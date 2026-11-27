import type Database from 'better-sqlite3';
import {
  bindDuelChallengeMessageId,
  cleanupOldFinishedDuelChallenges,
  createDuelChallenge,
  getDuelChallengeById,
  listDuePendingDuelChallenges,
  updateDuelChallengeStatus,
} from './duel/diceDuelQueries.js';
import {
  bindRouletteDuelMessageId,
  bindRpsDuelMessageId,
  createRouletteDuelRecord,
  createRpsDuel,
  deleteNicknameLock,
  getNicknameLock,
  getRouletteDuelById,
  getRpsDuelById,
  listActiveNicknameLocksByWinner,
  listDueNicknameLocks,
  listDuePendingRouletteDuels,
  listDuePendingRpsDuels,
  listDuePlayingRouletteDuels,
  listDuePlayingRpsDuels,
  saveRouletteDuel,
  saveRpsDuel,
  upsertNicknameLock,
} from './duel/rpsRouletteLockQueries.js';
import type {
  DuelChallengeRecord,
  DuelChallengeStatus,
  DuelRouletteRecord,
  NicknameLockRecord,
  RpsDuelRecord,
} from './duel/duelTypesAndSchema.js';

export {
  DUEL_SCHEMA_SQL,
  initDuelSchema,
  type DuelChallengeRecord,
  type DuelChallengeStatus,
  type DuelRouletteRecord,
  type DuelRouletteStatus,
  type NicknameLockRecord,
  type NicknameLockSourceType,
  type RpsDuelRecord,
  type RpsDuelStatus,
  type RpsMove,
  type RpsRoundEntry,
} from './duel/duelTypesAndSchema.js';

export class DuelRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    id: string;
    guildId: string;
    channelId: string;
    messageId?: string | null;
    challengerId: string;
    opponentId: string;
    bet: number;
    status?: DuelChallengeStatus;
    createdAt: number;
    expiresAt: number;
  }): DuelChallengeRecord {
    return createDuelChallenge(this.db, input);
  }

  getById(id: string): DuelChallengeRecord | null {
    return getDuelChallengeById(this.db, id);
  }

  bindMessageId(id: string, messageId: string): boolean {
    return bindDuelChallengeMessageId(this.db, id, messageId);
  }

  updateStatus(
    id: string,
    status: DuelChallengeStatus,
    expectedCurrentStatus?: DuelChallengeStatus,
  ): boolean {
    return updateDuelChallengeStatus(this.db, id, status, expectedCurrentStatus);
  }

  listDuePending(nowMs: number): DuelChallengeRecord[] {
    return listDuePendingDuelChallenges(this.db, nowMs);
  }

  cleanupOldFinished(beforeMs: number): number {
    return cleanupOldFinishedDuelChallenges(this.db, beforeMs);
  }

  // ========== RPS Duels ==========

  createRps(input: {
    id: string;
    guildId: string;
    channelId: string;
    messageId?: string | null;
    challengerId: string;
    opponentId: string;
    bet: number;
    renameDurationMs: number;
    createdAt: number;
    expiresAt: number;
  }): RpsDuelRecord {
    return createRpsDuel(this.db, input);
  }

  getRpsById(id: string): RpsDuelRecord | null {
    return getRpsDuelById(this.db, id);
  }

  bindRpsMessageId(id: string, messageId: string): boolean {
    return bindRpsDuelMessageId(this.db, id, messageId);
  }

  saveRps(duel: RpsDuelRecord): void {
    saveRpsDuel(this.db, duel);
  }

  listDuePendingRps(nowMs: number): RpsDuelRecord[] {
    return listDuePendingRpsDuels(this.db, nowMs);
  }

  listDuePlayingRps(nowMs: number): RpsDuelRecord[] {
    return listDuePlayingRpsDuels(this.db, nowMs);
  }

  // ========== 1v1 Roulette Duels ==========

  createRouletteDuel(input: {
    id: string;
    guildId: string;
    channelId: string;
    messageId?: string | null;
    challengerId: string;
    opponentId: string;
    bullets: number;
    bet: number;
    renameDurationMs: number;
    timeoutDurationMs: number;
    customWager: string;
    createdAt: number;
    expiresAt: number;
  }): DuelRouletteRecord {
    return createRouletteDuelRecord(this.db, input);
  }

  getRouletteDuelById(id: string): DuelRouletteRecord | null {
    return getRouletteDuelById(this.db, id);
  }

  bindRouletteDuelMessageId(id: string, messageId: string): boolean {
    return bindRouletteDuelMessageId(this.db, id, messageId);
  }

  saveRouletteDuel(duel: DuelRouletteRecord): void {
    saveRouletteDuel(this.db, duel);
  }

  listDuePendingRouletteDuels(nowMs: number): DuelRouletteRecord[] {
    return listDuePendingRouletteDuels(this.db, nowMs);
  }

  listDuePlayingRouletteDuels(nowMs: number): DuelRouletteRecord[] {
    return listDuePlayingRouletteDuels(this.db, nowMs);
  }

  // ========== Nickname Locks ==========

  getNicknameLock(guildId: string, targetId: string): NicknameLockRecord | null {
    return getNicknameLock(this.db, guildId, targetId);
  }

  upsertNicknameLock(lock: NicknameLockRecord): void {
    upsertNicknameLock(this.db, lock);
  }

  listActiveNicknameLocksByWinner(
    guildId: string,
    winnerId: string,
    nowMs: number,
  ): NicknameLockRecord[] {
    return listActiveNicknameLocksByWinner(this.db, guildId, winnerId, nowMs);
  }

  listDueNicknameLocks(nowMs: number): NicknameLockRecord[] {
    return listDueNicknameLocks(this.db, nowMs);
  }

  deleteNicknameLock(guildId: string, targetId: string): boolean {
    return deleteNicknameLock(this.db, guildId, targetId);
  }
}
