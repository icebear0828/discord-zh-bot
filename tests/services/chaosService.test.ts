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
  it('supports buying props, trap反抓小偷, lockpick加成功率, shield防盗, and curse减半打工', () => {
    const { db, profileRepo, chaos, economy } = createFixture();
    profileRepo.addCoins('g1', 'victim', 5000);
    profileRepo.addCoins('g1', 'thief', 5000);

    // Curse victim from thief
    const buyCurse = chaos.buyProp('g1', 'thief', 'curse');
    expect(buyCurse.ok).toBe(true);
    const cursedRes = chaos.useCurseProp('g1', 'thief', 'victim', 1000);
    expect(cursedRes.ok).toBe(true);
    expect(chaos.useCurseProp('g1', 'thief', 'thief', 1000)).toEqual({
      ok: false,
      reason: 'self_target',
    });

    const workRes = economy.work('g1', 'victim', 2000, () => 0.5);
    expect(workRes.ok).toBe(true);
    if (workRes.ok) {
      expect(workRes.cursed).toBe(true);
      expect(workRes.reward).toBeLessThanOrEqual(2500); // half of [2000, 5000]
    }
    // Curse is single-use
    const workRes2 = economy.work('g1', 'victim', 5_000_000, () => 0.5);
    if (workRes2.ok) {
      expect(workRes2.cursed).toBeUndefined();
    }

    // Arm trap on victim -> thief's rob gets trapped even with favorable RNG!
    expect(chaos.buyProp('g1', 'victim', 'trap').ok).toBe(true);
    expect(chaos.useSelfProp('g1', 'victim', 'trap', 10_000).ok).toBe(true);
    const trappedRob = economy.rob('g1', 'thief', 'victim', 10_000, () => 0.01);
    expect(trappedRob.ok).toBe(true);
    if (trappedRob.ok) {
      expect(trappedRob.success).toBe(false);
      expect(trappedRob.trapped).toBe(true);
      expect(trappedRob.amount).toBe(1000); // 30% of 5000 clamped at 1000 double fine!
    }

    // Lockpick boosts success rate (+25% -> 0.45 + 0.25 = 0.70), rng=0.60 fails normally but succeeds with lockpick!
    expect(chaos.buyProp('g1', 'thief', 'lockpick').ok).toBe(true);
    expect(chaos.useSelfProp('g1', 'thief', 'lockpick', 20_000).ok).toBe(true);
    const lockRob = economy.rob('g1', 'thief', 'victim', 5_000_000, () => 0.6);
    expect(lockRob.ok).toBe(true);
    if (lockRob.ok) {
      expect(lockRob.success).toBe(true);
      expect(lockRob.usedLockpick).toBe(true);
    }

    // Shield prop adds 4h shield immediately
    expect(chaos.buyProp('g1', 'victim', 'shield').ok).toBe(true);
    const sh = chaos.useSelfProp('g1', 'victim', 'shield', 10_000_000);
    expect(sh.ok).toBe(true);
    if (sh.ok) {
      expect(sh.shieldUntil).toBeGreaterThanOrEqual(10_000_000 + 4 * 3600 * 1000);
    }
    expect(economy.rob('g1', 'thief', 'victim', 10_000_100, () => 0.01)).toMatchObject({
      ok: false,
      reason: 'target_shielded',
    });

    db.close();
  });

  it('stacks bounties, pays out on successful rob or duel win, and supports 1.5x self-clear', () => {
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

    // Self-clear costs ceil(1000 * 1.5) = 1500
    const cleared = chaos.clearOwnBounty('g1', 'target', 1200);
    expect(cleared).toEqual({ ok: true, clearedAmount: 1000, cost: 1500, balance: 3500 });
    expect(chaos.getOpenBountyTotal('g1', 'target')).toBe(0);

    // Re-place 800 bounty -> claimed on rob success
    chaos.placeBounty('g1', 'p1', 'target', 800, 1300);
    const beforeP2 = profileRepo.getOrCreate('g1', 'p2').coins;
    const robRes = economy.rob('g1', 'p2', 'target', 2000, () => 0.05);
    expect(robRes.ok).toBe(true);
    if (robRes.ok) {
      expect(robRes.success).toBe(true);
      expect(robRes.bountyClaimed).toBe(800);
      expect(robRes.attackerBalance).toBe(beforeP2 + robRes.amount + 800);
    }
    expect(chaos.getOpenBountyTotal('g1', 'target')).toBe(0);

    // Re-place 500 bounty -> claimed on duel victory
    chaos.placeBounty('g1', 'p2', 'target', 500, 3000);
    const duel = multiplayer.createDuel('g1', 'c1', 'p1', 'target', 200, 3100);
    expect(duel.ok).toBe(true);
    if (duel.ok) {
      let step = 0;
      const rolls = [0.95, 0.95, 0.95, 0.05, 0.05, 0.05]; // challenger 6,6,6 vs opponent 1,1,1
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

  it('runs roulette recruiting, leave/timeout refunds, firing/elimination, and winner pot payout', () => {
    const { db, profileRepo, chaos } = createFixture();
    profileRepo.addCoins('g1', 'u1', 1000);
    profileRepo.addCoins('g1', 'u2', 1000);
    profileRepo.addCoins('g1', 'u3', 1000);

    const created = chaos.createRoulette({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u1',
      entryFee: 200,
      maxPlayers: 3,
      nowMs: 1000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(chaos.joinRoulette(created.game.id, 'u2', 1100).ok).toBe(true);
    expect(chaos.leaveRoulette(created.game.id, 'u2', 1200)).toMatchObject({
      ok: true,
      refunded: 200,
      cancelled: false,
    });
    expect(profileRepo.getOrCreate('g1', 'u2').coins).toBe(1000);

    expect(chaos.startRoulette(created.game.id, 'u1', false, 1300).ok).toBe(false); // only 1 player

    chaos.joinRoulette(created.game.id, 'u2', 1400);
    // Deterministic rng=0 puts bulletPos=0 and keeps reverse shuffle deterministic
    const started = chaos.startRoulette(created.game.id, 'u1', false, 1500, () => 0.99);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // Wait: rng=0.99 gives bulletPos = 5. First player pulls empty!
    const current = started.game.alivePlayers[0]!;
    const p1 = chaos.pullTrigger(started.game.id, current, { nowMs: 2000 });
    expect(p1.ok).toBe(true);
    if (p1.ok) {
      expect(p1.fired).toBe(false);
    }

    // Timeout advances & fires until bullet triggers (here test recruit expiry in a second room)
    const expRoom = chaos.createRoulette({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u3',
      entryFee: 100,
      maxPlayers: 2,
      nowMs: 5000,
    });
    expect(expRoom.ok).toBe(true);
    if (expRoom.ok) {
      const updates = chaos.processTimedOutRoulettes(5000 + 11 * 60 * 1000);
      expect(updates.some((u) => u.game.id === expRoom.game.id && u.kind === 'recruit_expired')).toBe(true);
      expect(profileRepo.getOrCreate('g1', 'u3').coins).toBe(1000);
    }

    // Test direct bullet hit & 2-player prize win
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
      // rng=0 -> swap puts u2 first? Fisher-Yates i=1 j=0 swaps u1 and u2, bulletPos=0!
      const s2 = chaos.startRoulette(duelRoom.game.id, 'u1', false, 20_200, () => 0);
      expect(s2.ok).toBe(true);
      if (s2.ok) {
        const firstVictim = s2.game.alivePlayers[0]!;
        const survivor = s2.game.alivePlayers[1]!;
        const beforeWinnerCoins = profileRepo.getOrCreate('g1', survivor).coins;
        // Simulate 30s turn timeout auto-trigger firing bullet at chamber 0!
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

  it('runs number bomb bounds, consecutive guard, and explosion payout split', () => {
    const { db, profileRepo, chaos } = createFixture();
    profileRepo.addCoins('g1', 'host', 1000);
    profileRepo.addCoins('g1', 'p1', 1000);
    profileRepo.addCoins('g1', 'p2', 1000);

    // secret = 2 + floor(0.5 * 98) = 51
    const bomb = chaos.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'host',
      penalty: 301,
      nowMs: 1000,
      rng: () => 0.5,
    });
    expect(bomb.ok).toBe(true);
    if (!bomb.ok) return;
    expect(bomb.game.secretNumber).toBe(51);

    const g1 = chaos.guessNumberBomb(bomb.game.id, 'p1', 20, 2000);
    expect(g1.ok).toBe(true);
    if (g1.ok) {
      expect(g1.exploded).toBe(false);
      expect(g1.game.minBound).toBe(21);
      expect(g1.game.maxBound).toBe(100);
    }

    // Cannot guess twice in a row
    expect(chaos.guessNumberBomb(bomb.game.id, 'p1', 80, 2100)).toEqual({
      ok: false,
      reason: 'consecutive_guess',
    });

    // Cannot guess out of current bounds
    expect(chaos.guessNumberBomb(bomb.game.id, 'p2', 15, 2200)).toMatchObject({
      ok: false,
      reason: 'invalid_guess',
      minBound: 21,
      maxBound: 100,
    });

    const g2 = chaos.guessNumberBomb(bomb.game.id, 'p2', 80, 2300);
    expect(g2.ok).toBe(true);
    if (g2.ok) {
      expect(g2.game.maxBound).toBe(79);
    }

    // Host hits secret 51 -> pays 301 split across p1 (151) & p2 (150)
    const boom = chaos.guessNumberBomb(bomb.game.id, 'host', 51, 2400);
    expect(boom.ok).toBe(true);
    if (boom.ok) {
      expect(boom.exploded).toBe(true);
      expect(boom.penaltyPaid).toBe(301);
      expect(boom.payouts).toEqual([
        { userId: 'p1', amount: 151 },
        { userId: 'p2', amount: 150 },
      ]);
      expect(profileRepo.getOrCreate('g1', 'host').coins).toBe(699);
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(1151);
      expect(profileRepo.getOrCreate('g1', 'p2').coins).toBe(1150);
    }

    db.close();
  });
});
