import type Database from 'better-sqlite3';
import type { ChaosRepo } from '../db/repositories/chaosRepo.js';
import type {
  CreditAccount,
  CreditLoanRepo,
  CreditLog,
  DeadbeatEntry,
  GamblingLeaderboardSort,
  GamblingStats,
  HustleStats,
  Loan,
  PaginatedResult,
} from '../db/repositories/creditLoanRepo.js';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import {
  adjustCreditOp,
  getCreditProfileOp,
  submitReviewOp,
} from './creditLoan/creditScoreAndReviewOps.js';
import {
  CREDIT_SCORE_DEFAULT,
  CREDIT_SCORE_MAX,
  CREDIT_SCORE_MIN,
  CREDIT_TIERS,
  DEFAULT_CREDIT_LOAN_CONFIG,
  getCreditTier,
  type AdjustCreditResult,
  type CreditLoanConfig,
  type CreditLoanOpsContext,
  type CreditProfileSummary,
  type CreditTier,
  type CreditTierKey,
  type DeadbeatStatus,
  type GarnishResult,
  type HustleEventKey,
  type OverdueNotice,
  type RepayLoanResult,
  type ReviewResult,
  type SellButtResult,
  type TakeBankLoanResult,
  type TakeUsuryLoanResult,
} from './creditLoan/creditTiersAndFlavor.js';
import { recordGamblingResultOp, sellButtOp } from './creditLoan/hustleAndGamblingOps.js';
import {
  repayLoanOp,
  takeBankLoanOp,
  takeUsuryLoanOp,
} from './creditLoan/loanBorrowRepayOps.js';
import {
  garnishIncomingCoinsOp,
  isDeadbeatBlockedOp,
  processOverdueLoansOp,
} from './creditLoan/overdueAndGarnishOps.js';

export {
  CREDIT_SCORE_DEFAULT,
  CREDIT_SCORE_MAX,
  CREDIT_SCORE_MIN,
  CREDIT_TIERS,
  DEFAULT_CREDIT_LOAN_CONFIG,
  getCreditTier,
};
export type {
  AdjustCreditResult,
  CreditLoanConfig,
  CreditProfileSummary,
  CreditTier,
  CreditTierKey,
  DeadbeatStatus,
  GarnishResult,
  HustleEventKey,
  OverdueNotice,
  RepayLoanResult,
  ReviewResult,
  SellButtResult,
  TakeBankLoanResult,
  TakeUsuryLoanResult,
};

export class CreditLoanService {
  private readonly config: CreditLoanConfig;
  private readonly configOverrides?: Partial<CreditLoanConfig>;
  private readonly opsCtx: CreditLoanOpsContext;

  constructor(
    private readonly db: Database.Database,
    private readonly configRepo: GuildConfigRepo,
    private readonly profileRepo: ProfileRepo,
    private readonly repo: CreditLoanRepo,
    private readonly timezone = 'Asia/Shanghai',
    private readonly chaosRepo?: ChaosRepo,
    configOverrides?: Partial<CreditLoanConfig>,
  ) {
    this.configOverrides = configOverrides;
    this.config = {
      ...DEFAULT_CREDIT_LOAN_CONFIG,
      ...configOverrides,
    };
    this.opsCtx = {
      db: this.db,
      configRepo: this.configRepo,
      profileRepo: this.profileRepo,
      repo: this.repo,
      timezone: this.timezone,
      chaosRepo: this.chaosRepo,
      getConfig: (guildId?: string): CreditLoanConfig => this.getConfig(guildId),
    };
  }

  getConfig(guildId?: string): CreditLoanConfig {
    if (guildId) {
      const guildCfg = this.configRepo.getOrCreate(guildId).creditLoan;
      return {
        ...DEFAULT_CREDIT_LOAN_CONFIG,
        ...guildCfg,
        ...this.configOverrides,
      };
    }
    return { ...this.config };
  }

  getCreditProfile(guildId: string, userId: string, nowMs = Date.now()): CreditProfileSummary {
    return getCreditProfileOp(this.opsCtx, guildId, userId, nowMs);
  }

  listCreditLogs(
    guildId: string,
    userId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<CreditLog> {
    return this.repo.listCreditLogs(guildId, userId, limit, offset);
  }

  listUserLoans(guildId: string, userId: string, includeRepaid = false): Loan[] {
    if (includeRepaid) {
      return this.repo.listUserLoans(guildId, userId);
    }
    return this.repo.listUserLoans(guildId, userId, { statuses: ['active', 'overdue'] });
  }

  getHustleStats(guildId: string, userId: string): HustleStats {
    return this.repo.getOrCreateHustleStats(guildId, userId);
  }

  resetAllHustleCooldowns(guildId: string): number {
    return this.repo.resetAllHustleCooldowns(guildId);
  }

  getGamblingStats(guildId: string, userId: string): GamblingStats {
    return this.repo.getOrCreateGamblingStats(guildId, userId);
  }

  adjustCredit(
    guildId: string,
    userId: string,
    delta: number,
    reason: string,
    nowMs = Date.now(),
  ): AdjustCreditResult {
    return adjustCreditOp(this.opsCtx, guildId, userId, delta, reason, nowMs);
  }

  endorseUser(
    guildId: string,
    reviewerId: string,
    targetId: string,
    nowMs = Date.now(),
  ): ReviewResult {
    return submitReviewOp(this.opsCtx, guildId, reviewerId, targetId, 'endorse', nowMs);
  }

  reportUser(
    guildId: string,
    reviewerId: string,
    targetId: string,
    nowMs = Date.now(),
  ): ReviewResult {
    return submitReviewOp(this.opsCtx, guildId, reviewerId, targetId, 'report', nowMs);
  }

  takeBankLoan(
    guildId: string,
    userId: string,
    amount: number,
    termDays: number,
    nowMs = Date.now(),
  ): TakeBankLoanResult {
    return takeBankLoanOp(this.opsCtx, guildId, userId, amount, termDays, nowMs);
  }

  takeUsuryLoan(
    guildId: string,
    userId: string,
    amount: number,
    nowMs = Date.now(),
  ): TakeUsuryLoanResult {
    return takeUsuryLoanOp(this.opsCtx, guildId, userId, amount, nowMs);
  }

  repayLoan(
    guildId: string,
    userId: string,
    loanId: number,
    amount: number,
    nowMs = Date.now(),
    options?: { useBank?: boolean },
  ): RepayLoanResult {
    return repayLoanOp(this.opsCtx, guildId, userId, loanId, amount, nowMs, options);
  }

  isDeadbeatBlocked(guildId: string, userId: string, nowMs = Date.now()): DeadbeatStatus {
    return isDeadbeatBlockedOp(this.opsCtx, guildId, userId, nowMs);
  }

  garnishIncomingCoins(
    guildId: string,
    userId: string,
    grossAmount: number,
    source: string,
    nowMs = Date.now(),
  ): GarnishResult {
    return garnishIncomingCoinsOp(this.opsCtx, guildId, userId, grossAmount, source, nowMs);
  }

  processOverdueLoans(nowMs = Date.now()): OverdueNotice[] {
    return processOverdueLoansOp(this.opsCtx, nowMs);
  }

  sellButt(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): SellButtResult {
    return sellButtOp(this.opsCtx, guildId, userId, nowMs, rng);
  }

  recordGamblingResult(
    guildId: string,
    userId: string,
    wager: number,
    netChange: number,
    nowMs = Date.now(),
  ): GamblingStats {
    return recordGamblingResultOp(this.opsCtx, guildId, userId, wager, netChange, nowMs);
  }

  getCreditLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<CreditAccount> {
    return this.repo.getCreditLeaderboard(guildId, limit, offset);
  }

  getDeadbeatLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<DeadbeatEntry> {
    return this.repo.getDeadbeatLeaderboard(guildId, limit, offset);
  }

  getHustleLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): PaginatedResult<HustleStats> {
    return this.repo.getHustleLeaderboard(guildId, limit, offset);
  }

  getGamblingLeaderboard(
    guildId: string,
    sort: GamblingLeaderboardSort = 'profit',
    limit = 10,
    offset = 0,
  ): PaginatedResult<GamblingStats> {
    return this.repo.getGamblingLeaderboard(guildId, sort, limit, offset);
  }
}
