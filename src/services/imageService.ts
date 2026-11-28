import type { GuildConfig, ImageGenConfig } from '../config/defaults.js';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type {
  ImageGenerationRecord,
  ImageRepo,
  ImageUsageSummary,
  ImageUserPrefs,
  ImageUserPrefsPatch,
} from '../db/repositories/imageRepo.js';
import { ImageClient } from './imageClient.js';
import {
  DefaultImagePromptProcessor,
  type ImagePromptProcessor,
} from './imagePromptProcessor.js';
import { runGenerateBatch, runGenerateOcSelfie } from './image/imageBatchEngine.js';
import { ImageCooldownAndQueue } from './image/imageCooldownAndQueue.js';
import {
  DEFAULT_IMG2IMG_NOISE,
  DEFAULT_IMG2IMG_STRENGTH,
  defaultRandomDelayMs,
  defaultSleep,
  ENHANCE_IMG2IMG_STRENGTH,
  isValidImageAspectRatio,
  type GenerateImageBatchInput,
  type GenerateImageBatchResult,
  type GenerateImageInput,
  type GenerateImageResult,
  type GenerateOcSelfieInput,
  type ImageBatchItem,
  type ImageQueueSnapshot,
  type ImageServiceDeps,
  type ImageServiceErrorCode,
} from './image/imageTypes.js';

export {
  DEFAULT_IMG2IMG_NOISE,
  DEFAULT_IMG2IMG_STRENGTH,
  ENHANCE_IMG2IMG_STRENGTH,
  isValidImageAspectRatio,
  type GenerateImageBatchInput,
  type GenerateImageBatchResult,
  type GenerateImageInput,
  type GenerateImageResult,
  type GenerateOcSelfieInput,
  type ImageBatchItem,
  type ImageQueueSnapshot,
  type ImageServiceDeps,
  type ImageServiceErrorCode,
};

export class ImageService {
  private readonly scheduler = new ImageCooldownAndQueue();
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly randomDelayMsFn: () => number;

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

  getGalleryUrl(): string | undefined {
    return this.imageClient.getGalleryUrl?.();
  }

  getEffectiveConfig(guildId: string): { cfg: GuildConfig; imageCfg: ImageGenConfig } {
    const cfg = this.guildConfigRepo.getOrCreate(guildId);
    return { cfg, imageCfg: cfg.imageGen };
  }

  getQueueSnapshot(): ImageQueueSnapshot {
    return this.scheduler.getQueueSnapshot();
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
    const { imageCfg } = this.getEffectiveConfig(guildId);
    return this.scheduler.getUserCooldownRemainingSec(
      guildId,
      userId,
      imageCfg.cooldownSec,
      isAdmin,
    );
  }

  getRecordById(id: number): ImageGenerationRecord | null {
    return this.imageRepo.getById(id);
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
    const channelCheck = this.scheduler.checkChannelAllowed(cfg, params.channelId);
    if (!channelCheck.ok) {
      return channelCheck;
    }

    const cooldownCheck = this.scheduler.checkDrawCooldown(
      `${params.guildId}:${params.userId}`,
      imageCfg.cooldownSec,
      Boolean(params.isAdmin),
    );
    if (!cooldownCheck.ok) {
      return {
        ok: false,
        errorCode: cooldownCheck.errorCode,
        errorMessage: cooldownCheck.errorMessage,
        ...(cooldownCheck.retryAfterSec !== undefined
          ? { retryAfterSec: cooldownCheck.retryAfterSec }
          : {}),
      };
    }

    return this.scheduler.checkQueueCapacity(imageCfg.maxConcurrency, imageCfg.maxPendingQueue);
  }

  async generateBatch(input: GenerateImageBatchInput): Promise<GenerateImageBatchResult> {
    return runGenerateBatch(
      {
        guildConfigRepo: this.guildConfigRepo,
        imageRepo: this.imageRepo,
        imageClient: this.imageClient,
        getPromptProcessor: () => this.promptProcessor,
        scheduler: this.scheduler,
        sleepFn: this.sleepFn,
        randomDelayMsFn: this.randomDelayMsFn,
      },
      input,
    );
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

  async generateOcSelfie(input: GenerateOcSelfieInput): Promise<GenerateImageResult> {
    return runGenerateOcSelfie(
      {
        guildConfigRepo: this.guildConfigRepo,
        imageRepo: this.imageRepo,
        imageClient: this.imageClient,
        getPromptProcessor: () => this.promptProcessor,
        scheduler: this.scheduler,
        sleepFn: this.sleepFn,
        randomDelayMsFn: this.randomDelayMsFn,
      },
      input,
    );
  }
}
