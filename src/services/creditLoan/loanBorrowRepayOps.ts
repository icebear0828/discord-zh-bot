import type { Loan } from '../../db/repositories/creditLoanRepo.js';
import { getDateKey } from '../economy/economyTypesAndDates.js';
import { adjustCreditOp } from './creditScoreAndReviewOps.js';
import {
  BANK_MIN_SCORE,
  DAY_MS,
  clampNumber,
  getCreditTier,
  getDeadbeatStatusForUser,
  getLoanDebt,
  isLoanOverdueAt,
  type CreditLoanOpsContext,
  type RepayLoanResult,
  type TakeBankLoanResult,
  type TakeUsuryLoanResult,
} from './creditTiersAndFlavor.js';

export function computeOnTimeRepayCreditBonus(loan: Loan, nowMs: number): number {
  if (loan.loanType === 'usury') {
    return 10;
  }
  const earlyBonus = nowMs <= loan.dueAt - DAY_MS ? 5 : 0;
  const sizeBonus = Math.min(15, Math.floor(loan.principal / 20_000) * 3);
  return clampNumber(15 + earlyBonus + sizeBonus, 15, 35);
}

export function takeBankLoanOp(
  ctx: CreditLoanOpsContext,
  guildId: string,
  userId: string,
  amount: number,
  termDays: number,
  nowMs = Date.now(),
): TakeBankLoanResult {
  const cleanAmount = Math.floor(amount);
  const cleanTermDays = Math.floor(termDays);

  return ctx.db.transaction((): TakeBankLoanResult => {
    const account = ctx.repo.getOrCreateCredit(guildId, userId, nowMs);
    const tier = getCreditTier(account.score);

    if (account.score < BANK_MIN_SCORE || tier.bankLoanMax <= 0 || tier.bankMaxDays <= 0) {
      return {
        ok: false,
        reason: 'credit_too_low',
        score: account.score,
        minScore: BANK_MIN_SCORE,
      };
    }

    if (getDeadbeatStatusForUser(ctx.repo, guildId, userId, nowMs).blocked) {
      return { ok: false, reason: 'has_overdue_loan' };
    }

    const existingBankLoans = ctx.repo.listUserLoans(guildId, userId, {
      statuses: ['active', 'overdue'],
      loanType: 'bank',
    });
    if (existingBankLoans.length > 0) {
      return { ok: false, reason: 'active_bank_loan_exists' };
    }

    const cfg = ctx.getConfig(guildId);
    const maxAmount = Math.min(tier.bankLoanMax, cfg.bankLoanMaxCap);
    if (
      !Number.isFinite(cleanAmount) ||
      cleanAmount < cfg.bankLoanMin ||
      cleanAmount > maxAmount
    ) {
      return {
        ok: false,
        reason: 'invalid_amount',
        minAmount: cfg.bankLoanMin,
        maxAmount,
      };
    }

    if (
      !Number.isFinite(cleanTermDays) ||
      cleanTermDays < 1 ||
      cleanTermDays > tier.bankMaxDays
    ) {
      return {
        ok: false,
        reason: 'invalid_term',
        minDays: 1,
        maxDays: tier.bankMaxDays,
      };
    }

    const dateKey = getDateKey(nowMs, ctx.timezone);
    const loan = ctx.repo.createLoan({
      guildId,
      userId,
      loanType: 'bank',
      principal: cleanAmount,
      dailyRate: tier.bankDailyRate,
      termDays: cleanTermDays,
      createdAt: nowMs,
      dueAt: nowMs + cleanTermDays * DAY_MS,
      lastAccrualDate: dateKey,
    });

    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    const nextBalance = profile.coins + cleanAmount;
    ctx.profileRepo.save({ ...profile, coins: nextBalance });

    return {
      ok: true,
      loan,
      balance: nextBalance,
      tier,
    };
  })();
}

export function takeUsuryLoanOp(
  ctx: CreditLoanOpsContext,
  guildId: string,
  userId: string,
  amount: number,
  nowMs = Date.now(),
): TakeUsuryLoanResult {
  const cleanAmount = Math.floor(amount);

  return ctx.db.transaction((): TakeUsuryLoanResult => {
    const existingUsury = ctx.repo.listUserLoans(guildId, userId, {
      statuses: ['active', 'overdue'],
      loanType: 'usury',
    });
    if (existingUsury.length > 0) {
      return { ok: false, reason: 'active_usury_loan_exists' };
    }

    const cfg = ctx.getConfig(guildId);
    if (
      !Number.isFinite(cleanAmount) ||
      cleanAmount < cfg.usuryLoanMin ||
      cleanAmount > cfg.usuryLoanMax
    ) {
      return {
        ok: false,
        reason: 'invalid_amount',
        minAmount: cfg.usuryLoanMin,
        maxAmount: cfg.usuryLoanMax,
      };
    }

    ctx.repo.getOrCreateCredit(guildId, userId, nowMs);
    const dateKey = getDateKey(nowMs, ctx.timezone);
    const loan = ctx.repo.createLoan({
      guildId,
      userId,
      loanType: 'usury',
      principal: cleanAmount,
      dailyRate: cfg.usuryDailyRate,
      termDays: cfg.usuryTermDays,
      createdAt: nowMs,
      dueAt: nowMs + cfg.usuryTermDays * DAY_MS,
      lastAccrualDate: dateKey,
    });

    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    const nextBalance = profile.coins + cleanAmount;
    ctx.profileRepo.save({ ...profile, coins: nextBalance });

    return {
      ok: true,
      loan,
      balance: nextBalance,
    };
  })();
}

export function repayLoanOp(
  ctx: CreditLoanOpsContext,
  guildId: string,
  userId: string,
  loanId: number,
  amount: number,
  nowMs = Date.now(),
  options?: { useBank?: boolean },
): RepayLoanResult {
  const cleanAmount = Math.floor(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }

  const useBank = Boolean(options?.useBank);

  return ctx.db.transaction((): RepayLoanResult => {
    const loan = ctx.repo.getLoanById(loanId);
    if (!loan || loan.guildId !== guildId || loan.userId !== userId) {
      return { ok: false, reason: 'loan_not_found' };
    }

    if (loan.status === 'repaid') {
      return { ok: false, reason: 'already_repaid' };
    }

    const totalOwed = getLoanDebt(loan);
    const paidAmount = Math.min(cleanAmount, totalOwed);

    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    const available = useBank ? profile.coins + profile.bankCoins : profile.coins;
    if (available < paidAmount) {
      return {
        ok: false,
        reason: 'insufficient_funds',
        required: paidAmount,
        available,
      };
    }

    const paidFromPocket = Math.min(profile.coins, paidAmount);
    const paidFromBank = paidAmount - paidFromPocket;
    const nextCoins = profile.coins - paidFromPocket;
    const nextBankCoins = profile.bankCoins - paidFromBank;
    ctx.profileRepo.save({
      ...profile,
      coins: nextCoins,
      bankCoins: nextBankCoins,
    });

    const wasOverdue = isLoanOverdueAt(loan, nowMs);
    const interestPaid = Math.min(loan.accruedInterest, paidAmount);
    const principalPaid = paidAmount - interestPaid;
    const nextAccruedInterest = loan.accruedInterest - interestPaid;
    const nextRemainingPrincipal = loan.remainingPrincipal - principalPaid;
    const nextTotalRepaid = loan.totalRepaid + paidAmount;
    const fullyRepaid = nextAccruedInterest === 0 && nextRemainingPrincipal === 0;

    const updatedLoan: Loan = {
      ...loan,
      remainingPrincipal: nextRemainingPrincipal,
      accruedInterest: nextAccruedInterest,
      totalRepaid: nextTotalRepaid,
      status: fullyRepaid ? 'repaid' : loan.status,
      repaidAt: fullyRepaid ? nowMs : loan.repaidAt,
    };
    ctx.repo.updateLoan(updatedLoan);

    let creditDelta = 0;
    let creditScore = ctx.repo.getOrCreateCredit(guildId, userId, nowMs).score;
    let deadbeatCleared = false;

    if (fullyRepaid) {
      if (!wasOverdue) {
        const reward = computeOnTimeRepayCreditBonus(loan, nowMs);
        const reason =
          loan.loanType === 'bank' ? '银行贷款按期结清奖励' : '黑市高利贷按期结清奖励';
        const adjusted = adjustCreditOp(ctx, guildId, userId, reward, reason, nowMs);
        creditDelta = adjusted.actualDelta;
        creditScore = adjusted.account.score;
      } else {
        deadbeatCleared = !getDeadbeatStatusForUser(ctx.repo, guildId, userId, nowMs).blocked;
      }
    }

    return {
      ok: true,
      loan: updatedLoan,
      paidAmount,
      interestPaid,
      principalPaid,
      paidFromPocket,
      paidFromBank,
      remainingDebt: nextRemainingPrincipal + nextAccruedInterest,
      fullyRepaid,
      creditDelta,
      creditScore,
      deadbeatCleared,
      coins: nextCoins,
      bankCoins: nextBankCoins,
    };
  })();
}
