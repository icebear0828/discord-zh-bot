import { sanitizeTagSegment } from '../../imagePromptProcessor.js';
import type { OcPoseCluster, OcPosePreset, OcPoseTier } from '../../ocPoseCatalog.js';
import {
  DEFAULT_AI_SELFIE_CONFIG,
  DEFAULT_CUSTOM_OC_CONFIG,
  ensureTrailingComma,
  isRecord,
  normalizeCameraAngle,
  normalizeOcAppearance,
  normalizeOcCostumeTier,
  VALID_OC_PRESET_ID_RE,
  VALID_PO_CLUSTERS,
  type AiOcPresetKey,
  type AiOcProfile,
  type AiSelfieConfig,
  type OcOutfitPreset,
} from './selfieTypesAndDefaults.js';

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

export function sanitizeExternalOutfitPreset(raw: unknown): OcOutfitPreset | null {
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
  const hairAccessory = rawHair
    ? ensureTrailingComma(sanitizeTagSegment(rawHair.slice(0, 600)))
    : undefined;
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

export function sanitizeExternalPosePreset(raw: unknown): OcPosePreset | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  if (!id || !VALID_OC_PRESET_ID_RE.test(id)) return null;
  const actionTags =
    typeof raw['actionTags'] === 'string' ? raw['actionTags'].trim().slice(0, 500) : '';
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

export function sanitizeExternalOcProfile(raw: unknown): AiOcProfile | null {
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
