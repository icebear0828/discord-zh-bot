import type { ImageAspectRatio } from '../config/defaults.js';
import type { ImageEnvConfig } from '../config/env.js';

export type ImageErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'service_unavailable'
  | 'timeout'
  | 'auth_error'
  | 'bad_request'
  | 'network_error'
  | 'empty_response'
  | 'unknown';

export class ImageApiError extends Error {
  readonly code: ImageErrorCode;
  readonly status?: number;
  readonly attempts: number;
  readonly userMessage: string;

  constructor(params: {
    code: ImageErrorCode;
    message: string;
    userMessage: string;
    attempts: number;
    status?: number;
  }) {
    super(params.message);
    this.name = 'ImageApiError';
    this.code = params.code;
    this.status = params.status;
    this.attempts = params.attempts;
    this.userMessage = params.userMessage;
  }
}

export interface NaiCharCaptionCenter {
  x: number;
  y: number;
}

export interface NaiCharCaption {
  char_caption: string;
  uc?: string;
  centers?: readonly NaiCharCaptionCenter[];
}

export interface ImageGalleryMeta {
  source: 'discord-draw' | 'discord-selfie';
  authorId?: string;
  authorName?: string;
  authorAvatar?: string;
  rawPrompt?: string;
  skip?: boolean;
}

export interface ImageGenerateRequest {
  model?: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: ImageAspectRatio;
  steps: number;
  scale: number;
  cfgRescale?: number;
  seed?: number;
  charCaptions?: readonly NaiCharCaption[];
  useCoords?: boolean;
  timeoutMs?: number;
  galleryMeta?: ImageGalleryMeta;
}

export interface ImageGenerateResponse {
  buffer: Buffer;
  model: string;
  attempts: number;
}

export interface ImageClientDeps {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

const RETRY_DELAYS_MS = [1200, 2500, 4000, 6000, 8000] as const;

export function resolveImagesGenerationsUrl(baseUrl: string): string {
  const cleaned = baseUrl.trim().replace(/\/+$/, '');
  if (cleaned.endsWith('/images/generations')) {
    return cleaned;
  }
  return `${cleaned}/images/generations`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number, bodyText: string): boolean {
  if (status === 429 || status === 408 || status === 409 || status === 425 || status >= 500) {
    return true;
  }
  const lower = bodyText.toLowerCase();
  if (
    (status === 400 || status === 401 || status === 403) &&
    (lower.includes('upstream_http_error') ||
      lower.includes('upstream error') ||
      lower.includes('no available account') ||
      lower.includes('channel_error'))
  ) {
    return true;
  }
  return false;
}

function mapHttpStatusToError(
  status: number,
  bodyText: string,
  attempts: number,
): ImageApiError {
  if (status === 429) {
    return new ImageApiError({
      code: 'rate_limited',
      status,
      attempts,
      message: `Image API rate limited (429): ${bodyText.slice(0, 200)}`,
      userMessage: '生图接口当前限流较忙，请稍后再试。',
    });
  }
  if (status === 401 || status === 403) {
    return new ImageApiError({
      code: 'auth_error',
      status,
      attempts,
      message: `Image API auth failed (${status}): ${bodyText.slice(0, 200)}`,
      userMessage: '生图服务鉴权失败，请联系管理员检查 IMAGE_API_KEY 配置。',
    });
  }
  if (status === 400 || status === 422) {
    return new ImageApiError({
      code: 'bad_request',
      status,
      attempts,
      message: `Image API bad request (${status}): ${bodyText.slice(0, 250)}`,
      userMessage: '生图请求参数或提示词被上游拒绝，请调整提示词或参数后重试。',
    });
  }
  if (status >= 500) {
    return new ImageApiError({
      code: 'service_unavailable',
      status,
      attempts,
      message: `Image API server error (${status}): ${bodyText.slice(0, 200)}`,
      userMessage: '生图服务暂时不可用，请稍后重试。',
    });
  }
  return new ImageApiError({
    code: 'unknown',
    status,
    attempts,
    message: `Image API HTTP ${status}: ${bodyText.slice(0, 200)}`,
    userMessage: '生图服务返回未知错误，请稍后重试。',
  });
}

function extractImageDataItem(parsed: unknown): { b64?: string; url?: string } {
  if (!isRecord(parsed)) return {};
  const data = parsed['data'];
  if (!Array.isArray(data) || data.length === 0) return {};
  const first = data[0];
  if (!isRecord(first)) return {};
  const b64 = typeof first['b64_json'] === 'string' && first['b64_json'].trim()
    ? first['b64_json'].trim()
    : undefined;
  const url = typeof first['url'] === 'string' && first['url'].trim()
    ? first['url'].trim()
    : undefined;
  return { ...(b64 ? { b64 } : {}), ...(url ? { url } : {}) };
}

function decodeBase64Image(raw: string): Buffer {
  const cleaned = raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i, '').trim();
  return Buffer.from(cleaned, 'base64');
}

export class ImageClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    private readonly config: ImageEnvConfig | undefined,
    deps?: ImageClientDeps,
  ) {
    this.fetchFn = deps?.fetchFn ?? fetch;
    this.sleepFn = deps?.sleepFn ?? defaultSleep;
  }

  isConfigured(): boolean {
    return Boolean(this.config?.baseUrl && this.config?.apiKey);
  }

  getDefaultModel(): string {
    return this.config?.model ?? '';
  }

  getGalleryUrl(): string | undefined {
    return this.config?.galleryUrl;
  }

  async generate(request: ImageGenerateRequest): Promise<ImageGenerateResponse> {
    if (!this.config || !this.config.baseUrl || !this.config.apiKey) {
      throw new ImageApiError({
        code: 'not_configured',
        attempts: 0,
        message: 'Image API not configured',
        userMessage: '生图服务尚未配置完成，请联系管理员检查环境变量。',
      });
    }

    const model = (request.model ?? this.config.model).trim();
    if (!model) {
      throw new ImageApiError({
        code: 'not_configured',
        attempts: 0,
        message: 'Image model not configured',
        userMessage: '未配置默认生图模型，请联系管理员设置 IMAGE_MODEL。',
      });
    }

    const url = resolveImagesGenerationsUrl(this.config.baseUrl);
    const timeoutMs = request.timeoutMs ?? this.config.timeoutMs;
    const maxRetries = Math.max(0, Math.min(8, this.config.maxRetries));

    const payload: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      aspect_ratio: request.aspectRatio,
      steps: Math.round(request.steps),
      scale: Number(request.scale),
    };
    const neg = request.negativePrompt?.trim();
    if (neg) {
      payload['negative_prompt'] = neg;
    }
    if (
      request.cfgRescale !== undefined &&
      Number.isFinite(request.cfgRescale) &&
      request.cfgRescale > 0
    ) {
      payload['cfg_rescale'] = Number(Math.max(0, Math.min(1.0, request.cfgRescale)).toFixed(2));
    }
    if (request.seed !== undefined && Number.isInteger(request.seed) && request.seed >= 0) {
      payload['seed'] = request.seed;
    }
    if (request.charCaptions && request.charCaptions.length > 0) {
      payload['char_captions'] = request.charCaptions.map((item) => ({
        char_caption: item.char_caption,
        ...(item.uc?.trim() ? { uc: item.uc.trim() } : {}),
        ...(item.centers && item.centers.length > 0 ? { centers: item.centers } : {}),
      }));
    }
    if (request.useCoords === true) {
      payload['use_coords'] = true;
    }

    let lastErr: ImageApiError | null = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        };
        if (request.galleryMeta) {
          const gm = request.galleryMeta;
          if (gm.skip) {
            headers['X-Gallery-Skip'] = '1';
          } else {
            headers['X-Gallery-Source'] = gm.source;
            if (gm.authorId?.trim()) {
              headers['X-Gallery-Author-Id'] = encodeURIComponent(gm.authorId.trim());
            }
            if (gm.authorName?.trim()) {
              headers['X-Gallery-Author-Name'] = encodeURIComponent(gm.authorName.trim().slice(0, 80));
            }
            if (gm.authorAvatar?.trim()) {
              headers['X-Gallery-Author-Avatar'] = encodeURIComponent(gm.authorAvatar.trim().slice(0, 500));
            }
            if (gm.rawPrompt?.trim()) {
              headers['X-Gallery-Raw-Prompt'] = encodeURIComponent(gm.rawPrompt.trim().slice(0, 1500));
            }
          }
        }

        const res = await this.fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const bodyText = await res.text();
        if (!res.ok) {
          const err = mapHttpStatusToError(res.status, bodyText, attempt);
          if (attempt <= maxRetries && isRetryableStatus(res.status, bodyText)) {
            lastErr = err;
            const delayMs = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
            await this.sleepFn(delayMs);
            continue;
          }
          throw err;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(bodyText);
        } catch {
          throw new ImageApiError({
            code: 'empty_response',
            attempts: attempt,
            message: `Invalid JSON from image API: ${bodyText.slice(0, 180)}`,
            userMessage: '生图接口返回格式异常，请稍后重试。',
          });
        }

        const item = extractImageDataItem(parsed);
        let buffer: Buffer | null = null;

        if (item.b64) {
          buffer = decodeBase64Image(item.b64);
        } else if (item.url) {
          const imgRes = await this.fetchFn(item.url, { signal: controller.signal });
          if (!imgRes.ok) {
            throw new ImageApiError({
              code: 'network_error',
              status: imgRes.status,
              attempts: attempt,
              message: `Failed to download image URL (${imgRes.status})`,
              userMessage: '拉取生成图片文件失败，请稍后重试。',
            });
          }
          buffer = Buffer.from(await imgRes.arrayBuffer());
        }

        if (!buffer || buffer.length === 0) {
          const err = new ImageApiError({
            code: 'empty_response',
            attempts: attempt,
            message: 'Image API returned empty image payload',
            userMessage: '生图模型返回空图片，请稍后重试。',
          });
          if (attempt <= maxRetries) {
            lastErr = err;
            await this.sleepFn(1500);
            continue;
          }
          throw err;
        }

        return {
          buffer,
          model,
          attempts: attempt,
        };
      } catch (err) {
        if (err instanceof ImageApiError) {
          if (
            attempt <= maxRetries &&
            (err.code === 'network_error' ||
              err.code === 'empty_response' ||
              err.code === 'service_unavailable' ||
              err.code === 'rate_limited')
          ) {
            lastErr = err;
            const delayMs = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
            await this.sleepFn(delayMs);
            continue;
          }
          throw err;
        }

        const isAbort = err instanceof Error && err.name === 'AbortError';
        const wrapped = new ImageApiError({
          code: isAbort ? 'timeout' : 'network_error',
          attempts: attempt,
          message: err instanceof Error ? err.message : String(err),
          userMessage: isAbort ? '生图请求超时，请稍后重试。' : '连接生图服务失败，请稍后重试。',
        });
        if (attempt <= maxRetries) {
          lastErr = wrapped;
          const delayMs = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
          await this.sleepFn(delayMs);
          continue;
        }
        throw wrapped;
      } finally {
        clearTimeout(timer);
      }
    }

    throw (
      lastErr ??
      new ImageApiError({
        code: 'unknown',
        attempts: maxRetries + 1,
        message: 'Unknown image generation failure',
        userMessage: '生图服务异常，请稍后重试。',
      })
    );
  }
}
