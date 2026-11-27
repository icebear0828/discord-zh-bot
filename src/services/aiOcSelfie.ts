import fs from 'node:fs';
import type { ImageAspectRatio } from '../config/defaults.js';
import type { NaiCharCaption } from './imageClient.js';
import { sanitizeTagSegment, splitTopLevelTags } from './imagePromptProcessor.js';

export type AiOcPresetKey = string;
export type OcSelfieFraming = 'portrait' | 'upper' | 'full' | 'chibi' | 'sticker_pack';
export type OcSelfieStyle = 'anime' | 'watercolor' | 'graphic' | 'impasto' | 'nihonga';

export interface AiCustomOcConfig {
  name: string;
  appearance: string;
  costumePortrait: string;
  costumeUpper: string;
  costumeFull: string;
  silhouetteGuard: string;
}

export interface AiSelfieConfig {
  enabled: boolean;
  ocPreset: AiOcPresetKey;
  cooldownSec: number;
  allowNsfw: boolean;
  customOc: AiCustomOcConfig;
}

export interface AiOcProfile {
  id: string;
  name: string;
  description: string;
  visualSummaryZh: string;
  appearance: string;
  costumePortrait: string;
  costumeUpper: string;
  costumeFull: string;
  silhouetteGuard: string;
  defaultThemeHint: string;
}

export interface SelfieSkillSpec {
  framing?: OcSelfieFraming;
  aspect?: ImageAspectRatio;
  style?: OcSelfieStyle;
  scene?: string;
  action?: string;
  sentence?: string;
  animal?: string;
  outfit?: string;
  nsfw?: boolean;
}

export interface CompiledOcSelfiePrompt {
  prompt: string;
  negativePrompt: string;
  charCaptions: NaiCharCaption[];
  aspectRatio: ImageAspectRatio;
  steps: number;
  scale: number;
  cfgRescale: number;
  nsfw: boolean;
  spoiler: boolean;
  framing: OcSelfieFraming;
  style: OcSelfieStyle;
}

// NovelAI V5 Undesired Content (UC) presets per framing and rendering style
export const V5_SOLO_UC =
  '2::extra characters, extra fingers, extra toes, logo, watermark, signature, deformed, ::, lowres, blurry, out of focus, overexposed, washed out, harsh spotlight, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, too many watermarks, negative space, blank page, @_@, mismatched pupils, bad anatomy';

export const V5_WATERCOLOR_UC =
  '2::extra characters, extra fingers, extra toes, logo, watermark, signature, deformed, ::, lowres, blurry, out of focus, harsh spotlight, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, too many watermarks, @_@, mismatched pupils, bad anatomy';

export const V5_GRAPHIC_UC =
  '2::extra characters, extra fingers, extra toes, watermark, signature, deformed, ::, lowres, blurry, out of focus, overexposed, washed out, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, too many watermarks, blank page, @_@, mismatched pupils, bad anatomy';

export const V5_STICKER_UC =
  '2::extra fingers, extra toes, logo, watermark, signature, deformed, ::, lowres, blurry, out of focus, overexposed, washed out, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, too many watermarks, blank page, @_@, mismatched pupils, bad anatomy';

const ANTI_CENSOR_UC_TAGS =
  'censored, mosaic censoring, bar censor, light censor, pointillism censor';

const R18_POSITIVE_PREFIX = 'nsfw, rating:explicit, uncensored';

const VALID_OC_PRESET_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/i;

export const DEFAULT_CUSTOM_OC_CONFIG: AiCustomOcConfig = {
  name: '默认自设',
  appearance:
    'girl, long dark hair, bright eyes, parted bangs, wispy sidelocks, fair skin, slender figure,',
  costumePortrait: 'white collared blouse, dark ribbon tie, tailored cardigan over shoulders,',
  costumeUpper:
    'white collared blouse, dark ribbon tie, tailored cardigan, pleated mini skirt, thighhighs,',
  costumeFull:
    'white collared blouse, dark ribbon tie, tailored cardigan, pleated mini skirt, thighhighs, dark leather loafers,',
  silhouetteGuard: '',
};

export const DEFAULT_AI_SELFIE_CONFIG: AiSelfieConfig = {
  enabled: true,
  ocPreset: 'auto',
  cooldownSec: 20,
  allowNsfw: true,
  customOc: { ...DEFAULT_CUSTOM_OC_CONFIG },
};

const VALID_ASPECTS: ReadonlySet<string> = new Set<ImageAspectRatio>([
  '2:3',
  '3:2',
  '1:1',
  '9:16',
  '16:9',
]);

const EXPLICIT_USER_NSFW_RE =
  /(?:\br18g?\b|\bnsfw\b|\bhentai\b|\bnude\b|\bnaked\b|\btopless\b|\bbottomless\b|\bsex\b|\berotic\b|\blewd\b|涩图|色图|瑟瑟|涩涩|黄图|裸体|全裸|半裸|脱光|脱衣|露奶|露点|露胸|露逼|露穴|露乳|白虎穴|私处|做爱|自慰|内射|口交|乳交|足交|情趣内衣|透视装|真空上阵|掀裙|走光|擦边)/i;

const EXPLICIT_TAG_FILTER_RE =
  /\b(?:nsfw|uncensored|rating\s*:\s*explicit|rating\s*:\s*questionable|completely\s+nude|nude|naked|topless|bottomless|nipples?|areolae?|pussy|vaginal?|penis|cum|sex|masturbat\w*|spread\s+legs|exposed\s+breasts?|bare\s+breasts?|cameltoe|anus|asshole)\b/i;

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function ensureTrailingComma(text: string): string {
  const trimmed = text.trim().replace(/,+$/, '').trim();
  return trimmed ? `${trimmed},` : '';
}

/**
 * Normalize OC Character 1 Line 1 (`OC_APPEARANCE`):
 * Strictly start with `girl,` / `boy,` / `other,` and strip `1girl`/`1boy`/`solo` count tags
 * per NovelAI V5 multi-character / Character 1 SOP.
 */
export function normalizeOcAppearance(raw: string): string {
  const tags = splitTopLevelTags(sanitizeTagSegment(raw));
  let genderNoun: 'girl' | 'boy' | 'other' = 'girl';
  const filtered: string[] = [];

  for (const tag of tags) {
    const lower = tag.trim().toLowerCase();
    if (!lower || lower === 'solo') continue;
    if (/^\d*girls?$/.test(lower) || lower === 'female' || lower === 'woman') {
      genderNoun = 'girl';
      continue;
    }
    if (/^\d*boys?$/.test(lower) || lower === 'male' || lower === 'man') {
      genderNoun = 'boy';
      continue;
    }
    if (lower === 'other' || lower === '1other') {
      genderNoun = 'other';
      continue;
    }
    filtered.push(tag.trim());
  }

  return ensureTrailingComma([genderNoun, ...filtered].join(', '));
}

export function normalizeOcCostumeTier(raw: string): string {
  const cleaned = sanitizeTagSegment(raw);
  return ensureTrailingComma(cleaned);
}

export function sanitizeStoredAiSelfieConfig(raw: unknown): AiSelfieConfig {
  if (!isRecord(raw)) {
    return {
      ...DEFAULT_AI_SELFIE_CONFIG,
      customOc: { ...DEFAULT_CUSTOM_OC_CONFIG },
    };
  }

  const enabled =
    typeof raw['enabled'] === 'boolean' ? raw['enabled'] : DEFAULT_AI_SELFIE_CONFIG.enabled;
  const rawPreset = typeof raw['ocPreset'] === 'string' ? raw['ocPreset'].trim() : '';
  const ocPreset: AiOcPresetKey =
    rawPreset === 'auto' || rawPreset === 'custom' || VALID_OC_PRESET_ID_RE.test(rawPreset)
      ? rawPreset
      : DEFAULT_AI_SELFIE_CONFIG.ocPreset;
  const cooldownSec =
    typeof raw['cooldownSec'] === 'number' && Number.isFinite(raw['cooldownSec'])
      ? Math.max(0, Math.min(600, Math.round(raw['cooldownSec'])))
      : DEFAULT_AI_SELFIE_CONFIG.cooldownSec;
  const allowNsfw =
    typeof raw['allowNsfw'] === 'boolean' ? raw['allowNsfw'] : DEFAULT_AI_SELFIE_CONFIG.allowNsfw;

  const rawCustom = isRecord(raw['customOc']) ? raw['customOc'] : {};
  const name =
    typeof rawCustom['name'] === 'string' && rawCustom['name'].trim()
      ? rawCustom['name'].trim().slice(0, 40)
      : DEFAULT_CUSTOM_OC_CONFIG.name;
  const appearance =
    typeof rawCustom['appearance'] === 'string' && rawCustom['appearance'].trim()
      ? rawCustom['appearance'].trim().slice(0, 1500)
      : DEFAULT_CUSTOM_OC_CONFIG.appearance;
  const costumePortrait =
    typeof rawCustom['costumePortrait'] === 'string'
      ? rawCustom['costumePortrait'].trim().slice(0, 1500)
      : DEFAULT_CUSTOM_OC_CONFIG.costumePortrait;
  const costumeUpper =
    typeof rawCustom['costumeUpper'] === 'string'
      ? rawCustom['costumeUpper'].trim().slice(0, 1800)
      : DEFAULT_CUSTOM_OC_CONFIG.costumeUpper;
  const costumeFull =
    typeof rawCustom['costumeFull'] === 'string'
      ? rawCustom['costumeFull'].trim().slice(0, 2000)
      : DEFAULT_CUSTOM_OC_CONFIG.costumeFull;
  const silhouetteGuard =
    typeof rawCustom['silhouetteGuard'] === 'string'
      ? rawCustom['silhouetteGuard'].trim().slice(0, 400)
      : DEFAULT_CUSTOM_OC_CONFIG.silhouetteGuard;

  return {
    enabled,
    ocPreset,
    cooldownSec,
    allowNsfw,
    customOc: {
      name,
      appearance,
      costumePortrait,
      costumeUpper,
      costumeFull,
      silhouetteGuard,
    },
  };
}

function sanitizeExternalOcProfile(raw: unknown): AiOcProfile | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  if (!id || id === 'auto' || id === 'custom' || !VALID_OC_PRESET_ID_RE.test(id)) {
    return null;
  }
  const rawAppearance = typeof raw['appearance'] === 'string' ? raw['appearance'].trim() : '';
  if (!rawAppearance) return null;

  const appearance = normalizeOcAppearance(rawAppearance.slice(0, 1500));
  const rawPortrait = typeof raw['costumePortrait'] === 'string' ? raw['costumePortrait'] : '';
  const rawUpper = typeof raw['costumeUpper'] === 'string' ? raw['costumeUpper'] : '';
  const rawFull = typeof raw['costumeFull'] === 'string' ? raw['costumeFull'] : '';

  const costumePortrait =
    normalizeOcCostumeTier(rawPortrait.slice(0, 1500)) ||
    normalizeOcCostumeTier(rawUpper.slice(0, 1800)) ||
    normalizeOcCostumeTier(rawFull.slice(0, 2000)) ||
    DEFAULT_CUSTOM_OC_CONFIG.costumePortrait;
  const costumeUpper = normalizeOcCostumeTier(rawUpper.slice(0, 1800)) || costumePortrait;
  const costumeFull = normalizeOcCostumeTier(rawFull.slice(0, 2000)) || costumeUpper;
  const rawGuard = typeof raw['silhouetteGuard'] === 'string' ? raw['silhouetteGuard'].trim() : '';
  const silhouetteGuard = rawGuard ? ensureTrailingComma(rawGuard.slice(0, 400)) : '';

  const name =
    typeof raw['name'] === 'string' && raw['name'].trim()
      ? raw['name'].trim().slice(0, 80)
      : id;
  const description =
    typeof raw['description'] === 'string' && raw['description'].trim()
      ? raw['description'].trim().slice(0, 200)
      : '本地私有自设档案';
  const visualSummaryZh =
    typeof raw['visualSummaryZh'] === 'string' && raw['visualSummaryZh'].trim()
      ? raw['visualSummaryZh'].trim().slice(0, 400)
      : `专属自设「${name}」（外貌与服饰锚点已锁定）`;
  const defaultThemeHint =
    typeof raw['defaultThemeHint'] === 'string' && raw['defaultThemeHint'].trim()
      ? raw['defaultThemeHint'].trim().slice(0, 400)
      : 'warm natural ambient lighting, soft golden rim lighting, detailed background';

  return {
    id,
    name,
    description,
    visualSummaryZh,
    appearance,
    costumePortrait,
    costumeUpper,
    costumeFull,
    silhouetteGuard,
    defaultThemeHint,
  };
}

/**
 * Loads private OC preset profiles from a gitignored JSON file (e.g. `data/ai-packs/oc-presets.json`)
 * with mtime-based hot reload so personal OC prompts never need to be committed to public repositories.
 */
export class AiOcPresetStore {
  private cache: { mtimeMs: number; profiles: AiOcProfile[] } | null = null;

  constructor(private readonly filePath: string) {}

  getFilePath(): string {
    return this.filePath;
  }

  listProfiles(): AiOcProfile[] {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.filePath);
    } catch {
      this.cache = null;
      return [];
    }

    if (this.cache && this.cache.mtimeMs === stat.mtimeMs) {
      return [...this.cache.profiles];
    }

    try {
      const rawText = fs.readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(rawText);
      const listRaw: unknown[] = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed['profiles'])
          ? (parsed['profiles'] as unknown[])
          : [];

      const seenIds = new Set<string>();
      const profiles: AiOcProfile[] = [];
      for (const item of listRaw) {
        const sanitized = sanitizeExternalOcProfile(item);
        if (!sanitized || seenIds.has(sanitized.id)) continue;
        seenIds.add(sanitized.id);
        profiles.push(sanitized);
      }

      this.cache = { mtimeMs: stat.mtimeMs, profiles };
      return [...profiles];
    } catch {
      this.cache = null;
      return [];
    }
  }

  getProfile(id: string): AiOcProfile | undefined {
    const trimmed = id.trim();
    if (!trimmed) return undefined;
    return this.listProfiles().find((p) => p.id === trimmed);
  }
}

export function resolveActiveOcProfile(
  selfieCfg?: AiSelfieConfig,
  externalProfiles: readonly AiOcProfile[] = [],
): AiOcProfile {
  const cfg = selfieCfg ?? DEFAULT_AI_SELFIE_CONFIG;

  if (cfg.ocPreset !== 'custom') {
    if (cfg.ocPreset && cfg.ocPreset !== 'auto') {
      const matched = externalProfiles.find((p) => p.id === cfg.ocPreset);
      if (matched) return matched;
    }
    if (externalProfiles.length > 0) {
      return externalProfiles[0]!;
    }
  }

  const normAppearance = normalizeOcAppearance(
    cfg.customOc.appearance || DEFAULT_CUSTOM_OC_CONFIG.appearance,
  );
  const portrait =
    normalizeOcCostumeTier(cfg.customOc.costumePortrait) ||
    normalizeOcCostumeTier(cfg.customOc.costumeUpper) ||
    normalizeOcCostumeTier(cfg.customOc.costumeFull) ||
    DEFAULT_CUSTOM_OC_CONFIG.costumePortrait;
  const upper = normalizeOcCostumeTier(cfg.customOc.costumeUpper) || portrait;
  const full = normalizeOcCostumeTier(cfg.customOc.costumeFull) || upper;
  const guard = cfg.customOc.silhouetteGuard.trim()
    ? ensureTrailingComma(cfg.customOc.silhouetteGuard)
    : '';

  return {
    id: 'custom',
    name: cfg.customOc.name.trim() || '自定义专属自设',
    description: '管理员自定义的专属自设外貌与三级景别服饰',
    visualSummaryZh: `自定义专属自设「${cfg.customOc.name.trim() || '自设'}」（外貌与服饰锚点已由后台锁定）`,
    appearance: normAppearance,
    costumePortrait: portrait,
    costumeUpper: upper,
    costumeFull: full,
    silhouetteGuard: guard,
    defaultThemeHint: 'warm natural ambient lighting, soft golden rim lighting, detailed background',
  };
}

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

function normalizeFraming(raw: unknown): OcSelfieFraming {
  if (typeof raw !== 'string') return 'portrait';
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
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
      const framing = normalizeFraming(parsed['framing']);
      const aspect = normalizeAspect(parsed['aspect'] ?? parsed['aspect_ratio']);
      const style = normalizeStyle(parsed['style']);
      const scene = cleanOptionalTextField(parsed['scene'], 500);
      const action = cleanOptionalTextField(parsed['action'], 500);
      const sentence = cleanOptionalTextField(parsed['sentence'], 400);
      const animal = cleanOptionalTextField(parsed['animal'], 120);
      const outfit = cleanOptionalTextField(parsed['outfit'], 600);
      const nsfw = Boolean(parsed['nsfw']);

      return {
        framing,
        ...(aspect ? { aspect } : {}),
        style,
        ...(scene ? { scene } : {}),
        ...(action ? { action } : {}),
        ...(sentence ? { sentence } : {}),
        ...(animal ? { animal } : {}),
        ...(outfit ? { outfit } : {}),
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

function sanitizeFieldTags(raw: string | undefined, stripExplicit: boolean): string {
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

function inferGenderSubject(appearance: string): 'girl' | 'boy' | 'character' {
  const first = appearance.trim().split(',')[0]?.trim().toLowerCase();
  if (first === 'boy') return 'boy';
  if (first === 'other') return 'character';
  return 'girl';
}

function extractAnimalSpeciesWord(animalTag: string): string | null {
  const lower = animalTag.toLowerCase();
  const known = ['cat', 'dog', 'fox', 'rabbit', 'bunny', 'wolf', 'bird', 'owl', 'tiger', 'hamster'];
  for (const word of known) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      return word === 'bunny' ? 'rabbit' : word;
    }
  }
  return null;
}

function extractGuardInnerTerms(guardRaw: string): Array<{ weight: string; terms: string }> {
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

/**
 * Deterministically compile a `SelfieSkillSpec` + `AiOcProfile` into a verified
 * NovelAI V5 OC Pipeline payload (4-part Base Prompt + Two-Line Character 1 + Scene UC).
 */
export function compileOcSelfiePrompt(params: {
  oc: AiOcProfile;
  spec: SelfieSkillSpec;
  userContent: string;
  allowNsfw: boolean;
  forceSpoiler?: boolean;
}): CompiledOcSelfiePrompt {
  const { oc, spec, userContent, allowNsfw, forceSpoiler = false } = params;
  const framing: OcSelfieFraming = spec.framing ?? 'portrait';
  const style: OcSelfieStyle =
    framing === 'chibi' || framing === 'sticker_pack' ? 'anime' : (spec.style ?? 'anime');

  // Dual-gate NSFW check: requires config allowNsfw + LLM nsfw:true + explicit user NSFW intent
  const effectiveNsfw = Boolean(
    allowNsfw &&
      spec.nsfw === true &&
      framing !== 'chibi' &&
      framing !== 'sticker_pack' &&
      hasExplicitUserNsfwIntent(userContent),
  );
  const stripExplicit = !effectiveNsfw;

  const subjectGender = inferGenderSubject(oc.appearance);
  const countTag = subjectGender === 'boy' ? '1boy' : subjectGender === 'character' ? '1other' : '1girl';

  // Resolve default aspect ratio matched to framing when omitted
  const defaultAspectByFraming: Record<OcSelfieFraming, ImageAspectRatio> = {
    portrait: '1:1',
    upper: style === 'watercolor' || style === 'graphic' || style === 'impasto' || style === 'nihonga' ? '2:3' : '3:2',
    full: '2:3',
    chibi: '1:1',
    sticker_pack: '1:1',
  };
  const aspectRatio: ImageAspectRatio =
    framing === 'sticker_pack'
      ? '1:1'
      : (spec.aspect ?? defaultAspectByFraming[framing]);

  // Select framing-matched Costume Tier (or custom outfit override when non-empty after sanitization)
  const sanitizedCustomOutfit = sanitizeFieldTags(spec.outfit, stripExplicit);
  const usingCustomOutfit = Boolean(sanitizedCustomOutfit);
  const selectedCostumeLine = usingCustomOutfit
    ? ensureTrailingComma(sanitizedCustomOutfit)
    : framing === 'portrait'
      ? oc.costumePortrait
      : framing === 'full' || framing === 'chibi'
        ? oc.costumeFull
        : oc.costumeUpper;

  const charCaptionText = `${oc.appearance}\n${selectedCostumeLine}`.trim();

  // Animal presence rule (omit `solo` and add anti-chimera ear/tail negative guard)
  const sanitizedAnimal =
    framing === 'sticker_pack' ? '' : sanitizeFieldTags(spec.animal, true);
  const hasAnimal = Boolean(sanitizedAnimal);

  const sanitizedScene = sanitizeFieldTags(spec.scene, stripExplicit) || oc.defaultThemeHint;
  const sanitizedAction =
    sanitizeFieldTags(spec.action, stripExplicit) ||
    'gentle smile, blush, looking at viewer';

  // Part 1: Count + Animal/Solo + Scene/Setting
  const headTags: string[] = [];
  if (effectiveNsfw) {
    headTags.push(R18_POSITIVE_PREFIX);
  }
  if (framing === 'sticker_pack') {
    headTags.push(
      `${countTag}, chibi, chibi only, multiple views, sticker, white outline, warm ivory background`,
    );
  } else if (framing === 'chibi') {
    headTags.push(
      hasAnimal
        ? `${countTag}, ${sanitizedAnimal}, chibi`
        : `${countTag}, solo, chibi`,
    );
    headTags.push(sanitizedScene);
  } else {
    headTags.push(hasAnimal ? `${countTag}, ${sanitizedAnimal}` : `${countTag}, solo`);
    headTags.push(sanitizedScene);
  }
  const line1 = `${headTags.filter(Boolean).join(', ')},`;

  // Part 2: Pose/Action + Framing + Style/Medium + Focus
  const framingTagsMap: Record<OcSelfieFraming, string> = {
    portrait: 'portrait, close-up, upper body, three-quarter view',
    upper: 'cowboy shot, upper body, three-quarter view',
    full: 'full body, straight on',
    chibi: 'full body chibi, straight on, clean crisp lineart, vibrant warm lighting, sharp focus, sticker style',
    sticker_pack:
      'four separate die-cut chibi stickers arranged neatly in a 2x2 layout, clean crisp lineart, vibrant anime coloring, sharp focus',
  };

  const styleTagsMap: Record<OcSelfieStyle, string> = {
    anime:
      'warm ambient lighting, soft golden rim lighting, clean fine anime lineart, luminous soft cel-painterly shading, sharp focus',
    watercolor:
      'soft diffused daylight, watercolor (medium), traditional media, delicate ink outlines, soft watercolor wash, visible cold-press paper texture, bleeding pigment edges',
    graphic:
      'flat color, bold graphic illustration, clean crisp lineart, cel shading, art nouveau ornamental frame, sharp focus',
    impasto:
      'anime style, painterly, rich visible brushstrokes, thick impasto highlights, dramatic warm golden rim lighting, warm chiaroscuro, no lineart, sharp focus',
    nihonga:
      'nihonga, traditional Japanese mineral pigment painting, sumi ink fine linework, matte granular washi paper texture, metallic gold leaf accents, gold leaf folding byobu screen, flat atmospheric perspective',
  };

  const line2 =
    framing === 'sticker_pack'
      ? `${framingTagsMap.sticker_pack},`
      : framing === 'chibi'
        ? `${sanitizedAction}, ${framingTagsMap.chibi},`
        : `${sanitizedAction}, ${framingTagsMap[framing]}, ${styleTagsMap[style]},`;

  // Part 3: Natural-language binding sentence(s)
  let rawSentence = (spec.sentence ?? '').trim();
  if (stripExplicit && EXPLICIT_TAG_FILTER_RE.test(rawSentence)) {
    rawSentence = '';
  }
  let sentenceBlock = '';
  if (framing === 'sticker_pack' && !rawSentence) {
    sentenceBlock = [
      `Top-left chibi sticker: waving one hand cheerfully with a bright smile (${sanitizedAction}),`,
      'Top-right chibi sticker: puffed cheeks pouting grumpy face with arms crossed,',
      'Bottom-left chibi sticker: sipping happily from a warm teacup with closed-eyes smile,',
      'Bottom-right chibi sticker: surprised blushing face covering mouth with both tiny hands,',
    ].join('\n');
  } else if (rawSentence) {
    sentenceBlock = ensureTrailingComma(rawSentence);
  } else {
    const nounPhrase = subjectGender === 'boy' ? 'The boy' : 'The girl';
    sentenceBlock = `${nounPhrase} poses naturally (${sanitizedAction}) in ${sanitizedScene},`;
  }

  // Part 4: Trailing negative weight guards (silhouette + framing + style + animal)
  const negBlocks: string[] = [];
  if (style === 'impasto') {
    negBlocks.push(
      '-2.0::realistic, photorealistic, western oil portrait, nosebleed, realistic nose, 3d, doll::',
    );
  }

  const neg15Terms: string[] = [];
  const neg12Terms: string[] = [];

  if (!usingCustomOutfit && oc.silhouetteGuard) {
    for (const block of extractGuardInnerTerms(oc.silhouetteGuard)) {
      if (block.weight === '-1.5') {
        neg15Terms.push(block.terms);
      } else if (block.weight === '-1.2') {
        neg12Terms.push(block.terms);
      } else {
        negBlocks.push(`${block.weight}::${block.terms}::`);
      }
    }
  }

  if (framing === 'sticker_pack') {
    neg15Terms.push('comic panels, speech bubble');
  }
  if (framing === 'full') {
    neg12Terms.push('cropped feet');
  }
  if (hasAnimal) {
    const species = extractAnimalSpeciesWord(sanitizedAnimal);
    if (species) {
      neg15Terms.push(`${species} ears on ${subjectGender}`);
    }
    neg15Terms.push(`animal ears on ${subjectGender}`, `tail on ${subjectGender}`);
  }

  if (style === 'watercolor') {
    neg12Terms.push('glossy digital shading, 3d render');
  } else if (style === 'graphic') {
    neg12Terms.push('soft airbrush gradient');
  } else if (style === 'impasto') {
    neg12Terms.push('flat cel shading');
  } else if (style === 'nihonga') {
    neg12Terms.push('glossy 3d shading, modern background');
  }

  if (neg15Terms.length > 0) {
    negBlocks.push(`-1.5::${neg15Terms.join(', ')}::`);
  }
  if (neg12Terms.length > 0) {
    negBlocks.push(`-1.2::${neg12Terms.join(', ')}::`);
  }

  const trailingGuardLine = negBlocks.length > 0 ? `${negBlocks.join(', ')},` : '';

  const promptLines = [line1, line2, '', sentenceBlock];
  if (trailingGuardLine) {
    promptLines.push(trailingGuardLine);
  }
  const finalPrompt = promptLines.join('\n');

  // Select Undesired Content (UC) preset
  const baseUc =
    framing === 'sticker_pack'
      ? V5_STICKER_UC
      : framing === 'chibi' || style === 'graphic' || style === 'nihonga'
        ? V5_GRAPHIC_UC
        : style === 'watercolor'
          ? V5_WATERCOLOR_UC
          : V5_SOLO_UC;

  const finalNegativePrompt = effectiveNsfw ? `${baseUc}, ${ANTI_CENSOR_UC_TAGS}` : baseUc;

  return {
    prompt: finalPrompt,
    negativePrompt: finalNegativePrompt,
    charCaptions: [{ char_caption: charCaptionText }],
    aspectRatio,
    steps: 28,
    scale: 5.0,
    cfgRescale: 0,
    nsfw: effectiveNsfw,
    spoiler: Boolean(forceSpoiler || effectiveNsfw),
    framing,
    style,
  };
}

export function buildOcSelfieSkillPrompt(params: {
  oc: AiOcProfile;
  allowNsfw: boolean;
}): string {
  const { oc, allowNsfw } = params;
  const nsfwLine = allowNsfw
    ? '- 分级规则：日常拍照/看图一律保持 `"nsfw": false`；仅当群友明确要求涩图/R18内容且符合你当前态度愿意发时，才可设 `"nsfw": true`（系统会自动加模糊遮罩）。'
    : '- 分级规则：仅支持健康日常向画面，固定 `"nsfw": false`，严禁输出裸露色情标签。';

  return [
    '## 自设拍照与生图技能（仅在群友要图时调用）',
    `- 你的固定外貌与招牌穿搭设定：${oc.visualSummaryZh}。`,
    '- 触发条件：仅当群友明确让你发自拍、拍张照、看看你在干嘛、看你的穿搭、发Q版表情包，或让你画一张你自己的图时调用；普通文字闲聊、问答、互怼时**严禁**调用。',
    '- 调用方式：先用符合你人设口吻的中文自然回复 1~3 句（严禁把英文提示词念出来），然后在回复**最末尾另起一行**附上单行标签（系统会自动拦截调用生图 API 并把照片附在消息里发出）：',
    '  `[SELFIE: {"framing":"portrait","aspect":"1:1","style":"anime","scene":"英文环境背景与光影tag","action":"英文动作姿态与表情tag","sentence":"1句简洁英文描述画面(The girl ...)","nsfw":false}]`',
    '- 参数规范：`framing` 选 `portrait`(特写自拍,1:1) / `upper`(半身日常,3:2或2:3) / `full`(全身穿搭,2:3) / `chibi`(单张Q版,1:1) / `sticker_pack`(2x2四格表情包,1:1)；`style` 默认 `anime`，若群友指定水彩/平面海报/厚涂/岩彩可填 `watercolor`/`graphic`/`impasto`/`nihonga`；若有动物同框加 `"animal":"英文动物词"`；默认穿你的招牌自设服（无需填 `outfit`），仅当群友明确指定换装时才填 `"outfit":"英文服装tag"`。',
    nsfwLine,
  ].join('\n');
}
