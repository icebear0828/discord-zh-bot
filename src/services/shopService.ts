import type Database from 'better-sqlite3';
import type { ChaosRepo, PropKey } from '../db/repositories/chaosRepo.js';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { InventoryItem, ShopItem, ShopRepo } from '../db/repositories/shopRepo.js';
import type { SocialPetRepo } from '../db/repositories/socialPetRepo.js';
import { PROP_CATALOG } from './chaosService.js';
import { getCreditTier, type CreditLoanService } from './creditLoanService.js';
import { getDateKey } from './economyService.js';
import { applyPetXp } from './socialPetService.js';

export const DEFAULT_STAT_BOOST_DAILY_LIMIT = 3;

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
  timezone?: string;
}

export type BuyFailureReason =
  | 'not_found'
  | 'out_of_stock'
  | 'insufficient_funds'
  | 'already_owned'
  | 'daily_limit_reached'
  | 'no_active_pet'
  | 'invalid_title';

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
      mysteryBoxResult?: MysteryBoxReward;
      customTitleVoucher?: boolean;
    }
  | {
      ok: false;
      reason: BuyFailureReason;
      dailyLimit?: number;
      finalPrice?: number;
    };

export type UseInventoryResult =
  | {
      ok: true;
      item: InventoryItem;
      boostMultiplier?: number;
      boostExpiresAt?: number;
      equippedTitle?: string;
    }
  | { ok: false; reason: 'not_found' | 'unsupported_item' | 'already_owned' | 'invalid_title' };

interface TitlePayload {
  titleText: string;
}

interface BoostPayload {
  multiplier: number;
  durationSec: number;
}

const PROP_KEYS: readonly PropKey[] = ['trap', 'lockpick', 'shield', 'curse', 'nickname'];

function parseJsonObject(raw: string): Record<string, unknown> {
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
  const minRaw = typeof obj.minGain === 'number' && Number.isFinite(obj.minGain) ? Math.floor(obj.minGain) : 1;
  const minGain = Math.max(1, minRaw);
  const maxRaw = typeof obj.maxGain === 'number' && Number.isFinite(obj.maxGain) ? Math.floor(obj.maxGain) : 3;
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
  const raw = typeof obj.petXp === 'number' && Number.isFinite(obj.petXp) ? Math.floor(obj.petXp) : 150;
  return { petXp: Math.max(1, raw) };
}

function randomIntInclusive(min: number, max: number, rng: () => number): number {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (hi <= lo) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export class ShopService {
  private readonly guildConfigRepo?: GuildConfigRepo;
  private readonly chaosRepo?: ChaosRepo;
  private readonly socialPetRepo?: SocialPetRepo;
  private readonly creditLoanService?: CreditLoanService;
  private readonly timezone: string;

  constructor(
    private readonly db: Database.Database,
    private readonly profileRepo: ProfileRepo,
    private readonly shopRepo: ShopRepo,
    deps: ShopServiceDeps = {},
  ) {
    this.guildConfigRepo = deps.guildConfigRepo;
    this.chaosRepo = deps.chaosRepo;
    this.socialPetRepo = deps.socialPetRepo;
    this.creditLoanService = deps.creditLoanService;
    this.timezone = deps.timezone ?? 'Asia/Shanghai';
  }

  private computeFinalPrice(
    guildId: string,
    userId: string,
    basePrice: number,
    nowMs: number,
  ): number {
    if (!this.creditLoanService || basePrice <= 0) {
      return basePrice;
    }
    const creditProfile = this.creditLoanService.getCreditProfile(guildId, userId, nowMs);
    const mult = getCreditTier(creditProfile.account.score).shopMult;
    return Math.max(1, Math.round(basePrice * mult));
  }

  private getStatMeta(guildId: string): { statName: string; statUnit: string; currencyName: string } {
    if (!this.guildConfigRepo) {
      return { statName: '成长值', statUnit: '点', currencyName: '星币' };
    }
    const cfg = this.guildConfigRepo.getOrCreate(guildId);
    return {
      statName: cfg.leveling.statName,
      statUnit: cfg.leveling.statUnit,
      currencyName: cfg.economy.currencyName,
    };
  }

  createRoleItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    roleId: string;
    stock: number | null;
  }): ShopItem {
    return this.shopRepo.createItem({
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      type: 'role',
      price: Math.max(0, Math.floor(input.price)),
      roleId: input.roleId,
      titleText: null,
      boostMultiplier: null,
      boostDurationSec: null,
      stock: input.stock,
      payloadJson: '{}',
    });
  }

  createTitleItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    titleText: string;
    stock: number | null;
  }): ShopItem {
    return this.shopRepo.createItem({
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      type: 'title',
      price: Math.max(0, Math.floor(input.price)),
      roleId: null,
      titleText: input.titleText,
      boostMultiplier: null,
      boostDurationSec: null,
      stock: input.stock,
      payloadJson: '{}',
    });
  }

  createBoostItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    boostMultiplier: number;
    boostDurationSec: number;
    stock: number | null;
  }): ShopItem {
    return this.shopRepo.createItem({
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      type: 'xp_boost',
      price: Math.max(0, Math.floor(input.price)),
      roleId: null,
      titleText: null,
      boostMultiplier: input.boostMultiplier,
      boostDurationSec: input.boostDurationSec,
      stock: input.stock,
      payloadJson: '{}',
    });
  }

  createStatBoostItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    minGain: number;
    maxGain: number;
    dailyLimit?: number;
    critChance?: number;
    backfireChance?: number;
    stock: number | null;
  }): ShopItem {
    const minGain = Math.max(1, Math.floor(input.minGain));
    const maxGain = Math.max(minGain, Math.floor(input.maxGain));
    const payload: StatBoostPayload = {
      minGain,
      maxGain,
      dailyLimit: Math.max(1, Math.floor(input.dailyLimit ?? DEFAULT_STAT_BOOST_DAILY_LIMIT)),
      critChance: Math.max(0, Math.min(1, input.critChance ?? 0.1)),
      backfireChance: Math.max(0, Math.min(1, input.backfireChance ?? 0.1)),
    };
    return this.shopRepo.createItem({
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      type: 'stat_boost',
      price: Math.max(0, Math.floor(input.price)),
      roleId: null,
      titleText: null,
      boostMultiplier: null,
      boostDurationSec: null,
      stock: input.stock,
      payloadJson: JSON.stringify(payload),
    });
  }

  createCustomTitleItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    stock: number | null;
  }): ShopItem {
    return this.shopRepo.createItem({
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      type: 'custom_title',
      price: Math.max(0, Math.floor(input.price)),
      roleId: null,
      titleText: null,
      boostMultiplier: null,
      boostDurationSec: null,
      stock: input.stock,
      payloadJson: '{}',
    });
  }

  createPetXpItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    petXp: number;
    stock: number | null;
  }): ShopItem {
    const payload: PetXpPayload = { petXp: Math.max(1, Math.floor(input.petXp)) };
    return this.shopRepo.createItem({
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      type: 'pet_xp',
      price: Math.max(0, Math.floor(input.price)),
      roleId: null,
      titleText: null,
      boostMultiplier: null,
      boostDurationSec: null,
      stock: input.stock,
      payloadJson: JSON.stringify(payload),
    });
  }

  createMysteryBoxItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    stock: number | null;
  }): ShopItem {
    return this.shopRepo.createItem({
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      type: 'mystery_box',
      price: Math.max(0, Math.floor(input.price)),
      roleId: null,
      titleText: null,
      boostMultiplier: null,
      boostDurationSec: null,
      stock: input.stock,
      payloadJson: '{}',
    });
  }

  listItems(guildId: string): ShopItem[] {
    return this.shopRepo.listItems(guildId);
  }

  removeItem(guildId: string, itemId: number): boolean {
    return this.shopRepo.removeItem(guildId, itemId);
  }

  listInventory(guildId: string, userId: string): InventoryItem[] {
    return this.shopRepo.listInventory(guildId, userId);
  }

  getStatBoostRemainingToday(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
    dailyLimit = DEFAULT_STAT_BOOST_DAILY_LIMIT,
  ): { usedToday: number; remaining: number; dailyLimit: number } {
    const profile = this.profileRepo.getOrCreate(guildId, userId);
    const today = getDateKey(nowMs, this.timezone);
    const usedToday = profile.lastStatBoostDate === today ? profile.statBoostDailyCount : 0;
    const safeLimit = Math.max(1, Math.floor(dailyLimit));
    return {
      usedToday,
      remaining: Math.max(0, safeLimit - usedToday),
      dailyLimit: safeLimit,
    };
  }

  buyItem(
    guildId: string,
    userId: string,
    itemId: number,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): BuyResult {
    return this.db.transaction((): BuyResult => {
      const item = this.shopRepo.getItemById(guildId, itemId);
      if (!item) {
        return { ok: false, reason: 'not_found' };
      }
      if (item.stock !== null && item.stock <= 0) {
        return { ok: false, reason: 'out_of_stock' };
      }

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      const finalPrice = this.computeFinalPrice(guildId, userId, item.price, nowMs);
      if (profile.coins < finalPrice) {
        return { ok: false, reason: 'insufficient_funds', finalPrice };
      }

      if (item.type === 'title' && item.titleText) {
        const owned = this.shopRepo.findInventoryByTypeAndName(
          guildId,
          userId,
          'title',
          item.titleText,
        );
        if (owned) {
          return { ok: false, reason: 'already_owned' };
        }
      }

      if (item.type === 'stat_boost') {
        const payload = parseStatBoostPayload(item.payloadJson);
        const today = getDateKey(nowMs, this.timezone);
        const usedToday = profile.lastStatBoostDate === today ? profile.statBoostDailyCount : 0;
        if (usedToday >= payload.dailyLimit) {
          return { ok: false, reason: 'daily_limit_reached', dailyLimit: payload.dailyLimit };
        }

        const baseGain = randomIntInclusive(payload.minGain, payload.maxGain, rng);
        const roll = rng();
        let outcome: StatBoostOutcome = 'normal';
        let delta = baseGain;

        if (roll < payload.critChance) {
          outcome = 'crit';
          delta = baseGain * 2;
        } else if (roll < payload.critChance + payload.backfireChance) {
          outcome = 'backfire';
          const loss = Math.max(1, Math.floor(payload.minGain));
          const clampedNext = Math.max(0, profile.statValue - loss);
          delta = clampedNext - profile.statValue;
        }

        const nextStatValue = Math.max(0, profile.statValue + delta);
        const nextCoins = profile.coins - finalPrice;
        const nextUsed = usedToday + 1;

        this.shopRepo.decrementStock(guildId, item.id);
        this.profileRepo.save({
          ...profile,
          coins: nextCoins,
          statValue: nextStatValue,
          lastStatBoostDate: today,
          statBoostDailyCount: nextUsed,
        });

        return {
          ok: true,
          item,
          finalPrice,
          balance: nextCoins,
          grantRoleId: null,
          equippedTitle: null,
          addedInventory: null,
          statBoostResult: {
            outcome,
            delta,
            newStatValue: nextStatValue,
            usedToday: nextUsed,
            dailyLimit: payload.dailyLimit,
          },
        };
      }

      if (item.type === 'pet_xp') {
        const activePet = this.socialPetRepo?.getActivePet(guildId, userId) ?? null;
        if (!activePet || !this.socialPetRepo) {
          return { ok: false, reason: 'no_active_pet' };
        }

        const { petXp } = parsePetXpPayload(item.payloadJson);
        const applied = applyPetXp(activePet, petXp);
        const nextCoins = profile.coins - finalPrice;

        this.shopRepo.decrementStock(guildId, item.id);
        this.profileRepo.save({ ...profile, coins: nextCoins });
        this.socialPetRepo.savePet(applied.updatedPet);

        return {
          ok: true,
          item,
          finalPrice,
          balance: nextCoins,
          grantRoleId: null,
          equippedTitle: null,
          addedInventory: null,
          petXpResult: {
            petName: applied.updatedPet.nickname,
            xpGained: petXp,
            oldLevel: activePet.level,
            newLevel: applied.updatedPet.level,
            levelsGained: applied.levelsGained,
          },
        };
      }

      if (item.type === 'mystery_box') {
        const meta = this.getStatMeta(guildId);
        this.shopRepo.decrementStock(guildId, item.id);
        let nextCoins = profile.coins - finalPrice;
        let nextStat = profile.statValue;
        const roll = rng();
        let reward: MysteryBoxReward;

        if (roll < 0.03) {
          const mult = randomIntInclusive(3, 5, rng);
          const prize = Math.max(100, finalPrice * mult);
          nextCoins += prize;
          reward = {
            kind: 'coins_jackpot',
            isJackpot: true,
            coinsDelta: prize,
            summary: `💥 **超级金奖！** 开出 **${mult}x** 暴击返币 **+${prize}** ${meta.currencyName}！`,
          };
        } else if (roll < 0.05) {
          const gain = randomIntInclusive(8, 15, rng);
          nextStat += gain;
          reward = {
            kind: 'stat_jackpot',
            isJackpot: true,
            statDelta: gain,
            newStatValue: nextStat,
            summary: `🌟 **天选奇迹！** ${meta.statName}暴涨 **+${gain}** ${meta.statUnit}（现 **${nextStat}** ${meta.statUnit}）！`,
          };
        } else if (roll < 0.25) {
          const boostPayload: BoostPayload = { multiplier: 2.0, durationSec: 3600 };
          this.shopRepo.addInventoryItem({
            guildId,
            userId,
            itemType: 'xp_boost',
            itemName: '⚡ 盲盒双倍经验卡',
            payloadJson: JSON.stringify(boostPayload),
            quantity: 1,
            acquiredAt: nowMs,
          });
          reward = {
            kind: 'xp_boost',
            isJackpot: false,
            boostMultiplier: 2.0,
            boostDurationSec: 3600,
            summary: '⚡ 开出 **2.0x 经验加成卡（60分钟）**，已存入背包！',
          };
        } else if (roll < 0.45 && this.chaosRepo) {
          const propKey = PROP_KEYS[Math.floor(rng() * PROP_KEYS.length)] ?? 'shield';
          const propMeta = PROP_CATALOG[propKey];
          this.chaosRepo.addProp(guildId, userId, propKey, 1);
          reward = {
            kind: 'chaos_prop',
            isJackpot: false,
            propKey,
            summary: `${propMeta.emoji} 开出黑市道具 **【${propMeta.name}】× 1**，已放入黑市背包！`,
          };
        } else if (roll < 0.60 && this.socialPetRepo) {
          const activePet = this.socialPetRepo.getActivePet(guildId, userId);
          if (activePet) {
            const petXpGain = 120;
            const applied = applyPetXp(activePet, petXpGain);
            this.socialPetRepo.savePet(applied.updatedPet);
            reward = {
              kind: 'pet_xp',
              isJackpot: false,
              petName: applied.updatedPet.nickname,
              petXpGained: petXpGain,
              petLevelsGained: applied.levelsGained,
              summary: `🐾 出战宠物 **${applied.updatedPet.nickname}** 获得 **+${petXpGain} XP**${applied.levelsGained > 0 ? `（连升 ${applied.levelsGained} 级至 Lv.${applied.updatedPet.level}！）` : ''}！`,
            };
          } else {
            const prize = Math.max(1, Math.floor(finalPrice * 0.7));
            nextCoins += prize;
            reward = {
              kind: 'coins_refund',
              isJackpot: false,
              coinsDelta: prize,
              summary: `🪙 暂无出战宠物，折算返还 **+${prize}** ${meta.currencyName}！`,
            };
          }
        } else if (roll < 0.72) {
          const gain = randomIntInclusive(1, 3, rng);
          nextStat += gain;
          reward = {
            kind: 'stat_small',
            isJackpot: false,
            statDelta: gain,
            newStatValue: nextStat,
            summary: `📈 ${meta.statName}提升 **+${gain}** ${meta.statUnit}（现 **${nextStat}** ${meta.statUnit}）！`,
          };
        } else {
          const ratio = 0.25 + rng() * 0.55;
          const prize = Math.max(1, Math.floor(finalPrice * ratio));
          nextCoins += prize;
          reward = {
            kind: 'coins_refund',
            isJackpot: false,
            coinsDelta: prize,
            summary: `🪙 开出保底小金库，返还 **+${prize}** ${meta.currencyName}！`,
          };
        }

        this.profileRepo.save({
          ...profile,
          coins: nextCoins,
          statValue: nextStat,
        });

        return {
          ok: true,
          item,
          finalPrice,
          balance: nextCoins,
          grantRoleId: null,
          equippedTitle: null,
          addedInventory: null,
          mysteryBoxResult: reward,
        };
      }

      this.shopRepo.decrementStock(guildId, item.id);
      const nextCoins = profile.coins - finalPrice;

      if (item.type === 'role') {
        this.profileRepo.save({ ...profile, coins: nextCoins });
        return {
          ok: true,
          item,
          finalPrice,
          balance: nextCoins,
          grantRoleId: item.roleId,
          equippedTitle: null,
          addedInventory: null,
        };
      }

      if (item.type === 'title' && item.titleText) {
        const payload: TitlePayload = { titleText: item.titleText };
        const inv = this.shopRepo.addInventoryItem({
          guildId,
          userId,
          itemType: 'title',
          itemName: item.titleText,
          payloadJson: JSON.stringify(payload),
          quantity: 1,
          acquiredAt: nowMs,
        });
        this.profileRepo.save({
          ...profile,
          coins: nextCoins,
          equippedTitle: item.titleText,
        });
        return {
          ok: true,
          item,
          finalPrice,
          balance: nextCoins,
          grantRoleId: null,
          equippedTitle: item.titleText,
          addedInventory: inv,
        };
      }

      if (item.type === 'custom_title') {
        const inv = this.shopRepo.addInventoryItem({
          guildId,
          userId,
          itemType: 'custom_title',
          itemName: item.name,
          payloadJson: '{}',
          quantity: 1,
          acquiredAt: nowMs,
        });
        this.profileRepo.save({ ...profile, coins: nextCoins });
        return {
          ok: true,
          item,
          finalPrice,
          balance: nextCoins,
          grantRoleId: null,
          equippedTitle: null,
          addedInventory: inv,
          customTitleVoucher: true,
        };
      }

      const boostPayload: BoostPayload = {
        multiplier: item.boostMultiplier ?? 1.5,
        durationSec: item.boostDurationSec ?? 3600,
      };
      const inv = this.shopRepo.addInventoryItem({
        guildId,
        userId,
        itemType: 'xp_boost',
        itemName: item.name,
        payloadJson: JSON.stringify(boostPayload),
        quantity: 1,
        acquiredAt: nowMs,
      });
      this.profileRepo.save({ ...profile, coins: nextCoins });

      return {
        ok: true,
        item,
        finalPrice,
        balance: nextCoins,
        grantRoleId: null,
        equippedTitle: null,
        addedInventory: inv,
      };
    })();
  }

  buyCustomTitle(
    guildId: string,
    userId: string,
    itemId: number,
    rawTitle: string,
    nowMs = Date.now(),
  ): BuyResult {
    const cleanTitle = rawTitle.trim();
    if (cleanTitle.length < 1 || cleanTitle.length > 20) {
      return { ok: false, reason: 'invalid_title' };
    }

    return this.db.transaction((): BuyResult => {
      const item = this.shopRepo.getItemById(guildId, itemId);
      if (!item || item.type !== 'custom_title') {
        return { ok: false, reason: 'not_found' };
      }
      if (item.stock !== null && item.stock <= 0) {
        return { ok: false, reason: 'out_of_stock' };
      }

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      const finalPrice = this.computeFinalPrice(guildId, userId, item.price, nowMs);
      if (profile.coins < finalPrice) {
        return { ok: false, reason: 'insufficient_funds', finalPrice };
      }

      const owned = this.shopRepo.findInventoryByTypeAndName(guildId, userId, 'title', cleanTitle);
      if (owned) {
        return { ok: false, reason: 'already_owned' };
      }

      this.shopRepo.decrementStock(guildId, item.id);
      const nextCoins = profile.coins - finalPrice;
      const payload: TitlePayload = { titleText: cleanTitle };
      const inv = this.shopRepo.addInventoryItem({
        guildId,
        userId,
        itemType: 'title',
        itemName: cleanTitle,
        payloadJson: JSON.stringify(payload),
        quantity: 1,
        acquiredAt: nowMs,
      });
      this.profileRepo.save({
        ...profile,
        coins: nextCoins,
        equippedTitle: cleanTitle,
      });

      return {
        ok: true,
        item,
        finalPrice,
        balance: nextCoins,
        grantRoleId: null,
        equippedTitle: cleanTitle,
        addedInventory: inv,
      };
    })();
  }

  redeemCustomTitleVoucher(
    guildId: string,
    userId: string,
    inventoryId: number,
    rawTitle: string,
    nowMs = Date.now(),
  ): UseInventoryResult {
    const cleanTitle = rawTitle.trim();
    if (cleanTitle.length < 1 || cleanTitle.length > 20) {
      return { ok: false, reason: 'invalid_title' };
    }

    return this.db.transaction((): UseInventoryResult => {
      const inv = this.shopRepo.getInventoryItem(guildId, userId, inventoryId);
      if (!inv || inv.quantity <= 0 || inv.itemType !== 'custom_title') {
        return { ok: false, reason: 'not_found' };
      }

      const owned = this.shopRepo.findInventoryByTypeAndName(guildId, userId, 'title', cleanTitle);
      if (owned) {
        return { ok: false, reason: 'already_owned' };
      }

      const consumed = this.shopRepo.consumeInventoryItem(guildId, userId, inv.id);
      if (!consumed) {
        return { ok: false, reason: 'not_found' };
      }

      const payload: TitlePayload = { titleText: cleanTitle };
      const titleInv = this.shopRepo.addInventoryItem({
        guildId,
        userId,
        itemType: 'title',
        itemName: cleanTitle,
        payloadJson: JSON.stringify(payload),
        quantity: 1,
        acquiredAt: nowMs,
      });
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      this.profileRepo.save({
        ...profile,
        equippedTitle: cleanTitle,
      });

      return {
        ok: true,
        item: titleInv,
        equippedTitle: cleanTitle,
      };
    })();
  }

  refundRolePurchase(guildId: string, userId: string, itemId: number, amount: number): void {
    this.db.transaction((): void => {
      this.profileRepo.addCoins(guildId, userId, amount);
      this.shopRepo.incrementStock(guildId, itemId);
    })();
  }

  useInventoryItem(
    guildId: string,
    userId: string,
    inventoryId: number,
    nowMs = Date.now(),
  ): UseInventoryResult {
    return this.db.transaction((): UseInventoryResult => {
      const inv = this.shopRepo.getInventoryItem(guildId, userId, inventoryId);
      if (!inv || inv.quantity <= 0) {
        return { ok: false, reason: 'not_found' };
      }

      const profile = this.profileRepo.getOrCreate(guildId, userId);

      if (inv.itemType === 'title') {
        const obj = parseJsonObject(inv.payloadJson);
        const titleText = typeof obj.titleText === 'string' ? obj.titleText : inv.itemName;
        this.profileRepo.save({ ...profile, equippedTitle: titleText });
        return { ok: true, item: inv, equippedTitle: titleText };
      }

      if (inv.itemType === 'xp_boost') {
        const obj = parseJsonObject(inv.payloadJson);
        const multiplier =
          typeof obj.multiplier === 'number' && obj.multiplier > 1 ? obj.multiplier : 1.5;
        const durationSec =
          typeof obj.durationSec === 'number' && obj.durationSec > 0 ? obj.durationSec : 3600;
        const durationMs = durationSec * 1000;

        const consumed = this.shopRepo.consumeInventoryItem(guildId, userId, inv.id);
        if (!consumed) {
          return { ok: false, reason: 'not_found' };
        }

        const hasActive = profile.xpBoostExpiresAt > nowMs && profile.xpBoostMultiplier > 1;
        let nextMultiplier = multiplier;
        let nextExpiresAt = nowMs + durationMs;

        if (hasActive) {
          if (profile.xpBoostMultiplier === multiplier) {
            nextExpiresAt = profile.xpBoostExpiresAt + durationMs;
          } else if (profile.xpBoostMultiplier > multiplier) {
            nextMultiplier = profile.xpBoostMultiplier;
            nextExpiresAt = profile.xpBoostExpiresAt + durationMs;
          }
        }

        this.profileRepo.save({
          ...profile,
          xpBoostMultiplier: nextMultiplier,
          xpBoostExpiresAt: nextExpiresAt,
        });

        return {
          ok: true,
          item: inv,
          boostMultiplier: nextMultiplier,
          boostExpiresAt: nextExpiresAt,
        };
      }

      return { ok: false, reason: 'unsupported_item' };
    })();
  }
}
