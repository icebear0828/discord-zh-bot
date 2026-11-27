import fs from 'node:fs';
import type { ImageAspectRatio } from '../config/defaults.js';
import type { NaiCharCaption } from './imageClient.js';
import { sanitizeTagSegment, splitTopLevelTags } from './imagePromptProcessor.js';
import {
  BUILTIN_OC_POSES,
  OC_CAMERA_ANGLE_TAGS,
  type OcCameraAngle,
  type OcPoseCluster,
  type OcPosePreset,
  type OcPoseTier,
} from './ocPoseCatalog.js';

export {
  OC_CAMERA_ANGLE_TAGS,
  type OcCameraAngle,
  type OcPoseCluster,
  type OcPosePreset,
  type OcPoseTier,
};

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

export interface OcOutfitPreset {
  id: string;
  name: string;
  summaryZh: string;
  ootdEligible: boolean;
  hairAccessory?: string;
  bodyAnchors?: string;
  costumeNsfw?: string;
  costumePortrait: string;
  costumeUpper: string;
  costumeFull: string;
  silhouetteGuard: string;
  themeHint?: string;
  keywordsZh?: readonly string[];
}

export interface AiSelfieConfig {
  enabled: boolean;
  ocPreset: AiOcPresetKey;
  outfitMode?: string;
  ootdOffset?: number;
  cooldownSec: number;
  allowNsfw: boolean;
  customOc: AiCustomOcConfig;
}

export interface AiOcProfile {
  id: string;
  name: string;
  description: string;
  visualSummaryZh: string;
  baseAppearanceZh?: string;
  baseAppearance?: string;
  defaultHairAccessory?: string;
  bodyAnchors?: string;
  costumeNsfw?: string;
  appearance: string;
  costumePortrait: string;
  costumeUpper: string;
  costumeFull: string;
  silhouetteGuard: string;
  defaultThemeHint: string;
  outfits?: readonly OcOutfitPreset[];
}

export interface SelfieSkillSpec {
  framing?: OcSelfieFraming;
  aspect?: ImageAspectRatio;
  style?: OcSelfieStyle;
  pose?: string;
  angle?: OcCameraAngle;
  outfitId?: string;
  scene?: string;
  action?: string;
  sentence?: string;
  animal?: string;
  outfit?: string;
  partnerAction?: string;
  partnerOutfit?: string;
  duo?: boolean;
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
  poseId?: string;
  outfitId?: string;
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

const ANTI_CENSOR_NEG15_TERMS = 'censored, mosaic censoring, bar censor';

const NSFW_UNDRESS_NEG15_TERMS =
  'bra, bikini, lingerie covering breasts, camisole, shirt, halter top, qipao, dress, skirt, panties';

const R18_POSITIVE_PREFIX = 'nsfw';

const DEFAULT_NSFW_BODY_ANCHORS = 'smooth dewy skin, slender waist, curvy,';

const DEFAULT_COSTUME_NSFW =
  'completely nude, topless, bare breasts, nipples, no bra, no panties,';

const EXPLICIT_NUDITY_OUTFIT_TAG_RE =
  /\b(?:nude|naked|topless|bare\s+breasts?|nipples?)\b/i;

const USER_UNDRESS_INTENT_RE =
  /(?:脱|全裸|裸|果体|不穿|一丝不挂|光着|露胸|露点|露奶|色图|涩图|瑟瑟|r18|nsfw|nude|naked|topless)/i;

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

const DEFAULT_CUSTOM_OC_WARDROBE: readonly OcOutfitPreset[] = [
  {
    id: 'custom_default',
    name: '🎀 经典开衫学院服',
    summaryZh: '白衬衫配深色丝带领结、修身针织开衫与百褶短裙乐福鞋',
    ootdEligible: true,
    costumePortrait: DEFAULT_CUSTOM_OC_CONFIG.costumePortrait,
    costumeUpper: DEFAULT_CUSTOM_OC_CONFIG.costumeUpper,
    costumeFull: DEFAULT_CUSTOM_OC_CONFIG.costumeFull,
    silhouetteGuard: '',
  },
  {
    id: 'custom_urban',
    name: '🏙️ 假日针织贝雷私服',
    summaryZh: '软呢贝雷帽、米白露肩针织衫与高腰短裙短靴',
    ootdEligible: true,
    hairAccessory: 'wool beret tilted slightly on head,',
    costumePortrait: 'cream off-shoulder ribbed knit sweater, delicate silver pendant necklace,',
    costumeUpper:
      'cream off-shoulder ribbed knit sweater, high-waisted dark pleated skirt, sheer black tights,',
    costumeFull:
      'cream off-shoulder ribbed knit sweater, high-waisted dark pleated skirt, sheer black tights, black ankle boots,',
    silhouetteGuard: '-1.2::school uniform, tie::,',
  },
  {
    id: 'custom_cozy',
    name: '🛋️ 暖绒宽松居家服',
    summaryZh: '柔顺披肩散发、丝质吊带配宽松针织长开衫与家居短裤',
    ootdEligible: true,
    costumePortrait: 'soft pastel camisole top, oversized cream knit lounge cardigan,',
    costumeUpper:
      'soft pastel camisole top, oversized cream knit lounge cardigan, matching lounge shorts,',
    costumeFull:
      'soft pastel camisole top, oversized cream knit lounge cardigan, matching lounge shorts, bare feet,',
    silhouetteGuard: '-1.2::shoes, boots, formal blazer::,',
  },
];

export const DEFAULT_AI_SELFIE_CONFIG: AiSelfieConfig = {
  enabled: true,
  ocPreset: 'auto',
  outfitMode: 'ootd',
  ootdOffset: 0,
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

const VALID_PO_CLUSTERS: ReadonlySet<string> = new Set<OcPoseCluster>([
  'cute_heart',
  'cute_peace',
  'cute_face',
  'cute_playful',
  'cute_shy',
  'stand_casual',
  'stand_lookback',
  'sit_relaxed',
  'sit_girl',
  'squat_kneel',
  'lie_casual',
  'spicy_upper',
  'spicy_curve',
  'nsfw_tease',
  'nsfw_open',
  'duo_cuddle',
  'duo_intimate',
]);

const EXPLICIT_USER_NSFW_RE =
  /(?:\br18g?\b|\bnsfw\b|\bhentai\b|\bnude\b|\bnaked\b|\btopless\b|\bbottomless\b|\bsex\b|\berotic\b|\blewd\b|涩图|色图|瑟瑟|涩涩|黄图|裸体|全裸|半裸|脱光|脱衣|脱掉|脱下|不穿|私房照|床照|福利图|色一点|涩一点|更色|更涩|过分一点|来点刺激|大尺度|尺度大|内衣照|无码|露奶|露点|露胸|露逼|露穴|露乳|白虎穴|私处|做爱|自慰|内射|口交|乳交|足交|情趣内衣|透视装|真空上阵|掀裙|走光|擦边)/i;

const EXPLICIT_DUO_INTENT_RE =
  /(?:双人|合照|情侣照|双女主?|百合|\b2girls\b|\b1boy\b|和我一起|跟我一起|抱抱我|抱着你|抱着我|环抱你|从背后抱|背后环抱|坐我腿上|坐在?膝上|坐怀|公主抱|横抱你|壁咚|耳边低语|十指紧扣|相拥|贴脸依偎|同眠|抱着睡|骑乘位?|传教士|正常位|后入位?|侧入位?|双人瑟瑟|双人涩图|和我做爱|跟我做爱)/i;

const YURI_DUO_RE = /(?:百合|双女主?|女女|\b2girls\b|\byuri\b|闺蜜贴贴|两个女孩)/i;

const SPICY_POSE_HINT_RE =
  /(?:性感|撩人|魅惑|曲线|事业线|显身材|火辣|诱惑|顶胯|翘臀|S形|兔女郎|纯欲)/i;

const EXPLICIT_TAG_FILTER_RE =
  /\b(?:nsfw|uncensored|rating\s*:\s*explicit|rating\s*:\s*questionable|completely\s+nude|nude|naked|topless|bottomless|nipples?|areolae?|pussy|vaginal?|penis|cum|sex|masturbat\w*|spread\s+legs|exposed\s+breasts?|bare\s+breasts?|cameltoe|anus|asshole)\b/i;

// Bounded LRU state for anti-repeat pose rotation per channel/guild scope
const MAX_POSE_ROTATION_SCOPES = 256;
const RECENT_POSE_HISTORY_LIMIT = 8;
const poseRotationHistory = new Map<string, string[]>();
let globalPoseSequence = 0;

export function resetPoseRotationState(): void {
  poseRotationHistory.clear();
  globalPoseSequence = 0;
}

export function listBuiltinOcPoses(): readonly OcPosePreset[] {
  return BUILTIN_OC_POSES;
}

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
  const seen = new Set<string>();

  for (const tag of tags) {
    const trimmed = tag.trim();
    const lower = trimmed.toLowerCase();
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
    if (seen.has(lower)) continue;
    seen.add(lower);
    filtered.push(trimmed);
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
  const rawOutfitMode = typeof raw['outfitMode'] === 'string' ? raw['outfitMode'].trim() : '';
  const outfitMode =
    rawOutfitMode === 'ootd' || VALID_OC_PRESET_ID_RE.test(rawOutfitMode)
      ? rawOutfitMode
      : 'ootd';
  const ootdOffset =
    typeof raw['ootdOffset'] === 'number' && Number.isFinite(raw['ootdOffset'])
      ? Math.max(0, Math.min(10_000, Math.trunc(raw['ootdOffset'])))
      : 0;
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
    outfitMode,
    ootdOffset,
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

function sanitizeExternalOutfitPreset(raw: unknown): OcOutfitPreset | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  if (!id || id === 'ootd' || !VALID_OC_PRESET_ID_RE.test(id)) return null;

  const rawPortrait = typeof raw['costumePortrait'] === 'string' ? raw['costumePortrait'] : '';
  const rawUpper = typeof raw['costumeUpper'] === 'string' ? raw['costumeUpper'] : '';
  const rawFull = typeof raw['costumeFull'] === 'string' ? raw['costumeFull'] : '';

  const costumePortrait =
    normalizeOcCostumeTier(rawPortrait.slice(0, 1500)) ||
    normalizeOcCostumeTier(rawUpper.slice(0, 1800)) ||
    normalizeOcCostumeTier(rawFull.slice(0, 2000));
  if (!costumePortrait) return null;

  const costumeUpper = normalizeOcCostumeTier(rawUpper.slice(0, 1800)) || costumePortrait;
  const costumeFull = normalizeOcCostumeTier(rawFull.slice(0, 2000)) || costumeUpper;

  const name =
    typeof raw['name'] === 'string' && raw['name'].trim()
      ? raw['name'].trim().slice(0, 80)
      : id;
  const summaryZh =
    typeof raw['summaryZh'] === 'string' && raw['summaryZh'].trim()
      ? raw['summaryZh'].trim().slice(0, 300)
      : name;
  const ootdEligible = typeof raw['ootdEligible'] === 'boolean' ? raw['ootdEligible'] : true;
  const rawHair = typeof raw['hairAccessory'] === 'string' ? raw['hairAccessory'].trim() : '';
  const hairAccessory = rawHair ? ensureTrailingComma(sanitizeTagSegment(rawHair.slice(0, 600))) : undefined;
  const rawBodyAnchors = typeof raw['bodyAnchors'] === 'string' ? raw['bodyAnchors'].trim() : '';
  const bodyAnchors = rawBodyAnchors
    ? ensureTrailingComma(sanitizeTagSegment(rawBodyAnchors.slice(0, 800)))
    : undefined;
  const rawCostumeNsfw = typeof raw['costumeNsfw'] === 'string' ? raw['costumeNsfw'].trim() : '';
  const costumeNsfw = rawCostumeNsfw
    ? normalizeOcCostumeTier(rawCostumeNsfw.slice(0, 2000)) || undefined
    : undefined;
  const rawGuard = typeof raw['silhouetteGuard'] === 'string' ? raw['silhouetteGuard'].trim() : '';
  const silhouetteGuard = rawGuard ? ensureTrailingComma(rawGuard.slice(0, 400)) : '';
  const themeHint =
    typeof raw['themeHint'] === 'string' && raw['themeHint'].trim()
      ? raw['themeHint'].trim().slice(0, 400)
      : undefined;
  const keywordsZh = Array.isArray(raw['keywordsZh'])
    ? raw['keywordsZh']
        .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
        .map((x) => x.trim().slice(0, 40))
        .slice(0, 16)
    : undefined;

  return {
    id,
    name,
    summaryZh,
    ootdEligible,
    ...(hairAccessory ? { hairAccessory } : {}),
    ...(bodyAnchors ? { bodyAnchors } : {}),
    ...(costumeNsfw ? { costumeNsfw } : {}),
    costumePortrait,
    costumeUpper,
    costumeFull,
    silhouetteGuard,
    ...(themeHint ? { themeHint } : {}),
    ...(keywordsZh && keywordsZh.length > 0 ? { keywordsZh } : {}),
  };
}

function sanitizeExternalPosePreset(raw: unknown): OcPosePreset | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  if (!id || !VALID_OC_PRESET_ID_RE.test(id)) return null;
  const actionTags = typeof raw['actionTags'] === 'string' ? raw['actionTags'].trim().slice(0, 500) : '';
  const sentence = typeof raw['sentence'] === 'string' ? raw['sentence'].trim().slice(0, 500) : '';
  if (!actionTags || !sentence) return null;

  const rawCluster = typeof raw['cluster'] === 'string' ? raw['cluster'].trim() : '';
  const cluster: OcPoseCluster = VALID_PO_CLUSTERS.has(rawCluster)
    ? (rawCluster as OcPoseCluster)
    : 'stand_casual';
  const rawTier = typeof raw['tier'] === 'string' ? raw['tier'].trim() : '';
  const tier: OcPoseTier =
    rawTier === 'sfw' ||
    rawTier === 'spicy' ||
    rawTier === 'nsfw' ||
    rawTier === 'duo_hug' ||
    rawTier === 'duo_nsfw'
      ? rawTier
      : 'sfw';
  const rawFraming = typeof raw['framing'] === 'string' ? raw['framing'].trim() : '';
  const framing: 'portrait' | 'upper' | 'full' =
    rawFraming === 'portrait' || rawFraming === 'upper' || rawFraming === 'full'
      ? rawFraming
      : 'upper';
  const defaultAngle = normalizeCameraAngle(raw['defaultAngle']) ?? 'three_quarter';
  const name =
    typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'].trim().slice(0, 80) : id;
  const keywordsZh = Array.isArray(raw['keywordsZh'])
    ? raw['keywordsZh']
        .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
        .map((x) => x.trim().slice(0, 40))
        .slice(0, 16)
    : [name];
  const partnerActionTags =
    typeof raw['partnerActionTags'] === 'string' && raw['partnerActionTags'].trim()
      ? raw['partnerActionTags'].trim().slice(0, 500)
      : undefined;
  const guard =
    typeof raw['guard'] === 'string' && raw['guard'].trim()
      ? raw['guard'].trim().slice(0, 300)
      : undefined;

  return {
    id,
    name,
    cluster,
    tier,
    framing,
    defaultAngle,
    keywordsZh,
    actionTags,
    sentence: ensureTrailingComma(sentence.replace(/\.$/, '')),
    ...(partnerActionTags ? { partnerActionTags } : {}),
    ...(guard ? { guard } : {}),
  };
}

function sanitizeExternalOcProfile(raw: unknown): AiOcProfile | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  if (!id || id === 'auto' || id === 'custom' || !VALID_OC_PRESET_ID_RE.test(id)) {
    return null;
  }
  const rawAppearance = typeof raw['appearance'] === 'string' ? raw['appearance'].trim() : '';
  const rawBaseAppearance =
    typeof raw['baseAppearance'] === 'string' ? raw['baseAppearance'].trim() : '';
  if (!rawAppearance && !rawBaseAppearance) return null;

  const baseAppearance = rawBaseAppearance
    ? normalizeOcAppearance(rawBaseAppearance.slice(0, 1500))
    : undefined;
  const rawDefaultHair =
    typeof raw['defaultHairAccessory'] === 'string' ? raw['defaultHairAccessory'].trim() : '';
  const defaultHairAccessory = rawDefaultHair
    ? ensureTrailingComma(sanitizeTagSegment(rawDefaultHair.slice(0, 600)))
    : undefined;
  const rawBodyAnchors = typeof raw['bodyAnchors'] === 'string' ? raw['bodyAnchors'].trim() : '';
  const bodyAnchors = rawBodyAnchors
    ? ensureTrailingComma(sanitizeTagSegment(rawBodyAnchors.slice(0, 800)))
    : undefined;
  const rawCostumeNsfw = typeof raw['costumeNsfw'] === 'string' ? raw['costumeNsfw'].trim() : '';
  const costumeNsfw = rawCostumeNsfw
    ? normalizeOcCostumeTier(rawCostumeNsfw.slice(0, 2000)) || undefined
    : undefined;
  const appearance = rawAppearance
    ? normalizeOcAppearance(rawAppearance.slice(0, 1500))
    : normalizeOcAppearance(
        `${baseAppearance ?? ''} ${defaultHairAccessory ?? ''}`.trim().slice(0, 1500),
      );

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
  const baseAppearanceZh =
    typeof raw['baseAppearanceZh'] === 'string' && raw['baseAppearanceZh'].trim()
      ? raw['baseAppearanceZh'].trim().slice(0, 300)
      : undefined;
  const defaultThemeHint =
    typeof raw['defaultThemeHint'] === 'string' && raw['defaultThemeHint'].trim()
      ? raw['defaultThemeHint'].trim().slice(0, 400)
      : 'warm natural ambient lighting, soft golden rim lighting, detailed background';

  const outfits: OcOutfitPreset[] = [];
  if (Array.isArray(raw['outfits'])) {
    const seenOutfitIds = new Set<string>();
    for (const item of raw['outfits']) {
      const parsedOutfit = sanitizeExternalOutfitPreset(item);
      if (!parsedOutfit || seenOutfitIds.has(parsedOutfit.id)) continue;
      seenOutfitIds.add(parsedOutfit.id);
      outfits.push(parsedOutfit);
    }
  }

  return {
    id,
    name,
    description,
    visualSummaryZh,
    ...(baseAppearanceZh ? { baseAppearanceZh } : {}),
    ...(baseAppearance ? { baseAppearance } : {}),
    ...(defaultHairAccessory ? { defaultHairAccessory } : {}),
    ...(bodyAnchors ? { bodyAnchors } : {}),
    ...(costumeNsfw ? { costumeNsfw } : {}),
    appearance,
    costumePortrait,
    costumeUpper,
    costumeFull,
    silhouetteGuard,
    defaultThemeHint,
    ...(outfits.length > 0 ? { outfits } : {}),
  };
}

/**
 * Loads private OC preset profiles (and optional custom pose extensions) from a gitignored JSON file
 * (e.g. `data/ai-packs/oc-presets.json`) with mtime-based hot reload.
 */
export class AiOcPresetStore {
  private cache: {
    mtimeMs: number;
    profiles: AiOcProfile[];
    customPoses: OcPosePreset[];
  } | null = null;

  constructor(private readonly filePath: string) {}

  getFilePath(): string {
    return this.filePath;
  }

  private reloadIfNeeded(): { profiles: AiOcProfile[]; customPoses: OcPosePreset[] } {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.filePath);
    } catch {
      this.cache = null;
      return { profiles: [], customPoses: [] };
    }

    if (this.cache && this.cache.mtimeMs === stat.mtimeMs) {
      return this.cache;
    }

    try {
      const rawText = fs.readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(rawText);
      const listRaw: unknown[] = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed['profiles'])
          ? (parsed['profiles'] as unknown[])
          : [];
      const posesRaw: unknown[] =
        isRecord(parsed) && Array.isArray(parsed['poses']) ? (parsed['poses'] as unknown[]) : [];

      const seenIds = new Set<string>();
      const profiles: AiOcProfile[] = [];
      for (const item of listRaw) {
        const sanitized = sanitizeExternalOcProfile(item);
        if (!sanitized || seenIds.has(sanitized.id)) continue;
        seenIds.add(sanitized.id);
        profiles.push(sanitized);
      }

      const seenPoseIds = new Set<string>();
      const customPoses: OcPosePreset[] = [];
      for (const item of posesRaw) {
        const pose = sanitizeExternalPosePreset(item);
        if (!pose || seenPoseIds.has(pose.id)) continue;
        seenPoseIds.add(pose.id);
        customPoses.push(pose);
      }

      this.cache = { mtimeMs: stat.mtimeMs, profiles, customPoses };
      return this.cache;
    } catch {
      this.cache = null;
      return { profiles: [], customPoses: [] };
    }
  }

  listProfiles(): AiOcProfile[] {
    return [...this.reloadIfNeeded().profiles];
  }

  listPoses(): OcPosePreset[] {
    const { customPoses } = this.reloadIfNeeded();
    if (customPoses.length === 0) {
      return [...BUILTIN_OC_POSES];
    }
    const customMap = new Map(customPoses.map((p) => [p.id, p]));
    const merged = BUILTIN_OC_POSES.map((p) => customMap.get(p.id) ?? p);
    for (const cp of customPoses) {
      if (!BUILTIN_OC_POSES.some((bp) => bp.id === cp.id)) {
        merged.push(cp);
      }
    }
    return merged;
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

  const isDefaultCustomCostume =
    portrait === DEFAULT_CUSTOM_OC_CONFIG.costumePortrait &&
    upper === DEFAULT_CUSTOM_OC_CONFIG.costumeUpper &&
    full === DEFAULT_CUSTOM_OC_CONFIG.costumeFull &&
    !guard;

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
    ...(isDefaultCustomCostume ? { outfits: DEFAULT_CUSTOM_OC_WARDROBE } : {}),
  };
}

export function listOcOutfits(oc: AiOcProfile): readonly OcOutfitPreset[] {
  if (oc.outfits && oc.outfits.length > 0) {
    return oc.outfits;
  }
  return [
    {
      id: `${oc.id}_default`,
      name: `${oc.name}·招牌穿搭`,
      summaryZh: oc.visualSummaryZh,
      ootdEligible: true,
      ...(oc.bodyAnchors ? { bodyAnchors: oc.bodyAnchors } : {}),
      ...(oc.costumeNsfw ? { costumeNsfw: oc.costumeNsfw } : {}),
      costumePortrait: oc.costumePortrait,
      costumeUpper: oc.costumeUpper,
      costumeFull: oc.costumeFull,
      silhouetteGuard: oc.silhouetteGuard,
      themeHint: oc.defaultThemeHint,
    },
  ];
}

const dayFormatterCache = new Map<string, Intl.DateTimeFormat>();

function resolveTimezoneDayNumber(nowMs: number, timezone = 'Asia/Shanghai'): number {
  const tzKey = timezone.trim() || 'Asia/Shanghai';
  let fmt = dayFormatterCache.get(tzKey);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tzKey,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }
    dayFormatterCache.set(tzKey, fmt);
  }

  const parts = fmt.formatToParts(new Date(nowMs));
  let year = 2026;
  let month = 1;
  let day = 1;
  for (const part of parts) {
    if (part.type === 'year') year = Number.parseInt(part.value, 10) || 2026;
    else if (part.type === 'month') month = Number.parseInt(part.value, 10) || 1;
    else if (part.type === 'day') day = Number.parseInt(part.value, 10) || 1;
  }
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Resolve the active daily OOTD outfit (deterministic per calendar day in `timezone`,
 * excluding `ootdEligible === false` hidden outfits unless explicitly locked via `outfitMode`).
 */
export function resolveActiveOcOutfit(params: {
  oc: AiOcProfile;
  selfieCfg?: AiSelfieConfig;
  nowMs?: number;
  timezone?: string;
}): OcOutfitPreset {
  const { oc, selfieCfg, nowMs = Date.now(), timezone = 'Asia/Shanghai' } = params;
  const outfits = listOcOutfits(oc);
  const mode = selfieCfg?.outfitMode?.trim() || 'ootd';

  if (mode !== 'ootd') {
    const locked = outfits.find((o) => o.id === mode);
    if (locked) return locked;
  }

  const eligible = outfits.filter((o) => o.ootdEligible !== false);
  const pool = eligible.length > 0 ? eligible : outfits;
  const dayNumber = resolveTimezoneDayNumber(nowMs, timezone);
  const offset = Math.max(0, Math.trunc(selfieCfg?.ootdOffset ?? 0));
  const index = (((dayNumber + offset) % pool.length) + pool.length) % pool.length;
  return pool[index]!;
}

export function composeOcAppearanceForOutfit(
  oc: AiOcProfile,
  outfit?: OcOutfitPreset,
): string {
  if (oc.baseAppearance) {
    const hairPart = outfit?.hairAccessory?.trim()
      ? outfit.hairAccessory.trim()
      : (oc.defaultHairAccessory?.trim() ?? '');
    const combined = hairPart ? `${oc.baseAppearance} ${hairPart}` : oc.baseAppearance;
    return normalizeOcAppearance(combined);
  }
  if (outfit?.hairAccessory?.trim()) {
    return normalizeOcAppearance(`${oc.appearance} ${outfit.hairAccessory.trim()}`);
  }
  return oc.appearance;
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

function normalizeCameraAngle(raw: unknown): OcCameraAngle | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (v === 'front' || v === 'straight_on') return 'front';
  if (v === 'three_quarter' || v === 'diag' || v === 'diagonal' || v === '3/4') {
    return 'three_quarter';
  }
  if (v === 'high' || v === 'from_above' || v === 'high_angle' || v === 'overhead') return 'high';
  if (v === 'low' || v === 'from_below' || v === 'low_angle') return 'low';
  if (v === 'side' || v === 'profile' || v === 'from_side') return 'side';
  return undefined;
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

function removeExtraCharactersFromUc(uc: string): string {
  return uc.replace(/\bextra characters,\s*/gi, '');
}

function recordAndPickPoseWithLru(
  candidates: readonly OcPosePreset[],
  scopeKey: string,
): OcPosePreset {
  const history = poseRotationHistory.get(scopeKey) ?? [];
  const historySet = new Set(history);
  const fresh = candidates.filter((c) => !historySet.has(c.id));
  const pool = fresh.length > 0 ? fresh : candidates;
  const chosen = pool[globalPoseSequence % pool.length]!;
  globalPoseSequence = (globalPoseSequence + 1) % 1_000_000;

  const nextHistory = [...history.filter((id) => id !== chosen.id), chosen.id].slice(
    -RECENT_POSE_HISTORY_LIMIT,
  );
  if (!poseRotationHistory.has(scopeKey) && poseRotationHistory.size >= MAX_POSE_ROTATION_SCOPES) {
    const oldestKey = poseRotationHistory.keys().next().value;
    if (oldestKey !== undefined) {
      poseRotationHistory.delete(oldestKey);
    }
  }
  poseRotationHistory.set(scopeKey, nextHistory);
  return chosen;
}

function findKeywordMatchedPoses(
  allowedPool: readonly OcPosePreset[],
  userContent: string,
): OcPosePreset[] {
  const text = userContent.trim();
  if (!text) return [];
  let bestLen = 0;
  let matches: OcPosePreset[] = [];

  for (const pose of allowedPool) {
    let poseBestLen = 0;
    for (const kw of pose.keywordsZh) {
      if (kw.length >= 2 && text.includes(kw) && kw.length > poseBestLen) {
        poseBestLen = kw.length;
      }
    }
    if (poseBestLen === 0) continue;
    if (poseBestLen > bestLen) {
      bestLen = poseBestLen;
      matches = [pose];
    } else if (poseBestLen === bestLen) {
      matches.push(pose);
    }
  }
  return matches;
}

type PoseMatchKind = 'id' | 'keyword' | 'cluster' | 'default';

interface SelectedCatalogPose {
  pose: OcPosePreset;
  matchKind: PoseMatchKind;
}

function selectCatalogPose(params: {
  poses: readonly OcPosePreset[];
  framing: 'portrait' | 'upper' | 'full';
  hasExplicitFraming: boolean;
  requestedPose?: string;
  userContent: string;
  effectiveNsfw: boolean;
  allowDuo: boolean;
  allowSpicy: boolean;
  scopeKey: string;
}): SelectedCatalogPose | undefined {
  const {
    poses,
    framing,
    hasExplicitFraming,
    requestedPose,
    userContent,
    effectiveNsfw,
    allowDuo,
    allowSpicy,
    scopeKey,
  } = params;

  const allowedTiers = new Set<OcPoseTier>();
  if (allowDuo) {
    allowedTiers.add('duo_hug');
    if (effectiveNsfw) {
      allowedTiers.add('duo_nsfw');
    }
  } else {
    allowedTiers.add('sfw');
    if (allowSpicy || effectiveNsfw) {
      allowedTiers.add('spicy');
    }
    if (effectiveNsfw) {
      allowedTiers.add('nsfw');
    }
  }

  const allowedPool = poses.filter((p) => allowedTiers.has(p.tier));
  if (allowedPool.length === 0) return undefined;

  const trimmedReq = requestedPose?.trim().toLowerCase();

  // 1. Exact pose ID match (only if within allowed safety tier!)
  if (trimmedReq) {
    const exactId = allowedPool.find((p) => p.id.toLowerCase() === trimmedReq);
    if (exactId) return { pose: exactId, matchKind: 'id' };
  }

  // 2. Direct Chinese keyword match in userContent (with LRU rotation when multiple poses share a keyword)
  const keywordHits = findKeywordMatchedPoses(allowedPool, userContent);
  if (keywordHits.length === 1) {
    return { pose: keywordHits[0]!, matchKind: 'keyword' };
  }
  if (keywordHits.length > 1) {
    return {
      pose: recordAndPickPoseWithLru(keywordHits, `${scopeKey}:kw:${framing}`),
      matchKind: 'keyword',
    };
  }

  // 3. Semantic cluster match + framing preference + LRU anti-repeat rotation
  if (trimmedReq) {
    const inCluster = allowedPool.filter((p) => p.cluster === trimmedReq);
    if (inCluster.length > 0) {
      const allowMixedFullAndUpper =
        effectiveNsfw && !allowDuo && trimmedReq === 'nsfw_open' && framing !== 'full';
      const framingMatched = allowMixedFullAndUpper
        ? inCluster
        : inCluster.filter(
            (p) =>
              p.framing === framing ||
              (framing === 'portrait' && p.framing === 'upper') ||
              (framing === 'upper' && p.framing === 'portrait'),
          );
      return {
        pose: recordAndPickPoseWithLru(
          framingMatched.length > 0 ? framingMatched : inCluster,
          `${scopeKey}:${trimmedReq}`,
        ),
        matchKind: 'cluster',
      };
    }
  }

  // 4. Default tier/framing rotation when requestedPose was blocked by safety gate or set to 'auto'
  const nsfwSoloOnly = !allowDuo && effectiveNsfw ? allowedPool.filter((p) => p.tier === 'nsfw') : [];
  const preferredTierPool =
    allowDuo && effectiveNsfw
      ? allowedPool.filter((p) => p.tier === 'duo_nsfw')
      : !allowDuo && effectiveNsfw
        ? nsfwSoloOnly.length > 0
          ? nsfwSoloOnly
          : allowedPool.filter((p) => p.tier === 'spicy')
        : allowedPool.filter((p) => p.tier === (allowDuo ? 'duo_hug' : 'sfw'));

  const baseCandidates = preferredTierPool.length > 0 ? preferredTierPool : allowedPool;
  const allowMixedDefaultPool =
    effectiveNsfw && !allowDuo && (!hasExplicitFraming || framing !== 'full');
  const framingMatched = allowMixedDefaultPool
    ? baseCandidates
    : baseCandidates.filter(
        (p) =>
          p.framing === framing ||
          (framing === 'portrait' && p.framing === 'upper') ||
          (framing === 'upper' && p.framing === 'portrait'),
      );
  return {
    pose: recordAndPickPoseWithLru(
      framingMatched.length > 0 ? framingMatched : baseCandidates,
      `${scopeKey}:default:${effectiveNsfw && !allowDuo ? 'nsfw_any' : framing}`,
    ),
    matchKind: 'default',
  };
}

function findShotOutfitPreset(params: {
  oc: AiOcProfile;
  activeOutfit?: OcOutfitPreset;
  requestedOutfitId?: string;
  userContent: string;
}): OcOutfitPreset {
  const outfits = listOcOutfits(params.oc);
  const reqId = params.requestedOutfitId?.trim();
  if (reqId) {
    const byId = outfits.find((o) => o.id === reqId);
    if (byId) return byId;
  }

  const content = params.userContent.trim();
  if (content) {
    let bestMatch: OcOutfitPreset | undefined;
    let bestLen = 0;
    for (const outfit of outfits) {
      for (const kw of outfit.keywordsZh ?? []) {
        if (kw.length >= 2 && content.includes(kw) && kw.length > bestLen) {
          bestMatch = outfit;
          bestLen = kw.length;
        }
      }
    }
    if (bestMatch) return bestMatch;
  }

  return params.activeOutfit ?? outfits[0]!;
}

/**
 * Deterministically compile a `SelfieSkillSpec` + `AiOcProfile` into a verified
 * NovelAI V5 OC Pipeline payload (4-part Base Prompt + Character Captions + Scene UC).
 */
export function compileOcSelfiePrompt(params: {
  oc: AiOcProfile;
  activeOutfit?: OcOutfitPreset;
  poses?: readonly OcPosePreset[];
  spec: SelfieSkillSpec;
  userContent: string;
  intentText?: string;
  allowNsfw: boolean;
  forceSpoiler?: boolean;
  rotationScopeKey?: string;
}): CompiledOcSelfiePrompt {
  const {
    oc,
    activeOutfit,
    poses = BUILTIN_OC_POSES,
    spec,
    userContent,
    intentText,
    allowNsfw,
    forceSpoiler = false,
    rotationScopeKey = 'default',
  } = params;
  const effectiveIntentText = intentText ?? userContent;
  const hasExplicitFraming = spec.framing !== undefined;
  const requestedFraming: OcSelfieFraming = spec.framing ?? 'portrait';

  // Dual-gate NSFW check: requires config allowNsfw + LLM nsfw:true + explicit user NSFW intent
  const effectiveNsfw = Boolean(
    allowNsfw &&
      spec.nsfw === true &&
      requestedFraming !== 'chibi' &&
      requestedFraming !== 'sticker_pack' &&
      hasExplicitUserNsfwIntent(effectiveIntentText),
  );
  const stripExplicit = !effectiveNsfw;

  // Resolve shot outfit (per-shot override -> keyword hit -> active daily OOTD -> default outfit #0)
  const selectedPresetOutfit = findShotOutfitPreset({
    oc,
    activeOutfit,
    requestedOutfitId: spec.outfitId,
    userContent,
  });
  const rawSanitizedCustomOutfit = sanitizeFieldTags(spec.outfit, stripExplicit);
  const ignoreModestCustomOutfit = Boolean(
    effectiveNsfw &&
      rawSanitizedCustomOutfit &&
      !EXPLICIT_NUDITY_OUTFIT_TAG_RE.test(rawSanitizedCustomOutfit) &&
      USER_UNDRESS_INTENT_RE.test(effectiveIntentText),
  );
  const sanitizedCustomOutfit = ignoreModestCustomOutfit ? '' : rawSanitizedCustomOutfit;
  const usingCustomOutfit = Boolean(sanitizedCustomOutfit);
  const sanitizedExplicitAction = sanitizeFieldTags(spec.action, stripExplicit);
  const sanitizedPartnerOutfit = sanitizeFieldTags(spec.partnerOutfit, stripExplicit);
  const sanitizedPartnerAction = sanitizeFieldTags(spec.partnerAction, stripExplicit);

  // Dual-gate Duo check: requires BOTH explicit user duo request AND LLM agreeing via duo_* pose / duo:true
  const llmAgreedDuo = Boolean(
    spec.duo === true || (spec.pose && /^duo_/i.test(spec.pose.trim())),
  );
  const allowDuo = Boolean(
    requestedFraming !== 'chibi' &&
      requestedFraming !== 'sticker_pack' &&
      llmAgreedDuo &&
      hasExplicitDuoIntent(effectiveIntentText),
  );
  const allowSpicy = Boolean(
    effectiveNsfw ||
      selectedPresetOutfit.ootdEligible === false ||
      SPICY_POSE_HINT_RE.test(effectiveIntentText),
  );

  // Resolve catalog pose when `spec.pose` is specified, `allowDuo` is active, or free-form `spec.action` is omitted
  const hasFreeformActionOnly = Boolean(sanitizedExplicitAction && !spec.pose?.trim() && !allowDuo);
  const selectedPoseResult =
    requestedFraming === 'chibi' || requestedFraming === 'sticker_pack' || hasFreeformActionOnly
      ? undefined
      : selectCatalogPose({
          poses,
          framing: requestedFraming,
          hasExplicitFraming,
          requestedPose: spec.pose,
          userContent,
          effectiveNsfw,
          allowDuo,
          allowSpicy,
          scopeKey: rotationScopeKey,
        });
  const selectedPose = selectedPoseResult?.pose;
  const poseMatchKind = selectedPoseResult?.matchKind;

  const isDuo = Boolean(
    selectedPose && (selectedPose.tier === 'duo_hug' || selectedPose.tier === 'duo_nsfw'),
  );

  const shouldUpgradeToFullFraming = Boolean(
    requestedFraming !== 'chibi' &&
      requestedFraming !== 'sticker_pack' &&
      selectedPose?.framing === 'full' &&
      (!hasExplicitFraming ||
        poseMatchKind === 'id' ||
        poseMatchKind === 'keyword' ||
        isDuo ||
        effectiveNsfw),
  );
  const framing: OcSelfieFraming = shouldUpgradeToFullFraming ? 'full' : requestedFraming;
  const style: OcSelfieStyle =
    framing === 'chibi' || framing === 'sticker_pack' ? 'anime' : (spec.style ?? 'anime');

  const baseEffectiveAppearance = composeOcAppearanceForOutfit(
    oc,
    usingCustomOutfit ? undefined : selectedPresetOutfit,
  );
  const nsfwBodyAnchors =
    selectedPresetOutfit.bodyAnchors || oc.bodyAnchors || DEFAULT_NSFW_BODY_ANCHORS;
  const effectiveAppearance = effectiveNsfw
    ? normalizeOcAppearance(`${baseEffectiveAppearance} ${nsfwBodyAnchors}`)
    : baseEffectiveAppearance;
  const subjectGender = inferGenderSubject(effectiveAppearance);
  const countTag =
    subjectGender === 'boy' ? '1boy' : subjectGender === 'character' ? '1other' : '1girl';

  // Resolve default aspect ratio matched to framing when omitted
  const defaultAspectByFraming: Record<OcSelfieFraming, ImageAspectRatio> = {
    portrait: '1:1',
    upper:
      style === 'watercolor' || style === 'graphic' || style === 'impasto' || style === 'nihonga'
        ? '2:3'
        : '3:2',
    full: '2:3',
    chibi: '1:1',
    sticker_pack: '1:1',
  };
  const aspectRatio: ImageAspectRatio =
    framing === 'sticker_pack'
      ? '1:1'
      : shouldUpgradeToFullFraming && requestedFraming === 'portrait' && spec.aspect === '1:1'
        ? '2:3'
        : (spec.aspect ?? defaultAspectByFraming[framing]);

  // Select framing-matched Costume Tier (prefer costumeNsfw / DEFAULT_COSTUME_NSFW in NSFW mode when custom outfit is omitted)
  const nsfwPresetCostume = effectiveNsfw
    ? normalizeOcCostumeTier(selectedPresetOutfit.costumeNsfw || oc.costumeNsfw || '') ||
      DEFAULT_COSTUME_NSFW
    : '';
  const selectedCostumeLine = usingCustomOutfit
    ? ensureTrailingComma(sanitizedCustomOutfit)
    : effectiveNsfw
      ? nsfwPresetCostume
      : framing === 'portrait'
        ? selectedPresetOutfit.costumePortrait
        : framing === 'full' || framing === 'chibi'
          ? selectedPresetOutfit.costumeFull
          : selectedPresetOutfit.costumeUpper;
  const hasExplicitToplessCue =
    effectiveNsfw && /\b(?:topless|bare\s+breasts?)\b/i.test(selectedCostumeLine);

  const primaryCharCaption = `${effectiveAppearance}\n${selectedCostumeLine}`.trim();
  const charCaptions: NaiCharCaption[] = [{ char_caption: primaryCharCaption }];

  const isYuriDuo = isDuo && YURI_DUO_RE.test(effectiveIntentText);
  if (isDuo) {
    if (isYuriDuo) {
      const partnerGirlCostume = sanitizedPartnerOutfit
        ? ensureTrailingComma(sanitizedPartnerOutfit)
        : effectiveNsfw
          ? 'loosely draped white silk camisole slipping off shoulder,'
          : 'simple cream knit cardigan, dark skirt,';
      charCaptions.push({
        char_caption: `girl, shoulder-length soft brown hair, gentle demeanor, face partially out of frame,\n${partnerGirlCostume}`,
      });
    } else {
      const partnerBoyCostume = sanitizedPartnerOutfit
        ? ensureTrailingComma(sanitizedPartnerOutfit)
        : effectiveNsfw
          ? selectedPose?.tier === 'duo_nsfw'
            ? 'unbuttoned open dark shirt, muscular shoulders, nude lower body,'
            : 'unbuttoned open dark shirt, muscular shoulders,'
          : 'casual dark button-up shirt with rolled sleeves, dark trousers,';
      charCaptions.push({
        char_caption: `boy, faceless male, hair shadowing eyes, face out of frame, tall build,\n${partnerBoyCostume}`,
      });
    }
  }

  // Animal presence rule (omit `solo` and add anti-chimera ear/tail negative guard)
  const sanitizedAnimal =
    framing === 'sticker_pack' || isDuo ? '' : sanitizeFieldTags(spec.animal, true);
  const hasAnimal = Boolean(sanitizedAnimal);

  const fallbackThemeHint = selectedPresetOutfit.themeHint || oc.defaultThemeHint;
  const sanitizedScene = sanitizeFieldTags(spec.scene, stripExplicit) || fallbackThemeHint;
  const sanitizedAction =
    sanitizedExplicitAction ||
    selectedPose?.actionTags ||
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
      hasAnimal ? `${countTag}, ${sanitizedAnimal}, chibi` : `${countTag}, solo, chibi`,
    );
    headTags.push(sanitizedScene);
  } else if (isDuo) {
    headTags.push(isYuriDuo ? '2girls, yuri' : '1girl, 1boy, heterosexual');
    headTags.push(sanitizedScene);
  } else {
    headTags.push(hasAnimal ? `${countTag}, ${sanitizedAnimal}` : `${countTag}, solo`);
    headTags.push(sanitizedScene);
  }
  const line1 = `${headTags.filter(Boolean).join(', ')},`;

  // Part 2: Pose/Action + Framing + Camera Angle + Style/Medium + Focus
  const effectiveAngle: OcCameraAngle | undefined = spec.angle ?? selectedPose?.defaultAngle;
  const angleTag = effectiveAngle ? OC_CAMERA_ANGLE_TAGS[effectiveAngle] : undefined;

  const framingTagsMap: Record<OcSelfieFraming, string> = {
    portrait: `portrait, close-up, upper body, ${angleTag ?? 'three-quarter view'}`,
    upper: `cowboy shot, upper body, ${angleTag ?? 'three-quarter view'}`,
    full: `full body, ${angleTag ?? 'straight on'}`,
    chibi:
      'full body chibi, straight on, clean crisp lineart, vibrant warm lighting, sharp focus, sticker style',
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

  // Per NAI V5 multi-character SOP: in 2-person shots, individual pose/expression tags go in Character N: lines!
  const soloEffectiveAction = hasExplicitToplessCue
    ? `topless, bare breasts, nipples, ${sanitizedAction}`
    : sanitizedAction;
  const line2 =
    framing === 'sticker_pack'
      ? `${framingTagsMap.sticker_pack},`
      : framing === 'chibi'
        ? `${sanitizedAction}, ${framingTagsMap.chibi},`
        : isDuo
          ? `${framingTagsMap[framing]}, ${styleTagsMap[style]},`
          : `${soloEffectiveAction}, ${framingTagsMap[framing]}, ${styleTagsMap[style]},`;

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
    sentenceBlock = ensureTrailingComma(rawSentence.replace(/\.$/, ''));
  } else if (selectedPose) {
    sentenceBlock = ensureTrailingComma(selectedPose.sentence.replace(/\.$/, ''));
  } else {
    const nounPhrase = subjectGender === 'boy' ? 'The boy' : 'The girl';
    sentenceBlock = `${nounPhrase} poses naturally (${sanitizedAction}) in ${sanitizedScene},`;
  }

  // Part 4: Trailing negative weight guards (silhouette + pose + framing + style + animal + anti-censor)
  const negBlocks: string[] = [];
  if (style === 'impasto') {
    negBlocks.push(
      '-2.0::realistic, photorealistic, western oil portrait, nosebleed, realistic nose, 3d, doll::',
    );
  }

  const neg15Terms: string[] = [];
  const neg12Terms: string[] = [];

  // In NSFW mode or custom outfit mode, omit daywear silhouetteGuard (which may forbid bare shoulders/legs)
  const activeGuard = effectiveNsfw || usingCustomOutfit ? '' : selectedPresetOutfit.silhouetteGuard;
  if (activeGuard) {
    for (const block of extractGuardInnerTerms(activeGuard)) {
      if (block.weight === '-1.5') {
        neg15Terms.push(block.terms);
      } else if (block.weight === '-1.2') {
        neg12Terms.push(block.terms);
      } else {
        negBlocks.push(`${block.weight}::${block.terms}::`);
      }
    }
  }

  if (selectedPose?.guard && !sanitizedExplicitAction) {
    for (const block of extractGuardInnerTerms(selectedPose.guard)) {
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
  if (effectiveNsfw && !usingCustomOutfit) {
    neg15Terms.push(NSFW_UNDRESS_NEG15_TERMS);
  }
  if (effectiveNsfw) {
    neg15Terms.push(ANTI_CENSOR_NEG15_TERMS);
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

  if (isDuo && selectedPose) {
    const primaryPrefix =
      subjectGender === 'boy' ? 'boy' : subjectGender === 'character' ? 'other' : 'girl';
    const rawPrimaryActions = sanitizedExplicitAction || selectedPose.actionTags;
    const primaryActions = hasExplicitToplessCue
      ? `topless, bare breasts, nipples, ${rawPrimaryActions}`
      : rawPrimaryActions;
    const partnerPrefix = isYuriDuo ? 'girl' : 'boy, faceless male';
    const partnerActions =
      sanitizedPartnerAction || selectedPose.partnerActionTags || 'holding girl gently, mutual#hug';
    promptLines.push(
      '',
      `Character 1: ${primaryPrefix}, ${ensureTrailingComma(primaryActions)}`,
      `Character 2: ${partnerPrefix}, ${ensureTrailingComma(partnerActions)}`,
    );
  }

  const finalPrompt = promptLines.join('\n');

  // Select Undesired Content (UC) preset (remove `extra characters` when rendering 2-character duo!)
  const rawBaseUc =
    framing === 'sticker_pack'
      ? V5_STICKER_UC
      : framing === 'chibi' || style === 'graphic' || style === 'nihonga'
        ? V5_GRAPHIC_UC
        : style === 'watercolor'
          ? V5_WATERCOLOR_UC
          : V5_SOLO_UC;
  const baseUc = isDuo ? removeExtraCharactersFromUc(rawBaseUc) : rawBaseUc;
  const finalNegativePrompt = effectiveNsfw ? `${baseUc}, ${ANTI_CENSOR_UC_TAGS}` : baseUc;

  return {
    prompt: finalPrompt,
    negativePrompt: finalNegativePrompt,
    charCaptions,
    aspectRatio,
    steps: 28,
    scale: 5.0,
    cfgRescale: 0,
    nsfw: effectiveNsfw,
    spoiler: Boolean(forceSpoiler || effectiveNsfw),
    framing,
    style,
    ...(selectedPose ? { poseId: selectedPose.id } : {}),
    ...(!usingCustomOutfit ? { outfitId: selectedPresetOutfit.id } : {}),
  };
}

export function buildOcSelfieSkillPrompt(params: {
  oc: AiOcProfile;
  activeOutfit?: OcOutfitPreset;
  allowNsfw: boolean;
}): string {
  const { oc, activeOutfit, allowNsfw } = params;
  const outfits = listOcOutfits(oc);
  const currentOutfit = activeOutfit ?? outfits[0]!;
  const coreAppearanceText = oc.baseAppearanceZh ?? oc.visualSummaryZh;

  const otherOutfitsSummary =
    outfits.length > 1
      ? outfits
          .map((o) => `${o.id}(${o.name}${o.ootdEligible === false ? '·隐藏款仅点名穿' : ''})`)
          .join(' / ')
      : '';

  const poseClustersLine = allowNsfw
    ? '- 姿势库（288组全量分级，`pose` 填簇名自动防重轮换）：日常特写上半身选 `cute_heart`(比心) / `cute_peace`(比耶敬礼) / `cute_face`(托腮捧脸挽发) / `cute_playful`(猫爪兔耳飞吻嘘) / `cute_shy`(捂嘴害羞伸懒腰)；全身选 `stand_casual`(站姿) / `stand_lookback`(回眸探身) / `sit_relaxed`(休闲坐晃腿) / `sit_girl`(女孩坐侧坐) / `squat_kneel`(蹲姿单膝跪) / `lie_casual`(趴卧侧躺)；曲线选 `spicy_upper` / `spicy_curve`；R18单人选 `nsfw_tease` / `nsfw_open`；当群友明确要双人合照且你愿意拍双人照时选 `duo_cuddle`（双人R18选 `duo_intimate`；若你拒绝双人互动只肯发单人照则选单人簇）。镜头 `angle` 可选 `front`/`three_quarter`/`high`(俯拍)/`low`(仰拍)/`side`。如需微调或自定义具体动作与画面叙事，可同时或单独传入英文 `"action"` 与 `"sentence"`（均优先于姿势库默认词）；双人同框还可用 `"partnerOutfit"` 与 `"partnerAction"` 定制对方衣着与 `source#`/`target#`/`mutual#` 互动标签。'
    : '- 姿势库（`pose` 填簇名自动防重轮换）：上半身特写选 `cute_heart`(比心) / `cute_peace`(比耶敬礼) / `cute_face`(托腮捧脸挽发) / `cute_playful`(猫爪兔耳飞吻嘘) / `cute_shy`(捂嘴害羞伸懒腰)；全身选 `stand_casual`(站姿) / `stand_lookback`(回眸探身) / `sit_relaxed`(休闲坐晃腿) / `sit_girl`(女孩坐侧坐) / `squat_kneel`(蹲姿单膝跪) / `lie_casual`(趴卧侧躺)；当群友明确要双人拥抱合照且你愿意配合时选 `duo_cuddle`（若拒绝双人互动只发单人照则选单人簇）。镜头 `angle` 可选 `front`/`three_quarter`/`high`/`low`/`side`。仅当群友指定库外动作时填英文 `action` 与 `sentence`（双人可用 `partnerOutfit`/`partnerAction`）。';

  const nsfwLine = allowNsfw
    ? '- 分级与衣着规则：日常拍照一律保持 `"nsfw": false`；仅当群友明确要求涩图/大尺度/脱衣内容且符合你当前态度愿意发时，才可设 `"nsfw": true`（自动打模糊遮罩）。注意：当 `"nsfw": true` 时**默认省略 `"outfit"`**，让编译器自动套用该自设内置的无遮挡褪衣 `costumeNsfw` 预设（严禁自行填上半解外衣或遮胸内衣词；仅当群友明确点名泳装、女仆、兔女郎等特定主题装扮时才传 `"outfit"`）；动作与台词仍可通过 `"action"`、`"sentence"` 以及双人 `"partnerOutfit"` / `"partnerAction"` 定制。'
    : '- 分级规则：仅支持健康日常向画面，固定 `"nsfw": false`，严禁输出裸露色情标签。';

  return [
    '## 自设穿搭状态与拍照生图技能（文字闲聊也同步知晓今日穿搭；仅在群友要图时附 `[SELFIE:]`）',
    `- 你的固定外貌特征：${coreAppearanceText}。`,
    `- 你今天的当前穿搭（OOTD）：**${currentOutfit.name}**（${currentOutfit.summaryZh}）。群友平时问你今天穿什么，按这套自然回答；日常拍照无需填换装参数，默认即穿这套。`,
    ...(otherOutfitsSummary
      ? [
          `- 你的衣柜备选套装（仅当群友明确要求换某套拍照时，在标签填 \`"outfitId":"套装ID"\`，仅当次拍照生效；若点名衣柜外服装再填 \`"outfit":"英文服装tag"\`）：${otherOutfitsSummary}。`,
        ]
      : []),
    '- 触发条件：仅当群友明确让你发自拍、拍张照、看看你在干嘛、看你的穿搭、发Q版表情包，或画一张你的图时调用；普通文字闲聊、问答时**严禁**输出 `[SELFIE:]`。',
    '- 调用方式：先用符合人设的中文自然回复 1~3 句（严禁念出英文提示词），在回复**最末尾另起一行**附上单行 JSON 标签：',
    '  `[SELFIE: {"framing":"full","aspect":"2:3","style":"anime","pose":"stand_casual","angle":"three_quarter","scene":"英文环境背景与光影tag","nsfw":false}]`',
    '- 取景与画风：`framing` 选 `full`(全身与大动态姿势,2:3；凡选 `stand_casual`/`stand_lookback`/`sit_relaxed`/`sit_girl`/`squat_kneel`/`lie_casual`/`spicy_curve`/`nsfw_open`/`duo_cuddle`/`duo_intimate` 等全身簇时优先用 `"framing":"full","aspect":"2:3"`) / `upper`(半身,3:2或2:3) / `portrait`(大头特写,1:1) / `chibi`(单张Q版,1:1) / `sticker_pack`(2x2四格表情包,1:1)；`style` 默认 `anime`（可选 `watercolor`/`graphic`/`impasto`/`nihonga`）；有动物同框加 `"animal":"英文动物词"`。',
    poseClustersLine,
    nsfwLine,
  ].join('\n');
}
