import type Database from 'better-sqlite3';

export const CREDIT_LOAN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS credit_accounts (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 600,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_accounts_score
  ON credit_accounts (guild_id, score DESC, updated_at ASC);

CREATE TABLE IF NOT EXISTS credit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  score_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_logs_user
  ON credit_logs (guild_id, user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS credit_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('endorse', 'report')),
  delta INTEGER NOT NULL,
  date_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_reviews_reviewer_date
  ON credit_reviews (guild_id, reviewer_id, date_key);

CREATE INDEX IF NOT EXISTS idx_credit_reviews_pair_time
  ON credit_reviews (guild_id, reviewer_id, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_reviews_target_date
  ON credit_reviews (guild_id, target_id, date_key);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  loan_type TEXT NOT NULL CHECK (loan_type IN ('bank', 'usury')),
  principal INTEGER NOT NULL CHECK (principal >= 1),
  daily_rate REAL NOT NULL CHECK (daily_rate >= 0),
  remaining_principal INTEGER NOT NULL CHECK (remaining_principal >= 0),
  accrued_interest INTEGER NOT NULL DEFAULT 0 CHECK (accrued_interest >= 0),
  total_repaid INTEGER NOT NULL DEFAULT 0 CHECK (total_repaid >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'overdue', 'repaid')),
  term_days INTEGER NOT NULL CHECK (term_days >= 1),
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  last_accrual_date TEXT,
  last_notice_date TEXT,
  bounty_posted INTEGER NOT NULL DEFAULT 0,
  repaid_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_loans_guild_user_status
  ON loans (guild_id, user_id, status);

CREATE INDEX IF NOT EXISTS idx_loans_status_due
  ON loans (status, due_at);

CREATE TABLE IF NOT EXISTS hustle_stats (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0,
  best_payout INTEGER NOT NULL DEFAULT 0,
  last_hustle_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hustle_stats_guild_earned
  ON hustle_stats (guild_id, total_earned DESC, total_count DESC);

CREATE TABLE IF NOT EXISTS gambling_stats (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  total_wagered INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  total_lost INTEGER NOT NULL DEFAULT 0,
  net_profit INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  biggest_win INTEGER NOT NULL DEFAULT 0,
  biggest_loss INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_gambling_stats_guild_profit
  ON gambling_stats (guild_id, net_profit DESC, total_wagered DESC);
`;

export function initCreditLoanSchema(db: Database.Database): void {
  db.exec(CREDIT_LOAN_SCHEMA_SQL);
}

export type CreditReviewKind = 'endorse' | 'report';
export type LoanType = 'bank' | 'usury';
export type LoanStatus = 'active' | 'overdue' | 'repaid';
export type GamblingLeaderboardSort = 'profit' | 'loss';

export interface CreditAccount {
  guildId: string;
  userId: string;
  score: number;
  updatedAt: number;
}

export interface CreditLog {
  id: number;
  guildId: string;
  userId: string;
  delta: number;
  scoreAfter: number;
  reason: string;
  createdAt: number;
}

export interface CreditReview {
  id: number;
  guildId: string;
  reviewerId: string;
  targetId: string;
  kind: CreditReviewKind;
  delta: number;
  dateKey: string;
  createdAt: number;
}

export interface Loan {
  id: number;
  guildId: string;
  userId: string;
  loanType: LoanType;
  principal: number;
  dailyRate: number;
  remainingPrincipal: number;
  accruedInterest: number;
  totalRepaid: number;
  status: LoanStatus;
  termDays: number;
  createdAt: number;
  dueAt: number;
  lastAccrualDate: string | null;
  lastNoticeDate: string | null;
  bountyPosted: boolean;
  repaidAt: number | null;
}

export interface HustleStats {
  guildId: string;
  userId: string;
  totalCount: number;
  totalEarned: number;
  bestPayout: number;
  lastHustleAt: number;
}

export interface GamblingStats {
  guildId: string;
  userId: string;
  totalWagered: number;
  totalWon: number;
  totalLost: number;
  netProfit: number;
  gamesPlayed: number;
  biggestWin: number;
  biggestLoss: number;
  updatedAt: number;
}

export interface DeadbeatEntry {
  guildId: string;
  userId: string;
  score: number;
  overdueLoanCount: number;
  totalOverdueDebt: number;
  updatedAt: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

interface CreditAccountSqlRow {
  guild_id: string;
  user_id: string;
  score: number;
  updated_at: number;
}

interface CreditLogSqlRow {
  id: number;
  guild_id: string;
  user_id: string;
  delta: number;
  score_after: number;
  reason: string;
  created_at: number;
}

interface CreditReviewSqlRow {
  id: number;
  guild_id: string;
  reviewer_id: string;
  target_id: string;
  kind: CreditReviewKind;
  delta: number;
  date_key: string;
  created_at: number;
}

interface LoanSqlRow {
  id: number;
  guild_id: string;
  user_id: string;
  loan_type: LoanType;
  principal: number;
  daily_rate: number;
  remaining_principal: number;
  accrued_interest: number;
  total_repaid: number;
  status: LoanStatus;
  term_days: number;
  created_at: number;
  due_at: number;
  last_accrual_date: string | null;
  last_notice_date: string | null;
  bounty_posted: number;
  repaid_at: number | null;
}

interface HustleStatsSqlRow {
  guild_id: string;
  user_id: string;
  total_count: number;
  total_earned: number;
  best_payout: number;
  last_hustle_at: number;
}

interface GamblingStatsSqlRow {
  guild_id: string;
  user_id: string;
  total_wagered: number;
  total_won: number;
  total_lost: number;
  net_profit: number;
  games_played: number;
  biggest_win: number;
  biggest_loss: number;
  updated_at: number;
}

interface DeadbeatSqlRow {
  guild_id: string;
  user_id: string;
  score: number;
  overdue_loan_count: number;
  total_overdue_debt: number;
  updated_at: number;
}

function mapCreditAccount(row: CreditAccountSqlRow): CreditAccount {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    score: row.score,
    updatedAt: row.updated_at,
  };
}

function mapCreditLog(row: CreditLogSqlRow): CreditLog {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    delta: row.delta,
    scoreAfter: row.score_after,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function mapCreditReview(row: CreditReviewSqlRow): CreditReview {
  return {
    id: row.id,
    guildId: row.guild_id,
    reviewerId: row.reviewer_id,
    targetId: row.target_id,
    kind: row.kind,
    delta: row.delta,
    dateKey: row.date_key,
    createdAt: row.created_at,
  };
}

function mapLoan(row: LoanSqlRow): Loan {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    loanType: row.loan_type,
    principal: row.principal,
    dailyRate: row.daily_rate,
    remainingPrincipal: row.remaining_principal,
    accruedInterest: row.accrued_interest,
    totalRepaid: row.total_repaid,
    status: row.status,
    termDays: row.term_days,
    createdAt: row.created_at,
    dueAt: row.due_at,
    lastAccrualDate: row.last_accrual_date,
    lastNoticeDate: row.last_notice_date,
    bountyPosted: row.bounty_posted !== 0,
    repaidAt: row.repaid_at,
  };
}

function mapHustleStats(row: HustleStatsSqlRow): HustleStats {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    totalCount: row.total_count,
    totalEarned: row.total_earned,
    bestPayout: row.best_payout,
    lastHustleAt: row.last_hustle_at,
  };
}

function mapGamblingStats(row: GamblingStatsSqlRow): GamblingStats {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    totalWagered: row.total_wagered,
    totalWon: row.total_won,
    totalLost: row.total_lost,
    netProfit: row.net_profit,
    gamesPlayed: row.games_played,
    biggestWin: row.biggest_win,
    biggestLoss: row.biggest_loss,
    updatedAt: row.updated_at,
  };
}

function mapDeadbeatEntry(row: DeadbeatSqlRow): DeadbeatEntry {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    score: row.score,
    overdueLoanCount: row.overdue_loan_count,
    totalOverdueDebt: row.total_overdue_debt,
    updatedAt: row.updated_at,
  };
}

function clampPagination(limit: number, offset: number): { limit: number; offset: number } {
  return {
    limit: Math.max(1, Math.floor(limit)),
    offset: Math.max(0, Math.floor(offset)),
  };
}

export class CreditLoanRepo {
  constructor(private readonly db: Database.Database) {}

  // Credit accounts & logs
  getOrCreateCredit(guildId: string, userId: string, nowMs = Date.now()): CreditAccount {
    const existing = this.db
      .prepare('SELECT * FROM credit_accounts WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as CreditAccountSqlRow | undefined;

    if (existing) {
      return mapCreditAccount(existing);
    }

    this.db
      .prepare(
        'INSERT OR IGNORE INTO credit_accounts (guild_id, user_id, score, updated_at) VALUES (?, ?, 600, ?)',
      )
      .run(guildId, userId, nowMs);

    const created = this.db
      .prepare('SELECT * FROM credit_accounts WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as CreditAccountSqlRow;

    return mapCreditAccount(created);
  }

  setCreditScore(
    guildId: string,
    userId: string,
    score: number,
    nowMs = Date.now(),
  ): CreditAccount {
    const cleanScore = Math.max(0, Math.min(1000, Math.trunc(score)));
    this.db
      .prepare(
        `INSERT INTO credit_accounts (guild_id, user_id, score, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           score = excluded.score,
           updated_at = excluded.updated_at`,
      )
      .run(guildId, userId, cleanScore, nowMs);

    return {
      guildId,
      userId,
      score: cleanScore,
      updatedAt: nowMs,
    };
  }

  addCreditLog(input: {
    guildId: string;
    userId: string;
    delta: number;
    scoreAfter: number;
    reason: string;
    createdAt: number;
  }): CreditLog {
    const res = this.db
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

    const row = this.db
      .prepare('SELECT * FROM credit_logs WHERE id = ?')
      .get(Number(res.lastInsertRowid)) as CreditLogSqlRow | undefined;

    if (!row) {
      throw new Error('Failed to load inserted credit log');
    }
    return mapCreditLog(row);
  }

  listCreditLogs(
    guildId: string,
    userId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<CreditLog> {
    const page = clampPagination(limit, offset);
    const rows = this.db
      .prepare(
        `SELECT * FROM credit_logs
         WHERE guild_id = ? AND user_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(guildId, userId, page.limit, page.offset) as CreditLogSqlRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM credit_logs WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as { cnt: number };

    return { items: rows.map(mapCreditLog), total: total.cnt };
  }

  // Peer credit reviews
  countReviewsByReviewerOnDate(guildId: string, reviewerId: string, dateKey: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM credit_reviews
         WHERE guild_id = ? AND reviewer_id = ? AND date_key = ?`,
      )
      .get(guildId, reviewerId, dateKey) as { cnt: number };
    return row.cnt;
  }

  hasReviewedTargetRecently(
    guildId: string,
    reviewerId: string,
    targetId: string,
    sinceMs: number,
  ): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM credit_reviews
         WHERE guild_id = ? AND reviewer_id = ? AND target_id = ? AND created_at > ?
         LIMIT 1`,
      )
      .get(guildId, reviewerId, targetId, sinceMs) as { found: number } | undefined;
    return Boolean(row);
  }

  getLatestReviewForTarget(
    guildId: string,
    reviewerId: string,
    targetId: string,
  ): CreditReview | null {
    const row = this.db
      .prepare(
        `SELECT * FROM credit_reviews
         WHERE guild_id = ? AND reviewer_id = ? AND target_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .get(guildId, reviewerId, targetId) as CreditReviewSqlRow | undefined;
    return row ? mapCreditReview(row) : null;
  }

  sumTargetDeltaOnDate(guildId: string, targetId: string, dateKey: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(delta), 0) AS total FROM credit_reviews
         WHERE guild_id = ? AND target_id = ? AND date_key = ?`,
      )
      .get(guildId, targetId, dateKey) as { total: number };
    return row.total;
  }

  insertReview(input: {
    guildId: string;
    reviewerId: string;
    targetId: string;
    kind: CreditReviewKind;
    delta: number;
    dateKey: string;
    createdAt: number;
  }): CreditReview {
    const res = this.db
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

    const row = this.db
      .prepare('SELECT * FROM credit_reviews WHERE id = ?')
      .get(Number(res.lastInsertRowid)) as CreditReviewSqlRow | undefined;

    if (!row) {
      throw new Error('Failed to load inserted credit review');
    }
    return mapCreditReview(row);
  }

  // Loans
  createLoan(input: {
    guildId: string;
    userId: string;
    loanType: LoanType;
    principal: number;
    dailyRate: number;
    termDays: number;
    createdAt: number;
    dueAt: number;
    lastAccrualDate: string | null;
  }): Loan {
    const cleanPrincipal = Math.max(1, Math.floor(input.principal));
    const cleanTermDays = Math.max(1, Math.floor(input.termDays));
    const res = this.db
      .prepare(
        `INSERT INTO loans (
          guild_id, user_id, loan_type, principal, daily_rate,
          remaining_principal, accrued_interest, total_repaid, status,
          term_days, created_at, due_at, last_accrual_date, last_notice_date,
          bounty_posted, repaid_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'active', ?, ?, ?, ?, NULL, 0, NULL)`,
      )
      .run(
        input.guildId,
        input.userId,
        input.loanType,
        cleanPrincipal,
        input.dailyRate,
        cleanPrincipal,
        cleanTermDays,
        input.createdAt,
        input.dueAt,
        input.lastAccrualDate,
      );

    const created = this.getLoanById(Number(res.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to load created loan');
    }
    return created;
  }

  getLoanById(loanId: number): Loan | null {
    const row = this.db
      .prepare('SELECT * FROM loans WHERE id = ?')
      .get(loanId) as LoanSqlRow | undefined;
    return row ? mapLoan(row) : null;
  }

  listUserLoans(
    guildId: string,
    userId: string,
    options?: {
      status?: LoanStatus;
      statuses?: readonly LoanStatus[];
      loanType?: LoanType;
    },
  ): Loan[] {
    const clauses: string[] = ['guild_id = ?', 'user_id = ?'];
    const params: Array<string | number> = [guildId, userId];

    if (options?.status) {
      clauses.push('status = ?');
      params.push(options.status);
    } else if (options?.statuses && options.statuses.length > 0) {
      const placeholders = options.statuses.map(() => '?').join(', ');
      clauses.push(`status IN (${placeholders})`);
      params.push(...options.statuses);
    }

    if (options?.loanType) {
      clauses.push('loan_type = ?');
      params.push(options.loanType);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM loans
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at ASC, id ASC`,
      )
      .all(...params) as LoanSqlRow[];

    return rows.map(mapLoan);
  }

  listOpenLoans(guildId?: string): Loan[] {
    if (guildId) {
      const rows = this.db
        .prepare(
          `SELECT * FROM loans
           WHERE guild_id = ? AND status IN ('active', 'overdue')
           ORDER BY due_at ASC, id ASC`,
        )
        .all(guildId) as LoanSqlRow[];
      return rows.map(mapLoan);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM loans
         WHERE status IN ('active', 'overdue')
         ORDER BY due_at ASC, id ASC`,
      )
      .all() as LoanSqlRow[];
    return rows.map(mapLoan);
  }

  listDueOrOverdueLoans(nowMs: number, guildId?: string): Loan[] {
    if (guildId) {
      const rows = this.db
        .prepare(
          `SELECT * FROM loans
           WHERE guild_id = ? AND (status = 'overdue' OR (status = 'active' AND due_at < ?))
           ORDER BY due_at ASC, id ASC`,
        )
        .all(guildId, nowMs) as LoanSqlRow[];
      return rows.map(mapLoan);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM loans
         WHERE status = 'overdue' OR (status = 'active' AND due_at < ?)
         ORDER BY due_at ASC, id ASC`,
      )
      .all(nowMs) as LoanSqlRow[];
    return rows.map(mapLoan);
  }

  updateLoan(loan: Loan): void {
    this.db
      .prepare(
        `UPDATE loans SET
          remaining_principal = ?,
          accrued_interest = ?,
          total_repaid = ?,
          status = ?,
          last_accrual_date = ?,
          last_notice_date = ?,
          bounty_posted = ?,
          repaid_at = ?
         WHERE id = ?`,
      )
      .run(
        Math.max(0, Math.floor(loan.remainingPrincipal)),
        Math.max(0, Math.floor(loan.accruedInterest)),
        Math.max(0, Math.floor(loan.totalRepaid)),
        loan.status,
        loan.lastAccrualDate,
        loan.lastNoticeDate,
        loan.bountyPosted ? 1 : 0,
        loan.repaidAt,
        loan.id,
      );
  }

  // Hustle stats
  getOrCreateHustleStats(guildId: string, userId: string): HustleStats {
    const existing = this.db
      .prepare('SELECT * FROM hustle_stats WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as HustleStatsSqlRow | undefined;

    if (existing) {
      return mapHustleStats(existing);
    }

    this.db
      .prepare('INSERT OR IGNORE INTO hustle_stats (guild_id, user_id) VALUES (?, ?)')
      .run(guildId, userId);

    const created = this.db
      .prepare('SELECT * FROM hustle_stats WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as HustleStatsSqlRow;

    return mapHustleStats(created);
  }

  saveHustleStats(stats: HustleStats): void {
    this.db
      .prepare(
        `INSERT INTO hustle_stats (
          guild_id, user_id, total_count, total_earned, best_payout, last_hustle_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          total_count = excluded.total_count,
          total_earned = excluded.total_earned,
          best_payout = excluded.best_payout,
          last_hustle_at = excluded.last_hustle_at`,
      )
      .run(
        stats.guildId,
        stats.userId,
        Math.max(0, Math.floor(stats.totalCount)),
        Math.max(0, Math.floor(stats.totalEarned)),
        Math.max(0, Math.floor(stats.bestPayout)),
        Math.max(0, Math.floor(stats.lastHustleAt)),
      );
  }

  resetAllHustleCooldowns(guildId: string): number {
    const res = this.db
      .prepare('UPDATE hustle_stats SET last_hustle_at = 0 WHERE guild_id = ? AND last_hustle_at > 0')
      .run(guildId);
    return res.changes;
  }

  // Gambling stats
  getOrCreateGamblingStats(guildId: string, userId: string): GamblingStats {
    const existing = this.db
      .prepare('SELECT * FROM gambling_stats WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as GamblingStatsSqlRow | undefined;

    if (existing) {
      return mapGamblingStats(existing);
    }

    this.db
      .prepare('INSERT OR IGNORE INTO gambling_stats (guild_id, user_id) VALUES (?, ?)')
      .run(guildId, userId);

    const created = this.db
      .prepare('SELECT * FROM gambling_stats WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as GamblingStatsSqlRow;

    return mapGamblingStats(created);
  }

  recordGamblingDelta(
    guildId: string,
    userId: string,
    wager: number,
    netChange: number,
    nowMs = Date.now(),
  ): GamblingStats {
    const cleanWager = Math.max(0, Math.floor(wager));
    const cleanNet = Math.trunc(netChange);
    const wonDelta = cleanNet > 0 ? cleanNet : 0;
    const lostDelta = cleanNet < 0 ? Math.abs(cleanNet) : 0;

    return this.db.transaction((): GamblingStats => {
      const current = this.getOrCreateGamblingStats(guildId, userId);
      const next: GamblingStats = {
        guildId,
        userId,
        totalWagered: current.totalWagered + cleanWager,
        totalWon: current.totalWon + wonDelta,
        totalLost: current.totalLost + lostDelta,
        netProfit: current.netProfit + cleanNet,
        gamesPlayed: current.gamesPlayed + 1,
        biggestWin: Math.max(current.biggestWin, wonDelta),
        biggestLoss: Math.max(current.biggestLoss, lostDelta),
        updatedAt: nowMs,
      };

      this.db
        .prepare(
          `UPDATE gambling_stats SET
            total_wagered = ?,
            total_won = ?,
            total_lost = ?,
            net_profit = ?,
            games_played = ?,
            biggest_win = ?,
            biggest_loss = ?,
            updated_at = ?
           WHERE guild_id = ? AND user_id = ?`,
        )
        .run(
          next.totalWagered,
          next.totalWon,
          next.totalLost,
          next.netProfit,
          next.gamesPlayed,
          next.biggestWin,
          next.biggestLoss,
          next.updatedAt,
          guildId,
          userId,
        );

      return next;
    })();
  }

  // Leaderboards
  getCreditLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<CreditAccount> {
    const page = clampPagination(limit, offset);
    const rows = this.db
      .prepare(
        `SELECT * FROM credit_accounts
         WHERE guild_id = ?
         ORDER BY score DESC, updated_at ASC, user_id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(guildId, page.limit, page.offset) as CreditAccountSqlRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM credit_accounts WHERE guild_id = ?')
      .get(guildId) as { cnt: number };

    return { items: rows.map(mapCreditAccount), total: total.cnt };
  }

  getDeadbeatLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<DeadbeatEntry> {
    const page = clampPagination(limit, offset);
    const rows = this.db
      .prepare(
        `WITH overdue_agg AS (
           SELECT
             guild_id,
             user_id,
             COUNT(*) AS overdue_loan_count,
             COALESCE(SUM(remaining_principal + accrued_interest), 0) AS total_overdue_debt
           FROM loans
           WHERE guild_id = ? AND status = 'overdue'
           GROUP BY guild_id, user_id
         ),
         deadbeat_users AS (
           SELECT user_id FROM credit_accounts WHERE guild_id = ? AND score < 300
           UNION
           SELECT user_id FROM overdue_agg
         )
         SELECT
           ? AS guild_id,
           du.user_id,
           COALESCE(ca.score, 600) AS score,
           COALESCE(oa.overdue_loan_count, 0) AS overdue_loan_count,
           COALESCE(oa.total_overdue_debt, 0) AS total_overdue_debt,
           COALESCE(ca.updated_at, 0) AS updated_at
         FROM deadbeat_users du
         LEFT JOIN credit_accounts ca ON ca.guild_id = ? AND ca.user_id = du.user_id
         LEFT JOIN overdue_agg oa ON oa.guild_id = ? AND oa.user_id = du.user_id
         ORDER BY total_overdue_debt DESC, score ASC, du.user_id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(
        guildId,
        guildId,
        guildId,
        guildId,
        guildId,
        page.limit,
        page.offset,
      ) as DeadbeatSqlRow[];

    const total = this.db
      .prepare(
        `WITH deadbeat_users AS (
           SELECT user_id FROM credit_accounts WHERE guild_id = ? AND score < 300
           UNION
           SELECT DISTINCT user_id FROM loans WHERE guild_id = ? AND status = 'overdue'
         )
         SELECT COUNT(*) AS cnt FROM deadbeat_users`,
      )
      .get(guildId, guildId) as { cnt: number };

    return { items: rows.map(mapDeadbeatEntry), total: total.cnt };
  }

  getHustleLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<HustleStats> {
    const page = clampPagination(limit, offset);
    const rows = this.db
      .prepare(
        `SELECT * FROM hustle_stats
         WHERE guild_id = ? AND total_count > 0
         ORDER BY total_earned DESC, total_count DESC, best_payout DESC, user_id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(guildId, page.limit, page.offset) as HustleStatsSqlRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM hustle_stats WHERE guild_id = ? AND total_count > 0')
      .get(guildId) as { cnt: number };

    return { items: rows.map(mapHustleStats), total: total.cnt };
  }

  getGamblingLeaderboard(
    guildId: string,
    sort: GamblingLeaderboardSort,
    limit = 10,
    offset = 0,
  ): PaginatedResult<GamblingStats> {
    const page = clampPagination(limit, offset);
    const orderClause =
      sort === 'profit'
        ? 'net_profit DESC, total_won DESC, games_played DESC, user_id ASC'
        : 'net_profit ASC, total_lost DESC, games_played DESC, user_id ASC';

    const rows = this.db
      .prepare(
        `SELECT * FROM gambling_stats
         WHERE guild_id = ? AND games_played > 0
         ORDER BY ${orderClause}
         LIMIT ? OFFSET ?`,
      )
      .all(guildId, page.limit, page.offset) as GamblingStatsSqlRow[];
    const total = this.db
      .prepare(
        'SELECT COUNT(*) AS cnt FROM gambling_stats WHERE guild_id = ? AND games_played > 0',
      )
      .get(guildId) as { cnt: number };

    return { items: rows.map(mapGamblingStats), total: total.cnt };
  }
}
