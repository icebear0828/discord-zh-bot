import type { NaiCharCaption, NaiCharCaptionCenter } from '../../imageClient.js';
import {
  MAX_NAI_CHARACTERS,
  parseCoordSpec,
  sanitizeTagSegment,
  stripMarkdownCodeFences,
} from './naiTagTokenizer.js';

export function stripHeaderDecorations(line: string): string {
  return line
    .trim()
    .replace(/^#{1,4}\s+/, '')
    .replace(/^\*\*(.+?)\*\*\s*([:：].*)$/, '$1$2');
}

export const BASE_HEADER_RE = /^(?:Base\s+Prompt|Main\s+Prompt|主提示词|主串)\s*[:：]\s*(.*)$/i;
export const CHAR_UC_HEADER_RE =
  /^(?:Character|Char|角色)\s*([1-6])\s*(?:UC|Undesired\s+Content|Negative(?:\s+Prompt)?|负面(?:词)?)\s*[:：]\s*(.*)$/i;
export const CHAR_HEADER_RE =
  /^(?:Character|Char|角色)\s*([1-6])(?:\s+Prompt)?(?:\s*(?:@\s*([A-Ea-e][1-5]|[01]?(?:\.\d+)?\s*[,，]\s*[01]?(?:\.\d+)?)|[([（【]\s*([^)\]）】]+)\s*[)\]）】]))?\s*[:：]\s*(.*)$/i;
export const GLOBAL_UC_HEADER_RE =
  /^(?:Undesired\s+Content|Negative\s+Prompt|UC|负面提示词|负面词)\s*[:：]\s*(.*)$/i;
export const NOTES_HEADER_RE = /^(?:补充|附注|说明|Note|Notes)\s*[:：]\s*(.*)$/i;
export const INLINE_BASE_CHAR_LINE_RE = /^\s*Character\s+([1-6])\s*:\s*(.+)$/i;

export interface ParsedSingleCharBlock {
  caption: NaiCharCaption;
  hasExplicitCoord: boolean;
}

export function parseSingleCharacterBlock(
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

export function sanitizeExplicitCharCaptions(
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
