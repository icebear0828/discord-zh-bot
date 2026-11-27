import { MAX_COIN_AMOUNT } from '../../config/economyConstants.js';
import type { NumberBombGame } from '../../db/repositories/chaosRepo.js';
import {
  BOMB_TTL_MS,
  type BombPayout,
  type ChaosOpsDeps,
  type CreateBombResult,
  type GuessBombResult,
} from './chaosCatalogAndTypes.js';

export function createNumberBombOp(
  deps: ChaosOpsDeps,
  input: {
    guildId: string;
    channelId: string;
    hostId: string;
    penalty: number;
    nowMs?: number;
    rng?: () => number;
  },
): CreateBombResult {
  const penalty = Math.floor(input.penalty);
  const nowMs = input.nowMs ?? Date.now();
  const rng = input.rng ?? Math.random;

  if (!Number.isFinite(penalty) || penalty < 100 || penalty > MAX_COIN_AMOUNT) {
    return { ok: false, reason: 'invalid_penalty' };
  }
  if (deps.creditLoanService?.isDeadbeatBlocked(input.guildId, input.hostId, nowMs).blocked) {
    return { ok: false, reason: 'deadbeat_blocked' };
  }

  const host = deps.profileRepo.getOrCreate(input.guildId, input.hostId);
  if (host.coins < penalty) {
    return { ok: false, reason: 'insufficient_funds' };
  }

  // Full closed interval [1, 100] so guessing 1 or 100 carries real risk
  const secretNumber = 1 + Math.min(99, Math.max(0, Math.floor(rng() * 100)));
  const game = deps.chaosRepo.createNumberBomb({
    guildId: input.guildId,
    channelId: input.channelId,
    hostId: input.hostId,
    penalty,
    minBound: 1,
    maxBound: 100,
    secretNumber,
    createdAt: nowMs,
    expiresAt: nowMs + BOMB_TTL_MS,
  });

  return { ok: true, game };
}

export function expireNumberBombIfDueOp(
  deps: ChaosOpsDeps,
  gameId: number,
  nowMs = Date.now(),
): NumberBombGame | null {
  return deps.db.transaction((): NumberBombGame | null => {
    const current = deps.chaosRepo.getNumberBombById(gameId);
    if (!current || current.status !== 'open' || current.expiresAt > nowMs) {
      return null;
    }
    if (!deps.chaosRepo.expireNumberBombById(gameId)) {
      return null;
    }
    return deps.chaosRepo.getNumberBombById(gameId) ?? { ...current, status: 'cancelled' };
  })();
}

export function guessNumberBombOp(
  deps: ChaosOpsDeps,
  gameId: number,
  userId: string,
  rawGuess: number,
  nowMs = Date.now(),
): GuessBombResult {
  const guess = Math.floor(rawGuess);

  return deps.db.transaction((): GuessBombResult => {
    const game = deps.chaosRepo.getNumberBombById(gameId);
    if (!game) return { ok: false, reason: 'not_found' };
    if (game.status !== 'open') return { ok: false, reason: 'not_open' };
    if (game.expiresAt <= nowMs) {
      deps.chaosRepo.expireNumberBombById(game.id);
      return { ok: false, reason: 'expired' };
    }

    if (!Number.isFinite(guess) || guess < game.minBound || guess > game.maxBound) {
      return {
        ok: false,
        reason: 'invalid_guess',
        minBound: game.minBound,
        maxBound: game.maxBound,
      };
    }

    if (game.guesses.length > 0 && game.lastGuesserId === userId) {
      return { ok: false, reason: 'consecutive_guess' };
    }
    if (deps.creditLoanService?.isDeadbeatBlocked(game.guildId, userId, nowMs).blocked) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }

    const player = deps.profileRepo.getOrCreate(game.guildId, userId);
    if (player.coins < game.penalty) {
      return { ok: false, reason: 'insufficient_funds', penalty: game.penalty };
    }

    const nextGuesses = [
      ...game.guesses,
      { userId, guess, exploded: guess === game.secretNumber, at: nowMs },
    ].slice(-12);

    if (guess === game.secretNumber) {
      const actualPenalty = Math.min(player.coins, game.penalty);
      deps.profileRepo.save({ ...player, coins: player.coins - actualPenalty });

      const recipients = game.participants.filter((id) => id !== userId);
      const payouts: BombPayout[] = [];

      if (recipients.length > 0 && actualPenalty > 0) {
        const base = Math.floor(actualPenalty / recipients.length);
        const rem = actualPenalty % recipients.length;
        recipients.forEach((recipientId, idx) => {
          const share = base + (idx === 0 ? rem : 0);
          if (share > 0) {
            deps.profileRepo.addCoins(game.guildId, recipientId, share);
            payouts.push({ userId: recipientId, amount: share });
          }
        });
      }

      if (deps.creditLoanService && actualPenalty > 0) {
        deps.creditLoanService.recordGamblingResult(
          game.guildId,
          userId,
          actualPenalty,
          -actualPenalty,
          nowMs,
        );
        for (const payout of payouts) {
          deps.creditLoanService.recordGamblingResult(
            game.guildId,
            payout.userId,
            game.penalty,
            payout.amount,
            nowMs,
          );
        }
      }

      const updated: NumberBombGame = {
        ...game,
        lastGuesserId: userId,
        guesses: nextGuesses,
        status: 'exploded',
        loserId: userId,
        payoutsJson: JSON.stringify(payouts),
      };
      deps.chaosRepo.saveNumberBomb(updated);

      return {
        ok: true,
        game: updated,
        guess,
        exploded: true,
        penaltyPaid: actualPenalty,
        payouts,
      };
    }

    const nextParticipants = game.participants.includes(userId)
      ? game.participants
      : [...game.participants, userId];

    const nextMin = guess < game.secretNumber ? guess + 1 : game.minBound;
    const nextMax = guess > game.secretNumber ? guess - 1 : game.maxBound;

    const updated: NumberBombGame = {
      ...game,
      minBound: nextMin,
      maxBound: nextMax,
      lastGuesserId: userId,
      participants: nextParticipants,
      guesses: nextGuesses,
    };
    deps.chaosRepo.saveNumberBomb(updated);

    return {
      ok: true,
      game: updated,
      guess,
      exploded: false,
      penaltyPaid: 0,
      payouts: [],
    };
  })();
}

export function expireDueNumberBombsOp(
  deps: ChaosOpsDeps,
  nowMs = Date.now(),
): NumberBombGame[] {
  const due = deps.chaosRepo.listDueNumberBombs(nowMs);
  const expired: NumberBombGame[] = [];
  for (const game of due) {
    const res = expireNumberBombIfDueOp(deps, game.id, nowMs);
    if (res) expired.push(res);
  }
  return expired;
}
