import type Database from 'better-sqlite3';

export type RpgClassKey = 'warrior' | 'mage' | 'ranger' | 'paladin';
export type RpgItemSlot = 'weapon' | 'armor' | 'accessory';
export type RpgItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type RpgTrialStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';
export type RpgDuelRulesMode = 'full' | 'equalized';
export type RpgDuelStatus = 'pending' | 'completed' | 'expired' | 'cancelled';
export type RpgRaidStatus = 'recruiting' | 'completed' | 'failed' | 'cancelled';

export type RpgAffixKind =
  | 'lifesteal'
  | 'combo'
  | 'thorns'
  | 'crit_dmg'
  | 'armor_pen'
  | 'dodge'
  | 'dmg_reduce'
  | 'greed';

export interface RpgAffix {
  kind: RpgAffixKind;
  valueBp: number;
}

export type RpgLegendaryEffect =
  | 'phoenix_rebirth'
  | 'twin_meteor'
  | 'ancestral_war_cry'
  | 'godslayer_execute'
  | 'titan_aegis'
  | 'abyss_soul_drain';

const VALID_AFFIX_KINDS: ReadonlySet<string> = new Set<RpgAffixKind>([
  'lifesteal',
  'combo',
  'thorns',
  'crit_dmg',
  'armor_pen',
  'dodge',
  'dmg_reduce',
  'greed',
]);

const VALID_LEGENDARY_EFFECTS: ReadonlySet<string> = new Set<RpgLegendaryEffect>([
  'phoenix_rebirth',
  'twin_meteor',
  'ancestral_war_cry',
  'godslayer_execute',
  'titan_aegis',
  'abyss_soul_drain',
]);

const VALID_CLASS_KEYS: ReadonlySet<string> = new Set<RpgClassKey>([
  'warrior',
  'mage',
  'ranger',
  'paladin',
]);

const VALID_RARITIES: ReadonlySet<string> = new Set<RpgItemRarity>([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
]);

const VALID_SLOTS: ReadonlySet<string> = new Set<RpgItemSlot>(['weapon', 'armor', 'accessory']);

function parseAffixesRaw(raw: string | null | undefined): RpgAffix[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RpgAffix[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const rec = entry as Record<string, unknown>;
      if (
        typeof rec.kind === 'string' &&
        VALID_AFFIX_KINDS.has(rec.kind) &&
        typeof rec.valueBp === 'number' &&
        Number.isFinite(rec.valueBp) &&
        rec.valueBp > 0
      ) {
        out.push({
          kind: rec.kind as RpgAffixKind,
          valueBp: Math.round(rec.valueBp),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function parseLegendaryEffectRaw(raw: string | null | undefined): RpgLegendaryEffect | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return VALID_LEGENDARY_EFFECTS.has(trimmed) ? (trimmed as RpgLegendaryEffect) : null;
}

export const RPG_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rpg_characters (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  class_key TEXT NOT NULL CHECK (class_key IN ('warrior', 'mage', 'ranger', 'paladin')),
  class_selected INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  stamina INTEGER NOT NULL DEFAULT 5,
  last_stamina_date TEXT,
  stamina_buys_today INTEGER NOT NULL DEFAULT 0,
  max_chapter_cleared INTEGER NOT NULL DEFAULT 0,
  total_clears INTEGER NOT NULL DEFAULT 0,
  total_boss_kills INTEGER NOT NULL DEFAULT 0,
  last_idle_claim_at INTEGER NOT NULL DEFAULT 0,
  injured_until INTEGER NOT NULL DEFAULT 0,
  breakthrough_pity INTEGER NOT NULL DEFAULT 0,
  total_breakthroughs INTEGER NOT NULL DEFAULT 0,
  promo_pills INTEGER NOT NULL DEFAULT 0,
  guard_elixirs INTEGER NOT NULL DEFAULT 0,
  pill_buys_today INTEGER NOT NULL DEFAULT 0,
  elixir_buys_today INTEGER NOT NULL DEFAULT 0,
  trial_pills_staged INTEGER NOT NULL DEFAULT 0,
  trial_use_guard INTEGER NOT NULL DEFAULT 0,
  arcane_dust INTEGER NOT NULL DEFAULT 0,
  dust_backfilled INTEGER NOT NULL DEFAULT 0,
  abyss_cleared_tier INTEGER NOT NULL DEFAULT 0,
  arena_rating INTEGER NOT NULL DEFAULT 1000,
  arena_fights_today INTEGER NOT NULL DEFAULT 0,
  arena_reward_date TEXT,
  coop_tickets_today INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS rpg_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('weapon', 'armor', 'accessory')),
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  base_hp INTEGER NOT NULL DEFAULT 0,
  base_atk INTEGER NOT NULL DEFAULT 0,
  base_def INTEGER NOT NULL DEFAULT 0,
  base_crit_bp INTEGER NOT NULL DEFAULT 0,
  enhance_level INTEGER NOT NULL DEFAULT 0,
  equipped INTEGER NOT NULL DEFAULT 0,
  affixes_json TEXT NOT NULL DEFAULT '[]',
  legendary_effect TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  affixes_awakened INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rpg_items_owner
  ON rpg_items (guild_id, user_id, equipped, slot);

CREATE TABLE IF NOT EXISTS rpg_runs (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  floor INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS rpg_trials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  user_id TEXT NOT NULL,
  from_level INTEGER NOT NULL,
  target_tier INTEGER NOT NULL,
  pills_used INTEGER NOT NULL DEFAULT 0,
  used_guard INTEGER NOT NULL DEFAULT 0,
  base_chance_bp INTEGER NOT NULL,
  supporters_json TEXT NOT NULL DEFAULT '[]',
  saboteurs_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  result_summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rpg_trials_status_expires
  ON rpg_trials (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_rpg_trials_guild_user_status
  ON rpg_trials (guild_id, user_id, status);

CREATE TABLE IF NOT EXISTS rpg_duels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  challenger_id TEXT NOT NULL,
  opponent_id TEXT,
  rules_mode TEXT NOT NULL CHECK (rules_mode IN ('full', 'equalized')),
  bet_amount INTEGER NOT NULL DEFAULT 0 CHECK (bet_amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'expired', 'cancelled')),
  winner_id TEXT,
  result_summary TEXT NOT NULL DEFAULT '',
  highlights_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rpg_duels_status_expires
  ON rpg_duels (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_rpg_duels_guild_challenger_status
  ON rpg_duels (guild_id, challenger_id, status);

CREATE TABLE IF NOT EXISTS rpg_raids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  leader_id TEXT NOT NULL,
  tier INTEGER NOT NULL,
  boss_name TEXT NOT NULL,
  boss_max_hp INTEGER NOT NULL DEFAULT 0,
  boss_remaining_hp INTEGER NOT NULL DEFAULT 0,
  members_json TEXT NOT NULL DEFAULT '[]',
  merc_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('recruiting', 'completed', 'failed', 'cancelled')),
  mvp_user_id TEXT,
  result_summary TEXT NOT NULL DEFAULT '',
  highlights_json TEXT NOT NULL DEFAULT '[]',
  payouts_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rpg_raids_status_expires
  ON rpg_raids (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_rpg_raids_guild_leader_status
  ON rpg_raids (guild_id, leader_id, status);
`;

function ensureRpgColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

export function initRpgSchema(db: Database.Database): void {
  db.exec(RPG_SCHEMA_SQL);

  ensureRpgColumn(db, 'rpg_characters', 'last_idle_claim_at', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'injured_until', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'breakthrough_pity', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'total_breakthroughs', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'promo_pills', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'guard_elixirs', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'pill_buys_today', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'elixir_buys_today', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'trial_pills_staged', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'trial_use_guard', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'arcane_dust', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'dust_backfilled', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'abyss_cleared_tier', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'arena_rating', 'INTEGER NOT NULL DEFAULT 1000');
  ensureRpgColumn(db, 'rpg_characters', 'arena_fights_today', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_characters', 'arena_reward_date', 'TEXT');
  ensureRpgColumn(db, 'rpg_characters', 'coop_tickets_today', 'INTEGER NOT NULL DEFAULT 0');

  ensureRpgColumn(db, 'rpg_items', 'affixes_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureRpgColumn(db, 'rpg_items', 'legendary_effect', 'TEXT');
  ensureRpgColumn(db, 'rpg_items', 'locked', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_items', 'affixes_awakened', 'INTEGER NOT NULL DEFAULT 0');

  ensureRpgColumn(db, 'rpg_raids', 'boss_max_hp', 'INTEGER NOT NULL DEFAULT 0');
  ensureRpgColumn(db, 'rpg_raids', 'boss_remaining_hp', 'INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rpg_characters_realm_lb
      ON rpg_characters (guild_id, level DESC, xp DESC, total_breakthroughs DESC, total_boss_kills DESC);

    CREATE INDEX IF NOT EXISTS idx_rpg_characters_arena_lb
      ON rpg_characters (guild_id, class_selected, arena_rating DESC, level DESC, total_boss_kills DESC);
  `);
}

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

interface RpgCharacterSqlRow {
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

interface RpgItemSqlRow {
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

interface RpgTrialSqlRow {
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

interface RpgDuelSqlRow {
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

interface RpgRaidSqlRow {
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

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function parseRaidPayouts(raw: string | null | undefined): RpgRaidPayout[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: RpgRaidPayout[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.userId !== 'string') continue;
      const classKey: RpgClassKey =
        typeof rec.classKey === 'string' && VALID_CLASS_KEYS.has(rec.classKey)
          ? (rec.classKey as RpgClassKey)
          : 'warrior';
      const itemsDropped: RpgRaidDroppedItem[] = [];
      if (Array.isArray(rec.itemsDropped)) {
        for (const rawItem of rec.itemsDropped) {
          if (typeof rawItem !== 'object' || rawItem === null) continue;
          const itemRec = rawItem as Record<string, unknown>;
          if (
            typeof itemRec.id === 'number' &&
            typeof itemRec.name === 'string' &&
            typeof itemRec.rarity === 'string' &&
            VALID_RARITIES.has(itemRec.rarity) &&
            typeof itemRec.slot === 'string' &&
            VALID_SLOTS.has(itemRec.slot)
          ) {
            itemsDropped.push({
              id: itemRec.id,
              name: itemRec.name,
              rarity: itemRec.rarity as RpgItemRarity,
              slot: itemRec.slot as RpgItemSlot,
            });
          }
        }
      }
      out.push({
        userId: rec.userId,
        name: typeof rec.name === 'string' ? rec.name : rec.userId,
        classKey,
        level: typeof rec.level === 'number' && Number.isFinite(rec.level) ? Math.floor(rec.level) : 1,
        isLeader: Boolean(rec.isLeader),
        isMercenary: Boolean(rec.isMercenary),
        isMvp: Boolean(rec.isMvp),
        damageDealt:
          typeof rec.damageDealt === 'number' && Number.isFinite(rec.damageDealt)
            ? Math.floor(rec.damageDealt)
            : 0,
        damageTaken:
          typeof rec.damageTaken === 'number' && Number.isFinite(rec.damageTaken)
            ? Math.floor(rec.damageTaken)
            : 0,
        grossCoins:
          typeof rec.grossCoins === 'number' && Number.isFinite(rec.grossCoins)
            ? Math.floor(rec.grossCoins)
            : 0,
        garnishedCoins:
          typeof rec.garnishedCoins === 'number' && Number.isFinite(rec.garnishedCoins)
            ? Math.floor(rec.garnishedCoins)
            : 0,
        netCoins:
          typeof rec.netCoins === 'number' && Number.isFinite(rec.netCoins)
            ? Math.floor(rec.netCoins)
            : 0,
        dustEarned:
          typeof rec.dustEarned === 'number' && Number.isFinite(rec.dustEarned)
            ? Math.floor(rec.dustEarned)
            : 0,
        xpEarned:
          typeof rec.xpEarned === 'number' && Number.isFinite(rec.xpEarned)
            ? Math.floor(rec.xpEarned)
            : 0,
        itemsDropped,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function mapCharacter(row: RpgCharacterSqlRow): RpgCharacter {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    classKey: row.class_key,
    classSelected: (row.class_selected ?? 0) === 1,
    level: row.level,
    xp: row.xp,
    stamina: row.stamina,
    lastStaminaDate: row.last_stamina_date,
    staminaBuysToday: row.stamina_buys_today,
    maxChapterCleared: row.max_chapter_cleared,
    totalClears: row.total_clears,
    totalBossKills: row.total_boss_kills,
    lastIdleClaimAt: row.last_idle_claim_at ?? 0,
    injuredUntil: row.injured_until ?? 0,
    breakthroughPity: row.breakthrough_pity ?? 0,
    totalBreakthroughs: row.total_breakthroughs ?? 0,
    promoPills: row.promo_pills ?? 0,
    guardElixirs: row.guard_elixirs ?? 0,
    pillBuysToday: row.pill_buys_today ?? 0,
    elixirBuysToday: row.elixir_buys_today ?? 0,
    trialPillsStaged: row.trial_pills_staged ?? 0,
    trialUseGuard: (row.trial_use_guard ?? 0) === 1,
    arcaneDust: row.arcane_dust ?? 0,
    dustBackfilled: (row.dust_backfilled ?? 0) === 1,
    abyssClearedTier: row.abyss_cleared_tier ?? 0,
    arenaRating: row.arena_rating ?? 1000,
    arenaFightsToday: row.arena_fights_today ?? 0,
    arenaRewardDate: row.arena_reward_date ?? null,
    coopTicketsToday: row.coop_tickets_today ?? 0,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: RpgItemSqlRow): RpgItem {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    name: row.name,
    slot: row.slot,
    rarity: row.rarity,
    baseHp: row.base_hp,
    baseAtk: row.base_atk,
    baseDef: row.base_def,
    baseCritBp: row.base_crit_bp,
    enhanceLevel: row.enhance_level,
    equipped: row.equipped === 1,
    affixes: parseAffixesRaw(row.affixes_json),
    legendaryEffect: parseLegendaryEffectRaw(row.legendary_effect),
    locked: (row.locked ?? 0) === 1,
    affixesAwakened: (row.affixes_awakened ?? 0) === 1,
    createdAt: row.created_at,
  };
}

function mapTrial(row: RpgTrialSqlRow): RpgTrial {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    userId: row.user_id,
    fromLevel: row.from_level,
    targetTier: row.target_tier,
    pillsUsed: row.pills_used,
    usedGuard: row.used_guard === 1,
    baseChanceBp: row.base_chance_bp,
    supporters: parseStringArray(row.supporters_json),
    saboteurs: parseStringArray(row.saboteurs_json),
    status: row.status,
    resultSummary: row.result_summary,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

function mapDuel(row: RpgDuelSqlRow): RpgDuel {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    challengerId: row.challenger_id,
    opponentId: row.opponent_id,
    rulesMode: row.rules_mode,
    betAmount: row.bet_amount,
    status: row.status,
    winnerId: row.winner_id,
    resultSummary: row.result_summary,
    highlights: parseStringArray(row.highlights_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

function mapRaid(row: RpgRaidSqlRow): RpgRaid {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    leaderId: row.leader_id,
    tier: row.tier,
    bossName: row.boss_name,
    bossMaxHp: row.boss_max_hp ?? 0,
    bossRemainingHp: row.boss_remaining_hp ?? 0,
    members: parseStringArray(row.members_json),
    mercIds: parseStringArray(row.merc_ids_json),
    status: row.status,
    mvpUserId: row.mvp_user_id,
    resultSummary: row.result_summary,
    highlights: parseStringArray(row.highlights_json),
    payouts: parseRaidPayouts(row.payouts_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

export class RpgRepo {
  constructor(private readonly db: Database.Database) {}

  // Characters
  getCharacter(guildId: string, userId: string): RpgCharacter | null {
    const row = this.db
      .prepare('SELECT * FROM rpg_characters WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as RpgCharacterSqlRow | undefined;
    return row ? mapCharacter(row) : null;
  }

  createCharacter(input: {
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
  }): RpgCharacter {
    const lastIdleClaimAt = input.lastIdleClaimAt ?? input.updatedAt;
    this.db
      .prepare(
        `INSERT INTO rpg_characters (
          guild_id, user_id, class_key, class_selected, level, xp, stamina,
          last_stamina_date, stamina_buys_today, max_chapter_cleared,
          total_clears, total_boss_kills, last_idle_claim_at,
          injured_until, breakthrough_pity, total_breakthroughs,
          promo_pills, guard_elixirs, pill_buys_today, elixir_buys_today,
          trial_pills_staged, trial_use_guard,
          arcane_dust, dust_backfilled, abyss_cleared_tier,
          arena_rating, arena_fights_today, arena_reward_date, coop_tickets_today,
          updated_at
        ) VALUES (?, ?, ?, ?, 1, 0, ?, ?, 0, 0, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.guildId,
        input.userId,
        input.classKey,
        input.classSelected ? 1 : 0,
        input.stamina,
        input.lastStaminaDate,
        lastIdleClaimAt,
        input.arcaneDust ?? 0,
        input.dustBackfilled ? 1 : 0,
        input.abyssClearedTier ?? 0,
        input.arenaRating ?? 1000,
        input.arenaFightsToday ?? 0,
        input.arenaRewardDate ?? null,
        input.coopTicketsToday ?? 0,
        input.updatedAt,
      );

    const created = this.getCharacter(input.guildId, input.userId);
    if (!created) throw new Error('Failed to load created RPG character');
    return created;
  }

  saveCharacter(character: RpgCharacter): void {
    this.db
      .prepare(
        `UPDATE rpg_characters SET
          class_key = ?, class_selected = ?, level = ?, xp = ?, stamina = ?,
          last_stamina_date = ?, stamina_buys_today = ?, max_chapter_cleared = ?,
          total_clears = ?, total_boss_kills = ?, last_idle_claim_at = ?,
          injured_until = ?, breakthrough_pity = ?, total_breakthroughs = ?,
          promo_pills = ?, guard_elixirs = ?, pill_buys_today = ?, elixir_buys_today = ?,
          trial_pills_staged = ?, trial_use_guard = ?,
          arcane_dust = ?, dust_backfilled = ?, abyss_cleared_tier = ?,
          arena_rating = ?, arena_fights_today = ?, arena_reward_date = ?, coop_tickets_today = ?,
          updated_at = ?
         WHERE guild_id = ? AND user_id = ?`,
      )
      .run(
        character.classKey,
        character.classSelected ? 1 : 0,
        character.level,
        character.xp,
        character.stamina,
        character.lastStaminaDate,
        character.staminaBuysToday,
        character.maxChapterCleared,
        character.totalClears,
        character.totalBossKills,
        character.lastIdleClaimAt,
        character.injuredUntil,
        character.breakthroughPity,
        character.totalBreakthroughs,
        character.promoPills,
        character.guardElixirs,
        character.pillBuysToday,
        character.elixirBuysToday,
        character.trialPillsStaged,
        character.trialUseGuard ? 1 : 0,
        character.arcaneDust,
        character.dustBackfilled ? 1 : 0,
        character.abyssClearedTier,
        character.arenaRating,
        character.arenaFightsToday,
        character.arenaRewardDate,
        character.coopTicketsToday,
        character.updatedAt,
        character.guildId,
        character.userId,
      );
  }

  listUnbackfilledCharacters(): RpgCharacter[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM rpg_characters WHERE class_selected = 1 AND dust_backfilled = 0 ORDER BY guild_id ASC, user_id ASC',
      )
      .all() as RpgCharacterSqlRow[];
    return rows.map(mapCharacter);
  }

  backfillCharacterDust(guildId: string, userId: string, dustToAdd: number): boolean {
    const res = this.db
      .prepare(
        'UPDATE rpg_characters SET arcane_dust = arcane_dust + ?, dust_backfilled = 1 WHERE guild_id = ? AND user_id = ? AND dust_backfilled = 0',
      )
      .run(Math.max(0, Math.floor(dustToAdd)), guildId, userId);
    return res.changes > 0;
  }

  addArcaneDust(guildId: string, userId: string, delta: number): number {
    const clean = Math.max(0, Math.floor(delta));
    if (clean > 0) {
      this.db
        .prepare(
          'UPDATE rpg_characters SET arcane_dust = arcane_dust + ? WHERE guild_id = ? AND user_id = ?',
        )
        .run(clean, guildId, userId);
    }
    const row = this.db
      .prepare('SELECT arcane_dust FROM rpg_characters WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as { arcane_dust: number } | undefined;
    return row?.arcane_dust ?? 0;
  }

  getLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): { items: RpgCharacter[]; total: number } {
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = this.db
      .prepare(
        `SELECT * FROM rpg_characters
         WHERE guild_id = ?
         ORDER BY level DESC, xp DESC, total_breakthroughs DESC, total_boss_kills DESC, updated_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(guildId, safeLimit, safeOffset) as RpgCharacterSqlRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM rpg_characters WHERE guild_id = ?')
      .get(guildId) as { cnt: number };
    return { items: rows.map(mapCharacter), total: total.cnt };
  }

  getArenaLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): { items: RpgCharacter[]; total: number } {
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = this.db
      .prepare(
        `SELECT * FROM rpg_characters
         WHERE guild_id = ? AND class_selected = 1
         ORDER BY arena_rating DESC, level DESC, total_boss_kills DESC, updated_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(guildId, safeLimit, safeOffset) as RpgCharacterSqlRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM rpg_characters WHERE guild_id = ? AND class_selected = 1')
      .get(guildId) as { cnt: number };
    return { items: rows.map(mapCharacter), total: total.cnt };
  }

  getArenaRank(guildId: string, userId: string): { rank: number; total: number } | null {
    const actor = this.getCharacter(guildId, userId);
    if (!actor || !actor.classSelected) {
      return null;
    }
    const totalRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM rpg_characters WHERE guild_id = ? AND class_selected = 1')
      .get(guildId) as { cnt: number };
    const higherRow = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM rpg_characters
         WHERE guild_id = ? AND class_selected = 1 AND (
           arena_rating > ?
           OR (arena_rating = ? AND level > ?)
           OR (arena_rating = ? AND level = ? AND total_boss_kills > ?)
           OR (arena_rating = ? AND level = ? AND total_boss_kills = ? AND updated_at < ?)
           OR (arena_rating = ? AND level = ? AND total_boss_kills = ? AND updated_at = ? AND user_id < ?)
         )`,
      )
      .get(
        guildId,
        actor.arenaRating,
        actor.arenaRating,
        actor.level,
        actor.arenaRating,
        actor.level,
        actor.totalBossKills,
        actor.arenaRating,
        actor.level,
        actor.totalBossKills,
        actor.updatedAt,
        actor.arenaRating,
        actor.level,
        actor.totalBossKills,
        actor.updatedAt,
        actor.userId,
      ) as { cnt: number };
    return { rank: higherRow.cnt + 1, total: totalRow.cnt };
  }

  listArenaCandidates(guildId: string, excludeUserId: string, limit = 15): RpgCharacter[] {
    const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));
    const actor = this.getCharacter(guildId, excludeUserId);
    const targetRating = actor?.arenaRating ?? 1000;
    const rows = this.db
      .prepare(
        `SELECT * FROM rpg_characters
         WHERE guild_id = ? AND class_selected = 1 AND user_id != ?
         ORDER BY ABS(arena_rating - ?) ASC, arena_rating DESC, level DESC, updated_at ASC
         LIMIT ?`,
      )
      .all(guildId, excludeUserId, targetRating, safeLimit) as RpgCharacterSqlRow[];
    return rows.map(mapCharacter);
  }

  // Items
  createItem(input: {
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
  }): RpgItem {
    const hasExplicitAffixInit =
      input.affixes !== undefined ||
      input.legendaryEffect !== undefined ||
      input.affixesAwakened !== undefined;
    const affixesJson = JSON.stringify(input.affixes ?? []);
    const legendaryEffect = input.legendaryEffect ?? null;
    const locked = input.locked ? 1 : 0;
    const affixesAwakened = hasExplicitAffixInit ? ((input.affixesAwakened ?? true) ? 1 : 0) : 0;

    const res = this.db
      .prepare(
        `INSERT INTO rpg_items (
          guild_id, user_id, name, slot, rarity,
          base_hp, base_atk, base_def, base_crit_bp,
          enhance_level, equipped,
          affixes_json, legendary_effect, locked, affixes_awakened,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.guildId,
        input.userId,
        input.name,
        input.slot,
        input.rarity,
        input.baseHp,
        input.baseAtk,
        input.baseDef,
        input.baseCritBp,
        input.enhanceLevel ?? 0,
        input.equipped ? 1 : 0,
        affixesJson,
        legendaryEffect,
        locked,
        affixesAwakened,
        input.createdAt,
      );
    const created = this.getItemById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created RPG item');
    return created;
  }

  getItemById(itemId: number): RpgItem | null {
    const row = this.db
      .prepare('SELECT * FROM rpg_items WHERE id = ?')
      .get(itemId) as RpgItemSqlRow | undefined;
    return row ? mapItem(row) : null;
  }

  listItems(guildId: string, userId: string): RpgItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM rpg_items
         WHERE guild_id = ? AND user_id = ?
         ORDER BY
           equipped DESC,
           CASE rarity
             WHEN 'legendary' THEN 5
             WHEN 'epic' THEN 4
             WHEN 'rare' THEN 3
             WHEN 'uncommon' THEN 2
             ELSE 1
           END DESC,
           enhance_level DESC,
           id DESC`,
      )
      .all(guildId, userId) as RpgItemSqlRow[];
    return rows.map(mapItem);
  }

  listEquippedItems(guildId: string, userId: string): RpgItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM rpg_items
         WHERE guild_id = ? AND user_id = ? AND equipped = 1
         ORDER BY
           CASE slot
             WHEN 'weapon' THEN 1
             WHEN 'armor' THEN 2
             ELSE 3
           END ASC`,
      )
      .all(guildId, userId) as RpgItemSqlRow[];
    return rows.map(mapItem);
  }

  listUnawakenedItems(): RpgItem[] {
    const rows = this.db
      .prepare('SELECT * FROM rpg_items WHERE affixes_awakened = 0 ORDER BY id ASC')
      .all() as RpgItemSqlRow[];
    return rows.map(mapItem);
  }

  countItems(guildId: string, userId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM rpg_items WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as { cnt: number };
    return row.cnt;
  }

  setSlotEquipped(
    guildId: string,
    userId: string,
    slot: RpgItemSlot,
    itemId: number | null,
  ): void {
    this.db
      .prepare(
        'UPDATE rpg_items SET equipped = 0 WHERE guild_id = ? AND user_id = ? AND slot = ?',
      )
      .run(guildId, userId, slot);
    if (itemId !== null) {
      this.db
        .prepare(
          'UPDATE rpg_items SET equipped = 1 WHERE id = ? AND guild_id = ? AND user_id = ?',
        )
        .run(itemId, guildId, userId);
    }
  }

  updateItemEnhanceLevel(itemId: number, enhanceLevel: number): void {
    this.db
      .prepare('UPDATE rpg_items SET enhance_level = ? WHERE id = ?')
      .run(enhanceLevel, itemId);
  }

  updateItemAffixes(
    itemId: number,
    affixes: readonly RpgAffix[],
    legendaryEffect: RpgLegendaryEffect | null,
    affixesAwakened = true,
  ): void {
    this.db
      .prepare(
        'UPDATE rpg_items SET affixes_json = ?, legendary_effect = ?, affixes_awakened = ? WHERE id = ?',
      )
      .run(JSON.stringify(affixes), legendaryEffect, affixesAwakened ? 1 : 0, itemId);
  }

  setItemLocked(itemId: number, guildId: string, userId: string, locked: boolean): boolean {
    const res = this.db
      .prepare('UPDATE rpg_items SET locked = ? WHERE id = ? AND guild_id = ? AND user_id = ?')
      .run(locked ? 1 : 0, itemId, guildId, userId);
    return res.changes > 0;
  }

  deleteItem(itemId: number, guildId: string, userId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM rpg_items WHERE id = ? AND guild_id = ? AND user_id = ?')
      .run(itemId, guildId, userId);
    return res.changes > 0;
  }

  // Public Breakthrough Trials
  createTrial(input: {
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
  }): RpgTrial {
    const res = this.db
      .prepare(
        `INSERT INTO rpg_trials (
          guild_id, channel_id, message_id, user_id, from_level, target_tier,
          pills_used, used_guard, base_chance_bp, supporters_json, saboteurs_json,
          status, result_summary, created_at, expires_at, resolved_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, '[]', '[]', 'pending', '', ?, ?, 0)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.userId,
        input.fromLevel,
        input.targetTier,
        input.pillsUsed,
        input.usedGuard ? 1 : 0,
        input.baseChanceBp,
        input.createdAt,
        input.expiresAt,
      );
    const created = this.getTrialById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created RPG trial');
    return created;
  }

  getTrialById(trialId: number): RpgTrial | null {
    const row = this.db
      .prepare('SELECT * FROM rpg_trials WHERE id = ?')
      .get(trialId) as RpgTrialSqlRow | undefined;
    return row ? mapTrial(row) : null;
  }

  getPendingTrialForUser(guildId: string, userId: string): RpgTrial | null {
    const row = this.db
      .prepare(
        "SELECT * FROM rpg_trials WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get(guildId, userId) as RpgTrialSqlRow | undefined;
    return row ? mapTrial(row) : null;
  }

  bindTrialMessage(trialId: number, messageId: string, channelId?: string): void {
    if (channelId) {
      this.db
        .prepare('UPDATE rpg_trials SET message_id = ?, channel_id = ? WHERE id = ?')
        .run(messageId, channelId, trialId);
      return;
    }
    this.db
      .prepare('UPDATE rpg_trials SET message_id = ? WHERE id = ?')
      .run(messageId, trialId);
  }

  saveTrial(trial: RpgTrial): void {
    this.db
      .prepare(
        `UPDATE rpg_trials SET
          channel_id = ?, message_id = ?, supporters_json = ?, saboteurs_json = ?,
          status = ?, result_summary = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .run(
        trial.channelId,
        trial.messageId,
        JSON.stringify(trial.supporters),
        JSON.stringify(trial.saboteurs),
        trial.status,
        trial.resultSummary,
        trial.resolvedAt,
        trial.id,
      );
  }

  listDuePendingTrials(nowMs: number): RpgTrial[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM rpg_trials WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC, id ASC",
      )
      .all(nowMs) as RpgTrialSqlRow[];
    return rows.map(mapTrial);
  }

  // Public Duels (#游戏聊天)
  createDuel(input: {
    guildId: string;
    channelId: string;
    challengerId: string;
    opponentId: string | null;
    rulesMode: RpgDuelRulesMode;
    betAmount: number;
    createdAt: number;
    expiresAt: number;
  }): RpgDuel {
    const res = this.db
      .prepare(
        `INSERT INTO rpg_duels (
          guild_id, channel_id, message_id, challenger_id, opponent_id,
          rules_mode, bet_amount, status, winner_id, result_summary,
          highlights_json, created_at, expires_at, resolved_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'pending', NULL, '', '[]', ?, ?, 0)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.challengerId,
        input.opponentId,
        input.rulesMode,
        Math.max(0, Math.floor(input.betAmount)),
        input.createdAt,
        input.expiresAt,
      );
    const created = this.getDuelById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created RPG duel');
    return created;
  }

  getDuelById(duelId: number): RpgDuel | null {
    const row = this.db
      .prepare('SELECT * FROM rpg_duels WHERE id = ?')
      .get(duelId) as RpgDuelSqlRow | undefined;
    return row ? mapDuel(row) : null;
  }

  getPendingDuelForUser(guildId: string, userId: string): RpgDuel | null {
    const row = this.db
      .prepare(
        "SELECT * FROM rpg_duels WHERE guild_id = ? AND challenger_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get(guildId, userId) as RpgDuelSqlRow | undefined;
    return row ? mapDuel(row) : null;
  }

  bindDuelMessage(duelId: number, messageId: string, channelId?: string): void {
    if (channelId) {
      this.db
        .prepare('UPDATE rpg_duels SET message_id = ?, channel_id = ? WHERE id = ?')
        .run(messageId, channelId, duelId);
      return;
    }
    this.db
      .prepare('UPDATE rpg_duels SET message_id = ? WHERE id = ?')
      .run(messageId, duelId);
  }

  saveDuel(duel: RpgDuel): void {
    this.db
      .prepare(
        `UPDATE rpg_duels SET
          channel_id = ?, message_id = ?, opponent_id = ?,
          status = ?, winner_id = ?, result_summary = ?,
          highlights_json = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .run(
        duel.channelId,
        duel.messageId,
        duel.opponentId,
        duel.status,
        duel.winnerId,
        duel.resultSummary,
        JSON.stringify(duel.highlights),
        duel.resolvedAt,
        duel.id,
      );
  }

  listDuePendingDuels(nowMs: number): RpgDuel[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM rpg_duels WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC, id ASC",
      )
      .all(nowMs) as RpgDuelSqlRow[];
    return rows.map(mapDuel);
  }

  // Co-op Raids (#游戏聊天)
  createRaid(input: {
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
  }): RpgRaid {
    const members = input.members ?? [input.leaderId];
    const bossMaxHp = Math.max(0, Math.floor(input.bossMaxHp ?? 0));
    const bossRemainingHp = Math.max(0, Math.floor(input.bossRemainingHp ?? bossMaxHp));
    const res = this.db
      .prepare(
        `INSERT INTO rpg_raids (
          guild_id, channel_id, message_id, leader_id, tier, boss_name,
          boss_max_hp, boss_remaining_hp, members_json, merc_ids_json,
          status, mvp_user_id, result_summary, highlights_json, payouts_json,
          created_at, expires_at, resolved_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, '[]', 'recruiting', NULL, '', '[]', '[]', ?, ?, 0)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.leaderId,
        input.tier,
        input.bossName,
        bossMaxHp,
        bossRemainingHp,
        JSON.stringify(members),
        input.createdAt,
        input.expiresAt,
      );
    const created = this.getRaidById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created RPG raid');
    return created;
  }

  getRaidById(raidId: number): RpgRaid | null {
    const row = this.db
      .prepare('SELECT * FROM rpg_raids WHERE id = ?')
      .get(raidId) as RpgRaidSqlRow | undefined;
    return row ? mapRaid(row) : null;
  }

  getRecruitingRaidForLeader(guildId: string, leaderId: string): RpgRaid | null {
    const row = this.db
      .prepare(
        "SELECT * FROM rpg_raids WHERE guild_id = ? AND leader_id = ? AND status = 'recruiting' ORDER BY id DESC LIMIT 1",
      )
      .get(guildId, leaderId) as RpgRaidSqlRow | undefined;
    return row ? mapRaid(row) : null;
  }

  bindRaidMessage(raidId: number, messageId: string, channelId?: string): void {
    if (channelId) {
      this.db
        .prepare('UPDATE rpg_raids SET message_id = ?, channel_id = ? WHERE id = ?')
        .run(messageId, channelId, raidId);
      return;
    }
    this.db
      .prepare('UPDATE rpg_raids SET message_id = ? WHERE id = ?')
      .run(messageId, raidId);
  }

  saveRaid(raid: RpgRaid): void {
    this.db
      .prepare(
        `UPDATE rpg_raids SET
          channel_id = ?, message_id = ?, boss_max_hp = ?, boss_remaining_hp = ?,
          members_json = ?, merc_ids_json = ?, status = ?, mvp_user_id = ?,
          result_summary = ?, highlights_json = ?, payouts_json = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .run(
        raid.channelId,
        raid.messageId,
        raid.bossMaxHp,
        raid.bossRemainingHp,
        JSON.stringify(raid.members),
        JSON.stringify(raid.mercIds),
        raid.status,
        raid.mvpUserId,
        raid.resultSummary,
        JSON.stringify(raid.highlights),
        JSON.stringify(raid.payouts),
        raid.resolvedAt,
        raid.id,
      );
  }

  listDueRecruitingRaids(nowMs: number): RpgRaid[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM rpg_raids WHERE status = 'recruiting' AND expires_at <= ? ORDER BY expires_at ASC, id ASC",
      )
      .all(nowMs) as RpgRaidSqlRow[];
    return rows.map(mapRaid);
  }
}
