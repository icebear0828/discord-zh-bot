import type { NaiCharCaption } from './imageClient.js';
import {
  formatCharacterPromptsText,
  parseCharacterPromptsText,
  sanitizeExplicitCharCaptions,
  type ParsedCharacterPromptsResult,
} from './image/prompt/naiCharacterBlockParser.js';
import {
  hasMultiCharacterOrViewCue,
  mergeNegativePrompts,
  mergePositivePrompts,
  stripExtraCharactersFromNegative,
} from './image/prompt/naiPromptMerger.js';
import {
  parseStructuredNaiPrompt,
  type StructuredNaiPrompt,
} from './image/prompt/naiStructuredParser.js';
import {
  MAX_NAI_CHARACTERS,
  parseCoordSpec,
  sanitizeTagSegment,
  splitTopLevelTags,
  type ImagePromptContext,
  type ImagePromptProcessor,
  type ProcessedImagePrompt,
} from './image/prompt/naiTagTokenizer.js';

export {
  MAX_NAI_CHARACTERS,
  formatCharacterPromptsText,
  mergeNegativePrompts,
  mergePositivePrompts,
  parseCharacterPromptsText,
  parseCoordSpec,
  parseStructuredNaiPrompt,
  sanitizeTagSegment,
  splitTopLevelTags,
  stripExtraCharactersFromNegative,
  type ImagePromptContext,
  type ImagePromptProcessor,
  type ParsedCharacterPromptsResult,
  type ProcessedImagePrompt,
  type StructuredNaiPrompt,
};

export class DefaultImagePromptProcessor implements ImagePromptProcessor {
  async process(input: ImagePromptContext): Promise<ProcessedImagePrompt> {
    const structured = parseStructuredNaiPrompt(input.rawPrompt);
    const effectiveBasePrompt = structured.basePrompt || input.rawPrompt;

    let charCaptions: NaiCharCaption[] = [];
    let hasExplicitCoords = false;

    if (input.charCaptions && input.charCaptions.length > 0) {
      const normalized = sanitizeExplicitCharCaptions(input.charCaptions);
      charCaptions = normalized.charCaptions;
      hasExplicitCoords = normalized.hasExplicitCoords;
    } else if (input.rawCharacterPrompt !== undefined && input.rawCharacterPrompt.trim()) {
      const parsedChars = parseCharacterPromptsText(input.rawCharacterPrompt);
      charCaptions = parsedChars.charCaptions;
      hasExplicitCoords = parsedChars.hasExplicitCoords;
    } else if (structured.charCaptions.length > 0) {
      charCaptions = structured.charCaptions;
      hasExplicitCoords = structured.hasExplicitCoords;
    }

    const combinedUserNeg = [structured.negativePrompt, input.userNegativePrompt]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');

    const effectiveUseCoords =
      input.useCoords !== undefined ? input.useCoords : hasExplicitCoords;

    const rawMergedNegative = mergeNegativePrompts(input.defaultNegativePrompt, combinedUserNeg);
    const finalNegativePrompt = hasMultiCharacterOrViewCue(
      effectiveBasePrompt,
      charCaptions.length,
    )
      ? stripExtraCharactersFromNegative(rawMergedNegative)
      : rawMergedNegative;

    return {
      finalPrompt: mergePositivePrompts(input.defaultPositivePrompt, effectiveBasePrompt),
      finalNegativePrompt,
      effectiveRawPrompt: effectiveBasePrompt.trim(),
      ...(charCaptions.length > 0 ? { charCaptions } : {}),
      ...(effectiveUseCoords ? { useCoords: true } : {}),
    };
  }
}
