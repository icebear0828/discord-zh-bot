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

export function hasWardrobeKeywordHit(oc: AiOcProfile, userContent: string): boolean {
  const text = userContent.trim();
  if (!text) return false;
  for (const outfit of listOcOutfits(oc)) {
    for (const kw of outfit.keywordsZh ?? []) {
      if (kw.length >= 2 && text.includes(kw)) {
        return true;
      }
    }
  }
  return false;
}
