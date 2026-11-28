import { MessageFlags, type ModalSubmitInteraction } from 'discord.js';
import {
  MAX_IMAGE_BATCH_COUNT,
  MAX_IMAGE_STEPS,
  VALID_IMAGE_ASPECT_RATIOS,
} from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import {
  downloadInitImageAttachment,
  validateInitAttachmentMeta,
} from '../../services/image/imageInitLoader.js';
import { isValidImageAspectRatio } from '../../services/imageService.js';
import { createErrorEmbed } from '../../ui/embeds.js';
import { buildUserImageMenuView } from '../../ui/imageMenuBuilder.js';
import {
  checkModuleDisabled,
  parseIntInRange,
  parseNonNegativeInt,
  parseNumberInRange,
  parsePositiveInt,
  resolveActor,
  respondFromModal,
} from '../menuHelpers.js';
import {
  executeAndReplyImageBatch,
  parseModalStepsAndScale,
  parseModalStrengthAndNoise,
  parseOptionalBatchCount,
  parseRatioOrDefault,
  pickMessageInitAttachment,
  readOptionalModalField,
  resolveEffectiveUserDefaults,
} from './imageBatchReplyRunner.js';

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
    return;
  }

  if (modalAction === 'modal_i2i') {
    const recId = parsePositiveInt(parts[2] ?? '');
    const requestedCount = parseOptionalBatchCount(parts[3]);
    const orig = recId ? (imageSvc.getRecordById(recId) ?? ctx.repos.image?.getById(recId)) : null;
    const prompt = interaction.fields.getTextInputValue('prompt').trim();
    const charPrompts = readOptionalModalField(interaction, 'charPrompts').trim();
    const negativePrompt = readOptionalModalField(interaction, 'negativePrompt').trim() || undefined;
    const { strength, noise } = parseModalStrengthAndNoise(interaction);
    const { steps, scale } = parseModalStepsAndScale(interaction);

    if (!prompt || strength === null || noise === null || steps === null || scale === null) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '❌ 参数无效',
            `请检查输入：重绘强度 0.05~0.99、噪点 0~0.99（格式如 \`0.6 | 0\`），步数 1~${MAX_IMAGE_STEPS}、引导 1.0~10.0（格式如 \`28 | 5.0\`）。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const att = pickMessageInitAttachment(interaction.message?.attachments);
    if (!att) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '❌ 未找到可用底图',
            '原消息卡片未附带可读取的底图（请改用 `/改图` 重新上传垫图）。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const metaCheck = validateInitAttachmentMeta(att);
    if (!metaCheck.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 底图格式无效', metaCheck.errorMessage)],
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
        embeds: [createErrorEmbed('⚠️ 暂无法改图', precheck.errorMessage)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isPrivate = Boolean(orig?.ephemeral);
    await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});

    const dl = await downloadInitImageAttachment(att);
    if (!dl.ok) {
      await interaction.editReply({
        embeds: [createErrorEmbed('❌ 底图读取失败', dl.errorMessage)],
        components: [],
      });
      return;
    }

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
        ...(charPrompts && orig?.useCoords ? { useCoords: true } : {}),
        negativePrompt,
        aspectRatio: orig?.aspectRatio ?? dl.inferredAspectRatio ?? undefined,
        steps,
        scale,
        initImageDataUrl: dl.dataUrl,
        strength,
        noise,
        spoiler: Boolean(orig?.spoiler),
        ephemeral: isPrivate,
        isAdmin: Boolean(actor.isAdmin),
      },
      authorName: interaction.user.displayName,
      authorAvatarUrl: interaction.user.displayAvatarURL(),
      failTitle: '⚠️ 改图失败',
    });
  }
}
