import type Database from 'better-sqlite3';

export type RpgClassKey = 'warrior' | 'mage' | 'ranger' | 'paladin';
export type RpgItemSlot = 'weapon' | 'armor' | 'accessory';
export type RpgItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

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
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rpg_characters_leaderboard
  ON rpg_characters (guild_id, max_chapter_cleared DESC, level DESC, total_clears DESC, xp DESC);

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
`;

export function initRpgSchema(db: Database.Database): void {
  db.exec(RPG_SCHEMA_SQL);
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

export interface RpgRunRecord {
  guildId: string;
  userId: string;
  chapter: number;
  floor: number;
  stateJson: string;
  updatedAt: number;
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

interface RpgRunSqlRow {
  guild_id: string;
  user_id: string;
  chapter: number;
  floor: number;
  state_json: string;
  updated_at: number;
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

function mapRun(row: RpgRunSqlRow): RpgRunRecord {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    chapter: row.chapter,
    floor: row.floor,
    stateJson: row.state_json,
    updatedAt: row.updated_at,
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
    updatedAt: number;
  }): RpgCharacter {
    this.db
      .prepare(
        `INSERT INTO rpg_characters (
          guild_id, user_id, class_key, class_selected, level, xp, stamina,
          last_stamina_date, stamina_buys_today, max_chapter_cleared,
          total_clears, total_boss_kills, updated_at
        ) VALUES (?, ?, ?, ?, 1, 0, ?, ?, 0, 0, 0, 0, ?)`,
      )
      .run(
        input.guildId,
        input.userId,
        input.classKey,
        input.classSelected ? 1 : 0,
        input.stamina,
        input.lastStaminaDate,
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
          total_clears = ?, total_boss_kills = ?, updated_at = ?
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
         ORDER BY max_chapter_cleared DESC, level DESC, total_clears DESC, xp DESC, updated_at ASC
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

  // Runs
  getRun(guildId: string, userId: string): RpgRunRecord | null {
    const row = this.db
      .prepare('SELECT * FROM rpg_runs WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as RpgRunSqlRow | undefined;
    return row ? mapRun(row) : null;
  }

  upsertRun(record: RpgRunRecord): void {
    this.db
      .prepare(
        `INSERT INTO rpg_runs (guild_id, user_id, chapter, floor, state_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET
           chapter = excluded.chapter,
           floor = excluded.floor,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.guildId,
        record.userId,
        record.chapter,
        record.floor,
        record.stateJson,
        record.updatedAt,
      );
  }

  deleteRun(guildId: string, userId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM rpg_runs WHERE guild_id = ? AND user_id = ?')
      .run(guildId, userId);
    return res.changes > 0;
  }
}
