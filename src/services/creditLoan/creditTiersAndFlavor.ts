import type Database from 'better-sqlite3';
import type { ChaosRepo } from '../../db/repositories/chaosRepo.js';
import type {
  CreditAccount,
  CreditLoanRepo,
  CreditLog,
  CreditReviewKind,
  HustleStats,
  Loan,
  LoanType,
} from '../../db/repositories/creditLoanRepo.js';
import type { GuildConfigRepo } from '../../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../../db/repositories/profileRepo.js';

export const CREDIT_SCORE_MIN = 0;
export const CREDIT_SCORE_MAX = 1000;
export const CREDIT_SCORE_DEFAULT = 600;

export const DAY_MS = 86_400_000;
export const BANK_MIN_SCORE = 300;
export const ENDORSE_BASE_DELTA = 10;
export const REPORT_NORMAL_DELTA = -8;
export const REPORT_OVERDUE_DELTA = -15;
export const BANK_OVERDUE_PENALTY_RATE = 0.05;
export const BANK_OVERDUE_CAP_MULT = 2.5;
export const BANK_OVERDUE_CREDIT_DROP = -15;
export const USURY_OVERDUE_PENALTY_RATE = 0.2;
export const USURY_OVERDUE_CAP_MULT = 3.0;
export const USURY_OVERDUE_CREDIT_DROP = -30;
export const USURY_BOUNTY_RATE = 0.2;
export const USURY_BOUNTY_MIN = 5_000;
export const USURY_BOUNTY_MAX = 100_000;

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
  hustleCooldownSec: 3_600,
  hustleMinMultiplier: 12,
  hustleMaxMultiplier: 14,
  hustleCreditPenalty: 5,
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

export interface HustleEventSpec {
  key: HustleEventKey;
  title: string;
  minMult: number;
  maxMult: number;
  stories: readonly string[];
}

export const HUSTLE_EVENTS: Readonly<Record<HustleEventKey, HustleEventSpec>> = {
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
    minMult: 0.85,
    maxMult: 0.85,
    stories: [
      '刚开场就遇上治安巡逻查消防证，抱着收款码一路狂奔，只捡回一半出场费',
      '辛辛苦苦陪聊两小时，结果对面是个比你还穷的群友老赖，借口上厕所跳窗跑单',
      '在广场整活时音响突然炸麦，围观群众一哄而散，只凑到半份辛苦费',
    ],
  },
};

export interface CreditLoanOpsContext {
  readonly db: Database.Database;
  readonly configRepo: GuildConfigRepo;
  readonly profileRepo: ProfileRepo;
  readonly repo: CreditLoanRepo;
  readonly timezone: string;
  readonly chaosRepo?: ChaosRepo;
  getConfig(guildId?: string): CreditLoanConfig;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999, value));
}

export function pickFrom<T>(items: readonly T[], r: number): T {
  const idx = Math.min(items.length - 1, Math.floor(clampUnit(r) * items.length));
  return items[idx]!;
}

export function isLoanOverdueAt(loan: Loan, nowMs: number): boolean {
  return loan.status === 'overdue' || (loan.status === 'active' && nowMs > loan.dueAt);
}

export function getLoanDebt(loan: Loan): number {
  return loan.remainingPrincipal + loan.accruedInterest;
}

export function getDeadbeatStatusForUser(
  repo: CreditLoanRepo,
  guildId: string,
  userId: string,
  nowMs: number,
): DeadbeatStatus {
  const openLoans = repo.listUserLoans(guildId, userId, {
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
