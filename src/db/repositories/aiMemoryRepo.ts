import type Database from 'better-sqlite3';

export type AiMemoryScopeType = 'user' | 'channel' | 'guild';
export type AiUsageStatus = 'ok' | 'error';

export const MAX_AI_USAGE_LOGS_PER_GUILD = 5000;

export const FREE_TIER_AI_MODEL_PREFIXES = [
  'pg/',
  'free/',
  'gemini-free/',
  'opal/',
  'agy/',
  'antigravity/',
  'webctl/',
] as const;

export function isFreeTierAiModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return false;
  return FREE_TIER_AI_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export interface AiUsageLogRecord {
  id: number;
  guildId: string;
  channelId: string;
  userId: string;
  model: string;
  status: AiUsageStatus;
  errorCode: string | null;
  attempts: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  usageEstimated: boolean;
  estimatedCostUsd: number;
  latencyMs: number;
  createdAt: number;
}

export interface AiUsageModelBreakdown {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface AiUsageUserBreakdown {
  userId: string;
  calls: number;
  totalTokens: number;
  costUsd: number;
}

export interface AiUsageSummary {
  totalCalls: number;
  okCalls: number;
  errorCalls: number;
  estimatedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  recordedCostUsd: number;
  estimatedCostUsd: number;
  byModel: AiUsageModelBreakdown[];
  topUsers: AiUsageUserBreakdown[];
}

interface AiUsageLogRow {
  id: number;
  guild_id: string;
  channel_id: string;
  user_id: string;
  model: string;
  status: AiUsageStatus;
  error_code: string | null;
  attempts: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  usage_estimated: number;
  estimated_cost_usd: number;
  latency_ms: number;
  created_at: number;
}

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

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  usage_estimated INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_guild_time
  ON ai_usage_logs (guild_id, created_at DESC, id DESC);
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

function mapUsageLogRow(row: AiUsageLogRow): AiUsageLogRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    model: row.model,
    status: row.status,
    errorCode: row.error_code,
    attempts: row.attempts,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    usageEstimated: row.usage_estimated !== 0,
    estimatedCostUsd: row.estimated_cost_usd,
    latencyMs: row.latency_ms,
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

  recordUsageLog(input: {
    guildId: string;
    channelId: string;
    userId: string;
    model: string;
    status: AiUsageStatus;
    errorCode?: string | null;
    attempts?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    usageEstimated?: boolean;
    estimatedCostUsd?: number;
    latencyMs?: number;
    createdAt?: number;
  }): AiUsageLogRecord {
    const now = input.createdAt ?? Date.now();
    const promptTokens = Math.max(0, Math.floor(input.promptTokens ?? 0));
    const completionTokens = Math.max(0, Math.floor(input.completionTokens ?? 0));
    const totalTokens = Math.max(0, Math.floor(input.totalTokens ?? promptTokens + completionTokens));
    const attempts = Math.max(1, Math.floor(input.attempts ?? 1));
    const latencyMs = Math.max(0, Math.floor(input.latencyMs ?? 0));
    const estimatedCostUsd =
      typeof input.estimatedCostUsd === 'number' && Number.isFinite(input.estimatedCostUsd)
        ? Math.max(0, input.estimatedCostUsd)
        : 0;

    return this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO ai_usage_logs (
            guild_id, channel_id, user_id, model, status, error_code,
            attempts, prompt_tokens, completion_tokens, total_tokens,
            usage_estimated, estimated_cost_usd, latency_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.guildId,
          input.channelId,
          input.userId,
          input.model,
          input.status,
          input.errorCode ?? null,
          attempts,
          promptTokens,
          completionTokens,
          totalTokens,
          input.usageEstimated ? 1 : 0,
          estimatedCostUsd,
          latencyMs,
          now,
        );

      this.db
        .prepare(
          `DELETE FROM ai_usage_logs
           WHERE guild_id = ?
             AND id NOT IN (
               SELECT id FROM ai_usage_logs
               WHERE guild_id = ?
               ORDER BY id DESC
               LIMIT ?
             )`,
        )
        .run(input.guildId, input.guildId, MAX_AI_USAGE_LOGS_PER_GUILD);

      const row = this.db
        .prepare('SELECT * FROM ai_usage_logs WHERE id = ?')
        .get(Number(info.lastInsertRowid)) as AiUsageLogRow;
      return mapUsageLogRow(row);
    })();
  }

  summarizeUsage(
    guildId: string,
    sinceMs: number,
    pricing?: { inputPricePer1MUsd: number; outputPricePer1MUsd: number },
  ): AiUsageSummary {
    const totalsRow = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total_calls,
          COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS ok_calls,
          COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS error_calls,
          COALESCE(SUM(CASE WHEN status = 'ok' AND usage_estimated = 1 THEN 1 ELSE 0 END), 0) AS estimated_calls,
          COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(AVG(latency_ms), 0) AS avg_latency_ms,
          COALESCE(SUM(estimated_cost_usd), 0) AS recorded_cost_usd
         FROM ai_usage_logs
         WHERE guild_id = ? AND created_at >= ?`,
      )
      .get(guildId, sinceMs) as {
      total_calls: number;
      ok_calls: number;
      error_calls: number;
      estimated_calls: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      avg_latency_ms: number;
      recorded_cost_usd: number;
    };

    const inputRate = Math.max(0, pricing?.inputPricePer1MUsd ?? 0);
    const outputRate = Math.max(0, pricing?.outputPricePer1MUsd ?? 0);
    const computeCost = (
      model: string,
      promptTok: number,
      completionTok: number,
      recorded: number,
    ): number => {
      if (isFreeTierAiModel(model)) return 0;
      return pricing
        ? (promptTok / 1_000_000) * inputRate + (completionTok / 1_000_000) * outputRate
        : recorded;
    };

    const modelRows = this.db
      .prepare(
        `SELECT
          model,
          COUNT(*) AS calls,
          COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(estimated_cost_usd), 0) AS recorded_cost_usd
         FROM ai_usage_logs
         WHERE guild_id = ? AND created_at >= ?
         GROUP BY model
         ORDER BY total_tokens DESC, calls DESC`,
      )
      .all(guildId, sinceMs) as Array<{
      model: string;
      calls: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      recorded_cost_usd: number;
    }>;

    const userModelRows = this.db
      .prepare(
        `SELECT
          user_id,
          model,
          COUNT(*) AS calls,
          COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(estimated_cost_usd), 0) AS recorded_cost_usd
         FROM ai_usage_logs
         WHERE guild_id = ? AND created_at >= ?
         GROUP BY user_id, model`,
      )
      .all(guildId, sinceMs) as Array<{
      user_id: string;
      model: string;
      calls: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      recorded_cost_usd: number;
    }>;

    const byModel = modelRows.map((m) => ({
      model: m.model,
      calls: m.calls,
      promptTokens: m.prompt_tokens,
      completionTokens: m.completion_tokens,
      totalTokens: m.total_tokens,
      costUsd: computeCost(m.model, m.prompt_tokens, m.completion_tokens, m.recorded_cost_usd),
    }));

    let billableRecordedCostUsd = 0;
    let billableEstimatedCostUsd = 0;
    for (let i = 0; i < modelRows.length; i++) {
      const m = modelRows[i];
      const computed = byModel[i];
      if (m && computed && !isFreeTierAiModel(m.model)) {
        billableRecordedCostUsd += m.recorded_cost_usd;
        billableEstimatedCostUsd += computed.costUsd;
      }
    }

    const userAgg = new Map<string, AiUsageUserBreakdown>();
    for (const row of userModelRows) {
      const rowCost = computeCost(
        row.model,
        row.prompt_tokens,
        row.completion_tokens,
        row.recorded_cost_usd,
      );
      const existing = userAgg.get(row.user_id);
      if (existing) {
        existing.calls += row.calls;
        existing.totalTokens += row.total_tokens;
        existing.costUsd += rowCost;
      } else {
        userAgg.set(row.user_id, {
          userId: row.user_id,
          calls: row.calls,
          totalTokens: row.total_tokens,
          costUsd: rowCost,
        });
      }
    }

    const topUsers = [...userAgg.values()]
      .sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls)
      .slice(0, 5);

    return {
      totalCalls: totalsRow.total_calls,
      okCalls: totalsRow.ok_calls,
      errorCalls: totalsRow.error_calls,
      estimatedCalls: totalsRow.estimated_calls,
      promptTokens: totalsRow.prompt_tokens,
      completionTokens: totalsRow.completion_tokens,
      totalTokens: totalsRow.total_tokens,
      avgLatencyMs: Math.round(totalsRow.avg_latency_ms),
      recordedCostUsd: billableRecordedCostUsd,
      estimatedCostUsd: billableEstimatedCostUsd,
      byModel,
      topUsers,
    };
  }

  listRecentUsageLogs(guildId: string, limit = 10): AiUsageLogRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM ai_usage_logs
         WHERE guild_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(guildId, safeLimit) as AiUsageLogRow[];
    return rows.map(mapUsageLogRow);
  }

  clearUsageLogs(guildId: string): number {
    const res = this.db
      .prepare('DELETE FROM ai_usage_logs WHERE guild_id = ?')
      .run(guildId);
    return res.changes;
  }
}
