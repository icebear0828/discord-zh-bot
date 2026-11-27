import type Database from 'better-sqlite3';
import { awakenLegacyItemAffixes } from '../../../services/rpgAffixes.js';
import { mapItem } from './mappers.js';
import type {
  CreateRpgItemInput,
  RpgAffix,
  RpgItem,
  RpgItemSlot,
  RpgItemSqlRow,
  RpgLegendaryEffect,
} from './types.js';

export class RpgItemQueries {
  constructor(private readonly db: Database.Database) {}

  createItem(input: CreateRpgItemInput): RpgItem {
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
    const insertedId = Number(res.lastInsertRowid);
    if (!hasExplicitAffixInit) {
      const awakened = awakenLegacyItemAffixes({ id: insertedId, rarity: input.rarity });
      this.updateItemAffixes(insertedId, awakened.affixes, awakened.legendaryEffect, true);
    }
    const created = this.getItemById(insertedId);
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
}
