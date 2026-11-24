import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo } from '../../src/db/repositories/redPacketRepo.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { EconomyService } from '../../src/services/economyService.js';
import { MultiplayerService } from '../../src/services/multiplayerService.js';

function createFixture() {
  const db = createDatabase(':memory:');
  const configRepo = new GuildConfigRepo(db);
  const profileRepo = new ProfileRepo(db);
  const chaosRepo = new ChaosRepo(db);
  const redPacketRepo = new RedPacketRepo(db);
  const chaos = new ChaosService(db, configRepo, profileRepo, chaosRepo);
  const economy = new EconomyService(db, configRepo, profileRepo, 'Asia/Shanghai', chaosRepo);
  const multiplayer = new MultiplayerService(db, profileRepo, redPacketRepo, chaosRepo);
  return { db, configRepo, profileRepo, chaosRepo, chaos, economy, multiplayer };
}

describe('ChaosService (props, bounties, roulette, number bomb)', () => {
  it('supports props, blocks already_active overwrite (no prop swallow), and supports atomic reserveProp/refundProp', () => {
    const { db, profileRepo, chaos, economy } = createFixture();
    profileRepo.addCoins('g1', 'victim', 5000);
    profileRepo.addCoins('g1', 'thief', 5000);

    // Curse victim from thief; second curse while active returns already_active without consuming!
    expect(chaos.buyProp('g1', 'thief', 'curse').ok).toBe(true);
    expect(chaos.buyProp('g1', 'thief', 'curse').ok).toBe(true);
    expect(chaos.useCurseProp('g1', 'thief', 'victim', 1000)).toEqual({
      ok: true,
      remainingQuantity: 1,
      targetId: 'victim',
    });
    expect(chaos.useCurseProp('g1', 'thief', 'victim', 1500)).toEqual({
      ok: false,
      reason: 'already_active',
    });
    expect(chaos.getPropQuantity('g1', 'thief', 'curse')).toBe(1);
    expect(chaos.useCurseProp('g1', 'thief', 'thief', 1000)).toEqual({
      ok: false,
      reason: 'self_target',
    });

    const workRes = economy.work('g1', 'victim', 2000, () => 0.5);
    expect(workRes.ok).toBe(true);
    if (workRes.ok) {
      expect(workRes.cursed).toBe(true);
      expect(workRes.reward).toBeLessThanOrEqual(110);
    }

    // Trap armed: duplicate use returns already_active without consuming 2nd trap!
    expect(chaos.buyProp('g1', 'victim', 'trap').ok).toBe(true);
    expect(chaos.buyProp('g1', 'victim', 'trap').ok).toBe(true);
    expect(chaos.useSelfProp('g1', 'victim', 'trap', 10_000).ok).toBe(true);
    expect(chaos.useSelfProp('g1', 'victim', 'trap', 10_500)).toEqual({
      ok: false,
      reason: 'already_active',
    });
    expect(chaos.getPropQuantity('g1', 'victim', 'trap')).toBe(1);

    const trappedRob = economy.rob('g1', 'thief', 'victim', 10_000, () => 0.01);
    expect(trappedRob.ok).toBe(true);
    if (trappedRob.ok) {
      expect(trappedRob.success).toBe(false);
      expect(trappedRob.trapped).toBe(true);
    }

    // Lockpick ready: duplicate use returns already_active without consuming!
    expect(chaos.buyProp('g1', 'thief', 'lockpick').ok).toBe(true);
    expect(chaos.buyProp('g1', 'thief', 'lockpick').ok).toBe(true);
    expect(chaos.useSelfProp('g1', 'thief', 'lockpick', 20_000).ok).toBe(true);
    expect(chaos.useSelfProp('g1', 'thief', 'lockpick', 20_500)).toEqual({
      ok: false,
      reason: 'already_active',
    });
    expect(chaos.getPropQuantity('g1', 'thief', 'lockpick')).toBe(1);

    // reserveProp & refundProp prevent concurrent double-spend
    expect(chaos.buyProp('g1', 'thief', 'nickname').ok).toBe(true);
    expect(chaos.reserveProp('g1', 'thief', 'nickname')).toBe(true);
    expect(chaos.reserveProp('g1', 'thief', 'nickname')).toBe(false);
    expect(chaos.getPropQuantity('g1', 'thief', 'nickname')).toBe(0);
    expect(chaos.refundProp('g1', 'thief', 'nickname')).toBe(1);
    expect(chaos.getPropQuantity('g1', 'thief', 'nickname')).toBe(1);

    // Shield prop adds 4h shield immediately
    expect(chaos.buyProp('g1', 'victim', 'shield').ok).toBe(true);
    const sh = chaos.useSelfProp('g1', 'victim', 'shield', 10_000_000);
    expect(sh.ok).toBe(true);
    if (sh.ok) {
      expect(sh.shieldUntil).toBeGreaterThanOrEqual(10_000_000 + 4 * 3600 * 1000);
    }

    db.close();
  });

  it('stacks bounties, pays out on successful rob or qualifying duel win, and supports 1.5x self-clear', () => {
    const { db, profileRepo, chaos, economy, multiplayer } = createFixture();
    profileRepo.addCoins('g1', 'p1', 5000);
    profileRepo.addCoins('g1', 'p2', 5000);
    profileRepo.addCoins('g1', 'target', 5000);

    expect(chaos.placeBounty('g1', 'p1', 'p1', 500)).toEqual({ ok: false, reason: 'self_target' });
    expect(chaos.placeBounty('g1', 'p1', 'target', 50)).toEqual({
      ok: false,
      reason: 'below_min',
      minAmount: 200,
    });

    const b1 = chaos.placeBounty('g1', 'p1', 'target', 400, 1000);
    const b2 = chaos.placeBounty('g1', 'p2', 'target', 600, 1100);
    expect(b1.ok && b2.ok).toBe(true);
    expect(chaos.getOpenBountyTotal('g1', 'target')).toBe(1000);

    const cleared = chaos.clearOwnBounty('g1', 'target', 1200);
    expect(cleared).toEqual({ ok: true, clearedAmount: 1000, cost: 1500, balance: 3500 });
    expect(chaos.getOpenBountyTotal('g1', 'target')).toBe(0);

    chaos.placeBounty('g1', 'p1', 'target', 800, 1300);
    const beforeP2 = profileRepo.getOrCreate('g1', 'p2').coins;
    const robRes = economy.rob('g1', 'p2', 'target', 2000, () => 0.05);
    expect(robRes.ok).toBe(true);
    if (robRes.ok) {
      expect(robRes.success).toBe(true);
      expect(robRes.bountyClaimed).toBe(800);
      expect(robRes.attackerBalance).toBe(beforeP2 + robRes.amount + 800);
    }

    // 500 bounty -> 200 bet >= max(100, 500*0.2=100) claims bounty!
    chaos.placeBounty('g1', 'p2', 'target', 500, 3000);
    const duel = multiplayer.createDuel('g1', 'c1', 'p1', 'target', 200, 3100);
    expect(duel.ok).toBe(true);
    if (duel.ok) {
      let step = 0;
      const rolls = [0.95, 0.95, 0.95, 0.05, 0.05, 0.05];
      const accept = multiplayer.acceptDuel(duel.duel.id, 'target', 3200, () => rolls[step++] ?? 0.5);
      expect(accept.ok).toBe(true);
      if (accept.ok) {
        expect(accept.winnerId).toBe('p1');
        expect(accept.bountyClaimed).toBe(500);
      }
      expect(chaos.getOpenBountyTotal('g1', 'target')).toBe(0);
    }

    db.close();
  });

  it('enforces instant turnDeadline expiry on roulette actions, single-ID expire, firing/elimination, and winner pot payout', () => {
    const { db, profileRepo, chaos } = createFixture();
    profileRepo.addCoins('g1', 'u1', 1000);
    profileRepo.addCoins('g1', 'u2', 1000);
    profileRepo.addCoins('g1', 'u3', 1000);

    // Instant turnDeadline check on joinRoulette expires & refunds host immediately!
    const staleRoom = chaos.createRoulette({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u3',
      entryFee: 100,
      maxPlayers: 3,
      nowMs: 1000,
    });
    expect(staleRoom.ok).toBe(true);
    if (staleRoom.ok) {
      expect(profileRepo.getOrCreate('g1', 'u3').coins).toBe(900);
      expect(chaos.joinRoulette(staleRoom.game.id, 'u2', 1000 + 10 * 60_000)).toEqual({
        ok: false,
        reason: 'expired',
      });
      expect(profileRepo.getOrCreate('g1', 'u3').coins).toBe(1000);
      expect(chaos.getRoulette(staleRoom.game.id)?.status).toBe('cancelled');
    }

    // Same instant turnDeadline check on startRoulette
    const staleStart = chaos.createRoulette({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u3',
      entryFee: 100,
      maxPlayers: 3,
      nowMs: 2000,
    });
    if (staleStart.ok) {
      chaos.joinRoulette(staleStart.game.id, 'u2', 2100);
      expect(chaos.startRoulette(staleStart.game.id, 'u3', false, 2000 + 10 * 60_000)).toEqual({
        ok: false,
        reason: 'expired',
      });
      expect(profileRepo.getOrCreate('g1', 'u3').coins).toBe(1000);
      expect(profileRepo.getOrCreate('g1', 'u2').coins).toBe(1000);
    }

    // Normal game flow
    const duelRoom = chaos.createRoulette({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u1',
      entryFee: 300,
      maxPlayers: 2,
      nowMs: 20_000,
    });
    expect(duelRoom.ok).toBe(true);
    if (duelRoom.ok) {
      chaos.joinRoulette(duelRoom.game.id, 'u2', 20_100);
      const s2 = chaos.startRoulette(duelRoom.game.id, 'u1', false, 20_200, () => 0);
      expect(s2.ok).toBe(true);
      if (s2.ok) {
        const firstVictim = s2.game.alivePlayers[0]!;
        const survivor = s2.game.alivePlayers[1]!;
        const beforeWinnerCoins = profileRepo.getOrCreate('g1', survivor).coins;
        const timed = chaos.processTimedOutRoulettes(20_200 + 31_000, () => 0);
        const hit = timed.find((t) => t.game.id === duelRoom.game.id);
        expect(hit?.fired).toBe(true);
        expect(hit?.eliminatedUserId).toBe(firstVictim);
        expect(hit?.winnerId).toBe(survivor);
        expect(hit?.prizePool).toBe(600);
        expect(profileRepo.getOrCreate('g1', survivor).coins).toBe(beforeWinnerCoins + 600);
      }
    }

    db.close();
  });

  it('generates number bomb secrets across full [1, 100], removes host freeloading, persists payoutsJson, and cancels by single ID', () => {
    const { db, profileRepo, chaos } = createFixture();
    profileRepo.addCoins('g1', 'host', 1000);
    profileRepo.addCoins('g1', 'p1', 1000);
    profileRepo.addCoins('g1', 'p2', 1000);

    // Boundary secret = 1 (rng=0) and 100 (rng=0.999)
    const bombMin = chaos.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'host',
      penalty: 200,
      nowMs: 1000,
      rng: () => 0,
    });
    const bombMax = chaos.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'host',
      penalty: 200,
      nowMs: 1000,
      rng: () => 0.999,
    });
    expect(bombMin.ok && bombMax.ok).toBe(true);
    if (!bombMin.ok || !bombMax.ok) return;
    expect(bombMin.game.secretNumber).toBe(1);
    expect(bombMax.game.secretNumber).toBe(100);

    // Single-ID cancelNumberBomb cancels ONLY bombMax without touching bombMin!
    expect(chaos.cancelNumberBomb(bombMax.game.id)).toBe(true);
    expect(chaos.getNumberBomb(bombMax.game.id)?.status).toBe('cancelled');
    expect(chaos.getNumberBomb(bombMin.game.id)?.status).toBe('open');

    // First guess hits 1 -> NO freeloading payout to host!
    const firstBoom = chaos.guessNumberBomb(bombMin.game.id, 'p1', 1, 1500);
    expect(firstBoom.ok).toBe(true);
    if (firstBoom.ok) {
      expect(firstBoom.exploded).toBe(true);
      expect(firstBoom.payouts).toEqual([]);
      expect(profileRepo.getOrCreate('g1', 'host').coins).toBe(1000);
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(800);
    }

    // Normal game: secret = 1 + floor(0.5 * 100) = 51 -> payouts persisted in payoutsJson!
    const bomb = chaos.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'host',
      penalty: 301,
      nowMs: 2000,
      rng: () => 0.5,
    });
    expect(bomb.ok).toBe(true);
    if (!bomb.ok) return;
    expect(bomb.game.secretNumber).toBe(51);

    expect(chaos.guessNumberBomb(bomb.game.id, 'p1', 20, 2100).ok).toBe(true);
    expect(chaos.guessNumberBomb(bomb.game.id, 'p1', 80, 2150)).toEqual({
      ok: false,
      reason: 'consecutive_guess',
    });
    expect(chaos.guessNumberBomb(bomb.game.id, 'p2', 80, 2200).ok).toBe(true);

    const boom = chaos.guessNumberBomb(bomb.game.id, 'host', 51, 2400);
    expect(boom.ok).toBe(true);
    if (boom.ok) {
      expect(boom.exploded).toBe(true);
      expect(boom.penaltyPaid).toBe(301);
      expect(boom.payouts).toEqual([
        { userId: 'p1', amount: 151 },
        { userId: 'p2', amount: 150 },
      ]);
      expect(boom.game.payoutsJson).toBe(JSON.stringify(boom.payouts));
      expect(chaos.getNumberBomb(bomb.game.id)?.payoutsJson).toBe(JSON.stringify(boom.payouts));
      expect(profileRepo.getOrCreate('g1', 'host').coins).toBe(699);
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(951);
      expect(profileRepo.getOrCreate('g1', 'p2').coins).toBe(1150);
    }

    db.close();
  });
});
