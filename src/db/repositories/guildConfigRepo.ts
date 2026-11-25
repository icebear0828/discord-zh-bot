import type Database from 'better-sqlite3';
import { sanitizeStoredUserProfiles } from '../../services/aiProfiles.js';
import {
  cloneDefaultAiRegexRules,
  sanitizeStoredRegexRules,
} from '../../services/aiRegex.js';
import {
  createDefaultGuildConfig,
  DEFAULT_AI_CONFIG,
  DEFAULT_CREDIT_LOAN_CONFIG,
  DEFAULT_ECONOMY_CONFIG,
  DEFAULT_GAMES_CONFIG,
  DEFAULT_LEVELING_CONFIG,
  DEFAULT_MODULES,
  DEFAULT_RPG_CONFIG,
  DEFAULT_TICKET_CONFIG,
  DEFAULT_WELCOME_CONFIG,
  type AiConfig,
  type CreditLoanConfig,
  type EconomyConfig,
  type GamesConfig,
  type GuildConfig,
  type LevelingConfig,
  type ModuleToggles,
  type RpgConfig,
  type TicketConfig,
  type WelcomeConfig,
} from '../../config/defaults.js';

interface GuildConfigRow {
  guild_id: string;
  modules_json: string;
  admin_role_ids_json: string;
  admin_user_ids_json?: string;
  leveling_config_json: string;
  economy_config_json: string;
  welcome_config_json: string;
  ticket_config_json: string;
  games_config_json?: string;
  ai_config_json?: string;
  credit_loan_config_json?: string;
  rpg_config_json?: string;
  updated_at: number;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function parseStringArray(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is string => typeof item === 'string');
}

function parseRecord<T extends object>(raw: string, defaults: T): T {
  const obj = parseJsonObject(raw);
  return { ...defaults, ...obj } as T;
}

export class GuildConfigRepo {
  constructor(private readonly db: Database.Database) {}

  getOrCreate(guildId: string): GuildConfig {
    const row = this.db
      .prepare('SELECT * FROM guild_configs WHERE guild_id = ?')
      .get(guildId) as GuildConfigRow | undefined;

    if (row) {
      const levelingRaw = parseRecord<LevelingConfig>(row.leveling_config_json, {
        ...DEFAULT_LEVELING_CONFIG,
        allowedChannelIds: [],
        ignoredChannelIds: [],
        channelMultipliers: {},
      });
      let economy = parseRecord<EconomyConfig>(row.economy_config_json, {
        ...DEFAULT_ECONOMY_CONFIG,
      });
      if (economy.dailyBase <= 500 && economy.workMax <= 500) {
        economy = {
          ...economy,
          dailyBase: 5000,
          dailyStreakBonus: 1000,
          dailyMaxStreakBonus: 10000,
          workMin: 2000,
          workMax: 5000,
          bankInterestMax: Math.max(economy.bankInterestMax, 10000),
        };
        this.db
          .prepare(
            'UPDATE guild_configs SET economy_config_json = ?, updated_at = ? WHERE guild_id = ?',
          )
          .run(JSON.stringify(economy), Date.now(), row.guild_id);
      }
      return {
        guildId: row.guild_id,
        modules: parseRecord<ModuleToggles>(row.modules_json, { ...DEFAULT_MODULES }),
        adminRoleIds: parseStringArray(row.admin_role_ids_json),
        adminUserIds: parseStringArray(row.admin_user_ids_json ?? '[]'),
        leveling: {
          ...levelingRaw,
          allowedChannelIds: Array.isArray(levelingRaw.allowedChannelIds)
            ? levelingRaw.allowedChannelIds
            : [],
          ignoredChannelIds: Array.isArray(levelingRaw.ignoredChannelIds)
            ? levelingRaw.ignoredChannelIds
            : [],
          channelMultipliers:
            typeof levelingRaw.channelMultipliers === 'object' &&
            levelingRaw.channelMultipliers !== null
              ? levelingRaw.channelMultipliers
              : {},
        },
        economy,
        welcome: parseRecord<WelcomeConfig>(row.welcome_config_json, {
          ...DEFAULT_WELCOME_CONFIG,
          autoRoleIds: [],
        }),
        ticket: parseRecord<TicketConfig>(row.ticket_config_json, {
          ...DEFAULT_TICKET_CONFIG,
          staffRoleIds: [],
        }),
        games: parseRecord<GamesConfig>(row.games_config_json ?? '{}', {
          ...DEFAULT_GAMES_CONFIG,
        }),
        ai: (() => {
          const rawAiObj = parseJsonObject(row.ai_config_json ?? '{}');
          const aiRaw = parseRecord<AiConfig>(row.ai_config_json ?? '{}', {
            ...DEFAULT_AI_CONFIG,
            regexRules: cloneDefaultAiRegexRules(),
            userProfiles: [],
            freeChatChannelIds: [],
            allowedChannelIds: [],
            ignoredChannelIds: [],
          });
          const parsedRules = sanitizeStoredRegexRules(rawAiObj['regexRules']);
          const parsedProfiles = sanitizeStoredUserProfiles(rawAiObj['userProfiles']);
          const rawInputPrice = rawAiObj['inputPricePer1MUsd'];
          const rawOutputPrice = rawAiObj['outputPricePer1MUsd'];
          return {
            ...aiRaw,
            inputPricePer1MUsd:
              typeof rawInputPrice === 'number' && Number.isFinite(rawInputPrice) && rawInputPrice >= 0
                ? rawInputPrice
                : 0,
            outputPricePer1MUsd:
              typeof rawOutputPrice === 'number' && Number.isFinite(rawOutputPrice) && rawOutputPrice >= 0
                ? rawOutputPrice
                : 0,
            antiClichePromptEnabled:
              typeof rawAiObj['antiClichePromptEnabled'] === 'boolean'
                ? rawAiObj['antiClichePromptEnabled']
                : true,
            regexRules: parsedRules !== undefined ? parsedRules : cloneDefaultAiRegexRules(),
            userProfiles: parsedProfiles,
            freeChatChannelIds: Array.isArray(aiRaw.freeChatChannelIds)
              ? aiRaw.freeChatChannelIds.filter((id): id is string => typeof id === 'string')
              : [],
            allowedChannelIds: Array.isArray(aiRaw.allowedChannelIds)
              ? aiRaw.allowedChannelIds.filter((id): id is string => typeof id === 'string')
              : [],
            ignoredChannelIds: Array.isArray(aiRaw.ignoredChannelIds)
              ? aiRaw.ignoredChannelIds.filter((id): id is string => typeof id === 'string')
              : [],
          };
        })(),
        creditLoan: parseRecord<CreditLoanConfig>(row.credit_loan_config_json ?? '{}', {
          ...DEFAULT_CREDIT_LOAN_CONFIG,
        }),
        rpg: parseRecord<RpgConfig>(row.rpg_config_json ?? '{}', {
          ...DEFAULT_RPG_CONFIG,
        }),
        updatedAt: row.updated_at,
      };
    }

    const created = createDefaultGuildConfig(guildId);
    this.db
      .prepare(
        `INSERT INTO guild_configs (
          guild_id, modules_json, admin_role_ids_json, admin_user_ids_json,
          leveling_config_json, economy_config_json,
          welcome_config_json, ticket_config_json, games_config_json, ai_config_json,
          credit_loan_config_json, rpg_config_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        created.guildId,
        JSON.stringify(created.modules),
        JSON.stringify(created.adminRoleIds),
        JSON.stringify(created.adminUserIds),
        JSON.stringify(created.leveling),
        JSON.stringify(created.economy),
        JSON.stringify(created.welcome),
        JSON.stringify(created.ticket),
        JSON.stringify(created.games),
        JSON.stringify(created.ai),
        JSON.stringify(created.creditLoan),
        JSON.stringify(created.rpg),
        created.updatedAt,
      );
    return created;
  }

  updateModules(guildId: string, modules: ModuleToggles): void {
    this.getOrCreate(guildId);
    this.db
      .prepare('UPDATE guild_configs SET modules_json = ?, updated_at = ? WHERE guild_id = ?')
      .run(JSON.stringify(modules), Date.now(), guildId);
  }

  updateAdminRoles(guildId: string, adminRoleIds: string[]): void {
    this.getOrCreate(guildId);
    this.db
      .prepare(
        'UPDATE guild_configs SET admin_role_ids_json = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(JSON.stringify(adminRoleIds), Date.now(), guildId);
  }

  updateAdminUsers(guildId: string, adminUserIds: string[]): void {
    this.getOrCreate(guildId);
    this.db
      .prepare(
        'UPDATE guild_configs SET admin_user_ids_json = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(JSON.stringify(adminUserIds), Date.now(), guildId);
  }

  updateLeveling(guildId: string, leveling: LevelingConfig): void {
    this.getOrCreate(guildId);
    this.db
      .prepare(
        'UPDATE guild_configs SET leveling_config_json = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(JSON.stringify(leveling), Date.now(), guildId);
  }

  updateEconomy(guildId: string, economy: EconomyConfig): void {
    this.getOrCreate(guildId);
    this.db
      .prepare(
        'UPDATE guild_configs SET economy_config_json = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(JSON.stringify(economy), Date.now(), guildId);
  }

  updateWelcome(guildId: string, welcome: WelcomeConfig): void {
    this.getOrCreate(guildId);
    this.db
      .prepare(
        'UPDATE guild_configs SET welcome_config_json = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(JSON.stringify(welcome), Date.now(), guildId);
  }

  updateTicket(guildId: string, ticket: TicketConfig): void {
    this.getOrCreate(guildId);
    this.db
      .prepare(
        'UPDATE guild_configs SET ticket_config_json = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(JSON.stringify(ticket), Date.now(), guildId);
  }

  updateGames(guildId: string, games: GamesConfig): void {
    this.getOrCreate(guildId);
    this.db
      .prepare(
        'UPDATE guild_configs SET games_config_json = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(JSON.stringify(games), Date.now(), guildId);
  }

  updateAi(guildId: string, ai: AiConfig): void {
    this.getOrCreate(guildId);
    this.db
      .prepare(
        'UPDATE guild_configs SET ai_config_json = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(JSON.stringify(ai), Date.now(), guildId);
  }

  updateCreditLoan(guildId: string, creditLoan: CreditLoanConfig): void {
    this.getOrCreate(guildId);
    this.db
      .prepare(
        'UPDATE guild_configs SET credit_loan_config_json = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(JSON.stringify(creditLoan), Date.now(), guildId);
  }

  updateRpg(guildId: string, rpg: RpgConfig): void {
    this.getOrCreate(guildId);
    this.db
      .prepare(
        'UPDATE guild_configs SET rpg_config_json = ?, updated_at = ? WHERE guild_id = ?',
      )
      .run(JSON.stringify(rpg), Date.now(), guildId);
  }

  incrementTicketCounter(guildId: string): number {
    const cfg = this.getOrCreate(guildId);
    const nextCounter = cfg.ticket.counter + 1;
    this.updateTicket(guildId, { ...cfg.ticket, counter: nextCounter });
    return nextCounter;
  }
}
