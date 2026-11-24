import type Database from 'better-sqlite3';

export type ShopItemType =
  | 'role'
  | 'title'
  | 'xp_boost'
  | 'stat_boost'
  | 'custom_title'
  | 'pet_xp'
  | 'mystery_box';

export interface ShopItem {
  id: number;
  guildId: string;
  name: string;
  description: string;
  type: ShopItemType;
  price: number;
  roleId: string | null;
  titleText: string | null;
  boostMultiplier: number | null;
  boostDurationSec: number | null;
  stock: number | null;
  payloadJson: string;
  createdAt: number;
}

export interface InventoryItem {
  id: number;
  guildId: string;
  userId: string;
  itemType: ShopItemType;
  itemName: string;
  payloadJson: string;
  quantity: number;
  acquiredAt: number;
}

interface ShopItemRow {
  id: number;
  guild_id: string;
  name: string;
  description: string;
  type: ShopItemType;
  price: number;
  role_id: string | null;
  title_text: string | null;
  boost_multiplier: number | null;
  boost_duration_sec: number | null;
  stock: number | null;
  payload_json?: string;
  created_at: number;
}

interface InventoryRow {
  id: number;
  guild_id: string;
  user_id: string;
  item_type: ShopItemType;
  item_name: string;
  payload_json: string;
  quantity: number;
  acquired_at: number;
}

function mapShopItem(row: ShopItemRow): ShopItem {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    description: row.description,
    type: row.type,
    price: row.price,
    roleId: row.role_id,
    titleText: row.title_text,
    boostMultiplier: row.boost_multiplier,
    boostDurationSec: row.boost_duration_sec,
    stock: row.stock,
    payloadJson: row.payload_json ?? '{}',
    createdAt: row.created_at,
  };
}

function mapInventoryItem(row: InventoryRow): InventoryItem {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    itemType: row.item_type,
    itemName: row.item_name,
    payloadJson: row.payload_json,
    quantity: row.quantity,
    acquiredAt: row.acquired_at,
  };
}

export class ShopRepo {
  constructor(private readonly db: Database.Database) {}

  createItem(
    input: Omit<ShopItem, 'id' | 'createdAt' | 'payloadJson'> & {
      payloadJson?: string;
      createdAt?: number;
    },
  ): ShopItem {
    const now = input.createdAt ?? Date.now();
    const payloadJson = input.payloadJson ?? '{}';
    const res = this.db
      .prepare(
        `INSERT INTO shop_items (
          guild_id, name, description, type, price,
          role_id, title_text, boost_multiplier, boost_duration_sec, stock, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.guildId,
        input.name,
        input.description,
        input.type,
        input.price,
        input.roleId,
        input.titleText,
        input.boostMultiplier,
        input.boostDurationSec,
        input.stock,
        payloadJson,
        now,
      );

    return this.getItemById(input.guildId, Number(res.lastInsertRowid))!;
  }

  getItemById(guildId: string, itemId: number): ShopItem | null {
    const row = this.db
      .prepare('SELECT * FROM shop_items WHERE guild_id = ? AND id = ?')
      .get(guildId, itemId) as ShopItemRow | undefined;
    return row ? mapShopItem(row) : null;
  }

  listItems(guildId: string): ShopItem[] {
    const rows = this.db
      .prepare('SELECT * FROM shop_items WHERE guild_id = ? ORDER BY id ASC')
      .all(guildId) as ShopItemRow[];
    return rows.map(mapShopItem);
  }

  removeItem(guildId: string, itemId: number): boolean {
    const res = this.db
      .prepare('DELETE FROM shop_items WHERE guild_id = ? AND id = ?')
      .run(guildId, itemId);
    return res.changes > 0;
  }

  decrementStock(guildId: string, itemId: number): void {
    this.db
      .prepare(
        'UPDATE shop_items SET stock = stock - 1 WHERE guild_id = ? AND id = ? AND stock IS NOT NULL AND stock > 0',
      )
      .run(guildId, itemId);
  }

  incrementStock(guildId: string, itemId: number): void {
    this.db
      .prepare(
        'UPDATE shop_items SET stock = stock + 1 WHERE guild_id = ? AND id = ? AND stock IS NOT NULL',
      )
      .run(guildId, itemId);
  }

  listInventory(guildId: string, userId: string): InventoryItem[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM user_inventory WHERE guild_id = ? AND user_id = ? AND quantity > 0 ORDER BY id ASC',
      )
      .all(guildId, userId) as InventoryRow[];
    return rows.map(mapInventoryItem);
  }

  getInventoryItem(guildId: string, userId: string, inventoryId: number): InventoryItem | null {
    const row = this.db
      .prepare('SELECT * FROM user_inventory WHERE guild_id = ? AND user_id = ? AND id = ?')
      .get(guildId, userId, inventoryId) as InventoryRow | undefined;
    return row ? mapInventoryItem(row) : null;
  }

  findInventoryByTypeAndName(
    guildId: string,
    userId: string,
    itemType: ShopItemType,
    itemName: string,
  ): InventoryItem | null {
    const row = this.db
      .prepare(
        'SELECT * FROM user_inventory WHERE guild_id = ? AND user_id = ? AND item_type = ? AND item_name = ?',
      )
      .get(guildId, userId, itemType, itemName) as InventoryRow | undefined;
    return row ? mapInventoryItem(row) : null;
  }

  addInventoryItem(input: {
    guildId: string;
    userId: string;
    itemType: ShopItemType;
    itemName: string;
    payloadJson: string;
    quantity?: number;
    acquiredAt?: number;
  }): InventoryItem {
    const qty = input.quantity ?? 1;
    const now = input.acquiredAt ?? Date.now();
    const existing = this.db
      .prepare(
        'SELECT * FROM user_inventory WHERE guild_id = ? AND user_id = ? AND item_type = ? AND item_name = ? AND payload_json = ?',
      )
      .get(
        input.guildId,
        input.userId,
        input.itemType,
        input.itemName,
        input.payloadJson,
      ) as InventoryRow | undefined;

    if (existing) {
      this.db
        .prepare('UPDATE user_inventory SET quantity = quantity + ? WHERE id = ?')
        .run(qty, existing.id);
      return this.getInventoryItem(input.guildId, input.userId, existing.id)!;
    }

    const res = this.db
      .prepare(
        `INSERT INTO user_inventory (
          guild_id, user_id, item_type, item_name, payload_json, quantity, acquired_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.guildId,
        input.userId,
        input.itemType,
        input.itemName,
        input.payloadJson,
        qty,
        now,
      );

    return this.getInventoryItem(input.guildId, input.userId, Number(res.lastInsertRowid))!;
  }

  consumeInventoryItem(guildId: string, userId: string, inventoryId: number): boolean {
    const item = this.getInventoryItem(guildId, userId, inventoryId);
    if (!item || item.quantity <= 0) {
      return false;
    }

    if (item.quantity === 1) {
      this.db
        .prepare('DELETE FROM user_inventory WHERE id = ? AND guild_id = ? AND user_id = ?')
        .run(inventoryId, guildId, userId);
    } else {
      this.db
        .prepare(
          'UPDATE user_inventory SET quantity = quantity - 1 WHERE id = ? AND guild_id = ? AND user_id = ?',
        )
        .run(inventoryId, guildId, userId);
    }
    return true;
  }
}
