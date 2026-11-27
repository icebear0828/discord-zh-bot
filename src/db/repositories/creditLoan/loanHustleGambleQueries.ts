import type Database from 'better-sqlite3';
import {
  clampPagination,
  mapDeadbeatEntry,
  mapGamblingStats,
  mapHustleStats,
  mapLoan,
} from './creditLoanMappers.js';
import type {
  DeadbeatEntry,
  DeadbeatSqlRow,
  GamblingLeaderboardSort,
  GamblingStats,
  GamblingStatsSqlRow,
  HustleStats,
  HustleStatsSqlRow,
  Loan,
  LoanSqlRow,
  LoanStatus,
  LoanType,
  PaginatedResult,
} from './creditLoanTypesAndSchema.js';

export function getLoanByIdQuery(db: Database.Database, loanId: number): Loan | null {
  const row = db
    .prepare('SELECT * FROM loans WHERE id = ?')
    .get(loanId) as LoanSqlRow | undefined;
  return row ? mapLoan(row) : null;
}

export function createLoanQuery(
  db: Database.Database,
  input: {
    guildId: string;
    userId: string;
    loanType: LoanType;
    principal: number;
    dailyRate: number;
    termDays: number;
    createdAt: number;
    dueAt: number;
    lastAccrualDate: string | null;
  },
): Loan {
  const cleanPrincipal = Math.max(1, Math.floor(input.principal));
  const cleanTermDays = Math.max(1, Math.floor(input.termDays));
  const res = db
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

  const created = getLoanByIdQuery(db, Number(res.lastInsertRowid));
  if (!created) {
    throw new Error('Failed to load created loan');
  }
  return created;
}

export function listUserLoansQuery(
  db: Database.Database,
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

  const rows = db
    .prepare(
      `SELECT * FROM loans
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at ASC, id ASC`,
    )
    .all(...params) as LoanSqlRow[];

  return rows.map(mapLoan);
}

export function listOpenLoansQuery(db: Database.Database, guildId?: string): Loan[] {
  if (guildId) {
    const rows = db
      .prepare(
        `SELECT * FROM loans
         WHERE guild_id = ? AND status IN ('active', 'overdue')
         ORDER BY due_at ASC, id ASC`,
      )
      .all(guildId) as LoanSqlRow[];
    return rows.map(mapLoan);
  }

  const rows = db
    .prepare(
      `SELECT * FROM loans
       WHERE status IN ('active', 'overdue')
       ORDER BY due_at ASC, id ASC`,
    )
    .all() as LoanSqlRow[];
  return rows.map(mapLoan);
}

export function listDueOrOverdueLoansQuery(
  db: Database.Database,
  nowMs: number,
  guildId?: string,
): Loan[] {
  if (guildId) {
    const rows = db
      .prepare(
        `SELECT * FROM loans
         WHERE guild_id = ? AND (status = 'overdue' OR (status = 'active' AND due_at < ?))
         ORDER BY due_at ASC, id ASC`,
      )
      .all(guildId, nowMs) as LoanSqlRow[];
    return rows.map(mapLoan);
  }

  const rows = db
    .prepare(
      `SELECT * FROM loans
       WHERE status = 'overdue' OR (status = 'active' AND due_at < ?)
       ORDER BY due_at ASC, id ASC`,
    )
    .all(nowMs) as LoanSqlRow[];
  return rows.map(mapLoan);
}

export function updateLoanQuery(db: Database.Database, loan: Loan): void {
  db.prepare(
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
  ).run(
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

export function getOrCreateHustleStatsQuery(
  db: Database.Database,
  guildId: string,
  userId: string,
): HustleStats {
  const existing = db
    .prepare('SELECT * FROM hustle_stats WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as HustleStatsSqlRow | undefined;

  if (existing) {
    return mapHustleStats(existing);
  }

  db.prepare('INSERT OR IGNORE INTO hustle_stats (guild_id, user_id) VALUES (?, ?)').run(
    guildId,
    userId,
  );

  const created = db
    .prepare('SELECT * FROM hustle_stats WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as HustleStatsSqlRow;

  return mapHustleStats(created);
}

export function saveHustleStatsQuery(db: Database.Database, stats: HustleStats): void {
  db.prepare(
    `INSERT INTO hustle_stats (
      guild_id, user_id, total_count, total_earned, best_payout, last_hustle_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      total_count = excluded.total_count,
      total_earned = excluded.total_earned,
      best_payout = excluded.best_payout,
      last_hustle_at = excluded.last_hustle_at`,
  ).run(
    stats.guildId,
    stats.userId,
    Math.max(0, Math.floor(stats.totalCount)),
    Math.max(0, Math.floor(stats.totalEarned)),
    Math.max(0, Math.floor(stats.bestPayout)),
    Math.max(0, Math.floor(stats.lastHustleAt)),
  );
}

export function resetAllHustleCooldownsQuery(db: Database.Database, guildId: string): number {
  const res = db
    .prepare('UPDATE hustle_stats SET last_hustle_at = 0 WHERE guild_id = ? AND last_hustle_at > 0')
    .run(guildId);
  return res.changes;
}

export function getOrCreateGamblingStatsQuery(
  db: Database.Database,
  guildId: string,
  userId: string,
): GamblingStats {
  const existing = db
    .prepare('SELECT * FROM gambling_stats WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as GamblingStatsSqlRow | undefined;

  if (existing) {
    return mapGamblingStats(existing);
  }

  db.prepare('INSERT OR IGNORE INTO gambling_stats (guild_id, user_id) VALUES (?, ?)').run(
    guildId,
    userId,
  );

  const created = db
    .prepare('SELECT * FROM gambling_stats WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId) as GamblingStatsSqlRow;

  return mapGamblingStats(created);
}

export function recordGamblingDeltaQuery(
  db: Database.Database,
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

  return db.transaction((): GamblingStats => {
    const current = getOrCreateGamblingStatsQuery(db, guildId, userId);
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

    db.prepare(
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
    ).run(
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

export function getDeadbeatLeaderboardQuery(
  db: Database.Database,
  guildId: string,
  limit = 10,
  offset = 0,
): PaginatedResult<DeadbeatEntry> {
  const page = clampPagination(limit, offset);
  const rows = db
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

  const total = db
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

export function getHustleLeaderboardQuery(
  db: Database.Database,
  guildId: string,
  limit = 10,
  offset = 0,
): PaginatedResult<HustleStats> {
  const page = clampPagination(limit, offset);
  const rows = db
    .prepare(
      `SELECT * FROM hustle_stats
       WHERE guild_id = ? AND total_count > 0
       ORDER BY total_earned DESC, total_count DESC, best_payout DESC, user_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(guildId, page.limit, page.offset) as HustleStatsSqlRow[];
  const total = db
    .prepare('SELECT COUNT(*) AS cnt FROM hustle_stats WHERE guild_id = ? AND total_count > 0')
    .get(guildId) as { cnt: number };

  return { items: rows.map(mapHustleStats), total: total.cnt };
}

export function getGamblingLeaderboardQuery(
  db: Database.Database,
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

  const rows = db
    .prepare(
      `SELECT * FROM gambling_stats
       WHERE guild_id = ? AND games_played > 0
       ORDER BY ${orderClause}
       LIMIT ? OFFSET ?`,
    )
    .all(guildId, page.limit, page.offset) as GamblingStatsSqlRow[];
  const total = db
    .prepare(
      'SELECT COUNT(*) AS cnt FROM gambling_stats WHERE guild_id = ? AND games_played > 0',
    )
    .get(guildId) as { cnt: number };

  return { items: rows.map(mapGamblingStats), total: total.cnt };
}
