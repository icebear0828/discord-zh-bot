import type {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import {
  DEFAULT_IMAGE_GEN_CONFIG,
  MAX_IMAGE_STEPS,
  VALID_IMAGE_ASPECT_RATIOS,
} from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import { isValidImageAspectRatio } from '../../services/imageService.js';
import { buildAdminImageView, buildImageLobbyMessage } from '../../ui/imageMenuBuilder.js';
import type { MenuActor, MenuFeedback } from '../../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  parseIntInRange,
  parseNumberInRange,
  respondFromModal,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from '../menuHelpers.js';
import {
  buildAdminImgLimitsModal,
  buildAdminImgParamsModal,
  buildAdminImgPromptsModal,
} from './imageModals.js';

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
