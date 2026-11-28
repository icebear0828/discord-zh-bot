import { MAX_IMAGE_BATCH_COUNT, MAX_IMAGE_STEPS } from '../../config/defaults.js';
import type { GuildConfigRepo } from '../../db/repositories/guildConfigRepo.js';
import type { ImageRepo } from '../../db/repositories/imageRepo.js';
import { ImageApiError, ImageClient, type NaiCharCaption } from '../imageClient.js';
import type { ImagePromptProcessor } from '../imagePromptProcessor.js';
import type { ImageCooldownAndQueue } from './imageCooldownAndQueue.js';
import {
  DEFAULT_IMG2IMG_NOISE,
  DEFAULT_IMG2IMG_STRENGTH,
  FATAL_ERROR_CODES,
  isValidImageAspectRatio,
  MAX_CHAR_PROMPT_LENGTH,
  MAX_NEGATIVE_PROMPT_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_SEED_VALUE,
  type GenerateImageBatchInput,
  type GenerateImageBatchResult,
  type GenerateImageResult,
  type GenerateOcSelfieInput,
  type ImageBatchItem,
} from './imageTypes.js';

export interface ImageBatchEngineDeps {
  guildConfigRepo: GuildConfigRepo;
  imageRepo: ImageRepo;
  imageClient: ImageClient;
  getPromptProcessor: () => ImagePromptProcessor;
  scheduler: ImageCooldownAndQueue;
  sleepFn: (ms: number) => Promise<void>;
  randomDelayMsFn: () => number;
}

export async function runGenerateBatch(
  deps: ImageBatchEngineDeps,
  input: GenerateImageBatchInput,
): Promise<GenerateImageBatchResult> {
  if (!deps.imageClient.isConfigured()) {
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

  const cfg = deps.guildConfigRepo.getOrCreate(input.guildId);
  const imageCfg = cfg.imageGen;
  const channelCheck = deps.scheduler.checkChannelAllowed(cfg, input.channelId);
  if (!channelCheck.ok) {
    return channelCheck;
  }

  const nowMs = Date.now();
  const cooldownKey = `${input.guildId}:${input.userId}`;
  const cooldownCheck = deps.scheduler.checkDrawCooldown(
    cooldownKey,
    imageCfg.cooldownSec,
    Boolean(input.isAdmin),
    nowMs,
  );
  if (!cooldownCheck.ok) {
    return cooldownCheck;
  }
  const prevTimestamp = cooldownCheck.prevTimestamp;

  const maxConcurrency = Math.max(1, Math.min(5, imageCfg.maxConcurrency));
  const queueCheck = deps.scheduler.checkQueueCapacity(maxConcurrency, imageCfg.maxPendingQueue);
  if (!queueCheck.ok) {
    return queueCheck;
  }

  const cooldownMs = Math.max(0, imageCfg.cooldownSec * 1000);
  deps.scheduler.recordDrawRun(cooldownKey, nowMs, Math.max(60_000, cooldownMs));

  const userPrefs = deps.imageRepo.getUserPrefs(input.guildId, input.userId);
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
  const effectiveModel = imageCfg.modelOverride?.trim() || deps.imageClient.getDefaultModel();
  const initImageDataUrl = input.initImageDataUrl?.trim() || undefined;
  const img2imgStrength = initImageDataUrl
    ? Number(
        Math.max(
          0.01,
          Math.min(
            0.99,
            input.strength !== undefined &&
              input.strength !== null &&
              Number.isFinite(input.strength)
              ? input.strength
              : DEFAULT_IMG2IMG_STRENGTH,
          ),
        ).toFixed(2),
      )
    : null;
  const img2imgNoise = initImageDataUrl
    ? Number(
        Math.max(
          0,
          Math.min(
            0.99,
            input.noise !== undefined && input.noise !== null && Number.isFinite(input.noise)
              ? input.noise
              : DEFAULT_IMG2IMG_NOISE,
          ),
        ).toFixed(2),
      )
    : null;

  return new Promise<GenerateImageBatchResult>((resolve) => {
    const execute = async (): Promise<void> => {
      let effectiveRawPrompt = rawPrompt;
      let finalPrompt = rawPrompt;
      let finalNegativePrompt = userNeg;
      let finalCharCaptions: NaiCharCaption[] = input.charCaptions ? [...input.charCaptions] : [];
      let finalUseCoords = Boolean(input.useCoords);
      const rawCharPrompt = input.rawCharacterPrompt?.trim().slice(0, MAX_CHAR_PROMPT_LENGTH);

      try {
        const processed = await deps.getPromptProcessor().process({
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
        deps.scheduler.rollbackDrawCooldown(cooldownKey, nowMs, prevTimestamp);
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
          const delayMs = Math.max(0, Math.round(deps.randomDelayMsFn()));
          await deps.sleepFn(delayMs);
        }

        const itemSeed = baseSeed !== null ? (baseSeed + i) % MAX_SEED_VALUE : null;
        const itemStart = Date.now();

        try {
          const genRes = await deps.imageClient.generate({
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
            ...(initImageDataUrl
              ? {
                  initImageDataUrl,
                  strength: img2imgStrength ?? DEFAULT_IMG2IMG_STRENGTH,
                  noise: img2imgNoise ?? DEFAULT_IMG2IMG_NOISE,
                }
              : {}),
            galleryMeta: {
              source: initImageDataUrl ? 'discord-img2img' : 'discord-draw',
              authorId: input.userId,
              ...(input.authorName ? { authorName: input.authorName } : {}),
              ...(input.authorAvatarUrl ? { authorAvatar: input.authorAvatarUrl } : {}),
              rawPrompt: effectiveRawPrompt,
              skip: ephemeral,
            },
          });

          const latencyMs = Math.max(0, Date.now() - itemStart);
          const record = deps.imageRepo.create({
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
            strength: img2imgStrength,
            noise: img2imgNoise,
            spoiler,
            ephemeral,
            model: genRes.model,
            status: 'ok',
            errorCode: null,
            latencyMs,
          });

          items.push({ buffer: genRes.buffer, record, attempts: genRes.attempts });

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
            deps.imageRepo.create({
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
              strength: img2imgStrength,
              noise: img2imgNoise,
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

      deps.scheduler.rollbackDrawCooldown(cooldownKey, nowMs, prevTimestamp);
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

    deps.scheduler.enqueue(maxConcurrency, execute);
  });
}

export async function runGenerateOcSelfie(
  deps: ImageBatchEngineDeps,
  input: GenerateOcSelfieInput,
): Promise<GenerateImageResult> {
  if (!deps.imageClient.isConfigured()) {
    return {
      ok: false,
      errorCode: 'not_configured',
      errorMessage: '生图服务尚未配置完成，请联系管理员检查环境变量。',
    };
  }

  const finalPrompt = input.prompt.trim().slice(0, MAX_PROMPT_LENGTH);
  if (!finalPrompt) {
    return {
      ok: false,
      errorCode: 'invalid_prompt',
      errorMessage: '自设提示词为空，无法生成图片。',
    };
  }

  const cfg = deps.guildConfigRepo.getOrCreate(input.guildId);
  const imageCfg = cfg.imageGen;
  if (!cfg.modules.ai || !cfg.ai.selfie.enabled) {
    return {
      ok: false,
      errorCode: 'module_disabled',
      errorMessage: '当前已关闭聊天自设生图。',
    };
  }

  const nowMs = Date.now();
  const cooldownKey = `${input.guildId}:${input.userId}`;
  const cooldownCheck = deps.scheduler.checkSelfieCooldown(
    cooldownKey,
    cfg.ai.selfie.cooldownSec,
    Boolean(input.isAdmin),
    nowMs,
  );
  if (!cooldownCheck.ok) {
    return cooldownCheck;
  }
  const prevTimestamp = cooldownCheck.prevTimestamp;

  const maxConcurrency = Math.max(1, Math.min(5, imageCfg.maxConcurrency));
  const queueCheck = deps.scheduler.checkQueueCapacity(maxConcurrency, imageCfg.maxPendingQueue);
  if (!queueCheck.ok) {
    return queueCheck;
  }

  const cooldownMs = Math.max(0, cfg.ai.selfie.cooldownSec * 1000);
  deps.scheduler.recordSelfieRun(cooldownKey, nowMs, Math.max(60_000, cooldownMs));

  const aspectRatio = isValidImageAspectRatio(input.aspectRatio) ? input.aspectRatio : '1:1';
  const steps = Math.max(1, Math.min(MAX_IMAGE_STEPS, Math.round(input.steps ?? 28)));
  const scale = Math.max(1.0, Math.min(10.0, Number((input.scale ?? 5.0).toFixed(1))));
  const cfgRescale = Math.max(0, Math.min(1.0, Number((input.cfgRescale ?? 0).toFixed(2))));
  const finalNegativePrompt = input.negativePrompt.trim().slice(0, MAX_NEGATIVE_PROMPT_LENGTH);
  const finalCharCaptions = [...input.charCaptions];
  const spoiler = Boolean(imageCfg.forceSpoiler || input.spoiler);
  const effectiveModel = imageCfg.modelOverride?.trim() || deps.imageClient.getDefaultModel();

  return new Promise<GenerateImageResult>((resolve) => {
    const execute = async (): Promise<void> => {
      const startedAt = Date.now();
      try {
        const genRes = await deps.imageClient.generate({
          model: effectiveModel || undefined,
          prompt: finalPrompt,
          negativePrompt: finalNegativePrompt || undefined,
          aspectRatio,
          steps,
          scale,
          cfgRescale,
          charCaptions: finalCharCaptions.length > 0 ? finalCharCaptions : undefined,
          useCoords: false,
          galleryMeta: {
            source: 'discord-selfie',
            authorId: input.userId,
            ...(input.authorName ? { authorName: input.authorName } : {}),
            ...(input.authorAvatarUrl ? { authorAvatar: input.authorAvatarUrl } : {}),
            rawPrompt: finalPrompt,
            skip: false,
          },
        });

        const latencyMs = Math.max(0, Date.now() - startedAt);
        const record = deps.imageRepo.create({
          guildId: input.guildId,
          channelId: input.channelId,
          userId: input.userId,
          rawPrompt: finalPrompt,
          finalPrompt,
          negativePrompt: finalNegativePrompt,
          charCaptions: finalCharCaptions,
          useCoords: false,
          aspectRatio,
          steps,
          scale,
          seed: null,
          spoiler,
          ephemeral: false,
          model: genRes.model,
          status: 'ok',
          errorCode: null,
          latencyMs,
        });

        resolve({ ok: true, buffer: genRes.buffer, record, attempts: genRes.attempts });
      } catch (err) {
        const latencyMs = Math.max(0, Date.now() - startedAt);
        deps.scheduler.rollbackSelfieCooldown(cooldownKey, nowMs, prevTimestamp);

        const apiErr =
          err instanceof ImageApiError
            ? err
            : new ImageApiError({
                code: 'unknown',
                attempts: 1,
                message: err instanceof Error ? err.message : String(err),
                userMessage: '自设生图服务暂时异常，请稍后重试。',
              });

        try {
          deps.imageRepo.create({
            guildId: input.guildId,
            channelId: input.channelId,
            userId: input.userId,
            rawPrompt: finalPrompt,
            finalPrompt,
            negativePrompt: finalNegativePrompt,
            charCaptions: finalCharCaptions,
            useCoords: false,
            aspectRatio,
            steps,
            scale,
            seed: null,
            spoiler,
            ephemeral: false,
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

    deps.scheduler.enqueue(maxConcurrency, execute);
  });
}
