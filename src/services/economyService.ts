import type Database from 'better-sqlite3';
import type { ChaosRepo } from '../db/repositories/chaosRepo.js';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { CreditLoanService } from './creditLoanService.js';
import { claimDailyOp, workOp } from './economy/dailyAndWorkOps.js';
import {
  getDateKey,
  getPreviousDateKey,
  type BankInterestResult,
  type BankRobResult,
  type BankTransferResult,
  type DailyResult,
  type DiceChoice,
  type DiceResult,
  type EconomyOpsContext,
  type RobResult,
  type RobTargetHints,
  type SlotsResult,
  type TransferResult,
  type WorkResult,
} from './economy/economyTypesAndDates.js';
import {
  isRobProtectedAdmin,
  matchesSlotsVipPlayer,
  resolveRobAdminPersona,
} from './economy/robAdminPersonas.js';
import {
  claimBankInterestOp,
  robBankOp,
  robOp,
  transferBankOp,
  transferCoinsOp,
} from './economy/robPayBankOps.js';
import { SLOT_SYMBOLS, playDiceOp, playSlotsOp } from './economy/slotsAndDiceOps.js';

export {
  SLOT_SYMBOLS,
  getDateKey,
  getPreviousDateKey,
  isRobProtectedAdmin,
  matchesSlotsVipPlayer,
  resolveRobAdminPersona,
};
export type {
  BankInterestResult,
  BankRobResult,
  BankTransferResult,
  DailyResult,
  DiceChoice,
  DiceResult,
  RobResult,
  RobTargetHints,
  SlotsResult,
  TransferResult,
  WorkResult,
};

export class EconomyService {
  private readonly opsCtx: EconomyOpsContext;

  constructor(
    private readonly db: Database.Database,
    private readonly configRepo: GuildConfigRepo,
    private readonly profileRepo: ProfileRepo,
    private readonly timezone = 'Asia/Shanghai',
    private readonly chaosRepo?: ChaosRepo,
    private readonly creditLoanService?: CreditLoanService,
  ) {
    this.opsCtx = {
      db: this.db,
      configRepo: this.configRepo,
      profileRepo: this.profileRepo,
      timezone: this.timezone,
      chaosRepo: this.chaosRepo,
      creditLoanService: this.creditLoanService,
    };
  }

  claimDaily(guildId: string, userId: string, nowMs = Date.now()): DailyResult {
    return claimDailyOp(this.opsCtx, guildId, userId, nowMs);
  }

  work(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): WorkResult {
    return workOp(this.opsCtx, guildId, userId, nowMs, rng);
  }

  rob(
    guildId: string,
    attackerId: string,
    targetId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
    targetHints?: RobTargetHints,
  ): RobResult {
    return robOp(this.opsCtx, guildId, attackerId, targetId, nowMs, rng, targetHints);
  }

  robBank(
    guildId: string,
    attackerId: string,
    targetId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
    targetHints?: RobTargetHints,
  ): BankRobResult {
    return robBankOp(this.opsCtx, guildId, attackerId, targetId, nowMs, rng, targetHints);
  }

  transferCoins(
    guildId: string,
    fromId: string,
    toId: string,
    amount: number,
    nowMs = Date.now(),
  ): TransferResult {
    return transferCoinsOp(this.opsCtx, guildId, fromId, toId, amount, nowMs);
  }

  playDice(
    guildId: string,
    userId: string,
    bet: number,
    choice: DiceChoice,
    rng: () => number = Math.random,
    nowMs = Date.now(),
  ): DiceResult {
    return playDiceOp(this.opsCtx, guildId, userId, bet, choice, rng, nowMs);
  }

  playSlots(
    guildId: string,
    userId: string,
    bet: number,
    rng: () => number = Math.random,
    nowMs = Date.now(),
    playerHints?: RobTargetHints,
  ): SlotsResult {
    return playSlotsOp(this.opsCtx, guildId, userId, bet, rng, nowMs, playerHints);
  }

  deposit(guildId: string, userId: string, amount: number): BankTransferResult {
    return transferBankOp(this.opsCtx, guildId, userId, amount, 'deposit');
  }

  withdraw(guildId: string, userId: string, amount: number): BankTransferResult {
    return transferBankOp(this.opsCtx, guildId, userId, amount, 'withdraw');
  }

  claimBankInterest(guildId: string, userId: string, nowMs = Date.now()): BankInterestResult {
    return claimBankInterestOp(this.opsCtx, guildId, userId, nowMs);
  }
}
