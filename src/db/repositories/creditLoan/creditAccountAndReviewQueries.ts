import type Database from 'better-sqlite3';
import {
  clampPagination,
  mapCreditAccount,
  mapCreditLog,
  mapCreditReview,
} from './creditLoanMappers.js';
import type {
  CreditAccount,
  CreditAccountSqlRow,
  CreditLog,
  CreditLogSqlRow,
  CreditReview,
  CreditReviewKind,
  CreditReviewSqlRow,
  PaginatedResult,
} from './creditLoanTypesAndSchema.js';

export function getOrCreateCreditQuery(
  db: Database.Database,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): CreditAccount {
  const existing = db
    .prepare('SELECT * FROM credit_accounts WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as CreditAccountSqlRow | undefined;

  if (existing) {
    return mapCreditAccount(existing);
  }

  db.prepare(
    'INSERT OR IGNORE INTO credit_accounts (guild_id, user_id, score, updated_at) VALUES (?, ?, 600, ?)',
  ).run(guildId, userId, nowMs);

  const created = db
    .prepare('SELECT * FROM credit_accounts WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as CreditAccountSqlRow;

  return mapCreditAccount(created);
}

export function setCreditScoreQuery(
  db: Database.Database,
  guildId: string,
  userId: string,
  score: number,
  nowMs = Date.now(),
): CreditAccount {
  const cleanScore = Math.max(0, Math.min(1000, Math.trunc(score)));
  db.prepare(
    `INSERT INTO credit_accounts (guild_id, user_id, score, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       score = excluded.score,
       updated_at = excluded.updated_at`,
  ).run(guildId, userId, cleanScore, nowMs);

  return {
    guildId,
    userId,
    score: cleanScore,
    updatedAt: nowMs,
  };
}

export function addCreditLogQuery(
  db: Database.Database,
  input: {
    guildId: string;
    userId: string;
    delta: number;
    scoreAfter: number;
    reason: string;
    createdAt: number;
  },
): CreditLog {
  const res = db
    .prepare(
      `INSERT INTO credit_logs (guild_id, user_id, delta, score_after, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.guildId,
      input.userId,
      Math.trunc(input.delta),
      Math.trunc(input.scoreAfter),
      input.reason,
      input.createdAt,
    );

  const row = db
    .prepare('SELECT * FROM credit_logs WHERE id = ?')
    .get(Number(res.lastInsertRowid)) as CreditLogSqlRow | undefined;

  if (!row) {
    throw new Error('Failed to load inserted credit log');
  }
  return mapCreditLog(row);
}

export function listCreditLogsQuery(
  db: Database.Database,
  guildId: string,
  userId: string,
  limit = 10,
  offset = 0,
): PaginatedResult<CreditLog> {
  const page = clampPagination(limit, offset);
  const rows = db
    .prepare(
      `SELECT * FROM credit_logs
       WHERE guild_id = ? AND user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(guildId, userId, page.limit, page.offset) as CreditLogSqlRow[];
  const total = db
    .prepare('SELECT COUNT(*) AS cnt FROM credit_logs WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as { cnt: number };

  return { items: rows.map(mapCreditLog), total: total.cnt };
}

export function countReviewsByReviewerOnDateQuery(
  db: Database.Database,
  guildId: string,
  reviewerId: string,
  dateKey: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM credit_reviews
       WHERE guild_id = ? AND reviewer_id = ? AND date_key = ?`,
    )
    .get(guildId, reviewerId, dateKey) as { cnt: number };
  return row.cnt;
}

export function hasReviewedTargetRecentlyQuery(
  db: Database.Database,
  guildId: string,
  reviewerId: string,
  targetId: string,
  sinceMs: number,
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS found FROM credit_reviews
       WHERE guild_id = ? AND reviewer_id = ? AND target_id = ? AND created_at > ?
       LIMIT 1`,
    )
    .get(guildId, reviewerId, targetId, sinceMs) as { found: number } | undefined;
  return Boolean(row);
}

export function getLatestReviewForTargetQuery(
  db: Database.Database,
  guildId: string,
  reviewerId: string,
  targetId: string,
): CreditReview | null {
  const row = db
    .prepare(
      `SELECT * FROM credit_reviews
       WHERE guild_id = ? AND reviewer_id = ? AND target_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(guildId, reviewerId, targetId) as CreditReviewSqlRow | undefined;
  return row ? mapCreditReview(row) : null;
}

export function sumTargetDeltaOnDateQuery(
  db: Database.Database,
  guildId: string,
  targetId: string,
  dateKey: string,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(delta), 0) AS total FROM credit_reviews
       WHERE guild_id = ? AND target_id = ? AND date_key = ?`,
    )
    .get(guildId, targetId, dateKey) as { total: number };
  return row.total;
}

export function insertReviewQuery(
  db: Database.Database,
  input: {
    guildId: string;
    reviewerId: string;
    targetId: string;
    kind: CreditReviewKind;
    delta: number;
    dateKey: string;
    createdAt: number;
  },
): CreditReview {
  const res = db
    .prepare(
      `INSERT INTO credit_reviews (
        guild_id, reviewer_id, target_id, kind, delta, date_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.guildId,
      input.reviewerId,
      input.targetId,
      input.kind,
      Math.trunc(input.delta),
      input.dateKey,
      input.createdAt,
    );

  const row = db
    .prepare('SELECT * FROM credit_reviews WHERE id = ?')
    .get(Number(res.lastInsertRowid)) as CreditReviewSqlRow | undefined;

  if (!row) {
    throw new Error('Failed to load inserted credit review');
  }
  return mapCreditReview(row);
}

export function getCreditLeaderboardQuery(
  db: Database.Database,
  guildId: string,
  limit = 10,
  offset = 0,
): PaginatedResult<CreditAccount> {
  const page = clampPagination(limit, offset);
  const rows = db
    .prepare(
      `SELECT * FROM credit_accounts
       WHERE guild_id = ?
       ORDER BY score DESC, updated_at ASC, user_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(guildId, page.limit, page.offset) as CreditAccountSqlRow[];
  const total = db
    .prepare('SELECT COUNT(*) AS cnt FROM credit_accounts WHERE guild_id = ?')
    .get(guildId) as { cnt: number };

  return { items: rows.map(mapCreditAccount), total: total.cnt };
}
