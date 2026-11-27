export {
  DEFAULT_AI_SELFIE_CONFIG,
  DEFAULT_CUSTOM_OC_CONFIG,
  normalizeOcAppearance,
  normalizeOcCostumeTier,
  OC_CAMERA_ANGLE_TAGS,
  V5_GRAPHIC_UC,
  V5_SOLO_UC,
  V5_STICKER_UC,
  V5_WATERCOLOR_UC,
  type AiCustomOcConfig,
  type AiOcPresetKey,
  type AiOcProfile,
  type AiSelfieConfig,
  type CompiledOcSelfiePrompt,
  type OcCameraAngle,
  type OcOutfitPreset,
  type OcPoseCluster,
  type OcPosePreset,
  type OcPoseTier,
  type OcSelfieFraming,
  type OcSelfieStyle,
  type SelfieSkillSpec,
} from './ai/selfie/selfieTypesAndDefaults.js';

export { sanitizeStoredAiSelfieConfig } from './ai/selfie/selfieExternalSanitizer.js';

export {
  AiOcPresetStore,
  listBuiltinOcPoses,
} from './ai/selfie/selfiePresetStore.js';

export {
  composeOcAppearanceForOutfit,
  listOcOutfits,
  resolveActiveOcOutfit,
  resolveActiveOcProfile,
} from './ai/selfie/selfieOutfitsAndOotd.js';

export {
  extractSelfieSkillTag,
  hasExplicitDuoIntent,
  hasExplicitUserNsfwIntent,
  stripSelfieSkillTags,
} from './ai/selfie/selfieTagParser.js';

export { resetPoseRotationState } from './ai/selfie/selfiePoseSelector.js';

export { compileOcSelfiePrompt } from './ai/selfie/selfiePromptCompiler.js';

export {
  buildOcChatStatusPrompt,
  buildOcSelfieSkillPrompt,
  didAssistantRefuseAllPhoto,
  didAssistantRefuseDuo,
  hasExplicitSelfieRequest,
  inferOcSelfieSpecFromTurn,
} from './ai/selfie/selfieTurnInference.js';
