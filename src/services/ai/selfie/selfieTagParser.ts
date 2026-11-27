import type { ImageAspectRatio } from '../../../config/defaults.js';
import { sanitizeTagSegment, splitTopLevelTags } from '../../imagePromptProcessor.js';
import {
  EXPLICIT_DUO_INTENT_RE,
  EXPLICIT_TAG_FILTER_RE,
  EXPLICIT_USER_NSFW_RE,
  isRecord,
  normalizeCameraAngle,
  VALID_ASPECTS,
  type OcSelfieFraming,
  type OcSelfieStyle,
  type SelfieSkillSpec,
} from './selfieTypesAndDefaults.js';

interface TagSpan {
  start: number;
  end: number;
  payload: string;
}

function scanSelfieTagSpans(raw: string): TagSpan[] {
  const spans: TagSpan[] = [];
  const headerRe = /\[(?:SELFIE|OC_IMAGE)\s*:/gi;

  for (const match of raw.matchAll(headerRe)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const payloadStart = start + match[0].length;

    let inString = false;
    let escaped = false;
    let curlyDepth = 0;
    let squareDepth = 1; // opening '[' of [SELFIE:
    let endIdx = -1;

    for (let i = payloadStart; i < raw.length; i++) {
      const ch = raw[i]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === '{') {
        curlyDepth += 1;
      } else if (ch === '}' && curlyDepth > 0) {
        curlyDepth -= 1;
      } else if (ch === '[') {
        squareDepth += 1;
      } else if (ch === ']') {
        squareDepth -= 1;
        if (squareDepth === 0 && curlyDepth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    if (endIdx > payloadStart) {
      spans.push({
        start,
        end: endIdx,
        payload: raw.slice(payloadStart, endIdx - 1).trim(),
      });
    }
  }

  return spans;
}

function parseOptionalFraming(raw: unknown): OcSelfieFraming | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const v = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
  if (v === 'portrait' || v === 'close_up' || v === 'closeup' || v === 'avatar' || v === 'headshot') {
    return 'portrait';
  }
  if (v === 'upper' || v === 'upper_body' || v === 'cowboy' || v === 'cowboy_shot' || v === 'half_body') {
    return 'upper';
  }
  if (v === 'full' || v === 'full_body' || v === 'fullbody' || v === 'standing') {
    return 'full';
  }
  if (v === 'chibi' || v === 'chibi_icon' || v === 'sd') {
    return 'chibi';
  }
  if (v === 'sticker_pack' || v === 'stickers' || v === 'sticker' || v === '2x2' || v === 'emote_pack') {
    return 'sticker_pack';
  }
  return 'portrait';
}

function normalizeStyle(raw: unknown): OcSelfieStyle {
  if (typeof raw !== 'string') return 'anime';
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (v === 'watercolor' || v === 'watercolour') return 'watercolor';
  if (v === 'graphic' || v === 'poster' || v === 'art_nouveau' || v === 'flat') return 'graphic';
  if (v === 'impasto' || v === 'painterly' || v === 'oil') return 'impasto';
  if (v === 'nihonga' || v === 'goldleaf' || v === 'gold_leaf') return 'nihonga';
  return 'anime';
}

function normalizeAspect(raw: unknown): ImageAspectRatio | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return VALID_ASPECTS.has(trimmed) ? (trimmed as ImageAspectRatio) : undefined;
}

function cleanOptionalTextField(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, maxLen);
  return trimmed || undefined;
}

export function extractSelfieSkillTag(raw: string): SelfieSkillSpec | null {
  const spans = scanSelfieTagSpans(raw);
  if (spans.length === 0) return null;

  const first = spans[0]!;
  let jsonCandidate = first.payload
    .replace(/^`+(?:json)?\s*/i, '')
    .replace(/\s*`+$/, '')
    .trim();

  if (!jsonCandidate) return null;

  // Tolerate trailing commas before closing brace
  jsonCandidate = jsonCandidate.replace(/,\s*([}\]])/g, '$1');

  if (jsonCandidate.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(jsonCandidate);
      if (!isRecord(parsed)) return null;
      const framing = parseOptionalFraming(parsed['framing']);
      const aspect = normalizeAspect(parsed['aspect'] ?? parsed['aspect_ratio']);
      const style = normalizeStyle(parsed['style']);
      const pose = cleanOptionalTextField(parsed['pose'], 80);
      const angle = normalizeCameraAngle(parsed['angle'] ?? parsed['camera']);
      const outfitId = cleanOptionalTextField(parsed['outfitId'] ?? parsed['outfit_id'], 80);
      const scene = cleanOptionalTextField(parsed['scene'], 500);
      const action = cleanOptionalTextField(parsed['action'], 500);
      const sentence = cleanOptionalTextField(parsed['sentence'], 400);
      const animal = cleanOptionalTextField(parsed['animal'], 120);
      const outfit = cleanOptionalTextField(parsed['outfit'], 600);
      const partnerAction = cleanOptionalTextField(
        parsed['partnerAction'] ?? parsed['partner_action'],
        500,
      );
      const partnerOutfit = cleanOptionalTextField(
        parsed['partnerOutfit'] ?? parsed['partner_outfit'],
        600,
      );
      const duo = parsed['duo'] === true ? true : undefined;
      const nsfw = Boolean(parsed['nsfw']);

      return {
        ...(framing ? { framing } : {}),
        ...(aspect ? { aspect } : {}),
        style,
        ...(pose ? { pose } : {}),
        ...(angle ? { angle } : {}),
        ...(outfitId ? { outfitId } : {}),
        ...(scene ? { scene } : {}),
        ...(action ? { action } : {}),
        ...(sentence ? { sentence } : {}),
        ...(animal ? { animal } : {}),
        ...(outfit ? { outfit } : {}),
        ...(partnerAction ? { partnerAction } : {}),
        ...(partnerOutfit ? { partnerOutfit } : {}),
        ...(duo ? { duo } : {}),
        nsfw,
      };
    } catch {
      return null;
    }
  }

  // Fallback shorthand: [SELFIE: warm engawa, holding teacup]
  const fallbackScene = cleanOptionalTextField(jsonCandidate, 400);
  if (!fallbackScene) return null;
  return {
    framing: 'portrait',
    style: 'anime',
    scene: fallbackScene,
    nsfw: false,
  };
}

export function stripSelfieSkillTags(raw: string): string {
  const spans = scanSelfieTagSpans(raw);
  let out = raw;
  if (spans.length > 0) {
    let cursor = 0;
    const parts: string[] = [];
    for (const span of spans) {
      if (span.start > cursor) {
        parts.push(raw.slice(cursor, span.start));
      }
      cursor = span.end;
    }
    if (cursor < raw.length) {
      parts.push(raw.slice(cursor));
    }
    out = parts.join('');
  }
  // Also strip any malformed unclosed/simple [SELFIE: ...] remnants
  return out.replace(/\[(?:SELFIE|OC_IMAGE)\s*:[^\]]*\]/gi, '');
}

export function hasExplicitUserNsfwIntent(userContent: string): boolean {
  return EXPLICIT_USER_NSFW_RE.test(userContent);
}

export function hasExplicitDuoIntent(userContent: string): boolean {
  return EXPLICIT_DUO_INTENT_RE.test(userContent);
}

export function sanitizeFieldTags(raw: string | undefined, stripExplicit: boolean): string {
  if (!raw?.trim()) return '';
  const tags = splitTopLevelTags(sanitizeTagSegment(raw));
  const kept = tags.filter((tag) => {
    const lower = tag.trim().toLowerCase();
    if (!lower) return false;
    // Strip count tags that belong at start of Base Prompt
    if (/^\d*(?:girls?|boys?|others?)$/.test(lower) || lower === 'solo') {
      return false;
    }
    // Strip manual quality boilerplate (upstream image gateway applies quality tags automatically)
    if (
      lower === 'masterpiece' ||
      lower === 'best quality' ||
      lower === 'very aesthetic' ||
      lower === 'amazing quality' ||
      lower === 'no text'
    ) {
      return false;
    }
    // Strip unverified V3/V4 artist weight soup
    if (lower.includes('artist:')) {
      return false;
    }
    if (stripExplicit && EXPLICIT_TAG_FILTER_RE.test(lower)) {
      return false;
    }
    return true;
  });
  return kept.join(', ');
}

export function inferGenderSubject(appearance: string): 'girl' | 'boy' | 'character' {
  const first = appearance.trim().split(',')[0]?.trim().toLowerCase();
  if (first === 'boy') return 'boy';
  if (first === 'other') return 'character';
  return 'girl';
}

export function extractAnimalSpeciesWord(animalTag: string): string | null {
  const lower = animalTag.toLowerCase();
  const known = ['cat', 'dog', 'fox', 'rabbit', 'bunny', 'wolf', 'bird', 'owl', 'tiger', 'hamster'];
  for (const word of known) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      return word === 'bunny' ? 'rabbit' : word;
    }
  }
  return null;
}

export function extractGuardInnerTerms(
  guardRaw: string,
): Array<{ weight: string; terms: string }> {
  const trimmed = guardRaw.trim().replace(/,+$/, '').trim();
  if (!trimmed) return [];
  const matches = [...trimmed.matchAll(/(-?\d+(?:\.\d+)?)::([\s\S]*?)::/g)];
  if (matches.length > 0) {
    return matches
      .map((m) => ({
        weight: m[1]!,
        terms: sanitizeTagSegment(m[2]!),
      }))
      .filter((x) => Boolean(x.terms));
  }
  const plain = sanitizeTagSegment(trimmed);
  return plain ? [{ weight: '-1.2', terms: plain }] : [];
}

export function removeExtraCharactersFromUc(uc: string): string {
  return uc.replace(/\bextra characters,\s*/gi, '');
}
