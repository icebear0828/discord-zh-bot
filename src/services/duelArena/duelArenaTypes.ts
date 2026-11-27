import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  DUEL_BOUNTY_MIN_BET,
  DUEL_BOUNTY_MIN_BET_RATIO,
} from '../../config/economyConstants.js';
import type { ChaosRepo } from '../../db/repositories/chaosRepo.js';
import type {
  DuelRepo,
  DuelRouletteRecord,
  NicknameLockRecord,
  NicknameLockSourceType,
  RpsDuelRecord,
  RpsMove,
  RpsRoundEntry,
} from '../../db/repositories/duelRepo.js';
import type { ProfileRepo } from '../../db/repositories/profileRepo.js';
import type { CreditLoanService } from '../creditLoanService.js';

export const VALID_RENAME_HOURS = [1, 6, 24] as const;
export const VALID_TIMEOUT_MINUTES = [5, 10, 30] as const;
export const RPS_INVITE_TTL_MS = 5 * 60 * 1000;
export const RPS_ROUND_TTL_MS = 60 * 1000;
export const RPS_WINS_NEEDED = 3;
export const ROULETTE_1V1_INVITE_TTL_MS = 5 * 60 * 1000;
export const ROULETTE_1V1_TURN_TTL_MS = 30 * 1000;
export const RENAME_COOLDOWN_MS = 10 * 1000;
export const MAX_CUSTOM_WAGER_LEN = 100;

export interface DuelArenaDeps {
  db: Database.Database;
  profileRepo: ProfileRepo;
  duelRepo: DuelRepo;
  chaosRepo?: ChaosRepo;
  creditLoanService?: CreditLoanService;
}

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

export function isValidRenameHours(hours: number, allowZero: boolean): boolean {
  if (allowZero && hours === 0) return true;
  return (VALID_RENAME_HOURS as readonly number[]).includes(hours);
}

export function isValidTimeoutMinutes(minutes: number): boolean {
  if (minutes === 0) return true;
  return (VALID_TIMEOUT_MINUTES as readonly number[]).includes(minutes);
}

export function resolveRpsWinner(
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

export function generateArenaId(prefix: string): string {
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

export function claimEligibleBounty(
  deps: DuelArenaDeps,
  guildId: string,
  loserId: string,
  winnerId: string,
  bet: number,
  nowMs: number,
): number {
  if (!deps.chaosRepo || bet <= 0) return 0;
  const openBounty = deps.chaosRepo.getOpenBountyTotal(guildId, loserId);
  if (openBounty <= 0) return 0;
  const minBet = Math.max(
    DUEL_BOUNTY_MIN_BET,
    Math.floor(openBounty * DUEL_BOUNTY_MIN_BET_RATIO),
  );
  if (bet < minBet) return 0;
  return deps.chaosRepo.claimOpenBounties(guildId, loserId, winnerId, nowMs);
}

export function settleCoinsAndStatsInTx(
  deps: DuelArenaDeps,
  input: {
    guildId: string;
    winnerId: string;
    loserId: string;
    bet: number;
    nowMs: number;
  },
): number {
  if (input.bet <= 0) return 0;
  const bountyClaimed = claimEligibleBounty(
    deps,
    input.guildId,
    input.loserId,
    input.winnerId,
    input.bet,
    input.nowMs,
  );
  deps.profileRepo.addCoins(input.guildId, input.winnerId, input.bet * 2 + bountyClaimed);
  deps.creditLoanService?.recordGamblingResult(
    input.guildId,
    input.winnerId,
    input.bet,
    input.bet,
    input.nowMs,
  );
  deps.creditLoanService?.recordGamblingResult(
    input.guildId,
    input.loserId,
    input.bet,
    -input.bet,
    input.nowMs,
  );
  return bountyClaimed;
}

export function grantNicknameLockInTx(
  deps: DuelArenaDeps,
  input: {
    guildId: string;
    targetId: string;
    winnerId: string;
    sourceType: NicknameLockSourceType;
    sourceId: string;
    durationMs: number;
    nowMs: number;
  },
): void {
  if (input.durationMs <= 0) return;
  const existing = deps.duelRepo.getNicknameLock(input.guildId, input.targetId);
  const preserveActive = existing !== null && existing.expiresAt > input.nowMs;

  deps.duelRepo.upsertNicknameLock({
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
