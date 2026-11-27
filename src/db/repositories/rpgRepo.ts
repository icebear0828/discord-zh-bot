import type Database from 'better-sqlite3';
import { RpgCharacterQueries } from './rpg/characterQueries.js';
import { RpgItemQueries } from './rpg/itemQueries.js';
import { initRpgSchema, RPG_SCHEMA_SQL } from './rpg/schema.js';
import { RpgTrialDuelRaidQueries } from './rpg/trialDuelRaidQueries.js';
import type {
  CreateRpgCharacterInput,
  CreateRpgDuelInput,
  CreateRpgItemInput,
  CreateRpgRaidInput,
  CreateRpgTrialInput,
  RpgAffix,
  RpgAffixKind,
  RpgCharacter,
  RpgClassKey,
  RpgDuel,
  RpgDuelRulesMode,
  RpgDuelStatus,
  RpgItem,
  RpgItemRarity,
  RpgItemSlot,
  RpgLegendaryEffect,
  RpgRaid,
  RpgRaidDroppedItem,
  RpgRaidPayout,
  RpgRaidStatus,
  RpgTrial,
  RpgTrialStatus,
} from './rpg/types.js';

export { initRpgSchema, RPG_SCHEMA_SQL };
export type {
  RpgAffix,
  RpgAffixKind,
  RpgCharacter,
  RpgClassKey,
  RpgDuel,
  RpgDuelRulesMode,
  RpgDuelStatus,
  RpgItem,
  RpgItemRarity,
  RpgItemSlot,
  RpgLegendaryEffect,
  RpgRaid,
  RpgRaidDroppedItem,
  RpgRaidPayout,
  RpgRaidStatus,
  RpgTrial,
  RpgTrialStatus,
};

export class RpgRepo {
  private readonly characters: RpgCharacterQueries;
  private readonly items: RpgItemQueries;
  private readonly activities: RpgTrialDuelRaidQueries;

  constructor(db: Database.Database) {
    this.characters = new RpgCharacterQueries(db);
    this.items = new RpgItemQueries(db);
    this.activities = new RpgTrialDuelRaidQueries(db);
  }

  // Characters
  getCharacter(guildId: string, userId: string): RpgCharacter | null {
    return this.characters.getCharacter(guildId, userId);
  }

  createCharacter(input: CreateRpgCharacterInput): RpgCharacter {
    return this.characters.createCharacter(input);
  }

  saveCharacter(character: RpgCharacter): void {
    this.characters.saveCharacter(character);
  }

  listUnbackfilledCharacters(): RpgCharacter[] {
    return this.characters.listUnbackfilledCharacters();
  }

  backfillCharacterDust(guildId: string, userId: string, dustToAdd: number): boolean {
    return this.characters.backfillCharacterDust(guildId, userId, dustToAdd);
  }

  addArcaneDust(guildId: string, userId: string, delta: number): number {
    return this.characters.addArcaneDust(guildId, userId, delta);
  }

  getLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): { items: RpgCharacter[]; total: number } {
    return this.characters.getLeaderboard(guildId, limit, offset);
  }

  getArenaLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): { items: RpgCharacter[]; total: number } {
    return this.characters.getArenaLeaderboard(guildId, limit, offset);
  }

  getArenaRank(guildId: string, userId: string): { rank: number; total: number } | null {
    return this.characters.getArenaRank(guildId, userId);
  }

  listArenaCandidates(guildId: string, excludeUserId: string, limit = 15): RpgCharacter[] {
    return this.characters.listArenaCandidates(guildId, excludeUserId, limit);
  }

  // Items
  createItem(input: CreateRpgItemInput): RpgItem {
    return this.items.createItem(input);
  }

  getItemById(itemId: number): RpgItem | null {
    return this.items.getItemById(itemId);
  }

  listItems(guildId: string, userId: string): RpgItem[] {
    return this.items.listItems(guildId, userId);
  }

  listEquippedItems(guildId: string, userId: string): RpgItem[] {
    return this.items.listEquippedItems(guildId, userId);
  }

  listUnawakenedItems(): RpgItem[] {
    return this.items.listUnawakenedItems();
  }

  countItems(guildId: string, userId: string): number {
    return this.items.countItems(guildId, userId);
  }

  setSlotEquipped(
    guildId: string,
    userId: string,
    slot: RpgItemSlot,
    itemId: number | null,
  ): void {
    this.items.setSlotEquipped(guildId, userId, slot, itemId);
  }

  updateItemEnhanceLevel(itemId: number, enhanceLevel: number): void {
    this.items.updateItemEnhanceLevel(itemId, enhanceLevel);
  }

  updateItemAffixes(
    itemId: number,
    affixes: readonly RpgAffix[],
    legendaryEffect: RpgLegendaryEffect | null,
    affixesAwakened = true,
  ): void {
    this.items.updateItemAffixes(itemId, affixes, legendaryEffect, affixesAwakened);
  }

  setItemLocked(itemId: number, guildId: string, userId: string, locked: boolean): boolean {
    return this.items.setItemLocked(itemId, guildId, userId, locked);
  }

  deleteItem(itemId: number, guildId: string, userId: string): boolean {
    return this.items.deleteItem(itemId, guildId, userId);
  }

  // Public Breakthrough Trials
  createTrial(input: CreateRpgTrialInput): RpgTrial {
    return this.activities.createTrial(input);
  }

  getTrialById(trialId: number): RpgTrial | null {
    return this.activities.getTrialById(trialId);
  }

  getPendingTrialForUser(guildId: string, userId: string): RpgTrial | null {
    return this.activities.getPendingTrialForUser(guildId, userId);
  }

  bindTrialMessage(trialId: number, messageId: string, channelId?: string): void {
    this.activities.bindTrialMessage(trialId, messageId, channelId);
  }

  saveTrial(trial: RpgTrial): void {
    this.activities.saveTrial(trial);
  }

  listDuePendingTrials(nowMs: number): RpgTrial[] {
    return this.activities.listDuePendingTrials(nowMs);
  }

  // Public Duels (#游戏聊天)
  createDuel(input: CreateRpgDuelInput): RpgDuel {
    return this.activities.createDuel(input);
  }

  getDuelById(duelId: number): RpgDuel | null {
    return this.activities.getDuelById(duelId);
  }

  getPendingDuelForUser(guildId: string, userId: string): RpgDuel | null {
    return this.activities.getPendingDuelForUser(guildId, userId);
  }

  bindDuelMessage(duelId: number, messageId: string, channelId?: string): void {
    this.activities.bindDuelMessage(duelId, messageId, channelId);
  }

  saveDuel(duel: RpgDuel): void {
    this.activities.saveDuel(duel);
  }

  listDuePendingDuels(nowMs: number): RpgDuel[] {
    return this.activities.listDuePendingDuels(nowMs);
  }

  // Co-op Raids (#游戏聊天)
  createRaid(input: CreateRpgRaidInput): RpgRaid {
    return this.activities.createRaid(input);
  }

  getRaidById(raidId: number): RpgRaid | null {
    return this.activities.getRaidById(raidId);
  }

  getRecruitingRaidForLeader(guildId: string, leaderId: string): RpgRaid | null {
    return this.activities.getRecruitingRaidForLeader(guildId, leaderId);
  }

  bindRaidMessage(raidId: number, messageId: string, channelId?: string): void {
    this.activities.bindRaidMessage(raidId, messageId, channelId);
  }

  saveRaid(raid: RpgRaid): void {
    this.activities.saveRaid(raid);
  }

  listDueRecruitingRaids(nowMs: number): RpgRaid[] {
    return this.activities.listDueRecruitingRaids(nowMs);
  }
}
