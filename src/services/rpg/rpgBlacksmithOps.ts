import type {
  RpgAffix,
  RpgCharacter,
  RpgItem,
  RpgItemRarity,
  RpgItemSlot,
} from '../../db/repositories/rpgRepo.js';
import {
  computeClassAwareItemScore,
  getAffixSlotCount,
  getReforgeCost,
  getSalvageArcaneDust,
  rollRandomAffixes,
} from '../rpgAffixes.js';
import { RARITY_ORDER } from './rpgCatalogBossesAndItems.js';
import { getEnhanceInfo, getSalvageValue } from './rpgPureMath.js';
import {
  clampUnit,
  type CombatStats,
  type RpgCombatStats,
  type RpgOpsContext,
} from './rpgTypesAndConfig.js';

export type EquipItemResult =
  | { ok: true; item: RpgItem; unequippedItem: RpgItem | null; stats: CombatStats }
  | { ok: false; reason: 'not_found' | 'already_equipped' };

export type UnequipItemResult =
  | { ok: true; item: RpgItem; stats: CombatStats }
  | { ok: false; reason: 'not_found' | 'not_equipped' };

export type EnhanceItemResult =
  | { ok: true; success: boolean; item: RpgItem; cost: number; balance: number; successRate: number }
  | { ok: false; reason: 'not_found' | 'max_enhance_level' | 'insufficient_funds'; cost?: number };

export type ToggleItemLockResult =
  | { ok: true; item: RpgItem; locked: boolean }
  | { ok: false; reason: 'not_found' };

export type ReforgeItemAffixesResult =
  | {
      ok: true;
      item: RpgItem;
      previousAffixes: RpgAffix[];
      lockedAffix: RpgAffix | null;
      costCoins: number;
      costDust: number;
      balance: number;
      arcaneDust: number;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'cannot_reforge_common'
        | 'invalid_lock_index'
        | 'insufficient_funds'
        | 'insufficient_dust';
      costCoins?: number;
      costDust?: number;
      currentDust?: number;
    };

export type SalvageItemResult =
  | {
      ok: true;
      salvagedItem: RpgItem;
      coinsEarned: number;
      dustEarned: number;
      arcaneDust: number;
      balance: number;
    }
  | { ok: false; reason: 'not_found' | 'item_equipped' | 'item_locked' };

export interface EquipBestGearChange {
  slot: RpgItemSlot;
  item: RpgItem;
  previousItem?: RpgItem;
}

export type EquipBestGearResult =
  | { ok: true; changed: EquipBestGearChange[]; unchangedCount: number; stats: RpgCombatStats }
  | { ok: false; reason: 'no_items' };

export type BulkSalvageItemsResult =
  | {
      ok: true;
      salvagedCount: number;
      totalCoins: number;
      totalDust: number;
      arcaneDust: number;
      balance: number;
      byRarity: Partial<Record<RpgItemRarity, number>>;
    }
  | { ok: false; reason: 'nothing_to_salvage' };

export function equipItem(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  itemId: number,
  nowMs = Date.now(),
): EquipItemResult {
  return ctx.db.transaction((): EquipItemResult => {
    const item = ctx.rpgRepo.getItemById(itemId);
    if (!item || item.guildId !== guildId || item.userId !== userId) {
      return { ok: false, reason: 'not_found' };
    }
    if (item.equipped) {
      return { ok: false, reason: 'already_equipped' };
    }

    const equipped = ctx.rpgRepo.listEquippedItems(guildId, userId);
    const prevInSlot = equipped.find((eq) => eq.slot === item.slot) ?? null;

    ctx.rpgRepo.setSlotEquipped(guildId, userId, item.slot, item.id);
    const updatedItem = ctx.rpgRepo.getItemById(item.id)!;
    const unequippedItem = prevInSlot ? { ...prevInSlot, equipped: false } : null;
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    const stats = ctx.computeCombatStatsForCharacter(character);

    return { ok: true, item: updatedItem, unequippedItem, stats };
  })();
}

export function unequipItem(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  itemId: number,
  nowMs = Date.now(),
): UnequipItemResult {
  return ctx.db.transaction((): UnequipItemResult => {
    const item = ctx.rpgRepo.getItemById(itemId);
    if (!item || item.guildId !== guildId || item.userId !== userId) {
      return { ok: false, reason: 'not_found' };
    }
    if (!item.equipped) {
      return { ok: false, reason: 'not_equipped' };
    }

    ctx.rpgRepo.setSlotEquipped(guildId, userId, item.slot, null);
    const updatedItem = ctx.rpgRepo.getItemById(item.id)!;
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    const stats = ctx.computeCombatStatsForCharacter(character);

    return { ok: true, item: updatedItem, stats };
  })();
}

export function enhanceItem(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  itemId: number,
  _nowMs = Date.now(),
  rng: () => number = Math.random,
): EnhanceItemResult {
  return ctx.db.transaction((): EnhanceItemResult => {
    const item = ctx.rpgRepo.getItemById(itemId);
    if (!item || item.guildId !== guildId || item.userId !== userId) {
      return { ok: false, reason: 'not_found' };
    }

    const info = getEnhanceInfo(item);
    if (!info) {
      return { ok: false, reason: 'max_enhance_level' };
    }

    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    if (profile.coins < info.cost) {
      return { ok: false, reason: 'insufficient_funds', cost: info.cost };
    }

    const balance = profile.coins - info.cost;
    ctx.profileRepo.save({ ...profile, coins: balance });

    const succeeded = clampUnit(rng()) < info.successRate;
    if (succeeded) {
      ctx.rpgRepo.updateItemEnhanceLevel(item.id, info.nextLevel);
    }

    const finalItem = ctx.rpgRepo.getItemById(item.id)!;
    return {
      ok: true,
      success: succeeded,
      item: finalItem,
      cost: info.cost,
      balance,
      successRate: info.successRate,
    };
  })();
}

export function toggleItemLock(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  itemId: number,
): ToggleItemLockResult {
  return ctx.db.transaction((): ToggleItemLockResult => {
    const item = ctx.rpgRepo.getItemById(itemId);
    if (!item || item.guildId !== guildId || item.userId !== userId) {
      return { ok: false, reason: 'not_found' };
    }
    const nextLocked = !item.locked;
    ctx.rpgRepo.setItemLocked(item.id, guildId, userId, nextLocked);
    const updated = ctx.rpgRepo.getItemById(item.id)!;
    return { ok: true, item: updated, locked: nextLocked };
  })();
}

export function reforgeItemAffixes(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  itemId: number,
  lockedAffixIndex: number | null = null,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): ReforgeItemAffixesResult {
  return ctx.db.transaction((): ReforgeItemAffixesResult => {
    const item = ctx.rpgRepo.getItemById(itemId);
    if (!item || item.guildId !== guildId || item.userId !== userId) {
      return { ok: false, reason: 'not_found' };
    }

    if (getAffixSlotCount(item.rarity) <= 0) {
      return { ok: false, reason: 'cannot_reforge_common' };
    }

    let lockedAffix: RpgAffix | null = null;
    if (lockedAffixIndex !== null) {
      if (
        !Number.isInteger(lockedAffixIndex) ||
        lockedAffixIndex < 0 ||
        lockedAffixIndex >= item.affixes.length
      ) {
        return { ok: false, reason: 'invalid_lock_index' };
      }
      lockedAffix = item.affixes[lockedAffixIndex] ?? null;
    }

    const cost = getReforgeCost(item, lockedAffix !== null);
    if (!cost) {
      return { ok: false, reason: 'cannot_reforge_common' };
    }

    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    if (profile.coins < cost.coins) {
      return {
        ok: false,
        reason: 'insufficient_funds',
        costCoins: cost.coins,
        costDust: cost.dust,
      };
    }

    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    if (character.arcaneDust < cost.dust) {
      return {
        ok: false,
        reason: 'insufficient_dust',
        costCoins: cost.coins,
        costDust: cost.dust,
        currentDust: character.arcaneDust,
      };
    }

    const balance = profile.coins - cost.coins;
    ctx.profileRepo.save({ ...profile, coins: balance });

    const updatedChar: RpgCharacter = {
      ...character,
      arcaneDust: character.arcaneDust - cost.dust,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updatedChar);

    const newAffixes = rollRandomAffixes(item.rarity, rng, lockedAffix);
    ctx.rpgRepo.updateItemAffixes(item.id, newAffixes, item.legendaryEffect, true);
    const updatedItem = ctx.rpgRepo.getItemById(item.id)!;

    return {
      ok: true,
      item: updatedItem,
      previousAffixes: item.affixes,
      lockedAffix,
      costCoins: cost.coins,
      costDust: cost.dust,
      balance,
      arcaneDust: updatedChar.arcaneDust,
    };
  })();
}

export function salvageItem(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  itemId: number,
  nowMs = Date.now(),
): SalvageItemResult {
  return ctx.db.transaction((): SalvageItemResult => {
    const item = ctx.rpgRepo.getItemById(itemId);
    if (!item || item.guildId !== guildId || item.userId !== userId) {
      return { ok: false, reason: 'not_found' };
    }
    if (item.equipped) {
      return { ok: false, reason: 'item_equipped' };
    }
    if (item.locked) {
      return { ok: false, reason: 'item_locked' };
    }

    const coinsEarned = getSalvageValue(item);
    const dustEarned = getSalvageArcaneDust(item);
    ctx.rpgRepo.deleteItem(item.id, guildId, userId);
    const updatedProfile = ctx.profileRepo.addCoins(guildId, userId, coinsEarned);
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    const updatedChar: RpgCharacter = {
      ...character,
      arcaneDust: character.arcaneDust + dustEarned,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updatedChar);

    return {
      ok: true,
      salvagedItem: item,
      coinsEarned,
      dustEarned,
      arcaneDust: updatedChar.arcaneDust,
      balance: updatedProfile.coins,
    };
  })();
}

export function equipBestGear(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): EquipBestGearResult {
  return ctx.db.transaction((): EquipBestGearResult => {
    const items = ctx.rpgRepo.listItems(guildId, userId);
    if (items.length === 0) {
      return { ok: false, reason: 'no_items' };
    }

    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    const slots: readonly RpgItemSlot[] = ['weapon', 'armor', 'accessory'];
    const changed: EquipBestGearChange[] = [];
    let unchangedCount = 0;

    for (const slot of slots) {
      const slotItems = items.filter((item) => item.slot === slot);
      if (slotItems.length === 0) {
        continue;
      }

      let best = slotItems[0]!;
      let bestScore = computeClassAwareItemScore(best, character.classKey);
      for (let i = 1; i < slotItems.length; i++) {
        const candidate = slotItems[i]!;
        const candidateScore = computeClassAwareItemScore(candidate, character.classKey);
        if (
          candidateScore > bestScore ||
          (candidateScore === bestScore && candidate.enhanceLevel > best.enhanceLevel) ||
          (candidateScore === bestScore &&
            candidate.enhanceLevel === best.enhanceLevel &&
            candidate.id < best.id)
        ) {
          best = candidate;
          bestScore = candidateScore;
        }
      }

      if (best.equipped) {
        unchangedCount += 1;
        continue;
      }

      const previousEquipped = slotItems.find((item) => item.equipped);
      ctx.rpgRepo.setSlotEquipped(guildId, userId, slot, best.id);
      const updatedBest = ctx.rpgRepo.getItemById(best.id)!;
      if (previousEquipped) {
        changed.push({
          slot,
          item: updatedBest,
          previousItem: { ...previousEquipped, equipped: false },
        });
      } else {
        changed.push({ slot, item: updatedBest });
      }
    }

    const stats = ctx.computeCombatStatsForCharacter(character);
    return { ok: true, changed, unchangedCount, stats };
  })();
}

export function bulkSalvageItems(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  maxRarity: 'uncommon' | 'rare' = 'uncommon',
  nowMs = Date.now(),
): BulkSalvageItemsResult {
  return ctx.db.transaction((): BulkSalvageItemsResult => {
    const maxOrder = RARITY_ORDER[maxRarity];
    const targets = ctx.rpgRepo
      .listItems(guildId, userId)
      .filter((item) => !item.equipped && !item.locked && RARITY_ORDER[item.rarity] <= maxOrder);

    if (targets.length === 0) {
      return { ok: false, reason: 'nothing_to_salvage' };
    }

    let salvagedCount = 0;
    let totalCoins = 0;
    let totalDust = 0;
    const byRarity: Partial<Record<RpgItemRarity, number>> = {};

    for (const item of targets) {
      const deleted = ctx.rpgRepo.deleteItem(item.id, guildId, userId);
      if (!deleted) continue;
      salvagedCount += 1;
      totalCoins += getSalvageValue(item);
      totalDust += getSalvageArcaneDust(item);
      byRarity[item.rarity] = (byRarity[item.rarity] ?? 0) + 1;
    }

    if (salvagedCount === 0) {
      return { ok: false, reason: 'nothing_to_salvage' };
    }

    const updatedProfile = ctx.profileRepo.addCoins(guildId, userId, totalCoins);
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    const updatedChar: RpgCharacter = {
      ...character,
      arcaneDust: character.arcaneDust + totalDust,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updatedChar);

    return {
      ok: true,
      salvagedCount,
      totalCoins,
      totalDust,
      arcaneDust: updatedChar.arcaneDust,
      balance: updatedProfile.coins,
      byRarity,
    };
  })();
}
