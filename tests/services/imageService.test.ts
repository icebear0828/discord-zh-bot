import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ImageRepo } from '../../src/db/repositories/imageRepo.js';
import {
  ImageApiError,
  ImageClient,
  resolveImagesGenerationsUrl,
} from '../../src/services/imageClient.js';
import {
  containsCjkText,
  LiteralTranslationPromptProcessor,
  type ImagePromptProcessor,
} from '../../src/services/imagePromptProcessor.js';
import { ImageService } from '../../src/services/imageService.js';
import { LlmClient } from '../../src/services/llmClient.js';

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

  it('sends expected JSON payload (omitting empty negative_prompt/seed) and decodes b64_json', async () => {
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

    await client.generate({
      prompt: '1girl',
      negativePrompt: 'lowres, bad hands',
      aspectRatio: '3:2',
      steps: 20,
      scale: 6.5,
      seed: 42,
    });
    const body2 = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(body2).toEqual({
      model: 'nai/nai-diffusion-5-full',
      prompt: '1girl',
      negative_prompt: 'lowres, bad hands',
      aspect_ratio: '3:2',
      steps: 20,
      scale: 6.5,
      seed: 42,
    });
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
});

describe('LiteralTranslationPromptProcessor', () => {
  it('detects CJK, bypasses LLM for pure English, and translates CJK literally while stripping think tags', async () => {
    expect(containsCjkText('1girl, solo, silver hair')).toBe(false);
    expect(containsCjkText('银发少女, solo')).toBe(true);

    const chatSpy = vi.fn(async () => ({
      content: '<think>reasoning</think>"silver hair girl, blue eyes, solo"',
      model: 'pg/gemini-4-carbon',
      attempts: 1,
    }));
    const mockLlm = {
      isConfigured: () => true,
      chat: chatSpy,
    } as unknown as LlmClient;

    const processor = new LiteralTranslationPromptProcessor(mockLlm, 'pg/gemini-4-carbon');

    const enRes = await processor.process({
      rawPrompt: '1girl, solo, silver hair',
      userNegativePrompt: 'bad hands',
      defaultPositivePrompt: 'best quality',
      defaultNegativePrompt: 'lowres',
      translateChinese: true,
      translatorModel: null,
    });
    expect(chatSpy).not.toHaveBeenCalled();
    expect(enRes).toEqual({
      finalPrompt: '1girl, solo, silver hair, best quality',
      finalNegativePrompt: 'lowres, bad hands',
      translated: false,
    });

    const zhRes = await processor.process({
      rawPrompt: '银发蓝瞳少女，独自一人',
      userNegativePrompt: '',
      defaultPositivePrompt: '',
      defaultNegativePrompt: '',
      translateChinese: true,
      translatorModel: null,
    });
    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(zhRes).toEqual({
      finalPrompt: 'silver hair girl, blue eyes, solo',
      finalNegativePrompt: '',
      translated: true,
    });
  });

  it('falls back to rawPrompt gracefully when LLM is unconfigured or errors', async () => {
    const failingLlm = {
      isConfigured: () => true,
      chat: async () => {
        throw new Error('upstream down');
      },
    } as unknown as LlmClient;

    const processor = new LiteralTranslationPromptProcessor(failingLlm, 'pg/gemini-4-carbon');
    const res = await processor.process({
      rawPrompt: '蓝发少女',
      userNegativePrompt: '',
      defaultPositivePrompt: '',
      defaultNegativePrompt: '',
      translateChinese: true,
      translatorModel: null,
    });
    expect(res).toEqual({
      finalPrompt: '蓝发少女',
      finalNegativePrompt: '',
      translated: false,
    });
  });
});

describe('ImageService', () => {
  function setupService(opts?: {
    generateFn?: (req: unknown) => Promise<{ buffer: Buffer; model: string; attempts: number }>;
    processor?: ImagePromptProcessor;
    configured?: boolean;
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
      opts?.processor ?? new LiteralTranslationPromptProcessor(new LlmClient(undefined));

    const service = new ImageService(guildConfigRepo, imageRepo, mockClient, processor);
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
      prompt: '1girl',
    });
    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.record.status).toBe('ok');
      expect(imageRepo.getById(okRes.record.id)?.rawPrompt).toBe('1girl');
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
        translated: false,
      }),
    });

    const p1 = service.generateImage({ guildId: 'g1', channelId: 'c1', userId: 'u1', prompt: 'p1' });
    const p2 = service.generateImage({ guildId: 'g1', channelId: 'c1', userId: 'u2', prompt: 'p2' });
    const p3 = service.generateImage({ guildId: 'g1', channelId: 'c1', userId: 'u3', prompt: 'p3' });

    // Wait a tick for queue checks
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

  it('persists user preferences, falls back cleanly during generation, and lets explicit inputs override', async () => {
    const { db, guildConfigRepo, generateSpy, service } = setupService();
    const cfg = guildConfigRepo.getOrCreate('g1');
    guildConfigRepo.updateImageGen('g1', { ...cfg.imageGen, cooldownSec: 30 });

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

    // Explicit negativePrompt: '' overrides saved userPref.negativePrompt instead of double-appending
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
});
