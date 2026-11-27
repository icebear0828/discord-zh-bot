import type { GuildConfig } from '../../config/defaults.js';
import type { AiMemoryScopeType } from '../../db/repositories/aiMemoryRepo.js';
import { applyAiRegexRules, type AiRegexRule } from '../aiRegex.js';
import { stripSelfieSkillTags } from './selfie/selfieTagParser.js';
import {
  EMPTY_AI_REPLY_FALLBACK,
  type ExtractedMemoryTag,
  type MentionParticipant,
  type ResolveOutgoingMentionsResult,
} from './aiTypes.js';

export function stripBotMention(text: string, botId: string): string {
  return text.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
}

function resolveScopeHint(category: string): AiMemoryScopeType {
  const lower = category.toLowerCase();
  if (lower === 'channel' || category === '频道') {
    return 'channel';
  }
  if (lower === 'guild' || lower === 'server' || category === '全服' || category === '群') {
    return 'guild';
  }
  return 'user';
}

export function extractMemoryTags(raw: string): ExtractedMemoryTag[] {
  const results: ExtractedMemoryTag[] = [];
  const seen = new Set<string>();
  const regex = /\[MEMORY:([^\]]+)\]/gi;

  for (const match of raw.matchAll(regex)) {
    const inner = match[1]?.trim();
    if (!inner) continue;

    let category = 'general';
    let content = inner;
    const colonIdx = inner.indexOf(':');
    if (colonIdx > 0 && colonIdx < 24) {
      const maybeCat = inner.slice(0, colonIdx).trim();
      const rest = inner.slice(colonIdx + 1).trim();
      if (maybeCat && rest && /^[\p{L}\p{N}_-]+$/u.test(maybeCat)) {
        category = maybeCat;
        content = rest;
      }
    }

    const normalized = content.replace(/\s+/g, ' ').slice(0, 200);
    if (!normalized) continue;
    const dedupKey = `${category}:${normalized}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    results.push({
      category,
      content: normalized,
      scopeHint: resolveScopeHint(category),
    });
    if (results.length >= 3) break;
  }

  return results;
}

const LEADING_TIMESTAMP_PREFIX_RE =
  /^\[(?:\d{4}[-/])?\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\]\s*(?:[:：]\s*)?/;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingSpeakerPrefix(text: string, personaName?: string): string {
  let out = text.trimStart();
  const trimmedName = personaName?.trim();
  const plainNameRegex = trimmedName
    ? new RegExp(`^(?:${escapeRegExp(trimmedName)})\\s*[:：]\\s*`, 'i')
    : null;

  for (let i = 0; i < 4; i++) {
    const afterTimestamp = out.replace(LEADING_TIMESTAMP_PREFIX_RE, '');
    if (afterTimestamp !== out) {
      out = afterTimestamp.trimStart();
      continue;
    }
    const afterBracket = out.replace(/^\[[^\]\r\n]{1,32}\]\s*[:：]\s*/, '');
    if (afterBracket !== out) {
      out = afterBracket.trimStart();
      continue;
    }
    if (plainNameRegex) {
      const afterPlain = out.replace(plainNameRegex, '');
      if (afterPlain !== out) {
        out = afterPlain.trimStart();
        continue;
      }
    }
    break;
  }

  return out;
}

export function cleanAiOutput(
  raw: string,
  personaName?: string,
  regexRules?: ReadonlyArray<AiRegexRule>,
): string {
  let out = stripSelfieSkillTags(raw);
  out = out.replace(/\[MEMORY:[^\]]*\]/gi, '');
  out = out.replace(/\[VOICE:[^\]]*\]/gi, '');
  out = out.replace(/\[IMAGE:[^\]]*\]/gi, '');
  out = out.replace(/\[USAGE:\{[^\]]*\}\]/gi, '');
  out = stripLeadingSpeakerPrefix(out, personaName);
  if (regexRules && regexRules.length > 0) {
    out = applyAiRegexRules(out, regexRules, 'output', { preserveCodeBlocks: true });
  }
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

const CODE_FENCE_OPEN_RE = /^```([^\s`]*)\s*$/;
const CODE_FENCE_CLOSE_RE = /^```\s*$/;

export function splitDiscordMessage(text: string, maxLen = 2000): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [EMPTY_AI_REPLY_FALLBACK];
  }
  if (trimmed.length <= maxLen) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let current = '';
  let activeFenceLang: string | null = null;
  const closeSuffix = '\n```';

  const flushChunk = (): void => {
    if (!current) return;
    if (activeFenceLang !== null) {
      const openMarker = `\`\`\`${activeFenceLang}`;
      if (current === openMarker) {
        current = '';
        return;
      }
      chunks.push(`${current}${closeSuffix}`);
      current = openMarker;
    } else {
      chunks.push(current);
      current = '';
    }
  };

  for (const line of trimmed.split('\n')) {
    const trimmedLine = line.trim();
    const isClosingFence = activeFenceLang !== null && CODE_FENCE_CLOSE_RE.test(trimmedLine);
    const openMatch: RegExpExecArray | null =
      activeFenceLang === null ? CODE_FENCE_OPEN_RE.exec(trimmedLine) : null;

    const nextInFence = isClosingFence
      ? false
      : openMatch !== null
        ? true
        : activeFenceLang !== null;
    const reserve = nextInFence ? closeSuffix.length : 0;

    if (isClosingFence && activeFenceLang !== null && current === `\`\`\`${activeFenceLang}`) {
      current = '';
      activeFenceLang = null;
      continue;
    }

    const candidateLen = current ? current.length + 1 + line.length : line.length;
    if (candidateLen + reserve > maxLen) {
      flushChunk();
    }

    const afterFlushLen = current ? current.length + 1 + line.length : line.length;
    if (afterFlushLen + reserve > maxLen) {
      if (activeFenceLang !== null) {
        const openMarker = `\`\`\`${activeFenceLang}`;
        const headerPrefix = `${openMarker}\n`;
        const sliceBudget = Math.max(1, maxLen - headerPrefix.length - closeSuffix.length);
        for (let i = 0; i < line.length; i += sliceBudget) {
          const piece = line.slice(i, i + sliceBudget);
          chunks.push(`${headerPrefix}${piece}${closeSuffix}`);
        }
        current = openMarker;
      } else {
        for (let i = 0; i < line.length; i += maxLen) {
          chunks.push(line.slice(i, i + maxLen));
        }
        current = '';
      }
    } else {
      current = current ? `${current}\n${line}` : line;
    }

    if (isClosingFence) {
      activeFenceLang = null;
    } else if (openMatch !== null) {
      activeFenceLang = openMatch[1] ?? '';
    }
  }

  if (current) {
    if (activeFenceLang !== null) {
      const openMarker = `\`\`\`${activeFenceLang}`;
      if (current !== openMarker) {
        chunks.push(`${current}${closeSuffix}`);
      }
    } else {
      chunks.push(current);
    }
  }

  return chunks.length > 0 ? chunks : [EMPTY_AI_REPLY_FALLBACK];
}

export function shouldTriggerAi(params: {
  cfg: GuildConfig;
  channelId: string;
  isMentioned: boolean;
  isReplyToBot: boolean;
}): boolean {
  if (!params.cfg.modules.ai) return false;
  if (params.cfg.ai.ignoredChannelIds.includes(params.channelId)) return false;
  if (
    params.cfg.ai.allowedChannelIds.length > 0 &&
    !params.cfg.ai.allowedChannelIds.includes(params.channelId)
  ) {
    return false;
  }
  return (
    params.isMentioned ||
    params.isReplyToBot ||
    params.cfg.ai.freeChatChannelIds.includes(params.channelId)
  );
}

const CODE_BLOCK_SEGMENT_RE = /(```[\s\S]*?```)/g;
const INLINE_CODE_SEGMENT_RE = /(`[^`\n]+`)/g;
const STANDALONE_USER_TAG_RE = /^<@!?(\d{15,22})>$/;

function grantMentionTag(
  userId: string,
  fallbackName: string,
  allowedSet: Set<string>,
  allowedOrder: string[],
  maxMentions: number,
): string {
  if (allowedSet.has(userId)) {
    return `<@${userId}>`;
  }
  if (allowedOrder.length < maxMentions) {
    allowedSet.add(userId);
    allowedOrder.push(userId);
    return `<@${userId}>`;
  }
  return `@${fallbackName}`;
}

function resolveInlineCodeMention(
  part: string,
  participantById: ReadonlyMap<string, string>,
  sortedCandidates: ReadonlyArray<{ id: string; name: string; regex: RegExp }>,
  allowedSet: Set<string>,
  allowedOrder: string[],
  maxMentions: number,
): string {
  const inner = part.slice(1, -1).trim();
  const tagMatch = STANDALONE_USER_TAG_RE.exec(inner);
  if (tagMatch) {
    const userId = tagMatch[1]!;
    const primaryName = participantById.get(userId);
    if (!primaryName) {
      return '@群友';
    }
    return grantMentionTag(userId, primaryName, allowedSet, allowedOrder, maxMentions);
  }

  if (inner.startsWith('@')) {
    const mentionTarget = inner.slice(1).toLowerCase();
    const matched = sortedCandidates.find(
      (candidate) => candidate.name.toLowerCase() === mentionTarget,
    );
    if (matched) {
      return grantMentionTag(matched.id, matched.name, allowedSet, allowedOrder, maxMentions);
    }
  }

  return part;
}

function resolveOutgoingMentionsPlain(
  segment: string,
  participantById: ReadonlyMap<string, string>,
  sortedCandidates: ReadonlyArray<{ id: string; name: string; regex: RegExp }>,
  allowedSet: Set<string>,
  allowedOrder: string[],
  maxMentions: number,
): string {
  let out = segment.replace(/@(everyone|here)\b/gi, (_m, target: string) => `@\u200b${target}`);

  // 1. Validate existing <@id> or <@!id> tags against participant allowlist
  out = out.replace(/<@!?(\d{15,22})>/g, (_m, userId: string) => {
    const primaryName = participantById.get(userId);
    if (!primaryName) {
      return '@群友';
    }
    return grantMentionTag(userId, primaryName, allowedSet, allowedOrder, maxMentions);
  });

  // 2. Replace @DisplayName / @Alias with real <@userId> (preserving order, capped at maxMentions)
  for (const candidate of sortedCandidates) {
    out = out.replace(candidate.regex, (fullMatch, prefix: string) => {
      if (allowedSet.has(candidate.id)) {
        return `${prefix}<@${candidate.id}>`;
      }
      if (allowedOrder.length < maxMentions) {
        allowedSet.add(candidate.id);
        allowedOrder.push(candidate.id);
        return `${prefix}<@${candidate.id}>`;
      }
      return fullMatch;
    });
  }

  return out;
}

function resolveOutgoingMentionsSegment(
  segment: string,
  participantById: ReadonlyMap<string, string>,
  sortedCandidates: ReadonlyArray<{ id: string; name: string; regex: RegExp }>,
  allowedSet: Set<string>,
  allowedOrder: string[],
  maxMentions: number,
): string {
  if (!segment.includes('`')) {
    return resolveOutgoingMentionsPlain(
      segment,
      participantById,
      sortedCandidates,
      allowedSet,
      allowedOrder,
      maxMentions,
    );
  }

  return segment
    .split(INLINE_CODE_SEGMENT_RE)
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 3 && !part.includes('\n')) {
        return resolveInlineCodeMention(
          part,
          participantById,
          sortedCandidates,
          allowedSet,
          allowedOrder,
          maxMentions,
        );
      }
      return resolveOutgoingMentionsPlain(
        part,
        participantById,
        sortedCandidates,
        allowedSet,
        allowedOrder,
        maxMentions,
      );
    })
    .join('');
}

export function resolveOutgoingMentions(
  text: string,
  participants: ReadonlyArray<MentionParticipant>,
  maxMentions = 2,
): ResolveOutgoingMentionsResult {
  if (!text) {
    return { text, allowedMentionUserIds: [] };
  }

  const safeCap = Math.max(0, Math.min(5, Math.floor(maxMentions)));
  const participantById = new Map<string, string>();
  const candidateEntries: Array<{ id: string; name: string }> = [];
  const seenPairs = new Set<string>();

  for (const p of participants) {
    const id = p.id.trim();
    if (!/^\d{15,22}$/.test(id) && !id) continue;
    const cleanNames = p.names
      .map((n) => n.trim())
      .filter((n) => n.length > 0 && !n.includes('\n') && !n.includes('\r'));
    if (cleanNames.length === 0) continue;
    if (!participantById.has(id)) {
      participantById.set(id, cleanNames[0]!);
    }
    for (const name of cleanNames) {
      const key = `${id}\0${name.toLowerCase()}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      candidateEntries.push({ id, name });
    }
  }

  candidateEntries.sort((a, b) => b.name.length - a.name.length);
  const sortedCandidates = candidateEntries.map((entry) => ({
    ...entry,
    // Match @name only when not preceded by word/email chars or '<' (already converted <@id>),
    // and ensure trailing boundary isn't glued to another word char.
    regex: new RegExp(
      `(^|[^\\p{L}\\p{N}_<@])@${escapeRegExp(entry.name)}(?=$|[^\\p{L}\\p{N}_])`,
      'giu',
    ),
  }));

  const allowedSet = new Set<string>();
  const allowedOrder: string[] = [];

  if (!text.includes('```')) {
    const resolved = resolveOutgoingMentionsSegment(
      text,
      participantById,
      sortedCandidates,
      allowedSet,
      allowedOrder,
      safeCap,
    );
    return { text: resolved, allowedMentionUserIds: allowedOrder };
  }

  const parts = text.split(CODE_BLOCK_SEGMENT_RE);
  const resolved = parts
    .map((part) => {
      if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
        return part;
      }
      return resolveOutgoingMentionsSegment(
        part,
        participantById,
        sortedCandidates,
        allowedSet,
        allowedOrder,
        safeCap,
      );
    })
    .join('');

  return { text: resolved, allowedMentionUserIds: allowedOrder };
}
