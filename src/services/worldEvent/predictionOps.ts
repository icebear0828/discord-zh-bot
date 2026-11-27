import {
  PREDICTION_LOCKED_EXPIRE_MS,
  PREDICTION_MAX_BET,
} from '../../config/economyConstants.js';
import type { Prediction, PredictionStatus } from '../../db/repositories/worldEventRepo.js';
import {
  buildPredictionSummary,
  type CancelPredictionResult,
  type CreatePredictionResult,
  type ExpiredLockedPredictionResult,
  type LockPredictionResult,
  type PlaceBetResult,
  type PredictionPayout,
  type PredictionSummary,
  type SettlePredictionResult,
  type WorldEventOpsDeps,
} from './worldEventTypesAndCatalog.js';

export function getPredictionSummaryOp(
  deps: WorldEventOpsDeps,
  predictionId: number,
): PredictionSummary | null {
  const prediction = deps.worldEventRepo.getPredictionById(predictionId);
  if (!prediction) return null;
  const bets = deps.worldEventRepo.listBets(predictionId);
  return buildPredictionSummary(prediction, bets);
}

export function listPredictionsPaginatedOp(
  deps: WorldEventOpsDeps,
  guildId: string,
  page: number,
  pageSize: number,
  statuses: readonly PredictionStatus[] = ['open', 'locked'],
): { items: Prediction[]; total: number; page: number; totalPages: number } {
  const safePageSize = Math.max(1, Math.min(25, Math.floor(pageSize)));
  const safePage = Math.max(1, Math.floor(page));
  const offset = (safePage - 1) * safePageSize;
  const res = deps.worldEventRepo.listPredictionsPaginated(guildId, offset, safePageSize, statuses);
  const totalPages = Math.max(1, Math.ceil(res.total / safePageSize));
  if (safePage > totalPages && res.total > 0) {
    const clampedOffset = (totalPages - 1) * safePageSize;
    const clamped = deps.worldEventRepo.listPredictionsPaginated(
      guildId,
      clampedOffset,
      safePageSize,
      statuses,
    );
    return { items: clamped.items, total: clamped.total, page: totalPages, totalPages };
  }
  return { items: res.items, total: res.total, page: safePage, totalPages };
}

export function createPredictionOp(
  deps: WorldEventOpsDeps,
  input: {
    guildId: string;
    channelId: string;
    creatorId: string;
    title: string;
    options: string[];
    closeMinutes: number;
    nowMs?: number;
  },
): CreatePredictionResult {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 100) {
    return { ok: false, reason: 'invalid_title' };
  }

  const seen = new Set<string>();
  const options: string[] = [];
  for (const rawOpt of input.options) {
    const clean = rawOpt.trim();
    if (clean.length === 0 || clean.length > 40 || seen.has(clean)) continue;
    seen.add(clean);
    options.push(clean);
  }
  if (options.length < 2 || options.length > 4) {
    return { ok: false, reason: 'invalid_options' };
  }

  const closeMinutes = Math.floor(input.closeMinutes);
  if (!Number.isFinite(closeMinutes) || closeMinutes < 1 || closeMinutes > 10_080) {
    return { ok: false, reason: 'invalid_duration' };
  }

  const nowMs = input.nowMs ?? Date.now();
  const prediction = deps.worldEventRepo.createPrediction({
    guildId: input.guildId,
    channelId: input.channelId,
    creatorId: input.creatorId,
    title,
    options,
    closesAt: nowMs + closeMinutes * 60_000,
    createdAt: nowMs,
  });

  return { ok: true, summary: buildPredictionSummary(prediction, []) };
}

export function placeBetOp(
  deps: WorldEventOpsDeps,
  input: {
    predictionId: number;
    userId: string;
    optionIndex: number;
    amount: number;
    nowMs?: number;
  },
): PlaceBetResult {
  const nowMs = input.nowMs ?? Date.now();
  const cleanAmount = Math.floor(input.amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0 || cleanAmount > PREDICTION_MAX_BET) {
    return { ok: false, reason: 'invalid_amount' };
  }

  return deps.db.transaction((): PlaceBetResult => {
    const pred = deps.worldEventRepo.getPredictionById(input.predictionId);
    if (!pred) return { ok: false, reason: 'not_found' };
    if (pred.status !== 'open') return { ok: false, reason: 'not_open' };
    if (pred.closesAt <= nowMs) {
      deps.worldEventRepo.updatePredictionStatus(pred.id, 'locked', null, null, nowMs);
      return { ok: false, reason: 'closed' };
    }
    if (pred.creatorId === input.userId) {
      return { ok: false, reason: 'creator_cannot_bet' };
    }
    if (
      !Number.isInteger(input.optionIndex) ||
      input.optionIndex < 0 ||
      input.optionIndex >= pred.options.length
    ) {
      return { ok: false, reason: 'invalid_option' };
    }
    if (deps.creditLoanService?.isDeadbeatBlocked(pred.guildId, input.userId, nowMs).blocked) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }

    const profile = deps.profileRepo.getOrCreate(pred.guildId, input.userId);
    if (profile.coins < cleanAmount) {
      return { ok: false, reason: 'insufficient_funds' };
    }
    const balance = profile.coins - cleanAmount;
    deps.profileRepo.save({ ...profile, coins: balance });

    deps.worldEventRepo.addBet({
      predictionId: pred.id,
      userId: input.userId,
      optionIndex: input.optionIndex,
      amount: cleanAmount,
      createdAt: nowMs,
    });

    const bets = deps.worldEventRepo.listBets(pred.id);
    return {
      ok: true,
      summary: buildPredictionSummary(pred, bets),
      betAmount: cleanAmount,
      balance,
    };
  })();
}

export function lockPredictionOp(
  deps: WorldEventOpsDeps,
  predictionId: number,
  actorId: string,
  isAdmin = false,
  nowMs = Date.now(),
): LockPredictionResult {
  return deps.db.transaction((): LockPredictionResult => {
    const pred = deps.worldEventRepo.getPredictionById(predictionId);
    if (!pred) return { ok: false, reason: 'not_found' };
    if (actorId !== pred.creatorId && !isAdmin) return { ok: false, reason: 'no_permission' };
    if (pred.status !== 'open') return { ok: false, reason: 'invalid_status' };

    deps.worldEventRepo.updatePredictionStatus(pred.id, 'locked', null, null, nowMs);
    const updated = deps.worldEventRepo.getPredictionById(pred.id)!;
    const bets = deps.worldEventRepo.listBets(pred.id);
    return { ok: true, summary: buildPredictionSummary(updated, bets) };
  })();
}

export function lockPredictionIfDueOp(
  deps: WorldEventOpsDeps,
  predictionId: number,
  nowMs = Date.now(),
): PredictionSummary | null {
  return deps.db.transaction((): PredictionSummary | null => {
    const pred = deps.worldEventRepo.getPredictionById(predictionId);
    if (!pred || pred.status !== 'open' || pred.closesAt > nowMs) {
      return null;
    }
    deps.worldEventRepo.updatePredictionStatus(pred.id, 'locked', null, null, nowMs);
    const updated = deps.worldEventRepo.getPredictionById(pred.id);
    if (!updated) return null;
    const bets = deps.worldEventRepo.listBets(updated.id);
    return buildPredictionSummary(updated, bets);
  })();
}

export function settlePredictionOp(
  deps: WorldEventOpsDeps,
  predictionId: number,
  actorId: string,
  isAdmin: boolean,
  winningOption: number,
  nowMs = Date.now(),
): SettlePredictionResult {
  return deps.db.transaction((): SettlePredictionResult => {
    const pred = deps.worldEventRepo.getPredictionById(predictionId);
    if (!pred) return { ok: false, reason: 'not_found' };
    if (actorId !== pred.creatorId && !isAdmin) return { ok: false, reason: 'no_permission' };
    if (pred.status === 'open') {
      return { ok: false, reason: 'not_locked' };
    }
    if (pred.status !== 'locked') {
      return { ok: false, reason: 'invalid_status' };
    }
    if (
      !Number.isInteger(winningOption) ||
      winningOption < 0 ||
      winningOption >= pred.options.length
    ) {
      return { ok: false, reason: 'invalid_option' };
    }

    const bets = deps.worldEventRepo.listBets(pred.id);
    let totalPool = 0;
    const stakesAll = new Map<string, number>();
    const winningStakes = new Map<string, number>();
    let winningTotal = 0;

    for (const bet of bets) {
      totalPool += bet.amount;
      stakesAll.set(bet.userId, (stakesAll.get(bet.userId) ?? 0) + bet.amount);
      if (bet.optionIndex === winningOption) {
        winningTotal += bet.amount;
        winningStakes.set(bet.userId, (winningStakes.get(bet.userId) ?? 0) + bet.amount);
      }
    }

    const payouts: PredictionPayout[] = [];
    let refundedNoWinner = false;

    if (totalPool > 0 && winningTotal === 0) {
      refundedNoWinner = true;
      for (const [userId, stake] of stakesAll) {
        deps.profileRepo.addCoins(pred.guildId, userId, stake);
        payouts.push({ userId, amount: stake });
      }
    } else if (totalPool > 0 && winningTotal > 0) {
      const sortedWinners = [...winningStakes.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      );
      let distributed = 0;
      const mutableShares = sortedWinners.map(([userId, stake]) => {
        const share = Math.floor((stake * totalPool) / winningTotal);
        distributed += share;
        return { userId, amount: share };
      });

      let remainder = totalPool - distributed;
      let idx = 0;
      while (remainder > 0 && mutableShares.length > 0) {
        const entry = mutableShares[idx % mutableShares.length]!;
        entry.amount += 1;
        remainder -= 1;
        idx += 1;
      }

      for (const entry of mutableShares) {
        if (entry.amount > 0) {
          deps.profileRepo.addCoins(pred.guildId, entry.userId, entry.amount);
          payouts.push(entry);
        }
      }

      if (deps.creditLoanService) {
        const payoutMap = new Map<string, number>();
        for (const entry of payouts) {
          payoutMap.set(entry.userId, (payoutMap.get(entry.userId) ?? 0) + entry.amount);
        }
        for (const [userId, stake] of stakesAll) {
          const received = payoutMap.get(userId) ?? 0;
          deps.creditLoanService.recordGamblingResult(
            pred.guildId,
            userId,
            stake,
            received - stake,
            nowMs,
          );
        }
      }
    }

    deps.worldEventRepo.updatePredictionStatus(pred.id, 'settled', winningOption, nowMs);
    const updated = deps.worldEventRepo.getPredictionById(pred.id)!;

    return {
      ok: true,
      summary: buildPredictionSummary(updated, bets),
      winningOption,
      totalPool,
      refundedNoWinner,
      payouts,
    };
  })();
}

export function cancelPredictionOp(
  deps: WorldEventOpsDeps,
  predictionId: number,
  actorId: string,
  isAdmin = false,
  nowMs = Date.now(),
): CancelPredictionResult {
  return deps.db.transaction((): CancelPredictionResult => {
    const pred = deps.worldEventRepo.getPredictionById(predictionId);
    if (!pred) return { ok: false, reason: 'not_found' };
    if (actorId !== pred.creatorId && !isAdmin) return { ok: false, reason: 'no_permission' };
    if (pred.status !== 'open' && pred.status !== 'locked') {
      return { ok: false, reason: 'invalid_status' };
    }

    const bets = deps.worldEventRepo.listBets(pred.id);
    const totals = new Map<string, number>();
    for (const bet of bets) {
      totals.set(bet.userId, (totals.get(bet.userId) ?? 0) + bet.amount);
    }
    const refunds: PredictionPayout[] = [];
    for (const [userId, amount] of totals) {
      deps.profileRepo.addCoins(pred.guildId, userId, amount);
      refunds.push({ userId, amount });
    }

    deps.worldEventRepo.updatePredictionStatus(pred.id, 'cancelled', null, nowMs);
    const updated = deps.worldEventRepo.getPredictionById(pred.id)!;
    return { ok: true, summary: buildPredictionSummary(updated, bets), refunds };
  })();
}

export function autoLockDuePredictionsOp(
  deps: WorldEventOpsDeps,
  nowMs = Date.now(),
): PredictionSummary[] {
  const due = deps.worldEventRepo.listDueOpenPredictions(nowMs);
  const locked: PredictionSummary[] = [];
  for (const pred of due) {
    const res = lockPredictionIfDueOp(deps, pred.id, nowMs);
    if (res) locked.push(res);
  }
  return locked;
}

export function expireDueLockedPredictionsOp(
  deps: WorldEventOpsDeps,
  nowMs = Date.now(),
): ExpiredLockedPredictionResult[] {
  const cutoff = nowMs - PREDICTION_LOCKED_EXPIRE_MS;
  const due = deps.worldEventRepo.listDueLockedPredictions(cutoff);
  const results: ExpiredLockedPredictionResult[] = [];

  for (const item of due) {
    const res = deps.db.transaction((): ExpiredLockedPredictionResult | null => {
      const current = deps.worldEventRepo.getPredictionById(item.id);
      if (!current || current.status !== 'locked') return null;
      const lockRef = current.lockedAt > 0 ? current.lockedAt : current.closesAt;
      if (lockRef > cutoff) return null;

      const bets = deps.worldEventRepo.listBets(current.id);
      const totals = new Map<string, number>();
      for (const bet of bets) {
        totals.set(bet.userId, (totals.get(bet.userId) ?? 0) + bet.amount);
      }
      const refunds: PredictionPayout[] = [];
      for (const [userId, amount] of totals) {
        deps.profileRepo.addCoins(current.guildId, userId, amount);
        refunds.push({ userId, amount });
      }

      deps.worldEventRepo.updatePredictionStatus(current.id, 'cancelled', null, nowMs);
      const updated = deps.worldEventRepo.getPredictionById(current.id)!;
      return { summary: buildPredictionSummary(updated, bets), refunds };
    })();
    if (res) results.push(res);
  }

  return results;
}
