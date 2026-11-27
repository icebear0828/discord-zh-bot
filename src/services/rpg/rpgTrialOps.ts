import type { RpgCharacter, RpgTrial } from '../../db/repositories/rpgRepo.js';
import { PET_BREAKTHROUGH_BONUS_PCT } from './rpgCatalogBossesAndItems.js';
import { RPG_TIER_MAP, type RpgRealmInfo } from './rpgCatalogClassesAndTiers.js';
import {
  applyCharacterXp,
  computeTrialEffectiveRate,
  getCreditBreakthroughBonus,
  getRpgRealmInfo,
  isAtBreakthroughGate,
  xpNeededForRpgLevel,
} from './rpgPureMath.js';
import {
  clampUnit,
  INJURY_DURATION_MS,
  MAX_RPG_LEVEL,
  MAX_TRIAL_PILLS,
  MAX_TRIAL_SABOTEURS,
  MAX_TRIAL_SUPPORTERS,
  PITY_BONUS_PER_FAIL_PCT,
  PROMO_PILL_BONUS_PCT,
  PUBLIC_TRIAL_DURATION_MS,
  SABOTEUR_POOL_BONUS_PCT,
  type BreakthroughPreview,
  type InteractPublicTrialResult,
  type RpgOpsContext,
  type SettlePublicTrialResult,
  type SoloBreakthroughResult,
  type StartPublicTrialResult,
  type SupporterPayout,
} from './rpgTypesAndConfig.js';

export function computeBreakthroughPreviewForCharacter(
  ctx: RpgOpsContext,
  character: RpgCharacter,
  hasPendingTrial: boolean,
): BreakthroughPreview {
  const fromRealm = getRpgRealmInfo(character.level);
  const targetTierDef = fromRealm.nextTierDef;
  const atMaxTier = !targetTierDef || character.level >= MAX_RPG_LEVEL;
  const needXp = xpNeededForRpgLevel(character.level);

  const pillsUsed = Math.max(
    0,
    Math.min(MAX_TRIAL_PILLS, character.trialPillsStaged, character.promoPills),
  );
  const usedGuard = character.trialUseGuard && character.guardElixirs > 0;

  const baseRatePct = targetTierDef ? fromRealm.tierDef.breakthroughBasePct : 0;
  const pillBonusPct = pillsUsed * PROMO_PILL_BONUS_PCT;

  const activePet = ctx.socialPetRepo?.getActivePet(character.guildId, character.userId) ?? null;
  const petBonusPct = activePet ? PET_BREAKTHROUGH_BONUS_PCT[activePet.rarity] : 0;

  const creditScore = ctx.getUserCreditScore(character.guildId, character.userId);
  const creditBonusPct = getCreditBreakthroughBonus(creditScore);
  const pityBonusPct = character.breakthroughPity * PITY_BONUS_PER_FAIL_PCT;

  const rawBasePct = atMaxTier
    ? 0
    : baseRatePct + pillBonusPct + petBonusPct + creditBonusPct + pityBonusPct;
  const totalRatePct = atMaxTier ? 0 : Math.max(5, Math.min(100, rawBasePct));

  return {
    eligible: !atMaxTier && isAtBreakthroughGate(character.level, character.xp) && !hasPendingTrial,
    atMaxTier,
    fromRealm,
    targetTierDef,
    needXp,
    currentXp: character.xp,
    pillsUsed,
    usedGuard,
    baseRatePct,
    pillBonusPct,
    petBonusPct,
    petName: activePet ? activePet.nickname : null,
    creditBonusPct,
    creditScore,
    pityBonusPct,
    rawBasePct,
    totalRatePct,
    hasPendingTrial,
  };
}

function resolveBreakthroughOutcomeInTx(
  ctx: RpgOpsContext,
  input: {
    guildId: string;
    userId: string;
    character: RpgCharacter;
    targetTier: number;
    usedGuard: boolean;
    succeeded: boolean;
    saboteurCount: number;
    nowMs: number;
  },
): {
  toRealm: RpgRealmInfo;
  grossCoins: number;
  garnishedCoins: number;
  netCoins: number;
  creditDelta: number;
  xpLost: number;
  injuredUntil: number;
  character: RpgCharacter;
  balance: number;
} {
  const needXp = xpNeededForRpgLevel(input.character.level);

  if (input.succeeded) {
    const overflowXp = Math.max(0, input.character.xp - needXp);
    const nextBaseChar: RpgCharacter = {
      ...input.character,
      level: Math.min(MAX_RPG_LEVEL, input.character.level + 1),
      xp: 0,
    };
    const { updated: afterOverflow } = applyCharacterXp(nextBaseChar, overflowXp);
    const toRealm = getRpgRealmInfo(afterOverflow.level);

    const basePrize = input.targetTier * 6000;
    const saboteurBonusMult =
      1 + Math.max(0, input.saboteurCount) * (SABOTEUR_POOL_BONUS_PCT / 100);
    const rawPrize = Math.round(basePrize * saboteurBonusMult);
    const coinRes = ctx.applyCoinRewardInTx(
      input.guildId,
      input.userId,
      rawPrize,
      `rpg_breakthrough_tier${input.targetTier}`,
      input.nowMs,
    );

    const creditDelta = 15;
    if (ctx.onCreditChange) {
      ctx.onCreditChange(
        input.guildId,
        input.userId,
        creditDelta,
        `RPG晋升突破至${toRealm.tierDef.name}`,
        input.nowMs,
      );
    }

    const finalChar: RpgCharacter = {
      ...afterOverflow,
      maxChapterCleared: Math.max(afterOverflow.maxChapterCleared, toRealm.tier),
      breakthroughPity: 0,
      totalBreakthroughs: afterOverflow.totalBreakthroughs + 1,
      updatedAt: input.nowMs,
    };
    ctx.rpgRepo.saveCharacter(finalChar);

    return {
      toRealm,
      grossCoins: coinRes.grossCoins,
      garnishedCoins: coinRes.garnishedCoins,
      netCoins: coinRes.netCoins,
      creditDelta,
      xpLost: 0,
      injuredUntil: finalChar.injuredUntil,
      character: finalChar,
      balance: coinRes.balance,
    };
  }

  // Breakthrough failed
  const xpLost = Math.min(
    input.character.xp,
    Math.round(needXp * (input.usedGuard ? 0.1 : 0.4)),
  );
  const nextInjuredUntil = input.usedGuard
    ? input.character.injuredUntil
    : Math.max(input.character.injuredUntil, input.nowMs + INJURY_DURATION_MS);

  const finalChar: RpgCharacter = {
    ...input.character,
    xp: Math.max(0, input.character.xp - xpLost),
    injuredUntil: nextInjuredUntil,
    breakthroughPity: input.character.breakthroughPity + 1,
    updatedAt: input.nowMs,
  };
  ctx.rpgRepo.saveCharacter(finalChar);
  const profile = ctx.profileRepo.getOrCreate(input.guildId, input.userId);

  return {
    toRealm: getRpgRealmInfo(finalChar.level),
    grossCoins: 0,
    garnishedCoins: 0,
    netCoins: 0,
    creditDelta: 0,
    xpLost,
    injuredUntil: finalChar.injuredUntil,
    character: finalChar,
    balance: profile.coins,
  };
}

export function attemptSoloBreakthrough(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): SoloBreakthroughResult {
  return ctx.db.transaction((): SoloBreakthroughResult => {
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    if (!character.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }
    const fromRealm = getRpgRealmInfo(character.level);
    if (!fromRealm.nextTierDef || character.level >= MAX_RPG_LEVEL) {
      return { ok: false, reason: 'at_max_tier' };
    }
    if (!isAtBreakthroughGate(character.level, character.xp)) {
      return { ok: false, reason: 'not_at_gate' };
    }
    if (ctx.rpgRepo.getPendingTrialForUser(guildId, userId)) {
      return { ok: false, reason: 'pending_trial_exists' };
    }

    const preview = computeBreakthroughPreviewForCharacter(ctx, character, false);
    const consumedChar: RpgCharacter = {
      ...character,
      promoPills: Math.max(0, character.promoPills - preview.pillsUsed),
      guardElixirs: Math.max(0, character.guardElixirs - (preview.usedGuard ? 1 : 0)),
      trialPillsStaged: 0,
      trialUseGuard: false,
    };

    const succeeded = clampUnit(rng()) * 100 < preview.totalRatePct;
    const outcome = resolveBreakthroughOutcomeInTx(ctx, {
      guildId,
      userId,
      character: consumedChar,
      targetTier: fromRealm.nextTierDef.tier,
      usedGuard: preview.usedGuard,
      succeeded,
      saboteurCount: 0,
      nowMs,
    });

    return {
      ok: true,
      succeeded,
      fromRealm,
      toRealm: outcome.toRealm,
      finalRatePct: preview.totalRatePct,
      pillsUsed: preview.pillsUsed,
      usedGuard: preview.usedGuard,
      grossCoins: outcome.grossCoins,
      garnishedCoins: outcome.garnishedCoins,
      netCoins: outcome.netCoins,
      creditDelta: outcome.creditDelta,
      xpLost: outcome.xpLost,
      injuredUntil: outcome.injuredUntil,
      character: outcome.character,
      balance: outcome.balance,
    };
  })();
}

export function startPublicBreakthroughTrial(
  ctx: RpgOpsContext,
  guildId: string,
  channelId: string,
  userId: string,
  nowMs = Date.now(),
): StartPublicTrialResult {
  return ctx.db.transaction((): StartPublicTrialResult => {
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    if (!character.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }
    const fromRealm = getRpgRealmInfo(character.level);
    if (!fromRealm.nextTierDef || character.level >= MAX_RPG_LEVEL) {
      return { ok: false, reason: 'at_max_tier' };
    }
    if (!isAtBreakthroughGate(character.level, character.xp)) {
      return { ok: false, reason: 'not_at_gate' };
    }
    if (ctx.rpgRepo.getPendingTrialForUser(guildId, userId)) {
      return { ok: false, reason: 'pending_trial_exists' };
    }

    const preview = computeBreakthroughPreviewForCharacter(ctx, character, false);
    const updatedChar: RpgCharacter = {
      ...character,
      promoPills: Math.max(0, character.promoPills - preview.pillsUsed),
      guardElixirs: Math.max(0, character.guardElixirs - (preview.usedGuard ? 1 : 0)),
      trialPillsStaged: 0,
      trialUseGuard: false,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updatedChar);

    const trial = ctx.rpgRepo.createTrial({
      guildId,
      channelId,
      userId,
      fromLevel: updatedChar.level,
      targetTier: fromRealm.nextTierDef.tier,
      pillsUsed: preview.pillsUsed,
      usedGuard: preview.usedGuard,
      baseChanceBp: Math.round(preview.rawBasePct * 100),
      createdAt: nowMs,
      expiresAt: nowMs + PUBLIC_TRIAL_DURATION_MS,
    });

    return { ok: true, trial, character: updatedChar, preview };
  })();
}

export function cancelPublicTrialAndRefund(
  ctx: RpgOpsContext,
  trialId: number,
  nowMs = Date.now(),
): boolean {
  return ctx.db.transaction((): boolean => {
    const trial = ctx.rpgRepo.getTrialById(trialId);
    if (!trial || trial.status !== 'pending') {
      return false;
    }
    const character = ctx.rpgRepo.getCharacter(trial.guildId, trial.userId);
    if (character) {
      ctx.rpgRepo.saveCharacter({
        ...character,
        promoPills: character.promoPills + trial.pillsUsed,
        guardElixirs: character.guardElixirs + (trial.usedGuard ? 1 : 0),
        updatedAt: nowMs,
      });
    }
    ctx.rpgRepo.saveTrial({
      ...trial,
      status: 'cancelled',
      resultSummary: '公屏试炼发送失败，已全额退还投入秘药。',
      resolvedAt: nowMs,
    });
    return true;
  })();
}

export function interactPublicTrial(
  ctx: RpgOpsContext,
  trialId: number,
  actorId: string,
  mode: 'help' | 'jeer',
  nowMs = Date.now(),
): InteractPublicTrialResult {
  return ctx.db.transaction((): InteractPublicTrialResult => {
    const trial = ctx.rpgRepo.getTrialById(trialId);
    if (!trial) {
      return { ok: false, reason: 'not_found' };
    }
    if (trial.status !== 'pending' || trial.expiresAt <= nowMs) {
      return { ok: false, reason: 'already_resolved' };
    }
    if (actorId === trial.userId) {
      return { ok: false, reason: 'own_trial' };
    }
    if (trial.supporters.includes(actorId) || trial.saboteurs.includes(actorId)) {
      return { ok: false, reason: 'already_joined' };
    }

    const nextSupporters = [...trial.supporters];
    const nextSaboteurs = [...trial.saboteurs];
    if (mode === 'help') {
      if (nextSupporters.length >= MAX_TRIAL_SUPPORTERS) {
        return { ok: false, reason: 'supporters_full' };
      }
      nextSupporters.push(actorId);
    } else {
      if (nextSaboteurs.length >= MAX_TRIAL_SABOTEURS) {
        return { ok: false, reason: 'saboteurs_full' };
      }
      nextSaboteurs.push(actorId);
    }

    const updated: RpgTrial = {
      ...trial,
      supporters: nextSupporters,
      saboteurs: nextSaboteurs,
    };
    ctx.rpgRepo.saveTrial(updated);

    const currentRatePct = computeTrialEffectiveRate(
      updated.baseChanceBp,
      updated.supporters.length,
      updated.saboteurs.length,
    );
    return { ok: true, trial: updated, currentRatePct, mode };
  })();
}

export function settlePublicTrial(
  ctx: RpgOpsContext,
  trialId: number,
  actorIdOrSystem: string | null,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): SettlePublicTrialResult {
  return ctx.db.transaction((): SettlePublicTrialResult => {
    const trial = ctx.rpgRepo.getTrialById(trialId);
    if (!trial) {
      return { ok: false, reason: 'not_found' };
    }
    if (trial.status !== 'pending') {
      return { ok: false, reason: 'already_resolved' };
    }
    if (actorIdOrSystem !== null && actorIdOrSystem !== trial.userId) {
      return { ok: false, reason: 'not_owner' };
    }

    const character = ctx.getOrCreateCharacterInTx(trial.guildId, trial.userId, nowMs);
    const fromRealm = getRpgRealmInfo(character.level);
    const finalRatePct = computeTrialEffectiveRate(
      trial.baseChanceBp,
      trial.supporters.length,
      trial.saboteurs.length,
    );
    const succeeded = clampUnit(rng()) * 100 < finalRatePct;

    const outcome = resolveBreakthroughOutcomeInTx(ctx, {
      guildId: trial.guildId,
      userId: trial.userId,
      character,
      targetTier: trial.targetTier,
      usedGuard: trial.usedGuard,
      succeeded,
      saboteurCount: trial.saboteurs.length,
      nowMs,
    });

    const supporterPayouts: SupporterPayout[] = [];
    if (succeeded && trial.supporters.length > 0) {
      const candyAmount = trial.targetTier * 600;
      for (const supId of trial.supporters) {
        ctx.profileRepo.addCoins(trial.guildId, supId, candyAmount);
        supporterPayouts.push({ userId: supId, amount: candyAmount });
      }
    }

    const targetTierDef = RPG_TIER_MAP.get(trial.targetTier);
    const summary = succeeded
      ? `🎉 晋升成功！跨入 ${targetTierDef?.emoji ?? '🌟'} **${targetTierDef?.name ?? `第${trial.targetTier}阶`}·一重**（成功率 ${finalRatePct}%），获赏金 +${outcome.grossCoins.toLocaleString()}！`
      : `💥 晋升失败（成功率 ${finalRatePct}%），${trial.usedGuard ? '护魂圣水生效免于重伤' : '陷入 1 小时重伤'}，下轮保底 +${PITY_BONUS_PER_FAIL_PCT}%！`;

    const settledTrial: RpgTrial = {
      ...trial,
      status: succeeded ? 'succeeded' : 'failed',
      resultSummary: summary,
      resolvedAt: nowMs,
    };
    ctx.rpgRepo.saveTrial(settledTrial);

    return {
      ok: true,
      trial: settledTrial,
      succeeded,
      fromRealm,
      toRealm: outcome.toRealm,
      finalRatePct,
      grossCoins: outcome.grossCoins,
      garnishedCoins: outcome.garnishedCoins,
      netCoins: outcome.netCoins,
      creditDelta: outcome.creditDelta,
      xpLost: outcome.xpLost,
      injuredUntil: outcome.injuredUntil,
      supporterPayouts,
      character: outcome.character,
      balance: outcome.balance,
    };
  })();
}

export function settleDuePublicTrials(
  ctx: RpgOpsContext,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): Array<Extract<SettlePublicTrialResult, { ok: true }>> {
  const due = ctx.rpgRepo.listDuePendingTrials(nowMs);
  const settled: Array<Extract<SettlePublicTrialResult, { ok: true }>> = [];
  for (const trial of due) {
    const res = settlePublicTrial(ctx, trial.id, null, nowMs, rng);
    if (res.ok) {
      settled.push(res);
    }
  }
  return settled;
}
