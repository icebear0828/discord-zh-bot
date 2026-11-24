import type Database from 'better-sqlite3';

export type AiMemoryScopeType = 'user' | 'channel' | 'guild';

export interface AiMemoryRecord {
  id: number;
  guildId: string;
  scopeType: AiMemoryScopeType;
  scopeId: string;
  category: string;
  content: string;
  createdBy: string;
  createdAt: number;
}

interface AiMemoryRow {
  id: number;
  guild_id: string;
  scope_type: AiMemoryScopeType;
  scope_id: string;
  category: string;
  content: string;
  created_by: string;
  created_at: number;
}

const AI_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ai_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'channel', 'guild')),
  scope_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_scope
  ON ai_memories (guild_id, scope_type, scope_id, id DESC);

CREATE TABLE IF NOT EXISTS ai_channel_resets (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  reset_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);
`;

export function initAiSchema(db: Database.Database): void {
  db.exec(AI_SCHEMA_SQL);
}

function mapMemoryRow(row: AiMemoryRow): AiMemoryRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    category: row.category,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function normalizeCategory(raw: string): string {
  const cleaned = raw.trim().replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24);
  return cleaned || 'general';
}

function normalizeContent(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 200);
}

export class AiMemoryRepo {
  constructor(private readonly db: Database.Database) {}

  addMemory(input: {
    guildId: string;
    scopeType: AiMemoryScopeType;
    scopeId: string;
    category: string;
    content: string;
    createdBy: string;
    maxPerScope?: number;
    nowMs?: number;
  }): AiMemoryRecord {
    const category = normalizeCategory(input.category);
    const content = normalizeContent(input.content);
    if (!content) {
      throw new Error('记忆内容不能为空');
    }
    const now = input.nowMs ?? Date.now();
    const maxPerScope = input.maxPerScope ?? 30;

    return this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `SELECT * FROM ai_memories
           WHERE guild_id = ? AND scope_type = ? AND scope_id = ? AND content = ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(input.guildId, input.scopeType, input.scopeId, content) as AiMemoryRow | undefined;

      if (existing) {
        this.db
          .prepare(
            `UPDATE ai_memories SET category = ?, created_at = ?, created_by = ? WHERE id = ?`,
          )
          .run(category, now, input.createdBy, existing.id);
        const updated = this.db
          .prepare('SELECT * FROM ai_memories WHERE id = ?')
          .get(existing.id) as AiMemoryRow;
        return mapMemoryRow(updated);
      }

      const info = this.db
        .prepare(
          `INSERT INTO ai_memories (
            guild_id, scope_type, scope_id, category, content, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.guildId,
          input.scopeType,
          input.scopeId,
          category,
          content,
          input.createdBy,
          now,
        );

      if (maxPerScope > 0) {
        this.db
          .prepare(
            `DELETE FROM ai_memories
             WHERE guild_id = ? AND scope_type = ? AND scope_id = ?
               AND id NOT IN (
                 SELECT id FROM ai_memories
                 WHERE guild_id = ? AND scope_type = ? AND scope_id = ?
                 ORDER BY id DESC
                 LIMIT ?
               )`,
          )
          .run(
            input.guildId,
            input.scopeType,
            input.scopeId,
            input.guildId,
            input.scopeType,
            input.scopeId,
            maxPerScope,
          );
      }

      const inserted = this.db
        .prepare('SELECT * FROM ai_memories WHERE id = ?')
        .get(Number(info.lastInsertRowid)) as AiMemoryRow;
      return mapMemoryRow(inserted);
    })();
  }

  listMemories(
    guildId: string,
    scopeType: AiMemoryScopeType,
    scopeId: string,
    limit = 30,
  ): AiMemoryRecord[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM ai_memories
         WHERE guild_id = ? AND scope_type = ? AND scope_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(guildId, scopeType, scopeId, safeLimit) as AiMemoryRow[];
    return rows.map(mapMemoryRow);
  }

  listMemoriesChronological(
    guildId: string,
    scopeType: AiMemoryScopeType,
    scopeId: string,
    limit = 30,
  ): AiMemoryRecord[] {
    return this.listMemories(guildId, scopeType, scopeId, limit).reverse();
  }

  getById(guildId: string, id: number): AiMemoryRecord | null {
    const row = this.db
      .prepare('SELECT * FROM ai_memories WHERE guild_id = ? AND id = ?')
      .get(guildId, id) as AiMemoryRow | undefined;
    return row ? mapMemoryRow(row) : null;
  }

  deleteById(guildId: string, id: number): boolean {
    const res = this.db
      .prepare('DELETE FROM ai_memories WHERE guild_id = ? AND id = ?')
      .run(guildId, id);
    return res.changes > 0;
  }

  clearScope(guildId: string, scopeType: AiMemoryScopeType, scopeId: string): number {
    const res = this.db
      .prepare('DELETE FROM ai_memories WHERE guild_id = ? AND scope_type = ? AND scope_id = ?')
      .run(guildId, scopeType, scopeId);
    return res.changes;
  }

  countByGuild(guildId: string): {
    total: number;
    user: number;
    channel: number;
    guild: number;
  } {
    const rows = this.db
      .prepare(
        `SELECT scope_type, COUNT(*) AS cnt
         FROM ai_memories
         WHERE guild_id = ?
         GROUP BY scope_type`,
      )
      .all(guildId) as Array<{ scope_type: AiMemoryScopeType; cnt: number }>;

    const counts = { total: 0, user: 0, channel: 0, guild: 0 };
    for (const row of rows) {
      counts[row.scope_type] = row.cnt;
      counts.total += row.cnt;
    }
    return counts;
  }

  getChannelResetAt(guildId: string, channelId: string): number {
    const row = this.db
      .prepare('SELECT reset_at FROM ai_channel_resets WHERE guild_id = ? AND channel_id = ?')
      .get(guildId, channelId) as { reset_at: number } | undefined;
    return row?.reset_at ?? 0;
  }

  setChannelResetAt(guildId: string, channelId: string, resetAt: number): void {
    this.db
      .prepare(
        `INSERT INTO ai_channel_resets (guild_id, channel_id, reset_at)
         VALUES (?, ?, ?)
         ON CONFLICT(guild_id, channel_id) DO UPDATE SET reset_at = excluded.reset_at`,
      )
      .run(guildId, channelId, resetAt);
  }
}
