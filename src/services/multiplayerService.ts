import type Database from 'better-sqlite3';
import { DUEL_TTL_MS } from '../config/economyConstants.js';
import type { ChaosRepo } from '../db/repositories/chaosRepo.js';
import type { DuelRepo } from '../db/repositories/duelRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { RedPacketRepo } from '../db/repositories/redPacketRepo.js';
import type { CreditLoanService } from './creditLoanService.js';
import {
  acceptDuelOp,
  bindDuelMessageOp,
  createDuelOp,
  declineDuelOp,
  expireDueDuelsOp,
  expireDuelIfDueOp,
  getDuelOp,
  type DiceDuelState,
} from './multiplayer/diceDuelOps.js';
import type {
  AcceptDuelResult,
  ClaimRedPacketResult,
  CreateDuelResult,
  CreateRedPacketResult,
  DeclineDuelResult,
  DistributeRandomRedPacketResult,
  DuelChallenge,
  ExpiredRedPacketResult,
  MultiplayerDeps,
  RedPacketWithClaims,
} from './multiplayer/multiplayerTypes.js';
import {
  claimRedPacketOp,
  createRedPacketOp,
  distributeRandomRedPacketOp,
  expireDueRedPacketsOp,
  expireRedPacketIfDueOp,
  getRedPacketWithClaimsOp,
} from './multiplayer/redPacketOps.js';

export {
  MAX_COIN_AMOUNT,
  MAX_RED_PACKET_COUNT,
  type AcceptDuelResult,
  type ClaimRedPacketResult,
  type CreateDuelResult,
  type CreateRedPacketResult,
  type DeclineDuelResult,
  type DistributeRandomRedPacketResult,
  type DuelChallenge,
  type DuelStatus,
  type ExpiredRedPacketResult,
  type RandomDropShare,
  type RedPacketWithClaims,
} from './multiplayer/multiplayerTypes.js';

export class MultiplayerService {
  private readonly duelState: DiceDuelState = { duels: new Map<string, DuelChallenge>() };
  private readonly deps: MultiplayerDeps;

  constructor(
    db: Database.Database,
    profileRepo: ProfileRepo,
    private readonly redPacketRepo: RedPacketRepo,
    chaosRepo?: ChaosRepo,
    duelRepoOrCreditLoan?: DuelRepo | CreditLoanService,
    creditLoanService?: CreditLoanService,
  ) {
    let duelRepo: DuelRepo | undefined;
    let resolvedCreditLoan: CreditLoanService | undefined;

    if (duelRepoOrCreditLoan) {
      if ('isDeadbeatBlocked' in duelRepoOrCreditLoan) {
        resolvedCreditLoan = duelRepoOrCreditLoan;
      } else {
        duelRepo = duelRepoOrCreditLoan;
        resolvedCreditLoan = creditLoanService;
      }
    } else {
      resolvedCreditLoan = creditLoanService;
    }

    this.deps = {
      db,
      profileRepo,
      redPacketRepo,
      chaosRepo,
      duelRepo,
      creditLoanService: resolvedCreditLoan,
    };
  }

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
    return createRedPacketOp(this.deps, input);
  }

  distributeRandomRedPacket(input: {
    guildId: string;
    candidateUserIds: readonly string[];
    totalAmount: number;
    count: number;
    rng?: () => number;
  }): DistributeRandomRedPacketResult {
    return distributeRandomRedPacketOp(this.deps, input);
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
    return claimRedPacketOp(this.deps, packetId, userId, nowMs, rng);
  }

  expireRedPacketIfDue(packetId: number, nowMs = Date.now()): ExpiredRedPacketResult | null {
    return expireRedPacketIfDueOp(this.deps, packetId, nowMs);
  }

  expireDueRedPackets(nowMs = Date.now()): ExpiredRedPacketResult[] {
    return expireDueRedPacketsOp(this.deps, nowMs);
  }

  getRedPacketWithClaims(packetId: number): RedPacketWithClaims | null {
    return getRedPacketWithClaimsOp(this.deps, packetId);
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
    return createDuelOp(
      this.deps,
      this.duelState,
      guildId,
      channelId,
      challengerId,
      opponentId,
      bet,
      nowMs,
      ttlMs,
    );
  }

  bindDuelMessage(duelId: string, messageId: string): void {
    bindDuelMessageOp(this.deps, this.duelState, duelId, messageId);
  }

  acceptDuel(
    duelId: string,
    acceptorId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): AcceptDuelResult {
    return acceptDuelOp(this.deps, this.duelState, duelId, acceptorId, nowMs, rng);
  }

  declineDuel(duelId: string, actorId: string, nowMs = Date.now()): DeclineDuelResult {
    return declineDuelOp(this.deps, this.duelState, duelId, actorId, nowMs);
  }

  expireDuelIfDue(duelId: string, nowMs = Date.now()): DuelChallenge | null {
    return expireDuelIfDueOp(this.deps, this.duelState, duelId, nowMs);
  }

  expireDueDuels(nowMs = Date.now()): DuelChallenge[] {
    return expireDueDuelsOp(this.deps, this.duelState, nowMs);
  }

  getDuel(duelId: string, nowMs = Date.now()): DuelChallenge | null {
    return getDuelOp(this.deps, this.duelState, duelId, nowMs);
  }
}
