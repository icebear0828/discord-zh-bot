import {
  MAX_IMAGE_BATCH_COUNT,
  MAX_IMAGE_STEPS,
  VALID_IMAGE_ASPECT_RATIOS,
  type GuildConfig,
  type ImageAspectRatio,
  type ImageGenConfig,
} from '../config/defaults.js';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type {
  ImageGenerationRecord,
  ImageRepo,
  ImageUsageSummary,
  ImageUserPrefs,
  ImageUserPrefsPatch,
} from '../db/repositories/imageRepo.js';
import {
  ImageApiError,
  ImageClient,
  type ImageErrorCode,
  type NaiCharCaption,
} from './imageClient.js';
import {
  DefaultImagePromptProcessor,
  type ImagePromptProcessor,
} from './imagePromptProcessor.js';

export type ImageServiceErrorCode =
  | ImageErrorCode
  | 'module_disabled'
  | 'channel_ignored'
  | 'channel_not_allowed'
  | 'cooldown'
  | 'queue_full'
  | 'invalid_prompt';

export interface GenerateImageInput {
  guildId: string;
  channelId: string;
  userId: string;
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  negativePrompt?: string;
  steps?: number;
  scale?: number;
  cfgRescale?: number;
  seed?: number | null;
  charCaptions?: readonly NaiCharCaption[];
  rawCharacterPrompt?: string;
  useCoords?: boolean;
  spoiler?: boolean;
  ephemeral?: boolean;
  isAdmin?: boolean;
}

export interface GenerateImageBatchInput extends GenerateImageInput {
  count?: number;
  onProgress?: (completed: number, total: number) => Promise<void> | void;
}

export interface ImageBatchItem {
  buffer: Buffer;
  record: ImageGenerationRecord;
  attempts: number;
}

export type GenerateImageBatchResult =
  | {
      ok: true;
      items: ImageBatchItem[];
      requestedCount: number;
      failedCount: number;
      lastErrorMessage?: string;
    }
  | {
      ok: false;
      errorCode: ImageServiceErrorCode;
      errorMessage: string;
      errorDetail?: string;
      retryAfterSec?: number;
    };

export type GenerateImageResult =
  | {
      ok: true;
      buffer: Buffer;
      record: ImageGenerationRecord;
      attempts: number;
    }
  | {
      ok: false;
      errorCode: ImageServiceErrorCode;
      errorMessage: string;
      errorDetail?: string;
      retryAfterSec?: number;
    };

export interface ImageQueueSnapshot {
  running: number;
  pending: number;
}

export interface ImageServiceDeps {
  sleepFn?: (ms: number) => Promise<void>;
  randomDelayMsFn?: () => number;
}

interface QueuedImageJob {
  run: () => Promise<void>;
}

const MAX_PROMPT_LENGTH = 4000;
const MAX_CHAR_PROMPT_LENGTH = 3000;
const MAX_NEGATIVE_PROMPT_LENGTH = 1000;
const MAX_SEED_VALUE = 2_147_483_647;
const FATAL_ERROR_CODES: ReadonlySet<ImageErrorCode> = new Set([
  'not_configured',
  'auth_error',
  'bad_request',
]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultRandomDelayMs(): number {
  return 1000 + Math.floor(Math.random() * 2001);
}

export function isValidImageAspectRatio(value: string): value is ImageAspectRatio {
  return (VALID_IMAGE_ASPECT_RATIOS as readonly string[]).includes(value);
}

export class ImageService {
  private readonly userLastRunAt = new Map<string, number>();
  private readonly queue: QueuedImageJob[] = [];
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly randomDelayMsFn: () => number;
  private activeCount = 0;

  constructor(
    private readonly guildConfigRepo: GuildConfigRepo,
    private readonly imageRepo: ImageRepo,
    private readonly imageClient: ImageClient,
    private promptProcessor: ImagePromptProcessor = new DefaultImagePromptProcessor(),
    deps?: ImageServiceDeps,
  ) {
    this.sleepFn = deps?.sleepFn ?? defaultSleep;
    this.randomDelayMsFn = deps?.randomDelayMsFn ?? defaultRandomDelayMs;
  }

  setPromptProcessor(processor: ImagePromptProcessor): void {
    this.promptProcessor = processor;
  }

  isConfigured(): boolean {
    return this.imageClient.isConfigured();
  }

  getDefaultModel(): string {
    return this.imageClient.getDefaultModel();
  }

  getEffectiveConfig(guildId: string): { cfg: GuildConfig; imageCfg: ImageGenConfig } {
    const cfg = this.guildConfigRepo.getOrCreate(guildId);
    return { cfg, imageCfg: cfg.imageGen };
  }

  getQueueSnapshot(): ImageQueueSnapshot {
    return { running: this.activeCount, pending: this.queue.length };
  }

  getUsageSummary(guildId: string, hours = 24): ImageUsageSummary {
    const safeHours = Math.max(1, Math.min(720, Math.floor(hours)));
    const sinceMs = Date.now() - safeHours * 3_600_000;
    return this.imageRepo.getUsageSummary(guildId, sinceMs);
  }

  listRecent(guildId: string, limit = 10): ImageGenerationRecord[] {
    return this.imageRepo.listRecent(guildId, limit);
  }

  listUserRecent(guildId: string, userId: string, limit = 15): ImageGenerationRecord[] {
    return this.imageRepo.listByUser(guildId, userId, limit);
  }

  getUserPrefs(guildId: string, userId: string): ImageUserPrefs {
    return this.imageRepo.getUserPrefs(guildId, userId);
  }

  updateUserPrefs(
    guildId: string,
    userId: string,
    patch: ImageUserPrefsPatch,
  ): ImageUserPrefs {
    return this.imageRepo.upsertUserPrefs(guildId, userId, patch);
  }

  resetUserPrefs(guildId: string, userId: string): void {
    this.imageRepo.resetUserPrefs(guildId, userId);
  }

  getUserCooldownRemainingSec(guildId: string, userId: string, isAdmin = false): number {
    if (isAdmin) return 0;
    const { imageCfg } = this.getEffectiveConfig(guildId);
    const cooldownMs = Math.max(0, imageCfg.cooldownSec * 1000);
    if (cooldownMs <= 0) return 0;
    const prev = this.userLastRunAt.get(`${guildId}:${userId}`);
    if (prev === undefined) return 0;
    const remainingMs = cooldownMs - (Date.now() - prev);
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  getRecordById(id: number): ImageGenerationRecord | null {
    return this.imageRepo.getById(id);
  }

  private pruneCooldowns(nowMs: number, maxCooldownMs: number): void {
    if (this.userLastRunAt.size <= 1000) return;
    for (const [key, ts] of this.userLastRunAt.entries()) {
      if (nowMs - ts >= maxCooldownMs) {
        this.userLastRunAt.delete(key);
      }
    }
  }

  private checkChannelAllowed(
    cfg: GuildConfig,
    channelId: string,
  ): { ok: true } | { ok: false; errorCode: ImageServiceErrorCode; errorMessage: string } {
    if (!cfg.modules.imageGen) {
      return {
        ok: false,
        errorCode: 'module_disabled',
        errorMessage: '当前服务器已关闭 **AI 绘图** 模块，请联系管理员开启。',
      };
    }
    if (cfg.imageGen.ignoredChannelIds.includes(channelId)) {
      return {
        ok: false,
        errorCode: 'channel_ignored',
        errorMessage: '当前频道已被管理员设置为禁用 AI 生图。',
      };
    }
    if (
      cfg.imageGen.allowedChannelIds.length > 0 &&
      !cfg.imageGen.allowedChannelIds.includes(channelId)
    ) {
      const allowedList = cfg.imageGen.allowedChannelIds.map((id) => `<#${id}>`).join('、');
      return {
        ok: false,
        errorCode: 'channel_not_allowed',
        errorMessage: `当前频道未开放 AI 生图，请前往指定频道使用：${allowedList}`,
      };
    }
    return { ok: true };
  }

  precheckRequest(params: {
    guildId: string;
    channelId: string;
    userId: string;
    isAdmin?: boolean;
  }):
    | { ok: true }
    | { ok: false; errorCode: ImageServiceErrorCode; errorMessage: string; retryAfterSec?: number } {
    if (!this.imageClient.isConfigured()) {
      return {
        ok: false,
        errorCode: 'not_configured',
        errorMessage: '生图服务尚未配置完成，请联系管理员检查环境变量。',
      };
    }

    const { cfg, imageCfg } = this.getEffectiveConfig(params.guildId);
    const channelCheck = this.checkChannelAllowed(cfg, params.channelId);
    if (!channelCheck.ok) {
      return channelCheck;
    }

    const nowMs = Date.now();
    const cooldownKey = `${params.guildId}:${params.userId}`;
    const cooldownMs = Math.max(0, imageCfg.cooldownSec * 1000);
    const prevTimestamp = this.userLastRunAt.get(cooldownKey);

    if (!params.isAdmin && cooldownMs > 0 && prevTimestamp !== undefined) {
      const elapsed = nowMs - prevTimestamp;
      if (elapsed < cooldownMs) {
        const retryAfterSec = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
        return {
          ok: false,
          errorCode: 'cooldown',
          retryAfterSec,
          errorMessage: `画师还在喘气中，请等待 **${retryAfterSec} 秒**后再试。`,
        };
      }
    }

    const maxConcurrency = Math.max(1, Math.min(5, imageCfg.maxConcurrency));
    const maxPending = Math.max(1, Math.min(20, imageCfg.maxPendingQueue));
    if (this.activeCount >= maxConcurrency && this.queue.length >= maxPending) {
      return {
        ok: false,
        errorCode: 'queue_full',
        errorMessage: `当前生图排队已满（正在生成 ${this.activeCount} 张 / 排队 ${this.queue.length} 张），请稍后再试。`,
      };
    }

    return { ok: true };
  }

  private drainQueue(maxConcurrency: number): void {
    const limit = Math.max(1, Math.min(5, Math.floor(maxConcurrency)));
    while (this.activeCount < limit && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) continue;
      this.activeCount++;
      void next.run().finally(() => {
        this.activeCount = Math.max(0, this.activeCount - 1);
        const latestLimit = Math.max(1, Math.min(5, Math.floor(maxConcurrency)));
        this.drainQueue(latestLimit);
      });
    }
  }

  private rollbackCooldown(
    cooldownKey: string,
    runTimestamp: number,
    prevTimestamp: number | undefined,
  ): void {
    if (this.userLastRunAt.get(cooldownKey) === runTimestamp) {
      if (prevTimestamp !== undefined) {
        this.userLastRunAt.set(cooldownKey, prevTimestamp);
      } else {
        this.userLastRunAt.delete(cooldownKey);
      }
    }
  }

  async generateBatch(input: GenerateImageBatchInput): Promise<GenerateImageBatchResult> {
    if (!this.imageClient.isConfigured()) {
      return {
        ok: false,
        errorCode: 'not_configured',
        errorMessage: '生图服务尚未配置完成，请联系管理员检查环境变量。',
      };
    }

    const rawPrompt = input.prompt.trim().slice(0, MAX_PROMPT_LENGTH);
    if (!rawPrompt) {
      return {
        ok: false,
        errorCode: 'invalid_prompt',
        errorMessage: '提示词不能为空，请描述你想要生成的画面内容。',
      };
    }

    const { cfg, imageCfg } = this.getEffectiveConfig(input.guildId);
    const channelCheck = this.checkChannelAllowed(cfg, input.channelId);
    if (!channelCheck.ok) {
      return channelCheck;
    }

    const nowMs = Date.now();
    const cooldownKey = `${input.guildId}:${input.userId}`;
    const cooldownMs = Math.max(0, imageCfg.cooldownSec * 1000);
    const prevTimestamp = this.userLastRunAt.get(cooldownKey);

    if (!input.isAdmin && cooldownMs > 0 && prevTimestamp !== undefined) {
      const elapsed = nowMs - prevTimestamp;
      if (elapsed < cooldownMs) {
        const retryAfterSec = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
        return {
          ok: false,
          errorCode: 'cooldown',
          retryAfterSec,
          errorMessage: `画师还在喘气中，请等待 **${retryAfterSec} 秒**后再试。`,
        };
      }
    }

    const maxConcurrency = Math.max(1, Math.min(5, imageCfg.maxConcurrency));
    const maxPending = Math.max(1, Math.min(20, imageCfg.maxPendingQueue));
    if (this.activeCount >= maxConcurrency && this.queue.length >= maxPending) {
      return {
        ok: false,
        errorCode: 'queue_full',
        errorMessage: `当前生图排队已满（正在生成 ${this.activeCount} 张 / 排队 ${this.queue.length} 张），请稍后再试。`,
      };
    }

    this.pruneCooldowns(nowMs, Math.max(60_000, cooldownMs));
    this.userLastRunAt.set(cooldownKey, nowMs);

    const userPrefs = this.imageRepo.getUserPrefs(input.guildId, input.userId);
    const requestedCount = Math.max(
      1,
      Math.min(MAX_IMAGE_BATCH_COUNT, Math.round(input.count ?? userPrefs.batchCount ?? 1)),
    );
    const aspectRatio =
      input.aspectRatio && isValidImageAspectRatio(input.aspectRatio)
        ? input.aspectRatio
        : (userPrefs.aspectRatio ?? imageCfg.defaultAspectRatio);
    const steps = Math.max(
      1,
      Math.min(MAX_IMAGE_STEPS, Math.round(input.steps ?? userPrefs.steps ?? imageCfg.defaultSteps)),
    );
    const scale = Math.max(
      1.0,
      Math.min(10.0, Number((input.scale ?? userPrefs.scale ?? imageCfg.defaultScale).toFixed(1))),
    );
    const cfgRescale = Math.max(
      0,
      Math.min(1.0, Number((input.cfgRescale ?? imageCfg.defaultCfgRescale).toFixed(2))),
    );
    const rawUserNeg =
      input.negativePrompt !== undefined ? input.negativePrompt : userPrefs.negativePrompt;
    const userNeg = rawUserNeg.trim().slice(0, MAX_NEGATIVE_PROMPT_LENGTH);
    const baseSeed =
      input.seed !== undefined &&
      input.seed !== null &&
      Number.isInteger(input.seed) &&
      input.seed >= 0
        ? Math.min(MAX_SEED_VALUE, input.seed)
        : null;
    const spoiler = Boolean(
      imageCfg.forceSpoiler || (input.spoiler !== undefined ? input.spoiler : userPrefs.spoiler),
    );
    const ephemeral = Boolean(
      input.ephemeral !== undefined ? input.ephemeral : userPrefs.ephemeral,
    );
    const effectiveModel = imageCfg.modelOverride?.trim() || this.imageClient.getDefaultModel();

    return new Promise<GenerateImageBatchResult>((resolve) => {
      const execute = async (): Promise<void> => {
        let effectiveRawPrompt = rawPrompt;
        let finalPrompt = rawPrompt;
        let finalNegativePrompt = userNeg;
        let finalCharCaptions: NaiCharCaption[] = input.charCaptions
          ? [...input.charCaptions]
          : [];
        let finalUseCoords = Boolean(input.useCoords);
        const rawCharPrompt = input.rawCharacterPrompt?.trim().slice(0, MAX_CHAR_PROMPT_LENGTH);

        try {
          const processed = await this.promptProcessor.process({
            rawPrompt,
            userNegativePrompt: userNeg,
            defaultPositivePrompt: imageCfg.defaultPositivePrompt,
            defaultNegativePrompt: imageCfg.defaultNegativePrompt,
            ...(input.charCaptions && input.charCaptions.length > 0
              ? { charCaptions: input.charCaptions }
              : {}),
            ...(rawCharPrompt ? { rawCharacterPrompt: rawCharPrompt } : {}),
            ...(input.useCoords !== undefined ? { useCoords: input.useCoords } : {}),
          });
          if (processed.effectiveRawPrompt?.trim()) {
            effectiveRawPrompt = processed.effectiveRawPrompt.trim();
          }
          finalPrompt = processed.finalPrompt || effectiveRawPrompt;
          finalNegativePrompt = processed.finalNegativePrompt;
          if (processed.charCaptions !== undefined) {
            finalCharCaptions = processed.charCaptions;
          }
          if (processed.useCoords !== undefined) {
            finalUseCoords = processed.useCoords;
          }
        } catch (err) {
          this.rollbackCooldown(cooldownKey, nowMs, prevTimestamp);
          const apiErr =
            err instanceof ImageApiError
              ? err
              : new ImageApiError({
                  code: 'unknown',
                  attempts: 1,
                  message: err instanceof Error ? err.message : String(err),
                  userMessage: '生图提示词处理异常，请稍后重试。',
                });
          resolve({
            ok: false,
            errorCode: apiErr.code,
            errorMessage: apiErr.userMessage,
            errorDetail: apiErr.message,
          });
          return;
        }

        const items: ImageBatchItem[] = [];
        let failedCount = 0;
        let lastApiErr: ImageApiError | null = null;

        for (let i = 0; i < requestedCount; i++) {
          if (i > 0) {
            const delayMs = Math.max(0, Math.round(this.randomDelayMsFn()));
            await this.sleepFn(delayMs);
          }

          const itemSeed = baseSeed !== null ? (baseSeed + i) % MAX_SEED_VALUE : null;
          const itemStart = Date.now();

          try {
            const genRes = await this.imageClient.generate({
              model: effectiveModel || undefined,
              prompt: finalPrompt,
              negativePrompt: finalNegativePrompt || undefined,
              aspectRatio,
              steps,
              scale,
              cfgRescale,
              seed: itemSeed ?? undefined,
              charCaptions: finalCharCaptions.length > 0 ? finalCharCaptions : undefined,
              useCoords: finalUseCoords ? true : undefined,
            });

            const latencyMs = Math.max(0, Date.now() - itemStart);
            const record = this.imageRepo.create({
              guildId: input.guildId,
              channelId: input.channelId,
              userId: input.userId,
              rawPrompt: effectiveRawPrompt,
              finalPrompt,
              negativePrompt: finalNegativePrompt,
              charCaptions: finalCharCaptions,
              useCoords: finalUseCoords,
              aspectRatio,
              steps,
              scale,
              seed: itemSeed,
              spoiler,
              ephemeral,
              model: genRes.model,
              status: 'ok',
              errorCode: null,
              latencyMs,
            });

            items.push({
              buffer: genRes.buffer,
              record,
              attempts: genRes.attempts,
            });

            if (input.onProgress && i + 1 < requestedCount) {
              try {
                await input.onProgress(i + 1, requestedCount);
              } catch {
                // Do not abort batch generation if transient progress edit fails
              }
            }
          } catch (err) {
            const latencyMs = Math.max(0, Date.now() - itemStart);
            const apiErr =
              err instanceof ImageApiError
                ? err
                : new ImageApiError({
                    code: 'unknown',
                    attempts: 1,
                    message: err instanceof Error ? err.message : String(err),
                    userMessage: '生图服务发生异常，请稍后重试。',
                  });

            lastApiErr = apiErr;
            failedCount += 1;

            try {
              this.imageRepo.create({
                guildId: input.guildId,
                channelId: input.channelId,
                userId: input.userId,
                rawPrompt: effectiveRawPrompt,
                finalPrompt,
                negativePrompt: finalNegativePrompt,
                charCaptions: finalCharCaptions,
                useCoords: finalUseCoords,
                aspectRatio,
                steps,
                scale,
                seed: itemSeed,
                spoiler,
                ephemeral,
                model: effectiveModel || 'unknown',
                status: 'error',
                errorCode: apiErr.code,
                latencyMs,
              });
            } catch {
              // Best-effort logging
            }

            if (FATAL_ERROR_CODES.has(apiErr.code)) {
              failedCount = requestedCount - items.length;
              break;
            }
          }
        }

        if (items.length > 0) {
          resolve({
            ok: true,
            items,
            requestedCount,
            failedCount,
            ...(lastApiErr ? { lastErrorMessage: lastApiErr.userMessage } : {}),
          });
          return;
        }

        this.rollbackCooldown(cooldownKey, nowMs, prevTimestamp);
        const finalErr =
          lastApiErr ??
          new ImageApiError({
            code: 'unknown',
            attempts: 1,
            message: 'Unknown batch image generation failure',
            userMessage: '生图服务异常，请稍后重试。',
          });
        resolve({
          ok: false,
          errorCode: finalErr.code,
          errorMessage: finalErr.userMessage,
          errorDetail: finalErr.message,
        });
      };

      this.queue.push({ run: execute });
      this.drainQueue(maxConcurrency);
    });
  }

  async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
    const res = await this.generateBatch({ ...input, count: 1 });
    if (!res.ok) {
      return res;
    }
    const first = res.items[0];
    if (!first) {
      return {
        ok: false,
        errorCode: 'unknown',
        errorMessage: '生图服务返回空结果，请稍后重试。',
      };
    }
    return {
      ok: true,
      buffer: first.buffer,
      record: first.record,
      attempts: first.attempts,
    };
  }
}
