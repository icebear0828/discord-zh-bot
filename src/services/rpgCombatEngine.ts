import type { RpgClassKey } from '../db/repositories/rpgRepo.js';
import {
  aggregateEquippedAffixes,
  createEmptyAffixBonuses,
  type AffixBearingItem,
  type AggregatedAffixBonuses,
  type RpgLegendaryEffect,
} from './rpgAffixes.js';

export const MAX_BATTLE_ROUNDS = 12;
export const EQUALIZED_TEMPLATE_LEVEL = 45;

export interface CombatPetCompanion {
  nickname: string;
  emoji: string;
  assistChance: number;
  assistDamage: number;
}

export interface CombatantSnapshot {
  id: string;
  name: string;
  classKey: RpgClassKey;
  level: number;
  maxHp: number;
  atk: number;
  def: number;
  critBp: number;
  dodgeBp: number;
  affixes: AggregatedAffixBonuses;
  pet?: CombatPetCompanion | null;
  avgEnhanceLevel?: number;
  isBoss?: boolean;
}

export type RpgBattleMode = 'full' | 'equalized';
export type RpgBattleRating = 'SSS' | 'S' | 'A' | 'B';
export type RpgBattleWinner = 'left' | 'right' | 'draw';

export interface SimulateBattleOptions {
  maxRounds?: number;
  mode?: RpgBattleMode;
  templateLevel?: number;
  rng?: () => number;
}

export interface RpgBattleReport {
  winner: RpgBattleWinner;
  rating: RpgBattleRating;
  roundsPlayed: number;
  mode: RpgBattleMode;
  leftRemainingHp: number;
  rightRemainingHp: number;
  leftMaxHp: number;
  rightMaxHp: number;
  leftTotalDamage: number;
  rightTotalDamage: number;
  highlights: string[];
}

export type CoopPartyMemberInput = CombatantSnapshot & { isMercenary?: boolean };

export interface CoopMemberBattleStat {
  userId: string;
  name: string;
  classKey: RpgClassKey;
  isMercenary: boolean;
  role: 'frontline' | 'backline';
  remainingHp: number;
  maxHp: number;
  damageDealt: number;
  damageTaken: number;
  healedAndShielded: number;
}

export interface CoopRaidBattleReport {
  succeeded: boolean;
  tier: number;
  bossName: string;
  bossMaxHp: number;
  bossRemainingHp: number;
  roundsPlayed: number;
  partySynergyBonusPct: number;
  mvpUserId: string | null;
  members: CoopMemberBattleStat[];
  totalPartyDamage: number;
  highlights: string[];
}

interface ClassGrowthModel {
  key: RpgClassKey;
  name: string;
  emoji: string;
  skillName: string;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseCritBp: number;
  baseDodgeBp: number;
  hpPerLevel: number;
  atkPerLevel: number;
  defPerLevel: number;
  critBpPerLevel: number;
  initiative: number;
}

const CLASS_MODELS: Record<RpgClassKey, ClassGrowthModel> = {
  warrior: {
    key: 'warrior',
    name: '圣殿战士',
    emoji: '⚔️',
    skillName: '破军重斩',
    baseHp: 170,
    baseAtk: 24,
    baseDef: 14,
    baseCritBp: 1000,
    baseDodgeBp: 500,
    hpPerLevel: 26,
    atkPerLevel: 4.5,
    defPerLevel: 2.8,
    critBpPerLevel: 25,
    initiative: 2,
  },
  mage: {
    key: 'mage',
    name: '奥术法师',
    emoji: '🔮',
    skillName: '陨星火球',
    baseHp: 115,
    baseAtk: 34,
    baseDef: 7,
    baseCritBp: 1600,
    baseDodgeBp: 700,
    hpPerLevel: 16,
    atkPerLevel: 6.2,
    defPerLevel: 1.5,
    critBpPerLevel: 45,
    initiative: 3,
  },
  ranger: {
    key: 'ranger',
    name: '暗影游侠',
    emoji: '🏹',
    skillName: '穿云连射',
    baseHp: 130,
    baseAtk: 29,
    baseDef: 9,
    baseCritBp: 2000,
    baseDodgeBp: 1500,
    hpPerLevel: 19,
    atkPerLevel: 5.4,
    defPerLevel: 1.8,
    critBpPerLevel: 55,
    initiative: 4,
  },
  paladin: {
    key: 'paladin',
    name: '辉光圣骑士',
    emoji: '🛡️',
    skillName: '圣光裁决',
    baseHp: 155,
    baseAtk: 25,
    baseDef: 12,
    baseCritBp: 1200,
    baseDodgeBp: 600,
    hpPerLevel: 23,
    atkPerLevel: 4.8,
    defPerLevel: 2.4,
    critBpPerLevel: 30,
    initiative: 1,
  },
};

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

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999999, Math.max(0, value));
}

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

interface BattleUnitState {
  id: string;
  name: string;
  classKey: RpgClassKey;
  level: number;
  maxHp: number;
  hp: number;
  shield: number;
  baseAtk: number;
  stolenAtk: number;
  lostAtk: number;
  def: number;
  critBp: number;
  dodgeBp: number;
  rage: number;
  armorBreakRounds: number;
  phoenixUsed: boolean;
  soulDrainStacks: number;
  affixes: AggregatedAffixBonuses;
  legendarySet: ReadonlySet<RpgLegendaryEffect>;
  pet: CombatPetCompanion | null;
  isBoss: boolean;
  isMercenary: boolean;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalHealedAndShielded: number;
}

interface HighlightCandidate {
  seq: number;
  priority: number;
  text: string;
}

class HighlightLogCollector {
  private readonly entries: HighlightCandidate[] = [];
  private seq = 0;

  push(priority: number, text: string): void {
    this.seq += 1;
    this.entries.push({ seq: this.seq, priority, text });
  }

  finalize(fallbackLines: readonly string[], minLines = 6, maxLines = 8): string[] {
    let selected: HighlightCandidate[];
    if (this.entries.length <= maxLines) {
      selected = [...this.entries];
    } else {
      const ranked = [...this.entries].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.seq - b.seq;
      });
      selected = ranked.slice(0, maxLines).sort((a, b) => a.seq - b.seq);
    }

    const lines = selected.map((item) => item.text);
    for (const extra of fallbackLines) {
      if (lines.length >= minLines) break;
      if (!lines.includes(extra)) {
        // Insert tactical lines right before the closing line if possible
        if (lines.length >= 2) {
          lines.splice(lines.length - 1, 0, extra);
        } else {
          lines.push(extra);
        }
      }
    }

    return lines.slice(0, maxLines);
  }
}

function createUnitState(
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

function getEffectiveAtk(unit: BattleUnitState): number {
  return Math.max(1, unit.baseAtk + unit.stolenAtk - unit.lostAtk);
}

function applyPreBattlePassives(unit: BattleUnitState, log: HighlightLogCollector): void {
  if (unit.legendarySet.has('ancestral_war_cry')) {
    unit.rage = 100;
    log.push(4, `📯 **先祖战吼**：${unit.name} 战意沸腾，开场直接凝聚 100 满怒气！`);
  }
  if (unit.legendarySet.has('titan_aegis')) {
    const shieldGain = Math.max(1, Math.round(unit.maxHp * 0.28));
    unit.shield += shieldGain;
    unit.totalHealedAndShielded += shieldGain;
    log.push(3, `🛡️ **泰坦圣壁**：${unit.name} 披挂神圣壁垒，入场获得 **${shieldGain}** 点护盾！`);
  }
}

function refreshPeriodicTitanShield(
  unit: BattleUnitState,
  round: number,
  log: HighlightLogCollector,
): void {
  if (unit.hp <= 0 || round <= 1 || round % 3 !== 0) return;
  if (!unit.legendarySet.has('titan_aegis')) return;

  const refreshShield = Math.max(1, Math.round(unit.maxHp * 0.14));
  const nextShield = Math.max(unit.shield, Math.min(Math.round(unit.maxHp * 0.35), unit.shield + refreshShield));
  const gained = Math.max(0, nextShield - unit.shield);
  if (gained > 0) {
    unit.shield = nextShield;
    unit.totalHealedAndShielded += gained;
    log.push(2, `🛡️ [R${round}] **泰坦圣壁**：${unit.name} 刷新 **${gained}** 点圣盾加护！`);
  }
}

function dealDamageToUnit(
  attacker: BattleUnitState | null,
  target: BattleUnitState,
  amount: number,
  round: number,
  log: HighlightLogCollector,
): { actualDealt: number; triggeredPhoenix: boolean } {
  const safeDmg = Math.max(1, Math.round(amount));
  if (attacker) {
    attacker.totalDamageDealt += safeDmg;
  }
  target.totalDamageTaken += safeDmg;

  let remaining = safeDmg;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, remaining);
    target.shield -= absorbed;
    remaining -= absorbed;
  }

  let triggeredPhoenix = false;
  if (remaining > 0) {
    target.hp -= remaining;
    if (target.hp <= 0) {
      if (target.legendarySet.has('phoenix_rebirth') && !target.phoenixUsed) {
        target.phoenixUsed = true;
        triggeredPhoenix = true;
        const healAmt = Math.max(1, Math.round(target.maxHp * 0.25));
        target.hp = Math.min(target.maxHp, 1 + healAmt);
        target.totalHealedAndShielded += healAmt;
        log.push(
          5,
          `🔥 [R${round}] **不灭凤羽**：${target.name} 遭遇致命重创锁 1 血涅槃，瞬间恢复 **${healAmt}** 生命！`,
        );
      } else {
        target.hp = 0;
      }
    }
  }

  if (target.hp > 0) {
    const rageGain = target.isBoss ? 8 : target.classKey === 'warrior' ? 28 : 16;
    target.rage = Math.min(140, target.rage + rageGain);
  }

  return { actualDealt: safeDmg, triggeredPhoenix };
}

interface StrikeOptions {
  round: number;
  multiplier: number;
  canDodge: boolean;
  extraArmorPenBp: number;
  allowCombo: boolean;
  allowThorns: boolean;
  skillLabel?: string;
  logPriority?: number;
}

function executeSingleStrike(
  attacker: BattleUnitState,
  target: BattleUnitState,
  opts: StrikeOptions,
  rng: () => number,
  log: HighlightLogCollector,
): { hit: boolean; isCrit: boolean; damage: number } {
  if (attacker.hp <= 0 || target.hp <= 0) {
    return { hit: false, isCrit: false, damage: 0 };
  }

  // 1. Dodge check
  if (opts.canDodge) {
    const rangerBonusBp = target.classKey === 'ranger' ? 800 : 0;
    const dodgeChance = Math.min(
      0.6,
      Math.max(0, (target.dodgeBp + target.affixes.dodgeBp + rangerBonusBp) / 10000),
    );
    if (clampUnit(rng()) < dodgeChance) {
      if (target.classKey === 'ranger' && target.hp > 0) {
        // Ranger passive: 幻影追猎 — dodge triggers 75% counter-arrow
        const counterRes = executeSingleStrike(
          target,
          attacker,
          {
            round: opts.round,
            multiplier: 0.75,
            canDodge: false,
            extraArmorPenBp: 0,
            allowCombo: false,
            allowThorns: false,
          },
          rng,
          log,
        );
        log.push(
          3,
          `💨 [R${opts.round}] **幻影追猎**：${target.name} 残影闪避攻击，反手追射 ${attacker.name} **${counterRes.damage}** 伤害！`,
        );
      } else {
        log.push(2, `💨 [R${opts.round}] ${target.name} 灵巧闪避了 ${attacker.name} 的攻势！`);
      }
      return { hit: false, isCrit: false, damage: 0 };
    }
  }

  // 2. Effective ATK & DEF
  const effAtk = getEffectiveAtk(attacker);
  let targetDef = target.def;
  const paladinShieldImmune = target.classKey === 'paladin' && target.shield > 0;
  if (target.armorBreakRounds > 0 && !paladinShieldImmune) {
    targetDef *= 0.7;
  }
  const totalPenBp = Math.min(8500, attacker.affixes.armorPenBp + opts.extraArmorPenBp);
  const effDef = Math.max(0, targetDef * (1 - totalPenBp / 10000));

  // 3. Pre-mitigation damage & Warrior low-HP passive
  const variance = 0.95 + clampUnit(rng()) * 0.1;
  let rawPreMit = effAtk * opts.multiplier * variance;

  if (attacker.classKey === 'warrior' && attacker.hp < attacker.maxHp * 0.4) {
    const targetMissingRatio = 1 - target.hp / Math.max(1, target.maxHp);
    rawPreMit *= 1.12 + targetMissingRatio * 0.25;
  }

  // 4. Crit & Abyss Soul Drain
  const critChance = Math.min(0.85, Math.max(0, attacker.critBp / 10000));
  const isCrit = clampUnit(rng()) < critChance;
  if (isCrit) {
    const magePassiveCritBonus = attacker.classKey === 'mage' ? 0.35 : 0;
    const critMult = 1.5 + magePassiveCritBonus + attacker.affixes.critDmgBp / 10000;
    rawPreMit *= critMult;

    if (attacker.legendarySet.has('abyss_soul_drain') && attacker.soulDrainStacks < 5) {
      const drainAtk = Math.max(1, Math.round(target.baseAtk * 0.04));
      attacker.soulDrainStacks += 1;
      attacker.stolenAtk += drainAtk;
      target.lostAtk = Math.min(Math.floor(target.baseAtk * 0.4), target.lostAtk + drainAtk);
      log.push(
        3,
        `👁️ [R${opts.round}] **深渊噬魂**：${attacker.name} 暴击汲取 ${target.name} **${drainAtk}** 点攻击力（${attacker.soulDrainStacks}/5层）！`,
      );
    }
  }

  // 5. Defense mitigation (level-scaled K so high-tier armor stays balanced) & Damage Reduction
  const armorK = 100 + Math.max(1, attacker.level) * 5;
  const mitigated = rawPreMit * (armorK / (armorK + effDef));
  const classDmgReduceBp =
    target.classKey === 'warrior' ? 1000 : target.classKey === 'paladin' ? 800 : 0;
  const totalDmgReduceBp = Math.min(6500, target.affixes.dmgReduceBp + classDmgReduceBp);
  let finalDmg = mitigated * (1 - totalDmgReduceBp / 10000);

  // 6. Godslayer Execute (<35% HP -> +30% final damage)
  let triggeredExecute = false;
  if (
    attacker.legendarySet.has('godslayer_execute') &&
    target.hp / Math.max(1, target.maxHp) < 0.35
  ) {
    finalDmg *= 1.3;
    triggeredExecute = true;
  }

  const roundedDmg = Math.max(1, Math.round(finalDmg));
  dealDamageToUnit(attacker, target, roundedDmg, opts.round, log);

  if (opts.skillLabel) {
    const critBadge = isCrit ? '💥暴击 ' : '';
    const execBadge = triggeredExecute ? '【弑神处决】' : '';
    log.push(
      opts.logPriority ?? 4,
      `${opts.skillLabel} [R${opts.round}] ${attacker.name} 重创 ${target.name}，${critBadge}${execBadge}造成 **${roundedDmg}** 伤害！`,
    );
  } else if (isCrit || triggeredExecute) {
    const execBadge = triggeredExecute ? '触发【弑神处决】' : '';
    log.push(
      3,
      `💥 [R${opts.round}] ${attacker.name} 致命暴击${execBadge}，对 ${target.name} 造成 **${roundedDmg}** 伤害！`,
    );
  } else {
    log.push(1, `⚔️ [R${opts.round}] ${attacker.name} 命中 ${target.name}，造成 **${roundedDmg}** 伤害。`);
  }

  // 7. Lifesteal
  if (attacker.affixes.lifestealBp > 0 && attacker.hp > 0) {
    const heal = Math.max(1, Math.round(roundedDmg * (attacker.affixes.lifestealBp / 10000)));
    const actualHeal = Math.min(attacker.maxHp - attacker.hp, heal);
    attacker.hp += actualHeal;
    attacker.totalHealedAndShielded += actualHeal;
  }

  // 8. Thorns (荆棘 + Paladin 圣盾荆棘 18%)
  if (opts.allowThorns && attacker.hp > 0) {
    const paladinThornsBp = target.classKey === 'paladin' ? 1800 : 0;
    const totalThornsBp = target.affixes.thornsBp + paladinThornsBp;
    if (totalThornsBp > 0) {
      let thornsDmg = Math.max(1, Math.round(rawPreMit * (totalThornsBp / 10000)));
      if (attacker.isBoss) {
        thornsDmg = Math.min(thornsDmg, Math.max(10, Math.round(attacker.maxHp * 0.08)));
      }
      dealDamageToUnit(target, attacker, thornsDmg, opts.round, log);
      if (thornsDmg >= Math.max(15, Math.round(attacker.maxHp * 0.05))) {
        log.push(
          2,
          `🌵 [R${opts.round}] ${target.name} 圣盾荆棘反震 ${attacker.name} **${thornsDmg}** 伤害！`,
        );
      }
    }
  }

  // 9. Combo affix (疾风)
  if (opts.allowCombo && attacker.affixes.comboBp > 0 && attacker.hp > 0 && target.hp > 0) {
    if (clampUnit(rng()) < attacker.affixes.comboBp / 10000) {
      const comboRes = executeSingleStrike(
        attacker,
        target,
        {
          round: opts.round,
          multiplier: 0.65,
          canDodge: true,
          extraArmorPenBp: 0,
          allowCombo: false,
          allowThorns: false,
        },
        rng,
        log,
      );
      if (comboRes.hit) {
        log.push(
          2,
          `🌪️ [R${opts.round}] **疾风连击**：${attacker.name} 乘胜追击再添 **${comboRes.damage}** 伤害！`,
        );
      }
    }
  }

  return { hit: true, isCrit, damage: roundedDmg };
}

function executeClassUltimate(
  attacker: BattleUnitState,
  target: BattleUnitState,
  round: number,
  rng: () => number,
  log: HighlightLogCollector,
  allies?: readonly BattleUnitState[],
): void {
  const model = CLASS_MODELS[attacker.classKey];

  const runUltimateCast = (powerScale: number, isAftershock: boolean): void => {
    if (attacker.hp <= 0 || target.hp <= 0) return;
    const tagPrefix = isAftershock
      ? `☄️ **双生星陨·${model.skillName}**`
      : `${model.emoji} **招牌大招·${model.skillName}**`;

    if (attacker.classKey === 'warrior') {
      const res = executeSingleStrike(
        attacker,
        target,
        {
          round,
          multiplier: 1.85 * powerScale,
          canDodge: false,
          extraArmorPenBp: 0,
          allowCombo: false,
          allowThorns: !isAftershock,
          skillLabel: tagPrefix,
          logPriority: 4,
        },
        rng,
        log,
      );
      if (res.hit && target.hp > 0 && !(target.classKey === 'paladin' && target.shield > 0)) {
        target.armorBreakRounds = Math.max(target.armorBreakRounds, 2);
      }
      return;
    }

    if (attacker.classKey === 'mage') {
      executeSingleStrike(
        attacker,
        target,
        {
          round,
          multiplier: 2.05 * powerScale,
          canDodge: false,
          extraArmorPenBp: 4000,
          allowCombo: false,
          allowThorns: !isAftershock,
          skillLabel: tagPrefix,
          logPriority: 4,
        },
        rng,
        log,
      );
      return;
    }

    if (attacker.classKey === 'ranger') {
      let totalArrowDmg = 0;
      for (let shot = 0; shot < 2; shot++) {
        if (target.hp <= 0 || attacker.hp <= 0) break;
        const res = executeSingleStrike(
          attacker,
          target,
          {
            round,
            multiplier: 1.08 * powerScale,
            canDodge: false,
            extraArmorPenBp: 0,
            allowCombo: true,
            allowThorns: shot === 0 && !isAftershock,
          },
          rng,
          log,
        );
        totalArrowDmg += res.damage;
      }
      log.push(
        4,
        `${tagPrefix} [R${round}] ${attacker.name} 双箭齐发贯穿 ${target.name}，合计造成 **${totalArrowDmg}** 伤害！`,
      );
      return;
    }

    // Paladin: 圣光裁决
    executeSingleStrike(
      attacker,
      target,
      {
        round,
        multiplier: 1.65 * powerScale,
        canDodge: false,
        extraArmorPenBp: 0,
        allowCombo: false,
        allowThorns: !isAftershock,
        skillLabel: tagPrefix,
        logPriority: 4,
      },
      rng,
      log,
    );

    if (attacker.hp > 0) {
      const shieldAmt = Math.max(1, Math.round(attacker.maxHp * 0.22 * powerScale));
      const healAmt = Math.max(1, Math.round(attacker.maxHp * 0.12 * powerScale));
      attacker.shield += shieldAmt;
      const actualHeal = Math.min(attacker.maxHp - attacker.hp, healAmt);
      attacker.hp += actualHeal;
      attacker.totalHealedAndShielded += shieldAmt + actualHeal;

      if (allies && !isAftershock) {
        for (const ally of allies) {
          if (ally.id !== attacker.id && ally.hp > 0) {
            const allyShield = Math.max(1, Math.round(ally.maxHp * 0.08));
            ally.shield += allyShield;
            attacker.totalHealedAndShielded += allyShield;
          }
        }
      }
    }
  };

  runUltimateCast(1, false);

  if (
    attacker.hp > 0 &&
    target.hp > 0 &&
    attacker.legendarySet.has('twin_meteor') &&
    clampUnit(rng()) < 0.35
  ) {
    runUltimateCast(0.55, true);
  }
}

function executePetAssist(
  attacker: BattleUnitState,
  target: BattleUnitState,
  round: number,
  rng: () => number,
  log: HighlightLogCollector,
): void {
  if (!attacker.pet || attacker.hp <= 0 || target.hp <= 0) return;
  if (attacker.pet.assistDamage <= 0) return;
  if (clampUnit(rng()) >= attacker.pet.assistChance) return;

  const petDmg = Math.max(
    1,
    Math.round(attacker.pet.assistDamage * (120 / (120 + target.def * 0.35))),
  );
  dealDamageToUnit(attacker, target, petDmg, round, log);
  log.push(
    2,
    `${attacker.pet.emoji} [R${round}] 灵宠 **${attacker.pet.nickname}** 默契协战，扑击 ${target.name} **${petDmg}** 伤害！`,
  );
}

function executeFighterTurn(
  attacker: BattleUnitState,
  target: BattleUnitState,
  round: number,
  rng: () => number,
  log: HighlightLogCollector,
  allies?: readonly BattleUnitState[],
): void {
  if (attacker.hp <= 0 || target.hp <= 0) return;

  // Turn-start rage focus (Mage passive: 奥术增幅 gains +18 mana rage)
  const passiveRage = attacker.classKey === 'mage' ? 18 : 6;
  attacker.rage = Math.min(140, attacker.rage + passiveRage);

  if (attacker.rage >= 100) {
    attacker.rage = Math.max(0, attacker.rage - 100);
    executeClassUltimate(attacker, target, round, rng, log, allies);
  } else {
    attacker.rage = Math.min(140, attacker.rage + 26);
    executeSingleStrike(
      attacker,
      target,
      {
        round,
        multiplier: 1.0,
        canDodge: true,
        extraArmorPenBp: 0,
        allowCombo: true,
        allowThorns: true,
      },
      rng,
      log,
    );
  }

  executePetAssist(attacker, target, round, rng, log);
}

function computeBattleRating(
  winner: RpgBattleWinner,
  rightIsBoss: boolean,
  roundsPlayed: number,
  winnerRemainingHp: number,
  winnerMaxHp: number,
): RpgBattleRating {
  if (winner === 'draw') return 'B';
  if (rightIsBoss && winner !== 'left') return 'B';

  const hpRatio = winnerRemainingHp / Math.max(1, winnerMaxHp);
  if (roundsPlayed <= 4 && hpRatio >= 0.55) return 'SSS';
  if (roundsPlayed <= 7 && hpRatio >= 0.35) return 'S';
  if (roundsPlayed <= 10) return 'A';
  return 'B';
}

export function simulateRpgBattle(
  leftInput: CombatantSnapshot,
  rightInput: CombatantSnapshot,
  options: SimulateBattleOptions = {},
): RpgBattleReport {
  const mode: RpgBattleMode = options.mode ?? 'full';
  const maxRounds = Math.max(1, Math.min(30, Math.floor(options.maxRounds ?? MAX_BATTLE_ROUNDS)));
  const rng = options.rng ?? Math.random;
  const tplLevel = options.templateLevel ?? EQUALIZED_TEMPLATE_LEVEL;

  const preparedLeft =
    mode === 'equalized' ? buildEqualizedCombatant(leftInput, tplLevel) : leftInput;
  const preparedRight =
    mode === 'equalized' ? buildEqualizedCombatant(rightInput, tplLevel) : rightInput;

  const left = createUnitState(preparedLeft);
  const right = createUnitState(preparedRight);
  const log = new HighlightLogCollector();

  const modeBadge = mode === 'equalized' ? `⚖️同阶拉平(Lv.${tplLevel})` : '🔥实战交锋';
  log.push(3, `⚔️ **${modeBadge}**：**${left.name}** 迎战 **${right.name}**！`);

  applyPreBattlePassives(left, log);
  applyPreBattlePassives(right, log);

  const leftFirst =
    CLASS_MODELS[left.classKey].initiative >= CLASS_MODELS[right.classKey].initiative;

  let roundsPlayed = 0;
  for (let round = 1; round <= maxRounds; round++) {
    if (left.hp <= 0 || right.hp <= 0) break;
    roundsPlayed = round;

    refreshPeriodicTitanShield(left, round, log);
    refreshPeriodicTitanShield(right, round, log);

    if (leftFirst) {
      executeFighterTurn(left, right, round, rng, log);
      if (right.hp > 0 && left.hp > 0) {
        executeFighterTurn(right, left, round, rng, log);
      }
    } else {
      executeFighterTurn(right, left, round, rng, log);
      if (left.hp > 0 && right.hp > 0) {
        executeFighterTurn(left, right, round, rng, log);
      }
    }

    if (left.armorBreakRounds > 0) left.armorBreakRounds -= 1;
    if (right.armorBreakRounds > 0) right.armorBreakRounds -= 1;
  }

  let winner: RpgBattleWinner = 'draw';
  if (left.hp > 0 && right.hp <= 0) {
    winner = 'left';
  } else if (right.hp > 0 && left.hp <= 0) {
    winner = 'right';
  }

  const winnerUnit = winner === 'left' ? left : winner === 'right' ? right : null;
  const rating = computeBattleRating(
    winner,
    right.isBoss,
    roundsPlayed,
    winnerUnit ? winnerUnit.hp : 0,
    winnerUnit ? winnerUnit.maxHp : 1,
  );

  if (winner === 'left') {
    log.push(
      5,
      `🏆 **胜负已分**：第 ${roundsPlayed} 回合，**${left.name}** 斩获胜利（剩余生命 ${left.hp}/${left.maxHp} · 评级 **${rating}**）！`,
    );
  } else if (winner === 'right') {
    log.push(
      5,
      `💀 **战局终结**：第 ${roundsPlayed} 回合，**${right.name}** 击败了 ${left.name}（剩余生命 ${right.hp}/${right.maxHp}）！`,
    );
  } else {
    log.push(
      5,
      `🤝 **鏖战平局**：激战满 ${roundsPlayed} 回合未分生死（${left.name} ${left.hp} HP vs ${right.name} ${right.hp} HP）！`,
    );
  }

  const fallbackTacticalLines: string[] = [
    `📊 **气势对决**：${left.name}（${CLASS_MODELS[left.classKey].name}）正面对抗 ${right.name}（${CLASS_MODELS[right.classKey].name}）。`,
    `🗡️ **输出统计**：${left.name} 累计造成 **${left.totalDamageDealt}** 伤害；${right.name} 累计造成 **${right.totalDamageDealt}** 伤害。`,
    `🛡️ **生存态势**：战罢时 ${left.name} 剩余 **${left.hp}/${left.maxHp}** HP，${right.name} 剩余 **${right.hp}/${right.maxHp}** HP。`,
    `⚡ **战术节奏**：双方共交锋 **${roundsPlayed}** 回合，完成整场战斗结算。`,
  ];

  return {
    winner,
    rating,
    roundsPlayed,
    mode,
    leftRemainingHp: left.hp,
    rightRemainingHp: right.hp,
    leftMaxHp: left.maxHp,
    rightMaxHp: right.maxHp,
    leftTotalDamage: left.totalDamageDealt,
    rightTotalDamage: right.totalDamageDealt,
    highlights: log.finalize(fallbackTacticalLines, 6, 8),
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

function getPartyRole(classKey: RpgClassKey): 'frontline' | 'backline' {
  return classKey === 'warrior' || classKey === 'paladin' ? 'frontline' : 'backline';
}

function getAggroWeight(classKey: RpgClassKey): number {
  switch (classKey) {
    case 'paladin':
      return 3.6;
    case 'warrior':
      return 3.2;
    case 'ranger':
      return 1.0;
    case 'mage':
      return 1.0;
  }
}

function getPartySynergyBonusPct(partyCount: number): number {
  if (partyCount >= 4) return 25;
  if (partyCount === 3) return 16;
  if (partyCount === 2) return 8;
  return 0;
}

function pickWeightedTarget(
  livingMembers: readonly BattleUnitState[],
  rng: () => number,
): BattleUnitState {
  let totalWeight = 0;
  for (const m of livingMembers) {
    totalWeight += getAggroWeight(m.classKey);
  }
  let roll = clampUnit(rng()) * totalWeight;
  for (const m of livingMembers) {
    roll -= getAggroWeight(m.classKey);
    if (roll <= 0) {
      return m;
    }
  }
  return livingMembers[livingMembers.length - 1]!;
}

export function simulateCoopRaidBattle(
  party: readonly CoopPartyMemberInput[],
  tier: number,
  rng: () => number = Math.random,
): CoopRaidBattleReport {
  const safeTier = Math.max(1, Math.min(10, Math.floor(tier)));
  const activePartyInputs = party.slice(0, 4);
  const partyCount = activePartyInputs.length;
  const synergyPct = getPartySynergyBonusPct(partyCount);
  const synergyMult = 1 + synergyPct / 100;

  const bossSnapshot = buildCoopRaidBossCombatant(safeTier, Math.max(2, partyCount));
  const boss = createUnitState(bossSnapshot);

  if (partyCount === 0) {
    return {
      succeeded: false,
      tier: safeTier,
      bossName: boss.name,
      bossMaxHp: boss.maxHp,
      bossRemainingHp: boss.maxHp,
      roundsPlayed: 0,
      partySynergyBonusPct: 0,
      mvpUserId: null,
      members: [],
      totalPartyDamage: 0,
      highlights: [
        `🐉 **团本集结**：${boss.name} 盘踞深渊王座。`,
        '⚠️ 队伍无人出战，讨伐未能展开。',
        '🛡️ 请至少集结 2 名勇者后再发起冲锋。',
        `📊 首领生命：${boss.maxHp}/${boss.maxHp}。`,
        '💡 提示：3 分钟招募期满将自动征召公会雇佣兵助战。',
        '🏳️ 本次团本行动已中止。',
      ],
    };
  }

  const members = activePartyInputs.map((member) =>
    createUnitState(member, Boolean(member.isMercenary), synergyMult),
  );

  const log = new HighlightLogCollector();
  log.push(
    4,
    `🐉 **集结开荒**：${partyCount} 人小队迎战 **${boss.name}**（羁绊增幅 **+${synergyPct}%**）！`,
  );

  for (const member of members) {
    applyPreBattlePassives(member, log);
  }
  applyPreBattlePassives(boss, log);

  const orderedBySpeed = [...members].sort(
    (a, b) => CLASS_MODELS[b.classKey].initiative - CLASS_MODELS[a.classKey].initiative,
  );

  let roundsPlayed = 0;
  for (let round = 1; round <= MAX_BATTLE_ROUNDS; round++) {
    const anyAlive = members.some((m) => m.hp > 0);
    if (!anyAlive || boss.hp <= 0) break;
    roundsPlayed = round;

    for (const member of members) {
      refreshPeriodicTitanShield(member, round, log);
    }
    refreshPeriodicTitanShield(boss, round, log);

    // Party members act in initiative order
    for (const member of orderedBySpeed) {
      if (boss.hp <= 0) break;
      if (member.hp <= 0) continue;
      executeFighterTurn(member, boss, round, rng, log, members);
    }

    // Boss acts if still alive: AoE roar on ultimate, or frontline-weighted strike + cleave
    if (boss.hp > 0) {
      const living = members.filter((m) => m.hp > 0);
      if (living.length > 0) {
        boss.rage = Math.min(140, boss.rage + 16);
        if (boss.rage >= 100) {
          boss.rage = Math.max(0, boss.rage - 100);
          const hasLivingFrontline = living.some((m) => getPartyRole(m.classKey) === 'frontline');
          let totalAoe = 0;
          for (const target of living) {
            const isFront = getPartyRole(target.classKey) === 'frontline';
            const roleMult = isFront ? 1.3 : hasLivingFrontline ? 0.38 : 0.85;
            const res = executeSingleStrike(
              boss,
              target,
              {
                round,
                multiplier: 1.25 * roleMult,
                canDodge: false,
                extraArmorPenBp: 1500,
                allowCombo: false,
                allowThorns: true,
              },
              rng,
              log,
            );
            totalAoe += res.damage;
          }
          log.push(
            4,
            `🌋 [R${round}] **首领狂暴震击**：${boss.name} 席卷全队，合计造成 **${totalAoe}** 毁灭伤害！`,
          );
        } else {
          boss.rage = Math.min(140, boss.rage + 24);
          const mainTarget = pickWeightedTarget(living, rng);
          executeSingleStrike(
            boss,
            mainTarget,
            {
              round,
              multiplier: 1.15,
              canDodge: true,
              extraArmorPenBp: 0,
              allowCombo: true,
              allowThorns: true,
            },
            rng,
            log,
          );
        }
      }
    }

    for (const member of members) {
      if (member.armorBreakRounds > 0) member.armorBreakRounds -= 1;
    }
    if (boss.armorBreakRounds > 0) boss.armorBreakRounds -= 1;
  }

  const succeeded = boss.hp <= 0;
  let totalPartyDamage = 0;
  let mvpUserId: string | null = null;
  let bestContribution = -1;

  const memberStats: CoopMemberBattleStat[] = members.map((m) => {
    totalPartyDamage += m.totalDamageDealt;
    const contribution =
      m.totalDamageDealt + m.totalDamageTaken * 0.25 + m.totalHealedAndShielded * 0.2;
    if (contribution > bestContribution) {
      bestContribution = contribution;
      mvpUserId = m.id;
    }
    return {
      userId: m.id,
      name: m.name,
      classKey: m.classKey,
      isMercenary: m.isMercenary,
      role: getPartyRole(m.classKey),
      remainingHp: m.hp,
      maxHp: m.maxHp,
      damageDealt: m.totalDamageDealt,
      damageTaken: m.totalDamageTaken,
      healedAndShielded: m.totalHealedAndShielded,
    };
  });

  const mvpMember = memberStats.find((m) => m.userId === mvpUserId) ?? memberStats[0]!;

  if (succeeded) {
    log.push(
      5,
      `🏆 **团本告捷**：第 ${roundsPlayed} 回合成功讨伐 **${boss.name}**！全场 MVP：**${mvpMember.name}**（输出 ${mvpMember.damageDealt}）！`,
    );
  } else {
    log.push(
      5,
      `💀 **讨伐受挫**：鏖战 ${roundsPlayed} 回合未能击倒 **${boss.name}**（首领余血 ${boss.hp}/${boss.maxHp}）！`,
    );
  }

  const frontline = memberStats.find((m) => m.role === 'frontline') ?? memberStats[0]!;
  const fallbackRaidLines: string[] = [
    `🛡️ **前排承伤**：${frontline.name} 顶在战线最前方，累计扛下 **${frontline.damageTaken}** 伤害。`,
    `⚔️ **团队火力**：小队合计倾泻 **${totalPartyDamage}** 总伤害，MVP **${mvpMember.name}** 贡献突出。`,
    `✨ **阵容羁绊**：${partyCount} 人编队激活 **+${synergyPct}%** 全属性协同光环。`,
    `📊 **首领态势**：${boss.name} 最终剩余生命 **${boss.hp}/${boss.maxHp}**（共 ${roundsPlayed} 回合）。`,
  ];

  return {
    succeeded,
    tier: safeTier,
    bossName: boss.name,
    bossMaxHp: boss.maxHp,
    bossRemainingHp: boss.hp,
    roundsPlayed,
    partySynergyBonusPct: synergyPct,
    mvpUserId,
    members: memberStats,
    totalPartyDamage,
    highlights: log.finalize(fallbackRaidLines, 6, 8),
  };
}
