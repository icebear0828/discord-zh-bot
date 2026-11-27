import type { GamblingStats, HustleStats } from '../../db/repositories/creditLoanRepo.js';
import { adjustCreditOp } from './creditScoreAndReviewOps.js';
import {
  HUSTLE_EVENTS,
  clampUnit,
  pickFrom,
  type CreditLoanOpsContext,
  type HustleEventKey,
  type SellButtResult,
} from './creditTiersAndFlavor.js';
import { garnishIncomingCoinsOp } from './overdueAndGarnishOps.js';

export function sellButtOp(
  ctx: CreditLoanOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): SellButtResult {
  const cfg = ctx.getConfig(guildId);
  const ecoCfg = ctx.configRepo.getOrCreate(guildId).economy;
  const cooldownMs = cfg.hustleCooldownSec * 1000;

  return ctx.db.transaction((): SellButtResult => {
    const stats = ctx.repo.getOrCreateHustleStats(guildId, userId);
    const elapsed = nowMs - stats.lastHustleAt;
    if (stats.lastHustleAt > 0 && elapsed < cooldownMs) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterSec: Math.ceil((cooldownMs - elapsed) / 1000),
      };
    }

    const workMin = Math.max(1, Math.min(ecoCfg.workMin, ecoCfg.workMax));
    const workMax = Math.max(workMin, Math.max(ecoCfg.workMin, ecoCfg.workMax));
    const minReward = Math.max(1, Math.floor(workMin * cfg.hustleMinMultiplier));
    const maxReward = Math.max(minReward, Math.floor(workMax * cfg.hustleMaxMultiplier));
    const baseReward = minReward + Math.floor(clampUnit(rng()) * (maxReward - minReward + 1));

    const eventRoll = clampUnit(rng());
    let eventKey: HustleEventKey;
    if (eventRoll < 0.15) {
      eventKey = 'vip';
    } else if (eventRoll < 0.3) {
      eventKey = 'acquaintance';
    } else if (eventRoll < 0.85) {
      eventKey = 'normal';
    } else {
      eventKey = 'bust';
    }

    const spec = HUSTLE_EVENTS[eventKey];
    const multRoll = clampUnit(rng());
    const rawMult = spec.minMult + multRoll * (spec.maxMult - spec.minMult);
    const multiplier = Math.round(rawMult * 100) / 100;
    const story = pickFrom(spec.stories, rng());
    const grossReward = Math.max(1, Math.floor(baseReward * multiplier));

    const creditAdj = adjustCreditOp(
      ctx,
      guildId,
      userId,
      -cfg.hustleCreditPenalty,
      '下海营业信用扣分',
      nowMs,
    );

    const garnishRes = garnishIncomingCoinsOp(
      ctx,
      guildId,
      userId,
      grossReward,
      'sell_butt',
      nowMs,
    );

    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    const nextBalance = profile.coins + garnishRes.netAmount;
    ctx.profileRepo.save({ ...profile, coins: nextBalance });

    const nextStats: HustleStats = {
      guildId,
      userId,
      totalCount: stats.totalCount + 1,
      totalEarned: stats.totalEarned + grossReward,
      bestPayout: Math.max(stats.bestPayout, grossReward),
      lastHustleAt: nowMs,
    };
    ctx.repo.saveHustleStats(nextStats);

    const garnishNote =
      garnishRes.garnished > 0
        ? `（逾期强扣还债 ${garnishRes.garnished.toLocaleString()}，实到手 ${garnishRes.netAmount.toLocaleString()}）`
        : '';
    const publicAnnouncement = `🪩 【下海快报】<@${userId}> 触发「${spec.title}」：${story}！狂揽 ${grossReward.toLocaleString()} ${ecoCfg.currencyName}${garnishNote}，信用分 ${creditAdj.actualDelta}（${creditAdj.account.score}）。`;

    return {
      ok: true,
      eventKey,
      eventTitle: spec.title,
      story,
      multiplier,
      baseReward,
      grossReward,
      garnished: garnishRes.garnished,
      netReward: garnishRes.netAmount,
      clearedLoanIds: garnishRes.clearedLoanIds,
      creditDelta: creditAdj.actualDelta,
      creditScore: creditAdj.account.score,
      creditTier: creditAdj.tier,
      balance: nextBalance,
      stats: nextStats,
      publicAnnouncement,
    };
  })();
}

export function recordGamblingResultOp(
  ctx: CreditLoanOpsContext,
  guildId: string,
  userId: string,
  wager: number,
  netChange: number,
  nowMs = Date.now(),
): GamblingStats {
  return ctx.repo.recordGamblingDelta(guildId, userId, wager, netChange, nowMs);
}
