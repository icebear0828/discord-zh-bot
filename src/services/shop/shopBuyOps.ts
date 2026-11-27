import type { ShopItem } from '../../db/repositories/shopRepo.js';
import { CREDIT_SCORE_MAX, getCreditTier } from '../creditLoan/creditTiersAndFlavor.js';
import { getDateKey } from '../economy/economyTypesAndDates.js';
import { DEFAULT_RPG_CONFIG, generateShopRpgLoot, getRpgRealmInfo } from '../rpgService.js';
import { applyPetXp, unlockRelationshipMilestoneTitles } from '../socialPetService.js';
import { openMysteryBoxInTx } from './mysteryBoxEngine.js';
import {
  parseCpAffinityPayload,
  parseCreditBoostPayload,
  parsePetXpPayload,
  parseRolePayload,
  parseRpgSupplyPayload,
  parseStatBoostPayload,
  randomIntInclusive,
  type BoostPayload,
  type BuyResult,
  type RpgSupplyResult,
  type ShopOpsContext,
  type StatBoostOutcome,
  type TitlePayload,
} from './shopTypesAndPayloads.js';

type BuyOkExtras = Partial<
  Omit<Extract<BuyResult, { ok: true }>, 'ok' | 'item' | 'finalPrice' | 'balance'>
>;

function makeBuyOk(
  item: ShopItem,
  finalPrice: number,
  balance: number,
  extras: BuyOkExtras = {},
): BuyResult {
  return {
    ok: true,
    item,
    finalPrice,
    balance,
    grantRoleId: null,
    equippedTitle: null,
    addedInventory: null,
    ...extras,
  };
}

export function computeFinalPrice(
  ctx: ShopOpsContext,
  guildId: string,
  userId: string,
  basePrice: number,
  nowMs: number,
): number {
  if (!ctx.creditLoanService || basePrice <= 0) {
    return basePrice;
  }
  const creditProfile = ctx.creditLoanService.getCreditProfile(guildId, userId, nowMs);
  const mult = getCreditTier(creditProfile.account.score).shopMult;
  return Math.max(1, Math.round(basePrice * mult));
}

export function buyItemOp(
  ctx: ShopOpsContext,
  guildId: string,
  userId: string,
  itemId: number,
  nowMs = Date.now(),
  rng: () => number = Math.random,
  ownedRoleIds?: ReadonlySet<string>,
): BuyResult {
  return ctx.db.transaction((): BuyResult => {
    const item = ctx.shopRepo.getItemById(guildId, itemId);
    if (!item) {
      return { ok: false, reason: 'not_found' };
    }
    if (item.stock !== null && item.stock <= 0) {
      return { ok: false, reason: 'out_of_stock' };
    }

    if (item.type === 'role' && item.roleId && ownedRoleIds?.has(item.roleId)) {
      return { ok: false, reason: 'already_owned' };
    }

    if (item.type === 'role') {
      const { requiredRoleId } = parseRolePayload(item.payloadJson);
      if (requiredRoleId && ownedRoleIds && !ownedRoleIds.has(requiredRoleId)) {
        return { ok: false, reason: 'missing_required_role', requiredRoleId };
      }
    }

    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    const finalPrice = computeFinalPrice(ctx, guildId, userId, item.price, nowMs);
    if (profile.coins < finalPrice) {
      return { ok: false, reason: 'insufficient_funds', finalPrice };
    }

    if (item.type === 'title' && item.titleText) {
      const owned = ctx.shopRepo.findInventoryByTypeAndName(
        guildId,
        userId,
        'title',
        item.titleText,
      );
      if (owned) {
        return { ok: false, reason: 'already_owned' };
      }
    }

    if (item.type === 'stat_boost') {
      const payload = parseStatBoostPayload(item.payloadJson);
      const today = getDateKey(nowMs, ctx.timezone);
      const usedToday = profile.lastStatBoostDate === today ? profile.statBoostDailyCount : 0;
      if (usedToday >= payload.dailyLimit) {
        return { ok: false, reason: 'daily_limit_reached', dailyLimit: payload.dailyLimit };
      }

      const baseGain = randomIntInclusive(payload.minGain, payload.maxGain, rng);
      const roll = rng();
      let outcome: StatBoostOutcome = 'normal';
      let delta = baseGain;

      if (roll < payload.critChance) {
        outcome = 'crit';
        delta = baseGain * 2;
      } else if (roll < payload.critChance + payload.backfireChance) {
        outcome = 'backfire';
        const loss = Math.max(1, Math.floor(payload.minGain));
        const clampedNext = Math.max(0, profile.statValue - loss);
        delta = clampedNext - profile.statValue;
      }

      const nextStatValue = Math.max(0, profile.statValue + delta);
      const nextCoins = profile.coins - finalPrice;
      const nextUsed = usedToday + 1;

      ctx.shopRepo.decrementStock(guildId, item.id);
      ctx.profileRepo.save({
        ...profile,
        coins: nextCoins,
        statValue: nextStatValue,
        lastStatBoostDate: today,
        statBoostDailyCount: nextUsed,
      });

      return makeBuyOk(item, finalPrice, nextCoins, {
        statBoostResult: {
          outcome,
          delta,
          newStatValue: nextStatValue,
          usedToday: nextUsed,
          dailyLimit: payload.dailyLimit,
        },
      });
    }

    if (item.type === 'pet_xp') {
      const activePet = ctx.socialPetRepo?.getActivePet(guildId, userId) ?? null;
      if (!activePet || !ctx.socialPetRepo) {
        return { ok: false, reason: 'no_active_pet' };
      }

      const { petXp } = parsePetXpPayload(item.payloadJson);
      const applied = applyPetXp(activePet, petXp);
      const nextCoins = profile.coins - finalPrice;

      ctx.shopRepo.decrementStock(guildId, item.id);
      ctx.profileRepo.save({ ...profile, coins: nextCoins });
      ctx.socialPetRepo.savePet(applied.updatedPet);

      return makeBuyOk(item, finalPrice, nextCoins, {
        petXpResult: {
          petName: applied.updatedPet.nickname,
          xpGained: petXp,
          oldLevel: activePet.level,
          newLevel: applied.updatedPet.level,
          levelsGained: applied.levelsGained,
        },
      });
    }

    if (item.type === 'credit_boost') {
      if (!ctx.creditLoanService) {
        return { ok: false, reason: 'not_found' };
      }
      const payload = parseCreditBoostPayload(item.payloadJson);
      const today = getDateKey(nowMs, ctx.timezone);
      const usedToday = profile.lastCreditBoostDate === today ? profile.creditBoostDailyCount : 0;
      if (usedToday >= payload.dailyLimit) {
        return { ok: false, reason: 'daily_limit_reached', dailyLimit: payload.dailyLimit };
      }
      const creditProfile = ctx.creditLoanService.getCreditProfile(guildId, userId, nowMs);
      if (creditProfile.account.score >= CREDIT_SCORE_MAX) {
        return { ok: false, reason: 'credit_already_max' };
      }

      const nextCoins = profile.coins - finalPrice;
      const nextUsed = usedToday + 1;
      ctx.shopRepo.decrementStock(guildId, item.id);
      ctx.profileRepo.save({
        ...profile,
        coins: nextCoins,
        lastCreditBoostDate: today,
        creditBoostDailyCount: nextUsed,
      });
      const adjusted = ctx.creditLoanService.adjustCredit(
        guildId,
        userId,
        payload.creditGain,
        `商店信用修复道具 (${item.name})`,
        nowMs,
      );

      return makeBuyOk(item, finalPrice, nextCoins, {
        creditBoostResult: {
          delta: adjusted.actualDelta,
          newScore: adjusted.account.score,
          tierLabel: adjusted.tier.label,
          usedToday: nextUsed,
          dailyLimit: payload.dailyLimit,
        },
      });
    }

    if (item.type === 'rpg_supply') {
      if (!ctx.rpgRepo) {
        return { ok: false, reason: 'no_rpg_character' };
      }
      const character = ctx.rpgRepo.getCharacter(guildId, userId);
      if (!character) {
        return { ok: false, reason: 'no_rpg_character' };
      }

      const payload = parseRpgSupplyPayload(item.payloadJson);
      const rpgCfg = ctx.guildConfigRepo?.getOrCreate(guildId).rpg ?? DEFAULT_RPG_CONFIG;
      if (payload.lootBox && ctx.rpgRepo.countItems(guildId, userId) >= rpgCfg.bagCapacity) {
        return { ok: false, reason: 'rpg_bag_full' };
      }

      const nextCoins = profile.coins - finalPrice;
      ctx.shopRepo.decrementStock(guildId, item.id);
      ctx.profileRepo.save({ ...profile, coins: nextCoins });

      let nextStamina = character.stamina;
      if (payload.staminaGain > 0) {
        nextStamina = character.stamina + payload.staminaGain;
        ctx.rpgRepo.saveCharacter({
          ...character,
          stamina: nextStamina,
          updatedAt: nowMs,
        });
      }

      let droppedItem: RpgSupplyResult['droppedItem'];
      if (payload.lootBox) {
        const targetTier = getRpgRealmInfo(character.level).tier;
        const pending = generateShopRpgLoot(targetTier, payload.minRarity, rng);
        const created = ctx.rpgRepo.createItem({
          guildId,
          userId,
          name: pending.name,
          slot: pending.slot,
          rarity: pending.rarity,
          baseHp: pending.baseHp,
          baseAtk: pending.baseAtk,
          baseDef: pending.baseDef,
          baseCritBp: pending.baseCritBp,
          enhanceLevel: 0,
          equipped: false,
          createdAt: nowMs,
        });
        droppedItem = {
          name: created.name,
          slot: created.slot,
          rarity: created.rarity,
        };
      }

      return makeBuyOk(item, finalPrice, nextCoins, {
        rpgSupplyResult: {
          staminaGained: payload.staminaGain,
          newStamina: nextStamina,
          ...(droppedItem ? { droppedItem } : {}),
        },
      });
    }

    if (item.type === 'cp_affinity') {
      if (!ctx.socialPetRepo) {
        return { ok: false, reason: 'no_relationship' };
      }
      const rels = ctx.socialPetRepo.listUserRelationships(guildId, userId);
      if (rels.length === 0) {
        return { ok: false, reason: 'no_relationship' };
      }

      const targetRel = rels.find((r) => r.relType === 'marriage') ?? rels[0]!;
      const payload = parseCpAffinityPayload(item.payloadJson);
      const nextCoins = profile.coins - finalPrice;
      const nextAffinity = targetRel.affinity + payload.affinityGain;

      ctx.shopRepo.decrementStock(guildId, item.id);
      ctx.profileRepo.save({ ...profile, coins: nextCoins });
      ctx.socialPetRepo.updateRelationshipAffinity(
        targetRel.id,
        nextAffinity,
        targetRel.lastCheckinDate ?? '',
      );
      const unlockedTitles = unlockRelationshipMilestoneTitles(
        ctx.shopRepo,
        targetRel,
        targetRel.affinity,
        nextAffinity,
        nowMs,
      );
      const partnerId = targetRel.userA === userId ? targetRel.userB : targetRel.userA;

      return makeBuyOk(item, finalPrice, nextCoins, {
        cpAffinityResult: {
          partnerId,
          relType: targetRel.relType,
          affinityGained: payload.affinityGain,
          newAffinity: nextAffinity,
          unlockedTitles,
        },
      });
    }

    if (item.type === 'mystery_box') {
      return openMysteryBoxInTx(ctx, guildId, userId, item, profile, finalPrice, nowMs, rng);
    }

    ctx.shopRepo.decrementStock(guildId, item.id);
    const nextCoins = profile.coins - finalPrice;

    if (item.type === 'role') {
      ctx.profileRepo.save({ ...profile, coins: nextCoins });
      return makeBuyOk(item, finalPrice, nextCoins, { grantRoleId: item.roleId });
    }

    if (item.type === 'title' && item.titleText) {
      const payload: TitlePayload = { titleText: item.titleText };
      const inv = ctx.shopRepo.addInventoryItem({
        guildId,
        userId,
        itemType: 'title',
        itemName: item.titleText,
        payloadJson: JSON.stringify(payload),
        quantity: 1,
        acquiredAt: nowMs,
      });
      ctx.profileRepo.save({
        ...profile,
        coins: nextCoins,
        equippedTitle: item.titleText,
      });
      return makeBuyOk(item, finalPrice, nextCoins, {
        equippedTitle: item.titleText,
        addedInventory: inv,
      });
    }

    if (item.type === 'custom_title') {
      const inv = ctx.shopRepo.addInventoryItem({
        guildId,
        userId,
        itemType: 'custom_title',
        itemName: item.name,
        payloadJson: '{}',
        quantity: 1,
        acquiredAt: nowMs,
      });
      ctx.profileRepo.save({ ...profile, coins: nextCoins });
      return makeBuyOk(item, finalPrice, nextCoins, {
        addedInventory: inv,
        customTitleVoucher: true,
      });
    }

    const boostPayload: BoostPayload = {
      multiplier: item.boostMultiplier ?? 1.5,
      durationSec: item.boostDurationSec ?? 3600,
    };
    const inv = ctx.shopRepo.addInventoryItem({
      guildId,
      userId,
      itemType: 'xp_boost',
      itemName: item.name,
      payloadJson: JSON.stringify(boostPayload),
      quantity: 1,
      acquiredAt: nowMs,
    });
    ctx.profileRepo.save({ ...profile, coins: nextCoins });

    return makeBuyOk(item, finalPrice, nextCoins, { addedInventory: inv });
  })();
}

export function buyCustomTitleOp(
  ctx: ShopOpsContext,
  guildId: string,
  userId: string,
  itemId: number,
  rawTitle: string,
  nowMs = Date.now(),
): BuyResult {
  const cleanTitle = rawTitle.trim();
  if (cleanTitle.length < 1 || cleanTitle.length > 20) {
    return { ok: false, reason: 'invalid_title' };
  }

  return ctx.db.transaction((): BuyResult => {
    const item = ctx.shopRepo.getItemById(guildId, itemId);
    if (!item || item.type !== 'custom_title') {
      return { ok: false, reason: 'not_found' };
    }
    if (item.stock !== null && item.stock <= 0) {
      return { ok: false, reason: 'out_of_stock' };
    }

    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    const finalPrice = computeFinalPrice(ctx, guildId, userId, item.price, nowMs);
    if (profile.coins < finalPrice) {
      return { ok: false, reason: 'insufficient_funds', finalPrice };
    }

    const owned = ctx.shopRepo.findInventoryByTypeAndName(guildId, userId, 'title', cleanTitle);
    if (owned) {
      return { ok: false, reason: 'already_owned' };
    }

    ctx.shopRepo.decrementStock(guildId, item.id);
    const nextCoins = profile.coins - finalPrice;
    const payload: TitlePayload = { titleText: cleanTitle };
    const inv = ctx.shopRepo.addInventoryItem({
      guildId,
      userId,
      itemType: 'title',
      itemName: cleanTitle,
      payloadJson: JSON.stringify(payload),
      quantity: 1,
      acquiredAt: nowMs,
    });
    ctx.profileRepo.save({
      ...profile,
      coins: nextCoins,
      equippedTitle: cleanTitle,
    });

    return makeBuyOk(item, finalPrice, nextCoins, {
      equippedTitle: cleanTitle,
      addedInventory: inv,
    });
  })();
}

export function refundRolePurchaseOp(
  ctx: ShopOpsContext,
  guildId: string,
  userId: string,
  itemId: number,
  amount: number,
): void {
  ctx.db.transaction((): void => {
    ctx.profileRepo.addCoins(guildId, userId, amount);
    ctx.shopRepo.incrementStock(guildId, itemId);
  })();
}
