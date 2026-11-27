import type { NaiCharCaption, NaiCharCaptionCenter } from '../../imageClient.js';

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

export function stripMarkdownCodeFences(raw: string): string {
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

export function normalizeTagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function dedupeTagList(tags: readonly string[]): string[] {
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
