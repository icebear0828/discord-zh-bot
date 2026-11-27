import { SHOP_MYSTERY_BOX_MIN_PRICE } from '../../config/economyConstants.js';
import type { RpgItemRarity } from '../../db/repositories/rpgRepo.js';
import type { ShopItem, ShopRepo } from '../../db/repositories/shopRepo.js';
import {
  DEFAULT_CREDIT_BOOST_DAILY_LIMIT,
  DEFAULT_STAT_BOOST_DAILY_LIMIT,
  type CpAffinityPayload,
  type CreditBoostPayload,
  type PetXpPayload,
  type RpgSupplyPayload,
  type StatBoostPayload,
} from './shopTypesAndPayloads.js';

export function createRoleItemOp(
  shopRepo: ShopRepo,
  input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    roleId: string;
    stock: number | null;
    requiredRoleId?: string | null;
  },
): ShopItem {
  const reqRole = input.requiredRoleId?.trim() || null;
  const payloadJson = reqRole ? JSON.stringify({ requiredRoleId: reqRole }) : '{}';
  return shopRepo.createItem({
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
    payloadJson,
  });
}

export function createTitleItemOp(
  shopRepo: ShopRepo,
  input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    titleText: string;
    stock: number | null;
  },
): ShopItem {
  return shopRepo.createItem({
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

export function createBoostItemOp(
  shopRepo: ShopRepo,
  input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    boostMultiplier: number;
    boostDurationSec: number;
    stock: number | null;
  },
): ShopItem {
  return shopRepo.createItem({
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

export function createStatBoostItemOp(
  shopRepo: ShopRepo,
  input: {
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
  },
): ShopItem {
  const minGain = Math.max(1, Math.floor(input.minGain));
  const maxGain = Math.max(minGain, Math.floor(input.maxGain));
  const payload: StatBoostPayload = {
    minGain,
    maxGain,
    dailyLimit: Math.max(1, Math.floor(input.dailyLimit ?? DEFAULT_STAT_BOOST_DAILY_LIMIT)),
    critChance: Math.max(0, Math.min(1, input.critChance ?? 0.1)),
    backfireChance: Math.max(0, Math.min(1, input.backfireChance ?? 0.1)),
  };
  return shopRepo.createItem({
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

export function createCustomTitleItemOp(
  shopRepo: ShopRepo,
  input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    stock: number | null;
  },
): ShopItem {
  return shopRepo.createItem({
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

export function createPetXpItemOp(
  shopRepo: ShopRepo,
  input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    petXp: number;
    stock: number | null;
  },
): ShopItem {
  const payload: PetXpPayload = { petXp: Math.max(1, Math.floor(input.petXp)) };
  return shopRepo.createItem({
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

export function createMysteryBoxItemOp(
  shopRepo: ShopRepo,
  input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    stock: number | null;
  },
): ShopItem {
  const safePrice = Math.max(SHOP_MYSTERY_BOX_MIN_PRICE, Math.floor(input.price));
  return shopRepo.createItem({
    guildId: input.guildId,
    name: input.name,
    description: input.description,
    type: 'mystery_box',
    price: safePrice,
    roleId: null,
    titleText: null,
    boostMultiplier: null,
    boostDurationSec: null,
    stock: input.stock,
    payloadJson: '{}',
  });
}

export function createCreditBoostItemOp(
  shopRepo: ShopRepo,
  input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    creditGain: number;
    dailyLimit?: number;
    stock: number | null;
  },
): ShopItem {
  const payload: CreditBoostPayload = {
    creditGain: Math.max(1, Math.floor(input.creditGain)),
    dailyLimit: Math.max(1, Math.floor(input.dailyLimit ?? DEFAULT_CREDIT_BOOST_DAILY_LIMIT)),
  };
  return shopRepo.createItem({
    guildId: input.guildId,
    name: input.name,
    description: input.description,
    type: 'credit_boost',
    price: Math.max(0, Math.floor(input.price)),
    roleId: null,
    titleText: null,
    boostMultiplier: null,
    boostDurationSec: null,
    stock: input.stock,
    payloadJson: JSON.stringify(payload),
  });
}

export function createRpgSupplyItemOp(
  shopRepo: ShopRepo,
  input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    staminaGain: number;
    lootBox: boolean;
    minRarity?: RpgItemRarity;
    stock: number | null;
  },
): ShopItem {
  const payload: RpgSupplyPayload = {
    staminaGain: Math.max(0, Math.floor(input.staminaGain)),
    lootBox: Boolean(input.lootBox),
    minRarity: input.minRarity ?? 'rare',
  };
  return shopRepo.createItem({
    guildId: input.guildId,
    name: input.name,
    description: input.description,
    type: 'rpg_supply',
    price: Math.max(0, Math.floor(input.price)),
    roleId: null,
    titleText: null,
    boostMultiplier: null,
    boostDurationSec: null,
    stock: input.stock,
    payloadJson: JSON.stringify(payload),
  });
}

export function createCpAffinityItemOp(
  shopRepo: ShopRepo,
  input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    affinityGain: number;
    stock: number | null;
  },
): ShopItem {
  const payload: CpAffinityPayload = {
    affinityGain: Math.max(1, Math.floor(input.affinityGain)),
  };
  return shopRepo.createItem({
    guildId: input.guildId,
    name: input.name,
    description: input.description,
    type: 'cp_affinity',
    price: Math.max(0, Math.floor(input.price)),
    roleId: null,
    titleText: null,
    boostMultiplier: null,
    boostDurationSec: null,
    stock: input.stock,
    payloadJson: JSON.stringify(payload),
  });
}
