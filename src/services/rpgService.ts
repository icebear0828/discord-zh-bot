import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type {
  RpgCharacter,
  RpgClassKey,
  RpgDuel,
  RpgDuelRulesMode,
  RpgItem,
  RpgRaid,
  RpgRepo,
  RpgTrial,
} from '../db/repositories/rpgRepo.js';
import type { SocialPetRepo } from '../db/repositories/socialPetRepo.js';
import { awakenLegacyItemAffixes } from './rpgAffixes.js';
import { buildHeroCombatantSnapshot, type CombatantSnapshot } from './rpgCombatEngine.js';
import * as arenaOps from './rpg/rpgArenaAndDuelOps.js';
import * as blacksmithOps from './rpg/rpgBlacksmithOps.js';
import * as bossOps from './rpg/rpgBossAndWorldBridgeOps.js';
import * as charOps from './rpg/rpgCharacterAndIdleOps.js';
import * as coopOps from './rpg/rpgCoopRaidOps.js';
import { computeCombatStatsFromData, computeStarterBackfillDust } from './rpg/rpgPureMath.js';
import * as trialOps from './rpg/rpgTrialOps.js';
import {
  DEFAULT_CREDIT_SCORE,
  DEFAULT_RPG_CONFIG,
  type AcceptPublicDuelResult,
  type ArenaDailyRewardPreview,
  type BreakthroughPreview,
  type BuyAlchemyItemResult,
  type BuyStaminaPotionResult,
  type CancelPublicDuelResult,
  type ChallengeArenaResult,
  type ChooseClassResult,
  type ClaimDailyArenaRewardResult,
  type ClaimIdleHarvestResult,
  type CombatStats,
  type ConfigureTrialLoadoutResult,
  type CreatePublicDuelResult,
  type HealInjuryResult,
  type IdleHarvestPreview,
  type InteractPublicTrialResult,
  type RpgConfig,
  type RpgOpsContext,
  type RpgServiceOptions,
  type RpgWorldBossBridge,
  type SettlePublicTrialResult,
  type SoloBreakthroughResult,
  type StartPublicTrialResult,
} from './rpg/rpgTypesAndConfig.js';

export {
  COOP_RECRUIT_TTL_MS,
  DAILY_ARENA_FIGHTS,
  DAILY_COOP_TICKETS,
  DEFAULT_CREDIT_SCORE,
  DEFAULT_RPG_CONFIG,
  GUARD_ELIXIR_DAILY_LIMIT,
  GUARD_ELIXIR_PRICE,
  INJURY_DURATION_MS,
  MAX_COOP_PARTY_SIZE,
  MAX_ENHANCE_LEVEL,
  MAX_IDLE_ACCRUE_MS,
  MAX_RPG_DUEL_BET,
  MAX_RPG_LEVEL,
  MAX_TRIAL_PILLS,
  MAX_TRIAL_SABOTEURS,
  MAX_TRIAL_SUPPORTERS,
  MIN_COOP_PARTY_SIZE,
  MIN_IDLE_CLAIM_MS,
  PITY_BONUS_PER_FAIL_PCT,
  PROMO_PILL_BONUS_PCT,
  PROMO_PILL_DAILY_LIMIT,
  PROMO_PILL_PRICE,
  PUBLIC_DUEL_TTL_MS,
  PUBLIC_TRIAL_DURATION_MS,
  SABOTEUR_PENALTY_PCT,
  SABOTEUR_POOL_BONUS_PCT,
  STAGES_PER_TIER,
  SUPPORTER_BONUS_PCT,
  WORLD_BOSS_HEAVY_BONUS_CAP,
  WORLD_BOSS_NORMAL_BONUS_CAP,
  type AcceptPublicDuelResult,
  type ArenaDailyRewardPreview,
  type BreakthroughPreview,
  type BuyAlchemyItemResult,
  type BuyStaminaPotionResult,
  type CancelPublicDuelResult,
  type ChallengeArenaResult,
  type ChooseClassResult,
  type ClaimDailyArenaRewardResult,
  type ClaimIdleHarvestResult,
  type CombatStats,
  type ConfigureTrialLoadoutResult,
  type CreatePublicDuelResult,
  type EffectiveItemStats,
  type HealInjuryResult,
  type IdleHarvestPreview,
  type InteractPublicTrialResult,
  type PendingRpgItem,
  type PetSynergyInfo,
  type RpgCombatStats,
  type RpgConfig,
  type RpgLootSource,
  type RpgServiceOptions,
  type RpgWorldBossBonus,
  type RpgWorldBossBridge,
  type SettlePublicTrialResult,
  type SoloBreakthroughResult,
  type StartPublicTrialResult,
  type SupporterPayout,
} from './rpg/rpgTypesAndConfig.js';

export {
  RPG_CLASSES,
  RPG_CLASS_MAP,
  RPG_TIERS,
  RPG_TIER_MAP,
  type RpgClassDef,
  type RpgRealmInfo,
  type RpgTierDef,
} from './rpg/rpgCatalogClassesAndTiers.js';

export {
  generateShopRpgLoot,
  generateTierItem,
  RARITY_META,
  RARITY_ORDER,
} from './rpg/rpgCatalogBossesAndItems.js';

export {
  applyCharacterXp,
  computeHealInjuryCost,
  computeIdlePowerMultiplier,
  computeItemEffectiveStats,
  computeItemScore,
  computeTrialEffectiveRate,
  getArenaTierLabel,
  getEnhanceInfo,
  getRpgRealmInfo,
  getSalvageValue,
  isAtBreakthroughGate,
  xpNeededForRpgLevel,
} from './rpg/rpgPureMath.js';

export type {
  BulkSalvageItemsResult,
  EnhanceItemResult,
  EquipBestGearChange,
  EquipBestGearResult,
  EquipItemResult,
  ReforgeItemAffixesResult,
  SalvageItemResult,
  ToggleItemLockResult,
  UnequipItemResult,
} from './rpg/rpgBlacksmithOps.js';

export type { ChallengeAbyssBossResult, RaidBossResult } from './rpg/rpgBossAndWorldBridgeOps.js';
export type {
  JoinCoopRaidResult,
  LaunchCoopRaidResult,
  StartCoopRaidResult,
} from './rpg/rpgCoopRaidOps.js';

export class RpgService {
  private readonly config: RpgConfig;
  private readonly configOverrides?: Partial<RpgConfig>;
  private readonly timezone: string;
  private readonly guildConfigRepo?: GuildConfigRepo;
  private readonly socialPetRepo?: SocialPetRepo;
  private readonly creditLoanService?: RpgServiceOptions['creditLoanService'];
  private readonly isGamblingBlockedHook?: RpgServiceOptions['isGamblingBlocked'];
  private readonly recordGamblingResultHook?: RpgServiceOptions['recordGamblingResult'];
  private readonly onCoinsEarned?: RpgServiceOptions['onCoinsEarned'];
  private readonly onCreditChange?: RpgServiceOptions['onCreditChange'];
  private readonly getCreditScore?: RpgServiceOptions['getCreditScore'];
  private readonly opsCtx: RpgOpsContext;

  constructor(
    private readonly db: Database.Database,
    private readonly rpgRepo: RpgRepo,
    private readonly profileRepo: ProfileRepo,
    options: RpgServiceOptions = {},
  ) {
    this.configOverrides = options.config;
    this.config = { ...DEFAULT_RPG_CONFIG, ...options.config };
    this.timezone = options.timezone ?? 'Asia/Shanghai';
    this.guildConfigRepo = options.guildConfigRepo;
    this.socialPetRepo = options.socialPetRepo;
    this.creditLoanService = options.creditLoanService;
    this.isGamblingBlockedHook = options.isGamblingBlocked;
    this.recordGamblingResultHook = options.recordGamblingResult;
    this.onCoinsEarned = options.onCoinsEarned;
    this.onCreditChange = options.onCreditChange;
    this.getCreditScore = options.getCreditScore;

    this.opsCtx = {
      db: this.db,
      rpgRepo: this.rpgRepo,
      profileRepo: this.profileRepo,
      timezone: this.timezone,
      socialPetRepo: this.socialPetRepo,
      onCreditChange: this.onCreditChange,
      getConfig: (guildId) => this.getConfig(guildId),
      getUserCreditScore: (guildId, userId) => this.getUserCreditScore(guildId, userId),
      checkGamblingBlocked: (guildId, userId, nowMs) => this.checkGamblingBlocked(guildId, userId, nowMs),
      emitGamblingResult: (guildId, userId, stake, netProfit, nowMs) =>
        this.emitGamblingResult(guildId, userId, stake, netProfit, nowMs),
      applyCoinRewardInTx: (guildId, userId, rawCoins, source, nowMs) =>
        this.applyCoinRewardInTx(guildId, userId, rawCoins, source, nowMs),
      resolveHeroDisplayName: (guildId, userId) => this.resolveHeroDisplayName(guildId, userId),
      computeCombatStatsForCharacter: (ch) => this.computeCombatStatsForCharacter(ch),
      buildCombatantForCharacter: (ch, customName) => this.buildCombatantForCharacter(ch, customName),
      getOrCreateCharacterInTx: (guildId, userId, nowMs) =>
        charOps.getOrCreateCharacterInTx(this.opsCtx, guildId, userId, nowMs),
      refreshCharacterInTx: (ch, today, nowMs) => charOps.refreshCharacterInTx(this.opsCtx, ch, today, nowMs),
      bankLootInTx: (input) => bossOps.bankLootInTx(this.opsCtx, input),
    };

    this.awakenLegacyDataInTx();
  }

  awakenLegacyData(): { awakenedItems: number; backfilledCharacters: number } {
    return this.awakenLegacyDataInTx();
  }

  private awakenLegacyDataInTx(): { awakenedItems: number; backfilledCharacters: number } {
    return this.db.transaction(() => {
      let awakenedItems = 0;
      for (const item of this.rpgRepo.listUnawakenedItems()) {
        const { affixes, legendaryEffect } = awakenLegacyItemAffixes({ id: item.id, rarity: item.rarity });
        this.rpgRepo.updateItemAffixes(item.id, affixes, legendaryEffect, true);
        awakenedItems += 1;
      }
      let backfilledCharacters = 0;
      for (const ch of this.rpgRepo.listUnbackfilledCharacters()) {
        if (this.rpgRepo.backfillCharacterDust(ch.guildId, ch.userId, computeStarterBackfillDust(ch))) {
          backfilledCharacters += 1;
        }
      }
      return { awakenedItems, backfilledCharacters };
    })();
  }

  private checkGamblingBlocked(guildId: string, userId: string, nowMs: number): boolean {
    if (this.isGamblingBlockedHook) return Boolean(this.isGamblingBlockedHook(guildId, userId, nowMs));
    if (this.creditLoanService) return this.creditLoanService.isDeadbeatBlocked(guildId, userId, nowMs).blocked;
    return false;
  }

  private emitGamblingResult(guildId: string, userId: string, stake: number, netProfit: number, nowMs: number): void {
    if (stake <= 0) return;
    if (this.recordGamblingResultHook) {
      this.recordGamblingResultHook(guildId, userId, stake, netProfit, nowMs);
      return;
    }
    if (this.creditLoanService) this.creditLoanService.recordGamblingResult(guildId, userId, stake, netProfit, nowMs);
  }

  private applyCoinRewardInTx(guildId: string, userId: string, rawCoins: number, source: string, nowMs: number) {
    const grossCoins = Math.max(0, Math.floor(rawCoins));
    let garnishedCoins = 0;
    let netCoins = grossCoins;
    if (grossCoins > 0 && this.onCoinsEarned) {
      const hookRes = this.onCoinsEarned(guildId, userId, grossCoins, source, nowMs);
      garnishedCoins = Math.max(0, Math.floor(hookRes.garnished));
      netCoins = Math.max(0, Math.floor(hookRes.net));
    }
    const updatedProfile =
      netCoins > 0 ? this.profileRepo.addCoins(guildId, userId, netCoins) : this.profileRepo.getOrCreate(guildId, userId);
    return { grossCoins, garnishedCoins, netCoins, balance: updatedProfile.coins };
  }

  private resolveHeroDisplayName(guildId: string, userId: string): string {
    const nick = this.profileRepo.getOrCreate(guildId, userId).cardNickname?.trim();
    return nick && nick.length > 0 ? nick : `<@${userId}>`;
  }

  private computeCombatStatsForCharacter(character: RpgCharacter): CombatStats {
    const equippedItems = this.rpgRepo.listEquippedItems(character.guildId, character.userId);
    const activePet = this.socialPetRepo?.getActivePet(character.guildId, character.userId) ?? null;
    return computeCombatStatsFromData(character, equippedItems, activePet);
  }

  buildCombatantForCharacter(character: RpgCharacter, customName?: string): CombatantSnapshot {
    const stats = this.computeCombatStatsForCharacter(character);
    const name = customName ?? this.resolveHeroDisplayName(character.guildId, character.userId);
    return buildHeroCombatantSnapshot({ id: character.userId, name, stats });
  }

  getUserCreditScore(guildId: string, userId: string): number {
    if (!this.getCreditScore) return DEFAULT_CREDIT_SCORE;
    const score = this.getCreditScore(guildId, userId);
    return Number.isFinite(score) ? score : DEFAULT_CREDIT_SCORE;
  }

  getConfig(guildId?: string): RpgConfig {
    if (guildId && this.guildConfigRepo) {
      return { ...DEFAULT_RPG_CONFIG, ...this.guildConfigRepo.getOrCreate(guildId).rpg, ...this.configOverrides };
    }
    return { ...this.config };
  }

  getOrCreateCharacter(guildId: string, userId: string, nowMs = Date.now()): RpgCharacter {
    return this.db.transaction(() => charOps.getOrCreateCharacterInTx(this.opsCtx, guildId, userId, nowMs))();
  }

  getPendingTrialForUser(guildId: string, userId: string): RpgTrial | null { return this.rpgRepo.getPendingTrialForUser(guildId, userId); }
  getTrialById(trialId: number): RpgTrial | null { return this.rpgRepo.getTrialById(trialId); }
  bindTrialMessage(trialId: number, messageId: string, channelId?: string): void { this.rpgRepo.bindTrialMessage(trialId, messageId, channelId); }
  listItems(guildId: string, userId: string): RpgItem[] { return this.rpgRepo.listItems(guildId, userId); }
  getArenaLeaderboard(guildId: string, limit = 10, offset = 0) { return this.rpgRepo.getArenaLeaderboard(guildId, limit, offset); }
  getArenaRank(guildId: string, userId: string) { return this.rpgRepo.getArenaRank(guildId, userId); }
  listArenaCandidates(guildId: string, excludeUserId: string, limit = 15) { return this.rpgRepo.listArenaCandidates(guildId, excludeUserId, limit); }
  getPublicDuelById(duelId: number): RpgDuel | null { return this.rpgRepo.getDuelById(duelId); }
  getPendingDuelForUser(guildId: string, userId: string): RpgDuel | null { return this.rpgRepo.getPendingDuelForUser(guildId, userId); }
  bindPublicDuelMessage(duelId: number, messageId: string, channelId?: string): void { this.rpgRepo.bindDuelMessage(duelId, messageId, channelId); }
  getCoopRaidById(raidId: number): RpgRaid | null { return this.rpgRepo.getRaidById(raidId); }
  getRecruitingRaidForLeader(guildId: string, leaderId: string): RpgRaid | null { return this.rpgRepo.getRecruitingRaidForLeader(guildId, leaderId); }
  bindCoopRaidMessage(raidId: number, messageId: string, channelId?: string): void { this.rpgRepo.bindRaidMessage(raidId, messageId, channelId); }
  getLeaderboard(guildId: string, limit = 10, offset = 0) { return this.rpgRepo.getLeaderboard(guildId, limit, offset); }

  chooseOrSwitchClass(guildId: string, userId: string, classKey: RpgClassKey, nowMs = Date.now()): ChooseClassResult {
    return charOps.chooseOrSwitchClass(this.opsCtx, guildId, userId, classKey, nowMs);
  }
  buyStaminaPotion(guildId: string, userId: string, nowMs = Date.now()): BuyStaminaPotionResult {
    return charOps.buyStaminaPotion(this.opsCtx, guildId, userId, nowMs);
  }
  buyAlchemyItem(guildId: string, userId: string, kind: 'pill' | 'elixir', nowMs = Date.now()): BuyAlchemyItemResult {
    return charOps.buyAlchemyItem(this.opsCtx, guildId, userId, kind, nowMs);
  }
  healInjury(guildId: string, userId: string, nowMs = Date.now()): HealInjuryResult {
    return charOps.healInjury(this.opsCtx, guildId, userId, nowMs);
  }
  configureTrialLoadout(guildId: string, userId: string, action: 'cycle_pills' | 'toggle_guard', nowMs = Date.now()): ConfigureTrialLoadoutResult {
    return charOps.configureTrialLoadout(this.opsCtx, guildId, userId, action, nowMs);
  }
  computeCombatStats(guildId: string, userId: string, nowMs = Date.now()): CombatStats {
    return this.computeCombatStatsForCharacter(this.getOrCreateCharacter(guildId, userId, nowMs));
  }
  equipItem(guildId: string, userId: string, itemId: number, nowMs = Date.now()) {
    return blacksmithOps.equipItem(this.opsCtx, guildId, userId, itemId, nowMs);
  }
  unequipItem(guildId: string, userId: string, itemId: number, nowMs = Date.now()) {
    return blacksmithOps.unequipItem(this.opsCtx, guildId, userId, itemId, nowMs);
  }
  enhanceItem(guildId: string, userId: string, itemId: number, _nowMs = Date.now(), rng: () => number = Math.random) {
    return blacksmithOps.enhanceItem(this.opsCtx, guildId, userId, itemId, _nowMs, rng);
  }
  toggleItemLock(guildId: string, userId: string, itemId: number) {
    return blacksmithOps.toggleItemLock(this.opsCtx, guildId, userId, itemId);
  }
  reforgeItemAffixes(guildId: string, userId: string, itemId: number, lockedAffixIndex: number | null = null, nowMs = Date.now(), rng: () => number = Math.random) {
    return blacksmithOps.reforgeItemAffixes(this.opsCtx, guildId, userId, itemId, lockedAffixIndex, nowMs, rng);
  }
  salvageItem(guildId: string, userId: string, itemId: number, nowMs = Date.now()) {
    return blacksmithOps.salvageItem(this.opsCtx, guildId, userId, itemId, nowMs);
  }
  equipBestGear(guildId: string, userId: string, nowMs = Date.now()) {
    return blacksmithOps.equipBestGear(this.opsCtx, guildId, userId, nowMs);
  }
  bulkSalvageItems(guildId: string, userId: string, maxRarity: 'uncommon' | 'rare' = 'uncommon', nowMs = Date.now()) {
    return blacksmithOps.bulkSalvageItems(this.opsCtx, guildId, userId, maxRarity, nowMs);
  }
  previewIdleHarvest(guildId: string, userId: string, nowMs = Date.now()): IdleHarvestPreview {
    return charOps.computeIdlePreviewForCharacter(this.opsCtx, this.getOrCreateCharacter(guildId, userId, nowMs), nowMs);
  }
  claimIdleHarvest(guildId: string, userId: string, nowMs = Date.now(), rng: () => number = Math.random): ClaimIdleHarvestResult {
    return charOps.claimIdleHarvest(this.opsCtx, guildId, userId, nowMs, rng);
  }
  raidBoss(guildId: string, userId: string, mode: 'single' | 'all', nowMs = Date.now(), rng: () => number = Math.random) {
    return bossOps.raidBoss(this.opsCtx, guildId, userId, mode, nowMs, rng);
  }
  challengeAbyssBoss(guildId: string, userId: string, nowMs = Date.now(), rng: () => number = Math.random) {
    return bossOps.challengeAbyssBoss(this.opsCtx, guildId, userId, nowMs, rng);
  }
  previewDailyArenaReward(guildId: string, userId: string, nowMs = Date.now()): ArenaDailyRewardPreview {
    return arenaOps.previewDailyArenaReward(this.opsCtx, guildId, userId, nowMs);
  }
  challengeArenaOpponent(guildId: string, actorId: string, targetId: string, nowMs = Date.now(), rng: () => number = Math.random): ChallengeArenaResult {
    return arenaOps.challengeArenaOpponent(this.opsCtx, guildId, actorId, targetId, nowMs, rng);
  }
  claimDailyArenaReward(guildId: string, userId: string, nowMs = Date.now()): ClaimDailyArenaRewardResult {
    return arenaOps.claimDailyArenaReward(this.opsCtx, guildId, userId, nowMs);
  }
  createPublicDuel(input: { guildId: string; channelId: string; challengerId: string; opponentId?: string | null; rulesMode: RpgDuelRulesMode; betAmount: number; nowMs?: number }): CreatePublicDuelResult {
    return arenaOps.createPublicDuel(this.opsCtx, input);
  }
  cancelPublicDuelAndRefund(duelId: number, actorIdOrSystem: string | null = null, nowMs = Date.now()): CancelPublicDuelResult {
    return arenaOps.cancelPublicDuelAndRefund(this.opsCtx, duelId, actorIdOrSystem, nowMs);
  }
  acceptPublicDuel(duelId: number, acceptorId: string, nowMs = Date.now(), rng: () => number = Math.random): AcceptPublicDuelResult {
    return arenaOps.acceptPublicDuel(this.opsCtx, duelId, acceptorId, nowMs, rng);
  }
  expireDuePublicDuels(nowMs = Date.now()): RpgDuel[] {
    return arenaOps.expireDuePublicDuels(this.opsCtx, nowMs);
  }
  startCoopRaidLobby(guildId: string, channelId: string, leaderId: string, nowMs = Date.now()) {
    return coopOps.startCoopRaidLobby(this.opsCtx, guildId, channelId, leaderId, nowMs);
  }
  cancelCoopRaidAndRefund(raidId: number, nowMs = Date.now()): boolean {
    return coopOps.cancelCoopRaidAndRefund(this.opsCtx, raidId, nowMs);
  }
  joinCoopRaidLobby(raidId: number, userId: string, nowMs = Date.now()) {
    return coopOps.joinCoopRaidLobby(this.opsCtx, raidId, userId, nowMs);
  }
  launchCoopRaid(raidId: number, actorIdOrSystem: string | null, nowMs = Date.now(), rng: () => number = Math.random) {
    return coopOps.launchCoopRaid(this.opsCtx, raidId, actorIdOrSystem, nowMs, rng);
  }
  settleDueCoopRaids(nowMs = Date.now(), rng: () => number = Math.random) {
    return coopOps.settleDueCoopRaids(this.opsCtx, nowMs, rng);
  }
  createWorldBossBridge(rng: () => number = Math.random): RpgWorldBossBridge {
    return bossOps.createWorldBossBridge(this.opsCtx, rng);
  }
  computeBreakthroughPreview(guildId: string, userId: string, nowMs = Date.now()): BreakthroughPreview {
    const character = this.getOrCreateCharacter(guildId, userId, nowMs);
    const pending = this.rpgRepo.getPendingTrialForUser(guildId, userId);
    return trialOps.computeBreakthroughPreviewForCharacter(this.opsCtx, character, Boolean(pending));
  }
  attemptSoloBreakthrough(guildId: string, userId: string, nowMs = Date.now(), rng: () => number = Math.random): SoloBreakthroughResult {
    return trialOps.attemptSoloBreakthrough(this.opsCtx, guildId, userId, nowMs, rng);
  }
  startPublicBreakthroughTrial(guildId: string, channelId: string, userId: string, nowMs = Date.now()): StartPublicTrialResult {
    return trialOps.startPublicBreakthroughTrial(this.opsCtx, guildId, channelId, userId, nowMs);
  }
  cancelPublicTrialAndRefund(trialId: number, nowMs = Date.now()): boolean {
    return trialOps.cancelPublicTrialAndRefund(this.opsCtx, trialId, nowMs);
  }
  interactPublicTrial(trialId: number, actorId: string, mode: 'help' | 'jeer', nowMs = Date.now()): InteractPublicTrialResult {
    return trialOps.interactPublicTrial(this.opsCtx, trialId, actorId, mode, nowMs);
  }
  settlePublicTrial(trialId: number, actorIdOrSystem: string | null, nowMs = Date.now(), rng: () => number = Math.random): SettlePublicTrialResult {
    return trialOps.settlePublicTrial(this.opsCtx, trialId, actorIdOrSystem, nowMs, rng);
  }
  settleDuePublicTrials(nowMs = Date.now(), rng: () => number = Math.random) {
    return trialOps.settleDuePublicTrials(this.opsCtx, nowMs, rng);
  }
}
