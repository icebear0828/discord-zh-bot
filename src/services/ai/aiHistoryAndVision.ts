import type { AiConfig } from '../../config/defaults.js';
import type { AiUserProfile } from '../aiProfiles.js';
import {
  normalizeDiscordCustomEmojis,
  type AiRegexRule,
} from '../aiRegex.js';
import type { LlmChatMessage, LlmContentPart, LlmImageUrlPart } from '../llmClient.js';
import {
  normalizeChatInputSegment,
  type AiInputSanitizerStore,
} from './aiInputSanitizer.js';
import {
  formatAiMinuteTimestamp,
  isSafetyRefusalReply,
} from './aiSafetyAndTokens.js';
import {
  extractVipAliases,
  formatSpeakerHeaderDesc,
  formatSpeakerLabel,
} from './aiSystemPromptBuilder.js';
import { stripBotMention } from './aiTextAndMentions.js';
import {
  MAX_AI_IMAGE_BYTES,
  MAX_AI_IMAGES_PER_MESSAGE,
  type DiscordAttachmentLike,
  type GenerateAiReplyInput,
  type MentionParticipant,
  type RawContextMessage,
} from './aiTypes.js';

const SELFIE_FALLBACK_FOOTNOTE_RE = /(?:\r?\n)?\*（📷 [^\r\n]*）\*\s*$/u;

export function sanitizeBotContextContent(rawText: string): string | null {
  const withoutFootnote = rawText.replace(SELFIE_FALLBACK_FOOTNOTE_RE, '').trim();
  if (!withoutFootnote) return null;
  if (withoutFootnote.startsWith('⚠️')) return null;
  if (isSafetyRefusalReply(withoutFootnote)) return null;
  return withoutFootnote;
}

export function mergeConversationHistory(params: {
  replyChain: RawContextMessage[];
  channelWindow: RawContextMessage[];
  currentMessageId: string;
  botId: string;
  resetAt: number;
  maxMessages: number;
  timezone?: string;
  inputRegexRules?: ReadonlyArray<AiRegexRule>;
  inputSanitizerEnabled?: boolean;
  sanitizerStore?: AiInputSanitizerStore;
  userProfiles?: ReadonlyArray<AiUserProfile>;
}): LlmChatMessage[] {
  const {
    replyChain,
    channelWindow,
    currentMessageId,
    botId,
    resetAt,
    maxMessages,
    timezone = 'Asia/Shanghai',
    inputRegexRules,
    inputSanitizerEnabled = false,
    sanitizerStore,
    userProfiles = [],
  } = params;
  if (maxMessages <= 0) return [];

  const profileByUserId = new Map<string, AiUserProfile>(
    userProfiles.map((p) => [p.userId, p]),
  );
  const vipAliases = extractVipAliases(userProfiles);
  const byId = new Map<string, { msg: RawContextMessage; fromReplyChain: boolean }>();

  for (const msg of channelWindow) {
    if (msg.id === currentMessageId || msg.createdTimestamp <= resetAt) continue;
    byId.set(msg.id, { msg, fromReplyChain: false });
  }
  for (const msg of replyChain) {
    if (msg.id === currentMessageId || msg.createdTimestamp <= resetAt) continue;
    byId.set(msg.id, { msg, fromReplyChain: true });
  }

  const cleaned: Array<{ msg: RawContextMessage; fromReplyChain: boolean; text: string }> = [];
  for (const item of byId.values()) {
    const isBotMsg = item.msg.isBot || item.msg.authorId === botId;
    if (isBotMsg && item.msg.hasEmbeds) continue;
    const stripped = stripBotMention(item.msg.content, botId);
    const normalizedEmojis = normalizeDiscordCustomEmojis(stripped);
    if (isBotMsg) {
      const sanitizedBotText = sanitizeBotContextContent(normalizedEmojis);
      const botText =
        sanitizedBotText ?? (item.msg.hasImages && !normalizedEmojis ? '（发送了图片）' : '');
      if (!botText) continue;
      cleaned.push({ ...item, text: botText });
      continue;
    }
    const text = normalizedEmojis || (item.msg.hasImages ? '（发送了图片）' : '');
    if (!text) continue;
    cleaned.push({ ...item, text });
  }

  cleaned.sort((a, b) => a.msg.createdTimestamp - b.msg.createdTimestamp);

  let selected = cleaned;
  if (cleaned.length > maxMessages) {
    const replyItems = cleaned.filter((item) => item.fromReplyChain);
    if (replyItems.length >= maxMessages) {
      selected = replyItems.slice(-maxMessages);
    } else {
      const replyIds = new Set(replyItems.map((i) => i.msg.id));
      const remainingSlots = maxMessages - replyItems.length;
      const nonReplyTail = cleaned
        .filter((item) => !replyIds.has(item.msg.id))
        .slice(-remainingSlots);
      selected = [...replyItems, ...nonReplyTail].sort(
        (a, b) => a.msg.createdTimestamp - b.msg.createdTimestamp,
      );
    }
  }

  const normalizeName = (rawName: string): string => {
    const clean = normalizeDiscordCustomEmojis(rawName);
    return (
      normalizeChatInputSegment({
        text: clean,
        inputSanitizerEnabled,
        sanitizerStore,
        regexRules: inputRegexRules,
      }).trim() || clean
    );
  };

  // Coalesce consecutive non-bot messages into a single role:'user' block
  // so LLM gateways always see clean user <-> assistant turns without speaker confusion.
  const result: LlmChatMessage[] = [];
  let pendingUserLines: string[] = [];

  const flushPendingUser = (): void => {
    if (pendingUserLines.length === 0) return;
    result.push({ role: 'user', content: pendingUserLines.join('\n') });
    pendingUserLines = [];
  };

  for (const { msg, text } of selected) {
    const minuteTs = formatAiMinuteTimestamp(msg.createdTimestamp, timezone);
    const tsPrefix = minuteTs ? `[${minuteTs}] ` : '';

    if (msg.authorId === botId) {
      flushPendingUser();
      const assistantText = normalizeDiscordCustomEmojis(text);
      result.push({ role: 'assistant', content: `${tsPrefix}${assistantText}` });
      continue;
    }

    const authorBase = normalizeName(msg.authorName);
    const authorLabel = formatSpeakerLabel({
      displayName: authorBase,
      profile: profileByUserId.get(msg.authorId),
      vipAliases,
    });

    let replyClause = '';
    if (msg.replyToAuthorId) {
      if (msg.replyToAuthorId === botId) {
        replyClause = ' 回复 你';
      } else {
        const targetBase = normalizeName(msg.replyToAuthorName || '群友');
        const targetLabel = formatSpeakerLabel({
          displayName: targetBase,
          profile: profileByUserId.get(msg.replyToAuthorId),
          vipAliases,
        });
        replyClause = ` 回复 ${targetLabel}`;
      }
    }

    const normalizedText = normalizeChatInputSegment({
      text,
      inputSanitizerEnabled,
      sanitizerStore,
      regexRules: inputRegexRules,
    });
    pendingUserLines.push(`${tsPrefix}[${authorLabel}${replyClause}]: ${normalizedText}`);
  }

  flushPendingUser();
  return result;
}

function inferImageMimeType(att: DiscordAttachmentLike): string {
  const ct = att.contentType?.split(';')[0]?.trim().toLowerCase();
  if (ct && ct.startsWith('image/')) {
    return ct;
  }
  const lowerName = att.name?.toLowerCase() ?? '';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

export async function loadImageParts(
  attachments: ReadonlyArray<DiscordAttachmentLike>,
  fetchFn: typeof fetch = fetch,
): Promise<LlmImageUrlPart[]> {
  const candidates = attachments
    .filter(
      (att) =>
        Boolean(att.contentType?.toLowerCase().startsWith('image/')) &&
        att.size > 0 &&
        att.size <= MAX_AI_IMAGE_BYTES,
    )
    .slice(0, MAX_AI_IMAGES_PER_MESSAGE);

  if (candidates.length === 0) return [];

  const parts: LlmImageUrlPart[] = [];
  for (const att of candidates) {
    try {
      const res = await fetchFn(att.url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_AI_IMAGE_BYTES) continue;
      const mime = inferImageMimeType(att);
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${mime};base64,${buf.toString('base64')}`,
        },
      });
    } catch {
      // Ignore individual broken/timed-out image downloads so text chat still works
    }
  }

  return parts;
}

export interface PreparedReplyTurnContext {
  rawUserText: string;
  effectiveUserName: string;
  speakerDesc: string;
  activeProfiles: AiUserProfile[];
  combinedHistory: LlmChatMessage[];
  userMessageContent: string | LlmContentPart[];
  scanCorpusLower: string;
  mentionParticipants: MentionParticipant[];
}

export async function prepareReplyTurnContext(params: {
  input: GenerateAiReplyInput;
  aiCfg: AiConfig;
  botId: string;
  resetAt: number;
  timezone: string;
  effectiveRegexRules: ReadonlyArray<AiRegexRule>;
  sanitizerStore?: AiInputSanitizerStore;
  fetchFn: typeof fetch;
}): Promise<PreparedReplyTurnContext> {
  const {
    input,
    aiCfg,
    botId,
    resetAt,
    timezone,
    effectiveRegexRules,
    sanitizerStore,
    fetchFn,
  } = params;
  const inputSanitizerEnabled = aiCfg.inputSanitizerEnabled !== false;

  const normalizeName = (rawName: string): string => {
    const clean = normalizeDiscordCustomEmojis(rawName);
    return (
      normalizeChatInputSegment({
        text: clean,
        inputSanitizerEnabled,
        sanitizerStore,
        regexRules: effectiveRegexRules,
      }).trim() || clean
    );
  };

  const profileByUserId = new Map<string, AiUserProfile>(
    aiCfg.userProfiles.map((p) => [p.userId, p]),
  );
  const activeProfileIds = new Set<string>();
  const participantNamesById = new Map<string, Set<string>>();

  const registerParticipant = (id: string | undefined, ...names: Array<string | undefined>): void => {
    if (!id || id === botId) return;
    if (profileByUserId.has(id)) {
      activeProfileIds.add(id);
    }
    let set = participantNamesById.get(id);
    if (!set) {
      set = new Set<string>();
      participantNamesById.set(id, set);
    }
    const profile = profileByUserId.get(id);
    if (profile?.alias.trim()) {
      set.add(profile.alias.trim());
    }
    for (const raw of names) {
      const trimmed = raw?.trim();
      if (!trimmed) continue;
      set.add(trimmed);
      const norm = normalizeName(trimmed);
      if (norm) set.add(norm);
    }
  };

  registerParticipant(input.userId, input.userName, input.userHandle);
  registerParticipant(input.replyToAuthorId, input.replyToAuthorName);
  for (const m of input.mentionedUsers ?? []) {
    if (m.id !== botId) {
      registerParticipant(m.id, m.name);
    }
  }
  for (const ctxMsg of [...(input.replyChain ?? []), ...(input.channelWindow ?? [])]) {
    if (!ctxMsg.isBot && ctxMsg.authorId !== botId) {
      registerParticipant(ctxMsg.authorId, ctxMsg.authorName);
    }
    if (ctxMsg.replyToAuthorId && ctxMsg.replyToAuthorId !== botId) {
      registerParticipant(ctxMsg.replyToAuthorId, ctxMsg.replyToAuthorName);
    }
    for (const m of ctxMsg.mentionedUsers ?? []) {
      if (m.id !== botId) {
        registerParticipant(m.id, m.name);
      }
    }
  }

  const vipAliases = extractVipAliases(aiCfg.userProfiles);
  const imageParts =
    aiCfg.visionEnabled && input.attachments && input.attachments.length > 0
      ? await loadImageParts(input.attachments, fetchFn)
      : [];

  const rawUserText =
    normalizeDiscordCustomEmojis(input.userContent.trim()) ||
    (imageParts.length > 0 ? '请看看这张图片。' : '你好');
  const sanitizeSeg = (text: string): string =>
    normalizeChatInputSegment({
      text,
      inputSanitizerEnabled,
      sanitizerStore,
      regexRules: effectiveRegexRules,
    });
  const normalizedUserText = sanitizeSeg(rawUserText).trim() || rawUserText;
  const effectiveUserName = normalizeName(input.userName);
  const effectiveUserHandle = input.userHandle?.trim() ? normalizeName(input.userHandle.trim()) : undefined;

  const scanTextsForProfiles: string[] = [normalizedUserText.toLowerCase(), effectiveUserName.toLowerCase()];
  if (effectiveUserHandle) scanTextsForProfiles.push(effectiveUserHandle.toLowerCase());
  if (input.replyToAuthorName?.trim()) {
    scanTextsForProfiles.push(normalizeName(input.replyToAuthorName).toLowerCase());
  }
  for (const m of input.mentionedUsers ?? []) {
    if (m.id !== botId) scanTextsForProfiles.push(normalizeName(m.name).toLowerCase());
  }
  for (const ctxMsg of [...(input.replyChain ?? []), ...(input.channelWindow ?? [])]) {
    if (ctxMsg.id === input.messageId || ctxMsg.createdTimestamp <= resetAt) continue;
    const isBotCtx = ctxMsg.isBot || ctxMsg.authorId === botId;
    if (isBotCtx && ctxMsg.hasEmbeds) continue;
    const emojiNormCtx = normalizeDiscordCustomEmojis(stripBotMention(ctxMsg.content, botId));
    const effectiveCtxText = isBotCtx ? sanitizeBotContextContent(emojiNormCtx) : emojiNormCtx;
    if (isBotCtx && !effectiveCtxText) continue;
    if (ctxMsg.authorName.trim()) scanTextsForProfiles.push(normalizeName(ctxMsg.authorName).toLowerCase());
    if (effectiveCtxText?.trim()) {
      const normCtx = isBotCtx ? effectiveCtxText : sanitizeSeg(effectiveCtxText);
      if (normCtx.trim()) scanTextsForProfiles.push(normCtx.toLowerCase());
    }
  }

  for (const p of aiCfg.userProfiles) {
    const aliasLower = p.alias.trim().toLowerCase();
    if (aliasLower.length >= 2 && scanTextsForProfiles.some((txt) => txt.includes(aliasLower))) {
      activeProfileIds.add(p.userId);
    }
  }

  const activeProfiles = aiCfg.userProfiles.filter((p) => activeProfileIds.has(p.userId));
  const currentUserProfile = profileByUserId.get(input.userId);
  const speakerDesc = formatSpeakerHeaderDesc({
    currentUserName: effectiveUserName,
    currentUserHandle: effectiveUserHandle,
    currentUserProfile,
    vipAliases,
  });

  const history = mergeConversationHistory({
    replyChain: input.replyChain ?? [],
    channelWindow: input.channelWindow ?? [],
    currentMessageId: input.messageId,
    botId,
    resetAt,
    maxMessages: aiCfg.contextWindowMessages,
    timezone,
    inputRegexRules: effectiveRegexRules,
    inputSanitizerEnabled,
    sanitizerStore,
    userProfiles: aiCfg.userProfiles,
  });

  const currentSpeakerLabel = formatSpeakerLabel({
    displayName: effectiveUserName,
    profile: currentUserProfile,
    vipAliases,
  });
  let currentReplyClause = '';
  if (input.replyToAuthorId) {
    if (input.replyToAuthorId === botId) {
      currentReplyClause = ' 回复 你';
    } else {
      const replyTargetBase = normalizeName(input.replyToAuthorName || '群友');
      const replyTargetLabel = formatSpeakerLabel({
        displayName: replyTargetBase,
        profile: profileByUserId.get(input.replyToAuthorId),
        vipAliases,
      });
      currentReplyClause = ` 回复 ${replyTargetLabel}`;
    }
  }

  const nonBotMentions = (input.mentionedUsers ?? []).filter((m) => m.id !== botId);
  const mentionHintLine =
    nonBotMentions.length > 0
      ? `\n（本句点名提到：${nonBotMentions
          .map((m) => {
            const name = normalizeName(m.name);
            const label = formatSpeakerLabel({
              displayName: name,
              profile: profileByUserId.get(m.id),
              vipAliases,
            });
            return `@${label}`;
          })
          .join('、')}）`
      : '';

  const currentMinuteTs = formatAiMinuteTimestamp(input.messageTimestamp ?? Date.now(), timezone);
  const currentTurnLine = `${currentMinuteTs ? `[${currentMinuteTs}] ` : ''}[${currentSpeakerLabel}${currentReplyClause}]: ${normalizedUserText}${mentionHintLine}`;

  // Merge trailing history user block into the final user turn so messages strictly alternate
  let combinedHistory = history;
  let formattedText = currentTurnLine;
  const lastHistory = history[history.length - 1];
  if (lastHistory && lastHistory.role === 'user' && typeof lastHistory.content === 'string') {
    combinedHistory = history.slice(0, -1);
    formattedText = [
      '【刚才频道对话】',
      lastHistory.content,
      '',
      '【当前对你说话】',
      currentTurnLine,
    ].join('\n');
  }

  const userMessageContent: string | LlmContentPart[] =
    imageParts.length > 0
      ? [{ type: 'text', text: formattedText }, ...imageParts]
      : formattedText;

  const mentionParticipants: MentionParticipant[] = [...participantNamesById.entries()].map(
    ([id, nameSet]) => ({
      id,
      names: [...nameSet],
    }),
  );

  return {
    rawUserText,
    effectiveUserName,
    speakerDesc,
    activeProfiles,
    combinedHistory,
    userMessageContent,
    scanCorpusLower: scanTextsForProfiles.join('\n'),
    mentionParticipants,
  };
}
