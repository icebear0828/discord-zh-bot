import type Database from 'better-sqlite3';
import {
  BANK_ROB_ATTACKER_MIN_ASSETS,
  BANK_ROB_FINE_RATE,
  BANK_ROB_LOCKPICK_BONUS,
  BANK_ROB_LOCKPICK_CAP,
  BANK_ROB_STEAL_MAX_RATE,
  BANK_ROB_STEAL_MIN_RATE,
  BANK_ROB_TARGET_MIN,
  BANK_ROB_TRAP_FINE_RATE,
  DEFAULT_SLOTS_VIP_KEYWORDS,
  MAX_SOLO_GAMBLE_BET,
  ROB_ADMIN_EASTER_EGG_STORIES,
  ROB_ATTACKER_MIN_ASSETS,
  ROB_EASTER_EGG_FINE_RATE,
  ROB_FINE_RATE,
  ROB_LOCKPICK_BONUS,
  ROB_LOCKPICK_CAP,
  ROB_STEAL_MAX_RATE,
  ROB_STEAL_MIN_RATE,
  ROB_TARGET_MIN_COINS,
  ROB_TRAP_FINE_RATE,
  SLOTS_VIP_ICE_JACKPOT_CHANCE,
} from '../config/economyConstants.js';
import type { ChaosRepo } from '../db/repositories/chaosRepo.js';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import { getCreditTier, type CreditLoanService } from './creditLoanService.js';

export function getDateKey(nowMs: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

export function getPreviousDateKey(nowMs: number, timezone: string): string {
  return getDateKey(nowMs - 86_400_000, timezone);
}

export type DailyResult =
  | {
      ok: true;
      reward: number;
      streak: number;
      bonus: number;
      balance: number;
      garnished?: number;
    }
  | { ok: false; reason: 'already_claimed'; streak: number };

export type WorkResult =
  | {
      ok: true;
      reward: number;
      story: string;
      balance: number;
      cursed?: boolean;
      garnished?: number;
      creditMultiplier?: number;
    }
  | { ok: false; reason: 'cooldown'; retryAfterSec: number };

export interface RobTargetHints {
  displayNames?: readonly string[];
  roleNames?: readonly string[];
  isAdmin?: boolean;
}

export function isRobProtectedAdmin(
  targetId: string,
  guildCfg: { adminUserIds: readonly string[] },
  targetHints?: RobTargetHints,
): boolean {
  if (targetHints?.isAdmin) {
    return true;
  }
  return guildCfg.adminUserIds.includes(targetId);
}

function matchesProfileKeywords(
  targetProfile: { equippedTitle: string | null; cardNickname: string | null },
  targetHints: RobTargetHints | undefined,
  keywords: readonly string[],
): boolean {
  const loweredKeywords = keywords
    .map((kw) => kw.trim().toLowerCase())
    .filter((kw) => kw.length > 0);
  if (loweredKeywords.length === 0) return false;

  const candidates: string[] = [];
  if (targetProfile.equippedTitle) candidates.push(targetProfile.equippedTitle);
  if (targetProfile.cardNickname) candidates.push(targetProfile.cardNickname);
  if (targetHints?.displayNames) {
    for (const name of targetHints.displayNames) {
      if (name) candidates.push(name);
    }
  }
  if (targetHints?.roleNames) {
    for (const roleName of targetHints.roleNames) {
      if (roleName) candidates.push(roleName);
    }
  }

  for (const raw of candidates) {
    const normalized = raw.toLowerCase();
    for (const kw of loweredKeywords) {
      if (normalized.includes(kw)) {
        return true;
      }
    }
  }
  return false;
}

export function matchesSlotsVipPlayer(
  playerProfile: { equippedTitle: string | null; cardNickname: string | null },
  playerHints?: RobTargetHints,
  keywords: readonly string[] = DEFAULT_SLOTS_VIP_KEYWORDS,
): boolean {
  return matchesProfileKeywords(playerProfile, playerHints, keywords);
}

function renderRobEasterEggStory(
  attackerId: string,
  targetId: string,
  fine: number,
  currencyName: string,
  rng: () => number,
): string {
  const raw = rng();
  const r = Number.isFinite(raw) ? Math.min(0.999999, Math.max(0, raw)) : 0;
  const idx = Math.min(
    ROB_ADMIN_EASTER_EGG_STORIES.length - 1,
    Math.floor(r * ROB_ADMIN_EASTER_EGG_STORIES.length),
  );
  const template = ROB_ADMIN_EASTER_EGG_STORIES[idx]!;
  return template
    .replaceAll('{attacker}', `<@${attackerId}>`)
    .replaceAll('{target}', `<@${targetId}>`)
    .replaceAll('{fine}', `**${fine}**`)
    .replaceAll('{currency}', currencyName);
}

export type RobResult =
  | {
      ok: true;
      success: boolean;
      amount: number;
      attackerBalance: number;
      attackerBankBalance?: number;
      targetBalance: number;
      fineFromPocket?: number;
      fineFromBank?: number;
      trapped?: boolean;
      usedLockpick?: boolean;
      bountyClaimed?: number;
      easterEggTriggered?: boolean;
      easterEggStory?: string;
    }
  | {
      ok: false;
      reason:
        | 'self_target'
        | 'cooldown'
        | 'target_shielded'
        | 'target_too_poor'
        | 'attacker_too_poor';
      retryAfterSec?: number;
    };

export type BankRobResult =
  | {
      ok: true;
      success: boolean;
      amount: number;
      fineFromPocket: number;
      fineFromBank: number;
      attackerBalance: number;
      attackerBankBalance: number;
      targetBankBalance: number;
      trapped?: boolean;
      usedLockpick?: boolean;
      bountyClaimed?: number;
      easterEggTriggered?: boolean;
      easterEggStory?: string;
    }
  | {
      ok: false;
      reason:
        | 'self_target'
        | 'cooldown'
        | 'target_shielded'
        | 'target_bank_too_poor'
        | 'attacker_too_poor';
      retryAfterSec?: number;
    };

export type TransferResult =
  | { ok: true; amount: number; fromBalance: number; toBalance: number }
  | {
      ok: false;
      reason: 'self_target' | 'invalid_amount' | 'insufficient_funds' | 'deadbeat_blocked';
    };

export type BankTransferResult =
  | { ok: true; amount: number; coins: number; bankCoins: number }
  | { ok: false; reason: 'invalid_amount' | 'insufficient_funds' };

export type BankInterestResult =
  | { ok: true; interest: number; bankCoins: number }
  | { ok: false; reason: 'already_claimed' | 'below_minimum'; minDeposit?: number };

export type DiceChoice = 'big' | 'small' | 'triple';

export type DiceResult =
  | {
      ok: true;
      dice: [number, number, number];
      sum: number;
      isTriple: boolean;
      won: boolean;
      netChange: number;
      balance: number;
    }
  | {
      ok: false;
      reason: 'invalid_bet' | 'bet_too_large' | 'insufficient_funds' | 'deadbeat_blocked';
    };

export type SlotsResult =
  | {
      ok: true;
      reels: [string, string, string];
      multiplier: number;
      payout: number;
      netChange: number;
      balance: number;
    }
  | {
      ok: false;
      reason: 'invalid_bet' | 'bet_too_large' | 'insufficient_funds' | 'deadbeat_blocked';
    };

const WORK_STORIES = [
  '帮管理员整理频道归档',
  '在咖啡馆兼职冲泡手冲咖啡',
  '给社区机器人修了一个小 Bug',
  '代班主持了一场语音茶话会',
  '在集市帮路人搬运补给箱',
  '撰写了一份新手入门攻略',
];

export const SLOT_SYMBOLS: ReadonlyArray<{ symbol: string; weight: number }> = [
  { symbol: '🍒', weight: 35 },
  { symbol: '🍋', weight: 23 },
  { symbol: '🍇', weight: 15 },
  { symbol: '🔔', weight: 9 },
  { symbol: '💎', weight: 8 },
  { symbol: '7️⃣', weight: 5 },
  { symbol: '🧊', weight: 5 },
];

const TOTAL_SLOT_WEIGHT = SLOT_SYMBOLS.reduce((sum, item) => sum + item.weight, 0);

function pickWeightedSlotSymbol(r: number): string {
  let target = Math.min(0.999999, Math.max(0, r)) * TOTAL_SLOT_WEIGHT;
  for (const item of SLOT_SYMBOLS) {
    if (target < item.weight) {
      return item.symbol;
    }
    target -= item.weight;
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1]!.symbol;
}

export class EconomyService {
  constructor(
    private readonly db: Database.Database,
    private readonly configRepo: GuildConfigRepo,
    private readonly profileRepo: ProfileRepo,
    private readonly timezone = 'Asia/Shanghai',
    private readonly chaosRepo?: ChaosRepo,
    private readonly creditLoanService?: CreditLoanService,
  ) {}

  claimDaily(guildId: string, userId: string, nowMs = Date.now()): DailyResult {
    const cfg = this.configRepo.getOrCreate(guildId).economy;
    const today = getDateKey(nowMs, this.timezone);
    const yesterday = getPreviousDateKey(nowMs, this.timezone);

    return this.db.transaction((): DailyResult => {
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.lastDailyDate === today) {
        return { ok: false, reason: 'already_claimed', streak: profile.dailyStreak };
      }

      const nextStreak = profile.lastDailyDate === yesterday ? profile.dailyStreak + 1 : 1;
      const bonus = Math.min(
        (nextStreak - 1) * cfg.dailyStreakBonus,
        cfg.dailyMaxStreakBonus,
      );
      const reward = cfg.dailyBase + bonus;
      let garnished = 0;
      let netReward = reward;
      if (this.creditLoanService) {
        this.creditLoanService.adjustCredit(guildId, userId, 3, '每日签到信用奖励', nowMs);
        const garnishRes = this.creditLoanService.garnishIncomingCoins(
          guildId,
          userId,
          reward,
          'daily',
          nowMs,
        );
        garnished = garnishRes.garnished;
        netReward = garnishRes.netAmount;
      }
      const nextCoins = profile.coins + netReward;

      this.profileRepo.save({
        ...profile,
        coins: nextCoins,
        dailyStreak: nextStreak,
        lastDailyDate: today,
      });

      return {
        ok: true,
        reward,
        streak: nextStreak,
        bonus,
        balance: nextCoins,
        ...(this.creditLoanService ? { garnished } : {}),
      };
    })();
  }

  work(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): WorkResult {
    const cfg = this.configRepo.getOrCreate(guildId).economy;

    return this.db.transaction((): WorkResult => {
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      const cooldownMs = cfg.workCooldownSec * 1000;
      const elapsed = nowMs - profile.lastWorkAt;
      if (profile.lastWorkAt > 0 && elapsed < cooldownMs) {
        return {
          ok: false,
          reason: 'cooldown',
          retryAfterSec: Math.ceil((cooldownMs - elapsed) / 1000),
        };
      }

      const min = Math.min(cfg.workMin, cfg.workMax);
      const max = Math.max(cfg.workMin, cfg.workMax);
      const baseReward = min + Math.floor(rng() * (max - min + 1));
      const cursedEffect = this.chaosRepo?.consumeEffect(guildId, userId, 'work_cursed', nowMs);
      const cursed = Boolean(cursedEffect);
      let reward = cursed ? Math.max(1, Math.floor(baseReward * 0.5)) : baseReward;
      let creditMultiplier: number | undefined;
      let garnished = 0;
      let netReward = reward;
      if (this.creditLoanService) {
        const creditProfile = this.creditLoanService.getCreditProfile(guildId, userId, nowMs);
        creditMultiplier = getCreditTier(creditProfile.account.score).workMult;
        reward = Math.max(1, Math.round(reward * creditMultiplier));
        const garnishRes = this.creditLoanService.garnishIncomingCoins(
          guildId,
          userId,
          reward,
          'work',
          nowMs,
        );
        garnished = garnishRes.garnished;
        netReward = garnishRes.netAmount;
      }
      const storyIndex = Math.min(
        WORK_STORIES.length - 1,
        Math.floor(rng() * WORK_STORIES.length),
      );
      const story = WORK_STORIES[storyIndex]!;
      const nextCoins = profile.coins + netReward;

      this.profileRepo.save({
        ...profile,
        coins: nextCoins,
        lastWorkAt: nowMs,
      });

      return {
        ok: true,
        reward,
        story,
        balance: nextCoins,
        ...(cursed ? { cursed: true } : {}),
        ...(this.creditLoanService ? { garnished, creditMultiplier } : {}),
      };
    })();
  }

  rob(
    guildId: string,
    attackerId: string,
    targetId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
    targetHints?: RobTargetHints,
  ): RobResult {
    if (attackerId === targetId) {
      return { ok: false, reason: 'self_target' };
    }
    const guildCfg = this.configRepo.getOrCreate(guildId);
    const cfg = guildCfg.economy;

    return this.db.transaction((): RobResult => {
      const attacker = this.profileRepo.getOrCreate(guildId, attackerId);
      const target = this.profileRepo.getOrCreate(guildId, targetId);

      const cooldownMs = cfg.robCooldownSec * 1000;
      const elapsed = nowMs - attacker.lastRobAt;
      if (attacker.lastRobAt > 0 && elapsed < cooldownMs) {
        return {
          ok: false,
          reason: 'cooldown',
          retryAfterSec: Math.ceil((cooldownMs - elapsed) / 1000),
        };
      }

      if (isRobProtectedAdmin(targetId, guildCfg, targetHints)) {
        const attackerTotal = attacker.coins + attacker.bankCoins;
        const rawFine =
          attackerTotal > 0 ? Math.max(1, Math.floor(attackerTotal * ROB_EASTER_EGG_FINE_RATE)) : 0;
        const actualFine = Math.min(rawFine, attackerTotal);
        const fineFromPocket = Math.min(attacker.coins, actualFine);
        const fineFromBank = actualFine - fineFromPocket;
        const nextAttackerCoins = attacker.coins - fineFromPocket;
        const nextAttackerBank = attacker.bankCoins - fineFromBank;
        const nextTargetCoins = target.coins + actualFine;

        this.profileRepo.save({
          ...attacker,
          coins: nextAttackerCoins,
          bankCoins: nextAttackerBank,
          lastRobAt: nowMs,
        });
        this.profileRepo.save({
          ...target,
          coins: nextTargetCoins,
        });
        this.creditLoanService?.adjustCredit(
          guildId,
          attackerId,
          -10,
          '打劫管理员触发反噬信用扣分',
          nowMs,
        );

        const easterEggStory = renderRobEasterEggStory(
          attackerId,
          targetId,
          actualFine,
          cfg.currencyName,
          rng,
        );

        return {
          ok: true,
          success: false,
          amount: actualFine,
          fineFromPocket,
          fineFromBank,
          attackerBalance: nextAttackerCoins,
          attackerBankBalance: nextAttackerBank,
          targetBalance: nextTargetCoins,
          easterEggTriggered: true,
          easterEggStory,
        };
      }

      if (target.robShieldUntil > nowMs) {
        return {
          ok: false,
          reason: 'target_shielded',
          retryAfterSec: Math.ceil((target.robShieldUntil - nowMs) / 1000),
        };
      }

      if (target.coins < ROB_TARGET_MIN_COINS) {
        return { ok: false, reason: 'target_too_poor' };
      }

      const attackerTotal = attacker.coins + attacker.bankCoins;
      if (attackerTotal < ROB_ATTACKER_MIN_ASSETS) {
        return { ok: false, reason: 'attacker_too_poor' };
      }

      const usedLockpick = Boolean(
        this.chaosRepo?.consumeEffect(guildId, attackerId, 'lockpick_ready', nowMs),
      );
      const trappedEffect = this.chaosRepo?.consumeEffect(guildId, targetId, 'trap_armed', nowMs);

      const applyFine = (rawFine: number): {
        actualFine: number;
        fineFromPocket: number;
        fineFromBank: number;
        nextAttackerCoins: number;
        nextAttackerBank: number;
      } => {
        const actualFine = Math.min(rawFine, attackerTotal);
        const fineFromPocket = Math.min(attacker.coins, actualFine);
        const fineFromBank = actualFine - fineFromPocket;
        return {
          actualFine,
          fineFromPocket,
          fineFromBank,
          nextAttackerCoins: attacker.coins - fineFromPocket,
          nextAttackerBank: attacker.bankCoins - fineFromBank,
        };
      };

      if (trappedEffect) {
        const rawTrapFine = Math.max(1, Math.floor(attackerTotal * ROB_TRAP_FINE_RATE));
        const fine = applyFine(rawTrapFine);
        const nextTarget = target.coins + fine.actualFine;

        this.profileRepo.save({
          ...attacker,
          coins: fine.nextAttackerCoins,
          bankCoins: fine.nextAttackerBank,
          lastRobAt: nowMs,
        });
        this.profileRepo.save({
          ...target,
          coins: nextTarget,
        });
        this.creditLoanService?.adjustCredit(
          guildId,
          attackerId,
          -10,
          '偷窃踩捕兽夹信用扣分',
          nowMs,
        );

        return {
          ok: true,
          success: false,
          amount: fine.actualFine,
          fineFromPocket: fine.fineFromPocket,
          fineFromBank: fine.fineFromBank,
          attackerBalance: fine.nextAttackerCoins,
          attackerBankBalance: fine.nextAttackerBank,
          targetBalance: nextTarget,
          trapped: true,
          ...(usedLockpick ? { usedLockpick: true } : {}),
        };
      }

      const effectiveRate = usedLockpick
        ? Math.min(ROB_LOCKPICK_CAP, cfg.robSuccessRate + ROB_LOCKPICK_BONUS)
        : cfg.robSuccessRate;
      const succeeded = rng() < effectiveRate;
      if (succeeded) {
        const roll = Math.min(1, Math.max(0, rng()));
        const pct = ROB_STEAL_MIN_RATE + roll * (ROB_STEAL_MAX_RATE - ROB_STEAL_MIN_RATE);
        const stolen = Math.max(1, Math.floor(target.coins * pct));
        const actualStolen = Math.min(stolen, target.coins);
        const bountyClaimed =
          this.chaosRepo?.claimOpenBounties(guildId, targetId, attackerId, nowMs) ?? 0;
        const nextAttacker = attacker.coins + actualStolen + bountyClaimed;
        const nextTarget = target.coins - actualStolen;

        this.profileRepo.save({
          ...attacker,
          coins: nextAttacker,
          lastRobAt: nowMs,
        });
        this.profileRepo.save({
          ...target,
          coins: nextTarget,
          robShieldUntil: nowMs + cfg.robTargetShieldSec * 1000,
        });

        return {
          ok: true,
          success: true,
          amount: actualStolen,
          fineFromPocket: 0,
          fineFromBank: 0,
          attackerBalance: nextAttacker,
          attackerBankBalance: attacker.bankCoins,
          targetBalance: nextTarget,
          ...(usedLockpick ? { usedLockpick: true } : {}),
          ...(bountyClaimed > 0 ? { bountyClaimed } : {}),
        };
      }

      const rawFine = Math.max(1, Math.floor(attackerTotal * ROB_FINE_RATE));
      const fine = applyFine(rawFine);
      const nextTarget = target.coins + fine.actualFine;

      this.profileRepo.save({
        ...attacker,
        coins: fine.nextAttackerCoins,
        bankCoins: fine.nextAttackerBank,
        lastRobAt: nowMs,
      });
      this.profileRepo.save({
        ...target,
        coins: nextTarget,
      });
      this.creditLoanService?.adjustCredit(guildId, attackerId, -10, '偷窃失败信用扣分', nowMs);

      return {
        ok: true,
        success: false,
        amount: fine.actualFine,
        fineFromPocket: fine.fineFromPocket,
        fineFromBank: fine.fineFromBank,
        attackerBalance: fine.nextAttackerCoins,
        attackerBankBalance: fine.nextAttackerBank,
        targetBalance: nextTarget,
        ...(usedLockpick ? { usedLockpick: true } : {}),
      };
    })();
  }

  robBank(
    guildId: string,
    attackerId: string,
    targetId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
    targetHints?: RobTargetHints,
  ): BankRobResult {
    if (attackerId === targetId) {
      return { ok: false, reason: 'self_target' };
    }
    const guildCfg = this.configRepo.getOrCreate(guildId);
    const cfg = guildCfg.economy;

    return this.db.transaction((): BankRobResult => {
      const attacker = this.profileRepo.getOrCreate(guildId, attackerId);
      const target = this.profileRepo.getOrCreate(guildId, targetId);

      const cooldownMs = cfg.robCooldownSec * 1000;
      const elapsed = nowMs - attacker.lastRobAt;
      if (attacker.lastRobAt > 0 && elapsed < cooldownMs) {
        return {
          ok: false,
          reason: 'cooldown',
          retryAfterSec: Math.ceil((cooldownMs - elapsed) / 1000),
        };
      }

      if (isRobProtectedAdmin(targetId, guildCfg, targetHints)) {
        const attackerTotal = attacker.coins + attacker.bankCoins;
        const rawFine =
          attackerTotal > 0 ? Math.max(1, Math.floor(attackerTotal * ROB_EASTER_EGG_FINE_RATE)) : 0;
        const actualFine = Math.min(rawFine, attackerTotal);
        const fineFromPocket = Math.min(attacker.coins, actualFine);
        const fineFromBank = actualFine - fineFromPocket;
        const nextAttackerCoins = attacker.coins - fineFromPocket;
        const nextAttackerBank = attacker.bankCoins - fineFromBank;
        const nextTargetBank = target.bankCoins + actualFine;

        this.profileRepo.save({
          ...attacker,
          coins: nextAttackerCoins,
          bankCoins: nextAttackerBank,
          lastRobAt: nowMs,
        });
        this.profileRepo.save({
          ...target,
          bankCoins: nextTargetBank,
        });

        const easterEggStory = renderRobEasterEggStory(
          attackerId,
          targetId,
          actualFine,
          cfg.currencyName,
          rng,
        );

        return {
          ok: true,
          success: false,
          amount: actualFine,
          fineFromPocket,
          fineFromBank,
          attackerBalance: nextAttackerCoins,
          attackerBankBalance: nextAttackerBank,
          targetBankBalance: nextTargetBank,
          easterEggTriggered: true,
          easterEggStory,
        };
      }

      if (target.robShieldUntil > nowMs) {
        return {
          ok: false,
          reason: 'target_shielded',
          retryAfterSec: Math.ceil((target.robShieldUntil - nowMs) / 1000),
        };
      }

      if (target.bankCoins < BANK_ROB_TARGET_MIN) {
        return { ok: false, reason: 'target_bank_too_poor' };
      }

      const attackerTotal = attacker.coins + attacker.bankCoins;
      if (attackerTotal < BANK_ROB_ATTACKER_MIN_ASSETS) {
        return { ok: false, reason: 'attacker_too_poor' };
      }

      const usedLockpick = Boolean(
        this.chaosRepo?.consumeEffect(guildId, attackerId, 'lockpick_ready', nowMs),
      );
      const trappedEffect = this.chaosRepo?.consumeEffect(guildId, targetId, 'trap_armed', nowMs);

      const applyFine = (rawFine: number): {
        actualFine: number;
        fineFromPocket: number;
        fineFromBank: number;
        nextAttackerCoins: number;
        nextAttackerBank: number;
      } => {
        const actualFine = Math.min(rawFine, attackerTotal);
        const fineFromPocket = Math.min(attacker.coins, actualFine);
        const fineFromBank = actualFine - fineFromPocket;
        return {
          actualFine,
          fineFromPocket,
          fineFromBank,
          nextAttackerCoins: attacker.coins - fineFromPocket,
          nextAttackerBank: attacker.bankCoins - fineFromBank,
        };
      };

      if (trappedEffect) {
        const rawTrapFine = Math.max(1, Math.floor(attackerTotal * BANK_ROB_TRAP_FINE_RATE));
        const fine = applyFine(rawTrapFine);
        const nextTargetBank = target.bankCoins + fine.actualFine;

        this.profileRepo.save({
          ...attacker,
          coins: fine.nextAttackerCoins,
          bankCoins: fine.nextAttackerBank,
          lastRobAt: nowMs,
        });
        this.profileRepo.save({
          ...target,
          bankCoins: nextTargetBank,
        });
        this.creditLoanService?.adjustCredit(
          guildId,
          attackerId,
          -20,
          '抢劫银行踩陷阱信用扣分',
          nowMs,
        );

        return {
          ok: true,
          success: false,
          amount: fine.actualFine,
          fineFromPocket: fine.fineFromPocket,
          fineFromBank: fine.fineFromBank,
          attackerBalance: fine.nextAttackerCoins,
          attackerBankBalance: fine.nextAttackerBank,
          targetBankBalance: nextTargetBank,
          trapped: true,
          ...(usedLockpick ? { usedLockpick: true } : {}),
        };
      }

      const baseBankRate = Number.isFinite(cfg.robBankSuccessRate)
        ? cfg.robBankSuccessRate
        : 0.2;
      const effectiveRate = usedLockpick
        ? Math.min(BANK_ROB_LOCKPICK_CAP, baseBankRate + BANK_ROB_LOCKPICK_BONUS)
        : baseBankRate;
      const succeeded = rng() < effectiveRate;

      if (succeeded) {
        const roll = Math.min(1, Math.max(0, rng()));
        const pct =
          BANK_ROB_STEAL_MIN_RATE +
          roll * (BANK_ROB_STEAL_MAX_RATE - BANK_ROB_STEAL_MIN_RATE);
        const stolen = Math.max(1, Math.floor(target.bankCoins * pct));
        const actualStolen = Math.min(stolen, target.bankCoins);
        const bountyClaimed =
          this.chaosRepo?.claimOpenBounties(guildId, targetId, attackerId, nowMs) ?? 0;
        const nextAttackerCoins = attacker.coins + actualStolen + bountyClaimed;
        const nextTargetBank = target.bankCoins - actualStolen;

        this.profileRepo.save({
          ...attacker,
          coins: nextAttackerCoins,
          lastRobAt: nowMs,
        });
        this.profileRepo.save({
          ...target,
          bankCoins: nextTargetBank,
          robShieldUntil: nowMs + cfg.robTargetShieldSec * 1000,
        });

        return {
          ok: true,
          success: true,
          amount: actualStolen,
          fineFromPocket: 0,
          fineFromBank: 0,
          attackerBalance: nextAttackerCoins,
          attackerBankBalance: attacker.bankCoins,
          targetBankBalance: nextTargetBank,
          ...(usedLockpick ? { usedLockpick: true } : {}),
          ...(bountyClaimed > 0 ? { bountyClaimed } : {}),
        };
      }

      const rawFine = Math.max(1, Math.floor(attackerTotal * BANK_ROB_FINE_RATE));
      const fine = applyFine(rawFine);
      const nextTargetBank = target.bankCoins + fine.actualFine;

      this.profileRepo.save({
        ...attacker,
        coins: fine.nextAttackerCoins,
        bankCoins: fine.nextAttackerBank,
        lastRobAt: nowMs,
      });
      this.profileRepo.save({
        ...target,
        bankCoins: nextTargetBank,
      });
      this.creditLoanService?.adjustCredit(
        guildId,
        attackerId,
        -20,
        '抢劫银行失败信用扣分',
        nowMs,
      );

      return {
        ok: true,
        success: false,
        amount: fine.actualFine,
        fineFromPocket: fine.fineFromPocket,
        fineFromBank: fine.fineFromBank,
        attackerBalance: fine.nextAttackerCoins,
        attackerBankBalance: fine.nextAttackerBank,
        targetBankBalance: nextTargetBank,
        ...(usedLockpick ? { usedLockpick: true } : {}),
      };
    })();
  }

  transferCoins(
    guildId: string,
    fromId: string,
    toId: string,
    amount: number,
    nowMs = Date.now(),
  ): TransferResult {
    if (fromId === toId) {
      return { ok: false, reason: 'self_target' };
    }
    const cleanAmount = Math.floor(amount);
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      return { ok: false, reason: 'invalid_amount' };
    }

    return this.db.transaction((): TransferResult => {
      if (this.creditLoanService?.isDeadbeatBlocked(guildId, fromId, nowMs).blocked) {
        return { ok: false, reason: 'deadbeat_blocked' };
      }
      const sender = this.profileRepo.getOrCreate(guildId, fromId);
      if (sender.coins < cleanAmount) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      const receiver = this.profileRepo.getOrCreate(guildId, toId);
      const fromBalance = sender.coins - cleanAmount;
      const toBalance = receiver.coins + cleanAmount;

      this.profileRepo.save({ ...sender, coins: fromBalance });
      this.profileRepo.save({ ...receiver, coins: toBalance });

      return { ok: true, amount: cleanAmount, fromBalance, toBalance };
    })();
  }

  playDice(
    guildId: string,
    userId: string,
    bet: number,
    choice: DiceChoice,
    rng: () => number = Math.random,
    nowMs = Date.now(),
  ): DiceResult {
    const cleanBet = Math.floor(bet);
    if (!Number.isFinite(cleanBet) || cleanBet <= 0) {
      return { ok: false, reason: 'invalid_bet' };
    }
    if (cleanBet > MAX_SOLO_GAMBLE_BET) {
      return { ok: false, reason: 'bet_too_large' };
    }

    return this.db.transaction((): DiceResult => {
      if (this.creditLoanService?.isDeadbeatBlocked(guildId, userId, nowMs).blocked) {
        return { ok: false, reason: 'deadbeat_blocked' };
      }
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cleanBet) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const roll = (): number => 1 + Math.min(5, Math.floor(rng() * 6));
      const d1 = roll();
      const d2 = roll();
      const d3 = roll();
      const dice: [number, number, number] = [d1, d2, d3];
      const sum = d1 + d2 + d3;
      const isTriple = d1 === d2 && d2 === d3;

      let won = false;
      let netChange = -cleanBet;

      if (choice === 'triple' && isTriple) {
        won = true;
        netChange = cleanBet * 10;
      } else if (!isTriple && choice === 'big' && sum >= 11) {
        won = true;
        netChange = cleanBet;
      } else if (!isTriple && choice === 'small' && sum <= 10) {
        won = true;
        netChange = cleanBet;
      }

      const balance = profile.coins + netChange;
      this.profileRepo.save({ ...profile, coins: balance });
      this.creditLoanService?.recordGamblingResult(guildId, userId, cleanBet, netChange, nowMs);

      return { ok: true, dice, sum, isTriple, won, netChange, balance };
    })();
  }

  playSlots(
    guildId: string,
    userId: string,
    bet: number,
    rng: () => number = Math.random,
    nowMs = Date.now(),
    playerHints?: RobTargetHints,
  ): SlotsResult {
    const cleanBet = Math.floor(bet);
    if (!Number.isFinite(cleanBet) || cleanBet <= 0) {
      return { ok: false, reason: 'invalid_bet' };
    }
    if (cleanBet > MAX_SOLO_GAMBLE_BET) {
      return { ok: false, reason: 'bet_too_large' };
    }

    return this.db.transaction((): SlotsResult => {
      if (this.creditLoanService?.isDeadbeatBlocked(guildId, userId, nowMs).blocked) {
        return { ok: false, reason: 'deadbeat_blocked' };
      }
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cleanBet) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const isVip = matchesSlotsVipPlayer(profile, playerHints);
      let reels: [string, string, string];
      let multiplier = 0;

      if (isVip && rng() < SLOTS_VIP_ICE_JACKPOT_CHANCE) {
        reels = ['🧊', '🧊', '🧊'];
        multiplier = 100;
      } else {
        const r1 = pickWeightedSlotSymbol(rng());
        const r2 = pickWeightedSlotSymbol(rng());
        const r3 = pickWeightedSlotSymbol(rng());
        reels = [r1, r2, r3];

        if (r1 === r2 && r2 === r3) {
          if (r1 === '🧊') {
            multiplier = 100;
          } else if (r1 === '7️⃣') {
            multiplier = 15;
          } else if (r1 === '💎') {
            multiplier = 8;
          } else {
            multiplier = 4;
          }
        } else if (r1 === r2 || r2 === r3 || r1 === r3) {
          multiplier = 1.5;
        }
      }

      const payout = Math.floor(cleanBet * multiplier);
      const netChange = payout - cleanBet;
      const balance = profile.coins + netChange;
      this.profileRepo.save({ ...profile, coins: balance });
      this.creditLoanService?.recordGamblingResult(guildId, userId, cleanBet, netChange, nowMs);

      return { ok: true, reels, multiplier, payout, netChange, balance };
    })();
  }

  deposit(guildId: string, userId: string, amount: number): BankTransferResult {
    return this.transferBank(guildId, userId, amount, 'deposit');
  }

  withdraw(guildId: string, userId: string, amount: number): BankTransferResult {
    return this.transferBank(guildId, userId, amount, 'withdraw');
  }

  claimBankInterest(guildId: string, userId: string, nowMs = Date.now()): BankInterestResult {
    const cfg = this.configRepo.getOrCreate(guildId).economy;
    const today = getDateKey(nowMs, this.timezone);

    return this.db.transaction((): BankInterestResult => {
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.lastBankInterestDate === today) {
        return { ok: false, reason: 'already_claimed' };
      }
      if (profile.bankCoins < cfg.bankInterestMinDeposit) {
        return {
          ok: false,
          reason: 'below_minimum',
          minDeposit: cfg.bankInterestMinDeposit,
        };
      }

      let interestCap = cfg.bankInterestMax;
      if (this.creditLoanService) {
        const creditProfile = this.creditLoanService.getCreditProfile(guildId, userId, nowMs);
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

      this.profileRepo.save({
        ...profile,
        bankCoins,
        lastBankInterestDate: today,
      });

      return { ok: true, interest, bankCoins };
    })();
  }

  private transferBank(
    guildId: string,
    userId: string,
    amount: number,
    direction: 'deposit' | 'withdraw',
  ): BankTransferResult {
    const cleanAmount = Math.floor(amount);
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      return { ok: false, reason: 'invalid_amount' };
    }

    return this.db.transaction((): BankTransferResult => {
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      const sourceBalance = direction === 'deposit' ? profile.coins : profile.bankCoins;
      if (sourceBalance < cleanAmount) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const delta = direction === 'deposit' ? cleanAmount : -cleanAmount;
      const coins = profile.coins - delta;
      const bankCoins = profile.bankCoins + delta;
      this.profileRepo.save({ ...profile, coins, bankCoins });

      return { ok: true, amount: cleanAmount, coins, bankCoins };
    })();
  }
}
