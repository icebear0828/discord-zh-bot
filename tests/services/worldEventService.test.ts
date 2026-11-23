import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { WorldEventRepo } from '../../src/db/repositories/worldEventRepo.js';
import { WorldEventService } from '../../src/services/worldEventService.js';

function createFixture() {
  const db = createDatabase(':memory:');
  const configRepo = new GuildConfigRepo(db);
  const profileRepo = new ProfileRepo(db);
  const worldEventRepo = new WorldEventRepo(db);
  const socialPetRepo = new SocialPetRepo(db);
  const worldEvent = new WorldEventService(
    db,
    configRepo,
    profileRepo,
    worldEventRepo,
    socialPetRepo,
  );
  return { db, configRepo, profileRepo, worldEventRepo, socialPetRepo, worldEvent };
}

describe('WorldEventService (predictions, chest, boss, auto-spawn)', () => {
  it('handles predictions with proportional payouts, permission checks, refunds, and auto-lock', () => {
    const { db, profileRepo, worldEvent } = createFixture();
    profileRepo.addCoins('g1', 'u1', 1000);
    profileRepo.addCoins('g1', 'u2', 1000);
    profileRepo.addCoins('g1', 'u3', 1000);

    const created = worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'creator',
      title: '今晚会不会发大红包？',
      options: ['会', '不会', '发一半'],
      closeMinutes: 10,
      nowMs: 1000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const predId = created.summary.prediction.id;

    expect(worldEvent.placeBet({ predictionId: predId, userId: 'u1', optionIndex: 0, amount: 100, nowMs: 2000 }).ok).toBe(true);
    expect(worldEvent.placeBet({ predictionId: predId, userId: 'u2', optionIndex: 0, amount: 200, nowMs: 2100 }).ok).toBe(true);
    expect(worldEvent.placeBet({ predictionId: predId, userId: 'u3', optionIndex: 1, amount: 300, nowMs: 2200 }).ok).toBe(true);

    // Non-creator non-admin cannot settle
    expect(worldEvent.settlePrediction(predId, 'u1', false, 0, 3000)).toEqual({
      ok: false,
      reason: 'no_permission',
    });

    // Creator locks & settles option 0 -> totalPool = 600, u1 (100/300 -> 200), u2 (200/300 -> 400)
    expect(worldEvent.lockPrediction(predId, 'creator', false).ok).toBe(true);
    const settled = worldEvent.settlePrediction(predId, 'creator', false, 0, 4000);
    expect(settled.ok).toBe(true);
    if (settled.ok) {
      expect(settled.totalPool).toBe(600);
      expect(settled.refundedNoWinner).toBe(false);
      expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(1100);
      expect(profileRepo.getOrCreate('g1', 'u2').coins).toBe(1200);
      expect(profileRepo.getOrCreate('g1', 'u3').coins).toBe(700);
    }

    // Refund when winning option has zero bets
    const p2 = worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'creator',
      title: '流局退币测试',
      options: ['A', 'B'],
      closeMinutes: 5,
      nowMs: 10_000,
    });
    expect(p2.ok).toBe(true);
    if (p2.ok) {
      worldEvent.placeBet({ predictionId: p2.summary.prediction.id, userId: 'u1', optionIndex: 0, amount: 250, nowMs: 11_000 });
      const settleZero = worldEvent.settlePrediction(p2.summary.prediction.id, 'admin1', true, 1, 12_000);
      expect(settleZero.ok).toBe(true);
      if (settleZero.ok) {
        expect(settleZero.refundedNoWinner).toBe(true);
        expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(1100); // restored
      }
    }

    // Cancel refunds all bets
    const p3 = worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'creator',
      title: '自动封盘与作废测试',
      options: ['X', 'Y'],
      closeMinutes: 1,
      nowMs: 20_000,
    });
    if (p3.ok) {
      worldEvent.placeBet({ predictionId: p3.summary.prediction.id, userId: 'u3', optionIndex: 1, amount: 100, nowMs: 21_000 });
      const lockedList = worldEvent.autoLockDuePredictions(20_000 + 61_000);
      expect(lockedList.some((s) => s.prediction.id === p3.summary.prediction.id && s.prediction.status === 'locked')).toBe(true);
      const cancelRes = worldEvent.cancelPrediction(p3.summary.prediction.id, 'creator', false, 90_000);
      expect(cancelRes.ok).toBe(true);
      expect(profileRepo.getOrCreate('g1', 'u3').coins).toBe(700);
    }

    db.close();
  });

  it('spawns chests and bosses, tracks pet assist + cooldowns + kill MVP, and auto-spawns on messages', () => {
    const { db, configRepo, profileRepo, socialPetRepo, worldEvent } = createFixture();
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateGames('g1', {
      ...cfg.games,
      eventMsgThreshold: 3,
      eventCooldownSec: 60,
      chestShares: 2,
      chestRewardMin: 500,
      chestRewardMax: 500,
      bossBaseHp: 120,
      bossRewardPool: 1000,
    });

    // 3rd message triggers auto spawn chest (rng < 0.55)
    expect(worldEvent.tryAutoSpawnOnMessage('g1', 'c1', 1000, () => 0.1)).toBeNull();
    expect(worldEvent.tryAutoSpawnOnMessage('g1', 'c1', 2000, () => 0.1)).toBeNull();
    const chest = worldEvent.tryAutoSpawnOnMessage('g1', 'c1', 3000, () => 0.1);
    expect(chest).not.toBeNull();
    expect(chest?.eventType).toBe('chest');

    if (chest) {
      const c1 = worldEvent.claimChest(chest.id, 'u1', 4000, () => 0.5);
      expect(c1.ok).toBe(true);
      expect(worldEvent.claimChest(chest.id, 'u1', 4100)).toEqual({
        ok: false,
        reason: 'already_claimed',
      });
      const c2 = worldEvent.claimChest(chest.id, 'u2', 4200);
      expect(c2.ok).toBe(true);
      if (c1.ok && c2.ok) {
        expect(c1.amount + c2.amount).toBe(500);
        expect(c2.event.status).toBe('completed');
      }
    }

    // Spawn Boss with pet assist on u1 (ATK = 40 -> +20 assist)
    socialPetRepo.createPet({
      guildId: 'g1',
      ownerId: 'u1',
      speciesKey: 'dino',
      nickname: '助战暴龙',
      rarity: 'SSR',
      hp: 200,
      atk: 40,
      spd: 30,
      critRate: 0.2,
      trait: '暴躁',
      isActive: true,
      createdAt: 5000,
    });

    const u1BeforeBoss = profileRepo.getOrCreate('g1', 'u1').coins;
    const boss = worldEvent.spawnBoss('g1', 'c1', 100_000, () => 0.5);
    expect(boss.maxHp).toBe(120);

    // Heavy attack miss when first rng < 0.25 -> 0 damage, triggers 25s cooldown
    const missHit = worldEvent.attackBoss(boss.id, 'u2', 'heavy', 101_000, () => 0.1);
    expect(missHit.ok).toBe(true);
    if (missHit.ok) {
      expect(missHit.missed).toBe(true);
      expect(missHit.damage).toBe(0);
    }
    expect(worldEvent.attackBoss(boss.id, 'u2', 'heavy', 102_000, () => 0.5)).toMatchObject({
      ok: false,
      reason: 'cooldown',
    });

    // u1 normal attacks with crit + pet assist (rng 0.99 base + rng 0.05 crit): base ~65 * 1.5 + 20 = 117 damage!
    let step = 0;
    const hitRolls = [0.99, 0.05];
    const hit1 = worldEvent.attackBoss(boss.id, 'u1', 'normal', 103_000, () => hitRolls[step++] ?? 0.5);
    expect(hit1.ok).toBe(true);
    if (hit1.ok) {
      expect(hit1.petBonus).toBe(20);
      expect(hit1.damage).toBeGreaterThanOrEqual(80);
      expect(hit1.killed).toBe(false);
    }

    // Finish boss after 12s cooldown
    const killHit = worldEvent.attackBoss(boss.id, 'u1', 'normal', 116_000, () => 0.5);
    expect(killHit.ok).toBe(true);
    if (killHit.ok) {
      expect(killHit.killed).toBe(true);
      // Solo killer gets full 1000 rewardPool + 250 MVP tail-blow bonus = +1250!
      expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(u1BeforeBoss + 1250);
    }

    // Test Boss escape consolation reward
    const boss2 = worldEvent.spawnBoss('g1', 'c1', 200_000, () => 0.2);
    worldEvent.attackBoss(boss2.id, 'u3', 'normal', 201_000, () => 0.5);
    const expired = worldEvent.expireDueWorldEvents(200_000 + 11 * 60 * 1000);
    expect(expired).toHaveLength(1);
    expect(expired[0]!.consolations).toHaveLength(1);
    expect(profileRepo.getOrCreate('g1', 'u3').coins).toBeGreaterThanOrEqual(30);

    db.close();
  });
});
