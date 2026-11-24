import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ChaosRepo, initChaosSchema } from '../../src/db/repositories/chaosRepo.js';
import { DuelRepo, initDuelSchema } from '../../src/db/repositories/duelRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo, initRedPacketSchema } from '../../src/db/repositories/redPacketRepo.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { MultiplayerService } from '../../src/services/multiplayerService.js';

function setup(withDuelRepo = false) {
  const db = createDatabase(':memory:');
  initRedPacketSchema(db);
  initChaosSchema(db);
  initDuelSchema(db);
  const configRepo = new GuildConfigRepo(db);
  const profileRepo = new ProfileRepo(db);
  const redPacketRepo = new RedPacketRepo(db);
  const chaosRepo = new ChaosRepo(db);
  const duelRepo = withDuelRepo ? new DuelRepo(db) : undefined;
  const chaos = new ChaosService(db, configRepo, profileRepo, chaosRepo);
  const svc = new MultiplayerService(db, profileRepo, redPacketRepo, chaosRepo, duelRepo);
  return { db, profileRepo, redPacketRepo, chaosRepo, duelRepo, chaos, svc };
}

function sequenceRng(values: number[]): () => number {
  let index = 0;
  return () => {
    const val = values[index];
    index += 1;
    return val ?? 0.5;
  };
}

describe('multiplayerService - red packets', () => {
  it('validates creation inputs and deducts sender coins atomically', () => {
    const { db, profileRepo, svc } = setup();
    profileRepo.addCoins('g1', 'sender', 1000);

    expect(
      svc.createRedPacket({
        guildId: 'g1',
        channelId: 'c1',
        senderId: 'sender',
        totalAmount: 100,
        totalCount: 1,
      }),
    ).toEqual({ ok: false, reason: 'invalid_count' });

    expect(
      svc.createRedPacket({
        guildId: 'g1',
        channelId: 'c1',
        senderId: 'sender',
        totalAmount: 100,
        totalCount: 101,
      }),
    ).toEqual({ ok: false, reason: 'invalid_count' });

    expect(
      svc.createRedPacket({
        guildId: 'g1',
        channelId: 'c1',
        senderId: 'sender',
        totalAmount: 100,
        totalCount: 2.5,
      }),
    ).toEqual({ ok: false, reason: 'invalid_count' });

    expect(
      svc.createRedPacket({
        guildId: 'g1',
        channelId: 'c1',
        senderId: 'sender',
        totalAmount: 0,
        totalCount: 3,
      }),
    ).toEqual({ ok: false, reason: 'invalid_amount' });

    expect(
      svc.createRedPacket({
        guildId: 'g1',
        channelId: 'c1',
        senderId: 'sender',
        totalAmount: 1_000_000_001,
        totalCount: 3,
      }),
    ).toEqual({ ok: false, reason: 'invalid_amount' });

    expect(
      svc.createRedPacket({
        guildId: 'g1',
        channelId: 'c1',
        senderId: 'sender',
        totalAmount: 10.5,
        totalCount: 3,
      }),
    ).toEqual({ ok: false, reason: 'invalid_amount' });

    expect(
      svc.createRedPacket({
        guildId: 'g1',
        channelId: 'c1',
        senderId: 'sender',
        totalAmount: 4,
        totalCount: 5,
      }),
    ).toEqual({ ok: false, reason: 'amount_too_small_for_count' });

    expect(
      svc.createRedPacket({
        guildId: 'g1',
        channelId: 'c1',
        senderId: 'sender',
        totalAmount: 1500,
        totalCount: 5,
      }),
    ).toEqual({ ok: false, reason: 'insufficient_funds' });

    const created = svc.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'sender',
      totalAmount: 300,
      totalCount: 3,
      greeting: '   ',
      nowMs: 1_000_000,
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.senderBalance).toBe(700);
      expect(created.packet.greeting).toBe('恭喜发财，大吉大利！');
      expect(created.packet.remainingAmount).toBe(300);
      expect(created.packet.remainingCount).toBe(3);
      expect(created.packet.status).toBe('open');
      expect(created.packet.systemFunded).toBe(false);
      expect(created.packet.messageId).toBeNull();
      expect(created.packet.expiresAt).toBe(1_000_000 + 24 * 3600 * 1000);

      svc.bindRedPacketMessage(created.packet.id, 'msg-123');
      const detail = svc.getRedPacketWithClaims(created.packet.id);
      expect(detail?.packet.messageId).toBe('msg-123');
      expect(detail?.claims).toEqual([]);
      expect(detail?.bestLuckUserId).toBeNull();
    }

    expect(profileRepo.getOrCreate('g1', 'sender').coins).toBe(700);
    expect(svc.getRedPacketWithClaims(999_999)).toBeNull();

    db.close();
  });

  it('distributes claims across users until finished and identifies best luck user', () => {
    const { db, profileRepo, svc } = setup();
    profileRepo.addCoins('g1', 'sender', 1000);

    const created = svc.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'sender',
      totalAmount: 100,
      totalCount: 4,
      greeting: ' 新年快乐 ',
      nowMs: 5_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      db.close();
      return;
    }

    const packetId = created.packet.id;
    expect(created.packet.greeting).toBe('新年快乐');

    expect(svc.claimRedPacket(999_999, 'u1', 5_100)).toEqual({
      ok: false,
      reason: 'not_found',
    });

    const c1 = svc.claimRedPacket(packetId, 'u1', 5_100, () => 0.1);
    expect(c1.ok).toBe(true);
    if (c1.ok) {
      expect(c1.amount).toBeGreaterThanOrEqual(1);
      expect(c1.bestLuckUserId).toBeNull();
      expect(c1.packet.status).toBe('open');
      expect(c1.claimerBalance).toBe(c1.amount);
    }

    expect(svc.claimRedPacket(packetId, 'u1', 5_200, () => 0.9)).toEqual({
      ok: false,
      reason: 'already_claimed',
    });

    const c2 = svc.claimRedPacket(packetId, 'u2', 5_300, () => 0.99);
    const c3 = svc.claimRedPacket(packetId, 'u3', 5_400, () => 0.5);
    const c4 = svc.claimRedPacket(packetId, 'u4', 5_500, () => 0.25);

    expect(c2.ok).toBe(true);
    expect(c3.ok).toBe(true);
    expect(c4.ok).toBe(true);

    if (c4.ok) {
      expect(c4.packet.status).toBe('finished');
      expect(c4.packet.remainingAmount).toBe(0);
      expect(c4.packet.remainingCount).toBe(0);
      expect(c4.claims).toHaveLength(4);

      const sum = c4.claims.reduce((acc, item) => acc + item.amount, 0);
      expect(sum).toBe(100);
      for (const claim of c4.claims) {
        expect(claim.amount).toBeGreaterThanOrEqual(1);
        expect(profileRepo.getOrCreate('g1', claim.userId).coins).toBe(claim.amount);
      }

      const expectedBest = c4.claims.reduce((best, item) =>
        item.amount > best.amount ? item : best,
      );
      expect(c4.bestLuckUserId).toBe(expectedBest.userId);
    }

    expect(svc.claimRedPacket(packetId, 'u5', 5_600)).toEqual({
      ok: false,
      reason: 'finished',
    });

    db.close();
  });

  it('picks the first claimer on best-luck tie', () => {
    const { db, profileRepo, svc } = setup();
    profileRepo.addCoins('g1', 'sender', 500);

    const created = svc.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'sender',
      totalAmount: 100,
      totalCount: 2,
      nowMs: 1_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      db.close();
      return;
    }

    const c1 = svc.claimRedPacket(created.packet.id, 'first', 1_100, () => 0.5);
    const c2 = svc.claimRedPacket(created.packet.id, 'second', 1_200, () => 0.5);

    expect(c1.ok).toBe(true);
    expect(c2.ok).toBe(true);
    if (c1.ok && c2.ok) {
      expect(c1.amount).toBe(50);
      expect(c2.amount).toBe(50);
      expect(c2.bestLuckUserId).toBe('first');
    }

    db.close();
  });

  it('expires due red packets (single-ID & batch), refunds user-funded packets, and NEVER refunds systemFunded packets to admin', () => {
    const { db, profileRepo, svc } = setup();
    profileRepo.addCoins('g1', 'sender', 1000);

    const created = svc.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'sender',
      totalAmount: 500,
      totalCount: 5,
      nowMs: 10_000,
      ttlMs: 60_000,
    });
    const sysCreated = svc.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'admin-zero',
      totalAmount: 10_000,
      totalCount: 5,
      nowMs: 10_000,
      ttlMs: 60_000,
      systemFunded: true,
    });
    expect(created.ok && sysCreated.ok).toBe(true);
    if (!created.ok || !sysCreated.ok) {
      db.close();
      return;
    }

    expect(sysCreated.packet.systemFunded).toBe(true);
    const packetId = created.packet.id;
    const sysPacketId = sysCreated.packet.id;
    expect(profileRepo.getOrCreate('g1', 'sender').coins).toBe(500);

    const claimed = svc.claimRedPacket(packetId, 'u1', 20_000, () => 0.4);
    expect(claimed.ok).toBe(true);
    const remainingBeforeExpiry = claimed.ok ? claimed.packet.remainingAmount : 0;
    expect(remainingBeforeExpiry).toBeGreaterThan(0);

    expect(svc.expireDueRedPackets(69_999)).toEqual([]);
    expect(svc.claimRedPacket(packetId, 'u2', 70_000)).toEqual({
      ok: false,
      reason: 'expired',
    });

    // Single-ID expire only expires target packet, leaving sysPacket untouched!
    const singleExp = svc.expireRedPacketIfDue(packetId, 70_000);
    expect(singleExp?.packet.status).toBe('expired');
    expect(singleExp?.refundedAmount).toBe(remainingBeforeExpiry);
    expect(profileRepo.getOrCreate('g1', 'sender').coins).toBe(500 + remainingBeforeExpiry);
    expect(svc.getRedPacketWithClaims(sysPacketId)?.packet.status).toBe('open');

    // Expiring systemFunded packet NEVER refunds coins to admin-zero!
    const sysExp = svc.expireDueRedPackets(70_000);
    expect(sysExp).toHaveLength(1);
    expect(sysExp[0]?.packet.id).toBe(sysPacketId);
    expect(sysExp[0]?.refundedAmount).toBe(0);
    expect(profileRepo.getOrCreate('g1', 'admin-zero').coins).toBe(0);

    // Subsequent expire run is idempotent
    expect(svc.expireDueRedPackets(80_000)).toEqual([]);
    expect(profileRepo.getOrCreate('g1', 'sender').coins).toBe(500 + remainingBeforeExpiry);

    db.close();
  });
});

describe('multiplayerService - pvp dice duel', () => {
  it('validates duel creation inputs and freezes challenger bet atomically', () => {
    const { db, profileRepo, svc } = setup();
    profileRepo.addCoins('g1', 'p1', 200);

    expect(svc.createDuel('g1', 'c1', 'p1', 'p1', 100)).toEqual({
      ok: false,
      reason: 'self_target',
    });
    expect(svc.createDuel('g1', 'c1', 'p1', 'p2', 0)).toEqual({
      ok: false,
      reason: 'invalid_bet',
    });
    expect(svc.createDuel('g1', 'c1', 'p1', 'p2', -50)).toEqual({
      ok: false,
      reason: 'invalid_bet',
    });
    expect(svc.createDuel('g1', 'c1', 'p1', 'p2', 12.5)).toEqual({
      ok: false,
      reason: 'invalid_bet',
    });
    expect(svc.createDuel('g1', 'c1', 'p1', 'p2', 1_000_000_001)).toEqual({
      ok: false,
      reason: 'invalid_bet',
    });
    expect(svc.createDuel('g1', 'c1', 'p1', 'p2', 201)).toEqual({
      ok: false,
      reason: 'insufficient_funds',
    });

    const created = svc.createDuel('g1', 'c1', 'p1', 'p2', 100, 1_000, 180_000);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.duel.id).toMatch(/^[0-9a-f]{8}$/);
      expect(created.duel.status).toBe('pending');
      expect(created.duel.expiresAt).toBe(181_000);
      expect(created.challengerBalance).toBe(100);
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(100);
      expect(svc.getDuel(created.duel.id, 1_500)).toEqual(created.duel);
    }

    db.close();
  });

  it('settles duel win, loss, and tie atomically with frozen challenger bet', () => {
    const { db, profileRepo, svc } = setup(true);
    profileRepo.addCoins('g1', 'p1', 500);
    profileRepo.addCoins('g1', 'p2', 500);

    // Challenger wins: p1 rolls (6,6,6)=18, p2 rolls (1,1,1)=3
    const d1 = svc.createDuel('g1', 'c1', 'p1', 'p2', 100, 1_000);
    expect(d1.ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(400);
    if (d1.ok) {
      const res = svc.acceptDuel(
        d1.duel.id,
        'p2',
        2_000,
        sequenceRng([0.99, 0.99, 0.99, 0, 0, 0]),
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.challengerDice).toEqual([6, 6, 6]);
        expect(res.challengerSum).toBe(18);
        expect(res.opponentDice).toEqual([1, 1, 1]);
        expect(res.opponentSum).toBe(3);
        expect(res.tie).toBe(false);
        expect(res.winnerId).toBe('p1');
        expect(res.loserId).toBe('p2');
        expect(res.challengerBalance).toBe(600);
        expect(res.opponentBalance).toBe(400);
        expect(res.duel.status).toBe('completed');
      }
    }

    // Opponent wins: p1 rolls (1,2,1)=4, p2 rolls (5,5,5)=15
    const d2 = svc.createDuel('g1', 'c1', 'p1', 'p2', 150, 3_000);
    expect(d2.ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(450);
    if (d2.ok) {
      const res = svc.acceptDuel(
        d2.duel.id,
        'p2',
        4_000,
        sequenceRng([0, 0.2, 0, 0.7, 0.7, 0.7]),
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.tie).toBe(false);
        expect(res.winnerId).toBe('p2');
        expect(res.loserId).toBe('p1');
        expect(res.challengerBalance).toBe(450);
        expect(res.opponentBalance).toBe(550);
      }
    }

    // Tie: both roll (3,3,3)=9 -> challenger frozen bet refunded!
    const d3 = svc.createDuel('g1', 'c1', 'p1', 'p2', 200, 5_000);
    expect(d3.ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(250);
    if (d3.ok) {
      const res = svc.acceptDuel(
        d3.duel.id,
        'p2',
        6_000,
        sequenceRng([0.4, 0.4, 0.4, 0.4, 0.4, 0.4]),
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.tie).toBe(true);
        expect(res.winnerId).toBeNull();
        expect(res.loserId).toBeNull();
        expect(res.challengerBalance).toBe(450);
        expect(res.opponentBalance).toBe(550);
      }
    }

    expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(450);
    expect(profileRepo.getOrCreate('g1', 'p2').coins).toBe(550);

    db.close();
  });

  it('persists duels via DuelRepo, checks expiry before permission, refunds on decline/expire, and blocks 1-coin bounty collusion', () => {
    const { db, profileRepo, redPacketRepo, chaosRepo, duelRepo, chaos, svc } = setup(true);
    profileRepo.addCoins('g1', 'p1', 5000);
    profileRepo.addCoins('g1', 'p2', 5000);
    profileRepo.addCoins('g1', 'placer', 5000);

    // 1. Persisted duel survives service re-instantiation (restart)!
    const d1 = svc.createDuel('g1', 'c1', 'p1', 'p2', 100, 1_000, 60_000);
    expect(d1.ok).toBe(true);
    if (!d1.ok) return;
    svc.bindDuelMessage(d1.duel.id, 'duel-msg-1');

    const svcAfterRestart = new MultiplayerService(db, profileRepo, redPacketRepo, chaosRepo, duelRepo);
    expect(svcAfterRestart.getDuel(d1.duel.id, 2_000)?.messageId).toBe('duel-msg-1');

    // Bystander clicking EXPIRED duel gets 'expired' (NOT 'not_opponent'/'not_participant'), and challenger bet is refunded!
    expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(4900);
    expect(svcAfterRestart.acceptDuel(d1.duel.id, 'outsider', 61_000)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(5000);
    expect(svcAfterRestart.declineDuel(d1.duel.id, 'outsider', 62_000)).toEqual({
      ok: false,
      reason: 'expired',
    });

    // 2. Decline refunds frozen bet
    const d2 = svcAfterRestart.createDuel('g1', 'c1', 'p1', 'p2', 300, 100_000, 60_000);
    expect(d2.ok).toBe(true);
    if (d2.ok) {
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(4700);
      expect(svcAfterRestart.declineDuel(d2.duel.id, 'intruder', 101_000)).toEqual({
        ok: false,
        reason: 'not_participant',
      });
      const declined = svcAfterRestart.declineDuel(d2.duel.id, 'p2', 101_000);
      expect(declined).toMatchObject({ ok: true, refunded: 300 });
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(5000);
      expect(svcAfterRestart.acceptDuel(d2.duel.id, 'intruder', 102_000)).toEqual({
        ok: false,
        reason: 'already_resolved',
      });
    }

    // 3. Single-ID expireDuelIfDue vs expireDueDuels
    const d3 = svcAfterRestart.createDuel('g1', 'c1', 'p1', 'p2', 150, 200_000, 10_000);
    const d4 = svcAfterRestart.createDuel('g1', 'c1', 'p1', 'p2', 250, 200_000, 10_000);
    expect(d3.ok && d4.ok).toBe(true);
    if (d3.ok && d4.ok) {
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(4600);
      const exp3 = svcAfterRestart.expireDuelIfDue(d3.duel.id, 210_000);
      expect(exp3?.status).toBe('expired');
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(4750);
      // d4 still pending in DB until expired
      expect(duelRepo?.getById(d4.duel.id)?.status).toBe('pending');
      const expRest = svcAfterRestart.expireDueDuels(210_000);
      expect(expRest).toHaveLength(1);
      expect(expRest[0]?.id).toBe(d4.duel.id);
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(5000);
    }

    // 4. Bounty collusion defense: 1000 bounty requires bet >= max(100, floor(1000 * 0.2)) = 200!
    chaos.placeBounty('g1', 'placer', 'p2', 1000, 300_000);
    const cheapDuel = svcAfterRestart.createDuel('g1', 'c1', 'p1', 'p2', 1, 301_000);
    expect(cheapDuel.ok).toBe(true);
    if (cheapDuel.ok) {
      const res = svcAfterRestart.acceptDuel(
        cheapDuel.duel.id,
        'p2',
        302_000,
        sequenceRng([0.99, 0.99, 0.99, 0, 0, 0]),
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.winnerId).toBe('p1');
        expect(res.bountyClaimed).toBeUndefined();
      }
      // Bounty remains intact!
      expect(chaos.getOpenBountyTotal('g1', 'p2')).toBe(1000);
    }

    // Valid 200-coin duel DOES claim the 1000 bounty!
    const validDuel = svcAfterRestart.createDuel('g1', 'c1', 'p1', 'p2', 200, 305_000);
    expect(validDuel.ok).toBe(true);
    if (validDuel.ok) {
      const res = svcAfterRestart.acceptDuel(
        validDuel.duel.id,
        'p2',
        306_000,
        sequenceRng([0.99, 0.99, 0.99, 0, 0, 0]),
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.bountyClaimed).toBe(1000);
      }
      expect(chaos.getOpenBountyTotal('g1', 'p2')).toBe(0);
    }

    db.close();
  });

  it('supports systemFunded red packets (> 1,000,000) and distributeRandomRedPacket', () => {
    const { db, profileRepo, svc } = setup();

    const sysPacket = svc.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'admin-zero-coins',
      totalAmount: 50_000_000,
      totalCount: 25,
      greeting: '全服系统大红包',
      systemFunded: true,
    });
    expect(sysPacket.ok).toBe(true);
    if (sysPacket.ok) {
      expect(sysPacket.senderBalance).toBe(0);
      expect(sysPacket.packet.systemFunded).toBe(true);
    }

    expect(
      svc.distributeRandomRedPacket({
        guildId: 'g1',
        candidateUserIds: [],
        totalAmount: 1000,
        count: 3,
      }),
    ).toEqual({ ok: false, reason: 'no_candidates' });

    const dist = svc.distributeRandomRedPacket({
      guildId: 'g1',
      candidateUserIds: ['u1', 'u2', 'u3', 'u4', 'u5'],
      totalAmount: 10_000_000,
      count: 3,
      rng: sequenceRng([0.1, 0.8, 0.4, 0.3, 0.9, 0.2]),
    });
    expect(dist.ok).toBe(true);
    if (dist.ok) {
      expect(dist.winnerCount).toBe(3);
      expect(dist.shares).toHaveLength(3);
      const sum = dist.shares.reduce((acc, s) => acc + s.amount, 0);
      expect(sum).toBe(10_000_000);
      expect(dist.bestLuckUserId).not.toBeNull();
      for (const share of dist.shares) {
        expect(profileRepo.getOrCreate('g1', share.userId).coins).toBe(share.amount);
      }
    }

    db.close();
  });
});
