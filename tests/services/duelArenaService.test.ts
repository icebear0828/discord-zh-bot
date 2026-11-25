import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { CreditLoanRepo } from '../../src/db/repositories/creditLoanRepo.js';
import { DuelRepo } from '../../src/db/repositories/duelRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { CreditLoanService } from '../../src/services/creditLoanService.js';
import {
  DuelArenaService,
  RENAME_COOLDOWN_MS,
  RPS_INVITE_TTL_MS,
  RPS_ROUND_TTL_MS,
} from '../../src/services/duelArenaService.js';

function setup() {
  const db = createDatabase(':memory:');
  const configRepo = new GuildConfigRepo(db);
  const profileRepo = new ProfileRepo(db);
  const duelRepo = new DuelRepo(db);
  const chaosRepo = new ChaosRepo(db);
  const creditRepo = new CreditLoanRepo(db);
  const creditLoan = new CreditLoanService(db, configRepo, profileRepo, creditRepo, 'Asia/Shanghai', chaosRepo);
  const chaos = new ChaosService(db, configRepo, profileRepo, chaosRepo, creditLoan);
  const arena = new DuelArenaService(db, profileRepo, duelRepo, chaosRepo, creditLoan);
  return { db, configRepo, profileRepo, duelRepo, chaosRepo, creditRepo, creditLoan, chaos, arena };
}

describe('DuelArenaService', () => {
  it('runs Bo5 RPS where ties replay without counting, first to 3 wins settles coins/bounty/stats and grants nickname lock', () => {
    const { db, profileRepo, chaos, creditRepo, arena } = setup();
    profileRepo.addCoins('g1', 'c1', 1000);
    profileRepo.addCoins('g1', 'o1', 1000);
    profileRepo.addCoins('g1', 'bounty_placer', 500);
    chaos.placeBounty('g1', 'bounty_placer', 'o1', 300, 1000);

    const createRes = arena.createRpsDuel({
      guildId: 'g1',
      channelId: 'ch1',
      challengerId: 'c1',
      opponentId: 'o1',
      renameHours: 6,
      bet: 200,
      nowMs: 2000,
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    expect(profileRepo.getOrCreate('g1', 'c1').coins).toBe(800);

    const acceptRes = arena.acceptRpsDuel(createRes.duel.id, 'o1', 3000);
    expect(acceptRes.ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'o1').coins).toBe(800);

    // Round 1: Tie -> roundNumber remains 1 and score stays 0:0
    expect(arena.submitRpsMove(createRes.duel.id, 'c1', 'rock', 3100).ok).toBe(true);
    const dupMove = arena.submitRpsMove(createRes.duel.id, 'c1', 'paper', 3150);
    expect(dupMove).toEqual({ ok: false, reason: 'already_moved' });

    const tieRes = arena.submitRpsMove(createRes.duel.id, 'o1', 'rock', 3200);
    expect(tieRes.ok).toBe(true);
    if (tieRes.ok) {
      expect(tieRes.roundResolved).toBe(true);
      expect(tieRes.roundTie).toBe(true);
      expect(tieRes.duel.roundNumber).toBe(1);
      expect(tieRes.duel.challengerWins).toBe(0);
      expect(tieRes.duel.opponentWins).toBe(0);
    }

    // Round 1 replay: c1 wins (1:0)
    arena.submitRpsMove(createRes.duel.id, 'c1', 'paper', 3300);
    const r1 = arena.submitRpsMove(createRes.duel.id, 'o1', 'rock', 3400);
    expect(r1.ok && r1.duel.challengerWins).toBe(1);

    // Round 2: o1 wins (1:1)
    arena.submitRpsMove(createRes.duel.id, 'c1', 'rock', 3500);
    const r2 = arena.submitRpsMove(createRes.duel.id, 'o1', 'paper', 3600);
    expect(r2.ok && r2.duel.opponentWins).toBe(1);

    // Round 3: c1 wins (2:1)
    arena.submitRpsMove(createRes.duel.id, 'c1', 'scissors', 3700);
    arena.submitRpsMove(createRes.duel.id, 'o1', 'paper', 3800);

    // Round 4: c1 wins (3:1) -> match completes!
    arena.submitRpsMove(createRes.duel.id, 'c1', 'rock', 3900);
    const finalRes = arena.submitRpsMove(createRes.duel.id, 'o1', 'scissors', 4000);
    expect(finalRes.ok).toBe(true);
    if (!finalRes.ok) return;

    expect(finalRes.matchFinished).toBe(true);
    expect(finalRes.winnerId).toBe('c1');
    expect(finalRes.loserId).toBe('o1');
    expect(finalRes.bountyClaimed).toBe(300);
    expect(profileRepo.getOrCreate('g1', 'c1').coins).toBe(800 + 400 + 300);

    const cStats = creditRepo.getOrCreateGamblingStats('g1', 'c1');
    const oStats = creditRepo.getOrCreateGamblingStats('g1', 'o1');
    expect(cStats.netProfit).toBe(200);
    expect(oStats.netProfit).toBe(-200);

    const lock = arena.getActiveNicknameLock('g1', 'o1', 4100);
    expect(lock).not.toBeNull();
    expect(lock?.winnerId).toBe('c1');
    expect(lock?.expiresAt).toBe(4000 + 6 * 3600 * 1000);

    // Deadbeat allowed for bet = 0, blocked for bet > 0
    profileRepo.addCoins('g1', 'deadbeat', 500);
    creditRepo.createLoan({
      guildId: 'g1',
      userId: 'deadbeat',
      loanType: 'bank',
      principal: 1000,
      dailyRate: 0.01,
      termDays: 7,
      createdAt: 100,
      dueAt: 500,
      lastAccrualDate: null,
    });
    expect(
      arena.createRpsDuel({
        guildId: 'g1',
        channelId: 'ch1',
        challengerId: 'deadbeat',
        opponentId: 'o1',
        bet: 100,
        nowMs: 5000,
      }),
    ).toEqual({ ok: false, reason: 'deadbeat_blocked' });
    expect(
      arena.createRpsDuel({
        guildId: 'g1',
        channelId: 'ch1',
        challengerId: 'deadbeat',
        opponentId: 'o1',
        bet: 0,
        nowMs: 5000,
      }).ok,
    ).toBe(true);

    db.close();
  });

  it('handles RPS invite expiry, one-sided round timeout forfeit, and two-sided round timeout cancel', () => {
    const { db, profileRepo, creditRepo, arena } = setup();
    profileRepo.addCoins('g1', 'c1', 500);
    profileRepo.addCoins('g1', 'o1', 500);

    // Invite expiry refunds challenger
    const expiredInvite = arena.createRpsDuel({
      guildId: 'g1',
      channelId: 'ch1',
      challengerId: 'c1',
      opponentId: 'o1',
      bet: 100,
      nowMs: 1000,
    });
    expect(expiredInvite.ok).toBe(true);
    if (!expiredInvite.ok) return;
    const invUpdates = arena.processTimedOutRpsDuels(1000 + RPS_INVITE_TTL_MS + 1);
    expect(invUpdates).toHaveLength(1);
    expect(invUpdates[0]?.kind).toBe('invite_expired');
    expect(profileRepo.getOrCreate('g1', 'c1').coins).toBe(500);

    // Zero-bet RPS does NOT record gambling_stats; both-timeout cancels
    const zeroRps = arena.createRpsDuel({
      guildId: 'g1',
      channelId: 'ch1',
      challengerId: 'c1',
      opponentId: 'o1',
      bet: 0,
      nowMs: 10_000,
    });
    expect(zeroRps.ok).toBe(true);
    if (!zeroRps.ok) return;
    arena.acceptRpsDuel(zeroRps.duel.id, 'o1', 10_100);
    const cancelUpdates = arena.processTimedOutRpsDuels(10_100 + RPS_ROUND_TTL_MS + 1);
    expect(cancelUpdates[0]?.kind).toBe('round_cancelled');
    expect(cancelUpdates[0]?.duel.status).toBe('cancelled');

    // One-sided timeout forfeit can win rounds and finish match
    const paidRps = arena.createRpsDuel({
      guildId: 'g1',
      channelId: 'ch1',
      challengerId: 'c1',
      opponentId: 'o1',
      bet: 100,
      nowMs: 20_000,
    });
    expect(paidRps.ok).toBe(true);
    if (!paidRps.ok) return;
    arena.acceptRpsDuel(paidRps.duel.id, 'o1', 20_100);
    for (let i = 0; i < 3; i++) {
      const t = 20_200 + i * (RPS_ROUND_TTL_MS + 100);
      arena.submitRpsMove(paidRps.duel.id, 'c1', 'rock', t);
      const upd = arena.processTimedOutRpsDuels(t + RPS_ROUND_TTL_MS + 1);
      expect(upd[0]?.kind).toBe('round_forfeit');
      if (i === 2) {
        expect(upd[0]?.matchFinished).toBe(true);
        expect(upd[0]?.winnerId).toBe('c1');
      }
    }
    expect(profileRepo.getOrCreate('g1', 'c1').coins).toBe(600);
    expect(creditRepo.getOrCreateGamblingStats('g1', 'c1').totalWagered).toBe(100);

    db.close();
  });

  it('runs 1v1 multi-stake Russian Roulette with deterministic RNG, bullet counts, and timeout auto-fire', () => {
    const { db, profileRepo, arena } = setup();
    profileRepo.addCoins('g1', 'c1', 1000);
    profileRepo.addCoins('g1', 'o1', 1000);

    // Rejects zero-stake
    expect(
      arena.createRouletteDuel({
        guildId: 'g1',
        channelId: 'ch1',
        challengerId: 'c1',
        opponentId: 'o1',
        bullets: 1,
        bet: 0,
        renameHours: 0,
        timeoutMinutes: 0,
        customWager: '',
      }),
    ).toEqual({ ok: false, reason: 'no_stake' });

    // Multi-stake combination with bet=0 allowed
    const nonCoin = arena.createRouletteDuel({
      guildId: 'g1',
      channelId: 'ch1',
      challengerId: 'c1',
      opponentId: 'o1',
      bullets: 2,
      bet: 0,
      renameHours: 1,
      timeoutMinutes: 10,
      customWager: '输了发一段情诗',
      nowMs: 1000,
    });
    expect(nonCoin.ok).toBe(true);
    if (!nonCoin.ok) return;

    // Deterministic rng: 0.1 -> challenger goes first; remaining rolls place bullets at [0, 5] or deterministic slots
    const seq = [0.1, 0.99, 0.99, 0.99, 0.99, 0.0];
    let idx = 0;
    const accept = arena.acceptRouletteDuel(nonCoin.duel.id, 'o1', 2000, () => seq[idx++] ?? 0);
    expect(accept.ok).toBe(true);
    if (!accept.ok) return;
    expect(accept.duel.turnOrder).toEqual(['c1', 'o1']);
    expect(accept.duel.bulletPositions).toHaveLength(2);

    // Force a single-bullet duel where slot 1 is loaded so turn 0 survives, turn 1 fires via auto-timeout
    const paid = arena.createRouletteDuel({
      guildId: 'g1',
      channelId: 'ch1',
      challengerId: 'c1',
      opponentId: 'o1',
      bullets: 1,
      bet: 300,
      renameHours: 24,
      timeoutMinutes: 5,
      nowMs: 5000,
    });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;

    // With slots [0,1,2,3,4,5]: i=5 j=0 -> [5,1,2,3,4,0]; i=4 j=0 -> [4,1,2,3,5,0]; ...
    // Easier: rng always 0.1 -> turnOrder=[c1,o1], shuffle swaps i with 0 -> [1,2,3,4,5,0], first 1 item = [1]!
    const acceptPaid = arena.acceptRouletteDuel(paid.duel.id, 'o1', 6000, () => 0.1);
    expect(acceptPaid.ok).toBe(true);
    if (!acceptPaid.ok) return;
    expect(acceptPaid.duel.bulletPositions).toEqual([1]);

    // Wrong turn rejected
    expect(arena.pullRouletteDuelTrigger(paid.duel.id, 'o1', { nowMs: 6500 })).toEqual({
      ok: false,
      reason: 'not_your_turn',
    });

    // c1 pulls at chamber 0 -> empty
    const shot1 = arena.pullRouletteDuelTrigger(paid.duel.id, 'c1', { nowMs: 6500 });
    expect(shot1.ok && !shot1.fired).toBe(true);

    // o1 times out at chamber 1 -> bullet fires! c1 wins!
    const timeouts = arena.processTimedOutRouletteDuels(6500 + 30_001);
    const paidTimeout = timeouts.find((t) => t.duel.id === paid.duel.id);
    expect(paidTimeout).toBeDefined();
    expect(paidTimeout?.fired).toBe(true);
    expect(paidTimeout?.winnerId).toBe('c1');
    expect(paidTimeout?.loserId).toBe('o1');
    expect(paidTimeout?.timeoutDurationMs).toBe(5 * 60 * 1000);
    expect(profileRepo.getOrCreate('g1', 'c1').coins).toBe(1300);
    expect(profileRepo.getOrCreate('g1', 'o1').coins).toBe(700);
    expect(arena.getActiveNicknameLock('g1', 'o1', 40_000)?.winnerId).toBe('c1');

    db.close();
  });

  it('enforces rename cooldown, preserves original nickname across overwrites, and restores fallback card/title on expiry', () => {
    const { db, profileRepo, duelRepo, arena } = setup();
    profileRepo.updateCard('g1', 'loser', {
      cardNickname: '原名片',
      cardTag: null,
      cardBio: null,
      cardColor: null,
    });
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'loser'), equippedTitle: '原称号' });

    // Grant initial lock from RPS win
    const d1 = arena.createRpsDuel({
      guildId: 'g1',
      channelId: 'ch1',
      challengerId: 'w1',
      opponentId: 'loser',
      renameHours: 1,
      nowMs: 1000,
    });
    if (!d1.ok) throw new Error('unexpected');
    arena.acceptRpsDuel(d1.duel.id, 'loser', 1100);
    for (let i = 0; i < 3; i++) {
      arena.submitRpsMove(d1.duel.id, 'w1', 'rock', 1200 + i * 10);
      arena.submitRpsMove(d1.duel.id, 'loser', 'scissors', 1205 + i * 10);
    }

    // Discord rename captures original nickname once, enforces 10s cooldown
    const v1 = arena.validateWinnerRename('g1', 'w1', 'loser', '菜狗一号', 2000);
    expect(v1.ok).toBe(true);
    arena.commitDiscordRename('g1', 'loser', '原始群昵称', '菜狗一号', 2000);

    const cd = arena.validateWinnerRename('g1', 'w1', 'loser', '菜狗二号', 5000);
    expect(cd.ok).toBe(false);
    if (!cd.ok) expect(cd.reason).toBe('cooldown');

    const v2 = arena.validateWinnerRename('g1', 'w1', 'loser', '菜狗二号', 2000 + RENAME_COOLDOWN_MS);
    expect(v2.ok).toBe(true);
    arena.commitDiscordRename('g1', 'loser', '应该被忽略的中间名', '菜狗二号', 2000 + RENAME_COOLDOWN_MS);
    expect(duelRepo.getNicknameLock('g1', 'loser')?.originalNickname).toBe('原始群昵称');

    // Overwrite by new winner w2 preserves originalNickname while updating winnerId
    const d2 = arena.createRpsDuel({
      guildId: 'g1',
      channelId: 'ch1',
      challengerId: 'w2',
      opponentId: 'loser',
      renameHours: 6,
      nowMs: 20_000,
    });
    if (!d2.ok) throw new Error('unexpected');
    arena.acceptRpsDuel(d2.duel.id, 'loser', 20_100);
    for (let i = 0; i < 3; i++) {
      arena.submitRpsMove(d2.duel.id, 'w2', 'paper', 20_200 + i * 10);
      arena.submitRpsMove(d2.duel.id, 'loser', 'rock', 20_205 + i * 10);
    }
    const overwritten = duelRepo.getNicknameLock('g1', 'loser');
    expect(overwritten?.winnerId).toBe('w2');
    expect(overwritten?.originalNickname).toBe('原始群昵称');

    // Fallback rename updates cardNickname & equippedTitle and restores on expiry
    arena.commitFallbackRename('g1', 'loser', '挂牌小丑', 21_000);
    expect(profileRepo.getOrCreate('g1', 'loser').cardNickname).toBe('挂牌小丑');
    expect(profileRepo.getOrCreate('g1', 'loser').equippedTitle).toBe('挂牌小丑');

    const expired = arena.expireDueNicknameLocks(20_225 + 6 * 3600 * 1000 + 1);
    expect(expired).toHaveLength(1);
    expect(profileRepo.getOrCreate('g1', 'loser').cardNickname).toBe('原名片');
    expect(profileRepo.getOrCreate('g1', 'loser').equippedTitle).toBe('原称号');
    expect(duelRepo.getNicknameLock('g1', 'loser')).toBeNull();

    db.close();
  });
});
