import type { RpgCharacter, RpgClassKey } from '../../db/repositories/rpgRepo.js';
import { getDateKey } from '../economyService.js';
import { generateTierItem, RARITY_META } from './rpgCatalogBossesAndItems.js';
import { computeHealInjuryCost, computeIdlePreviewFromData } from './rpgPureMath.js';
import {
  clampUnit,
  GUARD_ELIXIR_DAILY_LIMIT,
  GUARD_ELIXIR_PRICE,
  MAX_IDLE_ACCRUE_MS,
  MAX_TRIAL_PILLS,
  PROMO_PILL_DAILY_LIMIT,
  PROMO_PILL_PRICE,
  type BuyAlchemyItemResult,
  type BuyStaminaPotionResult,
  type ChooseClassResult,
  type ClaimIdleHarvestResult,
  type ConfigureTrialLoadoutResult,
  type HealInjuryResult,
  type IdleHarvestPreview,
  type PendingRpgItem,
  type RpgOpsContext,
} from './rpgTypesAndConfig.js';

export function refreshCharacterInTx(
  ctx: RpgOpsContext,
  character: RpgCharacter,
  today: string,
  nowMs: number,
): RpgCharacter {
  let next = character;
  let dirty = false;

  // Backfill legacy characters BEFORE daily stamina reset overwrites updatedAt
  if (next.classSelected && next.lastIdleClaimAt <= 0) {
    const minAnchor = Math.max(0, nowMs - MAX_IDLE_ACCRUE_MS);
    const seedClaimAt =
      character.updatedAt > 0
        ? Math.max(minAnchor, Math.min(nowMs, character.updatedAt))
        : minAnchor;
    next = {
      ...next,
      lastIdleClaimAt: seedClaimAt,
    };
    dirty = true;
  }

  if (next.lastStaminaDate !== today) {
    const cfg = ctx.getConfig(next.guildId);
    next = {
      ...next,
      stamina: Math.max(next.stamina, cfg.dailyStamina),
      lastStaminaDate: today,
      staminaBuysToday: 0,
      pillBuysToday: 0,
      elixirBuysToday: 0,
      arenaFightsToday: 0,
      coopTicketsToday: 0,
      updatedAt: nowMs,
    };
    dirty = true;
  }

  if (dirty) {
    ctx.rpgRepo.saveCharacter(next);
  }
  return next;
}

export function getOrCreateCharacterInTx(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  nowMs: number,
): RpgCharacter {
  const cfg = ctx.getConfig(guildId);
  const today = getDateKey(nowMs, ctx.timezone);
  const existing = ctx.rpgRepo.getCharacter(guildId, userId);
  if (!existing) {
    return ctx.rpgRepo.createCharacter({
      guildId,
      userId,
      classKey: 'warrior',
      classSelected: false,
      stamina: cfg.dailyStamina,
      lastStaminaDate: today,
      lastIdleClaimAt: nowMs,
      updatedAt: nowMs,
    });
  }
  return ctx.refreshCharacterInTx(existing, today, nowMs);
}

export function chooseOrSwitchClass(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  classKey: RpgClassKey,
  nowMs = Date.now(),
): ChooseClassResult {
  return ctx.db.transaction((): ChooseClassResult => {
    if (ctx.rpgRepo.getPendingTrialForUser(guildId, userId)) {
      return { ok: false, reason: 'pending_trial' };
    }

    const cfg = ctx.getConfig(guildId);
    const today = getDateKey(nowMs, ctx.timezone);
    const existing = ctx.rpgRepo.getCharacter(guildId, userId);

    if (!existing) {
      const created = ctx.rpgRepo.createCharacter({
        guildId,
        userId,
        classKey,
        classSelected: true,
        dustBackfilled: true,
        stamina: cfg.dailyStamina,
        lastStaminaDate: today,
        lastIdleClaimAt: nowMs,
        updatedAt: nowMs,
      });
      const profile = ctx.profileRepo.getOrCreate(guildId, userId);
      return {
        ok: true,
        character: created,
        cost: 0,
        balance: profile.coins,
        isFirstSelection: true,
      };
    }

    const refreshed = ctx.refreshCharacterInTx(existing, today, nowMs);

    if (!refreshed.classSelected) {
      const updated: RpgCharacter = {
        ...refreshed,
        classKey,
        classSelected: true,
        dustBackfilled: true,
        lastIdleClaimAt: nowMs,
        updatedAt: nowMs,
      };
      ctx.rpgRepo.saveCharacter(updated);
      const profile = ctx.profileRepo.getOrCreate(guildId, userId);
      return {
        ok: true,
        character: updated,
        cost: 0,
        balance: profile.coins,
        isFirstSelection: true,
      };
    }

    if (refreshed.classKey === classKey) {
      return { ok: false, reason: 'same_class' };
    }

    const cost = Math.max(0, Math.floor(cfg.classSwitchCost));
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    if (profile.coins < cost) {
      return { ok: false, reason: 'insufficient_funds', cost };
    }

    const balance = profile.coins - cost;
    if (cost > 0) {
      ctx.profileRepo.save({ ...profile, coins: balance });
    }

    const updated: RpgCharacter = {
      ...refreshed,
      classKey,
      classSelected: true,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updated);

    return {
      ok: true,
      character: updated,
      cost,
      balance,
      isFirstSelection: false,
    };
  })();
}

export function buyStaminaPotion(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): BuyStaminaPotionResult {
  return ctx.db.transaction((): BuyStaminaPotionResult => {
    const cfg = ctx.getConfig(guildId);
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    const dailyLimit = Math.max(0, Math.floor(cfg.staminaPotionDailyLimit));
    if (character.staminaBuysToday >= dailyLimit) {
      return { ok: false, reason: 'daily_limit_reached', dailyLimit };
    }

    const cost = Math.max(0, Math.floor(cfg.staminaPotionPrice));
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    if (profile.coins < cost) {
      return { ok: false, reason: 'insufficient_funds', cost };
    }

    const balance = profile.coins - cost;
    if (cost > 0) {
      ctx.profileRepo.save({ ...profile, coins: balance });
    }

    const updated: RpgCharacter = {
      ...character,
      stamina: character.stamina + 1,
      staminaBuysToday: character.staminaBuysToday + 1,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updated);

    return {
      ok: true,
      character: updated,
      cost,
      balance,
      buysRemaining: Math.max(0, dailyLimit - updated.staminaBuysToday),
    };
  })();
}

export function buyAlchemyItem(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  kind: 'pill' | 'elixir',
  nowMs = Date.now(),
): BuyAlchemyItemResult {
  return ctx.db.transaction((): BuyAlchemyItemResult => {
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    const dailyLimit = kind === 'pill' ? PROMO_PILL_DAILY_LIMIT : GUARD_ELIXIR_DAILY_LIMIT;
    const boughtToday = kind === 'pill' ? character.pillBuysToday : character.elixirBuysToday;
    if (boughtToday >= dailyLimit) {
      return { ok: false, reason: 'daily_limit_reached', dailyLimit };
    }

    const cost = kind === 'pill' ? PROMO_PILL_PRICE : GUARD_ELIXIR_PRICE;
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    if (profile.coins < cost) {
      return { ok: false, reason: 'insufficient_funds', cost };
    }

    const balance = profile.coins - cost;
    ctx.profileRepo.save({ ...profile, coins: balance });

    const updated: RpgCharacter =
      kind === 'pill'
        ? {
            ...character,
            promoPills: character.promoPills + 1,
            pillBuysToday: character.pillBuysToday + 1,
            updatedAt: nowMs,
          }
        : {
            ...character,
            guardElixirs: character.guardElixirs + 1,
            elixirBuysToday: character.elixirBuysToday + 1,
            updatedAt: nowMs,
          };
    ctx.rpgRepo.saveCharacter(updated);

    return {
      ok: true,
      kind,
      character: updated,
      cost,
      balance,
      buysRemaining: Math.max(
        0,
        dailyLimit - (kind === 'pill' ? updated.pillBuysToday : updated.elixirBuysToday),
      ),
    };
  })();
}

export function healInjury(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): HealInjuryResult {
  return ctx.db.transaction((): HealInjuryResult => {
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    if (character.injuredUntil <= nowMs) {
      return { ok: false, reason: 'not_injured' };
    }

    const cost = computeHealInjuryCost(character.level);
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    if (profile.coins < cost) {
      return { ok: false, reason: 'insufficient_funds', cost };
    }

    const balance = profile.coins - cost;
    ctx.profileRepo.save({ ...profile, coins: balance });

    const updated: RpgCharacter = {
      ...character,
      injuredUntil: 0,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updated);

    return { ok: true, character: updated, cost, balance };
  })();
}

export function configureTrialLoadout(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  action: 'cycle_pills' | 'toggle_guard',
  nowMs = Date.now(),
): ConfigureTrialLoadoutResult {
  return ctx.db.transaction((): ConfigureTrialLoadoutResult => {
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    if (action === 'cycle_pills') {
      const maxUsable = Math.min(MAX_TRIAL_PILLS, character.promoPills);
      const nextPills =
        maxUsable <= 0 ? 0 : (Math.min(character.trialPillsStaged, maxUsable) + 1) % (maxUsable + 1);
      const updated: RpgCharacter = {
        ...character,
        trialPillsStaged: nextPills,
        updatedAt: nowMs,
      };
      ctx.rpgRepo.saveCharacter(updated);
      return { ok: true, character: updated };
    }

    const nextGuard = !character.trialUseGuard;
    if (nextGuard && character.guardElixirs <= 0) {
      return { ok: false, reason: 'no_guard_elixir' };
    }
    const updated: RpgCharacter = {
      ...character,
      trialUseGuard: nextGuard,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updated);
    return { ok: true, character: updated };
  })();
}

export function computeIdlePreviewForCharacter(
  ctx: RpgOpsContext,
  character: RpgCharacter,
  nowMs: number,
): IdleHarvestPreview {
  const stats = ctx.computeCombatStatsForCharacter(character);
  return computeIdlePreviewFromData(character, stats, nowMs);
}

export function claimIdleHarvest(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): ClaimIdleHarvestResult {
  return ctx.db.transaction((): ClaimIdleHarvestResult => {
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    if (!character.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }

    const preview = computeIdlePreviewForCharacter(ctx, character, nowMs);
    if (!preview.canClaim) {
      return { ok: false, reason: 'too_soon', waitSeconds: preview.waitSeconds };
    }

    let extraXp = 0;
    let extraCoins = 0;
    let pillsFound = 0;
    let elixirsFound = 0;
    const pendingItems: PendingRpgItem[] = [];
    const adventures: string[] = [];

    const eventSlots =
      preview.accruedMs >= 8 * 3_600_000
        ? 3
        : preview.accruedMs >= 2 * 3_600_000
          ? 2
          : preview.accruedMs >= 15 * 60_000
            ? 1
            : 0;

    for (let i = 0; i < eventSlots; i++) {
      const r = clampUnit(rng());
      if (r < 0.25) {
        const bonus = Math.max(10, Math.round(preview.estimatedXp * 0.25));
        extraXp += bonus;
        adventures.push(`✨ **灵泉顿悟**：挂机期间寻得古树灵泉，额外领悟 **+${bonus} XP**`);
      } else if (r < 0.5) {
        const bonus = Math.max(50, Math.round(preview.estimatedCoins * 0.25));
        extraCoins += bonus;
        adventures.push(`🪙 **无主秘窖**：踢开半掩的石箱，顺手拾获 **+${bonus.toLocaleString()}** 赏金`);
      } else if (r < 0.72) {
        pillsFound += 1;
        adventures.push('🧪 **炼金遗物**：顺手炼化妖兽内丹，收获 **晋升秘药 ×1**');
      } else if (r < 0.92) {
        const dropped = generateTierItem(preview.realm.tier, 'idle', rng);
        pendingItems.push(dropped);
        const meta = RARITY_META[dropped.rarity];
        adventures.push(`🎁 **战利品拾遗**：巡猎精英残骸捡到 ${meta.emoji} **${dropped.name}**`);
      } else {
        elixirsFound += 1;
        adventures.push('🛡️ **圣泉恩赐**：在古老神龛发现 **护魂圣水 ×1**');
      }
    }

    const totalXp = preview.estimatedXp + extraXp;
    const totalCoins = preview.estimatedCoins + extraCoins;

    const banked = ctx.bankLootInTx({
      guildId,
      userId,
      character,
      xpGain: totalXp,
      coinGain: totalCoins,
      pendingItems,
      source: `rpg_idle_tier${preview.realm.tier}`,
      nowMs,
    });

    const finalCharacter: RpgCharacter = {
      ...banked.updatedCharacter,
      lastIdleClaimAt: nowMs,
      promoPills: banked.updatedCharacter.promoPills + pillsFound,
      guardElixirs: banked.updatedCharacter.guardElixirs + elixirsFound,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(finalCharacter);

    return {
      ok: true,
      accruedMs: preview.accruedMs,
      powerMultiplier: preview.powerMultiplier,
      xpEarned: totalXp,
      levelsGained: banked.levelsGained,
      hitGate: banked.hitGate,
      grossCoins: banked.grossCoins,
      garnishedCoins: banked.garnishedCoins,
      netCoins: banked.netCoins,
      pillsFound,
      elixirsFound,
      bankedItems: banked.bankedItems,
      legendaryDrops: banked.legendaryDrops,
      autoSalvagedCount: banked.autoSalvagedCount,
      autoSalvagedCoins: banked.autoSalvagedCoins,
      autoSalvagedDust: banked.autoSalvagedDust,
      dustEarned: banked.dustEarned,
      adventures,
      character: finalCharacter,
      balance: banked.balance,
    };
  })();
}
