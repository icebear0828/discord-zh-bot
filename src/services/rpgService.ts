import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type {
  RpgCharacter,
  RpgClassKey,
  RpgItem,
  RpgItemRarity,
  RpgItemSlot,
  RpgRepo,
  RpgTrial,
} from '../db/repositories/rpgRepo.js';
import type { PetRarity, SocialPetRepo, UserPet } from '../db/repositories/socialPetRepo.js';
import { getDateKey } from './economyService.js';
import { PET_SPECIES_MAP } from './socialPetService.js';

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

const STAGE_ZH_LABELS: readonly string[] = [
  '一重',
  '二重',
  '三重',
  '四重',
  '五重',
  '六重',
  '七重',
  '八重',
  '九重',
];

export interface RpgClassDef {
  key: RpgClassKey;
  name: string;
  emoji: string;
  description: string;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseCritBp: number;
  baseDodgeBp: number;
  hpPerLevel: number;
  atkPerLevel: number;
  defPerLevel: number;
  critBpPerLevel: number;
  skillName: string;
  skillDescription: string;
}

export const RPG_CLASSES: readonly RpgClassDef[] = [
  {
    key: 'warrior',
    name: '圣殿战士',
    emoji: '⚔️',
    description: '高血量高防御，重甲破军稳健压制',
    baseHp: 170,
    baseAtk: 24,
    baseDef: 14,
    baseCritBp: 1000,
    baseDodgeBp: 500,
    hpPerLevel: 26,
    atkPerLevel: 4.5,
    defPerLevel: 2.8,
    critBpPerLevel: 25,
    skillName: '破军重斩',
    skillDescription: '重甲冲锋破防，讨伐首领稳健增伤',
  },
  {
    key: 'mage',
    name: '奥术法师',
    emoji: '🔮',
    description: '极致法伤高暴击，陨星奥术焚灭强敌',
    baseHp: 115,
    baseAtk: 34,
    baseDef: 7,
    baseCritBp: 1600,
    baseDodgeBp: 700,
    hpPerLevel: 16,
    atkPerLevel: 6.2,
    defPerLevel: 1.5,
    critBpPerLevel: 45,
    skillName: '陨星火球',
    skillDescription: '高额奥术暴击爆发，快速收割高阶猎场',
  },
  {
    key: 'ranger',
    name: '暗影游侠',
    emoji: '🏹',
    description: '高暴击高闪避，穿云连射双段收割',
    baseHp: 130,
    baseAtk: 29,
    baseDef: 9,
    baseCritBp: 2000,
    baseDodgeBp: 1500,
    hpPerLevel: 19,
    atkPerLevel: 5.4,
    defPerLevel: 1.8,
    critBpPerLevel: 55,
    skillName: '穿云连射',
    skillDescription: '双段狙击暴击率拉满，讨伐评分稳定拔高',
  },
  {
    key: 'paladin',
    name: '辉光圣骑士',
    emoji: '🛡️',
    description: '攻守均衡强续航，圣光裁决攻防一体',
    baseHp: 155,
    baseAtk: 25,
    baseDef: 12,
    baseCritBp: 1200,
    baseDodgeBp: 600,
    hpPerLevel: 23,
    atkPerLevel: 4.8,
    defPerLevel: 2.4,
    critBpPerLevel: 30,
    skillName: '圣光裁决',
    skillDescription: '圣光加护攻防均衡，全阶位适应力极强',
  },
];

export const RPG_CLASS_MAP: ReadonlyMap<RpgClassKey, RpgClassDef> = new Map(
  RPG_CLASSES.map((c) => [c.key, c]),
);

export interface RpgTierDef {
  tier: number;
  name: string;
  emoji: string;
  zoneName: string;
  zoneEmoji: string;
  bossName: string;
  bossEmoji: string;
  idleXpPerHour: number;
  idleCoinsPerHour: number;
  breakthroughBasePct: number;
}

export const RPG_TIERS: readonly RpgTierDef[] = [
  {
    tier: 1,
    name: '见习阶',
    emoji: '🌱',
    zoneName: '迷雾哨林',
    zoneEmoji: '🌲',
    bossName: '哥布林督军·格鲁克',
    bossEmoji: '👺',
    idleXpPerHour: 120,
    idleCoinsPerHour: 600,
    breakthroughBasePct: 85,
  },
  {
    tier: 2,
    name: '黑铁阶',
    emoji: '🪨',
    zoneName: '腐朽亡灵墓穴',
    zoneEmoji: '🦴',
    bossName: '骸骨领主·莫德雷德',
    bossEmoji: '💀',
    idleXpPerHour: 260,
    idleCoinsPerHour: 1200,
    breakthroughBasePct: 75,
  },
  {
    tier: 3,
    name: '青铜阶',
    emoji: '🥉',
    zoneName: '猩红血族古堡',
    zoneEmoji: '🏰',
    bossName: '血族伯爵·弗拉德',
    bossEmoji: '🧛',
    idleXpPerHour: 520,
    idleCoinsPerHour: 2200,
    breakthroughBasePct: 65,
  },
  {
    tier: 4,
    name: '白银阶',
    emoji: '🥈',
    zoneName: '矮人地心熔炉',
    zoneEmoji: '🌋',
    bossName: '熔岩魔像·卡兹丹',
    bossEmoji: '🔥',
    idleXpPerHour: 980,
    idleCoinsPerHour: 3800,
    breakthroughBasePct: 55,
  },
  {
    tier: 5,
    name: '黄金阶',
    emoji: '🥇',
    zoneName: '极北霜火龙巢',
    zoneEmoji: '🐉',
    bossName: '双头古龙·提亚马特',
    bossEmoji: '🐲',
    idleXpPerHour: 1750,
    idleCoinsPerHour: 6200,
    breakthroughBasePct: 45,
  },
  {
    tier: 6,
    name: '秘银阶',
    emoji: '💠',
    zoneName: '星界奥术高塔',
    zoneEmoji: '🔮',
    bossName: '虚空大魔导·梅林',
    bossEmoji: '👁️',
    idleXpPerHour: 3000,
    idleCoinsPerHour: 9800,
    breakthroughBasePct: 38,
  },
  {
    tier: 7,
    name: '史诗阶',
    emoji: '🔮',
    zoneName: '沉没泰坦神殿',
    zoneEmoji: '🏛️',
    bossName: '雷霆泰坦·克洛诺斯',
    bossEmoji: '⚡',
    idleXpPerHour: 5000,
    idleCoinsPerHour: 15000,
    breakthroughBasePct: 30,
  },
  {
    tier: 8,
    name: '传说阶',
    emoji: '👑',
    zoneName: '无尽深渊王座',
    zoneEmoji: '🌌',
    bossName: '堕落魔神·阿撒托斯',
    bossEmoji: '🔱',
    idleXpPerHour: 8200,
    idleCoinsPerHour: 23000,
    breakthroughBasePct: 24,
  },
  {
    tier: 9,
    name: '半神阶',
    emoji: '🔥',
    zoneName: '诸神黄昏裂隙',
    zoneEmoji: '☄️',
    bossName: '噬界魔狼·芬里尔',
    bossEmoji: '🐍',
    idleXpPerHour: 13000,
    idleCoinsPerHour: 35000,
    breakthroughBasePct: 18,
  },
  {
    tier: 10,
    name: '神座阶',
    emoji: '☀️',
    zoneName: '永恒创世星域',
    zoneEmoji: '✨',
    bossName: '混沌原初之影',
    bossEmoji: '👑',
    idleXpPerHour: 20000,
    idleCoinsPerHour: 52000,
    breakthroughBasePct: 0,
  },
];

export const RPG_TIER_MAP: ReadonlyMap<number, RpgTierDef> = new Map(
  RPG_TIERS.map((t) => [t.tier, t]),
);

export interface RpgRealmInfo {
  level: number;
  tier: number;
  stage: number;
  stageZh: string;
  tierDef: RpgTierDef;
  nextTierDef: RpgTierDef | null;
  fullLabel: string;
}

export function getRpgRealmInfo(level: number): RpgRealmInfo {
  const safeLevel = Math.max(1, Math.min(MAX_RPG_LEVEL, Math.floor(level)));
  const tier = Math.min(RPG_TIERS.length, Math.floor((safeLevel - 1) / STAGES_PER_TIER) + 1);
  const stage = ((safeLevel - 1) % STAGES_PER_TIER) + 1;
  const stageZh = STAGE_ZH_LABELS[stage - 1] ?? `${stage}重`;
  const tierDef = RPG_TIER_MAP.get(tier) ?? RPG_TIERS[0]!;
  const nextTierDef = RPG_TIER_MAP.get(tier + 1) ?? null;
  return {
    level: safeLevel,
    tier,
    stage,
    stageZh,
    tierDef,
    nextTierDef,
    fullLabel: `${tierDef.emoji} ${tierDef.name}·${stageZh}`,
  };
}

export function xpNeededForRpgLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  return Math.floor(100 * safeLevel + 35 * safeLevel * (safeLevel - 1));
}

export function isAtBreakthroughGate(level: number, xp: number): boolean {
  if (level >= MAX_RPG_LEVEL) return false;
  if (level % STAGES_PER_TIER !== 0) return false;
  return xp >= xpNeededForRpgLevel(level);
}

export function applyCharacterXp(
  character: RpgCharacter,
  gainXp: number,
): { updated: RpgCharacter; levelsGained: number; hitGate: boolean } {
  let level = Math.max(1, Math.min(MAX_RPG_LEVEL, Math.floor(character.level)));
  let xp = Math.max(0, Math.floor(character.xp)) + Math.max(0, Math.floor(gainXp));
  let levelsGained = 0;

  while (level < MAX_RPG_LEVEL) {
    const need = xpNeededForRpgLevel(level);
    if (level % STAGES_PER_TIER === 0) {
      xp = Math.min(xp, need * 3);
      break;
    }
    if (xp < need) {
      break;
    }
    xp -= need;
    level += 1;
    levelsGained += 1;
  }

  if (level >= MAX_RPG_LEVEL) {
    level = MAX_RPG_LEVEL;
    xp = Math.min(xp, xpNeededForRpgLevel(MAX_RPG_LEVEL));
  }

  return {
    updated: { ...character, level, xp },
    levelsGained,
    hitGate: isAtBreakthroughGate(level, xp),
  };
}

export const RARITY_ORDER: Record<RpgItemRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

export const RARITY_META: Record<RpgItemRarity, { label: string; emoji: string }> = {
  common: { label: '普通', emoji: '⚪' },
  uncommon: { label: '精良', emoji: '🟢' },
  rare: { label: '稀有', emoji: '🔵' },
  epic: { label: '史诗', emoji: '🟣' },
  legendary: { label: '传说', emoji: '🟠' },
};

const RARITY_STAT_MULT: Record<RpgItemRarity, number> = {
  common: 1.0,
  uncommon: 1.35,
  rare: 1.8,
  epic: 2.4,
  legendary: 3.3,
};

const RARITY_ENHANCE_COST_MULT: Record<RpgItemRarity, number> = {
  common: 1.0,
  uncommon: 1.4,
  rare: 2.0,
  epic: 3.0,
  legendary: 4.5,
};

const RARITY_SALVAGE_BASE: Record<RpgItemRarity, number> = {
  common: 300,
  uncommon: 800,
  rare: 2000,
  epic: 5500,
  legendary: 15000,
};

const ENHANCE_SUCCESS_RATES: readonly number[] = [
  1.0, // +0 -> +1
  1.0, // +1 -> +2
  1.0, // +2 -> +3
  0.9, // +3 -> +4
  0.8, // +4 -> +5
  0.7, // +5 -> +6
  0.6, // +6 -> +7
  0.5, // +7 -> +8
  0.4, // +8 -> +9
  0.3, // +9 -> +10
];

const PET_RARITY_SYNERGY_MULT: Record<PetRarity, number> = {
  N: 1.0,
  R: 1.15,
  SR: 1.35,
  SSR: 1.6,
};

const PET_BREAKTHROUGH_BONUS_PCT: Record<PetRarity, number> = {
  N: 2,
  R: 4,
  SR: 7,
  SSR: 10,
};

const ITEM_NAMES: Record<RpgItemSlot, Record<RpgItemRarity, readonly string[]>> = {
  weapon: {
    common: ['铁制短剑', '橡木法杖', '猎人木弓'],
    uncommon: ['精钢长剑', '秘银魔杖', '复合长弓'],
    rare: ['圣殿巨剑', '星辉权杖', '疾风猎弓'],
    epic: ['龙炎魔刃', '虚空星杖', '暗影追魂弓'],
    legendary: ['晨曦裁决者', '阿卡纳永恒法典', '弑神星陨弓'],
  },
  armor: {
    common: ['皮质轻甲', '粗布法袍', '锁链护胸'],
    uncommon: ['精钢锁甲', '符文法袍', '猎风皮铠'],
    rare: ['银月板甲', '秘法圣袍', '影步轻铠'],
    epic: ['龙鳞圣铠', '星穹大魔导袍', '夜枭幽影甲'],
    legendary: ['永恒神佑战甲', '深渊星织圣袍', '不灭圣殿龙铠'],
  },
  accessory: {
    common: ['铜制指环', '幸运四叶草', '冒险者徽章'],
    uncommon: ['翠玉护符', '银质战戒', '旅人怀表'],
    rare: ['星辉吊坠', '狮心勋章', '圣银念珠'],
    epic: ['猩红血戒', '古龙之眼', '秘银龙牙坠'],
    legendary: ['深渊星辰之心', '神王传承之戒', '创世圣辉护符'],
  },
};

export interface EffectiveItemStats {
  hp: number;
  atk: number;
  def: number;
  critBp: number;
}

export function computeItemEffectiveStats(
  item: Pick<RpgItem, 'baseHp' | 'baseAtk' | 'baseDef' | 'baseCritBp' | 'enhanceLevel'>,
): EffectiveItemStats {
  const mult = 1 + Math.max(0, item.enhanceLevel) * 0.15;
  return {
    hp: Math.round(item.baseHp * mult),
    atk: Math.round(item.baseAtk * mult),
    def: Math.round(item.baseDef * mult),
    critBp: Math.round(item.baseCritBp * mult),
  };
}

const RARITY_SCORE_BONUS: Record<RpgItemRarity, number> = {
  common: 0,
  uncommon: 8,
  rare: 18,
  epic: 32,
  legendary: 50,
};

export function computeItemScore(
  item: Pick<RpgItem, 'rarity' | 'baseHp' | 'baseAtk' | 'baseDef' | 'baseCritBp' | 'enhanceLevel'>,
): number {
  const eff = computeItemEffectiveStats(item);
  const raw =
    eff.hp * 0.6 +
    eff.atk * 4 +
    eff.def * 3 +
    (eff.critBp / 100) * 5 +
    RARITY_SCORE_BONUS[item.rarity];
  return Math.round(raw * 100) / 100;
}

export function getEnhanceInfo(
  item: Pick<RpgItem, 'rarity' | 'enhanceLevel'>,
): { nextLevel: number; cost: number; successRate: number } | null {
  if (item.enhanceLevel >= MAX_ENHANCE_LEVEL) {
    return null;
  }
  const lvl = Math.max(0, item.enhanceLevel);
  const baseCost = 800 + lvl * 700 + lvl * lvl * 250;
  const cost = Math.round(baseCost * RARITY_ENHANCE_COST_MULT[item.rarity]);
  const successRate = ENHANCE_SUCCESS_RATES[lvl] ?? 0.3;
  return { nextLevel: lvl + 1, cost, successRate };
}

export function getSalvageValue(item: Pick<RpgItem, 'rarity' | 'enhanceLevel'>): number {
  const base = RARITY_SALVAGE_BASE[item.rarity];
  return base + Math.max(0, item.enhanceLevel) * Math.round(base * 0.25);
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
}

export type ChooseClassResult =
  | {
      ok: true;
      character: RpgCharacter;
      cost: number;
      balance: number;
      isFirstSelection: boolean;
    }
  | { ok: false; reason: 'same_class' | 'insufficient_funds' | 'pending_trial'; cost?: number };

export type BuyStaminaPotionResult =
  | {
      ok: true;
      character: RpgCharacter;
      cost: number;
      balance: number;
      buysRemaining: number;
    }
  | {
      ok: false;
      reason: 'daily_limit_reached' | 'insufficient_funds';
      cost?: number;
      dailyLimit?: number;
    };

export type BuyAlchemyItemResult =
  | {
      ok: true;
      kind: 'pill' | 'elixir';
      character: RpgCharacter;
      cost: number;
      balance: number;
      buysRemaining: number;
    }
  | {
      ok: false;
      reason: 'daily_limit_reached' | 'insufficient_funds';
      cost?: number;
      dailyLimit?: number;
    };

export type HealInjuryResult =
  | {
      ok: true;
      character: RpgCharacter;
      cost: number;
      balance: number;
    }
  | {
      ok: false;
      reason: 'not_injured' | 'insufficient_funds';
      cost?: number;
    };

export type ConfigureTrialLoadoutResult =
  | {
      ok: true;
      character: RpgCharacter;
    }
  | {
      ok: false;
      reason: 'no_guard_elixir';
    };

export type EquipItemResult =
  | { ok: true; item: RpgItem; unequippedItem: RpgItem | null; stats: CombatStats }
  | { ok: false; reason: 'not_found' | 'already_equipped' };

export type UnequipItemResult =
  | { ok: true; item: RpgItem; stats: CombatStats }
  | { ok: false; reason: 'not_found' | 'not_equipped' };

export type EnhanceItemResult =
  | {
      ok: true;
      success: boolean;
      item: RpgItem;
      cost: number;
      balance: number;
      successRate: number;
    }
  | {
      ok: false;
      reason: 'not_found' | 'max_enhance_level' | 'insufficient_funds';
      cost?: number;
    };

export type SalvageItemResult =
  | { ok: true; salvagedItem: RpgItem; coinsEarned: number; balance: number }
  | { ok: false; reason: 'not_found' | 'item_equipped' };

export interface EquipBestGearChange {
  slot: RpgItemSlot;
  item: RpgItem;
  previousItem?: RpgItem;
}

export type EquipBestGearResult =
  | {
      ok: true;
      changed: EquipBestGearChange[];
      unchangedCount: number;
      stats: RpgCombatStats;
    }
  | { ok: false; reason: 'no_items' };

export type BulkSalvageItemsResult =
  | {
      ok: true;
      salvagedCount: number;
      totalCoins: number;
      balance: number;
      byRarity: Partial<Record<RpgItemRarity, number>>;
    }
  | { ok: false; reason: 'nothing_to_salvage' };

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
      adventures: string[];
      character: RpgCharacter;
      balance: number;
    }
  | {
      ok: false;
      reason: 'no_class_selected' | 'too_soon';
      waitSeconds?: number;
    };

export type RaidBossResult =
  | {
      ok: true;
      runsExecuted: number;
      rating: 'S' | 'A' | 'B';
      tierDef: RpgTierDef;
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
      character: RpgCharacter;
      balance: number;
    }
  | {
      ok: false;
      reason: 'no_class_selected' | 'insufficient_stamina';
    };

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
  | {
      ok: false;
      reason: 'no_class_selected' | 'at_max_tier' | 'not_at_gate' | 'pending_trial_exists';
    };

export type StartPublicTrialResult =
  | {
      ok: true;
      trial: RpgTrial;
      character: RpgCharacter;
      preview: BreakthroughPreview;
    }
  | {
      ok: false;
      reason: 'no_class_selected' | 'at_max_tier' | 'not_at_gate' | 'pending_trial_exists';
    };

export type InteractPublicTrialResult =
  | {
      ok: true;
      trial: RpgTrial;
      currentRatePct: number;
      mode: 'help' | 'jeer';
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'already_resolved'
        | 'own_trial'
        | 'already_joined'
        | 'supporters_full'
        | 'saboteurs_full';
    };

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
  | {
      ok: false;
      reason: 'not_found' | 'already_resolved' | 'not_owner';
    };

export interface RpgServiceOptions {
  timezone?: string;
  config?: Partial<RpgConfig>;
  guildConfigRepo?: GuildConfigRepo;
  socialPetRepo?: SocialPetRepo;
  onCoinsEarned?: (
    guildId: string,
    userId: string,
    grossCoins: number,
    source: string,
    nowMs: number,
  ) => { garnished: number; net: number };
  onCreditChange?: (
    guildId: string,
    userId: string,
    delta: number,
    reason: string,
    nowMs: number,
  ) => void;
  getCreditScore?: (guildId: string, userId: string) => number;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999999, Math.max(0, value));
}

function pickFrom<T>(list: readonly T[], rng: () => number): T {
  const idx = Math.min(list.length - 1, Math.floor(clampUnit(rng()) * list.length));
  return list[idx]!;
}

function computePetSynergy(pet: UserPet): PetSynergyInfo {
  const mult = PET_RARITY_SYNERGY_MULT[pet.rarity];
  const species = PET_SPECIES_MAP.get(pet.speciesKey);
  return {
    petId: pet.id,
    nickname: pet.nickname,
    emoji: species?.emoji ?? '🐾',
    rarity: pet.rarity,
    level: pet.level,
    bonusHp: Math.max(10, Math.round(pet.hp * 0.35 * mult)),
    bonusAtk: Math.max(3, Math.round(pet.atk * 0.45 * mult)),
    bonusCritBp: Math.min(1200, Math.round(pet.critRate * 10000 * 0.25 * mult)),
    assistChance: Math.min(0.65, Number((0.28 + (mult - 1) * 0.25 + pet.level * 0.015).toFixed(3))),
    assistDamage: Math.max(5, Math.round(pet.atk * 0.65 * mult)),
  };
}

function rollItemRarity(
  tier: number,
  source: 'idle' | 'boss' | 'shop',
  rng: () => number,
): RpgItemRarity {
  const r = clampUnit(rng());
  const offset = Math.max(0, tier - 1);

  if (source === 'boss') {
    if (r >= Math.max(0.75, 0.96 - offset * 0.025)) return 'legendary';
    if (r >= Math.max(0.45, 0.78 - offset * 0.04)) return 'epic';
    if (r >= Math.max(0.18, 0.45 - offset * 0.035)) return 'rare';
    return 'uncommon';
  }

  if (r >= Math.max(0.88, 0.985 - offset * 0.012)) return 'legendary';
  if (r >= Math.max(0.62, 0.86 - offset * 0.028)) return 'epic';
  if (r >= Math.max(0.32, 0.58 - offset * 0.03)) return 'rare';
  if (r >= 0.12) return 'uncommon';
  return 'common';
}

export function generateTierItem(
  tier: number,
  source: 'idle' | 'boss' | 'shop',
  rng: () => number,
  minRarity?: RpgItemRarity,
): PendingRpgItem {
  const safeTier = Math.max(1, Math.min(RPG_TIERS.length, Math.floor(tier)));
  const slots: readonly RpgItemSlot[] = ['weapon', 'armor', 'accessory'];
  const slot = pickFrom(slots, rng);
  let rarity = rollItemRarity(safeTier, source, rng);
  if (minRarity && RARITY_ORDER[rarity] < RARITY_ORDER[minRarity]) {
    rarity = minRarity;
  }

  const name = pickFrom(ITEM_NAMES[slot][rarity], rng);
  const tierScale = 1 + (safeTier - 1) * 0.52;
  const rarityScale = RARITY_STAT_MULT[rarity];
  const variance = 0.9 + clampUnit(rng()) * 0.2;
  const power = tierScale * rarityScale * variance;

  if (slot === 'weapon') {
    return {
      name,
      slot,
      rarity,
      baseHp: Math.round(8 * power),
      baseAtk: Math.max(4, Math.round(10 * power)),
      baseDef: Math.round(1 * power),
      baseCritBp: Math.min(2500, Math.round(180 * rarityScale + safeTier * 30)),
    };
  }
  if (slot === 'armor') {
    return {
      name,
      slot,
      rarity,
      baseHp: Math.max(18, Math.round(40 * power)),
      baseAtk: 0,
      baseDef: Math.max(3, Math.round(7 * power)),
      baseCritBp: 0,
    };
  }
  return {
    name,
    slot,
    rarity,
    baseHp: Math.max(12, Math.round(22 * power)),
    baseAtk: Math.max(2, Math.round(5 * power)),
    baseDef: Math.max(1, Math.round(3 * power)),
    baseCritBp: Math.min(3000, Math.round(260 * rarityScale + safeTier * 38)),
  };
}

export function generateShopRpgLoot(
  tier: number,
  minRarity: RpgItemRarity,
  rng: () => number = Math.random,
): PendingRpgItem {
  const safeTier = Math.max(1, Math.min(RPG_TIERS.length, Math.floor(tier)));
  return generateTierItem(safeTier, 'shop', rng, minRarity);
}

export function computeIdlePowerMultiplier(stats: CombatStats, tier: number): number {
  let gearScore = 0;
  for (const eq of stats.equippedItems) {
    gearScore += computeItemScore(eq);
  }
  const gearBonus = Math.min(0.65, Math.sqrt(Math.max(0, gearScore)) * 0.022);
  const petBonus = stats.petSynergy
    ? stats.petSynergy.rarity === 'SSR'
      ? 0.16
      : stats.petSynergy.rarity === 'SR'
        ? 0.11
        : stats.petSynergy.rarity === 'R'
          ? 0.06
          : 0.03
    : 0;
  const tierBonus = Math.min(0.14, Math.max(0, tier - 1) * 0.015);
  return Number(Math.min(1.85, Math.max(1.0, 1 + gearBonus + petBonus + tierBonus)).toFixed(2));
}

export function computeTrialEffectiveRate(
  baseChanceBp: number,
  supporterCount: number,
  saboteurCount: number,
): number {
  const basePct = Math.round(baseChanceBp / 100);
  const raw =
    basePct +
    Math.max(0, supporterCount) * SUPPORTER_BONUS_PCT -
    Math.max(0, saboteurCount) * SABOTEUR_PENALTY_PCT;
  return Math.max(5, Math.min(100, raw));
}

export function computeHealInjuryCost(level: number): number {
  const { tier } = getRpgRealmInfo(level);
  return 1500 * tier;
}

function getCreditBreakthroughBonus(creditScore: number): number {
  if (creditScore >= 850) return 5;
  if (creditScore >= 700) return 3;
  if (creditScore >= 500) return 0;
  if (creditScore >= 300) return -2;
  return -5;
}

export class RpgService {
  private readonly config: RpgConfig;
  private readonly configOverrides?: Partial<RpgConfig>;
  private readonly timezone: string;
  private readonly guildConfigRepo?: GuildConfigRepo;
  private readonly socialPetRepo?: SocialPetRepo;
  private readonly onCoinsEarned?: RpgServiceOptions['onCoinsEarned'];
  private readonly onCreditChange?: RpgServiceOptions['onCreditChange'];
  private readonly getCreditScore?: RpgServiceOptions['getCreditScore'];

  constructor(
    private readonly db: Database.Database,
    private readonly rpgRepo: RpgRepo,
    private readonly profileRepo: ProfileRepo,
    options: RpgServiceOptions = {},
  ) {
    this.configOverrides = options.config;
    this.config = { ...DEFAULT_RPG_CONFIG, ...options.config };
    this.timezone = options.timezone ?? 'Asia/Shanghai';
    this.guildConfigRepo = options.guildConfigRepo;
    this.socialPetRepo = options.socialPetRepo;
    this.onCoinsEarned = options.onCoinsEarned;
    this.onCreditChange = options.onCreditChange;
    this.getCreditScore = options.getCreditScore;
  }

  getUserCreditScore(guildId: string, userId: string): number {
    if (!this.getCreditScore) {
      return DEFAULT_CREDIT_SCORE;
    }
    const score = this.getCreditScore(guildId, userId);
    return Number.isFinite(score) ? score : DEFAULT_CREDIT_SCORE;
  }

  getConfig(guildId?: string): RpgConfig {
    if (guildId && this.guildConfigRepo) {
      const guildCfg = this.guildConfigRepo.getOrCreate(guildId).rpg;
      return {
        ...DEFAULT_RPG_CONFIG,
        ...guildCfg,
        ...this.configOverrides,
      };
    }
    return { ...this.config };
  }

  getOrCreateCharacter(guildId: string, userId: string, nowMs = Date.now()): RpgCharacter {
    return this.db.transaction((): RpgCharacter => {
      return this.getOrCreateCharacterInTx(guildId, userId, nowMs);
    })();
  }

  getPendingTrialForUser(guildId: string, userId: string): RpgTrial | null {
    return this.rpgRepo.getPendingTrialForUser(guildId, userId);
  }

  getTrialById(trialId: number): RpgTrial | null {
    return this.rpgRepo.getTrialById(trialId);
  }

  bindTrialMessage(trialId: number, messageId: string, channelId?: string): void {
    this.rpgRepo.bindTrialMessage(trialId, messageId, channelId);
  }

  chooseOrSwitchClass(
    guildId: string,
    userId: string,
    classKey: RpgClassKey,
    nowMs = Date.now(),
  ): ChooseClassResult {
    return this.db.transaction((): ChooseClassResult => {
      if (this.rpgRepo.getPendingTrialForUser(guildId, userId)) {
        return { ok: false, reason: 'pending_trial' };
      }

      const cfg = this.getConfig(guildId);
      const today = getDateKey(nowMs, this.timezone);
      const existing = this.rpgRepo.getCharacter(guildId, userId);

      if (!existing) {
        const created = this.rpgRepo.createCharacter({
          guildId,
          userId,
          classKey,
          classSelected: true,
          stamina: cfg.dailyStamina,
          lastStaminaDate: today,
          lastIdleClaimAt: nowMs,
          updatedAt: nowMs,
        });
        const profile = this.profileRepo.getOrCreate(guildId, userId);
        return {
          ok: true,
          character: created,
          cost: 0,
          balance: profile.coins,
          isFirstSelection: true,
        };
      }

      const refreshed = this.refreshCharacterInTx(existing, today, nowMs);

      if (!refreshed.classSelected) {
        const updated: RpgCharacter = {
          ...refreshed,
          classKey,
          classSelected: true,
          lastIdleClaimAt: nowMs,
          updatedAt: nowMs,
        };
        this.rpgRepo.saveCharacter(updated);
        const profile = this.profileRepo.getOrCreate(guildId, userId);
        return {
          ok: true,
          character: updated,
          cost: 0,
          balance: profile.coins,
          isFirstSelection: true,
        };
      }

      if (refreshed.classKey === classKey) {
        return { ok: false, reason: 'same_class' };
      }

      const cost = Math.max(0, Math.floor(cfg.classSwitchCost));
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cost) {
        return { ok: false, reason: 'insufficient_funds', cost };
      }

      const balance = profile.coins - cost;
      if (cost > 0) {
        this.profileRepo.save({ ...profile, coins: balance });
      }

      const updated: RpgCharacter = {
        ...refreshed,
        classKey,
        classSelected: true,
        updatedAt: nowMs,
      };
      this.rpgRepo.saveCharacter(updated);

      return {
        ok: true,
        character: updated,
        cost,
        balance,
        isFirstSelection: false,
      };
    })();
  }

  buyStaminaPotion(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
  ): BuyStaminaPotionResult {
    return this.db.transaction((): BuyStaminaPotionResult => {
      const cfg = this.getConfig(guildId);
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      const dailyLimit = Math.max(0, Math.floor(cfg.staminaPotionDailyLimit));
      if (character.staminaBuysToday >= dailyLimit) {
        return { ok: false, reason: 'daily_limit_reached', dailyLimit };
      }

      const cost = Math.max(0, Math.floor(cfg.staminaPotionPrice));
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cost) {
        return { ok: false, reason: 'insufficient_funds', cost };
      }

      const balance = profile.coins - cost;
      if (cost > 0) {
        this.profileRepo.save({ ...profile, coins: balance });
      }

      const updated: RpgCharacter = {
        ...character,
        stamina: character.stamina + 1,
        staminaBuysToday: character.staminaBuysToday + 1,
        updatedAt: nowMs,
      };
      this.rpgRepo.saveCharacter(updated);

      return {
        ok: true,
        character: updated,
        cost,
        balance,
        buysRemaining: Math.max(0, dailyLimit - updated.staminaBuysToday),
      };
    })();
  }

  buyAlchemyItem(
    guildId: string,
    userId: string,
    kind: 'pill' | 'elixir',
    nowMs = Date.now(),
  ): BuyAlchemyItemResult {
    return this.db.transaction((): BuyAlchemyItemResult => {
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      const dailyLimit = kind === 'pill' ? PROMO_PILL_DAILY_LIMIT : GUARD_ELIXIR_DAILY_LIMIT;
      const boughtToday = kind === 'pill' ? character.pillBuysToday : character.elixirBuysToday;
      if (boughtToday >= dailyLimit) {
        return { ok: false, reason: 'daily_limit_reached', dailyLimit };
      }

      const cost = kind === 'pill' ? PROMO_PILL_PRICE : GUARD_ELIXIR_PRICE;
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cost) {
        return { ok: false, reason: 'insufficient_funds', cost };
      }

      const balance = profile.coins - cost;
      this.profileRepo.save({ ...profile, coins: balance });

      const updated: RpgCharacter =
        kind === 'pill'
          ? {
              ...character,
              promoPills: character.promoPills + 1,
              pillBuysToday: character.pillBuysToday + 1,
              updatedAt: nowMs,
            }
          : {
              ...character,
              guardElixirs: character.guardElixirs + 1,
              elixirBuysToday: character.elixirBuysToday + 1,
              updatedAt: nowMs,
            };
      this.rpgRepo.saveCharacter(updated);

      return {
        ok: true,
        kind,
        character: updated,
        cost,
        balance,
        buysRemaining: Math.max(
          0,
          dailyLimit - (kind === 'pill' ? updated.pillBuysToday : updated.elixirBuysToday),
        ),
      };
    })();
  }

  healInjury(guildId: string, userId: string, nowMs = Date.now()): HealInjuryResult {
    return this.db.transaction((): HealInjuryResult => {
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      if (character.injuredUntil <= nowMs) {
        return { ok: false, reason: 'not_injured' };
      }

      const cost = computeHealInjuryCost(character.level);
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cost) {
        return { ok: false, reason: 'insufficient_funds', cost };
      }

      const balance = profile.coins - cost;
      this.profileRepo.save({ ...profile, coins: balance });

      const updated: RpgCharacter = {
        ...character,
        injuredUntil: 0,
        updatedAt: nowMs,
      };
      this.rpgRepo.saveCharacter(updated);

      return { ok: true, character: updated, cost, balance };
    })();
  }

  configureTrialLoadout(
    guildId: string,
    userId: string,
    action: 'cycle_pills' | 'toggle_guard',
    nowMs = Date.now(),
  ): ConfigureTrialLoadoutResult {
    return this.db.transaction((): ConfigureTrialLoadoutResult => {
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      if (action === 'cycle_pills') {
        const maxUsable = Math.min(MAX_TRIAL_PILLS, character.promoPills);
        const nextPills =
          maxUsable <= 0 ? 0 : (Math.min(character.trialPillsStaged, maxUsable) + 1) % (maxUsable + 1);
        const updated: RpgCharacter = {
          ...character,
          trialPillsStaged: nextPills,
          updatedAt: nowMs,
        };
        this.rpgRepo.saveCharacter(updated);
        return { ok: true, character: updated };
      }

      const nextGuard = !character.trialUseGuard;
      if (nextGuard && character.guardElixirs <= 0) {
        return { ok: false, reason: 'no_guard_elixir' };
      }
      const updated: RpgCharacter = {
        ...character,
        trialUseGuard: nextGuard,
        updatedAt: nowMs,
      };
      this.rpgRepo.saveCharacter(updated);
      return { ok: true, character: updated };
    })();
  }

  listItems(guildId: string, userId: string): RpgItem[] {
    return this.rpgRepo.listItems(guildId, userId);
  }

  computeCombatStats(guildId: string, userId: string, nowMs = Date.now()): CombatStats {
    const character = this.getOrCreateCharacter(guildId, userId, nowMs);
    return this.computeCombatStatsForCharacter(character);
  }

  equipItem(guildId: string, userId: string, itemId: number, nowMs = Date.now()): EquipItemResult {
    return this.db.transaction((): EquipItemResult => {
      const item = this.rpgRepo.getItemById(itemId);
      if (!item || item.guildId !== guildId || item.userId !== userId) {
        return { ok: false, reason: 'not_found' };
      }
      if (item.equipped) {
        return { ok: false, reason: 'already_equipped' };
      }

      const equipped = this.rpgRepo.listEquippedItems(guildId, userId);
      const prevInSlot = equipped.find((eq) => eq.slot === item.slot) ?? null;

      this.rpgRepo.setSlotEquipped(guildId, userId, item.slot, item.id);
      const updatedItem = this.rpgRepo.getItemById(item.id)!;
      const unequippedItem = prevInSlot ? { ...prevInSlot, equipped: false } : null;
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      const stats = this.computeCombatStatsForCharacter(character);

      return { ok: true, item: updatedItem, unequippedItem, stats };
    })();
  }

  unequipItem(
    guildId: string,
    userId: string,
    itemId: number,
    nowMs = Date.now(),
  ): UnequipItemResult {
    return this.db.transaction((): UnequipItemResult => {
      const item = this.rpgRepo.getItemById(itemId);
      if (!item || item.guildId !== guildId || item.userId !== userId) {
        return { ok: false, reason: 'not_found' };
      }
      if (!item.equipped) {
        return { ok: false, reason: 'not_equipped' };
      }

      this.rpgRepo.setSlotEquipped(guildId, userId, item.slot, null);
      const updatedItem = this.rpgRepo.getItemById(item.id)!;
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      const stats = this.computeCombatStatsForCharacter(character);

      return { ok: true, item: updatedItem, stats };
    })();
  }

  enhanceItem(
    guildId: string,
    userId: string,
    itemId: number,
    _nowMs = Date.now(),
    rng: () => number = Math.random,
  ): EnhanceItemResult {
    return this.db.transaction((): EnhanceItemResult => {
      const item = this.rpgRepo.getItemById(itemId);
      if (!item || item.guildId !== guildId || item.userId !== userId) {
        return { ok: false, reason: 'not_found' };
      }

      const info = getEnhanceInfo(item);
      if (!info) {
        return { ok: false, reason: 'max_enhance_level' };
      }

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < info.cost) {
        return { ok: false, reason: 'insufficient_funds', cost: info.cost };
      }

      const balance = profile.coins - info.cost;
      this.profileRepo.save({ ...profile, coins: balance });

      const succeeded = clampUnit(rng()) < info.successRate;
      if (succeeded) {
        this.rpgRepo.updateItemEnhanceLevel(item.id, info.nextLevel);
      }

      const finalItem = this.rpgRepo.getItemById(item.id)!;
      return {
        ok: true,
        success: succeeded,
        item: finalItem,
        cost: info.cost,
        balance,
        successRate: info.successRate,
      };
    })();
  }

  salvageItem(guildId: string, userId: string, itemId: number): SalvageItemResult {
    return this.db.transaction((): SalvageItemResult => {
      const item = this.rpgRepo.getItemById(itemId);
      if (!item || item.guildId !== guildId || item.userId !== userId) {
        return { ok: false, reason: 'not_found' };
      }
      if (item.equipped) {
        return { ok: false, reason: 'item_equipped' };
      }

      const coinsEarned = getSalvageValue(item);
      this.rpgRepo.deleteItem(item.id, guildId, userId);
      const updatedProfile = this.profileRepo.addCoins(guildId, userId, coinsEarned);

      return {
        ok: true,
        salvagedItem: item,
        coinsEarned,
        balance: updatedProfile.coins,
      };
    })();
  }

  equipBestGear(guildId: string, userId: string, nowMs = Date.now()): EquipBestGearResult {
    return this.db.transaction((): EquipBestGearResult => {
      const items = this.rpgRepo.listItems(guildId, userId);
      if (items.length === 0) {
        return { ok: false, reason: 'no_items' };
      }

      const slots: readonly RpgItemSlot[] = ['weapon', 'armor', 'accessory'];
      const changed: EquipBestGearChange[] = [];
      let unchangedCount = 0;

      for (const slot of slots) {
        const slotItems = items.filter((item) => item.slot === slot);
        if (slotItems.length === 0) {
          continue;
        }

        let best = slotItems[0]!;
        let bestScore = computeItemScore(best);
        for (let i = 1; i < slotItems.length; i++) {
          const candidate = slotItems[i]!;
          const candidateScore = computeItemScore(candidate);
          if (
            candidateScore > bestScore ||
            (candidateScore === bestScore && candidate.enhanceLevel > best.enhanceLevel) ||
            (candidateScore === bestScore &&
              candidate.enhanceLevel === best.enhanceLevel &&
              candidate.id < best.id)
          ) {
            best = candidate;
            bestScore = candidateScore;
          }
        }

        if (best.equipped) {
          unchangedCount += 1;
          continue;
        }

        const previousEquipped = slotItems.find((item) => item.equipped);
        this.rpgRepo.setSlotEquipped(guildId, userId, slot, best.id);
        const updatedBest = this.rpgRepo.getItemById(best.id)!;
        if (previousEquipped) {
          changed.push({
            slot,
            item: updatedBest,
            previousItem: { ...previousEquipped, equipped: false },
          });
        } else {
          changed.push({ slot, item: updatedBest });
        }
      }

      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      const stats = this.computeCombatStatsForCharacter(character);
      return { ok: true, changed, unchangedCount, stats };
    })();
  }

  bulkSalvageItems(
    guildId: string,
    userId: string,
    maxRarity: 'uncommon' | 'rare' = 'uncommon',
    _nowMs = Date.now(),
  ): BulkSalvageItemsResult {
    return this.db.transaction((): BulkSalvageItemsResult => {
      const maxOrder = RARITY_ORDER[maxRarity];
      const targets = this.rpgRepo
        .listItems(guildId, userId)
        .filter((item) => !item.equipped && RARITY_ORDER[item.rarity] <= maxOrder);

      if (targets.length === 0) {
        return { ok: false, reason: 'nothing_to_salvage' };
      }

      let salvagedCount = 0;
      let totalCoins = 0;
      const byRarity: Partial<Record<RpgItemRarity, number>> = {};

      for (const item of targets) {
        const deleted = this.rpgRepo.deleteItem(item.id, guildId, userId);
        if (!deleted) continue;
        salvagedCount += 1;
        totalCoins += getSalvageValue(item);
        byRarity[item.rarity] = (byRarity[item.rarity] ?? 0) + 1;
      }

      if (salvagedCount === 0) {
        return { ok: false, reason: 'nothing_to_salvage' };
      }

      const updatedProfile = this.profileRepo.addCoins(guildId, userId, totalCoins);
      return {
        ok: true,
        salvagedCount,
        totalCoins,
        balance: updatedProfile.coins,
        byRarity,
      };
    })();
  }

  previewIdleHarvest(guildId: string, userId: string, nowMs = Date.now()): IdleHarvestPreview {
    const character = this.getOrCreateCharacter(guildId, userId, nowMs);
    return this.computeIdlePreviewForCharacter(character, nowMs);
  }

  claimIdleHarvest(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): ClaimIdleHarvestResult {
    return this.db.transaction((): ClaimIdleHarvestResult => {
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      if (!character.classSelected) {
        return { ok: false, reason: 'no_class_selected' };
      }

      const preview = this.computeIdlePreviewForCharacter(character, nowMs);
      if (!preview.canClaim) {
        return { ok: false, reason: 'too_soon', waitSeconds: preview.waitSeconds };
      }

      let extraXp = 0;
      let extraCoins = 0;
      let pillsFound = 0;
      let elixirsFound = 0;
      const pendingItems: PendingRpgItem[] = [];
      const adventures: string[] = [];

      const eventSlots =
        preview.accruedMs >= 8 * 3_600_000
          ? 3
          : preview.accruedMs >= 2 * 3_600_000
            ? 2
            : preview.accruedMs >= 15 * 60_000
              ? 1
              : 0;

      for (let i = 0; i < eventSlots; i++) {
        const r = clampUnit(rng());
        if (r < 0.25) {
          const bonus = Math.max(10, Math.round(preview.estimatedXp * 0.25));
          extraXp += bonus;
          adventures.push(`✨ **灵泉顿悟**：挂机期间寻得古树灵泉，额外领悟 **+${bonus} XP**`);
        } else if (r < 0.5) {
          const bonus = Math.max(50, Math.round(preview.estimatedCoins * 0.25));
          extraCoins += bonus;
          adventures.push(`🪙 **无主秘窖**：踢开半掩的石箱，顺手拾获 **+${bonus.toLocaleString()}** 赏金`);
        } else if (r < 0.72) {
          pillsFound += 1;
          adventures.push('🧪 **炼金遗物**：顺手炼化妖兽内丹，收获 **晋升秘药 ×1**');
        } else if (r < 0.92) {
          const dropped = generateTierItem(preview.realm.tier, 'idle', rng);
          pendingItems.push(dropped);
          const meta = RARITY_META[dropped.rarity];
          adventures.push(`🎁 **战利品拾遗**：巡猎精英残骸捡到 ${meta.emoji} **${dropped.name}**`);
        } else {
          elixirsFound += 1;
          adventures.push('🛡️ **圣泉恩赐**：在古老神龛发现 **护魂圣水 ×1**');
        }
      }

      const totalXp = preview.estimatedXp + extraXp;
      const totalCoins = preview.estimatedCoins + extraCoins;

      const banked = this.bankLootInTx({
        guildId,
        userId,
        character,
        xpGain: totalXp,
        coinGain: totalCoins,
        pendingItems,
        source: `rpg_idle_tier${preview.realm.tier}`,
        nowMs,
      });

      const finalCharacter: RpgCharacter = {
        ...banked.updatedCharacter,
        lastIdleClaimAt: nowMs,
        promoPills: banked.updatedCharacter.promoPills + pillsFound,
        guardElixirs: banked.updatedCharacter.guardElixirs + elixirsFound,
        updatedAt: nowMs,
      };
      this.rpgRepo.saveCharacter(finalCharacter);

      return {
        ok: true,
        accruedMs: preview.accruedMs,
        powerMultiplier: preview.powerMultiplier,
        xpEarned: totalXp,
        levelsGained: banked.levelsGained,
        hitGate: banked.hitGate,
        grossCoins: banked.grossCoins,
        garnishedCoins: banked.garnishedCoins,
        netCoins: banked.netCoins,
        pillsFound,
        elixirsFound,
        bankedItems: banked.bankedItems,
        legendaryDrops: banked.legendaryDrops,
        autoSalvagedCount: banked.autoSalvagedCount,
        autoSalvagedCoins: banked.autoSalvagedCoins,
        adventures,
        character: finalCharacter,
        balance: banked.balance,
      };
    })();
  }

  raidBoss(
    guildId: string,
    userId: string,
    mode: 'single' | 'all',
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): RaidBossResult {
    return this.db.transaction((): RaidBossResult => {
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      if (!character.classSelected) {
        return { ok: false, reason: 'no_class_selected' };
      }
      if (character.stamina < 1) {
        return { ok: false, reason: 'insufficient_stamina' };
      }

      const runsExecuted = mode === 'all' ? character.stamina : 1;
      const realm = getRpgRealmInfo(character.level);
      const tierDef = realm.tierDef;
      const stats = this.computeCombatStatsForCharacter(character);

      const powerScore = stats.atk * 2.5 + stats.maxHp * 0.2 + stats.def * 2;
      const expectedScore = tierDef.tier * 130;
      const rating: 'S' | 'A' | 'B' =
        powerScore >= expectedScore * 1.35 ? 'S' : powerScore >= expectedScore * 0.9 ? 'A' : 'B';
      const ratingMult = rating === 'S' ? 1.25 : rating === 'A' ? 1.1 : 1.0;
      const dropChance = rating === 'S' ? 0.85 : 0.75;

      let totalXp = 0;
      let totalCoins = 0;
      let pillsFound = 0;
      let elixirsFound = 0;
      const pendingItems: PendingRpgItem[] = [];

      for (let i = 0; i < runsExecuted; i++) {
        const xpVar = 0.9 + clampUnit(rng()) * 0.2;
        const coinVar = 0.9 + clampUnit(rng()) * 0.2;
        totalXp += Math.max(10, Math.round(tierDef.idleXpPerHour * 0.75 * ratingMult * xpVar));
        totalCoins += Math.max(50, Math.round(tierDef.idleCoinsPerHour * 0.95 * ratingMult * coinVar));

        if (clampUnit(rng()) < dropChance) {
          pendingItems.push(generateTierItem(tierDef.tier, 'boss', rng));
        }
        if (clampUnit(rng()) < 0.35) {
          pillsFound += 1;
        }
        if (clampUnit(rng()) < 0.15) {
          elixirsFound += 1;
        }
      }

      const banked = this.bankLootInTx({
        guildId,
        userId,
        character: {
          ...character,
          stamina: character.stamina - runsExecuted,
        },
        xpGain: totalXp,
        coinGain: totalCoins,
        pendingItems,
        source: `rpg_raid_tier${tierDef.tier}`,
        nowMs,
      });

      const finalCharacter: RpgCharacter = {
        ...banked.updatedCharacter,
        totalClears: banked.updatedCharacter.totalClears + runsExecuted,
        totalBossKills: banked.updatedCharacter.totalBossKills + runsExecuted,
        promoPills: banked.updatedCharacter.promoPills + pillsFound,
        guardElixirs: banked.updatedCharacter.guardElixirs + elixirsFound,
        updatedAt: nowMs,
      };
      this.rpgRepo.saveCharacter(finalCharacter);

      return {
        ok: true,
        runsExecuted,
        rating,
        tierDef,
        xpEarned: totalXp,
        levelsGained: banked.levelsGained,
        hitGate: banked.hitGate,
        grossCoins: banked.grossCoins,
        garnishedCoins: banked.garnishedCoins,
        netCoins: banked.netCoins,
        pillsFound,
        elixirsFound,
        bankedItems: banked.bankedItems,
        legendaryDrops: banked.legendaryDrops,
        autoSalvagedCount: banked.autoSalvagedCount,
        autoSalvagedCoins: banked.autoSalvagedCoins,
        character: finalCharacter,
        balance: banked.balance,
      };
    })();
  }

  computeBreakthroughPreview(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
  ): BreakthroughPreview {
    const character = this.getOrCreateCharacter(guildId, userId, nowMs);
    const pending = this.rpgRepo.getPendingTrialForUser(guildId, userId);
    return this.computeBreakthroughPreviewForCharacter(character, Boolean(pending));
  }

  attemptSoloBreakthrough(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): SoloBreakthroughResult {
    return this.db.transaction((): SoloBreakthroughResult => {
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      if (!character.classSelected) {
        return { ok: false, reason: 'no_class_selected' };
      }
      const fromRealm = getRpgRealmInfo(character.level);
      if (!fromRealm.nextTierDef || character.level >= MAX_RPG_LEVEL) {
        return { ok: false, reason: 'at_max_tier' };
      }
      if (!isAtBreakthroughGate(character.level, character.xp)) {
        return { ok: false, reason: 'not_at_gate' };
      }
      if (this.rpgRepo.getPendingTrialForUser(guildId, userId)) {
        return { ok: false, reason: 'pending_trial_exists' };
      }

      const preview = this.computeBreakthroughPreviewForCharacter(character, false);
      const consumedChar: RpgCharacter = {
        ...character,
        promoPills: Math.max(0, character.promoPills - preview.pillsUsed),
        guardElixirs: Math.max(0, character.guardElixirs - (preview.usedGuard ? 1 : 0)),
        trialPillsStaged: 0,
        trialUseGuard: false,
      };

      const succeeded = clampUnit(rng()) * 100 < preview.totalRatePct;
      const outcome = this.resolveBreakthroughOutcomeInTx({
        guildId,
        userId,
        character: consumedChar,
        targetTier: fromRealm.nextTierDef.tier,
        usedGuard: preview.usedGuard,
        succeeded,
        saboteurCount: 0,
        nowMs,
      });

      return {
        ok: true,
        succeeded,
        fromRealm,
        toRealm: outcome.toRealm,
        finalRatePct: preview.totalRatePct,
        pillsUsed: preview.pillsUsed,
        usedGuard: preview.usedGuard,
        grossCoins: outcome.grossCoins,
        garnishedCoins: outcome.garnishedCoins,
        netCoins: outcome.netCoins,
        creditDelta: outcome.creditDelta,
        xpLost: outcome.xpLost,
        injuredUntil: outcome.injuredUntil,
        character: outcome.character,
        balance: outcome.balance,
      };
    })();
  }

  startPublicBreakthroughTrial(
    guildId: string,
    channelId: string,
    userId: string,
    nowMs = Date.now(),
  ): StartPublicTrialResult {
    return this.db.transaction((): StartPublicTrialResult => {
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      if (!character.classSelected) {
        return { ok: false, reason: 'no_class_selected' };
      }
      const fromRealm = getRpgRealmInfo(character.level);
      if (!fromRealm.nextTierDef || character.level >= MAX_RPG_LEVEL) {
        return { ok: false, reason: 'at_max_tier' };
      }
      if (!isAtBreakthroughGate(character.level, character.xp)) {
        return { ok: false, reason: 'not_at_gate' };
      }
      if (this.rpgRepo.getPendingTrialForUser(guildId, userId)) {
        return { ok: false, reason: 'pending_trial_exists' };
      }

      const preview = this.computeBreakthroughPreviewForCharacter(character, false);
      const updatedChar: RpgCharacter = {
        ...character,
        promoPills: Math.max(0, character.promoPills - preview.pillsUsed),
        guardElixirs: Math.max(0, character.guardElixirs - (preview.usedGuard ? 1 : 0)),
        trialPillsStaged: 0,
        trialUseGuard: false,
        updatedAt: nowMs,
      };
      this.rpgRepo.saveCharacter(updatedChar);

      const trial = this.rpgRepo.createTrial({
        guildId,
        channelId,
        userId,
        fromLevel: updatedChar.level,
        targetTier: fromRealm.nextTierDef.tier,
        pillsUsed: preview.pillsUsed,
        usedGuard: preview.usedGuard,
        baseChanceBp: Math.round(preview.rawBasePct * 100),
        createdAt: nowMs,
        expiresAt: nowMs + PUBLIC_TRIAL_DURATION_MS,
      });

      return { ok: true, trial, character: updatedChar, preview };
    })();
  }

  cancelPublicTrialAndRefund(trialId: number, nowMs = Date.now()): boolean {
    return this.db.transaction((): boolean => {
      const trial = this.rpgRepo.getTrialById(trialId);
      if (!trial || trial.status !== 'pending') {
        return false;
      }
      const character = this.rpgRepo.getCharacter(trial.guildId, trial.userId);
      if (character) {
        this.rpgRepo.saveCharacter({
          ...character,
          promoPills: character.promoPills + trial.pillsUsed,
          guardElixirs: character.guardElixirs + (trial.usedGuard ? 1 : 0),
          updatedAt: nowMs,
        });
      }
      this.rpgRepo.saveTrial({
        ...trial,
        status: 'cancelled',
        resultSummary: '公屏试炼发送失败，已全额退还投入秘药。',
        resolvedAt: nowMs,
      });
      return true;
    })();
  }

  interactPublicTrial(
    trialId: number,
    actorId: string,
    mode: 'help' | 'jeer',
    nowMs = Date.now(),
  ): InteractPublicTrialResult {
    return this.db.transaction((): InteractPublicTrialResult => {
      const trial = this.rpgRepo.getTrialById(trialId);
      if (!trial) {
        return { ok: false, reason: 'not_found' };
      }
      if (trial.status !== 'pending' || trial.expiresAt <= nowMs) {
        return { ok: false, reason: 'already_resolved' };
      }
      if (actorId === trial.userId) {
        return { ok: false, reason: 'own_trial' };
      }
      if (trial.supporters.includes(actorId) || trial.saboteurs.includes(actorId)) {
        return { ok: false, reason: 'already_joined' };
      }

      const nextSupporters = [...trial.supporters];
      const nextSaboteurs = [...trial.saboteurs];
      if (mode === 'help') {
        if (nextSupporters.length >= MAX_TRIAL_SUPPORTERS) {
          return { ok: false, reason: 'supporters_full' };
        }
        nextSupporters.push(actorId);
      } else {
        if (nextSaboteurs.length >= MAX_TRIAL_SABOTEURS) {
          return { ok: false, reason: 'saboteurs_full' };
        }
        nextSaboteurs.push(actorId);
      }

      const updated: RpgTrial = {
        ...trial,
        supporters: nextSupporters,
        saboteurs: nextSaboteurs,
      };
      this.rpgRepo.saveTrial(updated);

      const currentRatePct = computeTrialEffectiveRate(
        updated.baseChanceBp,
        updated.supporters.length,
        updated.saboteurs.length,
      );
      return { ok: true, trial: updated, currentRatePct, mode };
    })();
  }

  settlePublicTrial(
    trialId: number,
    actorIdOrSystem: string | null,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): SettlePublicTrialResult {
    return this.db.transaction((): SettlePublicTrialResult => {
      const trial = this.rpgRepo.getTrialById(trialId);
      if (!trial) {
        return { ok: false, reason: 'not_found' };
      }
      if (trial.status !== 'pending') {
        return { ok: false, reason: 'already_resolved' };
      }
      if (actorIdOrSystem !== null && actorIdOrSystem !== trial.userId) {
        return { ok: false, reason: 'not_owner' };
      }

      const character = this.getOrCreateCharacterInTx(trial.guildId, trial.userId, nowMs);
      const fromRealm = getRpgRealmInfo(character.level);
      const finalRatePct = computeTrialEffectiveRate(
        trial.baseChanceBp,
        trial.supporters.length,
        trial.saboteurs.length,
      );
      const succeeded = clampUnit(rng()) * 100 < finalRatePct;

      const outcome = this.resolveBreakthroughOutcomeInTx({
        guildId: trial.guildId,
        userId: trial.userId,
        character,
        targetTier: trial.targetTier,
        usedGuard: trial.usedGuard,
        succeeded,
        saboteurCount: trial.saboteurs.length,
        nowMs,
      });

      const supporterPayouts: SupporterPayout[] = [];
      if (succeeded && trial.supporters.length > 0) {
        const candyAmount = trial.targetTier * 600;
        for (const supId of trial.supporters) {
          this.profileRepo.addCoins(trial.guildId, supId, candyAmount);
          supporterPayouts.push({ userId: supId, amount: candyAmount });
        }
      }

      const targetTierDef = RPG_TIER_MAP.get(trial.targetTier);
      const summary = succeeded
        ? `🎉 晋升成功！跨入 ${targetTierDef?.emoji ?? '🌟'} **${targetTierDef?.name ?? `第${trial.targetTier}阶`}·一重**（成功率 ${finalRatePct}%），获赏金 +${outcome.grossCoins.toLocaleString()}！`
        : `💥 晋升失败（成功率 ${finalRatePct}%），${trial.usedGuard ? '护魂圣水生效免于重伤' : '陷入 1 小时重伤'}，下轮保底 +${PITY_BONUS_PER_FAIL_PCT}%！`;

      const settledTrial: RpgTrial = {
        ...trial,
        status: succeeded ? 'succeeded' : 'failed',
        resultSummary: summary,
        resolvedAt: nowMs,
      };
      this.rpgRepo.saveTrial(settledTrial);

      return {
        ok: true,
        trial: settledTrial,
        succeeded,
        fromRealm,
        toRealm: outcome.toRealm,
        finalRatePct,
        grossCoins: outcome.grossCoins,
        garnishedCoins: outcome.garnishedCoins,
        netCoins: outcome.netCoins,
        creditDelta: outcome.creditDelta,
        xpLost: outcome.xpLost,
        injuredUntil: outcome.injuredUntil,
        supporterPayouts,
        character: outcome.character,
        balance: outcome.balance,
      };
    })();
  }

  settleDuePublicTrials(
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): Array<Extract<SettlePublicTrialResult, { ok: true }>> {
    const due = this.rpgRepo.listDuePendingTrials(nowMs);
    const settled: Array<Extract<SettlePublicTrialResult, { ok: true }>> = [];
    for (const trial of due) {
      const res = this.settlePublicTrial(trial.id, null, nowMs, rng);
      if (res.ok) {
        settled.push(res);
      }
    }
    return settled;
  }

  getLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): { items: RpgCharacter[]; total: number } {
    return this.rpgRepo.getLeaderboard(guildId, limit, offset);
  }

  private getOrCreateCharacterInTx(
    guildId: string,
    userId: string,
    nowMs: number,
  ): RpgCharacter {
    const cfg = this.getConfig(guildId);
    const today = getDateKey(nowMs, this.timezone);
    const existing = this.rpgRepo.getCharacter(guildId, userId);
    if (!existing) {
      return this.rpgRepo.createCharacter({
        guildId,
        userId,
        classKey: 'warrior',
        classSelected: false,
        stamina: cfg.dailyStamina,
        lastStaminaDate: today,
        lastIdleClaimAt: nowMs,
        updatedAt: nowMs,
      });
    }
    return this.refreshCharacterInTx(existing, today, nowMs);
  }

  private refreshCharacterInTx(
    character: RpgCharacter,
    today: string,
    nowMs: number,
  ): RpgCharacter {
    let next = character;
    let dirty = false;

    // Backfill legacy characters BEFORE daily stamina reset overwrites updatedAt
    if (next.classSelected && next.lastIdleClaimAt <= 0) {
      const minAnchor = Math.max(0, nowMs - MAX_IDLE_ACCRUE_MS);
      const seedClaimAt =
        character.updatedAt > 0
          ? Math.max(minAnchor, Math.min(nowMs, character.updatedAt))
          : minAnchor;
      next = {
        ...next,
        lastIdleClaimAt: seedClaimAt,
      };
      dirty = true;
    }

    if (next.lastStaminaDate !== today) {
      const cfg = this.getConfig(next.guildId);
      next = {
        ...next,
        stamina: Math.max(next.stamina, cfg.dailyStamina),
        lastStaminaDate: today,
        staminaBuysToday: 0,
        pillBuysToday: 0,
        elixirBuysToday: 0,
        updatedAt: nowMs,
      };
      dirty = true;
    }

    if (dirty) {
      this.rpgRepo.saveCharacter(next);
    }
    return next;
  }

  private computeCombatStatsForCharacter(character: RpgCharacter): CombatStats {
    const classDef = RPG_CLASS_MAP.get(character.classKey) ?? RPG_CLASSES[0]!;
    const extraLevels = Math.max(0, character.level - 1);

    let maxHp = Math.round(classDef.baseHp + extraLevels * classDef.hpPerLevel);
    let atk = Math.round(classDef.baseAtk + extraLevels * classDef.atkPerLevel);
    let def = Math.round(classDef.baseDef + extraLevels * classDef.defPerLevel);
    let critBp = Math.round(classDef.baseCritBp + extraLevels * classDef.critBpPerLevel);
    const dodgeBp = Math.min(5000, classDef.baseDodgeBp);

    const equippedItems = this.rpgRepo.listEquippedItems(character.guildId, character.userId);
    for (const item of equippedItems) {
      const eff = computeItemEffectiveStats(item);
      maxHp += eff.hp;
      atk += eff.atk;
      def += eff.def;
      critBp += eff.critBp;
    }

    let petSynergy: PetSynergyInfo | null = null;
    if (this.socialPetRepo) {
      const activePet = this.socialPetRepo.getActivePet(character.guildId, character.userId);
      if (activePet) {
        petSynergy = computePetSynergy(activePet);
        maxHp += petSynergy.bonusHp;
        atk += petSynergy.bonusAtk;
        critBp += petSynergy.bonusCritBp;
      }
    }

    return {
      maxHp: Math.max(50, maxHp),
      atk: Math.max(5, atk),
      def: Math.max(1, def),
      critBp: Math.min(8500, Math.max(0, critBp)),
      dodgeBp,
      classKey: character.classKey,
      level: character.level,
      equippedItems,
      petSynergy,
    };
  }

  private computeIdlePreviewForCharacter(
    character: RpgCharacter,
    nowMs: number,
  ): IdleHarvestPreview {
    const realm = getRpgRealmInfo(character.level);
    const stats = this.computeCombatStatsForCharacter(character);
    const powerMultiplier = computeIdlePowerMultiplier(stats, realm.tier);

    const anchorMs = character.lastIdleClaimAt > 0 ? character.lastIdleClaimAt : nowMs;
    const rawElapsedMs = Math.max(0, nowMs - anchorMs);
    const accruedMs = Math.min(MAX_IDLE_ACCRUE_MS, rawElapsedMs);
    const windowStartMs = nowMs - accruedMs;

    const injuredOverlapMs =
      character.injuredUntil > windowStartMs
        ? Math.max(0, Math.min(nowMs, character.injuredUntil) - windowStartMs)
        : 0;
    const healthyMs = Math.max(0, accruedMs - injuredOverlapMs);
    const effectiveHours = (healthyMs + injuredOverlapMs * 0.5) / 3_600_000;

    const estimatedXp = Math.floor(realm.tierDef.idleXpPerHour * effectiveHours * powerMultiplier);
    const estimatedCoins = Math.floor(
      realm.tierDef.idleCoinsPerHour * effectiveHours * powerMultiplier,
    );
    const canClaim = character.classSelected && accruedMs >= MIN_IDLE_CLAIM_MS;
    const waitSeconds = canClaim ? 0 : Math.ceil(Math.max(0, MIN_IDLE_CLAIM_MS - accruedMs) / 1000);
    const injuredRemainingMs = Math.max(0, character.injuredUntil - nowMs);

    return {
      accruedMs,
      isCapped: rawElapsedMs >= MAX_IDLE_ACCRUE_MS,
      canClaim,
      waitSeconds,
      isInjuredNow: injuredRemainingMs > 0,
      injuredRemainingMs,
      powerMultiplier,
      estimatedXp,
      estimatedCoins,
      realm,
      atGate: isAtBreakthroughGate(character.level, character.xp),
    };
  }

  private computeBreakthroughPreviewForCharacter(
    character: RpgCharacter,
    hasPendingTrial: boolean,
  ): BreakthroughPreview {
    const fromRealm = getRpgRealmInfo(character.level);
    const targetTierDef = fromRealm.nextTierDef;
    const atMaxTier = !targetTierDef || character.level >= MAX_RPG_LEVEL;
    const needXp = xpNeededForRpgLevel(character.level);

    const pillsUsed = Math.max(0, Math.min(MAX_TRIAL_PILLS, character.trialPillsStaged, character.promoPills));
    const usedGuard = character.trialUseGuard && character.guardElixirs > 0;

    const baseRatePct = targetTierDef ? fromRealm.tierDef.breakthroughBasePct : 0;
    const pillBonusPct = pillsUsed * PROMO_PILL_BONUS_PCT;

    const activePet = this.socialPetRepo?.getActivePet(character.guildId, character.userId) ?? null;
    const petBonusPct = activePet ? PET_BREAKTHROUGH_BONUS_PCT[activePet.rarity] : 0;

    const creditScore = this.getUserCreditScore(character.guildId, character.userId);
    const creditBonusPct = getCreditBreakthroughBonus(creditScore);
    const pityBonusPct = character.breakthroughPity * PITY_BONUS_PER_FAIL_PCT;

    const rawBasePct = atMaxTier
      ? 0
      : baseRatePct + pillBonusPct + petBonusPct + creditBonusPct + pityBonusPct;
    const totalRatePct = atMaxTier ? 0 : Math.max(5, Math.min(100, rawBasePct));

    return {
      eligible: !atMaxTier && isAtBreakthroughGate(character.level, character.xp) && !hasPendingTrial,
      atMaxTier,
      fromRealm,
      targetTierDef,
      needXp,
      currentXp: character.xp,
      pillsUsed,
      usedGuard,
      baseRatePct,
      pillBonusPct,
      petBonusPct,
      petName: activePet ? activePet.nickname : null,
      creditBonusPct,
      creditScore,
      pityBonusPct,
      rawBasePct,
      totalRatePct,
      hasPendingTrial,
    };
  }

  private bankLootInTx(input: {
    guildId: string;
    userId: string;
    character: RpgCharacter;
    xpGain: number;
    coinGain: number;
    pendingItems: PendingRpgItem[];
    source: string;
    nowMs: number;
  }): {
    bankedItems: RpgItem[];
    legendaryDrops: RpgItem[];
    autoSalvagedCount: number;
    autoSalvagedCoins: number;
    grossCoins: number;
    garnishedCoins: number;
    netCoins: number;
    levelsGained: number;
    hitGate: boolean;
    updatedCharacter: RpgCharacter;
    balance: number;
  } {
    const cfg = this.getConfig(input.guildId);
    const currentItemCount = this.rpgRepo.countItems(input.guildId, input.userId);
    const availableSlots = Math.max(0, cfg.bagCapacity - currentItemCount);

    const sortedPending = [...input.pendingItems].sort(
      (a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity],
    );

    const bankedItems: RpgItem[] = [];
    let autoSalvagedCount = 0;
    let autoSalvagedCoins = 0;

    for (const item of sortedPending) {
      if (bankedItems.length < availableSlots) {
        const created = this.rpgRepo.createItem({
          guildId: input.guildId,
          userId: input.userId,
          name: item.name,
          slot: item.slot,
          rarity: item.rarity,
          baseHp: item.baseHp,
          baseAtk: item.baseAtk,
          baseDef: item.baseDef,
          baseCritBp: item.baseCritBp,
          enhanceLevel: 0,
          equipped: false,
          createdAt: input.nowMs,
        });
        bankedItems.push(created);
      } else {
        autoSalvagedCount += 1;
        autoSalvagedCoins += getSalvageValue({ rarity: item.rarity, enhanceLevel: 0 });
      }
    }

    const grossCoins = Math.max(0, Math.floor(input.coinGain)) + autoSalvagedCoins;
    let garnishedCoins = 0;
    let netCoins = grossCoins;
    if (grossCoins > 0 && this.onCoinsEarned) {
      const hookRes = this.onCoinsEarned(
        input.guildId,
        input.userId,
        grossCoins,
        input.source,
        input.nowMs,
      );
      garnishedCoins = Math.max(0, Math.floor(hookRes.garnished));
      netCoins = Math.max(0, Math.floor(hookRes.net));
    }

    const updatedProfile =
      netCoins > 0
        ? this.profileRepo.addCoins(input.guildId, input.userId, netCoins)
        : this.profileRepo.getOrCreate(input.guildId, input.userId);

    const { updated: leveledChar, levelsGained, hitGate } = applyCharacterXp(
      input.character,
      input.xpGain,
    );

    const legendaryDrops = bankedItems.filter((item) => item.rarity === 'legendary');

    return {
      bankedItems,
      legendaryDrops,
      autoSalvagedCount,
      autoSalvagedCoins,
      grossCoins,
      garnishedCoins,
      netCoins,
      levelsGained,
      hitGate,
      updatedCharacter: { ...leveledChar, updatedAt: input.nowMs },
      balance: updatedProfile.coins,
    };
  }

  private resolveBreakthroughOutcomeInTx(input: {
    guildId: string;
    userId: string;
    character: RpgCharacter;
    targetTier: number;
    usedGuard: boolean;
    succeeded: boolean;
    saboteurCount: number;
    nowMs: number;
  }): {
    toRealm: RpgRealmInfo;
    grossCoins: number;
    garnishedCoins: number;
    netCoins: number;
    creditDelta: number;
    xpLost: number;
    injuredUntil: number;
    character: RpgCharacter;
    balance: number;
  } {
    const needXp = xpNeededForRpgLevel(input.character.level);

    if (input.succeeded) {
      const overflowXp = Math.max(0, input.character.xp - needXp);
      const nextBaseChar: RpgCharacter = {
        ...input.character,
        level: Math.min(MAX_RPG_LEVEL, input.character.level + 1),
        xp: 0,
      };
      const { updated: afterOverflow } = applyCharacterXp(nextBaseChar, overflowXp);
      const toRealm = getRpgRealmInfo(afterOverflow.level);

      const basePrize = input.targetTier * 6000;
      const saboteurBonusMult = 1 + Math.max(0, input.saboteurCount) * (SABOTEUR_POOL_BONUS_PCT / 100);
      const grossCoins = Math.round(basePrize * saboteurBonusMult);
      let garnishedCoins = 0;
      let netCoins = grossCoins;
      if (grossCoins > 0 && this.onCoinsEarned) {
        const hookRes = this.onCoinsEarned(
          input.guildId,
          input.userId,
          grossCoins,
          `rpg_breakthrough_tier${input.targetTier}`,
          input.nowMs,
        );
        garnishedCoins = Math.max(0, Math.floor(hookRes.garnished));
        netCoins = Math.max(0, Math.floor(hookRes.net));
      }

      const updatedProfile =
        netCoins > 0
          ? this.profileRepo.addCoins(input.guildId, input.userId, netCoins)
          : this.profileRepo.getOrCreate(input.guildId, input.userId);

      const creditDelta = 15;
      if (this.onCreditChange) {
        this.onCreditChange(
          input.guildId,
          input.userId,
          creditDelta,
          `RPG晋升突破至${toRealm.tierDef.name}`,
          input.nowMs,
        );
      }

      const finalChar: RpgCharacter = {
        ...afterOverflow,
        maxChapterCleared: Math.max(afterOverflow.maxChapterCleared, toRealm.tier),
        breakthroughPity: 0,
        totalBreakthroughs: afterOverflow.totalBreakthroughs + 1,
        updatedAt: input.nowMs,
      };
      this.rpgRepo.saveCharacter(finalChar);

      return {
        toRealm,
        grossCoins,
        garnishedCoins,
        netCoins,
        creditDelta,
        xpLost: 0,
        injuredUntil: finalChar.injuredUntil,
        character: finalChar,
        balance: updatedProfile.coins,
      };
    }

    // Breakthrough failed
    const xpLost = Math.min(
      input.character.xp,
      Math.round(needXp * (input.usedGuard ? 0.1 : 0.4)),
    );
    const nextInjuredUntil = input.usedGuard
      ? input.character.injuredUntil
      : Math.max(input.character.injuredUntil, input.nowMs + INJURY_DURATION_MS);

    const finalChar: RpgCharacter = {
      ...input.character,
      xp: Math.max(0, input.character.xp - xpLost),
      injuredUntil: nextInjuredUntil,
      breakthroughPity: input.character.breakthroughPity + 1,
      updatedAt: input.nowMs,
    };
    this.rpgRepo.saveCharacter(finalChar);
    const profile = this.profileRepo.getOrCreate(input.guildId, input.userId);

    return {
      toRealm: getRpgRealmInfo(finalChar.level),
      grossCoins: 0,
      garnishedCoins: 0,
      netCoins: 0,
      creditDelta: 0,
      xpLost,
      injuredUntil: finalChar.injuredUntil,
      character: finalChar,
      balance: profile.coins,
    };
  }
}
