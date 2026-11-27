import type {
  CreditAccount,
  CreditAccountSqlRow,
  CreditLog,
  CreditLogSqlRow,
  CreditReview,
  CreditReviewSqlRow,
  DeadbeatEntry,
  DeadbeatSqlRow,
  GamblingStats,
  GamblingStatsSqlRow,
  HustleStats,
  HustleStatsSqlRow,
  Loan,
  LoanSqlRow,
} from './creditLoanTypesAndSchema.js';

export function mapCreditAccount(row: CreditAccountSqlRow): CreditAccount {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    score: row.score,
    updatedAt: row.updated_at,
  };
}

export function mapCreditLog(row: CreditLogSqlRow): CreditLog {
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

export function mapCreditReview(row: CreditReviewSqlRow): CreditReview {
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

export function mapLoan(row: LoanSqlRow): Loan {
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

export function mapHustleStats(row: HustleStatsSqlRow): HustleStats {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    totalCount: row.total_count,
    totalEarned: row.total_earned,
    bestPayout: row.best_payout,
    lastHustleAt: row.last_hustle_at,
  };
}

export function mapGamblingStats(row: GamblingStatsSqlRow): GamblingStats {
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

export function mapDeadbeatEntry(row: DeadbeatSqlRow): DeadbeatEntry {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    score: row.score,
    overdueLoanCount: row.overdue_loan_count,
    totalOverdueDebt: row.total_overdue_debt,
    updatedAt: row.updated_at,
  };
}

export function clampPagination(limit: number, offset: number): { limit: number; offset: number } {
  return {
    limit: Math.max(1, Math.floor(limit)),
    offset: Math.max(0, Math.floor(offset)),
  };
}
