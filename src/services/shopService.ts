import type Database from 'better-sqlite3';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { RpgItemRarity } from '../db/repositories/rpgRepo.js';
import type { InventoryItem, ShopItem, ShopRepo } from '../db/repositories/shopRepo.js';
import {
  createBoostItemOp,
  createCpAffinityItemOp,
  createCreditBoostItemOp,
  createCustomTitleItemOp,
  createMysteryBoxItemOp,
  createPetXpItemOp,
  createRoleItemOp,
  createRpgSupplyItemOp,
  createStatBoostItemOp,
  createTitleItemOp,
} from './shop/shopAdminCatalogOps.js';
import {
  buyCustomTitleOp,
  buyItemOp,
  refundRolePurchaseOp,
} from './shop/shopBuyOps.js';
import {
  getStatBoostRemainingTodayOp,
  redeemCustomTitleVoucherOp,
  useInventoryItemOp,
} from './shop/shopInventoryUseOps.js';
import {
  DEFAULT_CREDIT_BOOST_DAILY_LIMIT,
  DEFAULT_STAT_BOOST_DAILY_LIMIT,
  parseCpAffinityPayload,
  parseCreditBoostPayload,
  parsePetXpPayload,
  parseRolePayload,
  parseRpgSupplyPayload,
  parseStatBoostPayload,
  type BuyFailureReason,
  type BuyResult,
  type CpAffinityPayload,
  type CpAffinityResult,
  type CreditBoostPayload,
  type CreditBoostResult,
  type MysteryBoxReward,
  type PetXpPayload,
  type PetXpResult,
  type RoleItemPayload,
  type RpgSupplyPayload,
  type RpgSupplyResult,
  type ShopOpsContext,
  type ShopServiceDeps,
  type StatBoostOutcome,
  type StatBoostPayload,
  type StatBoostResult,
  type UseInventoryResult,
} from './shop/shopTypesAndPayloads.js';

export {
  DEFAULT_CREDIT_BOOST_DAILY_LIMIT,
  DEFAULT_STAT_BOOST_DAILY_LIMIT,
  parseCpAffinityPayload,
  parseCreditBoostPayload,
  parsePetXpPayload,
  parseRolePayload,
  parseRpgSupplyPayload,
  parseStatBoostPayload,
};
export type {
  BuyFailureReason,
  BuyResult,
  CpAffinityPayload,
  CpAffinityResult,
  CreditBoostPayload,
  CreditBoostResult,
  MysteryBoxReward,
  PetXpPayload,
  PetXpResult,
  RoleItemPayload,
  RpgSupplyPayload,
  RpgSupplyResult,
  ShopServiceDeps,
  StatBoostOutcome,
  StatBoostPayload,
  StatBoostResult,
  UseInventoryResult,
};

export class ShopService {
  private readonly opsCtx: ShopOpsContext;

  constructor(
    private readonly db: Database.Database,
    private readonly profileRepo: ProfileRepo,
    private readonly shopRepo: ShopRepo,
    deps: ShopServiceDeps = {},
  ) {
    this.opsCtx = {
      db: this.db,
      profileRepo: this.profileRepo,
      shopRepo: this.shopRepo,
      guildConfigRepo: deps.guildConfigRepo,
      chaosRepo: deps.chaosRepo,
      socialPetRepo: deps.socialPetRepo,
      creditLoanService: deps.creditLoanService,
      rpgRepo: deps.rpgRepo,
      timezone: deps.timezone ?? 'Asia/Shanghai',
    };
  }

  createRoleItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    roleId: string;
    stock: number | null;
    requiredRoleId?: string | null;
  }): ShopItem {
    return createRoleItemOp(this.shopRepo, input);
  }

  createTitleItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    titleText: string;
    stock: number | null;
  }): ShopItem {
    return createTitleItemOp(this.shopRepo, input);
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
    return createBoostItemOp(this.shopRepo, input);
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
    return createStatBoostItemOp(this.shopRepo, input);
  }

  createCustomTitleItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    stock: number | null;
  }): ShopItem {
    return createCustomTitleItemOp(this.shopRepo, input);
  }

  createPetXpItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    petXp: number;
    stock: number | null;
  }): ShopItem {
    return createPetXpItemOp(this.shopRepo, input);
  }

  createMysteryBoxItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    stock: number | null;
  }): ShopItem {
    return createMysteryBoxItemOp(this.shopRepo, input);
  }

  createCreditBoostItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    creditGain: number;
    dailyLimit?: number;
    stock: number | null;
  }): ShopItem {
    return createCreditBoostItemOp(this.shopRepo, input);
  }

  createRpgSupplyItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    staminaGain: number;
    lootBox: boolean;
    minRarity?: RpgItemRarity;
    stock: number | null;
  }): ShopItem {
    return createRpgSupplyItemOp(this.shopRepo, input);
  }

  createCpAffinityItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    affinityGain: number;
    stock: number | null;
  }): ShopItem {
    return createCpAffinityItemOp(this.shopRepo, input);
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
    return getStatBoostRemainingTodayOp(this.opsCtx, guildId, userId, nowMs, dailyLimit);
  }

  buyItem(
    guildId: string,
    userId: string,
    itemId: number,
    nowMs = Date.now(),
    rng: () => number = Math.random,
    ownedRoleIds?: ReadonlySet<string>,
  ): BuyResult {
    return buyItemOp(this.opsCtx, guildId, userId, itemId, nowMs, rng, ownedRoleIds);
  }

  buyCustomTitle(
    guildId: string,
    userId: string,
    itemId: number,
    rawTitle: string,
    nowMs = Date.now(),
  ): BuyResult {
    return buyCustomTitleOp(this.opsCtx, guildId, userId, itemId, rawTitle, nowMs);
  }

  redeemCustomTitleVoucher(
    guildId: string,
    userId: string,
    inventoryId: number,
    rawTitle: string,
    nowMs = Date.now(),
  ): UseInventoryResult {
    return redeemCustomTitleVoucherOp(this.opsCtx, guildId, userId, inventoryId, rawTitle, nowMs);
  }

  refundRolePurchase(guildId: string, userId: string, itemId: number, amount: number): void {
    refundRolePurchaseOp(this.opsCtx, guildId, userId, itemId, amount);
  }

  useInventoryItem(
    guildId: string,
    userId: string,
    inventoryId: number,
    nowMs = Date.now(),
  ): UseInventoryResult {
    return useInventoryItemOp(this.opsCtx, guildId, userId, inventoryId, nowMs);
  }
}
