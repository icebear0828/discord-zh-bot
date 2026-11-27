import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  MAX_IMAGE_BATCH_COUNT,
  MAX_IMAGE_STEPS,
  VALID_IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
} from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import type { ImageGenerationRecord } from '../../db/repositories/imageRepo.js';
import { formatCharacterPromptsText } from '../../services/imagePromptProcessor.js';
import { truncateText } from '../../ui/menuShared.js';
import { prefilledField } from '../menuHelpers.js';

export function buildCreateImageModal(params: {
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

export function buildUserPrefsModal(params: {
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

export function buildEditImageModal(rec: ImageGenerationRecord, requestedCount = 1): ModalBuilder {
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

export function buildAdminImgParamsModal(ctx: AppContext, guildId: string): ModalBuilder {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).imageGen;
  const defaultModel = ctx.services.image?.getDefaultModel() || '';

  const modelInput = new TextInputBuilder()
    .setCustomId('modelOverride')
    .setLabel(truncateText('生图模型覆盖（留空用环境变量默认）', 45))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(120)
    .setPlaceholder(
      defaultModel ? `默认: ${truncateText(defaultModel, 60)}` : 'nai/nai-diffusion-5-full',
    )
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

export function buildAdminImgPromptsModal(ctx: AppContext, guildId: string): ModalBuilder {
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

export function buildAdminImgLimitsModal(ctx: AppContext, guildId: string): ModalBuilder {
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
