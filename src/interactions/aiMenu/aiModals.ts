import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { AiConfig, AiSelfieConfig, AiUserProfile } from '../../config/defaults.js';
import { MAX_AI_USER_ALIAS_LEN, MAX_AI_USER_NOTE_LEN } from '../../services/aiProfiles.js';
import {
  MAX_AI_REGEX_LABEL_LEN,
  MAX_AI_REGEX_PATTERN_LEN,
  MAX_AI_REGEX_REPLACEMENT_LEN,
} from '../../services/aiRegex.js';
import { truncateText } from '../../ui/menuShared.js';
import { prefilledField } from '../menuHelpers.js';

export const MAX_AI_PERSONA_MODAL_TEXT_LEN = 4000;

export function buildAiPersonaModal(ai: AiConfig): ModalBuilder {
  const worldbookInput = new TextInputBuilder()
    .setCustomId('worldbook')
    .setLabel(truncateText(`群背景与世界书（可选，最多${MAX_AI_PERSONA_MODAL_TEXT_LEN}字）`, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(MAX_AI_PERSONA_MODAL_TEXT_LEN)
    .setPlaceholder('填写本群梗、常用规则、成员关系或固定设定...')
    .setRequired(false);
  if (ai.worldbook.trim()) {
    worldbookInput.setValue(truncateText(ai.worldbook.trim(), MAX_AI_PERSONA_MODAL_TEXT_LEN));
  }

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_ai_persona')
    .setTitle(truncateText('✍️ 编辑 AI 人设与世界书', 45))
    .addComponents(
      prefilledField('personaName', '人格名称（1~32字）', truncateText(ai.personaName, 32), 32),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('identityPrompt')
          .setLabel(truncateText(`身份设定 Identity（1~${MAX_AI_PERSONA_MODAL_TEXT_LEN}字）`, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(MAX_AI_PERSONA_MODAL_TEXT_LEN)
          .setValue(truncateText(ai.identityPrompt, MAX_AI_PERSONA_MODAL_TEXT_LEN))
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('soulPrompt')
          .setLabel(truncateText(`说话风格 Soul（1~${MAX_AI_PERSONA_MODAL_TEXT_LEN}字）`, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(MAX_AI_PERSONA_MODAL_TEXT_LEN)
          .setValue(truncateText(ai.soulPrompt, MAX_AI_PERSONA_MODAL_TEXT_LEN))
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(worldbookInput),
    );
}

export function buildAiParamsModal(
  ai: AiConfig,
  defaultModel: string,
  defaultFallbackModel = '',
): ModalBuilder {
  const fallbackValue =
    ai.fallbackModel !== undefined ? ai.fallbackModel : (defaultFallbackModel || null);
  const modelField = new TextInputBuilder()
    .setCustomId('modelOverride')
    .setLabel(truncateText('主模型 | 兜底模型（留空默认，none关兜底）', 45))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(150)
    .setPlaceholder(
      defaultModel
        ? `默认: ${truncateText(defaultModel, 40)} | 兜底: ${truncateText(fallbackValue || '无', 30)}`
        : '例如：paid/gemini-4-argon | paid/gemini-4-carbon',
    )
    .setRequired(false);
  const leftPrefill = ai.modelOverride?.trim() ?? '';
  const rightPrefill = fallbackValue === null ? 'none' : fallbackValue.trim();
  if (leftPrefill || ai.fallbackModel !== undefined) {
    const combinedPrefill =
      ai.fallbackModel !== undefined
        ? `${leftPrefill} | ${rightPrefill}`.trim()
        : leftPrefill;
    if (combinedPrefill && combinedPrefill !== '|') {
      modelField.setValue(truncateText(combinedPrefill, 150));
    }
  }

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_ai_params')
    .setTitle('🎛️ 调整 AI 模型与上下文参数')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(modelField),
      prefilledField('temperature', '温度 Temperature（0.0 ~ 2.0）', ai.temperature, 8),
      prefilledField('maxTokens', '最大输出 Token（128 ~ 16384）', ai.maxTokens, 8),
      prefilledField('contextWindowMessages', '短期上下文滑窗条数（0 ~ 30）', ai.contextWindowMessages, 4),
      prefilledField('maxMemoriesPerScope', '单作用域记忆上限（5 ~ 100）', ai.maxMemoriesPerScope, 4),
    );
}

export function buildAiRegexAddModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_ai_regex_add')
    .setTitle('➕ 新增 AI 正则替换规则')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel(truncateText(`规则名称（1~${MAX_AI_REGEX_LABEL_LEN}字）`, 45))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(MAX_AI_REGEX_LABEL_LEN)
          .setPlaceholder('例如：昵称简称归一化')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('pattern')
          .setLabel(truncateText(`正则表达式（1~${MAX_AI_REGEX_PATTERN_LEN}字符）`, 45))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(MAX_AI_REGEX_PATTERN_LEN)
          .setPlaceholder('例如：旧昵称A|旧昵称B')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('replacement')
          .setLabel(truncateText(`替换为（留空表示删除，最多${MAX_AI_REGEX_REPLACEMENT_LEN}字）`, 45))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(MAX_AI_REGEX_REPLACEMENT_LEN)
          .setPlaceholder('例如：标准称呼')
          .setRequired(false),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('scope')
          .setLabel(truncateText('生效范围（both / input / output）', 45))
          .setStyle(TextInputStyle.Short)
          .setMinLength(4)
          .setMaxLength(6)
          .setValue('both')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('flags')
          .setLabel(truncateText('正则标志（可选，默认 gi，允许 g/i/m/u）', 45))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(8)
          .setValue('gi')
          .setRequired(false),
      ),
    );
}

export function buildAiPricingModal(ai: AiConfig): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_ai_pricing')
    .setTitle('💲 设置 AI Token 计费单价')
    .addComponents(
      prefilledField(
        'inputPricePer1MUsd',
        truncateText('输入单价（美元 / 1M Tokens，0~1000）', 45),
        ai.inputPricePer1MUsd,
        12,
      ),
      prefilledField(
        'outputPricePer1MUsd',
        truncateText('输出单价（美元 / 1M Tokens，0~1000）', 45),
        ai.outputPricePer1MUsd,
        12,
      ),
    );
}

export function buildAiUserProfileModal(
  targetUserId: string,
  defaultDisplayName: string,
  existing?: AiUserProfile,
): ModalBuilder {
  const noteField = new TextInputBuilder()
    .setCustomId('note')
    .setLabel(truncateText(`一句话态度备注（可选，最多${MAX_AI_USER_NOTE_LEN}字）`, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(MAX_AI_USER_NOTE_LEN)
    .setPlaceholder('例如：本服老大，有人怼他直接反击')
    .setRequired(false);
  if (existing?.note) {
    noteField.setValue(truncateText(existing.note, MAX_AI_USER_NOTE_LEN));
  }

  return new ModalBuilder()
    .setCustomId(`menu:modal_sub:admin_ai_profile_save:${targetUserId}`)
    .setTitle(truncateText(`👤 配置人物档案：${existing?.alias || defaultDisplayName}`, 45))
    .addComponents(
      prefilledField(
        'alias',
        truncateText(`称呼（1~${MAX_AI_USER_ALIAS_LEN}字）`, 45),
        truncateText(existing?.alias || defaultDisplayName, MAX_AI_USER_ALIAS_LEN),
        MAX_AI_USER_ALIAS_LEN,
      ),
      prefilledField(
        'relation',
        truncateText('关系档位（vip 核心偏爱 / friend 熟人 / rival 重点怼）', 45),
        existing?.relation || 'vip',
        10,
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(noteField),
    );
}

export function buildAiSelfieAppearanceModal(selfie: AiSelfieConfig): ModalBuilder {
  const guardField = new TextInputBuilder()
    .setCustomId('silhouetteGuard')
    .setLabel(truncateText('防漂移负权重守卫（可选，末尾自动拼接）', 45))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(400)
    .setPlaceholder('例如：-1.2::kimono lapels covering shoulders::,')
    .setRequired(false);
  if (selfie.customOc.silhouetteGuard.trim()) {
    guardField.setValue(truncateText(selfie.customOc.silhouetteGuard.trim(), 400));
  }

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_ai_selfie_appearance')
    .setTitle(truncateText('✍️ 编辑自定义自设外貌与冷却', 45))
    .addComponents(
      prefilledField(
        'name',
        truncateText('自设名称（1~40字）', 45),
        truncateText(selfie.customOc.name || '自定义专属自设', 40),
        40,
      ),
      prefilledField(
        'cooldownSec',
        truncateText('单人拍照冷却秒数（0 ~ 600，管理员免冷却）', 45),
        selfie.cooldownSec,
        6,
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('appearance')
          .setLabel(truncateText('固定外貌锚点 OC_APPEARANCE（英文Tag）', 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(1500)
          .setValue(truncateText(selfie.customOc.appearance, 1500))
          .setPlaceholder('girl, silver hair, red eyes, hair ornament, slender figure,')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(guardField),
    );
}

export function buildAiSelfieCostumeModal(selfie: AiSelfieConfig): ModalBuilder {
  const upperField = new TextInputBuilder()
    .setCustomId('costumeUpper')
    .setLabel(truncateText('半身服饰 OC_COSTUME_UPPER（留空继承特写）', 45))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1800)
    .setPlaceholder('特写服饰 + 腰封/百褶裙/大腿袜边（不含鞋子）')
    .setRequired(false);
  if (selfie.customOc.costumeUpper.trim()) {
    upperField.setValue(truncateText(selfie.customOc.costumeUpper.trim(), 1800));
  }

  const fullField = new TextInputBuilder()
    .setCustomId('costumeFull')
    .setLabel(truncateText('全身服饰 OC_COSTUME_FULL（留空继承半身）', 45))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(2000)
    .setPlaceholder('半身服饰 + 完整腿袜与鞋履细节（全身立绘与Q版用）')
    .setRequired(false);
  if (selfie.customOc.costumeFull.trim()) {
    fullField.setValue(truncateText(selfie.customOc.costumeFull.trim(), 2000));
  }

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_ai_selfie_costume')
    .setTitle(truncateText('👗 编辑自定义自设三级景别服饰', 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('costumePortrait')
          .setLabel(truncateText('特写服饰 OC_COSTUME_PORTRAIT（领口/肩袖）', 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(1500)
          .setValue(truncateText(selfie.customOc.costumePortrait, 1500))
          .setPlaceholder('仅填颈饰、衣领、肩部与上臂袖口（防全身鞋袜拉远特写镜头）')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(upperField),
      new ActionRowBuilder<TextInputBuilder>().addComponents(fullField),
    );
}
