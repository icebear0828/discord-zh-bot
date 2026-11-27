import { INLINE_BASE_CHAR_LINE_RE } from './naiCharacterBlockParser.js';
import {
  dedupeTagList,
  normalizeTagKey,
  sanitizeTagSegment,
  splitTopLevelTags,
  stripMarkdownCodeFences,
} from './naiTagTokenizer.js';

const ANTI_CENSOR_NEG_WEIGHT = '-1.5::censored, mosaic censoring, bar censor::,';
const MULTI_CHAR_OR_VIEW_RE =
  /\b(?:1girl\s*,\s*1boy|1boy\s*,\s*1girl|[2-6](?:girls|boys|others)|multiple\s+(?:girls|boys|views))\b/i;

function ensureTrailingCommaText(text: string): string {
  const trimmed = text.trim().replace(/,+\s*$/, '');
  return trimmed ? `${trimmed},` : '';
}

function mergePositiveParagraphs(defaultPositivePrompt: string, rawBody: string): string {
  const rawParagraphs = rawBody
    .trim()
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (rawParagraphs.length === 0) {
    return '';
  }

  const allUserTags = rawParagraphs.flatMap((p) => splitTopLevelTags(sanitizeTagSegment(p)));
  if (allUserTags.length === 0) {
    return '';
  }

  const defaultTags = splitTopLevelTags(sanitizeTagSegment(defaultPositivePrompt));

  let hasSafeRating = false;
  let userRatingKey: string | null = null;
  for (const tag of allUserTags) {
    const match = tag.match(/\brating\s*:\s*([a-z]+)\b/i);
    if (match) {
      const level = match[1]!.toLowerCase();
      userRatingKey = `rating:${level}`;
      if (level === 'safe' || level === 'general') {
        hasSafeRating = true;
      }
    }
  }

  const filteredDefaults = defaultTags.filter((tag) => {
    const key = normalizeTagKey(tag);
    if (hasSafeRating && (key === 'nsfw' || key === 'uncensored' || /^rating\s*:/.test(key))) {
      return false;
    }
    if (userRatingKey && /^rating\s*:/.test(key) && key !== userRatingKey) {
      return false;
    }
    return true;
  });

  const firstRawLines = rawParagraphs[0]!.split('\n');
  const firstTagLines: string[] = [];
  const firstNegWeightLines: string[] = [];
  for (const line of firstRawLines) {
    if (/^\s*-\d+(?:\.\d+)?::/.test(line)) {
      const cleanedNeg = sanitizeTagSegment(line).replace(/,+\s*$/, '');
      if (cleanedNeg) {
        firstNegWeightLines.push(cleanedNeg);
      }
    } else {
      firstTagLines.push(line);
    }
  }

  const firstParaTags = splitTopLevelTags(sanitizeTagSegment(firstTagLines.join('\n')));
  const mergedFirstTags = dedupeTagList([...filteredDefaults, ...firstParaTags]).join(', ');
  const mergedFirst =
    firstNegWeightLines.length > 0
      ? [mergedFirstTags, ...firstNegWeightLines]
          .filter(Boolean)
          .map((part) => part.replace(/,+\s*$/, ''))
          .join(',\n')
      : mergedFirstTags;

  const cleanedParagraphs: string[] = [];
  if (mergedFirst) {
    cleanedParagraphs.push(mergedFirst);
  }

  for (let i = 1; i < rawParagraphs.length; i++) {
    const cleanedLines = rawParagraphs[i]!
      .split('\n')
      .map((line) => sanitizeTagSegment(line).replace(/,+\s*$/, ''))
      .filter(Boolean);
    if (cleanedLines.length > 0) {
      cleanedParagraphs.push(cleanedLines.join(',\n'));
    }
  }

  if (cleanedParagraphs.length === 0) {
    return '';
  }

  const isMultiParagraph = cleanedParagraphs.length > 1;
  let mergedBody = isMultiParagraph
    ? cleanedParagraphs
        .map((p, idx) => (idx < cleanedParagraphs.length - 1 ? ensureTrailingCommaText(p) : p))
        .join('\n\n')
    : cleanedParagraphs[0]!;

  const hasNsfw =
    !hasSafeRating &&
    (/\bnsfw\b/i.test(defaultPositivePrompt) || /\bnsfw\b/i.test(rawBody));
  const alreadyHasAntiCensor = /\b(?:censored|mosaic\s+censoring)\b/i.test(rawBody);
  const hadTrailingNegWeightComma =
    (isMultiParagraph || firstNegWeightLines.length > 0) &&
    Boolean(rawParagraphs.at(-1)?.trim().endsWith(','));

  if (hasNsfw && !alreadyHasAntiCensor) {
    mergedBody = `${ensureTrailingCommaText(mergedBody)}\n${ANTI_CENSOR_NEG_WEIGHT}`;
  } else if (hadTrailingNegWeightComma) {
    mergedBody = ensureTrailingCommaText(mergedBody);
  }

  return mergedBody;
}

/**
 * Prepend server default positive tags before user tags with deduplication,
 * preserve blank-line (`\n\n`) paragraph breaks in V5 multi-part prompts,
 * inject `-1.5::censored, mosaic censoring, bar censor::,` when NSFW is active,
 * and keep inline `Character N: ...` action lines at the end of Base Prompt.
 */
export function mergePositivePrompts(defaultPositivePrompt: string, userPrompt: string): string {
  const stripped = stripMarkdownCodeFences(userPrompt).replace(/\r\n/g, '\n');
  const rawLines = stripped.split('\n');
  const mainLines: string[] = [];
  const inlineCharLines: string[] = [];

  for (const line of rawLines) {
    const match = line.match(INLINE_BASE_CHAR_LINE_RE);
    if (match) {
      const charIdx = match[1]!;
      const cleanedRest = sanitizeTagSegment(match[2]!);
      if (cleanedRest) {
        inlineCharLines.push(`Character ${charIdx}: ${cleanedRest},`);
      }
    } else {
      mainLines.push(line);
    }
  }

  const mergedMain = mergePositiveParagraphs(defaultPositivePrompt, mainLines.join('\n'));
  if (inlineCharLines.length === 0) {
    return mergedMain;
  }
  if (!mergedMain) {
    return inlineCharLines.join('\n');
  }
  return `${ensureTrailingCommaText(mergedMain)}\n\n${inlineCharLines.join('\n')}`;
}

/**
 * Merge server default negative tags (Heavy UC + anti-mosaic) with user negative tags,
 * deduplicating case-insensitively so custom negative prompts never wipe anti-censor tags.
 */
export function mergeNegativePrompts(
  defaultNegativePrompt: string,
  userNegativePrompt: string,
): string {
  const defaultTags = splitTopLevelTags(sanitizeTagSegment(defaultNegativePrompt));
  const userTags = splitTopLevelTags(sanitizeTagSegment(userNegativePrompt));
  return dedupeTagList([...defaultTags, ...userTags]).join(', ');
}

/**
 * Remove `extra characters` cleanly from a negative prompt (both top-level and inside
 * NAI weight blocks like `2::extra characters, extra fingers, ...::`) without leaving
 * empty weight shells or stray commas.
 */
export function stripExtraCharactersFromNegative(negPrompt: string): string {
  if (!negPrompt.trim()) return '';
  const topTags = splitTopLevelTags(negPrompt);
  const out: string[] = [];

  for (const tag of topTags) {
    if (/^extra\s+characters$/i.test(tag.trim())) {
      continue;
    }

    const weightMatch = tag.match(/^(-?\d+(?:\.\d+)?)::(.*)::$/s);
    if (weightMatch) {
      const weightPrefix = weightMatch[1]!;
      const rawInner = weightMatch[2]!;
      const hadTrailingCommaSpace = /,\s*$/.test(rawInner);
      const innerParts = rawInner
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/^extra\s+characters$/i.test(s));
      if (innerParts.length === 0) {
        continue;
      }
      const rebuiltInner = innerParts.join(', ') + (hadTrailingCommaSpace ? ', ' : '');
      out.push(`${weightPrefix}::${rebuiltInner}::`);
      continue;
    }

    const bracketMatch = tag.match(/^(\{+|\[+)(.*?)(\}+|\]+)$/s);
    if (bracketMatch) {
      const open = bracketMatch[1]!;
      const rawInner = bracketMatch[2]!;
      const close = bracketMatch[3]!;
      const innerParts = rawInner
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/^extra\s+characters$/i.test(s));
      if (innerParts.length === 0) {
        continue;
      }
      out.push(`${open}${innerParts.join(', ')}${close}`);
      continue;
    }

    out.push(tag);
  }

  return out.join(', ');
}

export function hasMultiCharacterOrViewCue(basePrompt: string, charCount: number): boolean {
  if (charCount >= 2) {
    return true;
  }
  const stripped = stripMarkdownCodeFences(basePrompt);
  if (MULTI_CHAR_OR_VIEW_RE.test(stripped)) {
    return true;
  }
  const normalized = sanitizeTagSegment(stripped);
  if (MULTI_CHAR_OR_VIEW_RE.test(normalized)) {
    return true;
  }
  if (/^\s*Character\s+[2-6]\s*:/im.test(stripped)) {
    return true;
  }
  const withoutWeightBlocks = normalized.replace(/-?\d+(?:\.\d+)?::.*?::/gs, '');
  if (/\b1girl\b/i.test(withoutWeightBlocks) && /\b1boy\b/i.test(withoutWeightBlocks)) {
    return true;
  }
  return false;
}
