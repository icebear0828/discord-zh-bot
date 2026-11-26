import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { InviteRepo } from '../db/repositories/inviteRepo.js';
import type { MemberProfile, ProfileRepo } from '../db/repositories/profileRepo.js';
import type { CreditLoanService } from './creditLoanService.js';
import type { RpgService } from './rpgService.js';

export type XpSkipReason =
  | 'module_disabled'
  | 'ignored_channel'
  | 'cooldown'
  | 'voice_disabled'
  | 'hourly_cap';

export interface AwardXpResult {
  awarded: boolean;
  reason?: XpSkipReason;
  xpGained: number;
  totalXp: number;
  heatStreak: number;
  heatMultiplier: number;
  boostMultiplier: number;
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  coinsAwarded: number;
  statGained: number;
  statValue: number;
  rolesToAdd: string[];
  rolesToRemove: string[];
}

export interface LevelProgress {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressRatio: number;
}

export interface RankCardData {
  profile: MemberProfile;
  progress: LevelProgress;
  rank: number;
  totalMembers: number;
  heatMultiplier: number;
  activeBoostMultiplier: number;
  boostExpiresAt: number;
}

export type LeaderboardType =
  | 'xp'
  | 'coins'
  | 'invites'
  | 'stat'
  | 'credit'
  | 'deadbeat'
  | 'hustle'
  | 'gambling_profit'
  | 'gambling_loss'
  | 'rpg';

export interface LeaderboardEntry {
  userId: string;
  primaryValue: number;
  secondaryValue: number;
  equippedTitle: string | null;
  totalWon?: number;
  totalLost?: number;
}

export interface LeaderboardPage {
  type: LeaderboardType;
  page: number;
  totalPages: number;
  totalItems: number;
  items: LeaderboardEntry[];
}

export interface LevelUpTemplateVars {
  user: string;
  username: string;
  level: number;
  oldLevel: number;
  coins: number;
  currency: string;
  roles: string;
  stat: number;
  statGained: number;
  statUnit: string;
}

export function renderLevelUpTemplate(template: string, vars: LevelUpTemplateVars): string {
  const tokenMap: Record<string, string> = {
    '{user}': vars.user,
    '{username}': vars.username,
    '{level}': String(vars.level),
    '{oldLevel}': String(vars.oldLevel),
    '{coins}': String(vars.coins),
    '{currency}': vars.currency,
    '{roles}': vars.roles,
    '{stat}': String(vars.stat),
    '{statGained}': String(vars.statGained),
    '{statUnit}': vars.statUnit,
  };

  return template.replace(
    /\{(user|username|level|oldLevel|coins|currency|roles|stat|statGained|statUnit)\}/g,
    (match) => tokenMap[match] ?? match,
  );
}

export const CARD_COLOR_PRESETS: Readonly<Record<string, string>> = {
  红: '#ED4245',
  红色: '#ED4245',
  橙: '#E67E22',
  橙色: '#E67E22',
  黄: '#FEE75C',
  黄色: '#FEE75C',
  绿: '#57F287',
  绿色: '#57F287',
  青: '#1ABC9C',
  青色: '#1ABC9C',
  蓝: '#5865F2',
  蓝色: '#5865F2',
  紫: '#9B59B6',
  紫色: '#9B59B6',
  粉: '#EB459E',
  粉色: '#EB459E',
  金: '#F1C40F',
  金色: '#F1C40F',
  黑: '#23272A',
  黑色: '#23272A',
  白: '#FFFFFF',
  白色: '#FFFFFF',
};

export function parseCardColor(
  raw: string | null | undefined,
): { ok: true; normalized: string | null; colorInt: number | null } | { ok: false } {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) {
    return { ok: true, normalized: null, colorInt: null };
  }

  const preset = CARD_COLOR_PRESETS[trimmed];
  const hexCandidate = preset ?? (trimmed.startsWith('#') ? trimmed : `#${trimmed}`);
  if (!/^#[0-9a-fA-F]{6}$/.test(hexCandidate)) {
    return { ok: false };
  }

  const normalized = hexCandidate.toUpperCase();
  const colorInt = Number.parseInt(normalized.slice(1), 16);
  return { ok: true, normalized, colorInt };
}

export function xpRequiredForLevel(level: number): number {
  const safeLevel = Math.max(0, Math.floor(level));
  return 40 + safeLevel * 20 + safeLevel * safeLevel * 10 + safeLevel * safeLevel * safeLevel * 2;
}

export function totalXpForLevel(targetLevel: number): number {
  const safeTarget = Math.max(0, Math.floor(targetLevel));
  let total = 0;
  for (let i = 0; i < safeTarget; i++) {
    total += xpRequiredForLevel(i);
  }
  return total;
}

export function calculateLevelProgress(totalXp: number): LevelProgress {
  let remaining = Math.max(0, Math.floor(totalXp));
  let level = 0;

  while (remaining >= xpRequiredForLevel(level)) {
    remaining -= xpRequiredForLevel(level);
    level += 1;
  }

  const nextLevelXp = xpRequiredForLevel(level);
  const progressRatio = nextLevelXp > 0 ? Math.min(1, remaining / nextLevelXp) : 0;

  return {
    level,
    currentLevelXp: remaining,
    nextLevelXp,
    progressRatio,
  };
}

export function getHeatMultiplier(heatStreak: number, maxMultiplier: number): number {
  const safeMax = Math.max(1.0, maxMultiplier);
  const steps = Math.floor(Math.max(0, heatStreak) / 2);
  const raw = 1.0 + steps * 0.25;
  return Number(Math.min(raw, safeMax).toFixed(2));
}

const HOUR_MS = 3_600_000;

export class LevelingService {
  constructor(
    private readonly configRepo: GuildConfigRepo,
    private readonly profileRepo: ProfileRepo,
    private readonly inviteRepo: InviteRepo,
    private readonly creditLoanService?: CreditLoanService,
    private readonly rpgService?: RpgService,
  ) {}

  awardMessageXp(
    guildId: string,
    userId: string,
    channelId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): AwardXpResult {
    const cfg = this.configRepo.getOrCreate(guildId);
    const profile = this.profileRepo.getOrCreate(guildId, userId);

    if (!cfg.modules.leveling) {
      return this.skippedResult(profile, 'module_disabled', nowMs, cfg.leveling.heatMaxMultiplier);
    }
    if (cfg.leveling.ignoredChannelIds.includes(channelId)) {
      return this.skippedResult(profile, 'ignored_channel', nowMs, cfg.leveling.heatMaxMultiplier);
    }
    if (
      cfg.leveling.allowedChannelIds.length > 0 &&
      !cfg.leveling.allowedChannelIds.includes(channelId)
    ) {
      return this.skippedResult(profile, 'ignored_channel', nowMs, cfg.leveling.heatMaxMultiplier);
    }

    const cooldownMs = cfg.leveling.cooldownSec * 1000;
    if (profile.lastXpAt > 0 && nowMs - profile.lastXpAt < cooldownMs) {
      return this.skippedResult(profile, 'cooldown', nowMs, cfg.leveling.heatMaxMultiplier);
    }

    const heatWindowMs = cfg.leveling.heatWindowSec * 1000;
    const withinHeatWindow = profile.lastXpAt > 0 && nowMs - profile.lastXpAt <= heatWindowMs;
    const nextHeatStreak = withinHeatWindow ? profile.heatStreak + 1 : 1;
    const heatMultiplier = getHeatMultiplier(nextHeatStreak, cfg.leveling.heatMaxMultiplier);

    const minXp = Math.min(cfg.leveling.baseMinXp, cfg.leveling.baseMaxXp);
    const maxXp = Math.max(cfg.leveling.baseMinXp, cfg.leveling.baseMaxXp);
    const baseXp = minXp + Math.floor(rng() * (maxXp - minXp + 1));

    const channelMult = cfg.leveling.channelMultipliers[channelId] ?? 1.0;
    const boostMult = this.getActiveBoost(profile, nowMs);
    const rawXp = Math.max(1, Math.round(baseXp * heatMultiplier * channelMult * boostMult));

    const hourState = this.computeHourlyGrant(profile, rawXp, cfg.leveling.hourlyXpCap, nowMs);
    if (hourState.granted <= 0) {
      return this.skippedResult(profile, 'hourly_cap', nowMs, cfg.leveling.heatMaxMultiplier);
    }

    return this.applyXpGrant(
      guildId,
      profile,
      hourState.granted,
      {
        messageIncrement: 1,
        voiceMinutesIncrement: 0,
        nextHeatStreak,
        lastXpAt: nowMs,
        hourWindowStart: hourState.windowStart,
        hourXpEarned: hourState.hourXpEarned,
        heatMultiplier,
        boostMultiplier: boostMult,
      },
      cfg.leveling.levelUpCoinReward,
      cfg.leveling.stackRoles,
      {
        statEnabled: cfg.leveling.statEnabled,
        statMinGain: cfg.leveling.statMinGain,
        statMaxGain: cfg.leveling.statMaxGain,
      },
      rng,
    );
  }

  awardVoiceXp(guildId: string, userId: string, nowMs = Date.now()): AwardXpResult {
    const cfg = this.configRepo.getOrCreate(guildId);
    const profile = this.profileRepo.getOrCreate(guildId, userId);

    if (!cfg.modules.leveling) {
      return this.skippedResult(profile, 'module_disabled', nowMs, cfg.leveling.heatMaxMultiplier);
    }
    if (!cfg.leveling.voiceEnabled || cfg.leveling.voiceXpPerMin <= 0) {
      return this.skippedResult(profile, 'voice_disabled', nowMs, cfg.leveling.heatMaxMultiplier);
    }

    const boostMult = this.getActiveBoost(profile, nowMs);
    const rawXp = Math.max(1, Math.round(cfg.leveling.voiceXpPerMin * boostMult));
    const hourState = this.computeHourlyGrant(profile, rawXp, cfg.leveling.hourlyXpCap, nowMs);
    if (hourState.granted <= 0) {
      return this.skippedResult(profile, 'hourly_cap', nowMs, cfg.leveling.heatMaxMultiplier);
    }

    return this.applyXpGrant(
      guildId,
      profile,
      hourState.granted,
      {
        messageIncrement: 0,
        voiceMinutesIncrement: 1,
        nextHeatStreak: profile.heatStreak,
        lastXpAt: profile.lastXpAt,
        hourWindowStart: hourState.windowStart,
        hourXpEarned: hourState.hourXpEarned,
        heatMultiplier: 1.0,
        boostMultiplier: boostMult,
      },
      cfg.leveling.levelUpCoinReward,
      cfg.leveling.stackRoles,
      {
        statEnabled: cfg.leveling.statEnabled,
        statMinGain: cfg.leveling.statMinGain,
        statMaxGain: cfg.leveling.statMaxGain,
      },
    );
  }

  setUserXp(guildId: string, userId: string, targetXp: number): AwardXpResult {
    const cfg = this.configRepo.getOrCreate(guildId);
    const profile = this.profileRepo.getOrCreate(guildId, userId);
    const clampedXp = Math.max(0, Math.floor(targetXp));
    const oldLevel = profile.level;
    const progress = calculateLevelProgress(clampedXp);
    const newLevel = progress.level;

    this.profileRepo.save({
      ...profile,
      xp: clampedXp,
      level: newLevel,
      levelOffset: 0,
    });

    const roleChanges = this.computeRoleRewards(guildId, oldLevel, newLevel, cfg.leveling.stackRoles);
    return {
      awarded: true,
      xpGained: clampedXp - profile.xp,
      totalXp: clampedXp,
      heatStreak: profile.heatStreak,
      heatMultiplier: 1.0,
      boostMultiplier: 1.0,
      leveledUp: newLevel > oldLevel,
      oldLevel,
      newLevel,
      coinsAwarded: 0,
      statGained: 0,
      statValue: profile.statValue,
      rolesToAdd: roleChanges.rolesToAdd,
      rolesToRemove: roleChanges.rolesToRemove,
    };
  }

  getRankCardData(guildId: string, userId: string, nowMs = Date.now()): RankCardData {
    const cfg = this.configRepo.getOrCreate(guildId);
    const profile = this.profileRepo.getOrCreate(guildId, userId);
    const rawProgress = calculateLevelProgress(profile.xp);
    const progress: LevelProgress = {
      ...rawProgress,
      level: Math.max(0, rawProgress.level + profile.levelOffset),
    };
    const { rank, total } = this.profileRepo.getXpRank(guildId, userId);
    const heatWindowMs = cfg.leveling.heatWindowSec * 1000;
    const heatActive = profile.lastXpAt > 0 && nowMs - profile.lastXpAt <= heatWindowMs;
    const heatMultiplier = heatActive
      ? getHeatMultiplier(profile.heatStreak, cfg.leveling.heatMaxMultiplier)
      : 1.0;

    return {
      profile,
      progress,
      rank,
      totalMembers: total,
      heatMultiplier,
      activeBoostMultiplier: this.getActiveBoost(profile, nowMs),
      boostExpiresAt: profile.xpBoostExpiresAt > nowMs ? profile.xpBoostExpiresAt : 0,
    };
  }

  getLeaderboard(
    guildId: string,
    type: LeaderboardType,
    page = 1,
    pageSize = 10,
  ): LeaderboardPage {
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * pageSize;

    if (type === 'invites') {
      const res = this.inviteRepo.listLeaderboard(guildId, pageSize, offset);
      const totalPages = Math.max(1, Math.ceil(res.total / pageSize));
      return {
        type,
        page: Math.min(safePage, totalPages),
        totalPages,
        totalItems: res.total,
        items: res.items.map((row) => ({
          userId: row.inviterId,
          primaryValue: row.inviteCount,
          secondaryValue: 0,
          equippedTitle: null,
        })),
      };
    }

    if (type === 'credit') {
      const res = this.creditLoanService?.getCreditLeaderboard(guildId, pageSize, offset) ?? {
        items: [],
        total: 0,
      };
      const totalPages = Math.max(1, Math.ceil(res.total / pageSize));
      return {
        type,
        page: Math.min(safePage, totalPages),
        totalPages,
        totalItems: res.total,
        items: res.items.map((row) => ({
          userId: row.userId,
          primaryValue: row.score,
          secondaryValue: 0,
          equippedTitle: null,
        })),
      };
    }

    if (type === 'deadbeat') {
      const res = this.creditLoanService?.getDeadbeatLeaderboard(guildId, pageSize, offset) ?? {
        items: [],
        total: 0,
      };
      const totalPages = Math.max(1, Math.ceil(res.total / pageSize));
      return {
        type,
        page: Math.min(safePage, totalPages),
        totalPages,
        totalItems: res.total,
        items: res.items.map((row) => ({
          userId: row.userId,
          primaryValue: row.totalOverdueDebt,
          secondaryValue: row.score,
          equippedTitle: null,
        })),
      };
    }

    if (type === 'hustle') {
      const res = this.creditLoanService?.getHustleLeaderboard(guildId, pageSize, offset) ?? {
        items: [],
        total: 0,
      };
      const totalPages = Math.max(1, Math.ceil(res.total / pageSize));
      return {
        type,
        page: Math.min(safePage, totalPages),
        totalPages,
        totalItems: res.total,
        items: res.items.map((row) => ({
          userId: row.userId,
          primaryValue: row.totalEarned,
          secondaryValue: row.totalCount,
          equippedTitle: null,
        })),
      };
    }

    if (type === 'gambling_profit' || type === 'gambling_loss') {
      const sort = type === 'gambling_profit' ? 'profit' : 'loss';
      const res = this.creditLoanService?.getGamblingLeaderboard(
        guildId,
        sort,
        pageSize,
        offset,
      ) ?? { items: [], total: 0 };
      const totalPages = Math.max(1, Math.ceil(res.total / pageSize));
      return {
        type,
        page: Math.min(safePage, totalPages),
        totalPages,
        totalItems: res.total,
        items: res.items.map((row) => ({
          userId: row.userId,
          primaryValue: row.netProfit,
          secondaryValue: row.gamesPlayed,
          equippedTitle: null,
          totalWon: row.totalWon,
          totalLost: row.totalLost,
        })),
      };
    }

    if (type === 'rpg') {
      const res = this.rpgService?.getLeaderboard(guildId, pageSize, offset) ?? {
        items: [],
        total: 0,
      };
      const totalPages = Math.max(1, Math.ceil(res.total / pageSize));
      return {
        type,
        page: Math.min(safePage, totalPages),
        totalPages,
        totalItems: res.total,
        items: res.items.map((row) => ({
          userId: row.userId,
          primaryValue: row.level,
          secondaryValue: row.totalBreakthroughs,
          equippedTitle: null,
        })),
      };
    }

    const res =
      type === 'coins'
        ? this.profileRepo.listLeaderboardByCoins(guildId, pageSize, offset)
        : type === 'stat'
          ? this.profileRepo.listLeaderboardByStat(guildId, pageSize, offset)
          : this.profileRepo.listLeaderboardByXp(guildId, pageSize, offset);

    const totalPages = Math.max(1, Math.ceil(res.total / pageSize));
    return {
      type,
      page: Math.min(safePage, totalPages),
      totalPages,
      totalItems: res.total,
      items: res.items.map((p) => ({
        userId: p.userId,
        primaryValue:
          type === 'coins'
            ? p.coins + p.bankCoins
            : type === 'stat'
              ? p.statValue
              : p.xp,
        secondaryValue: type === 'coins' ? p.bankCoins : p.level,
        equippedTitle: p.equippedTitle,
      })),
    };
  }

  private getActiveBoost(profile: MemberProfile, nowMs: number): number {
    if (profile.xpBoostExpiresAt > nowMs && profile.xpBoostMultiplier > 1) {
      return profile.xpBoostMultiplier;
    }
    return 1.0;
  }

  private computeHourlyGrant(
    profile: MemberProfile,
    requestedXp: number,
    hourlyCap: number,
    nowMs: number,
  ): { granted: number; windowStart: number; hourXpEarned: number } {
    if (hourlyCap <= 0) {
      return { granted: requestedXp, windowStart: nowMs, hourXpEarned: requestedXp };
    }
    const sameWindow = profile.hourWindowStart > 0 && nowMs - profile.hourWindowStart < HOUR_MS;
    const windowStart = sameWindow ? profile.hourWindowStart : nowMs;
    const earnedSoFar = sameWindow ? profile.hourXpEarned : 0;
    const remaining = Math.max(0, hourlyCap - earnedSoFar);
    const granted = Math.min(requestedXp, remaining);
    return {
      granted,
      windowStart,
      hourXpEarned: earnedSoFar + granted,
    };
  }

  private applyXpGrant(
    guildId: string,
    profile: MemberProfile,
    grantedXp: number,
    meta: {
      messageIncrement: number;
      voiceMinutesIncrement: number;
      nextHeatStreak: number;
      lastXpAt: number;
      hourWindowStart: number;
      hourXpEarned: number;
      heatMultiplier: number;
      boostMultiplier: number;
    },
    levelUpCoinReward: number,
    stackRoles: boolean,
    statCfg: { statEnabled: boolean; statMinGain: number; statMaxGain: number },
    rng: () => number = Math.random,
  ): AwardXpResult {
    const oldLevel = profile.level;
    const totalXp = profile.xp + grantedXp;
    const rawProgress = calculateLevelProgress(totalXp);
    const newLevel = Math.max(0, rawProgress.level + profile.levelOffset);
    const levelsGained = Math.max(0, newLevel - oldLevel);
    const coinsAwarded = levelsGained * Math.max(0, levelUpCoinReward);

    let statGained = 0;
    if (levelsGained > 0 && statCfg.statEnabled) {
      const minG = Math.max(0, Math.min(statCfg.statMinGain, statCfg.statMaxGain));
      const maxG = Math.max(0, Math.max(statCfg.statMinGain, statCfg.statMaxGain));
      for (let i = 0; i < levelsGained; i++) {
        statGained += minG + Math.floor(rng() * (maxG - minG + 1));
      }
    }
    const nextStatValue = profile.statValue + statGained;

    const updated: MemberProfile = {
      ...profile,
      xp: totalXp,
      level: newLevel,
      statValue: nextStatValue,
      messageCount: profile.messageCount + meta.messageIncrement,
      voiceMinutes: profile.voiceMinutes + meta.voiceMinutesIncrement,
      coins: profile.coins + coinsAwarded,
      heatStreak: meta.nextHeatStreak,
      lastXpAt: meta.lastXpAt,
      hourWindowStart: meta.hourWindowStart,
      hourXpEarned: meta.hourXpEarned,
    };
    this.profileRepo.save(updated);

    const roleChanges =
      newLevel > oldLevel
        ? this.computeRoleRewards(guildId, oldLevel, newLevel, stackRoles)
        : { rolesToAdd: [], rolesToRemove: [] };

    return {
      awarded: true,
      xpGained: grantedXp,
      totalXp,
      heatStreak: meta.nextHeatStreak,
      heatMultiplier: meta.heatMultiplier,
      boostMultiplier: meta.boostMultiplier,
      leveledUp: newLevel > oldLevel,
      oldLevel,
      newLevel,
      coinsAwarded,
      statGained,
      statValue: nextStatValue,
      rolesToAdd: roleChanges.rolesToAdd,
      rolesToRemove: roleChanges.rolesToRemove,
    };
  }

  private computeRoleRewards(
    guildId: string,
    oldLevel: number,
    newLevel: number,
    stackRoles: boolean,
  ): { rolesToAdd: string[]; rolesToRemove: string[] } {
    const rewards = this.profileRepo.listLevelRewards(guildId);
    if (rewards.length === 0) {
      return { rolesToAdd: [], rolesToRemove: [] };
    }

    const eligible = rewards.filter((r) => r.level <= newLevel);
    const higherLost =
      newLevel < oldLevel
        ? rewards.filter((r) => r.level > newLevel && r.level <= oldLevel)
        : [];

    if (eligible.length === 0) {
      return {
        rolesToAdd: [],
        rolesToRemove: [...new Set(higherLost.map((r) => r.roleId))],
      };
    }

    if (stackRoles) {
      const rolesToAdd =
        newLevel > oldLevel
          ? [...new Set(eligible.filter((r) => r.level > oldLevel).map((r) => r.roleId))]
          : [];
      const addSet = new Set(rolesToAdd);
      const rolesToRemove = [
        ...new Set(higherLost.map((r) => r.roleId).filter((id) => !addSet.has(id))),
      ];
      return { rolesToAdd, rolesToRemove };
    }

    const highest = eligible[eligible.length - 1]!;
    const rolesToRemove = [
      ...new Set(
        [...eligible, ...higherLost]
          .filter((r) => r.roleId !== highest.roleId)
          .map((r) => r.roleId),
      ),
    ];
    return {
      rolesToAdd: [highest.roleId],
      rolesToRemove,
    };
  }

  private skippedResult(
    profile: MemberProfile,
    reason: XpSkipReason,
    nowMs: number,
    maxHeatMult: number,
  ): AwardXpResult {
    return {
      awarded: false,
      reason,
      xpGained: 0,
      totalXp: profile.xp,
      heatStreak: profile.heatStreak,
      heatMultiplier: getHeatMultiplier(profile.heatStreak, maxHeatMult),
      boostMultiplier: this.getActiveBoost(profile, nowMs),
      leveledUp: false,
      oldLevel: profile.level,
      newLevel: profile.level,
      coinsAwarded: 0,
      statGained: 0,
      statValue: profile.statValue,
      rolesToAdd: [],
      rolesToRemove: [],
    };
  }
}
