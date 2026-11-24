import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  DUEL_BOUNTY_MIN_BET,
  DUEL_BOUNTY_MIN_BET_RATIO,
  DUEL_TTL_MS,
  MAX_COIN_AMOUNT,
} from '../config/economyConstants.js';
import type { ChaosRepo } from '../db/repositories/chaosRepo.js';
import type { DuelChallengeRecord, DuelRepo } from '../db/repositories/duelRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type {
  RedPacket,
  RedPacketClaim,
  RedPacketRepo,
} from '../db/repositories/redPacketRepo.js';

export { MAX_COIN_AMOUNT };

export type CreateRedPacketResult =
  | { ok: true; packet: RedPacket; senderBalance: number }
  | {
      ok: false;
      reason:
        | 'invalid_count'
        | 'invalid_amount'
        | 'amount_too_small_for_count'
        | 'insufficient_funds';
    };

export type ClaimRedPacketResult =
  | {
      ok: true;
      amount: number;
      claimerBalance: number;
      packet: RedPacket;
      claims: RedPacketClaim[];
      bestLuckUserId: string | null;
    }
  | {
      ok: false;
      reason: 'not_found' | 'expired' | 'finished' | 'already_claimed';
    };

export interface ExpiredRedPacketResult {
  packet: RedPacket;
  refundedAmount: number;
}

export interface RedPacketWithClaims {
  packet: RedPacket;
  claims: RedPacketClaim[];
  bestLuckUserId: string | null;
}

export type DuelStatus = 'pending' | 'completed' | 'declined' | 'expired';

export interface DuelChallenge {
  id: string;
  guildId: string;
  channelId: string;
  messageId?: string | null;
  challengerId: string;
  opponentId: string;
  bet: number;
  status: DuelStatus;
  createdAt: number;
  expiresAt: number;
}

export type CreateDuelResult =
  | { ok: true; duel: DuelChallenge; challengerBalance: number }
  | { ok: false; reason: 'self_target' | 'invalid_bet' | 'insufficient_funds' };

export type AcceptDuelResult =
  | {
      ok: true;
      duel: DuelChallenge;
      challengerDice: [number, number, number];
      challengerSum: number;
      opponentDice: [number, number, number];
      opponentSum: number;
      tie: boolean;
      winnerId: string | null;
      loserId: string | null;
      challengerBalance: number;
      opponentBalance: number;
      bountyClaimed?: number;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_opponent'
        | 'already_resolved'
        | 'expired'
        | 'challenger_insufficient_funds'
        | 'opponent_insufficient_funds';
    };

export type DeclineDuelResult =
  | { ok: true; duel: DuelChallenge; refunded: number }
  | {
      ok: false;
      reason: 'not_found' | 'not_participant' | 'already_resolved' | 'expired';
    };

export interface RandomDropShare {
  userId: string;
  amount: number;
  newBalance: number;
}

export type DistributeRandomRedPacketResult =
  | {
      ok: true;
      totalAmount: number;
      winnerCount: number;
      shares: RandomDropShare[];
      bestLuckUserId: string;
      bestLuckAmount: number;
    }
  | {
      ok: false;
      reason:
        | 'no_candidates'
        | 'invalid_count'
        | 'invalid_amount'
        | 'amount_too_small_for_count';
    };

export const MAX_RED_PACKET_COUNT = 100;
const MAX_DUELS_IN_MEMORY = 100;
const DEFAULT_RED_PACKET_TTL_MS = 24 * 3600 * 1000;
const DEFAULT_GREETING = '恭喜发财，大吉大利！';

function computeBestLuckUserId(packet: RedPacket, claims: RedPacketClaim[]): string | null {
  if (packet.status !== 'finished' || claims.length === 0) {
    return null;
  }
  let best: RedPacketClaim | undefined;
  for (const claim of claims) {
    if (!best || claim.amount > best.amount) {
      best = claim;
    }
  }
  return best ? best.userId : null;
}

function mapDuelRecord(record: DuelChallengeRecord): DuelChallenge {
  return {
    id: record.id,
    guildId: record.guildId,
    channelId: record.channelId,
    messageId: record.messageId,
    challengerId: record.challengerId,
    opponentId: record.opponentId,
    bet: record.bet,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export class MultiplayerService {
  private readonly duels = new Map<string, DuelChallenge>();

  constructor(
    private readonly db: Database.Database,
    private readonly profileRepo: ProfileRepo,
    private readonly redPacketRepo: RedPacketRepo,
    private readonly chaosRepo?: ChaosRepo,
    private readonly duelRepo?: DuelRepo,
  ) {}

  createRedPacket(input: {
    guildId: string;
    channelId: string;
    senderId: string;
    totalAmount: number;
    totalCount: number;
    greeting?: string;
    nowMs?: number;
    ttlMs?: number;
    systemFunded?: boolean;
  }): CreateRedPacketResult {
    if (
      !Number.isInteger(input.totalCount) ||
      input.totalCount < 2 ||
      input.totalCount > MAX_RED_PACKET_COUNT
    ) {
      return { ok: false, reason: 'invalid_count' };
    }
    if (
      !Number.isInteger(input.totalAmount) ||
      input.totalAmount <= 0 ||
      input.totalAmount > MAX_COIN_AMOUNT
    ) {
      return { ok: false, reason: 'invalid_amount' };
    }
    if (input.totalAmount < input.totalCount) {
      return { ok: false, reason: 'amount_too_small_for_count' };
    }

    const nowMs = input.nowMs ?? Date.now();
    const expiresAt = nowMs + (input.ttlMs ?? DEFAULT_RED_PACKET_TTL_MS);
    const greeting = input.greeting?.trim() || DEFAULT_GREETING;
    const systemFunded = Boolean(input.systemFunded);

    return this.db.transaction((): CreateRedPacketResult => {
      const sender = this.profileRepo.getOrCreate(input.guildId, input.senderId);
      let senderBalance = sender.coins;
      if (!systemFunded) {
        if (sender.coins < input.totalAmount) {
          return { ok: false, reason: 'insufficient_funds' };
        }
        senderBalance = sender.coins - input.totalAmount;
        this.profileRepo.save({ ...sender, coins: senderBalance });
      }

      const packet = this.redPacketRepo.create({
        guildId: input.guildId,
        channelId: input.channelId,
        senderId: input.senderId,
        totalAmount: input.totalAmount,
        totalCount: input.totalCount,
        greeting,
        expiresAt,
        createdAt: nowMs,
        systemFunded,
      });

      return { ok: true, packet, senderBalance };
    })();
  }

  distributeRandomRedPacket(input: {
    guildId: string;
    candidateUserIds: readonly string[];
    totalAmount: number;
    count: number;
    rng?: () => number;
  }): DistributeRandomRedPacketResult {
    const uniqueCandidates = [...new Set(input.candidateUserIds)];
    if (uniqueCandidates.length === 0) {
      return { ok: false, reason: 'no_candidates' };
    }
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_RED_PACKET_COUNT) {
      return { ok: false, reason: 'invalid_count' };
    }
    if (
      !Number.isInteger(input.totalAmount) ||
      input.totalAmount <= 0 ||
      input.totalAmount > MAX_COIN_AMOUNT
    ) {
      return { ok: false, reason: 'invalid_amount' };
    }

    const winnerCount = Math.min(input.count, uniqueCandidates.length);
    if (input.totalAmount < winnerCount) {
      return { ok: false, reason: 'amount_too_small_for_count' };
    }

    const rng = input.rng ?? Math.random;
    const shuffled = [...uniqueCandidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }
    const winners = shuffled.slice(0, winnerCount);

    return this.db.transaction((): DistributeRandomRedPacketResult => {
      let remainingAmount = input.totalAmount;
      let remainingCount = winnerCount;
      const shares: RandomDropShare[] = [];
      let bestLuckUserId = winners[0]!;
      let bestLuckAmount = -1;

      for (const userId of winners) {
        let share: number;
        if (remainingCount === 1) {
          share = remainingAmount;
        } else {
          const maxShare = Math.max(
            1,
            Math.min(
              remainingAmount - (remainingCount - 1),
              Math.floor((remainingAmount / remainingCount) * 2),
            ),
          );
          share = 1 + Math.min(maxShare - 1, Math.max(0, Math.floor(rng() * maxShare)));
        }
        remainingAmount -= share;
        remainingCount -= 1;

        const updated = this.profileRepo.addCoins(input.guildId, userId, share);
        shares.push({
          userId,
          amount: share,
          newBalance: updated.coins,
        });
        if (share > bestLuckAmount) {
          bestLuckAmount = share;
          bestLuckUserId = userId;
        }
      }

      return {
        ok: true,
        totalAmount: input.totalAmount,
        winnerCount,
        shares,
        bestLuckUserId,
        bestLuckAmount,
      };
    })();
  }

  bindRedPacketMessage(packetId: number, messageId: string): void {
    this.redPacketRepo.bindMessageId(packetId, messageId);
  }

  claimRedPacket(
    packetId: number,
    userId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): ClaimRedPacketResult {
    return this.db.transaction((): ClaimRedPacketResult => {
      const packet = this.redPacketRepo.getById(packetId);
      if (!packet) {
        return { ok: false, reason: 'not_found' };
      }
      if (packet.status === 'expired') {
        return { ok: false, reason: 'expired' };
      }
      if (packet.status !== 'open' || packet.remainingCount <= 0) {
        return { ok: false, reason: 'finished' };
      }
      if (packet.expiresAt <= nowMs) {
        return { ok: false, reason: 'expired' };
      }
      if (this.redPacketRepo.hasClaimed(packetId, userId)) {
        return { ok: false, reason: 'already_claimed' };
      }

      let share: number;
      if (packet.remainingCount === 1) {
        share = packet.remainingAmount;
      } else {
        const maxShare = Math.max(
          1,
          Math.min(
            packet.remainingAmount - (packet.remainingCount - 1),
            Math.floor((packet.remainingAmount / packet.remainingCount) * 2),
          ),
        );
        share = 1 + Math.min(maxShare - 1, Math.max(0, Math.floor(rng() * maxShare)));
      }

      const updatedClaimer = this.profileRepo.addCoins(packet.guildId, userId, share);
      const updatedPacket = this.redPacketRepo.recordClaimAndDecrement(
        packetId,
        userId,
        share,
        nowMs,
      );
      const claims = this.redPacketRepo.listClaims(packetId);
      const bestLuckUserId = computeBestLuckUserId(updatedPacket, claims);

      return {
        ok: true,
        amount: share,
        claimerBalance: updatedClaimer.coins,
        packet: updatedPacket,
        claims,
        bestLuckUserId,
      };
    })();
  }

  expireRedPacketIfDue(packetId: number, nowMs = Date.now()): ExpiredRedPacketResult | null {
    return this.db.transaction((): ExpiredRedPacketResult | null => {
      const current = this.redPacketRepo.getById(packetId);
      if (!current || current.status !== 'open' || current.expiresAt > nowMs) {
        return null;
      }
      const changed = this.redPacketRepo.markExpired(current.id);
      if (!changed) {
        return null;
      }
      const refundedAmount =
        !current.systemFunded && current.remainingAmount > 0 ? current.remainingAmount : 0;
      if (refundedAmount > 0) {
        this.profileRepo.addCoins(current.guildId, current.senderId, refundedAmount);
      }
      const updated = this.redPacketRepo.getById(current.id) ?? {
        ...current,
        status: 'expired' as const,
      };
      return { packet: updated, refundedAmount };
    })();
  }

  expireDueRedPackets(nowMs = Date.now()): ExpiredRedPacketResult[] {
    const due = this.redPacketRepo.listDueOpen(nowMs);
    const results: ExpiredRedPacketResult[] = [];

    for (const item of due) {
      const result = this.expireRedPacketIfDue(item.id, nowMs);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  getRedPacketWithClaims(packetId: number): RedPacketWithClaims | null {
    const packet = this.redPacketRepo.getById(packetId);
    if (!packet) {
      return null;
    }
    const claims = this.redPacketRepo.listClaims(packetId);
    return {
      packet,
      claims,
      bestLuckUserId: computeBestLuckUserId(packet, claims),
    };
  }

  createDuel(
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

    return this.db.transaction((): CreateDuelResult => {
      const challenger = this.profileRepo.getOrCreate(guildId, challengerId);
      if (challenger.coins < bet) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      const challengerBalance = challenger.coins - bet;
      this.profileRepo.save({ ...challenger, coins: challengerBalance });

      if (!this.duelRepo) {
        this.cleanupInMemoryDuels(nowMs);
      }

      const id = this.generateDuelId();
      const expiresAt = nowMs + ttlMs;

      if (this.duelRepo) {
        const created = this.duelRepo.create({
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
      this.duels.set(id, duel);

      return { ok: true, duel: { ...duel }, challengerBalance };
    })();
  }

  bindDuelMessage(duelId: string, messageId: string): void {
    if (this.duelRepo) {
      this.duelRepo.bindMessageId(duelId, messageId);
      return;
    }
    const duel = this.duels.get(duelId);
    if (duel) {
      duel.messageId = messageId;
    }
  }

  private loadDuelRaw(duelId: string): DuelChallenge | null {
    if (this.duelRepo) {
      const rec = this.duelRepo.getById(duelId);
      return rec ? mapDuelRecord(rec) : null;
    }
    return this.duels.get(duelId) ?? null;
  }

  private transitionDuelStatus(
    duelId: string,
    nextStatus: DuelStatus,
    expectedStatus: DuelStatus,
  ): boolean {
    if (this.duelRepo) {
      return this.duelRepo.updateStatus(duelId, nextStatus, expectedStatus);
    }
    const duel = this.duels.get(duelId);
    if (!duel || duel.status !== expectedStatus) return false;
    duel.status = nextStatus;
    return true;
  }

  acceptDuel(
    duelId: string,
    acceptorId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): AcceptDuelResult {
    return this.db.transaction((): AcceptDuelResult => {
      const duel = this.loadDuelRaw(duelId);
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
        if (this.transitionDuelStatus(duel.id, 'expired', 'pending')) {
          this.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
        }
        return { ok: false, reason: 'expired' };
      }
      if (acceptorId !== duel.opponentId) {
        return { ok: false, reason: 'not_opponent' };
      }

      const challenger = this.profileRepo.getOrCreate(duel.guildId, duel.challengerId);
      const opponent = this.profileRepo.getOrCreate(duel.guildId, duel.opponentId);
      if (opponent.coins < duel.bet) {
        return { ok: false, reason: 'opponent_insufficient_funds' };
      }

      if (!this.transitionDuelStatus(duel.id, 'completed', 'pending')) {
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
        if (!this.chaosRepo) return 0;
        const openBounty = this.chaosRepo.getOpenBountyTotal(duel.guildId, loser);
        if (openBounty <= 0) return 0;
        const minBet = Math.max(
          DUEL_BOUNTY_MIN_BET,
          Math.floor(openBounty * DUEL_BOUNTY_MIN_BET_RATIO),
        );
        if (duel.bet < minBet) return 0;
        return this.chaosRepo.claimOpenBounties(duel.guildId, loser, winner, nowMs);
      };

      // Challenger's bet was already frozen/deducted at createDuel.
      if (challengerSum === opponentSum) {
        tie = true;
        challengerBalance = challenger.coins + duel.bet;
        this.profileRepo.save({ ...challenger, coins: challengerBalance });
      } else if (challengerSum > opponentSum) {
        winnerId = duel.challengerId;
        loserId = duel.opponentId;
        bountyClaimed = tryClaimBounty(loserId, winnerId);
        challengerBalance = challenger.coins + duel.bet * 2 + bountyClaimed;
        opponentBalance = opponent.coins - duel.bet;
        this.profileRepo.save({ ...challenger, coins: challengerBalance });
        this.profileRepo.save({ ...opponent, coins: opponentBalance });
      } else {
        winnerId = duel.opponentId;
        loserId = duel.challengerId;
        bountyClaimed = tryClaimBounty(loserId, winnerId);
        challengerBalance = challenger.coins;
        opponentBalance = opponent.coins + duel.bet + bountyClaimed;
        this.profileRepo.save({ ...opponent, coins: opponentBalance });
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

  declineDuel(duelId: string, actorId: string, nowMs = Date.now()): DeclineDuelResult {
    return this.db.transaction((): DeclineDuelResult => {
      const duel = this.loadDuelRaw(duelId);
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
        if (this.transitionDuelStatus(duel.id, 'expired', 'pending')) {
          this.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
        }
        return { ok: false, reason: 'expired' };
      }
      if (actorId !== duel.opponentId && actorId !== duel.challengerId) {
        return { ok: false, reason: 'not_participant' };
      }

      if (!this.transitionDuelStatus(duel.id, 'declined', 'pending')) {
        return { ok: false, reason: 'already_resolved' };
      }
      this.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);

      return { ok: true, duel: { ...duel, status: 'declined' }, refunded: duel.bet };
    })();
  }

  expireDuelIfDue(duelId: string, nowMs = Date.now()): DuelChallenge | null {
    return this.db.transaction((): DuelChallenge | null => {
      const duel = this.loadDuelRaw(duelId);
      if (!duel || duel.status !== 'pending' || duel.expiresAt > nowMs) {
        return null;
      }
      if (!this.transitionDuelStatus(duel.id, 'expired', 'pending')) {
        return null;
      }
      this.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
      return { ...duel, status: 'expired' };
    })();
  }

  expireDueDuels(nowMs = Date.now()): DuelChallenge[] {
    const expired: DuelChallenge[] = [];
    if (this.duelRepo) {
      const due = this.duelRepo.listDuePending(nowMs);
      for (const item of due) {
        const res = this.expireDuelIfDue(item.id, nowMs);
        if (res) expired.push(res);
      }
      return expired;
    }

    for (const duel of this.duels.values()) {
      if (duel.status === 'pending' && duel.expiresAt <= nowMs) {
        const res = this.expireDuelIfDue(duel.id, nowMs);
        if (res) expired.push(res);
      }
    }
    return expired;
  }

  getDuel(duelId: string, nowMs = Date.now()): DuelChallenge | null {
    const duel = this.loadDuelRaw(duelId);
    if (!duel) {
      return null;
    }
    if (duel.status === 'pending' && duel.expiresAt <= nowMs) {
      const expired = this.expireDuelIfDue(duel.id, nowMs);
      if (expired) return expired;
    }
    const latest = this.loadDuelRaw(duelId);
    return latest ? { ...latest } : null;
  }

  private cleanupInMemoryDuels(nowMs: number): void {
    this.expireDueDuels(nowMs);
    for (const [id, duel] of this.duels) {
      if (duel.status !== 'pending' && duel.expiresAt <= nowMs) {
        this.duels.delete(id);
      }
    }
    if (this.duels.size > MAX_DUELS_IN_MEMORY) {
      for (const [id, duel] of this.duels) {
        if (duel.status !== 'pending') {
          this.duels.delete(id);
        }
      }
    }
    while (this.duels.size > MAX_DUELS_IN_MEMORY) {
      const oldestKey = this.duels.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const victim = this.duels.get(oldestKey);
      if (victim && victim.status === 'pending') {
        this.profileRepo.addCoins(victim.guildId, victim.challengerId, victim.bet);
      }
      this.duels.delete(oldestKey);
    }
  }

  private generateDuelId(): string {
    let id = randomBytes(4).toString('hex');
    while (this.duelRepo ? this.duelRepo.getById(id) !== null : this.duels.has(id)) {
      id = randomBytes(4).toString('hex');
    }
    return id;
  }
}
