import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import {
  initRpgSchema as facadeInitRpgSchema,
  RPG_SCHEMA_SQL as FACADE_RPG_SCHEMA_SQL,
  RpgRepo,
  type RpgCharacter,
  type RpgItem,
} from '../../src/db/repositories/rpgRepo.js';
import { initRpgSchema, RPG_SCHEMA_SQL } from '../../src/db/repositories/rpg/schema.js';
import { mapCharacter, mapItem } from '../../src/db/repositories/rpg/mappers.js';
import { computeClassAwareItemScore } from '../../src/services/rpgAffixes.js';
import {
  buildCoopRaidBossCombatant as facadeBuildCoopBoss,
  buildEqualizedCombatant as facadeBuildEqualized,
  buildHeroCombatantSnapshot as facadeBuildHeroSnapshot,
  buildTierBossCombatant as facadeBuildTierBoss,
  EQUALIZED_TEMPLATE_LEVEL,
  MAX_BATTLE_ROUNDS,
  simulateCoopRaidBattle as facadeSimCoop,
  simulateRpgBattle as facadeSimBattle,
} from '../../src/services/rpgCombatEngine.js';
import {
  buildCoopRaidBossCombatant,
  buildEqualizedCombatant,
  buildHeroCombatantSnapshot,
  buildTierBossCombatant,
} from '../../src/services/rpg/combat/combatSnapshots.js';
import { simulateRpgBattle } from '../../src/services/rpg/combat/soloBattleSim.js';
import { simulateCoopRaidBattle } from '../../src/services/rpg/combat/coopRaidSim.js';
import {
  applyCharacterXp as facadeApplyXp,
  computeHealInjuryCost as facadeHealCost,
  computeIdlePowerMultiplier as facadeIdleMult,
  computeItemEffectiveStats as facadeEffStats,
  computeItemScore as facadeItemScore,
  computeTrialEffectiveRate as facadeTrialRate,
  generateShopRpgLoot as facadeGenShopLoot,
  generateTierItem as facadeGenTierItem,
  getArenaTierLabel as facadeArenaLabel,
  getEnhanceInfo as facadeEnhanceInfo,
  getRpgRealmInfo as facadeRealmInfo,
  getSalvageValue as facadeSalvageVal,
  isAtBreakthroughGate as facadeAtGate,
  RARITY_META as FACADE_RARITY_META,
  RARITY_ORDER as FACADE_RARITY_ORDER,
  RPG_CLASSES as FACADE_RPG_CLASSES,
  RPG_CLASS_MAP as FACADE_RPG_CLASS_MAP,
  RPG_TIERS as FACADE_RPG_TIERS,
  RPG_TIER_MAP as FACADE_RPG_TIER_MAP,
  RpgService,
  xpNeededForRpgLevel as facadeXpNeeded,
} from '../../src/services/rpgService.js';
import {
  RPG_CLASSES,
  RPG_CLASS_MAP,
  RPG_TIERS,
  RPG_TIER_MAP,
} from '../../src/services/rpg/rpgCatalogClassesAndTiers.js';
import {
  generateShopRpgLoot,
  generateTierItem,
  RARITY_META,
  RARITY_ORDER,
} from '../../src/services/rpg/rpgCatalogBossesAndItems.js';
import {
  applyCharacterXp,
  computeHealInjuryCost,
  computeIdlePowerMultiplier,
  computeItemEffectiveStats,
  computeItemScore,
  computeTrialEffectiveRate,
  getArenaTierLabel,
  getEnhanceInfo,
  getRpgRealmInfo,
  getSalvageValue,
  isAtBreakthroughGate,
  xpNeededForRpgLevel,
} from '../../src/services/rpg/rpgPureMath.js';

function createDeterministicRng(seed = 42): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('RPG core modular split: pure math, combat snapshots, facades, and red-line invariants', () => {
  const openDbs: Database.Database[] = [];

  function openMemoryDb(): Database.Database {
    const db = new Database(':memory:');
    openDbs.push(db);
    return db;
  }

  afterEach(() => {
    while (openDbs.length > 0) {
      openDbs.pop()?.close();
    }
  });

  it('preserves exact Facade re-export identities across rpgRepo, rpgCombatEngine, and rpgService', () => {
    expect(facadeInitRpgSchema).toBe(initRpgSchema);
    expect(FACADE_RPG_SCHEMA_SQL).toBe(RPG_SCHEMA_SQL);

    expect(MAX_BATTLE_ROUNDS).toBe(12);
    expect(EQUALIZED_TEMPLATE_LEVEL).toBe(45);
    expect(facadeBuildHeroSnapshot).toBe(buildHeroCombatantSnapshot);
    expect(facadeBuildEqualized).toBe(buildEqualizedCombatant);
    expect(facadeBuildTierBoss).toBe(buildTierBossCombatant);
    expect(facadeBuildCoopBoss).toBe(buildCoopRaidBossCombatant);
    expect(facadeSimBattle).toBe(simulateRpgBattle);
    expect(facadeSimCoop).toBe(simulateCoopRaidBattle);

    expect(FACADE_RPG_CLASSES).toBe(RPG_CLASSES);
    expect(FACADE_RPG_CLASS_MAP).toBe(RPG_CLASS_MAP);
    expect(FACADE_RPG_TIERS).toBe(RPG_TIERS);
    expect(FACADE_RPG_TIER_MAP).toBe(RPG_TIER_MAP);
    expect(FACADE_RARITY_ORDER).toBe(RARITY_ORDER);
    expect(FACADE_RARITY_META).toBe(RARITY_META);
    expect(facadeGenTierItem).toBe(generateTierItem);
    expect(facadeGenShopLoot).toBe(generateShopRpgLoot);

    expect(facadeRealmInfo).toBe(getRpgRealmInfo);
    expect(facadeXpNeeded).toBe(xpNeededForRpgLevel);
    expect(facadeAtGate).toBe(isAtBreakthroughGate);
    expect(facadeApplyXp).toBe(applyCharacterXp);
    expect(facadeEffStats).toBe(computeItemEffectiveStats);
    expect(facadeItemScore).toBe(computeItemScore);
    expect(facadeEnhanceInfo).toBe(getEnhanceInfo);
    expect(facadeSalvageVal).toBe(getSalvageValue);
    expect(facadeArenaLabel).toBe(getArenaTierLabel);
    expect(facadeIdleMult).toBe(computeIdlePowerMultiplier);
    expect(facadeTrialRate).toBe(computeTrialEffectiveRate);
    expect(facadeHealCost).toBe(computeHealInjuryCost);
  });

  it('computes realm progression, breakthrough gates, and XP overflow caps accurately', () => {
    const lv1 = getRpgRealmInfo(1);
    expect(lv1.tier).toBe(1);
    expect(lv1.stage).toBe(1);
    expect(lv1.stageZh).toBe('一重');
    expect(lv1.nextTierDef?.tier).toBe(2);

    const lv9 = getRpgRealmInfo(9);
    expect(lv9.tier).toBe(1);
    expect(lv9.stage).toBe(9);
    expect(lv9.stageZh).toBe('九重');

    const lv90 = getRpgRealmInfo(999);
    expect(lv90.level).toBe(90);
    expect(lv90.tier).toBe(10);
    expect(lv90.nextTierDef).toBeNull();

    const gateXp = xpNeededForRpgLevel(9);
    expect(isAtBreakthroughGate(9, gateXp - 1)).toBe(false);
    expect(isAtBreakthroughGate(9, gateXp)).toBe(true);
    expect(isAtBreakthroughGate(8, xpNeededForRpgLevel(8) * 5)).toBe(false);
    expect(isAtBreakthroughGate(90, xpNeededForRpgLevel(90) * 5)).toBe(false);

    const stubChar: RpgCharacter = {
      guildId: 'g1',
      userId: 'u1',
      classKey: 'warrior',
      classSelected: true,
      level: 8,
      xp: 0,
      stamina: 5,
      lastStaminaDate: '2026-01-01',
      staminaBuysToday: 0,
      maxChapterCleared: 0,
      totalClears: 0,
      totalBossKills: 0,
      lastIdleClaimAt: 1000,
      injuredUntil: 0,
      breakthroughPity: 0,
      totalBreakthroughs: 0,
      promoPills: 0,
      guardElixirs: 0,
      pillBuysToday: 0,
      elixirBuysToday: 0,
      trialPillsStaged: 0,
      trialUseGuard: false,
      arcaneDust: 0,
      dustBackfilled: true,
      abyssClearedTier: 0,
      arenaRating: 1000,
      arenaFightsToday: 0,
      arenaRewardDate: null,
      coopTicketsToday: 0,
      updatedAt: 1000,
    };

    const leveled = applyCharacterXp(stubChar, xpNeededForRpgLevel(8) + gateXp * 10);
    expect(leveled.levelsGained).toBe(1);
    expect(leveled.updated.level).toBe(9);
    expect(leveled.updated.xp).toBe(gateXp * 3);
    expect(leveled.hitGate).toBe(true);
  });

  it('computes item effective stats, class-aware affix scores, idle multiplier, and trial rates', () => {
    const sampleItem: RpgItem = {
      id: 7,
      guildId: 'g1',
      userId: 'u1',
      name: '龙炎魔刃',
      slot: 'weapon',
      rarity: 'epic',
      baseHp: 20,
      baseAtk: 40,
      baseDef: 5,
      baseCritBp: 500,
      enhanceLevel: 4,
      equipped: true,
      affixes: [
        { kind: 'crit_dmg', valueBp: 2200 },
        { kind: 'armor_pen', valueBp: 1200 },
      ],
      legendaryEffect: null,
      locked: false,
      affixesAwakened: true,
      createdAt: 1000,
    };

    const eff = computeItemEffectiveStats(sampleItem);
    expect(eff).toEqual({ hp: 32, atk: 64, def: 8, critBp: 800 });
    expect(computeItemScore(sampleItem)).toBeGreaterThan(300);
    expect(computeClassAwareItemScore(sampleItem, 'mage')).toBeGreaterThan(
      computeItemScore(sampleItem),
    );
    expect(getEnhanceInfo(sampleItem)?.nextLevel).toBe(5);
    expect(getEnhanceInfo({ rarity: 'epic', enhanceLevel: 10 })).toBeNull();
    expect(getSalvageValue(sampleItem)).toBe(5500 + 4 * Math.round(5500 * 0.25));
    expect(getArenaTierLabel(1650)).toContain('传说');
    expect(computeHealInjuryCost(19)).toBe(4500);

    const idleMult = computeIdlePowerMultiplier(
      {
        maxHp: 300,
        atk: 120,
        def: 40,
        critBp: 2000,
        dodgeBp: 700,
        classKey: 'mage',
        level: 20,
        equippedItems: [sampleItem],
        affixes: {
          lifestealBp: 0,
          critDmgBp: 2200,
          armorPenBp: 1200,
          dmgReduceBp: 0,
          thornsBp: 0,
          comboBp: 0,
          dodgeBp: 0,
          greedBp: 0,
          legendaryEffects: [],
        },
        petSynergy: {
          petId: 1,
          nickname: '小火龙',
          emoji: '🐉',
          rarity: 'SSR',
          level: 10,
          bonusHp: 50,
          bonusAtk: 20,
          bonusCritBp: 300,
          assistChance: 0.5,
          assistDamage: 30,
        },
      },
      3,
    );
    expect(idleMult).toBeGreaterThan(1.2);
    expect(idleMult).toBeLessThanOrEqual(1.85);

    expect(computeTrialEffectiveRate(5000, 3, 1)).toBe(57);
    expect(computeTrialEffectiveRate(100, 0, 5)).toBe(5);
    expect(computeTrialEffectiveRate(9500, 5, 0)).toBe(100);
  });

  it('builds hero, equalized, tier boss, and coop boss snapshots and runs deterministic battles', () => {
    const hero = buildHeroCombatantSnapshot({
      id: 'u1',
      name: '测试勇者',
      stats: {
        maxHp: 900,
        atk: 180,
        def: 85,
        critBp: 2400,
        dodgeBp: 800,
        classKey: 'warrior',
        level: 25,
        equippedItems: [
          {
            affixes: [{ kind: 'lifesteal', valueBp: 800 }],
            legendaryEffect: 'titan_aegis',
            enhanceLevel: 6,
          },
        ],
        petSynergy: null,
      },
    });
    expect(hero.affixes.lifestealBp).toBe(800);
    expect(hero.affixes.legendaryEffects).toEqual(['titan_aegis']);

    const equalized = buildEqualizedCombatant(hero, EQUALIZED_TEMPLATE_LEVEL);
    expect(equalized.level).toBe(EQUALIZED_TEMPLATE_LEVEL);
    expect(equalized.maxHp).toBeGreaterThan(80);

    const boss = buildTierBossCombatant(2, 'normal');
    expect(boss.isBoss).toBe(true);
    const coopBoss = buildCoopRaidBossCombatant(2, 3);
    expect(coopBoss.maxHp).toBeGreaterThan(boss.maxHp);

    const soloReport = simulateRpgBattle(hero, boss, {
      mode: 'full',
      rng: createDeterministicRng(101),
    });
    expect(soloReport.roundsPlayed).toBeGreaterThan(0);
    expect(soloReport.highlights.length).toBeGreaterThanOrEqual(6);

    const coopReport = simulateCoopRaidBattle(
      [
        { ...hero, isMercenary: false },
        { ...hero, id: 'u2', name: '法爷', classKey: 'mage', isMercenary: false },
      ],
      1,
      createDeterministicRng(202),
    );
    expect(coopReport.partySynergyBonusPct).toBe(8);
    expect(coopReport.members).toHaveLength(2);
    expect(coopReport.highlights.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps initRpgSchema idempotent, maps rows safely, and awakens legacy items & dust', () => {
    const db = openMemoryDb();
    // Simulate legacy tables missing RPG 2.0 columns
    db.exec(`
      CREATE TABLE rpg_characters (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        class_key TEXT NOT NULL,
        class_selected INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        stamina INTEGER NOT NULL DEFAULT 5,
        last_stamina_date TEXT,
        stamina_buys_today INTEGER NOT NULL DEFAULT 0,
        max_chapter_cleared INTEGER NOT NULL DEFAULT 0,
        total_clears INTEGER NOT NULL DEFAULT 0,
        total_boss_kills INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE rpg_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slot TEXT NOT NULL,
        rarity TEXT NOT NULL,
        base_hp INTEGER NOT NULL DEFAULT 0,
        base_atk INTEGER NOT NULL DEFAULT 0,
        base_def INTEGER NOT NULL DEFAULT 0,
        base_crit_bp INTEGER NOT NULL DEFAULT 0,
        enhance_level INTEGER NOT NULL DEFAULT 0,
        equipped INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      INSERT INTO rpg_characters (guild_id, user_id, class_key, class_selected, level, xp, stamina, last_stamina_date, total_boss_kills, updated_at)
      VALUES ('g1', 'legacy-u1', 'mage', 1, 10, 0, 5, '2026-01-01', 5, 1700000000000);
      INSERT INTO rpg_items (guild_id, user_id, name, slot, rarity, base_hp, base_atk, base_def, base_crit_bp, enhance_level, equipped, created_at)
      VALUES ('g1', 'legacy-u1', '旧纪元法杖', 'weapon', 'legendary', 10, 50, 0, 400, 3, 1, 1700000000000);
    `);

    initRpgSchema(db);
    initRpgSchema(db); // idempotent second call

    const rpgRepo = new RpgRepo(db);
    const profileRepo = new ProfileRepo(db);
    const svc = new RpgService(db, rpgRepo, profileRepo);
    expect(svc).toBeDefined();

    const ch = rpgRepo.getCharacter('g1', 'legacy-u1');
    expect(ch?.dustBackfilled).toBe(true);
    expect(ch?.arcaneDust).toBeGreaterThanOrEqual(80); // 5*8 + 10*4 = 80

    const items = rpgRepo.listItems('g1', 'legacy-u1');
    expect(items[0]?.affixesAwakened).toBe(true);
    expect(items[0]?.affixes.length).toBeGreaterThan(0);
    expect(items[0]?.legendaryEffect).not.toBeNull();

    // Direct mapper check
    const mappedChar = mapCharacter({
      guild_id: 'g1',
      user_id: 'u-map',
      class_key: 'ranger',
      level: 1,
      xp: 0,
      stamina: 5,
      last_stamina_date: null,
      stamina_buys_today: 0,
      max_chapter_cleared: 0,
      total_clears: 0,
      total_boss_kills: 0,
      updated_at: 123,
    });
    expect(mappedChar.arenaRating).toBe(1000);
    const mappedItem = mapItem({
      id: 1,
      guild_id: 'g1',
      user_id: 'u-map',
      name: '剑',
      slot: 'weapon',
      rarity: 'common',
      base_hp: 1,
      base_atk: 2,
      base_def: 3,
      base_crit_bp: 4,
      enhance_level: 0,
      equipped: 0,
      created_at: 123,
    });
    expect(mappedItem.affixes).toEqual([]);
  });

  it('backfills lastIdleClaimAt from old updatedAt BEFORE cross-day reset overwrites updatedAt', () => {
    const db = createDatabase(':memory:');
    openDbs.push(db);
    initRpgSchema(db);
    const rpgRepo = new RpgRepo(db);
    const profileRepo = new ProfileRepo(db);
    const svc = new RpgService(db, rpgRepo, profileRepo, { timezone: 'Asia/Shanghai' });

    const oldUpdatedAt = Date.parse('2026-05-01T10:00:00+08:00');
    const nextDayNow = Date.parse('2026-05-02T02:00:00+08:00'); // 16 hours later, crossed midnight
    rpgRepo.createCharacter({
      guildId: 'g1',
      userId: 'u-legacy-idle',
      classKey: 'warrior',
      classSelected: true,
      stamina: 1,
      lastStaminaDate: '2026-05-01',
      lastIdleClaimAt: 0,
      dustBackfilled: true,
      updatedAt: oldUpdatedAt,
    });

    const refreshed = svc.getOrCreateCharacter('g1', 'u-legacy-idle', nextDayNow);
    expect(refreshed.lastIdleClaimAt).toBe(oldUpdatedAt);
    expect(refreshed.updatedAt).toBe(nextDayNow);
    expect(refreshed.lastStaminaDate).toBe('2026-05-02');
    expect(refreshed.stamina).toBe(5);

    const preview = svc.previewIdleHarvest('g1', 'u-legacy-idle', nextDayNow);
    expect(preview.accruedMs).toBe(16 * 3_600_000);
    expect(preview.canClaim).toBe(true);
  });

  it('allows system auto-settlement of public trials when actorUserId === null and rejects non-owners', () => {
    const db = createDatabase(':memory:');
    openDbs.push(db);
    initRpgSchema(db);
    const rpgRepo = new RpgRepo(db);
    const profileRepo = new ProfileRepo(db);
    const svc = new RpgService(db, rpgRepo, profileRepo);

    const nowMs = Date.parse('2026-05-10T12:00:00+08:00');
    svc.chooseOrSwitchClass('g1', 'u-owner', 'paladin', nowMs);
    const ch = rpgRepo.getCharacter('g1', 'u-owner')!;
    rpgRepo.saveCharacter({
      ...ch,
      level: 9,
      xp: xpNeededForRpgLevel(9),
      updatedAt: nowMs,
    });

    const started = svc.startPublicBreakthroughTrial('g1', 'ch-game', 'u-owner', nowMs);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const wrongActor = svc.settlePublicTrial(started.trial.id, 'u-intruder', nowMs + 61_000, () => 0.01);
    expect(wrongActor).toEqual({ ok: false, reason: 'not_owner' });

    const autoSettled = svc.settlePublicTrial(started.trial.id, null, nowMs + 61_000, () => 0.01);
    expect(autoSettled.ok).toBe(true);
    if (!autoSettled.ok) return;
    expect(autoSettled.succeeded).toBe(true);
    expect(autoSettled.character.level).toBe(10);
  });
});
