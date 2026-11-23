import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
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
    // Deterministic deck (pop() takes from end of array)
    // Start pops: p1, d1, p2, d2
    const fixedDeck: Card[] = [
      { rank: '2', suit: '♣' }, // unused
      { rank: '10', suit: '♠' }, // dealer hit if needed
      { rank: '6', suit: '♦' }, // player double/hit -> 10+6+5 = 21 or similar
      { rank: '8', suit: '♥' }, // d2 => dealer 18
      { rank: '6', suit: '♣' }, // p2 => player 16
      { rank: '10', suit: '♦' }, // d1
      { rank: '10', suit: '♣' }, // p1
    ];

    const startRes = manager.startGame('g1', 'u1', 100, () => fixedDeck.slice());
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    // Bet deducted on start
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(900);

    // Player hits and gets 6 (10 + 6 + 6 = 22 -> bust!)
    const hitRes = manager.hit('g1', 'u1');
    expect(hitRes.ok).toBe(true);
    if (!hitRes.ok) return;
    expect(hitRes.game.status).toBe('player_bust');
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(900);

    // Start second game and double down for a win (player 5+6 -> +10 = 21 vs dealer 10+8 = 18)
    const winDeck: Card[] = [
      { rank: '10', suit: '♠' }, // player double card -> 21
      { rank: '8', suit: '♥' },  // d2 => 18
      { rank: '6', suit: '♣' },  // p2
      { rank: '10', suit: '♦' }, // d1
      { rank: '5', suit: '♣' },  // p1
    ];
    const g2 = manager.startGame('g1', 'u1', 100, () => winDeck.slice());
    expect(g2.ok).toBe(true);
    const dbl = manager.doubleDown('g1', 'u1');
    expect(dbl.ok).toBe(true);
    if (dbl.ok) {
      expect(dbl.game.status).toBe('player_win');
      expect(dbl.game.bet).toBe(200);
      // Started at 900 -> -100 -100 + 400 = 1100
      expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(1100);
    }

    db.close();
  });
});
