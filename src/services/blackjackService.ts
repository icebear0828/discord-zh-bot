import type Database from 'better-sqlite3';
import { BLACKJACK_TTL_MS, MAX_SOLO_GAMBLE_BET } from '../config/economyConstants.js';
import type { BlackjackRepo } from '../db/repositories/blackjackRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { CreditLoanService } from './creditLoanService.js';

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
  createdAt: number;
  expiresAt: number;
}

export interface ExpiredBlackjackResult {
  guildId: string;
  userId: string;
  bet: number;
  refunded: number;
  balance: number;
  createdAt: number;
  expiresAt: number;
}

export type BlackjackActionResult =
  | { ok: true; game: BlackjackGame; balance: number }
  | {
      ok: false;
      reason:
        | 'invalid_bet'
        | 'bet_too_large'
        | 'insufficient_funds'
        | 'game_already_active'
        | 'no_active_game'
        | 'cannot_double'
        | 'deadbeat_blocked';
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
  private readonly blackjackRepo?: BlackjackRepo;
  private readonly creditLoanService?: CreditLoanService;

  constructor(
    private readonly db: Database.Database,
    private readonly profileRepo: ProfileRepo,
    blackjackRepoOrCreditLoan?: BlackjackRepo | CreditLoanService,
    creditLoanService?: CreditLoanService,
  ) {
    if (blackjackRepoOrCreditLoan) {
      if ('isDeadbeatBlocked' in blackjackRepoOrCreditLoan) {
        this.creditLoanService = blackjackRepoOrCreditLoan;
      } else {
        this.blackjackRepo = blackjackRepoOrCreditLoan;
        this.creditLoanService = creditLoanService;
      }
    } else {
      this.creditLoanService = creditLoanService;
    }
  }

  private key(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  private loadRawGame(guildId: string, userId: string): BlackjackGame | null {
    if (this.blackjackRepo) {
      return this.blackjackRepo.get(guildId, userId);
    }
    return this.games.get(this.key(guildId, userId)) ?? null;
  }

  private persistGame(game: BlackjackGame): void {
    const k = this.key(game.guildId, game.userId);
    this.games.set(k, game);
    this.blackjackRepo?.upsert(game);
  }

  private removeGame(guildId: string, userId: string): boolean {
    const k = this.key(guildId, userId);
    const removedMem = this.games.delete(k);
    if (this.blackjackRepo) {
      return this.blackjackRepo.delete(guildId, userId);
    }
    return removedMem;
  }

  private expireSingleIfDue(
    guildId: string,
    userId: string,
    nowMs: number,
  ): ExpiredBlackjackResult | null {
    const game = this.loadRawGame(guildId, userId);
    if (!game) return null;
    if (game.status !== 'playing') {
      this.removeGame(guildId, userId);
      return null;
    }
    if (game.expiresAt > nowMs) {
      return null;
    }
    const deleted = this.removeGame(guildId, userId);
    if (!deleted) return null;
    const refunded = Math.max(0, game.bet);
    const updated =
      refunded > 0
        ? this.profileRepo.addCoins(guildId, userId, refunded)
        : this.profileRepo.getOrCreate(guildId, userId);
    return {
      guildId,
      userId,
      bet: game.bet,
      refunded,
      balance: updated.coins,
      createdAt: game.createdAt,
      expiresAt: game.expiresAt,
    };
  }

  getActiveGame(guildId: string, userId: string, nowMs = Date.now()): BlackjackGame | null {
    return this.db.transaction((): BlackjackGame | null => {
      const game = this.loadRawGame(guildId, userId);
      if (!game) return null;
      if (game.status !== 'playing' || game.expiresAt <= nowMs) {
        this.expireSingleIfDue(guildId, userId, nowMs);
        return null;
      }
      return game;
    })();
  }

  expireDueGames(nowMs = Date.now()): ExpiredBlackjackResult[] {
    return this.db.transaction((): ExpiredBlackjackResult[] => {
      const dueGames: BlackjackGame[] = this.blackjackRepo
        ? this.blackjackRepo.listExpired(nowMs)
        : [...this.games.values()].filter((g) => g.expiresAt <= nowMs);

      const results: ExpiredBlackjackResult[] = [];
      for (const game of dueGames) {
        const res = this.expireSingleIfDue(game.guildId, game.userId, nowMs);
        if (res) {
          results.push(res);
        }
      }
      return results;
    })();
  }

  startGame(
    guildId: string,
    userId: string,
    bet: number,
    deckFactory: () => Card[] = () => createShuffledDeck(),
    nowMs = Date.now(),
  ): BlackjackActionResult {
    const cleanBet = Math.floor(bet);
    if (!Number.isFinite(cleanBet) || cleanBet <= 0) {
      return { ok: false, reason: 'invalid_bet' };
    }
    if (cleanBet > MAX_SOLO_GAMBLE_BET) {
      return { ok: false, reason: 'bet_too_large' };
    }
    if (this.creditLoanService?.isDeadbeatBlocked(guildId, userId, nowMs).blocked) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }

    return this.db.transaction((): BlackjackActionResult => {
      this.expireSingleIfDue(guildId, userId, nowMs);
      const existing = this.loadRawGame(guildId, userId);
      if (existing && existing.status === 'playing' && existing.expiresAt > nowMs) {
        return { ok: false, reason: 'game_already_active' };
      }

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
        createdAt: nowMs,
        expiresAt: nowMs + BLACKJACK_TTL_MS,
      };

      if (playerEval.isBlackjack || dealerEval.isBlackjack) {
        if (playerEval.isBlackjack && dealerEval.isBlackjack) {
          game.status = 'push';
          game.payout = cleanBet;
        } else if (playerEval.isBlackjack) {
          game.status = 'player_blackjack';
          game.payout = Math.ceil(cleanBet * 2.5);
        } else {
          game.status = 'dealer_win';
          game.payout = 0;
        }
        const finalBalance = remainingCoins + game.payout;
        if (game.payout > 0) {
          this.profileRepo.save({ ...profile, coins: finalBalance });
        }
        this.creditLoanService?.recordGamblingResult(
          guildId,
          userId,
          game.bet,
          game.payout - game.bet,
          nowMs,
        );
        return { ok: true, game, balance: finalBalance };
      }

      this.persistGame(game);
      return { ok: true, game, balance: remainingCoins };
    })();
  }

  private settleStandInTx(game: BlackjackGame, nowMs: number): BlackjackActionResult {
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

    this.removeGame(game.guildId, game.userId);

    const balance =
      game.payout > 0
        ? this.profileRepo.addCoins(game.guildId, game.userId, game.payout).coins
        : this.profileRepo.getOrCreate(game.guildId, game.userId).coins;
    this.creditLoanService?.recordGamblingResult(
      game.guildId,
      game.userId,
      game.bet,
      game.payout - game.bet,
      nowMs,
    );

    return { ok: true, game, balance };
  }

  hit(guildId: string, userId: string, nowMs = Date.now()): BlackjackActionResult {
    return this.db.transaction((): BlackjackActionResult => {
      const game = this.loadRawGame(guildId, userId);
      if (!game || game.status !== 'playing') {
        return { ok: false, reason: 'no_active_game' };
      }
      if (game.expiresAt <= nowMs) {
        this.expireSingleIfDue(guildId, userId, nowMs);
        return { ok: false, reason: 'no_active_game' };
      }

      const card = game.deck.pop();
      if (!card) {
        return this.settleStandInTx(game, nowMs);
      }
      game.playerHand.push(card);
      game.canDouble = false;

      const playerEval = evaluateHand(game.playerHand);
      if (playerEval.isBust) {
        game.status = 'player_bust';
        game.payout = 0;
        this.removeGame(guildId, userId);
        this.creditLoanService?.recordGamblingResult(guildId, userId, game.bet, -game.bet, nowMs);
        const balance = this.profileRepo.getOrCreate(guildId, userId).coins;
        return { ok: true, game, balance };
      }

      if (playerEval.total === 21) {
        return this.settleStandInTx(game, nowMs);
      }

      this.persistGame(game);
      const balance = this.profileRepo.getOrCreate(guildId, userId).coins;
      return { ok: true, game, balance };
    })();
  }

  doubleDown(guildId: string, userId: string, nowMs = Date.now()): BlackjackActionResult {
    return this.db.transaction((): BlackjackActionResult => {
      const game = this.loadRawGame(guildId, userId);
      if (!game || game.status !== 'playing') {
        return { ok: false, reason: 'no_active_game' };
      }
      if (game.expiresAt <= nowMs) {
        this.expireSingleIfDue(guildId, userId, nowMs);
        return { ok: false, reason: 'no_active_game' };
      }
      if (game.playerHand.length !== 2) {
        return { ok: false, reason: 'cannot_double' };
      }

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < game.bet) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      this.profileRepo.save({ ...profile, coins: profile.coins - game.bet });

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
        this.removeGame(guildId, userId);
        this.creditLoanService?.recordGamblingResult(guildId, userId, game.bet, -game.bet, nowMs);
        const balance = this.profileRepo.getOrCreate(guildId, userId).coins;
        return { ok: true, game, balance };
      }

      return this.settleStandInTx(game, nowMs);
    })();
  }

  stand(guildId: string, userId: string, nowMs = Date.now()): BlackjackActionResult {
    return this.db.transaction((): BlackjackActionResult => {
      const game = this.loadRawGame(guildId, userId);
      if (!game || game.status !== 'playing') {
        return { ok: false, reason: 'no_active_game' };
      }
      if (game.expiresAt <= nowMs) {
        this.expireSingleIfDue(guildId, userId, nowMs);
        return { ok: false, reason: 'no_active_game' };
      }
      return this.settleStandInTx(game, nowMs);
    })();
  }
}
