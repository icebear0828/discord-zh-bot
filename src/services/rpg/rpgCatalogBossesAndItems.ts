import type { RpgItemRarity, RpgItemSlot } from '../../db/repositories/rpgRepo.js';
import type { PetRarity } from '../../db/repositories/socialPetRepo.js';
import {
  createEmptyAffixBonuses,
  rollLegendaryEffect,
  rollRandomAffixes,
} from '../rpgAffixes.js';
import type { CoopPartyMemberInput } from '../rpgCombatEngine.js';
import { RPG_CLASS_MAP, RPG_TIERS } from './rpgCatalogClassesAndTiers.js';
import {
  clampUnit,
  pickFrom,
  STAGES_PER_TIER,
  type PendingRpgItem,
  type RpgLootSource,
} from './rpgTypesAndConfig.js';

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

export const RARITY_STAT_MULT: Record<RpgItemRarity, number> = {
  common: 1.0,
  uncommon: 1.35,
  rare: 1.8,
  epic: 2.4,
  legendary: 3.3,
};

export const RARITY_ENHANCE_COST_MULT: Record<RpgItemRarity, number> = {
  common: 1.0,
  uncommon: 1.4,
  rare: 2.0,
  epic: 3.0,
  legendary: 4.5,
};

export const RARITY_SALVAGE_BASE: Record<RpgItemRarity, number> = {
  common: 300,
  uncommon: 800,
  rare: 2000,
  epic: 5500,
  legendary: 15000,
};

export const ENHANCE_SUCCESS_RATES: readonly number[] = [
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

export const PET_RARITY_SYNERGY_MULT: Record<PetRarity, number> = {
  N: 1.0,
  R: 1.15,
  SR: 1.35,
  SSR: 1.6,
};

export const PET_BREAKTHROUGH_BONUS_PCT: Record<PetRarity, number> = {
  N: 2,
  R: 4,
  SR: 7,
  SSR: 10,
};

export const RARITY_SCORE_BONUS: Record<RpgItemRarity, number> = {
  common: 0,
  uncommon: 8,
  rare: 18,
  epic: 32,
  legendary: 50,
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

export function rollItemRarity(
  tier: number,
  source: RpgLootSource,
  rng: () => number,
): RpgItemRarity {
  const r = clampUnit(rng());
  const offset = Math.max(0, tier - 1);

  if (source === 'abyss') {
    if (r >= Math.max(0.55, 0.84 - offset * 0.03)) return 'legendary';
    if (r >= Math.max(0.2, 0.46 - offset * 0.03)) return 'epic';
    return 'rare';
  }

  if (source === 'coop') {
    if (r >= Math.max(0.65, 0.9 - offset * 0.03)) return 'legendary';
    if (r >= Math.max(0.32, 0.62 - offset * 0.035)) return 'epic';
    return 'rare';
  }

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
  source: RpgLootSource,
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
  const affixes = rollRandomAffixes(rarity, rng);
  const legendaryEffect = rarity === 'legendary' ? rollLegendaryEffect(rng) : null;

  if (slot === 'weapon') {
    return {
      name,
      slot,
      rarity,
      baseHp: Math.round(8 * power),
      baseAtk: Math.max(4, Math.round(10 * power)),
      baseDef: Math.round(1 * power),
      baseCritBp: Math.min(2500, Math.round(180 * rarityScale + safeTier * 30)),
      affixes,
      legendaryEffect,
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
      affixes,
      legendaryEffect,
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
    affixes,
    legendaryEffect,
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

export function buildFallbackGuardianMercenary(tier: number, index: number): CoopPartyMemberInput {
  const safeTier = Math.max(1, Math.min(RPG_TIERS.length, Math.floor(tier)));
  const level = (safeTier - 1) * STAGES_PER_TIER + 7;
  const classDef = RPG_CLASS_MAP.get('paladin')!;
  const extraLevels = Math.max(0, level - 1);
  const tierScale = 1 + (safeTier - 1) * 0.52;

  const affixes = createEmptyAffixBonuses();
  affixes.thornsBp = 900;
  affixes.dmgReduceBp = 800;
  affixes.lifestealBp = 600;
  if (safeTier >= 5) {
    affixes.legendaryEffects.push('titan_aegis');
  }

  return {
    id: `merc:guardian:${index}`,
    name: '🛡️ 圣殿守护佣兵',
    classKey: 'paladin',
    level,
    maxHp: Math.round(classDef.baseHp + extraLevels * classDef.hpPerLevel + 95 * tierScale),
    atk: Math.round(classDef.baseAtk + extraLevels * classDef.atkPerLevel + 24 * tierScale),
    def: Math.round(classDef.baseDef + extraLevels * classDef.defPerLevel + 18 * tierScale),
    critBp: Math.min(
      7500,
      Math.round(classDef.baseCritBp + extraLevels * classDef.critBpPerLevel + 500),
    ),
    dodgeBp: classDef.baseDodgeBp,
    affixes,
    pet: null,
    isMercenary: true,
  };
}
