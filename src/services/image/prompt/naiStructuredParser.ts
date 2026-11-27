import type { NaiCharCaption, NaiCharCaptionCenter } from '../../imageClient.js';
import { MAX_NAI_CHARACTERS, parseCoordSpec, sanitizeTagSegment } from './naiTagTokenizer.js';
import {
  BASE_HEADER_RE,
  CHAR_HEADER_RE,
  CHAR_UC_HEADER_RE,
  GLOBAL_UC_HEADER_RE,
  NOTES_HEADER_RE,
  parseSingleCharacterBlock,
  stripHeaderDecorations,
} from './naiCharacterBlockParser.js';

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
