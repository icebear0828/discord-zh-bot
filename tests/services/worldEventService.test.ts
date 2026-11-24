import { describe, expect, it } from 'vitest';
import {
  PET_BOSS_BONUS_CAP,
  PREDICTION_LOCKED_EXPIRE_MS,
  PREDICTION_MAX_BET,
} from '../../src/config/economyConstants.js';
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
  it('blocks creator self-betting, requires locked status before settlement, expires 72h locked predictions, and supports single-ID lock & pagination', () => {
    const { db, profileRepo, worldEvent } = createFixture();
    profileRepo.addCoins('g1', 'creator', 5000);
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

    // Creator CANNOT bet on their own prediction!
    expect(
      worldEvent.placeBet({
        predictionId: predId,
        userId: 'creator',
        optionIndex: 0,
        amount: 100,
        nowMs: 1500,
      }),
    ).toEqual({ ok: false, reason: 'creator_cannot_bet' });

    // Exceeding PREDICTION_MAX_BET rejected
    expect(
      worldEvent.placeBet({
        predictionId: predId,
        userId: 'u1',
        optionIndex: 0,
        amount: PREDICTION_MAX_BET + 1,
        nowMs: 1600,
      }),
    ).toEqual({ ok: false, reason: 'invalid_amount' });

    expect(
      worldEvent.placeBet({ predictionId: predId, userId: 'u1', optionIndex: 0, amount: 100, nowMs: 2000 }).ok,
    ).toBe(true);
    expect(
      worldEvent.placeBet({ predictionId: predId, userId: 'u2', optionIndex: 0, amount: 200, nowMs: 2100 }).ok,
    ).toBe(true);
    expect(
      worldEvent.placeBet({ predictionId: predId, userId: 'u3', optionIndex: 1, amount: 300, nowMs: 2200 }).ok,
    ).toBe(true);

    // Non-creator non-admin cannot settle
    expect(worldEvent.settlePrediction(predId, 'u1', false, 0, 3000)).toEqual({
      ok: false,
      reason: 'no_permission',
    });

    // Creator CANNOT settle while still open!
    expect(worldEvent.settlePrediction(predId, 'creator', false, 0, 3500)).toEqual({
      ok: false,
      reason: 'not_locked',
    });

    // Creator locks (recording lockedAt) & settles option 0
    const lockedRes = worldEvent.lockPrediction(predId, 'creator', false, 3800);
    expect(lockedRes.ok).toBe(true);
    if (lockedRes.ok) {
      expect(lockedRes.summary.prediction.lockedAt).toBe(3800);
    }

    const settled = worldEvent.settlePrediction(predId, 'creator', false, 0, 4000);
    expect(settled.ok).toBe(true);
    if (settled.ok) {
      expect(settled.totalPool).toBe(600);
      expect(settled.refundedNoWinner).toBe(false);
      expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(1100);
      expect(profileRepo.getOrCreate('g1', 'u2').coins).toBe(1200);
      expect(profileRepo.getOrCreate('g1', 'u3').coins).toBe(700);
    }

    // Refund when winning option has zero bets (must lock first!)
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
      worldEvent.placeBet({
        predictionId: p2.summary.prediction.id,
        userId: 'u1',
        optionIndex: 0,
        amount: 250,
        nowMs: 11_000,
      });
      expect(worldEvent.lockPrediction(p2.summary.prediction.id, 'admin1', true, 11_500).ok).toBe(
        true,
      );
      const settleZero = worldEvent.settlePrediction(
        p2.summary.prediction.id,
        'admin1',
        true,
        1,
        12_000,
      );
      expect(settleZero.ok).toBe(true);
      if (settleZero.ok) {
        expect(settleZero.refundedNoWinner).toBe(true);
        expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(1100);
      }
    }

    // Single-ID lockPredictionIfDue does NOT lock other due predictions
    const p3 = worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'creator',
      title: '单ID封盘与72h超期自动退币',
      options: ['X', 'Y'],
      closeMinutes: 1,
      nowMs: 20_000,
    });
    const p4 = worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'creator',
      title: '另一个盘口',
      options: ['M', 'N'],
      closeMinutes: 1,
      nowMs: 20_000,
    });
    expect(p3.ok && p4.ok).toBe(true);
    if (p3.ok && p4.ok) {
      worldEvent.placeBet({
        predictionId: p3.summary.prediction.id,
        userId: 'u3',
        optionIndex: 1,
        amount: 100,
        nowMs: 21_000,
      });
      // Lock ONLY p3 via single-ID method
      const lockTime = 20_000 + 61_000;
      const lockedP3 = worldEvent.lockPredictionIfDue(p3.summary.prediction.id, lockTime);
      expect(lockedP3?.prediction.status).toBe('locked');
      expect(lockedP3?.prediction.lockedAt).toBe(lockTime);
      // p4 stays open!
      expect(worldEvent.getPredictionSummary(p4.summary.prediction.id)?.prediction.status).toBe('open');

      // 72h later: p3 auto-cancels & refunds u3
      expect(worldEvent.expireDueLockedPredictions(lockTime + PREDICTION_LOCKED_EXPIRE_MS - 1)).toHaveLength(0);
      const expiredLocked = worldEvent.expireDueLockedPredictions(lockTime + PREDICTION_LOCKED_EXPIRE_MS);
      expect(expiredLocked).toHaveLength(1);
      expect(expiredLocked[0]!.summary.prediction.id).toBe(p3.summary.prediction.id);
      expect(expiredLocked[0]!.summary.prediction.status).toBe('cancelled');
      expect(profileRepo.getOrCreate('g1', 'u3').coins).toBe(700);

      // bindPredictionMessage updates channel_id as well
      worldEvent.bindPredictionMessage(p4.summary.prediction.id, 'msg-p4', 'c-new');
      const reloaded = worldEvent.getPredictionSummary(p4.summary.prediction.id);
      expect(reloaded?.prediction.messageId).toBe('msg-p4');
      expect(reloaded?.prediction.channelId).toBe('c-new');

      // Pagination works cleanly
      const paged = worldEvent.listPredictionsPaginated('g1', 1, 1, ['open', 'locked']);
      expect(paged.items).toHaveLength(1);
      expect(paged.total).toBe(1);
      expect(paged.totalPages).toBe(1);
    }

    db.close();
  });

  it('caps Boss pet assist, enforces independent nextAttackAt cooldowns, snapshots rewardsJson, respects economy module on auto-spawn, and supports single-ID expire', () => {
    const { db, configRepo, profileRepo, socialPetRepo, worldEvent } = createFixture();
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateGames('g1', {
      ...cfg.games,
      eventMsgThreshold: 3,
      eventCooldownSec: 60,
      chestShares: 2,
      chestRewardMin: 500,
      chestRewardMax: 500,
      bossBaseHp: 250,
      bossRewardPool: 1000,
    });

    // Auto-spawn disabled when economy module is off
    configRepo.updateModules('g1', { ...cfg.modules, economy: false });
    expect(worldEvent.tryAutoSpawnOnMessage('g1', 'c1', 500, () => 0.1)).toBeNull();
    configRepo.updateModules('g1', { ...cfg.modules, economy: true });

    // 3rd message triggers auto spawn chest
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

    // Monster pet with ATK=9999 -> petBonus MUST be capped at PET_BOSS_BONUS_CAP (80)!
    socialPetRepo.createPet({
      guildId: 'g1',
      ownerId: 'u1',
      speciesKey: 'dino',
      nickname: '满级暴龙',
      rarity: 'SSR',
      hp: 2000,
      atk: 9999,
      spd: 200,
      critRate: 0.2,
      trait: '暴躁',
      isActive: true,
      createdAt: 5000,
    });

    const u1BeforeBoss = profileRepo.getOrCreate('g1', 'u1').coins;
    const boss = worldEvent.spawnBoss('g1', 'c1', 100_000, () => 0.5);
    expect(worldEvent.listActiveWorldEvents('g1')).toHaveLength(1);

    // Bind message with new channelId updates channel_id
    worldEvent.bindWorldEventMessage(boss.id, 'msg-boss-1', 'c-boss-new');
    expect(worldEvent.getWorldEventDetail(boss.id)?.event.channelId).toBe('c-boss-new');

    // Heavy attack sets nextAttackAt = 101_000 + 25_000 = 126_000 -> normal attack at 114_000 (+13s) STILL BLOCKED!
    const heavyMiss = worldEvent.attackBoss(boss.id, 'u2', 'heavy', 101_000, () => 0.1);
    expect(heavyMiss.ok).toBe(true);
    expect(worldEvent.attackBoss(boss.id, 'u2', 'normal', 114_000, () => 0.5)).toMatchObject({
      ok: false,
      reason: 'cooldown',
    });
    // At 126_000 (+25s), u2 can attack again
    expect(worldEvent.attackBoss(boss.id, 'u2', 'normal', 126_000, () => 0.5).ok).toBe(true);

    // Normal attack sets nextAttackAt = 103_000 + 12_000 = 115_000 -> heavy attack at 116_000 (+13s) IS ALLOWED!
    const hit1 = worldEvent.attackBoss(boss.id, 'u1', 'normal', 103_000, () => 0.5);
    expect(hit1.ok).toBe(true);
    if (hit1.ok) {
      expect(hit1.petBonus).toBe(PET_BOSS_BONUS_CAP);
    }

    // Finish boss with heavy attack at +13s after normal attack
    const killHit = worldEvent.attackBoss(boss.id, 'u1', 'heavy', 116_000, () => 0.99);
    expect(killHit.ok).toBe(true);
    if (killHit.ok) {
      expect(killHit.killed).toBe(true);
      expect(killHit.rewards.length).toBeGreaterThanOrEqual(1);
      // rewards_json snapshot persisted!
      const saved = worldEvent.getWorldEventDetail(boss.id);
      expect(saved?.event.rewardsJson).toBe(JSON.stringify(killHit.rewards));
      expect(profileRepo.getOrCreate('g1', 'u1').coins).toBeGreaterThan(u1BeforeBoss);
    }

    // Single-ID expireWorldEventIfDue leaves other active events intact & persists consolation snapshot
    const bossA = worldEvent.spawnBoss('g1', 'c1', 200_000, () => 0.2);
    const bossB = worldEvent.spawnBoss('g1', 'c1', 200_000, () => 0.3);
    expect(worldEvent.listActiveWorldEvents('g1')).toHaveLength(2);
    worldEvent.attackBoss(bossA.id, 'u3', 'normal', 201_000, () => 0.5);

    const expiredA = worldEvent.expireWorldEventIfDue(bossA.id, 200_000 + 11 * 60 * 1000);
    expect(expiredA).not.toBeNull();
    expect(expiredA?.consolations).toHaveLength(1);
    expect(expiredA?.event.rewardsJson).toBe(JSON.stringify(expiredA?.consolations));
    expect(profileRepo.getOrCreate('g1', 'u3').coins).toBeGreaterThanOrEqual(30);
    // bossB was NOT touched by single-ID expire!
    expect(worldEvent.getWorldEventDetail(bossB.id)?.event.status).toBe('active');

    db.close();
  });
});
