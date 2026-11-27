import {
  BANK_ROB_ATTACKER_MIN_ASSETS,
  BANK_ROB_FINE_RATE,
  BANK_ROB_LOCKPICK_BONUS,
  BANK_ROB_LOCKPICK_CAP,
  BANK_ROB_STEAL_MAX_RATE,
  BANK_ROB_STEAL_MIN_RATE,
  BANK_ROB_TARGET_MIN,
  BANK_ROB_TRAP_FINE_RATE,
  ROB_ATTACKER_MIN_ASSETS,
  ROB_EASTER_EGG_FINE_RATE,
  ROB_FINE_RATE,
  ROB_LOCKPICK_BONUS,
  ROB_LOCKPICK_CAP,
  ROB_STEAL_MAX_RATE,
  ROB_STEAL_MIN_RATE,
  ROB_TARGET_MIN_COINS,
  ROB_TRAP_FINE_RATE,
} from '../../config/economyConstants.js';
import type { MemberProfile } from '../../db/repositories/profileRepo.js';
import { getCreditTier } from '../creditLoan/creditTiersAndFlavor.js';
import {
  getDateKey,
  type BankInterestResult,
  type BankRobResult,
  type BankTransferResult,
  type EconomyOpsContext,
  type RobResult,
  type RobTargetHints,
  type TransferResult,
} from './economyTypesAndDates.js';
import {
  isRobProtectedAdmin,
  renderRobEasterEggStory,
  resolveRobAdminPersona,
} from './robAdminPersonas.js';

interface RobCreditPenalty {
  readonly delta: number;
  readonly reason: string;
}

interface RobModeConfig {
  readonly mode: 'pocket' | 'bank';
  readonly targetMin: number;
  readonly attackerMin: number;
  readonly trapFineRate: number;
  readonly failFineRate: number;
  readonly lockpickBonus: number;
  readonly lockpickCap: number;
  readonly stealMinRate: number;
  readonly stealMaxRate: number;
  readonly adminCreditPenalty: RobCreditPenalty | null;
  readonly trapCreditPenalty: RobCreditPenalty;
  readonly failCreditPenalty: RobCreditPenalty;
}

type RobCoreOk = {
  ok: true;
  success: boolean;
  amount: number;
  fineFromPocket: number;
  fineFromBank: number;
  attackerBalance: number;
  attackerBankBalance: number;
  nextTargetBalance: number;
  trapped?: boolean;
  usedLockpick?: boolean;
  bountyClaimed?: number;
  easterEggTriggered?: boolean;
  easterEggStory?: string;
};

type RobCoreResult =
  | RobCoreOk
  | {
      ok: false;
      reason: 'self_target' | 'cooldown' | 'target_shielded' | 'target_too_poor' | 'attacker_too_poor';
      retryAfterSec?: number;
    };

const POCKET_ROB_MODE: RobModeConfig = {
  mode: 'pocket',
  targetMin: ROB_TARGET_MIN_COINS,
  attackerMin: ROB_ATTACKER_MIN_ASSETS,
  trapFineRate: ROB_TRAP_FINE_RATE,
  failFineRate: ROB_FINE_RATE,
  lockpickBonus: ROB_LOCKPICK_BONUS,
  lockpickCap: ROB_LOCKPICK_CAP,
  stealMinRate: ROB_STEAL_MIN_RATE,
  stealMaxRate: ROB_STEAL_MAX_RATE,
  adminCreditPenalty: { delta: -10, reason: '偷窃失败信用扣分' },
  trapCreditPenalty: { delta: -10, reason: '偷窃踩捕兽夹信用扣分' },
  failCreditPenalty: { delta: -10, reason: '偷窃失败信用扣分' },
};

const BANK_ROB_MODE: RobModeConfig = {
  mode: 'bank',
  targetMin: BANK_ROB_TARGET_MIN,
  attackerMin: BANK_ROB_ATTACKER_MIN_ASSETS,
  trapFineRate: BANK_ROB_TRAP_FINE_RATE,
  failFineRate: BANK_ROB_FINE_RATE,
  lockpickBonus: BANK_ROB_LOCKPICK_BONUS,
  lockpickCap: BANK_ROB_LOCKPICK_CAP,
  stealMinRate: BANK_ROB_STEAL_MIN_RATE,
  stealMaxRate: BANK_ROB_STEAL_MAX_RATE,
  adminCreditPenalty: null,
  trapCreditPenalty: { delta: -20, reason: '抢劫银行踩陷阱信用扣分' },
  failCreditPenalty: { delta: -20, reason: '抢劫银行失败信用扣分' },
};

function settleRobFine(
  ctx: EconomyOpsContext,
  mode: 'pocket' | 'bank',
  guildId: string,
  attacker: MemberProfile,
  target: MemberProfile,
  rawFine: number,
  nowMs: number,
  creditPenalty: RobCreditPenalty | null,
  extras?: Partial<Pick<RobCoreOk, 'trapped' | 'usedLockpick' | 'easterEggTriggered' | 'easterEggStory'>>,
): RobCoreOk {
  const attackerTotal = attacker.coins + attacker.bankCoins;
  const actualFine = Math.min(rawFine, attackerTotal);
  const fineFromPocket = Math.min(attacker.coins, actualFine);
  const fineFromBank = actualFine - fineFromPocket;
  const nextAttackerCoins = attacker.coins - fineFromPocket;
  const nextAttackerBank = attacker.bankCoins - fineFromBank;
  const currentTarget = mode === 'pocket' ? target.coins : target.bankCoins;
  const nextTargetBalance = currentTarget + actualFine;

  ctx.profileRepo.save({
    ...attacker,
    coins: nextAttackerCoins,
    bankCoins: nextAttackerBank,
    lastRobAt: nowMs,
  });
  ctx.profileRepo.save(
    mode === 'pocket'
      ? { ...target, coins: nextTargetBalance }
      : { ...target, bankCoins: nextTargetBalance },
  );
  if (creditPenalty) {
    ctx.creditLoanService?.adjustCredit(
      guildId,
      attacker.userId,
      creditPenalty.delta,
      creditPenalty.reason,
      nowMs,
    );
  }
  return {
    ok: true,
    success: false,
    amount: actualFine,
    fineFromPocket,
    fineFromBank,
    attackerBalance: nextAttackerCoins,
    attackerBankBalance: nextAttackerBank,
    nextTargetBalance,
    ...extras,
  };
}

function executeRobCore(
  ctx: EconomyOpsContext,
  spec: RobModeConfig,
  guildId: string,
  attackerId: string,
  targetId: string,
  nowMs: number,
  rng: () => number,
  targetHints?: RobTargetHints,
): RobCoreResult {
  if (attackerId === targetId) return { ok: false, reason: 'self_target' };
  const guildCfg = ctx.configRepo.getOrCreate(guildId);
  const cfg = guildCfg.economy;

  return ctx.db.transaction((): RobCoreResult => {
    const attacker = ctx.profileRepo.getOrCreate(guildId, attackerId);
    const target = ctx.profileRepo.getOrCreate(guildId, targetId);

    const cooldownMs = cfg.robCooldownSec * 1000;
    const elapsed = nowMs - attacker.lastRobAt;
    if (attacker.lastRobAt > 0 && elapsed < cooldownMs) {
      return { ok: false, reason: 'cooldown', retryAfterSec: Math.ceil((cooldownMs - elapsed) / 1000) };
    }

    const attackerTotal = attacker.coins + attacker.bankCoins;
    if (isRobProtectedAdmin(targetId, guildCfg, targetHints)) {
      const rawFine =
        attackerTotal > 0 ? Math.max(1, Math.floor(attackerTotal * ROB_EASTER_EGG_FINE_RATE)) : 0;
      const settled = settleRobFine(
        ctx, spec.mode, guildId, attacker, target, rawFine, nowMs, spec.adminCreditPenalty,
      );
      const persona = resolveRobAdminPersona(target, targetHints);
      const easterEggStory = renderRobEasterEggStory(
        attackerId, targetId, settled.amount, cfg.currencyName, rng, spec.mode, persona,
      );
      return { ...settled, easterEggTriggered: true, easterEggStory };
    }

    if (target.robShieldUntil > nowMs) {
      return {
        ok: false,
        reason: 'target_shielded',
        retryAfterSec: Math.ceil((target.robShieldUntil - nowMs) / 1000),
      };
    }

    const targetBalance = spec.mode === 'pocket' ? target.coins : target.bankCoins;
    if (targetBalance < spec.targetMin) return { ok: false, reason: 'target_too_poor' };
    if (attackerTotal < spec.attackerMin) return { ok: false, reason: 'attacker_too_poor' };

    const usedLockpick = Boolean(
      ctx.chaosRepo?.consumeEffect(guildId, attackerId, 'lockpick_ready', nowMs),
    );
    const trappedEffect = ctx.chaosRepo?.consumeEffect(guildId, targetId, 'trap_armed', nowMs);

    if (trappedEffect) {
      const rawTrapFine = Math.max(1, Math.floor(attackerTotal * spec.trapFineRate));
      return settleRobFine(
        ctx, spec.mode, guildId, attacker, target, rawTrapFine, nowMs, spec.trapCreditPenalty,
        { trapped: true, ...(usedLockpick ? { usedLockpick: true } : {}) },
      );
    }

    const baseRate =
      spec.mode === 'pocket'
        ? cfg.robSuccessRate
        : Number.isFinite(cfg.robBankSuccessRate)
          ? cfg.robBankSuccessRate
          : 0.2;
    const effectiveRate = usedLockpick
      ? Math.min(spec.lockpickCap, baseRate + spec.lockpickBonus)
      : baseRate;

    if (rng() < effectiveRate) {
      const roll = Math.min(1, Math.max(0, rng()));
      const pct = spec.stealMinRate + roll * (spec.stealMaxRate - spec.stealMinRate);
      const actualStolen = Math.min(Math.max(1, Math.floor(targetBalance * pct)), targetBalance);
      const bountyClaimed =
        ctx.chaosRepo?.claimOpenBounties(guildId, targetId, attackerId, nowMs) ?? 0;
      const nextAttackerCoins = attacker.coins + actualStolen + bountyClaimed;
      const nextTargetBalance = targetBalance - actualStolen;
      const shieldUntil = nowMs + cfg.robTargetShieldSec * 1000;

      ctx.profileRepo.save({ ...attacker, coins: nextAttackerCoins, lastRobAt: nowMs });
      ctx.profileRepo.save(
        spec.mode === 'pocket'
          ? { ...target, coins: nextTargetBalance, robShieldUntil: shieldUntil }
          : { ...target, bankCoins: nextTargetBalance, robShieldUntil: shieldUntil },
      );

      return {
        ok: true,
        success: true,
        amount: actualStolen,
        fineFromPocket: 0,
        fineFromBank: 0,
        attackerBalance: nextAttackerCoins,
        attackerBankBalance: attacker.bankCoins,
        nextTargetBalance,
        ...(usedLockpick ? { usedLockpick: true } : {}),
        ...(bountyClaimed > 0 ? { bountyClaimed } : {}),
      };
    }

    const rawFine = Math.max(1, Math.floor(attackerTotal * spec.failFineRate));
    return settleRobFine(
      ctx, spec.mode, guildId, attacker, target, rawFine, nowMs, spec.failCreditPenalty,
      usedLockpick ? { usedLockpick: true } : undefined,
    );
  })();
}

export function robOp(
  ctx: EconomyOpsContext,
  guildId: string,
  attackerId: string,
  targetId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
  targetHints?: RobTargetHints,
): RobResult {
  const res = executeRobCore(ctx, POCKET_ROB_MODE, guildId, attackerId, targetId, nowMs, rng, targetHints);
  if (!res.ok) return res;
  const { nextTargetBalance, ...rest } = res;
  return { ...rest, targetBalance: nextTargetBalance };
}

export function robBankOp(
  ctx: EconomyOpsContext,
  guildId: string,
  attackerId: string,
  targetId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
  targetHints?: RobTargetHints,
): BankRobResult {
  const res = executeRobCore(ctx, BANK_ROB_MODE, guildId, attackerId, targetId, nowMs, rng, targetHints);
  if (!res.ok) {
    if (res.reason === 'target_too_poor') return { ok: false, reason: 'target_bank_too_poor' };
    return {
      ok: false,
      reason: res.reason,
      ...(res.retryAfterSec !== undefined ? { retryAfterSec: res.retryAfterSec } : {}),
    };
  }
  const { nextTargetBalance, ...rest } = res;
  return { ...rest, targetBankBalance: nextTargetBalance };
}

export function transferCoinsOp(
  ctx: EconomyOpsContext,
  guildId: string,
  fromId: string,
  toId: string,
  amount: number,
  nowMs = Date.now(),
): TransferResult {
  if (fromId === toId) return { ok: false, reason: 'self_target' };
  const cleanAmount = Math.floor(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }

  return ctx.db.transaction((): TransferResult => {
    if (ctx.creditLoanService?.isDeadbeatBlocked(guildId, fromId, nowMs).blocked) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }
    const sender = ctx.profileRepo.getOrCreate(guildId, fromId);
    if (sender.coins < cleanAmount) return { ok: false, reason: 'insufficient_funds' };
    const receiver = ctx.profileRepo.getOrCreate(guildId, toId);
    const fromBalance = sender.coins - cleanAmount;
    const toBalance = receiver.coins + cleanAmount;

    ctx.profileRepo.save({ ...sender, coins: fromBalance });
    ctx.profileRepo.save({ ...receiver, coins: toBalance });

    return { ok: true, amount: cleanAmount, fromBalance, toBalance };
  })();
}

export function claimBankInterestOp(
  ctx: EconomyOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): BankInterestResult {
  const cfg = ctx.configRepo.getOrCreate(guildId).economy;
  const today = getDateKey(nowMs, ctx.timezone);

  return ctx.db.transaction((): BankInterestResult => {
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    if (profile.lastBankInterestDate === today) return { ok: false, reason: 'already_claimed' };
    if (profile.bankCoins < cfg.bankInterestMinDeposit) {
      return { ok: false, reason: 'below_minimum', minDeposit: cfg.bankInterestMinDeposit };
    }

    let interestCap = cfg.bankInterestMax;
    if (ctx.creditLoanService) {
      const creditProfile = ctx.creditLoanService.getCreditProfile(guildId, userId, nowMs);
      interestCap = Math.max(
        1,
        Math.round(cfg.bankInterestMax * getCreditTier(creditProfile.account.score).bankInterestCapMult),
      );
    }

    const interest = Math.max(
      1,
      Math.min(interestCap, Math.floor(profile.bankCoins * cfg.bankInterestRate)),
    );
    const bankCoins = profile.bankCoins + interest;

    ctx.profileRepo.save({ ...profile, bankCoins, lastBankInterestDate: today });
    return { ok: true, interest, bankCoins };
  })();
}

export function transferBankOp(
  ctx: EconomyOpsContext,
  guildId: string,
  userId: string,
  amount: number,
  direction: 'deposit' | 'withdraw',
): BankTransferResult {
  const cleanAmount = Math.floor(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }

  return ctx.db.transaction((): BankTransferResult => {
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    const sourceBalance = direction === 'deposit' ? profile.coins : profile.bankCoins;
    if (sourceBalance < cleanAmount) return { ok: false, reason: 'insufficient_funds' };

    const delta = direction === 'deposit' ? cleanAmount : -cleanAmount;
    const coins = profile.coins - delta;
    const bankCoins = profile.bankCoins + delta;
    ctx.profileRepo.save({ ...profile, coins, bankCoins });

    return { ok: true, amount: cleanAmount, coins, bankCoins };
  })();
}
