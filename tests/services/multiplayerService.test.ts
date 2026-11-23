import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo, initRedPacketSchema } from '../../src/db/repositories/redPacketRepo.js';
import { MultiplayerService } from '../../src/services/multiplayerService.js';

function setup() {
  const db = createDatabase(':memory:');
  initRedPacketSchema(db);
  const profileRepo = new ProfileRepo(db);
  const redPacketRepo = new RedPacketRepo(db);
  const svc = new MultiplayerService(db, profileRepo, redPacketRepo);
  return { db, profileRepo, redPacketRepo, svc };
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
        totalCount: 21,
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
        totalAmount: 1_000_001,
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

    // Duplicate claim rejected
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

    // Claiming after finished fails
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

    // With remainingAmount=100, remainingCount=2, maxShare=99; rng=0.5 -> 1 + Math.floor(0.5 * 99) = 50
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

  it('expires due red packets, refunds exact remainingAmount, and blocks subsequent claims', () => {
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
    expect(created.ok).toBe(true);
    if (!created.ok) {
      db.close();
      return;
    }
    const packetId = created.packet.id;
    expect(profileRepo.getOrCreate('g1', 'sender').coins).toBe(500);

    const claimed = svc.claimRedPacket(packetId, 'u1', 20_000, () => 0.4);
    expect(claimed.ok).toBe(true);
    const remainingBeforeExpiry = claimed.ok ? claimed.packet.remainingAmount : 0;
    expect(remainingBeforeExpiry).toBeGreaterThan(0);

    // Before expiry: claim at 69_999 would still be allowed; expireDueRedPackets does nothing
    expect(svc.expireDueRedPackets(69_999)).toEqual([]);

    // At expiry boundary (70_000): claim is blocked with 'expired' without double-touching refund
    expect(svc.claimRedPacket(packetId, 'u2', 70_000)).toEqual({
      ok: false,
      reason: 'expired',
    });

    // Expire job refunds exact remainingAmount once
    const expired = svc.expireDueRedPackets(70_000);
    expect(expired).toHaveLength(1);
    expect(expired[0]?.packet.id).toBe(packetId);
    expect(expired[0]?.packet.status).toBe('expired');
    expect(expired[0]?.refundedAmount).toBe(remainingBeforeExpiry);
    expect(profileRepo.getOrCreate('g1', 'sender').coins).toBe(500 + remainingBeforeExpiry);

    // Subsequent expire run is idempotent (no double refund)
    expect(svc.expireDueRedPackets(80_000)).toEqual([]);
    expect(profileRepo.getOrCreate('g1', 'sender').coins).toBe(500 + remainingBeforeExpiry);

    // Claim after status='expired' returns expired
    expect(svc.claimRedPacket(packetId, 'u3', 80_000)).toEqual({
      ok: false,
      reason: 'expired',
    });

    db.close();
  });
});

describe('multiplayerService - pvp dice duel', () => {
  it('validates duel creation inputs and challenger funds', () => {
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
    expect(svc.createDuel('g1', 'c1', 'p1', 'p2', 1_000_001)).toEqual({
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
      expect(svc.getDuel(created.duel.id, 1_500)).toEqual(created.duel);
    }

    db.close();
  });

  it('settles duel win, loss, and tie atomically', () => {
    const { db, profileRepo, svc } = setup();
    profileRepo.addCoins('g1', 'p1', 500);
    profileRepo.addCoins('g1', 'p2', 500);

    // Challenger wins: p1 rolls (6,6,6)=18, p2 rolls (1,1,1)=3
    const d1 = svc.createDuel('g1', 'c1', 'p1', 'p2', 100, 1_000);
    expect(d1.ok).toBe(true);
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

    // Tie: both roll (3,3,3)=9
    const d3 = svc.createDuel('g1', 'c1', 'p1', 'p2', 200, 5_000);
    expect(d3.ok).toBe(true);
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

  it('rejects wrong acceptor, insufficient funds at accept time, expired, and supports decline', () => {
    const { db, profileRepo, svc } = setup();
    profileRepo.addCoins('g1', 'p1', 300);
    profileRepo.addCoins('g1', 'p2', 50);

    // Opponent insufficient funds at accept time
    const d1 = svc.createDuel('g1', 'c1', 'p1', 'p2', 100, 1_000, 60_000);
    expect(d1.ok).toBe(true);
    if (d1.ok) {
      expect(svc.acceptDuel('missing', 'p2', 2_000)).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(svc.acceptDuel(d1.duel.id, 'p1', 2_000)).toEqual({
        ok: false,
        reason: 'not_opponent',
      });
      expect(svc.acceptDuel(d1.duel.id, 'p3', 2_000)).toEqual({
        ok: false,
        reason: 'not_opponent',
      });
      expect(svc.acceptDuel(d1.duel.id, 'p2', 2_000)).toEqual({
        ok: false,
        reason: 'opponent_insufficient_funds',
      });

      // Challenger spends coins before accept -> challenger_insufficient_funds
      profileRepo.addCoins('g1', 'p1', -250);
      expect(svc.acceptDuel(d1.duel.id, 'p2', 2_000)).toEqual({
        ok: false,
        reason: 'challenger_insufficient_funds',
      });

      // Expiry check via acceptDuel
      expect(svc.acceptDuel(d1.duel.id, 'p2', 61_000)).toEqual({
        ok: false,
        reason: 'expired',
      });
      expect(svc.getDuel(d1.duel.id, 61_000)?.status).toBe('expired');
    }

    // Decline by opponent and by challenger, plus getDuel expiry transition
    profileRepo.addCoins('g1', 'p1', 300);
    profileRepo.addCoins('g1', 'p2', 300);

    const d2 = svc.createDuel('g1', 'c1', 'p1', 'p2', 100, 100_000, 60_000);
    expect(d2.ok).toBe(true);
    if (d2.ok) {
      expect(svc.declineDuel('missing', 'p2', 101_000)).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(svc.declineDuel(d2.duel.id, 'intruder', 101_000)).toEqual({
        ok: false,
        reason: 'not_participant',
      });
      const declined = svc.declineDuel(d2.duel.id, 'p2', 101_000);
      expect(declined.ok).toBe(true);
      if (declined.ok) {
        expect(declined.duel.status).toBe('declined');
      }
      expect(svc.declineDuel(d2.duel.id, 'p1', 102_000)).toEqual({
        ok: false,
        reason: 'already_resolved',
      });
      expect(svc.acceptDuel(d2.duel.id, 'p2', 102_000)).toEqual({
        ok: false,
        reason: 'already_resolved',
      });
    }

    const d3 = svc.createDuel('g1', 'c1', 'p1', 'p2', 100, 200_000, 60_000);
    expect(d3.ok).toBe(true);
    if (d3.ok) {
      // Challenger can cancel/decline
      const cancelled = svc.declineDuel(d3.duel.id, 'p1', 201_000);
      expect(cancelled.ok).toBe(true);
      if (cancelled.ok) {
        expect(cancelled.duel.status).toBe('declined');
      }
    }

    const d4 = svc.createDuel('g1', 'c1', 'p1', 'p2', 100, 300_000, 10_000);
    expect(d4.ok).toBe(true);
    if (d4.ok) {
      expect(svc.getDuel(d4.duel.id, 310_000)?.status).toBe('expired');
      expect(svc.declineDuel(d4.duel.id, 'p2', 310_000)).toEqual({
        ok: false,
        reason: 'expired',
      });
    }

    expect(svc.getDuel('nonexistent')).toBeNull();

    // Creating >100 duels cleans up old ones without crashing and preserves newest duel
    for (let i = 0; i < 110; i += 1) {
      const res = svc.createDuel('g1', 'c1', 'p1', 'p2', 10, 400_000 + i, 60_000);
      expect(res.ok).toBe(true);
      if (res.ok && i === 109) {
        expect(svc.getDuel(res.duel.id, 400_200)?.id).toBe(res.duel.id);
      }
    }

    db.close();
  });

  it('handles equal amount/count splits, claim tie ordering, and preserves bankCoins', () => {
    const { db, profileRepo, svc } = setup();
    const senderInit = profileRepo.getOrCreate('g1', 'sender');
    profileRepo.save({
      ...senderInit,
      coins: 500,
      bankCoins: 1200,
      lastBankInterestDate: '2026-11-23',
    });
    const p2Init = profileRepo.getOrCreate('g1', 'p2');
    profileRepo.save({
      ...p2Init,
      coins: 300,
      bankCoins: 800,
      lastBankInterestDate: '2026-11-22',
    });

    // Minimum split: 5 coins across 5 users -> 1 coin each, ordered by rowid when claimedAt matches
    const packet = svc.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'sender',
      totalAmount: 5,
      totalCount: 5,
      nowMs: 1000,
    });
    expect(packet.ok).toBe(true);
    if (packet.ok) {
      expect(profileRepo.getOrCreate('g1', 'sender').bankCoins).toBe(1200);
      expect(profileRepo.getOrCreate('g1', 'sender').lastBankInterestDate).toBe('2026-11-23');

      for (const uid of ['u1', 'u2', 'u3', 'u4', 'u5']) {
        const claimed = svc.claimRedPacket(packet.packet.id, uid, 2000, () => 0.99);
        expect(claimed.ok).toBe(true);
        if (claimed.ok) {
          expect(claimed.amount).toBe(1);
        }
      }
      const detail = svc.getRedPacketWithClaims(packet.packet.id);
      expect(detail?.claims.map((c) => c.userId)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
      expect(detail?.bestLuckUserId).toBe('u1');
    }

    // Duel preserves bankCoins and lastBankInterestDate on both participants
    const duel = svc.createDuel('g1', 'c1', 'sender', 'p2', 100, 3000);
    expect(duel.ok).toBe(true);
    if (duel.ok) {
      const settled = svc.acceptDuel(
        duel.duel.id,
        'p2',
        3500,
        sequenceRng([0.99, 0.99, 0.99, 0, 0, 0]),
      );
      expect(settled.ok).toBe(true);
      const afterSender = profileRepo.getOrCreate('g1', 'sender');
      const afterP2 = profileRepo.getOrCreate('g1', 'p2');
      expect(afterSender.bankCoins).toBe(1200);
      expect(afterSender.lastBankInterestDate).toBe('2026-11-23');
      expect(afterP2.bankCoins).toBe(800);
      expect(afterP2.lastBankInterestDate).toBe('2026-11-22');
    }

    db.close();
  });
});
