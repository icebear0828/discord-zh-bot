import type {
  RpgAffix,
  RpgAffixKind,
  RpgLegendaryEffect,
} from '../../../services/rpgAffixes.js';

export type { RpgAffix, RpgAffixKind, RpgLegendaryEffect };

export type RpgClassKey = 'warrior' | 'mage' | 'ranger' | 'paladin';
export type RpgItemSlot = 'weapon' | 'armor' | 'accessory';
export type RpgItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type RpgTrialStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';
export type RpgDuelRulesMode = 'full' | 'equalized';
export type RpgDuelStatus = 'pending' | 'completed' | 'expired' | 'cancelled';
export type RpgRaidStatus = 'recruiting' | 'completed' | 'failed' | 'cancelled';

export interface RpgCharacter {
  guildId: string;
  userId: string;
  classKey: RpgClassKey;
  classSelected: boolean;
  level: number;
  xp: number;
  stamina: number;
  lastStaminaDate: string | null;
  staminaBuysToday: number;
  maxChapterCleared: number;
  totalClears: number;
  totalBossKills: number;
  lastIdleClaimAt: number;
  injuredUntil: number;
  breakthroughPity: number;
  totalBreakthroughs: number;
  promoPills: number;
  guardElixirs: number;
  pillBuysToday: number;
  elixirBuysToday: number;
  trialPillsStaged: number;
  trialUseGuard: boolean;
  arcaneDust: number;
  dustBackfilled: boolean;
  abyssClearedTier: number;
  arenaRating: number;
  arenaFightsToday: number;
  arenaRewardDate: string | null;
  coopTicketsToday: number;
  updatedAt: number;
}

export interface RpgItem {
  id: number;
  guildId: string;
  userId: string;
  name: string;
  slot: RpgItemSlot;
  rarity: RpgItemRarity;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseCritBp: number;
  enhanceLevel: number;
  equipped: boolean;
  affixes: RpgAffix[];
  legendaryEffect: RpgLegendaryEffect | null;
  locked: boolean;
  affixesAwakened: boolean;
  createdAt: number;
}

export interface RpgTrial {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  userId: string;
  fromLevel: number;
  targetTier: number;
  pillsUsed: number;
  usedGuard: boolean;
  baseChanceBp: number;
  supporters: string[];
  saboteurs: string[];
  status: RpgTrialStatus;
  resultSummary: string;
  createdAt: number;
  expiresAt: number;
  resolvedAt: number;
}

export interface RpgDuel {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  challengerId: string;
  opponentId: string | null;
  rulesMode: RpgDuelRulesMode;
  betAmount: number;
  status: RpgDuelStatus;
  winnerId: string | null;
  resultSummary: string;
  highlights: string[];
  createdAt: number;
  expiresAt: number;
  resolvedAt: number;
}

export interface RpgRaidDroppedItem {
  id: number;
  name: string;
  rarity: RpgItemRarity;
  slot: RpgItemSlot;
}

export interface RpgRaidPayout {
  userId: string;
  name: string;
  classKey: RpgClassKey;
  level: number;
  isLeader: boolean;
  isMercenary: boolean;
  isMvp: boolean;
  damageDealt: number;
  damageTaken: number;
  grossCoins: number;
  garnishedCoins: number;
  netCoins: number;
  dustEarned: number;
  xpEarned: number;
  itemsDropped: RpgRaidDroppedItem[];
}

export interface RpgRaid {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  leaderId: string;
  tier: number;
  bossName: string;
  bossMaxHp: number;
  bossRemainingHp: number;
  members: string[];
  mercIds: string[];
  status: RpgRaidStatus;
  mvpUserId: string | null;
  resultSummary: string;
  highlights: string[];
  payouts: RpgRaidPayout[];
  createdAt: number;
  expiresAt: number;
  resolvedAt: number;
}

export interface RpgCharacterSqlRow {
  guild_id: string;
  user_id: string;
  class_key: RpgClassKey;
  class_selected?: number;
  level: number;
  xp: number;
  stamina: number;
  last_stamina_date: string | null;
  stamina_buys_today: number;
  max_chapter_cleared: number;
  total_clears: number;
  total_boss_kills: number;
  last_idle_claim_at?: number;
  injured_until?: number;
  breakthrough_pity?: number;
  total_breakthroughs?: number;
  promo_pills?: number;
  guard_elixirs?: number;
  pill_buys_today?: number;
  elixir_buys_today?: number;
  trial_pills_staged?: number;
  trial_use_guard?: number;
  arcane_dust?: number;
  dust_backfilled?: number;
  abyss_cleared_tier?: number;
  arena_rating?: number;
  arena_fights_today?: number;
  arena_reward_date?: string | null;
  coop_tickets_today?: number;
  updated_at: number;
}

export interface RpgItemSqlRow {
  id: number;
  guild_id: string;
  user_id: string;
  name: string;
  slot: RpgItemSlot;
  rarity: RpgItemRarity;
  base_hp: number;
  base_atk: number;
  base_def: number;
  base_crit_bp: number;
  enhance_level: number;
  equipped: number;
  affixes_json?: string;
  legendary_effect?: string | null;
  locked?: number;
  affixes_awakened?: number;
  created_at: number;
}

export interface RpgTrialSqlRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  user_id: string;
  from_level: number;
  target_tier: number;
  pills_used: number;
  used_guard: number;
  base_chance_bp: number;
  supporters_json: string;
  saboteurs_json: string;
  status: RpgTrialStatus;
  result_summary: string;
  created_at: number;
  expires_at: number;
  resolved_at: number;
}

export interface RpgDuelSqlRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  challenger_id: string;
  opponent_id: string | null;
  rules_mode: RpgDuelRulesMode;
  bet_amount: number;
  status: RpgDuelStatus;
  winner_id: string | null;
  result_summary: string;
  highlights_json: string;
  created_at: number;
  expires_at: number;
  resolved_at: number;
}

export interface RpgRaidSqlRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  leader_id: string;
  tier: number;
  boss_name: string;
  boss_max_hp?: number;
  boss_remaining_hp?: number;
  members_json: string;
  merc_ids_json: string;
  status: RpgRaidStatus;
  mvp_user_id: string | null;
  result_summary: string;
  highlights_json: string;
  payouts_json: string;
  created_at: number;
  expires_at: number;
  resolved_at: number;
}

export interface CreateRpgCharacterInput {
  guildId: string;
  userId: string;
  classKey: RpgClassKey;
  classSelected?: boolean;
  stamina: number;
  lastStaminaDate: string | null;
  lastIdleClaimAt?: number;
  arcaneDust?: number;
  dustBackfilled?: boolean;
  abyssClearedTier?: number;
  arenaRating?: number;
  arenaFightsToday?: number;
  arenaRewardDate?: string | null;
  coopTicketsToday?: number;
  updatedAt: number;
}

export interface CreateRpgItemInput {
  guildId: string;
  userId: string;
  name: string;
  slot: RpgItemSlot;
  rarity: RpgItemRarity;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseCritBp: number;
  enhanceLevel?: number;
  equipped?: boolean;
  affixes?: readonly RpgAffix[];
  legendaryEffect?: RpgLegendaryEffect | null;
  locked?: boolean;
  affixesAwakened?: boolean;
  createdAt: number;
}

export interface CreateRpgTrialInput {
  guildId: string;
  channelId: string;
  userId: string;
  fromLevel: number;
  targetTier: number;
  pillsUsed: number;
  usedGuard: boolean;
  baseChanceBp: number;
  createdAt: number;
  expiresAt: number;
}

export interface CreateRpgDuelInput {
  guildId: string;
  channelId: string;
  challengerId: string;
  opponentId: string | null;
  rulesMode: RpgDuelRulesMode;
  betAmount: number;
  createdAt: number;
  expiresAt: number;
}

export interface CreateRpgRaidInput {
  guildId: string;
  channelId: string;
  leaderId: string;
  tier: number;
  bossName: string;
  bossMaxHp?: number;
  bossRemainingHp?: number;
  members?: readonly string[];
  createdAt: number;
  expiresAt: number;
}
