import type { Loan } from '../../db/repositories/creditLoanRepo.js';
import { getDateKey } from '../economy/economyTypesAndDates.js';
import { adjustCreditOp } from './creditScoreAndReviewOps.js';
import {
  BANK_OVERDUE_CAP_MULT,
  BANK_OVERDUE_CREDIT_DROP,
  BANK_OVERDUE_PENALTY_RATE,
  USURY_BOUNTY_MAX,
  USURY_BOUNTY_MIN,
  USURY_BOUNTY_RATE,
  USURY_OVERDUE_CAP_MULT,
  USURY_OVERDUE_CREDIT_DROP,
  USURY_OVERDUE_PENALTY_RATE,
  clampNumber,
  getDeadbeatStatusForUser,
  getLoanDebt,
  type CreditLoanOpsContext,
  type DeadbeatStatus,
  type GarnishResult,
  type OverdueNotice,
} from './creditTiersAndFlavor.js';

export function isDeadbeatBlockedOp(
  ctx: CreditLoanOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): DeadbeatStatus {
  return getDeadbeatStatusForUser(ctx.repo, guildId, userId, nowMs);
}

export function garnishIncomingCoinsOp(
  ctx: CreditLoanOpsContext,
  guildId: string,
  userId: string,
  grossAmount: number,
  _source: string,
  nowMs = Date.now(),
): GarnishResult {
  const cleanGross = Math.max(0, Math.floor(grossAmount));
  if (cleanGross <= 0) {
    return {
      grossAmount: cleanGross,
      garnished: 0,
      netAmount: 0,
      clearedLoanIds: [],
    };
  }

  return ctx.db.transaction((): GarnishResult => {
    const status = getDeadbeatStatusForUser(ctx.repo, guildId, userId, nowMs);
    if (!status.blocked || status.totalOverdueDebt <= 0) {
      return {
        grossAmount: cleanGross,
        garnished: 0,
        netAmount: cleanGross,
        clearedLoanIds: [],
      };
    }

    const cfg = ctx.getConfig(guildId);
    const targetGarnish = Math.min(
      status.totalOverdueDebt,
      Math.floor(cleanGross * cfg.garnishRate),
    );
    if (targetGarnish <= 0) {
      return {
        grossAmount: cleanGross,
        garnished: 0,
        netAmount: cleanGross,
        clearedLoanIds: [],
      };
    }

    let remainingToApply = targetGarnish;
    const clearedLoanIds: number[] = [];

    for (const loan of status.overdueLoans) {
      if (remainingToApply <= 0) break;
      const loanDebt = getLoanDebt(loan);
      if (loanDebt <= 0) continue;

      const applied = Math.min(loanDebt, remainingToApply);
      const interestPaid = Math.min(loan.accruedInterest, applied);
      const principalPaid = applied - interestPaid;
      const nextAccruedInterest = loan.accruedInterest - interestPaid;
      const nextRemainingPrincipal = loan.remainingPrincipal - principalPaid;
      const cleared = nextAccruedInterest === 0 && nextRemainingPrincipal === 0;

      ctx.repo.updateLoan({
        ...loan,
        remainingPrincipal: nextRemainingPrincipal,
        accruedInterest: nextAccruedInterest,
        totalRepaid: loan.totalRepaid + applied,
        status: cleared ? 'repaid' : loan.status,
        repaidAt: cleared ? nowMs : loan.repaidAt,
      });

      if (cleared) {
        clearedLoanIds.push(loan.id);
      }
      remainingToApply -= applied;
    }

    const actualGarnished = targetGarnish - remainingToApply;
    return {
      grossAmount: cleanGross,
      garnished: actualGarnished,
      netAmount: cleanGross - actualGarnished,
      clearedLoanIds,
    };
  })();
}

export function processOverdueLoansOp(
  ctx: CreditLoanOpsContext,
  nowMs = Date.now(),
): OverdueNotice[] {
  const dateKey = getDateKey(nowMs, ctx.timezone);
  const openLoans = ctx.repo.listOpenLoans();
  const notices: OverdueNotice[] = [];

  for (const snapshot of openLoans) {
    const notice = ctx.db.transaction((): OverdueNotice | null => {
      const loan = ctx.repo.getLoanById(snapshot.id);
      if (!loan || loan.status === 'repaid') {
        return null;
      }

      const capMult =
        loan.loanType === 'bank' ? BANK_OVERDUE_CAP_MULT : USURY_OVERDUE_CAP_MULT;
      const maxTotalOwed = Math.floor(loan.principal * capMult);

      if (loan.status === 'active' && nowMs <= loan.dueAt) {
        if (loan.lastAccrualDate !== dateKey && loan.dailyRate > 0) {
          const currentOwed = getLoanDebt(loan);
          const headroom = Math.max(0, maxTotalOwed - currentOwed);
          const baseAmount = loan.remainingPrincipal > 0 ? loan.remainingPrincipal : currentOwed;
          const rawInterest = Math.max(1, Math.floor(baseAmount * loan.dailyRate));
          const interestAdded = Math.min(rawInterest, headroom);

          ctx.repo.updateLoan({
            ...loan,
            accruedInterest: loan.accruedInterest + interestAdded,
            lastAccrualDate: dateKey,
          });
        }
        return null;
      }

      const workingLoan: Loan = {
        ...loan,
        status: 'overdue',
      };

      if (workingLoan.lastNoticeDate === dateKey) {
        if (loan.status !== 'overdue') {
          ctx.repo.updateLoan(workingLoan);
        }
        return null;
      }

      const penaltyRate =
        workingLoan.loanType === 'bank'
          ? BANK_OVERDUE_PENALTY_RATE
          : USURY_OVERDUE_PENALTY_RATE;
      const creditDrop =
        workingLoan.loanType === 'bank' ? BANK_OVERDUE_CREDIT_DROP : USURY_OVERDUE_CREDIT_DROP;

      const currentOwed = getLoanDebt(workingLoan);
      const headroom = Math.max(0, maxTotalOwed - currentOwed);
      const baseForPenalty =
        workingLoan.remainingPrincipal > 0 ? workingLoan.remainingPrincipal : currentOwed;
      const rawPenalty = Math.max(1, Math.floor(baseForPenalty * penaltyRate));
      const penaltyAdded = Math.min(rawPenalty, headroom);
      workingLoan.accruedInterest += penaltyAdded;

      const creditReason =
        workingLoan.loanType === 'bank'
          ? `银行贷款 #${workingLoan.id} 逾期违约`
          : `黑市高利贷 #${workingLoan.id} 逾期违约`;
      const adjusted = adjustCreditOp(
        ctx,
        workingLoan.guildId,
        workingLoan.userId,
        creditDrop,
        creditReason,
        nowMs,
      );

      const profile = ctx.profileRepo.getOrCreate(workingLoan.guildId, workingLoan.userId);
      const debtBeforeSeize = getLoanDebt(workingLoan);
      const seizedFromPocket = Math.min(profile.coins, debtBeforeSeize);
      const seizedFromBank = Math.min(profile.bankCoins, debtBeforeSeize - seizedFromPocket);
      const totalSeized = seizedFromPocket + seizedFromBank;

      if (totalSeized > 0) {
        ctx.profileRepo.save({
          ...profile,
          coins: profile.coins - seizedFromPocket,
          bankCoins: profile.bankCoins - seizedFromBank,
        });

        const interestPaid = Math.min(workingLoan.accruedInterest, totalSeized);
        const principalPaid = totalSeized - interestPaid;
        workingLoan.accruedInterest -= interestPaid;
        workingLoan.remainingPrincipal -= principalPaid;
        workingLoan.totalRepaid += totalSeized;
      }

      const remainingDebt = getLoanDebt(workingLoan);
      const clearedBySeize = remainingDebt === 0;
      if (clearedBySeize) {
        workingLoan.status = 'repaid';
        workingLoan.repaidAt = nowMs;
      }

      let bountyPostedNow = false;
      let bountyAmount = 0;
      if (
        workingLoan.loanType === 'usury' &&
        !workingLoan.bountyPosted &&
        workingLoan.status === 'overdue' &&
        ctx.chaosRepo
      ) {
        bountyAmount = clampNumber(
          Math.floor(workingLoan.principal * USURY_BOUNTY_RATE),
          USURY_BOUNTY_MIN,
          USURY_BOUNTY_MAX,
        );
        ctx.chaosRepo.createBounty({
          guildId: workingLoan.guildId,
          targetId: workingLoan.userId,
          placerId: 'SYSTEM_USURY',
          amount: bountyAmount,
          createdAt: nowMs,
        });
        workingLoan.bountyPosted = true;
        bountyPostedNow = true;
      }

      workingLoan.lastAccrualDate = dateKey;
      workingLoan.lastNoticeDate = dateKey;
      ctx.repo.updateLoan(workingLoan);

      const loanLabel = workingLoan.loanType === 'bank' ? '🏦 银行贷款' : '🩸 黑市高利贷';
      const parts: string[] = [
        `📢 【逾期催收公告】<@${workingLoan.userId}> 的${loanLabel} #${workingLoan.id} 已逾期！`,
        `新增罚息 +${penaltyAdded.toLocaleString()}，信用分 ${adjusted.actualDelta}（当前 ${adjusted.account.score}）`,
      ];
      if (totalSeized > 0) {
        parts.push(
          `强制划扣 ${totalSeized.toLocaleString()}（口袋 ${seizedFromPocket.toLocaleString()} / 银行 ${seizedFromBank.toLocaleString()}）`,
        );
      }
      if (clearedBySeize) {
        parts.push('本次强扣已将欠款全部结清');
      } else {
        parts.push(`剩余欠款 ${remainingDebt.toLocaleString()}`);
      }
      if (bountyPostedNow) {
        parts.push(
          `黑市高利贷逾期自动通缉已发布，悬赏金 ${bountyAmount.toLocaleString()}！`,
        );
      }

      return {
        guildId: workingLoan.guildId,
        userId: workingLoan.userId,
        loanId: workingLoan.id,
        loanType: workingLoan.loanType,
        dateKey,
        principal: workingLoan.principal,
        penaltyAdded,
        seizedFromPocket,
        seizedFromBank,
        totalSeized,
        remainingDebt,
        clearedBySeize,
        creditDelta: adjusted.actualDelta,
        creditScore: adjusted.account.score,
        bountyPostedNow,
        bountyAmount,
        message: parts.join('；'),
      };
    })();

    if (notice) {
      notices.push(notice);
    }
  }

  return notices;
}
