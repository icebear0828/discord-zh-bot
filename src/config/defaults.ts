export interface ModuleToggles {
  leveling: boolean;
  economy: boolean;
  fun: boolean;
  welcome: boolean;
  tickets: boolean;
  giveaways: boolean;
  invites: boolean;
  rolePanels: boolean;
  socialGames: boolean;
  worldEvents: boolean;
  petsAndCp: boolean;
  ai: boolean;
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
  levelUpTitle: string;
  levelUpTemplate: string;
  statEnabled: boolean;
  statName: string;
  statUnit: string;
  statMinGain: number;
  statMaxGain: number;
  allowedChannelIds: string[];
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
  bankInterestRate: number;
  bankInterestMax: number;
  bankInterestMinDeposit: number;
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

export interface GamesConfig {
  propTrapPrice: number;
  propLockpickPrice: number;
  propShieldPrice: number;
  propCursePrice: number;
  propNicknamePrice: number;
  bountyMinAmount: number;
  bountyClearMultiplier: number;
  eventChannelId: string | null;
  eventAutoEnabled: boolean;
  eventMsgThreshold: number;
  eventCooldownSec: number;
  bossBaseHp: number;
  bossRewardPool: number;
  chestRewardMin: number;
  chestRewardMax: number;
  chestShares: number;
  petGachaPrice: number;
  petFeedPrice: number;
  petMaxOwned: number;
  cpProposeCost: number;
  cpMaxSworn: number;
}

export type AiPersonaPresetKey = 'community' | 'roast' | 'assistant' | 'custom';

export interface AiPersonaPreset {
  key: Exclude<AiPersonaPresetKey, 'custom'>;
  label: string;
  description: string;
  personaName: string;
  identityPrompt: string;
  soulPrompt: string;
}

export interface AiConfig {
  preset: AiPersonaPresetKey;
  personaName: string;
  identityPrompt: string;
  soulPrompt: string;
  worldbook: string;
  modelOverride: string | null;
  temperature: number;
  maxTokens: number;
  contextWindowMessages: number;
  maxMemoriesPerScope: number;
  memoryEnabled: boolean;
  visionEnabled: boolean;
  freeChatChannelIds: string[];
  allowedChannelIds: string[];
  ignoredChannelIds: string[];
}

export interface GuildConfig {
  guildId: string;
  modules: ModuleToggles;
  adminRoleIds: string[];
  adminUserIds: string[];
  leveling: LevelingConfig;
  economy: EconomyConfig;
  welcome: WelcomeConfig;
  ticket: TicketConfig;
  games: GamesConfig;
  ai: AiConfig;
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
  socialGames: true,
  worldEvents: true,
  petsAndCp: true,
  ai: true,
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
  levelUpTitle: '🎉 等级提升！',
  levelUpTemplate: '恭喜 {user} 升到 **Lv.{level}**！',
  statEnabled: true,
  statName: '成长值',
  statUnit: '点',
  statMinGain: 1,
  statMaxGain: 3,
  allowedChannelIds: [],
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
  bankInterestRate: 0.02,
  bankInterestMax: 500,
  bankInterestMinDeposit: 100,
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

export const DEFAULT_GAMES_CONFIG: GamesConfig = {
  propTrapPrice: 500,
  propLockpickPrice: 400,
  propShieldPrice: 600,
  propCursePrice: 300,
  propNicknamePrice: 1000,
  bountyMinAmount: 200,
  bountyClearMultiplier: 1.5,
  eventChannelId: null,
  eventAutoEnabled: true,
  eventMsgThreshold: 30,
  eventCooldownSec: 1800,
  bossBaseHp: 1000,
  bossRewardPool: 3000,
  chestRewardMin: 800,
  chestRewardMax: 2000,
  chestShares: 5,
  petGachaPrice: 500,
  petFeedPrice: 80,
  petMaxOwned: 12,
  cpProposeCost: 500,
  cpMaxSworn: 3,
};

export const AI_PERSONA_PRESETS: Readonly<Record<Exclude<AiPersonaPresetKey, 'custom'>, AiPersonaPreset>> = {
  community: {
    key: 'community',
    label: '🎭 群聊活宝（默认）',
    description: '接梗快、有烟火气、像群里的老熟人一样陪聊',
    personaName: '黑吊使者',
    identityPrompt:
      '你是本 Discord 社群的常驻 AI 伙伴，熟悉群友日常吹水、游戏开黑与社群文化。',
    soulPrompt:
      '用自然口语化的中文回复，像真实群友一样简短接梗、风趣有温度；日常闲聊控制在 1~4 句话内，只有遇到正经提问或复杂问题时才展开分点说明。',
  },
  roast: {
    key: 'roast',
    label: '🔥 毒舌吐槽役',
    description: '嘴硬心软、锐评一切，适合热闹吐槽氛围',
    personaName: '毒舌使者',
    identityPrompt:
      '你是本群嘴最毒但心最软的锐评选手，擅长一针见血地吐槽群友的离谱发言与下饭操作。',
    soulPrompt:
      '用中文犀利但不过线的幽默口吻回复，多用短句和反问，不人身攻击、不恶意引战；遇到真求助时先嘴硬吐槽半句再给出靠谱答案。',
  },
  assistant: {
    key: 'assistant',
    label: '🧠 冷静技术助手',
    description: '务实克制、直奔重点，少废话多给可执行结论',
    personaName: '冷静助手',
    identityPrompt:
      '你是严谨务实的多面手技术与知识助手，擅长排查问题、总结信息、给出清晰建议。',
    soulPrompt:
      '用简洁直接的中文回复，优先给结论与关键步骤；不确定时明确说明边界和验证方法，不胡编、不水字数。',
  },
};

export const DEFAULT_AI_CONFIG: AiConfig = {
  preset: 'community',
  personaName: AI_PERSONA_PRESETS.community.personaName,
  identityPrompt: AI_PERSONA_PRESETS.community.identityPrompt,
  soulPrompt: AI_PERSONA_PRESETS.community.soulPrompt,
  worldbook: '',
  modelOverride: null,
  temperature: 0.8,
  maxTokens: 1024,
  contextWindowMessages: 12,
  maxMemoriesPerScope: 30,
  memoryEnabled: true,
  visionEnabled: true,
  freeChatChannelIds: [],
  allowedChannelIds: [],
  ignoredChannelIds: [],
};

export function createDefaultGuildConfig(guildId: string, nowMs = Date.now()): GuildConfig {
  return {
    guildId,
    modules: { ...DEFAULT_MODULES },
    adminRoleIds: [],
    adminUserIds: [],
    leveling: {
      ...DEFAULT_LEVELING_CONFIG,
      allowedChannelIds: [],
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
    games: { ...DEFAULT_GAMES_CONFIG },
    ai: {
      ...DEFAULT_AI_CONFIG,
      freeChatChannelIds: [],
      allowedChannelIds: [],
      ignoredChannelIds: [],
    },
    updatedAt: nowMs,
  };
}
