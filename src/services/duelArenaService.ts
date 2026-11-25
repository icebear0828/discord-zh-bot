import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  DUEL_BOUNTY_MIN_BET,
  DUEL_BOUNTY_MIN_BET_RATIO,
  MAX_COIN_AMOUNT,
} from '../config/economyConstants.js';
import type { ChaosRepo } from '../db/repositories/chaosRepo.js';
import {
  DuelRepo,
  type DuelRouletteRecord,
  type NicknameLockRecord,
  type NicknameLockSourceType,
  type RpsDuelRecord,
  type RpsMove,
  type RpsRoundEntry,
} from '../db/repositories/duelRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { AppContext } from '../ui/embeds.js';
import type { CreditLoanService } from './creditLoanService.js';

export const VALID_RENAME_HOURS = [1, 6, 24] as const;
export const VALID_TIMEOUT_MINUTES = [5, 10, 30] as const;
export const RPS_INVITE_TTL_MS = 5 * 60 * 1000;
export const RPS_ROUND_TTL_MS = 60 * 1000;
export const RPS_WINS_NEEDED = 3;
export const ROULETTE_1V1_INVITE_TTL_MS = 5 * 60 * 1000;
export const ROULETTE_1V1_TURN_TTL_MS = 30 * 1000;
export const RENAME_COOLDOWN_MS = 10 * 1000;
export const MAX_CUSTOM_WAGER_LEN = 100;

export type CreateRpsDuelResult =
  | { ok: true; duel: RpsDuelRecord; challengerBalance: number }
  | {
      ok: false;
      reason:
        | 'self_target'
        | 'invalid_bet'
        | 'invalid_rename_hours'
        | 'insufficient_funds'
        | 'deadbeat_blocked';
    };

export type AcceptRpsDuelResult =
  | { ok: true; duel: RpsDuelRecord }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_opponent'
        | 'already_resolved'
        | 'expired'
        | 'opponent_insufficient_funds'
        | 'deadbeat_blocked';
    };

export type DeclineRpsDuelResult =
  | { ok: true; duel: RpsDuelRecord; refunded: number }
  | { ok: false; reason: 'not_found' | 'not_participant' | 'already_resolved' | 'expired' };

export type SubmitRpsMoveResult =
  | {
      ok: true;
      duel: RpsDuelRecord;
      roundResolved: boolean;
      roundTie?: boolean;
      matchFinished?: boolean;
      winnerId?: string | null;
      loserId?: string | null;
      bountyClaimed?: number;
      lastRound?: RpsRoundEntry;
    }
  | {
      ok: false;
      reason: 'not_found' | 'not_playing' | 'not_participant' | 'already_moved';
    };

export interface TimedOutRpsUpdate {
  duel: RpsDuelRecord;
  kind: 'invite_expired' | 'round_cancelled' | 'round_forfeit';
  winnerId: string | null;
  loserId: string | null;
  matchFinished: boolean;
  bountyClaimed: number;
}

export type CreateRouletteDuelResult =
  | { ok: true; duel: DuelRouletteRecord; challengerBalance: number }
  | {
      ok: false;
      reason:
        | 'self_target'
        | 'invalid_bullets'
        | 'invalid_bet'
        | 'invalid_rename_hours'
        | 'invalid_timeout_minutes'
        | 'invalid_custom_wager'
        | 'no_stake'
        | 'insufficient_funds'
        | 'deadbeat_blocked';
    };

export type AcceptRouletteDuelResult =
  | { ok: true; duel: DuelRouletteRecord }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_opponent'
        | 'already_resolved'
        | 'expired'
        | 'opponent_insufficient_funds'
        | 'deadbeat_blocked';
    };

export type DeclineRouletteDuelResult =
  | { ok: true; duel: DuelRouletteRecord; refunded: number }
  | { ok: false; reason: 'not_found' | 'not_participant' | 'already_resolved' | 'expired' };

export type PullRouletteDuelResult =
  | {
      ok: true;
      duel: DuelRouletteRecord;
      actorId: string;
      autoTimeout: boolean;
      fired: boolean;
      winnerId: string | null;
      loserId: string | null;
      bountyClaimed: number;
      renameDurationMs: number;
      timeoutDurationMs: number;
    }
  | { ok: false; reason: 'not_found' | 'not_playing' | 'not_your_turn' };

export interface TimedOutRouletteDuelUpdate {
  duel: DuelRouletteRecord;
  kind: 'invite_expired' | 'turn_timeout';
  actorId?: string;
  fired?: boolean;
  winnerId: string | null;
  loserId: string | null;
  bountyClaimed: number;
  renameDurationMs: number;
  timeoutDurationMs: number;
}

export type ValidateWinnerRenameResult =
  | { ok: true; lock: NicknameLockRecord; nickname: string }
  | {
      ok: false;
      reason: 'invalid_nickname' | 'no_lock' | 'cooldown';
      retryAfterSec?: number;
    };

export type CommitRenameResult =
  | { ok: true; lock: NicknameLockRecord }
  | { ok: false; reason: 'no_lock' };

function isValidRenameHours(hours: number, allowZero: boolean): boolean {
  if (allowZero && hours === 0) return true;
  return (VALID_RENAME_HOURS as readonly number[]).includes(hours);
}

function isValidTimeoutMinutes(minutes: number): boolean {
  if (minutes === 0) return true;
  return (VALID_TIMEOUT_MINUTES as readonly number[]).includes(minutes);
}

function resolveRpsWinner(
  challengerMove: RpsMove,
  opponentMove: RpsMove,
): 'challenger' | 'opponent' | 'tie' {
  if (challengerMove === opponentMove) return 'tie';
  if (
    (challengerMove === 'rock' && opponentMove === 'scissors') ||
    (challengerMove === 'scissors' && opponentMove === 'paper') ||
    (challengerMove === 'paper' && opponentMove === 'rock')
  ) {
    return 'challenger';
  }
  return 'opponent';
}

function generateArenaId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

export function formatRpsMoveLabel(move: RpsMove): string {
  switch (move) {
    case 'rock':
      return '✊ 石头';
    case 'paper':
      return '🖐️ 布';
    case 'scissors':
      return '✌️ 剪刀';
  }
}

export class DuelArenaService {
  constructor(
    private readonly db: Database.Database,
    private readonly profileRepo: ProfileRepo,
    private readonly duelRepo: DuelRepo,
    private readonly chaosRepo?: ChaosRepo,
    private readonly creditLoanService?: CreditLoanService,
  ) {}

  private claimEligibleBounty(
    guildId: string,
    loserId: string,
    winnerId: string,
    bet: number,
    nowMs: number,
  ): number {
    if (!this.chaosRepo || bet <= 0) return 0;
    const openBounty = this.chaosRepo.getOpenBountyTotal(guildId, loserId);
    if (openBounty <= 0) return 0;
    const minBet = Math.max(
      DUEL_BOUNTY_MIN_BET,
      Math.floor(openBounty * DUEL_BOUNTY_MIN_BET_RATIO),
    );
    if (bet < minBet) return 0;
    return this.chaosRepo.claimOpenBounties(guildId, loserId, winnerId, nowMs);
  }

  private settleCoinsAndStatsInTx(input: {
    guildId: string;
    winnerId: string;
    loserId: string;
    bet: number;
    nowMs: number;
  }): number {
    if (input.bet <= 0) return 0;
    const bountyClaimed = this.claimEligibleBounty(
      input.guildId,
      input.loserId,
      input.winnerId,
      input.bet,
      input.nowMs,
    );
    this.profileRepo.addCoins(input.guildId, input.winnerId, input.bet * 2 + bountyClaimed);
    this.creditLoanService?.recordGamblingResult(
      input.guildId,
      input.winnerId,
      input.bet,
      input.bet,
      input.nowMs,
    );
    this.creditLoanService?.recordGamblingResult(
      input.guildId,
      input.loserId,
      input.bet,
      -input.bet,
      input.nowMs,
    );
    return bountyClaimed;
  }

  private grantNicknameLockInTx(input: {
    guildId: string;
    targetId: string;
    winnerId: string;
    sourceType: NicknameLockSourceType;
    sourceId: string;
    durationMs: number;
    nowMs: number;
  }): void {
    if (input.durationMs <= 0) return;
    const existing = this.duelRepo.getNicknameLock(input.guildId, input.targetId);
    const preserveActive = existing !== null && existing.expiresAt > input.nowMs;

    this.duelRepo.upsertNicknameLock({
      guildId: input.guildId,
      targetId: input.targetId,
      winnerId: input.winnerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      originalNickname: preserveActive ? existing.originalNickname : null,
      originalNicknameCaptured: preserveActive ? existing.originalNicknameCaptured : false,
      lockedNickname: null,
      fallbackMode: preserveActive ? existing.fallbackMode : false,
      originalCardNickname: preserveActive ? existing.originalCardNickname : null,
      originalEquippedTitle: preserveActive ? existing.originalEquippedTitle : null,
      lastRenamedAt: 0,
      expiresAt: input.nowMs + input.durationMs,
      createdAt: preserveActive ? existing.createdAt : input.nowMs,
      updatedAt: input.nowMs,
    });
  }

  // ========== Rock-Paper-Scissors Bo5 ==========

  createRpsDuel(input: {
    guildId: string;
    channelId: string;
    challengerId: string;
    opponentId: string;
    renameHours?: number;
    bet?: number;
    nowMs?: number;
    ttlMs?: number;
  }): CreateRpsDuelResult {
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
      this.creditLoanService?.isDeadbeatBlocked(input.guildId, input.challengerId, nowMs).blocked
    ) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }

    return this.db.transaction((): CreateRpsDuelResult => {
      const challenger = this.profileRepo.getOrCreate(input.guildId, input.challengerId);
      if (bet > 0 && challenger.coins < bet) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      const challengerBalance = challenger.coins - bet;
      if (bet > 0) {
        this.profileRepo.save({ ...challenger, coins: challengerBalance });
      }

      const duel = this.duelRepo.createRps({
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

  bindRpsMessage(duelId: string, messageId: string): void {
    this.duelRepo.bindRpsMessageId(duelId, messageId);
  }

  getRpsDuel(duelId: string): RpsDuelRecord | null {
    return this.duelRepo.getRpsById(duelId);
  }

  acceptRpsDuel(duelId: string, acceptorId: string, nowMs = Date.now()): AcceptRpsDuelResult {
    return this.db.transaction((): AcceptRpsDuelResult => {
      const duel = this.duelRepo.getRpsById(duelId);
      if (!duel) return { ok: false, reason: 'not_found' };
      if (duel.status === 'expired') return { ok: false, reason: 'expired' };
      if (duel.status !== 'pending') return { ok: false, reason: 'already_resolved' };
      if (duel.expiresAt <= nowMs) {
        const expired: RpsDuelRecord = { ...duel, status: 'expired', updatedAt: nowMs };
        this.duelRepo.saveRps(expired);
        if (duel.bet > 0) {
          this.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
        }
        return { ok: false, reason: 'expired' };
      }
      if (acceptorId !== duel.opponentId) {
        return { ok: false, reason: 'not_opponent' };
      }
      if (
        duel.bet > 0 &&
        (this.creditLoanService?.isDeadbeatBlocked(duel.guildId, acceptorId, nowMs).blocked ||
          this.creditLoanService?.isDeadbeatBlocked(duel.guildId, duel.challengerId, nowMs).blocked)
      ) {
        return { ok: false, reason: 'deadbeat_blocked' };
      }

      if (duel.bet > 0) {
        const opponent = this.profileRepo.getOrCreate(duel.guildId, duel.opponentId);
        if (opponent.coins < duel.bet) {
          return { ok: false, reason: 'opponent_insufficient_funds' };
        }
        this.profileRepo.save({ ...opponent, coins: opponent.coins - duel.bet });
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
      this.duelRepo.saveRps(updated);
      return { ok: true, duel: updated };
    })();
  }

  declineRpsDuel(duelId: string, actorId: string, nowMs = Date.now()): DeclineRpsDuelResult {
    return this.db.transaction((): DeclineRpsDuelResult => {
      const duel = this.duelRepo.getRpsById(duelId);
      if (!duel) return { ok: false, reason: 'not_found' };
      if (duel.status === 'expired') return { ok: false, reason: 'expired' };
      if (duel.status !== 'pending') return { ok: false, reason: 'already_resolved' };
      if (duel.expiresAt <= nowMs) {
        const expired: RpsDuelRecord = { ...duel, status: 'expired', updatedAt: nowMs };
        this.duelRepo.saveRps(expired);
        if (duel.bet > 0) {
          this.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
        }
        return { ok: false, reason: 'expired' };
      }
      if (actorId !== duel.challengerId && actorId !== duel.opponentId) {
        return { ok: false, reason: 'not_participant' };
      }

      const updated: RpsDuelRecord = { ...duel, status: 'declined', updatedAt: nowMs };
      this.duelRepo.saveRps(updated);
      if (duel.bet > 0) {
        this.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
      }
      return { ok: true, duel: updated, refunded: duel.bet };
    })();
  }

  submitRpsMove(
    duelId: string,
    userId: string,
    move: RpsMove,
    nowMs = Date.now(),
  ): SubmitRpsMoveResult {
    return this.db.transaction((): SubmitRpsMoveResult => {
      const duel = this.duelRepo.getRpsById(duelId);
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
        this.duelRepo.saveRps(waiting);
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
        this.duelRepo.saveRps(tied);
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
      const nextChallengerWins =
        duel.challengerWins + (outcome === 'challenger' ? 1 : 0);
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
        const bountyClaimed = this.settleCoinsAndStatsInTx({
          guildId: duel.guildId,
          winnerId: roundWinnerId,
          loserId: roundLoserId,
          bet: duel.bet,
          nowMs,
        });
        this.grantNicknameLockInTx({
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
        this.duelRepo.saveRps(completed);
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
      this.duelRepo.saveRps(nextRound);
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

  processTimedOutRpsDuels(nowMs = Date.now()): TimedOutRpsUpdate[] {
    const updates: TimedOutRpsUpdate[] = [];

    for (const pending of this.duelRepo.listDuePendingRps(nowMs)) {
      const res = this.db.transaction((): TimedOutRpsUpdate | null => {
        const latest = this.duelRepo.getRpsById(pending.id);
        if (!latest || latest.status !== 'pending' || latest.expiresAt > nowMs) {
          return null;
        }
        const updated: RpsDuelRecord = { ...latest, status: 'expired', updatedAt: nowMs };
        this.duelRepo.saveRps(updated);
        if (latest.bet > 0) {
          this.profileRepo.addCoins(latest.guildId, latest.challengerId, latest.bet);
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

    for (const playing of this.duelRepo.listDuePlayingRps(nowMs)) {
      const res = this.db.transaction((): TimedOutRpsUpdate | null => {
        const latest = this.duelRepo.getRpsById(playing.id);
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
          this.duelRepo.saveRps(cancelled);
          if (latest.bet > 0) {
            this.profileRepo.addCoins(latest.guildId, latest.challengerId, latest.bet);
            this.profileRepo.addCoins(latest.guildId, latest.opponentId, latest.bet);
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
          const bountyClaimed = this.settleCoinsAndStatsInTx({
            guildId: latest.guildId,
            winnerId: roundWinnerId,
            loserId: roundLoserId,
            bet: latest.bet,
            nowMs,
          });
          this.grantNicknameLockInTx({
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
          this.duelRepo.saveRps(completed);
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
        this.duelRepo.saveRps(nextRound);
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

  // ========== 1v1 Russian Roulette ==========

  createRouletteDuel(input: {
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
  }): CreateRouletteDuelResult {
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
      this.creditLoanService?.isDeadbeatBlocked(input.guildId, input.challengerId, nowMs).blocked
    ) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }

    return this.db.transaction((): CreateRouletteDuelResult => {
      const challenger = this.profileRepo.getOrCreate(input.guildId, input.challengerId);
      if (bet > 0 && challenger.coins < bet) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      const challengerBalance = challenger.coins - bet;
      if (bet > 0) {
        this.profileRepo.save({ ...challenger, coins: challengerBalance });
      }

      const duel = this.duelRepo.createRouletteDuel({
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

  bindRouletteDuelMessage(duelId: string, messageId: string): void {
    this.duelRepo.bindRouletteDuelMessageId(duelId, messageId);
  }

  getRouletteDuel(duelId: string): DuelRouletteRecord | null {
    return this.duelRepo.getRouletteDuelById(duelId);
  }

  acceptRouletteDuel(
    duelId: string,
    acceptorId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): AcceptRouletteDuelResult {
    return this.db.transaction((): AcceptRouletteDuelResult => {
      const duel = this.duelRepo.getRouletteDuelById(duelId);
      if (!duel) return { ok: false, reason: 'not_found' };
      if (duel.status === 'expired') return { ok: false, reason: 'expired' };
      if (duel.status !== 'pending') return { ok: false, reason: 'already_resolved' };
      if (duel.expiresAt <= nowMs) {
        const expired: DuelRouletteRecord = { ...duel, status: 'expired', updatedAt: nowMs };
        this.duelRepo.saveRouletteDuel(expired);
        if (duel.bet > 0) {
          this.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
        }
        return { ok: false, reason: 'expired' };
      }
      if (acceptorId !== duel.opponentId) {
        return { ok: false, reason: 'not_opponent' };
      }
      if (
        duel.bet > 0 &&
        (this.creditLoanService?.isDeadbeatBlocked(duel.guildId, acceptorId, nowMs).blocked ||
          this.creditLoanService?.isDeadbeatBlocked(duel.guildId, duel.challengerId, nowMs).blocked)
      ) {
        return { ok: false, reason: 'deadbeat_blocked' };
      }

      if (duel.bet > 0) {
        const opponent = this.profileRepo.getOrCreate(duel.guildId, duel.opponentId);
        if (opponent.coins < duel.bet) {
          return { ok: false, reason: 'opponent_insufficient_funds' };
        }
        this.profileRepo.save({ ...opponent, coins: opponent.coins - duel.bet });
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
      this.duelRepo.saveRouletteDuel(updated);
      return { ok: true, duel: updated };
    })();
  }

  declineRouletteDuel(
    duelId: string,
    actorId: string,
    nowMs = Date.now(),
  ): DeclineRouletteDuelResult {
    return this.db.transaction((): DeclineRouletteDuelResult => {
      const duel = this.duelRepo.getRouletteDuelById(duelId);
      if (!duel) return { ok: false, reason: 'not_found' };
      if (duel.status === 'expired') return { ok: false, reason: 'expired' };
      if (duel.status !== 'pending') return { ok: false, reason: 'already_resolved' };
      if (duel.expiresAt <= nowMs) {
        const expired: DuelRouletteRecord = { ...duel, status: 'expired', updatedAt: nowMs };
        this.duelRepo.saveRouletteDuel(expired);
        if (duel.bet > 0) {
          this.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
        }
        return { ok: false, reason: 'expired' };
      }
      if (actorId !== duel.challengerId && actorId !== duel.opponentId) {
        return { ok: false, reason: 'not_participant' };
      }

      const updated: DuelRouletteRecord = { ...duel, status: 'declined', updatedAt: nowMs };
      this.duelRepo.saveRouletteDuel(updated);
      if (duel.bet > 0) {
        this.profileRepo.addCoins(duel.guildId, duel.challengerId, duel.bet);
      }
      return { ok: true, duel: updated, refunded: duel.bet };
    })();
  }

  pullRouletteDuelTrigger(
    duelId: string,
    actorId: string,
    opts?: { autoTimeout?: boolean; nowMs?: number },
  ): PullRouletteDuelResult {
    const nowMs = opts?.nowMs ?? Date.now();
    const autoTimeout = opts?.autoTimeout ?? false;

    return this.db.transaction((): PullRouletteDuelResult => {
      const duel = this.duelRepo.getRouletteDuelById(duelId);
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
        const bountyClaimed = this.settleCoinsAndStatsInTx({
          guildId: duel.guildId,
          winnerId,
          loserId,
          bet: duel.bet,
          nowMs,
        });
        this.grantNicknameLockInTx({
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
        this.duelRepo.saveRouletteDuel(updated);

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
      this.duelRepo.saveRouletteDuel(updated);

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

  processTimedOutRouletteDuels(nowMs = Date.now()): TimedOutRouletteDuelUpdate[] {
    const updates: TimedOutRouletteDuelUpdate[] = [];

    for (const pending of this.duelRepo.listDuePendingRouletteDuels(nowMs)) {
      const res = this.db.transaction((): TimedOutRouletteDuelUpdate | null => {
        const latest = this.duelRepo.getRouletteDuelById(pending.id);
        if (!latest || latest.status !== 'pending' || latest.expiresAt > nowMs) {
          return null;
        }
        const updated: DuelRouletteRecord = { ...latest, status: 'expired', updatedAt: nowMs };
        this.duelRepo.saveRouletteDuel(updated);
        if (latest.bet > 0) {
          this.profileRepo.addCoins(latest.guildId, latest.challengerId, latest.bet);
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

    for (const playing of this.duelRepo.listDuePlayingRouletteDuels(nowMs)) {
      const latest = this.duelRepo.getRouletteDuelById(playing.id);
      if (
        !latest ||
        latest.status !== 'playing' ||
        latest.turnDeadline <= 0 ||
        latest.turnDeadline > nowMs
      ) {
        continue;
      }
      const res = this.pullRouletteDuelTrigger(latest.id, '', { autoTimeout: true, nowMs });
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

  // ========== Nickname Locks ==========

  getActiveNicknameLock(
    guildId: string,
    targetId: string,
    nowMs = Date.now(),
  ): NicknameLockRecord | null {
    const lock = this.duelRepo.getNicknameLock(guildId, targetId);
    if (!lock || lock.expiresAt <= nowMs) return null;
    return lock;
  }

  listWinnerNicknameLocks(
    guildId: string,
    winnerId: string,
    nowMs = Date.now(),
  ): NicknameLockRecord[] {
    return this.duelRepo.listActiveNicknameLocksByWinner(guildId, winnerId, nowMs);
  }

  validateWinnerRename(
    guildId: string,
    winnerId: string,
    targetId: string,
    rawNickname: string,
    nowMs = Date.now(),
  ): ValidateWinnerRenameResult {
    const nickname = rawNickname.trim();
    if (!nickname || nickname.length > 32) {
      return { ok: false, reason: 'invalid_nickname' };
    }
    const lock = this.getActiveNicknameLock(guildId, targetId, nowMs);
    if (!lock || lock.winnerId !== winnerId) {
      return { ok: false, reason: 'no_lock' };
    }
    const elapsed = nowMs - lock.lastRenamedAt;
    if (lock.lastRenamedAt > 0 && elapsed < RENAME_COOLDOWN_MS) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterSec: Math.max(1, Math.ceil((RENAME_COOLDOWN_MS - elapsed) / 1000)),
      };
    }
    return { ok: true, lock, nickname };
  }

  commitDiscordRename(
    guildId: string,
    targetId: string,
    originalNickname: string | null,
    newNickname: string,
    nowMs = Date.now(),
  ): CommitRenameResult {
    return this.db.transaction((): CommitRenameResult => {
      const lock = this.duelRepo.getNicknameLock(guildId, targetId);
      if (!lock) return { ok: false, reason: 'no_lock' };

      const updated: NicknameLockRecord = {
        ...lock,
        originalNickname: lock.originalNicknameCaptured ? lock.originalNickname : originalNickname,
        originalNicknameCaptured: true,
        lockedNickname: newNickname,
        fallbackMode: false,
        lastRenamedAt: nowMs,
        updatedAt: nowMs,
      };
      this.duelRepo.upsertNicknameLock(updated);
      return { ok: true, lock: updated };
    })();
  }

  commitFallbackRename(
    guildId: string,
    targetId: string,
    newNickname: string,
    nowMs = Date.now(),
  ): CommitRenameResult {
    return this.db.transaction((): CommitRenameResult => {
      const lock = this.duelRepo.getNicknameLock(guildId, targetId);
      if (!lock) return { ok: false, reason: 'no_lock' };

      const profile = this.profileRepo.getOrCreate(guildId, targetId);
      const originalCardNickname = lock.fallbackMode
        ? lock.originalCardNickname
        : profile.cardNickname;
      const originalEquippedTitle = lock.fallbackMode
        ? lock.originalEquippedTitle
        : profile.equippedTitle;

      this.profileRepo.save({
        ...profile,
        cardNickname: newNickname,
        equippedTitle: newNickname,
      });

      const updated: NicknameLockRecord = {
        ...lock,
        lockedNickname: newNickname,
        fallbackMode: true,
        originalCardNickname,
        originalEquippedTitle,
        lastRenamedAt: nowMs,
        updatedAt: nowMs,
      };
      this.duelRepo.upsertNicknameLock(updated);
      return { ok: true, lock: updated };
    })();
  }

  expireDueNicknameLocks(nowMs = Date.now()): NicknameLockRecord[] {
    return this.db.transaction((): NicknameLockRecord[] => {
      const due = this.duelRepo.listDueNicknameLocks(nowMs);
      for (const lock of due) {
        if (lock.fallbackMode) {
          const profile = this.profileRepo.getOrCreate(lock.guildId, lock.targetId);
          this.profileRepo.save({
            ...profile,
            cardNickname: lock.originalCardNickname,
            equippedTitle: lock.originalEquippedTitle,
          });
        }
        this.duelRepo.deleteNicknameLock(lock.guildId, lock.targetId);
      }
      return due;
    })();
  }
}

export function getDuelArenaService(ctx: AppContext): DuelArenaService {
  if (ctx.services.duelArena) {
    return ctx.services.duelArena;
  }
  const duelRepo = ctx.repos.duel ?? new DuelRepo(ctx.db);
  return new DuelArenaService(
    ctx.db,
    ctx.repos.profile,
    duelRepo,
    ctx.repos.chaos,
    ctx.services.creditLoan,
  );
}
