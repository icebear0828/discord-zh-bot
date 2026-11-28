import { compileBreaklimitMessages, stripCotBlocks } from '../aiCompiler.js';
import { normalizeChatInputSegment } from './aiInputSanitizer.js';
import { LlmError, type LlmChatResponse, type LlmErrorCode } from '../llmClient.js';
import { resolveActiveOcOutfit, resolveActiveOcProfile } from './selfie/selfieOutfitsAndOotd.js';
import { listBuiltinOcPoses } from './selfie/selfiePresetStore.js';
import { compileOcSelfiePrompt } from './selfie/selfiePromptCompiler.js';
import { extractSelfieSkillTag } from './selfie/selfieTagParser.js';
import {
  buildOcChatStatusPrompt,
  hasExplicitSelfieRequest,
  inferOcSelfieSpecFromTurn,
} from './selfie/selfieTurnInference.js';
import { prepareReplyTurnContext } from './aiHistoryAndVision.js';
import { resolveEffectiveBindingOp } from './aiPackBindingOps.js';
import {
  buildRefusalSoftLandingMessages,
  computeReplyUsage,
  containsPromptInjectionMemoryTag,
  isSafetyRefusalReply,
} from './aiSafetyAndTokens.js';
import {
  loadNormalizedScopeMemories,
  mergeRegexRuleLists,
  resolvePreviousSameUserTurnText,
} from './aiSystemPromptBuilder.js';
import {
  cleanAiOutput,
  extractMemoryTags,
  resolveOutgoingMentions,
  splitDiscordMessage,
} from './aiTextAndMentions.js';
import {
  EMPTY_AI_MEMORY_ONLY_FALLBACK,
  EMPTY_AI_REPLY_FALLBACK,
  EMPTY_AI_SELFIE_ONLY_FALLBACK,
  MAX_DEBUG_TRACES,
  type AiServiceRuntimeDeps,
  type ChannelDebugTrace,
  type GenerateAiReplyInput,
  type GenerateAiReplyResult,
} from './aiTypes.js';

export function saveChannelDebugTrace(
  debugTraces: Map<string, ChannelDebugTrace>,
  trace: ChannelDebugTrace,
): void {
  const key = `${trace.guildId}:${trace.channelId}`;
  if (debugTraces.has(key)) {
    debugTraces.delete(key);
  } else if (debugTraces.size >= MAX_DEBUG_TRACES) {
    const oldestKey = debugTraces.keys().next().value;
    if (oldestKey !== undefined) {
      debugTraces.delete(oldestKey);
    }
  }
  debugTraces.set(key, trace);
}

export async function generateAiReplyOp(
  deps: AiServiceRuntimeDeps,
  input: GenerateAiReplyInput,
  botId = 'bot',
): Promise<GenerateAiReplyResult> {
  const cfg = deps.guildConfigRepo.getOrCreate(input.guildId);
  const aiCfg = cfg.ai;
  const resolved = resolveEffectiveBindingOp(deps, input.guildId, input.channelId);
  const effectiveModel = resolved.effectiveModel;

  if (!deps.llmClient.isConfigured() || !effectiveModel) {
    return {
      ok: false,
      errorCode: 'not_configured',
      errorMessage: 'AI 对话功能暂未配置完成，请联系服务器管理员检查服务设置。',
    };
  }

  const effectiveRegexRules = mergeRegexRuleLists(
    resolved.preset.regexRules,
    resolved.card.regexRules,
    aiCfg.regexRules,
  );

  const inputSanitizerEnabled = aiCfg.inputSanitizerEnabled !== false;
  const { guildMemories, channelMemories, userMemories } = loadNormalizedScopeMemories({
    aiMemoryRepo: deps.aiMemoryRepo,
    guildId: input.guildId,
    channelId: input.channelId,
    userId: input.userId,
    memoryEnabled: aiCfg.memoryEnabled,
    maxMemoriesPerScope: aiCfg.maxMemoriesPerScope,
    effectiveRegexRules,
    inputSanitizerEnabled,
    sanitizerStore: deps.inputSanitizerStore,
  });

  const resetAt = deps.aiMemoryRepo.getChannelResetAt(input.guildId, input.channelId);
  const turnCtx = await prepareReplyTurnContext({
    input,
    aiCfg,
    botId,
    resetAt,
    timezone: deps.timezone,
    effectiveRegexRules,
    sanitizerStore: deps.inputSanitizerStore,
    fetchFn: deps.fetchFn,
  });
  const { rawUserText } = turnCtx;

  const selfieSkillEnabled = Boolean(aiCfg.selfie?.enabled && deps.isImageGenAvailable?.());
  const hasPromptInjectionTag = containsPromptInjectionMemoryTag(rawUserText);
  const prevSameUserTurn =
    selfieSkillEnabled && !hasPromptInjectionTag
      ? resolvePreviousSameUserTurnText({
          userId: input.userId,
          currentMessageId: input.messageId,
          botId,
          resetAt,
          replyChain: input.replyChain,
          channelWindow: input.channelWindow,
        })
      : '';
  const photoRequested =
    selfieSkillEnabled &&
    !hasPromptInjectionTag &&
    hasExplicitSelfieRequest(rawUserText, prevSameUserTurn);
  const turnNowMs = input.messageTimestamp ?? Date.now();
  const activeOc = resolveActiveOcProfile(aiCfg.selfie, deps.ocPresetStore?.listProfiles() ?? []);
  const activeOutfit = resolveActiveOcOutfit({
    oc: activeOc,
    selfieCfg: aiCfg.selfie,
    nowMs: turnNowMs,
    timezone: deps.timezone,
  });
  const selfieSkillPrompt = selfieSkillEnabled
    ? buildOcChatStatusPrompt({
        oc: activeOc,
        activeOutfit,
        photoRequested,
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
    currentUserName: turnCtx.effectiveUserName,
    speakerDesc: turnCtx.speakerDesc,
    activeProfiles: turnCtx.activeProfiles,
    combinedHistory: turnCtx.combinedHistory,
    finalUserMessageContent: turnCtx.userMessageContent,
    scanCorpusLower: turnCtx.scanCorpusLower,
  });

  const messages = compiled.messages;
  const effectiveTemperature =
    resolved.usingCustomPreset && resolved.preset.sampling.temperature !== undefined
      ? resolved.preset.sampling.temperature
      : aiCfg.temperature;
  const effectiveMaxTokens =
    resolved.usingCustomPreset && resolved.preset.sampling.maxTokens !== undefined
      ? resolved.preset.sampling.maxTokens
      : aiCfg.maxTokens;

  const extractCleanedCompletion = (rawContent: string) => {
    const combinedRawStream =
      compiled.renderedPrefill !== null ? `${compiled.renderedPrefill}${rawContent}` : rawContent;
    const cotStripped = stripCotBlocks(combinedRawStream, resolved.preset.cotStrip);
    let postCotText = cotStripped.cleaned;
    if (compiled.renderedPrefill !== null && !resolved.preset.assistantPrefill.keepInReply) {
      const trimmedPrefill = compiled.renderedPrefill.trim();
      if (trimmedPrefill && postCotText.startsWith(trimmedPrefill)) {
        postCotText = postCotText.slice(trimmedPrefill.length).trimStart();
      }
    }
    const tags = extractMemoryTags(postCotText);
    const selfieSpec =
      selfieSkillEnabled && !containsPromptInjectionMemoryTag(rawUserText)
        ? extractSelfieSkillTag(postCotText)
        : null;
    const cleanedText = cleanAiOutput(postCotText, resolved.card.personaName, effectiveRegexRules);
    const hasSavableUserMemory =
      aiCfg.memoryEnabled &&
      !containsPromptInjectionMemoryTag(rawUserText) &&
      tags.some((t) => t.scopeHint === 'user');
    return {
      cotStripped,
      tags,
      selfieSpec,
      cleanedText,
      isNonEmpty: cleanedText.length > 0 || hasSavableUserMemory || selfieSpec !== null,
    };
  };

  const startedAt = Date.now();
  let primaryAttempts = 0;
  let fallbackStarted = false;
  let fallbackUsed = false;
  try {
    const softLandingMessages = buildRefusalSoftLandingMessages(
      messages,
      resolved.card.personaName,
    );
    const baseRequest = {
      messages,
      refusalRetryMessages: softLandingMessages,
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      ...(resolved.preset.sampling.topP !== undefined
        ? { topP: resolved.preset.sampling.topP }
        : {}),
      ...(resolved.preset.sampling.frequencyPenalty !== undefined
        ? { frequencyPenalty: resolved.preset.sampling.frequencyPenalty }
        : {}),
      ...(resolved.preset.sampling.presencePenalty !== undefined
        ? { presencePenalty: resolved.preset.sampling.presencePenalty }
        : {}),
      validateContent: (raw: string) => extractCleanedCompletion(raw).isNonEmpty,
      isRefusalContent: (raw: string) =>
        isSafetyRefusalReply(extractCleanedCompletion(raw).cleanedText),
    };

    let response: LlmChatResponse;
    try {
      response = await deps.llmClient.chat({
        ...baseRequest,
        model: effectiveModel,
        maxRefusalRetries: 2,
      });
    } catch (primaryErr) {
      const primaryCode: LlmErrorCode = primaryErr instanceof LlmError ? primaryErr.code : 'unknown';
      primaryAttempts = primaryErr instanceof LlmError ? primaryErr.attempts : 1;
      const fallbackModel = resolved.effectiveFallbackModel;
      if (
        !fallbackModel ||
        primaryCode === 'not_configured' ||
        primaryCode === 'context_too_long'
      ) {
        throw primaryErr;
      }
      console.info(
        `[ai:fallback] from=${effectiveModel} to=${fallbackModel} reason=${primaryCode} primaryAttempts=${primaryAttempts} guild=${input.guildId} channel=${input.channelId}`,
      );
      fallbackStarted = true;
      const fallbackMessages =
        primaryCode === 'content_refusal'
          ? buildRefusalSoftLandingMessages(messages, resolved.card.personaName, {
              dropPriorTurns: true,
            })
          : messages;
      const fallbackResponse = await deps.llmClient.chat({
        ...baseRequest,
        messages: fallbackMessages,
        refusalRetryMessages:
          primaryCode === 'content_refusal' ? fallbackMessages : softLandingMessages,
        model: fallbackModel,
        maxRetries: 3,
        maxRefusalRetries: 2,
      });
      fallbackUsed = true;
      response = {
        ...fallbackResponse,
        attempts: primaryAttempts + fallbackResponse.attempts,
      };
    }
    const latencyMs = Math.max(0, Date.now() - startedAt);

    const { cotStripped, tags, selfieSpec, cleanedText } = extractCleanedCompletion(
      response.content,
    );
    const activePoses = deps.ocPresetStore?.listPoses() ?? listBuiltinOcPoses();
    const effectiveSelfieSpec =
      selfieSpec ??
      (selfieSkillEnabled && !hasPromptInjectionTag
        ? inferOcSelfieSpecFromTurn({
            oc: activeOc,
            activeOutfit,
            poses: activePoses,
            userContent: rawUserText,
            previousSameUserTurn: prevSameUserTurn,
            assistantReply: cleanedText,
            allowNsfw: aiCfg.selfie.allowNsfw,
          })
        : null);
    const selfieIntentText = prevSameUserTurn ? `${prevSameUserTurn}\n${rawUserText}` : rawUserText;
    const compiledSelfiePrompt = effectiveSelfieSpec
      ? compileOcSelfiePrompt({
          oc: activeOc,
          activeOutfit,
          poses: activePoses,
          spec: effectiveSelfieSpec,
          userContent: rawUserText,
          intentText: selfieIntentText,
          allowNsfw: aiCfg.selfie.allowNsfw,
          forceSpoiler: cfg.imageGen.forceSpoiler,
          rotationScopeKey: `${input.guildId}:${input.channelId}`,
        })
      : undefined;

    saveChannelDebugTrace(deps.debugTraces, {
      guildId: input.guildId,
      channelId: input.channelId,
      presetId: resolved.preset.id,
      presetVersion: resolved.preset.version,
      cardId: resolved.card.id,
      cardVersion: resolved.card.version,
      personaName: resolved.card.personaName,
      model: response.model,
      messages,
      rawResponse: response.content,
      extractedCot: cotStripped.extractedCot,
      cleanedReply: cleanedText,
      triggeredLorebookIds: compiled.triggeredLorebookIds,
      timestamp: Date.now(),
    });

    let storedMemoryCount = 0;
    if (aiCfg.memoryEnabled && !containsPromptInjectionMemoryTag(rawUserText)) {
      for (const tag of tags) {
        // Auto-extracted memory tags are strictly confined to user scope;
        // reject natural-language attempts to inject guild/channel memories.
        if (tag.scopeHint !== 'user') {
          continue;
        }
        const normalizedMem =
          normalizeChatInputSegment({
            text: tag.content,
            inputSanitizerEnabled,
            sanitizerStore: deps.inputSanitizerStore,
            regexRules: effectiveRegexRules,
          }).trim() || tag.content;
        try {
          deps.aiMemoryRepo.addMemory({
            guildId: input.guildId,
            scopeType: 'user',
            scopeId: input.userId,
            category: tag.category,
            content: normalizedMem,
            createdBy: 'ai',
            maxPerScope: aiCfg.maxMemoriesPerScope,
          });
          storedMemoryCount++;
        } catch {
          // Best-effort persistence
        }
      }
    }

    const baseReplyText =
      cleanedText ||
      (compiledSelfiePrompt
        ? EMPTY_AI_SELFIE_ONLY_FALLBACK
        : storedMemoryCount > 0
          ? EMPTY_AI_MEMORY_ONLY_FALLBACK
          : EMPTY_AI_REPLY_FALLBACK);
    const resolvedMentions = resolveOutgoingMentions(
      baseReplyText,
      turnCtx.mentionParticipants,
      2,
    );
    const finalReplyText = resolvedMentions.text;
    const chunks = splitDiscordMessage(finalReplyText);

    const usageCalc = computeReplyUsage({
      response,
      messages,
      inputPricePer1MUsd: aiCfg.inputPricePer1MUsd,
      outputPricePer1MUsd: aiCfg.outputPricePer1MUsd,
    });

    try {
      deps.aiMemoryRepo.recordUsageLog({
        guildId: input.guildId,
        channelId: input.channelId,
        userId: input.userId,
        model: response.model,
        status: 'ok',
        attempts: response.attempts,
        promptTokens: usageCalc.promptTokens,
        completionTokens: usageCalc.completionTokens,
        totalTokens: usageCalc.totalTokens,
        usageEstimated: usageCalc.estimated,
        estimatedCostUsd: usageCalc.costUsd,
        latencyMs,
        createdAt: Date.now(),
      });
    } catch {
      // Best-effort usage persistence
    }

    return {
      ok: true,
      replyText: finalReplyText,
      chunks,
      allowedMentionUserIds: resolvedMentions.allowedMentionUserIds,
      storedMemoryCount,
      ...(compiledSelfiePrompt ? { selfiePrompt: compiledSelfiePrompt } : {}),
      model: response.model,
      ...(fallbackUsed ? { fallbackUsed: true } : {}),
      attempts: response.attempts,
      usage: {
        ...usageCalc,
        latencyMs,
      },
    };
  } catch (err) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const errorCode: LlmErrorCode = err instanceof LlmError ? err.code : 'unknown';
    const errAttempts = err instanceof LlmError ? err.attempts : 1;
    const attempts = fallbackStarted ? primaryAttempts + errAttempts : errAttempts;
    const failedModel =
      fallbackStarted && resolved.effectiveFallbackModel
        ? resolved.effectiveFallbackModel
        : effectiveModel;
    try {
      deps.aiMemoryRepo.recordUsageLog({
        guildId: input.guildId,
        channelId: input.channelId,
        userId: input.userId,
        model: failedModel,
        status: 'error',
        errorCode,
        attempts,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        usageEstimated: false,
        estimatedCostUsd: 0,
        latencyMs,
        createdAt: Date.now(),
      });
    } catch {
      // Best-effort usage persistence
    }

    if (err instanceof LlmError) {
      return {
        ok: false,
        errorCode: err.code,
        errorMessage: err.userMessage,
        errorDetail: err.message,
      };
    }
    return {
      ok: false,
      errorCode: 'unknown',
      errorMessage: 'AI 回复时发生未知错误，请稍后再试。',
      errorDetail: err instanceof Error ? err.message : String(err),
    };
  }
}
