import type Database from 'better-sqlite3';
import type { ChaosRepo } from '../db/repositories/chaosRepo.js';
import type {
  CreditAccount,
  CreditLoanRepo,
  CreditLog,
  CreditReviewKind,
  DeadbeatEntry,
  GamblingLeaderboardSort,
  GamblingStats,
  HustleStats,
  Loan,
  LoanType,
  PaginatedResult,
} from '../db/repositories/creditLoanRepo.js';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import { getDateKey } from './economyService.js';

export const CREDIT_SCORE_MIN = 0;
export const CREDIT_SCORE_MAX = 1000;
export const CREDIT_SCORE_DEFAULT = 600;

const DAY_MS = 86_400_000;
const BANK_MIN_SCORE = 300;
const ENDORSE_BASE_DELTA = 10;
const REPORT_NORMAL_DELTA = -8;
const REPORT_OVERDUE_DELTA = -15;
const BANK_OVERDUE_PENALTY_RATE = 0.05;
const BANK_OVERDUE_CAP_MULT = 2.5;
const BANK_OVERDUE_CREDIT_DROP = -15;
const USURY_OVERDUE_PENALTY_RATE = 0.2;
const USURY_OVERDUE_CAP_MULT = 3.0;
const USURY_OVERDUE_CREDIT_DROP = -30;
const USURY_BOUNTY_RATE = 0.2;
const USURY_BOUNTY_MIN = 5_000;
const USURY_BOUNTY_MAX = 100_000;

export interface CreditLoanConfig {
  bankLoanMaxCap: number;
  bankLoanMin: number;
  usuryLoanMax: number;
  usuryLoanMin: number;
  usuryDailyRate: number;
  usuryTermDays: number;
  garnishRate: number;
  hustleCooldownSec: number;
  hustleMinMultiplier: number;
  hustleMaxMultiplier: number;
  hustleCreditPenalty: number;
  dailyReviewLimit: number;
  reviewTargetCooldownSec: number;
  reviewTargetDailyCap: number;
}

export const DEFAULT_CREDIT_LOAN_CONFIG: CreditLoanConfig = {
  bankLoanMaxCap: 500_000,
  bankLoanMin: 500,
  usuryLoanMax: 100_000,
  usuryLoanMin: 1_000,
  usuryDailyRate: 0.12,
  usuryTermDays: 2,
  garnishRate: 0.5,
  hustleCooldownSec: 86_400,
  hustleMinMultiplier: 4,
  hustleMaxMultiplier: 5,
  hustleCreditPenalty: 10,
  dailyReviewLimit: 3,
  reviewTargetCooldownSec: 86_400,
  reviewTargetDailyCap: 30,
};

export type CreditTierKey = 'deadbeat' | 'graylist' | 'normal' | 'platinum' | 'noble';

export interface CreditTier {
  key: CreditTierKey;
  label: string;
  minScore: number;
  maxScore: number;
  shopMult: number;
  workMult: number;
  bankInterestCapMult: number;
  bankLoanMax: number;
  bankDailyRate: number;
  bankMaxDays: number;
}

export const CREDIT_TIERS: readonly CreditTier[] = [
  {
    key: 'deadbeat',
    label: '💀 极危老赖',
    minScore: 0,
    maxScore: 299,
    shopMult: 1.25,
    workMult: 0.8,
    bankInterestCapMult: 0.5,
    bankLoanMax: 0,
    bankDailyRate: 0,
    bankMaxDays: 0,
  },
  {
    key: 'graylist',
    label: '⚠️ 失信灰名单',
    minScore: 300,
    maxScore: 499,
    shopMult: 1.1,
    workMult: 0.9,
    bankInterestCapMult: 0.8,
    bankLoanMax: 10_000,
    bankDailyRate: 0.03,
    bankMaxDays: 3,
  },
  {
    key: 'normal',
    label: '🙂 普通良民',
    minScore: 500,
    maxScore: 699,
    shopMult: 1.0,
    workMult: 1.0,
    bankInterestCapMult: 1.0,
    bankLoanMax: 50_000,
    bankDailyRate: 0.015,
    bankMaxDays: 5,
  },
  {
    key: 'platinum',
    label: '💎 优质白金',
    minScore: 700,
    maxScore: 849,
    shopMult: 0.9,
    workMult: 1.2,
    bankInterestCapMult: 1.5,
    bankLoanMax: 200_000,
    bankDailyRate: 0.01,
    bankMaxDays: 7,
  },
  {
    key: 'noble',
    label: '👑 金卡贵族',
    minScore: 850,
    maxScore: 1000,
    shopMult: 0.8,
    workMult: 1.4,
    bankInterestCapMult: 2.0,
    bankLoanMax: 500_000,
    bankDailyRate: 0.005,
    bankMaxDays: 10,
  },
];

export function getCreditTier(score: number): CreditTier {
  const clamped = Math.max(CREDIT_SCORE_MIN, Math.min(CREDIT_SCORE_MAX, Math.trunc(score)));
  for (const tier of CREDIT_TIERS) {
    if (clamped >= tier.minScore && clamped <= tier.maxScore) {
      return tier;
    }
  }
  return CREDIT_TIERS[2]!;
}

export interface CreditProfileSummary {
  account: CreditAccount;
  tier: CreditTier;
  openLoans: Loan[];
  overdueLoans: Loan[];
  totalDebt: number;
  totalOverdueDebt: number;
}

export interface AdjustCreditResult {
  account: CreditAccount;
  tier: CreditTier;
  requestedDelta: number;
  actualDelta: number;
  log: CreditLog;
}

export type ReviewResult =
  | {
      ok: true;
      kind: CreditReviewKind;
      delta: number;
      targetScore: number;
      targetTier: CreditTier;
      remainingReviewsToday: number;
      targetIsOverdue: boolean;
    }
  | {
      ok: false;
      reason: 'self_target' | 'daily_limit_reached' | 'target_cooldown' | 'target_daily_cap';
      dailyLimit?: number;
      retryAfterSec?: number;
    };

export type TakeBankLoanResult =
  | {
      ok: true;
      loan: Loan;
      balance: number;
      tier: CreditTier;
    }
  | {
      ok: false;
      reason:
        | 'credit_too_low'
        | 'has_overdue_loan'
        | 'active_bank_loan_exists'
        | 'invalid_amount'
        | 'invalid_term';
      score?: number;
      minScore?: number;
      minAmount?: number;
      maxAmount?: number;
      minDays?: number;
      maxDays?: number;
    };

export type TakeUsuryLoanResult =
  | {
      ok: true;
      loan: Loan;
      balance: number;
    }
  | {
      ok: false;
      reason: 'active_usury_loan_exists' | 'invalid_amount';
      minAmount?: number;
      maxAmount?: number;
    };

export type RepayLoanResult =
  | {
      ok: true;
      loan: Loan;
      paidAmount: number;
      interestPaid: number;
      principalPaid: number;
      paidFromPocket: number;
      paidFromBank: number;
      remainingDebt: number;
      fullyRepaid: boolean;
      creditDelta: number;
      creditScore: number;
      deadbeatCleared: boolean;
      coins: number;
      bankCoins: number;
    }
  | {
      ok: false;
      reason: 'invalid_amount' | 'loan_not_found' | 'already_repaid' | 'insufficient_funds';
      required?: number;
      available?: number;
    };

export interface DeadbeatStatus {
  blocked: boolean;
  overdueLoans: Loan[];
  totalOverdueDebt: number;
}

export interface GarnishResult {
  grossAmount: number;
  garnished: number;
  netAmount: number;
  clearedLoanIds: number[];
}

export interface OverdueNotice {
  guildId: string;
  userId: string;
  loanId: number;
  loanType: LoanType;
  dateKey: string;
  principal: number;
  penaltyAdded: number;
  seizedFromPocket: number;
  seizedFromBank: number;
  totalSeized: number;
  remainingDebt: number;
  clearedBySeize: boolean;
  creditDelta: number;
  creditScore: number;
  bountyPostedNow: boolean;
  bountyAmount: number;
  message: string;
}

export type HustleEventKey = 'vip' | 'acquaintance' | 'normal' | 'bust';

export type SellButtResult =
  | {
      ok: true;
      eventKey: HustleEventKey;
      eventTitle: string;
      story: string;
      multiplier: number;
      baseReward: number;
      grossReward: number;
      garnished: number;
      netReward: number;
      clearedLoanIds: number[];
      creditDelta: number;
      creditScore: number;
      creditTier: CreditTier;
      balance: number;
      stats: HustleStats;
      publicAnnouncement: string;
    }
  | {
      ok: false;
      reason: 'cooldown';
      retryAfterSec: number;
    };

interface HustleEventSpec {
  key: HustleEventKey;
  title: string;
  minMult: number;
  maxMult: number;
  stories: readonly string[];
}

const HUSTLE_EVENTS: Readonly<Record<HustleEventKey, HustleEventSpec>> = {
  vip: {
    key: 'vip',
    title: '💎 VIP金主包场大单',
    minMult: 1.8,
    maxMult: 2.2,
    stories: [
      '在霓虹KTV包厢连唱八首《孤勇者》把榜一大哥感动到当场刷爆打赏',
      '靠一套丝滑的赛博霓虹甩手舞拿下了神秘VIP大佬的整晚情绪价值包场',
      '在复古舞厅客串气氛组把金主哄得心花怒放，临走直接塞来一大袋星币',
    ],
  },
  acquaintance: {
    key: 'acquaintance',
    title: '👀 撞见熟人喜提封口费',
    minMult: 1.3,
    maxMult: 1.5,
    stories: [
      '刚换上演出服就撞见群里平时最装高冷的大佬来点歌，对方秒转封口费求保密',
      '在巷口摆摊卖艺时迎面碰上熟人偷偷买皮肤，对视三秒对方主动打赏封口费',
      '推销高端果盘时认出VIP卡座坐着本群潜水王，双方默契成交一笔保密小费',
    ],
  },
  normal: {
    key: 'normal',
    title: '🕺 常规下海营业',
    minMult: 1.0,
    maxMult: 1.0,
    stories: [
      '踩着十厘米增高垫在赛博夜市连跳三小时科目三，汗流浃背但腰包鼓了',
      '在地下酒吧兼职气氛MC，喊麦喊到嗓子冒烟，总算结清了今晚出场费',
      '顶着抽象猫耳发箍在直播间疯狂整活摇花手，靠打赏凑够了明天的饭钱',
    ],
  },
  bust: {
    key: 'bust',
    title: '🚨 踩坑扫黄 / 老赖逃单',
    minMult: 0.5,
    maxMult: 0.5,
    stories: [
      '刚开场就遇上治安巡逻查消防证，抱着收款码一路狂奔，只捡回一半出场费',
      '辛辛苦苦陪聊两小时，结果对面是个比你还穷的群友老赖，借口上厕所跳窗跑单',
      '在广场整活时音响突然炸麦，围观群众一哄而散，只凑到半份辛苦费',
    ],
  },
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999, value));
}

function pickFrom<T>(items: readonly T[], r: number): T {
  const idx = Math.min(items.length - 1, Math.floor(clampUnit(r) * items.length));
  return items[idx]!;
}

function isLoanOverdueAt(loan: Loan, nowMs: number): boolean {
  return loan.status === 'overdue' || (loan.status === 'active' && nowMs > loan.dueAt);
}

function getLoanDebt(loan: Loan): number {
  return loan.remainingPrincipal + loan.accruedInterest;
}

export class CreditLoanService {
  private readonly config: CreditLoanConfig;

  constructor(
    private readonly db: Database.Database,
    private readonly configRepo: GuildConfigRepo,
    private readonly profileRepo: ProfileRepo,
    private readonly repo: CreditLoanRepo,
    private readonly timezone = 'Asia/Shanghai',
    private readonly chaosRepo?: ChaosRepo,
    configOverrides?: Partial<CreditLoanConfig>,
  ) {
    this.config = {
      ...DEFAULT_CREDIT_LOAN_CONFIG,
      ...configOverrides,
    };
  }

  getConfig(): CreditLoanConfig {
    return { ...this.config };
  }

  getCreditProfile(guildId: string, userId: string, nowMs = Date.now()): CreditProfileSummary {
    const account = this.repo.getOrCreateCredit(guildId, userId, nowMs);
    const tier = getCreditTier(account.score);
    const openLoans = this.repo.listUserLoans(guildId, userId, {
      statuses: ['active', 'overdue'],
    });
    const overdueLoans = openLoans.filter((loan) => isLoanOverdueAt(loan, nowMs));
    const totalDebt = openLoans.reduce((sum, loan) => sum + getLoanDebt(loan), 0);
    const totalOverdueDebt = overdueLoans.reduce((sum, loan) => sum + getLoanDebt(loan), 0);

    return {
      account,
      tier,
      openLoans,
      overdueLoans,
      totalDebt,
      totalOverdueDebt,
    };
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
    const requestedDelta = Math.trunc(delta);
    return this.db.transaction((): AdjustCreditResult => {
      const current = this.repo.getOrCreateCredit(guildId, userId, nowMs);
      const nextScore = clampNumber(
        current.score + requestedDelta,
        CREDIT_SCORE_MIN,
        CREDIT_SCORE_MAX,
      );
      const actualDelta = nextScore - current.score;
      const account = this.repo.setCreditScore(guildId, userId, nextScore, nowMs);
      const log = this.repo.addCreditLog({
        guildId,
        userId,
        delta: actualDelta,
        scoreAfter: nextScore,
        reason,
        createdAt: nowMs,
      });

      return {
        account,
        tier: getCreditTier(nextScore),
        requestedDelta,
        actualDelta,
        log,
      };
    })();
  }

  endorseUser(
    guildId: string,
    reviewerId: string,
    targetId: string,
    nowMs = Date.now(),
  ): ReviewResult {
    return this.submitReview(guildId, reviewerId, targetId, 'endorse', nowMs);
  }

  reportUser(
    guildId: string,
    reviewerId: string,
    targetId: string,
    nowMs = Date.now(),
  ): ReviewResult {
    return this.submitReview(guildId, reviewerId, targetId, 'report', nowMs);
  }

  private submitReview(
    guildId: string,
    reviewerId: string,
    targetId: string,
    kind: CreditReviewKind,
    nowMs: number,
  ): ReviewResult {
    if (reviewerId === targetId) {
      return { ok: false, reason: 'self_target' };
    }

    const dateKey = getDateKey(nowMs, this.timezone);
    const cooldownMs = this.config.reviewTargetCooldownSec * 1000;
    const cap = this.config.reviewTargetDailyCap;

    return this.db.transaction((): ReviewResult => {
      const usedToday = this.repo.countReviewsByReviewerOnDate(guildId, reviewerId, dateKey);
      if (usedToday >= this.config.dailyReviewLimit) {
        return {
          ok: false,
          reason: 'daily_limit_reached',
          dailyLimit: this.config.dailyReviewLimit,
        };
      }

      if (this.repo.hasReviewedTargetRecently(guildId, reviewerId, targetId, nowMs - cooldownMs)) {
        const latest = this.repo.getLatestReviewForTarget(guildId, reviewerId, targetId);
        const remainingMs = latest ? Math.max(1000, latest.createdAt + cooldownMs - nowMs) : cooldownMs;
        return {
          ok: false,
          reason: 'target_cooldown',
          retryAfterSec: Math.ceil(remainingMs / 1000),
        };
      }

      const targetOverdue = this.isDeadbeatBlocked(guildId, targetId, nowMs).blocked;
      const baseDelta =
        kind === 'endorse'
          ? ENDORSE_BASE_DELTA
          : targetOverdue
            ? REPORT_OVERDUE_DELTA
            : REPORT_NORMAL_DELTA;

      const currentTargetSum = this.repo.sumTargetDeltaOnDate(guildId, targetId, dateKey);
      let effectiveDelta: number;
      if (baseDelta > 0) {
        const remainingPositive = cap - currentTargetSum;
        if (remainingPositive <= 0) {
          return { ok: false, reason: 'target_daily_cap' };
        }
        effectiveDelta = Math.min(baseDelta, remainingPositive);
      } else {
        const remainingNegative = cap + currentTargetSum;
        if (remainingNegative <= 0) {
          return { ok: false, reason: 'target_daily_cap' };
        }
        effectiveDelta = -Math.min(Math.abs(baseDelta), remainingNegative);
      }

      this.repo.insertReview({
        guildId,
        reviewerId,
        targetId,
        kind,
        delta: effectiveDelta,
        dateKey,
        createdAt: nowMs,
      });

      const reason =
        kind === 'endorse'
          ? `群友信用背书 (${reviewerId})`
          : targetOverdue
            ? `逾期老赖加重举报 (${reviewerId})`
            : `群友失信举报 (${reviewerId})`;

      const adjusted = this.adjustCredit(guildId, targetId, effectiveDelta, reason, nowMs);

      return {
        ok: true,
        kind,
        delta: effectiveDelta,
        targetScore: adjusted.account.score,
        targetTier: adjusted.tier,
        remainingReviewsToday: Math.max(0, this.config.dailyReviewLimit - (usedToday + 1)),
        targetIsOverdue: targetOverdue,
      };
    })();
  }

  takeBankLoan(
    guildId: string,
    userId: string,
    amount: number,
    termDays: number,
    nowMs = Date.now(),
  ): TakeBankLoanResult {
    const cleanAmount = Math.floor(amount);
    const cleanTermDays = Math.floor(termDays);

    return this.db.transaction((): TakeBankLoanResult => {
      const account = this.repo.getOrCreateCredit(guildId, userId, nowMs);
      const tier = getCreditTier(account.score);

      if (account.score < BANK_MIN_SCORE || tier.bankLoanMax <= 0 || tier.bankMaxDays <= 0) {
        return {
          ok: false,
          reason: 'credit_too_low',
          score: account.score,
          minScore: BANK_MIN_SCORE,
        };
      }

      if (this.isDeadbeatBlocked(guildId, userId, nowMs).blocked) {
        return { ok: false, reason: 'has_overdue_loan' };
      }

      const existingBankLoans = this.repo.listUserLoans(guildId, userId, {
        statuses: ['active', 'overdue'],
        loanType: 'bank',
      });
      if (existingBankLoans.length > 0) {
        return { ok: false, reason: 'active_bank_loan_exists' };
      }

      const maxAmount = Math.min(tier.bankLoanMax, this.config.bankLoanMaxCap);
      if (
        !Number.isFinite(cleanAmount) ||
        cleanAmount < this.config.bankLoanMin ||
        cleanAmount > maxAmount
      ) {
        return {
          ok: false,
          reason: 'invalid_amount',
          minAmount: this.config.bankLoanMin,
          maxAmount,
        };
      }

      if (
        !Number.isFinite(cleanTermDays) ||
        cleanTermDays < 1 ||
        cleanTermDays > tier.bankMaxDays
      ) {
        return {
          ok: false,
          reason: 'invalid_term',
          minDays: 1,
          maxDays: tier.bankMaxDays,
        };
      }

      const dateKey = getDateKey(nowMs, this.timezone);
      const loan = this.repo.createLoan({
        guildId,
        userId,
        loanType: 'bank',
        principal: cleanAmount,
        dailyRate: tier.bankDailyRate,
        termDays: cleanTermDays,
        createdAt: nowMs,
        dueAt: nowMs + cleanTermDays * DAY_MS,
        lastAccrualDate: dateKey,
      });

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      const nextBalance = profile.coins + cleanAmount;
      this.profileRepo.save({ ...profile, coins: nextBalance });

      return {
        ok: true,
        loan,
        balance: nextBalance,
        tier,
      };
    })();
  }

  takeUsuryLoan(
    guildId: string,
    userId: string,
    amount: number,
    nowMs = Date.now(),
  ): TakeUsuryLoanResult {
    const cleanAmount = Math.floor(amount);

    return this.db.transaction((): TakeUsuryLoanResult => {
      const existingUsury = this.repo.listUserLoans(guildId, userId, {
        statuses: ['active', 'overdue'],
        loanType: 'usury',
      });
      if (existingUsury.length > 0) {
        return { ok: false, reason: 'active_usury_loan_exists' };
      }

      if (
        !Number.isFinite(cleanAmount) ||
        cleanAmount < this.config.usuryLoanMin ||
        cleanAmount > this.config.usuryLoanMax
      ) {
        return {
          ok: false,
          reason: 'invalid_amount',
          minAmount: this.config.usuryLoanMin,
          maxAmount: this.config.usuryLoanMax,
        };
      }

      this.repo.getOrCreateCredit(guildId, userId, nowMs);
      const dateKey = getDateKey(nowMs, this.timezone);
      const loan = this.repo.createLoan({
        guildId,
        userId,
        loanType: 'usury',
        principal: cleanAmount,
        dailyRate: this.config.usuryDailyRate,
        termDays: this.config.usuryTermDays,
        createdAt: nowMs,
        dueAt: nowMs + this.config.usuryTermDays * DAY_MS,
        lastAccrualDate: dateKey,
      });

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      const nextBalance = profile.coins + cleanAmount;
      this.profileRepo.save({ ...profile, coins: nextBalance });

      return {
        ok: true,
        loan,
        balance: nextBalance,
      };
    })();
  }

  repayLoan(
    guildId: string,
    userId: string,
    loanId: number,
    amount: number,
    nowMs = Date.now(),
    options?: { useBank?: boolean },
  ): RepayLoanResult {
    const cleanAmount = Math.floor(amount);
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      return { ok: false, reason: 'invalid_amount' };
    }

    const useBank = Boolean(options?.useBank);

    return this.db.transaction((): RepayLoanResult => {
      const loan = this.repo.getLoanById(loanId);
      if (!loan || loan.guildId !== guildId || loan.userId !== userId) {
        return { ok: false, reason: 'loan_not_found' };
      }

      if (loan.status === 'repaid') {
        return { ok: false, reason: 'already_repaid' };
      }

      const totalOwed = getLoanDebt(loan);
      const paidAmount = Math.min(cleanAmount, totalOwed);

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      const available = useBank ? profile.coins + profile.bankCoins : profile.coins;
      if (available < paidAmount) {
        return {
          ok: false,
          reason: 'insufficient_funds',
          required: paidAmount,
          available,
        };
      }

      const paidFromPocket = Math.min(profile.coins, paidAmount);
      const paidFromBank = paidAmount - paidFromPocket;
      const nextCoins = profile.coins - paidFromPocket;
      const nextBankCoins = profile.bankCoins - paidFromBank;
      this.profileRepo.save({
        ...profile,
        coins: nextCoins,
        bankCoins: nextBankCoins,
      });

      const wasOverdue = isLoanOverdueAt(loan, nowMs);
      const interestPaid = Math.min(loan.accruedInterest, paidAmount);
      const principalPaid = paidAmount - interestPaid;
      const nextAccruedInterest = loan.accruedInterest - interestPaid;
      const nextRemainingPrincipal = loan.remainingPrincipal - principalPaid;
      const nextTotalRepaid = loan.totalRepaid + paidAmount;
      const fullyRepaid = nextAccruedInterest === 0 && nextRemainingPrincipal === 0;

      const updatedLoan: Loan = {
        ...loan,
        remainingPrincipal: nextRemainingPrincipal,
        accruedInterest: nextAccruedInterest,
        totalRepaid: nextTotalRepaid,
        status: fullyRepaid ? 'repaid' : loan.status,
        repaidAt: fullyRepaid ? nowMs : loan.repaidAt,
      };
      this.repo.updateLoan(updatedLoan);

      let creditDelta = 0;
      let creditScore = this.repo.getOrCreateCredit(guildId, userId, nowMs).score;
      let deadbeatCleared = false;

      if (fullyRepaid) {
        if (!wasOverdue) {
          const reward = this.computeOnTimeRepayCreditBonus(loan, nowMs);
          const reason =
            loan.loanType === 'bank' ? '银行贷款按期结清奖励' : '黑市高利贷按期结清奖励';
          const adjusted = this.adjustCredit(guildId, userId, reward, reason, nowMs);
          creditDelta = adjusted.actualDelta;
          creditScore = adjusted.account.score;
        } else {
          deadbeatCleared = !this.isDeadbeatBlocked(guildId, userId, nowMs).blocked;
        }
      }

      return {
        ok: true,
        loan: updatedLoan,
        paidAmount,
        interestPaid,
        principalPaid,
        paidFromPocket,
        paidFromBank,
        remainingDebt: nextRemainingPrincipal + nextAccruedInterest,
        fullyRepaid,
        creditDelta,
        creditScore,
        deadbeatCleared,
        coins: nextCoins,
        bankCoins: nextBankCoins,
      };
    })();
  }

  private computeOnTimeRepayCreditBonus(loan: Loan, nowMs: number): number {
    if (loan.loanType === 'usury') {
      return 10;
    }
    const earlyBonus = nowMs <= loan.dueAt - DAY_MS ? 5 : 0;
    const sizeBonus = Math.min(15, Math.floor(loan.principal / 20_000) * 3);
    return clampNumber(15 + earlyBonus + sizeBonus, 15, 35);
  }

  isDeadbeatBlocked(guildId: string, userId: string, nowMs = Date.now()): DeadbeatStatus {
    const openLoans = this.repo.listUserLoans(guildId, userId, {
      statuses: ['active', 'overdue'],
    });
    const overdueLoans = openLoans.filter((loan) => isLoanOverdueAt(loan, nowMs));
    const totalOverdueDebt = overdueLoans.reduce((sum, loan) => sum + getLoanDebt(loan), 0);

    return {
      blocked: overdueLoans.length > 0,
      overdueLoans,
      totalOverdueDebt,
    };
  }

  garnishIncomingCoins(
    guildId: string,
    userId: string,
    grossAmount: number,
    _source: string,
    nowMs = Date.now(),
  ): GarnishResult {
    const cleanGross = Math.max(0, Math.floor(grossAmount));
    if (cleanGross <= 0) {
      return {
        grossAmount: cleanGross,
        garnished: 0,
        netAmount: 0,
        clearedLoanIds: [],
      };
    }

    return this.db.transaction((): GarnishResult => {
      const status = this.isDeadbeatBlocked(guildId, userId, nowMs);
      if (!status.blocked || status.totalOverdueDebt <= 0) {
        return {
          grossAmount: cleanGross,
          garnished: 0,
          netAmount: cleanGross,
          clearedLoanIds: [],
        };
      }

      const targetGarnish = Math.min(
        status.totalOverdueDebt,
        Math.floor(cleanGross * this.config.garnishRate),
      );
      if (targetGarnish <= 0) {
        return {
          grossAmount: cleanGross,
          garnished: 0,
          netAmount: cleanGross,
          clearedLoanIds: [],
        };
      }

      let remainingToApply = targetGarnish;
      const clearedLoanIds: number[] = [];

      for (const loan of status.overdueLoans) {
        if (remainingToApply <= 0) break;
        const loanDebt = getLoanDebt(loan);
        if (loanDebt <= 0) continue;

        const applied = Math.min(loanDebt, remainingToApply);
        const interestPaid = Math.min(loan.accruedInterest, applied);
        const principalPaid = applied - interestPaid;
        const nextAccruedInterest = loan.accruedInterest - interestPaid;
        const nextRemainingPrincipal = loan.remainingPrincipal - principalPaid;
        const cleared = nextAccruedInterest === 0 && nextRemainingPrincipal === 0;

        this.repo.updateLoan({
          ...loan,
          remainingPrincipal: nextRemainingPrincipal,
          accruedInterest: nextAccruedInterest,
          totalRepaid: loan.totalRepaid + applied,
          status: cleared ? 'repaid' : loan.status,
          repaidAt: cleared ? nowMs : loan.repaidAt,
        });

        if (cleared) {
          clearedLoanIds.push(loan.id);
        }
        remainingToApply -= applied;
      }

      const actualGarnished = targetGarnish - remainingToApply;
      return {
        grossAmount: cleanGross,
        garnished: actualGarnished,
        netAmount: cleanGross - actualGarnished,
        clearedLoanIds,
      };
    })();
  }

  processOverdueLoans(nowMs = Date.now()): OverdueNotice[] {
    const dateKey = getDateKey(nowMs, this.timezone);
    const openLoans = this.repo.listOpenLoans();
    const notices: OverdueNotice[] = [];

    for (const snapshot of openLoans) {
      const notice = this.db.transaction((): OverdueNotice | null => {
        const loan = this.repo.getLoanById(snapshot.id);
        if (!loan || loan.status === 'repaid') {
          return null;
        }

        const capMult =
          loan.loanType === 'bank' ? BANK_OVERDUE_CAP_MULT : USURY_OVERDUE_CAP_MULT;
        const maxTotalOwed = Math.floor(loan.principal * capMult);

        if (loan.status === 'active' && nowMs <= loan.dueAt) {
          if (loan.lastAccrualDate !== dateKey && loan.dailyRate > 0) {
            const currentOwed = getLoanDebt(loan);
            const headroom = Math.max(0, maxTotalOwed - currentOwed);
            const baseAmount = loan.remainingPrincipal > 0 ? loan.remainingPrincipal : currentOwed;
            const rawInterest = Math.max(1, Math.floor(baseAmount * loan.dailyRate));
            const interestAdded = Math.min(rawInterest, headroom);

            this.repo.updateLoan({
              ...loan,
              accruedInterest: loan.accruedInterest + interestAdded,
              lastAccrualDate: dateKey,
            });
          }
          return null;
        }

        // Loan is either already overdue or just crossed dueAt
        const workingLoan: Loan = {
          ...loan,
          status: 'overdue',
        };

        // Already processed overdue penalty & notice for this dateKey
        if (workingLoan.lastNoticeDate === dateKey) {
          if (loan.status !== 'overdue') {
            this.repo.updateLoan(workingLoan);
          }
          return null;
        }

        const penaltyRate =
          workingLoan.loanType === 'bank'
            ? BANK_OVERDUE_PENALTY_RATE
            : USURY_OVERDUE_PENALTY_RATE;
        const creditDrop =
          workingLoan.loanType === 'bank' ? BANK_OVERDUE_CREDIT_DROP : USURY_OVERDUE_CREDIT_DROP;

        const currentOwed = getLoanDebt(workingLoan);
        const headroom = Math.max(0, maxTotalOwed - currentOwed);
        const baseForPenalty =
          workingLoan.remainingPrincipal > 0 ? workingLoan.remainingPrincipal : currentOwed;
        const rawPenalty = Math.max(1, Math.floor(baseForPenalty * penaltyRate));
        const penaltyAdded = Math.min(rawPenalty, headroom);
        workingLoan.accruedInterest += penaltyAdded;

        const creditReason =
          workingLoan.loanType === 'bank'
            ? `银行贷款 #${workingLoan.id} 逾期违约`
            : `黑市高利贷 #${workingLoan.id} 逾期违约`;
        const adjusted = this.adjustCredit(
          workingLoan.guildId,
          workingLoan.userId,
          creditDrop,
          creditReason,
          nowMs,
        );

        // Auto-seize pocket coins first, then bankCoins
        const profile = this.profileRepo.getOrCreate(workingLoan.guildId, workingLoan.userId);
        const debtBeforeSeize = getLoanDebt(workingLoan);
        const seizedFromPocket = Math.min(profile.coins, debtBeforeSeize);
        const seizedFromBank = Math.min(profile.bankCoins, debtBeforeSeize - seizedFromPocket);
        const totalSeized = seizedFromPocket + seizedFromBank;

        if (totalSeized > 0) {
          this.profileRepo.save({
            ...profile,
            coins: profile.coins - seizedFromPocket,
            bankCoins: profile.bankCoins - seizedFromBank,
          });

          const interestPaid = Math.min(workingLoan.accruedInterest, totalSeized);
          const principalPaid = totalSeized - interestPaid;
          workingLoan.accruedInterest -= interestPaid;
          workingLoan.remainingPrincipal -= principalPaid;
          workingLoan.totalRepaid += totalSeized;
        }

        const remainingDebt = getLoanDebt(workingLoan);
        const clearedBySeize = remainingDebt === 0;
        if (clearedBySeize) {
          workingLoan.status = 'repaid';
          workingLoan.repaidAt = nowMs;
        }

        let bountyPostedNow = false;
        let bountyAmount = 0;
        if (
          workingLoan.loanType === 'usury' &&
          !workingLoan.bountyPosted &&
          workingLoan.status === 'overdue' &&
          this.chaosRepo
        ) {
          bountyAmount = clampNumber(
            Math.floor(workingLoan.principal * USURY_BOUNTY_RATE),
            USURY_BOUNTY_MIN,
            USURY_BOUNTY_MAX,
          );
          this.chaosRepo.createBounty({
            guildId: workingLoan.guildId,
            targetId: workingLoan.userId,
            placerId: 'SYSTEM_USURY',
            amount: bountyAmount,
            createdAt: nowMs,
          });
          workingLoan.bountyPosted = true;
          bountyPostedNow = true;
        }

        workingLoan.lastAccrualDate = dateKey;
        workingLoan.lastNoticeDate = dateKey;
        this.repo.updateLoan(workingLoan);

        const loanLabel = workingLoan.loanType === 'bank' ? '🏦 银行贷款' : '🩸 黑市高利贷';
        const parts: string[] = [
          `📢 【逾期催收公告】<@${workingLoan.userId}> 的${loanLabel} #${workingLoan.id} 已逾期！`,
          `新增罚息 +${penaltyAdded.toLocaleString()}，信用分 ${adjusted.actualDelta}（当前 ${adjusted.account.score}）`,
        ];
        if (totalSeized > 0) {
          parts.push(
            `强制划扣 ${totalSeized.toLocaleString()}（口袋 ${seizedFromPocket.toLocaleString()} / 银行 ${seizedFromBank.toLocaleString()}）`,
          );
        }
        if (clearedBySeize) {
          parts.push('本次强扣已将欠款全部结清');
        } else {
          parts.push(`剩余欠款 ${remainingDebt.toLocaleString()}`);
        }
        if (bountyPostedNow) {
          parts.push(
            `黑市高利贷逾期自动通缉已发布，悬赏金 ${bountyAmount.toLocaleString()}！`,
          );
        }

        return {
          guildId: workingLoan.guildId,
          userId: workingLoan.userId,
          loanId: workingLoan.id,
          loanType: workingLoan.loanType,
          dateKey,
          principal: workingLoan.principal,
          penaltyAdded,
          seizedFromPocket,
          seizedFromBank,
          totalSeized,
          remainingDebt,
          clearedBySeize,
          creditDelta: adjusted.actualDelta,
          creditScore: adjusted.account.score,
          bountyPostedNow,
          bountyAmount,
          message: parts.join('；'),
        };
      })();

      if (notice) {
        notices.push(notice);
      }
    }

    return notices;
  }

  sellButt(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): SellButtResult {
    const ecoCfg = this.configRepo.getOrCreate(guildId).economy;
    const cooldownMs = this.config.hustleCooldownSec * 1000;

    return this.db.transaction((): SellButtResult => {
      const stats = this.repo.getOrCreateHustleStats(guildId, userId);
      const elapsed = nowMs - stats.lastHustleAt;
      if (stats.lastHustleAt > 0 && elapsed < cooldownMs) {
        return {
          ok: false,
          reason: 'cooldown',
          retryAfterSec: Math.ceil((cooldownMs - elapsed) / 1000),
        };
      }

      const workMin = Math.max(1, Math.min(ecoCfg.workMin, ecoCfg.workMax));
      const workMax = Math.max(workMin, Math.max(ecoCfg.workMin, ecoCfg.workMax));
      const minReward = Math.max(1, Math.floor(workMin * this.config.hustleMinMultiplier));
      const maxReward = Math.max(minReward, Math.floor(workMax * this.config.hustleMaxMultiplier));
      const baseReward = minReward + Math.floor(clampUnit(rng()) * (maxReward - minReward + 1));

      const eventRoll = clampUnit(rng());
      let eventKey: HustleEventKey;
      if (eventRoll < 0.15) {
        eventKey = 'vip';
      } else if (eventRoll < 0.3) {
        eventKey = 'acquaintance';
      } else if (eventRoll < 0.85) {
        eventKey = 'normal';
      } else {
        eventKey = 'bust';
      }

      const spec = HUSTLE_EVENTS[eventKey];
      const multRoll = clampUnit(rng());
      const rawMult = spec.minMult + multRoll * (spec.maxMult - spec.minMult);
      const multiplier = Math.round(rawMult * 100) / 100;
      const story = pickFrom(spec.stories, rng());
      const grossReward = Math.max(1, Math.floor(baseReward * multiplier));

      const creditAdj = this.adjustCredit(
        guildId,
        userId,
        -this.config.hustleCreditPenalty,
        '下海营业信用扣分',
        nowMs,
      );

      const garnishRes = this.garnishIncomingCoins(guildId, userId, grossReward, 'sell_butt', nowMs);

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      const nextBalance = profile.coins + garnishRes.netAmount;
      this.profileRepo.save({ ...profile, coins: nextBalance });

      const nextStats: HustleStats = {
        guildId,
        userId,
        totalCount: stats.totalCount + 1,
        totalEarned: stats.totalEarned + grossReward,
        bestPayout: Math.max(stats.bestPayout, grossReward),
        lastHustleAt: nowMs,
      };
      this.repo.saveHustleStats(nextStats);

      const garnishNote =
        garnishRes.garnished > 0
          ? `（逾期强扣还债 ${garnishRes.garnished.toLocaleString()}，实到手 ${garnishRes.netAmount.toLocaleString()}）`
          : '';
      const publicAnnouncement = `🪩 【下海快报】<@${userId}> 触发「${spec.title}」：${story}！狂揽 ${grossReward.toLocaleString()} ${ecoCfg.currencyName}${garnishNote}，信用分 ${creditAdj.actualDelta}（${creditAdj.account.score}）。`;

      return {
        ok: true,
        eventKey,
        eventTitle: spec.title,
        story,
        multiplier,
        baseReward,
        grossReward,
        garnished: garnishRes.garnished,
        netReward: garnishRes.netAmount,
        clearedLoanIds: garnishRes.clearedLoanIds,
        creditDelta: creditAdj.actualDelta,
        creditScore: creditAdj.account.score,
        creditTier: creditAdj.tier,
        balance: nextBalance,
        stats: nextStats,
        publicAnnouncement,
      };
    })();
  }

  recordGamblingResult(
    guildId: string,
    userId: string,
    wager: number,
    netChange: number,
    nowMs = Date.now(),
  ): GamblingStats {
    return this.repo.recordGamblingDelta(guildId, userId, wager, netChange, nowMs);
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
