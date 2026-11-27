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

export interface CreditAccountSqlRow {
  guild_id: string;
  user_id: string;
  score: number;
  updated_at: number;
}

export interface CreditLogSqlRow {
  id: number;
  guild_id: string;
  user_id: string;
  delta: number;
  score_after: number;
  reason: string;
  created_at: number;
}

export interface CreditReviewSqlRow {
  id: number;
  guild_id: string;
  reviewer_id: string;
  target_id: string;
  kind: CreditReviewKind;
  delta: number;
  date_key: string;
  created_at: number;
}

export interface LoanSqlRow {
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

export interface HustleStatsSqlRow {
  guild_id: string;
  user_id: string;
  total_count: number;
  total_earned: number;
  best_payout: number;
  last_hustle_at: number;
}

export interface GamblingStatsSqlRow {
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

export interface DeadbeatSqlRow {
  guild_id: string;
  user_id: string;
  score: number;
  overdue_loan_count: number;
  total_overdue_debt: number;
  updated_at: number;
}
