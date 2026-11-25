import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SLOTS_VIP_KEYWORDS,
  MAX_SOLO_GAMBLE_BET,
  ROB_ADMIN_EASTER_EGG_STORIES,
  ROB_ATTACKER_MIN_ASSETS,
  ROB_EASTER_EGG_FINE_RATE,
  SLOTS_VIP_ICE_JACKPOT_CHANCE,
} from '../../src/config/economyConstants.js';
import { createDatabase } from '../../src/db/database.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { EconomyService, getDateKey, SLOT_SYMBOLS } from '../../src/services/economyService.js';
import { LevelingService } from '../../src/services/levelingService.js';

describe('economyService', () => {
  it('computes Shanghai date keys and daily streak rewards', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const svc = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai');

    // 2026-05-01 00:30:00 UTC+8 == 2026-04-30 16:30:00 UTC
    const day1 = Date.UTC(2026, 3, 30, 16, 30, 0);
    expect(getDateKey(day1, 'Asia/Shanghai')).toBe('2026-05-01');

    const c1 = svc.claimDaily('g1', 'u1', day1);
    expect(c1.ok).toBe(true);
    if (c1.ok) {
      expect(c1.streak).toBe(1);
      expect(c1.reward).toBe(5000);
    }

    // Same day fails
    const cSame = svc.claimDaily('g1', 'u1', day1 + 3600_000);
    expect(cSame.ok).toBe(false);

    // Consecutive day increments streak
    const day2 = day1 + 24 * 3600_000;
    const c2 = svc.claimDaily('g1', 'u1', day2);
    expect(c2.ok).toBe(true);
    if (c2.ok) {
      expect(c2.streak).toBe(2);
      expect(c2.reward).toBe(6000);
    }

    // Skipped day resets streak to 1
    const day4 = day2 + 2 * 24 * 3600_000;
    const c4 = svc.claimDaily('g1', 'u1', day4);
    expect(c4.ok).toBe(true);
    if (c4.ok) {
      expect(c4.streak).toBe(1);
      expect(c4.reward).toBe(5000);
    }

    db.close();
  });

  it('handles work, rob success/fail/shield, and atomic transfers', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const svc = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai');

    const now = 1_700_000_000_000;
    const w1 = svc.work('g1', 'u1', now, () => 0.5);
    expect(w1.ok).toBe(true);
    const wCooldown = svc.work('g1', 'u1', now + 60_000);
    expect(wCooldown.ok).toBe(false);

    profileRepo.addCoins('g1', 'u1', 1000);
    profileRepo.addCoins('g1', 'u2', 1000);

    // Transfer validation and execution
    expect(svc.transferCoins('g1', 'u1', 'u1', 100).ok).toBe(false);
    expect(svc.transferCoins('g1', 'u1', 'u2', 999_999).ok).toBe(false);
    const tx = svc.transferCoins('g1', 'u1', 'u2', 200);
    expect(tx.ok).toBe(true);

    // Rob success applies shield on target
    const robWin = svc.rob('g1', 'u1', 'u2', now, () => 0.1);
    expect(robWin.ok).toBe(true);
    if (robWin.ok) {
      expect(robWin.success).toBe(true);
      expect(robWin.amount).toBeGreaterThan(0);
    }

    // Another user cannot rob shielded u2
    profileRepo.addCoins('g1', 'u3', 500);
    const robShielded = svc.rob('g1', 'u3', 'u2', now + 10_000, () => 0.1);
    expect(robShielded.ok).toBe(false);

    // Rob failure fines attacker
    const robFail = svc.rob('g1', 'u3', 'u1', now + 10_000, () => 0.99);
    expect(robFail.ok).toBe(true);
    if (robFail.ok) {
      expect(robFail.success).toBe(false);
      expect(robFail.amount).toBeGreaterThanOrEqual(50);
    }

    db.close();
  });

  it('settles dice and slots atomically', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const svc = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai');

    profileRepo.addCoins('g1', 'u1', 500);
    // Dice triple (rolls 1,1,1 with rng returning 0)
    const diceTriple = svc.playDice('g1', 'u1', 100, 'triple', () => 0);
    expect(diceTriple.ok).toBe(true);
    if (diceTriple.ok) {
      expect(diceTriple.won).toBe(true);
      expect(diceTriple.netChange).toBe(1000);
      expect(diceTriple.balance).toBe(1500);
    }

    // Slots deterministic jackpots: 7️⃣ (15x) & 🧊 (100x)
    const slots7 = svc.playSlots('g1', 'u1', 100, () => 0.92);
    expect(slots7.ok).toBe(true);
    if (slots7.ok) {
      expect(slots7.reels).toEqual(['7️⃣', '7️⃣', '7️⃣']);
      expect(slots7.multiplier).toBe(15);
      expect(slots7.netChange).toBe(1400);
    }

    const slotsIce = svc.playSlots('g1', 'u1', 100, () => 0.999);
    expect(slotsIce.ok).toBe(true);
    if (slotsIce.ok) {
      expect(slotsIce.reels).toEqual(['🧊', '🧊', '🧊']);
      expect(slotsIce.multiplier).toBe(100);
      expect(slotsIce.netChange).toBe(9900);
    }

    db.close();
  });

  it('maintains balanced normal slots RTP (<100%) while giving VIP keywords a 50% 100x ice jackpot', () => {
    // 1. Exact analytical RTP check for normal players
    const totalW = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
    expect(totalW).toBe(100);
    let rtp = 0;
    for (const a of SLOT_SYMBOLS) {
      for (const b of SLOT_SYMBOLS) {
        for (const c of SLOT_SYMBOLS) {
          const p = (a.weight / totalW) * (b.weight / totalW) * (c.weight / totalW);
          let mult = 0;
          if (a.symbol === b.symbol && b.symbol === c.symbol) {
            mult = a.symbol === '🧊' ? 100 : a.symbol === '7️⃣' ? 15 : a.symbol === '💎' ? 8 : 4;
          } else if (a.symbol === b.symbol || b.symbol === c.symbol || a.symbol === c.symbol) {
            mult = 1.5;
          }
          rtp += p * mult;
        }
      }
    }
    expect(rtp).toBeGreaterThan(0.9544);
    expect(rtp).toBeLessThan(0.98);

    // 2. VIP 50% 🧊🧊🧊 check vs non-VIP
    expect(SLOTS_VIP_ICE_JACKPOT_CHANCE).toBe(0.5);
    expect(DEFAULT_SLOTS_VIP_KEYWORDS).toContain('icebear');
    expect(DEFAULT_SLOTS_VIP_KEYWORDS).toContain('草莓布丁酱');

    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const svc = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai');

    profileRepo.addCoins('g1', 'normal_user', 10_000);
    profileRepo.addCoins('g1', 'vip_icebear', 10_000);
    profileRepo.addCoins('g1', 'vip_strawberry', 10_000);

    const makeSeq = (vals: number[]): (() => number) => {
      let i = 0;
      return () => vals[i++] ?? 0.5;
    };

    // Non-VIP with low rng [0.1, 0.4, 0.7] does NOT trigger 🧊🧊🧊 shortcut (rolls 🍒/🍋/🍇 -> 0x)
    const nonVipRes = svc.playSlots('g1', 'normal_user', 100, makeSeq([0.1, 0.4, 0.7]), 1_000_000, {
      displayNames: ['普通群友'],
    });
    expect(nonVipRes.ok).toBe(true);
    if (nonVipRes.ok) {
      expect(nonVipRes.reels).toEqual(['🍒', '🍋', '🍇']);
      expect(nonVipRes.multiplier).toBe(0);
    }

    // VIP matched by displayName "icebear" with rng 0.2 < 0.5 triggers 100x 🧊🧊🧊
    const vipWin = svc.playSlots('g1', 'vip_icebear', 100, makeSeq([0.2]), 1_000_000, {
      displayNames: ['icebear4922'],
    });
    expect(vipWin.ok).toBe(true);
    if (vipWin.ok) {
      expect(vipWin.reels).toEqual(['🧊', '🧊', '🧊']);
      expect(vipWin.multiplier).toBe(100);
      expect(vipWin.payout).toBe(10_000);
    }

    // VIP matched by equippedTitle "冰冰冰" with rng 0.6 >= 0.5 falls back to normal rolls
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'vip_strawberry'), equippedTitle: '冰冰冰' });
    const vipFallback = svc.playSlots(
      'g1',
      'vip_strawberry',
      100,
      makeSeq([0.6, 0.1, 0.4, 0.7]),
      1_000_000,
    );
    expect(vipFallback.ok).toBe(true);
    if (vipFallback.ok) {
      expect(vipFallback.reels).toEqual(['🍒', '🍋', '🍇']);
      expect(vipFallback.multiplier).toBe(0);
    }

    db.close();
  });

  it('handles bank deposit, withdraw, and daily bank interest with caps', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const svc = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai');

    profileRepo.addCoins('g1', 'u1', 500);

    // Deposit validation
    expect(svc.deposit('g1', 'u1', 0)).toEqual({ ok: false, reason: 'invalid_amount' });
    expect(svc.deposit('g1', 'u1', -10)).toEqual({ ok: false, reason: 'invalid_amount' });
    expect(svc.deposit('g1', 'u1', Number.NaN)).toEqual({ ok: false, reason: 'invalid_amount' });
    expect(svc.deposit('g1', 'u1', Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      reason: 'invalid_amount',
    });
    expect(svc.deposit('g1', 'u1', 501)).toEqual({ ok: false, reason: 'insufficient_funds' });

    const d1 = svc.deposit('g1', 'u1', 99);
    expect(d1).toEqual({ ok: true, amount: 99, coins: 401, bankCoins: 99 });

    // Interest below minimum deposit
    const day1 = Date.UTC(2026, 4, 1, 4, 0, 0);
    const iLow = svc.claimBankInterest('g1', 'u1', day1);
    expect(iLow).toEqual({ ok: false, reason: 'below_minimum', minDeposit: 100 });

    // Deposit more to reach 500 in bank
    const d2 = svc.deposit('g1', 'u1', 401);
    expect(d2).toEqual({ ok: true, amount: 401, coins: 0, bankCoins: 500 });

    // Claim interest succeeds (500 * 0.02 = 10)
    const i1 = svc.claimBankInterest('g1', 'u1', day1);
    expect(i1).toEqual({ ok: true, interest: 10, bankCoins: 510 });

    // Same-day duplicate claim rejected
    const iSame = svc.claimBankInterest('g1', 'u1', day1 + 3600_000);
    expect(iSame).toEqual({ ok: false, reason: 'already_claimed' });

    // Next-day claim succeeds (Math.floor(510 * 0.02) = 10)
    const day2 = day1 + 24 * 3600_000;
    const i2 = svc.claimBankInterest('g1', 'u1', day2);
    expect(i2).toEqual({ ok: true, interest: 10, bankCoins: 520 });

    // Interest cap at bankInterestMax (10000)
    const p = profileRepo.getOrCreate('g1', 'u1');
    profileRepo.save({ ...p, bankCoins: 1_000_000 });
    const day3 = day2 + 24 * 3600_000;
    const iCapped = svc.claimBankInterest('g1', 'u1', day3);
    expect(iCapped).toEqual({ ok: true, interest: 10_000, bankCoins: 1_010_000 });

    // Withdraw validation and execution
    expect(svc.withdraw('g1', 'u1', 0)).toEqual({ ok: false, reason: 'invalid_amount' });
    expect(svc.withdraw('g1', 'u1', -5)).toEqual({ ok: false, reason: 'invalid_amount' });
    expect(svc.withdraw('g1', 'u1', 1_010_001)).toEqual({
      ok: false,
      reason: 'insufficient_funds',
    });

    const w1 = svc.withdraw('g1', 'u1', 10_000);
    expect(w1).toEqual({ ok: true, amount: 10_000, coins: 10_000, bankCoins: 1_000_000 });

    const persisted = profileRepo.getOrCreate('g1', 'u1');
    expect(persisted.coins).toBe(10_000);
    expect(persisted.bankCoins).toBe(1_000_000);

    db.close();
  });

  it('protects bankCoins from rob(), filters rob targets by pocket cash, and ranks rich leaderboard by net worth', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const inviteRepo = new InviteRepo(db);
    const svc = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai');
    const levelingSvc = new LevelingService(configRepo, profileRepo, inviteRepo);

    profileRepo.addCoins('g1', 'u1', 500);
    profileRepo.addCoins('g1', 'u2', 500);

    // u2 deposits 450 leaving 50 in pocket -> rob fails as target_too_poor
    expect(svc.deposit('g1', 'u2', 450).ok).toBe(true);
    const now = 1_700_000_000_000;
    const robPoor = svc.rob('g1', 'u1', 'u2', now, () => 0.1);
    expect(robPoor).toEqual({ ok: false, reason: 'target_too_poor' });
    expect(profileRepo.getOrCreate('g1', 'u2').bankCoins).toBe(450);

    // Even when u2 has >= 100 in pocket, successful rob only touches pocket coins and never bankCoins
    profileRepo.addCoins('g1', 'u2', 150); // pocket = 200, bank = 450
    const robHit = svc.rob('g1', 'u1', 'u2', now, () => 0.1);
    expect(robHit.ok).toBe(true);
    if (robHit.ok) {
      expect(robHit.success).toBe(true);
      expect(robHit.targetBalance).toBeLessThan(200);
    }
    expect(profileRepo.getOrCreate('g1', 'u2').bankCoins).toBe(450);

    // Setup fresh profiles for listRobTargets & net-worth leaderboard
    const db2 = createDatabase(':memory:');
    const cfgRepo2 = new GuildConfigRepo(db2);
    const profRepo2 = new ProfileRepo(db2);
    const invRepo2 = new InviteRepo(db2);
    const lvlSvc2 = new LevelingService(cfgRepo2, profRepo2, invRepo2);

    profRepo2.addCoins('g1', 'attacker', 9000); // excluded when excludeUserId='attacker'
    profRepo2.addCoins('g1', 'poorPocket', 99);
    profRepo2.save({ ...profRepo2.getOrCreate('g1', 'poorPocket'), bankCoins: 5000 }); // net 5099, pocket 99 (<100)
    profRepo2.addCoins('g1', 'richPocket', 500);
    profRepo2.save({ ...profRepo2.getOrCreate('g1', 'richPocket'), bankCoins: 100 }); // net 600, pocket 500
    profRepo2.addCoins('g1', 'midPocket', 300);
    profRepo2.save({ ...profRepo2.getOrCreate('g1', 'midPocket'), bankCoins: 700 }); // net 1000, pocket 300
    profRepo2.addCoins('g2', 'otherGuild', 8000); // different guild

    const targets = profRepo2.listRobTargets('g1', 'attacker');
    expect(targets.map((p) => p.userId)).toEqual(['richPocket', 'midPocket']);
    expect(profRepo2.listRobTargets('g1', 'attacker', 1).map((p) => p.userId)).toEqual([
      'richPocket',
    ]);

    // Net-worth leaderboard ordering: attacker (9000), poorPocket (5099), midPocket (1000), richPocket (600)
    // Plus tie-breaker: coins DESC when net worth is equal
    profRepo2.addCoins('g1', 'tieMorePocket', 400);
    profRepo2.save({ ...profRepo2.getOrCreate('g1', 'tieMorePocket'), bankCoins: 600 }); // net 1000, pocket 400

    const repoBoard = profRepo2.listLeaderboardByCoins('g1', 10, 0);
    expect(repoBoard.items.map((p) => p.userId)).toEqual([
      'attacker',
      'poorPocket',
      'tieMorePocket',
      'midPocket',
      'richPocket',
    ]);

    const lb = lvlSvc2.getLeaderboard('g1', 'coins', 1, 10);
    expect(lb.items).toEqual([
      { userId: 'attacker', primaryValue: 9000, secondaryValue: 0, equippedTitle: null },
      { userId: 'poorPocket', primaryValue: 5099, secondaryValue: 5000, equippedTitle: null },
      { userId: 'tieMorePocket', primaryValue: 1000, secondaryValue: 600, equippedTitle: null },
      { userId: 'midPocket', primaryValue: 1000, secondaryValue: 700, equippedTitle: null },
      { userId: 'richPocket', primaryValue: 600, secondaryValue: 100, equippedTitle: null },
    ]);

    // Check levelingSvc variable used without unused warning
    expect(levelingSvc.getLeaderboard('g1', 'coins').items.length).toBe(2);

    db2.close();
    db.close();
  });

  it('supports robBank() with lower success rate, smaller payout, and higher fine deducting from pocket then bank', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const chaosRepo = new ChaosRepo(db);
    const svc = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai', chaosRepo);
    const now = 1_700_000_000_000;

    // 1. Validation: self_target, attacker_too_poor, target_bank_too_poor
    expect(svc.robBank('g1', 'a1', 'a1', now)).toEqual({ ok: false, reason: 'self_target' });

    profileRepo.addCoins('g1', 'a1', 50); // total assets 50 < 100
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 't1'), bankCoins: 2000 });
    expect(svc.robBank('g1', 'a1', 't1', now)).toEqual({
      ok: false,
      reason: 'attacker_too_poor',
    });

    profileRepo.addCoins('g1', 'a1', 200); // pocket=250 >= 100
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 't_poor'), bankCoins: 99 });
    expect(svc.robBank('g1', 'a1', 't_poor', now)).toEqual({
      ok: false,
      reason: 'target_bank_too_poor',
    });

    // listBankRobTargets returns targets with bankCoins >= 500 sorted DESC
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 't2'), bankCoins: 5000 });
    const bankTargets = profileRepo.listBankRobTargets('g1', 'a1');
    expect(bankTargets.map((t) => t.userId)).toEqual(['t2', 't1']);

    // 2. Success: steals 1%~50% of target bankCoins (no fixed cap), applies shield, claims bounty
    chaosRepo.createBounty({
      guildId: 'g1',
      placerId: 'issuer1',
      targetId: 't2',
      amount: 800,
      createdAt: now - 1000,
    });
    const winRes = svc.robBank('g1', 'a1', 't2', now, () => 0.05); // 0.05 < default 0.20 robBankSuccessRate
    expect(winRes.ok).toBe(true);
    if (winRes.ok) {
      expect(winRes.success).toBe(true);
      expect(winRes.amount).toBeGreaterThanOrEqual(50);
      expect(winRes.amount).toBeLessThanOrEqual(2500);
      expect(winRes.amount).toBe(172); // floor(5000 * (0.01 + 0.05 * 0.49))
      expect(winRes.bountyClaimed).toBe(800);
      expect(winRes.targetBankBalance).toBe(5000 - winRes.amount);
      expect(winRes.attackerBalance).toBe(250 + winRes.amount + 800);
    }

    // Target t2 is now shielded
    profileRepo.addCoins('g1', 'a2', 100);
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'a2'), bankCoins: 1000 }); // pocket=100, bank=1000
    expect(svc.robBank('g1', 'a2', 't2', now + 1000)).toMatchObject({
      ok: false,
      reason: 'target_shielded',
    });

    // 3. Failure with trap: deducts from attacker pocket first, then bankCoins!
    chaosRepo.setEffect({
      guildId: 'g1',
      userId: 't1',
      effectKey: 'trap_armed',
      charges: 1,
      expiresAt: now + 3600_000,
      sourceUserId: null,
      updatedAt: now,
    });
    const failTrap = svc.robBank('g1', 'a2', 't1', now + 1000, () => 0.9);
    expect(failTrap.ok).toBe(true);
    if (failTrap.ok) {
      expect(failTrap.success).toBe(false);
      expect(failTrap.trapped).toBe(true);
      // Attacker a2 had pocket=100, bank=1000 (total 1100). Trap fine is 50% of 1100 = 550.
      expect(failTrap.amount).toBe(550);
      expect(failTrap.fineFromPocket).toBe(100);
      expect(failTrap.fineFromBank).toBe(450);
      expect(failTrap.attackerBalance).toBe(0);
      expect(failTrap.attackerBankBalance).toBe(550);
    }

    db.close();
  });

  it('prevents empty-pocket rob exploits via min total assets & bank fine deduction, and enforces solo gamble bet cap', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const chaosRepo = new ChaosRepo(db);
    const svc = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai', chaosRepo);
    const now = 1_700_000_000_000;

    profileRepo.addCoins('g1', 'victim', 1000);
    chaosRepo.setEffect({
      guildId: 'g1',
      userId: 'victim',
      effectKey: 'trap_armed',
      charges: 1,
      expiresAt: now + 3600_000,
      sourceUserId: null,
      updatedAt: now,
    });

    // Attacker with < ROB_ATTACKER_MIN_ASSETS total assets is blocked without consuming trap
    profileRepo.addCoins('g1', 'broke', ROB_ATTACKER_MIN_ASSETS - 1);
    expect(svc.rob('g1', 'broke', 'victim', now, () => 0.99)).toEqual({
      ok: false,
      reason: 'attacker_too_poor',
    });
    expect(chaosRepo.getActiveEffect('g1', 'victim', 'trap_armed', now)).not.toBeNull();

    // Attacker with 0 pocket + 1000 bank hits trap -> fine deducted from bank!
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'banker'), coins: 0, bankCoins: 1000 });
    const trapRes = svc.rob('g1', 'banker', 'victim', now, () => 0.99);
    expect(trapRes.ok).toBe(true);
    if (trapRes.ok) {
      expect(trapRes.success).toBe(false);
      expect(trapRes.trapped).toBe(true);
      expect(trapRes.amount).toBe(300); // 30% of 1000
      expect(trapRes.fineFromPocket).toBe(0);
      expect(trapRes.fineFromBank).toBe(300);
      expect(trapRes.attackerBalance).toBe(0);
      expect(trapRes.attackerBankBalance).toBe(700);
      expect(trapRes.targetBalance).toBe(1300);
    }

    // Attacker with 20 pocket + 500 bank fails normal rob -> pocket + bank split fine
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'splitter'), coins: 20, bankCoins: 500 });
    const failRes = svc.rob('g1', 'splitter', 'victim', now + 1000, () => 0.99);
    expect(failRes.ok).toBe(true);
    if (failRes.ok) {
      expect(failRes.success).toBe(false);
      expect(failRes.amount).toBe(78); // floor(520 * 0.15) = 78
      expect(failRes.fineFromPocket).toBe(20);
      expect(failRes.fineFromBank).toBe(58);
      expect(failRes.attackerBalance).toBe(0);
      expect(failRes.attackerBankBalance).toBe(442);
    }

    // Dice & slots bet cap
    profileRepo.addCoins('g1', 'whale', MAX_SOLO_GAMBLE_BET * 2);
    expect(svc.playDice('g1', 'whale', MAX_SOLO_GAMBLE_BET + 1, 'big')).toEqual({
      ok: false,
      reason: 'bet_too_large',
    });
    expect(svc.playSlots('g1', 'whale', MAX_SOLO_GAMBLE_BET + 1)).toEqual({
      ok: false,
      reason: 'bet_too_large',
    });

    db.close();
  });

  it('triggers 100%-fail 10%-total-asset easter egg only when robbing admins (and lets non-admin pudding/king targets be robbed)', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const chaosRepo = new ChaosRepo(db);
    const svc = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai', chaosRepo);
    const now = 1_700_000_000_000;

    expect(ROB_EASTER_EGG_FINE_RATE).toBe(0.1);
    expect(ROB_ADMIN_EASTER_EGG_STORIES.length).toBeGreaterThanOrEqual(8);
    for (const story of ROB_ADMIN_EASTER_EGG_STORIES) {
      expect(story).not.toContain('黑吊王');
      expect(story).not.toContain('草莓布丁');
    }

    // 1. Target is in configured adminUserIds, has 0 coins + active shield + armed trap
    // Attacker has lockpick + 100% robSuccessRate + 40 pocket + 960 bank (total 1000 -> 10% fine = 100)
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateEconomy('g1', {
      ...cfg.economy,
      robSuccessRate: 1.0,
      robBankSuccessRate: 1.0,
      robCooldownSec: 60,
    });
    configRepo.updateAdminUsers('g1', ['admin1']);
    profileRepo.save({
      ...profileRepo.getOrCreate('g1', 'admin1'),
      coins: 0,
      bankCoins: 0,
      robShieldUntil: now + 3600_000,
    });
    chaosRepo.setEffect({
      guildId: 'g1',
      userId: 'admin1',
      effectKey: 'trap_armed',
      charges: 1,
      expiresAt: now + 3600_000,
      sourceUserId: null,
      updatedAt: now,
    });
    chaosRepo.setEffect({
      guildId: 'g1',
      userId: 'thief1',
      effectKey: 'lockpick_ready',
      charges: 1,
      expiresAt: now + 3600_000,
      sourceUserId: null,
      updatedAt: now,
    });
    profileRepo.save({
      ...profileRepo.getOrCreate('g1', 'thief1'),
      coins: 40,
      bankCoins: 960,
    });

    const pocketEgg = svc.rob('g1', 'thief1', 'admin1', now, () => 0.0);
    expect(pocketEgg.ok).toBe(true);
    if (pocketEgg.ok) {
      expect(pocketEgg.success).toBe(false);
      expect(pocketEgg.easterEggTriggered).toBe(true);
      expect(pocketEgg.easterEggStory).toContain('<@thief1>');
      expect(pocketEgg.easterEggStory).toContain('<@admin1>');
      expect(pocketEgg.amount).toBe(100);
      expect(pocketEgg.fineFromPocket).toBe(40);
      expect(pocketEgg.fineFromBank).toBe(60);
      expect(pocketEgg.attackerBalance).toBe(0);
      expect(pocketEgg.attackerBankBalance).toBe(900);
      expect(pocketEgg.targetBalance).toBe(100);
    }
    // Trap was NOT wasted, and attacker entered cooldown
    expect(chaosRepo.getActiveEffect('g1', 'admin1', 'trap_armed', now)).not.toBeNull();
    expect(svc.rob('g1', 'thief1', 'admin1', now + 5_000)).toMatchObject({
      ok: false,
      reason: 'cooldown',
    });

    // 2. robBank matched via targetHints.isAdmin even when target bank is 0 & shielded
    profileRepo.save({
      ...profileRepo.getOrCreate('g1', 'admin2'),
      coins: 0,
      bankCoins: 0,
      robShieldUntil: now + 3600_000,
    });
    profileRepo.save({
      ...profileRepo.getOrCreate('g1', 'thief2'),
      coins: 200,
      bankCoins: 2300, // total 2500 -> 10% fine = 250 (200 pocket + 50 bank)
    });
    const bankEgg = svc.robBank('g1', 'thief2', 'admin2', now, () => 0.4, {
      isAdmin: true,
    });
    expect(bankEgg.ok).toBe(true);
    if (bankEgg.ok) {
      expect(bankEgg.success).toBe(false);
      expect(bankEgg.easterEggTriggered).toBe(true);
      expect(bankEgg.easterEggStory).toContain('<@thief2>');
      expect(bankEgg.amount).toBe(250);
      expect(bankEgg.fineFromPocket).toBe(200);
      expect(bankEgg.fineFromBank).toBe(50);
      expect(bankEgg.attackerBalance).toBe(0);
      expect(bankEgg.attackerBankBalance).toBe(2250);
      expect(bankEgg.targetBankBalance).toBe(250);
    }

    // 3. Matched via targetHints.isAdmin even when attacker is below min assets (total 50 -> fine 5)
    profileRepo.save({
      ...profileRepo.getOrCreate('g1', 'thief3'),
      coins: 50,
      bankCoins: 0,
    });
    const roleEgg = svc.rob('g1', 'thief3', 'admin3', now, () => 0.7, {
      isAdmin: true,
    });
    expect(roleEgg.ok).toBe(true);
    if (roleEgg.ok) {
      expect(roleEgg.success).toBe(false);
      expect(roleEgg.easterEggTriggered).toBe(true);
      expect(roleEgg.amount).toBe(5);
      expect(roleEgg.attackerBalance).toBe(45);
      expect(roleEgg.targetBalance).toBe(5);
    }

    // 4. Non-admin with 草莓布丁酱 / 黑吊王 hints is NO LONGER protected and can be robbed normally
    profileRepo.save({
      ...profileRepo.getOrCreate('g1', 'pudding'),
      coins: 1000,
      bankCoins: 2000,
      equippedTitle: '至高黑吊王',
    });
    profileRepo.save({
      ...profileRepo.getOrCreate('g1', 'thief4'),
      coins: 500,
      bankCoins: 0,
    });
    const puddingHints = {
      displayNames: ['草莓布丁酱'],
      roleNames: ['黑吊王'],
      isAdmin: false,
    };
    const robPudding = svc.rob('g1', 'thief4', 'pudding', now, () => 0.2, puddingHints);
    expect(robPudding.ok).toBe(true);
    if (robPudding.ok) {
      expect(robPudding.success).toBe(true);
      expect(robPudding.easterEggTriggered).toBeUndefined();
      expect(robPudding.amount).toBeGreaterThan(0);
    }

    profileRepo.save({
      ...profileRepo.getOrCreate('g1', 'thief5'),
      coins: 500,
      bankCoins: 0,
    });
    const robPuddingBank = svc.robBank(
      'g1',
      'thief5',
      'pudding',
      now + (cfg.economy.robTargetShieldSec + 10) * 1000,
      () => 0.2,
      puddingHints,
    );
    expect(robPuddingBank.ok).toBe(true);
    if (robPuddingBank.ok) {
      expect(robPuddingBank.success).toBe(true);
      expect(robPuddingBank.easterEggTriggered).toBeUndefined();
      expect(robPuddingBank.amount).toBeGreaterThan(0);
    }

    db.close();
  });

  it('uses uncapped 1%-50% steal and pure-percentage fines for both rob() and robBank()', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const chaosRepo = new ChaosRepo(db);
    const svc = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai', chaosRepo);
    const now = 1_700_000_000_000;

    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateEconomy('g1', {
      ...cfg.economy,
      robCooldownSec: 0,
      robTargetShieldSec: 0,
    });

    const makeSeq = (vals: number[]): (() => number) => {
      let i = 0;
      return () => vals[i++] ?? 0.5;
    };

    // Pocket rob on rich target (100,000 pocket coins)
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'a_rich'), coins: 100_000 });
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 't_rich'), coins: 100_000 });

    const pocketMin = svc.rob('g1', 'a_rich', 't_rich', now, makeSeq([0.0, 0.0]));
    expect(pocketMin.ok && pocketMin.success && pocketMin.amount).toBe(1_000); // 1%

    profileRepo.save({ ...profileRepo.getOrCreate('g1', 't_rich'), coins: 100_000 });
    const pocketMax = svc.rob('g1', 'a_rich', 't_rich', now, makeSeq([0.0, 1.0]));
    expect(pocketMax.ok && pocketMax.success && pocketMax.amount).toBe(50_000); // 50% (old 1,000 cap removed)

    // Pocket rob on minimum target (100 pocket coins) -> 1% = 1 (old 15 floor removed)
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 't_min'), coins: 100 });
    const pocketTiny = svc.rob('g1', 'a_rich', 't_min', now, makeSeq([0.0, 0.0]));
    expect(pocketTiny.ok && pocketTiny.success && pocketTiny.amount).toBe(1);

    // Pocket rob normal fail (15%) & trap fail (30%) on rich attacker (100,000 total assets)
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'a_fail'), coins: 100_000, bankCoins: 0 });
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 't_rich'), coins: 100_000 });
    const pocketFail = svc.rob('g1', 'a_fail', 't_rich', now, () => 0.99);
    expect(pocketFail.ok && !pocketFail.success && pocketFail.amount).toBe(15_000); // 15% (old 500 cap removed)

    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'a_trap'), coins: 100_000, bankCoins: 0 });
    chaosRepo.setEffect({
      guildId: 'g1',
      userId: 't_rich',
      effectKey: 'trap_armed',
      charges: 1,
      expiresAt: now + 3600_000,
      sourceUserId: null,
      updatedAt: now,
    });
    const pocketTrap = svc.rob('g1', 'a_trap', 't_rich', now, () => 0.99);
    expect(pocketTrap.ok && !pocketTrap.success && pocketTrap.trapped && pocketTrap.amount).toBe(30_000); // 30% (old 1,000 cap removed)

    // Pocket rob fail on minimum attacker (100 total assets) -> 15% = 15 (old 50 floor removed)
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'a_min'), coins: 100, bankCoins: 0 });
    const pocketFailMin = svc.rob('g1', 'a_min', 't_rich', now, () => 0.99);
    expect(pocketFailMin.ok && !pocketFailMin.success && pocketFailMin.amount).toBe(15);

    // Bank rob on rich target (200,000 bankCoins) -> 1% = 2,000, 50% = 100,000
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 't_bank'), coins: 0, bankCoins: 200_000 });
    const bankMin = svc.robBank('g1', 'a_rich', 't_bank', now, makeSeq([0.0, 0.0]));
    expect(bankMin.ok && bankMin.success && bankMin.amount).toBe(2_000);

    profileRepo.save({ ...profileRepo.getOrCreate('g1', 't_bank'), coins: 0, bankCoins: 200_000 });
    const bankMax = svc.robBank('g1', 'a_rich', 't_bank', now, makeSeq([0.0, 1.0]));
    expect(bankMax.ok && bankMax.success && bankMax.amount).toBe(100_000);

    // Bank rob normal fail (30%) & trap fail (50%) on rich attacker (100,000 total assets)
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'a_bfail'), coins: 100_000, bankCoins: 0 });
    const bankFail = svc.robBank('g1', 'a_bfail', 't_bank', now, () => 0.99);
    expect(bankFail.ok && !bankFail.success && bankFail.amount).toBe(30_000); // 30% (old 2,000 cap removed)

    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'a_btrap'), coins: 100_000, bankCoins: 0 });
    chaosRepo.setEffect({
      guildId: 'g1',
      userId: 't_bank',
      effectKey: 'trap_armed',
      charges: 1,
      expiresAt: now + 3600_000,
      sourceUserId: null,
      updatedAt: now,
    });
    const bankTrap = svc.robBank('g1', 'a_btrap', 't_bank', now, () => 0.99);
    expect(bankTrap.ok && !bankTrap.success && bankTrap.trapped && bankTrap.amount).toBe(50_000); // 50% (old 4,000 cap removed)

    db.close();
  });
});
