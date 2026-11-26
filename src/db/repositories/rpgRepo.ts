import type Database from 'better-sqlite3';

export type RpgClassKey = 'warrior' | 'mage' | 'ranger' | 'paladin';
export type RpgItemSlot = 'weapon' | 'armor' | 'accessory';
export type RpgItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type RpgTrialStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';

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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rpg_characters_realm_lb
      ON rpg_characters (guild_id, level DESC, xp DESC, total_breakthroughs DESC, total_boss_kills DESC);
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

function parseUserIdArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
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
    supporters: parseUserIdArray(row.supporters_json),
    saboteurs: parseUserIdArray(row.saboteurs_json),
    status: row.status,
    resultSummary: row.result_summary,
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
          trial_pills_staged, trial_use_guard, updated_at
        ) VALUES (?, ?, ?, ?, 1, 0, ?, ?, 0, 0, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)`,
      )
      .run(
        input.guildId,
        input.userId,
        input.classKey,
        input.classSelected ? 1 : 0,
        input.stamina,
        input.lastStaminaDate,
        lastIdleClaimAt,
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
          trial_pills_staged = ?, trial_use_guard = ?, updated_at = ?
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
        character.updatedAt,
        character.guildId,
        character.userId,
      );
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
    createdAt: number;
  }): RpgItem {
    const res = this.db
      .prepare(
        `INSERT INTO rpg_items (
          guild_id, user_id, name, slot, rarity,
          base_hp, base_atk, base_def, base_crit_bp,
          enhance_level, equipped, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
}
