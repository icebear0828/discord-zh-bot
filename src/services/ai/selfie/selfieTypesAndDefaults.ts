import type { ImageAspectRatio } from '../../../config/defaults.js';
import type { NaiCharCaption } from '../../imageClient.js';
import { sanitizeTagSegment, splitTopLevelTags } from '../../imagePromptProcessor.js';
import {
  OC_CAMERA_ANGLE_TAGS,
  type OcCameraAngle,
  type OcPoseCluster,
  type OcPosePreset,
  type OcPoseTier,
} from '../../ocPoseCatalog.js';

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

export const ANTI_CENSOR_UC_TAGS =
  'censored, mosaic censoring, bar censor, light censor, pointillism censor';

export const ANTI_CENSOR_NEG15_TERMS = 'censored, mosaic censoring, bar censor';

export const NSFW_UNDRESS_NEG15_TERMS =
  'bra, bikini, lingerie covering breasts, camisole, shirt, halter top, qipao, dress, skirt, panties';

export const R18_POSITIVE_PREFIX = 'nsfw';

export const DEFAULT_NSFW_BODY_ANCHORS = 'smooth dewy skin, slender waist, curvy,';

export const DEFAULT_COSTUME_NSFW =
  'completely nude, topless, bare breasts, nipples, no bra, no panties,';

export const EXPLICIT_NUDITY_OUTFIT_TAG_RE =
  /\b(?:nude|naked|topless|bare\s+breasts?|nipples?)\b/i;

export const USER_UNDRESS_INTENT_RE =
  /(?:脱|全裸|裸|果体|不穿|一丝不挂|光着|露胸|露点|露奶|色图|涩图|瑟瑟|r18|nsfw|nude|naked|topless)/i;

export const VALID_OC_PRESET_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/i;

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

export const DEFAULT_CUSTOM_OC_WARDROBE: readonly OcOutfitPreset[] = [
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

export const VALID_ASPECTS: ReadonlySet<string> = new Set<ImageAspectRatio>([
  '2:3',
  '3:2',
  '1:1',
  '9:16',
  '16:9',
]);

export const VALID_PO_CLUSTERS: ReadonlySet<string> = new Set<OcPoseCluster>([
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

export const EXPLICIT_USER_NSFW_RE =
  /(?:\br18g?\b|\bnsfw\b|\bhentai\b|\bnude\b|\bnaked\b|\btopless\b|\bbottomless\b|\bsex\b|\berotic\b|\blewd\b|涩图|色图|瑟瑟|涩涩|黄图|裸体|全裸|半裸|脱光|脱衣|脱掉|脱下|不穿|私房照|床照|福利图|色一点|涩一点|更色|更涩|过分一点|来点刺激|大尺度|尺度大|内衣照|无码|露奶|露点|露胸|露逼|露穴|露乳|白虎穴|私处|做爱|自慰|内射|口交|乳交|足交|情趣内衣|透视装|真空上阵|掀裙|走光|擦边)/i;

export const EXPLICIT_DUO_INTENT_RE =
  /(?:双人|合照|情侣照|双女主?|百合|\b2girls\b|\b1boy\b|和我一起|跟我一起|抱抱我|抱着你|抱着我|环抱你|从背后抱|背后环抱|坐我腿上|坐在?膝上|坐怀|公主抱|横抱你|壁咚|耳边低语|十指紧扣|相拥|贴脸依偎|同眠|抱着睡|骑乘位?|传教士|正常位|后入位?|侧入位?|双人瑟瑟|双人涩图|和我做爱|跟我做爱)/i;

export const YURI_DUO_RE = /(?:百合|双女主?|女女|\b2girls\b|\byuri\b|闺蜜贴贴|两个女孩)/i;

export const SPICY_POSE_HINT_RE =
  /(?:性感|撩人|魅惑|曲线|事业线|显身材|火辣|诱惑|顶胯|翘臀|S形|兔女郎|纯欲)/i;

export const EXPLICIT_TAG_FILTER_RE =
  /\b(?:nsfw|uncensored|rating\s*:\s*explicit|rating\s*:\s*questionable|completely\s+nude|nude|naked|topless|bottomless|nipples?|areolae?|pussy|vaginal?|penis|cum|sex|masturbat\w*|spread\s+legs|exposed\s+breasts?|bare\s+breasts?|cameltoe|anus|asshole)\b/i;

export function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function ensureTrailingComma(text: string): string {
  const trimmed = text.trim().replace(/,+$/, '').trim();
  return trimmed ? `${trimmed},` : '';
}

export function normalizeCameraAngle(raw: unknown): OcCameraAngle | undefined {
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
