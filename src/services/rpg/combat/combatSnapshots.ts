import type { RpgClassKey } from '../../../db/repositories/rpgRepo.js';
import {
  aggregateEquippedAffixes,
  createEmptyAffixBonuses,
  type AffixBearingItem,
  type RpgLegendaryEffect,
} from '../../rpgAffixes.js';
import {
  CLASS_MODELS,
  EQUALIZED_TEMPLATE_LEVEL,
  type BattleUnitState,
  type CombatPetCompanion,
  type CombatantSnapshot,
} from './combatTypes.js';

interface TierBossBlueprint {
  tier: number;
  bossName: string;
  bossEmoji: string;
  classKey: RpgClassKey;
  abyssLegendary: RpgLegendaryEffect | null;
}

const TIER_BOSS_BLUEPRINTS: readonly TierBossBlueprint[] = [
  {
    tier: 1,
    bossName: '哥布林督军·格鲁克',
    bossEmoji: '👺',
    classKey: 'warrior',
    abyssLegendary: null,
  },
  {
    tier: 2,
    bossName: '骸骨领主·莫德雷德',
    bossEmoji: '💀',
    classKey: 'paladin',
    abyssLegendary: null,
  },
  {
    tier: 3,
    bossName: '血族伯爵·弗拉德',
    bossEmoji: '🧛',
    classKey: 'ranger',
    abyssLegendary: 'abyss_soul_drain',
  },
  {
    tier: 4,
    bossName: '熔岩魔像·卡兹丹',
    bossEmoji: '🔥',
    classKey: 'paladin',
    abyssLegendary: 'titan_aegis',
  },
  {
    tier: 5,
    bossName: '双头古龙·提亚马特',
    bossEmoji: '🐲',
    classKey: 'mage',
    abyssLegendary: 'twin_meteor',
  },
  {
    tier: 6,
    bossName: '虚空大魔导·梅林',
    bossEmoji: '👁️',
    classKey: 'mage',
    abyssLegendary: 'ancestral_war_cry',
  },
  {
    tier: 7,
    bossName: '雷霆泰坦·克洛诺斯',
    bossEmoji: '⚡',
    classKey: 'warrior',
    abyssLegendary: 'ancestral_war_cry',
  },
  {
    tier: 8,
    bossName: '堕落魔神·阿撒托斯',
    bossEmoji: '🔱',
    classKey: 'mage',
    abyssLegendary: 'abyss_soul_drain',
  },
  {
    tier: 9,
    bossName: '噬界魔狼·芬里尔',
    bossEmoji: '🐍',
    classKey: 'ranger',
    abyssLegendary: 'godslayer_execute',
  },
  {
    tier: 10,
    bossName: '混沌原初之影',
    bossEmoji: '👑',
    classKey: 'warrior',
    abyssLegendary: 'phoenix_rebirth',
  },
];

function computeRawClassStats(classKey: RpgClassKey, level: number): {
  hp: number;
  atk: number;
  def: number;
  critBp: number;
  dodgeBp: number;
} {
  const model = CLASS_MODELS[classKey];
  const extra = Math.max(0, Math.floor(level) - 1);
  return {
    hp: Math.round(model.baseHp + extra * model.hpPerLevel),
    atk: Math.round(model.baseAtk + extra * model.atkPerLevel),
    def: Math.round(model.baseDef + extra * model.defPerLevel),
    critBp: Math.round(model.baseCritBp + extra * model.critBpPerLevel),
    dodgeBp: model.baseDodgeBp,
  };
}

export function createUnitState(
  snapshot: CombatantSnapshot,
  isMercenary = false,
  statMult = 1,
): BattleUnitState {
  const scaledMaxHp = Math.max(1, Math.round(snapshot.maxHp * statMult));
  const scaledAtk = Math.max(1, Math.round(snapshot.atk * statMult));
  const legendarySet = new Set<RpgLegendaryEffect>(snapshot.affixes.legendaryEffects);

  return {
    id: snapshot.id,
    name: snapshot.name,
    classKey: snapshot.classKey,
    level: snapshot.level,
    maxHp: scaledMaxHp,
    hp: scaledMaxHp,
    shield: 0,
    baseAtk: scaledAtk,
    stolenAtk: 0,
    lostAtk: 0,
    def: Math.max(0, Math.round(snapshot.def)),
    critBp: Math.max(0, Math.min(8500, Math.round(snapshot.critBp))),
    dodgeBp: Math.max(0, Math.min(5000, Math.round(snapshot.dodgeBp))),
    rage: 0,
    armorBreakRounds: 0,
    phoenixUsed: false,
    soulDrainStacks: 0,
    affixes: snapshot.affixes,
    legendarySet,
    pet: snapshot.pet ?? null,
    isBoss: Boolean(snapshot.isBoss),
    isMercenary,
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    totalHealedAndShielded: 0,
  };
}

export function buildHeroCombatantSnapshot(input: {
  id: string;
  name: string;
  stats: {
    maxHp: number;
    atk: number;
    def: number;
    critBp: number;
    dodgeBp: number;
    classKey: RpgClassKey;
    level: number;
    equippedItems: readonly (AffixBearingItem & { enhanceLevel?: number })[];
    petSynergy?: {
      nickname: string;
      emoji: string;
      assistChance: number;
      assistDamage: number;
    } | null;
  };
}): CombatantSnapshot {
  const items = input.stats.equippedItems;
  let enhanceSum = 0;
  for (const item of items) {
    enhanceSum += Math.max(0, item.enhanceLevel ?? 0);
  }
  const avgEnhanceLevel = items.length > 0 ? enhanceSum / 3 : 0;

  return {
    id: input.id,
    name: input.name,
    classKey: input.stats.classKey,
    level: input.stats.level,
    maxHp: input.stats.maxHp,
    atk: input.stats.atk,
    def: input.stats.def,
    critBp: input.stats.critBp,
    dodgeBp: input.stats.dodgeBp,
    affixes: aggregateEquippedAffixes(items),
    pet: input.stats.petSynergy
      ? {
          nickname: input.stats.petSynergy.nickname,
          emoji: input.stats.petSynergy.emoji,
          assistChance: input.stats.petSynergy.assistChance,
          assistDamage: input.stats.petSynergy.assistDamage,
        }
      : null,
    avgEnhanceLevel,
    isBoss: false,
  };
}

export function buildEqualizedCombatant(
  snapshot: CombatantSnapshot,
  templateLevel = EQUALIZED_TEMPLATE_LEVEL,
): CombatantSnapshot {
  const safeTemplateLevel = Math.max(1, Math.min(90, Math.floor(templateLevel)));
  const srcLevel = Math.max(1, Math.min(90, Math.floor(snapshot.level)));
  const srcTier = Math.min(10, Math.floor((srcLevel - 1) / 9) + 1);
  const srcTierScale = 1 + (srcTier - 1) * 0.52;

  const srcClassRaw = computeRawClassStats(snapshot.classKey, srcLevel);
  const tplClassRaw = computeRawClassStats(snapshot.classKey, safeTemplateLevel);

  const surplusHp = Math.max(0, snapshot.maxHp - srcClassRaw.hp);
  const surplusAtk = Math.max(0, snapshot.atk - srcClassRaw.atk);
  const surplusDef = Math.max(0, snapshot.def - srcClassRaw.def);
  const surplusCritBp = Math.max(0, snapshot.critBp - srcClassRaw.critBp);

  const explicitEnhanceRatio = Math.min(1, Math.max(0, snapshot.avgEnhanceLevel ?? 0) / 10);
  const hpGearRatio = Math.max(
    explicitEnhanceRatio * 0.75,
    Math.min(1, surplusHp / Math.max(1, 165 * srcTierScale)),
  );
  const atkGearRatio = Math.max(
    explicitEnhanceRatio * 0.75,
    Math.min(1, surplusAtk / Math.max(1, 88 * srcTierScale)),
  );
  const defGearRatio = Math.max(
    explicitEnhanceRatio * 0.75,
    Math.min(1, surplusDef / Math.max(1, 42 * srcTierScale)),
  );

  // Template standard geared base (1.25x class raw) + compressed up to +28% gear/enhance quality edge
  const baseTemplateMult = 1.25;
  const maxHp = Math.max(
    80,
    Math.round(tplClassRaw.hp * baseTemplateMult * (1 + hpGearRatio * 0.28)),
  );
  const atk = Math.max(
    10,
    Math.round(tplClassRaw.atk * baseTemplateMult * (1 + atkGearRatio * 0.28)),
  );
  const def = Math.max(
    5,
    Math.round(tplClassRaw.def * baseTemplateMult * (1 + defGearRatio * 0.28)),
  );
  const critBp = Math.min(
    8500,
    Math.round(tplClassRaw.critBp + Math.min(1600, surplusCritBp * 0.6)),
  );
  const dodgeBp = Math.min(5000, Math.max(tplClassRaw.dodgeBp, snapshot.dodgeBp));

  let equalizedPet: CombatPetCompanion | null = null;
  if (snapshot.pet) {
    const petRatio = Math.min(
      0.34,
      Math.max(0.14, snapshot.pet.assistDamage / Math.max(1, snapshot.atk)),
    );
    equalizedPet = {
      nickname: snapshot.pet.nickname,
      emoji: snapshot.pet.emoji,
      assistChance: snapshot.pet.assistChance,
      assistDamage: Math.max(8, Math.round(atk * petRatio)),
    };
  }

  return {
    ...snapshot,
    level: safeTemplateLevel,
    maxHp,
    atk,
    def,
    critBp,
    dodgeBp,
    affixes: {
      ...snapshot.affixes,
      legendaryEffects: [...snapshot.affixes.legendaryEffects],
    },
    pet: equalizedPet,
  };
}

function getBlueprintForTier(tier: number): TierBossBlueprint {
  const safeTier = Math.max(1, Math.min(TIER_BOSS_BLUEPRINTS.length, Math.floor(tier)));
  return TIER_BOSS_BLUEPRINTS[safeTier - 1]!;
}

export function buildTierBossCombatant(
  tier: number,
  difficulty: 'normal' | 'abyss',
): CombatantSnapshot {
  const blueprint = getBlueprintForTier(tier);
  const t = blueprint.tier;

  const normalHp = Math.round(120 + (t - 1) * 205 + Math.pow(t - 1, 1.55) * 42);
  const normalAtk = Math.round(15 + (t - 1) * 25 + Math.pow(t - 1, 1.35) * 5);
  const normalDef = Math.round(8 + (t - 1) * 14);

  if (difficulty === 'normal') {
    return {
      id: `boss-normal-t${t}`,
      name: `${blueprint.bossEmoji} ${blueprint.bossName}`,
      classKey: blueprint.classKey,
      level: (t - 1) * 9 + 3,
      maxHp: normalHp,
      atk: normalAtk,
      def: normalDef,
      critBp: 800 + t * 110,
      dodgeBp: 250 + t * 50,
      affixes: createEmptyAffixBonuses(),
      pet: null,
      isBoss: true,
    };
  }

  const abyssAffixes = createEmptyAffixBonuses();
  abyssAffixes.lifestealBp = 400 + t * 75;
  abyssAffixes.critDmgBp = 1200 + t * 180;
  abyssAffixes.armorPenBp = 500 + t * 120;
  abyssAffixes.dmgReduceBp = 300 + t * 60;
  if (t % 2 === 0) {
    abyssAffixes.thornsBp = 450 + t * 65;
  } else {
    abyssAffixes.comboBp = 600 + t * 80;
  }
  if (blueprint.abyssLegendary) {
    abyssAffixes.legendaryEffects.push(blueprint.abyssLegendary);
  }
  if (t === 10) {
    abyssAffixes.legendaryEffects.push('godslayer_execute');
  }

  return {
    id: `boss-abyss-t${t}`,
    name: `💀 深渊·${blueprint.bossName}`,
    classKey: blueprint.classKey,
    level: t * 9,
    maxHp: Math.round(normalHp * 3.35),
    atk: Math.round(normalAtk * 2.85),
    def: Math.round(normalDef * 1.9),
    critBp: 1500 + t * 210,
    dodgeBp: 500 + t * 90,
    affixes: abyssAffixes,
    pet: null,
    isBoss: true,
  };
}

export function buildCoopRaidBossCombatant(tier: number, partySize: number): CombatantSnapshot {
  const blueprint = getBlueprintForTier(tier);
  const t = blueprint.tier;
  const safePartySize = Math.max(2, Math.min(4, Math.floor(partySize)));
  const normalBoss = buildTierBossCombatant(t, 'normal');

  const hpScale = 2.6 + (safePartySize - 2) * 0.85;
  const atkScale = 1.65 + (safePartySize - 2) * 0.25;
  const defScale = 1.45 + (safePartySize - 2) * 0.1;

  const raidAffixes = createEmptyAffixBonuses();
  raidAffixes.critDmgBp = 1000 + t * 150;
  raidAffixes.armorPenBp = 600 + t * 100;
  raidAffixes.dmgReduceBp = 400 + t * 50;
  if (blueprint.abyssLegendary && t >= 4) {
    raidAffixes.legendaryEffects.push(blueprint.abyssLegendary);
  }

  return {
    id: `boss-coop-t${t}-p${safePartySize}`,
    name: `🐉 团本首领·${blueprint.bossName}`,
    classKey: blueprint.classKey,
    level: t * 9,
    maxHp: Math.round(normalBoss.maxHp * hpScale),
    atk: Math.round(normalBoss.atk * atkScale),
    def: Math.round(normalBoss.def * defScale),
    critBp: 1400 + t * 180,
    dodgeBp: 400 + t * 70,
    affixes: raidAffixes,
    pet: null,
    isBoss: true,
  };
}
