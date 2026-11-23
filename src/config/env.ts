import dotenv from 'dotenv';

export interface AppEnv {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  dbPath: string;
  timezone: string;
}

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const discordToken = source.DISCORD_TOKEN?.trim();
  if (!discordToken) {
    throw new Error('缺少必需的环境变量: DISCORD_TOKEN');
  }

  const discordClientId = source.DISCORD_CLIENT_ID?.trim();
  if (!discordClientId) {
    throw new Error('缺少必需的环境变量: DISCORD_CLIENT_ID');
  }

  const discordGuildId = source.DISCORD_GUILD_ID?.trim();
  const dbPath = source.DB_PATH?.trim() || './data/bot.db';
  const timezone = source.TIMEZONE?.trim() || 'Asia/Shanghai';

  return {
    discordToken,
    discordClientId,
    ...(discordGuildId ? { discordGuildId } : {}),
    dbPath,
    timezone,
  };
}

export function loadEnv(): AppEnv {
  dotenv.config();
  return parseEnv(process.env);
}
