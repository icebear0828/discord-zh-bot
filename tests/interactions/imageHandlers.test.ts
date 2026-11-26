import {
  MessageFlags,
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIEmbed,
  type APIMessageActionRowComponent,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { drawCommand } from '../../src/commands/ai/draw.js';
import {
  DEFAULT_NAI_NEGATIVE_PROMPT,
  DEFAULT_NAI_POSITIVE_PROMPT,
} from '../../src/config/defaults.js';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ImageRepo } from '../../src/db/repositories/imageRepo.js';
import {
  handleImageButton,
  handleImageModal,
  handleImageStringSelect,
  tryHandleAdminImageButton,
  tryHandleAdminImageChannelSelect,
  tryHandleAdminImageModal,
} from '../../src/interactions/imageHandler.js';
import { routeInteraction } from '../../src/interactions/router.js';
import { ImageClient } from '../../src/services/imageClient.js';
import { DefaultImagePromptProcessor } from '../../src/services/imagePromptProcessor.js';
import { ImageService } from '../../src/services/imageService.js';
import type { AppContext } from '../../src/ui/embeds.js';
import { buildImageBatchResultMessages } from '../../src/ui/imageMenuBuilder.js';
import type { MenuActor } from '../../src/ui/menuShared.js';

const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function makeMember(userId: string, admin = false) {
  return {
    id: userId,
    displayName: `User-${userId}`,
    permissions: {
      has: (bit: bigint) =>
        Boolean(
          admin &&
            (bit === PermissionFlagsBits.Administrator || bit === PermissionFlagsBits.ManageGuild),
        ),
    },
    roles: {
      cache: new Map<string, { id: string }>(),
    },
  };
}

function createImageTestCtx(opts?: {
  generateFn?: (req: unknown) => Promise<{ buffer: Buffer; model: string; attempts: number }>;
}) {
  const db = createDatabase(':memory:');
  const guildConfig = new GuildConfigRepo(db);
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
    isConfigured: () => true,
    getDefaultModel: () => 'nai/nai-diffusion-5-full',
    generate: generateSpy,
  } as unknown as ImageClient;

  const imageService = new ImageService(
    guildConfig,
    imageRepo,
    mockClient,
    new DefaultImagePromptProcessor(),
    { sleepFn: async () => undefined },
  );

  const ctx = {
    db,
    timezone: 'Asia/Shanghai',
    repos: {
      guildConfig,
      image: imageRepo,
    },
    services: {
      image: imageService,
    },
  } as unknown as AppContext;

  return { db, guildConfig, imageRepo, generateSpy, imageService, ctx };
}

describe('/draw command & img:* interactions', () => {
  it('runs /draw command: pre-flight checks reply ephemerally, prepends R18 defaults, and handles batch count=3', async () => {
    const { db, guildConfig, generateSpy, ctx } = createImageTestCtx();

    // 1. Disabled module replies ephemerally without deferring
    const cfg = guildConfig.getOrCreate('g1');
    guildConfig.updateModules('g1', { ...cfg.modules, imageGen: false });
    const disabledReply = vi.fn(async () => undefined);
    await drawCommand.execute(
      {
        guildId: 'g1',
        channelId: 'c1',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        options: {
          getString: (name: string) => (name === 'prompt' ? '1girl' : null),
          getInteger: () => null,
          getNumber: () => null,
          getBoolean: () => null,
        },
        reply: disabledReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(disabledReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(generateSpy).not.toHaveBeenCalled();

    // 2. Enable and run valid public generation with R18 default prepending/merging
    guildConfig.updateModules('g1', { ...cfg.modules, imageGen: true });
    const deferReply = vi.fn(async () => undefined);
    const editReply = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);
    await drawCommand.execute(
      {
        guildId: 'g1',
        channelId: 'c1',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        options: {
          getString: (name: string) => {
            if (name === 'prompt') return '1girl, mature female, silver hair';
            if (name === 'aspect_ratio') return '3:2';
            if (name === 'negative_prompt') return 'blurry';
            return null;
          },
          getInteger: (name: string) => {
            if (name === 'steps') return 22;
            if (name === 'seed') return 777;
            return null;
          },
          getNumber: (name: string) => (name === 'scale' ? 6.0 : null),
          getBoolean: () => false,
        },
        deferReply,
        editReply,
        followUp,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );

    expect(deferReply).toHaveBeenCalledWith({});
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: `${DEFAULT_NAI_POSITIVE_PROMPT}, 1girl, mature female, silver hair`,
        negativePrompt: `${DEFAULT_NAI_NEGATIVE_PROMPT}, blurry`,
        aspectRatio: '3:2',
        steps: 22,
        scale: 6.0,
        cfgRescale: 0.3,
        seed: 777,
      }),
    );
    const editPayload = editReply.mock.calls[0]?.[0] as {
      embeds: Array<{ toJSON(): APIEmbed }>;
      files: Array<{ name: string; spoiler: boolean }>;
      components: Array<{ toJSON(): APIActionRowComponent<APIMessageActionRowComponent> }>;
    };
    expect(editPayload.files[0]?.name).toMatch(/^nai-draw-.*\.png$/);
    expect(editPayload.files[0]?.spoiler).toBe(false);
    expect(editPayload.embeds[0]?.toJSON().image?.url).toMatch(/^attachment:\/\/nai-draw-.*\.png$/);
    expect(editPayload.components).toHaveLength(2);
    const ratioSelectComp = editPayload.components[0]!.toJSON().components[0]!;
    expect(ratioSelectComp).toMatchObject({ custom_id: 'img:ratio_reroll:1' });
    const btnIds = editPayload.components[1]!.toJSON().components.map((c) =>
      'custom_id' in c ? c.custom_id : '',
    );
    expect(btnIds).toEqual(['img:reroll:1', 'img:edit:1', 'img:open_workbench', 'img:del:1']);

    // 3. Batch count=3 + private + spoiler mode: 3 PNG files, omits embed.setImage, spoiler=true on all, wires :3 reroll
    const batchDefer = vi.fn(async () => undefined);
    const batchEdit = vi.fn(async () => undefined);
    const batchFollowUp = vi.fn(async () => undefined);
    await drawCommand.execute(
      {
        guildId: 'g1',
        channelId: 'c1',
        inCachedGuild: () => true,
        member: makeMember('admin1', true),
        user: { id: 'admin1', displayName: 'Admin', displayAvatarURL: () => 'https://example.com/a.png' },
        options: {
          getString: (name: string) => (name === 'prompt' ? '1girl, mature female' : null),
          getInteger: (name: string) => (name === 'count' ? 3 : null),
          getNumber: () => null,
          getBoolean: () => true,
        },
        deferReply: batchDefer,
        editReply: batchEdit,
        followUp: batchFollowUp,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(batchDefer).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const batchFinalPayload = batchEdit.mock.calls.at(-1)?.[0] as {
      embeds: Array<{ toJSON(): APIEmbed }>;
      files: Array<{ name: string; spoiler: boolean }>;
      components: Array<{ toJSON(): APIActionRowComponent<APIMessageActionRowComponent> }>;
    };
    expect(batchFinalPayload.files).toHaveLength(3);
    for (const f of batchFinalPayload.files) {
      expect(f.spoiler).toBe(true);
    }
    expect(batchFinalPayload.embeds[0]?.toJSON().image).toBeUndefined();
    const batchSelectComp = batchFinalPayload.components[0]!.toJSON().components[0]!;
    expect(batchSelectComp).toMatchObject({ custom_id: 'img:ratio_reroll:2:3' });
    const batchBtnIds = batchFinalPayload.components[1]!.toJSON().components.map((c) =>
      'custom_id' in c ? c.custom_id : '',
    );
    expect(batchBtnIds).toEqual(['img:reroll:2:3', 'img:edit:2:3', 'img:open_workbench']);

    // 4. Zero-arg /draw opens ephemeral interactive workbench immediately
    const zeroArgReply = vi.fn(async () => undefined);
    await drawCommand.execute(
      {
        guildId: 'g1',
        channelId: 'c1',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        options: {
          getString: () => null,
          getInteger: () => null,
          getNumber: () => null,
          getBoolean: () => null,
        },
        reply: zeroArgReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(zeroArgReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    const zeroPayload = zeroArgReply.mock.calls[0]?.[0] as {
      embeds: Array<{ toJSON(): APIEmbed }>;
    };
    expect(zeroPayload.embeds[0]?.toJSON().title).toContain('AI 独立绘图工作台');

    // 5. Cooldown on /draw replies ephemerally before deferReply
    const cdReply = vi.fn(async () => undefined);
    const cdDefer = vi.fn(async () => undefined);
    await drawCommand.execute(
      {
        guildId: 'g1',
        channelId: 'c1',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        options: {
          getString: (name: string) => (name === 'prompt' ? '1girl' : null),
          getInteger: () => null,
          getNumber: () => null,
          getBoolean: () => null,
        },
        reply: cdReply,
        deferReply: cdDefer,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(cdReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(cdDefer).not.toHaveBeenCalled();

    // 6. Ratio select menu updates user image workbench
    const selectUpdate = vi.fn(async () => undefined);
    await handleImageStringSelect(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:select_ratio',
        values: ['16:9'],
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        update: selectUpdate,
      } as unknown as StringSelectMenuInteraction,
      ctx,
    );
    expect(selectUpdate).toHaveBeenCalledTimes(1);
    const selectPayload = selectUpdate.mock.calls[0]?.[0] as {
      embeds: Array<{ toJSON(): APIEmbed }>;
    };
    expect(selectPayload.embeds[0]?.toJSON().description).toContain('16:9');

    db.close();
  });

  it('handles single & batch reroll (drops fixed seed), edit modal, delete permission guard, and router wiring', async () => {
    const { db, guildConfig, generateSpy, ctx } = createImageTestCtx();
    const cfg = guildConfig.getOrCreate('g1');
    guildConfig.updateImageGen('g1', {
      ...cfg.imageGen,
      cooldownSec: 0,
      defaultPositivePrompt: '',
      defaultNegativePrompt: '',
    });

    const genRes = await ctx.services.image!.generateImage({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'owner1',
      prompt: '1girl, red dress',
      negativePrompt: 'blurry',
      aspectRatio: '2:3',
      steps: 28,
      scale: 5.0,
      seed: 99999,
    });
    expect(genRes.ok).toBe(true);
    const recId = genRes.ok ? genRes.record.id : 1;

    // 1. Single reroll unsets fixed seed
    const rerollDefer = vi.fn(async () => undefined);
    const rerollEdit = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: `img:reroll:${recId}`,
        inCachedGuild: () => true,
        member: makeMember('u2'),
        user: { id: 'u2', displayName: 'Bob', displayAvatarURL: () => 'https://example.com/b.png' },
        deferReply: rerollDefer,
        editReply: rerollEdit,
        followUp: vi.fn(async () => undefined),
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(rerollDefer).toHaveBeenCalledWith({});
    const rerollCallArg = generateSpy.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(rerollCallArg['seed']).toBeUndefined();
    expect(rerollCallArg['prompt']).toBe('1girl, red dress');

    // 2. Batch reroll :3 generates 3 new images with seed cleared
    const batchRerollDefer = vi.fn(async () => undefined);
    const batchRerollEdit = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: `img:reroll:${recId}:3`,
        inCachedGuild: () => true,
        member: makeMember('u2'),
        user: { id: 'u2', displayName: 'Bob', displayAvatarURL: () => 'https://example.com/b.png' },
        deferReply: batchRerollDefer,
        editReply: batchRerollEdit,
        followUp: vi.fn(async () => undefined),
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(generateSpy).toHaveBeenCalledTimes(5); // 1 + 1 + 3
    for (let idx = 2; idx <= 4; idx++) {
      expect((generateSpy.mock.calls[idx]?.[0] as Record<string, unknown>)['seed']).toBeUndefined();
    }
    const batchRerollFinal = batchRerollEdit.mock.calls.at(-1)?.[0] as {
      files: Array<{ name: string }>;
    };
    expect(batchRerollFinal.files).toHaveLength(3);

    // 3. Edit opens modal with labels <= 45 chars
    const showModalSpy = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: `img:edit:${recId}`,
        inCachedGuild: () => true,
        member: makeMember('u2'),
        user: { id: 'u2', displayName: 'Bob', displayAvatarURL: () => 'https://example.com/b.png' },
        showModal: showModalSpy,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(showModalSpy).toHaveBeenCalledTimes(1);
    const modalJson = (
      showModalSpy.mock.calls[0]?.[0] as {
        toJSON(): { title: string; components: Array<{ components: Array<{ label: string }> }> };
      }
    ).toJSON();
    expect(modalJson.title.length).toBeLessThanOrEqual(45);
    for (const row of modalJson.components) {
      for (const comp of row.components) {
        expect(comp.label.length).toBeLessThanOrEqual(45);
      }
    }

    // 4. Submit edit modal triggers new generation
    const editModalDefer = vi.fn(async () => undefined);
    const editModalReply = vi.fn(async () => undefined);
    await handleImageModal(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: `img:modal_edit:${recId}`,
        inCachedGuild: () => true,
        member: makeMember('u2'),
        user: { id: 'u2', displayName: 'Bob', displayAvatarURL: () => 'https://example.com/b.png' },
        fields: {
          getTextInputValue: (id: string) => {
            if (id === 'prompt') return '1girl, blue dress';
            if (id === 'negativePrompt') return 'lowres';
            if (id === 'aspectRatio') return '1:1';
            if (id === 'steps') return '20';
            if (id === 'scale') return '6.0';
            return '';
          },
        },
        deferReply: editModalDefer,
        editReply: editModalReply,
        followUp: vi.fn(async () => undefined),
      } as unknown as ModalSubmitInteraction,
      ctx,
    );
    expect(editModalReply).toHaveBeenCalledTimes(1);
    expect(generateSpy.mock.calls[5]?.[0]).toMatchObject({
      prompt: '1girl, blue dress',
      aspectRatio: '1:1',
      steps: 20,
      scale: 6.0,
    });

    // 5. Delete guard rejects non-owner/non-admin first, then allows owner
    const denyReply = vi.fn(async () => undefined);
    const msgDelete = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: `img:del:${recId}`,
        inCachedGuild: () => true,
        member: makeMember('intruder', false),
        user: { id: 'intruder', displayName: 'Intruder', displayAvatarURL: () => 'https://example.com/x.png' },
        message: { delete: msgDelete },
        reply: denyReply,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(denyReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(msgDelete).not.toHaveBeenCalled();

    const ownerAck = vi.fn(async () => undefined);
    await routeInteraction(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: `img:del:${recId}`,
        inCachedGuild: () => true,
        isChatInputCommand: () => false,
        isButton: () => true,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => false,
        isRoleSelectMenu: () => false,
        isChannelSelectMenu: () => false,
        isModalSubmit: () => false,
        isRepliable: () => true,
        replied: false,
        deferred: false,
        member: makeMember('owner1', false),
        user: { id: 'owner1', username: 'owner1', displayName: 'Owner', displayAvatarURL: () => 'https://example.com/o.png' },
        message: { delete: msgDelete },
        deferUpdate: ownerAck,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(msgDelete).toHaveBeenCalledTimes(1);

    db.close();
  });

  it('updates admin image generation config via buttons, modals (params & prompts/cfgRescale), and channel selects', async () => {
    const { db, guildConfig, ctx } = createImageTestCtx();
    const adminActor: MenuActor = {
      id: 'admin1',
      displayName: 'Admin',
      avatarUrl: 'https://example.com/a.png',
      isAdmin: true,
      isSuperAdmin: true,
    };

    const toggleRes = await tryHandleAdminImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'menu:admin:img_toggle_spoiler',
        update: vi.fn(async () => undefined),
      } as unknown as ButtonInteraction,
      ctx,
      'g1',
      adminActor,
    );
    expect(toggleRes).toBe(true);
    expect(guildConfig.getOrCreate('g1').imageGen.forceSpoiler).toBe(true);

    const modalUpdate = vi.fn(async () => undefined);
    const modalHandled = await tryHandleAdminImageModal(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'menu:modal_sub:admin_img_params',
        isFromMessage: () => true,
        fields: {
          getTextInputValue: (id: string) => {
            if (id === 'modelOverride') return 'nai/custom-v5';
            if (id === 'defaultAspectRatio') return '16:9';
            if (id === 'defaultSteps') return '24';
            if (id === 'defaultScale') return '6.5';
            if (id === 'cooldownSec') return '20';
            return '';
          },
        },
        update: modalUpdate,
      } as unknown as ModalSubmitInteraction,
      ctx,
      'g1',
      adminActor,
    );
    expect(modalHandled).toBe(true);
    expect(guildConfig.getOrCreate('g1').imageGen).toMatchObject({
      modelOverride: 'nai/custom-v5',
      defaultAspectRatio: '16:9',
      defaultSteps: 24,
      defaultScale: 6.5,
      cooldownSec: 20,
    });

    const promptsHandled = await tryHandleAdminImageModal(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'menu:modal_sub:admin_img_prompts',
        isFromMessage: () => true,
        fields: {
          getTextInputValue: (id: string) => {
            if (id === 'defaultPositivePrompt') return 'nsfw, rating:explicit, uncensored, mature female';
            if (id === 'defaultNegativePrompt') return 'lowres, censored, mosaic censoring';
            if (id === 'defaultCfgRescale') return '0.35';
            return '';
          },
        },
        update: vi.fn(async () => undefined),
      } as unknown as ModalSubmitInteraction,
      ctx,
      'g1',
      adminActor,
    );
    expect(promptsHandled).toBe(true);
    expect(guildConfig.getOrCreate('g1').imageGen).toMatchObject({
      defaultPositivePrompt: 'nsfw, rating:explicit, uncensored, mature female',
      defaultNegativePrompt: 'lowres, censored, mosaic censoring',
      defaultCfgRescale: 0.35,
    });

    const chanUpdate = vi.fn(async () => undefined);
    const chanHandled = await tryHandleAdminImageChannelSelect(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'menu:chan:admin_img_allowed',
        values: ['draw-ch-1', 'draw-ch-2'],
        update: chanUpdate,
      } as unknown as ChannelSelectMenuInteraction,
      ctx,
      'g1',
      adminActor,
    );
    expect(chanHandled).toBe(true);
    expect(guildConfig.getOrCreate('g1').imageGen.allowedChannelIds).toEqual([
      'draw-ch-1',
      'draw-ch-2',
    ]);

    db.close();
  });

  it('supports interactive workbench prefs (ratio, batchCount, modal), history pick, card ratio reroll, chunking >8MiB, and lobby card', async () => {
    const { db, guildConfig, generateSpy, ctx } = createImageTestCtx();
    const cfg = guildConfig.getOrCreate('g1');
    guildConfig.updateImageGen('g1', {
      ...cfg.imageGen,
      cooldownSec: 0,
      defaultPositivePrompt: '',
      defaultNegativePrompt: '',
    });

    // 1. User changes ratio & batchCount via workbench buttons
    const ratioUpdate = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:pref_ratio:16:9',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        update: ratioUpdate,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(ctx.services.image!.getUserPrefs('g1', 'u1').aspectRatio).toBe('16:9');
    expect(ratioUpdate).toHaveBeenCalledTimes(1);

    const countUpdate = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:pref_count:4',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        update: countUpdate,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(ctx.services.image!.getUserPrefs('g1', 'u1').batchCount).toBe(4);
    expect(countUpdate).toHaveBeenCalledTimes(1);

    // 2. Toggle private mode & spoiler mode
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:pref_toggle:ephemeral',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        update: vi.fn(async () => undefined),
      } as unknown as ButtonInteraction,
      ctx,
    );
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:pref_toggle:spoiler',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        update: vi.fn(async () => undefined),
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(ctx.services.image!.getUserPrefs('g1', 'u1')).toMatchObject({
      ephemeral: true,
      spoiler: true,
    });

    // 3. Open & submit prefs modal (steps, scale, batchCount, negativePrompt)
    const prefsModalSpy = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:open_prefs_modal',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        showModal: prefsModalSpy,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(prefsModalSpy).toHaveBeenCalledTimes(1);

    await handleImageModal(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:modal_prefs',
        isFromMessage: () => true,
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        fields: {
          getTextInputValue: (id: string) => {
            if (id === 'steps') return '22';
            if (id === 'scale') return '6.5';
            if (id === 'batchCount') return '2';
            if (id === 'negativePrompt') return 'blurry, extra fingers';
            return '';
          },
        },
        update: vi.fn(async () => undefined),
      } as unknown as ModalSubmitInteraction,
      ctx,
    );
    expect(ctx.services.image!.getUserPrefs('g1', 'u1')).toMatchObject({
      steps: 22,
      scale: 6.5,
      batchCount: 2,
      negativePrompt: 'blurry, extra fingers',
    });

    // 4. Open create modal from workbench & submit using saved 16:9 / private / spoiler / batchCount=2 prefs
    const createModalSpy = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:open_create',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        showModal: createModalSpy,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(createModalSpy).toHaveBeenCalledTimes(1);

    const createDefer = vi.fn(async () => undefined);
    const createEdit = vi.fn(async () => undefined);
    await handleImageModal(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:modal_create',
        isFromMessage: () => false,
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        fields: {
          getTextInputValue: (id: string) => {
            if (id === 'prompt') return '1girl, cyberpunk';
            if (id === 'negativePrompt') return 'blurry, extra fingers';
            if (id === 'steps') return '22';
            if (id === 'scale') return '6.5';
            if (id === 'seed') return '123';
            return '';
          },
        },
        deferReply: createDefer,
        editReply: createEdit,
        followUp: vi.fn(async () => undefined),
      } as unknown as ModalSubmitInteraction,
      ctx,
    );
    expect(createDefer).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(generateSpy).toHaveBeenCalledTimes(2);
    expect(generateSpy.mock.calls[0]?.[0]).toMatchObject({
      prompt: '1girl, cyberpunk',
      aspectRatio: '16:9',
      steps: 22,
      scale: 6.5,
      seed: 123,
    });
    expect(generateSpy.mock.calls[1]?.[0]).toMatchObject({
      seed: 124,
    });

    // 5. History pick opens prefilled edit modal
    const histModalSpy = vi.fn(async () => undefined);
    await handleImageStringSelect(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:history_pick',
        values: ['1'],
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        showModal: histModalSpy,
      } as unknown as StringSelectMenuInteraction,
      ctx,
    );
    expect(histModalSpy).toHaveBeenCalledTimes(1);

    // 6. Ratio reroll on result card generates with newly chosen aspect ratio & drops fixed seed
    const rrDefer = vi.fn(async () => undefined);
    const rrEdit = vi.fn(async () => undefined);
    await handleImageStringSelect(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:ratio_reroll:1',
        values: ['1:1'],
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        deferReply: rrDefer,
        editReply: rrEdit,
        followUp: vi.fn(async () => undefined),
      } as unknown as StringSelectMenuInteraction,
      ctx,
    );
    expect(rrDefer).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const rrCall = generateSpy.mock.calls[2]?.[0] as Record<string, unknown>;
    expect(rrCall['aspectRatio']).toBe('1:1');
    expect(rrCall['seed']).toBeUndefined();

    // 7. Chunking > 8 MiB splits buffers across primary + followUp
    const bigBuf = Buffer.alloc(5 * 1024 * 1024, 1);
    const recSample = ctx.services.image!.getRecordById(1)!;
    const chunked = buildImageBatchResultMessages({
      items: [
        { buffer: bigBuf, record: { ...recSample, id: 101, spoiler: false }, attempts: 1 },
        { buffer: bigBuf, record: { ...recSample, id: 102, spoiler: false }, attempts: 1 },
      ],
      requestedCount: 2,
      authorName: 'Alice',
    });
    expect(chunked.primary.files).toHaveLength(1);
    expect(chunked.followUps).toHaveLength(1);
    expect(chunked.followUps[0]?.files).toHaveLength(1);

    // 8. Reset prefs
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:pref_reset',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        update: vi.fn(async () => undefined),
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(ctx.services.image!.getUserPrefs('g1', 'u1')).toMatchObject({
      aspectRatio: null,
      batchCount: null,
      ephemeral: false,
      spoiler: false,
    });

    // 9. Open workbench from result/lobby card
    const wbReply = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:open_workbench',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        reply: wbReply,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(wbReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );

    // 10. Send channel lobby card: rejects non-admin, succeeds for admin
    const nonAdminLobbyReply = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:send_lobby',
        inCachedGuild: () => true,
        member: makeMember('u1', false),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        reply: nonAdminLobbyReply,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(nonAdminLobbyReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );

    const chanSendSpy = vi.fn(async () => ({ id: 'lobby-msg-1' }));
    const adminLobbyUpdate = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:send_lobby',
        guild: { name: '黑吊国' },
        channel: { isSendable: () => true, send: chanSendSpy },
        inCachedGuild: () => true,
        member: makeMember('admin1', true),
        user: { id: 'admin1', displayName: 'Admin', displayAvatarURL: () => 'https://example.com/a.png' },
        deferUpdate: vi.fn(async () => undefined),
        editReply: adminLobbyUpdate,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(chanSendSpy).toHaveBeenCalledTimes(1);
    expect(adminLobbyUpdate).toHaveBeenCalledTimes(1);

    db.close();
  });

  it('supports NAI V5 multi-character slots across /draw options, full multi-block paste, create/edit modals, and reroll persistence', async () => {
    const { db, guildConfig, generateSpy, ctx } = createImageTestCtx();
    const cfg = guildConfig.getOrCreate('g1');
    guildConfig.updateImageGen('g1', {
      ...cfg.imageGen,
      cooldownSec: 0,
    });

    // 1. /draw with character_1 & character_2 options (+ inline @coords & | UC:)
    const slashDefer = vi.fn(async () => undefined);
    const slashEdit = vi.fn(async () => undefined);
    await drawCommand.execute(
      {
        guildId: 'g1',
        channelId: 'c1',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        options: {
          getString: (name: string) => {
            if (name === 'prompt') return '2girls, rooftop, sunset';
            if (name === 'character_1') return '@0.25,0.5 girl, silver hair, white dress | UC: glasses';
            if (name === 'character_2') return '@0.75,0.5 girl, black hair, school uniform';
            if (name === 'aspect_ratio') return '3:2';
            return null;
          },
          getInteger: () => null,
          getNumber: () => null,
          getBoolean: () => null,
        },
        deferReply: slashDefer,
        editReply: slashEdit,
        followUp: vi.fn(async () => undefined),
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );

    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy.mock.calls[0]?.[0]).toMatchObject({
      prompt: `${DEFAULT_NAI_POSITIVE_PROMPT}, 2girls, rooftop, sunset`,
      aspectRatio: '3:2',
      useCoords: true,
      charCaptions: [
        {
          char_caption: 'girl, silver hair, white dress',
          uc: 'glasses',
          centers: [{ x: 0.25, y: 0.5 }],
        },
        {
          char_caption: 'girl, black hair, school uniform',
          centers: [{ x: 0.75, y: 0.5 }],
        },
      ],
    });
    const slashPayload = slashEdit.mock.calls[0]?.[0] as {
      embeds: Array<{ toJSON(): APIEmbed }>;
    };
    expect(slashPayload.embeds[0]?.toJSON().description).toContain('角色栏 (2人');

    // 2. Reroll & Ratio-reroll preserve saved charCaptions & useCoords
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:reroll:1',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        deferReply: vi.fn(async () => undefined),
        editReply: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(generateSpy.mock.calls[1]?.[0]).toMatchObject({
      useCoords: true,
      charCaptions: [
        {
          char_caption: 'girl, silver hair, white dress',
          uc: 'glasses',
          centers: [{ x: 0.25, y: 0.5 }],
        },
        {
          char_caption: 'girl, black hair, school uniform',
          centers: [{ x: 0.75, y: 0.5 }],
        },
      ],
    });

    // 3. Edit modal prefills charPrompts and submits updated character prompts + combined params ("24 | 6.0")
    const editShowModal = vi.fn(async () => undefined);
    await handleImageButton(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:edit:1',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        showModal: editShowModal,
      } as unknown as ButtonInteraction,
      ctx,
    );
    const editModalJson = (
      editShowModal.mock.calls[0]?.[0] as {
        toJSON(): {
          title: string;
          components: Array<{ components: Array<{ custom_id: string; label: string; value?: string }> }>;
        };
      }
    ).toJSON();
    expect(editModalJson.components).toHaveLength(5);
    const charComp = editModalJson.components
      .flatMap((r) => r.components)
      .find((c) => c.custom_id === 'charPrompts');
    expect(charComp?.value).toContain('silver hair');
    expect(charComp?.value).toContain('black hair');

    await handleImageModal(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:modal_edit:1',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        fields: {
          getTextInputValue: (id: string) => {
            if (id === 'prompt') return '2girls, classroom';
            if (id === 'charPrompts') {
              return 'Character 1:\ngirl, pink hair, cardigan\n\nCharacter 2:\ngirl, blue hair, blazer';
            }
            if (id === 'negativePrompt') return 'blurry';
            if (id === 'aspectRatio') return '16:9';
            if (id === 'params') return '24 | 6.0';
            return '';
          },
        },
        deferReply: vi.fn(async () => undefined),
        editReply: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      } as unknown as ModalSubmitInteraction,
      ctx,
    );
    expect(generateSpy.mock.calls[2]?.[0]).toMatchObject({
      prompt: `${DEFAULT_NAI_POSITIVE_PROMPT}, 2girls, classroom`,
      aspectRatio: '16:9',
      steps: 24,
      scale: 6.0,
      charCaptions: [
        { char_caption: 'girl, pink hair, cardigan' },
        { char_caption: 'girl, blue hair, blazer' },
      ],
    });

    // 4. Create modal with full multi-section NAI V5 paste inside prompt box (charPrompts left empty)
    await handleImageModal(
      {
        guildId: 'g1',
        channelId: 'c1',
        customId: 'img:modal_create',
        isFromMessage: () => false,
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        fields: {
          getTextInputValue: (id: string) => {
            if (id === 'prompt') {
              return [
                'Base Prompt:',
                '```text',
                '1girl, solo, bedroom, morning sunlight,',
                '```',
                'Character 1:',
                '```text',
                'girl, white hair, red eyes,',
                'oversized shirt,',
                '```',
                'Undesired Content:',
                '```text',
                'extra limbs',
                '```',
              ].join('\n');
            }
            if (id === 'params') return '28 | 5.0';
            return '';
          },
        },
        deferReply: vi.fn(async () => undefined),
        editReply: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      } as unknown as ModalSubmitInteraction,
      ctx,
    );
    expect(generateSpy.mock.calls[3]?.[0]).toMatchObject({
      prompt: `${DEFAULT_NAI_POSITIVE_PROMPT}, 1girl, solo, bedroom, morning sunlight`,
      charCaptions: [{ char_caption: 'girl, white hair, red eyes, oversized shirt' }],
    });
    expect(
      (generateSpy.mock.calls[3]?.[0] as { negativePrompt?: string }).negativePrompt,
    ).toContain('extra limbs');

    db.close();
  });
});
