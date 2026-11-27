import { getDateKey } from '../economy/economyTypesAndDates.js';
import {
  DEFAULT_STAT_BOOST_DAILY_LIMIT,
  parseJsonObject,
  type ShopOpsContext,
  type TitlePayload,
  type UseInventoryResult,
} from './shopTypesAndPayloads.js';

export function getStatBoostRemainingTodayOp(
  ctx: ShopOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
  dailyLimit = DEFAULT_STAT_BOOST_DAILY_LIMIT,
): { usedToday: number; remaining: number; dailyLimit: number } {
  const profile = ctx.profileRepo.getOrCreate(guildId, userId);
  const today = getDateKey(nowMs, ctx.timezone);
  const usedToday = profile.lastStatBoostDate === today ? profile.statBoostDailyCount : 0;
  const safeLimit = Math.max(1, Math.floor(dailyLimit));
  return {
    usedToday,
    remaining: Math.max(0, safeLimit - usedToday),
    dailyLimit: safeLimit,
  };
}

export function redeemCustomTitleVoucherOp(
  ctx: ShopOpsContext,
  guildId: string,
  userId: string,
  inventoryId: number,
  rawTitle: string,
  nowMs = Date.now(),
): UseInventoryResult {
  const cleanTitle = rawTitle.trim();
  if (cleanTitle.length < 1 || cleanTitle.length > 20) {
    return { ok: false, reason: 'invalid_title' };
  }

  return ctx.db.transaction((): UseInventoryResult => {
    const inv = ctx.shopRepo.getInventoryItem(guildId, userId, inventoryId);
    if (!inv || inv.quantity <= 0 || inv.itemType !== 'custom_title') {
      return { ok: false, reason: 'not_found' };
    }

    const owned = ctx.shopRepo.findInventoryByTypeAndName(guildId, userId, 'title', cleanTitle);
    if (owned) {
      return { ok: false, reason: 'already_owned' };
    }

    const consumed = ctx.shopRepo.consumeInventoryItem(guildId, userId, inv.id);
    if (!consumed) {
      return { ok: false, reason: 'not_found' };
    }

    const payload: TitlePayload = { titleText: cleanTitle };
    const titleInv = ctx.shopRepo.addInventoryItem({
      guildId,
      userId,
      itemType: 'title',
      itemName: cleanTitle,
      payloadJson: JSON.stringify(payload),
      quantity: 1,
      acquiredAt: nowMs,
    });
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    ctx.profileRepo.save({
      ...profile,
      equippedTitle: cleanTitle,
    });

    return {
      ok: true,
      item: titleInv,
      equippedTitle: cleanTitle,
    };
  })();
}

export function useInventoryItemOp(
  ctx: ShopOpsContext,
  guildId: string,
  userId: string,
  inventoryId: number,
  nowMs = Date.now(),
): UseInventoryResult {
  return ctx.db.transaction((): UseInventoryResult => {
    const inv = ctx.shopRepo.getInventoryItem(guildId, userId, inventoryId);
    if (!inv || inv.quantity <= 0) {
      return { ok: false, reason: 'not_found' };
    }

    const profile = ctx.profileRepo.getOrCreate(guildId, userId);

    if (inv.itemType === 'title') {
      const obj = parseJsonObject(inv.payloadJson);
      const titleText = typeof obj.titleText === 'string' ? obj.titleText : inv.itemName;
      ctx.profileRepo.save({ ...profile, equippedTitle: titleText });
      return { ok: true, item: inv, equippedTitle: titleText };
    }

    if (inv.itemType === 'xp_boost') {
      const obj = parseJsonObject(inv.payloadJson);
      const multiplier =
        typeof obj.multiplier === 'number' && obj.multiplier > 1 ? obj.multiplier : 1.5;
      const durationSec =
        typeof obj.durationSec === 'number' && obj.durationSec > 0 ? obj.durationSec : 3600;
      const durationMs = durationSec * 1000;

      const hasActive = profile.xpBoostExpiresAt > nowMs && profile.xpBoostMultiplier > 1;
      if (hasActive && profile.xpBoostMultiplier !== multiplier) {
        return {
          ok: false,
          reason: 'boost_multiplier_conflict',
          activeBoostMultiplier: profile.xpBoostMultiplier,
          activeBoostExpiresAt: profile.xpBoostExpiresAt,
        };
      }

      const consumed = ctx.shopRepo.consumeInventoryItem(guildId, userId, inv.id);
      if (!consumed) {
        return { ok: false, reason: 'not_found' };
      }

      const nextExpiresAt = hasActive
        ? profile.xpBoostExpiresAt + durationMs
        : nowMs + durationMs;

      ctx.profileRepo.save({
        ...profile,
        xpBoostMultiplier: multiplier,
        xpBoostExpiresAt: nextExpiresAt,
      });

      return {
        ok: true,
        item: inv,
        boostMultiplier: multiplier,
        boostExpiresAt: nextExpiresAt,
      };
    }

    return { ok: false, reason: 'unsupported_item' };
  })();
}
