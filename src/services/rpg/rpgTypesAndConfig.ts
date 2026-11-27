import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../../db/repositories/profileRepo.js';
import type {
  RpgAffix,
  RpgCharacter,
  RpgClassKey,
  RpgDuel,
  RpgItem,
  RpgItemRarity,
  RpgItemSlot,
  RpgLegendaryEffect,
  RpgRepo,
  RpgTrial,
} from '../../db/repositories/rpgRepo.js';
import type { PetRarity, SocialPetRepo } from '../../db/repositories/socialPetRepo.js';
import type { CreditLoanService } from '../creditLoanService.js';
import type { AggregatedAffixBonuses } from '../rpgAffixes.js';
import type { CombatantSnapshot, RpgBattleReport, RpgBattleWinner } from '../rpgCombatEngine.js';
import type { RpgRealmInfo, RpgTierDef } from './rpgCatalogClassesAndTiers.js';

export interface RpgConfig {
  dailyStamina: number;
  staminaPotionPrice: number;
  staminaPotionDailyLimit: number;
  classSwitchCost: number;
  bagCapacity: number;
}

export const DEFAULT_RPG_CONFIG: RpgConfig = {
  dailyStamina: 5,
  staminaPotionPrice: 3000,
  staminaPotionDailyLimit: 3,
  classSwitchCost: 10000,
  bagCapacity: 30,
};

export const MAX_RPG_LEVEL = 90;
export const STAGES_PER_TIER = 9;
export const MAX_ENHANCE_LEVEL = 10;
export const MIN_IDLE_CLAIM_MS = 60_000;
export const MAX_IDLE_ACCRUE_MS = 24 * 3_600_000;
export const INJURY_DURATION_MS = 3_600_000;
export const PUBLIC_TRIAL_DURATION_MS = 60_000;

export const PROMO_PILL_PRICE = 5000;
export const PROMO_PILL_DAILY_LIMIT = 5;
export const PROMO_PILL_BONUS_PCT = 12;
export const MAX_TRIAL_PILLS = 3;

export const GUARD_ELIXIR_PRICE = 8000;
export const GUARD_ELIXIR_DAILY_LIMIT = 2;

export const MAX_TRIAL_SUPPORTERS = 5;
export const SUPPORTER_BONUS_PCT = 3;
export const MAX_TRIAL_SABOTEURS = 3;
export const SABOTEUR_PENALTY_PCT = 2;
export const SABOTEUR_POOL_BONUS_PCT = 20;
export const PITY_BONUS_PER_FAIL_PCT = 10;
export const DEFAULT_CREDIT_SCORE = 600;

export const DAILY_ARENA_FIGHTS = 5;
export const PUBLIC_DUEL_TTL_MS = 10 * 60_000;
export const MAX_RPG_DUEL_BET = 1_000_000_000;
export const DAILY_COOP_TICKETS = 2;
export const COOP_RECRUIT_TTL_MS = 3 * 60_000;
export const MIN_COOP_PARTY_SIZE = 2;
export const MAX_COOP_PARTY_SIZE = 4;
export const WORLD_BOSS_NORMAL_BONUS_CAP = 120;
export const WORLD_BOSS_HEAVY_BONUS_CAP = 180;

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999999, Math.max(0, value));
}

export function pickFrom<T>(list: readonly T[], rng: () => number): T {
  const idx = Math.min(list.length - 1, Math.floor(clampUnit(rng()) * list.length));
  return list[idx]!;
}

export interface EffectiveItemStats {
  hp: number;
  atk: number;
  def: number;
  critBp: number;
}

export interface PetSynergyInfo {
  petId: number;
  nickname: string;
  emoji: string;
  rarity: PetRarity;
  level: number;
  bonusHp: number;
  bonusAtk: number;
  bonusCritBp: number;
  assistChance: number;
  assistDamage: number;
}

export interface CombatStats {
  maxHp: number;
  atk: number;
  def: number;
  critBp: number;
  dodgeBp: number;
  classKey: RpgClassKey;
  level: number;
  equippedItems: RpgItem[];
  affixes: AggregatedAffixBonuses;
  petSynergy: PetSynergyInfo | null;
}

export type RpgCombatStats = CombatStats;

export interface PendingRpgItem {
  name: string;
  slot: RpgItemSlot;
  rarity: RpgItemRarity;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseCritBp: number;
  affixes: RpgAffix[];
  legendaryEffect: RpgLegendaryEffect | null;
}

export type RpgLootSource = 'idle' | 'boss' | 'shop' | 'abyss' | 'coop';

export type ChooseClassResult =
  | { ok: true; character: RpgCharacter; cost: number; balance: number; isFirstSelection: boolean }
  | { ok: false; reason: 'same_class' | 'insufficient_funds' | 'pending_trial'; cost?: number };

export type BuyStaminaPotionResult =
  | { ok: true; character: RpgCharacter; cost: number; balance: number; buysRemaining: number }
  | { ok: false; reason: 'daily_limit_reached' | 'insufficient_funds'; cost?: number; dailyLimit?: number };

export type BuyAlchemyItemResult =
  | { ok: true; kind: 'pill' | 'elixir'; character: RpgCharacter; cost: number; balance: number; buysRemaining: number }
  | { ok: false; reason: 'daily_limit_reached' | 'insufficient_funds'; cost?: number; dailyLimit?: number };

export type HealInjuryResult =
  | { ok: true; character: RpgCharacter; cost: number; balance: number }
  | { ok: false; reason: 'not_injured' | 'insufficient_funds'; cost?: number };

export type ConfigureTrialLoadoutResult =
  | { ok: true; character: RpgCharacter }
  | { ok: false; reason: 'no_guard_elixir' };

export interface IdleHarvestPreview {
  accruedMs: number;
  isCapped: boolean;
  canClaim: boolean;
  waitSeconds: number;
  isInjuredNow: boolean;
  injuredRemainingMs: number;
  powerMultiplier: number;
  estimatedXp: number;
  estimatedCoins: number;
  realm: RpgRealmInfo;
  atGate: boolean;
}

export type ClaimIdleHarvestResult =
  | {
      ok: true;
      accruedMs: number;
      powerMultiplier: number;
      xpEarned: number;
      levelsGained: number;
      hitGate: boolean;
      grossCoins: number;
      garnishedCoins: number;
      netCoins: number;
      pillsFound: number;
      elixirsFound: number;
      bankedItems: RpgItem[];
      legendaryDrops: RpgItem[];
      autoSalvagedCount: number;
      autoSalvagedCoins: number;
      autoSalvagedDust: number;
      dustEarned: number;
      adventures: string[];
      character: RpgCharacter;
      balance: number;
    }
  | { ok: false; reason: 'no_class_selected' | 'too_soon'; waitSeconds?: number };

export interface ArenaDailyRewardPreview {
  canClaim: boolean;
  claimedToday: boolean;
  rating: number;
  tierLabel: string;
  coins: number;
  dust: number;
  fightsUsed: number;
  fightsRemaining: number;
}

export type ChallengeArenaResult =
  | {
      ok: true;
      won: boolean;
      winner: RpgBattleWinner;
      ratingBefore: number;
      ratingAfter: number;
      ratingDelta: number;
      fightsUsed: number;
      fightsRemaining: number;
      grossCoins: number;
      garnishedCoins: number;
      netCoins: number;
      dustEarned: number;
      report: RpgBattleReport;
      highlights: string[];
      character: RpgCharacter;
      targetCharacter: RpgCharacter;
      balance: number;
    }
  | { ok: false; reason: 'self_target' | 'no_class_selected' | 'daily_limit_reached' | 'target_not_found'; dailyLimit?: number };

export type ClaimDailyArenaRewardResult =
  | {
      ok: true;
      rating: number;
      tierLabel: string;
      grossCoins: number;
      garnishedCoins: number;
      netCoins: number;
      dustEarned: number;
      character: RpgCharacter;
      balance: number;
    }
  | { ok: false; reason: 'no_class_selected' | 'already_claimed' };

export type CreatePublicDuelResult =
  | { ok: true; duel: RpgDuel; character: RpgCharacter; balance: number }
  | {
      ok: false;
      reason: 'self_target' | 'invalid_bet_amount' | 'no_class_selected' | 'pending_duel_exists' | 'deadbeat_blocked' | 'insufficient_funds';
      required?: number;
      available?: number;
    };

export type CancelPublicDuelResult =
  | { ok: true; duel: RpgDuel; refundedBet: number; balance: number }
  | { ok: false; reason: 'not_found' | 'already_resolved' | 'not_challenger' };

export type AcceptPublicDuelResult =
  | {
      ok: true;
      duel: RpgDuel;
      report: RpgBattleReport;
      winnerId: string | null;
      betAmount: number;
      winnerPayout: number;
      challengerBalance: number;
      acceptorBalance: number;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'already_resolved'
        | 'expired'
        | 'own_duel'
        | 'wrong_opponent'
        | 'no_class_selected'
        | 'challenger_unavailable'
        | 'deadbeat_blocked'
        | 'insufficient_funds';
      expectedOpponentId?: string;
      required?: number;
      available?: number;
    };

export interface RpgWorldBossBonus {
  bonusDamage: number;
  classEmoji: string;
  realmLabel: string;
}

export interface RpgWorldBossBridge {
  getBossAttackBonus(guildId: string, userId: string, mode: 'normal' | 'heavy', nowMs: number): RpgWorldBossBonus | null;
  awardBossKillDust(guildId: string, participantUserIds: readonly string[], mvpUserId: string, nowMs: number): ReadonlyMap<string, number>;
}

export interface BreakthroughPreview {
  eligible: boolean;
  atMaxTier: boolean;
  fromRealm: RpgRealmInfo;
  targetTierDef: RpgTierDef | null;
  needXp: number;
  currentXp: number;
  pillsUsed: number;
  usedGuard: boolean;
  baseRatePct: number;
  pillBonusPct: number;
  petBonusPct: number;
  petName: string | null;
  creditBonusPct: number;
  creditScore: number;
  pityBonusPct: number;
  rawBasePct: number;
  totalRatePct: number;
  hasPendingTrial: boolean;
}

export type SoloBreakthroughResult =
  | {
      ok: true;
      succeeded: boolean;
      fromRealm: RpgRealmInfo;
      toRealm: RpgRealmInfo;
      finalRatePct: number;
      pillsUsed: number;
      usedGuard: boolean;
      grossCoins: number;
      garnishedCoins: number;
      netCoins: number;
      creditDelta: number;
      xpLost: number;
      injuredUntil: number;
      character: RpgCharacter;
      balance: number;
    }
  | { ok: false; reason: 'no_class_selected' | 'at_max_tier' | 'not_at_gate' | 'pending_trial_exists' };

export type StartPublicTrialResult =
  | { ok: true; trial: RpgTrial; character: RpgCharacter; preview: BreakthroughPreview }
  | { ok: false; reason: 'no_class_selected' | 'at_max_tier' | 'not_at_gate' | 'pending_trial_exists' };

export type InteractPublicTrialResult =
  | { ok: true; trial: RpgTrial; currentRatePct: number; mode: 'help' | 'jeer' }
  | { ok: false; reason: 'not_found' | 'already_resolved' | 'own_trial' | 'already_joined' | 'supporters_full' | 'saboteurs_full' };

export interface SupporterPayout {
  userId: string;
  amount: number;
}

export type SettlePublicTrialResult =
  | {
      ok: true;
      trial: RpgTrial;
      succeeded: boolean;
      fromRealm: RpgRealmInfo;
      toRealm: RpgRealmInfo;
      finalRatePct: number;
      grossCoins: number;
      garnishedCoins: number;
      netCoins: number;
      creditDelta: number;
      xpLost: number;
      injuredUntil: number;
      supporterPayouts: SupporterPayout[];
      character: RpgCharacter;
      balance: number;
    }
  | { ok: false; reason: 'not_found' | 'already_resolved' | 'not_owner' };

export interface RpgServiceOptions {
  timezone?: string;
  config?: Partial<RpgConfig>;
  guildConfigRepo?: GuildConfigRepo;
  socialPetRepo?: SocialPetRepo;
  creditLoanService?: Pick<CreditLoanService, 'isDeadbeatBlocked' | 'recordGamblingResult'>;
  isGamblingBlocked?: (guildId: string, userId: string, nowMs?: number) => boolean;
  recordGamblingResult?: (guildId: string, userId: string, stake: number, netProfit: number, nowMs: number) => void;
  onCoinsEarned?: (guildId: string, userId: string, grossCoins: number, source: string, nowMs: number) => { garnished: number; net: number };
  onCreditChange?: (guildId: string, userId: string, delta: number, reason: string, nowMs: number) => void;
  getCreditScore?: (guildId: string, userId: string) => number;
}

export interface BankLootInput {
  guildId: string;
  userId: string;
  character: RpgCharacter;
  xpGain: number;
  coinGain: number;
  dustGain?: number;
  pendingItems: PendingRpgItem[];
  source: string;
  nowMs: number;
}

export interface BankLootResult {
  bankedItems: RpgItem[];
  legendaryDrops: RpgItem[];
  autoSalvagedCount: number;
  autoSalvagedCoins: number;
  autoSalvagedDust: number;
  dustEarned: number;
  grossCoins: number;
  garnishedCoins: number;
  netCoins: number;
  levelsGained: number;
  hitGate: boolean;
  updatedCharacter: RpgCharacter;
  balance: number;
}

export interface RpgOpsContext {
  readonly db: Database.Database;
  readonly rpgRepo: RpgRepo;
  readonly profileRepo: ProfileRepo;
  readonly timezone: string;
  readonly socialPetRepo?: SocialPetRepo;
  readonly onCreditChange?: RpgServiceOptions['onCreditChange'];
  getConfig(guildId?: string): RpgConfig;
  getUserCreditScore(guildId: string, userId: string): number;
  checkGamblingBlocked(guildId: string, userId: string, nowMs: number): boolean;
  emitGamblingResult(guildId: string, userId: string, stake: number, netProfit: number, nowMs: number): void;
  applyCoinRewardInTx(guildId: string, userId: string, rawCoins: number, source: string, nowMs: number): { grossCoins: number; garnishedCoins: number; netCoins: number; balance: number };
  resolveHeroDisplayName(guildId: string, userId: string): string;
  computeCombatStatsForCharacter(character: RpgCharacter): CombatStats;
  buildCombatantForCharacter(character: RpgCharacter, customName?: string): CombatantSnapshot;
  getOrCreateCharacterInTx(guildId: string, userId: string, nowMs: number): RpgCharacter;
  refreshCharacterInTx(character: RpgCharacter, today: string, nowMs: number): RpgCharacter;
  bankLootInTx(input: BankLootInput): BankLootResult;
}
