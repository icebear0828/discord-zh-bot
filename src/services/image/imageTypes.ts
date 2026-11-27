import { VALID_IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from '../../config/defaults.js';
import type { ImageGenerationRecord } from '../../db/repositories/imageRepo.js';
import type { ImageErrorCode, NaiCharCaption } from '../imageClient.js';

export interface GenerateOcSelfieInput {
  guildId: string;
  channelId: string;
  userId: string;
  authorName?: string;
  authorAvatarUrl?: string;
  prompt: string;
  negativePrompt: string;
  charCaptions: readonly NaiCharCaption[];
  aspectRatio: ImageAspectRatio;
  steps?: number;
  scale?: number;
  cfgRescale?: number;
  spoiler?: boolean;
  isAdmin?: boolean;
}

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
  authorName?: string;
  authorAvatarUrl?: string;
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

export interface QueuedImageJob {
  run: () => Promise<void>;
}

export const MAX_PROMPT_LENGTH = 4000;
export const MAX_CHAR_PROMPT_LENGTH = 3000;
export const MAX_NEGATIVE_PROMPT_LENGTH = 1000;
export const MAX_SEED_VALUE = 2_147_483_647;
export const FATAL_ERROR_CODES: ReadonlySet<ImageErrorCode> = new Set([
  'not_configured',
  'auth_error',
  'bad_request',
]);

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function defaultRandomDelayMs(): number {
  return 1000 + Math.floor(Math.random() * 2001);
}

export function isValidImageAspectRatio(value: string): value is ImageAspectRatio {
  return (VALID_IMAGE_ASPECT_RATIOS as readonly string[]).includes(value);
}
