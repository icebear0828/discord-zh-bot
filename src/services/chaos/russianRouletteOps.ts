import { MAX_COIN_AMOUNT } from '../../config/economyConstants.js';
import type { RouletteGame } from '../../db/repositories/chaosRepo.js';
import {
  ROULETTE_RECRUIT_TTL_MS,
  ROULETTE_TURN_TTL_MS,
  type CancelRouletteResult,
  type ChaosOpsDeps,
  type CreateRouletteResult,
  type JoinRouletteResult,
  type LeaveRouletteResult,
  type PullTriggerResult,
  type StartRouletteResult,
  type TimedOutRouletteUpdate,
} from './chaosCatalogAndTypes.js';

export function shufflePlayers(players: readonly string[], rng: () => number): string[] {
  const arr = [...players];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

function expireRecruitingRouletteInTx(
  deps: ChaosOpsDeps,
  game: RouletteGame,
  nowMs: number,
): RouletteGame {
  for (const p of game.players) {
    deps.profileRepo.addCoins(game.guildId, p, game.entryFee);
  }
  const updated: RouletteGame = {
    ...game,
    status: 'cancelled',
    turnDeadline: 0,
    logs: [...game.logs, '⌛ 招募超过 10 分钟未开局，已自动解散并退还入场费。'].slice(-8),
    updatedAt: nowMs,
  };
  deps.chaosRepo.saveRoulette(updated);
  return updated;
}

export function createRouletteOp(
  deps: ChaosOpsDeps,
  input: {
    guildId: string;
    channelId: string;
    hostId: string;
    entryFee: number;
    maxPlayers?: number;
    nowMs?: number;
  },
): CreateRouletteResult {
  const entryFee = Math.floor(input.entryFee);
  const maxPlayers = Math.floor(input.maxPlayers ?? 6);
  const nowMs = input.nowMs ?? Date.now();

  if (!Number.isFinite(entryFee) || entryFee < 50 || entryFee > MAX_COIN_AMOUNT) {
    return { ok: false, reason: 'invalid_fee' };
  }
  if (!Number.isFinite(maxPlayers) || maxPlayers < 2 || maxPlayers > 6) {
    return { ok: false, reason: 'invalid_max_players' };
  }
  if (deps.creditLoanService?.isDeadbeatBlocked(input.guildId, input.hostId, nowMs).blocked) {
    return { ok: false, reason: 'deadbeat_blocked' };
  }

  return deps.db.transaction((): CreateRouletteResult => {
    const host = deps.profileRepo.getOrCreate(input.guildId, input.hostId);
    if (host.coins < entryFee) {
      return { ok: false, reason: 'insufficient_funds' };
    }
    const hostBalance = host.coins - entryFee;
    deps.profileRepo.save({ ...host, coins: hostBalance });

    const game = deps.chaosRepo.createRoulette({
      guildId: input.guildId,
      channelId: input.channelId,
      hostId: input.hostId,
      entryFee,
      maxPlayers,
      createdAt: nowMs,
      turnDeadline: nowMs + ROULETTE_RECRUIT_TTL_MS,
    });

    return { ok: true, game, hostBalance };
  })();
}

export function expireRouletteIfDueOp(
  deps: ChaosOpsDeps,
  gameId: number,
  nowMs = Date.now(),
): RouletteGame | null {
  return deps.db.transaction((): RouletteGame | null => {
    const current = deps.chaosRepo.getRouletteById(gameId);
    if (
      !current ||
      current.status !== 'recruiting' ||
      current.turnDeadline <= 0 ||
      current.turnDeadline > nowMs
    ) {
      return null;
    }
    return expireRecruitingRouletteInTx(deps, current, nowMs);
  })();
}

export function joinRouletteOp(
  deps: ChaosOpsDeps,
  gameId: number,
  userId: string,
  nowMs = Date.now(),
): JoinRouletteResult {
  return deps.db.transaction((): JoinRouletteResult => {
    const game = deps.chaosRepo.getRouletteById(gameId);
    if (!game) return { ok: false, reason: 'not_found' };
    if (game.status !== 'recruiting') return { ok: false, reason: 'not_recruiting' };
    if (game.turnDeadline > 0 && game.turnDeadline <= nowMs) {
      expireRecruitingRouletteInTx(deps, game, nowMs);
      return { ok: false, reason: 'expired' };
    }
    if (game.players.includes(userId)) return { ok: false, reason: 'already_joined' };
    if (game.players.length >= game.maxPlayers) return { ok: false, reason: 'room_full' };
    if (deps.creditLoanService?.isDeadbeatBlocked(game.guildId, userId, nowMs).blocked) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }

    const profile = deps.profileRepo.getOrCreate(game.guildId, userId);
    if (profile.coins < game.entryFee) {
      return { ok: false, reason: 'insufficient_funds' };
    }
    const balance = profile.coins - game.entryFee;
    deps.profileRepo.save({ ...profile, coins: balance });

    const players = [...game.players, userId];
    const updated: RouletteGame = {
      ...game,
      players,
      alivePlayers: [...players],
      updatedAt: nowMs,
    };
    deps.chaosRepo.saveRoulette(updated);

    return { ok: true, game: updated, balance };
  })();
}

export function leaveRouletteOp(
  deps: ChaosOpsDeps,
  gameId: number,
  userId: string,
  nowMs = Date.now(),
): LeaveRouletteResult {
  return deps.db.transaction((): LeaveRouletteResult => {
    const game = deps.chaosRepo.getRouletteById(gameId);
    if (!game) return { ok: false, reason: 'not_found' };
    if (game.status !== 'recruiting') return { ok: false, reason: 'not_recruiting' };
    if (game.turnDeadline > 0 && game.turnDeadline <= nowMs) {
      expireRecruitingRouletteInTx(deps, game, nowMs);
      return { ok: false, reason: 'expired' };
    }
    if (!game.players.includes(userId)) return { ok: false, reason: 'not_joined' };

    const remaining = game.players.filter((id) => id !== userId);
    const isHostLeaving = userId === game.hostId || remaining.length === 0;

    if (isHostLeaving) {
      for (const p of game.players) {
        deps.profileRepo.addCoins(game.guildId, p, game.entryFee);
      }
      const updated: RouletteGame = {
        ...game,
        status: 'cancelled',
        turnDeadline: 0,
        logs: [...game.logs, `房主 <@${game.hostId}> 解散了本局，已退还全部入场费。`],
        updatedAt: nowMs,
      };
      deps.chaosRepo.saveRoulette(updated);
      return { ok: true, game: updated, refunded: game.entryFee, cancelled: true };
    }

    deps.profileRepo.addCoins(game.guildId, userId, game.entryFee);
    const updated: RouletteGame = {
      ...game,
      players: remaining,
      alivePlayers: [...remaining],
      updatedAt: nowMs,
    };
    deps.chaosRepo.saveRoulette(updated);
    return { ok: true, game: updated, refunded: game.entryFee, cancelled: false };
  })();
}

export function cancelRouletteOp(
  deps: ChaosOpsDeps,
  gameId: number,
  actorId: string,
  isAdmin = false,
  nowMs = Date.now(),
): CancelRouletteResult {
  return deps.db.transaction((): CancelRouletteResult => {
    const game = deps.chaosRepo.getRouletteById(gameId);
    if (!game) return { ok: false, reason: 'not_found' };
    if (game.status !== 'recruiting') return { ok: false, reason: 'not_recruiting' };
    if (game.turnDeadline > 0 && game.turnDeadline <= nowMs) {
      expireRecruitingRouletteInTx(deps, game, nowMs);
      return { ok: false, reason: 'expired' };
    }
    if (actorId !== game.hostId && !isAdmin) return { ok: false, reason: 'no_permission' };

    for (const p of game.players) {
      deps.profileRepo.addCoins(game.guildId, p, game.entryFee);
    }
    const updated: RouletteGame = {
      ...game,
      status: 'cancelled',
      turnDeadline: 0,
      logs: [...game.logs, `<@${actorId}> 取消了轮盘招募，全部入场费已原路退回。`],
      updatedAt: nowMs,
    };
    deps.chaosRepo.saveRoulette(updated);
    return { ok: true, game: updated, refundedPlayers: game.players };
  })();
}

export function startRouletteOp(
  deps: ChaosOpsDeps,
  gameId: number,
  actorId: string,
  isAdmin = false,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): StartRouletteResult {
  return deps.db.transaction((): StartRouletteResult => {
    const game = deps.chaosRepo.getRouletteById(gameId);
    if (!game) return { ok: false, reason: 'not_found' };
    if (game.status !== 'recruiting') return { ok: false, reason: 'not_recruiting' };
    if (game.turnDeadline > 0 && game.turnDeadline <= nowMs) {
      expireRecruitingRouletteInTx(deps, game, nowMs);
      return { ok: false, reason: 'expired' };
    }
    if (actorId !== game.hostId && !isAdmin) return { ok: false, reason: 'no_permission' };
    if (game.players.length < 2) return { ok: false, reason: 'not_enough_players' };

    const alivePlayers = shufflePlayers(game.players, rng);
    const bulletPos = Math.min(5, Math.max(0, Math.floor(rng() * 6)));
    const updated: RouletteGame = {
      ...game,
      status: 'playing',
      alivePlayers,
      turnIndex: 0,
      chamberPos: 0,
      bulletPos,
      turnDeadline: nowMs + ROULETTE_TURN_TTL_MS,
      logs: [`🔫 左轮装填完成！顺位首位：<@${alivePlayers[0]}>`],
      updatedAt: nowMs,
    };
    deps.chaosRepo.saveRoulette(updated);
    return { ok: true, game: updated };
  })();
}

export function pullTriggerOp(
  deps: ChaosOpsDeps,
  gameId: number,
  actorId: string,
  opts?: { autoTimeout?: boolean; nowMs?: number; rng?: () => number },
): PullTriggerResult {
  const nowMs = opts?.nowMs ?? Date.now();
  const rng = opts?.rng ?? Math.random;
  const autoTimeout = opts?.autoTimeout ?? false;

  return deps.db.transaction((): PullTriggerResult => {
    const game = deps.chaosRepo.getRouletteById(gameId);
    if (!game) return { ok: false, reason: 'not_found' };
    if (game.status !== 'playing' || game.alivePlayers.length === 0) {
      return { ok: false, reason: 'not_playing' };
    }

    const safeIdx = game.turnIndex % game.alivePlayers.length;
    const currentId = game.alivePlayers[safeIdx]!;
    if (!autoTimeout && actorId !== currentId) {
      return { ok: false, reason: 'not_your_turn' };
    }

    const fired = game.chamberPos === game.bulletPos;
    const timeoutTag = autoTimeout ? '⌛ 超时自动代扣！' : '';

    if (fired) {
      const nextAlive = game.alivePlayers.filter((id) => id !== currentId);
      const logEntry = `${timeoutTag}<@${currentId}> 在第 ${game.chamberPos + 1} 枪 💥 **中弹淘汰**！`;
      const nextLogs = [...game.logs, logEntry].slice(-8);

      if (nextAlive.length === 1) {
        const winnerId = nextAlive[0]!;
        const prizePool = game.entryFee * game.players.length;
        deps.profileRepo.addCoins(game.guildId, winnerId, prizePool);

        if (deps.creditLoanService) {
          for (const playerId of game.players) {
            const netChange =
              playerId === winnerId ? prizePool - game.entryFee : -game.entryFee;
            deps.creditLoanService.recordGamblingResult(
              game.guildId,
              playerId,
              game.entryFee,
              netChange,
              nowMs,
            );
          }
        }

        const updated: RouletteGame = {
          ...game,
          status: 'finished',
          alivePlayers: nextAlive,
          turnIndex: 0,
          turnDeadline: 0,
          winnerId,
          logs: [...nextLogs, `🏆 <@${winnerId}> 独活到最后，独吞奖池 **${prizePool}**！`].slice(-8),
          updatedAt: nowMs,
        };
        deps.chaosRepo.saveRoulette(updated);

        return {
          ok: true,
          game: updated,
          actorId: currentId,
          autoTimeout,
          fired: true,
          eliminatedUserId: currentId,
          winnerId,
          prizePool,
        };
      }

      const nextTurnIdx = safeIdx % nextAlive.length;
      const nextBullet = Math.min(5, Math.max(0, Math.floor(rng() * 6)));
      const updated: RouletteGame = {
        ...game,
        alivePlayers: nextAlive,
        turnIndex: nextTurnIdx,
        chamberPos: 0,
        bulletPos: nextBullet,
        turnDeadline: nowMs + ROULETTE_TURN_TTL_MS,
        logs: [...nextLogs, `🔄 重新装弹，下一位：<@${nextAlive[nextTurnIdx]}>`].slice(-8),
        updatedAt: nowMs,
      };
      deps.chaosRepo.saveRoulette(updated);

      return {
        ok: true,
        game: updated,
        actorId: currentId,
        autoTimeout,
        fired: true,
        eliminatedUserId: currentId,
        winnerId: null,
        prizePool: 0,
      };
    }

    const nextTurnIdx = (safeIdx + 1) % game.alivePlayers.length;
    const logEntry = `${timeoutTag}<@${currentId}> 咔哒…空枪过关 (${game.chamberPos + 1}/6)`;
    const updated: RouletteGame = {
      ...game,
      turnIndex: nextTurnIdx,
      chamberPos: game.chamberPos + 1,
      turnDeadline: nowMs + ROULETTE_TURN_TTL_MS,
      logs: [...game.logs, logEntry].slice(-8),
      updatedAt: nowMs,
    };
    deps.chaosRepo.saveRoulette(updated);

    return {
      ok: true,
      game: updated,
      actorId: currentId,
      autoTimeout,
      fired: false,
      eliminatedUserId: null,
      winnerId: null,
      prizePool: 0,
    };
  })();
}

export function processTimedOutRoulettesOp(
  deps: ChaosOpsDeps,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): TimedOutRouletteUpdate[] {
  const due = deps.chaosRepo.listDueRoulettes(nowMs);
  const updates: TimedOutRouletteUpdate[] = [];

  for (const item of due) {
    if (item.status === 'recruiting') {
      const res = expireRouletteIfDueOp(deps, item.id, nowMs);
      if (res) updates.push({ game: res, kind: 'recruit_expired' });
    } else if (item.status === 'playing' && item.alivePlayers.length > 0) {
      const currentIdx = item.turnIndex % item.alivePlayers.length;
      const targetActor = item.alivePlayers[currentIdx]!;
      const pull = pullTriggerOp(deps, item.id, targetActor, {
        autoTimeout: true,
        nowMs,
        rng,
      });
      if (pull.ok) {
        updates.push({
          game: pull.game,
          kind: 'turn_timeout',
          fired: pull.fired,
          eliminatedUserId: pull.eliminatedUserId,
          winnerId: pull.winnerId,
          prizePool: pull.prizePool,
        });
      }
    }
  }

  return updates;
}
