import { describe, expect, it } from 'vitest';
import { BLACKJACK_TTL_MS, MAX_SOLO_GAMBLE_BET } from '../../src/config/economyConstants.js';
import { createDatabase } from '../../src/db/database.js';
import { BlackjackRepo } from '../../src/db/repositories/blackjackRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import {
  BlackjackManager,
  evaluateHand,
  type Card,
} from '../../src/services/blackjackService.js';

describe('blackjackService', () => {
  it('calculates soft ace totals and natural blackjack accurately', () => {
    const aceSix: Card[] = [
      { rank: 'A', suit: '♠' },
      { rank: '6', suit: '♥' },
    ];
    expect(evaluateHand(aceSix)).toEqual({ total: 17, isSoft: true, isBlackjack: false, isBust: false });

    const aceKing: Card[] = [
      { rank: 'A', suit: '♠' },
      { rank: 'K', suit: '♦' },
    ];
    expect(evaluateHand(aceKing)).toEqual({ total: 21, isSoft: true, isBlackjack: true, isBust: false });

    const convertedAce: Card[] = [
      { rank: 'A', suit: '♠' },
      { rank: '9', suit: '♣' },
      { rank: '5', suit: '♦' },
    ];
    expect(evaluateHand(convertedAce)).toEqual({ total: 15, isSoft: false, isBlackjack: false, isBust: false });
  });

  it('handles start, hit, stand, double down, and atomic balance settlement', () => {
    const db = createDatabase(':memory:');
    const profileRepo = new ProfileRepo(db);
    profileRepo.addCoins('g1', 'u1', 1000);

    const manager = new BlackjackManager(db, profileRepo);
    const fixedDeck: Card[] = [
      { rank: '2', suit: '♣' },
      { rank: '10', suit: '♠' },
      { rank: '6', suit: '♦' },
      { rank: '8', suit: '♥' },
      { rank: '6', suit: '♣' },
      { rank: '10', suit: '♦' },
      { rank: '10', suit: '♣' },
    ];

    const startRes = manager.startGame('g1', 'u1', 100, () => fixedDeck.slice());
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(900);

    const hitRes = manager.hit('g1', 'u1');
    expect(hitRes.ok).toBe(true);
    if (!hitRes.ok) return;
    expect(hitRes.game.status).toBe('player_bust');
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(900);

    const winDeck: Card[] = [
      { rank: '10', suit: '♠' },
      { rank: '8', suit: '♥' },
      { rank: '6', suit: '♣' },
      { rank: '10', suit: '♦' },
      { rank: '5', suit: '♣' },
    ];
    const g2 = manager.startGame('g1', 'u1', 100, () => winDeck.slice());
    expect(g2.ok).toBe(true);
    const dbl = manager.doubleDown('g1', 'u1');
    expect(dbl.ok).toBe(true);
    if (dbl.ok) {
      expect(dbl.game.status).toBe('player_win');
      expect(dbl.game.bet).toBe(200);
      expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(1100);
    }

    db.close();
  });

  it('persists active games to BlackjackRepo across restarts, enforces bet cap & 1-coin natural ceil, and expires due games with full refund', () => {
    const db = createDatabase(':memory:');
    const profileRepo = new ProfileRepo(db);
    const bjRepo = new BlackjackRepo(db);
    profileRepo.addCoins('g1', 'u1', 5_000_000);
    profileRepo.addCoins('g1', 'u2', 500);

    const mgr1 = new BlackjackManager(db, profileRepo, bjRepo);

    // Bet cap enforcement
    expect(mgr1.startGame('g1', 'u1', MAX_SOLO_GAMBLE_BET + 1)).toEqual({
      ok: false,
      reason: 'bet_too_large',
    });

    // 1-coin natural blackjack uses Math.ceil(1 * 2.5) = 3 (net +2)
    const bjDeck = (): Card[] => [
      { rank: '8', suit: '♥' }, // d2
      { rank: 'K', suit: '♠' }, // p2
      { rank: '9', suit: '♦' }, // d1
      { rank: 'A', suit: '♣' }, // p1 -> 21 blackjack!
    ];
    const coinsBeforeBj = profileRepo.getOrCreate('g1', 'u2').coins;
    const nat = mgr1.startGame('g1', 'u2', 1, bjDeck, 10_000);
    expect(nat.ok).toBe(true);
    if (nat.ok) {
      expect(nat.game.status).toBe('player_blackjack');
      expect(nat.game.payout).toBe(3);
      expect(nat.balance).toBe(coinsBeforeBj + 2);
      expect(bjRepo.get('g1', 'u2')).toBeNull();
    }

    // Active game persists across a simulated restart (brand-new BlackjackManager instance)
    const playingDeck = (): Card[] => [
      { rank: '2', suit: '♠' }, // extra
      { rank: '5', suit: '♥' }, // hit card -> 10+6+5 = 21 auto stand!
      { rank: '8', suit: '♥' }, // d2 => 18
      { rank: '6', suit: '♣' }, // p2 => 16
      { rank: '10', suit: '♦' }, // d1
      { rank: '10', suit: '♣' }, // p1
    ];
    const t0 = 1_700_000_000_000;
    const started = mgr1.startGame('g1', 'u1', 200, playingDeck, t0);
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.game.createdAt).toBe(t0);
      expect(started.game.expiresAt).toBe(t0 + BLACKJACK_TTL_MS);
    }
    expect(bjRepo.get('g1', 'u1')).not.toBeNull();

    // New manager instance picks up persisted game
    const mgr2 = new BlackjackManager(db, profileRepo, bjRepo);
    const restored = mgr2.getActiveGame('g1', 'u1', t0 + 60_000);
    expect(restored).not.toBeNull();
    expect(restored?.bet).toBe(200);

    // Hit to 21 auto-stands and deletes persisted row
    const hit21 = mgr2.hit('g1', 'u1', t0 + 65_000);
    expect(hit21.ok).toBe(true);
    if (hit21.ok) {
      expect(hit21.game.status).toBe('player_win');
      expect(hit21.game.payout).toBe(400);
    }
    expect(bjRepo.get('g1', 'u1')).toBeNull();

    // Expiry refunds full bet and never double-refunds or deadlocks
    const coinsBeforeExp = profileRepo.getOrCreate('g1', 'u2').coins;
    const sExp = mgr2.startGame('g1', 'u2', 150, playingDeck, t0);
    expect(sExp.ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'u2').coins).toBe(coinsBeforeExp - 150);

    const expiredList = mgr2.expireDueGames(t0 + BLACKJACK_TTL_MS + 1);
    expect(expiredList).toHaveLength(1);
    expect(expiredList[0]?.refunded).toBe(150);
    expect(profileRepo.getOrCreate('g1', 'u2').coins).toBe(coinsBeforeExp);
    expect(bjRepo.get('g1', 'u2')).toBeNull();

    // Second expire call does nothing (no double refund)
    expect(mgr2.expireDueGames(t0 + BLACKJACK_TTL_MS + 5000)).toHaveLength(0);
    expect(profileRepo.getOrCreate('g1', 'u2').coins).toBe(coinsBeforeExp);

    // Lazy expiry inside startGame also unblocks user automatically
    const sLazy = mgr2.startGame('g1', 'u2', 100, playingDeck, t0 + 10_000);
    expect(sLazy.ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'u2').coins).toBe(coinsBeforeExp - 100);
    const sAfterExpiry = mgr2.startGame(
      'g1',
      'u2',
      80,
      playingDeck,
      t0 + 10_000 + BLACKJACK_TTL_MS + 1,
    );
    expect(sAfterExpiry.ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'u2').coins).toBe(coinsBeforeExp - 80);

    db.close();
  });
});
