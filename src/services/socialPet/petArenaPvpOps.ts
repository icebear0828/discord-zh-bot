import {
  MAX_COIN_AMOUNT,
  PET_PVP_COOLDOWN_MS,
  PET_PVP_DAILY_XP_CAP,
} from '../../config/economyConstants.js';
import type { PetBattle } from '../../db/repositories/socialPetRepo.js';
import { getDateKey } from '../economyService.js';
import { applyPetXp, simulatePetBattle } from './petMathAndBattleSim.js';
import {
  PET_BATTLE_TTL_MS,
  type AcceptPetBattleResult,
  type CreatePetBattleResult,
  type DeclinePetBattleResult,
  type SocialPetOpsDeps,
} from './socialPetCatalogAndTypes.js';

export interface PetArenaState {
  lastPaidPvpAt: Map<string, number>;
}

function getPaidPvpCooldownSec(
  state: PetArenaState,
  guildId: string,
  userId: string,
  nowMs: number,
): number {
  const last = state.lastPaidPvpAt.get(`${guildId}:${userId}`) ?? 0;
  if (last > 0 && nowMs - last < PET_PVP_COOLDOWN_MS) {
    return Math.ceil((PET_PVP_COOLDOWN_MS - (nowMs - last)) / 1000);
  }
  return 0;
}

export function createPetBattleOp(
  deps: SocialPetOpsDeps,
  state: PetArenaState,
  input: {
    guildId: string;
    channelId: string;
    challengerId: string;
    opponentId: string | null;
    bet: number;
    nowMs?: number;
  },
): CreatePetBattleResult {
  if (input.opponentId && input.opponentId === input.challengerId) {
    return { ok: false, reason: 'self_target' };
  }
  const bet = Math.floor(input.bet);
  if (!Number.isFinite(bet) || bet < 0 || bet > MAX_COIN_AMOUNT) {
    return { ok: false, reason: 'invalid_bet' };
  }
  const nowMs = input.nowMs ?? Date.now();
  if (
    bet > 0 &&
    deps.creditLoanService?.isDeadbeatBlocked(input.guildId, input.challengerId, nowMs).blocked
  ) {
    return { ok: false, reason: 'deadbeat_blocked' };
  }

  if (bet > 0) {
    const cdSec = getPaidPvpCooldownSec(state, input.guildId, input.challengerId, nowMs);
    if (cdSec > 0) {
      return { ok: false, reason: 'pvp_cooldown', retryAfterSec: cdSec };
    }
  }

  return deps.db.transaction((): CreatePetBattleResult => {
    const activePet = deps.socialPetRepo.getActivePet(input.guildId, input.challengerId);
    if (!activePet) {
      return { ok: false, reason: 'no_active_pet' };
    }
    const profile = deps.profileRepo.getOrCreate(input.guildId, input.challengerId);
    if (profile.coins < bet) {
      return { ok: false, reason: 'insufficient_funds' };
    }

    const challengerBalance = profile.coins - bet;
    if (bet > 0) {
      deps.profileRepo.save({ ...profile, coins: challengerBalance });
    }

    const battle = deps.socialPetRepo.createPetBattle({
      guildId: input.guildId,
      channelId: input.channelId,
      challengerId: input.challengerId,
      challengerPetId: activePet.id,
      opponentId: input.opponentId,
      bet,
      createdAt: nowMs,
      expiresAt: nowMs + PET_BATTLE_TTL_MS,
    });

    return { ok: true, battle, challengerPet: activePet, challengerBalance };
  })();
}

export function acceptPetBattleOp(
  deps: SocialPetOpsDeps,
  state: PetArenaState,
  battleId: number,
  acceptorId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): AcceptPetBattleResult {
  return deps.db.transaction((): AcceptPetBattleResult => {
    const battle = deps.socialPetRepo.getPetBattleById(battleId);
    if (!battle) return { ok: false, reason: 'not_found' };
    if (battle.status === 'expired') return { ok: false, reason: 'expired' };
    if (battle.status !== 'pending') return { ok: false, reason: 'already_resolved' };
    if (battle.expiresAt <= nowMs) {
      deps.socialPetRepo.savePetBattle({ ...battle, status: 'expired' });
      if (battle.bet > 0) {
        deps.profileRepo.addCoins(battle.guildId, battle.challengerId, battle.bet);
      }
      return { ok: false, reason: 'expired' };
    }

    if (acceptorId === battle.challengerId) {
      return { ok: false, reason: 'cannot_accept_self' };
    }
    if (battle.opponentId && acceptorId !== battle.opponentId) {
      return { ok: false, reason: 'not_opponent' };
    }
    if (
      battle.bet > 0 &&
      (deps.creditLoanService?.isDeadbeatBlocked(battle.guildId, acceptorId, nowMs).blocked ||
        deps.creditLoanService?.isDeadbeatBlocked(battle.guildId, battle.challengerId, nowMs)
          .blocked)
    ) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }

    if (battle.bet > 0) {
      const acceptorCd = getPaidPvpCooldownSec(state, battle.guildId, acceptorId, nowMs);
      if (acceptorCd > 0) {
        return { ok: false, reason: 'pvp_cooldown', retryAfterSec: acceptorCd };
      }
      const challengerCd = getPaidPvpCooldownSec(
        state,
        battle.guildId,
        battle.challengerId,
        nowMs,
      );
      if (challengerCd > 0) {
        return { ok: false, reason: 'pvp_cooldown', retryAfterSec: challengerCd };
      }
    }

    const challengerPet = deps.socialPetRepo.getPetById(battle.challengerPetId);
    if (!challengerPet || challengerPet.ownerId !== battle.challengerId) {
      return { ok: false, reason: 'challenger_no_pet' };
    }

    const opponentPet = deps.socialPetRepo.getActivePet(battle.guildId, acceptorId);
    if (!opponentPet) {
      return { ok: false, reason: 'no_active_pet' };
    }

    const challengerProfile = deps.profileRepo.getOrCreate(battle.guildId, battle.challengerId);
    const opponentProfile = deps.profileRepo.getOrCreate(battle.guildId, acceptorId);
    if (opponentProfile.coins < battle.bet) {
      return { ok: false, reason: 'opponent_insufficient_funds' };
    }

    const sim = simulatePetBattle(challengerPet, opponentPet, rng);

    if (sim.draw) {
      const challengerBalance = challengerProfile.coins + battle.bet;
      const opponentBalance = opponentProfile.coins;
      if (battle.bet > 0) {
        deps.profileRepo.save({ ...challengerProfile, coins: challengerBalance });
        state.lastPaidPvpAt.set(`${battle.guildId}:${battle.challengerId}`, nowMs);
        state.lastPaidPvpAt.set(`${battle.guildId}:${acceptorId}`, nowMs);
      }

      const updatedBattle: PetBattle = {
        ...battle,
        opponentId: acceptorId,
        opponentPetId: opponentPet.id,
        status: 'completed',
        winnerId: null,
        logs: sim.logs,
      };
      deps.socialPetRepo.savePetBattle(updatedBattle);

      return {
        ok: true,
        battle: updatedBattle,
        challengerPet,
        opponentPet,
        draw: true,
        winnerId: null,
        loserId: null,
        winnerPet: null,
        loserPet: null,
        challengerXpGained: 0,
        opponentXpGained: 0,
        challengerBalance,
        opponentBalance,
      };
    }

    const challengerWon = sim.winnerSide === 'challenger';
    const winnerId = challengerWon ? battle.challengerId : acceptorId;
    const loserId = challengerWon ? acceptorId : battle.challengerId;

    // Challenger's bet was already pre-deducted/frozen at createPetBattle.
    // Winner receives bet * 2; opponent pays bet on accept.
    const challengerBalance = challengerProfile.coins + (challengerWon ? battle.bet * 2 : 0);
    const opponentBalance = opponentProfile.coins + (challengerWon ? -battle.bet : battle.bet);

    let cXp = 0;
    let oXp = 0;
    let nextChallengerProfile = { ...challengerProfile, coins: challengerBalance };
    let nextOpponentProfile = { ...opponentProfile, coins: opponentBalance };

    if (battle.bet > 0) {
      const today = getDateKey(nowMs, deps.timezone);
      const cUsed =
        challengerProfile.petPvpXpDate === today ? challengerProfile.petPvpXpDaily : 0;
      const oUsed = opponentProfile.petPvpXpDate === today ? opponentProfile.petPvpXpDaily : 0;
      const rawCXp = challengerWon ? 30 : 12;
      const rawOXp = challengerWon ? 12 : 30;
      cXp = Math.min(rawCXp, Math.max(0, PET_PVP_DAILY_XP_CAP - cUsed));
      oXp = Math.min(rawOXp, Math.max(0, PET_PVP_DAILY_XP_CAP - oUsed));

      nextChallengerProfile = {
        ...nextChallengerProfile,
        petPvpXpDate: today,
        petPvpXpDaily: cUsed + cXp,
      };
      nextOpponentProfile = {
        ...nextOpponentProfile,
        petPvpXpDate: today,
        petPvpXpDaily: oUsed + oXp,
      };

      deps.profileRepo.save(nextChallengerProfile);
      deps.profileRepo.save(nextOpponentProfile);
      state.lastPaidPvpAt.set(`${battle.guildId}:${battle.challengerId}`, nowMs);
      state.lastPaidPvpAt.set(`${battle.guildId}:${acceptorId}`, nowMs);
      deps.creditLoanService?.recordGamblingResult(
        battle.guildId,
        winnerId,
        battle.bet,
        battle.bet,
        nowMs,
      );
      deps.creditLoanService?.recordGamblingResult(
        battle.guildId,
        loserId,
        battle.bet,
        -battle.bet,
        nowMs,
      );
    }

    const nextChallengerPet = applyPetXp(
      {
        ...challengerPet,
        wins: challengerPet.wins + (challengerWon ? 1 : 0),
        losses: challengerPet.losses + (challengerWon ? 0 : 1),
      },
      cXp,
    ).updatedPet;
    const nextOpponentPet = applyPetXp(
      {
        ...opponentPet,
        wins: opponentPet.wins + (challengerWon ? 0 : 1),
        losses: opponentPet.losses + (challengerWon ? 1 : 0),
      },
      oXp,
    ).updatedPet;

    deps.socialPetRepo.savePet(nextChallengerPet);
    deps.socialPetRepo.savePet(nextOpponentPet);

    const updatedBattle: PetBattle = {
      ...battle,
      opponentId: acceptorId,
      opponentPetId: opponentPet.id,
      status: 'completed',
      winnerId,
      logs: sim.logs,
    };
    deps.socialPetRepo.savePetBattle(updatedBattle);

    return {
      ok: true,
      battle: updatedBattle,
      challengerPet: nextChallengerPet,
      opponentPet: nextOpponentPet,
      draw: false,
      winnerId,
      loserId,
      winnerPet: challengerWon ? nextChallengerPet : nextOpponentPet,
      loserPet: challengerWon ? nextOpponentPet : nextChallengerPet,
      challengerXpGained: cXp,
      opponentXpGained: oXp,
      challengerBalance,
      opponentBalance,
    };
  })();
}

export function declinePetBattleOp(
  deps: SocialPetOpsDeps,
  battleId: number,
  actorId: string,
  nowMs = Date.now(),
): DeclinePetBattleResult {
  return deps.db.transaction((): DeclinePetBattleResult => {
    const battle = deps.socialPetRepo.getPetBattleById(battleId);
    if (!battle) return { ok: false, reason: 'not_found' };
    if (battle.status === 'expired') return { ok: false, reason: 'expired' };
    if (battle.status !== 'pending') return { ok: false, reason: 'already_resolved' };
    if (battle.expiresAt <= nowMs) {
      const updated: PetBattle = { ...battle, status: 'expired' };
      deps.socialPetRepo.savePetBattle(updated);
      if (battle.bet > 0) {
        deps.profileRepo.addCoins(battle.guildId, battle.challengerId, battle.bet);
      }
      return { ok: false, reason: 'expired' };
    }

    if (actorId !== battle.challengerId && actorId !== battle.opponentId) {
      return { ok: false, reason: 'not_participant' };
    }

    const updated: PetBattle = { ...battle, status: 'declined' };
    deps.socialPetRepo.savePetBattle(updated);
    if (battle.bet > 0) {
      deps.profileRepo.addCoins(battle.guildId, battle.challengerId, battle.bet);
    }
    return { ok: true, battle: updated, refunded: battle.bet };
  })();
}

export function expirePetBattleIfDueOp(
  deps: SocialPetOpsDeps,
  battleId: number,
  nowMs = Date.now(),
): PetBattle | null {
  return deps.db.transaction((): PetBattle | null => {
    const current = deps.socialPetRepo.getPetBattleById(battleId);
    if (!current || current.status !== 'pending' || current.expiresAt > nowMs) {
      return null;
    }
    const updated: PetBattle = { ...current, status: 'expired' };
    deps.socialPetRepo.savePetBattle(updated);
    if (current.bet > 0) {
      deps.profileRepo.addCoins(current.guildId, current.challengerId, current.bet);
    }
    return updated;
  })();
}

export function expireDuePetBattlesOp(
  deps: SocialPetOpsDeps,
  nowMs = Date.now(),
): PetBattle[] {
  const due = deps.socialPetRepo.listDuePetBattles(nowMs);
  const expired: PetBattle[] = [];
  for (const b of due) {
    const res = expirePetBattleIfDueOp(deps, b.id, nowMs);
    if (res) expired.push(res);
  }
  return expired;
}
