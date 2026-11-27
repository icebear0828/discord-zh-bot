import type Database from 'better-sqlite3';
import type { ChaosRepo } from '../../db/repositories/chaosRepo.js';
import type { GuildConfigRepo } from '../../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../../db/repositories/profileRepo.js';
import type { CreditLoanService } from '../creditLoanService.js';

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

export interface EconomyOpsContext {
  readonly db: Database.Database;
  readonly configRepo: GuildConfigRepo;
  readonly profileRepo: ProfileRepo;
  readonly timezone: string;
  readonly chaosRepo?: ChaosRepo;
  readonly creditLoanService?: CreditLoanService;
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
