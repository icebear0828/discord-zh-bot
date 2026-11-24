import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { initRpgSchema, RpgRepo } from '../../src/db/repositories/rpgRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import {
  computeItemEffectiveStats,
  DEFAULT_RPG_CONFIG,
  getEnhanceInfo,
  getSalvageValue,
  MAX_ENHANCE_LEVEL,
  RPG_CHAPTERS,
  RPG_CLASSES,
  RpgService,
  type RpgServiceOptions,
} from '../../src/services/rpgService.js';

function createFixture(options: RpgServiceOptions = {}) {
  const db = createDatabase(':memory:');
  initRpgSchema(db);
  const profileRepo = new ProfileRepo(db);
  const rpgRepo = new RpgRepo(db);
  const socialPetRepo = new SocialPetRepo(db);
  const rpg = new RpgService(db, rpgRepo, profileRepo, {
    timezone: 'Asia/Shanghai',
    ...options,
  });
  return { db, profileRepo, rpgRepo, socialPetRepo, rpg };
}

function makeSeqRng(values: readonly number[], fallback = 0.5): () => number {
  let idx = 0;
  return () => {
    if (idx < values.length) {
      const val = values[idx]!;
      idx += 1;
      return val;
    }
    return fallback;
  };
}

describe('RpgService (Western Fantasy Roguelike Engine)', () => {
  it('exposes 4 western fantasy classes and 6 chapters with expected metadata', () => {
    expect(RPG_CLASSES.map((c) => c.key)).toEqual(['warrior', 'mage', 'ranger', 'paladin']);
    expect(RPG_CHAPTERS).toHaveLength(6);
    expect(RPG_CHAPTERS[0]?.name).toBe('哥布林密林');
    expect(RPG_CHAPTERS[0]?.boss.name).toBe('哥布林酋长·格鲁克');
    expect(RPG_CHAPTERS[5]?.name).toBe('深渊王座');
    expect(RPG_CHAPTERS[5]?.boss.name).toBe('堕落魔神·阿撒托斯');
    expect(DEFAULT_RPG_CONFIG).toEqual({
      dailyStamina: 5,
      staminaPotionPrice: 3000,
      staminaPotionDailyLimit: 3,
      classSwitchCost: 10000,
      bagCapacity: 30,
    });
  });

  it('handles character creation, free first class selection, and paid class switching', () => {
    const { db, profileRepo, rpg } = createFixture();
    const day1 = Date.UTC(2026, 0, 10, 4, 0, 0); // 12:00 Asia/Shanghai

    // Auto-created character starts with default stamina & unselected class
    const autoChar = rpg.getOrCreateCharacter('g1', 'u1', day1);
    expect(autoChar.classKey).toBe('warrior');
    expect(autoChar.classSelected).toBe(false);
    expect(autoChar.stamina).toBe(5);

    // First class selection is FREE even after getOrCreateCharacter
    const firstPick = rpg.chooseOrSwitchClass('g1', 'u1', 'mage', day1);
    expect(firstPick.ok).toBe(true);
    if (!firstPick.ok) return;
    expect(firstPick.cost).toBe(0);
    expect(firstPick.isFirstSelection).toBe(true);
    expect(firstPick.character.classKey).toBe('mage');

    // Selecting the same class fails
    expect(rpg.chooseOrSwitchClass('g1', 'u1', 'mage', day1)).toEqual({
      ok: false,
      reason: 'same_class',
    });

    // Switching without enough coins fails
    expect(rpg.chooseOrSwitchClass('g1', 'u1', 'ranger', day1)).toEqual({
      ok: false,
      reason: 'insufficient_funds',
      cost: 10000,
    });

    // Fund user & switch class -> costs 10,000 coins
    profileRepo.addCoins('g1', 'u1', 15000);
    const switched = rpg.chooseOrSwitchClass('g1', 'u1', 'ranger', day1);
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(switched.cost).toBe(10000);
    expect(switched.balance).toBe(5000);
    expect(switched.isFirstSelection).toBe(false);
    expect(switched.character.classKey).toBe('ranger');
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(5000);

    // Brand new user calling chooseOrSwitchClass directly also gets free selection
    const directPick = rpg.chooseOrSwitchClass('g1', 'u2', 'paladin', day1);
    expect(directPick.ok).toBe(true);
    if (directPick.ok) {
      expect(directPick.cost).toBe(0);
      expect(directPick.isFirstSelection).toBe(true);
      expect(directPick.character.classKey).toBe('paladin');
    }

    db.close();
  });

  it('refills daily stamina lazily by Asia/Shanghai dateKey and enforces stamina potion limits', () => {
    const { db, profileRepo, rpgRepo, rpg } = createFixture();
    // 2026-01-10 23:30 Asia/Shanghai = 2026-01-10 15:30 UTC
    const beforeMidnight = Date.UTC(2026, 0, 10, 15, 30, 0);
    // 2026-01-11 00:30 Asia/Shanghai = 2026-01-10 16:30 UTC (only 1 hour later, next Shanghai day!)
    const afterMidnight = Date.UTC(2026, 0, 10, 16, 30, 0);

    const c0 = rpg.getOrCreateCharacter('g1', 'u1', beforeMidnight);
    expect(c0.stamina).toBe(5);
    expect(c0.lastStaminaDate).toBe('2026-01-10');

    // Spend all 5 stamina directly
    rpgRepo.saveCharacter({ ...c0, stamina: 0 });
    expect(rpg.getOrCreateCharacter('g1', 'u1', beforeMidnight + 60_000).stamina).toBe(0);

    // Buy potions: insufficient funds first
    expect(rpg.buyStaminaPotion('g1', 'u1', beforeMidnight + 60_000)).toEqual({
      ok: false,
      reason: 'insufficient_funds',
      cost: 3000,
    });

    // Fund and buy 3 potions (daily limit = 3)
    profileRepo.addCoins('g1', 'u1', 20000);
    for (let i = 1; i <= 3; i++) {
      const bought = rpg.buyStaminaPotion('g1', 'u1', beforeMidnight + i * 1000);
      expect(bought.ok).toBe(true);
      if (bought.ok) {
        expect(bought.character.stamina).toBe(i);
        expect(bought.buysRemaining).toBe(3 - i);
      }
    }
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(11000);

    // 4th buy same day hits daily limit
    expect(rpg.buyStaminaPotion('g1', 'u1', beforeMidnight + 10_000)).toEqual({
      ok: false,
      reason: 'daily_limit_reached',
      dailyLimit: 3,
    });

    // Cross Asia/Shanghai midnight -> stamina lazily refills to 5 & buysToday resets to 0
    const nextDayChar = rpg.getOrCreateCharacter('g1', 'u1', afterMidnight);
    expect(nextDayChar.lastStaminaDate).toBe('2026-01-11');
    expect(nextDayChar.stamina).toBe(5);
    expect(nextDayChar.staminaBuysToday).toBe(0);

    // Can buy potion again on the new day
    const nextDayBuy = rpg.buyStaminaPotion('g1', 'u1', afterMidnight + 1000);
    expect(nextDayBuy.ok).toBe(true);
    if (nextDayBuy.ok) {
      expect(nextDayBuy.character.stamina).toBe(6);
      expect(nextDayBuy.buysRemaining).toBe(2);
    }

    db.close();
  });

  it('supports equipment equip/swap/unequip, +0..+10 enhance (+15%/lvl, safe fail), and salvage', () => {
    const { db, profileRepo, rpgRepo, rpg } = createFixture();
    const now = Date.UTC(2026, 0, 12, 4, 0, 0);
    rpg.chooseOrSwitchClass('g1', 'u1', 'warrior', now);

    const baseStats = rpg.computeCombatStats('g1', 'u1', now);
    const sword1 = rpgRepo.createItem({
      guildId: 'g1',
      userId: 'u1',
      name: '精钢长剑',
      slot: 'weapon',
      rarity: 'uncommon',
      baseHp: 20,
      baseAtk: 20,
      baseDef: 4,
      baseCritBp: 200,
      createdAt: now,
    });
    const sword2 = rpgRepo.createItem({
      guildId: 'g1',
      userId: 'u1',
      name: '圣殿巨剑',
      slot: 'weapon',
      rarity: 'rare',
      baseHp: 40,
      baseAtk: 40,
      baseDef: 6,
      baseCritBp: 400,
      createdAt: now,
    });

    // Equip sword1
    const eq1 = rpg.equipItem('g1', 'u1', sword1.id, now);
    expect(eq1.ok).toBe(true);
    if (!eq1.ok) return;
    expect(eq1.unequippedItem).toBeNull();
    expect(eq1.stats.atk).toBe(baseStats.atk + 20);
    expect(eq1.stats.maxHp).toBe(baseStats.maxHp + 20);

    // Cannot salvage equipped item
    expect(rpg.salvageItem('g1', 'u1', sword1.id)).toEqual({
      ok: false,
      reason: 'item_equipped',
    });

    // Equipping sword2 auto-unequips sword1 in the weapon slot
    const eq2 = rpg.equipItem('g1', 'u1', sword2.id, now);
    expect(eq2.ok).toBe(true);
    if (!eq2.ok) return;
    expect(eq2.unequippedItem?.id).toBe(sword1.id);
    expect(eq2.stats.atk).toBe(baseStats.atk + 40);

    // Enhance sword2 from +0 -> +4 successfully (+60% stats!)
    profileRepo.addCoins('g1', 'u1', 1_000_000);
    for (let i = 0; i < 4; i++) {
      const enh = rpg.enhanceItem('g1', 'u1', sword2.id, now, () => 0.01);
      expect(enh.ok).toBe(true);
      if (enh.ok) {
        expect(enh.success).toBe(true);
        expect(enh.item.enhanceLevel).toBe(i + 1);
      }
    }
    const enhancedSword = rpgRepo.getItemById(sword2.id)!;
    const eff = computeItemEffectiveStats(enhancedSword);
    expect(eff.atk).toBe(Math.round(40 * 1.6)); // +15% * 4 = +60%
    expect(rpg.computeCombatStats('g1', 'u1', now).atk).toBe(baseStats.atk + eff.atk);

    // Enhance fail at +4 -> +5 (successRate = 0.80, rng = 0.95 fails): spends coins, NEVER destroys or downgrades!
    const coinsBeforeFail = profileRepo.getOrCreate('g1', 'u1').coins;
    const infoAt4 = getEnhanceInfo(enhancedSword)!;
    const failedEnh = rpg.enhanceItem('g1', 'u1', sword2.id, now, () => 0.95);
    expect(failedEnh.ok).toBe(true);
    if (failedEnh.ok) {
      expect(failedEnh.success).toBe(false);
      expect(failedEnh.item.enhanceLevel).toBe(4);
      expect(failedEnh.balance).toBe(coinsBeforeFail - infoAt4.cost);
    }

    // Enhance to +10 then verify cap
    for (let i = 4; i < MAX_ENHANCE_LEVEL; i++) {
      const enh = rpg.enhanceItem('g1', 'u1', sword2.id, now, () => 0.01);
      expect(enh.ok && enh.success).toBe(true);
    }
    expect(rpg.enhanceItem('g1', 'u1', sword2.id, now, () => 0.01)).toEqual({
      ok: false,
      reason: 'max_enhance_level',
    });

    // Unequip sword2 & salvage both items
    const uneq = rpg.unequipItem('g1', 'u1', sword2.id, now);
    expect(uneq.ok).toBe(true);
    if (uneq.ok) {
      expect(uneq.stats.atk).toBe(baseStats.atk);
    }

    const expectedSalvage = getSalvageValue({ rarity: 'rare', enhanceLevel: 10 });
    expect(expectedSalvage).toBeGreaterThan(getSalvageValue({ rarity: 'rare', enhanceLevel: 0 }));
    const salv = rpg.salvageItem('g1', 'u1', sword2.id);
    expect(salv.ok).toBe(true);
    if (salv.ok) {
      expect(salv.coinsEarned).toBe(expectedSalvage);
    }
    expect(rpgRepo.getItemById(sword2.id)).toBeNull();

    db.close();
  });

  it('integrates active pet synergy into combat stats and triggers pet assist attacks in battle logs', () => {
    const db = createDatabase(':memory:');
    initRpgSchema(db);
    const profileRepo = new ProfileRepo(db);
    const rpgRepo = new RpgRepo(db);
    const socialPetRepo = new SocialPetRepo(db);

    const rpgWithoutPet = new RpgService(db, rpgRepo, profileRepo, { timezone: 'Asia/Shanghai' });
    const rpgWithPet = new RpgService(db, rpgRepo, profileRepo, {
      timezone: 'Asia/Shanghai',
      socialPetRepo,
    });

    const now = Date.UTC(2026, 0, 12, 4, 0, 0);
    rpgWithPet.chooseOrSwitchClass('g1', 'u1', 'warrior', now);

    const statsNoPet = rpgWithoutPet.computeCombatStats('g1', 'u1', now);
    expect(statsNoPet.petSynergy).toBeNull();

    // Create an active SSR dragon pet
    socialPetRepo.createPet({
      guildId: 'g1',
      ownerId: 'u1',
      speciesKey: 'fish_dragon',
      nickname: '摸鱼神龙',
      rarity: 'SSR',
      hp: 200,
      atk: 50,
      spd: 40,
      critRate: 0.25,
      trait: '暴躁',
      isActive: true,
      createdAt: now,
    });

    const statsWithPet = rpgWithPet.computeCombatStats('g1', 'u1', now);
    expect(statsWithPet.petSynergy).not.toBeNull();
    expect(statsWithPet.petSynergy?.nickname).toBe('摸鱼神龙');
    expect(statsWithPet.petSynergy?.emoji).toBe('🐉');
    expect(statsWithPet.maxHp).toBeGreaterThan(statsNoPet.maxHp);
    expect(statsWithPet.atk).toBeGreaterThan(statsNoPet.atk);
    expect(statsWithPet.critBp).toBeGreaterThan(statsNoPet.critBp);

    // Start run against an elite monster (rng = 0.7) so it survives the first strike and triggers pet assist
    const started = rpgWithPet.startRun('g1', 'u1', 1, now, () => 0.7);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.run.logs.some((l) => l.includes('摸鱼神龙') && l.includes('🐉'))).toBe(true);

    // Attack with non-crit rng (0.5) for player hit, then low rng (0.05) for pet assist trigger
    const turn = rpgWithPet.actInRun('g1', 'u1', 'attack', now + 1000, makeSeqRng([0.5, 0.5, 0.05, 0.5, 0.5, 0.5]));
    expect(turn.ok).toBe(true);
    if (turn.ok) {
      expect(turn.logs.some((l) => l.includes('摸鱼神龙') && l.includes('助战追击'))).toBe(true);
    }

    db.close();
  });

  it('completes a full 5-floor run with skill/defend/potion/event/boss, first-clear 2x, legendary drop, persistence, and debt/credit hooks', () => {
    const onCoinsEarned = vi.fn(
      (_g: string, _u: string, gross: number, _src: string, _now: number) => {
        const garnished = Math.floor(gross * 0.5);
        return { garnished, net: gross - garnished };
      },
    );
    const onCreditChange = vi.fn();

    const { db, profileRepo, rpgRepo, rpg } = createFixture({
      onCoinsEarned,
      onCreditChange,
    });
    const now = Date.UTC(2026, 0, 15, 4, 0, 0);

    // Choose paladin and equip strong weapon so combat clears cleanly
    rpg.chooseOrSwitchClass('g1', 'hero', 'paladin', now);
    const starterWeapon = rpgRepo.createItem({
      guildId: 'g1',
      userId: 'hero',
      name: '晨曦测试刃',
      slot: 'weapon',
      rarity: 'epic',
      baseHp: 80,
      baseAtk: 55,
      baseDef: 15,
      baseCritBp: 1500,
      createdAt: now,
    });
    rpg.equipItem('g1', 'hero', starterWeapon.id, now);

    // Locked chapter 2 rejected before chapter 1 clear
    expect(rpg.startRun('g1', 'hero', 2, now)).toEqual({
      ok: false,
      reason: 'chapter_locked',
      maxUnlockedChapter: 1,
    });

    // Floor 1: normal monster (rng 0.1 < 0.65)
    const start = rpg.startRun('g1', 'hero', 1, now, makeSeqRng([0.1, 0.0]));
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.character.stamina).toBe(4);
    expect(start.run.floor).toBe(1);
    expect(start.run.phase).toBe('combat');

    // Simulate bot restart: a fresh RpgService instance reads persisted run from SQLite!
    const restartedRpg = new RpgService(db, rpgRepo, profileRepo, {
      timezone: 'Asia/Shanghai',
      onCoinsEarned,
      onCreditChange,
    });
    const persisted = restartedRpg.getActiveRun('g1', 'hero');
    expect(persisted).not.toBeNull();
    expect(persisted?.floor).toBe(1);

    // Turn 1: defend -> survives, reduces damage
    const defTurn = restartedRpg.actInRun('g1', 'hero', 'defend', now + 1000, () => 0.5);
    expect(defTurn.ok).toBe(true);
    if (!defTurn.ok || defTurn.outcome !== 'ongoing') throw new Error('Expected ongoing');

    // Turn 2: skill (paladin 圣光裁决 -> damage + heal + CD 3)
    const skillTurn = restartedRpg.actInRun('g1', 'hero', 'skill', now + 2000, () => 0.5);
    expect(skillTurn.ok).toBe(true);
    if (!skillTurn.ok) throw new Error('Expected ok');
    if (skillTurn.outcome === 'ongoing') {
      // Skill on cooldown cannot be used immediately
      expect(restartedRpg.actInRun('g1', 'hero', 'skill', now + 2500, () => 0.5)).toMatchObject({
        ok: false,
        reason: 'skill_on_cooldown',
      });
      // Use potion during combat
      const potTurn = restartedRpg.actInRun('g1', 'hero', 'potion', now + 3000, () => 0.5);
      expect(potTurn.ok).toBe(true);
      if (potTurn.ok && potTurn.outcome === 'ongoing') {
        expect(potTurn.run.potionsLeft).toBe(2);
      }
      // Finish floor 1 with attack(s)
      let f1 = restartedRpg.actInRun('g1', 'hero', 'attack', now + 3500, () => 0.3);
      while (f1.ok && f1.outcome === 'ongoing') {
        f1 = restartedRpg.actInRun('g1', 'hero', 'attack', now + 4000, () => 0.3);
      }
      expect(f1.ok && f1.outcome === 'floor_cleared').toBe(true);
    }

    // Floor 2: random event (rng 0.75 in [0.70, 0.88)) -> choose event_a (success with 0.1)
    const f2 = restartedRpg.actInRun('g1', 'hero', 'next_floor', now + 5000, makeSeqRng([0.75, 0.0]));
    expect(f2.ok && f2.outcome === 'ongoing').toBe(true);
    if (!f2.ok || f2.outcome !== 'ongoing') return;
    expect(f2.run.phase).toBe('event');
    expect(f2.run.event?.key).toBe('shrine');

    // Combat action invalid during event
    expect(restartedRpg.actInRun('g1', 'hero', 'attack', now + 5100)).toEqual({
      ok: false,
      reason: 'invalid_action_for_phase',
    });

    const evA = restartedRpg.actInRun('g1', 'hero', 'event_a', now + 5200, () => 0.1);
    expect(evA.ok && evA.outcome === 'floor_cleared').toBe(true);
    if (evA.ok && evA.outcome === 'floor_cleared') {
      expect(evA.run.atkBuffPct).toBeCloseTo(0.18, 5);
    }

    // Floor 3: random event (tavern, idx 1 -> 0.3) -> choose event_b (safe heal + potion)
    const f3 = restartedRpg.actInRun('g1', 'hero', 'next_floor', now + 6000, makeSeqRng([0.8, 0.3]));
    expect(f3.ok && f3.outcome === 'ongoing').toBe(true);
    if (!f3.ok || f3.outcome !== 'ongoing') return;
    expect(f3.run.event?.key).toBe('tavern');
    const potionsBeforeTavern = f3.run.potionsLeft;
    const evB = restartedRpg.actInRun('g1', 'hero', 'event_b', now + 6100, () => 0.5);
    expect(evB.ok && evB.outcome === 'floor_cleared').toBe(true);
    if (evB.ok && evB.outcome === 'floor_cleared') {
      expect(evB.run.potionsLeft).toBe(potionsBeforeTavern + 1);
    }

    // Floor 4: treasure chest (rng 0.95 >= 0.88)
    const f4 = restartedRpg.actInRun('g1', 'hero', 'next_floor', now + 7000, makeSeqRng([0.95, 0.5, 0.1, 0.5, 0.5, 0.5]));
    expect(f4.ok && f4.outcome === 'floor_cleared').toBe(true);
    if (f4.ok && f4.outcome === 'floor_cleared') {
      expect(f4.run.pendingItems.length).toBeGreaterThanOrEqual(1);
    }

    // Floor 5: Chapter 1 Boss (哥布林酋长·格鲁克)!
    const f5 = restartedRpg.actInRun('g1', 'hero', 'next_floor', now + 8000, () => 0.5);
    expect(f5.ok && f5.outcome === 'ongoing').toBe(true);
    if (!f5.ok || f5.outcome !== 'ongoing') return;
    expect(f5.run.floor).toBe(5);
    expect(f5.run.enemy?.kind).toBe('boss');
    expect(f5.run.enemy?.name).toBe('哥布林酋长·格鲁克');

    // Fight Boss; pass rng = 0.99 on the killing blow so Boss drops a Legendary item!
    let bossRes = restartedRpg.actInRun('g1', 'hero', 'attack', now + 9000, () => 0.99);
    let safety = 0;
    while (bossRes.ok && bossRes.outcome === 'ongoing' && safety < 25) {
      bossRes = restartedRpg.actInRun('g1', 'hero', 'attack', now + 9100 + safety * 100, () => 0.99);
      safety += 1;
    }

    expect(bossRes.ok).toBe(true);
    if (!bossRes.ok || bossRes.outcome !== 'victory') {
      throw new Error(`Expected victory, got ${JSON.stringify(bossRes)}`);
    }

    expect(bossRes.firstClear).toBe(true);
    expect(bossRes.reward.bossBonusCoins).toBe(16000); // 8000 * 2x first clear!
    expect(bossRes.reward.garnishedCoins).toBe(Math.floor(bossRes.reward.grossCoins * 0.5));
    expect(bossRes.reward.netCoins).toBe(bossRes.reward.grossCoins - bossRes.reward.garnishedCoins);
    expect(bossRes.balance).toBe(bossRes.reward.netCoins);
    expect(bossRes.legendaryDrops.length).toBeGreaterThanOrEqual(1);
    expect(bossRes.character.maxChapterCleared).toBe(1);
    expect(bossRes.character.totalClears).toBe(1);
    expect(bossRes.character.totalBossKills).toBe(1);
    expect(bossRes.character.level).toBeGreaterThan(1);
    expect(restartedRpg.getActiveRun('g1', 'hero')).toBeNull();

    // Verify hooks called with expected args
    expect(onCoinsEarned).toHaveBeenCalledTimes(1);
    expect(onCoinsEarned).toHaveBeenCalledWith(
      'g1',
      'hero',
      bossRes.reward.grossCoins,
      'rpg_clear_ch1',
      expect.any(Number),
    );
    expect(onCreditChange).toHaveBeenCalledTimes(1);
    expect(onCreditChange).toHaveBeenCalledWith(
      'g1',
      'hero',
      25,
      expect.stringContaining('首通'),
      expect.any(Number),
    );

    // Repeat clear of Chapter 1 awards 1x boss bonus (8,000) & +5 credit!
    const start2 = restartedRpg.startRun('g1', 'hero', 1, now + 20_000, () => 0.95); // chest F1
    expect(start2.ok).toBe(true);
    for (let fl = 2; fl <= 4; fl++) {
      const next = restartedRpg.actInRun('g1', 'hero', 'next_floor', now + 20_000 + fl * 100, () => 0.95);
      expect(next.ok && next.outcome === 'floor_cleared').toBe(true);
    }
    const bossStart2 = restartedRpg.actInRun('g1', 'hero', 'next_floor', now + 21_000, () => 0.5);
    expect(bossStart2.ok && bossStart2.outcome === 'ongoing').toBe(true);
    let boss2 = restartedRpg.actInRun('g1', 'hero', 'attack', now + 21_100, () => 0.5);
    let guard = 0;
    while (boss2.ok && boss2.outcome === 'ongoing' && guard < 25) {
      boss2 = restartedRpg.actInRun('g1', 'hero', 'attack', now + 21_200 + guard * 50, () => 0.5);
      guard += 1;
    }
    expect(boss2.ok && boss2.outcome === 'victory').toBe(true);
    if (boss2.ok && boss2.outcome === 'victory') {
      expect(boss2.firstClear).toBe(false);
      expect(boss2.reward.bossBonusCoins).toBe(8000);
      expect(boss2.character.totalClears).toBe(2);
      expect(boss2.character.totalBossKills).toBe(2);
    }
    expect(onCreditChange).toHaveBeenLastCalledWith(
      'g1',
      'hero',
      5,
      expect.stringContaining('通关'),
      expect.any(Number),
    );

    // Chapter 2 is now unlocked!
    const ch2Start = restartedRpg.startRun('g1', 'hero', 2, now + 30_000, () => 0.1);
    expect(ch2Start.ok).toBe(true);

    db.close();
  });

  it('banks all accumulated loot on safe retreat and auto-salvages bag overflow', () => {
    const { db, profileRepo, rpgRepo, rpg } = createFixture({
      config: { bagCapacity: 1 },
    });
    const now = Date.UTC(2026, 0, 16, 4, 0, 0);
    profileRepo.addCoins('g1', 'u1', 500);

    // Floor 1 chest -> 1 item; Floor 2 chest -> 2nd item (overflows bagCapacity = 1)
    const start = rpg.startRun('g1', 'u1', 1, now, () => 0.95);
    expect(start.ok && start.run.phase === 'floor_clear').toBe(true);
    const f2 = rpg.actInRun('g1', 'u1', 'next_floor', now + 1000, () => 0.95);
    expect(f2.ok && f2.outcome === 'floor_cleared').toBe(true);
    if (!f2.ok || f2.outcome !== 'floor_cleared') return;
    const pendingBeforeRetreat = f2.run.pendingCoins;
    const pendingXpBeforeRetreat = f2.run.pendingXp;
    expect(f2.run.pendingItems).toHaveLength(2);

    const ret = rpg.actInRun('g1', 'u1', 'retreat', now + 2000);
    expect(ret.ok && ret.outcome === 'retreated').toBe(true);
    if (!ret.ok || ret.outcome !== 'retreated') return;

    expect(ret.reward.bankedItems).toHaveLength(1);
    expect(ret.reward.autoSalvagedCount).toBe(1);
    expect(ret.reward.autoSalvagedCoins).toBeGreaterThan(0);
    expect(ret.reward.grossCoins).toBe(pendingBeforeRetreat + ret.reward.autoSalvagedCoins);
    expect(ret.reward.xpEarned).toBe(pendingXpBeforeRetreat);
    expect(ret.balance).toBe(500 + ret.reward.netCoins);
    expect(rpgRepo.listItems('g1', 'u1')).toHaveLength(1);
    expect(rpg.getActiveRun('g1', 'u1')).toBeNull();

    db.close();
  });

  it('loses ONLY pending run loot on combat defeat while preserving wallet and equipped gear', () => {
    const { db, profileRepo, rpgRepo, rpg } = createFixture();
    const now = Date.UTC(2026, 0, 17, 4, 0, 0);

    profileRepo.addCoins('g1', 'u1', 12345);
    rpg.chooseOrSwitchClass('g1', 'u1', 'mage', now);

    // Give character an equipped armor piece and unlock chapter 6 so Lv.1 mage gets crushed
    const armor = rpgRepo.createItem({
      guildId: 'g1',
      userId: 'u1',
      name: '银月板甲',
      slot: 'armor',
      rarity: 'rare',
      baseHp: 50,
      baseAtk: 0,
      baseDef: 10,
      baseCritBp: 0,
      createdAt: now,
    });
    rpg.equipItem('g1', 'u1', armor.id, now);

    const char = rpg.getOrCreateCharacter('g1', 'u1', now);
    rpgRepo.saveCharacter({ ...char, maxChapterCleared: 5 });

    // Floor 1 chest accumulates pending coins/items; Floor 2 elite in Chapter 6 destroys Lv.1 mage
    const start = rpg.startRun('g1', 'u1', 6, now, () => 0.95);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const accumulatedCoins = start.run.pendingCoins;
    expect(accumulatedCoins).toBeGreaterThan(0);

    const f2 = rpg.actInRun('g1', 'u1', 'next_floor', now + 1000, () => 0.55); // elite
    expect(f2.ok && f2.outcome === 'ongoing').toBe(true);

    let res = rpg.actInRun('g1', 'u1', 'attack', now + 2000, () => 0.5);
    let safety = 0;
    while (res.ok && res.outcome === 'ongoing' && safety < 20) {
      res = rpg.actInRun('g1', 'u1', 'attack', now + 2100 + safety * 100, () => 0.5);
      safety += 1;
    }

    expect(res.ok && res.outcome === 'defeat').toBe(true);
    if (!res.ok || res.outcome !== 'defeat') return;

    expect(res.lostLoot.coins).toBe(accumulatedCoins);
    expect(res.lostLoot.itemCount).toBe(1);
    expect(rpg.getActiveRun('g1', 'u1')).toBeNull();

    // Wallet & equipped gear are 100% untouched!
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(12345);
    const items = rpgRepo.listItems('g1', 'u1');
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(armor.id);
    expect(items[0]?.equipped).toBe(true);

    db.close();
  });

  it('supports mage burn skill, ranger double-shot skill, and warrior armor-break skill', () => {
    const { db, rpg } = createFixture();
    const now = Date.UTC(2026, 0, 18, 4, 0, 0);

    // Mage skill: 陨星火球 applies burn DoT
    rpg.chooseOrSwitchClass('g1', 'mage1', 'mage', now);
    const mStart = rpg.startRun('g1', 'mage1', 1, now, () => 0.7); // elite so it survives hit 1
    expect(mStart.ok).toBe(true);
    const mSkill = rpg.actInRun('g1', 'mage1', 'skill', now + 1000, () => 0.5);
    expect(mSkill.ok).toBe(true);
    if (mSkill.ok) {
      expect(mSkill.logs.some((l) => l.includes('陨星火球'))).toBe(true);
      expect(mSkill.logs.some((l) => l.includes('灼烧'))).toBe(true);
    }

    // Ranger skill: 穿云连射 deals 2 hits
    rpg.chooseOrSwitchClass('g1', 'ranger1', 'ranger', now);
    const rStart = rpg.startRun('g1', 'ranger1', 1, now, () => 0.7);
    expect(rStart.ok).toBe(true);
    const rSkill = rpg.actInRun('g1', 'ranger1', 'skill', now + 1000, () => 0.5);
    expect(rSkill.ok).toBe(true);
    if (rSkill.ok) {
      expect(rSkill.logs.some((l) => l.includes('穿云连射'))).toBe(true);
    }

    // Warrior skill: 破军重斩 applies armor break
    rpg.chooseOrSwitchClass('g1', 'war1', 'warrior', now);
    const wStart = rpg.startRun('g1', 'war1', 1, now, () => 0.7);
    expect(wStart.ok).toBe(true);
    const wSkill = rpg.actInRun('g1', 'war1', 'skill', now + 1000, () => 0.5);
    expect(wSkill.ok).toBe(true);
    if (wSkill.ok && wSkill.outcome === 'ongoing') {
      expect(wSkill.logs.some((l) => l.includes('破军重斩'))).toBe(true);
      expect(wSkill.run.enemy?.armorBreakTurns).toBe(1); // set to 2, decremented by 1 after enemy turn
    }

    db.close();
  });

  it('orders guild RPG leaderboard by max_chapter_cleared, level, total_clears, xp', () => {
    const { db, rpgRepo, rpg } = createFixture();
    const now = Date.UTC(2026, 0, 19, 4, 0, 0);

    const makeChar = (
      uid: string,
      maxChapterCleared: number,
      level: number,
      totalClears: number,
      xp: number,
    ) => {
      const c = rpg.getOrCreateCharacter('g1', uid, now);
      rpgRepo.saveCharacter({ ...c, maxChapterCleared, level, totalClears, xp });
    };

    makeChar('u_low', 1, 5, 10, 50);
    makeChar('u_top', 4, 10, 4, 100);
    makeChar('u_tie_b', 2, 6, 3, 20);
    makeChar('u_tie_a', 2, 6, 3, 90);
    makeChar('u_mid', 2, 7, 2, 10);

    const lb = rpg.getLeaderboard('g1', 10, 0);
    expect(lb.total).toBe(5);
    expect(lb.items.map((c) => c.userId)).toEqual([
      'u_top',
      'u_mid',
      'u_tie_a',
      'u_tie_b',
      'u_low',
    ]);

    const page2 = rpg.getLeaderboard('g1', 2, 2);
    expect(page2.total).toBe(5);
    expect(page2.items.map((c) => c.userId)).toEqual(['u_tie_a', 'u_tie_b']);

    db.close();
  });
});
