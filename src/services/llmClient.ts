import type { LlmEnvConfig } from '../config/env.js';

export interface LlmTextPart {
  type: 'text';
  text: string;
}

export interface LlmImageUrlPart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type LlmContentPart = LlmTextPart | LlmImageUrlPart;
export type LlmMessageContent = string | LlmContentPart[];

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: LlmMessageContent;
}

export interface LlmChatRequest {
  model?: string;
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmChatResponse {
  content: string;
  model: string;
  attempts: number;
  usage?: LlmUsage;
}

export type LlmErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'service_unavailable'
  | 'timeout'
  | 'auth_error'
  | 'context_too_long'
  | 'bad_request'
  | 'network_error'
  | 'empty_response'
  | 'unknown';

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status?: number;
  readonly attempts: number;
  readonly userMessage: string;

  constructor(params: {
    code: LlmErrorCode;
    message: string;
    userMessage: string;
    attempts: number;
    status?: number;
  }) {
    super(params.message);
    this.name = 'LlmError';
    this.code = params.code;
    this.status = params.status;
    this.attempts = params.attempts;
    this.userMessage = params.userMessage;
  }
}

export interface LlmClientDeps {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [1200, 2800] as const;

export function resolveChatCompletionsUrl(baseUrl: string): string {
  const cleaned = baseUrl.trim().replace(/\/+$/, '');
  if (cleaned.endsWith('/chat/completions')) {
    return cleaned;
  }
  return `${cleaned}/chat/completions`;
}

export function parseRetryAfterMs(
  headerValue: string | null,
  nowMs = Date.now(),
): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const sec = Number(trimmed);
    if (!Number.isFinite(sec)) return null;
    return Math.max(500, Math.min(15_000, Math.round(sec * 1000)));
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    const delta = parsedDate - nowMs;
    if (delta <= 0) return 500;
    return Math.max(500, Math.min(15_000, delta));
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractResponseContent(data: unknown): {
  content: string;
  model?: string;
  usage?: LlmUsage;
} {
  if (!isRecord(data)) {
    return { content: '' };
  }

  const model = typeof data.model === 'string' ? data.model : undefined;
  let usage: LlmUsage | undefined;
  if (isRecord(data.usage)) {
    usage = {
      ...(typeof data.usage.prompt_tokens === 'number'
        ? { promptTokens: data.usage.prompt_tokens }
        : {}),
      ...(typeof data.usage.completion_tokens === 'number'
        ? { completionTokens: data.usage.completion_tokens }
        : {}),
      ...(typeof data.usage.total_tokens === 'number'
        ? { totalTokens: data.usage.total_tokens }
        : {}),
    };
  }

  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { content: '', model, usage };
  }

  const first = choices[0];
  if (!isRecord(first)) {
    return { content: '', model, usage };
  }

  const msg = first.message;
  if (!isRecord(msg)) {
    return { content: '', model, usage };
  }

  const rawContent = msg.content;
  if (typeof rawContent === 'string') {
    return { content: rawContent.trim(), model, usage };
  }

  if (Array.isArray(rawContent)) {
    const texts: string[] = [];
    for (const part of rawContent) {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
        texts.push(part.text);
      }
    }
    return { content: texts.join('').trim(), model, usage };
  }

  return { content: '', model, usage };
}

function mapHttpError(
  status: number,
  bodyText: string,
  attempts: number,
): LlmError {
  const lower = bodyText.toLowerCase();
  if (status === 429) {
    return new LlmError({
      code: 'rate_limited',
      status,
      attempts,
      message: `LLM HTTP 429: ${bodyText.slice(0, 200)}`,
      userMessage: 'AI 当前请求人数较多（429 限流），已自动重试仍未成功，请稍等几秒再试。',
    });
  }
  if (status === 502 || status === 503 || status === 504 || status === 500 || status === 408) {
    return new LlmError({
      code: 'service_unavailable',
      status,
      attempts,
      message: `LLM HTTP ${status}: ${bodyText.slice(0, 200)}`,
      userMessage: `AI 服务高峰繁忙或网关暂时不可用（HTTP ${status}），已自动重试仍失败，请稍后再试。`,
    });
  }
  if (status === 401 || status === 403) {
    return new LlmError({
      code: 'auth_error',
      status,
      attempts,
      message: `LLM HTTP ${status}: ${bodyText.slice(0, 200)}`,
      userMessage: 'AI 网关鉴权失败（401/403），请联系管理员检查服务配置。',
    });
  }
  if (
    status === 413 ||
    (status === 400 &&
      (lower.includes('context_length') ||
        lower.includes('maximum context') ||
        lower.includes('too many tokens') ||
        lower.includes('token limit')))
  ) {
    return new LlmError({
      code: 'context_too_long',
      status,
      attempts,
      message: `LLM HTTP ${status}: ${bodyText.slice(0, 200)}`,
      userMessage: '当前对话上下文过长，请发送 `/ai 重置` 清空历史上下文后再试。',
    });
  }
  if (status >= 400 && status < 500) {
    return new LlmError({
      code: 'bad_request',
      status,
      attempts,
      message: `LLM HTTP ${status}: ${bodyText.slice(0, 200)}`,
      userMessage: `AI 请求参数或模型配置异常（HTTP ${status}），请检查模型名称或输入内容。`,
    });
  }
  return new LlmError({
    code: 'unknown',
    status,
    attempts,
    message: `LLM HTTP ${status}: ${bodyText.slice(0, 200)}`,
    userMessage: `AI 服务返回未知异常（HTTP ${status}），请稍后再试。`,
  });
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.name === 'TimeoutError';
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LlmClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(
    private readonly config: LlmEnvConfig | undefined,
    deps: LlmClientDeps = {},
  ) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.sleepFn = deps.sleepFn ?? defaultSleep;
    this.maxRetries = Math.max(0, Math.min(4, deps.maxRetries ?? 2));
  }

  isConfigured(): boolean {
    return Boolean(this.config?.baseUrl && this.config.apiKey);
  }

  getDefaultModel(): string {
    return this.config?.model ?? '';
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    if (!this.config || !this.config.baseUrl || !this.config.apiKey) {
      throw new LlmError({
        code: 'not_configured',
        attempts: 0,
        message: 'LLM_BASE_URL or LLM_API_KEY is not configured',
        userMessage: 'AI 功能尚未配置网关地址或密钥（`.env` 中的 `LLM_BASE_URL` / `LLM_API_KEY`）。',
      });
    }

    const model = request.model?.trim() || this.config.model;
    if (!model) {
      throw new LlmError({
        code: 'not_configured',
        attempts: 0,
        message: 'LLM model is not configured',
        userMessage: 'AI 模型尚未配置，请在 `.env` 设置 `LLM_MODEL` 或在后台指定模型。',
      });
    }

    const url = resolveChatCompletionsUrl(this.config.baseUrl);
    const timeoutMs = request.timeoutMs ?? this.config.timeoutMs;
    const totalAttempts = this.maxRetries + 1;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: request.messages,
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          if (RETRYABLE_STATUSES.has(res.status) && attempt < totalAttempts) {
            const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'));
            const fallbackDelay =
              DEFAULT_RETRY_DELAYS_MS[attempt - 1] ?? DEFAULT_RETRY_DELAYS_MS[1];
            await this.sleepFn(retryAfter ?? fallbackDelay);
            continue;
          }
          throw mapHttpError(res.status, bodyText, attempt);
        }

        const json: unknown = await res.json();
        const extracted = extractResponseContent(json);
        if (!extracted.content) {
          throw new LlmError({
            code: 'empty_response',
            status: res.status,
            attempts: attempt,
            message: 'LLM returned empty content',
            userMessage: 'AI 返回了空内容，请换个问法或稍后再试。',
          });
        }

        return {
          content: extracted.content,
          model: extracted.model ?? model,
          attempts: attempt,
          ...(extracted.usage ? { usage: extracted.usage } : {}),
        };
      } catch (err) {
        if (err instanceof LlmError) {
          throw err;
        }
        const timedOut = isTimeoutError(err);
        if (attempt < totalAttempts) {
          const delay = DEFAULT_RETRY_DELAYS_MS[attempt - 1] ?? DEFAULT_RETRY_DELAYS_MS[1];
          await this.sleepFn(delay);
          continue;
        }
        if (timedOut) {
          throw new LlmError({
            code: 'timeout',
            attempts: attempt,
            message: `LLM request timed out after ${timeoutMs}ms`,
            userMessage: 'AI 响应超时，已自动重试仍未完成，请稍后再试。',
          });
        }
        const detail = err instanceof Error ? err.message : String(err);
        throw new LlmError({
          code: 'network_error',
          attempts: attempt,
          message: `LLM network error: ${detail}`,
          userMessage: '连接 AI 网关失败（网络波动或服务暂不可达），请稍后再试。',
        });
      }
    }

    throw new LlmError({
      code: 'unknown',
      attempts: totalAttempts,
      message: 'Unexpected retry loop termination',
      userMessage: 'AI 请求失败，请稍后再试。',
    });
  }
}
