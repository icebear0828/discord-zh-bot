import type {
  RpgCharacter,
  RpgDuel,
  RpgDuelRulesMode,
} from '../../db/repositories/rpgRepo.js';
import { getDateKey } from '../economyService.js';
import { simulateRpgBattle } from '../rpgCombatEngine.js';
import { getArenaTierLabel } from './rpgPureMath.js';
import {
  DAILY_ARENA_FIGHTS,
  MAX_RPG_DUEL_BET,
  PUBLIC_DUEL_TTL_MS,
  type AcceptPublicDuelResult,
  type ArenaDailyRewardPreview,
  type CancelPublicDuelResult,
  type ChallengeArenaResult,
  type ClaimDailyArenaRewardResult,
  type CreatePublicDuelResult,
  type RpgOpsContext,
} from './rpgTypesAndConfig.js';

export function previewDailyArenaReward(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): ArenaDailyRewardPreview {
  const character = ctx.db.transaction(() => ctx.getOrCreateCharacterInTx(guildId, userId, nowMs))();
  const today = getDateKey(nowMs, ctx.timezone);
  const claimedToday = character.arenaRewardDate === today;
  const rating = character.arenaRating;
  const coins = Math.round(2500 + Math.max(0, rating - 800) * 4);
  const dust = Math.max(8, Math.round(8 + Math.max(0, rating - 900) / 50));
  const fightsUsed = character.arenaFightsToday;
  const fightsRemaining = Math.max(0, DAILY_ARENA_FIGHTS - fightsUsed);
  return {
    canClaim: character.classSelected && !claimedToday,
    claimedToday,
    rating,
    tierLabel: getArenaTierLabel(rating),
    coins,
    dust,
    fightsUsed,
    fightsRemaining,
  };
}

export function challengeArenaOpponent(
  ctx: RpgOpsContext,
  guildId: string,
  actorId: string,
  targetId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): ChallengeArenaResult {
  if (actorId === targetId) {
    return { ok: false, reason: 'self_target' };
  }

  return ctx.db.transaction((): ChallengeArenaResult => {
    const actor = ctx.getOrCreateCharacterInTx(guildId, actorId, nowMs);
    if (!actor.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }
    if (actor.arenaFightsToday >= DAILY_ARENA_FIGHTS) {
      return {
        ok: false,
        reason: 'daily_limit_reached',
        dailyLimit: DAILY_ARENA_FIGHTS,
      };
    }

    const target = ctx.rpgRepo.getCharacter(guildId, targetId);
    if (!target || !target.classSelected) {
      return { ok: false, reason: 'target_not_found' };
    }

    const left = ctx.buildCombatantForCharacter(actor);
    const right = ctx.buildCombatantForCharacter(target);
    const report = simulateRpgBattle(left, right, { mode: 'full', rng });

    const ratingBefore = actor.arenaRating;
    const expected = 1 / (1 + Math.pow(10, (target.arenaRating - ratingBefore) / 400));
    const won = report.winner === 'left';

    let ratingDelta: number;
    if (won) {
      ratingDelta = Math.max(15, Math.min(32, Math.round(15 + (1 - expected) * 17)));
    } else {
      ratingDelta = -Math.max(15, Math.min(32, Math.round(15 + expected * 17)));
    }
    const ratingAfter = Math.max(600, ratingBefore + ratingDelta);

    const rawCoins = won ? Math.round(1800 + ratingBefore * 1.5) : 500;
    const dustEarned = won ? 10 + Math.floor(Math.max(0, ratingBefore - 1000) / 200) * 2 : 4;

    const coinRes = ctx.applyCoinRewardInTx(
      guildId,
      actorId,
      rawCoins,
      won ? 'rpg_arena_win' : 'rpg_arena_consolation',
      nowMs,
    );

    const updatedActor: RpgCharacter = {
      ...actor,
      arenaRating: ratingAfter,
      arenaFightsToday: actor.arenaFightsToday + 1,
      arcaneDust: actor.arcaneDust + dustEarned,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updatedActor);

    return {
      ok: true,
      won,
      winner: report.winner,
      ratingBefore,
      ratingAfter,
      ratingDelta,
      fightsUsed: updatedActor.arenaFightsToday,
      fightsRemaining: Math.max(0, DAILY_ARENA_FIGHTS - updatedActor.arenaFightsToday),
      grossCoins: coinRes.grossCoins,
      garnishedCoins: coinRes.garnishedCoins,
      netCoins: coinRes.netCoins,
      dustEarned,
      report,
      highlights: report.highlights,
      character: updatedActor,
      targetCharacter: target,
      balance: coinRes.balance,
    };
  })();
}

export function claimDailyArenaReward(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): ClaimDailyArenaRewardResult {
  return ctx.db.transaction((): ClaimDailyArenaRewardResult => {
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    if (!character.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }

    const today = getDateKey(nowMs, ctx.timezone);
    if (character.arenaRewardDate === today) {
      return { ok: false, reason: 'already_claimed' };
    }

    const rating = character.arenaRating;
    const rawCoins = Math.round(2500 + Math.max(0, rating - 800) * 4);
    const dustEarned = Math.max(8, Math.round(8 + Math.max(0, rating - 900) / 50));

    const coinRes = ctx.applyCoinRewardInTx(
      guildId,
      userId,
      rawCoins,
      'rpg_arena_daily_reward',
      nowMs,
    );

    const updatedChar: RpgCharacter = {
      ...character,
      arenaRewardDate: today,
      arcaneDust: character.arcaneDust + dustEarned,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updatedChar);

    return {
      ok: true,
      rating,
      tierLabel: getArenaTierLabel(rating),
      grossCoins: coinRes.grossCoins,
      garnishedCoins: coinRes.garnishedCoins,
      netCoins: coinRes.netCoins,
      dustEarned,
      character: updatedChar,
      balance: coinRes.balance,
    };
  })();
}

export function createPublicDuel(
  ctx: RpgOpsContext,
  input: {
    guildId: string;
    channelId: string;
    challengerId: string;
    opponentId?: string | null;
    rulesMode: RpgDuelRulesMode;
    betAmount: number;
    nowMs?: number;
  },
): CreatePublicDuelResult {
  const nowMs = input.nowMs ?? Date.now();
  const opponentId = input.opponentId?.trim() || null;
  if (opponentId && opponentId === input.challengerId) {
    return { ok: false, reason: 'self_target' };
  }

  if (
    typeof input.betAmount !== 'number' ||
    !Number.isFinite(input.betAmount) ||
    !Number.isInteger(input.betAmount) ||
    input.betAmount < 0 ||
    input.betAmount > MAX_RPG_DUEL_BET
  ) {
    return { ok: false, reason: 'invalid_bet_amount' };
  }
  const betAmount = input.betAmount;

  return ctx.db.transaction((): CreatePublicDuelResult => {
    const character = ctx.getOrCreateCharacterInTx(input.guildId, input.challengerId, nowMs);
    if (!character.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }

    if (ctx.rpgRepo.getPendingDuelForUser(input.guildId, input.challengerId)) {
      return { ok: false, reason: 'pending_duel_exists' };
    }

    const profile = ctx.profileRepo.getOrCreate(input.guildId, input.challengerId);
    let nextBalance = profile.coins;

    if (betAmount > 0) {
      if (ctx.checkGamblingBlocked(input.guildId, input.challengerId, nowMs)) {
        return { ok: false, reason: 'deadbeat_blocked' };
      }
      if (profile.coins < betAmount) {
        return {
          ok: false,
          reason: 'insufficient_funds',
          required: betAmount,
          available: profile.coins,
        };
      }
      nextBalance = profile.coins - betAmount;
      ctx.profileRepo.save({ ...profile, coins: nextBalance });
    }

    const duel = ctx.rpgRepo.createDuel({
      guildId: input.guildId,
      channelId: input.channelId,
      challengerId: input.challengerId,
      opponentId,
      rulesMode: input.rulesMode,
      betAmount,
      createdAt: nowMs,
      expiresAt: nowMs + PUBLIC_DUEL_TTL_MS,
    });

    return { ok: true, duel, character, balance: nextBalance };
  })();
}

export function cancelPublicDuelAndRefund(
  ctx: RpgOpsContext,
  duelId: number,
  actorIdOrSystem: string | null = null,
  nowMs = Date.now(),
): CancelPublicDuelResult {
  return ctx.db.transaction((): CancelPublicDuelResult => {
    const duel = ctx.rpgRepo.getDuelById(duelId);
    if (!duel) {
      return { ok: false, reason: 'not_found' };
    }
    if (duel.status !== 'pending') {
      return { ok: false, reason: 'already_resolved' };
    }
    if (actorIdOrSystem !== null && actorIdOrSystem !== duel.challengerId) {
      return { ok: false, reason: 'not_challenger' };
    }

    const refundedBet = duel.betAmount;
    const updatedProfile =
      refundedBet > 0
        ? ctx.profileRepo.addCoins(duel.guildId, duel.challengerId, refundedBet)
        : ctx.profileRepo.getOrCreate(duel.guildId, duel.challengerId);

    const cancelled: RpgDuel = {
      ...duel,
      status: 'cancelled',
      resultSummary:
        actorIdOrSystem === null
          ? '公屏战书发送失败，已自动撤回并全额退还押注。'
          : '发起人已撤回战书，托管押注已全额退回。',
      resolvedAt: nowMs,
    };
    ctx.rpgRepo.saveDuel(cancelled);

    return {
      ok: true,
      duel: cancelled,
      refundedBet,
      balance: updatedProfile.coins,
    };
  })();
}

export function acceptPublicDuel(
  ctx: RpgOpsContext,
  duelId: number,
  acceptorId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): AcceptPublicDuelResult {
  return ctx.db.transaction((): AcceptPublicDuelResult => {
    const duel = ctx.rpgRepo.getDuelById(duelId);
    if (!duel) {
      return { ok: false, reason: 'not_found' };
    }
    if (duel.status !== 'pending') {
      return { ok: false, reason: 'already_resolved' };
    }
    if (duel.expiresAt <= nowMs) {
      if (duel.betAmount > 0) {
        ctx.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.betAmount);
      }
      ctx.rpgRepo.saveDuel({
        ...duel,
        status: 'expired',
        resultSummary: '战书已逾时失效，托管押注已退还发起人。',
        resolvedAt: nowMs,
      });
      return { ok: false, reason: 'expired' };
    }
    if (acceptorId === duel.challengerId) {
      return { ok: false, reason: 'own_duel' };
    }
    if (duel.opponentId !== null && duel.opponentId !== acceptorId) {
      return {
        ok: false,
        reason: 'wrong_opponent',
        expectedOpponentId: duel.opponentId,
      };
    }

    const acceptorChar = ctx.getOrCreateCharacterInTx(duel.guildId, acceptorId, nowMs);
    if (!acceptorChar.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }

    const challengerChar = ctx.rpgRepo.getCharacter(duel.guildId, duel.challengerId);
    if (!challengerChar || !challengerChar.classSelected) {
      return { ok: false, reason: 'challenger_unavailable' };
    }

    const betAmount = duel.betAmount;
    if (betAmount > 0) {
      if (ctx.checkGamblingBlocked(duel.guildId, acceptorId, nowMs)) {
        return { ok: false, reason: 'deadbeat_blocked' };
      }
      const acceptorProfile = ctx.profileRepo.getOrCreate(duel.guildId, acceptorId);
      if (acceptorProfile.coins < betAmount) {
        return {
          ok: false,
          reason: 'insufficient_funds',
          required: betAmount,
          available: acceptorProfile.coins,
        };
      }
      ctx.profileRepo.save({
        ...acceptorProfile,
        coins: acceptorProfile.coins - betAmount,
      });
    }

    const left = ctx.buildCombatantForCharacter(challengerChar);
    const right = ctx.buildCombatantForCharacter(acceptorChar);
    const report = simulateRpgBattle(left, right, { mode: duel.rulesMode, rng });

    let winnerId: string | null = null;
    let winnerPayout = 0;

    if (report.winner === 'draw') {
      if (betAmount > 0) {
        ctx.profileRepo.addCoins(duel.guildId, duel.challengerId, betAmount);
        ctx.profileRepo.addCoins(duel.guildId, acceptorId, betAmount);
      }
    } else {
      winnerId = report.winner === 'left' ? duel.challengerId : acceptorId;
      const loserId = report.winner === 'left' ? acceptorId : duel.challengerId;
      if (betAmount > 0) {
        winnerPayout = betAmount * 2;
        ctx.profileRepo.addCoins(duel.guildId, winnerId, winnerPayout);
        ctx.emitGamblingResult(duel.guildId, winnerId, betAmount, betAmount, nowMs);
        ctx.emitGamblingResult(duel.guildId, loserId, betAmount, -betAmount, nowMs);
      }
    }

    const modeLabel = duel.rulesMode === 'equalized' ? '⚖️ 同阶拉平局' : '🔥 满配神装局';
    const resultSummary =
      winnerId === null
        ? `🤝 ${modeLabel}鏖战 ${report.roundsPlayed} 回合握手言和${betAmount > 0 ? `，双方押注 ${betAmount.toLocaleString()} 已全额退回` : ''}！`
        : `🏆 ${modeLabel}第 ${report.roundsPlayed} 回合分出胜负：<@${winnerId}> 获胜（评级 ${report.rating}）${betAmount > 0 ? `，独揽奖池 ${winnerPayout.toLocaleString()}！` : '！'}`;

    const settledDuel: RpgDuel = {
      ...duel,
      opponentId: acceptorId,
      status: 'completed',
      winnerId,
      resultSummary,
      highlights: report.highlights,
      resolvedAt: nowMs,
    };
    ctx.rpgRepo.saveDuel(settledDuel);

    const challengerBalance = ctx.profileRepo.getOrCreate(duel.guildId, duel.challengerId).coins;
    const acceptorBalance = ctx.profileRepo.getOrCreate(duel.guildId, acceptorId).coins;

    return {
      ok: true,
      duel: settledDuel,
      report,
      winnerId,
      betAmount,
      winnerPayout,
      challengerBalance,
      acceptorBalance,
    };
  })();
}

export function expireDuePublicDuels(ctx: RpgOpsContext, nowMs = Date.now()): RpgDuel[] {
  const due = ctx.rpgRepo.listDuePendingDuels(nowMs);
  const expired: RpgDuel[] = [];
  for (const candidate of due) {
    const settled = ctx.db.transaction((): RpgDuel | null => {
      const duel = ctx.rpgRepo.getDuelById(candidate.id);
      if (!duel || duel.status !== 'pending' || duel.expiresAt > nowMs) {
        return null;
      }
      if (duel.betAmount > 0) {
        ctx.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.betAmount);
      }
      const next: RpgDuel = {
        ...duel,
        status: 'expired',
        resultSummary: '战书逾时无人应战，已自动撤回并全额退还托管押注。',
        resolvedAt: nowMs,
      };
      ctx.rpgRepo.saveDuel(next);
      return next;
    })();
    if (settled) {
      expired.push(settled);
    }
  }
  return expired;
}
