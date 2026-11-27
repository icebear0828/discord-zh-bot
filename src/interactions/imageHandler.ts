import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import {
  DEFAULT_IMAGE_GEN_CONFIG,
  MAX_IMAGE_BATCH_COUNT,
  MAX_IMAGE_STEPS,
  VALID_IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
} from '../config/defaults.js';
import type { ImageGenerationRecord } from '../db/repositories/imageRepo.js';
import { formatCharacterPromptsText } from '../services/imagePromptProcessor.js';
import {
  isValidImageAspectRatio,
  type GenerateImageBatchInput,
  type ImageService,
} from '../services/imageService.js';
import { createErrorEmbed, type AppContext } from '../ui/embeds.js';
import {
  buildAdminImageView,
  buildImageBatchProgressMessage,
  buildImageBatchResultMessages,
  buildImageLobbyMessage,
  buildUserImageMenuView,
} from '../ui/imageMenuBuilder.js';
import { truncateText, type MenuActor, type MenuFeedback } from '../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  parseIntInRange,
  parseNonNegativeInt,
  parseNumberInRange,
  parsePositiveInt,
  prefilledField,
  resolveActor,
  respondFromModal,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from './menuHelpers.js';

export interface ImageBatchReplyTarget {
  editReply(options: InteractionEditReplyOptions): Promise<unknown>;
  followUp?: (options: InteractionReplyOptions) => Promise<unknown>;
}

export async function executeAndReplyImageBatch(params: {
  interaction: ImageBatchReplyTarget;
  imageService: ImageService;
  input: GenerateImageBatchInput;
  authorName: string;
  authorAvatarUrl?: string;
  failTitle?: string;
}): Promise<void> {
  const { imageService, input, authorName, authorAvatarUrl } = params;
  const { imageCfg } = imageService.getEffectiveConfig(input.guildId);
  const userPrefs = imageService.getUserPrefs(input.guildId, input.userId);
  const requestedCount = Math.max(
    1,
    Math.min(MAX_IMAGE_BATCH_COUNT, Math.round(input.count ?? userPrefs.batchCount ?? 1)),
  );
  const aspectRatio = input.aspectRatio ?? userPrefs.aspectRatio ?? imageCfg.defaultAspectRatio;
  const steps = Math.max(
    1,
    Math.min(MAX_IMAGE_STEPS, Math.round(input.steps ?? userPrefs.steps ?? imageCfg.defaultSteps)),
  );
  const scale = Number((input.scale ?? userPrefs.scale ?? imageCfg.defaultScale).toFixed(1));
  const cfgRescale = Number((input.cfgRescale ?? imageCfg.defaultCfgRescale).toFixed(2));

  const res = await imageService.generateBatch({
    ...input,
    authorName,
    ...(authorAvatarUrl ? { authorAvatarUrl } : {}),
    count: requestedCount,
    onProgress:
      requestedCount > 1
        ? async (completed, total) => {
            await params.interaction.editReply(
              buildImageBatchProgressMessage({
                completed,
                total,
                aspectRatio,
                steps,
                scale,
                cfgRescale,
              }),
            );
          }
        : undefined,
  });

  if (!res.ok) {
    await params.interaction.editReply({
      embeds: [createErrorEmbed(params.failTitle ?? '⚠️ 生图失败', res.errorMessage)],
      components: [],
    });
    return;
  }

  const galleryUrl = imageService.getGalleryUrl();
  const built = buildImageBatchResultMessages({
    items: res.items,
    requestedCount: res.requestedCount,
    failedCount: res.failedCount,
    lastErrorMessage: res.lastErrorMessage,
    authorName,
    authorAvatarUrl,
    ...(galleryUrl ? { galleryUrl } : {}),
  });

  await params.interaction.editReply(built.primary);
  const isPrivate = Boolean(res.items[0]?.record.ephemeral);
  if (built.followUps.length > 0 && params.interaction.followUp) {
    for (const extra of built.followUps) {
      await params.interaction.followUp(
        isPrivate ? { ...extra, flags: MessageFlags.Ephemeral } : extra,
      );
    }
  }
}

function parseRatioOrDefault(raw: string | undefined, fallback: ImageAspectRatio): ImageAspectRatio {
  if (raw && isValidImageAspectRatio(raw.trim())) {
    return raw.trim() as ImageAspectRatio;
  }
  return fallback;
}

function parseOptionalBatchCount(raw: string | undefined): number {
  const parsed = raw ? parsePositiveInt(raw) : null;
  if (!parsed) return 1;
  return Math.max(1, Math.min(MAX_IMAGE_BATCH_COUNT, parsed));
}

function resolveEffectiveUserDefaults(
  ctx: AppContext,
  guildId: string,
  userId: string,
): {
  ratio: ImageAspectRatio;
  steps: number;
  scale: number;
  batchCount: number;
  negativePrompt: string;
  spoiler: boolean;
  ephemeral: boolean;
} {
  const imgCfg = ctx.repos.guildConfig.getOrCreate(guildId).imageGen;
  const prefs = ctx.services.image?.getUserPrefs(guildId, userId);
  return {
    ratio: prefs?.aspectRatio ?? imgCfg.defaultAspectRatio,
    steps: Math.max(1, Math.min(MAX_IMAGE_STEPS, prefs?.steps ?? imgCfg.defaultSteps)),
    scale: prefs?.scale ?? imgCfg.defaultScale,
    batchCount: prefs?.batchCount ?? 1,
    negativePrompt: prefs?.negativePrompt ?? '',
    spoiler: Boolean(imgCfg.forceSpoiler || prefs?.spoiler),
    ephemeral: Boolean(prefs?.ephemeral),
  };
}

function readOptionalModalField(interaction: ModalSubmitInteraction, fieldId: string): string {
  try {
    return interaction.fields.getTextInputValue(fieldId);
  } catch {
    return '';
  }
}

function parseModalStepsAndScale(
  interaction: ModalSubmitInteraction,
): { steps: number | null; scale: number | null } {
  const combined = readOptionalModalField(interaction, 'params').trim();
  if (combined) {
    const tokens = combined
      .split(/[|｜/,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const steps = tokens[0] ? parseIntInRange(tokens[0], 1, MAX_IMAGE_STEPS) : null;
    const scale = tokens[1] ? parseNumberInRange(tokens[1], 1.0, 10.0) : null;
    return { steps, scale };
  }
  const steps = parseIntInRange(readOptionalModalField(interaction, 'steps'), 1, MAX_IMAGE_STEPS);
  const scale = parseNumberInRange(readOptionalModalField(interaction, 'scale'), 1.0, 10.0);
  return { steps, scale };
}

function buildCreateImageModal(params: {
  ratio: ImageAspectRatio;
  steps: number;
  scale: number;
  batchCount: number;
  negativePrompt: string;
  ephemeral: boolean;
}): ModalBuilder {
  const charInput = new TextInputBuilder()
    .setCustomId('charPrompts')
    .setLabel(truncateText('Character 1~6 角色栏（空行分隔多人，可选）', 45))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(3000)
    .setPlaceholder(
      '可填每个角色的外貌与服装（空行隔开多人，支持 @0.3,0.5 或 @B3 站位及 UC: 负面词）',
    )
    .setRequired(false);

  const negInput = new TextInputBuilder()
    .setCustomId('negativePrompt')
    .setLabel(truncateText('Undesired Content 额外负面词（可选）', 45))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(1000)
    .setPlaceholder('例如：extra fingers, blurry（默认反打码 UC 已自动内置）')
    .setRequired(false);
  if (params.negativePrompt.trim()) {
    negInput.setValue(truncateText(params.negativePrompt.trim(), 1000));
  }

  const seedInput = new TextInputBuilder()
    .setCustomId('seed')
    .setLabel(truncateText('随机种子 Seed（可选整数，连抽递增）', 45))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(12)
    .setPlaceholder('留空每次自动随机')
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId('img:modal_create')
    .setTitle(
      truncateText(
        `${params.ephemeral ? '🙈 私密' : '🎨 公开'}绘图 (${params.ratio} · ${params.batchCount}张)`,
        45,
      ),
    )
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('prompt')
          .setLabel(truncateText('Base Prompt 主提示词（支持整段粘贴多栏词）', 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(4000)
          .setPlaceholder(
            '填主提示词；也可直接整段粘贴含 Base Prompt: / Character 1: / Undesired Content: 的文本',
          )
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(charInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(negInput),
      prefilledField(
        'params',
        `步数 Steps | 引导 CFG（1~${MAX_IMAGE_STEPS} | 1~10）`,
        `${params.steps} | ${params.scale}`,
        20,
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(seedInput),
    );
}

function buildUserPrefsModal(params: {
  steps: number;
  scale: number;
  batchCount: number;
  negativePrompt: string;
}): ModalBuilder {
  const negInput = new TextInputBuilder()
    .setCustomId('negativePrompt')
    .setLabel(truncateText('个人常驻额外负面词（自动合并默认反打码词）', 45))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setPlaceholder('例如：blurry, extra fingers（留空则仅使用默认反打码 UC）')
    .setRequired(false);
  if (params.negativePrompt.trim()) {
    negInput.setValue(truncateText(params.negativePrompt.trim(), 1000));
  }

  return new ModalBuilder()
    .setCustomId('img:modal_prefs')
    .setTitle(truncateText('🎛️ 我的绘图默认参数与负面词', 45))
    .addComponents(
      prefilledField('steps', `默认采样步数 Steps（1 ~ ${MAX_IMAGE_STEPS}）`, params.steps, 4),
      prefilledField('scale', '默认引导系数 Scale（1.0 ~ 10.0）', params.scale, 6),
      prefilledField(
        'batchCount',
        `默认连续张数（1 ~ ${MAX_IMAGE_BATCH_COUNT}，串行防风控）`,
        params.batchCount,
        2,
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(negInput),
    );
}

function buildEditImageModal(rec: ImageGenerationRecord, requestedCount = 1): ModalBuilder {
  const charInput = new TextInputBuilder()
    .setCustomId('charPrompts')
    .setLabel(truncateText('Character 1~6 角色栏（空行分隔多人，可选）', 45))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(3000)
    .setPlaceholder('可留空，或按 Character 1: / 空行分隔填写角色外貌与服装')
    .setRequired(false);
  if (rec.charCaptions.length > 0) {
    charInput.setValue(truncateText(formatCharacterPromptsText(rec.charCaptions), 3000));
  }

  const negInput = new TextInputBuilder()
    .setCustomId('negativePrompt')
    .setLabel(truncateText('Undesired Content 负面词（可留空）', 45))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(1000)
    .setPlaceholder('不想在画面中出现的内容')
    .setRequired(false);
  if (rec.negativePrompt.trim()) {
    negInput.setValue(truncateText(rec.negativePrompt.trim(), 1000));
  }

  const countSuffix = requestedCount > 1 ? `:${requestedCount}` : '';
  const safeSteps = Math.min(MAX_IMAGE_STEPS, rec.steps);
  return new ModalBuilder()
    .setCustomId(`img:modal_edit:${rec.id}${countSuffix}`)
    .setTitle(truncateText(`✏️ 修改提示词并重绘 (#${rec.id})`, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('prompt')
          .setLabel(truncateText('Base Prompt 主提示词（支持多栏粘贴）', 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(4000)
          .setValue(truncateText(rec.rawPrompt, 4000))
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(charInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(negInput),
      prefilledField(
        'aspectRatio',
        truncateText(`比例（${VALID_IMAGE_ASPECT_RATIOS.join(' / ')}）`, 45),
        rec.aspectRatio,
        10,
      ),
      prefilledField(
        'params',
        `步数 Steps | 引导 CFG（1~${MAX_IMAGE_STEPS} | 1~10）`,
        `${safeSteps} | ${rec.scale}`,
        20,
      ),
    );
}

function buildAdminImgParamsModal(ctx: AppContext, guildId: string): ModalBuilder {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).imageGen;
  const defaultModel = ctx.services.image?.getDefaultModel() || '';

  const modelInput = new TextInputBuilder()
    .setCustomId('modelOverride')
    .setLabel(truncateText('生图模型覆盖（留空用环境变量默认）', 45))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(120)
    .setPlaceholder(defaultModel ? `默认: ${truncateText(defaultModel, 60)}` : 'nai/nai-diffusion-5-full')
    .setRequired(false);
  if (cfg.modelOverride?.trim()) {
    modelInput.setValue(truncateText(cfg.modelOverride.trim(), 120));
  }

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_img_params')
    .setTitle(truncateText('🎛️ 配置生图模型与默认参数', 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(modelInput),
      prefilledField(
        'defaultAspectRatio',
        truncateText(`默认比例（${VALID_IMAGE_ASPECT_RATIOS.join(' / ')}）`, 45),
        cfg.defaultAspectRatio,
        10,
      ),
      prefilledField('defaultSteps', `默认步数 Steps（1 ~ ${MAX_IMAGE_STEPS}）`, cfg.defaultSteps, 4),
      prefilledField('defaultScale', '默认引导系数 Scale（1.0 ~ 10.0）', cfg.defaultScale, 6),
      prefilledField('cooldownSec', '单人冷却秒数（0 ~ 600，0=无冷却）', cfg.cooldownSec, 6),
    );
}

function buildAdminImgPromptsModal(ctx: AppContext, guildId: string): ModalBuilder {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).imageGen;

  const posInput = new TextInputBuilder()
    .setCustomId('defaultPositivePrompt')
    .setLabel(truncateText('默认正面附加词（前置，可留空，最多800字）', 45))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(800)
    .setPlaceholder('例如：nsfw, rating:explicit, uncensored')
    .setRequired(false);
  if (cfg.defaultPositivePrompt.trim()) {
    posInput.setValue(truncateText(cfg.defaultPositivePrompt.trim(), 800));
  }

  const negInput = new TextInputBuilder()
    .setCustomId('defaultNegativePrompt')
    .setLabel(truncateText('默认负面附加词（合并，可留空，最多800字）', 45))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(800)
    .setPlaceholder('默认 Heavy UC + 反打码词')
    .setRequired(false);
  if (cfg.defaultNegativePrompt.trim()) {
    negInput.setValue(truncateText(cfg.defaultNegativePrompt.trim(), 800));
  }

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_img_prompts')
    .setTitle(truncateText('📝 配置默认正负预设词与 CFG Rescale', 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(posInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(negInput),
      prefilledField(
        'defaultCfgRescale',
        'CFG Rescale 防过曝（0 ~ 1.0，推荐 0.3）',
        cfg.defaultCfgRescale,
        6,
      ),
    );
}

function buildAdminImgLimitsModal(ctx: AppContext, guildId: string): ModalBuilder {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).imageGen;
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_img_limits')
    .setTitle(truncateText('⏱️ 配置生图冷却与并发队列', 45))
    .addComponents(
      prefilledField('cooldownSec', '单人冷却秒数（0 ~ 600）', cfg.cooldownSec, 6),
      prefilledField('maxConcurrency', '同时生成并发上限（1 ~ 5，建议 1）', cfg.maxConcurrency, 4),
      prefilledField('maxPendingQueue', '最大排队等待人数（1 ~ 20）', cfg.maxPendingQueue, 4),
    );
}

export async function handleImageButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const parts = interaction.customId.split(':');
  const action = parts[1];
  const actor = await resolveActor(interaction, ctx, guildId);

  if (action === 'select_ratio') return;

  if (action === 'open_workbench') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'imageGen', 'AI 绘图');
    if (disabledMsg) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', disabledMsg)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      ...buildUserImageMenuView(ctx, guildId, actor, undefined, undefined),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'refresh') {
    await interaction.update(buildUserImageMenuView(ctx, guildId, actor, undefined, undefined));
    return;
  }

  if (action === 'pref_ratio') {
    const rawRatio = parts.slice(2).join(':');
    if (!isValidImageAspectRatio(rawRatio)) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 比例无效', '不支持的画幅比例。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    ctx.services.image?.updateUserPrefs(guildId, actor.id, { aspectRatio: rawRatio });
    await interaction.update(
      buildUserImageMenuView(ctx, guildId, actor, rawRatio, {
        type: 'success',
        text: `已将个人默认比例切换为 **${rawRatio}**。`,
      }),
    );
    return;
  }

  if (action === 'pref_count') {
    const chosenCount = parseIntInRange(parts[2] ?? '', 1, MAX_IMAGE_BATCH_COUNT);
    if (chosenCount === null) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 张数无效', `连续张数需在 1 ~ ${MAX_IMAGE_BATCH_COUNT} 之间。`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    ctx.services.image?.updateUserPrefs(guildId, actor.id, { batchCount: chosenCount });
    await interaction.update(
      buildUserImageMenuView(ctx, guildId, actor, undefined, {
        type: 'success',
        text: `已将个人默认连续出图张数设为 **${chosenCount} 张**（串行 + 1~3s 防风控停顿）。`,
      }),
    );
    return;
  }

  if (action === 'pref_toggle') {
    const field = parts[2];
    const prefs = ctx.services.image?.getUserPrefs(guildId, actor.id);
    if (field === 'ephemeral') {
      const next = !(prefs?.ephemeral ?? false);
      ctx.services.image?.updateUserPrefs(guildId, actor.id, { ephemeral: next });
      await interaction.update(
        buildUserImageMenuView(ctx, guildId, actor, undefined, {
          type: 'success',
          text: next
            ? '已切换为 **🙈 私密出图**（仅自己可见）。'
            : '已切换为 **📢 频道公开出图**。',
        }),
      );
      return;
    }
    if (field === 'spoiler') {
      const next = !(prefs?.spoiler ?? false);
      ctx.services.image?.updateUserPrefs(guildId, actor.id, { spoiler: next });
      await interaction.update(
        buildUserImageMenuView(ctx, guildId, actor, undefined, {
          type: 'success',
          text: next ? '已开启 **🔞 剧透模糊遮罩**。' : '已关闭 **👁️ 剧透模糊遮罩**。',
        }),
      );
      return;
    }
  }

  if (action === 'open_prefs_modal') {
    const eff = resolveEffectiveUserDefaults(ctx, guildId, actor.id);
    await interaction.showModal(
      buildUserPrefsModal({
        steps: eff.steps,
        scale: eff.scale,
        batchCount: eff.batchCount,
        negativePrompt: eff.negativePrompt,
      }),
    );
    return;
  }

  if (action === 'pref_reset') {
    ctx.services.image?.resetUserPrefs(guildId, actor.id);
    await interaction.update(
      buildUserImageMenuView(ctx, guildId, actor, undefined, {
        type: 'success',
        text: '♻️ 已重置你的个人绘图偏好，恢复服务器默认参数。',
      }),
    );
    return;
  }

  if (action === 'send_lobby') {
    if (!actor.isAdmin) {
      await interaction.reply({
        embeds: [createErrorEmbed('🔒 权限不足', ADMIN_DENIED_FEEDBACK.text)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    const sent = await sendPublicBroadcast(
      interaction,
      buildImageLobbyMessage(interaction.guild?.name, ctx.services.image?.getGalleryUrl()),
    );
    const feedback: MenuFeedback = sent.sent
      ? { type: 'success', text: '📌 已在当前频道发送永久「打开我的绘图菜单」入口卡片！' }
      : { type: 'error', text: '无法在当前频道发送入口卡片，请检查机器人发言与嵌入链接权限。' };
    await safeEditOrFollowUp(
      interaction,
      buildUserImageMenuView(ctx, guildId, actor, undefined, feedback),
    );
    return;
  }

  if (action === 'open_create') {
    const eff = resolveEffectiveUserDefaults(ctx, guildId, actor.id);
    const legacyMode = parts[2];
    const legacyRatio = parts[3];
    const ephemeral =
      legacyMode === 'priv' ? true : legacyMode === 'pub' ? false : eff.ephemeral;
    const ratio = parseRatioOrDefault(legacyRatio, eff.ratio);
    await interaction.showModal(
      buildCreateImageModal({
        ratio,
        steps: eff.steps,
        scale: eff.scale,
        batchCount: eff.batchCount,
        negativePrompt: eff.negativePrompt,
        ephemeral,
      }),
    );
    return;
  }

  const recordId = parsePositiveInt(parts[2] ?? '');
  if (!recordId) {
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 记录无效', '找不到该绘图记录 ID。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const record =
    ctx.services.image?.getRecordById(recordId) ?? ctx.repos.image?.getById(recordId) ?? null;
  if (!record || record.guildId !== guildId) {
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 记录不存在', '未找到对应的生图参数记录，请使用 `/画图` 重新生成。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'del') {
    const canDelete = record.userId === interaction.user.id || Boolean(actor.isAdmin);
    if (!canDelete) {
      await interaction.reply({
        embeds: [createErrorEmbed('🔒 无权撤回', '只有发起生图本人或管理员可以撤回该结果卡片。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => undefined);
    return;
  }

  const disabledMsg = checkModuleDisabled(ctx, guildId, 'imageGen', 'AI 绘图');
  if (disabledMsg) {
    await interaction.reply({
      embeds: [createErrorEmbed('🚫 模块未开启', disabledMsg)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const requestedCount = parseOptionalBatchCount(parts[3]);

  if (action === 'edit') {
    await interaction.showModal(buildEditImageModal(record, requestedCount));
    return;
  }

  if (action === 'reroll') {
    const imageSvc = ctx.services.image;
    if (!imageSvc || !imageSvc.isConfigured()) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 生图未配置', '生图服务尚未配置完成，请联系管理员。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const precheck = imageSvc.precheckRequest({
      guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      isAdmin: Boolean(actor.isAdmin),
    });
    if (!precheck.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 暂无法重绘', precheck.errorMessage)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isPrivate = record.ephemeral;
    await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});

    // Clear fixed seed on reroll so fresh variations are produced
    await executeAndReplyImageBatch({
      interaction,
      imageService: imageSvc,
      input: {
        guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        prompt: record.rawPrompt,
        count: requestedCount,
        negativePrompt: record.negativePrompt || undefined,
        ...(record.charCaptions.length > 0 ? { charCaptions: record.charCaptions } : {}),
        ...(record.useCoords ? { useCoords: true } : {}),
        aspectRatio: record.aspectRatio,
        steps: Math.min(MAX_IMAGE_STEPS, record.steps),
        scale: record.scale,
        seed: null,
        spoiler: record.spoiler,
        ephemeral: isPrivate,
        isAdmin: Boolean(actor.isAdmin),
      },
      authorName: interaction.user.displayName,
      authorAvatarUrl: interaction.user.displayAvatarURL(),
      failTitle: '⚠️ 重绘失败',
    });
  }
}

export async function handleImageStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);

  if (interaction.customId === 'img:select_ratio') {
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).imageGen;
    const selected = parseRatioOrDefault(interaction.values[0], cfg.defaultAspectRatio);
    ctx.services.image?.updateUserPrefs(guildId, actor.id, { aspectRatio: selected });
    await interaction.update(buildUserImageMenuView(ctx, guildId, actor, selected, undefined));
    return;
  }

  if (interaction.customId === 'img:history_pick') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'imageGen', 'AI 绘图');
    if (disabledMsg) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', disabledMsg)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const recId = parsePositiveInt(interaction.values[0] ?? '');
    const rec = recId
      ? (ctx.services.image?.getRecordById(recId) ?? ctx.repos.image?.getById(recId) ?? null)
      : null;
    if (!rec || rec.guildId !== guildId) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 记录不存在', '未找到对应的历史出图记录。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const userBatch = ctx.services.image?.getUserPrefs(guildId, actor.id).batchCount ?? 1;
    await interaction.showModal(buildEditImageModal(rec, userBatch));
    return;
  }

  const parts = interaction.customId.split(':');
  if (parts[1] === 'ratio_reroll') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'imageGen', 'AI 绘图');
    if (disabledMsg) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', disabledMsg)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const recId = parsePositiveInt(parts[2] ?? '');
    const requestedCount = parseOptionalBatchCount(parts[3]);
    const record = recId
      ? (ctx.services.image?.getRecordById(recId) ?? ctx.repos.image?.getById(recId) ?? null)
      : null;
    if (!record || record.guildId !== guildId) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 记录不存在', '未找到对应的生图参数记录，请使用 `/画图` 重新生成。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const chosenRatio = interaction.values[0]?.trim() ?? '';
    if (!isValidImageAspectRatio(chosenRatio)) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 比例无效', '请选择有效的画幅比例。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const imageSvc = ctx.services.image;
    if (!imageSvc || !imageSvc.isConfigured()) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 生图未配置', '生图服务尚未配置完成，请联系管理员。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const precheck = imageSvc.precheckRequest({
      guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      isAdmin: Boolean(actor.isAdmin),
    });
    if (!precheck.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 暂无法重绘', precheck.errorMessage)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isPrivate = record.ephemeral;
    await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});

    await executeAndReplyImageBatch({
      interaction,
      imageService: imageSvc,
      input: {
        guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        prompt: record.rawPrompt,
        count: requestedCount,
        negativePrompt: record.negativePrompt,
        ...(record.charCaptions.length > 0 ? { charCaptions: record.charCaptions } : {}),
        ...(record.useCoords ? { useCoords: true } : {}),
        aspectRatio: chosenRatio,
        steps: Math.min(MAX_IMAGE_STEPS, record.steps),
        scale: record.scale,
        seed: null,
        spoiler: record.spoiler,
        ephemeral: isPrivate,
        isAdmin: Boolean(actor.isAdmin),
      },
      authorName: interaction.user.displayName,
      authorAvatarUrl: interaction.user.displayAvatarURL(),
      failTitle: '⚠️ 重绘失败',
    });
  }
}

export async function handleImageModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const parts = interaction.customId.split(':');
  const modalAction = parts[1];
  const actor = await resolveActor(interaction, ctx, guildId);

  const disabledMsg = checkModuleDisabled(ctx, guildId, 'imageGen', 'AI 绘图');
  if (disabledMsg) {
    await interaction.reply({
      embeds: [createErrorEmbed('🚫 模块未开启', disabledMsg)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const imageSvc = ctx.services.image;
  if (!imageSvc || !imageSvc.isConfigured()) {
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 生图未配置', '生图服务尚未配置完成，请联系管理员。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (modalAction === 'modal_prefs') {
    const steps = parseIntInRange(interaction.fields.getTextInputValue('steps'), 1, MAX_IMAGE_STEPS);
    const scale = parseNumberInRange(interaction.fields.getTextInputValue('scale'), 1.0, 10.0);
    const batchCount = parseIntInRange(
      interaction.fields.getTextInputValue('batchCount'),
      1,
      MAX_IMAGE_BATCH_COUNT,
    );
    const negativePrompt = interaction.fields.getTextInputValue('negativePrompt').trim().slice(0, 1000);

    if (steps === null || scale === null || batchCount === null) {
      await respondFromModal(
        interaction,
        buildUserImageMenuView(ctx, guildId, actor, undefined, {
          type: 'error',
          text: `参数无效：步数 1~${MAX_IMAGE_STEPS}，引导系数 1.0~10.0，连续张数 1~${MAX_IMAGE_BATCH_COUNT}。`,
        }),
      );
      return;
    }

    const roundedScale = Number(scale.toFixed(1));
    imageSvc.updateUserPrefs(guildId, actor.id, {
      steps,
      scale: roundedScale,
      batchCount,
      negativePrompt,
    });
    await respondFromModal(
      interaction,
      buildUserImageMenuView(ctx, guildId, actor, undefined, {
        type: 'success',
        text: `已保存个人参数：Steps **${steps}**，Scale **${roundedScale}**，张数 **${batchCount}**${negativePrompt ? '，已更新额外负面词' : '，已清空个人额外负面词'}。`,
      }),
    );
    return;
  }

  if (modalAction === 'modal_create') {
    const eff = resolveEffectiveUserDefaults(ctx, guildId, actor.id);
    const isPrivate = parts[2] === 'priv' ? true : parts[2] === 'pub' ? false : eff.ephemeral;
    const ratio = parseRatioOrDefault(parts[3], eff.ratio);
    const prompt = interaction.fields.getTextInputValue('prompt').trim();
    const charPrompts = readOptionalModalField(interaction, 'charPrompts').trim();
    const negativePrompt = readOptionalModalField(interaction, 'negativePrompt').trim();
    const { steps, scale } = parseModalStepsAndScale(interaction);

    const seedRaw = readOptionalModalField(interaction, 'seed').trim();
    const seed = seedRaw ? parseNonNegativeInt(seedRaw) : null;
    if (seedRaw && (seed === null || seed > 2_147_483_647)) {
      await interaction.reply({
        embeds: [
          createErrorEmbed('❌ 种子无效', 'Seed 需为 0 ~ 2147483647 的整数，或留空自动随机。'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (steps === null || scale === null) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '❌ 参数无效',
            `步数需为 1~${MAX_IMAGE_STEPS} 的整数，引导系数需为 1.0~10.0 的数值（格式如 \`28 | 5.0\`）。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const precheck = imageSvc.precheckRequest({
      guildId,
      channelId: interaction.channelId ?? '',
      userId: interaction.user.id,
      isAdmin: Boolean(actor.isAdmin),
    });
    if (!precheck.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 暂无法生图', precheck.errorMessage)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});
    await executeAndReplyImageBatch({
      interaction,
      imageService: imageSvc,
      input: {
        guildId,
        channelId: interaction.channelId ?? '',
        userId: interaction.user.id,
        prompt,
        count: eff.batchCount,
        ...(charPrompts ? { rawCharacterPrompt: charPrompts } : {}),
        negativePrompt,
        aspectRatio: ratio,
        steps,
        scale,
        seed,
        spoiler: eff.spoiler,
        ephemeral: isPrivate,
        isAdmin: Boolean(actor.isAdmin),
      },
      authorName: interaction.user.displayName,
      authorAvatarUrl: interaction.user.displayAvatarURL(),
    });
    return;
  }

  if (modalAction === 'modal_edit') {
    const recId = parsePositiveInt(parts[2] ?? '');
    const requestedCount = parseOptionalBatchCount(parts[3]);
    const orig = recId ? (imageSvc.getRecordById(recId) ?? ctx.repos.image?.getById(recId)) : null;
    const prompt = interaction.fields.getTextInputValue('prompt').trim();
    const charPrompts = readOptionalModalField(interaction, 'charPrompts').trim();
    const negativePrompt = readOptionalModalField(interaction, 'negativePrompt').trim() || undefined;
    const rawRatio = interaction.fields.getTextInputValue('aspectRatio').trim();
    const { steps, scale } = parseModalStepsAndScale(interaction);

    if (!isValidImageAspectRatio(rawRatio) || steps === null || scale === null) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '❌ 参数无效',
            `比例需为 ${VALID_IMAGE_ASPECT_RATIOS.join(' / ')}，步数需为 1~${MAX_IMAGE_STEPS}，引导系数需为 1.0~10.0（格式如 \`28 | 5.0\`）。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const precheck = imageSvc.precheckRequest({
      guildId,
      channelId: interaction.channelId ?? orig?.channelId ?? '',
      userId: interaction.user.id,
      isAdmin: Boolean(actor.isAdmin),
    });
    if (!precheck.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 暂无法重绘', precheck.errorMessage)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isPrivate = Boolean(orig?.ephemeral);
    await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});
    await executeAndReplyImageBatch({
      interaction,
      imageService: imageSvc,
      input: {
        guildId,
        channelId: interaction.channelId ?? orig?.channelId ?? '',
        userId: interaction.user.id,
        prompt,
        count: requestedCount,
        ...(charPrompts ? { rawCharacterPrompt: charPrompts } : {}),
        negativePrompt,
        aspectRatio: rawRatio,
        steps,
        scale,
        spoiler: Boolean(orig?.spoiler),
        ephemeral: isPrivate,
        isAdmin: Boolean(actor.isAdmin),
      },
      authorName: interaction.user.displayName,
      authorAvatarUrl: interaction.user.displayAvatarURL(),
      failTitle: '⚠️ 重绘失败',
    });
  }
}

export async function tryHandleAdminImageButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
): Promise<boolean> {
  const parts = interaction.customId.split(':');
  const section = parts[1];
  const action = parts[2];

  if (section === 'modal' && action?.startsWith('admin_img_')) {
    if (!actor.isAdmin) {
      await interaction.update(buildAdminImageView(ctx, guildId, actor, ADMIN_DENIED_FEEDBACK));
      return true;
    }
    if (action === 'admin_img_params') {
      await interaction.showModal(buildAdminImgParamsModal(ctx, guildId));
      return true;
    }
    if (action === 'admin_img_prompts') {
      await interaction.showModal(buildAdminImgPromptsModal(ctx, guildId));
      return true;
    }
    if (action === 'admin_img_limits') {
      await interaction.showModal(buildAdminImgLimitsModal(ctx, guildId));
      return true;
    }
  }

  if (section !== 'admin' || !action?.startsWith('img_')) {
    return false;
  }
  if (!actor.isAdmin) {
    await interaction.update(buildAdminImageView(ctx, guildId, actor, ADMIN_DENIED_FEEDBACK));
    return true;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const img = cfg.imageGen;

  if (action === 'img_toggle_spoiler') {
    const next = !img.forceSpoiler;
    ctx.repos.guildConfig.updateImageGen(guildId, { ...img, forceSpoiler: next });
    await interaction.update(
      buildAdminImageView(ctx, guildId, actor, {
        type: 'success',
        text: `已将全局强制剧透遮罩设为：**${next ? '开启' : '关闭'}**。`,
      }),
    );
    return true;
  }

  if (action === 'img_toggle_allowed_here') {
    const chanId = interaction.channelId;
    const exists = img.allowedChannelIds.includes(chanId);
    const nextList = exists
      ? img.allowedChannelIds.filter((id) => id !== chanId)
      : [...img.allowedChannelIds, chanId];
    ctx.repos.guildConfig.updateImageGen(guildId, { ...img, allowedChannelIds: nextList });
    await interaction.update(
      buildAdminImageView(
        ctx,
        guildId,
        actor,
        {
          type: 'success',
          text: exists ? `已将 <#${chanId}> 移出生图白名单。` : `已将 <#${chanId}> 加入生图白名单。`,
        },
        'channels',
      ),
    );
    return true;
  }

  if (action === 'img_clear_allowed') {
    ctx.repos.guildConfig.updateImageGen(guildId, { ...img, allowedChannelIds: [] });
    await interaction.update(
      buildAdminImageView(
        ctx,
        guildId,
        actor,
        { type: 'success', text: '已清空生图白名单限制，现已恢复全服频道可用（除禁用频道）。' },
        'channels',
      ),
    );
    return true;
  }

  if (action === 'img_send_lobby') {
    await interaction.deferUpdate();
    const sent = await sendPublicBroadcast(
      interaction,
      buildImageLobbyMessage(interaction.guild?.name, ctx.services.image?.getGalleryUrl()),
    );
    const feedback: MenuFeedback = sent.sent
      ? { type: 'success', text: '📌 已在当前频道发送永久「打开我的绘图菜单」入口卡片！' }
      : { type: 'error', text: '无法在当前频道发送入口卡片，请检查机器人发言与嵌入链接权限。' };
    await safeEditOrFollowUp(
      interaction,
      buildAdminImageView(ctx, guildId, actor, feedback),
    );
    return true;
  }

  if (action === 'img_reset') {
    ctx.repos.guildConfig.updateImageGen(guildId, {
      ...DEFAULT_IMAGE_GEN_CONFIG,
      allowedChannelIds: img.allowedChannelIds,
      ignoredChannelIds: img.ignoredChannelIds,
    });
    await interaction.update(
      buildAdminImageView(ctx, guildId, actor, {
        type: 'success',
        text: '♻️ 已恢复生图默认参数（含默认 R18 无码与反打码预设，保留频道黑白名单）。',
      }),
    );
    return true;
  }

  return false;
}

export async function tryHandleAdminImageModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
): Promise<boolean> {
  const parts = interaction.customId.split(':');
  if (parts[1] !== 'modal_sub' || !parts[2]?.startsWith('admin_img_')) {
    return false;
  }
  if (!actor.isAdmin) {
    await respondFromModal(interaction, buildAdminImageView(ctx, guildId, actor, ADMIN_DENIED_FEEDBACK));
    return true;
  }

  const modalType = parts[2];
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const img = cfg.imageGen;

  if (modalType === 'admin_img_params') {
    const modelRaw = interaction.fields.getTextInputValue('modelOverride').trim();
    const ratioRaw = interaction.fields.getTextInputValue('defaultAspectRatio').trim();
    const steps = parseIntInRange(
      interaction.fields.getTextInputValue('defaultSteps'),
      1,
      MAX_IMAGE_STEPS,
    );
    const scale = parseNumberInRange(interaction.fields.getTextInputValue('defaultScale'), 1.0, 10.0);
    const cooldownSec = parseIntInRange(interaction.fields.getTextInputValue('cooldownSec'), 0, 600);

    if (!isValidImageAspectRatio(ratioRaw) || steps === null || scale === null || cooldownSec === null) {
      await respondFromModal(
        interaction,
        buildAdminImageView(ctx, guildId, actor, {
          type: 'error',
          text: `参数无效：比例需为 ${VALID_IMAGE_ASPECT_RATIOS.join(' / ')}，步数 1~${MAX_IMAGE_STEPS}，引导系数 1.0~10.0，冷却 0~600。`,
        }),
      );
      return true;
    }

    ctx.repos.guildConfig.updateImageGen(guildId, {
      ...img,
      modelOverride: modelRaw || null,
      defaultAspectRatio: ratioRaw,
      defaultSteps: steps,
      defaultScale: Number(scale.toFixed(1)),
      cooldownSec,
    });
    await respondFromModal(
      interaction,
      buildAdminImageView(ctx, guildId, actor, {
        type: 'success',
        text: `已保存生图参数：模型 \`${modelRaw || '环境变量默认'}\`，比例 **${ratioRaw}**，Steps **${steps}**，Scale **${scale.toFixed(1)}**，冷却 **${cooldownSec}s**。`,
      }),
    );
    return true;
  }

  if (modalType === 'admin_img_prompts') {
    const defaultPositivePrompt = interaction.fields
      .getTextInputValue('defaultPositivePrompt')
      .trim()
      .slice(0, 800);
    const defaultNegativePrompt = interaction.fields
      .getTextInputValue('defaultNegativePrompt')
      .trim()
      .slice(0, 800);
    const defaultCfgRescale = parseNumberInRange(
      interaction.fields.getTextInputValue('defaultCfgRescale'),
      0,
      1.0,
    );

    if (defaultCfgRescale === null) {
      await respondFromModal(
        interaction,
        buildAdminImageView(ctx, guildId, actor, {
          type: 'error',
          text: '参数无效：CFG Rescale 需为 0 ~ 1.0 之间的数值（推荐 0.3）。',
        }),
      );
      return true;
    }

    ctx.repos.guildConfig.updateImageGen(guildId, {
      ...img,
      defaultPositivePrompt,
      defaultNegativePrompt,
      defaultCfgRescale: Number(defaultCfgRescale.toFixed(2)),
    });
    await respondFromModal(
      interaction,
      buildAdminImageView(ctx, guildId, actor, {
        type: 'success',
        text: `已更新默认正负预设词，CFG Rescale 设为 **${defaultCfgRescale.toFixed(2)}**。`,
      }),
    );
    return true;
  }

  if (modalType === 'admin_img_limits') {
    const cooldownSec = parseIntInRange(interaction.fields.getTextInputValue('cooldownSec'), 0, 600);
    const maxConcurrency = parseIntInRange(interaction.fields.getTextInputValue('maxConcurrency'), 1, 5);
    const maxPendingQueue = parseIntInRange(interaction.fields.getTextInputValue('maxPendingQueue'), 1, 20);

    if (cooldownSec === null || maxConcurrency === null || maxPendingQueue === null) {
      await respondFromModal(
        interaction,
        buildAdminImageView(ctx, guildId, actor, {
          type: 'error',
          text: '参数无效：冷却 0~600s，并发上限 1~5，队列上限 1~20。',
        }),
      );
      return true;
    }

    ctx.repos.guildConfig.updateImageGen(guildId, {
      ...img,
      cooldownSec,
      maxConcurrency,
      maxPendingQueue,
    });
    await respondFromModal(
      interaction,
      buildAdminImageView(ctx, guildId, actor, {
        type: 'success',
        text: `已保存限流设置：冷却 **${cooldownSec}s**，并发 **${maxConcurrency}**，队列上限 **${maxPendingQueue}**。`,
      }),
    );
    return true;
  }

  return false;
}

export async function tryHandleAdminImageChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
): Promise<boolean> {
  const parts = interaction.customId.split(':');
  if (parts[1] !== 'chan' || !parts[2]?.startsWith('admin_img_')) {
    return false;
  }
  if (!actor.isAdmin) {
    await interaction.update(
      buildAdminImageView(ctx, guildId, actor, ADMIN_DENIED_FEEDBACK, 'channels'),
    );
    return true;
  }

  const target = parts[2];
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const img = cfg.imageGen;

  if (target === 'admin_img_allowed') {
    const allowedChannelIds = [...interaction.values].slice(0, 10);
    ctx.repos.guildConfig.updateImageGen(guildId, { ...img, allowedChannelIds });
    await interaction.update(
      buildAdminImageView(
        ctx,
        guildId,
        actor,
        {
          type: 'success',
          text:
            allowedChannelIds.length > 0
              ? `已更新生图白名单频道（${allowedChannelIds.length} 个）。`
              : '已清空生图白名单，全服频道均可生图（除禁用频道）。',
        },
        'channels',
      ),
    );
    return true;
  }

  if (target === 'admin_img_ignore') {
    const ignoredChannelIds = [...interaction.values].slice(0, 10);
    ctx.repos.guildConfig.updateImageGen(guildId, { ...img, ignoredChannelIds });
    await interaction.update(
      buildAdminImageView(
        ctx,
        guildId,
        actor,
        {
          type: 'success',
          text:
            ignoredChannelIds.length > 0
              ? `已更新生图禁用频道（${ignoredChannelIds.length} 个）。`
              : '已清空生图禁用频道列表。',
        },
        'channels',
      ),
    );
    return true;
  }

  return false;
}
