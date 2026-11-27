import type { ImageAspectRatio } from '../../../config/defaults.js';
import type { NaiCharCaption } from '../../imageClient.js';
import {
  BUILTIN_OC_POSES,
  OC_CAMERA_ANGLE_TAGS,
  type OcCameraAngle,
  type OcPosePreset,
} from '../../ocPoseCatalog.js';
import {
  ANTI_CENSOR_NEG15_TERMS,
  ANTI_CENSOR_UC_TAGS,
  DEFAULT_COSTUME_NSFW,
  DEFAULT_NSFW_BODY_ANCHORS,
  ensureTrailingComma,
  EXPLICIT_NUDITY_OUTFIT_TAG_RE,
  EXPLICIT_TAG_FILTER_RE,
  normalizeOcAppearance,
  normalizeOcCostumeTier,
  NSFW_UNDRESS_NEG15_TERMS,
  R18_POSITIVE_PREFIX,
  SPICY_POSE_HINT_RE,
  USER_UNDRESS_INTENT_RE,
  V5_GRAPHIC_UC,
  V5_SOLO_UC,
  V5_STICKER_UC,
  V5_WATERCOLOR_UC,
  YURI_DUO_RE,
  type AiOcProfile,
  type CompiledOcSelfiePrompt,
  type OcOutfitPreset,
  type OcSelfieFraming,
  type OcSelfieStyle,
  type SelfieSkillSpec,
} from './selfieTypesAndDefaults.js';
import { composeOcAppearanceForOutfit, findShotOutfitPreset } from './selfieOutfitsAndOotd.js';
import {
  extractAnimalSpeciesWord,
  extractGuardInnerTerms,
  hasExplicitDuoIntent,
  hasExplicitUserNsfwIntent,
  inferGenderSubject,
  removeExtraCharactersFromUc,
  sanitizeFieldTags,
} from './selfieTagParser.js';
import { selectCatalogPose } from './selfiePoseSelector.js';

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
