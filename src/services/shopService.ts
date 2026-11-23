import type Database from 'better-sqlite3';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { InventoryItem, ShopItem, ShopRepo } from '../db/repositories/shopRepo.js';

export type BuyResult =
  | {
      ok: true;
      item: ShopItem;
      balance: number;
      grantRoleId: string | null;
      equippedTitle: string | null;
      addedInventory: InventoryItem | null;
    }
  | {
      ok: false;
      reason: 'not_found' | 'out_of_stock' | 'insufficient_funds' | 'already_owned';
    };

export type UseInventoryResult =
  | {
      ok: true;
      item: InventoryItem;
      boostMultiplier?: number;
      boostExpiresAt?: number;
      equippedTitle?: string;
    }
  | { ok: false; reason: 'not_found' | 'unsupported_item' };

interface TitlePayload {
  titleText: string;
}

interface BoostPayload {
  multiplier: number;
  durationSec: number;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

export class ShopService {
  constructor(
    private readonly db: Database.Database,
    private readonly profileRepo: ProfileRepo,
    private readonly shopRepo: ShopRepo,
  ) {}

  createRoleItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    roleId: string;
    stock: number | null;
  }): ShopItem {
    return this.shopRepo.createItem({
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      type: 'role',
      price: Math.max(0, Math.floor(input.price)),
      roleId: input.roleId,
      titleText: null,
      boostMultiplier: null,
      boostDurationSec: null,
      stock: input.stock,
    });
  }

  createTitleItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    titleText: string;
    stock: number | null;
  }): ShopItem {
    return this.shopRepo.createItem({
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      type: 'title',
      price: Math.max(0, Math.floor(input.price)),
      roleId: null,
      titleText: input.titleText,
      boostMultiplier: null,
      boostDurationSec: null,
      stock: input.stock,
    });
  }

  createBoostItem(input: {
    guildId: string;
    name: string;
    description: string;
    price: number;
    boostMultiplier: number;
    boostDurationSec: number;
    stock: number | null;
  }): ShopItem {
    return this.shopRepo.createItem({
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      type: 'xp_boost',
      price: Math.max(0, Math.floor(input.price)),
      roleId: null,
      titleText: null,
      boostMultiplier: input.boostMultiplier,
      boostDurationSec: input.boostDurationSec,
      stock: input.stock,
    });
  }

  listItems(guildId: string): ShopItem[] {
    return this.shopRepo.listItems(guildId);
  }

  removeItem(guildId: string, itemId: number): boolean {
    return this.shopRepo.removeItem(guildId, itemId);
  }

  listInventory(guildId: string, userId: string): InventoryItem[] {
    return this.shopRepo.listInventory(guildId, userId);
  }

  buyItem(guildId: string, userId: string, itemId: number, nowMs = Date.now()): BuyResult {
    return this.db.transaction((): BuyResult => {
      const item = this.shopRepo.getItemById(guildId, itemId);
      if (!item) {
        return { ok: false, reason: 'not_found' };
      }
      if (item.stock !== null && item.stock <= 0) {
        return { ok: false, reason: 'out_of_stock' };
      }

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < item.price) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      if (item.type === 'title' && item.titleText) {
        const owned = this.shopRepo.findInventoryByTypeAndName(
          guildId,
          userId,
          'title',
          item.titleText,
        );
        if (owned) {
          return { ok: false, reason: 'already_owned' };
        }
      }

      this.shopRepo.decrementStock(guildId, item.id);
      const nextCoins = profile.coins - item.price;

      if (item.type === 'role') {
        this.profileRepo.save({ ...profile, coins: nextCoins });
        return {
          ok: true,
          item,
          balance: nextCoins,
          grantRoleId: item.roleId,
          equippedTitle: null,
          addedInventory: null,
        };
      }

      if (item.type === 'title' && item.titleText) {
        const payload: TitlePayload = { titleText: item.titleText };
        const inv = this.shopRepo.addInventoryItem({
          guildId,
          userId,
          itemType: 'title',
          itemName: item.titleText,
          payloadJson: JSON.stringify(payload),
          quantity: 1,
          acquiredAt: nowMs,
        });
        this.profileRepo.save({
          ...profile,
          coins: nextCoins,
          equippedTitle: item.titleText,
        });
        return {
          ok: true,
          item,
          balance: nextCoins,
          grantRoleId: null,
          equippedTitle: item.titleText,
          addedInventory: inv,
        };
      }

      const boostPayload: BoostPayload = {
        multiplier: item.boostMultiplier ?? 1.5,
        durationSec: item.boostDurationSec ?? 3600,
      };
      const inv = this.shopRepo.addInventoryItem({
        guildId,
        userId,
        itemType: 'xp_boost',
        itemName: item.name,
        payloadJson: JSON.stringify(boostPayload),
        quantity: 1,
        acquiredAt: nowMs,
      });
      this.profileRepo.save({ ...profile, coins: nextCoins });

      return {
        ok: true,
        item,
        balance: nextCoins,
        grantRoleId: null,
        equippedTitle: null,
        addedInventory: inv,
      };
    })();
  }

  refundRolePurchase(guildId: string, userId: string, itemId: number, amount: number): void {
    this.db.transaction((): void => {
      this.profileRepo.addCoins(guildId, userId, amount);
      this.shopRepo.incrementStock(guildId, itemId);
    })();
  }

  useInventoryItem(
    guildId: string,
    userId: string,
    inventoryId: number,
    nowMs = Date.now(),
  ): UseInventoryResult {
    return this.db.transaction((): UseInventoryResult => {
      const inv = this.shopRepo.getInventoryItem(guildId, userId, inventoryId);
      if (!inv || inv.quantity <= 0) {
        return { ok: false, reason: 'not_found' };
      }

      const profile = this.profileRepo.getOrCreate(guildId, userId);

      if (inv.itemType === 'title') {
        const obj = parseJsonObject(inv.payloadJson);
        const titleText = typeof obj.titleText === 'string' ? obj.titleText : inv.itemName;
        this.profileRepo.save({ ...profile, equippedTitle: titleText });
        return { ok: true, item: inv, equippedTitle: titleText };
      }

      if (inv.itemType === 'xp_boost') {
        const obj = parseJsonObject(inv.payloadJson);
        const multiplier =
          typeof obj.multiplier === 'number' && obj.multiplier > 1 ? obj.multiplier : 1.5;
        const durationSec =
          typeof obj.durationSec === 'number' && obj.durationSec > 0 ? obj.durationSec : 3600;
        const durationMs = durationSec * 1000;

        const consumed = this.shopRepo.consumeInventoryItem(guildId, userId, inv.id);
        if (!consumed) {
          return { ok: false, reason: 'not_found' };
        }

        const hasActive = profile.xpBoostExpiresAt > nowMs && profile.xpBoostMultiplier > 1;
        let nextMultiplier = multiplier;
        let nextExpiresAt = nowMs + durationMs;

        if (hasActive) {
          if (profile.xpBoostMultiplier === multiplier) {
            nextExpiresAt = profile.xpBoostExpiresAt + durationMs;
          } else if (profile.xpBoostMultiplier > multiplier) {
            nextMultiplier = profile.xpBoostMultiplier;
            nextExpiresAt = profile.xpBoostExpiresAt + durationMs;
          }
        }

        this.profileRepo.save({
          ...profile,
          xpBoostMultiplier: nextMultiplier,
          xpBoostExpiresAt: nextExpiresAt,
        });

        return {
          ok: true,
          item: inv,
          boostMultiplier: nextMultiplier,
          boostExpiresAt: nextExpiresAt,
        };
      }

      return { ok: false, reason: 'unsupported_item' };
    })();
  }
}
