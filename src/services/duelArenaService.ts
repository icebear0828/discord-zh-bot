import type Database from 'better-sqlite3';
import type { AppContext } from '../core/context.js';
import type { ChaosRepo } from '../db/repositories/chaosRepo.js';
import {
  DuelRepo,
  type DuelRouletteRecord,
  type NicknameLockRecord,
  type RpsDuelRecord,
  type RpsMove,
} from '../db/repositories/duelRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { CreditLoanService } from './creditLoanService.js';
import {
  RENAME_COOLDOWN_MS,
  type AcceptRouletteDuelResult,
  type AcceptRpsDuelResult,
  type CommitRenameResult,
  type CreateRouletteDuelResult,
  type CreateRpsDuelResult,
  type DeclineRouletteDuelResult,
  type DeclineRpsDuelResult,
  type DuelArenaDeps,
  type PullRouletteDuelResult,
  type SubmitRpsMoveResult,
  type TimedOutRouletteDuelUpdate,
  type TimedOutRpsUpdate,
  type ValidateWinnerRenameResult,
} from './duelArena/duelArenaTypes.js';
import {
  acceptRouletteDuelOp,
  createRouletteDuelOp,
  declineRouletteDuelOp,
  processTimedOutRouletteDuelsOp,
  pullRouletteDuelTriggerOp,
} from './duelArena/rouletteDuelOps.js';
import {
  acceptRpsDuelOp,
  createRpsDuelOp,
  declineRpsDuelOp,
  processTimedOutRpsDuelsOp,
  submitRpsMoveOp,
} from './duelArena/rpsDuelOps.js';

export {
  formatRpsMoveLabel,
  MAX_CUSTOM_WAGER_LEN,
  RENAME_COOLDOWN_MS,
  ROULETTE_1V1_INVITE_TTL_MS,
  ROULETTE_1V1_TURN_TTL_MS,
  RPS_INVITE_TTL_MS,
  RPS_ROUND_TTL_MS,
  RPS_WINS_NEEDED,
  VALID_RENAME_HOURS,
  VALID_TIMEOUT_MINUTES,
  type AcceptRouletteDuelResult,
  type AcceptRpsDuelResult,
  type CommitRenameResult,
  type CreateRouletteDuelResult,
  type CreateRpsDuelResult,
  type DeclineRouletteDuelResult,
  type DeclineRpsDuelResult,
  type PullRouletteDuelResult,
  type SubmitRpsMoveResult,
  type TimedOutRouletteDuelUpdate,
  type TimedOutRpsUpdate,
  type ValidateWinnerRenameResult,
} from './duelArena/duelArenaTypes.js';

export class DuelArenaService {
  private readonly deps: DuelArenaDeps;

  constructor(
    private readonly db: Database.Database,
    private readonly profileRepo: ProfileRepo,
    private readonly duelRepo: DuelRepo,
    chaosRepo?: ChaosRepo,
    creditLoanService?: CreditLoanService,
  ) {
    this.deps = {
      db,
      profileRepo,
      duelRepo,
      chaosRepo,
      creditLoanService,
    };
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
    return createRpsDuelOp(this.deps, input);
  }

  bindRpsMessage(duelId: string, messageId: string): void {
    this.duelRepo.bindRpsMessageId(duelId, messageId);
  }

  getRpsDuel(duelId: string): RpsDuelRecord | null {
    return this.duelRepo.getRpsById(duelId);
  }

  acceptRpsDuel(duelId: string, acceptorId: string, nowMs = Date.now()): AcceptRpsDuelResult {
    return acceptRpsDuelOp(this.deps, duelId, acceptorId, nowMs);
  }

  declineRpsDuel(duelId: string, actorId: string, nowMs = Date.now()): DeclineRpsDuelResult {
    return declineRpsDuelOp(this.deps, duelId, actorId, nowMs);
  }

  submitRpsMove(
    duelId: string,
    userId: string,
    move: RpsMove,
    nowMs = Date.now(),
  ): SubmitRpsMoveResult {
    return submitRpsMoveOp(this.deps, duelId, userId, move, nowMs);
  }

  processTimedOutRpsDuels(nowMs = Date.now()): TimedOutRpsUpdate[] {
    return processTimedOutRpsDuelsOp(this.deps, nowMs);
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
    return createRouletteDuelOp(this.deps, input);
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
    return acceptRouletteDuelOp(this.deps, duelId, acceptorId, nowMs, rng);
  }

  declineRouletteDuel(
    duelId: string,
    actorId: string,
    nowMs = Date.now(),
  ): DeclineRouletteDuelResult {
    return declineRouletteDuelOp(this.deps, duelId, actorId, nowMs);
  }

  pullRouletteDuelTrigger(
    duelId: string,
    actorId: string,
    opts?: { autoTimeout?: boolean; nowMs?: number },
  ): PullRouletteDuelResult {
    return pullRouletteDuelTriggerOp(this.deps, duelId, actorId, opts);
  }

  processTimedOutRouletteDuels(nowMs = Date.now()): TimedOutRouletteDuelUpdate[] {
    return processTimedOutRouletteDuelsOp(this.deps, nowMs);
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
