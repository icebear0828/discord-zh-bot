import type Database from 'better-sqlite3';
import type { ChaosRepo, PropKey } from '../../db/repositories/chaosRepo.js';
import type { GuildConfigRepo } from '../../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../../db/repositories/profileRepo.js';
import type {
  RpgItemRarity,
  RpgItemSlot,
  RpgRepo,
} from '../../db/repositories/rpgRepo.js';
import type { InventoryItem, ShopItem, ShopRepo } from '../../db/repositories/shopRepo.js';
import type { RelationshipType, SocialPetRepo } from '../../db/repositories/socialPetRepo.js';
import type { CreditLoanService } from '../creditLoanService.js';

export const DEFAULT_STAT_BOOST_DAILY_LIMIT = 3;
export const DEFAULT_CREDIT_BOOST_DAILY_LIMIT = 2;

export interface RoleItemPayload {
  requiredRoleId: string | null;
}

export interface StatBoostPayload {
  minGain: number;
  maxGain: number;
  dailyLimit: number;
  critChance: number;
  backfireChance: number;
}

export interface PetXpPayload {
  petXp: number;
}

export interface CreditBoostPayload {
  creditGain: number;
  dailyLimit: number;
}

export interface RpgSupplyPayload {
  staminaGain: number;
  lootBox: boolean;
  minRarity: RpgItemRarity;
}

export interface CpAffinityPayload {
  affinityGain: number;
}

export type StatBoostOutcome = 'crit' | 'normal' | 'backfire';

export interface StatBoostResult {
  outcome: StatBoostOutcome;
  delta: number;
  newStatValue: number;
  usedToday: number;
  dailyLimit: number;
}

export interface PetXpResult {
  petName: string;
  xpGained: number;
  oldLevel: number;
  newLevel: number;
  levelsGained: number;
}

export interface CreditBoostResult {
  delta: number;
  newScore: number;
  tierLabel: string;
  usedToday: number;
  dailyLimit: number;
}

export interface RpgSupplyResult {
  staminaGained: number;
  newStamina: number;
  droppedItem?: {
    name: string;
    slot: RpgItemSlot;
    rarity: RpgItemRarity;
  };
}

export interface CpAffinityResult {
  partnerId: string;
  relType: RelationshipType;
  affinityGained: number;
  newAffinity: number;
  unlockedTitles: string[];
}

export type MysteryBoxReward =
  | { kind: 'coins_jackpot'; summary: string; isJackpot: true; coinsDelta: number }
  | { kind: 'stat_jackpot'; summary: string; isJackpot: true; statDelta: number; newStatValue: number }
  | { kind: 'xp_boost'; summary: string; isJackpot: false; boostMultiplier: number; boostDurationSec: number }
  | { kind: 'chaos_prop'; summary: string; isJackpot: false; propKey: PropKey }
  | { kind: 'pet_xp'; summary: string; isJackpot: false; petName: string; petXpGained: number; petLevelsGained: number }
  | { kind: 'stat_small'; summary: string; isJackpot: false; statDelta: number; newStatValue: number }
  | { kind: 'coins_refund'; summary: string; isJackpot: false; coinsDelta: number };

export interface ShopServiceDeps {
  guildConfigRepo?: GuildConfigRepo;
  chaosRepo?: ChaosRepo;
  socialPetRepo?: SocialPetRepo;
  creditLoanService?: CreditLoanService;
  rpgRepo?: RpgRepo;
  timezone?: string;
}

export interface ShopOpsContext {
  readonly db: Database.Database;
  readonly profileRepo: ProfileRepo;
  readonly shopRepo: ShopRepo;
  readonly guildConfigRepo?: GuildConfigRepo;
  readonly chaosRepo?: ChaosRepo;
  readonly socialPetRepo?: SocialPetRepo;
  readonly creditLoanService?: CreditLoanService;
  readonly rpgRepo?: RpgRepo;
  readonly timezone: string;
}

export type BuyFailureReason =
  | 'not_found'
  | 'out_of_stock'
  | 'insufficient_funds'
  | 'already_owned'
  | 'daily_limit_reached'
  | 'no_active_pet'
  | 'invalid_title'
  | 'missing_required_role'
  | 'credit_already_max'
  | 'no_rpg_character'
  | 'rpg_bag_full'
  | 'no_relationship';

export type BuyResult =
  | {
      ok: true;
      item: ShopItem;
      finalPrice: number;
      balance: number;
      grantRoleId: string | null;
      equippedTitle: string | null;
      addedInventory: InventoryItem | null;
      statBoostResult?: StatBoostResult;
      petXpResult?: PetXpResult;
      creditBoostResult?: CreditBoostResult;
      rpgSupplyResult?: RpgSupplyResult;
      cpAffinityResult?: CpAffinityResult;
      mysteryBoxResult?: MysteryBoxReward;
      customTitleVoucher?: boolean;
    }
  | {
      ok: false;
      reason: BuyFailureReason;
      dailyLimit?: number;
      finalPrice?: number;
      requiredRoleId?: string;
    };

export type UseInventoryResult =
  | {
      ok: true;
      item: InventoryItem;
      boostMultiplier?: number;
      boostExpiresAt?: number;
      equippedTitle?: string;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'unsupported_item'
        | 'already_owned'
        | 'invalid_title'
        | 'boost_multiplier_conflict';
      activeBoostMultiplier?: number;
      activeBoostExpiresAt?: number;
    };

export interface TitlePayload {
  titleText: string;
}

export interface BoostPayload {
  multiplier: number;
  durationSec: number;
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function parseStatBoostPayload(payloadJson: string): StatBoostPayload {
  const obj = parseJsonObject(payloadJson);
  const minRaw =
    typeof obj.minGain === 'number' && Number.isFinite(obj.minGain) ? Math.floor(obj.minGain) : 1;
  const minGain = Math.max(1, minRaw);
  const maxRaw =
    typeof obj.maxGain === 'number' && Number.isFinite(obj.maxGain) ? Math.floor(obj.maxGain) : 3;
  const maxGain = Math.max(minGain, maxRaw);
  const dailyLimitRaw =
    typeof obj.dailyLimit === 'number' && Number.isFinite(obj.dailyLimit)
      ? Math.floor(obj.dailyLimit)
      : DEFAULT_STAT_BOOST_DAILY_LIMIT;
  const dailyLimit = Math.max(1, dailyLimitRaw);
  const critChance =
    typeof obj.critChance === 'number' && Number.isFinite(obj.critChance)
      ? Math.max(0, Math.min(1, obj.critChance))
      : 0.1;
  const backfireChance =
    typeof obj.backfireChance === 'number' && Number.isFinite(obj.backfireChance)
      ? Math.max(0, Math.min(1 - critChance, obj.backfireChance))
      : 0.1;
  return { minGain, maxGain, dailyLimit, critChance, backfireChance };
}

export function parsePetXpPayload(payloadJson: string): PetXpPayload {
  const obj = parseJsonObject(payloadJson);
  const raw =
    typeof obj.petXp === 'number' && Number.isFinite(obj.petXp) ? Math.floor(obj.petXp) : 150;
  return { petXp: Math.max(1, raw) };
}

export function parseRolePayload(payloadJson: string): RoleItemPayload {
  const obj = parseJsonObject(payloadJson);
  const raw = typeof obj.requiredRoleId === 'string' ? obj.requiredRoleId.trim() : '';
  return { requiredRoleId: raw.length > 0 ? raw : null };
}

export function parseCreditBoostPayload(payloadJson: string): CreditBoostPayload {
  const obj = parseJsonObject(payloadJson);
  const gainRaw =
    typeof obj.creditGain === 'number' && Number.isFinite(obj.creditGain)
      ? Math.floor(obj.creditGain)
      : 15;
  const limitRaw =
    typeof obj.dailyLimit === 'number' && Number.isFinite(obj.dailyLimit)
      ? Math.floor(obj.dailyLimit)
      : DEFAULT_CREDIT_BOOST_DAILY_LIMIT;
  return {
    creditGain: Math.max(1, gainRaw),
    dailyLimit: Math.max(1, limitRaw),
  };
}

const VALID_RPG_RARITIES: ReadonlySet<string> = new Set([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
]);

export function parseRpgSupplyPayload(payloadJson: string): RpgSupplyPayload {
  const obj = parseJsonObject(payloadJson);
  const staminaRaw =
    typeof obj.staminaGain === 'number' && Number.isFinite(obj.staminaGain)
      ? Math.floor(obj.staminaGain)
      : 0;
  const lootBox = typeof obj.lootBox === 'boolean' ? obj.lootBox : false;
  const rawRarity = typeof obj.minRarity === 'string' ? obj.minRarity : 'rare';
  const minRarity: RpgItemRarity = VALID_RPG_RARITIES.has(rawRarity)
    ? (rawRarity as RpgItemRarity)
    : 'rare';
  return {
    staminaGain: Math.max(0, staminaRaw),
    lootBox,
    minRarity,
  };
}

export function parseCpAffinityPayload(payloadJson: string): CpAffinityPayload {
  const obj = parseJsonObject(payloadJson);
  const raw =
    typeof obj.affinityGain === 'number' && Number.isFinite(obj.affinityGain)
      ? Math.floor(obj.affinityGain)
      : 20;
  return { affinityGain: Math.max(1, raw) };
}

export function randomIntInclusive(min: number, max: number, rng: () => number): number {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (hi <= lo) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}
