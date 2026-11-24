import dotenv from 'dotenv';

export interface LlmEnvConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface AppEnv {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  dbPath: string;
  timezone: string;
  llm?: LlmEnvConfig;
}

function parseLlmTimeoutMs(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return 60_000;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return 60_000;
  }
  return Math.max(5_000, Math.min(300_000, parsed));
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

  const llmBaseUrlRaw = source.LLM_BASE_URL?.trim();
  const llmApiKey = source.LLM_API_KEY?.trim() ?? '';
  const llmModel = source.LLM_MODEL?.trim() ?? '';
  const llm: LlmEnvConfig | undefined = llmBaseUrlRaw
    ? {
        baseUrl: llmBaseUrlRaw.replace(/\/+$/, ''),
        apiKey: llmApiKey,
        model: llmModel,
        timeoutMs: parseLlmTimeoutMs(source.LLM_TIMEOUT_MS),
      }
    : undefined;

  return {
    discordToken,
    discordClientId,
    ...(discordGuildId ? { discordGuildId } : {}),
    dbPath,
    timezone,
    ...(llm ? { llm } : {}),
  };
}

export function loadEnv(): AppEnv {
  dotenv.config();
  return parseEnv(process.env);
}
