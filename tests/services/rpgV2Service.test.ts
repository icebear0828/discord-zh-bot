import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { initRpgSchema, RpgRepo } from '../../src/db/repositories/rpgRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { getReforgeCost, getSalvageArcaneDust } from '../../src/services/rpgAffixes.js';
import {
  COOP_RECRUIT_TTL_MS,
  DAILY_ARENA_FIGHTS,
  DAILY_COOP_TICKETS,
  MAX_RPG_DUEL_BET,
  PUBLIC_DUEL_TTL_MS,
  RpgService,
  WORLD_BOSS_HEAVY_BONUS_CAP,
  WORLD_BOSS_NORMAL_BONUS_CAP,
  generateShopRpgLoot,
  generateTierItem,
  type RpgServiceOptions,
} from '../../src/services/rpgService.js';

function createV2Fixture(options: RpgServiceOptions = {}) {
  const db = createDatabase(':memory:');
  initRpgSchema(db);
  const profileRepo = new ProfileRepo(db);
  const rpgRepo = new RpgRepo(db);
  const socialPetRepo = new SocialPetRepo(db);
  const rpg = new RpgService(db, rpgRepo, profileRepo, {
    timezone: 'Asia/Shanghai',
    socialPetRepo,
    ...options,
  });
  return { db, profileRepo, rpgRepo, socialPetRepo, rpg };
}

describe('RpgService v2 (Affixes, Reforge, Abyss, Arena, Public Duel, Co-op Raid & World Boss Bridge)', () => {
  it('idempotently awakens pre-v2 SQLite items + backfills starter arcane_dust once while preserving legacy lastIdleClaimAt anchor', () => {
    const db = new Database(':memory:');
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    const legacyUpdatedAt = now - 12 * 3_600_000;

    // Simulate pre-v2 SQLite tables lacking all v2 columns
    db.exec(`
      CREATE TABLE member_profiles (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 0,
        message_count INTEGER NOT NULL DEFAULT 0,
        voice_minutes INTEGER NOT NULL DEFAULT 0,
        coins INTEGER NOT NULL DEFAULT 0,
        bank_coins INTEGER NOT NULL DEFAULT 0,
        last_bank_interest_date TEXT,
        daily_streak INTEGER NOT NULL DEFAULT 0,
        last_daily_date TEXT,
        last_work_at INTEGER NOT NULL DEFAULT 0,
        last_rob_at INTEGER NOT NULL DEFAULT 0,
        rob_shield_until INTEGER NOT NULL DEFAULT 0,
        equipped_title TEXT,
        xp_boost_multiplier REAL NOT NULL DEFAULT 1.0,
        xp_boost_expires_at INTEGER NOT NULL DEFAULT 0,
        heat_streak INTEGER NOT NULL DEFAULT 0,
        last_xp_at INTEGER NOT NULL DEFAULT 0,
        hour_window_start INTEGER NOT NULL DEFAULT 0,
        hour_xp_earned INTEGER NOT NULL DEFAULT 0,
        card_nickname TEXT,
        card_tag TEXT,
        card_bio TEXT,
        card_color TEXT,
        level_offset INTEGER NOT NULL DEFAULT 0,
        stat_value INTEGER NOT NULL DEFAULT 0,
        last_stat_boost_date TEXT,
        stat_boost_daily_count INTEGER NOT NULL DEFAULT 0,
        last_credit_boost_date TEXT,
        credit_boost_daily_count INTEGER NOT NULL DEFAULT 0,
        last_pet_work_at INTEGER NOT NULL DEFAULT 0,
        pet_pvp_xp_date TEXT NOT NULL DEFAULT '',
        pet_pvp_xp_daily INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE rpg_characters (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        class_key TEXT NOT NULL CHECK (class_key IN ('warrior', 'mage', 'ranger', 'paladin')),
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
        slot TEXT NOT NULL CHECK (slot IN ('weapon', 'armor', 'accessory')),
        rarity TEXT NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
        base_hp INTEGER NOT NULL DEFAULT 0,
        base_atk INTEGER NOT NULL DEFAULT 0,
        base_def INTEGER NOT NULL DEFAULT 0,
        base_crit_bp INTEGER NOT NULL DEFAULT 0,
        enhance_level INTEGER NOT NULL DEFAULT 0,
        equipped INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);

    db.prepare(
      `INSERT INTO rpg_characters (
        guild_id, user_id, class_key, class_selected, level, xp, stamina,
        last_stamina_date, stamina_buys_today, max_chapter_cleared, total_clears, total_boss_kills, updated_at
      ) VALUES
        ('g1', 'vet', 'mage', 1, 20, 500, 5, '2026-11-25', 0, 3, 15, 10, ?),
        ('g1', 'unselected', 'warrior', 0, 1, 0, 5, '2026-11-25', 0, 0, 0, 0, ?)`,
    ).run(legacyUpdatedAt, legacyUpdatedAt);

    db.prepare(
      `INSERT INTO rpg_items (
        guild_id, user_id, name, slot, rarity, base_hp, base_atk, base_def, base_crit_bp, enhance_level, equipped, created_at
      ) VALUES
        ('g1', 'vet', '阿卡纳永恒法典', 'weapon', 'legendary', 120, 150, 20, 900, 10, 1, 1000),
        ('g1', 'vet', '星穹大魔导袍', 'armor', 'epic', 260, 0, 55, 0, 8, 1, 1001),
        ('g1', 'vet', '铜制指环', 'accessory', 'common', 15, 2, 1, 100, 0, 0, 1002)`,
    ).run();

    initRpgSchema(db);
    const profileRepo = new ProfileRepo(db);
    const rpgRepo = new RpgRepo(db);
    const rpg1 = new RpgService(db, rpgRepo, profileRepo, { timezone: 'Asia/Shanghai' });

    const items1 = rpg1.listItems('g1', 'vet');
    const leg = items1.find((it) => it.rarity === 'legendary')!;
    const epic = items1.find((it) => it.rarity === 'epic')!;
    const common = items1.find((it) => it.rarity === 'common')!;

    expect(leg.affixes).toHaveLength(3);
    expect(leg.legendaryEffect).not.toBeNull();
    expect(leg.affixesAwakened).toBe(true);
    expect(epic.affixes).toHaveLength(3);
    expect(epic.legendaryEffect).toBeNull();
    expect(common.affixes).toHaveLength(0);
    expect(common.affixesAwakened).toBe(true);

    // Starter arcane dust = Math.max(25, 10 * 8 + 20 * 4) = 160; updatedAt preserved before first refresh!
    const rawVetBeforeRefresh = rpgRepo.getCharacter('g1', 'vet')!;
    expect(rawVetBeforeRefresh.arcaneDust).toBe(160);
    expect(rawVetBeforeRefresh.dustBackfilled).toBe(true);
    expect(rawVetBeforeRefresh.updatedAt).toBe(legacyUpdatedAt);
    expect(rpgRepo.getCharacter('g1', 'unselected')?.arcaneDust).toBe(0);

    // Legacy 12h idle harvest is preserved across daily refresh!
    const idlePreview = rpg1.previewIdleHarvest('g1', 'vet', now);
    expect(idlePreview.accruedMs).toBe(12 * 3_600_000);

    // Second RpgService instantiation is 100% idempotent (no duplicate dust, identical affixes)
    const rpg2 = new RpgService(db, rpgRepo, profileRepo, { timezone: 'Asia/Shanghai' });
    const leg2 = rpg2.listItems('g1', 'vet').find((it) => it.rarity === 'legendary')!;
    expect(leg2.affixes).toEqual(leg.affixes);
    expect(leg2.legendaryEffect).toBe(leg.legendaryEffect);
    expect(rpgRepo.getCharacter('g1', 'vet')?.arcaneDust).toBe(160);

    db.close();
  });

  it('handles item lock protection, salvage dust rewards, lock-1-affix reforge, and class-aware equipBestGear', () => {
    const { db, profileRepo, rpgRepo, rpg } = createV2Fixture();
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    rpg.chooseOrSwitchClass('g1', 'smith', 'ranger', now);

    // Generated drops & shop loot include affixes and legendary effect
    const genLeg = generateTierItem(5, 'abyss', () => 0.99, 'legendary');
    expect(genLeg.affixes).toHaveLength(3);
    expect(genLeg.legendaryEffect).not.toBeNull();
    const shopEpic = generateShopRpgLoot(3, 'epic', () => 0.4);
    expect(shopEpic.affixes.length).toBeGreaterThanOrEqual(3);

    const bowCritDodge = rpgRepo.createItem({
      guildId: 'g1',
      userId: 'smith',
      name: '幻影追魂弓',
      slot: 'weapon',
      rarity: 'epic',
      baseHp: 30,
      baseAtk: 42,
      baseDef: 5,
      baseCritBp: 500,
      enhanceLevel: 2,
      affixes: [
        { kind: 'dodge', valueBp: 800 },
        { kind: 'combo', valueBp: 1100 },
        { kind: 'lifesteal', valueBp: 600 },
      ],
      createdAt: now,
    });

    const bowTanky = rpgRepo.createItem({
      guildId: 'g1',
      userId: 'smith',
      name: '重铁钝剑',
      slot: 'weapon',
      rarity: 'epic',
      baseHp: 90,
      baseAtk: 35,
      baseDef: 18,
      baseCritBp: 100,
      enhanceLevel: 2,
      affixes: [
        { kind: 'thorns', valueBp: 600 },
        { kind: 'dmg_reduce', valueBp: 400 },
        { kind: 'greed', valueBp: 500 },
      ],
      createdAt: now + 1,
    });

    const trash1 = rpgRepo.createItem({
      guildId: 'g1',
      userId: 'smith',
      name: '精良护腕',
      slot: 'armor',
      rarity: 'uncommon',
      baseHp: 40,
      baseAtk: 0,
      baseDef: 8,
      baseCritBp: 0,
      affixes: [{ kind: 'greed', valueBp: 600 }],
      createdAt: now + 2,
    });

    const trash2 = rpgRepo.createItem({
      guildId: 'g1',
      userId: 'smith',
      name: '木盾',
      slot: 'armor',
      rarity: 'common',
      baseHp: 20,
      baseAtk: 0,
      baseDef: 4,
      baseCritBp: 0,
      affixes: [],
      createdAt: now + 3,
    });

    // Lock trash1 -> single salvage blocked with item_locked, bulkSalvage skips trash1 and salvages trash2
    const lockRes = rpg.toggleItemLock('g1', 'smith', trash1.id);
    expect(lockRes.ok && lockRes.locked).toBe(true);
    expect(rpg.salvageItem('g1', 'smith', trash1.id, now)).toEqual({
      ok: false,
      reason: 'item_locked',
    });

    // Common item cannot be reforged
    expect(rpg.reforgeItemAffixes('g1', 'smith', trash2.id, null, now)).toEqual({
      ok: false,
      reason: 'cannot_reforge_common',
    });

    const bulk = rpg.bulkSalvageItems('g1', 'smith', 'uncommon', now);
    expect(bulk.ok).toBe(true);
    if (!bulk.ok) return;
    expect(bulk.salvagedCount).toBe(1);
    expect(bulk.totalDust).toBe(getSalvageArcaneDust(trash2));
    expect(rpgRepo.getItemById(trash1.id)).not.toBeNull();
    expect(rpgRepo.getItemById(trash2.id)).toBeNull();

    // Unlock trash1 and single-salvage it -> earns coins + arcane dust
    expect(rpg.toggleItemLock('g1', 'smith', trash1.id).ok).toBe(true);
    const singleSalvage = rpg.salvageItem('g1', 'smith', trash1.id, now);
    expect(singleSalvage.ok).toBe(true);
    if (!singleSalvage.ok) return;
    expect(singleSalvage.dustEarned).toBe(getSalvageArcaneDust(trash1));
    expect(singleSalvage.arcaneDust).toBe(bulk.totalDust + singleSalvage.dustEarned);

    // Equip best gear for ranger prefers dodge/combo/atk bow over tanky thorns sword
    expect(bowTanky.id).not.toBe(bowCritDodge.id);
    const bestRes = rpg.equipBestGear('g1', 'smith', now);
    expect(bestRes.ok).toBe(true);
    if (bestRes.ok) {
      expect(bestRes.stats.equippedItems.find((i) => i.slot === 'weapon')?.id).toBe(bowCritDodge.id);
    }

    // Reforge checks: invalid_lock_index, insufficient_funds, insufficient_dust, then locked-affix reforge (2.5x)
    expect(rpg.reforgeItemAffixes('g1', 'smith', bowCritDodge.id, 9, now)).toEqual({
      ok: false,
      reason: 'invalid_lock_index',
    });

    const lockCost = getReforgeCost(bowCritDodge, true)!;
    expect(lockCost).toEqual({ coins: 30000, dust: 100 });
    expect(rpg.reforgeItemAffixes('g1', 'smith', bowCritDodge.id, 1, now)).toMatchObject({
      ok: false,
      reason: 'insufficient_funds',
      costCoins: 30000,
      costDust: 100,
    });

    profileRepo.addCoins('g1', 'smith', 100_000);
    expect(rpg.reforgeItemAffixes('g1', 'smith', bowCritDodge.id, 1, now)).toMatchObject({
      ok: false,
      reason: 'insufficient_dust',
      costDust: 100,
    });

    const charBeforeReforge = rpgRepo.getCharacter('g1', 'smith')!;
    rpgRepo.saveCharacter({ ...charBeforeReforge, arcaneDust: 150 });
    const reforged = rpg.reforgeItemAffixes('g1', 'smith', bowCritDodge.id, 1, now, () => 0.35);
    expect(reforged.ok).toBe(true);
    if (!reforged.ok) return;
    expect(reforged.costCoins).toBe(30000);
    expect(reforged.costDust).toBe(100);
    expect(reforged.arcaneDust).toBe(50);
    expect(reforged.item.affixes).toHaveLength(3);
    // Locked affix (combo 1100bp) is preserved!
    expect(reforged.item.affixes).toContainEqual({ kind: 'combo', valueBp: 1100 });

    db.close();
  });

  it('upgrades raidBoss with combat highlights + greed bonus + dust, and enforces Abyss Boss 0-stamina defeat & first-clear rewards', () => {
    const { db, rpgRepo, rpg } = createV2Fixture({ config: { bagCapacity: 2 } });
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);
    rpg.chooseOrSwitchClass('g1', 'slayer', 'warrior', now);

    // Undergeared Lv.1 warrior vs Tier 1 Abyss Boss -> loses, costs 0 stamina, returns highlights!
    const lossRes = rpg.challengeAbyssBoss('g1', 'slayer', now, () => 0.5);
    expect(lossRes.ok).toBe(true);
    if (!lossRes.ok) return;
    expect(lossRes.won).toBe(false);
    expect(lossRes.staminaSpent).toBe(0);
    expect(lossRes.character.stamina).toBe(5);
    expect(lossRes.character.abyssClearedTier).toBe(0);
    expect(lossRes.highlights.length).toBeGreaterThanOrEqual(6);

    // Equip powerhouse legendary gear with greed affix & phoenix_rebirth
    const godBlade = rpgRepo.createItem({
      guildId: 'g1',
      userId: 'slayer',
      name: '晨曦裁决者',
      slot: 'weapon',
      rarity: 'legendary',
      baseHp: 250,
      baseAtk: 180,
      baseDef: 45,
      baseCritBp: 1500,
      enhanceLevel: 10,
      equipped: true,
      affixes: [
        { kind: 'greed', valueBp: 2500 },
        { kind: 'lifesteal', valueBp: 1200 },
        { kind: 'crit_dmg', valueBp: 3500 },
      ],
      legendaryEffect: 'ancestral_war_cry',
      createdAt: now,
    });
    expect(godBlade.equipped).toBe(true);

    // Normal raidBoss -> SSS/S rating, awards dust + highlights + greed-boosted coins
    const raidRes = rpg.raidBoss('g1', 'slayer', 'single', now + 1000, () => 0.1);
    expect(raidRes.ok).toBe(true);
    if (!raidRes.ok) return;
    expect(['SSS', 'S']).toContain(raidRes.rating);
    expect(raidRes.dustEarned).toBeGreaterThan(0);
    expect(raidRes.highlights.length).toBeGreaterThanOrEqual(6);
    expect(raidRes.character.stamina).toBe(4);

    // First-clear Abyss Boss -> costs 0 stamina, sets abyssClearedTier = 1, awards tier*35 dust + epic/legendary item!
    const dustBeforeAbyss = rpgRepo.getCharacter('g1', 'slayer')!.arcaneDust;
    const firstClear = rpg.challengeAbyssBoss('g1', 'slayer', now + 2000, () => 0.2);
    expect(firstClear.ok).toBe(true);
    if (!firstClear.ok) return;
    expect(firstClear.won).toBe(true);
    expect(firstClear.isFirstClear).toBe(true);
    expect(firstClear.staminaSpent).toBe(0);
    expect(firstClear.character.stamina).toBe(4);
    expect(firstClear.character.abyssClearedTier).toBe(1);
    expect(firstClear.dustEarned).toBeGreaterThanOrEqual(35);
    expect(firstClear.character.arcaneDust).toBe(dustBeforeAbyss + firstClear.dustEarned);

    // Repeat Abyss Boss on already-cleared tier -> consumes 1 stamina!
    const repeatClear = rpg.challengeAbyssBoss('g1', 'slayer', now + 3000, () => 0.9);
    expect(repeatClear.ok).toBe(true);
    if (!repeatClear.ok) return;
    expect(repeatClear.won).toBe(true);
    expect(repeatClear.isFirstClear).toBe(false);
    expect(repeatClear.staminaSpent).toBe(1);
    expect(repeatClear.character.stamina).toBe(3);
    // Bag capacity 2 is full -> auto-salvaged item grants both coins AND dust!
    expect(repeatClear.autoSalvagedCount).toBe(1);
    expect(repeatClear.autoSalvagedDust).toBeGreaterThan(0);

    // 0 stamina blocks repeat farm on cleared tier
    rpgRepo.saveCharacter({ ...repeatClear.character, stamina: 0 });
    expect(rpg.challengeAbyssBoss('g1', 'slayer', now + 4000)).toEqual({
      ok: false,
      reason: 'insufficient_stamina',
    });

    db.close();
  });

  it('runs Async Arena (5/day limit, Elo +/-15..32, 0 defender coin loss, daily stipend & midnight reset)', () => {
    const { db, profileRepo, rpgRepo, rpg } = createV2Fixture();
    const day1 = Date.UTC(2026, 10, 26, 10, 0, 0);
    const day2 = Date.UTC(2026, 10, 27, 10, 0, 0);

    rpg.chooseOrSwitchClass('g1', 'gladiator', 'mage', day1);
    rpg.chooseOrSwitchClass('g1', 'defender', 'paladin', day1);
    profileRepo.addCoins('g1', 'defender', 50_000);

    // Boost gladiator so they win reliably
    rpgRepo.saveCharacter({ ...rpgRepo.getCharacter('g1', 'gladiator')!, level: 30 });

    expect(rpg.challengeArenaOpponent('g1', 'gladiator', 'gladiator', day1)).toEqual({
      ok: false,
      reason: 'self_target',
    });

    const candidates = rpg.listArenaCandidates('g1', 'gladiator', 10);
    expect(candidates.map((c) => c.userId)).toEqual(['defender']);

    for (let i = 1; i <= DAILY_ARENA_FIGHTS; i++) {
      const res = rpg.challengeArenaOpponent('g1', 'gladiator', 'defender', day1 + i * 1000, () => 0.2);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.won).toBe(true);
        expect(res.ratingDelta).toBeGreaterThanOrEqual(15);
        expect(res.ratingDelta).toBeLessThanOrEqual(32);
        expect(res.dustEarned).toBeGreaterThan(0);
        expect(res.fightsRemaining).toBe(DAILY_ARENA_FIGHTS - i);
      }
    }

    // Defender loses 0 coins!
    expect(profileRepo.getOrCreate('g1', 'defender').coins).toBe(50_000);

    // 6th fight on same day blocked
    expect(rpg.challengeArenaOpponent('g1', 'gladiator', 'defender', day1 + 9000)).toEqual({
      ok: false,
      reason: 'daily_limit_reached',
      dailyLimit: DAILY_ARENA_FIGHTS,
    });

    // Leaderboard & rank
    const lb = rpg.getArenaLeaderboard('g1', 10, 0);
    expect(lb.items[0]?.userId).toBe('gladiator');
    expect(rpg.getArenaRank('g1', 'gladiator')).toEqual({ rank: 1, total: 2 });

    // Daily arena stipend once per day
    const claim1 = rpg.claimDailyArenaReward('g1', 'gladiator', day1 + 10_000);
    expect(claim1.ok).toBe(true);
    if (claim1.ok) {
      expect(claim1.grossCoins).toBeGreaterThan(2500);
      expect(claim1.dustEarned).toBeGreaterThanOrEqual(8);
    }
    expect(rpg.claimDailyArenaReward('g1', 'gladiator', day1 + 11_000)).toEqual({
      ok: false,
      reason: 'already_claimed',
    });

    // Across midnight -> arenaFightsToday resets to 0 and daily reward unlocks again
    const refreshed = rpg.getOrCreateCharacter('g1', 'gladiator', day2);
    expect(refreshed.arenaFightsToday).toBe(0);
    expect(rpg.claimDailyArenaReward('g1', 'gladiator', day2).ok).toBe(true);

    db.close();
  });

  it('handles Public Duels (full & equalized, 0..1B bet escrow, deadbeat gating, cancel/expire refunds & gambling_stats)', () => {
    const deadbeats = new Set<string>(['deadbeat_u']);
    const recordGamblingResult = vi.fn();
    const { db, profileRepo, rpgRepo, rpg } = createV2Fixture({
      isGamblingBlocked: (_g, uid) => deadbeats.has(uid),
      recordGamblingResult,
    });
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);

    for (const uid of ['whale', 'rookie', 'deadbeat_u']) {
      rpg.chooseOrSwitchClass('g1', uid, uid === 'whale' ? 'warrior' : 'ranger', now);
      profileRepo.addCoins('g1', uid, 100_000);
    }
    rpgRepo.saveCharacter({ ...rpgRepo.getCharacter('g1', 'whale')!, level: 85 });

    // Invalid bet (> 1B or negative) rejected
    expect(
      rpg.createPublicDuel({
        guildId: 'g1',
        channelId: 'ch-game',
        challengerId: 'whale',
        rulesMode: 'full',
        betAmount: MAX_RPG_DUEL_BET + 1,
        nowMs: now,
      }),
    ).toEqual({ ok: false, reason: 'invalid_bet_amount' });

    // Deadbeat blocked on bet > 0, but allowed on 0-coin honor spar!
    expect(
      rpg.createPublicDuel({
        guildId: 'g1',
        channelId: 'ch-game',
        challengerId: 'deadbeat_u',
        rulesMode: 'equalized',
        betAmount: 1000,
        nowMs: now,
      }),
    ).toEqual({ ok: false, reason: 'deadbeat_blocked' });

    const honorCreate = rpg.createPublicDuel({
      guildId: 'g1',
      channelId: 'ch-game',
      challengerId: 'deadbeat_u',
      rulesMode: 'equalized',
      betAmount: 0,
      nowMs: now,
    });
    expect(honorCreate.ok).toBe(true);
    if (!honorCreate.ok) return;
    const honorAccept = rpg.acceptPublicDuel(honorCreate.duel.id, 'rookie', now + 1000, () => 0.4);
    expect(honorAccept.ok).toBe(true);
    expect(recordGamblingResult).not.toHaveBeenCalled();

    // Bet duel: escrows 20,000 on create; non-challenger cannot cancel; cancel refunds escrow
    const tempDuel = rpg.createPublicDuel({
      guildId: 'g1',
      channelId: 'ch-game',
      challengerId: 'whale',
      opponentId: 'rookie',
      rulesMode: 'full',
      betAmount: 20_000,
      nowMs: now + 2000,
    });
    expect(tempDuel.ok && tempDuel.balance === 80_000).toBe(true);
    if (!tempDuel.ok) return;
    expect(rpg.cancelPublicDuelAndRefund(tempDuel.duel.id, 'rookie', now + 2500)).toEqual({
      ok: false,
      reason: 'not_challenger',
    });
    const cancelled = rpg.cancelPublicDuelAndRefund(tempDuel.duel.id, 'whale', now + 3000);
    expect(cancelled.ok && cancelled.balance === 100_000).toBe(true);

    // Real 25,000 bet duel: targeted at rookie -> deadbeat_u rejected with wrong_opponent -> rookie accepts
    const realDuel = rpg.createPublicDuel({
      guildId: 'g1',
      channelId: 'ch-game',
      challengerId: 'whale',
      opponentId: 'rookie',
      rulesMode: 'full',
      betAmount: 25_000,
      nowMs: now + 4000,
    });
    expect(realDuel.ok).toBe(true);
    if (!realDuel.ok) return;
    rpg.bindPublicDuelMessage(realDuel.duel.id, 'msg-duel-1');

    expect(rpg.acceptPublicDuel(realDuel.duel.id, 'deadbeat_u', now + 4500)).toEqual({
      ok: false,
      reason: 'wrong_opponent',
      expectedOpponentId: 'rookie',
    });

    const settled = rpg.acceptPublicDuel(realDuel.duel.id, 'rookie', now + 5000, () => 0.2);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.winnerId).toBe('whale');
    expect(settled.winnerPayout).toBe(50_000);
    expect(settled.challengerBalance).toBe(125_000);
    expect(settled.acceptorBalance).toBe(75_000);
    expect(recordGamblingResult).toHaveBeenCalledWith('g1', 'whale', 25_000, 25_000, now + 5000);
    expect(recordGamblingResult).toHaveBeenCalledWith('g1', 'rookie', 25_000, -25_000, now + 5000);

    // Expiration after 10m refunds challenger's escrowed bet
    const expCreate = rpg.createPublicDuel({
      guildId: 'g1',
      channelId: 'ch-game',
      challengerId: 'rookie',
      rulesMode: 'equalized',
      betAmount: 10_000,
      nowMs: now + 10_000,
    });
    expect(expCreate.ok && expCreate.balance === 65_000).toBe(true);
    const expiredList = rpg.expireDuePublicDuels(now + 10_000 + PUBLIC_DUEL_TTL_MS);
    expect(expiredList).toHaveLength(1);
    expect(profileRepo.getOrCreate('g1', 'rookie').coins).toBe(75_000);

    db.close();
  });

  it('runs 2~4p Co-op Raids (daily 2 leader tickets, send-fail refund, unlimited assists, manual >=2 launch & 3m auto-mercenary fill)', () => {
    const { db, rpgRepo, rpg } = createV2Fixture();
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);

    // Guild 1: leader + 2 human joiners (manual launch)
    rpg.chooseOrSwitchClass('g1', 'leader', 'paladin', now);
    rpg.chooseOrSwitchClass('g1', 'ally1', 'mage', now);
    rpg.chooseOrSwitchClass('g1', 'ally2', 'ranger', now);
    for (const uid of ['leader', 'ally1', 'ally2']) {
      rpgRepo.saveCharacter({ ...rpgRepo.getCharacter('g1', uid)!, level: 12 });
    }

    // Start & refund on #游戏聊天 send failure
    const tempLobby = rpg.startCoopRaidLobby('g1', 'ch-game', 'leader', now);
    expect(tempLobby.ok && tempLobby.ticketsRemaining === 1).toBe(true);
    if (!tempLobby.ok) return;
    expect(rpg.cancelCoopRaidAndRefund(tempLobby.raid.id, now + 100)).toBe(true);
    expect(rpgRepo.getCharacter('g1', 'leader')?.coopTicketsToday).toBe(0);

    // Start real lobby #1 -> cannot manual launch with only 1 member!
    const lobby1 = rpg.startCoopRaidLobby('g1', 'ch-game', 'leader', now + 500);
    expect(lobby1.ok).toBe(true);
    if (!lobby1.ok) return;
    rpg.bindCoopRaidMessage(lobby1.raid.id, 'msg-raid-1');

    expect(rpg.launchCoopRaid(lobby1.raid.id, 'leader', now + 600)).toEqual({
      ok: false,
      reason: 'not_enough_members',
      minMembers: 2,
    });

    // Joiners join without consuming coopTicketsToday
    expect(rpg.joinCoopRaidLobby(lobby1.raid.id, 'ally1', now + 700).ok).toBe(true);
    expect(rpg.joinCoopRaidLobby(lobby1.raid.id, 'ally2', now + 800).ok).toBe(true);
    expect(rpgRepo.getCharacter('g1', 'ally1')?.coopTicketsToday).toBe(0);

    // Non-leader cannot manual launch
    expect(rpg.launchCoopRaid(lobby1.raid.id, 'ally1', now + 900)).toEqual({
      ok: false,
      reason: 'not_leader',
    });

    const launched1 = rpg.launchCoopRaid(lobby1.raid.id, 'leader', now + 1000, () => 0.2);
    expect(launched1.ok).toBe(true);
    if (!launched1.ok) return;
    expect(launched1.payouts).toHaveLength(3);
    const leaderPayout = launched1.payouts.find((p) => p.userId === 'leader')!;
    const allyPayout = launched1.payouts.find((p) => p.userId === 'ally1')!;
    expect(leaderPayout.dustEarned).toBeGreaterThan(0);
    expect(allyPayout.dustEarned).toBeGreaterThan(0);
    if (launched1.succeeded) {
      expect(leaderPayout.itemsDropped.length).toBeGreaterThanOrEqual(1);
    }

    // Lobby #2 (uses 2nd daily ticket) -> timeout with 1 human auto-recruits guild hero mercenary!
    const lobby2 = rpg.startCoopRaidLobby('g1', 'ch-game', 'leader', now + 2000);
    expect(lobby2.ok && lobby2.ticketsRemaining === 0).toBe(true);
    if (!lobby2.ok) return;

    // 3rd lobby today blocked by DAILY_COOP_TICKETS = 2 (after lobby2 settles)
    const settledAuto = rpg.settleDueCoopRaids(now + 2000 + COOP_RECRUIT_TTL_MS, () => 0.25);
    expect(settledAuto).toHaveLength(1);
    expect(settledAuto[0]!.raid.mercIds.length).toBeGreaterThanOrEqual(1);
    expect(settledAuto[0]!.payouts.some((p) => p.isMercenary)).toBe(true);

    expect(rpg.startCoopRaidLobby('g1', 'ch-game', 'leader', now + 250_000)).toEqual({
      ok: false,
      reason: 'no_coop_tickets',
      dailyLimit: DAILY_COOP_TICKETS,
    });

    // Solo guild with ZERO other players -> fallback Guardian Mercenary prevents fizzle!
    rpg.chooseOrSwitchClass('g_solo', 'lone_wolf', 'mage', now);
    const soloLobby = rpg.startCoopRaidLobby('g_solo', 'ch-solo', 'lone_wolf', now);
    expect(soloLobby.ok).toBe(true);
    if (!soloLobby.ok) return;
    const soloSettled = rpg.settleDueCoopRaids(now + COOP_RECRUIT_TTL_MS, () => 0.3);
    expect(soloSettled).toHaveLength(1);
    expect(soloSettled[0]!.raid.mercIds).toEqual(['merc:guardian:1']);

    db.close();
  });

  it('provides World Boss Bridge with capped normal/heavy attack bonus and Boss kill Arcane Dust drops', () => {
    const { db, rpgRepo, rpg } = createV2Fixture();
    const now = Date.UTC(2026, 10, 26, 12, 0, 0);

    // Non-RPG chatter gets null bonus and 0 dust
    const bridge = rpg.createWorldBossBridge(() => 0.5);
    expect(bridge.getBossAttackBonus('g1', 'chatter', 'normal', now)).toBeNull();

    // Unselected character also gets null bonus
    rpg.getOrCreateCharacter('g1', 'tourist', now);
    expect(bridge.getBossAttackBonus('g1', 'tourist', 'heavy', now)).toBeNull();

    // Maxed RPG hero gets capped <=120 normal and <=180 heavy bonus with clean realmLabel
    rpg.chooseOrSwitchClass('g1', 'archmage', 'mage', now);
    rpg.chooseOrSwitchClass('g1', 'vanguard', 'warrior', now);
    rpgRepo.saveCharacter({ ...rpgRepo.getCharacter('g1', 'archmage')!, level: 90 });

    const normalBonus = bridge.getBossAttackBonus('g1', 'archmage', 'normal', now)!;
    const heavyBonus = bridge.getBossAttackBonus('g1', 'archmage', 'heavy', now)!;
    expect(normalBonus.bonusDamage).toBeLessThanOrEqual(WORLD_BOSS_NORMAL_BONUS_CAP);
    expect(heavyBonus.bonusDamage).toBeLessThanOrEqual(WORLD_BOSS_HEAVY_BONUS_CAP);
    expect(normalBonus.classEmoji).toBe('🔮');
    expect(normalBonus.realmLabel).toBe('神座阶·九重');

    // Kill dust awards 8..18 to classSelected heroes + +8 to MVP, skipping non-RPG chatters
    const dustMap = bridge.awardBossKillDust(
      'g1',
      ['archmage', 'vanguard', 'chatter', 'tourist'],
      'archmage',
      now,
    );
    expect(dustMap.has('chatter')).toBe(false);
    expect(dustMap.has('tourist')).toBe(false);
    const vanguardDust = dustMap.get('vanguard')!;
    const mvpDust = dustMap.get('archmage')!;
    expect(vanguardDust).toBeGreaterThanOrEqual(8);
    expect(vanguardDust).toBeLessThanOrEqual(18);
    expect(mvpDust).toBe(vanguardDust + 8);
    expect(rpgRepo.getCharacter('g1', 'archmage')?.arcaneDust).toBe(mvpDust);

    db.close();
  });
});
