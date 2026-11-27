import type { CreditReviewKind } from '../../db/repositories/creditLoanRepo.js';
import { getDateKey } from '../economy/economyTypesAndDates.js';
import {
  CREDIT_SCORE_MAX,
  CREDIT_SCORE_MIN,
  ENDORSE_BASE_DELTA,
  REPORT_NORMAL_DELTA,
  REPORT_OVERDUE_DELTA,
  clampNumber,
  getCreditTier,
  getDeadbeatStatusForUser,
  getLoanDebt,
  isLoanOverdueAt,
  type AdjustCreditResult,
  type CreditLoanOpsContext,
  type CreditProfileSummary,
  type ReviewResult,
} from './creditTiersAndFlavor.js';

export function getCreditProfileOp(
  ctx: CreditLoanOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): CreditProfileSummary {
  const account = ctx.repo.getOrCreateCredit(guildId, userId, nowMs);
  const tier = getCreditTier(account.score);
  const openLoans = ctx.repo.listUserLoans(guildId, userId, {
    statuses: ['active', 'overdue'],
  });
  const overdueLoans = openLoans.filter((loan) => isLoanOverdueAt(loan, nowMs));
  const totalDebt = openLoans.reduce((sum, loan) => sum + getLoanDebt(loan), 0);
  const totalOverdueDebt = overdueLoans.reduce((sum, loan) => sum + getLoanDebt(loan), 0);

  return {
    account,
    tier,
    openLoans,
    overdueLoans,
    totalDebt,
    totalOverdueDebt,
  };
}

export function adjustCreditOp(
  ctx: CreditLoanOpsContext,
  guildId: string,
  userId: string,
  delta: number,
  reason: string,
  nowMs = Date.now(),
): AdjustCreditResult {
  const requestedDelta = Math.trunc(delta);
  return ctx.db.transaction((): AdjustCreditResult => {
    const current = ctx.repo.getOrCreateCredit(guildId, userId, nowMs);
    const nextScore = clampNumber(
      current.score + requestedDelta,
      CREDIT_SCORE_MIN,
      CREDIT_SCORE_MAX,
    );
    const actualDelta = nextScore - current.score;
    const account = ctx.repo.setCreditScore(guildId, userId, nextScore, nowMs);
    const log = ctx.repo.addCreditLog({
      guildId,
      userId,
      delta: actualDelta,
      scoreAfter: nextScore,
      reason,
      createdAt: nowMs,
    });

    return {
      account,
      tier: getCreditTier(nextScore),
      requestedDelta,
      actualDelta,
      log,
    };
  })();
}

export function submitReviewOp(
  ctx: CreditLoanOpsContext,
  guildId: string,
  reviewerId: string,
  targetId: string,
  kind: CreditReviewKind,
  nowMs: number,
): ReviewResult {
  if (reviewerId === targetId) {
    return { ok: false, reason: 'self_target' };
  }

  const cfg = ctx.getConfig(guildId);
  const dateKey = getDateKey(nowMs, ctx.timezone);
  const cooldownMs = cfg.reviewTargetCooldownSec * 1000;
  const cap = cfg.reviewTargetDailyCap;

  return ctx.db.transaction((): ReviewResult => {
    const usedToday = ctx.repo.countReviewsByReviewerOnDate(guildId, reviewerId, dateKey);
    if (usedToday >= cfg.dailyReviewLimit) {
      return {
        ok: false,
        reason: 'daily_limit_reached',
        dailyLimit: cfg.dailyReviewLimit,
      };
    }

    if (ctx.repo.hasReviewedTargetRecently(guildId, reviewerId, targetId, nowMs - cooldownMs)) {
      const latest = ctx.repo.getLatestReviewForTarget(guildId, reviewerId, targetId);
      const remainingMs = latest ? Math.max(1000, latest.createdAt + cooldownMs - nowMs) : cooldownMs;
      return {
        ok: false,
        reason: 'target_cooldown',
        retryAfterSec: Math.ceil(remainingMs / 1000),
      };
    }

    const targetOverdue = getDeadbeatStatusForUser(ctx.repo, guildId, targetId, nowMs).blocked;
    const baseDelta =
      kind === 'endorse'
        ? ENDORSE_BASE_DELTA
        : targetOverdue
          ? REPORT_OVERDUE_DELTA
          : REPORT_NORMAL_DELTA;

    const currentTargetSum = ctx.repo.sumTargetDeltaOnDate(guildId, targetId, dateKey);
    let effectiveDelta: number;
    if (baseDelta > 0) {
      const remainingPositive = cap - currentTargetSum;
      if (remainingPositive <= 0) {
        return { ok: false, reason: 'target_daily_cap' };
      }
      effectiveDelta = Math.min(baseDelta, remainingPositive);
    } else {
      const remainingNegative = cap + currentTargetSum;
      if (remainingNegative <= 0) {
        return { ok: false, reason: 'target_daily_cap' };
      }
      effectiveDelta = -Math.min(Math.abs(baseDelta), remainingNegative);
    }

    ctx.repo.insertReview({
      guildId,
      reviewerId,
      targetId,
      kind,
      delta: effectiveDelta,
      dateKey,
      createdAt: nowMs,
    });

    const reason =
      kind === 'endorse'
        ? `群友信用背书 (${reviewerId})`
        : targetOverdue
          ? `逾期老赖加重举报 (${reviewerId})`
          : `群友失信举报 (${reviewerId})`;

    const adjusted = adjustCreditOp(ctx, guildId, targetId, effectiveDelta, reason, nowMs);

    return {
      ok: true,
      kind,
      delta: effectiveDelta,
      targetScore: adjusted.account.score,
      targetTier: adjusted.tier,
      remainingReviewsToday: Math.max(0, cfg.dailyReviewLimit - (usedToday + 1)),
      targetIsOverdue: targetOverdue,
    };
  })();
}
