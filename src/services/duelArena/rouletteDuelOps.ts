import { MAX_COIN_AMOUNT } from '../../config/economyConstants.js';
import type { DuelRouletteRecord } from '../../db/repositories/duelRepo.js';
import {
  generateArenaId,
  grantNicknameLockInTx,
  isValidRenameHours,
  isValidTimeoutMinutes,
  MAX_CUSTOM_WAGER_LEN,
  ROULETTE_1V1_INVITE_TTL_MS,
  ROULETTE_1V1_TURN_TTL_MS,
  settleCoinsAndStatsInTx,
  type AcceptRouletteDuelResult,
  type CreateRouletteDuelResult,
  type DeclineRouletteDuelResult,
  type DuelArenaDeps,
  type PullRouletteDuelResult,
  type TimedOutRouletteDuelUpdate,
} from './duelArenaTypes.js';

export function createRouletteDuelOp(
  deps: DuelArenaDeps,
  input: {
    guildId: string;
    channelId: string;
    challengerId: string;
    opponentId: string;
    bullets?: number;
    bet?: number;
    renameHours?: number;
    timeoutMinutes?: number;
    customWager?: string;
    nowMs?: number;
    ttlMs?: number;
  },
): CreateRouletteDuelResult {
  const bullets = input.bullets ?? 1;
  const bet = input.bet ?? 0;
  const renameHours = input.renameHours ?? 0;
  const timeoutMinutes = input.timeoutMinutes ?? 0;
  const customWager = (input.customWager ?? '').trim();
  const nowMs = input.nowMs ?? Date.now();

  if (input.challengerId === input.opponentId) {
    return { ok: false, reason: 'self_target' };
  }
  if (!Number.isInteger(bullets) || bullets < 1 || bullets > 3) {
    return { ok: false, reason: 'invalid_bullets' };
  }
  if (!Number.isInteger(bet) || bet < 0 || bet > MAX_COIN_AMOUNT) {
    return { ok: false, reason: 'invalid_bet' };
  }
  if (!Number.isInteger(renameHours) || !isValidRenameHours(renameHours, true)) {
    return { ok: false, reason: 'invalid_rename_hours' };
  }
  if (!Number.isInteger(timeoutMinutes) || !isValidTimeoutMinutes(timeoutMinutes)) {
    return { ok: false, reason: 'invalid_timeout_minutes' };
  }
  if (customWager.length > MAX_CUSTOM_WAGER_LEN) {
    return { ok: false, reason: 'invalid_custom_wager' };
  }
  if (bet === 0 && renameHours === 0 && timeoutMinutes === 0 && customWager.length === 0) {
    return { ok: false, reason: 'no_stake' };
  }
  if (
    bet > 0 &&
    deps.creditLoanService?.isDeadbeatBlocked(input.guildId, input.challengerId, nowMs).blocked
  ) {
    return { ok: false, reason: 'deadbeat_blocked' };
  }

  return deps.db.transaction((): CreateRouletteDuelResult => {
    const challenger = deps.profileRepo.getOrCreate(input.guildId, input.challengerId);
    if (bet > 0 && challenger.coins < bet) {
      return { ok: false, reason: 'insufficient_funds' };
    }
    const challengerBalance = challenger.coins - bet;
    if (bet > 0) {
      deps.profileRepo.save({ ...challenger, coins: challengerBalance });
    }

    const duel = deps.duelRepo.createRouletteDuel({
      id: generateArenaId('rl1'),
      guildId: input.guildId,
      channelId: input.channelId,
      challengerId: input.challengerId,
      opponentId: input.opponentId,
      bullets,
      bet,
      renameDurationMs: renameHours * 3600 * 1000,
      timeoutDurationMs: timeoutMinutes * 60 * 1000,
      customWager,
      createdAt: nowMs,
      expiresAt: nowMs + (input.ttlMs ?? ROULETTE_1V1_INVITE_TTL_MS),
    });

    return { ok: true, duel, challengerBalance };
  })();
}

export function acceptRouletteDuelOp(
  deps: DuelArenaDeps,
  duelId: string,
  acceptorId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): AcceptRouletteDuelResult {
  return deps.db.transaction((): AcceptRouletteDuelResult => {
    const duel = deps.duelRepo.getRouletteDuelById(duelId);
    if (!duel) return { ok: false, reason: 'not_found' };
    if (duel.status === 'expired') return { ok: false, reason: 'expired' };
    if (duel.status !== 'pending') return { ok: false, reason: 'already_resolved' };
    if (duel.expiresAt <= nowMs) {
      const expired: DuelRouletteRecord = { ...duel, status: 'expired', updatedAt: nowMs };
      deps.duelRepo.saveRouletteDuel(expired);
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

    const turnOrder: string[] =
      rng() < 0.5
        ? [duel.challengerId, duel.opponentId]
        : [duel.opponentId, duel.challengerId];

    const slots = [0, 1, 2, 3, 4, 5];
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = slots[i]!;
      slots[i] = slots[j]!;
      slots[j] = tmp;
    }
    const bulletPositions = slots.slice(0, duel.bullets).sort((a, b) => a - b);

    const updated: DuelRouletteRecord = {
      ...duel,
      status: 'playing',
      turnOrder,
      turnIndex: 0,
      chamberPos: 0,
      bulletPositions,
      logs: [`🔫 左轮装填 **${duel.bullets}/6** 发实弹！随机先手：<@${turnOrder[0]}>`],
      turnDeadline: nowMs + ROULETTE_1V1_TURN_TTL_MS,
      updatedAt: nowMs,
    };
    deps.duelRepo.saveRouletteDuel(updated);
    return { ok: true, duel: updated };
  })();
}

export function declineRouletteDuelOp(
  deps: DuelArenaDeps,
  duelId: string,
  actorId: string,
  nowMs = Date.now(),
): DeclineRouletteDuelResult {
  return deps.db.transaction((): DeclineRouletteDuelResult => {
    const duel = deps.duelRepo.getRouletteDuelById(duelId);
    if (!duel) return { ok: false, reason: 'not_found' };
    if (duel.status === 'expired') return { ok: false, reason: 'expired' };
    if (duel.status !== 'pending') return { ok: false, reason: 'already_resolved' };
    if (duel.expiresAt <= nowMs) {
      const expired: DuelRouletteRecord = { ...duel, status: 'expired', updatedAt: nowMs };
      deps.duelRepo.saveRouletteDuel(expired);
      if (duel.bet > 0) {
        deps.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
      }
      return { ok: false, reason: 'expired' };
    }
    if (actorId !== duel.challengerId && actorId !== duel.opponentId) {
      return { ok: false, reason: 'not_participant' };
    }

    const updated: DuelRouletteRecord = { ...duel, status: 'declined', updatedAt: nowMs };
    deps.duelRepo.saveRouletteDuel(updated);
    if (duel.bet > 0) {
      deps.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
    }
    return { ok: true, duel: updated, refunded: duel.bet };
  })();
}

export function pullRouletteDuelTriggerOp(
  deps: DuelArenaDeps,
  duelId: string,
  actorId: string,
  opts?: { autoTimeout?: boolean; nowMs?: number },
): PullRouletteDuelResult {
  const nowMs = opts?.nowMs ?? Date.now();
  const autoTimeout = opts?.autoTimeout ?? false;

  return deps.db.transaction((): PullRouletteDuelResult => {
    const duel = deps.duelRepo.getRouletteDuelById(duelId);
    if (!duel) return { ok: false, reason: 'not_found' };
    if (duel.status !== 'playing' || duel.turnOrder.length !== 2) {
      return { ok: false, reason: 'not_playing' };
    }

    const currentId = duel.turnOrder[duel.turnIndex % 2]!;
    const otherId = duel.turnOrder[(duel.turnIndex + 1) % 2]!;
    if (!autoTimeout && actorId !== currentId) {
      return { ok: false, reason: 'not_your_turn' };
    }

    const fired = duel.bulletPositions.includes(duel.chamberPos);
    const timeoutTag = autoTimeout ? '⌛ 超时自动代扣！' : '';

    if (fired) {
      const winnerId = otherId;
      const loserId = currentId;
      const bountyClaimed = settleCoinsAndStatsInTx(deps, {
        guildId: duel.guildId,
        winnerId,
        loserId,
        bet: duel.bet,
        nowMs,
      });
      grantNicknameLockInTx(deps, {
        guildId: duel.guildId,
        targetId: loserId,
        winnerId,
        sourceType: 'roulette_1v1',
        sourceId: duel.id,
        durationMs: duel.renameDurationMs,
        nowMs,
      });

      const logEntry = `${timeoutTag}<@${currentId}> 在第 ${duel.chamberPos + 1} 枪 💥 **中弹倒下**！`;
      const winLog = `🏆 <@${winnerId}> 赢得本局 1v1 俄罗斯轮盘！`;
      const updated: DuelRouletteRecord = {
        ...duel,
        status: 'completed',
        winnerId,
        loserId,
        bountyClaimed,
        turnDeadline: 0,
        logs: [...duel.logs, logEntry, winLog].slice(-8),
        updatedAt: nowMs,
      };
      deps.duelRepo.saveRouletteDuel(updated);

      return {
        ok: true,
        duel: updated,
        actorId: currentId,
        autoTimeout,
        fired: true,
        winnerId,
        loserId,
        bountyClaimed,
        renameDurationMs: duel.renameDurationMs,
        timeoutDurationMs: duel.timeoutDurationMs,
      };
    }

    const nextTurnIndex = (duel.turnIndex + 1) % 2;
    const logEntry = `${timeoutTag}<@${currentId}> 咔哒…空枪过关 (${duel.chamberPos + 1}/6)`;
    const updated: DuelRouletteRecord = {
      ...duel,
      turnIndex: nextTurnIndex,
      chamberPos: duel.chamberPos + 1,
      turnDeadline: nowMs + ROULETTE_1V1_TURN_TTL_MS,
      logs: [...duel.logs, logEntry].slice(-8),
      updatedAt: nowMs,
    };
    deps.duelRepo.saveRouletteDuel(updated);

    return {
      ok: true,
      duel: updated,
      actorId: currentId,
      autoTimeout,
      fired: false,
      winnerId: null,
      loserId: null,
      bountyClaimed: 0,
      renameDurationMs: duel.renameDurationMs,
      timeoutDurationMs: duel.timeoutDurationMs,
    };
  })();
}

export function processTimedOutRouletteDuelsOp(
  deps: DuelArenaDeps,
  nowMs = Date.now(),
): TimedOutRouletteDuelUpdate[] {
  const updates: TimedOutRouletteDuelUpdate[] = [];

  for (const pending of deps.duelRepo.listDuePendingRouletteDuels(nowMs)) {
    const res = deps.db.transaction((): TimedOutRouletteDuelUpdate | null => {
      const latest = deps.duelRepo.getRouletteDuelById(pending.id);
      if (!latest || latest.status !== 'pending' || latest.expiresAt > nowMs) {
        return null;
      }
      const updated: DuelRouletteRecord = { ...latest, status: 'expired', updatedAt: nowMs };
      deps.duelRepo.saveRouletteDuel(updated);
      if (latest.bet > 0) {
        deps.profileRepo.addCoins(latest.guildId, latest.challengerId, latest.bet);
      }
      return {
        duel: updated,
        kind: 'invite_expired',
        winnerId: null,
        loserId: null,
        bountyClaimed: 0,
        renameDurationMs: 0,
        timeoutDurationMs: 0,
      };
    })();
    if (res) updates.push(res);
  }

  for (const playing of deps.duelRepo.listDuePlayingRouletteDuels(nowMs)) {
    const latest = deps.duelRepo.getRouletteDuelById(playing.id);
    if (
      !latest ||
      latest.status !== 'playing' ||
      latest.turnDeadline <= 0 ||
      latest.turnDeadline > nowMs
    ) {
      continue;
    }
    const res = pullRouletteDuelTriggerOp(deps, latest.id, '', { autoTimeout: true, nowMs });
    if (res.ok) {
      updates.push({
        duel: res.duel,
        kind: 'turn_timeout',
        actorId: res.actorId,
        fired: res.fired,
        winnerId: res.winnerId,
        loserId: res.loserId,
        bountyClaimed: res.bountyClaimed,
        renameDurationMs: res.renameDurationMs,
        timeoutDurationMs: res.timeoutDurationMs,
      });
    }
  }

  return updates;
}
