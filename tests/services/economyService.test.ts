import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { EconomyService, getDateKey } from '../../src/services/economyService.js';
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
      expect(c1.reward).toBe(200);
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
      expect(c2.reward).toBe(230);
    }

    // Skipped day resets streak to 1
    const day4 = day2 + 2 * 24 * 3600_000;
    const c4 = svc.claimDaily('g1', 'u1', day4);
    expect(c4.ok).toBe(true);
    if (c4.ok) {
      expect(c4.streak).toBe(1);
      expect(c4.reward).toBe(200);
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

    // Slots deterministic jackpot (max rng picks 7️⃣)
    const slots = svc.playSlots('g1', 'u1', 100, () => 0.999);
    expect(slots.ok).toBe(true);
    if (slots.ok) {
      expect(slots.reels).toEqual(['7️⃣', '7️⃣', '7️⃣']);
      expect(slots.netChange).toBe(1400);
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

    // Interest cap at bankInterestMax (500)
    const p = profileRepo.getOrCreate('g1', 'u1');
    profileRepo.save({ ...p, bankCoins: 100_000 });
    const day3 = day2 + 24 * 3600_000;
    const iCapped = svc.claimBankInterest('g1', 'u1', day3);
    expect(iCapped).toEqual({ ok: true, interest: 500, bankCoins: 100_500 });

    // Withdraw validation and execution
    expect(svc.withdraw('g1', 'u1', 0)).toEqual({ ok: false, reason: 'invalid_amount' });
    expect(svc.withdraw('g1', 'u1', -5)).toEqual({ ok: false, reason: 'invalid_amount' });
    expect(svc.withdraw('g1', 'u1', 100_501)).toEqual({
      ok: false,
      reason: 'insufficient_funds',
    });

    const w1 = svc.withdraw('g1', 'u1', 500);
    expect(w1).toEqual({ ok: true, amount: 500, coins: 500, bankCoins: 100_000 });

    const persisted = profileRepo.getOrCreate('g1', 'u1');
    expect(persisted.coins).toBe(500);
    expect(persisted.bankCoins).toBe(100_000);

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

    // 2. Success: steals 5%~12% of target bankCoins (capped at 500), applies shield, claims bounty
    chaosRepo.createBounty({
      guildId: 'g1',
      placerId: 'issuer1',
      targetId: 't2',
      amount: 800,
      createdAt: now - 1000,
    });
    const winRes = svc.robBank('g1', 'a1', 't2', now, () => 0.05); // 0.05 < default 0.20robBankSuccessRate
    expect(winRes.ok).toBe(true);
    if (winRes.ok) {
      expect(winRes.success).toBe(true);
      expect(winRes.amount).toBeGreaterThanOrEqual(10);
      expect(winRes.amount).toBeLessThanOrEqual(500);
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
});
