import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { BlackjackRepo, type BlackjackGameRecord } from '../../src/db/repositories/blackjackRepo.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { DuelRepo } from '../../src/db/repositories/duelRepo.js';
import { MonitorRepo } from '../../src/db/repositories/monitorRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo } from '../../src/db/repositories/redPacketRepo.js';
import { WorldEventRepo } from '../../src/db/repositories/worldEventRepo.js';
import {
  BANK_ROB_ATTACKER_MIN_ASSETS,
  BANK_ROB_LOCKPICK_CAP,
  BANK_ROB_TARGET_MIN,
  BLACKJACK_TTL_MS,
  DUEL_BOUNTY_MIN_BET,
  DUEL_BOUNTY_MIN_BET_RATIO,
  DUEL_TTL_MS,
  ECONOMY_CONSTANTS,
  MAX_SOLO_GAMBLE_BET,
  MONITOR_RETENTION_MS,
  PET_BOSS_BONUS_CAP,
  PET_MAX_LEVEL,
  PET_PVP_COOLDOWN_MS,
  PET_PVP_DAILY_XP_CAP,
  PET_WORK_LEVEL_BONUS_CAP,
  PREDICTION_LOCKED_EXPIRE_MS,
  ROB_ATTACKER_MIN_ASSETS,
  ROB_LOCKPICK_CAP,
  ROB_STEAL_MAX_AMOUNT,
  ROB_TARGET_MIN_COINS,
  SHOP_MYSTERY_BOX_MIN_PRICE,
} from '../../src/config/economyConstants.js';

describe('Wave 1 persistence repositories & economy constants', () => {
  it('supports BlackjackRepo upsert, get, listAllActive, listExpired, and delete', () => {
    const db = createDatabase(':memory:');
    const repo = new BlackjackRepo(db);

    expect(repo.get('g1', 'u1')).toBeNull();
    expect(repo.listAllActive()).toEqual([]);
    expect(repo.listExpired(10_000)).toEqual([]);

    const game1: BlackjackGameRecord = {
      guildId: 'g1',
      userId: 'u1',
      bet: 200,
      deck: [
        { rank: 'A', suit: '♠' },
        { rank: '10', suit: '♥' },
      ],
      playerHand: [
        { rank: '9', suit: '♦' },
        { rank: '7', suit: '♣' },
      ],
      dealerHand: [
        { rank: 'K', suit: '♠' },
        { rank: '5', suit: '♥' },
      ],
      status: 'playing',
      payout: 0,
      canDouble: true,
      createdAt: 1_000,
      expiresAt: 5_000,
    };

    const game2: BlackjackGameRecord = {
      ...game1,
      userId: 'u2',
      bet: 500,
      status: 'playing',
      canDouble: false,
      createdAt: 2_000,
      expiresAt: 15_000,
    };

    const game3Finished: BlackjackGameRecord = {
      ...game1,
      userId: 'u3',
      status: 'player_win',
      payout: 400,
      canDouble: false,
      createdAt: 3_000,
      expiresAt: 4_000,
    };

    repo.upsert(game1);
    repo.upsert(game2);
    repo.upsert(game3Finished);

    expect(repo.get('g1', 'u1')).toEqual(game1);
    expect(repo.listAllActive().map((g) => g.userId)).toEqual(['u1', 'u2']);
    expect(repo.listExpired(5_000).map((g) => g.userId)).toEqual(['u3', 'u1']);

    // Upsert updates existing row on (guild_id, user_id) conflict
    const updatedGame1: BlackjackGameRecord = {
      ...game1,
      bet: 400,
      canDouble: false,
      playerHand: [...game1.playerHand, { rank: '4', suit: '♠' }],
    };
    repo.upsert(updatedGame1);
    const loaded = repo.get('g1', 'u1');
    expect(loaded?.bet).toBe(400);
    expect(loaded?.canDouble).toBe(false);
    expect(loaded?.playerHand).toHaveLength(3);

    expect(repo.delete('g1', 'u1')).toBe(true);
    expect(repo.delete('g1', 'u1')).toBe(false);
    expect(repo.get('g1', 'u1')).toBeNull();

    db.close();
  });

  it('supports DuelRepo CRUD, message binding, status transitions, due listing, and cleanup', () => {
    const db = createDatabase(':memory:');
    const repo = new DuelRepo(db);

    const d1 = repo.create({
      id: 'duel-1',
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'u1',
      opponentId: 'u2',
      bet: 300,
      createdAt: 1_000,
      expiresAt: 10_000,
    });
    expect(d1.messageId).toBeNull();
    expect(d1.status).toBe('pending');

    expect(repo.bindMessageId('duel-1', 'msg-101')).toBe(true);
    expect(repo.bindMessageId('missing', 'msg-999')).toBe(false);
    expect(repo.getById('duel-1')?.messageId).toBe('msg-101');

    repo.create({
      id: 'duel-2',
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'u3',
      opponentId: 'u4',
      bet: 100,
      createdAt: 2_000,
      expiresAt: 20_000,
    });

    repo.create({
      id: 'duel-3',
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'u5',
      opponentId: 'u6',
      bet: 500,
      status: 'completed',
      createdAt: 500,
      expiresAt: 5_000,
    });

    expect(repo.listDuePending(9_999)).toEqual([]);
    expect(repo.listDuePending(10_000).map((d) => d.id)).toEqual(['duel-1']);
    expect(repo.listDuePending(25_000).map((d) => d.id)).toEqual(['duel-1', 'duel-2']);

    // CAS-guarded status transition
    expect(repo.updateStatus('duel-1', 'declined', 'completed')).toBe(false);
    expect(repo.updateStatus('duel-1', 'expired', 'pending')).toBe(true);
    expect(repo.getById('duel-1')?.status).toBe('expired');

    // Simple status update
    expect(repo.updateStatus('duel-2', 'completed')).toBe(true);
    expect(repo.getById('duel-2')?.status).toBe('completed');

    // Cleanup only deletes finished duels with expires_at <= beforeMs
    repo.create({
      id: 'duel-4',
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'u7',
      opponentId: 'u8',
      bet: 200,
      status: 'pending',
      createdAt: 100,
      expiresAt: 1_000,
    });

    const cleaned = repo.cleanupOldFinished(10_000);
    expect(cleaned).toBe(2); // duel-3 (5_000) and duel-1 (10_000)
    expect(repo.getById('duel-1')).toBeNull();
    expect(repo.getById('duel-3')).toBeNull();
    expect(repo.getById('duel-2')).not.toBeNull(); // expiresAt 20_000 > 10_000
    expect(repo.getById('duel-4')).not.toBeNull(); // still pending

    db.close();
  });

  it('persists RedPacketRepo.systemFunded and ProfileRepo pet tracking fields', () => {
    const db = createDatabase(':memory:');
    const redPacketRepo = new RedPacketRepo(db);
    const profileRepo = new ProfileRepo(db);

    const userPacket = redPacketRepo.create({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'u1',
      totalAmount: 1000,
      totalCount: 5,
      greeting: '玩家发包',
      expiresAt: 10_000,
      createdAt: 1_000,
    });
    expect(userPacket.systemFunded).toBe(false);

    const sysPacket = redPacketRepo.create({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'admin1',
      totalAmount: 5000,
      totalCount: 10,
      greeting: '系统福利',
      expiresAt: 10_000,
      createdAt: 1_000,
      systemFunded: true,
    });
    expect(sysPacket.systemFunded).toBe(true);
    expect(redPacketRepo.getById(sysPacket.id)?.systemFunded).toBe(true);
    expect(redPacketRepo.listDueOpen(10_000).map((p) => p.systemFunded)).toEqual([false, true]);

    const profile = profileRepo.getOrCreate('g1', 'u1');
    expect(profile.lastPetWorkAt).toBe(0);
    expect(profile.petPvpXpDate).toBe('');
    expect(profile.petPvpXpDaily).toBe(0);

    profileRepo.save({
      ...profile,
      lastPetWorkAt: 1_700_000_000_000,
      petPvpXpDate: '2026-11-24',
      petPvpXpDaily: 90,
    });

    const reloaded = profileRepo.getOrCreate('g1', 'u1');
    expect(reloaded.lastPetWorkAt).toBe(1_700_000_000_000);
    expect(reloaded.petPvpXpDate).toBe('2026-11-24');
    expect(reloaded.petPvpXpDaily).toBe(90);

    db.close();
  });

  it('isolates single-ID cancellations/expirations and persists payoutsJson in ChaosRepo', () => {
    const db = createDatabase(':memory:');
    const chaosRepo = new ChaosRepo(db);

    const bomb1 = chaosRepo.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u1',
      penalty: 200,
      minBound: 1,
      maxBound: 100,
      secretNumber: 55,
      createdAt: 1_000,
      expiresAt: 10_000,
    });
    const bomb2 = chaosRepo.createNumberBomb({
      guildId: 'g2',
      channelId: 'c2',
      hostId: 'u2',
      penalty: 500,
      minBound: 1,
      maxBound: 100,
      secretNumber: 77,
      createdAt: 1_000,
      expiresAt: 10_000,
    });
    const bomb3 = chaosRepo.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u3',
      penalty: 300,
      minBound: 1,
      maxBound: 100,
      secretNumber: 33,
      createdAt: 1_000,
      expiresAt: 10_000,
    });

    expect(bomb1.payoutsJson).toBe('[]');
    const payouts = JSON.stringify([{ userId: 'u9', amount: 200 }]);
    chaosRepo.saveNumberBomb({ ...bomb1, payoutsJson: payouts });
    expect(chaosRepo.getNumberBombById(bomb1.id)?.payoutsJson).toBe(payouts);

    // Cancel bomb1 by ID only; bomb2 and bomb3 remain open
    expect(chaosRepo.cancelNumberBombById(bomb1.id)).toBe(true);
    expect(chaosRepo.cancelNumberBombById(bomb1.id)).toBe(false); // already cancelled
    expect(chaosRepo.getNumberBombById(bomb1.id)?.status).toBe('cancelled');
    expect(chaosRepo.getNumberBombById(bomb2.id)?.status).toBe('open');
    expect(chaosRepo.getNumberBombById(bomb3.id)?.status).toBe('open');

    // Expire bomb3 by ID only; bomb2 remains open
    expect(chaosRepo.expireNumberBombById(bomb3.id)).toBe(true);
    expect(chaosRepo.expireNumberBombById(bomb3.id)).toBe(false);
    expect(chaosRepo.getNumberBombById(bomb3.id)?.status).toBe('cancelled');
    expect(chaosRepo.getNumberBombById(bomb2.id)?.status).toBe('open');

    // Roulette single-ID expiration isolation
    const r1 = chaosRepo.createRoulette({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u1',
      entryFee: 100,
      maxPlayers: 4,
      createdAt: 1_000,
      turnDeadline: 5_000,
    });
    const r2 = chaosRepo.createRoulette({
      guildId: 'g2',
      channelId: 'c2',
      hostId: 'u2',
      entryFee: 200,
      maxPlayers: 6,
      createdAt: 1_000,
      turnDeadline: 5_000,
    });

    expect(chaosRepo.expireRouletteById(r1.id, 6_000)).toBe(true);
    expect(chaosRepo.expireRouletteById(r1.id, 7_000)).toBe(false);
    expect(chaosRepo.getRouletteById(r1.id)?.status).toBe('cancelled');
    expect(chaosRepo.getRouletteById(r1.id)?.updatedAt).toBe(6_000);
    expect(chaosRepo.getRouletteById(r2.id)?.status).toBe('recruiting');

    db.close();
  });

  it('supports WorldEventRepo new fields, channelId rebinding, pagination, and due locked queries', () => {
    const db = createDatabase(':memory:');
    const repo = new WorldEventRepo(db);

    const p1 = repo.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'u1',
      title: '盘口1',
      options: ['A', 'B'],
      closesAt: 5_000,
      createdAt: 1_000,
    });
    const p2 = repo.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'u1',
      title: '盘口2',
      options: ['A', 'B'],
      closesAt: 6_000,
      createdAt: 2_000,
    });
    const p3 = repo.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'u1',
      title: '盘口3',
      options: ['A', 'B'],
      closesAt: 7_000,
      createdAt: 3_000,
    });

    expect(p1.lockedAt).toBe(0);

    // Rebind messageId with and without channelId
    repo.bindPredictionMessage(p1.id, 'm-1');
    expect(repo.getPredictionById(p1.id)?.messageId).toBe('m-1');
    expect(repo.getPredictionById(p1.id)?.channelId).toBe('c1');

    repo.bindPredictionMessage(p1.id, 'm-2', 'c-new');
    expect(repo.getPredictionById(p1.id)?.messageId).toBe('m-2');
    expect(repo.getPredictionById(p1.id)?.channelId).toBe('c-new');

    // Lock with explicit lockedAt & query due locked predictions
    repo.updatePredictionStatus(p1.id, 'locked', null, null, 10_000);
    repo.updatePredictionStatus(p2.id, 'locked', null, null, 30_000);
    expect(repo.getPredictionById(p1.id)?.lockedAt).toBe(10_000);
    expect(repo.listDueLockedPredictions(20_000).map((p) => p.id)).toEqual([p1.id]);
    expect(repo.listDueLockedPredictions(30_000).map((p) => p.id)).toEqual([p1.id, p2.id]);

    // Legacy row fallback when locked_at = 0 uses closes_at
    db.prepare("UPDATE predictions SET status = 'locked', locked_at = 0 WHERE id = ?").run(p3.id);
    expect(repo.listDueLockedPredictions(7_000).map((p) => p.id)).toEqual([p3.id]);

    // Pagination
    const page1 = repo.listPredictionsPaginated('g1', 0, 2);
    expect(page1.total).toBe(3);
    expect(page1.items.map((p) => p.id)).toEqual([p3.id, p2.id]);
    const page2 = repo.listPredictionsPaginated('g1', 2, 2);
    expect(page2.total).toBe(3);
    expect(page2.items.map((p) => p.id)).toEqual([p1.id]);

    // World events: rewardsJson, channelId rebind, listActiveWorldEvents with limit, participant nextAttackAt
    const e1 = repo.createWorldEvent({
      guildId: 'g1',
      channelId: 'c1',
      eventType: 'boss',
      name: 'Boss 1',
      flavor: 'f1',
      maxHp: 1000,
      currentHp: 1000,
      rewardPool: 3000,
      totalShares: 0,
      remainingShares: 0,
      remainingAmount: 3000,
      createdAt: 1_000,
      expiresAt: 100_000,
    });
    const e2 = repo.createWorldEvent({
      guildId: 'g1',
      channelId: 'c1',
      eventType: 'chest',
      name: 'Chest 1',
      flavor: 'f2',
      maxHp: 0,
      currentHp: 0,
      rewardPool: 1000,
      totalShares: 5,
      remainingShares: 5,
      remainingAmount: 1000,
      createdAt: 2_000,
      expiresAt: 100_000,
    });

    expect(e1.rewardsJson).toBe('[]');
    expect(repo.listActiveWorldEvents('g1')).toHaveLength(2);
    expect(repo.listActiveWorldEvents('g1', 1).map((e) => e.id)).toEqual([e2.id]);

    repo.bindWorldEventMessage(e1.id, 'em-1', 'c-boss');
    expect(repo.getWorldEventById(e1.id)?.messageId).toBe('em-1');
    expect(repo.getWorldEventById(e1.id)?.channelId).toBe('c-boss');

    const rewardsSnapshot = JSON.stringify([{ userId: 'u1', reward: 1500 }]);
    repo.saveWorldEvent({ ...repo.getWorldEventById(e1.id)!, rewardsJson: rewardsSnapshot });
    expect(repo.getWorldEventById(e1.id)?.rewardsJson).toBe(rewardsSnapshot);

    repo.upsertParticipant({
      eventId: e1.id,
      userId: 'u1',
      delta: 120,
      hitsDelta: 1,
      actionAt: 5_000,
      nextAttackAt: 30_000,
    });
    expect(repo.getParticipant(e1.id, 'u1')?.nextAttackAt).toBe(30_000);

    // Subsequent upsert without nextAttackAt preserves existing nextAttackAt
    repo.upsertParticipant({
      eventId: e1.id,
      userId: 'u1',
      delta: 50,
      hitsDelta: 1,
      actionAt: 31_000,
    });
    expect(repo.getParticipant(e1.id, 'u1')).toMatchObject({
      damageOrReward: 170,
      hits: 2,
      lastActionAt: 31_000,
      nextAttackAt: 30_000,
    });

    // Updating with new nextAttackAt overwrites it
    repo.upsertParticipant({
      eventId: e1.id,
      userId: 'u1',
      delta: 80,
      hitsDelta: 1,
      actionAt: 32_000,
      nextAttackAt: 44_000,
    });
    expect(repo.getParticipant(e1.id, 'u1')?.nextAttackAt).toBe(44_000);

    db.close();
  });

  it('prunes old interaction logs via MonitorRepo.pruneOlderThan', () => {
    const db = createDatabase(':memory:');
    const monitorRepo = new MonitorRepo(db);

    monitorRepo.record({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      userName: 'Alice',
      interactionType: 'button',
      interactionKey: 'menu:home',
      status: 'ok',
      durationMs: 25,
      createdAt: 1_000,
    });
    monitorRepo.record({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u2',
      userName: 'Bob',
      interactionType: 'command',
      interactionKey: '/签到',
      status: 'ok',
      durationMs: 40,
      createdAt: 5_000,
    });
    monitorRepo.record({
      guildId: 'g2',
      channelId: 'c2',
      userId: 'u3',
      userName: 'Charlie',
      interactionType: 'modal',
      interactionKey: 'menu:modal',
      status: 'error',
      durationMs: 120,
      createdAt: 10_000,
    });

    const deleted = monitorRepo.pruneOlderThan(5_000);
    expect(deleted).toBe(1);

    const remainingG1 = monitorRepo.listRecent('g1', { limit: 10 });
    expect(remainingG1).toHaveLength(1);
    expect(remainingG1[0]?.createdAt).toBe(5_000);

    const remainingG2 = monitorRepo.listRecent('g2', { limit: 10 });
    expect(remainingG2).toHaveLength(1);
    expect(remainingG2[0]?.createdAt).toBe(10_000);

    expect(monitorRepo.pruneOlderThan(5_000)).toBe(0);

    db.close();
  });

  it('exports consistent shared economy constants', () => {
    expect(ROB_TARGET_MIN_COINS).toBe(100);
    expect(ROB_ATTACKER_MIN_ASSETS).toBe(100);
    expect(ROB_STEAL_MAX_AMOUNT).toBe(1000);
    expect(ROB_LOCKPICK_CAP).toBe(0.85);
    expect(BANK_ROB_TARGET_MIN).toBe(100);
    expect(BANK_ROB_ATTACKER_MIN_ASSETS).toBe(100);
    expect(BANK_ROB_LOCKPICK_CAP).toBe(0.5);
    expect(MAX_SOLO_GAMBLE_BET).toBe(1_000_000);
    expect(BLACKJACK_TTL_MS).toBe(15 * 60_000);
    expect(DUEL_TTL_MS).toBe(180_000);
    expect(DUEL_BOUNTY_MIN_BET_RATIO).toBe(0.2);
    expect(DUEL_BOUNTY_MIN_BET).toBe(100);
    expect(PET_MAX_LEVEL).toBe(50);
    expect(PET_WORK_LEVEL_BONUS_CAP).toBe(300);
    expect(PET_BOSS_BONUS_CAP).toBe(80);
    expect(PET_PVP_DAILY_XP_CAP).toBe(120);
    expect(PET_PVP_COOLDOWN_MS).toBe(60_000);
    expect(SHOP_MYSTERY_BOX_MIN_PRICE).toBe(100);
    expect(PREDICTION_LOCKED_EXPIRE_MS).toBe(72 * 3600_000);
    expect(MONITOR_RETENTION_MS).toBe(14 * 86_400_000);
    expect(ECONOMY_CONSTANTS.MAX_SOLO_GAMBLE_BET).toBe(MAX_SOLO_GAMBLE_BET);
  });
});
