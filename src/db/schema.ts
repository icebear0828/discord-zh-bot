import type Database from 'better-sqlite3';
import { initAiSchema } from './repositories/aiMemoryRepo.js';
import { initBlackjackSchema } from './repositories/blackjackRepo.js';
import { initChaosSchema } from './repositories/chaosRepo.js';
import { initCreditLoanSchema } from './repositories/creditLoanRepo.js';
import { initDuelSchema } from './repositories/duelRepo.js';
import { initMonitorSchema } from './repositories/monitorRepo.js';
import { initRedPacketSchema } from './repositories/redPacketRepo.js';
import { initRpgSchema } from './repositories/rpgRepo.js';
import { initSocialPetSchema } from './repositories/socialPetRepo.js';
import { initWorldEventSchema } from './repositories/worldEventRepo.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS guild_configs (
  guild_id TEXT PRIMARY KEY,
  modules_json TEXT NOT NULL,
  admin_role_ids_json TEXT NOT NULL,
  admin_user_ids_json TEXT NOT NULL DEFAULT '[]',
  leveling_config_json TEXT NOT NULL,
  economy_config_json TEXT NOT NULL,
  welcome_config_json TEXT NOT NULL,
  ticket_config_json TEXT NOT NULL,
  games_config_json TEXT NOT NULL DEFAULT '{}',
  ai_config_json TEXT NOT NULL DEFAULT '{}',
  credit_loan_config_json TEXT NOT NULL DEFAULT '{}',
  rpg_config_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member_profiles (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  level_offset INTEGER NOT NULL DEFAULT 0,
  stat_value INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  voice_minutes INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  bank_coins INTEGER NOT NULL DEFAULT 0,
  daily_streak INTEGER NOT NULL DEFAULT 0,
  last_daily_date TEXT,
  last_bank_interest_date TEXT,
  last_work_at INTEGER NOT NULL DEFAULT 0,
  last_rob_at INTEGER NOT NULL DEFAULT 0,
  rob_shield_until INTEGER NOT NULL DEFAULT 0,
  equipped_title TEXT,
  card_nickname TEXT,
  card_tag TEXT,
  card_bio TEXT,
  card_color TEXT,
  last_stat_boost_date TEXT,
  stat_boost_daily_count INTEGER NOT NULL DEFAULT 0,
  xp_boost_multiplier REAL NOT NULL DEFAULT 1.0,
  xp_boost_expires_at INTEGER NOT NULL DEFAULT 0,
  heat_streak INTEGER NOT NULL DEFAULT 0,
  last_xp_at INTEGER NOT NULL DEFAULT 0,
  hour_window_start INTEGER NOT NULL DEFAULT 0,
  hour_xp_earned INTEGER NOT NULL DEFAULT 0,
  last_pet_work_at INTEGER NOT NULL DEFAULT 0,
  pet_pvp_xp_date TEXT NOT NULL DEFAULT '',
  pet_pvp_xp_daily INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_member_profiles_xp
  ON member_profiles (guild_id, xp DESC);

CREATE INDEX IF NOT EXISTS idx_member_profiles_coins
  ON member_profiles (guild_id, coins DESC);

CREATE TABLE IF NOT EXISTS level_role_rewards (
  guild_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, level)
);

CREATE TABLE IF NOT EXISTS shop_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('role', 'title', 'xp_boost', 'stat_boost', 'custom_title', 'pet_xp', 'mystery_box', 'credit_boost', 'rpg_supply', 'cp_affinity')),
  price INTEGER NOT NULL CHECK (price >= 0),
  role_id TEXT,
  title_text TEXT,
  boost_multiplier REAL,
  boost_duration_sec INTEGER,
  stock INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_items_guild
  ON shop_items (guild_id, id);

CREATE TABLE IF NOT EXISTS user_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  acquired_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_owner
  ON user_inventory (guild_id, user_id);

CREATE TABLE IF NOT EXISTS fun_fortunes (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  luck_tier TEXT NOT NULL,
  good_for TEXT NOT NULL,
  avoid TEXT NOT NULL,
  lucky_number INTEGER NOT NULL,
  bonus_coins INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, date_key)
);

CREATE TABLE IF NOT EXISTS fun_interactions (
  guild_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, actor_id, target_id, action)
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  ticket_number INTEGER NOT NULL,
  creator_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  closed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_guild_creator_status
  ON tickets (guild_id, creator_id, status);

CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  host_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  winner_count INTEGER NOT NULL CHECK (winner_count >= 1),
  min_level INTEGER NOT NULL DEFAULT 0,
  required_role_id TEXT,
  ends_at INTEGER NOT NULL,
  ended INTEGER NOT NULL DEFAULT 0,
  winners_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_giveaways_due
  ON giveaways (ended, ends_at);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, user_id),
  FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invite_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  inviter_id TEXT NOT NULL,
  invitee_id TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  UNIQUE (guild_id, invitee_id)
);

CREATE INDEX IF NOT EXISTS idx_invite_records_inviter
  ON invite_records (guild_id, inviter_id);

CREATE TABLE IF NOT EXISTS role_panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  display_mode TEXT NOT NULL CHECK (display_mode IN ('button', 'select')),
  selection_mode TEXT NOT NULL CHECK (selection_mode IN ('multi', 'single')),
  channel_id TEXT,
  message_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS role_panel_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  panel_id INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (panel_id) REFERENCES role_panels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_role_panel_options_panel
  ON role_panel_options (panel_id, sort_order);
`;

function ensureColumn(
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

export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  initRedPacketSchema(db);
  initChaosSchema(db);
  initWorldEventSchema(db);
  initSocialPetSchema(db);
  initAiSchema(db);
  initMonitorSchema(db);
  initBlackjackSchema(db);
  initDuelSchema(db);
  initCreditLoanSchema(db);
  initRpgSchema(db);

  ensureColumn(db, 'guild_configs', 'admin_user_ids_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'guild_configs', 'games_config_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'guild_configs', 'ai_config_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'guild_configs', 'credit_loan_config_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'guild_configs', 'rpg_config_json', "TEXT NOT NULL DEFAULT '{}'");

  ensureColumn(db, 'member_profiles', 'bank_coins', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'member_profiles', 'last_bank_interest_date', 'TEXT');
  ensureColumn(db, 'member_profiles', 'card_nickname', 'TEXT');
  ensureColumn(db, 'member_profiles', 'card_tag', 'TEXT');
  ensureColumn(db, 'member_profiles', 'card_bio', 'TEXT');
  ensureColumn(db, 'member_profiles', 'card_color', 'TEXT');
  ensureColumn(db, 'member_profiles', 'level_offset', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'member_profiles', 'stat_value', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'member_profiles', 'last_stat_boost_date', 'TEXT');
  ensureColumn(db, 'member_profiles', 'stat_boost_daily_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'member_profiles', 'last_credit_boost_date', 'TEXT');
  ensureColumn(db, 'member_profiles', 'credit_boost_daily_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'member_profiles', 'last_pet_work_at', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'member_profiles', 'pet_pvp_xp_date', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'member_profiles', 'pet_pvp_xp_daily', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn(db, 'red_packets', 'system_funded', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'world_event_participants', 'next_attack_at', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'world_events', 'rewards_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'number_bomb_games', 'payouts_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'predictions', 'locked_at', 'INTEGER NOT NULL DEFAULT 0');

  const shopCols = db.pragma('table_info(shop_items)') as Array<{ name: string }>;
  const shopColNames = new Set(shopCols.map((col) => col.name));
  const shopTableRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'shop_items'")
    .get() as { sql?: string } | undefined;
  const shopSql = shopTableRow?.sql ?? '';
  if (!shopColNames.has('payload_json') || !shopSql.includes('cp_affinity')) {
    const payloadSelect = shopColNames.has('payload_json') ? "COALESCE(payload_json, '{}')" : "'{}'";
    db.transaction(() => {
      db.exec(`
        CREATE TABLE shop_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('role', 'title', 'xp_boost', 'stat_boost', 'custom_title', 'pet_xp', 'mystery_box', 'credit_boost', 'rpg_supply', 'cp_affinity')),
          price INTEGER NOT NULL CHECK (price >= 0),
          role_id TEXT,
          title_text TEXT,
          boost_multiplier REAL,
          boost_duration_sec INTEGER,
          stock INTEGER,
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL
        );
        INSERT INTO shop_items_new (
          id, guild_id, name, description, type, price,
          role_id, title_text, boost_multiplier, boost_duration_sec, stock, payload_json, created_at
        )
        SELECT
          id, guild_id, name, description, type, price,
          role_id, title_text, boost_multiplier, boost_duration_sec, stock, ${payloadSelect}, created_at
        FROM shop_items;
        DROP TABLE shop_items;
        ALTER TABLE shop_items_new RENAME TO shop_items;
        CREATE INDEX IF NOT EXISTS idx_shop_items_guild ON shop_items (guild_id, id);
      `);
    })();
  }
}
