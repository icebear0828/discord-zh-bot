import type { AiChannelOverride } from '../../config/defaults.js';
import type { AiMemoryRepo } from '../../db/repositories/aiMemoryRepo.js';
import type { AiMemoryScopeType } from '../../db/repositories/aiMemoryRepo.js';
import type { GuildConfigRepo } from '../../db/repositories/guildConfigRepo.js';
import type { LlmChatMessage, LlmClient, LlmErrorCode } from '../llmClient.js';
import type { AiPackStore } from './packs/packDiskStore.js';
import type { CharacterCardPack, PresetPack } from './packs/packTypesAndBuiltins.js';
import type { AiOcPresetStore } from './selfie/selfiePresetStore.js';
import type { CompiledOcSelfiePrompt } from './selfie/selfieTypesAndDefaults.js';

export const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_AI_IMAGES_PER_MESSAGE = 4;
export const MAX_DEBUG_TRACES = 200;

export const EMPTY_AI_REPLY_FALLBACK = '嗯？刚才没听清，能再说一遍吗？';
export const EMPTY_AI_MEMORY_ONLY_FALLBACK = '嗯，我记下了。';
export const EMPTY_AI_SELFIE_ONLY_FALLBACK = '喏，刚拍好的。';

export interface DiscordAttachmentLike {
  url: string;
  contentType: string | null;
  size: number;
  name?: string | null;
}

export interface ContextMentionedUser {
  id: string;
  name: string;
}

export interface RawContextMessage {
  id: string;
  authorId: string;
  authorName: string;
  isBot: boolean;
  content: string;
  createdTimestamp: number;
  hasImages?: boolean;
  hasEmbeds?: boolean;
  replyToMessageId?: string;
  replyToAuthorId?: string;
  replyToAuthorName?: string;
  mentionedUsers?: ContextMentionedUser[];
}

export interface ExtractedMemoryTag {
  category: string;
  content: string;
  scopeHint: AiMemoryScopeType;
}

export interface GenerateAiReplyInput {
  guildId: string;
  channelId: string;
  userId: string;
  userName: string;
  userHandle?: string;
  messageId: string;
  messageTimestamp?: number;
  userContent: string;
  replyToAuthorId?: string;
  replyToAuthorName?: string;
  mentionedUsers?: ContextMentionedUser[];
  replyChain?: RawContextMessage[];
  channelWindow?: RawContextMessage[];
  attachments?: DiscordAttachmentLike[];
}

export interface AiReplyUsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  costUsd: number;
  latencyMs: number;
}

export type GenerateAiReplyResult =
  | {
      ok: true;
      replyText: string;
      chunks: string[];
      allowedMentionUserIds: string[];
      storedMemoryCount: number;
      selfiePrompt?: CompiledOcSelfiePrompt;
      model: string;
      fallbackUsed?: boolean;
      attempts: number;
      usage: AiReplyUsageInfo;
    }
  | {
      ok: false;
      errorCode: LlmErrorCode;
      errorMessage: string;
      errorDetail?: string;
    };

export interface MentionParticipant {
  id: string;
  names: string[];
}

export interface ResolveOutgoingMentionsResult {
  text: string;
  allowedMentionUserIds: string[];
}

export interface ChannelDebugTrace {
  guildId: string;
  channelId: string;
  presetId: string;
  presetVersion: string;
  cardId: string;
  cardVersion: string;
  personaName: string;
  model: string;
  messages: LlmChatMessage[];
  rawResponse: string;
  extractedCot: string;
  cleanedReply: string;
  triggeredLorebookIds: string[];
  timestamp: number;
}

export interface PreviewCompiledPromptInput {
  channelId: string;
  userId: string;
  userName: string;
  userHandle?: string;
  userContent: string;
  messageTimestamp?: number;
}

export interface PreviewCompiledPromptOutput {
  presetId: string;
  presetName: string;
  presetVersion: string;
  cardId: string;
  cardName: string;
  cardVersion: string;
  personaName: string;
  model: string;
  fallbackModel: string | null;
  sampling: {
    temperature: number;
    maxTokens: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
  triggeredLorebookIds: string[];
  messages: LlmChatMessage[];
}

export interface ResolvedAiBinding {
  preset: PresetPack;
  card: CharacterCardPack;
  effectiveModel: string;
  effectiveFallbackModel: string | null;
  usingCustomPreset: boolean;
  isChannelOverridden: boolean;
  channelOverride?: AiChannelOverride;
}

export interface AiServiceRuntimeDeps {
  guildConfigRepo: GuildConfigRepo;
  aiMemoryRepo: AiMemoryRepo;
  llmClient: LlmClient;
  fetchFn: typeof fetch;
  packStore?: AiPackStore;
  ocPresetStore?: AiOcPresetStore;
  isImageGenAvailable?: () => boolean;
  timezone: string;
  debugTraces: Map<string, ChannelDebugTrace>;
}
