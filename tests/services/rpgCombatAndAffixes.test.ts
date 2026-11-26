import { describe, expect, it } from 'vitest';
import { RPG_CLASSES, RPG_TIERS } from '../../src/services/rpgService.js';
import {
  AFFIX_META,
  aggregateEquippedAffixes,
  awakenLegacyItemAffixes,
  computeClassAwareItemScore,
  createEmptyAffixBonuses,
  formatAffixList,
  formatAffixTag,
  formatLegendaryEffect,
  getAffixSlotCount,
  getReforgeCost,
  getSalvageArcaneDust,
  LEGENDARY_EFFECT_META,
  parseAffixesJson,
  parseLegendaryEffect,
  rollLegendaryEffect,
  rollRandomAffixes,
  RPG_AFFIX_KINDS,
  RPG_LEGENDARY_EFFECTS,
  type RpgAffix,
  type RpgAffixKind,
  type RpgLegendaryEffect,
} from '../../src/services/rpgAffixes.js';
import {
  buildCoopRaidBossCombatant,
  buildEqualizedCombatant,
  buildTierBossCombatant,
  EQUALIZED_TEMPLATE_LEVEL,
  MAX_BATTLE_ROUNDS,
  simulateCoopRaidBattle,
  simulateRpgBattle,
  type CombatantSnapshot,
  type CoopPartyMemberInput,
} from '../../src/services/rpgCombatEngine.js';
import type { RpgClassKey, RpgItemRarity } from '../../src/db/repositories/rpgRepo.js';

function makeLcgRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function makeCombatant(overrides: Partial<CombatantSnapshot> = {}): CombatantSnapshot {
  return {
    id: 'hero-1',
    name: '测试勇者',
    classKey: 'warrior',
    level: 45,
    maxHp: 1800,
    atk: 300,
    def: 140,
    critBp: 2000,
    dodgeBp: 500,
    affixes: createEmptyAffixBonuses(),
    pet: null,
    ...overrides,
  };
}

describe('rpgAffixes — Diablo-style affixes, legendary effects, salvage dust & reforge', () => {
  it('defines all 8 affixes and 6 legendary effects with Chinese metadata and formatting', () => {
    expect(RPG_AFFIX_KINDS).toEqual([
      'lifesteal',
      'combo',
      'thorns',
      'crit_dmg',
      'armor_pen',
      'dodge',
      'dmg_reduce',
      'greed',
    ]);
    expect(RPG_LEGENDARY_EFFECTS).toEqual([
      'phoenix_rebirth',
      'twin_meteor',
      'ancestral_war_cry',
      'godslayer_execute',
      'titan_aegis',
      'abyss_soul_drain',
    ]);

    for (const kind of RPG_AFFIX_KINDS) {
      const meta = AFFIX_META[kind];
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.emoji.length).toBeGreaterThan(0);
      expect(meta.legendaryRangeBp[0]).toBeGreaterThan(meta.normalRangeBp[1]);
      expect(meta.capBp).toBeGreaterThan(meta.legendaryRangeBp[1]);
    }

    for (const effect of RPG_LEGENDARY_EFFECTS) {
      const meta = LEGENDARY_EFFECT_META[effect];
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(formatLegendaryEffect(effect)).toContain(meta.name);
    }

    expect(formatLegendaryEffect(null)).toBe('');
    expect(formatLegendaryEffect(undefined)).toBe('');

    const sampleAffixes: RpgAffix[] = [
      { kind: 'lifesteal', valueBp: 850 },
      { kind: 'crit_dmg', valueBp: 3000 },
    ];
    expect(formatAffixTag(sampleAffixes[0]!)).toContain('嗜血');
    expect(formatAffixTag(sampleAffixes[0]!)).toContain('8.5%');
    expect(formatAffixList(sampleAffixes)).toContain('嗜血');
    expect(formatAffixList(sampleAffixes)).toContain('狂暴');
    expect(formatAffixList([])).toBe('无');
  });

  it('returns correct affix slot counts and rolls unique affixes with higher legendary ranges', () => {
    expect(getAffixSlotCount('common')).toBe(0);
    expect(getAffixSlotCount('uncommon')).toBe(1);
    expect(getAffixSlotCount('rare')).toBe(2);
    expect(getAffixSlotCount('epic')).toBe(3);
    expect(getAffixSlotCount('legendary')).toBe(3);

    const rng = makeLcgRng(42);
    expect(rollRandomAffixes('common', rng)).toEqual([]);

    for (let i = 0; i < 30; i++) {
      const epicAffixes = rollRandomAffixes('epic', rng);
      expect(epicAffixes).toHaveLength(3);
      expect(new Set(epicAffixes.map((a) => a.kind)).size).toBe(3);
      for (const a of epicAffixes) {
        const [minBp, maxBp] = AFFIX_META[a.kind].normalRangeBp;
        expect(a.valueBp).toBeGreaterThanOrEqual(minBp);
        expect(a.valueBp).toBeLessThanOrEqual(maxBp);
      }

      const legAffixes = rollRandomAffixes('legendary', rng);
      expect(legAffixes).toHaveLength(3);
      expect(new Set(legAffixes.map((a) => a.kind)).size).toBe(3);
      for (const a of legAffixes) {
        const [minBp, maxBp] = AFFIX_META[a.kind].legendaryRangeBp;
        expect(a.valueBp).toBeGreaterThanOrEqual(minBp);
        expect(a.valueBp).toBeLessThanOrEqual(maxBp);
      }
    }

    // Locked affix preserved without duplicating its kind
    const locked: RpgAffix = { kind: 'greed', valueBp: 2200 };
    for (let i = 0; i < 20; i++) {
      const reforged = rollRandomAffixes('legendary', rng, locked);
      expect(reforged).toHaveLength(3);
      expect(reforged[0]).toEqual(locked);
      expect(new Set(reforged.map((a) => a.kind)).size).toBe(3);
    }

    const rolledEffects = new Set<RpgLegendaryEffect>();
    for (let i = 0; i < 60; i++) {
      rolledEffects.add(rollLegendaryEffect(rng));
    }
    expect(rolledEffects.size).toBe(6);
  });

  it('awakens legacy items deterministically and parses JSON safely', () => {
    const commonAwaken = awakenLegacyItemAffixes({ id: 101, rarity: 'common' });
    expect(commonAwaken).toEqual({ affixes: [], legendaryEffect: null });

    const epicAwaken1 = awakenLegacyItemAffixes({ id: 202, rarity: 'epic' });
    const epicAwaken2 = awakenLegacyItemAffixes({ id: 202, rarity: 'epic' });
    expect(epicAwaken1).toEqual(epicAwaken2);
    expect(epicAwaken1.affixes).toHaveLength(3);
    expect(epicAwaken1.legendaryEffect).toBeNull();

    const legAwaken1 = awakenLegacyItemAffixes({ id: 303, rarity: 'legendary' });
    const legAwaken2 = awakenLegacyItemAffixes({ id: 303, rarity: 'legendary' });
    const legAwakenOther = awakenLegacyItemAffixes({ id: 304, rarity: 'legendary' });
    expect(legAwaken1).toEqual(legAwaken2);
    expect(legAwaken1.affixes).toHaveLength(3);
    expect(legAwaken1.legendaryEffect).not.toBeNull();
    expect(JSON.stringify(legAwaken1)).not.toEqual(JSON.stringify(legAwakenOther));

    expect(parseAffixesJson(null)).toEqual([]);
    expect(parseAffixesJson('{bad json')).toEqual([]);
    expect(parseAffixesJson('{"not":"array"}')).toEqual([]);
    expect(
      parseAffixesJson(
        JSON.stringify([
          { kind: 'lifesteal', valueBp: 900 },
          { kind: 'lifesteal', valueBp: 1200 },
          { kind: 'unknown_kind', valueBp: 500 },
          { kind: 'combo', valueBp: -10 },
          { kind: 'thorns', valueBp: 1100.4 },
        ]),
      ),
    ).toEqual([
      { kind: 'lifesteal', valueBp: 900 },
      { kind: 'thorns', valueBp: 1100 },
    ]);

    expect(parseLegendaryEffect('phoenix_rebirth')).toBe('phoenix_rebirth');
    expect(parseLegendaryEffect('invalid_effect')).toBeNull();
    expect(parseLegendaryEffect(null)).toBeNull();
  });

  it('computes salvage arcane dust and reforge costs accurately', () => {
    const baseDust: Record<RpgItemRarity, number> = {
      common: 2,
      uncommon: 5,
      rare: 12,
      epic: 30,
      legendary: 75,
    };
    for (const [rarity, expected] of Object.entries(baseDust) as Array<[RpgItemRarity, number]>) {
      expect(getSalvageArcaneDust({ rarity, enhanceLevel: 0 })).toBe(expected);
      expect(getSalvageArcaneDust({ rarity, enhanceLevel: 4 })).toBe(expected * 2);
    }
    expect(getSalvageArcaneDust({ rarity: 'legendary', enhanceLevel: 10 })).toBe(
      Math.round(75 * (1 + 10 * 0.25)),
    );

    expect(getReforgeCost({ rarity: 'common', enhanceLevel: 5 }, false)).toBeNull();
    expect(getReforgeCost({ rarity: 'uncommon', enhanceLevel: 0 }, false)).toEqual({
      coins: 2000,
      dust: 8,
    });
    expect(getReforgeCost({ rarity: 'rare', enhanceLevel: 3 }, false)).toEqual({
      coins: 5000,
      dust: 18,
    });
    expect(getReforgeCost({ rarity: 'epic', enhanceLevel: 7 }, false)).toEqual({
      coins: 12000,
      dust: 40,
    });
    expect(getReforgeCost({ rarity: 'legendary', enhanceLevel: 10 }, false)).toEqual({
      coins: 28000,
      dust: 90,
    });
    expect(getReforgeCost({ rarity: 'legendary', enhanceLevel: 10 }, true)).toEqual({
      coins: 70000,
      dust: 225,
    });
    expect(getReforgeCost({ rarity: 'rare', enhanceLevel: 0 }, true)).toEqual({
      coins: 12500,
      dust: 45,
    });
  });

  it('aggregates equipped affixes with caps, deduplicates legendary effects, and scores items per class', () => {
    const bonus = aggregateEquippedAffixes([
      {
        affixes: [
          { kind: 'lifesteal', valueBp: 2500 },
          { kind: 'crit_dmg', valueBp: 8000 },
        ],
        legendaryEffect: 'phoenix_rebirth',
      },
      {
        affixes: [
          { kind: 'lifesteal', valueBp: 2500 },
          { kind: 'crit_dmg', valueBp: 8000 },
          { kind: 'greed', valueBp: 2000 },
        ],
        legendaryEffect: 'phoenix_rebirth',
      },
      {
        affixesJson: JSON.stringify([{ kind: 'dodge', valueBp: 1100 }]),
        legendaryEffect: 'twin_meteor',
      },
    ]);

    expect(bonus.lifestealBp).toBe(AFFIX_META.lifesteal.capBp);
    expect(bonus.critDmgBp).toBe(AFFIX_META.crit_dmg.capBp);
    expect(bonus.greedBp).toBe(2000);
    expect(bonus.dodgeBp).toBe(1100);
    expect(bonus.legendaryEffects).toEqual(['phoenix_rebirth', 'twin_meteor']);

    const agileRing = {
      rarity: 'epic' as const,
      baseHp: 40,
      baseAtk: 35,
      baseDef: 5,
      baseCritBp: 900,
      enhanceLevel: 5,
      affixes: [
        { kind: 'dodge' as RpgAffixKind, valueBp: 800 },
        { kind: 'combo' as RpgAffixKind, valueBp: 1200 },
      ],
      legendaryEffect: null,
    };
    const tankArmor = {
      rarity: 'epic' as const,
      baseHp: 220,
      baseAtk: 10,
      baseDef: 45,
      baseCritBp: 0,
      enhanceLevel: 5,
      affixes: [
        { kind: 'thorns' as RpgAffixKind, valueBp: 1200 },
        { kind: 'dmg_reduce' as RpgAffixKind, valueBp: 800 },
      ],
      legendaryEffect: null,
    };

    expect(computeClassAwareItemScore(agileRing, 'ranger')).toBeGreaterThan(
      computeClassAwareItemScore(tankArmor, 'ranger'),
    );
    expect(computeClassAwareItemScore(tankArmor, 'paladin')).toBeGreaterThan(
      computeClassAwareItemScore(agileRing, 'paladin'),
    );

    const withLegendary = {
      ...agileRing,
      rarity: 'legendary' as const,
      legendaryEffect: 'godslayer_execute' as const,
    };
    expect(computeClassAwareItemScore(withLegendary, 'ranger')).toBeGreaterThan(
      computeClassAwareItemScore(agileRing, 'ranger') + 80,
    );
  });
});

describe('rpgCombatEngine — Equalizer, 4 Class Archetypes, 8 Affixes, 6 Legendaries & Co-op Raids', () => {
  it('stays synchronized with RPG_CLASSES and RPG_TIERS definitions', () => {
    for (const tierDef of RPG_TIERS) {
      const normalBoss = buildTierBossCombatant(tierDef.tier, 'normal');
      const abyssBoss = buildTierBossCombatant(tierDef.tier, 'abyss');
      expect(normalBoss.name).toContain(tierDef.bossName);
      expect(abyssBoss.name).toContain(tierDef.bossName);
      expect(abyssBoss.maxHp).toBeGreaterThan(normalBoss.maxHp * 2);
      expect(abyssBoss.atk).toBeGreaterThan(normalBoss.atk * 1.8);
    }

    const classKeys: RpgClassKey[] = RPG_CLASSES.map((c) => c.key);
    expect(classKeys).toEqual(['warrior', 'mage', 'ranger', 'paladin']);
  });

  it('equalizes low-level and max-level heroes to templateLevel=45 while preserving class & enhance ratios', () => {
    const lv1Warrior = makeCombatant({
      id: 'w1',
      classKey: 'warrior',
      level: 1,
      maxHp: 170,
      atk: 24,
      def: 14,
      critBp: 1000,
      dodgeBp: 500,
    });
    const lv90NakedWarrior = makeCombatant({
      id: 'w90',
      classKey: 'warrior',
      level: 90,
      maxHp: 170 + 89 * 26,
      atk: Math.round(24 + 89 * 4.5),
      def: Math.round(14 + 89 * 2.8),
      critBp: 1000 + 89 * 25,
      dodgeBp: 500,
    });
    const lv90WhaleWarrior = makeCombatant({
      id: 'w90-god',
      classKey: 'warrior',
      level: 90,
      maxHp: 5600,
      atk: 1200,
      def: 550,
      critBp: 4800,
      dodgeBp: 500,
      affixes: {
        ...createEmptyAffixBonuses(),
        lifestealBp: 1200,
        legendaryEffects: ['phoenix_rebirth'],
      },
    });
    const lv1Mage = makeCombatant({
      id: 'm1',
      classKey: 'mage',
      level: 1,
      maxHp: 115,
      atk: 34,
      def: 7,
      critBp: 1600,
      dodgeBp: 700,
    });

    const eqW1 = buildEqualizedCombatant(lv1Warrior);
    const eqW90Naked = buildEqualizedCombatant(lv90NakedWarrior);
    const eqW90Whale = buildEqualizedCombatant(lv90WhaleWarrior);
    const eqM1 = buildEqualizedCombatant(lv1Mage);

    expect(eqW1.level).toBe(EQUALIZED_TEMPLATE_LEVEL);
    expect(eqW1.maxHp).toBe(eqW90Naked.maxHp);
    expect(eqW1.atk).toBe(eqW90Naked.atk);
    expect(eqW1.def).toBe(eqW90Naked.def);

    // Whale keeps a fair enhance edge (<35%) rather than 50x blowout, plus affixes & legendaries
    expect(eqW90Whale.atk).toBeGreaterThan(eqW90Naked.atk);
    expect(eqW90Whale.atk).toBeLessThan(Math.round(eqW90Naked.atk * 1.4));
    expect(eqW90Whale.affixes.lifestealBp).toBe(1200);
    expect(eqW90Whale.affixes.legendaryEffects).toEqual(['phoenix_rebirth']);

    // Class identity preserved: Warrior has more HP/DEF; Mage has more ATK/Crit
    expect(eqW1.maxHp).toBeGreaterThan(eqM1.maxHp);
    expect(eqW1.def).toBeGreaterThan(eqM1.def);
    expect(eqM1.atk).toBeGreaterThan(eqW1.atk);
    expect(eqM1.critBp).toBeGreaterThan(eqW1.critBp);
  });

  it('triggers all 4 class ultimates and passives authentically', () => {
    const rng = makeLcgRng(1001);

    // 1. Mage Ultimate (陨星火球) ignores dodge & pierces heavy armor
    const mage = makeCombatant({
      id: 'mage',
      name: '奥术魔导',
      classKey: 'mage',
      atk: 380,
      critBp: 5000,
      affixes: {
        ...createEmptyAffixBonuses(),
        legendaryEffects: ['ancestral_war_cry'],
      },
    });
    const evasiveTarget = makeCombatant({
      id: 'dodge-dummy',
      name: '幻影木桩',
      classKey: 'ranger',
      maxHp: 3000,
      atk: 50,
      def: 300,
      dodgeBp: 5000,
      affixes: { ...createEmptyAffixBonuses(), dodgeBp: 3500 },
    });
    const mageReport = simulateRpgBattle(mage, evasiveTarget, { maxRounds: 1, rng });
    expect(mageReport.leftTotalDamage).toBeGreaterThan(450);
    expect(mageReport.highlights.some((line) => line.includes('陨星火球'))).toBe(true);

    // 2. Ranger Passive (幻影追猎) dodges and fires counter-arrow + Ultimate (穿云连射)
    const ranger = makeCombatant({
      id: 'ranger',
      name: '疾风游侠',
      classKey: 'ranger',
      maxHp: 1800,
      atk: 320,
      dodgeBp: 5000,
      affixes: {
        ...createEmptyAffixBonuses(),
        dodgeBp: 3500,
        comboBp: 2500,
        legendaryEffects: ['ancestral_war_cry'],
      },
    });
    const slowBrute = makeCombatant({
      id: 'brute',
      name: '笨重巨魔',
      classKey: 'warrior',
      maxHp: 2600,
      atk: 200,
      def: 90,
      dodgeBp: 0,
    });
    const rangerReport = simulateRpgBattle(ranger, slowBrute, { rng: makeLcgRng(77) });
    expect(rangerReport.winner).toBe('left');
    expect(
      rangerReport.highlights.some(
        (line) => line.includes('穿云连射') || line.includes('幻影追猎'),
      ),
    ).toBe(true);

    // 3. Paladin Ultimate (圣光裁决) shield+heal & Passive (圣盾荆棘) reflects damage + blocks warrior armor break
    const paladin = makeCombatant({
      id: 'paladin',
      name: '辉光骑士',
      classKey: 'paladin',
      maxHp: 2200,
      atk: 260,
      def: 190,
      affixes: {
        ...createEmptyAffixBonuses(),
        thornsBp: 1800,
        legendaryEffects: ['titan_aegis', 'ancestral_war_cry'],
      },
    });
    const warrior = makeCombatant({
      id: 'warrior',
      name: '狂战先锋',
      classKey: 'warrior',
      maxHp: 1900,
      atk: 290,
      def: 140,
      affixes: {
        ...createEmptyAffixBonuses(),
        legendaryEffects: ['ancestral_war_cry'],
      },
    });
    const palReport = simulateRpgBattle(paladin, warrior, { rng: makeLcgRng(314) });
    expect(palReport.leftTotalDamage).toBeGreaterThan(0);
    expect(palReport.highlights.length).toBeGreaterThanOrEqual(6);
    expect(palReport.highlights.length).toBeLessThanOrEqual(8);
  });

  it('applies all 6 legendary effects, affixes, pet assist, and 12-round draw cap', () => {
    // Phoenix Rebirth saves from lethal blow once
    const phoenixHero = makeCombatant({
      id: 'phoenix',
      name: '涅槃勇者',
      classKey: 'mage',
      maxHp: 500,
      atk: 80,
      def: 20,
      dodgeBp: 0,
      affixes: {
        ...createEmptyAffixBonuses(),
        legendaryEffects: ['phoenix_rebirth'],
      },
    });
    const oneShotter = makeCombatant({
      id: 'executioner',
      name: '毁灭暴君',
      classKey: 'warrior',
      maxHp: 5000,
      atk: 2000,
      def: 200,
      critBp: 0,
      dodgeBp: 0,
    });

    // Over 1 round, executioner strikes once -> phoenixHero survives with >1 HP!
    const oneRoundPhoenix = simulateRpgBattle(phoenixHero, oneShotter, {
      maxRounds: 1,
      rng: () => 0.5,
    });
    expect(oneRoundPhoenix.leftRemainingHp).toBeGreaterThan(100);
    expect(oneRoundPhoenix.winner).toBe('draw');
    expect(oneRoundPhoenix.highlights.some((l) => l.includes('不灭凤羽'))).toBe(true);

    // Over full fight, second lethal blow finishes phoenixHero off
    const fullPhoenix = simulateRpgBattle(phoenixHero, oneShotter, { rng: () => 0.5 });
    expect(fullPhoenix.winner).toBe('right');
    expect(fullPhoenix.leftRemainingHp).toBe(0);

    // Twin Meteor + Abyss Soul Drain + Godslayer Execute + Lifesteal + Pet Assist
    const stackedHero = makeCombatant({
      id: 'stacked',
      name: '星陨战神',
      classKey: 'mage',
      maxHp: 2000,
      atk: 360,
      def: 120,
      critBp: 8500,
      affixes: {
        ...createEmptyAffixBonuses(),
        lifestealBp: 1500,
        critDmgBp: 3500,
        armorPenBp: 2000,
        comboBp: 2000,
        legendaryEffects: [
          'ancestral_war_cry',
          'twin_meteor',
          'godslayer_execute',
          'abyss_soul_drain',
        ],
      },
      pet: {
        nickname: '小火龙',
        emoji: '🐉',
        assistChance: 1.0,
        assistDamage: 95,
      },
    });
    const sandbag = makeCombatant({
      id: 'sandbag',
      name: '深渊巨像',
      classKey: 'warrior',
      maxHp: 2400,
      atk: 220,
      def: 160,
      dodgeBp: 0,
    });
    const stackedReport = simulateRpgBattle(stackedHero, sandbag, { rng: () => 0.1 });
    expect(stackedReport.winner).toBe('left');
    expect(stackedReport.rating).toBe('SSS');
    expect(stackedReport.highlights.some((l) => l.includes('双生星陨') || l.includes('小火龙'))).toBe(
      true,
    );

    // 12-round cap returns draw when neither dies
    const wallA = makeCombatant({ id: 'a', name: '叹息之墙甲', maxHp: 99999, atk: 10, def: 500 });
    const wallB = makeCombatant({ id: 'b', name: '叹息之墙乙', maxHp: 99999, atk: 10, def: 500 });
    const drawReport = simulateRpgBattle(wallA, wallB, { rng: makeLcgRng(9) });
    expect(drawReport.roundsPlayed).toBe(MAX_BATTLE_ROUNDS);
    expect(drawReport.winner).toBe('draw');
    expect(drawReport.rating).toBe('B');
    expect(drawReport.highlights.length).toBeGreaterThanOrEqual(6);
    expect(drawReport.highlights.length).toBeLessThanOrEqual(8);
  });

  it('balances Normal vs Abyss Tier Bosses properly', () => {
    const rng = makeLcgRng(2026);
    const nakedLv1 = makeCombatant({
      id: 'lv1',
      name: '初出茅庐新兵',
      classKey: 'warrior',
      level: 1,
      maxHp: 170,
      atk: 24,
      def: 14,
      critBp: 1000,
      dodgeBp: 500,
    });
    const gearedTier1Peak = makeCombatant({
      id: 'lv9',
      name: '见习阶巅峰勇者',
      classKey: 'warrior',
      level: 9,
      maxHp: 560,
      atk: 135,
      def: 60,
      critBp: 2400,
      dodgeBp: 600,
      affixes: {
        ...createEmptyAffixBonuses(),
        lifestealBp: 1000,
        critDmgBp: 2500,
        legendaryEffects: ['phoenix_rebirth'],
      },
    });

    const tier1Normal = buildTierBossCombatant(1, 'normal');
    const tier1Abyss = buildTierBossCombatant(1, 'abyss');

    // Normal boss is comfortably cleared even by Lv.1 newcomer
    const normalRes = simulateRpgBattle(nakedLv1, tier1Normal, { rng });
    expect(normalRes.winner).toBe('left');

    // Abyss boss defeats naked Lv.1 newcomer, but falls to geared Lv.9 Tier-1 peak hero
    const abyssFail = simulateRpgBattle(nakedLv1, tier1Abyss, { rng: makeLcgRng(55) });
    expect(abyssFail.winner).not.toBe('left');
    expect(abyssFail.rating).toBe('B');

    const abyssClear = simulateRpgBattle(gearedTier1Peak, tier1Abyss, { rng: makeLcgRng(55) });
    expect(abyssClear.winner).toBe('left');
  });

  it('simulates 2-4p Co-op Raid with frontline tanking, party synergy, mercenaries & MVP', () => {
    const paladinTank: CoopPartyMemberInput = {
      ...makeCombatant({
        id: 'u-tank',
        name: '圣盾铁卫',
        classKey: 'paladin',
        level: 45,
        maxHp: 2600,
        atk: 260,
        def: 220,
        affixes: {
          ...createEmptyAffixBonuses(),
          thornsBp: 1600,
          dmgReduceBp: 1000,
          legendaryEffects: ['titan_aegis'],
        },
      }),
      isMercenary: false,
    };
    const mageCarry: CoopPartyMemberInput = {
      ...makeCombatant({
        id: 'u-mage',
        name: '星界大法师',
        classKey: 'mage',
        level: 45,
        maxHp: 1500,
        atk: 540,
        def: 100,
        critBp: 4800,
        affixes: {
          ...createEmptyAffixBonuses(),
          critDmgBp: 3500,
          armorPenBp: 2200,
          legendaryEffects: ['ancestral_war_cry', 'twin_meteor'],
        },
      }),
      isMercenary: false,
    };
    const rangerMerc: CoopPartyMemberInput = {
      ...makeCombatant({
        id: 'u-merc',
        name: '疾风雇佣兵',
        classKey: 'ranger',
        level: 45,
        maxHp: 1650,
        atk: 390,
        def: 115,
        critBp: 4200,
        dodgeBp: 1800,
        affixes: { ...createEmptyAffixBonuses(), comboBp: 1800 },
      }),
      isMercenary: true,
    };
    const warriorSub: CoopPartyMemberInput = {
      ...makeCombatant({
        id: 'u-war',
        name: '破军重装',
        classKey: 'warrior',
        level: 45,
        maxHp: 2300,
        atk: 360,
        def: 185,
      }),
      isMercenary: false,
    };

    const twoPlayerBoss = buildCoopRaidBossCombatant(5, 2);
    const fourPlayerBoss = buildCoopRaidBossCombatant(5, 4);
    expect(fourPlayerBoss.maxHp).toBeGreaterThan(twoPlayerBoss.maxHp);

    const raid2p = simulateCoopRaidBattle([paladinTank, mageCarry], 5, makeLcgRng(808));
    const raid4p = simulateCoopRaidBattle(
      [paladinTank, mageCarry, rangerMerc, warriorSub],
      5,
      makeLcgRng(808),
    );

    expect(raid4p.partySynergyBonusPct).toBeGreaterThan(raid2p.partySynergyBonusPct);
    expect(raid4p.succeeded).toBe(true);
    expect(raid4p.bossRemainingHp).toBe(0);
    expect(raid4p.mvpUserId).toBe('u-mage');
    expect(raid4p.members).toHaveLength(4);
    expect(raid4p.members.find((m) => m.userId === 'u-merc')?.isMercenary).toBe(true);

    // Frontline tanks absorb substantially more damage over multiple trials than backline
    let tankTakenTotal = 0;
    let mageTakenTotal = 0;
    for (let s = 1; s <= 20; s++) {
      const sim = simulateCoopRaidBattle([paladinTank, mageCarry], 6, makeLcgRng(s * 37));
      tankTakenTotal += sim.members.find((m) => m.userId === 'u-tank')?.damageTaken ?? 0;
      mageTakenTotal += sim.members.find((m) => m.userId === 'u-mage')?.damageTaken ?? 0;
    }
    expect(tankTakenTotal).toBeGreaterThan(mageTakenTotal * 1.4);

    expect(raid4p.highlights.length).toBeGreaterThanOrEqual(6);
    expect(raid4p.highlights.length).toBeLessThanOrEqual(8);
  });
});
