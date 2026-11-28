import { splitTopLevelTags } from '../../imagePromptProcessor.js';
import {
  DEFAULT_AI_SELFIE_CONFIG,
  DEFAULT_CUSTOM_OC_CONFIG,
  DEFAULT_CUSTOM_OC_WARDROBE,
  ensureTrailingComma,
  normalizeOcAppearance,
  normalizeOcCostumeTier,
  type AiOcProfile,
  type AiSelfieConfig,
  type OcOutfitPreset,
} from './selfieTypesAndDefaults.js';

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

export function matchWardrobeOutfitByKeywords(
  oc: AiOcProfile,
  rawText: string,
): OcOutfitPreset | undefined {
  const contentLower = rawText.trim().toLowerCase();
  if (!contentLower) return undefined;
  let bestMatch: OcOutfitPreset | undefined;
  let bestLen = 0;
  for (const outfit of listOcOutfits(oc)) {
    for (const kw of outfit.keywordsZh ?? []) {
      const kwLower = kw.trim().toLowerCase();
      if (kwLower.length >= 2 && contentLower.includes(kwLower) && kwLower.length > bestLen) {
        bestMatch = outfit;
        bestLen = kwLower.length;
      }
    }
  }
  return bestMatch;
}

export function findShotOutfitPreset(params: {
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

  const byKeyword = matchWardrobeOutfitByKeywords(params.oc, params.userContent);
  if (byKeyword) return byKeyword;

  return params.activeOutfit ?? outfits[0]!;
}

export function hasWardrobeKeywordHit(oc: AiOcProfile, userContent: string): boolean {
  return matchWardrobeOutfitByKeywords(oc, userContent) !== undefined;
}

export interface InferredGarmentMods {
  legwear?: string;
  footwear?: string;
  barefoot?: boolean;
}

interface LegwearPatternRule {
  regex: RegExp;
  legwear: string;
  barefoot: boolean;
}

const HYPOTHETICAL_CLAUSE_RE =
  /(?:说不定|等会儿|待会儿|如果|要是|下次|改天)[^，。！？!?,;\n]{0,18}/gu;
const NEGATED_WEAR_CLAUSE_RE =
  /(?:才不穿|不给你穿|才不换|不给你换|不想穿|别穿|没穿)[^，。！？!?,;\n]{0,14}/gu;

const LEGWEAR_RULES: readonly LegwearPatternRule[] = [
  {
    regex:
      /(?:撕破|撕开|扯破|扯开|破洞|战损)[\p{L}]{0,4}(?:黑丝|丝袜)|(?:黑丝|丝袜)[\p{L}]{0,4}(?:撕破|撕开|扯破|扯开|破洞)/gu,
    legwear: 'torn sheer black pantyhose, ripped black nylon tights',
    barefoot: false,
  },
  {
    regex:
      /(?<!脱掉?|扒下?|褪下?|不穿|不要)(?:吊带黑丝|黑丝吊袜带|黑丝大腿袜|黑丝过膝袜|黑色过膝袜|黑色长筒袜)/gu,
    legwear: 'sheer black lace-top thighhigh stockings, garter straps',
    barefoot: false,
  },
  {
    regex: /(?<!脱掉?|扒下?|褪下?|不穿|不要)(?:超薄黑丝|油亮黑丝|黑丝连裤袜|黑色丝袜|黑色连裤袜|黑丝)/gu,
    legwear: 'sheer black pantyhose, black nylon tights',
    barefoot: false,
  },
  {
    regex:
      /(?<!脱掉?|扒下?|褪下?|不穿|不要)(?:吊带白丝|白丝吊袜带|白丝大腿袜|白丝过膝袜|白色过膝袜|白色长筒袜)/gu,
    legwear: 'sheer white lace-top thighhigh stockings',
    barefoot: false,
  },
  {
    regex: /(?<!脱掉?|扒下?|褪下?|不穿|不要)(?:超薄白丝|白丝连裤袜|白色丝袜|白色连裤袜|白丝)/gu,
    legwear: 'sheer white pantyhose, white tights',
    barefoot: false,
  },
  {
    regex: /(?<!脱掉?|扒下?|褪下?|不穿|不要)(?:肉色丝袜|裸色丝袜|肉丝)/gu,
    legwear: 'sheer nude pantyhose, skin-tone nylon tights',
    barefoot: false,
  },
  {
    regex: /(?<!脱掉?|扒下?|褪下?|不穿|不要)(?:灰色丝袜|灰丝)/gu,
    legwear: 'sheer grey pantyhose, grey tights',
    barefoot: false,
  },
  {
    regex: /(?<!脱掉?|扒下?|褪下?|不穿|不要)(?:渔网袜|黑网袜|网袜)/gu,
    legwear: 'black fishnet pantyhose, fishnet stockings',
    barefoot: false,
  },
  {
    regex: /(?:换上?|穿上?|套上?)(?:这双|那条|一条|一双)?丝袜/gu,
    legwear: 'sheer black pantyhose, black nylon tights',
    barefoot: false,
  },
  {
    regex:
      /(?:光着?脚丫?|赤足|裸足|(?:脱掉?|扒下?|褪下?|褪到底|不穿)(?:这双|那双|你的|刚穿好的)?(?:黑丝|白丝|肉丝|灰丝|网袜|丝袜|过膝袜|长筒袜|连裤袜|袜子|鞋袜)|(?:把|将)[\p{L}]{0,6}(?:黑丝|白丝|肉丝|灰丝|网袜|丝袜|过膝袜|长筒袜|连裤袜|袜子|鞋袜)(?:脱掉?|扒下?|褪下?|褪到底))/gu,
    legwear: 'bare legs, barefoot, no socks, no shoes',
    barefoot: true,
  },
];

export function inferGarmentModsFromText(rawText: string): InferredGarmentMods {
  const cleaned = rawText
    .replace(HYPOTHETICAL_CLAUSE_RE, ' ')
    .replace(NEGATED_WEAR_CLAUSE_RE, ' ')
    .trim();
  if (!cleaned) return {};

  let bestEndIdx = -1;
  let chosen: { legwear: string; barefoot: boolean } | undefined;
  for (const rule of LEGWEAR_RULES) {
    rule.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.regex.exec(cleaned)) !== null) {
      const endIdx = m.index + m[0].length;
      if (endIdx > bestEndIdx) {
        bestEndIdx = endIdx;
        chosen = { legwear: rule.legwear, barefoot: rule.barefoot };
      }
    }
  }

  let footwear: string | undefined;
  if (!chosen?.barefoot) {
    if (/(?<!脱掉?|不穿|不要)(?:白高跟)/u.test(cleaned)) {
      footwear = 'glossy white stiletto high heels';
    } else if (/(?<!脱掉?|不穿|不要)(?:黑高跟|细高跟|高跟鞋)/u.test(cleaned)) {
      footwear = 'glossy black stiletto high heels';
    }
  }

  return {
    ...(chosen ? { legwear: chosen.legwear, barefoot: chosen.barefoot } : {}),
    ...(footwear ? { footwear } : {}),
  };
}

const EXISTING_LEGWEAR_TAG_RE =
  /\b(?:thighhighs?|thigh-high\s+socks?|knee-high\s+socks?|over-the-knee\s+(?:[\w-]+\s+)*socks?|ankle\s+socks?|lounge\s+socks?|tabi\s+socks?|socks?|stockings?|pantyhose|tights|legwear|garter\s+straps?|garter\s+belt|bare\s+legs?|no\s+socks?|vertical\s+diamond\s+motif\s+along\s+shins)\b/i;

const EXISTING_FOOTWEAR_TAG_RE =
  /\b(?:boots?|shoes?|loafers?|sandals?|pumps?|heels?|mary\s+janes?|sneakers?|slippers?|bare\s+feet|bare\s+indoor\s+feet|barefoot|no\s+shoes?)\b/i;

const BARE_FOOT_ONLY_TAG_RE = /\b(?:bare\s+feet|bare\s+indoor\s+feet|barefoot)\b/i;

export function applyGarmentModsToCostume(
  costumeLine: string,
  mods: InferredGarmentMods,
): string {
  if (!mods.legwear && !mods.footwear && !mods.barefoot) {
    return costumeLine;
  }
  const tags = splitTopLevelTags(costumeLine);
  const bodyTags: string[] = [];
  const keptFootwearTags: string[] = [];

  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag) continue;
    if ((mods.legwear || mods.barefoot) && EXISTING_LEGWEAR_TAG_RE.test(tag)) {
      continue;
    }
    if (EXISTING_FOOTWEAR_TAG_RE.test(tag)) {
      if (mods.barefoot || mods.footwear) {
        continue;
      }
      if (mods.legwear && BARE_FOOT_ONLY_TAG_RE.test(tag)) {
        continue;
      }
      keptFootwearTags.push(tag);
      continue;
    }
    bodyTags.push(tag);
  }

  if (mods.legwear) {
    bodyTags.push(...splitTopLevelTags(mods.legwear));
  }
  if (mods.footwear && !mods.barefoot) {
    bodyTags.push(...splitTopLevelTags(mods.footwear));
  }
  bodyTags.push(...keptFootwearTags);

  return ensureTrailingComma(bodyTags.join(', '));
}

const GUARD_LEGWEAR_CONFLICT_RE =
  /\b(?:thighhighs?|stockings?|tights|pantyhose|legwear|socks?|bare\s+legs?|bare\s+feet|barefoot)\b/i;
const GUARD_FOOTWEAR_CONFLICT_RE =
  /\b(?:shoes?|boots?|heels?|loafers?|sandals?|pumps?|bare\s+feet|barefoot)\b/i;

export function filterConflictingGarmentGuardTerms(
  terms: string,
  mods: InferredGarmentMods,
): string {
  if (!mods.legwear && !mods.footwear && !mods.barefoot) {
    return terms;
  }
  const kept = terms
    .split(',')
    .map((t) => t.trim())
    .filter((t) => {
      if (!t) return false;
      if ((mods.legwear || mods.barefoot) && GUARD_LEGWEAR_CONFLICT_RE.test(t)) return false;
      if ((mods.footwear || mods.barefoot) && GUARD_FOOTWEAR_CONFLICT_RE.test(t)) return false;
      return true;
    });
  return kept.join(', ');
}
