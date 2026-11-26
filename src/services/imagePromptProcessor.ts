import type { NaiCharCaption, NaiCharCaptionCenter } from './imageClient.js';

export const MAX_NAI_CHARACTERS = 6;

export interface ImagePromptContext {
  rawPrompt: string;
  userNegativePrompt: string;
  defaultPositivePrompt: string;
  defaultNegativePrompt: string;
  charCaptions?: readonly NaiCharCaption[];
  rawCharacterPrompt?: string;
  useCoords?: boolean;
}

export interface ProcessedImagePrompt {
  finalPrompt: string;
  finalNegativePrompt: string;
  effectiveRawPrompt?: string;
  charCaptions?: NaiCharCaption[];
  useCoords?: boolean;
}

export interface ImagePromptProcessor {
  process(input: ImagePromptContext): Promise<ProcessedImagePrompt>;
}

/**
 * Split tag string on top-level commas only, keeping commas inside NAI weight
 * blocks (`1.3::a, b::`), curly braces (`{a, b}`), brackets (`[a, b]`), and parens.
 */
export function splitTopLevelTags(raw: string): string[] {
  const tags: string[] = [];
  let buf = '';
  let curlyDepth = 0;
  let squareDepth = 0;
  let parenDepth = 0;
  let inWeightColons = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const next = raw[i + 1];

    if (ch === ':' && next === ':') {
      inWeightColons = !inWeightColons;
      buf += '::';
      i += 1;
      continue;
    }
    if (ch === '{') {
      curlyDepth += 1;
    } else if (ch === '}' && curlyDepth > 0) {
      curlyDepth -= 1;
    } else if (ch === '[') {
      squareDepth += 1;
    } else if (ch === ']' && squareDepth > 0) {
      squareDepth -= 1;
    } else if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')' && parenDepth > 0) {
      parenDepth -= 1;
    } else if (
      ch === ',' &&
      !inWeightColons &&
      curlyDepth === 0 &&
      squareDepth === 0 &&
      parenDepth === 0
    ) {
      const trimmed = buf.trim().replace(/[ \t]{2,}/g, ' ');
      if (trimmed) {
        tags.push(trimmed);
      }
      buf = '';
      continue;
    }
    buf += ch;
  }

  const tail = buf.trim().replace(/[ \t]{2,}/g, ' ');
  if (tail) {
    tags.push(tail);
  }
  return tags;
}

function stripMarkdownCodeFences(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/```(?:txt|text|md|markdown|prompt|tags|json|yaml|yml)?[ \t]*\r?\n?/gi, '')
    .replace(/```/g, '');
}

/**
 * Strip markdown code fences, normalize NBSP and fullwidth punctuation/newlines,
 * and join cleaned top-level tags cleanly.
 */
export function sanitizeTagSegment(raw: string): string {
  const normalized = stripMarkdownCodeFences(raw)
    .replace(/[，、；]/g, ', ')
    .replace(/[\r\n]+/g, ', ');
  return splitTopLevelTags(normalized).join(', ');
}

function normalizeTagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeTagList(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = normalizeTagKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Parse normalized 0..1 coordinates (`0.25, 0.5` / `(0.25, 0.5)`) or NAI 5x5 grid (`A1`~`E5`).
 */
export function parseCoordSpec(raw: string): NaiCharCaptionCenter | null {
  const cleaned = raw
    .trim()
    .replace(/^@+/, '')
    .replace(/^[([（【]\s*/, '')
    .replace(/\s*[)\]）】]$/, '')
    .replace(/^@+/, '')
    .trim();
  if (!cleaned) return null;

  const gridMatch = cleaned.match(/^([A-Ea-e])\s*([1-5])$/);
  if (gridMatch) {
    const colIdx = gridMatch[1]!.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
    const rowIdx = Number.parseInt(gridMatch[2]!, 10) - 1;
    return {
      x: Number((colIdx * 0.2 + 0.1).toFixed(2)),
      y: Number((rowIdx * 0.2 + 0.1).toFixed(2)),
    };
  }

  const numMatch = cleaned.match(/^([01](?:\.\d+)?|\.\d+)\s*[,，]\s*([01](?:\.\d+)?|\.\d+)$/);
  if (!numMatch) return null;

  const x = Number.parseFloat(numMatch[1]!);
  const y = Number.parseFloat(numMatch[2]!);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return {
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
  };
}

function stripHeaderDecorations(line: string): string {
  return line
    .trim()
    .replace(/^#{1,4}\s+/, '')
    .replace(/^\*\*(.+?)\*\*\s*([:：].*)$/, '$1$2');
}

const BASE_HEADER_RE = /^(?:Base\s+Prompt|Main\s+Prompt|主提示词|主串)\s*[:：]\s*(.*)$/i;
const CHAR_UC_HEADER_RE =
  /^(?:Character|Char|角色)\s*([1-6])\s*(?:UC|Undesired\s+Content|Negative(?:\s+Prompt)?|负面(?:词)?)\s*[:：]\s*(.*)$/i;
const CHAR_HEADER_RE =
  /^(?:Character|Char|角色)\s*([1-6])(?:\s+Prompt)?(?:\s*(?:@\s*([A-Ea-e][1-5]|[01]?(?:\.\d+)?\s*[,，]\s*[01]?(?:\.\d+)?)|[([（【]\s*([^)\]）】]+)\s*[)\]）】]))?\s*[:：]\s*(.*)$/i;
const GLOBAL_UC_HEADER_RE =
  /^(?:Undesired\s+Content|Negative\s+Prompt|UC|负面提示词|负面词)\s*[:：]\s*(.*)$/i;
const NOTES_HEADER_RE = /^(?:补充|附注|说明|Note|Notes)\s*[:：]\s*(.*)$/i;
const INLINE_BASE_CHAR_LINE_RE = /^\s*Character\s+([1-6])\s*:\s*(.+)$/i;

interface ParsedSingleCharBlock {
  caption: NaiCharCaption;
  hasExplicitCoord: boolean;
}

function parseSingleCharacterBlock(
  rawLines: readonly string[],
  headerCoord?: NaiCharCaptionCenter | null,
  extraUcLines?: readonly string[],
): ParsedSingleCharBlock | null {
  let coord: NaiCharCaptionCenter | null = headerCoord ?? null;
  const captionParts: string[] = [];
  const ucParts: string[] = [...(extraUcLines ?? [])];
  let checkedLeadingCoord = Boolean(coord);

  for (const rawLine of rawLines) {
    const cleanedLine = stripMarkdownCodeFences(rawLine).trim();
    if (!cleanedLine) continue;

    const ucLineMatch = cleanedLine.match(
      /^(?:UC|Undesired\s+Content|Negative(?:\s+Prompt)?|负面(?:词)?)\s*[:：]\s*(.*)$/i,
    );
    if (ucLineMatch) {
      if (ucLineMatch[1]?.trim()) {
        ucParts.push(ucLineMatch[1].trim());
      }
      continue;
    }

    let working = cleanedLine;
    const pipeUcMatch = working.match(
      /^(.*?)\s*[|｜]\s*(?:UC|Undesired\s+Content|Negative(?:\s+Prompt)?|负面(?:词)?)\s*[:：]\s*(.*)$/i,
    );
    if (pipeUcMatch) {
      working = pipeUcMatch[1]?.trim() ?? '';
      if (pipeUcMatch[2]?.trim()) {
        ucParts.push(pipeUcMatch[2].trim());
      }
    }

    if (!checkedLeadingCoord && working) {
      checkedLeadingCoord = true;
      const atPrefix = working.match(
        /^@\s*([A-Ea-e][1-5]|[01]?(?:\.\d+)?\s*[,，]\s*[01]?(?:\.\d+)?)(?:\s+|,\s*|$)(.*)$/,
      );
      const bracketPrefix = !atPrefix
        ? working.match(
            /^[([（【]\s*(@?\s*(?:[A-Ea-e][1-5]|[01]?(?:\.\d+)?\s*[,，]\s*[01]?(?:\.\d+)?))\s*[)\]）】](?:\s+|,\s*|$)(.*)$/,
          )
        : null;
      const candidate = atPrefix?.[1] ?? bracketPrefix?.[1];
      const rest = atPrefix?.[2] ?? bracketPrefix?.[2];
      if (candidate !== undefined) {
        const parsed = parseCoordSpec(candidate);
        if (parsed) {
          coord = parsed;
          working = (rest ?? '').trim();
        }
      }
    }

    if (working) {
      captionParts.push(working);
    }
  }

  const charCaption = sanitizeTagSegment(captionParts.join('\n'));
  if (!charCaption) return null;
  const uc = sanitizeTagSegment(ucParts.join('\n'));

  return {
    caption: {
      char_caption: charCaption,
      ...(uc ? { uc } : {}),
      ...(coord ? { centers: [coord] } : {}),
    },
    hasExplicitCoord: Boolean(coord),
  };
}

export interface ParsedCharacterPromptsResult {
  charCaptions: NaiCharCaption[];
  hasExplicitCoords: boolean;
}

/**
 * Parse dedicated Character 1~6 prompt input (supports `Character N:` headers,
 * `---` or blank-line separated character blocks, `@0.3,0.5` / `@B3` coords, and `UC:` lines).
 */
export function parseCharacterPromptsText(raw: string): ParsedCharacterPromptsResult {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { charCaptions: [], hasExplicitCoords: false };
  }

  const lines = normalized.split('\n');
  const hasExplicitHeaders = lines.some((line) => {
    const clean = stripHeaderDecorations(line);
    return CHAR_HEADER_RE.test(clean) || CHAR_UC_HEADER_RE.test(clean);
  });

  if (hasExplicitHeaders) {
    const slots = new Map<
      number,
      { lines: string[]; ucLines: string[]; coord: NaiCharCaptionCenter | null }
    >();
    const ensureSlot = (idx: number) => {
      let slot = slots.get(idx);
      if (!slot) {
        slot = { lines: [], ucLines: [], coord: null };
        slots.set(idx, slot);
      }
      return slot;
    };

    let current: { kind: 'char' | 'uc'; idx: number } | null = null;
    for (const line of lines) {
      if (/^\s*```/.test(line)) continue;
      const clean = stripHeaderDecorations(line);
      const ucMatch = clean.match(CHAR_UC_HEADER_RE);
      if (ucMatch) {
        const idx = Number.parseInt(ucMatch[1]!, 10);
        const slot = ensureSlot(idx);
        if (ucMatch[2]?.trim()) {
          slot.ucLines.push(ucMatch[2].trim());
        }
        current = { kind: 'uc', idx };
        continue;
      }
      const charMatch = clean.match(CHAR_HEADER_RE);
      if (charMatch) {
        const idx = Number.parseInt(charMatch[1]!, 10);
        const slot = ensureSlot(idx);
        const rawCoord = charMatch[2] ?? charMatch[3];
        if (rawCoord) {
          const parsedCoord = parseCoordSpec(rawCoord);
          if (parsedCoord) {
            slot.coord = parsedCoord;
          }
        }
        if (charMatch[4]?.trim()) {
          slot.lines.push(charMatch[4].trim());
        }
        current = { kind: 'char', idx };
        continue;
      }

      if (!current) {
        current = { kind: 'char', idx: 1 };
      }
      const slot = ensureSlot(current.idx);
      if (current.kind === 'uc') {
        slot.ucLines.push(line);
      } else {
        slot.lines.push(line);
      }
    }

    const sortedIndices = [...slots.keys()].sort((a, b) => a - b).slice(0, MAX_NAI_CHARACTERS);
    const charCaptions: NaiCharCaption[] = [];
    let hasExplicitCoords = false;
    for (const idx of sortedIndices) {
      const slot = slots.get(idx)!;
      const parsed = parseSingleCharacterBlock(slot.lines, slot.coord, slot.ucLines);
      if (parsed) {
        charCaptions.push(parsed.caption);
        if (parsed.hasExplicitCoord) {
          hasExplicitCoords = true;
        }
      }
    }
    return { charCaptions, hasExplicitCoords };
  }

  const cleanedBody = stripMarkdownCodeFences(normalized).trim();
  if (!cleanedBody) {
    return { charCaptions: [], hasExplicitCoords: false };
  }

  const rawBlocks = cleanedBody
    .split(/\n[ \t]*(?:---+|[ \t]*\n)+[ \t]*/)
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, MAX_NAI_CHARACTERS);

  const charCaptions: NaiCharCaption[] = [];
  let hasExplicitCoords = false;
  for (const block of rawBlocks) {
    const parsed = parseSingleCharacterBlock(block.split('\n'));
    if (parsed) {
      charCaptions.push(parsed.caption);
      if (parsed.hasExplicitCoord) {
        hasExplicitCoords = true;
      }
    }
  }
  return { charCaptions, hasExplicitCoords };
}

/**
 * Format saved character captions into clean, round-trippable multi-block text for Edit Modals.
 */
export function formatCharacterPromptsText(chars: readonly NaiCharCaption[]): string {
  return chars
    .slice(0, MAX_NAI_CHARACTERS)
    .map((item, idx) => {
      const center = item.centers?.[0];
      const coordSuffix = center ? ` (${center.x}, ${center.y})` : '';
      const lines = [`Character ${idx + 1}${coordSuffix}:`, item.char_caption];
      if (item.uc?.trim()) {
        lines.push(`UC: ${item.uc.trim()}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

export interface StructuredNaiPrompt {
  basePrompt: string;
  charCaptions: NaiCharCaption[];
  negativePrompt: string;
  hasExplicitCoords: boolean;
}

/**
 * Parse full multi-section NAI V5 prompt paste (`Base Prompt:`, `Character 1~6:`,
 * `Character N UC:`, `Undesired Content:`, `补充:`), while preserving inline
 * `Character N: girl, source#...` action lines inside `Base Prompt`.
 */
export function parseStructuredNaiPrompt(rawPrompt: string): StructuredNaiPrompt {
  const normalized = rawPrompt.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  let scanFence = false;
  let hasExplicitBaseHeader = false;
  let hasStandaloneCharHeader = false;
  let hasCharUcHeader = false;
  let hasGlobalUcHeader = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      scanFence = !scanFence;
      continue;
    }
    if (scanFence) continue;
    const clean = stripHeaderDecorations(line);
    if (BASE_HEADER_RE.test(clean)) {
      hasExplicitBaseHeader = true;
      continue;
    }
    if (CHAR_UC_HEADER_RE.test(clean)) {
      hasCharUcHeader = true;
      continue;
    }
    const charMatch = clean.match(CHAR_HEADER_RE);
    if (charMatch) {
      const hasCoord = Boolean(charMatch[2] || charMatch[3]);
      const rest = (charMatch[4] ?? '').trim();
      if (!rest || hasCoord) {
        hasStandaloneCharHeader = true;
      }
      continue;
    }
    if (GLOBAL_UC_HEADER_RE.test(clean)) {
      hasGlobalUcHeader = true;
    }
  }

  const hasAnySectionHeader =
    hasExplicitBaseHeader || hasStandaloneCharHeader || hasCharUcHeader || hasGlobalUcHeader;
  if (!hasAnySectionHeader) {
    return {
      basePrompt: rawPrompt,
      charCaptions: [],
      negativePrompt: '',
      hasExplicitCoords: false,
    };
  }

  const baseLines: string[] = [];
  const ucLines: string[] = [];
  const charSlots = new Map<
    number,
    { lines: string[]; ucLines: string[]; coord: NaiCharCaptionCenter | null }
  >();
  const ensureSlot = (idx: number) => {
    let slot = charSlots.get(idx);
    if (!slot) {
      slot = { lines: [], ucLines: [], coord: null };
      charSlots.set(idx, slot);
    }
    return slot;
  };

  type SectionState =
    | { kind: 'base' }
    | { kind: 'char'; idx: number }
    | { kind: 'char_uc'; idx: number }
    | { kind: 'uc' }
    | { kind: 'notes' };

  let state: SectionState = { kind: 'base' };
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      const clean = stripHeaderDecorations(line);

      const baseMatch = clean.match(BASE_HEADER_RE);
      if (baseMatch) {
        state = { kind: 'base' };
        if (baseMatch[1]?.trim()) {
          baseLines.push(baseMatch[1].trim());
        }
        continue;
      }

      const charUcMatch = clean.match(CHAR_UC_HEADER_RE);
      if (charUcMatch) {
        const idx = Number.parseInt(charUcMatch[1]!, 10);
        const slot = ensureSlot(idx);
        if (charUcMatch[2]?.trim()) {
          slot.ucLines.push(charUcMatch[2].trim());
        }
        state = { kind: 'char_uc', idx };
        continue;
      }

      const charMatch = clean.match(CHAR_HEADER_RE);
      if (charMatch) {
        const idx = Number.parseInt(charMatch[1]!, 10);
        const rawCoord = charMatch[2] ?? charMatch[3];
        const parsedCoord = rawCoord ? parseCoordSpec(rawCoord) : null;
        const rest = (charMatch[4] ?? '').trim();

        const isSectionHeader =
          !rest ||
          parsedCoord !== null ||
          state.kind !== 'base' ||
          (hasExplicitBaseHeader && !hasStandaloneCharHeader);

        if (isSectionHeader) {
          const slot = ensureSlot(idx);
          if (parsedCoord) {
            slot.coord = parsedCoord;
          }
          if (rest) {
            slot.lines.push(rest);
          }
          state = { kind: 'char', idx };
          continue;
        }
      }

      const globalUcMatch = clean.match(GLOBAL_UC_HEADER_RE);
      if (globalUcMatch) {
        state = { kind: 'uc' };
        if (globalUcMatch[1]?.trim()) {
          ucLines.push(globalUcMatch[1].trim());
        }
        continue;
      }

      if (NOTES_HEADER_RE.test(clean)) {
        state = { kind: 'notes' };
        continue;
      }
    }

    switch (state.kind) {
      case 'base':
        baseLines.push(line);
        break;
      case 'char':
        ensureSlot(state.idx).lines.push(line);
        break;
      case 'char_uc':
        ensureSlot(state.idx).ucLines.push(line);
        break;
      case 'uc':
        ucLines.push(line);
        break;
      case 'notes':
        break;
    }
  }

  const sortedIndices = [...charSlots.keys()].sort((a, b) => a - b).slice(0, MAX_NAI_CHARACTERS);
  const charCaptions: NaiCharCaption[] = [];
  let hasExplicitCoords = false;
  for (const idx of sortedIndices) {
    const slot = charSlots.get(idx)!;
    const parsed = parseSingleCharacterBlock(slot.lines, slot.coord, slot.ucLines);
    if (parsed) {
      charCaptions.push(parsed.caption);
      if (parsed.hasExplicitCoord) {
        hasExplicitCoords = true;
      }
    }
  }

  return {
    basePrompt: baseLines.join('\n').trim(),
    charCaptions,
    negativePrompt: sanitizeTagSegment(ucLines.join('\n')),
    hasExplicitCoords,
  };
}

function mergePositiveTagCore(defaultPositivePrompt: string, rawBody: string): string {
  const userTags = splitTopLevelTags(sanitizeTagSegment(rawBody));
  if (userTags.length === 0) {
    return '';
  }

  const defaultTags = splitTopLevelTags(sanitizeTagSegment(defaultPositivePrompt));
  if (defaultTags.length === 0) {
    return dedupeTagList(userTags).join(', ');
  }

  let hasSafeRating = false;
  let userRatingKey: string | null = null;
  for (const tag of userTags) {
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

  return dedupeTagList([...filteredDefaults, ...userTags]).join(', ');
}

/**
 * Prepend server default positive tags before user tags with deduplication.
 * Skips NSFW/uncensored/rating defaults when user specifies `rating:safe` or `rating:general`,
 * avoids injecting `rating:explicit` if user already specified any `rating:*`,
 * and preserves NAI V5 inline `Character N: ...` action lines at the end of Base Prompt.
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

  if (inlineCharLines.length === 0) {
    return mergePositiveTagCore(defaultPositivePrompt, userPrompt);
  }

  const mergedMain = mergePositiveTagCore(defaultPositivePrompt, mainLines.join('\n'));
  if (!mergedMain) {
    return inlineCharLines.join('\n');
  }
  return `${mergedMain},\n\n${inlineCharLines.join('\n')}`;
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

function sanitizeExplicitCharCaptions(
  items: readonly NaiCharCaption[],
): { charCaptions: NaiCharCaption[]; hasExplicitCoords: boolean } {
  const out: NaiCharCaption[] = [];
  let hasExplicitCoords = false;

  for (const item of items.slice(0, MAX_NAI_CHARACTERS)) {
    const parsed = parseSingleCharacterBlock(
      [item.char_caption],
      item.centers?.[0] ?? null,
      item.uc ? [item.uc] : undefined,
    );
    if (!parsed) continue;
    const centers =
      item.centers && item.centers.length > 0 ? item.centers : parsed.caption.centers;
    if (centers && centers.length > 0) {
      hasExplicitCoords = true;
    }
    out.push({
      char_caption: parsed.caption.char_caption,
      ...(parsed.caption.uc ? { uc: parsed.caption.uc } : {}),
      ...(centers && centers.length > 0 ? { centers } : {}),
    });
  }

  return { charCaptions: out, hasExplicitCoords };
}

export class DefaultImagePromptProcessor implements ImagePromptProcessor {
  async process(input: ImagePromptContext): Promise<ProcessedImagePrompt> {
    const structured = parseStructuredNaiPrompt(input.rawPrompt);
    const effectiveBasePrompt = structured.basePrompt || input.rawPrompt;

    let charCaptions: NaiCharCaption[] = [];
    let hasExplicitCoords = false;

    if (input.charCaptions && input.charCaptions.length > 0) {
      const normalized = sanitizeExplicitCharCaptions(input.charCaptions);
      charCaptions = normalized.charCaptions;
      hasExplicitCoords = normalized.hasExplicitCoords;
    } else if (input.rawCharacterPrompt !== undefined && input.rawCharacterPrompt.trim()) {
      const parsedChars = parseCharacterPromptsText(input.rawCharacterPrompt);
      charCaptions = parsedChars.charCaptions;
      hasExplicitCoords = parsedChars.hasExplicitCoords;
    } else if (structured.charCaptions.length > 0) {
      charCaptions = structured.charCaptions;
      hasExplicitCoords = structured.hasExplicitCoords;
    }

    const combinedUserNeg = [structured.negativePrompt, input.userNegativePrompt]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');

    const effectiveUseCoords =
      input.useCoords !== undefined ? input.useCoords : hasExplicitCoords;

    return {
      finalPrompt: mergePositivePrompts(input.defaultPositivePrompt, effectiveBasePrompt),
      finalNegativePrompt: mergeNegativePrompts(input.defaultNegativePrompt, combinedUserNeg),
      effectiveRawPrompt: effectiveBasePrompt.trim(),
      ...(charCaptions.length > 0 ? { charCaptions } : {}),
      ...(effectiveUseCoords ? { useCoords: true } : {}),
    };
  }
}
