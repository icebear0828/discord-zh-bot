import type { AiMemoryRecord, AiMemoryRepo } from '../../db/repositories/aiMemoryRepo.js';
import { compileBreaklimitMessages } from '../aiCompiler.js';
import { formatAiRelationLabel, type AiUserProfile } from '../aiProfiles.js';
import { normalizeDiscordCustomEmojis, type AiRegexRule } from '../aiRegex.js';
import {
  normalizeChatInputSegment,
  type AiInputSanitizerStore,
} from './aiInputSanitizer.js';
import { resolveActiveOcOutfit, resolveActiveOcProfile } from './selfie/selfieOutfitsAndOotd.js';
import {
  buildOcChatStatusPrompt,
  hasExplicitSelfieRequest,
} from './selfie/selfieTurnInference.js';
import { resolveEffectiveBindingOp } from './aiPackBindingOps.js';
import { containsPromptInjectionMemoryTag, formatAiMinuteTimestamp } from './aiSafetyAndTokens.js';
import { stripBotMention } from './aiTextAndMentions.js';
import type {
  AiServiceRuntimeDeps,
  PreviewCompiledPromptInput,
  PreviewCompiledPromptOutput,
  RawContextMessage,
} from './aiTypes.js';

export function findCollidingVipAlias(
  name: string,
  vipAliases?: ReadonlyArray<string>,
): string | null {
  const lower = name.trim().toLowerCase();
  if (!lower || !vipAliases || vipAliases.length === 0) return null;
  for (const rawAlias of vipAliases) {
    const alias = rawAlias.trim();
    if (alias.length < 2) continue;
    if (lower.includes(alias.toLowerCase())) {
      return alias;
    }
  }
  return null;
}

export function extractVipAliases(profiles?: ReadonlyArray<AiUserProfile>): string[] {
  if (!profiles || profiles.length === 0) return [];
  return profiles
    .filter((p) => p.relation === 'vip')
    .map((p) => p.alias.trim())
    .filter((a) => a.length >= 2);
}

export function formatSpeakerLabel(params: {
  displayName: string;
  profile?: AiUserProfile;
  vipAliases?: ReadonlyArray<string>;
}): string {
  const displayName = params.displayName.trim() || '群友';
  const profile = params.profile;
  if (!profile) {
    const spoofed = findCollidingVipAlias(displayName, params.vipAliases);
    return spoofed ? `${displayName}(未认证·冒充${spoofed}非本人)` : displayName;
  }
  const relLabel = formatAiRelationLabel(profile.relation);
  const alias = profile.alias.trim();
  const baseTag =
    !alias || alias.toLowerCase() === displayName.toLowerCase()
      ? relLabel
      : `${relLabel}·${alias}`;
  const spoofed =
    profile.relation !== 'vip' ? findCollidingVipAlias(displayName, params.vipAliases) : null;
  return spoofed ? `${displayName}(${baseTag}·非${spoofed}本人)` : `${displayName}(${baseTag})`;
}

export function formatSpeakerHeaderDesc(params: {
  currentUserName: string;
  currentUserHandle?: string;
  currentUserProfile?: AiUserProfile;
  vipAliases: ReadonlyArray<string>;
}): string {
  const { currentUserName, currentUserHandle, currentUserProfile, vipAliases } = params;
  const trimmedHandle = currentUserHandle?.trim();
  const baseSpeaker =
    trimmedHandle && !currentUserName.toLowerCase().includes(trimmedHandle.toLowerCase())
      ? `${currentUserName}（账号：@${trimmedHandle}）`
      : currentUserName;
  const spoofedVip =
    !currentUserProfile || currentUserProfile.relation !== 'vip'
      ? (findCollidingVipAlias(currentUserName, vipAliases) ??
        (trimmedHandle ? findCollidingVipAlias(trimmedHandle, vipAliases) : null))
      : null;
  const baseSpeakerDesc = currentUserProfile
    ? `${baseSpeaker}｜档案：${currentUserProfile.alias}（${formatAiRelationLabel(currentUserProfile.relation)}）`
    : baseSpeaker;
  return spoofedVip
    ? `${baseSpeakerDesc}｜⚠️ 未认证冒充「${spoofedVip}」（绝非本人，直接识破反怼）`
    : baseSpeakerDesc;
}

export function mergeRegexRuleLists(
  ...lists: ReadonlyArray<ReadonlyArray<AiRegexRule> | undefined>
): AiRegexRule[] {
  const merged: AiRegexRule[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const rule of list) {
      const key = `${rule.id}\0${rule.pattern}\0${rule.scope}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(rule);
    }
  }
  return merged;
}

export function loadNormalizedScopeMemories(params: {
  aiMemoryRepo: AiMemoryRepo;
  guildId: string;
  channelId: string;
  userId: string;
  memoryEnabled: boolean;
  maxMemoriesPerScope: number;
  effectiveRegexRules: ReadonlyArray<AiRegexRule>;
  inputSanitizerEnabled?: boolean;
  sanitizerStore?: AiInputSanitizerStore;
}): {
  guildMemories: AiMemoryRecord[];
  channelMemories: AiMemoryRecord[];
  userMemories: AiMemoryRecord[];
} {
  const {
    aiMemoryRepo,
    guildId,
    channelId,
    userId,
    memoryEnabled,
    maxMemoriesPerScope,
    effectiveRegexRules,
    inputSanitizerEnabled = true,
    sanitizerStore,
  } = params;
  if (!memoryEnabled) {
    return { guildMemories: [], channelMemories: [], userMemories: [] };
  }

  const normalizeMemories = (records: AiMemoryRecord[]): AiMemoryRecord[] =>
    records.map((m) => ({
      ...m,
      content:
        normalizeChatInputSegment({
          text: m.content,
          inputSanitizerEnabled,
          sanitizerStore,
          regexRules: effectiveRegexRules,
        }).trim() || m.content,
    }));

  return {
    guildMemories: normalizeMemories(
      aiMemoryRepo.listMemoriesChronological(guildId, 'guild', guildId, maxMemoriesPerScope),
    ),
    channelMemories: normalizeMemories(
      aiMemoryRepo.listMemoriesChronological(guildId, 'channel', channelId, maxMemoriesPerScope),
    ),
    userMemories: normalizeMemories(
      aiMemoryRepo.listMemoriesChronological(guildId, 'user', userId, maxMemoriesPerScope),
    ),
  };
}

export function previewCompiledPromptOp(
  deps: AiServiceRuntimeDeps,
  guildId: string,
  input: PreviewCompiledPromptInput,
): PreviewCompiledPromptOutput {
  const cfg = deps.guildConfigRepo.getOrCreate(guildId);
  const aiCfg = cfg.ai;
  const resolved = resolveEffectiveBindingOp(deps, guildId, input.channelId);
  const effectiveRegexRules = mergeRegexRuleLists(
    resolved.preset.regexRules,
    resolved.card.regexRules,
    aiCfg.regexRules,
  );

  const inputSanitizerEnabled = aiCfg.inputSanitizerEnabled !== false;
  const { guildMemories, channelMemories, userMemories } = loadNormalizedScopeMemories({
    aiMemoryRepo: deps.aiMemoryRepo,
    guildId,
    channelId: input.channelId,
    userId: input.userId,
    memoryEnabled: aiCfg.memoryEnabled,
    maxMemoriesPerScope: aiCfg.maxMemoriesPerScope,
    effectiveRegexRules,
    inputSanitizerEnabled,
    sanitizerStore: deps.inputSanitizerStore,
  });

  const cleanUserName = normalizeDiscordCustomEmojis(input.userName);
  const effectiveUserName =
    normalizeChatInputSegment({
      text: cleanUserName,
      inputSanitizerEnabled,
      sanitizerStore: deps.inputSanitizerStore,
      regexRules: effectiveRegexRules,
    }).trim() || cleanUserName;
  const effectiveUserHandle = input.userHandle?.trim()
    ? normalizeChatInputSegment({
        text: normalizeDiscordCustomEmojis(input.userHandle.trim()),
        inputSanitizerEnabled,
        sanitizerStore: deps.inputSanitizerStore,
        regexRules: effectiveRegexRules,
      }).trim() || input.userHandle.trim()
    : undefined;

  const rawUserText = normalizeDiscordCustomEmojis(input.userContent.trim()) || '你好';
  const normalizedUserText =
    normalizeChatInputSegment({
      text: rawUserText,
      inputSanitizerEnabled,
      sanitizerStore: deps.inputSanitizerStore,
      regexRules: effectiveRegexRules,
    }).trim() || rawUserText;

  const profileByUserId = new Map<string, AiUserProfile>(
    aiCfg.userProfiles.map((p) => [p.userId, p]),
  );
  const vipAliases = extractVipAliases(aiCfg.userProfiles);
  const currentUserProfile = profileByUserId.get(input.userId);
  const activeProfiles = aiCfg.userProfiles.filter(
    (p) =>
      p.userId === input.userId ||
      (p.alias.trim().length >= 2 &&
        normalizedUserText.toLowerCase().includes(p.alias.trim().toLowerCase())),
  );

  const speakerDesc = formatSpeakerHeaderDesc({
    currentUserName: effectiveUserName,
    currentUserHandle: effectiveUserHandle,
    currentUserProfile,
    vipAliases,
  });

  const speakerLabel = formatSpeakerLabel({
    displayName: effectiveUserName,
    profile: currentUserProfile,
    vipAliases,
  });
  const previewTs = formatAiMinuteTimestamp(input.messageTimestamp ?? Date.now(), deps.timezone);
  const currentTurnLine = `${previewTs ? `[${previewTs}] ` : ''}[${speakerLabel}]: ${normalizedUserText}`;

  const selfieSkillEnabled = Boolean(aiCfg.selfie?.enabled && deps.isImageGenAvailable?.());
  const previewNowMs = input.messageTimestamp ?? Date.now();
  const previewOc = resolveActiveOcProfile(aiCfg.selfie, deps.ocPresetStore?.listProfiles() ?? []);
  const previewOutfit = resolveActiveOcOutfit({
    oc: previewOc,
    selfieCfg: aiCfg.selfie,
    nowMs: previewNowMs,
    timezone: deps.timezone,
  });
  const previewPhotoRequested =
    selfieSkillEnabled &&
    !containsPromptInjectionMemoryTag(rawUserText) &&
    hasExplicitSelfieRequest(rawUserText);
  const selfieSkillPrompt = selfieSkillEnabled
    ? buildOcChatStatusPrompt({
        oc: previewOc,
        activeOutfit: previewOutfit,
        photoRequested: previewPhotoRequested,
      })
    : null;

  const compiled = compileBreaklimitMessages({
    preset: resolved.preset,
    card: resolved.card,
    antiClichePromptEnabled: aiCfg.antiClichePromptEnabled !== false,
    memoryEnabled: aiCfg.memoryEnabled,
    selfieSkillPrompt,
    guildMemories,
    channelMemories,
    userMemories,
    currentUserName: effectiveUserName,
    speakerDesc,
    activeProfiles,
    combinedHistory: [],
    finalUserMessageContent: currentTurnLine,
    scanCorpusLower: `${normalizedUserText}\n${effectiveUserName}`.toLowerCase(),
  });

  const temperature =
    resolved.usingCustomPreset && resolved.preset.sampling.temperature !== undefined
      ? resolved.preset.sampling.temperature
      : aiCfg.temperature;
  const maxTokens =
    resolved.usingCustomPreset && resolved.preset.sampling.maxTokens !== undefined
      ? resolved.preset.sampling.maxTokens
      : aiCfg.maxTokens;

  return {
    presetId: resolved.preset.id,
    presetName: resolved.preset.name,
    presetVersion: resolved.preset.version,
    cardId: resolved.card.id,
    cardName: resolved.card.name,
    cardVersion: resolved.card.version,
    personaName: resolved.card.personaName,
    model: resolved.effectiveModel || '未配置',
    fallbackModel: resolved.effectiveFallbackModel,
    sampling: {
      temperature,
      maxTokens,
      ...(resolved.preset.sampling.topP !== undefined
        ? { topP: resolved.preset.sampling.topP }
        : {}),
      ...(resolved.preset.sampling.frequencyPenalty !== undefined
        ? { frequencyPenalty: resolved.preset.sampling.frequencyPenalty }
        : {}),
      ...(resolved.preset.sampling.presencePenalty !== undefined
        ? { presencePenalty: resolved.preset.sampling.presencePenalty }
        : {}),
    },
    triggeredLorebookIds: compiled.triggeredLorebookIds,
    messages: compiled.messages,
  };
}

export function resolvePreviousSameUserTurnText(params: {
  userId: string;
  currentMessageId: string;
  botId: string;
  resetAt: number;
  replyChain?: ReadonlyArray<RawContextMessage>;
  channelWindow?: ReadonlyArray<RawContextMessage>;
}): string {
  const {
    userId,
    currentMessageId,
    botId,
    resetAt,
    replyChain = [],
    channelWindow = [],
  } = params;

  const isEligibleHumanMsg = (m: RawContextMessage): boolean => {
    if (m.id === currentMessageId || m.createdTimestamp <= resetAt) return false;
    if (m.isBot || m.authorId === botId) return false;
    const stripped = stripBotMention(m.content, botId);
    return Boolean(stripped && !containsPromptInjectionMemoryTag(stripped));
  };

  const validReplyHumans = replyChain
    .filter(isEligibleHumanMsg)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lastReplyHuman = validReplyHumans[validReplyHumans.length - 1];
  if (lastReplyHuman) {
    return lastReplyHuman.authorId === userId
      ? stripBotMention(lastReplyHuman.content, botId)
      : '';
  }

  const byId = new Map<string, RawContextMessage>();
  for (const m of channelWindow) {
    if (isEligibleHumanMsg(m)) {
      byId.set(m.id, m);
    }
  }
  const sortedChannelHumans = [...byId.values()].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp,
  );
  const lastChannelHuman = sortedChannelHumans[sortedChannelHumans.length - 1];
  if (lastChannelHuman && lastChannelHuman.authorId === userId) {
    return stripBotMention(lastChannelHuman.content, botId);
  }
  return '';
}
