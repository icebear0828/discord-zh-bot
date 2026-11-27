import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type APIModalInteractionResponseCallbackData,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { aiCommand, formatMemoryListDescription } from '../../src/commands/ai/ai.js';
import { DEFAULT_AI_CONFIG, DEFAULT_NAI_NEGATIVE_PROMPT } from '../../src/config/defaults.js';
import type { AppContext } from '../../src/core/context.js';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ImageRepo } from '../../src/db/repositories/imageRepo.js';
import {
  tryHandleAiMenuButton,
  tryHandleAiMenuChannelSelect,
  tryHandleAiMenuModal,
  tryHandleAiMenuStringSelect,
  tryHandleAiMenuUserSelect,
} from '../../src/interactions/aiMenuHandler.js';
import { tryHandleAiMenuButton as subAiMenuButton } from '../../src/interactions/aiMenu/aiButtons.js';
import {
  tryHandleAiMenuChannelSelect as subAiMenuChannelSelect,
  tryHandleAiMenuUserSelect as subAiMenuUserSelect,
} from '../../src/interactions/aiMenu/aiChannelAndUserSelects.js';
import { buildAiParamsModal, buildAiPersonaModal } from '../../src/interactions/aiMenu/aiModals.js';
import { tryHandleAiMenuModal as subAiMenuModal } from '../../src/interactions/aiMenu/aiModalSubmits.js';
import { tryHandleAiMenuStringSelect as subAiMenuStringSelect } from '../../src/interactions/aiMenu/aiStringSelects.js';
import {
  executeAndReplyImageBatch,
  handleImageButton,
  handleImageModal,
  handleImageStringSelect,
  tryHandleAdminImageButton,
  tryHandleAdminImageChannelSelect,
  tryHandleAdminImageModal,
} from '../../src/interactions/imageHandler.js';
import {
  tryHandleAdminImageButton as subAdminImgBtn,
  tryHandleAdminImageChannelSelect as subAdminImgChan,
  tryHandleAdminImageModal as subAdminImgModal,
} from '../../src/interactions/image/imageAdminHandlers.js';
import { executeAndReplyImageBatch as subBatchReplyRunner } from '../../src/interactions/image/imageBatchReplyRunner.js';
import { buildCreateImageModal, buildEditImageModal } from '../../src/interactions/image/imageModals.js';
import {
  handleImageButton as subImageBtn,
  handleImageStringSelect as subImageStrSelect,
} from '../../src/interactions/image/imageUserButtonsAndSelects.js';
import { handleImageModal as subImageModal } from '../../src/interactions/image/imageUserModalSubmits.js';
import { ImageApiError, ImageClient } from '../../src/services/imageClient.js';
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
  stripExtraCharactersFromNegative,
} from '../../src/services/imagePromptProcessor.js';
import {
  formatCharacterPromptsText as subFormatChars,
  parseCharacterPromptsText as subParseChars,
} from '../../src/services/image/prompt/naiCharacterBlockParser.js';
import {
  mergeNegativePrompts as subMergeNeg,
  mergePositivePrompts as subMergePos,
  stripExtraCharactersFromNegative as subStripExtra,
} from '../../src/services/image/prompt/naiPromptMerger.js';
import { parseStructuredNaiPrompt as subParseStructured } from '../../src/services/image/prompt/naiStructuredParser.js';
import {
  parseCoordSpec as subParseCoord,
  sanitizeTagSegment as subSanitizeSegment,
  splitTopLevelTags as subSplitTags,
} from '../../src/services/image/prompt/naiTagTokenizer.js';
import { ImageCooldownAndQueue } from '../../src/services/image/imageCooldownAndQueue.js';
import { isValidImageAspectRatio as subIsValidRatio } from '../../src/services/image/imageTypes.js';
import { ImageService, isValidImageAspectRatio } from '../../src/services/imageService.js';

describe('ai-image split: NAI prompt tokenizer, parsers & merger', () => {
  it('re-exports identical functions from imagePromptProcessor facade and prompt sub-modules', () => {
    expect(splitTopLevelTags).toBe(subSplitTags);
    expect(sanitizeTagSegment).toBe(subSanitizeSegment);
    expect(parseCoordSpec).toBe(subParseCoord);
    expect(parseCharacterPromptsText).toBe(subParseChars);
    expect(formatCharacterPromptsText).toBe(subFormatChars);
    expect(parseStructuredNaiPrompt).toBe(subParseStructured);
    expect(mergePositivePrompts).toBe(subMergePos);
    expect(mergeNegativePrompts).toBe(subMergeNeg);
    expect(stripExtraCharactersFromNegative).toBe(subStripExtra);
  });

  it('tokenizes top-level tags while preserving commas in weight/brace/bracket/paren blocks', () => {
    const raw = '1girl, 1.3::silver hair, red eyes::, {detailed, lighting}, [blur, noise], (soft, glow)';
    expect(splitTopLevelTags(raw)).toEqual([
      '1girl',
      '1.3::silver hair, red eyes::',
      '{detailed, lighting}',
      '[blur, noise]',
      '(soft, glow)',
    ]);
    expect(sanitizeTagSegment('```tags\n1girl，solo、night\u00a0sky\n```')).toBe(
      '1girl, solo, night sky',
    );
  });

  it('parses NAI 5x5 grid & normalized coords and round-trips character blocks', () => {
    expect(parseCoordSpec('@B3')).toEqual({ x: 0.3, y: 0.5 });
    expect(parseCoordSpec('(0.25, 0.75)')).toEqual({ x: 0.25, y: 0.75 });
    expect(parseCoordSpec('Z9')).toBeNull();
    expect(parseCoordSpec('1.5, 0.5')).toBeNull();

    const parsed = parseCharacterPromptsText(
      [
        'Character 1 @B3:',
        'girl, silver hair, white dress',
        'UC: lowres, hat',
        'Character 2 (0.7, 0.5):',
        'boy, dark coat | UC: blurry',
      ].join('\n'),
    );
    expect(parsed.hasExplicitCoords).toBe(true);
    expect(parsed.charCaptions).toEqual([
      {
        char_caption: 'girl, silver hair, white dress',
        uc: 'lowres, hat',
        centers: [{ x: 0.3, y: 0.5 }],
      },
      {
        char_caption: 'boy, dark coat',
        uc: 'blurry',
        centers: [{ x: 0.7, y: 0.5 }],
      },
    ]);

    const formatted = formatCharacterPromptsText(parsed.charCaptions);
    expect(parseCharacterPromptsText(formatted)).toEqual(parsed);
  });

  it('parses multi-section structured NAI prompts and strips extra characters for multi-char', async () => {
    const raw = [
      'Base Prompt:',
      '1girl, 1boy, sunset beach',
      'Character 1: girl, source#hug',
      '',
      'Character 1 @B3:',
      'girl, white sundress',
      'Character 1 UC: hat',
      '',
      'Character 2 @D3:',
      'boy, summer shirt',
      '',
      'Undesired Content: watermark, signature',
      '补充: 忽略备注行',
    ].join('\n');

    const structured = parseStructuredNaiPrompt(raw);
    expect(structured.charCaptions).toHaveLength(2);
    expect(structured.hasExplicitCoords).toBe(true);
    expect(structured.negativePrompt).toBe('watermark, signature');
    expect(structured.basePrompt).not.toContain('忽略备注行');

    const processor = new DefaultImagePromptProcessor();
    const out = await processor.process({
      rawPrompt: raw,
      userNegativePrompt: '',
      defaultPositivePrompt: 'nsfw',
      defaultNegativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
    });
    expect(out.finalPrompt).toContain('nsfw');
    expect(out.finalPrompt).toContain('-1.5::censored, mosaic censoring, bar censor::,');
    expect(out.finalPrompt).toContain('Character 1: girl, source#hug,');
    expect(out.finalNegativePrompt.toLowerCase()).not.toContain('extra characters');
    expect(out.useCoords).toBe(true);
  });

  it('skips NSFW injection when user explicitly sets rating:safe and cleans extra characters inside weight blocks', () => {
    const safeMerged = mergePositivePrompts('nsfw, uncensored', 'rating:safe, 1girl, smile');
    expect(safeMerged).not.toContain('nsfw');
    expect(safeMerged).not.toContain('-1.5::censored');

    expect(
      stripExtraCharactersFromNegative('2::extra characters, bad hands::, extra characters, {extra characters}'),
    ).toBe('2::bad hands::');
  });
});

describe('ai-image split: cooldown, queue & ImageService facade', () => {
  it('enforces cooldown for non-admins, bypasses for admins, and supports rollback & FIFO queue limits', async () => {
    expect(isValidImageAspectRatio).toBe(subIsValidRatio);
    const scheduler = new ImageCooldownAndQueue();

    const now = 10_000;
    scheduler.recordDrawRun('g1:u1', now, 60_000);
    expect(scheduler.getUserCooldownRemainingSec('g1', 'u1', 15, false, now + 4_000)).toBe(11);
    expect(scheduler.getUserCooldownRemainingSec('g1', 'u1', 15, true, now + 4_000)).toBe(0);

    scheduler.rollbackDrawCooldown('g1:u1', now, undefined);
    expect(scheduler.getUserCooldownRemainingSec('g1', 'u1', 15, false, now + 4_000)).toBe(0);

    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });

    const p1 = new Promise<void>((resolve) => {
      scheduler.enqueue(1, async () => {
        order.push('start-1');
        await firstGate;
        order.push('end-1');
        resolve();
      });
    });
    const p2 = new Promise<void>((resolve) => {
      scheduler.enqueue(1, async () => {
        order.push('start-2');
        order.push('end-2');
        resolve();
      });
    });

    expect(scheduler.getQueueSnapshot()).toEqual({ running: 1, pending: 1 });
    expect(scheduler.checkQueueCapacity(1, 1).ok).toBe(false);

    releaseFirst();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
    expect(scheduler.getQueueSnapshot()).toEqual({ running: 0, pending: 0 });
  });

  it('rolls back cooldown in ImageService when all items in a batch fail', async () => {
    const db = createDatabase(':memory:');
    const guildConfig = new GuildConfigRepo(db);
    const imageRepo = new ImageRepo(db);
    const mockClient = {
      isConfigured: () => true,
      getDefaultModel: () => 'nai/nai-diffusion-5-full',
      generate: vi.fn(async () => {
        throw new ImageApiError({
          code: 'upstream_error',
          attempts: 1,
          message: 'boom',
          userMessage: '生图上游失败',
        });
      }),
    } as unknown as ImageClient;

    const svc = new ImageService(guildConfig, imageRepo, mockClient, undefined, {
      sleepFn: async () => undefined,
    });

    const res = await svc.generateBatch({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      prompt: '1girl',
      count: 1,
    });
    expect(res.ok).toBe(false);
    expect(svc.getUserCooldownRemainingSec('g1', 'u1', false)).toBe(0);
    db.close();
  });
});

describe('ai-image split: handler facades, gotchas & /ai schema compatibility', () => {
  it('re-exports all aiMenuHandler and imageHandler entrypoints cleanly', () => {
    expect(tryHandleAiMenuButton).toBe(subAiMenuButton);
    expect(tryHandleAiMenuStringSelect).toBe(subAiMenuStringSelect);
    expect(tryHandleAiMenuChannelSelect).toBe(subAiMenuChannelSelect);
    expect(tryHandleAiMenuUserSelect).toBe(subAiMenuUserSelect);
    expect(tryHandleAiMenuModal).toBe(subAiMenuModal);

    expect(executeAndReplyImageBatch).toBe(subBatchReplyRunner);
    expect(handleImageButton).toBe(subImageBtn);
    expect(handleImageStringSelect).toBe(subImageStrSelect);
    expect(handleImageModal).toBe(subImageModal);
    expect(tryHandleAdminImageButton).toBe(subAdminImgBtn);
    expect(tryHandleAdminImageModal).toBe(subAdminImgModal);
    expect(tryHandleAdminImageChannelSelect).toBe(subAdminImgChan);
  });

  it('keeps Modal titles and TextInput labels within 45 chars and preserves AI params placeholder', () => {
    const aiParams = buildAiParamsModal(
      DEFAULT_AI_CONFIG,
      'paid/gemini-4-argon',
      'paid/gemini-4-carbon',
    ).toJSON() as APIModalInteractionResponseCallbackData;
    const aiPersona = buildAiPersonaModal(DEFAULT_AI_CONFIG).toJSON() as APIModalInteractionResponseCallbackData;
    const createImg = buildCreateImageModal({
      ratio: '2:3',
      steps: 28,
      scale: 5,
      batchCount: 2,
      negativePrompt: '',
      ephemeral: false,
    }).toJSON() as APIModalInteractionResponseCallbackData;
    const editImg = buildEditImageModal(
      {
        id: 7,
        guildId: 'g1',
        channelId: 'c1',
        userId: 'u1',
        rawPrompt: '1girl',
        finalPrompt: 'nsfw, 1girl',
        negativePrompt: '',
        charCaptions: [],
        useCoords: false,
        aspectRatio: '2:3',
        steps: 28,
        scale: 5,
        seed: null,
        spoiler: false,
        ephemeral: false,
        model: 'nai/nai-diffusion-5-full',
        status: 'ok',
        errorCode: null,
        latencyMs: 100,
        createdAt: Date.now(),
      },
      2,
    ).toJSON() as APIModalInteractionResponseCallbackData;

    for (const modal of [aiParams, aiPersona, createImg, editImg]) {
      expect(modal.title.length).toBeLessThanOrEqual(45);
      for (const row of modal.components) {
        for (const comp of row.components) {
          if ('label' in comp && typeof comp.label === 'string') {
            expect(comp.label.length).toBeLessThanOrEqual(45);
          }
        }
      }
    }

    const modelInput = aiParams.components[0]?.components[0];
    expect(modelInput && 'placeholder' in modelInput ? modelInput.placeholder : '').toContain(
      '默认: paid/gemini-4-argon | 兜底: paid/gemini-4-carbon',
    );
  });

  it('runs precheckRequest synchronously before deferReply on img:reroll cooldown failure', async () => {
    const db = createDatabase(':memory:');
    const guildConfig = new GuildConfigRepo(db);
    const imageRepo = new ImageRepo(db);
    const rec = imageRepo.create({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      rawPrompt: '1girl',
      finalPrompt: 'nsfw, 1girl',
      negativePrompt: '',
      charCaptions: [],
      useCoords: false,
      aspectRatio: '2:3',
      steps: 28,
      scale: 5,
      seed: null,
      spoiler: false,
      ephemeral: false,
      model: 'nai/nai-diffusion-5-full',
      status: 'ok',
      errorCode: null,
      latencyMs: 100,
    });

    const mockClient = {
      isConfigured: () => true,
      getDefaultModel: () => 'nai/nai-diffusion-5-full',
      generate: vi.fn(),
    } as unknown as ImageClient;
    const imageService = new ImageService(guildConfig, imageRepo, mockClient);
    // Disable module's channel to trigger precheck failure before deferReply
    const cfg = guildConfig.getOrCreate('g1');
    guildConfig.updateImageGen('g1', { ...cfg.imageGen, ignoredChannelIds: ['c1'] });

    const reply = vi.fn(async () => undefined);
    const deferReply = vi.fn(async () => undefined);
    const interaction = {
      guildId: 'g1',
      channelId: 'c1',
      customId: `img:reroll:${rec.id}`,
      inCachedGuild: () => true,
      user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
      member: {
        id: 'u1',
        displayName: 'Alice',
        permissions: { has: (bit: bigint) => bit === PermissionFlagsBits.SendMessages },
        roles: { cache: new Map<string, { id: string }>() },
      },
      reply,
      deferReply,
    } as unknown as ButtonInteraction;

    const ctx = {
      db,
      timezone: 'Asia/Shanghai',
      repos: { guildConfig, image: imageRepo },
      services: { image: imageService },
    } as unknown as AppContext;

    await handleImageButton(interaction, ctx);
    expect(deferReply).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(1);
    const arg = (reply.mock.calls as unknown[][])[0]?.[0] as { flags?: number };
    expect(arg.flags).toBe(MessageFlags.Ephemeral);
    db.close();
  });

  it('preserves /ai slash command top-level groups/subcommands and formatMemoryListDescription', () => {
    const json = aiCommand.data.toJSON() as {
      name: string;
      options: Array<{ name: string; options?: Array<{ name: string }> }>;
    };
    expect(json.name).toBe('ai');
    expect(json.options.map((o) => o.name)).toEqual([
      'reset',
      'memory',
      'regex',
      'usage',
      'profile',
      'preset',
      'card',
      'debug',
    ]);

    expect(formatMemoryListDescription([])).toBe('当前作用域下暂无记忆条目。');
    const desc = formatMemoryListDescription(
      [
        {
          id: 1,
          guildId: 'g1',
          scopeType: 'user',
          scopeId: 'u1',
          category: 'pref',
          content: 'A'.repeat(60),
          createdBy: 'u1',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 2,
          guildId: 'g1',
          scopeType: 'user',
          scopeId: 'u1',
          category: 'pref',
          content: 'B'.repeat(60),
          createdBy: 'u1',
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      110,
    );
    expect(desc).toContain('另有 1 条记忆因长度限制已省略');
    expect(desc.length).toBeLessThanOrEqual(110);
  });
});
