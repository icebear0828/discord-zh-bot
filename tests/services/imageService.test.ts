import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NAI_NEGATIVE_PROMPT,
  DEFAULT_NAI_POSITIVE_PROMPT,
} from '../../src/config/defaults.js';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ImageRepo } from '../../src/db/repositories/imageRepo.js';
import {
  ImageApiError,
  ImageClient,
  resolveImagesGenerationsUrl,
} from '../../src/services/imageClient.js';
import {
  DefaultImagePromptProcessor,
  formatCharacterPromptsText,
  mergeNegativePrompts,
  mergePositivePrompts,
  parseCharacterPromptsText,
  parseCoordSpec,
  parseStructuredNaiPrompt,
  sanitizeTagSegment,
  splitTopLevelTags,
  type ImagePromptProcessor,
} from '../../src/services/imagePromptProcessor.js';
import { ImageService } from '../../src/services/imageService.js';

const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const TINY_PNG_B64 = TINY_PNG_BYTES.toString('base64');

describe('ImageClient', () => {
  it('resolves images/generations URL cleanly', () => {
    expect(resolveImagesGenerationsUrl('https://img.example.com/v1')).toBe(
      'https://img.example.com/v1/images/generations',
    );
    expect(resolveImagesGenerationsUrl('https://img.example.com/v1///')).toBe(
      'https://img.example.com/v1/images/generations',
    );
    expect(resolveImagesGenerationsUrl('https://img.example.com/v1/images/generations')).toBe(
      'https://img.example.com/v1/images/generations',
    );
  });

  it('sends expected JSON payload (omitting empty negative_prompt/seed/cfg_rescale) and serializes cfg_rescale & char_captions', async () => {
    const fetchSpy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(JSON.stringify({ created: 1, data: [{ b64_json: TINY_PNG_B64 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new ImageClient(
      {
        baseUrl: 'https://img.example.com/v1',
        apiKey: 'sk-img',
        model: 'nai/nai-diffusion-5-full',
        timeoutMs: 30_000,
        maxRetries: 2,
      },
      { fetchFn: fetchSpy as unknown as typeof fetch, sleepFn: async () => undefined },
    );

    const res1 = await client.generate({
      prompt: '1girl, solo, silver hair',
      aspectRatio: '2:3',
      steps: 28,
      scale: 5.0,
    });
    expect(res1.buffer.equals(TINY_PNG_BYTES)).toBe(true);
    expect(res1.model).toBe('nai/nai-diffusion-5-full');
    expect(res1.attempts).toBe(1);

    const body1 = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body1).toEqual({
      model: 'nai/nai-diffusion-5-full',
      prompt: '1girl, solo, silver hair',
      aspect_ratio: '2:3',
      steps: 28,
      scale: 5,
    });
    expect('negative_prompt' in body1).toBe(false);
    expect('seed' in body1).toBe(false);
    expect('cfg_rescale' in body1).toBe(false);
    expect('char_captions' in body1).toBe(false);

    await client.generate({
      prompt: '1girl',
      negativePrompt: 'lowres, bad hands',
      aspectRatio: '3:2',
      steps: 20,
      scale: 6.5,
      cfgRescale: 0.3,
      seed: 42,
      charCaptions: [
        { char_caption: 'girl, silver hair', centers: [{ x: 0.3, y: 0.5 }] },
      ],
    });
    const body2 = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(body2).toEqual({
      model: 'nai/nai-diffusion-5-full',
      prompt: '1girl',
      negative_prompt: 'lowres, bad hands',
      aspect_ratio: '3:2',
      steps: 20,
      scale: 6.5,
      cfg_rescale: 0.3,
      seed: 42,
      char_captions: [{ char_caption: 'girl, silver hair', centers: [{ x: 0.3, y: 0.5 }] }],
    });

    await client.generate({
      prompt: '1girl',
      aspectRatio: '1:1',
      steps: 28,
      scale: 5.0,
      cfgRescale: 0,
    });
    const body3 = JSON.parse(String(fetchSpy.mock.calls[2]?.[1]?.body)) as Record<string, unknown>;
    expect('cfg_rescale' in body3).toBe(false);
    expect('use_coords' in body3).toBe(false);

    await client.generate({
      prompt: '2girls, rooftop',
      aspectRatio: '3:2',
      steps: 28,
      scale: 5.0,
      useCoords: true,
      charCaptions: [
        {
          char_caption: 'girl, silver hair, white dress',
          uc: 'glasses, hat',
          centers: [{ x: 0.25, y: 0.5 }],
        },
        {
          char_caption: 'girl, black hair, school uniform',
          centers: [{ x: 0.75, y: 0.5 }],
        },
      ],
    });
    const body4 = JSON.parse(String(fetchSpy.mock.calls[3]?.[1]?.body)) as Record<string, unknown>;
    expect(body4['use_coords']).toBe(true);
    expect(body4['char_captions']).toEqual([
      {
        char_caption: 'girl, silver hair, white dress',
        uc: 'glasses, hat',
        centers: [{ x: 0.25, y: 0.5 }],
      },
      {
        char_caption: 'girl, black hair, school uniform',
        centers: [{ x: 0.75, y: 0.5 }],
      },
    ]);
  });

  it('supports URL fallback download and retries transient 5xx/429 while failing fast on 400/401', async () => {
    let callCount = 0;
    const fetchUrlFallback = vi.fn(async (url: string | URL | Request) => {
      callCount++;
      const urlStr = String(url);
      if (urlStr.endsWith('/images/generations')) {
        if (callCount === 1) {
          return new Response('rate limited', { status: 429 });
        }
        if (callCount === 2) {
          return new Response('upstream err', { status: 502 });
        }
        return new Response(
          JSON.stringify({ data: [{ url: 'https://cdn.example.com/out.png' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(TINY_PNG_BYTES, { status: 200, headers: { 'Content-Type': 'image/png' } });
    });

    const client = new ImageClient(
      {
        baseUrl: 'https://img.example.com/v1',
        apiKey: 'sk-img',
        model: 'nai/nai-diffusion-5-full',
        timeoutMs: 30_000,
        maxRetries: 2,
      },
      { fetchFn: fetchUrlFallback as unknown as typeof fetch, sleepFn: async () => undefined },
    );

    const ok = await client.generate({
      prompt: 'landscape',
      aspectRatio: '1:1',
      steps: 28,
      scale: 5.0,
    });
    expect(ok.attempts).toBe(3);
    expect(ok.buffer.equals(TINY_PNG_BYTES)).toBe(true);

    const badReqClient = new ImageClient(
      {
        baseUrl: 'https://img.example.com/v1',
        apiKey: 'sk-img',
        model: 'nai/nai-diffusion-5-full',
        timeoutMs: 30_000,
        maxRetries: 3,
      },
      {
        fetchFn: (async () => new Response('bad prompt', { status: 400 })) as unknown as typeof fetch,
        sleepFn: async () => undefined,
      },
    );
    await expect(
      badReqClient.generate({ prompt: 'bad', aspectRatio: '1:1', steps: 28, scale: 5 }),
    ).rejects.toMatchObject({ code: 'bad_request', attempts: 1 });

    const authClient = new ImageClient(
      {
        baseUrl: 'https://img.example.com/v1',
        apiKey: 'sk-bad',
        model: 'nai/nai-diffusion-5-full',
        timeoutMs: 30_000,
        maxRetries: 3,
      },
      {
        fetchFn: (async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch,
        sleepFn: async () => undefined,
      },
    );
    await expect(
      authClient.generate({ prompt: 'test', aspectRatio: '1:1', steps: 28, scale: 5 }),
    ).rejects.toBeInstanceOf(ImageApiError);
  });

  it('attaches ASCII-safe URL-encoded X-Gallery-* attribution headers and X-Gallery-Skip on private draws', async () => {
    const capturedHeaders: Array<Record<string, string>> = [];
    const fetchSpy = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new ImageClient(
      {
        baseUrl: 'https://img.example.com/v1',
        apiKey: 'sk-img',
        model: 'nai/nai-diffusion-5-full',
        timeoutMs: 30_000,
        maxRetries: 1,
        galleryUrl: 'https://gallery.example.com',
      },
      { fetchFn: fetchSpy as unknown as typeof fetch, sleepFn: async () => undefined },
    );

    expect(client.getGalleryUrl()).toBe('https://gallery.example.com');

    await client.generate({
      prompt: 'nsfw, 1girl',
      aspectRatio: '2:3',
      steps: 28,
      scale: 5.0,
      galleryMeta: {
        source: 'discord-draw',
        authorId: '1001',
        authorName: '小虎画师',
        rawPrompt: '1girl, 银发',
      },
    });
    expect(capturedHeaders[0]?.['X-Gallery-Source']).toBe('discord-draw');
    expect(capturedHeaders[0]?.['X-Gallery-Author-Id']).toBe('1001');
    expect(decodeURIComponent(capturedHeaders[0]?.['X-Gallery-Author-Name'] ?? '')).toBe('小虎画师');
    expect(decodeURIComponent(capturedHeaders[0]?.['X-Gallery-Raw-Prompt'] ?? '')).toBe('1girl, 银发');
    expect(capturedHeaders[0]?.['X-Gallery-Skip']).toBeUndefined();

    await client.generate({
      prompt: 'nsfw, 1girl',
      aspectRatio: '2:3',
      steps: 28,
      scale: 5.0,
      galleryMeta: {
        source: 'discord-draw',
        skip: true,
      },
    });
    expect(capturedHeaders[1]?.['X-Gallery-Skip']).toBe('1');
  });
});

describe('DefaultImagePromptProcessor', () => {
  it('sanitizes fences, nbsp, fullwidth punctuation, and preserves commas inside NAI weight/bracket blocks', () => {
    const raw =
      '```\nnsfw，1girl\u00a0、1.3::breasts, nude::；{silver hair, long hair}\n[looking at viewer, blush]```';
    expect(sanitizeTagSegment(raw)).toBe(
      'nsfw, 1girl, 1.3::breasts, nude::, {silver hair, long hair}, [looking at viewer, blush]',
    );
    expect(
      splitTopLevelTags('1.3::a, b::, {c, d}, [e, f], g'),
    ).toEqual(['1.3::a, b::', '{c, d}', '[e, f]', 'g']);
  });

  it('prepends default nsfw tag, injects -1.5 anti-censor weight when NSFW is active, and respects deduplication & rating overrides', async () => {
    const processor = new DefaultImagePromptProcessor();
    expect(DEFAULT_NAI_POSITIVE_PROMPT).toBe('nsfw');

    const standard = await processor.process({
      rawPrompt: '1girl, mature female',
      userNegativePrompt: '',
      defaultPositivePrompt: DEFAULT_NAI_POSITIVE_PROMPT,
      defaultNegativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
    });
    expect(standard.finalPrompt).toBe(
      'nsfw, 1girl, mature female,\n-1.5::censored, mosaic censoring, bar censor::,',
    );
    expect(standard.finalPrompt).not.toContain('rating:explicit');
    expect(standard.finalNegativePrompt).toContain('2::extra characters, extra fingers,');

    // `uncensored` must NOT prevent `-1.5::censored, mosaic censoring, bar censor::,` injection
    const dedup = await processor.process({
      rawPrompt: 'NSFW, 1girl, uncensored, nude',
      userNegativePrompt: '',
      defaultPositivePrompt: DEFAULT_NAI_POSITIVE_PROMPT,
      defaultNegativePrompt: '',
    });
    expect(dedup.finalPrompt).toBe(
      'nsfw, 1girl, uncensored, nude,\n-1.5::censored, mosaic censoring, bar censor::,',
    );

    // User prompt with nsfw still triggers -1.5 anti-censor even when guild defaultPositivePrompt is empty
    expect(mergePositivePrompts('', '1girl, nsfw, nude')).toBe(
      '1girl, nsfw, nude,\n-1.5::censored, mosaic censoring, bar censor::,',
    );

    // Custom legacy defaultPositivePrompt with rating:explicit still respects rating:questionable
    const questionable = await processor.process({
      rawPrompt: 'rating:questionable, 1girl, lingerie',
      userNegativePrompt: '',
      defaultPositivePrompt: 'nsfw, rating:explicit, uncensored',
      defaultNegativePrompt: '',
    });
    expect(questionable.finalPrompt).toBe(
      'nsfw, uncensored, rating:questionable, 1girl, lingerie,\n-1.5::censored, mosaic censoring, bar censor::,',
    );
    expect(questionable.finalPrompt).not.toContain('rating:explicit');

    // Explicit rating:safe / rating:general skips both nsfw prefix and -1.5 anti-censor suffix
    expect(
      mergePositivePrompts(DEFAULT_NAI_POSITIVE_PROMPT, 'rating:safe, 1girl, school uniform'),
    ).toBe('rating:safe, 1girl, school uniform');
    expect(
      mergePositivePrompts(DEFAULT_NAI_POSITIVE_PROMPT, 'rating:general, scenery, sunset'),
    ).toBe('rating:general, scenery, sunset');
  });

  it('preserves V5 multi-paragraph breaks (\\n\\n), avoids duplicate anti-censor blocks, and keeps Character N action lines at the bottom', async () => {
    const processor = new DefaultImagePromptProcessor();

    const multiParagraphWithoutAntiCensor = [
      '1girl, 1boy, hetero, nsfw, sex, vaginal, warm wood hotel room, soft warm ambient light, pov, cowboy shot,',
      '',
      'The girl presses both palms lightly against a tall sunset-lit window arching her slender back,',
      'Warm golden-amber sunset light wraps softly around her hair and curved spine,',
      '',
      "Character 1: girl, standing sex, from behind, looking back, blushing, target#grabbing another's hip,",
      "Character 2: boy, standing behind, pov, faceless male, source#grabbing another's hip,",
    ].join('\n');

    const res1 = await processor.process({
      rawPrompt: multiParagraphWithoutAntiCensor,
      userNegativePrompt: '',
      defaultPositivePrompt: DEFAULT_NAI_POSITIVE_PROMPT,
      defaultNegativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
    });

    expect(res1.finalPrompt).toBe(
      [
        'nsfw, 1girl, 1boy, hetero, sex, vaginal, warm wood hotel room, soft warm ambient light, pov, cowboy shot,',
        '',
        'The girl presses both palms lightly against a tall sunset-lit window arching her slender back,',
        'Warm golden-amber sunset light wraps softly around her hair and curved spine,',
        '-1.5::censored, mosaic censoring, bar censor::,',
        '',
        "Character 1: girl, standing sex, from behind, looking back, blushing, target#grabbing another's hip,",
        "Character 2: boy, standing behind, pov, faceless male, source#grabbing another's hip,",
      ].join('\n'),
    );

    // Passing a prompt that already contains `-1.5::censored, mosaic censoring, bar censor::,` must be idempotent
    const res2 = await processor.process({
      rawPrompt: res1.finalPrompt,
      userNegativePrompt: '',
      defaultPositivePrompt: DEFAULT_NAI_POSITIVE_PROMPT,
      defaultNegativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
    });
    expect(res2.finalPrompt).toBe(res1.finalPrompt);
    expect(res2.finalPrompt.match(/mosaic censoring/gi)).toHaveLength(1);
  });

  it('auto-strips extra characters from finalNegativePrompt on multi-character and multi-view prompts', async () => {
    const processor = new DefaultImagePromptProcessor();

    // 1. charCaptions.length >= 2 strips `extra characters` from `2::extra characters, extra fingers, ...::`
    const byCharCount = await processor.process({
      rawPrompt: 'rooftop, sunset',
      userNegativePrompt: '',
      defaultPositivePrompt: DEFAULT_NAI_POSITIVE_PROMPT,
      defaultNegativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
      charCaptions: [
        { char_caption: 'girl, silver hair' },
        { char_caption: 'boy, faceless male, pov' },
      ],
    });
    expect(byCharCount.finalNegativePrompt).not.toContain('extra characters');
    expect(byCharCount.finalNegativePrompt.startsWith('2::extra fingers, extra toes,')).toBe(true);

    // 2. Multi-person count/layout tags in base prompt strip `extra characters` even without charCaptions
    for (const multiTagPrompt of [
      '1girl, 1boy, warm hotel room, pov',
      '1boy, 1girl, holding hands',
      '2girls, yuri, bedroom',
      '3boys, campfire',
      '2others, fantasy tavern',
      '1girl, multiple girls, mirror',
      '1boy, multiple boys, locker room',
      '1girl, chibi, multiple views, sticker',
    ]) {
      const res = await processor.process({
        rawPrompt: multiTagPrompt,
        userNegativePrompt: 'extra characters, 2::extra characters::',
        defaultPositivePrompt: DEFAULT_NAI_POSITIVE_PROMPT,
        defaultNegativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
      });
      expect(res.finalNegativePrompt).not.toContain('extra characters');
      expect(res.finalNegativePrompt.startsWith('2::extra fingers, extra toes,')).toBe(true);
    }

    // 3. Solo single-character prompt keeps `extra characters` in UC
    const soloRes = await processor.process({
      rawPrompt: '1girl, solo, warm bedroom',
      userNegativePrompt: '',
      defaultPositivePrompt: DEFAULT_NAI_POSITIVE_PROMPT,
      defaultNegativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
      charCaptions: [{ char_caption: 'girl, silver hair' }],
    });
    expect(soloRes.finalNegativePrompt).toContain('2::extra characters, extra fingers,');
  });

  it('merges default anti-mosaic negative prompt with user negative prompt without duplicates', async () => {
    const processor = new DefaultImagePromptProcessor();

    const merged = await processor.process({
      rawPrompt: '1girl, mature female',
      userNegativePrompt: 'blurry，censored、extra fingers',
      defaultPositivePrompt: DEFAULT_NAI_POSITIVE_PROMPT,
      defaultNegativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
    });

    for (const antiMosaicTag of [
      'censored',
      'mosaic censoring',
      'bar censor',
      'light censor',
      'pointillism censor',
    ]) {
      expect(merged.finalNegativePrompt).toContain(antiMosaicTag);
    }
    expect(merged.finalNegativePrompt).toContain('blurry');
    expect(merged.finalNegativePrompt).toContain('extra fingers');
    expect(merged.finalNegativePrompt.match(/\bcensored\b/gi)).toHaveLength(1);

    const reprocessed = mergeNegativePrompts(
      DEFAULT_NAI_NEGATIVE_PROMPT,
      merged.finalNegativePrompt,
    );
    expect(reprocessed).toBe(merged.finalNegativePrompt);
  });

  it('parses NAI V5 multi-block prompts (preserving inline Character N action lines inside Base Prompt) and dedicated character blocks with coords & UC', async () => {
    expect(parseCoordSpec('0.25, 0.5')).toEqual({ x: 0.25, y: 0.5 });
    expect(parseCoordSpec('(0.8, 0.4)')).toEqual({ x: 0.8, y: 0.4 });
    expect(parseCoordSpec('B3')).toEqual({ x: 0.3, y: 0.5 });
    expect(parseCoordSpec('A1')).toEqual({ x: 0.1, y: 0.1 });
    expect(parseCoordSpec('E5')).toEqual({ x: 0.9, y: 0.9 });
    expect(parseCoordSpec('invalid')).toBeNull();

    const fullNaiV5Paste = [
      'Base Prompt:',
      '',
      '```text',
      '2girls, rooftop, sunset, warm lighting,',
      'The silver-haired girl stands on the left teasing the black-haired girl sitting on the right,',
      '',
      "Character 1: girl, source#teasing, source#hand on another's face, smirk, looking at another,",
      "Character 2: girl, target#teasing, target#hand on another's face, blush, embarrassed,",
      '```',
      '',
      'Character 1 (0.25, 0.5):',
      '',
      '```text',
      'girl, silver hair, long hair, blue eyes,',
      'white sailor collar, pleated skirt,',
      '```',
      '',
      'Character 1 UC:',
      '',
      '```text',
      'glasses, hat',
      '```',
      '',
      'Character 2 @D3:',
      '',
      '```text',
      'girl, black hair, short bob,',
      'black blazer, red ribbon,',
      '```',
      '',
      'Undesired Content:',
      '',
      '```text',
      '2::extra fingers, deformed, ::, blurry',
      '```',
      '',
      '补充:',
      '角色位置：Character 1 左、Character 2 右。',
    ].join('\n');

    const parsed = parseStructuredNaiPrompt(fullNaiV5Paste);
    expect(parsed.hasExplicitCoords).toBe(true);
    expect(parsed.basePrompt).toContain('2girls, rooftop, sunset');
    expect(parsed.basePrompt).toContain("Character 1: girl, source#teasing");
    expect(parsed.basePrompt).toContain("Character 2: girl, target#teasing");
    expect(parsed.basePrompt).not.toContain('补充');
    expect(parsed.charCaptions).toEqual([
      {
        char_caption: 'girl, silver hair, long hair, blue eyes, white sailor collar, pleated skirt',
        uc: 'glasses, hat',
        centers: [{ x: 0.25, y: 0.5 }],
      },
      {
        char_caption: 'girl, black hair, short bob, black blazer, red ribbon',
        centers: [{ x: 0.7, y: 0.5 }],
      },
    ]);
    expect(parsed.negativePrompt).toBe('2::extra fingers, deformed, ::, blurry');

    const processor = new DefaultImagePromptProcessor();
    const processed = await processor.process({
      rawPrompt: fullNaiV5Paste,
      userNegativePrompt: 'watermark',
      defaultPositivePrompt: DEFAULT_NAI_POSITIVE_PROMPT,
      defaultNegativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
    });
    expect(processed.finalPrompt.startsWith(`${DEFAULT_NAI_POSITIVE_PROMPT}, 2girls, rooftop`)).toBe(
      true,
    );
    expect(processed.finalPrompt).toContain('-1.5::censored, mosaic censoring, bar censor::,');
    expect(processed.finalPrompt).toContain(
      "\n\nCharacter 1: girl, source#teasing, source#hand on another's face, smirk, looking at another,\nCharacter 2: girl, target#teasing, target#hand on another's face, blush, embarrassed,",
    );
    expect(processed.charCaptions).toEqual(parsed.charCaptions);
    expect(processed.charCaptions?.[0]?.char_caption).not.toContain('nsfw');
    expect(processed.useCoords).toBe(true);
    expect(processed.finalNegativePrompt).not.toContain('extra characters');
    expect(processed.finalNegativePrompt).toContain('2::extra fingers, deformed, ::');
    expect(processed.finalNegativePrompt).toContain('watermark');
    expect(processed.finalNegativePrompt).toContain('mosaic censoring');

    // Compact 4-line unfenced format
    const compact = parseStructuredNaiPrompt(
      [
        'Base Prompt: 2girls, holding hands, beach',
        'Character 1: girl, blonde hair, white bikini',
        'Character 2: girl, pink hair, black bikini | UC: sunglasses',
        'Undesired Content: sunburn',
      ].join('\n'),
    );
    expect(compact.basePrompt).toBe('2girls, holding hands, beach');
    expect(compact.charCaptions).toEqual([
      { char_caption: 'girl, blonde hair, white bikini' },
      { char_caption: 'girl, pink hair, black bikini', uc: 'sunglasses' },
    ]);
    expect(compact.negativePrompt).toBe('sunburn');

    // Dedicated charPrompts parser + lossless round-trip formatting
    const dedicated = parseCharacterPromptsText(
      [
        '@0.3,0.5 girl, silver hair, ahoge,',
        'white dress, frills,',
        'UC: glasses',
        '',
        '@0.7,0.5 boy, black hair,',
        'dark suit,',
      ].join('\n'),
    );
    expect(dedicated.hasExplicitCoords).toBe(true);
    expect(dedicated.charCaptions).toEqual([
      {
        char_caption: 'girl, silver hair, ahoge, white dress, frills',
        uc: 'glasses',
        centers: [{ x: 0.3, y: 0.5 }],
      },
      {
        char_caption: 'boy, black hair, dark suit',
        centers: [{ x: 0.7, y: 0.5 }],
      },
    ]);
    const formatted = formatCharacterPromptsText(dedicated.charCaptions);
    expect(parseCharacterPromptsText(formatted).charCaptions).toEqual(dedicated.charCaptions);
  });
});

describe('ImageService', () => {
  function setupService(opts?: {
    generateFn?: (req: unknown) => Promise<{ buffer: Buffer; model: string; attempts: number }>;
    processor?: ImagePromptProcessor;
    configured?: boolean;
    sleepFn?: (ms: number) => Promise<void>;
    randomDelayMsFn?: () => number;
  }) {
    const db = createDatabase(':memory:');
    const guildConfigRepo = new GuildConfigRepo(db);
    const imageRepo = new ImageRepo(db);
    const generateSpy = vi.fn(
      opts?.generateFn ??
        (async () => ({
          buffer: TINY_PNG_BYTES,
          model: 'nai/nai-diffusion-5-full',
          attempts: 1,
        })),
    );
    const mockClient = {
      isConfigured: () => opts?.configured ?? true,
      getDefaultModel: () => 'nai/nai-diffusion-5-full',
      generate: generateSpy,
    } as unknown as ImageClient;

    const processor: ImagePromptProcessor =
      opts?.processor ?? new DefaultImagePromptProcessor();

    const service = new ImageService(guildConfigRepo, imageRepo, mockClient, processor, {
      ...(opts?.sleepFn ? { sleepFn: opts.sleepFn } : {}),
      ...(opts?.randomDelayMsFn ? { randomDelayMsFn: opts.randomDelayMsFn } : {}),
    });
    return { db, guildConfigRepo, imageRepo, generateSpy, service };
  }

  it('enforces module toggle, channel allow/ignore rules, and cooldown with admin bypass + failure rollback', async () => {
    const { db, guildConfigRepo, imageRepo, generateSpy, service } = setupService();

    const cfg = guildConfigRepo.getOrCreate('g1');
    guildConfigRepo.updateModules('g1', { ...cfg.modules, imageGen: false });
    const disabledRes = await service.generateImage({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      prompt: '1girl',
    });
    expect(disabledRes).toMatchObject({ ok: false, errorCode: 'module_disabled' });

    guildConfigRepo.updateModules('g1', { ...cfg.modules, imageGen: true });
    guildConfigRepo.updateImageGen('g1', {
      ...cfg.imageGen,
      allowedChannelIds: ['allowed-ch'],
      cooldownSec: 30,
    });
    const wrongChanRes = await service.generateImage({
      guildId: 'g1',
      channelId: 'other-ch',
      userId: 'u1',
      prompt: '1girl',
    });
    expect(wrongChanRes).toMatchObject({ ok: false, errorCode: 'channel_not_allowed' });

    const okRes = await service.generateImage({
      guildId: 'g1',
      channelId: 'allowed-ch',
      userId: 'u1',
      prompt: '1girl, mature female',
      steps: 40,
    });
    expect(okRes.ok).toBe(true);
    expect(generateSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: `${DEFAULT_NAI_POSITIVE_PROMPT}, 1girl, mature female,\n-1.5::censored, mosaic censoring, bar censor::,`,
        negativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
        steps: 28,
        cfgRescale: 0,
      }),
    );
    if (okRes.ok) {
      expect(okRes.record.status).toBe('ok');
      expect(okRes.record.steps).toBe(28);
      expect(imageRepo.getById(okRes.record.id)?.rawPrompt).toBe('1girl, mature female');
    }

    const cdRes = await service.generateImage({
      guildId: 'g1',
      channelId: 'allowed-ch',
      userId: 'u1',
      prompt: '1girl',
    });
    expect(cdRes).toMatchObject({ ok: false, errorCode: 'cooldown' });

    const adminRes = await service.generateImage({
      guildId: 'g1',
      channelId: 'allowed-ch',
      userId: 'u1',
      prompt: '1girl',
      isAdmin: true,
    });
    expect(adminRes.ok).toBe(true);

    // Rollback cooldown when upstream fails
    generateSpy.mockRejectedValueOnce(
      new ImageApiError({
        code: 'timeout',
        message: 'timed out',
        userMessage: '生图请求超时',
        attempts: 1,
      }),
    );
    const failRes = await service.generateImage({
      guildId: 'g1',
      channelId: 'allowed-ch',
      userId: 'u2',
      prompt: '1girl',
    });
    expect(failRes).toMatchObject({ ok: false, errorCode: 'timeout' });

    const retryRes = await service.generateImage({
      guildId: 'g1',
      channelId: 'allowed-ch',
      userId: 'u2',
      prompt: '1girl',
    });
    expect(retryRes.ok).toBe(true);

    db.close();
  });

  it('enforces maxConcurrency and rejects overflow beyond maxPendingQueue, and supports custom prompt processors', async () => {
    let active = 0;
    let maxObserved = 0;
    const resolvers: Array<() => void> = [];

    const { db, guildConfigRepo, service } = setupService({
      generateFn: () =>
        new Promise((resolve) => {
          active++;
          maxObserved = Math.max(maxObserved, active);
          resolvers.push(() => {
            active--;
            resolve({
              buffer: TINY_PNG_BYTES,
              model: 'nai/nai-diffusion-5-full',
              attempts: 1,
            });
          });
        }),
    });

    const cfg = guildConfigRepo.getOrCreate('g1');
    guildConfigRepo.updateImageGen('g1', {
      ...cfg.imageGen,
      cooldownSec: 0,
      maxConcurrency: 1,
      maxPendingQueue: 1,
    });

    service.setPromptProcessor({
      process: async (input) => ({
        finalPrompt: `${input.rawPrompt}, masterpiece`,
        finalNegativePrompt: 'worst quality',
      }),
    });

    const p1 = service.generateImage({ guildId: 'g1', channelId: 'c1', userId: 'u1', prompt: 'p1' });
    const p2 = service.generateImage({ guildId: 'g1', channelId: 'c1', userId: 'u2', prompt: 'p2' });
    const p3 = service.generateImage({ guildId: 'g1', channelId: 'c1', userId: 'u3', prompt: 'p3' });

    await Promise.resolve();
    const res3 = await p3;
    expect(res3).toMatchObject({ ok: false, errorCode: 'queue_full' });
    expect(maxObserved).toBe(1);

    resolvers.shift()?.();
    await new Promise((r) => setTimeout(r, 10));
    resolvers.shift()?.();

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    if (res1.ok) {
      expect(res1.record.finalPrompt).toBe('p1, masterpiece');
      expect(res1.record.negativePrompt).toBe('worst quality');
    }

    db.close();
  });

  it('persists user preferences, falls back cleanly during generation, and omits negativePrompt when guild defaults are cleared', async () => {
    const { db, guildConfigRepo, generateSpy, service } = setupService();
    const cfg = guildConfigRepo.getOrCreate('g1');
    guildConfigRepo.updateImageGen('g1', {
      ...cfg.imageGen,
      cooldownSec: 30,
      defaultPositivePrompt: '',
      defaultNegativePrompt: '',
    });

    service.updateUserPrefs('g1', 'u1', {
      aspectRatio: '16:9',
      steps: 24,
      scale: 6.5,
      negativePrompt: 'blurry',
      spoiler: true,
      ephemeral: true,
    });
    expect(service.getUserCooldownRemainingSec('g1', 'u1')).toBe(0);

    const resPref = await service.generateImage({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      prompt: '1girl, sakura',
    });
    expect(resPref.ok).toBe(true);
    expect(generateSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        aspectRatio: '16:9',
        steps: 24,
        scale: 6.5,
        negativePrompt: 'blurry',
      }),
    );
    if (resPref.ok) {
      expect(resPref.record.spoiler).toBe(true);
      expect(resPref.record.ephemeral).toBe(true);
    }
    expect(service.getUserCooldownRemainingSec('g1', 'u1')).toBeGreaterThan(0);
    expect(service.getUserCooldownRemainingSec('g1', 'u1', true)).toBe(0);
    expect(service.listUserRecent('g1', 'u1', 10)).toHaveLength(1);

    // Explicit negativePrompt: '' overrides saved userPref.negativePrompt when guild defaults are empty
    const resOverride = await service.generateImage({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      prompt: '1boy',
      aspectRatio: '1:1',
      negativePrompt: '',
      steps: 18,
      scale: 4.5,
      spoiler: false,
      ephemeral: false,
      isAdmin: true,
    });
    expect(resOverride.ok).toBe(true);
    expect(generateSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        aspectRatio: '1:1',
        steps: 18,
        scale: 4.5,
        negativePrompt: undefined,
      }),
    );
    if (resOverride.ok) {
      expect(resOverride.record.spoiler).toBe(false);
      expect(resOverride.record.ephemeral).toBe(false);
    }

    service.resetUserPrefs('g1', 'u1');
    expect(service.getUserPrefs('g1', 'u1').aspectRatio).toBeNull();

    db.close();
  });

  it('runs serial batch generation with anti-risk pauses, incremented seeds, progress callbacks, partial success, and total failure rollback', async () => {
    let active = 0;
    let maxObserved = 0;
    const sleepSpy = vi.fn(async (_ms: number) => undefined);
    const randomDelayMsFn = vi.fn(() => 1750);
    const progressCalls: Array<[number, number]> = [];

    const { db, guildConfigRepo, imageRepo, generateSpy, service } = setupService({
      sleepFn: sleepSpy,
      randomDelayMsFn,
      generateFn: async () => {
        active++;
        maxObserved = Math.max(maxObserved, active);
        await Promise.resolve();
        active--;
        return {
          buffer: TINY_PNG_BYTES,
          model: 'nai/nai-diffusion-5-full',
          attempts: 1,
        };
      },
    });

    const cfg = guildConfigRepo.getOrCreate('g1');
    guildConfigRepo.updateImageGen('g1', { ...cfg.imageGen, cooldownSec: 30 });

    // 1. Batch count=3 with fixed seed=100
    const batchRes = await service.generateBatch({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u-batch',
      prompt: '1girl, mature female',
      seed: 100,
      count: 3,
      onProgress: (completed, total) => {
        progressCalls.push([completed, total]);
      },
    });
    expect(batchRes.ok).toBe(true);
    expect(maxObserved).toBe(1);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
    for (const call of sleepSpy.mock.calls) {
      expect(call[0]).toBeGreaterThanOrEqual(1000);
      expect(call[0]).toBeLessThanOrEqual(3000);
    }
    expect(progressCalls).toEqual([
      [1, 3],
      [2, 3],
    ]);
    expect(generateSpy.mock.calls.map((c) => (c[0] as { seed?: number }).seed)).toEqual([
      100,
      101,
      102,
    ]);
    if (batchRes.ok) {
      expect(batchRes.items).toHaveLength(3);
      expect(batchRes.requestedCount).toBe(3);
      expect(batchRes.failedCount).toBe(0);
    }
    expect(imageRepo.listRecent('g1', 10)).toHaveLength(3);

    // 2. Uses saved userPrefs.batchCount when input.count is omitted
    service.updateUserPrefs('g1', 'u-pref-batch', { batchCount: 2 });
    const prefBatchRes = await service.generateBatch({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u-pref-batch',
      prompt: '1girl, mature female',
    });
    expect(prefBatchRes.ok).toBe(true);
    if (prefBatchRes.ok) {
      expect(prefBatchRes.items).toHaveLength(2);
      expect(prefBatchRes.requestedCount).toBe(2);
    }

    // 3. Partial failure preserves succeeded items
    let stepIdx = 0;
    generateSpy.mockImplementation(async () => {
      stepIdx++;
      if (stepIdx === 3) {
        throw new ImageApiError({
          code: 'timeout',
          message: 'timeout on #3',
          userMessage: '生图请求超时，请稍后重试。',
          attempts: 1,
        });
      }
      return {
        buffer: TINY_PNG_BYTES,
        model: 'nai/nai-diffusion-5-full',
        attempts: 1,
      };
    });
    const partialRes = await service.generateBatch({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u-partial',
      prompt: '1girl, mature female',
      count: 3,
    });
    expect(partialRes.ok).toBe(true);
    if (partialRes.ok) {
      expect(partialRes.items).toHaveLength(2);
      expect(partialRes.requestedCount).toBe(3);
      expect(partialRes.failedCount).toBe(1);
    }

    // 4. Total failure rolls back user cooldown
    generateSpy.mockRejectedValue(
      new ImageApiError({
        code: 'service_unavailable',
        message: 'upstream down',
        userMessage: '生图服务暂时不可用',
        attempts: 1,
      }),
    );
    const totalFailRes = await service.generateBatch({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u-fail',
      prompt: '1girl, mature female',
      count: 2,
    });
    expect(totalFailRes).toMatchObject({ ok: false, errorCode: 'service_unavailable' });
    expect(service.getUserCooldownRemainingSec('g1', 'u-fail')).toBe(0);

    db.close();
  });

  it('forwards galleryMeta for public draw, private skip, and OC selfie', async () => {
    const { db, guildConfigRepo, generateSpy, service } = setupService();
    const cfg = guildConfigRepo.getOrCreate('g1');
    guildConfigRepo.updateImageGen('g1', { ...cfg.imageGen, cooldownSec: 0 });
    guildConfigRepo.updateAi('g1', {
      ...cfg.ai,
      selfie: { ...cfg.ai.selfie, enabled: true, cooldownSec: 0 },
    });

    await service.generateImage({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u-pub',
      authorName: '群友甲',
      prompt: '1girl, beach',
      ephemeral: false,
    });
    expect(generateSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        galleryMeta: expect.objectContaining({
          source: 'discord-draw',
          authorId: 'u-pub',
          authorName: '群友甲',
          rawPrompt: '1girl, beach',
          skip: false,
        }),
      }),
    );

    await service.generateImage({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u-priv',
      prompt: '1girl, secret',
      ephemeral: true,
    });
    expect(generateSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        galleryMeta: expect.objectContaining({
          source: 'discord-draw',
          skip: true,
        }),
      }),
    );

    await service.generateOcSelfie({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u-selfie',
      authorName: '白虎姬',
      prompt: '1girl, tiger ears',
      negativePrompt: 'lowres',
      charCaptions: [{ char_caption: 'girl, white hair' }],
      aspectRatio: '2:3',
    });
    expect(generateSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        galleryMeta: expect.objectContaining({
          source: 'discord-selfie',
          authorId: 'u-selfie',
          authorName: '白虎姬',
          skip: false,
        }),
      }),
    );

    db.close();
  });
});
