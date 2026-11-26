import dotenv from 'dotenv';

export const DEFAULT_LLM_FALLBACK_MODEL = 'pg/gemini-4-carbon';
export const DEFAULT_LLM_MAX_RETRIES = 8;
export const DEFAULT_LLM_RATE_LIMIT_MAX_RETRIES = 2;

export interface LlmEnvConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  fallbackModel?: string;
  maxRetries?: number;
  rateLimitMaxRetries?: number;
}

export interface AppEnv {
  discordToken: string;
  discordClientId: string;
  discordGuildId?: string;
  dbPath: string;
  timezone: string;
  llm?: LlmEnvConfig;
}

function parseIntInBounds(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseLlmFallbackModel(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return DEFAULT_LLM_FALLBACK_MODEL;
  }
  if (/^(none|off|false|-)$/i.test(trimmed)) {
    return '';
  }
  return trimmed;
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
        timeoutMs: parseIntInBounds(source.LLM_TIMEOUT_MS, 60_000, 5_000, 300_000),
        fallbackModel: parseLlmFallbackModel(source.LLM_FALLBACK_MODEL),
        maxRetries: parseIntInBounds(source.LLM_MAX_RETRIES, DEFAULT_LLM_MAX_RETRIES, 0, 15),
        rateLimitMaxRetries: parseIntInBounds(
          source.LLM_RATE_LIMIT_MAX_RETRIES,
          DEFAULT_LLM_RATE_LIMIT_MAX_RETRIES,
          0,
          8,
        ),
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
