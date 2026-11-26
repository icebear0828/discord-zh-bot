import { stripCotBlocks } from './aiCompiler.js';
import type { LlmClient } from './llmClient.js';

export interface ImagePromptContext {
  rawPrompt: string;
  userNegativePrompt: string;
  defaultPositivePrompt: string;
  defaultNegativePrompt: string;
  translateChinese: boolean;
  translatorModel: string | null;
}

export interface ProcessedImagePrompt {
  finalPrompt: string;
  finalNegativePrompt: string;
  translated: boolean;
}

export interface ImagePromptProcessor {
  process(input: ImagePromptContext): Promise<ProcessedImagePrompt>;
}

const CJK_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/;

const LITERAL_TRANSLATOR_SYSTEM_PROMPT = [
  'You are a literal translator for image generation prompts.',
  'Translate the user prompt accurately and faithfully into concise English comma-separated descriptive phrases or tags.',
  'Preserve all existing English tags, numbers, weights, and structure verbatim.',
  'Do NOT add extra quality tags, style tags, artist names, or unrequested details.',
  'Output ONLY the translated prompt text without explanations, quotes, or markdown.',
].join('\n');

export function containsCjkText(text: string): boolean {
  return CJK_CHAR_RE.test(text);
}

function joinPromptSegments(parts: readonly string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(', ');
}

function cleanTranslatedOutput(raw: string): string {
  const { cleaned } = stripCotBlocks(raw, {
    enabled: true,
    tags: ['think', 'thinking', 'thought'],
  });
  let out = cleaned.trim();
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'")) ||
    (out.startsWith('`') && out.endsWith('`'))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out.replace(/\s*\n+\s*/g, ', ').trim();
}

export class LiteralTranslationPromptProcessor implements ImagePromptProcessor {
  constructor(
    private readonly llmClient?: LlmClient,
    private readonly defaultTranslatorModel?: string,
  ) {}

  private async translateLiteralIfNeeded(
    rawText: string,
    translateChinese: boolean,
    translatorModel: string | null,
  ): Promise<{ text: string; translated: boolean }> {
    const trimmed = rawText.trim();
    if (!trimmed || !translateChinese || !containsCjkText(trimmed)) {
      return { text: trimmed, translated: false };
    }
    if (!this.llmClient || !this.llmClient.isConfigured()) {
      return { text: trimmed, translated: false };
    }

    const modelOverride = translatorModel?.trim() || this.defaultTranslatorModel?.trim() || undefined;
    try {
      const res = await this.llmClient.chat({
        ...(modelOverride ? { model: modelOverride } : {}),
        messages: [
          { role: 'system', content: LITERAL_TRANSLATOR_SYSTEM_PROMPT },
          { role: 'user', content: trimmed },
        ],
        temperature: 0.1,
        maxTokens: 500,
        timeoutMs: 15_000,
        stream: false,
        maxRetries: 1,
      });
      const cleaned = cleanTranslatedOutput(res.content);
      if (!cleaned) {
        return { text: trimmed, translated: false };
      }
      return { text: cleaned, translated: true };
    } catch {
      return { text: trimmed, translated: false };
    }
  }

  async process(input: ImagePromptContext): Promise<ProcessedImagePrompt> {
    const posRes = await this.translateLiteralIfNeeded(
      input.rawPrompt,
      input.translateChinese,
      input.translatorModel,
    );
    const negRes = await this.translateLiteralIfNeeded(
      input.userNegativePrompt,
      input.translateChinese,
      input.translatorModel,
    );

    const finalPrompt = joinPromptSegments([posRes.text, input.defaultPositivePrompt]);
    const finalNegativePrompt = joinPromptSegments([input.defaultNegativePrompt, negRes.text]);

    return {
      finalPrompt,
      finalNegativePrompt,
      translated: posRes.translated || negRes.translated,
    };
  }
}
