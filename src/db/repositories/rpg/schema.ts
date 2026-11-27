import type Database from 'better-sqlite3';

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
