import type Database from 'better-sqlite3';

export type InteractionLogStatus = 'ok' | 'slow' | 'unhandled' | 'error';

export type InteractionKind =
  | 'command'
  | 'button'
  | 'string_select'
  | 'user_select'
  | 'role_select'
  | 'channel_select'
  | 'modal'
  | 'other';

export interface InteractionLogEntry {
  id: number;
  guildId: string | null;
  channelId: string | null;
  userId: string;
  userName: string;
  interactionType: InteractionKind;
  interactionKey: string;
  status: InteractionLogStatus;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
}

export interface InteractionMonitorSummary {
  totalCount: number;
  okCount: number;
  slowCount: number;
  unhandledCount: number;
  errorCount: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

interface InteractionLogRow {
  id: number;
  guild_id: string | null;
  channel_id: string | null;
  user_id: string;
  user_name: string;
  interaction_type: InteractionKind;
  interaction_key: string;
  status: InteractionLogStatus;
  duration_ms: number;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
}

const MONITOR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS interaction_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  channel_id TEXT,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  interaction_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'slow', 'unhandled', 'error')),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interaction_logs_guild_id
  ON interaction_logs (guild_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_interaction_logs_guild_status
  ON interaction_logs (guild_id, status, id DESC);

CREATE INDEX IF NOT EXISTS idx_interaction_logs_created_at
  ON interaction_logs (created_at);
`;

function mapRow(row: InteractionLogRow): InteractionLogEntry {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    userName: row.user_name,
    interactionType: row.interaction_type,
    interactionKey: row.interaction_key,
    status: row.status,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

const MAX_LOGS_PER_GUILD = 2000;

export function initMonitorSchema(db: Database.Database): void {
  db.exec(MONITOR_SCHEMA_SQL);
}

export class MonitorRepo {
  private writeCounter = 0;

  constructor(private readonly db: Database.Database) {}

  record(input: {
    guildId: string | null;
    channelId: string | null;
    userId: string;
    userName: string;
    interactionType: InteractionKind;
    interactionKey: string;
    status: InteractionLogStatus;
    durationMs: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    createdAt?: number;
  }): InteractionLogEntry {
    const createdAt = input.createdAt ?? Date.now();
    const durationMs = Math.max(0, Math.round(input.durationMs));
    const errorCode = input.errorCode ?? null;
    const errorMessage = input.errorMessage ? input.errorMessage.slice(0, 1000) : null;

    const info = this.db
      .prepare(
        `INSERT INTO interaction_logs (
          guild_id, channel_id, user_id, user_name,
          interaction_type, interaction_key, status, duration_ms,
          error_code, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.userId,
        input.userName,
        input.interactionType,
        input.interactionKey,
        input.status,
        durationMs,
        errorCode,
        errorMessage,
        createdAt,
      );

    this.writeCounter += 1;
    if (input.guildId && this.writeCounter % 50 === 0) {
      this.pruneOldLogs(input.guildId, MAX_LOGS_PER_GUILD);
    }

    return {
      id: Number(info.lastInsertRowid),
      guildId: input.guildId,
      channelId: input.channelId,
      userId: input.userId,
      userName: input.userName,
      interactionType: input.interactionType,
      interactionKey: input.interactionKey,
      status: input.status,
      durationMs,
      errorCode,
      errorMessage,
      createdAt,
    };
  }

  getSummary(guildId: string, sinceMs = Date.now() - 86_400_000): InteractionMonitorSummary {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
          SUM(CASE WHEN status = 'slow' THEN 1 ELSE 0 END) AS slow_count,
          SUM(CASE WHEN status = 'unhandled' THEN 1 ELSE 0 END) AS unhandled_count,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
          AVG(duration_ms) AS avg_duration,
          MAX(duration_ms) AS max_duration
         FROM interaction_logs
         WHERE (guild_id = ? OR guild_id IS NULL) AND created_at >= ?`,
      )
      .get(guildId, sinceMs) as {
      total_count: number;
      ok_count: number | null;
      slow_count: number | null;
      unhandled_count: number | null;
      error_count: number | null;
      avg_duration: number | null;
      max_duration: number | null;
    };

    return {
      totalCount: row.total_count ?? 0,
      okCount: row.ok_count ?? 0,
      slowCount: row.slow_count ?? 0,
      unhandledCount: row.unhandled_count ?? 0,
      errorCount: row.error_count ?? 0,
      avgDurationMs: Math.round(row.avg_duration ?? 0),
      maxDurationMs: row.max_duration ?? 0,
    };
  }

  listRecent(
    guildId: string,
    opts?: { onlyIssues?: boolean; limit?: number },
  ): InteractionLogEntry[] {
    const limit = Math.max(1, Math.min(100, Math.floor(opts?.limit ?? 15)));
    if (opts?.onlyIssues) {
      const rows = this.db
        .prepare(
          `SELECT * FROM interaction_logs
           WHERE (guild_id = ? OR guild_id IS NULL)
             AND status IN ('slow', 'unhandled', 'error')
           ORDER BY id DESC LIMIT ?`,
        )
        .all(guildId, limit) as InteractionLogRow[];
      return rows.map(mapRow);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM interaction_logs
         WHERE (guild_id = ? OR guild_id IS NULL)
         ORDER BY id DESC LIMIT ?`,
      )
      .all(guildId, limit) as InteractionLogRow[];
    return rows.map(mapRow);
  }

  clearGuildLogs(guildId: string): number {
    const res = this.db
      .prepare('DELETE FROM interaction_logs WHERE guild_id = ? OR guild_id IS NULL')
      .run(guildId);
    return res.changes;
  }

  pruneOldLogs(guildId: string, keepCount = MAX_LOGS_PER_GUILD): number {
    const cutoff = this.db
      .prepare(
        `SELECT id FROM interaction_logs
         WHERE guild_id = ?
         ORDER BY id DESC
         LIMIT 1 OFFSET ?`,
      )
      .get(guildId, Math.max(1, keepCount)) as { id: number } | undefined;
    if (!cutoff) return 0;

    const res = this.db
      .prepare('DELETE FROM interaction_logs WHERE guild_id = ? AND id <= ?')
      .run(guildId, cutoff.id);
    return res.changes;
  }

  pruneOlderThan(cutoffMs: number): number {
    const res = this.db
      .prepare('DELETE FROM interaction_logs WHERE created_at < ?')
      .run(cutoffMs);
    return res.changes;
  }
}
