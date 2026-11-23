import type Database from 'better-sqlite3';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';

export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export interface HandEvaluation {
  total: number;
  isSoft: boolean;
  isBlackjack: boolean;
  isBust: boolean;
}

export type BlackjackStatus =
  | 'playing'
  | 'player_blackjack'
  | 'player_bust'
  | 'dealer_bust'
  | 'player_win'
  | 'dealer_win'
  | 'push';

export interface BlackjackGame {
  guildId: string;
  userId: string;
  bet: number;
  deck: Card[];
  playerHand: Card[];
  dealerHand: Card[];
  status: BlackjackStatus;
  payout: number;
  canDouble: boolean;
}

export type BlackjackActionResult =
  | { ok: true; game: BlackjackGame; balance: number }
  | {
      ok: false;
      reason:
        | 'invalid_bet'
        | 'insufficient_funds'
        | 'game_already_active'
        | 'no_active_game'
        | 'cannot_double';
    };

const SUITS: readonly Suit[] = ['♠', '♥', '♦', '♣'];
const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function createShuffledDeck(rng: () => number = Math.random): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

export function evaluateHand(hand: readonly Card[]): HandEvaluation {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.rank === 'A') {
      total += 11;
      aces += 1;
    } else if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return {
    total,
    isSoft: aces > 0,
    isBlackjack: hand.length === 2 && total === 21,
    isBust: total > 21,
  };
}

export function formatHand(hand: readonly Card[]): string {
  return hand.map((c) => `\`${c.suit}${c.rank}\``).join(' ');
}

export class BlackjackManager {
  private readonly games = new Map<string, BlackjackGame>();

  constructor(
    private readonly db: Database.Database,
    private readonly profileRepo: ProfileRepo,
  ) {}

  private key(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  getActiveGame(guildId: string, userId: string): BlackjackGame | null {
    return this.games.get(this.key(guildId, userId)) ?? null;
  }

  startGame(
    guildId: string,
    userId: string,
    bet: number,
    deckFactory: () => Card[] = () => createShuffledDeck(),
  ): BlackjackActionResult {
    const cleanBet = Math.floor(bet);
    if (!Number.isFinite(cleanBet) || cleanBet <= 0) {
      return { ok: false, reason: 'invalid_bet' };
    }
    const k = this.key(guildId, userId);
    if (this.games.has(k)) {
      return { ok: false, reason: 'game_already_active' };
    }

    return this.db.transaction((): BlackjackActionResult => {
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cleanBet) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const remainingCoins = profile.coins - cleanBet;
      this.profileRepo.save({ ...profile, coins: remainingCoins });

      const deck = deckFactory();
      const p1 = deck.pop()!;
      const d1 = deck.pop()!;
      const p2 = deck.pop()!;
      const d2 = deck.pop()!;

      const playerHand = [p1, p2];
      const dealerHand = [d1, d2];
      const playerEval = evaluateHand(playerHand);
      const dealerEval = evaluateHand(dealerHand);

      const game: BlackjackGame = {
        guildId,
        userId,
        bet: cleanBet,
        deck,
        playerHand,
        dealerHand,
        status: 'playing',
        payout: 0,
        canDouble: remainingCoins >= cleanBet,
      };

      if (playerEval.isBlackjack || dealerEval.isBlackjack) {
        if (playerEval.isBlackjack && dealerEval.isBlackjack) {
          game.status = 'push';
          game.payout = cleanBet;
        } else if (playerEval.isBlackjack) {
          game.status = 'player_blackjack';
          game.payout = Math.floor(cleanBet * 2.5);
        } else {
          game.status = 'dealer_win';
          game.payout = 0;
        }
        const finalBalance = remainingCoins + game.payout;
        if (game.payout > 0) {
          this.profileRepo.save({ ...profile, coins: finalBalance });
        }
        return { ok: true, game, balance: finalBalance };
      }

      this.games.set(k, game);
      return { ok: true, game, balance: remainingCoins };
    })();
  }

  hit(guildId: string, userId: string): BlackjackActionResult {
    const k = this.key(guildId, userId);
    const game = this.games.get(k);
    if (!game) {
      return { ok: false, reason: 'no_active_game' };
    }

    const card = game.deck.pop();
    if (!card) {
      return this.stand(guildId, userId);
    }
    game.playerHand.push(card);
    game.canDouble = false;

    const playerEval = evaluateHand(game.playerHand);
    if (playerEval.isBust) {
      game.status = 'player_bust';
      game.payout = 0;
      this.games.delete(k);
      const balance = this.profileRepo.getOrCreate(guildId, userId).coins;
      return { ok: true, game, balance };
    }

    if (playerEval.total === 21) {
      return this.stand(guildId, userId);
    }

    const balance = this.profileRepo.getOrCreate(guildId, userId).coins;
    return { ok: true, game, balance };
  }

  doubleDown(guildId: string, userId: string): BlackjackActionResult {
    const k = this.key(guildId, userId);
    const game = this.games.get(k);
    if (!game) {
      return { ok: false, reason: 'no_active_game' };
    }
    if (game.playerHand.length !== 2) {
      return { ok: false, reason: 'cannot_double' };
    }

    const deductResult = this.db.transaction((): boolean => {
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < game.bet) {
        return false;
      }
      this.profileRepo.save({ ...profile, coins: profile.coins - game.bet });
      return true;
    })();

    if (!deductResult) {
      return { ok: false, reason: 'insufficient_funds' };
    }

    game.bet *= 2;
    game.canDouble = false;
    const card = game.deck.pop();
    if (card) {
      game.playerHand.push(card);
    }

    const playerEval = evaluateHand(game.playerHand);
    if (playerEval.isBust) {
      game.status = 'player_bust';
      game.payout = 0;
      this.games.delete(k);
      const balance = this.profileRepo.getOrCreate(guildId, userId).coins;
      return { ok: true, game, balance };
    }

    return this.stand(guildId, userId);
  }

  stand(guildId: string, userId: string): BlackjackActionResult {
    const k = this.key(guildId, userId);
    const game = this.games.get(k);
    if (!game) {
      return { ok: false, reason: 'no_active_game' };
    }

    while (evaluateHand(game.dealerHand).total < 17) {
      const next = game.deck.pop();
      if (!next) break;
      game.dealerHand.push(next);
    }

    const playerEval = evaluateHand(game.playerHand);
    const dealerEval = evaluateHand(game.dealerHand);

    if (dealerEval.isBust) {
      game.status = 'dealer_bust';
      game.payout = game.bet * 2;
    } else if (playerEval.total > dealerEval.total) {
      game.status = 'player_win';
      game.payout = game.bet * 2;
    } else if (playerEval.total < dealerEval.total) {
      game.status = 'dealer_win';
      game.payout = 0;
    } else {
      game.status = 'push';
      game.payout = game.bet;
    }

    this.games.delete(k);

    const balance = this.db.transaction((): number => {
      if (game.payout > 0) {
        const updated = this.profileRepo.addCoins(guildId, userId, game.payout);
        return updated.coins;
      }
      return this.profileRepo.getOrCreate(guildId, userId).coins;
    })();

    return { ok: true, game, balance };
  }
}
