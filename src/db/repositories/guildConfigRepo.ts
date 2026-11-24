import type Database from 'better-sqlite3';
import {
  createDefaultGuildConfig,
  DEFAULT_ECONOMY_CONFIG,
  DEFAULT_GAMES_CONFIG,
  DEFAULT_LEVELING_CONFIG,
  DEFAULT_MODULES,
  DEFAULT_TICKET_CONFIG,
  DEFAULT_WELCOME_CONFIG,
  type EconomyConfig,
  type GamesConfig,
  type GuildConfig,
  type LevelingConfig,
  type ModuleToggles,
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
        economy: parseRecord<EconomyConfig>(row.economy_config_json, {
          ...DEFAULT_ECONOMY_CONFIG,
        }),
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
        updatedAt: row.updated_at,
      };
    }

    const created = createDefaultGuildConfig(guildId);
    this.db
      .prepare(
        `INSERT INTO guild_configs (
          guild_id, modules_json, admin_role_ids_json, admin_user_ids_json,
          leveling_config_json, economy_config_json,
          welcome_config_json, ticket_config_json, games_config_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  incrementTicketCounter(guildId: string): number {
    const cfg = this.getOrCreate(guildId);
    const nextCounter = cfg.ticket.counter + 1;
    this.updateTicket(guildId, { ...cfg.ticket, counter: nextCounter });
    return nextCounter;
  }
}
