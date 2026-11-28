import path from 'node:path';
import type { AiChannelOverride } from '../config/defaults.js';
import type {
  AiMemoryRecord,
  AiMemoryRepo,
  AiMemoryScopeType,
  AiUsageLogRecord,
  AiUsageSummary,
} from '../db/repositories/aiMemoryRepo.js';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type {
  AiPackStore,
  CharacterCardPack,
  PackHistoryEntry,
  PresetPack,
} from './aiPackStore.js';
import {
  AiOcPresetStore,
  listBuiltinOcPoses,
  resolveActiveOcOutfit,
  resolveActiveOcProfile,
  type AiOcProfile,
  type AiSelfieConfig,
  type OcOutfitPreset,
  type OcPosePreset,
} from './aiOcSelfie.js';
import type { AiUserProfile, AiUserRelation } from './aiProfiles.js';
import type { AiRegexRule, AiRegexRuleInput } from './aiRegex.js';
import type { ImportPackOptions } from './stPresetConverter.js';
import type { LlmClient } from './llmClient.js';
import {
  addMemoryOp,
  addRegexRuleOp,
  clearMemoriesOp,
  clearUsageLogsOp,
  countMemoriesOp,
  deleteMemoryOp,
  deleteRegexRuleOp,
  deleteUserProfileOp,
  getChannelResetAtOp,
  getMemoryByIdOp,
  getUsageSummaryOp,
  listMemoriesOp,
  listRecentUsageLogsOp,
  listUserProfilesOp,
  previewRegexRulesOp,
  resetChannelContextOp,
  resetRegexRulesOp,
  toggleAntiClichePromptOp,
  toggleInputSanitizerOp,
  toggleRegexRuleOp,
  updatePricingOp,
  upsertUserProfileOp,
} from './ai/aiMemoryRegexProfileOps.js';
import { AiInputSanitizerStore } from './ai/aiInputSanitizer.js';
import {
  clearChannelOverrideOp,
  downloadTextAttachmentOp,
  exportCardOp,
  exportPresetOp,
  importCardJsonOp,
  importPresetJsonOp,
  listCardsOp,
  listPackHistoryOp,
  listPresetsOp,
  migrateLegacyGuildConfigToPacksOp,
  reloadPacksOp,
  resolveEffectiveBindingOp,
  rollbackCardOp,
  rollbackPresetOp,
  setChannelOverrideOp,
  setGuildActiveCardOp,
  setGuildActivePresetOp,
} from './ai/aiPackBindingOps.js';
import { generateAiReplyOp } from './ai/aiReplyGenerator.js';
import { previewCompiledPromptOp } from './ai/aiSystemPromptBuilder.js';
import { shouldTriggerAi } from './ai/aiTextAndMentions.js';
import type {
  AiServiceRuntimeDeps,
  ChannelDebugTrace,
  GenerateAiReplyInput,
  GenerateAiReplyResult,
  PreviewCompiledPromptInput,
  PreviewCompiledPromptOutput,
  ResolvedAiBinding,
} from './ai/aiTypes.js';

export {
  MAX_AI_IMAGE_BYTES,
  MAX_AI_IMAGES_PER_MESSAGE,
  type AiReplyUsageInfo,
  type ChannelDebugTrace,
  type ContextMentionedUser,
  type DiscordAttachmentLike,
  type ExtractedMemoryTag,
  type GenerateAiReplyInput,
  type GenerateAiReplyResult,
  type MentionParticipant,
  type PreviewCompiledPromptInput,
  type PreviewCompiledPromptOutput,
  type RawContextMessage,
  type ResolvedAiBinding,
  type ResolveOutgoingMentionsResult,
} from './ai/aiTypes.js';

export {
  calculateUsageCostUsd,
  containsPromptInjectionMemoryTag,
  estimatePromptTokens,
  estimateTextTokens,
  formatAiMinuteTimestamp,
  isSafetyRefusalReply,
} from './ai/aiSafetyAndTokens.js';

export {
  cleanAiOutput,
  extractMemoryTags,
  resolveOutgoingMentions,
  shouldTriggerAi,
  splitDiscordMessage,
  stripBotMention,
} from './ai/aiTextAndMentions.js';

export {
  buildSystemPrompt,
  extractVipAliases,
  findCollidingVipAlias,
  formatSpeakerLabel,
} from './ai/aiSystemPromptBuilder.js';

export {
  loadImageParts,
  mergeConversationHistory,
} from './ai/aiHistoryAndVision.js';

export class AiService {
  private readonly debugTraces = new Map<string, ChannelDebugTrace>();
  private readonly ocPresetStore?: AiOcPresetStore;
  private readonly inputSanitizerStore?: AiInputSanitizerStore;
  private readonly deps: AiServiceRuntimeDeps;

  constructor(
    private readonly guildConfigRepo: GuildConfigRepo,
    private readonly aiMemoryRepo: AiMemoryRepo,
    private readonly llmClient: LlmClient,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly packStore?: AiPackStore,
    private readonly isImageGenAvailable?: () => boolean,
    private readonly timezone = 'Asia/Shanghai',
  ) {
    if (packStore) {
      this.ocPresetStore = new AiOcPresetStore(
        path.join(packStore.getBaseDir(), 'oc-presets.json'),
      );
      this.inputSanitizerStore = new AiInputSanitizerStore(
        path.join(packStore.getBaseDir(), 'input-sanitizer.json'),
      );
    }
    this.deps = {
      guildConfigRepo: this.guildConfigRepo,
      aiMemoryRepo: this.aiMemoryRepo,
      llmClient: this.llmClient,
      fetchFn: this.fetchFn,
      ...(this.packStore ? { packStore: this.packStore } : {}),
      ...(this.ocPresetStore ? { ocPresetStore: this.ocPresetStore } : {}),
      ...(this.inputSanitizerStore ? { inputSanitizerStore: this.inputSanitizerStore } : {}),
      ...(this.isImageGenAvailable ? { isImageGenAvailable: this.isImageGenAvailable } : {}),
      timezone: this.timezone,
      debugTraces: this.debugTraces,
    };
  }

  listOcProfiles(): AiOcProfile[] {
    return this.ocPresetStore?.listProfiles() ?? [];
  }

  listOcPoses(): readonly OcPosePreset[] {
    return this.ocPresetStore?.listPoses() ?? listBuiltinOcPoses();
  }

  resolveActiveOcProfile(selfieCfg?: AiSelfieConfig): AiOcProfile {
    return resolveActiveOcProfile(selfieCfg, this.listOcProfiles());
  }

  resolveActiveOcOutfit(selfieCfg?: AiSelfieConfig, nowMs = Date.now()): OcOutfitPreset {
    const oc = this.resolveActiveOcProfile(selfieCfg);
    return resolveActiveOcOutfit({
      oc,
      selfieCfg,
      nowMs,
      timezone: this.timezone,
    });
  }

  isSelfieSkillAvailable(guildId: string): boolean {
    const cfg = this.guildConfigRepo.getOrCreate(guildId);
    return Boolean(cfg.modules.ai && cfg.ai.selfie.enabled && this.isImageGenAvailable?.());
  }

  getPackStore(): AiPackStore | undefined {
    return this.packStore;
  }

  async downloadTextAttachment(
    url: string,
    maxBytes = 2 * 1024 * 1024,
  ): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    return downloadTextAttachmentOp(this.deps, url, maxBytes);
  }

  listPresets(): PresetPack[] {
    return listPresetsOp(this.deps);
  }

  listCards(): CharacterCardPack[] {
    return listCardsOp(this.deps);
  }

  reloadPacks(): { presets: number; cards: number } {
    return reloadPacksOp(this.deps);
  }

  listPackHistory(kind: 'preset' | 'card', id: string): PackHistoryEntry[] {
    return listPackHistoryOp(this.deps, kind, id);
  }

  importPresetJson(
    rawJsonText: string,
    opts: ImportPackOptions = {},
  ):
    | {
        ok: true;
        pack: PresetPack;
        sourceFormat: 'native_preset' | 'sillytavern_preset';
        archivedPrevious: boolean;
      }
    | { ok: false; error: string } {
    return importPresetJsonOp(this.deps, rawJsonText, opts);
  }

  importCardJson(
    rawJsonText: string,
    opts: ImportPackOptions = {},
  ):
    | {
        ok: true;
        pack: CharacterCardPack;
        sourceFormat: 'native_card' | 'sillytavern_card';
        archivedPrevious: boolean;
      }
    | { ok: false; error: string } {
    return importCardJsonOp(this.deps, rawJsonText, opts);
  }

  exportPreset(guildId: string, presetId?: string, channelId?: string): PresetPack | null {
    return exportPresetOp(this.deps, guildId, presetId, channelId);
  }

  exportCard(guildId: string, cardId?: string, channelId?: string): CharacterCardPack | null {
    return exportCardOp(this.deps, guildId, cardId, channelId);
  }

  rollbackPreset(
    id: string,
    targetFileName?: string,
  ): { ok: true; restored: PresetPack } | { ok: false; error: string } {
    return rollbackPresetOp(this.deps, id, targetFileName);
  }

  rollbackCard(
    id: string,
    targetFileName?: string,
  ): { ok: true; restored: CharacterCardPack } | { ok: false; error: string } {
    return rollbackCardOp(this.deps, id, targetFileName);
  }

  setGuildActivePreset(
    guildId: string,
    presetId: string,
  ): { ok: true; preset: PresetPack } | { ok: false; error: string } {
    return setGuildActivePresetOp(this.deps, guildId, presetId);
  }

  setGuildActiveCard(
    guildId: string,
    cardId: string,
  ): { ok: true; card: CharacterCardPack } | { ok: false; error: string } {
    return setGuildActiveCardOp(this.deps, guildId, cardId);
  }

  setChannelOverride(
    guildId: string,
    channelId: string,
    override: AiChannelOverride,
  ): { ok: true; override: AiChannelOverride } | { ok: false; error: string } {
    return setChannelOverrideOp(this.deps, guildId, channelId, override);
  }

  clearChannelOverride(guildId: string, channelId: string): boolean {
    return clearChannelOverrideOp(this.deps, guildId, channelId);
  }

  migrateLegacyGuildConfigToPacks(guildId: string): void {
    migrateLegacyGuildConfigToPacksOp(this.deps, guildId);
  }

  resolveEffectiveBinding(guildId: string, channelId?: string): ResolvedAiBinding {
    return resolveEffectiveBindingOp(this.deps, guildId, channelId);
  }

  getLastChannelDebugTrace(guildId: string, channelId: string): ChannelDebugTrace | null {
    return this.debugTraces.get(`${guildId}:${channelId}`) ?? null;
  }

  previewCompiledPrompt(
    guildId: string,
    input: PreviewCompiledPromptInput,
  ): PreviewCompiledPromptOutput {
    return previewCompiledPromptOp(this.deps, guildId, input);
  }

  isConfigured(): boolean {
    return this.llmClient.isConfigured();
  }

  getDefaultModel(): string {
    return this.llmClient.getDefaultModel();
  }

  getFallbackModel(): string {
    return this.llmClient.getFallbackModel();
  }

  shouldTrigger(params: {
    guildId: string;
    channelId: string;
    isMentioned: boolean;
    isReplyToBot: boolean;
  }): boolean {
    const cfg = this.guildConfigRepo.getOrCreate(params.guildId);
    return shouldTriggerAi({
      cfg,
      channelId: params.channelId,
      isMentioned: params.isMentioned,
      isReplyToBot: params.isReplyToBot,
    });
  }

  getChannelResetAt(guildId: string, channelId: string): number {
    return getChannelResetAtOp(this.deps, guildId, channelId);
  }

  resetChannelContext(guildId: string, channelId: string, nowMs = Date.now()): void {
    resetChannelContextOp(this.deps, guildId, channelId, nowMs);
  }

  listMemories(
    guildId: string,
    scopeType: AiMemoryScopeType,
    scopeId: string,
    limit = 30,
  ): AiMemoryRecord[] {
    return listMemoriesOp(this.deps, guildId, scopeType, scopeId, limit);
  }

  addMemory(input: {
    guildId: string;
    scopeType: AiMemoryScopeType;
    scopeId: string;
    category: string;
    content: string;
    createdBy: string;
  }): AiMemoryRecord {
    return addMemoryOp(this.deps, input);
  }

  getMemoryById(guildId: string, id: number): AiMemoryRecord | null {
    return getMemoryByIdOp(this.deps, guildId, id);
  }

  deleteMemory(guildId: string, id: number): boolean {
    return deleteMemoryOp(this.deps, guildId, id);
  }

  clearMemories(guildId: string, scopeType: AiMemoryScopeType, scopeId: string): number {
    return clearMemoriesOp(this.deps, guildId, scopeType, scopeId);
  }

  countMemories(guildId: string): {
    total: number;
    user: number;
    channel: number;
    guild: number;
  } {
    return countMemoriesOp(this.deps, guildId);
  }

  addRegexRule(
    guildId: string,
    input: AiRegexRuleInput,
  ): { ok: true; rule: AiRegexRule } | { ok: false; error: string } {
    return addRegexRuleOp(this.deps, guildId, input);
  }

  toggleRegexRule(
    guildId: string,
    ruleId: string,
  ): { ok: true; rule: AiRegexRule } | { ok: false; error: string } {
    return toggleRegexRuleOp(this.deps, guildId, ruleId);
  }

  deleteRegexRule(
    guildId: string,
    ruleId: string,
  ): { ok: true; rule: AiRegexRule } | { ok: false; error: string } {
    return deleteRegexRuleOp(this.deps, guildId, ruleId);
  }

  resetRegexRules(guildId: string): AiRegexRule[] {
    return resetRegexRulesOp(this.deps, guildId);
  }

  toggleAntiClichePrompt(guildId: string): boolean {
    return toggleAntiClichePromptOp(this.deps, guildId);
  }

  toggleInputSanitizer(guildId: string): boolean {
    return toggleInputSanitizerOp(this.deps, guildId);
  }

  previewRegexRules(
    guildId: string,
    text: string,
    stage: 'input' | 'output',
  ): { before: string; after: string; changed: boolean } {
    return previewRegexRulesOp(this.deps, guildId, text, stage);
  }

  getUsageSummary(guildId: string, windowHours: number, nowMs = Date.now()): AiUsageSummary {
    return getUsageSummaryOp(this.deps, guildId, windowHours, nowMs);
  }

  listRecentUsageLogs(guildId: string, limit = 10): AiUsageLogRecord[] {
    return listRecentUsageLogsOp(this.deps, guildId, limit);
  }

  clearUsageLogs(guildId: string): number {
    return clearUsageLogsOp(this.deps, guildId);
  }

  updatePricing(guildId: string, inputPricePer1MUsd: number, outputPricePer1MUsd: number): void {
    updatePricingOp(this.deps, guildId, inputPricePer1MUsd, outputPricePer1MUsd);
  }

  listUserProfiles(guildId: string): AiUserProfile[] {
    return listUserProfilesOp(this.deps, guildId);
  }

  upsertUserProfile(
    guildId: string,
    input: { userId: string; alias: string; relation: AiUserRelation | string; note?: string },
  ): { ok: true; profile: AiUserProfile; updated: boolean } | { ok: false; error: string } {
    return upsertUserProfileOp(this.deps, guildId, input);
  }

  deleteUserProfile(
    guildId: string,
    userId: string,
  ): { ok: true; profile: AiUserProfile } | { ok: false; error: string } {
    return deleteUserProfileOp(this.deps, guildId, userId);
  }

  async generateReply(
    input: GenerateAiReplyInput,
    botId = 'bot',
  ): Promise<GenerateAiReplyResult> {
    return generateAiReplyOp(this.deps, input, botId);
  }
}
