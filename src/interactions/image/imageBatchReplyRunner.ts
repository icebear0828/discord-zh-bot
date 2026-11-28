import {
  MessageFlags,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type ModalSubmitInteraction,
} from 'discord.js';
import {
  MAX_IMAGE_BATCH_COUNT,
  MAX_IMAGE_STEPS,
  type ImageAspectRatio,
} from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import {
  DEFAULT_IMG2IMG_NOISE,
  DEFAULT_IMG2IMG_STRENGTH,
  isValidImageAspectRatio,
  type GenerateImageBatchInput,
  type ImageService,
} from '../../services/imageService.js';
import {
  validateInitAttachmentMeta,
  type InitAttachmentLike,
} from '../../services/image/imageInitLoader.js';
import { createErrorEmbed } from '../../ui/embeds.js';
import {
  buildImageBatchProgressMessage,
  buildImageBatchResultMessages,
} from '../../ui/imageMenuBuilder.js';
import { parseIntInRange, parseNumberInRange, parsePositiveInt } from '../menuHelpers.js';

export interface ImageBatchReplyTarget {
  editReply(options: InteractionEditReplyOptions): Promise<unknown>;
  followUp?: (options: InteractionReplyOptions) => Promise<unknown>;
}

export async function executeAndReplyImageBatch(params: {
  interaction: ImageBatchReplyTarget;
  imageService: ImageService;
  input: GenerateImageBatchInput;
  authorName: string;
  authorAvatarUrl?: string;
  failTitle?: string;
}): Promise<void> {
  const { imageService, input, authorName, authorAvatarUrl } = params;
  const { imageCfg } = imageService.getEffectiveConfig(input.guildId);
  const userPrefs = imageService.getUserPrefs(input.guildId, input.userId);
  const requestedCount = Math.max(
    1,
    Math.min(MAX_IMAGE_BATCH_COUNT, Math.round(input.count ?? userPrefs.batchCount ?? 1)),
  );
  const aspectRatio = input.aspectRatio ?? userPrefs.aspectRatio ?? imageCfg.defaultAspectRatio;
  const steps = Math.max(
    1,
    Math.min(MAX_IMAGE_STEPS, Math.round(input.steps ?? userPrefs.steps ?? imageCfg.defaultSteps)),
  );
  const scale = Number((input.scale ?? userPrefs.scale ?? imageCfg.defaultScale).toFixed(1));
  const cfgRescale = Number((input.cfgRescale ?? imageCfg.defaultCfgRescale).toFixed(2));

  const res = await imageService.generateBatch({
    ...input,
    authorName,
    ...(authorAvatarUrl ? { authorAvatarUrl } : {}),
    count: requestedCount,
    onProgress:
      requestedCount > 1
        ? async (completed, total) => {
            await params.interaction.editReply(
              buildImageBatchProgressMessage({
                completed,
                total,
                aspectRatio,
                steps,
                scale,
                cfgRescale,
              }),
            );
          }
        : undefined,
  });

  if (!res.ok) {
    await params.interaction.editReply({
      embeds: [createErrorEmbed(params.failTitle ?? '⚠️ 生图失败', res.errorMessage)],
      components: [],
    });
    return;
  }

  const galleryUrl = imageService.getGalleryUrl();
  const built = buildImageBatchResultMessages({
    items: res.items,
    requestedCount: res.requestedCount,
    failedCount: res.failedCount,
    lastErrorMessage: res.lastErrorMessage,
    authorName,
    authorAvatarUrl,
    ...(galleryUrl ? { galleryUrl } : {}),
  });

  await params.interaction.editReply(built.primary);
  const isPrivate = Boolean(res.items[0]?.record.ephemeral);
  if (built.followUps.length > 0 && params.interaction.followUp) {
    for (const extra of built.followUps) {
      await params.interaction.followUp(
        isPrivate ? { ...extra, flags: MessageFlags.Ephemeral } : extra,
      );
    }
  }
}

export function parseRatioOrDefault(
  raw: string | undefined,
  fallback: ImageAspectRatio,
): ImageAspectRatio {
  if (raw && isValidImageAspectRatio(raw.trim())) {
    return raw.trim() as ImageAspectRatio;
  }
  return fallback;
}

export function parseOptionalBatchCount(raw: string | undefined): number {
  const parsed = raw ? parsePositiveInt(raw) : null;
  if (!parsed) return 1;
  return Math.max(1, Math.min(MAX_IMAGE_BATCH_COUNT, parsed));
}

export function resolveEffectiveUserDefaults(
  ctx: AppContext,
  guildId: string,
  userId: string,
): {
  ratio: ImageAspectRatio;
  steps: number;
  scale: number;
  batchCount: number;
  negativePrompt: string;
  spoiler: boolean;
  ephemeral: boolean;
} {
  const imgCfg = ctx.repos.guildConfig.getOrCreate(guildId).imageGen;
  const prefs = ctx.services.image?.getUserPrefs(guildId, userId);
  return {
    ratio: prefs?.aspectRatio ?? imgCfg.defaultAspectRatio,
    steps: Math.max(1, Math.min(MAX_IMAGE_STEPS, prefs?.steps ?? imgCfg.defaultSteps)),
    scale: prefs?.scale ?? imgCfg.defaultScale,
    batchCount: prefs?.batchCount ?? 1,
    negativePrompt: prefs?.negativePrompt ?? '',
    spoiler: Boolean(imgCfg.forceSpoiler || prefs?.spoiler),
    ephemeral: Boolean(prefs?.ephemeral),
  };
}

export function readOptionalModalField(interaction: ModalSubmitInteraction, fieldId: string): string {
  try {
    return interaction.fields.getTextInputValue(fieldId);
  } catch {
    return '';
  }
}

export function parseModalStepsAndScale(
  interaction: ModalSubmitInteraction,
): { steps: number | null; scale: number | null } {
  const combined = readOptionalModalField(interaction, 'params').trim();
  if (combined) {
    const tokens = combined
      .split(/[|｜/,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const steps = tokens[0] ? parseIntInRange(tokens[0], 1, MAX_IMAGE_STEPS) : null;
    const scale = tokens[1] ? parseNumberInRange(tokens[1], 1.0, 10.0) : null;
    return { steps, scale };
  }
  const steps = parseIntInRange(readOptionalModalField(interaction, 'steps'), 1, MAX_IMAGE_STEPS);
  const scale = parseNumberInRange(readOptionalModalField(interaction, 'scale'), 1.0, 10.0);
  return { steps, scale };
}

export function parseModalStrengthAndNoise(
  interaction: ModalSubmitInteraction,
): { strength: number | null; noise: number | null } {
  const combined = readOptionalModalField(interaction, 'i2iParams').trim();
  if (!combined) {
    return { strength: DEFAULT_IMG2IMG_STRENGTH, noise: DEFAULT_IMG2IMG_NOISE };
  }
  const tokens = combined
    .split(/[|｜/,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const strength = tokens[0] ? parseNumberInRange(tokens[0], 0.05, 0.99) : null;
  if (strength === null) {
    return { strength: null, noise: null };
  }
  const noise = tokens[1] ? parseNumberInRange(tokens[1], 0, 0.99) : DEFAULT_IMG2IMG_NOISE;
  if (noise === null) {
    return { strength: null, noise: null };
  }
  return {
    strength: Number(strength.toFixed(2)),
    noise: Number(noise.toFixed(2)),
  };
}

export interface EmbedImageLike {
  url?: string | null;
  proxyURL?: string | null;
  proxy_url?: string | null;
  content_type?: string | null;
}

export interface MessageEmbedLike {
  image?: EmbedImageLike | null;
  data?: {
    image?: EmbedImageLike | null;
  } | null;
}

export interface MessageAttachmentCollectionLike {
  first?: () => InitAttachmentLike | null | undefined;
  values?: () => IterableIterator<InitAttachmentLike>;
}

export interface InitSourceMessageLike {
  attachments?: MessageAttachmentCollectionLike | null;
  embeds?: ReadonlyArray<MessageEmbedLike> | null;
}

/**
 * Extracts a usable init image from message attachments (batch/spoiler cards)
 * or embeds[i].image (single non-spoiler cards where Discord embeds `attachment://`).
 */
export function pickMessageInitAttachment(
  message: InitSourceMessageLike | null | undefined,
): InitAttachmentLike | null {
  const attachments = message?.attachments;
  if (attachments?.values) {
    for (const item of attachments.values()) {
      if (validateInitAttachmentMeta(item).ok) {
        return item;
      }
    }
  }
  const firstAtt = attachments?.first?.() ?? null;
  if (firstAtt) {
    return firstAtt;
  }

  for (const embed of message?.embeds ?? []) {
    const img = embed.image ?? embed.data?.image ?? null;
    const rawProxy = img?.proxyURL?.trim() || img?.proxy_url?.trim() || null;
    const rawUrl = img?.url?.trim() || rawProxy || '';
    if (!rawUrl) continue;
    const contentType = img?.content_type ?? embed.data?.image?.content_type ?? null;
    const pathName = rawUrl.split(/[?#]/, 1)[0]?.split('/').pop() || null;
    return {
      url: rawUrl,
      fallbackUrl: rawProxy && rawProxy !== rawUrl ? rawProxy : null,
      contentType,
      name: pathName,
      size: null,
    };
  }
  return null;
}
