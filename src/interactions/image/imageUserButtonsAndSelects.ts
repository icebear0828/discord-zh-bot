import {
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { MAX_IMAGE_BATCH_COUNT, MAX_IMAGE_STEPS } from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import { isValidImageAspectRatio } from '../../services/imageService.js';
import { createErrorEmbed } from '../../ui/embeds.js';
import { buildImageLobbyMessage, buildUserImageMenuView } from '../../ui/imageMenuBuilder.js';
import type { MenuFeedback } from '../../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  parseIntInRange,
  parsePositiveInt,
  resolveActor,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from '../menuHelpers.js';
import {
  executeAndReplyImageBatch,
  parseOptionalBatchCount,
  parseRatioOrDefault,
  resolveEffectiveUserDefaults,
} from './imageBatchReplyRunner.js';
import {
  buildCreateImageModal,
  buildEditImageModal,
  buildUserPrefsModal,
} from './imageModals.js';

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
        embeds: [
          createErrorEmbed('❌ 张数无效', `连续张数需在 1 ~ ${MAX_IMAGE_BATCH_COUNT} 之间。`),
        ],
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
