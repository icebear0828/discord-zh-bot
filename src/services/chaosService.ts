import type Database from 'better-sqlite3';
import type {
  BountySummary,
  ChaosRepo,
  NumberBombGame,
  PropKey,
  RouletteGame,
  UserEffect,
  UserPropRowData,
} from '../db/repositories/chaosRepo.js';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { CreditLoanService } from './creditLoanService.js';
import type {
  BuyPropResult,
  CancelRouletteResult,
  ChaosOpsDeps,
  ClearBountyResult,
  CreateBombResult,
  CreateRouletteResult,
  GuessBombResult,
  JoinRouletteResult,
  LeaveRouletteResult,
  PlaceBountyResult,
  PullTriggerResult,
  StartRouletteResult,
  TimedOutRouletteUpdate,
  UseCursePropResult,
  UseSelfPropResult,
} from './chaos/chaosCatalogAndTypes.js';
import {
  createNumberBombOp,
  expireDueNumberBombsOp,
  expireNumberBombIfDueOp,
  guessNumberBombOp,
} from './chaos/numberBombOps.js';
import {
  buyPropOp,
  clearOwnBountyOp,
  placeBountyOp,
  useCursePropOp,
  useSelfPropOp,
} from './chaos/propAndBountyOps.js';
import {
  cancelRouletteOp,
  createRouletteOp,
  expireRouletteIfDueOp,
  joinRouletteOp,
  leaveRouletteOp,
  processTimedOutRoulettesOp,
  pullTriggerOp,
  startRouletteOp,
} from './chaos/russianRouletteOps.js';

export {
  getPropPrice,
  PROP_CATALOG,
  PROP_KEYS,
  type BombPayout,
  type BuyPropResult,
  type CancelRouletteResult,
  type ClearBountyResult,
  type CreateBombResult,
  type CreateRouletteResult,
  type GuessBombResult,
  type JoinRouletteResult,
  type LeaveRouletteResult,
  type PlaceBountyResult,
  type PropDefinition,
  type PullTriggerResult,
  type StartRouletteResult,
  type TimedOutRouletteUpdate,
  type UseCursePropResult,
  type UseSelfPropResult,
} from './chaos/chaosCatalogAndTypes.js';

export class ChaosService {
  private readonly deps: ChaosOpsDeps;

  constructor(
    private readonly db: Database.Database,
    configRepo: GuildConfigRepo,
    profileRepo: ProfileRepo,
    private readonly chaosRepo: ChaosRepo,
    creditLoanService?: CreditLoanService,
  ) {
    this.deps = {
      db,
      configRepo,
      profileRepo,
      chaosRepo,
      creditLoanService,
    };
  }

  listUserProps(guildId: string, userId: string): UserPropRowData[] {
    return this.chaosRepo.listUserProps(guildId, userId);
  }

  getPropQuantity(guildId: string, userId: string, propKey: PropKey): number {
    return this.chaosRepo.getPropQuantity(guildId, userId, propKey);
  }

  hasProp(guildId: string, userId: string, propKey: PropKey): boolean {
    return this.chaosRepo.getPropQuantity(guildId, userId, propKey) > 0;
  }

  consumeProp(guildId: string, userId: string, propKey: PropKey): boolean {
    return this.chaosRepo.consumeProp(guildId, userId, propKey);
  }

  reserveProp(guildId: string, userId: string, propKey: PropKey): boolean {
    return this.db.transaction(() => this.chaosRepo.consumeProp(guildId, userId, propKey))();
  }

  refundProp(guildId: string, userId: string, propKey: PropKey): number {
    return this.db.transaction(() => this.chaosRepo.addProp(guildId, userId, propKey, 1))();
  }

  listActiveEffects(guildId: string, userId: string, nowMs = Date.now()): UserEffect[] {
    return this.chaosRepo.listActiveEffects(guildId, userId, nowMs);
  }

  buyProp(
    guildId: string,
    userId: string,
    propKey: PropKey,
    nowMs = Date.now(),
  ): BuyPropResult {
    return buyPropOp(this.deps, guildId, userId, propKey, nowMs);
  }

  useSelfProp(
    guildId: string,
    userId: string,
    propKey: PropKey,
    nowMs = Date.now(),
  ): UseSelfPropResult {
    return useSelfPropOp(this.deps, guildId, userId, propKey, nowMs);
  }

  useCurseProp(
    guildId: string,
    actorId: string,
    targetId: string,
    nowMs = Date.now(),
  ): UseCursePropResult {
    return useCursePropOp(this.deps, guildId, actorId, targetId, nowMs);
  }

  applyCurse(
    guildId: string,
    actorId: string,
    targetId: string,
    nowMs = Date.now(),
  ): UseCursePropResult {
    return this.useCurseProp(guildId, actorId, targetId, nowMs);
  }

  // Bounties
  placeBounty(
    guildId: string,
    placerId: string,
    targetId: string,
    amount: number,
    nowMs = Date.now(),
  ): PlaceBountyResult {
    return placeBountyOp(this.deps, guildId, placerId, targetId, amount, nowMs);
  }

  clearOwnBounty(guildId: string, userId: string, nowMs = Date.now()): ClearBountyResult {
    return clearOwnBountyOp(this.deps, guildId, userId, nowMs);
  }

  getOpenBountyTotal(guildId: string, targetId: string): number {
    return this.chaosRepo.getOpenBountyTotal(guildId, targetId);
  }

  listActiveBounties(guildId: string, limit = 10): BountySummary[] {
    return this.chaosRepo.listActiveBounties(guildId, limit);
  }

  // Roulette
  createRoulette(input: {
    guildId: string;
    channelId: string;
    hostId: string;
    entryFee: number;
    maxPlayers?: number;
    nowMs?: number;
  }): CreateRouletteResult {
    return createRouletteOp(this.deps, input);
  }

  bindRouletteMessage(gameId: number, messageId: string): void {
    this.chaosRepo.bindRouletteMessageId(gameId, messageId);
  }

  getRoulette(gameId: number): RouletteGame | null {
    return this.chaosRepo.getRouletteById(gameId);
  }

  listActiveRoulettes(guildId: string, limit = 10): RouletteGame[] {
    return this.chaosRepo.listActiveRoulettes(guildId, limit);
  }

  expireRouletteIfDue(gameId: number, nowMs = Date.now()): RouletteGame | null {
    return expireRouletteIfDueOp(this.deps, gameId, nowMs);
  }

  joinRoulette(gameId: number, userId: string, nowMs = Date.now()): JoinRouletteResult {
    return joinRouletteOp(this.deps, gameId, userId, nowMs);
  }

  leaveRoulette(gameId: number, userId: string, nowMs = Date.now()): LeaveRouletteResult {
    return leaveRouletteOp(this.deps, gameId, userId, nowMs);
  }

  cancelRoulette(
    gameId: number,
    actorId: string,
    isAdmin = false,
    nowMs = Date.now(),
  ): CancelRouletteResult {
    return cancelRouletteOp(this.deps, gameId, actorId, isAdmin, nowMs);
  }

  startRoulette(
    gameId: number,
    actorId: string,
    isAdmin = false,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): StartRouletteResult {
    return startRouletteOp(this.deps, gameId, actorId, isAdmin, nowMs, rng);
  }

  pullTrigger(
    gameId: number,
    actorId: string,
    opts?: { autoTimeout?: boolean; nowMs?: number; rng?: () => number },
  ): PullTriggerResult {
    return pullTriggerOp(this.deps, gameId, actorId, opts);
  }

  processTimedOutRoulettes(
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): TimedOutRouletteUpdate[] {
    return processTimedOutRoulettesOp(this.deps, nowMs, rng);
  }

  // Number Bomb
  createNumberBomb(input: {
    guildId: string;
    channelId: string;
    hostId: string;
    penalty: number;
    nowMs?: number;
    rng?: () => number;
  }): CreateBombResult {
    return createNumberBombOp(this.deps, input);
  }

  bindNumberBombMessage(gameId: number, messageId: string): void {
    this.chaosRepo.bindNumberBombMessageId(gameId, messageId);
  }

  getNumberBomb(gameId: number): NumberBombGame | null {
    return this.chaosRepo.getNumberBombById(gameId);
  }

  listOpenNumberBombs(guildId: string, limit = 10): NumberBombGame[] {
    return this.chaosRepo.listOpenNumberBombs(guildId, limit);
  }

  cancelNumberBomb(gameId: number): boolean {
    return this.chaosRepo.cancelNumberBombById(gameId);
  }

  expireNumberBombIfDue(gameId: number, nowMs = Date.now()): NumberBombGame | null {
    return expireNumberBombIfDueOp(this.deps, gameId, nowMs);
  }

  guessNumberBomb(
    gameId: number,
    userId: string,
    rawGuess: number,
    nowMs = Date.now(),
  ): GuessBombResult {
    return guessNumberBombOp(this.deps, gameId, userId, rawGuess, nowMs);
  }

  expireDueNumberBombs(nowMs = Date.now()): NumberBombGame[] {
    return expireDueNumberBombsOp(this.deps, nowMs);
  }
}
