import type { PropKey } from '../../db/repositories/chaosRepo.js';
import { getCreditTier } from '../creditLoanService.js';
import {
  CURSE_DURATION_MS,
  getPropPrice,
  PROP_CATALOG,
  SHIELD_DURATION_MS,
  TRAP_DURATION_MS,
  type BuyPropResult,
  type ChaosOpsDeps,
  type ClearBountyResult,
  type PlaceBountyResult,
  type UseCursePropResult,
  type UseSelfPropResult,
} from './chaosCatalogAndTypes.js';

export function buyPropOp(
  deps: ChaosOpsDeps,
  guildId: string,
  userId: string,
  propKey: PropKey,
  nowMs = Date.now(),
): BuyPropResult {
  const cfg = deps.configRepo.getOrCreate(guildId).games;
  const basePrice = Math.max(0, Math.floor(getPropPrice(cfg, propKey)));
  let price = basePrice;
  if (deps.creditLoanService && basePrice > 0) {
    const creditProfile = deps.creditLoanService.getCreditProfile(guildId, userId, nowMs);
    price = Math.max(1, Math.round(basePrice * getCreditTier(creditProfile.account.score).shopMult));
  }
  const prop = PROP_CATALOG[propKey];

  return deps.db.transaction((): BuyPropResult => {
    const profile = deps.profileRepo.getOrCreate(guildId, userId);
    if (profile.coins < price) {
      return { ok: false, reason: 'insufficient_funds', price };
    }

    const balance = profile.coins - price;
    deps.profileRepo.save({ ...profile, coins: balance });
    const quantity = deps.chaosRepo.addProp(guildId, userId, propKey, 1);

    return { ok: true, prop, price, quantity, balance };
  })();
}

export function useSelfPropOp(
  deps: ChaosOpsDeps,
  guildId: string,
  userId: string,
  propKey: PropKey,
  nowMs = Date.now(),
): UseSelfPropResult {
  const prop = PROP_CATALOG[propKey];
  if (prop.usageMode !== 'self') {
    return { ok: false, reason: 'invalid_prop_mode' };
  }

  return deps.db.transaction((): UseSelfPropResult => {
    if (propKey === 'trap') {
      if (deps.chaosRepo.getActiveEffect(guildId, userId, 'trap_armed', nowMs)) {
        return { ok: false, reason: 'already_active' };
      }
    } else if (propKey === 'lockpick') {
      if (deps.chaosRepo.getActiveEffect(guildId, userId, 'lockpick_ready', nowMs)) {
        return { ok: false, reason: 'already_active' };
      }
    }

    if (!deps.chaosRepo.consumeProp(guildId, userId, propKey)) {
      return { ok: false, reason: 'no_prop' };
    }
    const remainingQuantity = deps.chaosRepo.getPropQuantity(guildId, userId, propKey);

    if (propKey === 'trap') {
      deps.chaosRepo.setEffect({
        guildId,
        userId,
        effectKey: 'trap_armed',
        charges: 1,
        expiresAt: nowMs + TRAP_DURATION_MS,
        sourceUserId: userId,
        updatedAt: nowMs,
      });
      return { ok: true, prop, remainingQuantity };
    }

    if (propKey === 'lockpick') {
      deps.chaosRepo.setEffect({
        guildId,
        userId,
        effectKey: 'lockpick_ready',
        charges: 1,
        expiresAt: 0,
        sourceUserId: userId,
        updatedAt: nowMs,
      });
      return { ok: true, prop, remainingQuantity };
    }

    const profile = deps.profileRepo.getOrCreate(guildId, userId);
    const base = Math.max(nowMs, profile.robShieldUntil);
    const shieldUntil = base + SHIELD_DURATION_MS;
    deps.profileRepo.save({ ...profile, robShieldUntil: shieldUntil });
    return { ok: true, prop, remainingQuantity, shieldUntil };
  })();
}

export function useCursePropOp(
  deps: ChaosOpsDeps,
  guildId: string,
  actorId: string,
  targetId: string,
  nowMs = Date.now(),
): UseCursePropResult {
  if (actorId === targetId) {
    return { ok: false, reason: 'self_target' };
  }

  return deps.db.transaction((): UseCursePropResult => {
    if (deps.chaosRepo.getActiveEffect(guildId, targetId, 'work_cursed', nowMs)) {
      return { ok: false, reason: 'already_active' };
    }
    if (!deps.chaosRepo.consumeProp(guildId, actorId, 'curse')) {
      return { ok: false, reason: 'no_prop' };
    }
    deps.chaosRepo.setEffect({
      guildId,
      userId: targetId,
      effectKey: 'work_cursed',
      charges: 1,
      expiresAt: nowMs + CURSE_DURATION_MS,
      sourceUserId: actorId,
      updatedAt: nowMs,
    });
    const remainingQuantity = deps.chaosRepo.getPropQuantity(guildId, actorId, 'curse');
    return { ok: true, remainingQuantity, targetId };
  })();
}

export function placeBountyOp(
  deps: ChaosOpsDeps,
  guildId: string,
  placerId: string,
  targetId: string,
  amount: number,
  nowMs = Date.now(),
): PlaceBountyResult {
  if (placerId === targetId) {
    return { ok: false, reason: 'self_target' };
  }
  const cfg = deps.configRepo.getOrCreate(guildId).games;
  const minAmount = Math.max(1, cfg.bountyMinAmount);
  const cleanAmount = Math.floor(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount < minAmount) {
    return { ok: false, reason: 'below_min', minAmount };
  }

  return deps.db.transaction((): PlaceBountyResult => {
    const placer = deps.profileRepo.getOrCreate(guildId, placerId);
    if (placer.coins < cleanAmount) {
      return { ok: false, reason: 'insufficient_funds' };
    }
    const placerBalance = placer.coins - cleanAmount;
    deps.profileRepo.save({ ...placer, coins: placerBalance });

    const bounty = deps.chaosRepo.createBounty({
      guildId,
      targetId,
      placerId,
      amount: cleanAmount,
      createdAt: nowMs,
    });
    const totalTargetBounty = deps.chaosRepo.getOpenBountyTotal(guildId, targetId);
    return { ok: true, bounty, totalTargetBounty, placerBalance };
  })();
}

export function clearOwnBountyOp(
  deps: ChaosOpsDeps,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): ClearBountyResult {
  const cfg = deps.configRepo.getOrCreate(guildId).games;

  return deps.db.transaction((): ClearBountyResult => {
    const openTotal = deps.chaosRepo.getOpenBountyTotal(guildId, userId);
    if (openTotal <= 0) {
      return { ok: false, reason: 'no_bounty' };
    }
    const cost = Math.max(1, Math.ceil(openTotal * cfg.bountyClearMultiplier));
    const profile = deps.profileRepo.getOrCreate(guildId, userId);
    if (profile.coins < cost) {
      return { ok: false, reason: 'insufficient_funds', cost };
    }
    const balance = profile.coins - cost;
    deps.profileRepo.save({ ...profile, coins: balance });
    const clearedAmount = deps.chaosRepo.clearOpenBounties(guildId, userId, nowMs);
    return { ok: true, clearedAmount, cost, balance };
  })();
}
