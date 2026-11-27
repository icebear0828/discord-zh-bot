import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { SocialPetRepo } from '../db/repositories/socialPetRepo.js';
import type {
  Prediction,
  PredictionStatus,
  WorldEvent,
  WorldEventParticipant,
  WorldEventRepo,
} from '../db/repositories/worldEventRepo.js';
import type { CreditLoanService } from './creditLoanService.js';
import {
  autoLockDuePredictionsOp,
  cancelPredictionOp,
  createPredictionOp,
  expireDueLockedPredictionsOp,
  getPredictionSummaryOp,
  listPredictionsPaginatedOp,
  lockPredictionIfDueOp,
  lockPredictionOp,
  placeBetOp,
  settlePredictionOp,
} from './worldEvent/predictionOps.js';
import {
  attackBossOp,
  claimChestOp,
  expireDueWorldEventsOp,
  expireWorldEventIfDueOp,
  spawnBossOp,
  spawnChestOp,
  tryAutoSpawnOnMessageOp,
} from './worldEvent/worldChestAndBossOps.js';
import type {
  AttackBossResult,
  BossAttackMode,
  CancelPredictionResult,
  ClaimChestResult,
  CreatePredictionResult,
  ExpiredLockedPredictionResult,
  ExpiredWorldEventResult,
  LockPredictionResult,
  PlaceBetResult,
  PredictionSummary,
  RpgWorldBossBridge,
  SettlePredictionResult,
  WorldEventOpsDeps,
  WorldEventRuntimeState,
} from './worldEvent/worldEventTypesAndCatalog.js';

export {
  RPG_BOSS_HEAVY_BONUS_CAP,
  RPG_BOSS_NORMAL_BONUS_CAP,
  type AttackBossResult,
  type BossAttackMode,
  type BossRewardEntry,
  type CancelPredictionResult,
  type ClaimChestResult,
  type CreatePredictionResult,
  type ExpiredLockedPredictionResult,
  type ExpiredWorldEventResult,
  type LockPredictionResult,
  type PlaceBetResult,
  type PredictionOptionStat,
  type PredictionPayout,
  type PredictionSummary,
  type RpgWorldBossBonus,
  type RpgWorldBossBridge,
  type SettlePredictionResult,
} from './worldEvent/worldEventTypesAndCatalog.js';

export class WorldEventService {
  private readonly state: WorldEventRuntimeState;
  private readonly deps: WorldEventOpsDeps;

  constructor(
    db: Database.Database,
    configRepo: GuildConfigRepo,
    profileRepo: ProfileRepo,
    private readonly worldEventRepo: WorldEventRepo,
    socialPetRepo?: SocialPetRepo,
    creditLoanService?: CreditLoanService,
    rpgBridge?: RpgWorldBossBridge,
  ) {
    this.deps = {
      db,
      configRepo,
      profileRepo,
      worldEventRepo,
      socialPetRepo,
      creditLoanService,
    };
    this.state = {
      guildMsgCounts: new Map<string, number>(),
      lastAutoEventAt: new Map<string, number>(),
      rpgBridge,
    };
  }

  setRpgBridge(bridge: RpgWorldBossBridge | undefined): void {
    this.state.rpgBridge = bridge;
  }

  // Predictions
  getPredictionSummary(predictionId: number): PredictionSummary | null {
    return getPredictionSummaryOp(this.deps, predictionId);
  }

  listPredictions(
    guildId: string,
    statuses: readonly PredictionStatus[] = ['open', 'locked'],
    limit = 15,
  ): Prediction[] {
    return this.worldEventRepo.listPredictionsByGuild(guildId, statuses, limit);
  }

  listPredictionsPaginated(
    guildId: string,
    page: number,
    pageSize: number,
    statuses: readonly PredictionStatus[] = ['open', 'locked'],
  ): { items: Prediction[]; total: number; page: number; totalPages: number } {
    return listPredictionsPaginatedOp(this.deps, guildId, page, pageSize, statuses);
  }

  createPrediction(input: {
    guildId: string;
    channelId: string;
    creatorId: string;
    title: string;
    options: string[];
    closeMinutes: number;
    nowMs?: number;
  }): CreatePredictionResult {
    return createPredictionOp(this.deps, input);
  }

  bindPredictionMessage(predictionId: number, messageId: string, channelId?: string): void {
    this.worldEventRepo.bindPredictionMessage(predictionId, messageId, channelId);
  }

  placeBet(input: {
    predictionId: number;
    userId: string;
    optionIndex: number;
    amount: number;
    nowMs?: number;
  }): PlaceBetResult {
    return placeBetOp(this.deps, input);
  }

  lockPrediction(
    predictionId: number,
    actorId: string,
    isAdmin = false,
    nowMs = Date.now(),
  ): LockPredictionResult {
    return lockPredictionOp(this.deps, predictionId, actorId, isAdmin, nowMs);
  }

  lockPredictionIfDue(predictionId: number, nowMs = Date.now()): PredictionSummary | null {
    return lockPredictionIfDueOp(this.deps, predictionId, nowMs);
  }

  settlePrediction(
    predictionId: number,
    actorId: string,
    isAdmin: boolean,
    winningOption: number,
    nowMs = Date.now(),
  ): SettlePredictionResult {
    return settlePredictionOp(this.deps, predictionId, actorId, isAdmin, winningOption, nowMs);
  }

  cancelPrediction(
    predictionId: number,
    actorId: string,
    isAdmin = false,
    nowMs = Date.now(),
  ): CancelPredictionResult {
    return cancelPredictionOp(this.deps, predictionId, actorId, isAdmin, nowMs);
  }

  autoLockDuePredictions(nowMs = Date.now()): PredictionSummary[] {
    return autoLockDuePredictionsOp(this.deps, nowMs);
  }

  expireDueLockedPredictions(nowMs = Date.now()): ExpiredLockedPredictionResult[] {
    return expireDueLockedPredictionsOp(this.deps, nowMs);
  }

  // World Events (Chest & Boss)
  getActiveWorldEvent(guildId: string): WorldEvent | null {
    return this.worldEventRepo.getActiveWorldEvent(guildId);
  }

  listActiveWorldEvents(guildId: string, limit?: number): WorldEvent[] {
    return this.worldEventRepo.listActiveWorldEvents(guildId, limit);
  }

  getWorldEventDetail(eventId: number): {
    event: WorldEvent;
    participants: WorldEventParticipant[];
  } | null {
    const event = this.worldEventRepo.getWorldEventById(eventId);
    if (!event) return null;
    const participants = this.worldEventRepo.listParticipants(eventId);
    return { event, participants };
  }

  listRecentWorldEvents(guildId: string, limit = 5): WorldEvent[] {
    return this.worldEventRepo.listRecentWorldEvents(guildId, limit);
  }

  tryAutoSpawnOnMessage(
    guildId: string,
    fallbackChannelId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): WorldEvent | null {
    return tryAutoSpawnOnMessageOp(this.deps, this.state, guildId, fallbackChannelId, nowMs, rng);
  }

  spawnChest(
    guildId: string,
    channelId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): WorldEvent {
    return spawnChestOp(this.deps, this.state, guildId, channelId, nowMs, rng);
  }

  spawnBoss(
    guildId: string,
    channelId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): WorldEvent {
    return spawnBossOp(this.deps, this.state, guildId, channelId, nowMs, rng);
  }

  bindWorldEventMessage(eventId: number, messageId: string, channelId?: string): void {
    this.worldEventRepo.bindWorldEventMessage(eventId, messageId, channelId);
  }

  claimChest(
    eventId: number,
    userId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): ClaimChestResult {
    return claimChestOp(this.deps, eventId, userId, nowMs, rng);
  }

  attackBoss(
    eventId: number,
    userId: string,
    mode: BossAttackMode,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): AttackBossResult {
    return attackBossOp(this.deps, this.state, eventId, userId, mode, nowMs, rng);
  }

  expireWorldEventIfDue(eventId: number, nowMs = Date.now()): ExpiredWorldEventResult | null {
    return expireWorldEventIfDueOp(this.deps, eventId, nowMs);
  }

  expireDueWorldEvents(nowMs = Date.now()): ExpiredWorldEventResult[] {
    return expireDueWorldEventsOp(this.deps, nowMs);
  }
}
