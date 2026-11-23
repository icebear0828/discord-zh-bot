export interface ModuleToggles {
  leveling: boolean;
  economy: boolean;
  fun: boolean;
  welcome: boolean;
  tickets: boolean;
  giveaways: boolean;
  invites: boolean;
  rolePanels: boolean;
}

export type ModuleKey = keyof ModuleToggles;

export interface LevelingConfig {
  cooldownSec: number;
  baseMinXp: number;
  baseMaxXp: number;
  heatWindowSec: number;
  heatMaxMultiplier: number;
  hourlyXpCap: number;
  voiceEnabled: boolean;
  voiceXpPerMin: number;
  levelUpCoinReward: number;
  announceChannelId: string | null;
  announceEnabled: boolean;
  ignoredChannelIds: string[];
  channelMultipliers: Record<string, number>;
  stackRoles: boolean;
}

export interface EconomyConfig {
  currencyName: string;
  currencyEmoji: string;
  dailyBase: number;
  dailyStreakBonus: number;
  dailyMaxStreakBonus: number;
  workMin: number;
  workMax: number;
  workCooldownSec: number;
  robCooldownSec: number;
  robTargetShieldSec: number;
  robSuccessRate: number;
}

export interface WelcomeConfig {
  welcomeEnabled: boolean;
  welcomeChannelId: string | null;
  welcomeTitle: string;
  welcomeTemplate: string;
  leaveEnabled: boolean;
  leaveChannelId: string | null;
  leaveTemplate: string;
  autoRoleIds: string[];
}

export interface TicketConfig {
  categoryId: string | null;
  staffRoleIds: string[];
  logChannelId: string | null;
  counter: number;
  maxOpenPerUser: number;
}

export interface GuildConfig {
  guildId: string;
  modules: ModuleToggles;
  adminRoleIds: string[];
  leveling: LevelingConfig;
  economy: EconomyConfig;
  welcome: WelcomeConfig;
  ticket: TicketConfig;
  updatedAt: number;
}

export const DEFAULT_MODULES: ModuleToggles = {
  leveling: true,
  economy: true,
  fun: true,
  welcome: true,
  tickets: true,
  giveaways: true,
  invites: true,
  rolePanels: true,
};

export const DEFAULT_LEVELING_CONFIG: LevelingConfig = {
  cooldownSec: 15,
  baseMinXp: 15,
  baseMaxXp: 25,
  heatWindowSec: 180,
  heatMaxMultiplier: 2.0,
  hourlyXpCap: 1200,
  voiceEnabled: true,
  voiceXpPerMin: 10,
  levelUpCoinReward: 100,
  announceChannelId: null,
  announceEnabled: true,
  ignoredChannelIds: [],
  channelMultipliers: {},
  stackRoles: true,
};

export const DEFAULT_ECONOMY_CONFIG: EconomyConfig = {
  currencyName: '星币',
  currencyEmoji: '🪙',
  dailyBase: 200,
  dailyStreakBonus: 30,
  dailyMaxStreakBonus: 300,
  workMin: 80,
  workMax: 220,
  workCooldownSec: 1800,
  robCooldownSec: 3600,
  robTargetShieldSec: 3600,
  robSuccessRate: 0.45,
};

export const DEFAULT_WELCOME_CONFIG: WelcomeConfig = {
  welcomeEnabled: false,
  welcomeChannelId: null,
  welcomeTitle: '🎉 欢迎新成员！',
  welcomeTemplate: '欢迎 {user} 加入 **{server}**！你是第 **{memberCount}** 位成员。',
  leaveEnabled: false,
  leaveChannelId: null,
  leaveTemplate: '👋 **{username}** 离开了服务器，当前成员数：{memberCount}。',
  autoRoleIds: [],
};

export const DEFAULT_TICKET_CONFIG: TicketConfig = {
  categoryId: null,
  staffRoleIds: [],
  logChannelId: null,
  counter: 0,
  maxOpenPerUser: 2,
};

export function createDefaultGuildConfig(guildId: string, nowMs = Date.now()): GuildConfig {
  return {
    guildId,
    modules: { ...DEFAULT_MODULES },
    adminRoleIds: [],
    leveling: {
      ...DEFAULT_LEVELING_CONFIG,
      ignoredChannelIds: [],
      channelMultipliers: {},
    },
    economy: { ...DEFAULT_ECONOMY_CONFIG },
    welcome: {
      ...DEFAULT_WELCOME_CONFIG,
      autoRoleIds: [],
    },
    ticket: {
      ...DEFAULT_TICKET_CONFIG,
      staffRoleIds: [],
    },
    updatedAt: nowMs,
  };
}
