import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../../db/repositories/profileRepo.js';
import type { SocialPetRepo } from '../../db/repositories/socialPetRepo.js';
import type {
  Prediction,
  PredictionBet,
  WorldEvent,
  WorldEventParticipant,
  WorldEventRepo,
} from '../../db/repositories/worldEventRepo.js';
import type { CreditLoanService } from '../creditLoanService.js';

export interface WorldEventOpsDeps {
  db: Database.Database;
  configRepo: GuildConfigRepo;
  profileRepo: ProfileRepo;
  worldEventRepo: WorldEventRepo;
  socialPetRepo?: SocialPetRepo;
  creditLoanService?: CreditLoanService;
}

export interface WorldEventRuntimeState {
  guildMsgCounts: Map<string, number>;
  lastAutoEventAt: Map<string, number>;
  rpgBridge?: RpgWorldBossBridge;
}

export interface PredictionOptionStat {
  index: number;
  label: string;
  totalAmount: number;
  bettorCount: number;
  oddsText: string;
}

export interface PredictionSummary {
  prediction: Prediction;
  totalPool: number;
  optionStats: PredictionOptionStat[];
  bets: PredictionBet[];
}

export type CreatePredictionResult =
  | { ok: true; summary: PredictionSummary }
  | { ok: false; reason: 'invalid_title' | 'invalid_options' | 'invalid_duration' };

export type PlaceBetResult =
  | { ok: true; summary: PredictionSummary; betAmount: number; balance: number }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_open'
        | 'closed'
        | 'creator_cannot_bet'
        | 'invalid_option'
        | 'invalid_amount'
        | 'insufficient_funds'
        | 'deadbeat_blocked';
    };

export type LockPredictionResult =
  | { ok: true; summary: PredictionSummary }
  | { ok: false; reason: 'not_found' | 'no_permission' | 'invalid_status' };

export interface PredictionPayout {
  userId: string;
  amount: number;
}

export type SettlePredictionResult =
  | {
      ok: true;
      summary: PredictionSummary;
      winningOption: number;
      totalPool: number;
      refundedNoWinner: boolean;
      payouts: PredictionPayout[];
    }
  | {
      ok: false;
      reason: 'not_found' | 'no_permission' | 'not_locked' | 'invalid_status' | 'invalid_option';
    };

export type CancelPredictionResult =
  | { ok: true; summary: PredictionSummary; refunds: PredictionPayout[] }
  | { ok: false; reason: 'not_found' | 'no_permission' | 'invalid_status' };

export interface ExpiredLockedPredictionResult {
  summary: PredictionSummary;
  refunds: PredictionPayout[];
}

export type ClaimChestResult =
  | {
      ok: true;
      event: WorldEvent;
      amount: number;
      balance: number;
      participants: WorldEventParticipant[];
    }
  | { ok: false; reason: 'not_found' | 'not_chest' | 'not_active' | 'expired' | 'already_claimed' };

export type BossAttackMode = 'normal' | 'heavy';

export const RPG_BOSS_NORMAL_BONUS_CAP = 120;
export const RPG_BOSS_HEAVY_BONUS_CAP = 180;

export interface RpgWorldBossBonus {
  bonusDamage: number;
  classEmoji: string;
  realmLabel: string;
}

export interface RpgWorldBossBridge {
  getBossAttackBonus(
    guildId: string,
    userId: string,
    mode: BossAttackMode,
    nowMs: number,
  ): RpgWorldBossBonus | null;
  awardBossKillDust(
    guildId: string,
    participantUserIds: readonly string[],
    mvpUserId: string,
    nowMs: number,
  ): ReadonlyMap<string, number>;
}

export interface BossRewardEntry {
  userId: string;
  damage: number;
  baseReward: number;
  mvpBonus: number;
  totalReward: number;
  dustAwarded?: number;
}

export type AttackBossResult =
  | {
      ok: true;
      event: WorldEvent;
      damage: number;
      crit: boolean;
      missed: boolean;
      petBonus: number;
      petName: string | null;
      rpgBonus: number;
      rpgHeroLabel: string | null;
      killed: boolean;
      rewards: BossRewardEntry[];
      participants: WorldEventParticipant[];
    }
  | {
      ok: false;
      reason: 'not_found' | 'not_boss' | 'not_active' | 'expired' | 'cooldown';
      retryAfterSec?: number;
    };

export interface ExpiredWorldEventResult {
  event: WorldEvent;
  consolations: Array<{ userId: string; amount: number }>;
  participants: WorldEventParticipant[];
}

export const CHEST_TEMPLATES: ReadonlyArray<{ name: string; flavor: string }> = [
  { name: '黄金神秘宝箱', flavor: '天空中突然掉下一只金光闪闪的大宝箱，手快有手慢无！' },
  { name: '海盗沉船财宝箱', flavor: '潮汐带来了一只刻满神秘符号的古代宝箱，快来开箱！' },
  { name: '星界幸运补给箱', flavor: '社区能量爆棚！系统空投了一批幸运补给！' },
  { name: '策划遗落的私房钱盒', flavor: '快趁管理员没反应过来，赶紧过来抓一把！' },
];

export const BOSS_TEMPLATES: ReadonlyArray<{ name: string; flavor: string }> = [
  { name: '摸鱼大魔王', flavor: '“今天谁也不许按时下班！” — 携带大量摸鱼经费出没中！' },
  { name: '万恶的加班哥布林', flavor: '嘴里念叨着“紧急需求马上改”，快用重击教它做人！' },
  { name: '暴走偷钱巨鼠', flavor: '听说它偷光了三条街的口袋现金，击败它分赃！' },
  { name: '深渊欧皇嫉妒兽', flavor: '专吸十连保底人的怨气而生，击败必爆巨额奖池！' },
  { name: '通宵开黑修罗王', flavor: '“再来最后一把！” — 全群齐心协力拿下首杀和尾刀大奖！' },
  { name: '冰镇肥宅水史莱姆', flavor: 'QQ 弹弹却皮糙肉厚，出战宠物还能额外助战增伤！' },
  { name: '代码 Bug 缝合怪', flavor: '明明本地能跑，一上线就报错！快召唤群友共同镇压！' },
  { name: '发癫土味机械龙', flavor: '带着 24K 纯金爪子降临频道，打出最后一击还能暴击拿尾刀！' },
];

export const CHEST_TTL_MS = 5 * 60 * 1000;
export const BOSS_TTL_MS = 10 * 60 * 1000;

export function buildPredictionSummary(
  prediction: Prediction,
  bets: PredictionBet[],
): PredictionSummary {
  const amounts = prediction.options.map(() => 0);
  const bettorSets = prediction.options.map(() => new Set<string>());
  let totalPool = 0;

  for (const bet of bets) {
    if (bet.optionIndex >= 0 && bet.optionIndex < prediction.options.length) {
      amounts[bet.optionIndex] = (amounts[bet.optionIndex] ?? 0) + bet.amount;
      bettorSets[bet.optionIndex]!.add(bet.userId);
      totalPool += bet.amount;
    }
  }

  const optionStats: PredictionOptionStat[] = prediction.options.map((label, index) => {
    const totalAmount = amounts[index] ?? 0;
    const bettorCount = bettorSets[index]!.size;
    const oddsText =
      totalAmount > 0 && totalPool > 0
        ? `${(totalPool / totalAmount).toFixed(2)}x`
        : '待开赔率';
    return { index, label, totalAmount, bettorCount, oddsText };
  });

  return { prediction, totalPool, optionStats, bets };
}
