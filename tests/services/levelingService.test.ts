import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import {
  calculateLevelProgress,
  getHeatMultiplier,
  LevelingService,
  xpRequiredForLevel,
} from '../../src/services/levelingService.js';

describe('levelingService', () => {
  it('computes XP curve and heat multiplier brackets accurately', () => {
    expect(xpRequiredForLevel(0)).toBe(100);
    expect(xpRequiredForLevel(1)).toBe(190);
    expect(getHeatMultiplier(0, 2.0)).toBe(1.0);
    expect(getHeatMultiplier(2, 2.0)).toBe(1.25);
    expect(getHeatMultiplier(4, 2.0)).toBe(1.5);
    expect(getHeatMultiplier(6, 2.0)).toBe(1.75);
    expect(getHeatMultiplier(8, 2.0)).toBe(2.0);
    expect(getHeatMultiplier(10, 1.5)).toBe(1.5);

    const progress = calculateLevelProgress(150);
    expect(progress.level).toBe(1);
    expect(progress.currentLevelXp).toBe(50);
    expect(progress.nextLevelXp).toBe(190);
  });

  it('enforces cooldown, escalates chat heat within window, resets after window, and applies hourly cap', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const inviteRepo = new InviteRepo(db);
    const svc = new LevelingService(configRepo, profileRepo, inviteRepo);

    const t0 = 1_700_000_000_000;
    const r1 = svc.awardMessageXp('g1', 'u1', 'c1', t0, () => 0.5);
    expect(r1.awarded).toBe(true);
    expect(r1.heatStreak).toBe(1);
    expect(r1.heatMultiplier).toBe(1.0);
    expect(r1.xpGained).toBe(20);

    // Within 15s cooldown -> ignored
    const rCooldown = svc.awardMessageXp('g1', 'u1', 'c1', t0 + 10_000, () => 0.5);
    expect(rCooldown.awarded).toBe(false);
    expect(rCooldown.reason).toBe('cooldown');

    // 20s later -> heatStreak 2 => 1.25x => 25 XP
    const r2 = svc.awardMessageXp('g1', 'u1', 'c1', t0 + 20_000, () => 0.5);
    expect(r2.awarded).toBe(true);
    expect(r2.heatStreak).toBe(2);
    expect(r2.heatMultiplier).toBe(1.25);
    expect(r2.xpGained).toBe(25);

    // After heat window (200s > 180s) -> resets back to streak 1 (1.0x)
    const r3 = svc.awardMessageXp('g1', 'u1', 'c1', t0 + 220_000, () => 0.5);
    expect(r3.awarded).toBe(true);
    expect(r3.heatStreak).toBe(1);
    expect(r3.heatMultiplier).toBe(1.0);

    // Hourly cap enforcement
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateLeveling('g1', { ...cfg.leveling, hourlyXpCap: 70 });
    const r4 = svc.awardMessageXp('g1', 'u1', 'c1', t0 + 240_000, () => 0.5);
    expect(r4.awarded).toBe(true);
    expect(r4.xpGained).toBe(5); // 20 + 25 + 20 = 65 earned so far; cap 70 leaves 5
    const r5 = svc.awardMessageXp('g1', 'u1', 'c1', t0 + 260_000, () => 0.5);
    expect(r5.awarded).toBe(false);
    expect(r5.reason).toBe('hourly_cap');

    db.close();
  });

  it('handles ignored channels, channel multipliers, XP boost cards, level-up coins, and role stacking', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const inviteRepo = new InviteRepo(db);
    const svc = new LevelingService(configRepo, profileRepo, inviteRepo);

    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateLeveling('g1', {
      ...cfg.leveling,
      ignoredChannelIds: ['c-ignored'],
      channelMultipliers: { 'c-bonus': 1.5 },
      stackRoles: false,
      levelUpCoinReward: 150,
    });
    profileRepo.setLevelReward('g1', 1, 'role-lv1');
    profileRepo.setLevelReward('g1', 2, 'role-lv2');

    expect(svc.awardMessageXp('g1', 'u1', 'c-ignored', 1_000_000).reason).toBe('ignored_channel');

    // Give active 2x XP boost card and start near level 2 threshold (100 + 190 = 290)
    const p = profileRepo.getOrCreate('g1', 'u1');
    profileRepo.save({
      ...p,
      xp: 260,
      level: 1,
      xpBoostMultiplier: 2.0,
      xpBoostExpiresAt: 5_000_000,
    });

    // Base 20 * channel 1.5 * boost 2.0 = 60 -> total 320 >= 290 (level 2!)
    const res = svc.awardMessageXp('g1', 'u1', 'c-bonus', 1_000_000, () => 0.5);
    expect(res.awarded).toBe(true);
    expect(res.xpGained).toBe(60);
    expect(res.leveledUp).toBe(true);
    expect(res.oldLevel).toBe(1);
    expect(res.newLevel).toBe(2);
    expect(res.coinsAwarded).toBe(150);
    expect(res.rolesToAdd).toEqual(['role-lv2']);
    expect(res.rolesToRemove).toEqual(['role-lv1']);

    // Voice XP when enabled
    const voiceRes = svc.awardVoiceXp('g1', 'u1', 1_060_000);
    expect(voiceRes.awarded).toBe(true);
    expect(voiceRes.xpGained).toBe(20); // 10 * 2.0 boost

    db.close();
  });
});
