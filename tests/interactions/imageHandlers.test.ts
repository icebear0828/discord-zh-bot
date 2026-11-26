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
import { LiteralTranslationPromptProcessor } from '../../src/services/imagePromptProcessor.js';
import { ImageService } from '../../src/services/imageService.js';
import { LlmClient } from '../../src/services/llmClient.js';
import type { AppContext } from '../../src/ui/embeds.js';
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
    new LiteralTranslationPromptProcessor(new LlmClient(undefined)),
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
  it('runs /draw command: pre-flight checks reply ephemerally, valid request edits reply with PNG & card buttons', async () => {
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

    // 2. Enable and run valid public generation
    guildConfig.updateModules('g1', { ...cfg.modules, imageGen: true });
    const deferReply = vi.fn(async () => undefined);
    const editReply = vi.fn(async () => undefined);
    await drawCommand.execute(
      {
        guildId: 'g1',
        channelId: 'c1',
        inCachedGuild: () => true,
        member: makeMember('u1'),
        user: { id: 'u1', displayName: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' },
        options: {
          getString: (name: string) => {
            if (name === 'prompt') return '1girl, silver hair';
            if (name === 'aspect_ratio') return '3:2';
            if (name === 'negative_prompt') return 'lowres';
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
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );

    expect(deferReply).toHaveBeenCalledWith({});
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '1girl, silver hair',
        negativePrompt: 'lowres',
        aspectRatio: '3:2',
        steps: 22,
        scale: 6.0,
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

    // 3. Private + spoiler mode hides embed preview, sets spoiler attachment, and omits delete button
    const privDefer = vi.fn(async () => undefined);
    const privEdit = vi.fn(async () => undefined);
    await drawCommand.execute(
      {
        guildId: 'g1',
        channelId: 'c1',
        inCachedGuild: () => true,
        member: makeMember('admin1', true),
        user: { id: 'admin1', displayName: 'Admin', displayAvatarURL: () => 'https://example.com/a.png' },
        options: {
          getString: (name: string) => (name === 'prompt' ? '1boy' : null),
          getInteger: () => null,
          getNumber: () => null,
          getBoolean: () => true,
        },
        deferReply: privDefer,
        editReply: privEdit,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(privDefer).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const privPayload = privEdit.mock.calls[0]?.[0] as {
      embeds: Array<{ toJSON(): APIEmbed }>;
      files: Array<{ name: string; spoiler: boolean }>;
      components: Array<{ toJSON(): APIActionRowComponent<APIMessageActionRowComponent> }>;
    };
    expect(privPayload.files[0]?.spoiler).toBe(true);
    expect(privPayload.embeds[0]?.toJSON().image).toBeUndefined();
    const privBtnIds = privPayload.components[1]!.toJSON().components.map((c) =>
      'custom_id' in c ? c.custom_id : '',
    );
    expect(privBtnIds).toEqual(['img:reroll:2', 'img:edit:2', 'img:open_workbench']);

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

    // 5. Ratio select menu updates user image workbench
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

  it('handles reroll (drops fixed seed), edit modal, delete permission guard, and router wiring', async () => {
    const { db, guildConfig, generateSpy, ctx } = createImageTestCtx();
    const cfg = guildConfig.getOrCreate('g1');
    guildConfig.updateImageGen('g1', { ...cfg.imageGen, cooldownSec: 0 });

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

    // 1. Reroll unsets fixed seed
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
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(rerollDefer).toHaveBeenCalledWith({});
    const rerollCallArg = generateSpy.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(rerollCallArg['seed']).toBeUndefined();
    expect(rerollCallArg['prompt']).toBe('1girl, red dress');

    // 2. Edit opens modal with labels <= 45 chars
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
      showModalSpy.mock.calls[0]?.[0] as { toJSON(): { title: string; components: Array<{ components: Array<{ label: string }> }> } }
    ).toJSON();
    expect(modalJson.title.length).toBeLessThanOrEqual(45);
    for (const row of modalJson.components) {
      for (const comp of row.components) {
        expect(comp.label.length).toBeLessThanOrEqual(45);
      }
    }

    // 3. Submit edit modal triggers new generation
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
      } as unknown as ModalSubmitInteraction,
      ctx,
    );
    expect(editModalReply).toHaveBeenCalledTimes(1);
    expect(generateSpy.mock.calls[2]?.[0]).toMatchObject({
      prompt: '1girl, blue dress',
      aspectRatio: '1:1',
      steps: 20,
      scale: 6.0,
    });

    // 4. Delete guard rejects non-owner/non-admin first, then allows owner
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

  it('updates admin image generation config via buttons, modals, and channel selects', async () => {
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

  it('supports interactive workbench prefs, history pick, card ratio reroll, and channel lobby card', async () => {
    const { db, guildConfig, generateSpy, ctx } = createImageTestCtx();
    const cfg = guildConfig.getOrCreate('g1');
    guildConfig.updateImageGen('g1', { ...cfg.imageGen, cooldownSec: 0 });

    // 1. User changes ratio via workbench button
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

    // 3. Open & submit prefs modal (steps, scale, negativePrompt)
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
      negativePrompt: 'blurry, extra fingers',
    });

    // 4. Open create modal from workbench & submit using saved 16:9 / private / spoiler prefs
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
      } as unknown as ModalSubmitInteraction,
      ctx,
    );
    expect(createDefer).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(generateSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: '1girl, cyberpunk',
        aspectRatio: '16:9',
        steps: 22,
        scale: 6.5,
        seed: 123,
      }),
    );

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
      } as unknown as StringSelectMenuInteraction,
      ctx,
    );
    expect(rrDefer).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const rrCall = generateSpy.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(rrCall['aspectRatio']).toBe('1:1');
    expect(rrCall['seed']).toBeUndefined();

    // 7. Reset prefs
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
      ephemeral: false,
      spoiler: false,
    });

    // 8. Open workbench from result/lobby card
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

    // 9. Send channel lobby card: rejects non-admin, succeeds for admin
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
});
