import { getCreditTier } from '../creditLoan/creditTiersAndFlavor.js';
import {
  getDateKey,
  getPreviousDateKey,
  type DailyResult,
  type EconomyOpsContext,
  type WorkResult,
} from './economyTypesAndDates.js';

const WORK_STORIES = [
  '帮管理员整理频道归档',
  '在咖啡馆兼职冲泡手冲咖啡',
  '给社区机器人修了一个小 Bug',
  '代班主持了一场语音茶话会',
  '在集市帮路人搬运补给箱',
  '撰写了一份新手入门攻略',
];

export function claimDailyOp(
  ctx: EconomyOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
): DailyResult {
  const cfg = ctx.configRepo.getOrCreate(guildId).economy;
  const today = getDateKey(nowMs, ctx.timezone);
  const yesterday = getPreviousDateKey(nowMs, ctx.timezone);

  return ctx.db.transaction((): DailyResult => {
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
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
    if (ctx.creditLoanService) {
      ctx.creditLoanService.adjustCredit(guildId, userId, 3, '每日签到信用奖励', nowMs);
      const garnishRes = ctx.creditLoanService.garnishIncomingCoins(
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

    ctx.profileRepo.save({
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
      ...(ctx.creditLoanService ? { garnished } : {}),
    };
  })();
}

export function workOp(
  ctx: EconomyOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): WorkResult {
  const cfg = ctx.configRepo.getOrCreate(guildId).economy;

  return ctx.db.transaction((): WorkResult => {
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
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
    const cursedEffect = ctx.chaosRepo?.consumeEffect(guildId, userId, 'work_cursed', nowMs);
    const cursed = Boolean(cursedEffect);
    let reward = cursed ? Math.max(1, Math.floor(baseReward * 0.5)) : baseReward;
    let creditMultiplier: number | undefined;
    let garnished = 0;
    let netReward = reward;
    if (ctx.creditLoanService) {
      const creditProfile = ctx.creditLoanService.getCreditProfile(guildId, userId, nowMs);
      creditMultiplier = getCreditTier(creditProfile.account.score).workMult;
      reward = Math.max(1, Math.round(reward * creditMultiplier));
      const garnishRes = ctx.creditLoanService.garnishIncomingCoins(
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

    ctx.profileRepo.save({
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
      ...(ctx.creditLoanService ? { garnished, creditMultiplier } : {}),
    };
  })();
}
