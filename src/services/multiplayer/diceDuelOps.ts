import { randomBytes } from 'node:crypto';
import {
  DUEL_BOUNTY_MIN_BET,
  DUEL_BOUNTY_MIN_BET_RATIO,
  DUEL_TTL_MS,
  MAX_COIN_AMOUNT,
} from '../../config/economyConstants.js';
import {
  mapDuelRecord,
  MAX_DUELS_IN_MEMORY,
  type AcceptDuelResult,
  type CreateDuelResult,
  type DeclineDuelResult,
  type DuelChallenge,
  type DuelStatus,
  type MultiplayerDeps,
} from './multiplayerTypes.js';

export interface DiceDuelState {
  duels: Map<string, DuelChallenge>;
}

function loadDuelRaw(
  deps: MultiplayerDeps,
  state: DiceDuelState,
  duelId: string,
): DuelChallenge | null {
  if (deps.duelRepo) {
    const rec = deps.duelRepo.getById(duelId);
    return rec ? mapDuelRecord(rec) : null;
  }
  return state.duels.get(duelId) ?? null;
}

function transitionDuelStatus(
  deps: MultiplayerDeps,
  state: DiceDuelState,
  duelId: string,
  nextStatus: DuelStatus,
  expectedStatus: DuelStatus,
): boolean {
  if (deps.duelRepo) {
    return deps.duelRepo.updateStatus(duelId, nextStatus, expectedStatus);
  }
  const duel = state.duels.get(duelId);
  if (!duel || duel.status !== expectedStatus) return false;
  duel.status = nextStatus;
  return true;
}

function generateDuelId(deps: MultiplayerDeps, state: DiceDuelState): string {
  let id = randomBytes(4).toString('hex');
  while (deps.duelRepo ? deps.duelRepo.getById(id) !== null : state.duels.has(id)) {
    id = randomBytes(4).toString('hex');
  }
  return id;
}

function cleanupInMemoryDuels(
  deps: MultiplayerDeps,
  state: DiceDuelState,
  nowMs: number,
): void {
  expireDueDuelsOp(deps, state, nowMs);
  for (const [id, duel] of state.duels) {
    if (duel.status !== 'pending' && duel.expiresAt <= nowMs) {
      state.duels.delete(id);
    }
  }
  if (state.duels.size > MAX_DUELS_IN_MEMORY) {
    for (const [id, duel] of state.duels) {
      if (duel.status !== 'pending') {
        state.duels.delete(id);
      }
    }
  }
  while (state.duels.size > MAX_DUELS_IN_MEMORY) {
    const oldestKey = state.duels.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    const victim = state.duels.get(oldestKey);
    if (victim && victim.status === 'pending') {
      deps.profileRepo.addCoins(victim.guildId, victim.challengerId, victim.bet);
    }
    state.duels.delete(oldestKey);
  }
}

export function createDuelOp(
  deps: MultiplayerDeps,
  state: DiceDuelState,
  guildId: string,
  channelId: string,
  challengerId: string,
  opponentId: string,
  bet: number,
  nowMs = Date.now(),
  ttlMs = DUEL_TTL_MS,
): CreateDuelResult {
  if (challengerId === opponentId) {
    return { ok: false, reason: 'self_target' };
  }
  if (!Number.isInteger(bet) || bet <= 0 || bet > MAX_COIN_AMOUNT) {
    return { ok: false, reason: 'invalid_bet' };
  }
  if (bet > 0 && deps.creditLoanService?.isDeadbeatBlocked(guildId, challengerId, nowMs).blocked) {
    return { ok: false, reason: 'deadbeat_blocked' };
  }

  return deps.db.transaction((): CreateDuelResult => {
    const challenger = deps.profileRepo.getOrCreate(guildId, challengerId);
    if (challenger.coins < bet) {
      return { ok: false, reason: 'insufficient_funds' };
    }
    const challengerBalance = challenger.coins - bet;
    deps.profileRepo.save({ ...challenger, coins: challengerBalance });

    if (!deps.duelRepo) {
      cleanupInMemoryDuels(deps, state, nowMs);
    }

    const id = generateDuelId(deps, state);
    const expiresAt = nowMs + ttlMs;

    if (deps.duelRepo) {
      const created = deps.duelRepo.create({
        id,
        guildId,
        channelId,
        challengerId,
        opponentId,
        bet,
        status: 'pending',
        createdAt: nowMs,
        expiresAt,
      });
      return { ok: true, duel: mapDuelRecord(created), challengerBalance };
    }

    const duel: DuelChallenge = {
      id,
      guildId,
      channelId,
      messageId: null,
      challengerId,
      opponentId,
      bet,
      status: 'pending',
      createdAt: nowMs,
      expiresAt,
    };
    state.duels.set(id, duel);

    return { ok: true, duel: { ...duel }, challengerBalance };
  })();
}

export function bindDuelMessageOp(
  deps: MultiplayerDeps,
  state: DiceDuelState,
  duelId: string,
  messageId: string,
): void {
  if (deps.duelRepo) {
    deps.duelRepo.bindMessageId(duelId, messageId);
    return;
  }
  const duel = state.duels.get(duelId);
  if (duel) {
    duel.messageId = messageId;
  }
}

export function acceptDuelOp(
  deps: MultiplayerDeps,
  state: DiceDuelState,
  duelId: string,
  acceptorId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): AcceptDuelResult {
  return deps.db.transaction((): AcceptDuelResult => {
    const duel = loadDuelRaw(deps, state, duelId);
    if (!duel) {
      return { ok: false, reason: 'not_found' };
    }
    if (duel.status === 'expired') {
      return { ok: false, reason: 'expired' };
    }
    if (duel.status !== 'pending') {
      return { ok: false, reason: 'already_resolved' };
    }
    if (duel.expiresAt <= nowMs) {
      if (transitionDuelStatus(deps, state, duel.id, 'expired', 'pending')) {
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

    const challenger = deps.profileRepo.getOrCreate(duel.guildId, duel.challengerId);
    const opponent = deps.profileRepo.getOrCreate(duel.guildId, duel.opponentId);
    if (opponent.coins < duel.bet) {
      return { ok: false, reason: 'opponent_insufficient_funds' };
    }

    if (!transitionDuelStatus(deps, state, duel.id, 'completed', 'pending')) {
      return { ok: false, reason: 'already_resolved' };
    }

    const rollDie = (): number => 1 + Math.min(5, Math.max(0, Math.floor(rng() * 6)));
    const challengerDice: [number, number, number] = [rollDie(), rollDie(), rollDie()];
    const opponentDice: [number, number, number] = [rollDie(), rollDie(), rollDie()];
    const challengerSum = challengerDice[0] + challengerDice[1] + challengerDice[2];
    const opponentSum = opponentDice[0] + opponentDice[1] + opponentDice[2];

    let challengerBalance = challenger.coins;
    let opponentBalance = opponent.coins;
    let tie = false;
    let winnerId: string | null = null;
    let loserId: string | null = null;
    let bountyClaimed = 0;

    const tryClaimBounty = (loser: string, winner: string): number => {
      if (!deps.chaosRepo) return 0;
      const openBounty = deps.chaosRepo.getOpenBountyTotal(duel.guildId, loser);
      if (openBounty <= 0) return 0;
      const minBet = Math.max(
        DUEL_BOUNTY_MIN_BET,
        Math.floor(openBounty * DUEL_BOUNTY_MIN_BET_RATIO),
      );
      if (duel.bet < minBet) return 0;
      return deps.chaosRepo.claimOpenBounties(duel.guildId, loser, winner, nowMs);
    };

    // Challenger's bet was already frozen/deducted at createDuel.
    if (challengerSum === opponentSum) {
      tie = true;
      challengerBalance = challenger.coins + duel.bet;
      deps.profileRepo.save({ ...challenger, coins: challengerBalance });
    } else if (challengerSum > opponentSum) {
      winnerId = duel.challengerId;
      loserId = duel.opponentId;
      bountyClaimed = tryClaimBounty(loserId, winnerId);
      challengerBalance = challenger.coins + duel.bet * 2 + bountyClaimed;
      opponentBalance = opponent.coins - duel.bet;
      deps.profileRepo.save({ ...challenger, coins: challengerBalance });
      deps.profileRepo.save({ ...opponent, coins: opponentBalance });
    } else {
      winnerId = duel.opponentId;
      loserId = duel.challengerId;
      bountyClaimed = tryClaimBounty(loserId, winnerId);
      challengerBalance = challenger.coins;
      opponentBalance = opponent.coins + duel.bet + bountyClaimed;
      deps.profileRepo.save({ ...opponent, coins: opponentBalance });
    }

    if (!tie && winnerId && loserId && duel.bet > 0) {
      deps.creditLoanService?.recordGamblingResult(
        duel.guildId,
        winnerId,
        duel.bet,
        duel.bet,
        nowMs,
      );
      deps.creditLoanService?.recordGamblingResult(
        duel.guildId,
        loserId,
        duel.bet,
        -duel.bet,
        nowMs,
      );
    }

    return {
      ok: true,
      duel: { ...duel, status: 'completed' },
      challengerDice,
      challengerSum,
      opponentDice,
      opponentSum,
      tie,
      winnerId,
      loserId,
      challengerBalance,
      opponentBalance,
      ...(bountyClaimed > 0 ? { bountyClaimed } : {}),
    };
  })();
}

export function declineDuelOp(
  deps: MultiplayerDeps,
  state: DiceDuelState,
  duelId: string,
  actorId: string,
  nowMs = Date.now(),
): DeclineDuelResult {
  return deps.db.transaction((): DeclineDuelResult => {
    const duel = loadDuelRaw(deps, state, duelId);
    if (!duel) {
      return { ok: false, reason: 'not_found' };
    }
    if (duel.status === 'expired') {
      return { ok: false, reason: 'expired' };
    }
    if (duel.status !== 'pending') {
      return { ok: false, reason: 'already_resolved' };
    }
    if (duel.expiresAt <= nowMs) {
      if (transitionDuelStatus(deps, state, duel.id, 'expired', 'pending')) {
        deps.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
      }
      return { ok: false, reason: 'expired' };
    }
    if (actorId !== duel.opponentId && actorId !== duel.challengerId) {
      return { ok: false, reason: 'not_participant' };
    }

    if (!transitionDuelStatus(deps, state, duel.id, 'declined', 'pending')) {
      return { ok: false, reason: 'already_resolved' };
    }
    deps.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);

    return { ok: true, duel: { ...duel, status: 'declined' }, refunded: duel.bet };
  })();
}

export function expireDuelIfDueOp(
  deps: MultiplayerDeps,
  state: DiceDuelState,
  duelId: string,
  nowMs = Date.now(),
): DuelChallenge | null {
  return deps.db.transaction((): DuelChallenge | null => {
    const duel = loadDuelRaw(deps, state, duelId);
    if (!duel || duel.status !== 'pending' || duel.expiresAt > nowMs) {
      return null;
    }
    if (!transitionDuelStatus(deps, state, duel.id, 'expired', 'pending')) {
      return null;
    }
    deps.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
    return { ...duel, status: 'expired' };
  })();
}

export function expireDueDuelsOp(
  deps: MultiplayerDeps,
  state: DiceDuelState,
  nowMs = Date.now(),
): DuelChallenge[] {
  const expired: DuelChallenge[] = [];
  if (deps.duelRepo) {
    const due = deps.duelRepo.listDuePending(nowMs);
    for (const item of due) {
      const res = expireDuelIfDueOp(deps, state, item.id, nowMs);
      if (res) expired.push(res);
    }
    return expired;
  }

  for (const duel of state.duels.values()) {
    if (duel.status === 'pending' && duel.expiresAt <= nowMs) {
      const res = expireDuelIfDueOp(deps, state, duel.id, nowMs);
      if (res) expired.push(res);
    }
  }
  return expired;
}

export function getDuelOp(
  deps: MultiplayerDeps,
  state: DiceDuelState,
  duelId: string,
  nowMs = Date.now(),
): DuelChallenge | null {
  const duel = loadDuelRaw(deps, state, duelId);
  if (!duel) {
    return null;
  }
  if (duel.status === 'pending' && duel.expiresAt <= nowMs) {
    const expired = expireDuelIfDueOp(deps, state, duel.id, nowMs);
    if (expired) return expired;
  }
  const latest = loadDuelRaw(deps, state, duelId);
  return latest ? { ...latest } : null;
}
