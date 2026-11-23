import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';

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
  | { ok: true; reward: number; streak: number; bonus: number; balance: number }
  | { ok: false; reason: 'already_claimed'; streak: number };

export type WorkResult =
  | { ok: true; reward: number; story: string; balance: number }
  | { ok: false; reason: 'cooldown'; retryAfterSec: number };

export type RobResult =
  | {
      ok: true;
      success: boolean;
      amount: number;
      attackerBalance: number;
      targetBalance: number;
    }
  | {
      ok: false;
      reason: 'self_target' | 'cooldown' | 'target_shielded' | 'target_too_poor';
      retryAfterSec?: number;
    };

export type TransferResult =
  | { ok: true; amount: number; fromBalance: number; toBalance: number }
  | { ok: false; reason: 'self_target' | 'invalid_amount' | 'insufficient_funds' };

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
  | { ok: false; reason: 'invalid_bet' | 'insufficient_funds' };

export type SlotsResult =
  | {
      ok: true;
      reels: [string, string, string];
      multiplier: number;
      payout: number;
      netChange: number;
      balance: number;
    }
  | { ok: false; reason: 'invalid_bet' | 'insufficient_funds' };

const WORK_STORIES = [
  '帮管理员整理频道归档',
  '在咖啡馆兼职冲泡手冲咖啡',
  '给社区机器人修了一个小 Bug',
  '代班主持了一场语音茶话会',
  '在集市帮路人搬运补给箱',
  '撰写了一份新手入门攻略',
];

const SLOT_SYMBOLS: ReadonlyArray<{ symbol: string; weight: number }> = [
  { symbol: '🍒', weight: 30 },
  { symbol: '🍋', weight: 25 },
  { symbol: '🍇', weight: 20 },
  { symbol: '🔔', weight: 13 },
  { symbol: '💎', weight: 8 },
  { symbol: '7️⃣', weight: 4 },
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
      const nextCoins = profile.coins + reward;

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
      const reward = min + Math.floor(rng() * (max - min + 1));
      const storyIndex = Math.min(
        WORK_STORIES.length - 1,
        Math.floor(rng() * WORK_STORIES.length),
      );
      const story = WORK_STORIES[storyIndex]!;
      const nextCoins = profile.coins + reward;

      this.profileRepo.save({
        ...profile,
        coins: nextCoins,
        lastWorkAt: nowMs,
      });

      return { ok: true, reward, story, balance: nextCoins };
    })();
  }

  rob(
    guildId: string,
    attackerId: string,
    targetId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): RobResult {
    if (attackerId === targetId) {
      return { ok: false, reason: 'self_target' };
    }
    const cfg = this.configRepo.getOrCreate(guildId).economy;

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

      if (target.robShieldUntil > nowMs) {
        return {
          ok: false,
          reason: 'target_shielded',
          retryAfterSec: Math.ceil((target.robShieldUntil - nowMs) / 1000),
        };
      }

      if (target.coins < 100) {
        return { ok: false, reason: 'target_too_poor' };
      }

      const succeeded = rng() < cfg.robSuccessRate;
      if (succeeded) {
        const pct = 0.15 + rng() * 0.2;
        const stolen = Math.max(15, Math.min(1000, Math.floor(target.coins * pct)));
        const actualStolen = Math.min(stolen, target.coins);
        const nextAttacker = attacker.coins + actualStolen;
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
          attackerBalance: nextAttacker,
          targetBalance: nextTarget,
        };
      }

      const rawFine = Math.max(50, Math.min(500, Math.floor(attacker.coins * 0.15)));
      const actualFine = Math.min(rawFine, attacker.coins);
      const nextAttacker = attacker.coins - actualFine;
      const nextTarget = target.coins + actualFine;

      this.profileRepo.save({
        ...attacker,
        coins: nextAttacker,
        lastRobAt: nowMs,
      });
      this.profileRepo.save({
        ...target,
        coins: nextTarget,
      });

      return {
        ok: true,
        success: false,
        amount: actualFine,
        attackerBalance: nextAttacker,
        targetBalance: nextTarget,
      };
    })();
  }

  transferCoins(
    guildId: string,
    fromId: string,
    toId: string,
    amount: number,
  ): TransferResult {
    if (fromId === toId) {
      return { ok: false, reason: 'self_target' };
    }
    const cleanAmount = Math.floor(amount);
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      return { ok: false, reason: 'invalid_amount' };
    }

    return this.db.transaction((): TransferResult => {
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
  ): DiceResult {
    const cleanBet = Math.floor(bet);
    if (!Number.isFinite(cleanBet) || cleanBet <= 0) {
      return { ok: false, reason: 'invalid_bet' };
    }

    return this.db.transaction((): DiceResult => {
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

      return { ok: true, dice, sum, isTriple, won, netChange, balance };
    })();
  }

  playSlots(
    guildId: string,
    userId: string,
    bet: number,
    rng: () => number = Math.random,
  ): SlotsResult {
    const cleanBet = Math.floor(bet);
    if (!Number.isFinite(cleanBet) || cleanBet <= 0) {
      return { ok: false, reason: 'invalid_bet' };
    }

    return this.db.transaction((): SlotsResult => {
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cleanBet) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      const r1 = pickWeightedSlotSymbol(rng());
      const r2 = pickWeightedSlotSymbol(rng());
      const r3 = pickWeightedSlotSymbol(rng());
      const reels: [string, string, string] = [r1, r2, r3];

      let multiplier = 0;
      if (r1 === r2 && r2 === r3) {
        if (r1 === '7️⃣') {
          multiplier = 15;
        } else if (r1 === '💎') {
          multiplier = 8;
        } else {
          multiplier = 4;
        }
      } else if (r1 === r2 || r2 === r3 || r1 === r3) {
        multiplier = 1.5;
      }

      const payout = Math.floor(cleanBet * multiplier);
      const netChange = payout - cleanBet;
      const balance = profile.coins + netChange;
      this.profileRepo.save({ ...profile, coins: balance });

      return { ok: true, reels, multiplier, payout, netChange, balance };
    })();
  }
}
