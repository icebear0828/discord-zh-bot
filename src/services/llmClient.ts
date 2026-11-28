import {
  DEFAULT_LLM_MAX_RETRIES,
  DEFAULT_LLM_RATE_LIMIT_MAX_RETRIES,
  type LlmEnvConfig,
} from '../config/env.js';

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
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  timeoutMs?: number;
  stream?: boolean;
  maxRetries?: number;
  validateContent?: (rawContent: string) => boolean;
  isRefusalContent?: (rawContent: string) => boolean;
  maxRefusalRetries?: number;
  refusalRetryMessages?: LlmChatMessage[];
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
  | 'content_refusal'
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
  nowFn?: () => number;
  maxRetries?: number;
  maxRateLimitRetries?: number;
  maxTotalDurationMs?: number;
}

export const DEFAULT_MAX_RETRIES = DEFAULT_LLM_MAX_RETRIES;
export const DEFAULT_MAX_RATE_LIMIT_RETRIES = DEFAULT_LLM_RATE_LIMIT_MAX_RETRIES;
export const DEFAULT_RETRY_DELAYS_MS = [
  1200,
  2500,
  4000,
  6000,
  8000,
  10_000,
  12_000,
  15_000,
] as const;

const EMPTY_RESPONSE_MAX_DELAY_MS = 3000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_TOTAL_DURATION_MS = 120_000;

class SseUpstreamError extends Error {
  readonly status: number;
  readonly bodyText: string;

  constructor(status: number, bodyText: string) {
    super(`SSE upstream error ${status}: ${bodyText.slice(0, 200)}`);
    this.name = 'SseUpstreamError';
    this.status = status;
    this.bodyText = bodyText;
  }
}

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

function extractUsage(rawUsage: unknown): LlmUsage | undefined {
  if (!isRecord(rawUsage)) return undefined;
  const promptTokens =
    typeof rawUsage.prompt_tokens === 'number'
      ? rawUsage.prompt_tokens
      : typeof rawUsage.input_tokens === 'number'
        ? rawUsage.input_tokens
        : undefined;
  const completionTokens =
    typeof rawUsage.completion_tokens === 'number'
      ? rawUsage.completion_tokens
      : typeof rawUsage.output_tokens === 'number'
        ? rawUsage.output_tokens
        : undefined;
  const totalTokens =
    typeof rawUsage.total_tokens === 'number'
      ? rawUsage.total_tokens
      : promptTokens !== undefined || completionTokens !== undefined
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : undefined;

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function extractTextFromContentField(rawContent: unknown): string {
  if (typeof rawContent === 'string') {
    return rawContent;
  }
  if (Array.isArray(rawContent)) {
    const texts: string[] = [];
    for (const part of rawContent) {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
        texts.push(part.text);
      }
    }
    return texts.join('');
  }
  return '';
}

function extractResponseContent(data: unknown): {
  content: string;
  model?: string;
  usage?: LlmUsage;
  finishReason?: string;
} {
  if (!isRecord(data)) {
    return { content: '' };
  }

  const model = typeof data.model === 'string' ? data.model : undefined;
  const usage = extractUsage(data.usage);

  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { content: '', model, usage };
  }

  const first = choices[0];
  if (!isRecord(first)) {
    return { content: '', model, usage };
  }

  const finishReason =
    typeof first.finish_reason === 'string' && first.finish_reason.trim()
      ? first.finish_reason.trim()
      : undefined;

  const msg = first.message;
  if (!isRecord(msg)) {
    return { content: '', model, usage, finishReason };
  }

  const text = extractTextFromContentField(msg.content).trim();
  return { content: text, model, usage, finishReason };
}

function isContextTooLong(status: number, bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    status === 413 ||
    (status === 400 &&
      (lower.includes('context_length') ||
        lower.includes('maximum context') ||
        lower.includes('too many tokens') ||
        lower.includes('token limit')))
  );
}

function isUpstreamPoolError(bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    lower.includes('upstream_http_error') ||
    lower.includes('upstream error') ||
    lower.includes('上游 http') ||
    lower.includes('上游错误') ||
    lower.includes('no available account') ||
    lower.includes('account_unavailable') ||
    lower.includes('channel_error')
  );
}

function isRetryableHttpStatus(status: number, bodyText: string): boolean {
  if (isContextTooLong(status, bodyText)) {
    return false;
  }
  if (status === 429 || status === 408 || status === 409 || status === 425 || status >= 500) {
    return true;
  }
  if ((status === 400 || status === 401 || status === 403) && isUpstreamPoolError(bodyText)) {
    return true;
  }
  return false;
}

function extractSseErrorStatus(errObj: Record<string, unknown>): number {
  if (typeof errObj.status === 'number' && Number.isFinite(errObj.status)) {
    return errObj.status;
  }
  if (typeof errObj.status_code === 'number' && Number.isFinite(errObj.status_code)) {
    return errObj.status_code;
  }
  const msg = typeof errObj.message === 'string' ? errObj.message : '';
  const code = typeof errObj.code === 'string' ? errObj.code : '';
  const httpMatch = /HTTP\s+(\d{3})/i.exec(msg);
  if (httpMatch?.[1]) {
    const parsed = Number(httpMatch[1]);
    if (Number.isFinite(parsed) && parsed >= 400 && parsed <= 599) {
      return parsed;
    }
  }
  const combined = `${code} ${msg}`.toLowerCase();
  if (combined.includes('rate_limit') || combined.includes('too many requests') || combined.includes('429')) {
    return 429;
  }
  return 502;
}

function mapHttpError(
  status: number,
  bodyText: string,
  attempts: number,
): LlmError {
  if (status === 429) {
    return new LlmError({
      code: 'rate_limited',
      status,
      attempts,
      message: `LLM HTTP 429: ${bodyText.slice(0, 200)}`,
      userMessage: 'AI 当前请求人数较多（429 限流），已自动重试仍未成功，请稍等几秒再试。',
    });
  }
  if (status >= 500 || status === 408 || status === 409 || status === 425) {
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
  if (isContextTooLong(status, bodyText)) {
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

function getFallbackDelayMs(attempt: number): number {
  return (
    DEFAULT_RETRY_DELAYS_MS[attempt - 1] ??
    DEFAULT_RETRY_DELAYS_MS[DEFAULT_RETRY_DELAYS_MS.length - 1] ??
    15_000
  );
}

export class LlmClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly nowFn: () => number;
  private readonly maxRetries: number;
  private readonly maxRateLimitRetries: number;
  private readonly maxTotalDurationMs: number;

  constructor(
    private readonly config: LlmEnvConfig | undefined,
    deps: LlmClientDeps = {},
  ) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.sleepFn = deps.sleepFn ?? defaultSleep;
    this.nowFn = deps.nowFn ?? Date.now;
    const rawMaxRetries = deps.maxRetries ?? config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRetries = Math.max(0, Math.min(15, Math.floor(rawMaxRetries)));
    const rawRateLimitRetries =
      deps.maxRateLimitRetries ?? config?.rateLimitMaxRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES;
    this.maxRateLimitRetries = Math.max(0, Math.min(15, Math.floor(rawRateLimitRetries)));
    this.maxTotalDurationMs = Math.max(1_000, deps.maxTotalDurationMs ?? DEFAULT_MAX_TOTAL_DURATION_MS);
  }

  isConfigured(): boolean {
    return Boolean(this.config?.baseUrl && this.config.apiKey);
  }

  getDefaultModel(): string {
    return this.config?.model ?? '';
  }

  getFallbackModel(): string {
    return this.config?.fallbackModel?.trim() ?? '';
  }

  private async readSseStream(
    res: Response,
    timeoutMs: number,
    controller: AbortController,
    onTimedOut: () => void,
  ): Promise<{ content: string; model?: string; usage?: LlmUsage; finishReason?: string }> {
    const body = res.body;
    if (!body) {
      return { content: '' };
    }

    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    const idleTimeoutMs = Math.min(timeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS);
    const totalStreamTimeoutMs = Math.max(timeoutMs * 3, 180_000);

    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdleTimer = (): void => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        onTimedOut();
        controller.abort();
      }, idleTimeoutMs);
    };

    const totalTimer = setTimeout(() => {
      onTimedOut();
      controller.abort();
    }, totalStreamTimeoutMs);

    const contentParts: string[] = [];
    let resolvedModel: string | undefined;
    let usage: LlmUsage | undefined;
    let finishReason: string | undefined;
    let lineBuffer = '';
    let doneSeen = false;

    const processLine = (rawLine: string): void => {
      const line = rawLine.replace(/\r$/, '');
      if (!line.trim() || line.startsWith(':') || !line.startsWith('data:')) {
        return;
      }
      const payload = line.slice(5).trim();
      if (!payload) return;
      if (payload === '[DONE]') {
        doneSeen = true;
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      if (!isRecord(parsed)) return;

      if (isRecord(parsed.error)) {
        const status = extractSseErrorStatus(parsed.error);
        throw new SseUpstreamError(status, JSON.stringify({ error: parsed.error }));
      }

      if (typeof parsed.model === 'string' && parsed.model.trim()) {
        resolvedModel = parsed.model;
      }
      const frameUsage = extractUsage(parsed.usage);
      if (frameUsage) {
        usage = frameUsage;
      }

      const choices = parsed.choices;
      if (!Array.isArray(choices) || choices.length === 0) return;
      const first = choices[0];
      if (!isRecord(first)) return;

      if (typeof first.finish_reason === 'string' && first.finish_reason.trim()) {
        finishReason = first.finish_reason.trim();
      }

      if (isRecord(first.delta)) {
        const chunkText = extractTextFromContentField(first.delta.content);
        if (chunkText) {
          contentParts.push(chunkText);
        }
      } else if (isRecord(first.message)) {
        const msgText = extractTextFromContentField(first.message.content);
        if (msgText) {
          contentParts.push(msgText);
        }
      }
    };

    try {
      while (!doneSeen) {
        resetIdleTimer();
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';
          for (const line of lines) {
            processLine(line);
            if (doneSeen) break;
          }
        }
      }
      if (!doneSeen) {
        lineBuffer += decoder.decode();
        if (lineBuffer.trim()) {
          processLine(lineBuffer);
        }
      }
    } finally {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }
      if (totalTimer !== undefined) {
        clearTimeout(totalTimer);
      }
      reader.releaseLock();
    }

    return {
      content: contentParts.join('').trim(),
      model: resolvedModel,
      usage,
      finishReason,
    };
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
    const effectiveMaxRetries =
      request.maxRetries !== undefined
        ? Math.max(0, Math.min(this.maxRetries, Math.floor(request.maxRetries)))
        : this.maxRetries;
    const effectiveRateLimitCap = Math.min(effectiveMaxRetries, this.maxRateLimitRetries);
    const effectiveRefusalCap = Math.min(
      effectiveMaxRetries,
      Math.max(0, Math.floor(request.maxRefusalRetries ?? 0)),
    );
    const totalAttempts = effectiveMaxRetries + 1;
    const useStream = request.stream ?? true;
    const startedAt = this.nowFn();
    let rateLimitRetriesUsed = 0;
    let refusalRetriesUsed = 0;

    const canRetryAfterDelay = (attempt: number, delayMs: number): boolean => {
      if (attempt >= totalAttempts) return false;
      if (this.nowFn() - startedAt + delayMs > this.maxTotalDurationMs) return false;
      return true;
    };

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      const controller = new AbortController();
      let timedOut = false;
      let ttfbTimer: NodeJS.Timeout | undefined = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            stream: useStream,
            messages:
              refusalRetriesUsed > 0 && request.refusalRetryMessages
                ? request.refusalRetryMessages
                : request.messages,
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
            ...(request.topP !== undefined ? { top_p: request.topP } : {}),
            ...(request.frequencyPenalty !== undefined
              ? { frequency_penalty: request.frequencyPenalty }
              : {}),
            ...(request.presencePenalty !== undefined
              ? { presence_penalty: request.presencePenalty }
              : {}),
          }),
          signal: controller.signal,
        });

        clearTimeout(ttfbTimer);
        ttfbTimer = undefined;

        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          if (isRetryableHttpStatus(res.status, bodyText)) {
            if (res.status === 429) {
              if (rateLimitRetriesUsed < effectiveRateLimitCap) {
                const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'), this.nowFn());
                const delayMs = retryAfter ?? getFallbackDelayMs(attempt);
                if (canRetryAfterDelay(attempt, delayMs)) {
                  rateLimitRetriesUsed++;
                  await this.sleepFn(delayMs);
                  continue;
                }
              }
            } else {
              const delayMs = getFallbackDelayMs(attempt);
              if (canRetryAfterDelay(attempt, delayMs)) {
                await this.sleepFn(delayMs);
                continue;
              }
            }
          }
          throw mapHttpError(res.status, bodyText, attempt);
        }

        const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
        let extracted: { content: string; model?: string; usage?: LlmUsage; finishReason?: string };
        if (contentType.includes('text/event-stream') && res.body) {
          extracted = await this.readSseStream(res, timeoutMs, controller, () => {
            timedOut = true;
          });
        } else {
          let bodyTimer: NodeJS.Timeout | undefined = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, Math.min(timeoutMs, DEFAULT_STREAM_IDLE_TIMEOUT_MS));
          try {
            const json: unknown = await res.json();
            extracted = extractResponseContent(json);
          } finally {
            clearTimeout(bodyTimer);
            bodyTimer = undefined;
          }
        }

        const isValid =
          Boolean(extracted.content) &&
          (!request.validateContent || request.validateContent(extracted.content));
        if (!isValid) {
          const delayMs = Math.min(getFallbackDelayMs(attempt), EMPTY_RESPONSE_MAX_DELAY_MS);
          if (canRetryAfterDelay(attempt, delayMs)) {
            await this.sleepFn(delayMs);
            continue;
          }
          const finishPart = extracted.finishReason
            ? ` (finish_reason=${extracted.finishReason})`
            : '';
          throw new LlmError({
            code: 'empty_response',
            status: res.status,
            attempts: attempt,
            message: extracted.content
              ? `LLM returned empty content after CoT/output validation${finishPart}`
              : `LLM returned empty content${finishPart}`,
            userMessage: 'AI 返回了空内容，已自动重试仍为空，请换个问法或稍后再试。',
          });
        }

        if (request.isRefusalContent && request.isRefusalContent(extracted.content)) {
          if (refusalRetriesUsed < effectiveRefusalCap) {
            const delayMs = Math.min(getFallbackDelayMs(attempt), EMPTY_RESPONSE_MAX_DELAY_MS);
            if (canRetryAfterDelay(attempt, delayMs)) {
              refusalRetriesUsed++;
              await this.sleepFn(delayMs);
              continue;
            }
          }
          throw new LlmError({
            code: 'content_refusal',
            status: res.status,
            attempts: attempt,
            message: `LLM returned safety policy refusal: ${extracted.content.slice(0, 200)}`,
            userMessage: 'AI 触发了上游内容安全拦截，主备模型均无法生成回复，请换个表达方式再试。',
          });
        }

        return {
          content: extracted.content,
          model: extracted.model ?? model,
          attempts: attempt,
          ...(extracted.usage ? { usage: extracted.usage } : {}),
        };
      } catch (err) {
        if (ttfbTimer !== undefined) {
          clearTimeout(ttfbTimer);
          ttfbTimer = undefined;
        }
        if (err instanceof LlmError) {
          throw err;
        }
        if (err instanceof SseUpstreamError) {
          if (isRetryableHttpStatus(err.status, err.bodyText)) {
            if (err.status === 429) {
              if (rateLimitRetriesUsed < effectiveRateLimitCap) {
                const delayMs = getFallbackDelayMs(attempt);
                if (canRetryAfterDelay(attempt, delayMs)) {
                  rateLimitRetriesUsed++;
                  await this.sleepFn(delayMs);
                  continue;
                }
              }
            } else {
              const delayMs = getFallbackDelayMs(attempt);
              if (canRetryAfterDelay(attempt, delayMs)) {
                await this.sleepFn(delayMs);
                continue;
              }
            }
          }
          throw mapHttpError(err.status, err.bodyText, attempt);
        }

        const isTimedOut = timedOut || isTimeoutError(err);
        const delayMs = getFallbackDelayMs(attempt);
        if (canRetryAfterDelay(attempt, delayMs)) {
          await this.sleepFn(delayMs);
          continue;
        }
        if (isTimedOut) {
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
