import type { RpgCharacter, RpgItem } from '../../db/repositories/rpgRepo.js';
import type { UserPet } from '../../db/repositories/socialPetRepo.js';
import { aggregateEquippedAffixes, computeClassAwareItemScore } from '../rpgAffixes.js';
import type { RpgBattleRating } from '../rpgCombatEngine.js';
import { PET_SPECIES_MAP } from '../socialPetService.js';
import {
  ENHANCE_SUCCESS_RATES,
  PET_RARITY_SYNERGY_MULT,
  RARITY_ENHANCE_COST_MULT,
  RARITY_SALVAGE_BASE,
  RARITY_SCORE_BONUS,
} from './rpgCatalogBossesAndItems.js';
import {
  RPG_CLASSES,
  RPG_CLASS_MAP,
  RPG_TIERS,
  RPG_TIER_MAP,
  STAGE_ZH_LABELS,
  type RpgRealmInfo,
} from './rpgCatalogClassesAndTiers.js';
import {
  MAX_ENHANCE_LEVEL,
  MAX_IDLE_ACCRUE_MS,
  MAX_RPG_LEVEL,
  MIN_IDLE_CLAIM_MS,
  SABOTEUR_PENALTY_PCT,
  STAGES_PER_TIER,
  SUPPORTER_BONUS_PCT,
  type CombatStats,
  type EffectiveItemStats,
  type IdleHarvestPreview,
  type PetSynergyInfo,
} from './rpgTypesAndConfig.js';

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

export function getArenaTierLabel(rating: number): string {
  if (rating >= 1600) return '👑 传说战神';
  if (rating >= 1350) return '💎 璀璨钻石';
  if (rating >= 1150) return '🥇 荣耀黄金';
  if (rating >= 1000) return '🥈 秘银斗士';
  return '🥉 青铜新锐';
}

export function computePetSynergy(pet: UserPet): PetSynergyInfo {
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
    assistChance: Math.min(
      0.65,
      Number((0.28 + (mult - 1) * 0.25 + pet.level * 0.015).toFixed(3)),
    ),
    assistDamage: Math.max(5, Math.round(pet.atk * 0.65 * mult)),
  };
}

export function computeCombatStatsFromData(
  character: RpgCharacter,
  equippedItems: RpgItem[],
  activePet: UserPet | null,
): CombatStats {
  const classDef = RPG_CLASS_MAP.get(character.classKey) ?? RPG_CLASSES[0]!;
  const extraLevels = Math.max(0, character.level - 1);

  let maxHp = Math.round(classDef.baseHp + extraLevels * classDef.hpPerLevel);
  let atk = Math.round(classDef.baseAtk + extraLevels * classDef.atkPerLevel);
  let def = Math.round(classDef.baseDef + extraLevels * classDef.defPerLevel);
  let critBp = Math.round(classDef.baseCritBp + extraLevels * classDef.critBpPerLevel);
  const dodgeBp = Math.min(5000, classDef.baseDodgeBp);

  for (const item of equippedItems) {
    const eff = computeItemEffectiveStats(item);
    maxHp += eff.hp;
    atk += eff.atk;
    def += eff.def;
    critBp += eff.critBp;
  }
  const affixes = aggregateEquippedAffixes(equippedItems);

  let petSynergy: PetSynergyInfo | null = null;
  if (activePet) {
    petSynergy = computePetSynergy(activePet);
    maxHp += petSynergy.bonusHp;
    atk += petSynergy.bonusAtk;
    critBp += petSynergy.bonusCritBp;
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
    affixes,
    petSynergy,
  };
}

export function computeIdlePowerMultiplier(stats: CombatStats, tier: number): number {
  let gearScore = 0;
  for (const eq of stats.equippedItems) {
    gearScore += computeClassAwareItemScore(eq, stats.classKey);
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

export function getCreditBreakthroughBonus(creditScore: number): number {
  if (creditScore >= 850) return 5;
  if (creditScore >= 700) return 3;
  if (creditScore >= 500) return 0;
  if (creditScore >= 300) return -2;
  return -5;
}

export function computeStarterBackfillDust(
  character: Pick<RpgCharacter, 'totalBossKills' | 'level'>,
): number {
  return Math.max(25, character.totalBossKills * 8 + character.level * 4);
}

export function computeRatingMultiplier(rating: RpgBattleRating): number {
  switch (rating) {
    case 'SSS':
      return 1.4;
    case 'S':
      return 1.25;
    case 'A':
      return 1.1;
    case 'B':
      return 1.0;
  }
}

export function computeIdlePreviewFromData(
  character: RpgCharacter,
  stats: CombatStats,
  nowMs: number,
): IdleHarvestPreview {
  const realm = getRpgRealmInfo(character.level);
  const powerMultiplier = computeIdlePowerMultiplier(stats, realm.tier);
  const greedMult = 1 + stats.affixes.greedBp / 10_000;

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
    realm.tierDef.idleCoinsPerHour * effectiveHours * powerMultiplier * greedMult,
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
