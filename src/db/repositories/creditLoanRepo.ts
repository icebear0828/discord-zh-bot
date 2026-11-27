import type Database from 'better-sqlite3';
import {
  addCreditLogQuery,
  countReviewsByReviewerOnDateQuery,
  getCreditLeaderboardQuery,
  getLatestReviewForTargetQuery,
  getOrCreateCreditQuery,
  hasReviewedTargetRecentlyQuery,
  insertReviewQuery,
  listCreditLogsQuery,
  setCreditScoreQuery,
  sumTargetDeltaOnDateQuery,
} from './creditLoan/creditAccountAndReviewQueries.js';
import {
  CREDIT_LOAN_SCHEMA_SQL,
  initCreditLoanSchema,
  type CreditAccount,
  type CreditLog,
  type CreditReview,
  type CreditReviewKind,
  type DeadbeatEntry,
  type GamblingLeaderboardSort,
  type GamblingStats,
  type HustleStats,
  type Loan,
  type LoanStatus,
  type LoanType,
  type PaginatedResult,
} from './creditLoan/creditLoanTypesAndSchema.js';
import {
  createLoanQuery,
  getDeadbeatLeaderboardQuery,
  getGamblingLeaderboardQuery,
  getHustleLeaderboardQuery,
  getLoanByIdQuery,
  getOrCreateGamblingStatsQuery,
  getOrCreateHustleStatsQuery,
  listDueOrOverdueLoansQuery,
  listOpenLoansQuery,
  listUserLoansQuery,
  recordGamblingDeltaQuery,
  resetAllHustleCooldownsQuery,
  saveHustleStatsQuery,
  updateLoanQuery,
} from './creditLoan/loanHustleGambleQueries.js';

export { CREDIT_LOAN_SCHEMA_SQL, initCreditLoanSchema };
export type {
  CreditAccount,
  CreditLog,
  CreditReview,
  CreditReviewKind,
  DeadbeatEntry,
  GamblingLeaderboardSort,
  GamblingStats,
  HustleStats,
  Loan,
  LoanStatus,
  LoanType,
  PaginatedResult,
};

export class CreditLoanRepo {
  constructor(private readonly db: Database.Database) {}

  getOrCreateCredit(guildId: string, userId: string, nowMs = Date.now()): CreditAccount {
    return getOrCreateCreditQuery(this.db, guildId, userId, nowMs);
  }

  setCreditScore(
    guildId: string,
    userId: string,
    score: number,
    nowMs = Date.now(),
  ): CreditAccount {
    return setCreditScoreQuery(this.db, guildId, userId, score, nowMs);
  }

  addCreditLog(input: {
    guildId: string;
    userId: string;
    delta: number;
    scoreAfter: number;
    reason: string;
    createdAt: number;
  }): CreditLog {
    return addCreditLogQuery(this.db, input);
  }

  listCreditLogs(
    guildId: string,
    userId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<CreditLog> {
    return listCreditLogsQuery(this.db, guildId, userId, limit, offset);
  }

  countReviewsByReviewerOnDate(guildId: string, reviewerId: string, dateKey: string): number {
    return countReviewsByReviewerOnDateQuery(this.db, guildId, reviewerId, dateKey);
  }

  hasReviewedTargetRecently(
    guildId: string,
    reviewerId: string,
    targetId: string,
    sinceMs: number,
  ): boolean {
    return hasReviewedTargetRecentlyQuery(this.db, guildId, reviewerId, targetId, sinceMs);
  }

  getLatestReviewForTarget(
    guildId: string,
    reviewerId: string,
    targetId: string,
  ): CreditReview | null {
    return getLatestReviewForTargetQuery(this.db, guildId, reviewerId, targetId);
  }

  sumTargetDeltaOnDate(guildId: string, targetId: string, dateKey: string): number {
    return sumTargetDeltaOnDateQuery(this.db, guildId, targetId, dateKey);
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
    return insertReviewQuery(this.db, input);
  }

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
    return createLoanQuery(this.db, input);
  }

  getLoanById(loanId: number): Loan | null {
    return getLoanByIdQuery(this.db, loanId);
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
    return listUserLoansQuery(this.db, guildId, userId, options);
  }

  listOpenLoans(guildId?: string): Loan[] {
    return listOpenLoansQuery(this.db, guildId);
  }

  listDueOrOverdueLoans(nowMs: number, guildId?: string): Loan[] {
    return listDueOrOverdueLoansQuery(this.db, nowMs, guildId);
  }

  updateLoan(loan: Loan): void {
    updateLoanQuery(this.db, loan);
  }

  getOrCreateHustleStats(guildId: string, userId: string): HustleStats {
    return getOrCreateHustleStatsQuery(this.db, guildId, userId);
  }

  saveHustleStats(stats: HustleStats): void {
    saveHustleStatsQuery(this.db, stats);
  }

  resetAllHustleCooldowns(guildId: string): number {
    return resetAllHustleCooldownsQuery(this.db, guildId);
  }

  getOrCreateGamblingStats(guildId: string, userId: string): GamblingStats {
    return getOrCreateGamblingStatsQuery(this.db, guildId, userId);
  }

  recordGamblingDelta(
    guildId: string,
    userId: string,
    wager: number,
    netChange: number,
    nowMs = Date.now(),
  ): GamblingStats {
    return recordGamblingDeltaQuery(this.db, guildId, userId, wager, netChange, nowMs);
  }

  getCreditLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<CreditAccount> {
    return getCreditLeaderboardQuery(this.db, guildId, limit, offset);
  }

  getDeadbeatLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<DeadbeatEntry> {
    return getDeadbeatLeaderboardQuery(this.db, guildId, limit, offset);
  }

  getHustleLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<HustleStats> {
    return getHustleLeaderboardQuery(this.db, guildId, limit, offset);
  }

  getGamblingLeaderboard(
    guildId: string,
    sort: GamblingLeaderboardSort,
    limit = 10,
    offset = 0,
  ): PaginatedResult<GamblingStats> {
    return getGamblingLeaderboardQuery(this.db, guildId, sort, limit, offset);
  }
}
