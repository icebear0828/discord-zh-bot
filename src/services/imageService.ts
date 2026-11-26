import {
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
import { ImageApiError, ImageClient, type ImageErrorCode } from './imageClient.js';
import {
  LiteralTranslationPromptProcessor,
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
  seed?: number | null;
  spoiler?: boolean;
  ephemeral?: boolean;
  isAdmin?: boolean;
}

export type GenerateImageResult =
  | {
      ok: true;
      buffer: Buffer;
      record: ImageGenerationRecord;
      translated: boolean;
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

interface QueuedImageJob {
  run: () => Promise<void>;
}

const MAX_PROMPT_LENGTH = 1500;
const MAX_NEGATIVE_PROMPT_LENGTH = 1000;

export function isValidImageAspectRatio(value: string): value is ImageAspectRatio {
  return (VALID_IMAGE_ASPECT_RATIOS as readonly string[]).includes(value);
}

export class ImageService {
  private readonly userLastRunAt = new Map<string, number>();
  private readonly queue: QueuedImageJob[] = [];
  private activeCount = 0;

  constructor(
    private readonly guildConfigRepo: GuildConfigRepo,
    private readonly imageRepo: ImageRepo,
    private readonly imageClient: ImageClient,
    private promptProcessor: ImagePromptProcessor = new LiteralTranslationPromptProcessor(),
  ) {}

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

  async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
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
    const aspectRatio =
      input.aspectRatio && isValidImageAspectRatio(input.aspectRatio)
        ? input.aspectRatio
        : (userPrefs.aspectRatio ?? imageCfg.defaultAspectRatio);
    const steps = Math.max(
      1,
      Math.min(50, Math.round(input.steps ?? userPrefs.steps ?? imageCfg.defaultSteps)),
    );
    const scale = Math.max(
      1.0,
      Math.min(10.0, Number((input.scale ?? userPrefs.scale ?? imageCfg.defaultScale).toFixed(1))),
    );
    const rawUserNeg =
      input.negativePrompt !== undefined ? input.negativePrompt : userPrefs.negativePrompt;
    const userNeg = rawUserNeg.trim().slice(0, MAX_NEGATIVE_PROMPT_LENGTH);
    const seed =
      input.seed !== undefined &&
      input.seed !== null &&
      Number.isInteger(input.seed) &&
      input.seed >= 0
        ? input.seed
        : null;
    const spoiler = Boolean(
      imageCfg.forceSpoiler || (input.spoiler !== undefined ? input.spoiler : userPrefs.spoiler),
    );
    const ephemeral = Boolean(
      input.ephemeral !== undefined ? input.ephemeral : userPrefs.ephemeral,
    );
    const effectiveModel = imageCfg.modelOverride?.trim() || this.imageClient.getDefaultModel();

    return new Promise<GenerateImageResult>((resolve) => {
      const execute = async (): Promise<void> => {
        const startedAt = Date.now();
        let finalPrompt = rawPrompt;
        let finalNegativePrompt = userNeg;
        let translated = false;

        try {
          const processed = await this.promptProcessor.process({
            rawPrompt,
            userNegativePrompt: userNeg,
            defaultPositivePrompt: imageCfg.defaultPositivePrompt,
            defaultNegativePrompt: imageCfg.defaultNegativePrompt,
            translateChinese: imageCfg.translateChinese,
            translatorModel: imageCfg.translatorModel,
          });
          finalPrompt = processed.finalPrompt || rawPrompt;
          finalNegativePrompt = processed.finalNegativePrompt;
          translated = processed.translated;

          const genRes = await this.imageClient.generate({
            model: effectiveModel || undefined,
            prompt: finalPrompt,
            negativePrompt: finalNegativePrompt || undefined,
            aspectRatio,
            steps,
            scale,
            seed: seed ?? undefined,
          });

          const latencyMs = Math.max(0, Date.now() - startedAt);
          const record = this.imageRepo.create({
            guildId: input.guildId,
            channelId: input.channelId,
            userId: input.userId,
            rawPrompt,
            finalPrompt,
            negativePrompt: finalNegativePrompt,
            aspectRatio,
            steps,
            scale,
            seed,
            spoiler,
            ephemeral,
            model: genRes.model,
            status: 'ok',
            errorCode: null,
            latencyMs,
          });

          resolve({
            ok: true,
            buffer: genRes.buffer,
            record,
            translated,
            attempts: genRes.attempts,
          });
        } catch (err) {
          // Roll back cooldown if upstream failed so users are not penalized
          if (this.userLastRunAt.get(cooldownKey) === nowMs) {
            if (prevTimestamp !== undefined) {
              this.userLastRunAt.set(cooldownKey, prevTimestamp);
            } else {
              this.userLastRunAt.delete(cooldownKey);
            }
          }

          const latencyMs = Math.max(0, Date.now() - startedAt);
          const apiErr =
            err instanceof ImageApiError
              ? err
              : new ImageApiError({
                  code: 'unknown',
                  attempts: 1,
                  message: err instanceof Error ? err.message : String(err),
                  userMessage: '生图服务发生异常，请稍后重试。',
                });

          try {
            this.imageRepo.create({
              guildId: input.guildId,
              channelId: input.channelId,
              userId: input.userId,
              rawPrompt,
              finalPrompt,
              negativePrompt: finalNegativePrompt,
              aspectRatio,
              steps,
              scale,
              seed,
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

          resolve({
            ok: false,
            errorCode: apiErr.code,
            errorMessage: apiErr.userMessage,
            errorDetail: apiErr.message,
          });
        }
      };

      this.queue.push({ run: execute });
      this.drainQueue(maxConcurrency);
    });
  }
}
