import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { initRpgSchema, RpgRepo } from '../../src/db/repositories/rpgRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import {
  computeHealInjuryCost,
  computeItemEffectiveStats,
  computeItemScore,
  DEFAULT_RPG_CONFIG,
  getEnhanceInfo,
  getRpgRealmInfo,
  getSalvageValue,
  GUARD_ELIXIR_DAILY_LIMIT,
  GUARD_ELIXIR_PRICE,
  INJURY_DURATION_MS,
  isAtBreakthroughGate,
  MAX_ENHANCE_LEVEL,
  MAX_IDLE_ACCRUE_MS,
  MAX_RPG_LEVEL,
  PROMO_PILL_DAILY_LIMIT,
  PROMO_PILL_PRICE,
  PUBLIC_TRIAL_DURATION_MS,
  RPG_CLASSES,
  RPG_TIERS,
  RpgService,
  xpNeededForRpgLevel,
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
    socialPetRepo,
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

describe('RpgService (Idle & Breakthrough Western Fantasy Engine)', () => {
  it('exposes 4 classes, 10 tiers x 9 stages (Lv.1~90), and accurate realm metadata', () => {
    expect(RPG_CLASSES.map((c) => c.key)).toEqual(['warrior', 'mage', 'ranger', 'paladin']);
    expect(RPG_TIERS).toHaveLength(10);
    expect(RPG_TIERS[0]?.name).toBe('见习阶');
    expect(RPG_TIERS[9]?.name).toBe('神座阶');

    expect(getRpgRealmInfo(1)).toMatchObject({ tier: 1, stage: 1, stageZh: '一重' });
    expect(getRpgRealmInfo(9)).toMatchObject({ tier: 1, stage: 9, stageZh: '九重' });
    expect(getRpgRealmInfo(15)).toMatchObject({
      tier: 2,
      stage: 6,
      stageZh: '六重',
      fullLabel: '🪨 黑铁阶·六重',
    });
    expect(getRpgRealmInfo(90)).toMatchObject({
      tier: 10,
      stage: 9,
      stageZh: '九重',
      nextTierDef: null,
    });
    expect(DEFAULT_RPG_CONFIG).toEqual({
      dailyStamina: 5,
      staminaPotionPrice: 3000,
      staminaPotionDailyLimit: 3,
      classSwitchCost: 10000,
      bagCapacity: 30,
    });
  });

  it('handles character creation, free first class selection, paid class switching, and pending trial lock', () => {
    const { db, profileRepo, rpgRepo, rpg } = createFixture();
    const day1 = Date.UTC(2026, 0, 10, 4, 0, 0);

    const autoChar = rpg.getOrCreateCharacter('g1', 'u1', day1);
    expect(autoChar.classKey).toBe('warrior');
    expect(autoChar.classSelected).toBe(false);
    expect(autoChar.stamina).toBe(5);

    const firstPick = rpg.chooseOrSwitchClass('g1', 'u1', 'mage', day1);
    expect(firstPick.ok).toBe(true);
    if (!firstPick.ok) return;
    expect(firstPick.cost).toBe(0);
    expect(firstPick.isFirstSelection).toBe(true);
    expect(firstPick.character.classKey).toBe('mage');

    expect(rpg.chooseOrSwitchClass('g1', 'u1', 'mage', day1)).toEqual({
      ok: false,
      reason: 'same_class',
    });

    expect(rpg.chooseOrSwitchClass('g1', 'u1', 'ranger', day1)).toEqual({
      ok: false,
      reason: 'insufficient_funds',
      cost: 10000,
    });

    profileRepo.addCoins('g1', 'u1', 15000);
    const switched = rpg.chooseOrSwitchClass('g1', 'u1', 'ranger', day1);
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(switched.cost).toBe(10000);
    expect(switched.balance).toBe(5000);
    expect(switched.isFirstSelection).toBe(false);
    expect(switched.character.classKey).toBe('ranger');

    // Pending public trial blocks class switching
    const need9 = xpNeededForRpgLevel(9);
    rpgRepo.saveCharacter({ ...switched.character, level: 9, xp: need9 });
    const trialRes = rpg.startPublicBreakthroughTrial('g1', 'ch-game', 'u1', day1 + 1000);
    expect(trialRes.ok).toBe(true);
    expect(rpg.chooseOrSwitchClass('g1', 'u1', 'warrior', day1 + 2000)).toEqual({
      ok: false,
      reason: 'pending_trial',
    });

    db.close();
  });

  it('lazily resets daily stamina, stamina potions, and alchemy buy limits across Asia/Shanghai midnight', () => {
    const { db, profileRepo, rpgRepo, rpg } = createFixture();
    const beforeMidnight = Date.UTC(2026, 0, 10, 15, 30, 0); // 23:30 CST
    const afterMidnight = Date.UTC(2026, 0, 10, 16, 30, 0); // 00:30 CST next day

    const c0 = rpg.getOrCreateCharacter('g1', 'u1', beforeMidnight);
    rpgRepo.saveCharacter({ ...c0, stamina: 0 });
    expect(rpg.buyStaminaPotion('g1', 'u1', beforeMidnight + 60_000)).toEqual({
      ok: false,
      reason: 'insufficient_funds',
      cost: 3000,
    });

    profileRepo.addCoins('g1', 'u1', 200_000);
    for (let i = 1; i <= 3; i++) {
      const bought = rpg.buyStaminaPotion('g1', 'u1', beforeMidnight + i * 1000);
      expect(bought.ok).toBe(true);
      if (bought.ok) {
        expect(bought.character.stamina).toBe(i);
        expect(bought.buysRemaining).toBe(3 - i);
      }
    }
    expect(rpg.buyStaminaPotion('g1', 'u1', beforeMidnight + 10_000)).toEqual({
      ok: false,
      reason: 'daily_limit_reached',
      dailyLimit: 3,
    });

    // Alchemy daily limits: 5 promo pills & 2 guard elixirs
    for (let i = 0; i < PROMO_PILL_DAILY_LIMIT; i++) {
      expect(rpg.buyAlchemyItem('g1', 'u1', 'pill', beforeMidnight + 12_000).ok).toBe(true);
    }
    expect(rpg.buyAlchemyItem('g1', 'u1', 'pill', beforeMidnight + 13_000)).toEqual({
      ok: false,
      reason: 'daily_limit_reached',
      dailyLimit: PROMO_PILL_DAILY_LIMIT,
    });
    for (let i = 0; i < GUARD_ELIXIR_DAILY_LIMIT; i++) {
      expect(rpg.buyAlchemyItem('g1', 'u1', 'elixir', beforeMidnight + 14_000).ok).toBe(true);
    }
    expect(rpg.buyAlchemyItem('g1', 'u1', 'elixir', beforeMidnight + 15_000)).toEqual({
      ok: false,
      reason: 'daily_limit_reached',
      dailyLimit: GUARD_ELIXIR_DAILY_LIMIT,
    });

    const nextDayChar = rpg.getOrCreateCharacter('g1', 'u1', afterMidnight);
    expect(nextDayChar.lastStaminaDate).toBe('2026-01-11');
    expect(nextDayChar.stamina).toBe(5);
    expect(nextDayChar.staminaBuysToday).toBe(0);
    expect(nextDayChar.pillBuysToday).toBe(0);
    expect(nextDayChar.elixirBuysToday).toBe(0);
    expect(nextDayChar.promoPills).toBe(PROMO_PILL_DAILY_LIMIT);
    expect(nextDayChar.guardElixirs).toBe(GUARD_ELIXIR_DAILY_LIMIT);

    db.close();
  });

  it('backfills legacy character lastIdleClaimAt, enforces 24h cap, 0.5x injury segmentation, and 9th-stage XP gate', () => {
    const onCoinsEarned = vi.fn((_g: string, _u: string, gross: number) => {
      const garnished = Math.floor(gross * 0.5);
      return { garnished, net: gross - garnished };
    });
    const { db, profileRepo, rpgRepo, rpg } = createFixture({ onCoinsEarned });
    const now = Date.UTC(2026, 5, 10, 12, 0, 0);

    // Simulate legacy Lv.15 character migrated with lastIdleClaimAt = 0 and updatedAt = 48h ago
    rpgRepo.createCharacter({
      guildId: 'g1',
      userId: 'legacy1',
      classKey: 'paladin',
      classSelected: true,
      stamina: 5,
      lastStaminaDate: '2026-06-08',
      lastIdleClaimAt: 0,
      updatedAt: now - 48 * 3_600_000,
    });
    const createdLegacy = rpgRepo.getCharacter('g1', 'legacy1')!;
    rpgRepo.saveCharacter({ ...createdLegacy, level: 15, xp: 100 });

    const preview = rpg.previewIdleHarvest('g1', 'legacy1', now);
    expect(preview.accruedMs).toBe(MAX_IDLE_ACCRUE_MS);
    expect(preview.isCapped).toBe(true);
    expect(preview.canClaim).toBe(true);
    expect(preview.realm.tier).toBe(2);
    expect(preview.estimatedCoins).toBeGreaterThan(0);
    expect(preview.estimatedXp).toBeGreaterThan(0);

    // Too soon after claiming
    const claim1 = rpg.claimIdleHarvest('g1', 'legacy1', now, () => 0.1);
    expect(claim1.ok).toBe(true);
    if (!claim1.ok) return;
    expect(claim1.adventures).toHaveLength(3);
    expect(claim1.garnishedCoins).toBe(Math.floor(claim1.grossCoins * 0.5));
    expect(claim1.netCoins).toBe(claim1.grossCoins - claim1.garnishedCoins);

    expect(rpg.claimIdleHarvest('g1', 'legacy1', now + 30_000)).toEqual({
      ok: false,
      reason: 'too_soon',
      waitSeconds: 30,
    });

    // Injury segmentation: 4 hours elapsed, first 2 hours injured (0.5x), last 2 hours healthy (1.0x) => 3.0 effective hours
    const afterClaimChar = rpgRepo.getCharacter('g1', 'legacy1')!;
    const tStart = now;
    const tEnd = now + 4 * 3_600_000;
    rpgRepo.saveCharacter({
      ...afterClaimChar,
      level: 10,
      xp: 0,
      lastIdleClaimAt: tStart,
      injuredUntil: tStart + 2 * 3_600_000,
    });
    const segPreview = rpg.previewIdleHarvest('g1', 'legacy1', tEnd);
    const expectedHourly = RPG_TIERS[1]!.idleCoinsPerHour * segPreview.powerMultiplier;
    expect(segPreview.estimatedCoins).toBe(Math.floor(expectedHourly * 3));
    expect(segPreview.isInjuredNow).toBe(false);

    // Full injury currently active => 0.5x rate + healInjury clears it
    rpgRepo.saveCharacter({
      ...rpgRepo.getCharacter('g1', 'legacy1')!,
      level: 18,
      xp: 0,
      lastIdleClaimAt: tEnd,
      injuredUntil: tEnd + INJURY_DURATION_MS + 60_000,
    });
    const injuredPreview = rpg.previewIdleHarvest('g1', 'legacy1', tEnd + 3_600_000);
    expect(injuredPreview.isInjuredNow).toBe(true);
    expect(injuredPreview.estimatedCoins).toBe(
      Math.floor(RPG_TIERS[1]!.idleCoinsPerHour * injuredPreview.powerMultiplier * 0.5),
    );

    const healCost = computeHealInjuryCost(18);
    expect(healCost).toBe(3000);
    profileRepo.addCoins('g1', 'legacy1', healCost);
    const healed = rpg.healInjury('g1', 'legacy1', tEnd + 10_000);
    expect(healed.ok).toBe(true);
    if (healed.ok) {
      expect(healed.character.injuredUntil).toBe(0);
    }

    // 9th-stage XP gate: harvesting massive XP at Lv.9 stops at Lv.9 and retains capped overflow XP
    rpg.chooseOrSwitchClass('g1', 'gate_hero', 'warrior', now);
    const gChar = rpgRepo.getCharacter('g1', 'gate_hero')!;
    const need9 = xpNeededForRpgLevel(9);
    rpgRepo.saveCharacter({
      ...gChar,
      level: 9,
      xp: need9 - 50,
      lastIdleClaimAt: now - 24 * 3_600_000,
    });
    const gateHarvest = rpg.claimIdleHarvest('g1', 'gate_hero', now, () => 0.1);
    expect(gateHarvest.ok).toBe(true);
    if (gateHarvest.ok) {
      expect(gateHarvest.character.level).toBe(9);
      expect(gateHarvest.hitGate).toBe(true);
      expect(isAtBreakthroughGate(gateHarvest.character.level, gateHarvest.character.xp)).toBe(true);
      expect(gateHarvest.character.xp).toBeGreaterThanOrEqual(need9);
    }

    db.close();
  });

  it('supports single & sweep boss raids with rating, gear/alchemy drops, and bag overflow auto-salvage', () => {
    const { db, rpgRepo, rpg } = createFixture({
      config: { bagCapacity: 2 },
    });
    const now = Date.UTC(2026, 5, 10, 12, 0, 0);
    rpg.chooseOrSwitchClass('g1', 'raider', 'mage', now);

    // Single raid consumes 1 stamina and drops gear + pill + elixir when rng < 0.1
    const single = rpg.raidBoss('g1', 'raider', 'single', now, () => 0.1);
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    expect(single.runsExecuted).toBe(1);
    expect(single.character.stamina).toBe(4);
    expect(single.character.totalBossKills).toBe(1);
    expect(single.bankedItems).toHaveLength(1);
    expect(single.pillsFound).toBe(1);
    expect(single.elixirsFound).toBe(1);

    // Sweep remaining 4 stamina -> bag capacity 2 means 1 banked + 3 auto-salvaged
    const sweep = rpg.raidBoss('g1', 'raider', 'all', now + 1000, () => 0.1);
    expect(sweep.ok).toBe(true);
    if (!sweep.ok) return;
    expect(sweep.runsExecuted).toBe(4);
    expect(sweep.character.stamina).toBe(0);
    expect(sweep.character.totalBossKills).toBe(5);
    expect(sweep.bankedItems).toHaveLength(1);
    expect(sweep.autoSalvagedCount).toBe(3);
    expect(sweep.autoSalvagedCoins).toBeGreaterThan(0);

    // 0 stamina fails cleanly
    expect(rpg.raidBoss('g1', 'raider', 'single', now + 2000)).toEqual({
      ok: false,
      reason: 'insufficient_stamina',
    });
    expect(rpgRepo.countItems('g1', 'raider')).toBe(2);

    db.close();
  });

  it('handles solo breakthrough preview, success (overflow XP + coins + credit), failure penalty with/without guard elixir, and pity', () => {
    const onCoinsEarned = vi.fn((_g: string, _u: string, gross: number) => ({
      garnished: Math.floor(gross * 0.25),
      net: gross - Math.floor(gross * 0.25),
    }));
    const onCreditChange = vi.fn();
    const { db, profileRepo, rpgRepo, socialPetRepo, rpg } = createFixture({
      onCoinsEarned,
      onCreditChange,
      getCreditScore: (_g, uid) => (uid === 'vip' ? 880 : 600),
    });
    const now = Date.UTC(2026, 5, 11, 12, 0, 0);

    rpg.chooseOrSwitchClass('g1', 'vip', 'paladin', now);
    socialPetRepo.createPet({
      guildId: 'g1',
      ownerId: 'vip',
      speciesKey: 'fish_dragon',
      nickname: '神龙',
      rarity: 'SSR',
      hp: 200,
      atk: 50,
      spd: 40,
      critRate: 0.2,
      trait: '欧皇',
      isActive: true,
      createdAt: now,
    });

    // Not at gate yet
    expect(rpg.attemptSoloBreakthrough('g1', 'vip', now)).toEqual({
      ok: false,
      reason: 'not_at_gate',
    });

    // Advance to Lv.18 (tier 2, base 75%) with full XP, buy 1 pill + 1 guard elixir, stage both
    const need18 = xpNeededForRpgLevel(18);
    rpgRepo.saveCharacter({
      ...rpgRepo.getCharacter('g1', 'vip')!,
      level: 18,
      xp: need18 + 500,
    });
    profileRepo.addCoins('g1', 'vip', PROMO_PILL_PRICE + GUARD_ELIXIR_PRICE);
    expect(rpg.buyAlchemyItem('g1', 'vip', 'pill', now).ok).toBe(true);
    expect(rpg.buyAlchemyItem('g1', 'vip', 'elixir', now).ok).toBe(true);
    expect(rpg.configureTrialLoadout('g1', 'vip', 'cycle_pills', now).ok).toBe(true);
    expect(rpg.configureTrialLoadout('g1', 'vip', 'toggle_guard', now).ok).toBe(true);

    const preview = rpg.computeBreakthroughPreview('g1', 'vip', now);
    expect(preview.eligible).toBe(true);
    expect(preview.baseRatePct).toBe(75);
    expect(preview.pillBonusPct).toBe(12);
    expect(preview.petBonusPct).toBe(10);
    expect(preview.creditBonusPct).toBe(5);
    expect(preview.totalRatePct).toBe(100); // 75 + 12 + 10 + 5 = 102 -> clamped 100

    const winRes = rpg.attemptSoloBreakthrough('g1', 'vip', now, () => 0.5);
    expect(winRes.ok).toBe(true);
    if (!winRes.ok) return;
    expect(winRes.succeeded).toBe(true);
    expect(winRes.fromRealm.tier).toBe(2);
    expect(winRes.toRealm.tier).toBe(3);
    expect(winRes.character.level).toBe(19);
    expect(winRes.character.xp).toBe(500);
    expect(winRes.character.promoPills).toBe(0);
    expect(winRes.character.guardElixirs).toBe(0);
    expect(winRes.character.totalBreakthroughs).toBe(1);
    expect(winRes.grossCoins).toBe(3 * 6000);
    expect(winRes.garnishedCoins).toBe(4500);
    expect(winRes.creditDelta).toBe(15);
    expect(onCreditChange).toHaveBeenCalledTimes(1);

    // Failure WITHOUT guard elixir at Lv.45 (tier 5, base 45%): -40% XP, 1h injury, +10% pity
    rpg.chooseOrSwitchClass('g1', 'unlucky', 'warrior', now);
    const need45 = xpNeededForRpgLevel(45);
    rpgRepo.saveCharacter({
      ...rpgRepo.getCharacter('g1', 'unlucky')!,
      level: 45,
      xp: need45,
    });
    const failNoGuard = rpg.attemptSoloBreakthrough('g1', 'unlucky', now, () => 0.99);
    expect(failNoGuard.ok).toBe(true);
    if (!failNoGuard.ok) return;
    expect(failNoGuard.succeeded).toBe(false);
    expect(failNoGuard.xpLost).toBe(Math.round(need45 * 0.4));
    expect(failNoGuard.character.injuredUntil).toBe(now + INJURY_DURATION_MS);
    expect(failNoGuard.character.breakthroughPity).toBe(1);

    const previewAfterFail = rpg.computeBreakthroughPreview('g1', 'unlucky', now + 1000);
    expect(previewAfterFail.pityBonusPct).toBe(10);
    expect(previewAfterFail.totalRatePct).toBe(55); // 45 + 10

    // Failure WITH guard elixir at Lv.45: -10% XP, NO new injury, +10% pity
    profileRepo.addCoins('g1', 'unlucky', GUARD_ELIXIR_PRICE);
    rpgRepo.saveCharacter({
      ...rpgRepo.getCharacter('g1', 'unlucky')!,
      xp: need45,
      injuredUntil: 0,
    });
    expect(rpg.buyAlchemyItem('g1', 'unlucky', 'elixir', now + 2000).ok).toBe(true);
    expect(rpg.configureTrialLoadout('g1', 'unlucky', 'toggle_guard', now + 2000).ok).toBe(true);
    const failWithGuard = rpg.attemptSoloBreakthrough('g1', 'unlucky', now + 3000, () => 0.99);
    expect(failWithGuard.ok).toBe(true);
    if (!failWithGuard.ok) return;
    expect(failWithGuard.succeeded).toBe(false);
    expect(failWithGuard.usedGuard).toBe(true);
    expect(failWithGuard.xpLost).toBe(Math.round(need45 * 0.1));
    expect(failWithGuard.character.injuredUntil).toBe(0);
    expect(failWithGuard.character.breakthroughPity).toBe(2);

    db.close();
  });

  it('runs 60s public trials with supporters/saboteurs, duplicate/self guards, cancel refund, and due settlement', () => {
    const { db, profileRepo, rpgRepo, rpg } = createFixture();
    const now = Date.UTC(2026, 5, 12, 12, 0, 0);
    rpg.chooseOrSwitchClass('g1', 'hero', 'ranger', now);

    // Prepare Lv.27 (tier 3, base 65%) + 1 staged pill (+12% -> 77%)
    const need27 = xpNeededForRpgLevel(27);
    profileRepo.addCoins('g1', 'hero', PROMO_PILL_PRICE);
    expect(rpg.buyAlchemyItem('g1', 'hero', 'pill', now).ok).toBe(true);
    expect(rpg.configureTrialLoadout('g1', 'hero', 'cycle_pills', now).ok).toBe(true);
    rpgRepo.saveCharacter({
      ...rpgRepo.getCharacter('g1', 'hero')!,
      level: 27,
      xp: need27,
    });

    // Start and test cancelPublicTrialAndRefund
    const tempStart = rpg.startPublicBreakthroughTrial('g1', 'ch-game', 'hero', now);
    expect(tempStart.ok).toBe(true);
    if (!tempStart.ok) return;
    expect(tempStart.character.promoPills).toBe(0);
    expect(rpg.cancelPublicTrialAndRefund(tempStart.trial.id, now + 500)).toBe(true);
    expect(rpgRepo.getCharacter('g1', 'hero')?.promoPills).toBe(1);

    // Re-stage pill and start real trial
    expect(rpg.configureTrialLoadout('g1', 'hero', 'cycle_pills', now + 600).ok).toBe(true);
    const startRes = rpg.startPublicBreakthroughTrial('g1', 'ch-game', 'hero', now + 1000);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    const trialId = startRes.trial.id;

    // Duplicate trial blocked
    expect(rpg.startPublicBreakthroughTrial('g1', 'ch-game', 'hero', now + 1500)).toEqual({
      ok: false,
      reason: 'pending_trial_exists',
    });

    // Self-interaction blocked
    expect(rpg.interactPublicTrial(trialId, 'hero', 'help', now + 2000)).toEqual({
      ok: false,
      reason: 'own_trial',
    });

    // 2 supporters (+6%) & 1 saboteur (-2%, +20% prize pool) -> 77 + 6 - 2 = 81%
    const h1 = rpg.interactPublicTrial(trialId, 'sup1', 'help', now + 2100);
    expect(h1.ok && h1.currentRatePct === 80).toBe(true);
    expect(rpg.interactPublicTrial(trialId, 'sup1', 'jeer', now + 2200)).toEqual({
      ok: false,
      reason: 'already_joined',
    });
    const h2 = rpg.interactPublicTrial(trialId, 'sup2', 'help', now + 2300);
    expect(h2.ok && h2.currentRatePct === 83).toBe(true);
    const j1 = rpg.interactPublicTrial(trialId, 'sab1', 'jeer', now + 2400);
    expect(j1.ok && j1.currentRatePct === 81).toBe(true);

    // Non-owner cannot early-settle
    expect(rpg.settlePublicTrial(trialId, 'sup1', now + 3000)).toEqual({
      ok: false,
      reason: 'not_owner',
    });

    // Before expiry, settleDuePublicTrials returns empty
    expect(rpg.settleDuePublicTrials(now + 10_000)).toHaveLength(0);

    // At expiry, system auto-settles; with rng = 0.80 < 81% -> success!
    const settledList = rpg.settleDuePublicTrials(now + 1000 + PUBLIC_TRIAL_DURATION_MS, () => 0.8);
    expect(settledList).toHaveLength(1);
    const settled = settledList[0]!;
    expect(settled.succeeded).toBe(true);
    expect(settled.finalRatePct).toBe(81);
    expect(settled.character.level).toBe(28);
    // Base tier4 prize 24000 * 1.2 (1 saboteur) = 28800
    expect(settled.grossCoins).toBe(28800);
    // Supporters each get targetTier * 600 = 2400
    expect(settled.supporterPayouts).toEqual([
      { userId: 'sup1', amount: 2400 },
      { userId: 'sup2', amount: 2400 },
    ]);
    expect(profileRepo.getOrCreate('g1', 'sup1').coins).toBe(2400);
    expect(profileRepo.getOrCreate('g1', 'sup2').coins).toBe(2400);

    db.close();
  });

  it('supports equipment equip/swap/unequip, +0..+10 enhance (+15%/lvl, safe fail), equipBestGear, and bulkSalvageItems', () => {
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

    const eq1 = rpg.equipItem('g1', 'u1', sword1.id, now);
    expect(eq1.ok && eq1.stats.atk === baseStats.atk + 20).toBe(true);
    expect(rpg.salvageItem('g1', 'u1', sword1.id)).toEqual({
      ok: false,
      reason: 'item_equipped',
    });

    const eq2 = rpg.equipItem('g1', 'u1', sword2.id, now);
    expect(eq2.ok && eq2.unequippedItem?.id === sword1.id).toBe(true);

    profileRepo.addCoins('g1', 'u1', 1_000_000);
    for (let i = 0; i < 4; i++) {
      const enh = rpg.enhanceItem('g1', 'u1', sword2.id, now, () => 0.01);
      expect(enh.ok && enh.success && enh.item.enhanceLevel === i + 1).toBe(true);
    }
    const enhancedSword = rpgRepo.getItemById(sword2.id)!;
    const eff = computeItemEffectiveStats(enhancedSword);
    expect(eff.atk).toBe(Math.round(40 * 1.6));

    const coinsBeforeFail = profileRepo.getOrCreate('g1', 'u1').coins;
    const infoAt4 = getEnhanceInfo(enhancedSword)!;
    const failedEnh = rpg.enhanceItem('g1', 'u1', sword2.id, now, () => 0.95);
    expect(failedEnh.ok && !failedEnh.success && failedEnh.item.enhanceLevel === 4).toBe(true);
    if (failedEnh.ok) {
      expect(failedEnh.balance).toBe(coinsBeforeFail - infoAt4.cost);
    }

    for (let i = 4; i < MAX_ENHANCE_LEVEL; i++) {
      expect(rpg.enhanceItem('g1', 'u1', sword2.id, now, () => 0.01).ok).toBe(true);
    }
    expect(rpg.enhanceItem('g1', 'u1', sword2.id, now, () => 0.01)).toEqual({
      ok: false,
      reason: 'max_enhance_level',
    });

    expect(rpg.equipBestGear('g1', 'u1', now).ok).toBe(true);
    // sword1 is unequipped uncommon -> salvaged cleanly; sword2 is equipped rare -> untouched
    const bulk = rpg.bulkSalvageItems('g1', 'u1', 'uncommon', now);
    expect(bulk.ok).toBe(true);
    if (bulk.ok) {
      expect(bulk.salvagedCount).toBe(1);
      expect(bulk.totalCoins).toBe(getSalvageValue(sword1));
    }
    expect(rpgRepo.getItemById(sword2.id)?.equipped).toBe(true);

    // Unequip & salvage sword2
    expect(rpg.unequipItem('g1', 'u1', sword2.id, now).ok).toBe(true);
    expect(computeItemScore(sword2)).toBeGreaterThan(0);
    expect(rpg.salvageItem('g1', 'u1', sword2.id).ok).toBe(true);
    expect(rpgRepo.getItemById(sword2.id)).toBeNull();

    // Verify MAX_RPG_LEVEL cap
    const maxChar = rpgRepo.getCharacter('g1', 'u1')!;
    rpgRepo.saveCharacter({ ...maxChar, level: MAX_RPG_LEVEL, xp: 0 });
    expect(rpg.computeBreakthroughPreview('g1', 'u1', now).atMaxTier).toBe(true);

    db.close();
  });

  it('orders guild RPG leaderboard by level, xp, total_breakthroughs, and total_boss_kills', () => {
    const { db, rpgRepo, rpg } = createFixture();
    const now = Date.UTC(2026, 0, 20, 4, 0, 0);
    for (const uid of ['u_low', 'u_mid', 'u_high']) {
      rpg.chooseOrSwitchClass('g1', uid, 'warrior', now);
    }
    rpgRepo.saveCharacter({ ...rpgRepo.getCharacter('g1', 'u_low')!, level: 9, xp: 500 });
    rpgRepo.saveCharacter({
      ...rpgRepo.getCharacter('g1', 'u_mid')!,
      level: 18,
      xp: 200,
      totalBreakthroughs: 1,
    });
    rpgRepo.saveCharacter({
      ...rpgRepo.getCharacter('g1', 'u_high')!,
      level: 25,
      xp: 100,
      totalBreakthroughs: 2,
    });

    const lb = rpg.getLeaderboard('g1', 10, 0);
    expect(lb.items.map((c) => c.userId)).toEqual(['u_high', 'u_mid', 'u_low']);
    expect(makeSeqRng([0.1])()).toBe(0.1);

    db.close();
  });
});
