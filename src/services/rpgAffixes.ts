import type { RpgClassKey, RpgItemRarity } from '../db/repositories/rpgRepo.js';

export type RpgAffixKind =
  | 'lifesteal'
  | 'combo'
  | 'thorns'
  | 'crit_dmg'
  | 'armor_pen'
  | 'dodge'
  | 'dmg_reduce'
  | 'greed';

export interface RpgAffix {
  kind: RpgAffixKind;
  /** Basis points where 100 bp = 1% */
  valueBp: number;
}

export type RpgLegendaryEffect =
  | 'phoenix_rebirth'
  | 'twin_meteor'
  | 'ancestral_war_cry'
  | 'godslayer_execute'
  | 'titan_aegis'
  | 'abyss_soul_drain';

export const RPG_AFFIX_KINDS: readonly RpgAffixKind[] = [
  'lifesteal',
  'combo',
  'thorns',
  'crit_dmg',
  'armor_pen',
  'dodge',
  'dmg_reduce',
  'greed',
];

export const RPG_LEGENDARY_EFFECTS: readonly RpgLegendaryEffect[] = [
  'phoenix_rebirth',
  'twin_meteor',
  'ancestral_war_cry',
  'godslayer_execute',
  'titan_aegis',
  'abyss_soul_drain',
];

const AFFIX_KIND_SET: ReadonlySet<string> = new Set<string>(RPG_AFFIX_KINDS);
const LEGENDARY_EFFECT_SET: ReadonlySet<string> = new Set<string>(RPG_LEGENDARY_EFFECTS);

export interface AffixMeta {
  kind: RpgAffixKind;
  name: string;
  shortLabel: string;
  emoji: string;
  description: string;
  normalRangeBp: readonly [number, number];
  legendaryRangeBp: readonly [number, number];
  capBp: number;
}

export const AFFIX_META: Record<RpgAffixKind, AffixMeta> = {
  lifesteal: {
    kind: 'lifesteal',
    name: '嗜血',
    shortLabel: '吸血',
    emoji: '🩸',
    description: '攻击造成伤害时按比例回复自身生命',
    normalRangeBp: [300, 800],
    legendaryRangeBp: [900, 1400],
    capBp: 3500,
  },
  combo: {
    kind: 'combo',
    name: '疾风',
    shortLabel: '连击',
    emoji: '🌪️',
    description: '普攻概率追加一记65%威力的疾风连击',
    normalRangeBp: [500, 1200],
    legendaryRangeBp: [1300, 2000],
    capBp: 5000,
  },
  thorns: {
    kind: 'thorns',
    name: '荆棘',
    shortLabel: '反伤',
    emoji: '🌵',
    description: '受击时向攻击者反弹税前伤害比例',
    normalRangeBp: [500, 1300],
    legendaryRangeBp: [1400, 2200],
    capBp: 5500,
  },
  crit_dmg: {
    kind: 'crit_dmg',
    name: '狂暴',
    shortLabel: '暴伤',
    emoji: '💥',
    description: '暴击时额外提升暴击伤害倍率',
    normalRangeBp: [1000, 2500],
    legendaryRangeBp: [2800, 4500],
    capBp: 12000,
  },
  armor_pen: {
    kind: 'armor_pen',
    name: '破甲',
    shortLabel: '穿甲',
    emoji: '🗡️',
    description: '攻击时无视目标对应比例的防御力',
    normalRangeBp: [600, 1500],
    legendaryRangeBp: [1600, 2600],
    capBp: 6500,
  },
  dodge: {
    kind: 'dodge',
    name: '幻影',
    shortLabel: '闪避',
    emoji: '💨',
    description: '额外提高闪避敌方攻击的概率',
    normalRangeBp: [300, 800],
    legendaryRangeBp: [900, 1400],
    capBp: 3500,
  },
  dmg_reduce: {
    kind: 'dmg_reduce',
    name: '坚韧',
    shortLabel: '减伤',
    emoji: '🛡️',
    description: '按比例减免受到的最终伤害',
    normalRangeBp: [300, 850],
    legendaryRangeBp: [950, 1500],
    capBp: 4000,
  },
  greed: {
    kind: 'greed',
    name: '贪婪',
    shortLabel: '贪婪',
    emoji: '🪙',
    description: '提升挂机与秘境讨伐的星币及奥术魔尘收益',
    normalRangeBp: [500, 1400],
    legendaryRangeBp: [1500, 2500],
    capBp: 6000,
  },
};

export interface LegendaryEffectMeta {
  key: RpgLegendaryEffect;
  name: string;
  emoji: string;
  description: string;
}

export const LEGENDARY_EFFECT_META: Record<RpgLegendaryEffect, LegendaryEffectMeta> = {
  phoenix_rebirth: {
    key: 'phoenix_rebirth',
    name: '不灭凤羽',
    emoji: '🔥',
    description: '受到致命伤害时锁1点血免死并立刻回复25%生命（每场限1次）',
  },
  twin_meteor: {
    key: 'twin_meteor',
    name: '双生星陨',
    emoji: '☄️',
    description: '释放怒气大招时，35%概率无消耗追加一次55%威力的余波',
  },
  ancestral_war_cry: {
    key: 'ancestral_war_cry',
    name: '先祖战吼',
    emoji: '📯',
    description: '开场直接获得100满怒气，首回合起手释放招牌大招',
  },
  godslayer_execute: {
    key: 'godslayer_execute',
    name: '弑神处决',
    emoji: '⚔️',
    description: '对生命低于35%的敌人或首领造成的最终伤害+30%',
  },
  titan_aegis: {
    key: 'titan_aegis',
    name: '泰坦圣壁',
    emoji: '🛡️',
    description: '入场即获得28%最大生命护盾，且每3回合刷新一层轻型护盾',
  },
  abyss_soul_drain: {
    key: 'abyss_soul_drain',
    name: '深渊噬魂',
    emoji: '👁️',
    description: '每次暴击永久汲取目标4%攻击力（最多叠5层）',
  },
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999999, Math.max(0, value));
}

function isAffixKind(value: unknown): value is RpgAffixKind {
  return typeof value === 'string' && AFFIX_KIND_SET.has(value);
}

function isLegendaryEffect(value: unknown): value is RpgLegendaryEffect {
  return typeof value === 'string' && LEGENDARY_EFFECT_SET.has(value);
}

function createDeterministicRng(seed: number): () => number {
  let state = (Math.trunc(seed) + 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function formatBpPercent(valueBp: number): string {
  const pct = Math.max(0, valueBp) / 100;
  if (Number.isInteger(pct)) {
    return `${pct}%`;
  }
  return `${Number(pct.toFixed(1))}%`;
}

export function formatAffixTag(affix: RpgAffix): string {
  const meta = AFFIX_META[affix.kind];
  return `${meta.emoji}${meta.name}(${meta.shortLabel}+${formatBpPercent(affix.valueBp)})`;
}

export function formatAffixList(
  affixes: readonly RpgAffix[] | null | undefined,
  emptyLabel = '无',
): string {
  if (!affixes || affixes.length === 0) {
    return emptyLabel;
  }
  return affixes.map((affix) => formatAffixTag(affix)).join(' · ');
}

export function formatLegendaryEffect(
  effect: RpgLegendaryEffect | null | undefined,
  includeDescription = true,
): string {
  if (!effect || !isLegendaryEffect(effect)) {
    return '';
  }
  const meta = LEGENDARY_EFFECT_META[effect];
  if (!includeDescription) {
    return `${meta.emoji}【神铸·${meta.name}】`;
  }
  return `${meta.emoji}【神铸·${meta.name}】${meta.description}`;
}

const AFFIX_SLOT_COUNTS: Record<RpgItemRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 3,
};

export function getAffixSlotCount(rarity: RpgItemRarity): number {
  return AFFIX_SLOT_COUNTS[rarity] ?? 0;
}

function rollAffixValueBp(kind: RpgAffixKind, rarity: RpgItemRarity, rng: () => number): number {
  const meta = AFFIX_META[kind];
  const [minBp, maxBp] = rarity === 'legendary' ? meta.legendaryRangeBp : meta.normalRangeBp;
  const step = 25;
  const totalSteps = Math.max(0, Math.floor((maxBp - minBp) / step));
  const pickedStep = Math.floor(clampUnit(rng()) * (totalSteps + 1));
  return Math.min(maxBp, minBp + pickedStep * step);
}

export function rollRandomAffixes(
  rarity: RpgItemRarity,
  rng: () => number = Math.random,
  lockedAffix?: RpgAffix | null,
): RpgAffix[] {
  const slotCount = getAffixSlotCount(rarity);
  if (slotCount <= 0) {
    return [];
  }

  const result: RpgAffix[] = [];
  const pool: RpgAffixKind[] = [...RPG_AFFIX_KINDS];

  if (lockedAffix && isAffixKind(lockedAffix.kind) && Number.isFinite(lockedAffix.valueBp)) {
    const safeBp = Math.max(1, Math.round(lockedAffix.valueBp));
    result.push({ kind: lockedAffix.kind, valueBp: safeBp });
    const idx = pool.indexOf(lockedAffix.kind);
    if (idx >= 0) {
      pool.splice(idx, 1);
    }
  }

  while (result.length < slotCount && pool.length > 0) {
    const pickIdx = Math.min(pool.length - 1, Math.floor(clampUnit(rng()) * pool.length));
    const kind = pool.splice(pickIdx, 1)[0]!;
    const valueBp = rollAffixValueBp(kind, rarity, rng);
    result.push({ kind, valueBp });
  }

  return result;
}

export function rollLegendaryEffect(rng: () => number = Math.random): RpgLegendaryEffect {
  const idx = Math.min(
    RPG_LEGENDARY_EFFECTS.length - 1,
    Math.floor(clampUnit(rng()) * RPG_LEGENDARY_EFFECTS.length),
  );
  return RPG_LEGENDARY_EFFECTS[idx]!;
}

export function awakenLegacyItemAffixes(item: { id: number; rarity: RpgItemRarity }): {
  affixes: RpgAffix[];
  legendaryEffect: RpgLegendaryEffect | null;
} {
  const rng = createDeterministicRng(item.id);
  const affixes = rollRandomAffixes(item.rarity, rng);
  const legendaryEffect = item.rarity === 'legendary' ? rollLegendaryEffect(rng) : null;
  return { affixes, legendaryEffect };
}

export function parseAffixesJson(raw: string | null | undefined): RpgAffix[] {
  if (!raw || typeof raw !== 'string') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const seen = new Set<RpgAffixKind>();
  const valid: RpgAffix[] = [];

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const kind = candidate.kind;
    const valueBp = candidate.valueBp;
    if (!isAffixKind(kind) || seen.has(kind)) {
      continue;
    }
    if (typeof valueBp !== 'number' || !Number.isFinite(valueBp) || valueBp <= 0) {
      continue;
    }
    seen.add(kind);
    valid.push({
      kind,
      valueBp: Math.min(AFFIX_META[kind].capBp, Math.max(1, Math.round(valueBp))),
    });
  }

  return valid;
}

export function parseLegendaryEffect(raw: string | null | undefined): RpgLegendaryEffect | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return isLegendaryEffect(trimmed) ? trimmed : null;
}

const SALVAGE_DUST_BASE: Record<RpgItemRarity, number> = {
  common: 2,
  uncommon: 5,
  rare: 12,
  epic: 30,
  legendary: 75,
};

export function getSalvageArcaneDust(item: {
  rarity: RpgItemRarity;
  enhanceLevel: number;
}): number {
  const base = SALVAGE_DUST_BASE[item.rarity] ?? 2;
  const lvl = Math.max(0, Math.floor(item.enhanceLevel));
  return Math.round(base * (1 + lvl * 0.25));
}

const REFORGE_BASE_COST: Record<
  Exclude<RpgItemRarity, 'common'>,
  { coins: number; dust: number }
> = {
  uncommon: { coins: 2000, dust: 8 },
  rare: { coins: 5000, dust: 18 },
  epic: { coins: 12000, dust: 40 },
  legendary: { coins: 28000, dust: 90 },
};

export function getReforgeCost(
  item: { rarity: RpgItemRarity; enhanceLevel?: number },
  lockAffix = false,
): { coins: number; dust: number } | null {
  if (item.rarity === 'common') {
    return null;
  }
  const base = REFORGE_BASE_COST[item.rarity];
  if (!lockAffix) {
    return { coins: base.coins, dust: base.dust };
  }
  return {
    coins: Math.round(base.coins * 2.5),
    dust: Math.round(base.dust * 2.5),
  };
}

export interface AffixBearingItem {
  affixes?: readonly RpgAffix[] | null;
  affixesJson?: string | null;
  legendaryEffect?: RpgLegendaryEffect | string | null;
}

export interface AggregatedAffixBonuses {
  lifestealBp: number;
  comboBp: number;
  thornsBp: number;
  critDmgBp: number;
  armorPenBp: number;
  dodgeBp: number;
  dmgReduceBp: number;
  greedBp: number;
  legendaryEffects: RpgLegendaryEffect[];
}

export function createEmptyAffixBonuses(): AggregatedAffixBonuses {
  return {
    lifestealBp: 0,
    comboBp: 0,
    thornsBp: 0,
    critDmgBp: 0,
    armorPenBp: 0,
    dodgeBp: 0,
    dmgReduceBp: 0,
    greedBp: 0,
    legendaryEffects: [],
  };
}

export const EMPTY_AFFIX_BONUSES: Readonly<AggregatedAffixBonuses> = Object.freeze({
  lifestealBp: 0,
  comboBp: 0,
  thornsBp: 0,
  critDmgBp: 0,
  armorPenBp: 0,
  dodgeBp: 0,
  dmgReduceBp: 0,
  greedBp: 0,
  legendaryEffects: [],
});

function resolveItemAffixes(item: AffixBearingItem): readonly RpgAffix[] {
  if (item.affixes && Array.isArray(item.affixes)) {
    return item.affixes;
  }
  if (item.affixesJson) {
    return parseAffixesJson(item.affixesJson);
  }
  return [];
}

export function aggregateEquippedAffixes(
  items: readonly AffixBearingItem[],
): AggregatedAffixBonuses {
  const totals = createEmptyAffixBonuses();
  const seenLegendary = new Set<RpgLegendaryEffect>();

  for (const item of items) {
    const affixes = resolveItemAffixes(item);
    for (const affix of affixes) {
      if (!isAffixKind(affix.kind) || !Number.isFinite(affix.valueBp) || affix.valueBp <= 0) {
        continue;
      }
      const val = Math.round(affix.valueBp);
      switch (affix.kind) {
        case 'lifesteal':
          totals.lifestealBp += val;
          break;
        case 'combo':
          totals.comboBp += val;
          break;
        case 'thorns':
          totals.thornsBp += val;
          break;
        case 'crit_dmg':
          totals.critDmgBp += val;
          break;
        case 'armor_pen':
          totals.armorPenBp += val;
          break;
        case 'dodge':
          totals.dodgeBp += val;
          break;
        case 'dmg_reduce':
          totals.dmgReduceBp += val;
          break;
        case 'greed':
          totals.greedBp += val;
          break;
      }
    }

    const leg = parseLegendaryEffect(item.legendaryEffect ?? null);
    if (leg && !seenLegendary.has(leg)) {
      seenLegendary.add(leg);
      totals.legendaryEffects.push(leg);
    }
  }

  totals.lifestealBp = Math.min(AFFIX_META.lifesteal.capBp, totals.lifestealBp);
  totals.comboBp = Math.min(AFFIX_META.combo.capBp, totals.comboBp);
  totals.thornsBp = Math.min(AFFIX_META.thorns.capBp, totals.thornsBp);
  totals.critDmgBp = Math.min(AFFIX_META.crit_dmg.capBp, totals.critDmgBp);
  totals.armorPenBp = Math.min(AFFIX_META.armor_pen.capBp, totals.armorPenBp);
  totals.dodgeBp = Math.min(AFFIX_META.dodge.capBp, totals.dodgeBp);
  totals.dmgReduceBp = Math.min(AFFIX_META.dmg_reduce.capBp, totals.dmgReduceBp);
  totals.greedBp = Math.min(AFFIX_META.greed.capBp, totals.greedBp);

  return totals;
}

export interface ScorableRpgItem extends AffixBearingItem {
  rarity: RpgItemRarity;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseCritBp: number;
  enhanceLevel: number;
}

interface ClassScoringProfile {
  hpWeight: number;
  atkWeight: number;
  defWeight: number;
  critPctWeight: number;
  affixPctWeights: Record<RpgAffixKind, number>;
  favoredLegendaries: readonly RpgLegendaryEffect[];
}

const CLASS_SCORING_PROFILES: Record<RpgClassKey, ClassScoringProfile> = {
  warrior: {
    hpWeight: 0.72,
    atkWeight: 4.2,
    defWeight: 3.6,
    critPctWeight: 4.5,
    affixPctWeights: {
      lifesteal: 7.5,
      combo: 5.8,
      thorns: 5.5,
      crit_dmg: 4.6,
      armor_pen: 6.8,
      dodge: 4.0,
      dmg_reduce: 7.2,
      greed: 3.2,
    },
    favoredLegendaries: ['ancestral_war_cry', 'godslayer_execute', 'phoenix_rebirth'],
  },
  mage: {
    hpWeight: 0.46,
    atkWeight: 4.9,
    defWeight: 2.2,
    critPctWeight: 6.4,
    affixPctWeights: {
      lifesteal: 6.0,
      combo: 5.0,
      thorns: 3.2,
      crit_dmg: 5.8,
      armor_pen: 6.8,
      dodge: 5.0,
      dmg_reduce: 4.8,
      greed: 3.2,
    },
    favoredLegendaries: ['twin_meteor', 'ancestral_war_cry', 'abyss_soul_drain'],
  },
  ranger: {
    hpWeight: 0.5,
    atkWeight: 4.5,
    defWeight: 2.4,
    critPctWeight: 6.2,
    affixPctWeights: {
      lifesteal: 6.8,
      combo: 8.2,
      thorns: 3.2,
      crit_dmg: 5.4,
      armor_pen: 5.8,
      dodge: 9.0,
      dmg_reduce: 4.4,
      greed: 3.2,
    },
    favoredLegendaries: ['godslayer_execute', 'abyss_soul_drain', 'twin_meteor'],
  },
  paladin: {
    hpWeight: 0.78,
    atkWeight: 3.7,
    defWeight: 4.0,
    critPctWeight: 4.4,
    affixPctWeights: {
      lifesteal: 6.5,
      combo: 4.6,
      thorns: 8.2,
      crit_dmg: 4.0,
      armor_pen: 5.0,
      dodge: 4.2,
      dmg_reduce: 8.0,
      greed: 3.2,
    },
    favoredLegendaries: ['titan_aegis', 'phoenix_rebirth', 'ancestral_war_cry'],
  },
};

const RARITY_SCORE_BONUS: Record<RpgItemRarity, number> = {
  common: 0,
  uncommon: 8,
  rare: 18,
  epic: 32,
  legendary: 55,
};

export function computeClassAwareItemScore(item: ScorableRpgItem, classKey: RpgClassKey): number {
  const profile = CLASS_SCORING_PROFILES[classKey];
  const mult = 1 + Math.max(0, item.enhanceLevel) * 0.15;
  const effHp = Math.round(item.baseHp * mult);
  const effAtk = Math.round(item.baseAtk * mult);
  const effDef = Math.round(item.baseDef * mult);
  const effCritBp = Math.round(item.baseCritBp * mult);

  let score =
    effHp * profile.hpWeight +
    effAtk * profile.atkWeight +
    effDef * profile.defWeight +
    (effCritBp / 100) * profile.critPctWeight +
    RARITY_SCORE_BONUS[item.rarity];

  const affixes = resolveItemAffixes(item);
  for (const affix of affixes) {
    if (!isAffixKind(affix.kind) || !Number.isFinite(affix.valueBp) || affix.valueBp <= 0) {
      continue;
    }
    const pct = affix.valueBp / 100;
    score += pct * profile.affixPctWeights[affix.kind];
  }

  const leg = parseLegendaryEffect(item.legendaryEffect ?? null);
  if (leg) {
    score += 95;
    if (profile.favoredLegendaries.includes(leg)) {
      score += 25;
    }
  }

  return Math.round(score * 100) / 100;
}
