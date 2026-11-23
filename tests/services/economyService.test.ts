import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { EconomyService, getDateKey } from '../../src/services/economyService.js';

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
});
