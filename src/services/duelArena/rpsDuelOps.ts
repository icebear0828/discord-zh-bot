import { MAX_COIN_AMOUNT } from '../../config/economyConstants.js';
import type {
  RpsDuelRecord,
  RpsMove,
  RpsRoundEntry,
} from '../../db/repositories/duelRepo.js';
import {
  generateArenaId,
  grantNicknameLockInTx,
  isValidRenameHours,
  resolveRpsWinner,
  RPS_INVITE_TTL_MS,
  RPS_ROUND_TTL_MS,
  RPS_WINS_NEEDED,
  settleCoinsAndStatsInTx,
  type AcceptRpsDuelResult,
  type CreateRpsDuelResult,
  type DeclineRpsDuelResult,
  type DuelArenaDeps,
  type SubmitRpsMoveResult,
  type TimedOutRpsUpdate,
} from './duelArenaTypes.js';

export function createRpsDuelOp(
  deps: DuelArenaDeps,
  input: {
    guildId: string;
    channelId: string;
    challengerId: string;
    opponentId: string;
    renameHours?: number;
    bet?: number;
    nowMs?: number;
    ttlMs?: number;
  },
): CreateRpsDuelResult {
  const bet = input.bet ?? 0;
  const renameHours = input.renameHours ?? 24;
  const nowMs = input.nowMs ?? Date.now();

  if (input.challengerId === input.opponentId) {
    return { ok: false, reason: 'self_target' };
  }
  if (!Number.isInteger(bet) || bet < 0 || bet > MAX_COIN_AMOUNT) {
    return { ok: false, reason: 'invalid_bet' };
  }
  if (!Number.isInteger(renameHours) || !isValidRenameHours(renameHours, false)) {
    return { ok: false, reason: 'invalid_rename_hours' };
  }
  if (
    bet > 0 &&
    deps.creditLoanService?.isDeadbeatBlocked(input.guildId, input.challengerId, nowMs).blocked
  ) {
    return { ok: false, reason: 'deadbeat_blocked' };
  }

  return deps.db.transaction((): CreateRpsDuelResult => {
    const challenger = deps.profileRepo.getOrCreate(input.guildId, input.challengerId);
    if (bet > 0 && challenger.coins < bet) {
      return { ok: false, reason: 'insufficient_funds' };
    }
    const challengerBalance = challenger.coins - bet;
    if (bet > 0) {
      deps.profileRepo.save({ ...challenger, coins: challengerBalance });
    }

    const duel = deps.duelRepo.createRps({
      id: generateArenaId('rps'),
      guildId: input.guildId,
      channelId: input.channelId,
      challengerId: input.challengerId,
      opponentId: input.opponentId,
      bet,
      renameDurationMs: renameHours * 3600 * 1000,
      createdAt: nowMs,
      expiresAt: nowMs + (input.ttlMs ?? RPS_INVITE_TTL_MS),
    });

    return { ok: true, duel, challengerBalance };
  })();
}

export function acceptRpsDuelOp(
  deps: DuelArenaDeps,
  duelId: string,
  acceptorId: string,
  nowMs = Date.now(),
): AcceptRpsDuelResult {
  return deps.db.transaction((): AcceptRpsDuelResult => {
    const duel = deps.duelRepo.getRpsById(duelId);
    if (!duel) return { ok: false, reason: 'not_found' };
    if (duel.status === 'expired') return { ok: false, reason: 'expired' };
    if (duel.status !== 'pending') return { ok: false, reason: 'already_resolved' };
    if (duel.expiresAt <= nowMs) {
      const expired: RpsDuelRecord = { ...duel, status: 'expired', updatedAt: nowMs };
      deps.duelRepo.saveRps(expired);
      if (duel.bet > 0) {
        deps.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
      }
      return { ok: false, reason: 'expired' };
    }
    if (acceptorId !== duel.opponentId) {
      return { ok: false, reason: 'not_opponent' };
    }
    if (
      duel.bet > 0 &&
      (deps.creditLoanService?.isDeadbeatBlocked(duel.guildId, acceptorId, nowMs).blocked ||
        deps.creditLoanService?.isDeadbeatBlocked(duel.guildId, duel.challengerId, nowMs).blocked)
    ) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }

    if (duel.bet > 0) {
      const opponent = deps.profileRepo.getOrCreate(duel.guildId, duel.opponentId);
      if (opponent.coins < duel.bet) {
        return { ok: false, reason: 'opponent_insufficient_funds' };
      }
      deps.profileRepo.save({ ...opponent, coins: opponent.coins - duel.bet });
    }

    const updated: RpsDuelRecord = {
      ...duel,
      status: 'playing',
      roundNumber: 1,
      challengerWins: 0,
      opponentWins: 0,
      challengerMove: null,
      opponentMove: null,
      roundDeadline: nowMs + RPS_ROUND_TTL_MS,
      updatedAt: nowMs,
    };
    deps.duelRepo.saveRps(updated);
    return { ok: true, duel: updated };
  })();
}

export function declineRpsDuelOp(
  deps: DuelArenaDeps,
  duelId: string,
  actorId: string,
  nowMs = Date.now(),
): DeclineRpsDuelResult {
  return deps.db.transaction((): DeclineRpsDuelResult => {
    const duel = deps.duelRepo.getRpsById(duelId);
    if (!duel) return { ok: false, reason: 'not_found' };
    if (duel.status === 'expired') return { ok: false, reason: 'expired' };
    if (duel.status !== 'pending') return { ok: false, reason: 'already_resolved' };
    if (duel.expiresAt <= nowMs) {
      const expired: RpsDuelRecord = { ...duel, status: 'expired', updatedAt: nowMs };
      deps.duelRepo.saveRps(expired);
      if (duel.bet > 0) {
        deps.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
      }
      return { ok: false, reason: 'expired' };
    }
    if (actorId !== duel.challengerId && actorId !== duel.opponentId) {
      return { ok: false, reason: 'not_participant' };
    }

    const updated: RpsDuelRecord = { ...duel, status: 'declined', updatedAt: nowMs };
    deps.duelRepo.saveRps(updated);
    if (duel.bet > 0) {
      deps.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
    }
    return { ok: true, duel: updated, refunded: duel.bet };
  })();
}

export function submitRpsMoveOp(
  deps: DuelArenaDeps,
  duelId: string,
  userId: string,
  move: RpsMove,
  nowMs = Date.now(),
): SubmitRpsMoveResult {
  return deps.db.transaction((): SubmitRpsMoveResult => {
    const duel = deps.duelRepo.getRpsById(duelId);
    if (!duel) return { ok: false, reason: 'not_found' };
    if (duel.status !== 'playing') return { ok: false, reason: 'not_playing' };
    if (userId !== duel.challengerId && userId !== duel.opponentId) {
      return { ok: false, reason: 'not_participant' };
    }

    const isChallenger = userId === duel.challengerId;
    if (isChallenger && duel.challengerMove !== null) {
      return { ok: false, reason: 'already_moved' };
    }
    if (!isChallenger && duel.opponentMove !== null) {
      return { ok: false, reason: 'already_moved' };
    }

    const challengerMove = isChallenger ? move : duel.challengerMove;
    const opponentMove = !isChallenger ? move : duel.opponentMove;

    if (challengerMove === null || opponentMove === null) {
      const waiting: RpsDuelRecord = {
        ...duel,
        challengerMove,
        opponentMove,
        updatedAt: nowMs,
      };
      deps.duelRepo.saveRps(waiting);
      return { ok: true, duel: waiting, roundResolved: false };
    }

    const outcome = resolveRpsWinner(challengerMove, opponentMove);
    if (outcome === 'tie') {
      const entry: RpsRoundEntry = {
        round: duel.roundNumber,
        challengerMove,
        opponentMove,
        winnerId: null,
        tie: true,
      };
      const tied: RpsDuelRecord = {
        ...duel,
        challengerMove: null,
        opponentMove: null,
        history: [...duel.history, entry],
        roundDeadline: nowMs + RPS_ROUND_TTL_MS,
        updatedAt: nowMs,
      };
      deps.duelRepo.saveRps(tied);
      return {
        ok: true,
        duel: tied,
        roundResolved: true,
        roundTie: true,
        matchFinished: false,
        lastRound: entry,
      };
    }

    const roundWinnerId = outcome === 'challenger' ? duel.challengerId : duel.opponentId;
    const roundLoserId = outcome === 'challenger' ? duel.opponentId : duel.challengerId;
    const nextChallengerWins = duel.challengerWins + (outcome === 'challenger' ? 1 : 0);
    const nextOpponentWins = duel.opponentWins + (outcome === 'opponent' ? 1 : 0);
    const entry: RpsRoundEntry = {
      round: duel.roundNumber,
      challengerMove,
      opponentMove,
      winnerId: roundWinnerId,
      tie: false,
    };
    const nextHistory = [...duel.history, entry];
    const matchFinished =
      nextChallengerWins >= RPS_WINS_NEEDED || nextOpponentWins >= RPS_WINS_NEEDED;

    if (matchFinished) {
      const bountyClaimed = settleCoinsAndStatsInTx(deps, {
        guildId: duel.guildId,
        winnerId: roundWinnerId,
        loserId: roundLoserId,
        bet: duel.bet,
        nowMs,
      });
      grantNicknameLockInTx(deps, {
        guildId: duel.guildId,
        targetId: roundLoserId,
        winnerId: roundWinnerId,
        sourceType: 'rps',
        sourceId: duel.id,
        durationMs: duel.renameDurationMs,
        nowMs,
      });
      const completed: RpsDuelRecord = {
        ...duel,
        status: 'completed',
        challengerWins: nextChallengerWins,
        opponentWins: nextOpponentWins,
        challengerMove: null,
        opponentMove: null,
        history: nextHistory,
        winnerId: roundWinnerId,
        loserId: roundLoserId,
        bountyClaimed,
        roundDeadline: 0,
        updatedAt: nowMs,
      };
      deps.duelRepo.saveRps(completed);
      return {
        ok: true,
        duel: completed,
        roundResolved: true,
        roundTie: false,
        matchFinished: true,
        winnerId: roundWinnerId,
        loserId: roundLoserId,
        bountyClaimed,
        lastRound: entry,
      };
    }

    const nextRound: RpsDuelRecord = {
      ...duel,
      roundNumber: duel.roundNumber + 1,
      challengerWins: nextChallengerWins,
      opponentWins: nextOpponentWins,
      challengerMove: null,
      opponentMove: null,
      history: nextHistory,
      roundDeadline: nowMs + RPS_ROUND_TTL_MS,
      updatedAt: nowMs,
    };
    deps.duelRepo.saveRps(nextRound);
    return {
      ok: true,
      duel: nextRound,
      roundResolved: true,
      roundTie: false,
      matchFinished: false,
      lastRound: entry,
    };
  })();
}

export function processTimedOutRpsDuelsOp(
  deps: DuelArenaDeps,
  nowMs = Date.now(),
): TimedOutRpsUpdate[] {
  const updates: TimedOutRpsUpdate[] = [];

  for (const pending of deps.duelRepo.listDuePendingRps(nowMs)) {
    const res = deps.db.transaction((): TimedOutRpsUpdate | null => {
      const latest = deps.duelRepo.getRpsById(pending.id);
      if (!latest || latest.status !== 'pending' || latest.expiresAt > nowMs) {
        return null;
      }
      const updated: RpsDuelRecord = { ...latest, status: 'expired', updatedAt: nowMs };
      deps.duelRepo.saveRps(updated);
      if (latest.bet > 0) {
        deps.profileRepo.addCoins(latest.guildId, latest.challengerId, latest.bet);
      }
      return {
        duel: updated,
        kind: 'invite_expired',
        winnerId: null,
        loserId: null,
        matchFinished: false,
        bountyClaimed: 0,
      };
    })();
    if (res) updates.push(res);
  }

  for (const playing of deps.duelRepo.listDuePlayingRps(nowMs)) {
    const res = deps.db.transaction((): TimedOutRpsUpdate | null => {
      const latest = deps.duelRepo.getRpsById(playing.id);
      if (
        !latest ||
        latest.status !== 'playing' ||
        latest.roundDeadline <= 0 ||
        latest.roundDeadline > nowMs
      ) {
        return null;
      }

      const cMoved = latest.challengerMove !== null;
      const oMoved = latest.opponentMove !== null;

      if (!cMoved && !oMoved) {
        const cancelled: RpsDuelRecord = {
          ...latest,
          status: 'cancelled',
          roundDeadline: 0,
          updatedAt: nowMs,
        };
        deps.duelRepo.saveRps(cancelled);
        if (latest.bet > 0) {
          deps.profileRepo.addCoins(latest.guildId, latest.challengerId, latest.bet);
          deps.profileRepo.addCoins(latest.guildId, latest.opponentId, latest.bet);
        }
        return {
          duel: cancelled,
          kind: 'round_cancelled',
          winnerId: null,
          loserId: null,
          matchFinished: false,
          bountyClaimed: 0,
        };
      }

      const challengerWon = cMoved && !oMoved;
      const roundWinnerId = challengerWon ? latest.challengerId : latest.opponentId;
      const roundLoserId = challengerWon ? latest.opponentId : latest.challengerId;
      const nextChallengerWins = latest.challengerWins + (challengerWon ? 1 : 0);
      const nextOpponentWins = latest.opponentWins + (!challengerWon ? 1 : 0);
      const entry: RpsRoundEntry = {
        round: latest.roundNumber,
        challengerMove: latest.challengerMove,
        opponentMove: latest.opponentMove,
        winnerId: roundWinnerId,
        tie: false,
        timeoutBy: roundLoserId,
      };
      const nextHistory = [...latest.history, entry];
      const matchFinished =
        nextChallengerWins >= RPS_WINS_NEEDED || nextOpponentWins >= RPS_WINS_NEEDED;

      if (matchFinished) {
        const bountyClaimed = settleCoinsAndStatsInTx(deps, {
          guildId: latest.guildId,
          winnerId: roundWinnerId,
          loserId: roundLoserId,
          bet: latest.bet,
          nowMs,
        });
        grantNicknameLockInTx(deps, {
          guildId: latest.guildId,
          targetId: roundLoserId,
          winnerId: roundWinnerId,
          sourceType: 'rps',
          sourceId: latest.id,
          durationMs: latest.renameDurationMs,
          nowMs,
        });
        const completed: RpsDuelRecord = {
          ...latest,
          status: 'completed',
          challengerWins: nextChallengerWins,
          opponentWins: nextOpponentWins,
          challengerMove: null,
          opponentMove: null,
          history: nextHistory,
          winnerId: roundWinnerId,
          loserId: roundLoserId,
          bountyClaimed,
          roundDeadline: 0,
          updatedAt: nowMs,
        };
        deps.duelRepo.saveRps(completed);
        return {
          duel: completed,
          kind: 'round_forfeit',
          winnerId: roundWinnerId,
          loserId: roundLoserId,
          matchFinished: true,
          bountyClaimed,
        };
      }

      const nextRound: RpsDuelRecord = {
        ...latest,
        roundNumber: latest.roundNumber + 1,
        challengerWins: nextChallengerWins,
        opponentWins: nextOpponentWins,
        challengerMove: null,
        opponentMove: null,
        history: nextHistory,
        roundDeadline: nowMs + RPS_ROUND_TTL_MS,
        updatedAt: nowMs,
      };
      deps.duelRepo.saveRps(nextRound);
      return {
        duel: nextRound,
        kind: 'round_forfeit',
        winnerId: roundWinnerId,
        loserId: roundLoserId,
        matchFinished: false,
        bountyClaimed: 0,
      };
    })();
    if (res) updates.push(res);
  }

  return updates;
}
