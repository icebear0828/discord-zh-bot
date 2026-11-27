import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import {
  AI_PERSONA_PRESETS,
  DEFAULT_AI_CONFIG,
  DEFAULT_AI_SELFIE_CONFIG,
  DEFAULT_CUSTOM_OC_CONFIG,
  type AiConfig,
  type AiPersonaPresetKey,
  type AiSelfieConfig,
  type AiUserProfile,
} from '../config/defaults.js';
import {
  normalizeOcAppearance,
  normalizeOcCostumeTier,
} from '../services/aiOcSelfie.js';
import {
  formatAiRelationBadge,
  MAX_AI_USER_ALIAS_LEN,
  MAX_AI_USER_NOTE_LEN,
} from '../services/aiProfiles.js';
import {
  cloneDefaultAiRegexRules,
  isValidAiRegexScope,
  MAX_AI_REGEX_LABEL_LEN,
  MAX_AI_REGEX_PATTERN_LEN,
  MAX_AI_REGEX_REPLACEMENT_LEN,
  type AiRegexRuleScope,
} from '../services/aiRegex.js';
import type { AppContext } from '../ui/embeds.js';
import { buildMenuMessage } from '../ui/menuBuilder.js';
import { truncateText, type MenuActor } from '../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  parseIntInRange,
  parseNumberInRange,
  prefilledField,
  respondFromModal,
} from './menuHelpers.js';

function buildAiPersonaModal(ai: AiConfig): ModalBuilder {
  const worldbookInput = new TextInputBuilder()
    .setCustomId('worldbook')
    .setLabel('群背景与世界书（可选，最多1000字）')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setPlaceholder('填写本群梗、常用规则、成员关系或固定设定...')
    .setRequired(false);
  if (ai.worldbook.trim()) {
    worldbookInput.setValue(truncateText(ai.worldbook.trim(), 1000));
  }

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_ai_persona')
    .setTitle('✍️ 编辑 AI 人设与世界书')
    .addComponents(
      prefilledField('personaName', '人格名称（1~32字）', truncateText(ai.personaName, 32), 32),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('identityPrompt')
          .setLabel('身份设定 Identity（1~500字）')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(500)
          .setValue(truncateText(ai.identityPrompt, 500))
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('soulPrompt')
          .setLabel('说话风格 Soul（1~500字）')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(500)
          .setValue(truncateText(ai.soulPrompt, 500))
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(worldbookInput),
    );
}

function buildAiParamsModal(
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
        : '例如：pg/gemini-4-argon | pg/gemini-4-carbon',
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
      prefilledField('maxTokens', '最大输出 Token（128 ~ 8192）', ai.maxTokens, 8),
      prefilledField('contextWindowMessages', '短期上下文滑窗条数（0 ~ 30）', ai.contextWindowMessages, 4),
      prefilledField('maxMemoriesPerScope', '单作用域记忆上限（5 ~ 100）', ai.maxMemoriesPerScope, 4),
    );
}

function buildAiRegexAddModal(): ModalBuilder {
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

function buildAiPricingModal(ai: AiConfig): ModalBuilder {
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

function buildAiUserProfileModal(
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

function buildAiSelfieAppearanceModal(selfie: AiSelfieConfig): ModalBuilder {
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

function buildAiSelfieCostumeModal(selfie: AiSelfieConfig): ModalBuilder {
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

export async function tryHandleAiMenuButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const section = parts[1];

  if (section === 'nav' && parts[2] === 'admin_ai') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const tabRaw = parts[3];
    const tab: 'basic' | 'channels' | 'regex' | 'usage' | 'profiles' | 'selfie' =
      tabRaw === 'channels'
        ? 'channels'
        : tabRaw === 'regex'
          ? 'regex'
          : tabRaw === 'usage'
            ? 'usage'
            : tabRaw === 'profiles'
              ? 'profiles'
              : tabRaw === 'selfie'
                ? 'selfie'
                : 'basic';
    const parsedPage = parts[4] ? Number.parseInt(parts[4], 10) : 1;
    const safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, {
        page: 'admin_ai',
        tab,
        regexPage: tab === 'regex' ? safePage : 1,
        profilePage: tab === 'profiles' ? safePage : 1,
      }),
    );
    return true;
  }

  if (
    section === 'modal' &&
    (parts[2] === 'admin_ai_persona' ||
      parts[2] === 'admin_ai_params' ||
      parts[2] === 'admin_ai_regex_add' ||
      parts[2] === 'admin_ai_pricing' ||
      parts[2] === 'admin_ai_selfie_appearance' ||
      parts[2] === 'admin_ai_selfie_costume')
  ) {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    if (parts[2] === 'admin_ai_persona') {
      await interaction.showModal(buildAiPersonaModal(cfg.ai));
    } else if (parts[2] === 'admin_ai_params') {
      await interaction.showModal(
        buildAiParamsModal(
          cfg.ai,
          ctx.services.ai.getDefaultModel(),
          ctx.services.ai.getFallbackModel(),
        ),
      );
    } else if (parts[2] === 'admin_ai_pricing') {
      await interaction.showModal(buildAiPricingModal(cfg.ai));
    } else if (parts[2] === 'admin_ai_selfie_appearance') {
      await interaction.showModal(buildAiSelfieAppearanceModal(cfg.ai.selfie));
    } else if (parts[2] === 'admin_ai_selfie_costume') {
      await interaction.showModal(buildAiSelfieCostumeModal(cfg.ai.selfie));
    } else {
      await interaction.showModal(buildAiRegexAddModal());
    }
    return true;
  }

  if (section === 'admin') {
    const action = parts[2];
    const handled = new Set([
      'ai_toggle_memory',
      'ai_toggle_vision',
      'ai_toggle_selfie',
      'ai_toggle_selfie_nsfw',
      'ai_toggle_allowed_here',
      'ai_clear_allowed',
      'ai_reset_config',
      'ai_toggle_cliche_prompt',
      'ai_regex_reset',
      'ai_clear_usage',
    ]);
    if (!action || !handled.has(action)) {
      return false;
    }

    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (action === 'ai_toggle_memory') {
      const next = !cfg.ai.memoryEnabled;
      ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, memoryEnabled: next });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          { type: 'success', text: `AI 自动长期记忆提取已切换为：**${next ? '开启' : '关闭'}**。` },
        ),
      );
      return true;
    }

    if (action === 'ai_toggle_vision') {
      const next = !cfg.ai.visionEnabled;
      ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, visionEnabled: next });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          { type: 'success', text: `AI 图片识图能力已切换为：**${next ? '开启' : '关闭'}**。` },
        ),
      );
      return true;
    }

    if (action === 'ai_toggle_selfie') {
      const next = !cfg.ai.selfie.enabled;
      ctx.repos.guildConfig.updateAi(guildId, {
        ...cfg.ai,
        selfie: { ...cfg.ai.selfie, enabled: next },
      });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'selfie' },
          {
            type: 'success',
            text: `AI 聊天自设生图已切换为：**${next ? '开启' : '关闭'}**。`,
          },
        ),
      );
      return true;
    }

    if (action === 'ai_toggle_selfie_nsfw') {
      const next = !cfg.ai.selfie.allowNsfw;
      ctx.repos.guildConfig.updateAi(guildId, {
        ...cfg.ai,
        selfie: { ...cfg.ai.selfie, allowNsfw: next },
      });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'selfie' },
          {
            type: 'success',
            text: next
              ? '已开启 **🔞 R18 遮罩模式**：日常默认 SFW，群友明确索要 R18 时启用无码词并自动打模糊遮罩。'
              : '已切换为 **🔒 严格 SFW 模式**：聊天自设生图一律禁止裸露色情标签。',
          },
        ),
      );
      return true;
    }

    if (action === 'ai_toggle_allowed_here') {
      const channelId = interaction.channelId;
      if (!channelId) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ai' },
            { type: 'error', text: '无法识别当前频道 ID。' },
          ),
        );
        return true;
      }
      const set = new Set(cfg.ai.allowedChannelIds);
      const added = !set.has(channelId);
      if (added) {
        set.add(channelId);
      } else {
        set.delete(channelId);
      }
      ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, allowedChannelIds: [...set] });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          {
            type: 'success',
            text: added
              ? `已将 <#${channelId}> 加入 AI 白名单频道。`
              : `已将 <#${channelId}> 移出 AI 白名单频道。`,
          },
        ),
      );
      return true;
    }

    if (action === 'ai_clear_allowed') {
      ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, allowedChannelIds: [] });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          { type: 'success', text: '已清空 AI 频道白名单限制，现在全服频道均可触发（除屏蔽频道）。' },
        ),
      );
      return true;
    }

    if (action === 'ai_reset_config') {
      ctx.repos.guildConfig.updateAi(guildId, {
        ...DEFAULT_AI_CONFIG,
        antiClichePromptEnabled: true,
        regexRules: cloneDefaultAiRegexRules(),
        userProfiles: cfg.ai.userProfiles,
        selfie: {
          ...DEFAULT_AI_SELFIE_CONFIG,
          customOc: { ...DEFAULT_CUSTOM_OC_CONFIG },
        },
        freeChatChannelIds: [],
        allowedChannelIds: [],
        ignoredChannelIds: [],
      });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          {
            type: 'success',
            text: '已将 AI 人设、正则与频道配置恢复为默认设置（人物档案与历史记忆库已保留）。',
          },
        ),
      );
      return true;
    }

    if (action === 'ai_toggle_cliche_prompt') {
      const next = ctx.services.ai.toggleAntiClichePrompt(guildId);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'regex', regexPage: 1 },
          {
            type: 'success',
            text: `AI 全局反八股系统提示词已切换为：**${next ? '开启' : '关闭'}**。`,
          },
        ),
      );
      return true;
    }

    if (action === 'ai_regex_reset') {
      const rules = ctx.services.ai.resetRegexRules(guildId);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'regex', regexPage: 1 },
          {
            type: 'success',
            text: `已恢复默认的 **${rules.length}** 条代称与反八股正则规则，并开启反八股提示词。`,
          },
        ),
      );
      return true;
    }

    if (action === 'ai_clear_usage') {
      const deleted = ctx.services.ai.clearUsageLogs(guildId);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'usage' },
          {
            type: 'success',
            text: `已清空本服 AI 用量日志，共移除 **${deleted}** 条记录。`,
          },
        ),
      );
      return true;
    }
  }

  return false;
}

export async function tryHandleAiMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  if (parts[1] === 'admin_ai_regex_toggle' || parts[1] === 'admin_ai_regex_delete') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const parsedPage = parts[2] ? Number.parseInt(parts[2], 10) : 1;
    const regexPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const ruleId = interaction.values[0];
    if (!ruleId) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'regex', regexPage },
          { type: 'error', text: '未选择任何正则规则。' },
        ),
      );
      return true;
    }

    if (parts[1] === 'admin_ai_regex_toggle') {
      const res = ctx.services.ai.toggleRegexRule(guildId, ruleId);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'regex', regexPage },
          res.ok
            ? {
                type: 'success',
                text: `规则 \`${res.rule.id}\`（${res.rule.label}）已切换为：**${res.rule.enabled ? '启用' : '停用'}**。`,
              }
            : { type: 'error', text: res.error },
        ),
      );
      return true;
    }

    const res = ctx.services.ai.deleteRegexRule(guildId, ruleId);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'regex', regexPage },
        res.ok
          ? {
              type: 'success',
              text: `已删除正则规则 \`${res.rule.id}\`（${res.rule.label}）。`,
            }
          : { type: 'error', text: res.error },
      ),
    );
    return true;
  }

  if (parts[1] === 'admin_ai_profile_delete') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const parsedPage = parts[2] ? Number.parseInt(parts[2], 10) : 1;
    const profilePage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const targetUserId = interaction.values[0];
    if (!targetUserId) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'profiles', profilePage },
          { type: 'error', text: '未选择任何人物档案。' },
        ),
      );
      return true;
    }

    const res = ctx.services.ai.deleteUserProfile(guildId, targetUserId);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'profiles', profilePage },
        res.ok
          ? {
              type: 'success',
              text: `已删除 <@${res.profile.userId}>（**${res.profile.alias}**）的人物档案。`,
            }
          : { type: 'error', text: res.error },
      ),
    );
    return true;
  }

  if (parts[1] === 'admin_ai_selfie_preset') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const chosen = interaction.values[0] ?? '';
    if (chosen === 'nav:selfie') {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'admin_ai', tab: 'selfie' }),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    if (chosen.startsWith('preset:')) {
      const nextPreset = chosen.slice('preset:'.length).trim();
      const matchedExternal =
        nextPreset === 'custom'
          ? null
          : ctx.services.ai.listOcProfiles().find((p) => p.id === nextPreset) ?? null;

      if (nextPreset === 'custom' || matchedExternal) {
        ctx.repos.guildConfig.updateAi(guildId, {
          ...cfg.ai,
          selfie: {
            ...cfg.ai.selfie,
            enabled: true,
            ocPreset: nextPreset,
          },
        });
        const label = matchedExternal
          ? matchedExternal.name
          : `✍️ ${cfg.ai.selfie.customOc.name || '自定义专属自设'}`;
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ai', tab: 'selfie' },
            {
              type: 'success',
              text: `已切换聊天自设（OC）为：**${label}**（聊天拍照技能已开启）。`,
            },
          ),
        );
        return true;
      }
    }

    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'selfie' },
        { type: 'error', text: '无效的自设预设选项。' },
      ),
    );
    return true;
  }

  if (parts[1] !== 'admin_ai_preset') {
    return false;
  }

  if (!actor.isAdmin) {
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  const rawSelected = interaction.values[0];
  if (rawSelected?.startsWith('card:')) {
    const cardId = rawSelected.slice('card:'.length);
    const res = ctx.services.ai.setGuildActiveCard(guildId, cardId);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        res.ok
          ? {
              type: 'success',
              text: `已切换全服角色卡为：**${res.card.personaName}**（\`${res.card.id}@v${res.card.version}\`）。`,
            }
          : { type: 'error', text: res.error },
      ),
    );
    return true;
  }

  const selected = rawSelected as Exclude<AiPersonaPresetKey, 'custom'> | undefined;
  const preset = selected ? AI_PERSONA_PRESETS[selected] : undefined;
  if (!preset) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        { type: 'error', text: '无效的 AI 人格预设选项。' },
      ),
    );
    return true;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const matchingDiskCard = ctx.services.ai.getPackStore()?.getCard(preset.key) ?? null;
  if (matchingDiskCard) {
    ctx.repos.guildConfig.updateAi(guildId, {
      ...cfg.ai,
      preset: preset.key,
      activeCardId: matchingDiskCard.id,
      personaName: matchingDiskCard.personaName,
      identityPrompt: matchingDiskCard.identityPrompt,
      soulPrompt: matchingDiskCard.soulPrompt,
      worldbook: matchingDiskCard.worldbook || cfg.ai.worldbook,
    });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        {
          type: 'success',
          text: `已切换 AI 角色卡为：**${matchingDiskCard.name}**（\`v${matchingDiskCard.version}\`）。`,
        },
      ),
    );
    return true;
  }

  ctx.repos.guildConfig.updateAi(guildId, {
    ...cfg.ai,
    preset: preset.key,
    activeCardId: null,
    personaName: preset.personaName,
    identityPrompt: preset.identityPrompt,
    soulPrompt: preset.soulPrompt,
  });

  await interaction.update(
    buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'admin_ai' },
      { type: 'success', text: `已切换 AI 人格预设为：**${preset.label}**。` },
    ),
  );
  return true;
}

export async function tryHandleAiMenuChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  if (parts[1] !== 'chan') {
    return false;
  }
  const target = parts[2];
  if (
    target !== 'admin_ai_free' &&
    target !== 'admin_ai_allowed' &&
    target !== 'admin_ai_ignore'
  ) {
    return false;
  }

  if (!actor.isAdmin) {
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  const channelIds = [...new Set(interaction.values)].slice(0, 10);
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (target === 'admin_ai_free') {
    ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, freeChatChannelIds: channelIds });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        {
          type: 'success',
          text:
            channelIds.length > 0
              ? `已更新免 @ 直聊频道：${channelIds.map((id) => `<#${id}>`).join('、')}`
              : '已清空免 @ 直聊频道（恢复为仅 @Bot 或回复触发）。',
        },
      ),
    );
    return true;
  }

  if (target === 'admin_ai_allowed') {
    ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, allowedChannelIds: channelIds });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        {
          type: 'success',
          text:
            channelIds.length > 0
              ? `已更新 AI 白名单限定频道：${channelIds.map((id) => `<#${id}>`).join('、')}`
              : '已清空 AI 频道白名单限制（全频道可用，除屏蔽频道）。',
        },
      ),
    );
    return true;
  }

  ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, ignoredChannelIds: channelIds });
  await interaction.update(
    buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'admin_ai', tab: 'channels' },
      {
        type: 'success',
        text:
          channelIds.length > 0
            ? `已更新 AI 屏蔽频道：${channelIds.map((id) => `<#${id}>`).join('、')}`
            : '已清空 AI 屏蔽频道列表。',
      },
    ),
  );
  return true;
}

export async function tryHandleAiMenuUserSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
  targetId: string,
  targetIsBot: boolean,
): Promise<boolean> {
  if (parts[1] !== 'user' || parts[2] !== 'admin_ai_profile_pick') {
    return false;
  }

  if (!actor.isAdmin) {
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  if (targetIsBot) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'profiles', profilePage: 1 },
        { type: 'error', text: '只能为真实群友配置人物档案，不能选择机器人账号。' },
      ),
    );
    return true;
  }

  const targetUser = interaction.users.get(targetId) ?? interaction.users.first();
  const member = interaction.members?.get?.(targetId);
  const memberDisplayName =
    member && 'displayName' in member && typeof member.displayName === 'string'
      ? member.displayName
      : undefined;
  const fallbackName =
    memberDisplayName?.trim() || targetUser?.displayName?.trim() || targetUser?.username || '群友';
  const existing = ctx.services.ai.listUserProfiles(guildId).find((p) => p.userId === targetId);

  await interaction.showModal(buildAiUserProfileModal(targetId, fallbackName, existing));
  return true;
}

export async function tryHandleAiMenuModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  if (parts[1] !== 'modal_sub') {
    return false;
  }
  const modalType = parts[2];
  if (
    modalType !== 'admin_ai_persona' &&
    modalType !== 'admin_ai_params' &&
    modalType !== 'admin_ai_regex_add' &&
    modalType !== 'admin_ai_pricing' &&
    modalType !== 'admin_ai_profile_save' &&
    modalType !== 'admin_ai_selfie_appearance' &&
    modalType !== 'admin_ai_selfie_costume'
  ) {
    return false;
  }

  if (!actor.isAdmin) {
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  if (modalType === 'admin_ai_profile_save') {
    const targetUserId = parts[3] ?? '';
    const alias = interaction.fields.getTextInputValue('alias');
    const relation = interaction.fields.getTextInputValue('relation');
    const note = interaction.fields.getTextInputValue('note');

    const res = ctx.services.ai.upsertUserProfile(guildId, {
      userId: targetUserId,
      alias,
      relation,
      note,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'profiles', profilePage: 1 },
        res.ok
          ? {
              type: 'success',
              text: `${res.updated ? '已更新' : '已新增'} ${formatAiRelationBadge(res.profile.relation)} <@${res.profile.userId}> · **${res.profile.alias}**`,
            }
          : { type: 'error', text: res.error },
      ),
    );
    return true;
  }

  if (modalType === 'admin_ai_pricing') {
    const inputPrice = parseNumberInRange(
      interaction.fields.getTextInputValue('inputPricePer1MUsd'),
      0,
      1000,
    );
    const outputPrice = parseNumberInRange(
      interaction.fields.getTextInputValue('outputPricePer1MUsd'),
      0,
      1000,
    );
    if (inputPrice === null || outputPrice === null) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'usage' },
          { type: 'error', text: '单价无效：输入与输出每 1M Tokens 单价均需在 0 ~ 1000 美元之间。' },
        ),
      );
      return true;
    }

    ctx.services.ai.updatePricing(guildId, inputPrice, outputPrice);
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'usage' },
        {
          type: 'success',
          text: `已更新 AI 计费单价：输入 **$${Number(inputPrice.toFixed(4))}**/1M ｜ 输出 **$${Number(outputPrice.toFixed(4))}**/1M。`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_ai_regex_add') {
    const label = interaction.fields.getTextInputValue('label').trim();
    const pattern = interaction.fields.getTextInputValue('pattern').trim();
    const replacement = interaction.fields.getTextInputValue('replacement');
    const scopeRaw = interaction.fields.getTextInputValue('scope').trim().toLowerCase();
    const flags = interaction.fields.getTextInputValue('flags').trim();

    if (!isValidAiRegexScope(scopeRaw)) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'regex', regexPage: 1 },
          { type: 'error', text: '生效范围无效，请填写 `both`、`input` 或 `output`。' },
        ),
      );
      return true;
    }

    const res = ctx.services.ai.addRegexRule(guildId, {
      label,
      pattern,
      replacement,
      scope: scopeRaw as AiRegexRuleScope,
      flags,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'regex', regexPage: 1 },
        res.ok
          ? {
              type: 'success',
              text: `已新增规则 \`${res.rule.id}\` **${res.rule.label}**：\`/${res.rule.pattern}/${res.rule.flags}\` → ${res.rule.replacement ? `\`${res.rule.replacement}\`` : '*(删除)*'}`,
            }
          : { type: 'error', text: res.error },
      ),
    );
    return true;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (modalType === 'admin_ai_selfie_appearance') {
    const name = interaction.fields.getTextInputValue('name').trim().slice(0, 40);
    const cooldownSec = parseIntInRange(
      interaction.fields.getTextInputValue('cooldownSec'),
      0,
      600,
    );
    const rawAppearance = interaction.fields.getTextInputValue('appearance').trim();
    const silhouetteGuard = interaction.fields.getTextInputValue('silhouetteGuard').trim();

    if (!name || cooldownSec === null || !rawAppearance) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'selfie' },
          { type: 'error', text: '参数无效：自设名称与外貌锚点不能为空，冷却需在 0 ~ 600 秒之间。' },
        ),
      );
      return true;
    }

    const normalizedAppearance = normalizeOcAppearance(rawAppearance);
    ctx.repos.guildConfig.updateAi(guildId, {
      ...cfg.ai,
      selfie: {
        ...cfg.ai.selfie,
        enabled: true,
        ocPreset: 'custom',
        cooldownSec,
        customOc: {
          ...cfg.ai.selfie.customOc,
          name,
          appearance: normalizedAppearance,
          silhouetteGuard: silhouetteGuard.slice(0, 400),
        },
      },
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'selfie' },
        {
          type: 'success',
          text: `已保存并启用自定义自设 **${name}**（冷却 **${cooldownSec}s**，外貌锚点已规范化）。`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_ai_selfie_costume') {
    const rawPortrait = interaction.fields.getTextInputValue('costumePortrait').trim();
    const rawUpper = interaction.fields.getTextInputValue('costumeUpper').trim();
    const rawFull = interaction.fields.getTextInputValue('costumeFull').trim();

    const portrait = normalizeOcCostumeTier(rawPortrait);
    if (!portrait) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai', tab: 'selfie' },
          { type: 'error', text: '特写服饰（OC_COSTUME_PORTRAIT）不能为空。' },
        ),
      );
      return true;
    }

    const upper = normalizeOcCostumeTier(rawUpper) || portrait;
    const full = normalizeOcCostumeTier(rawFull) || upper;

    ctx.repos.guildConfig.updateAi(guildId, {
      ...cfg.ai,
      selfie: {
        ...cfg.ai.selfie,
        enabled: true,
        ocPreset: 'custom',
        customOc: {
          ...cfg.ai.selfie.customOc,
          costumePortrait: portrait,
          costumeUpper: upper,
          costumeFull: full,
        },
      },
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'selfie' },
        {
          type: 'success',
          text: `已更新自定义自设 **${cfg.ai.selfie.customOc.name}** 的三级景别服饰配置！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_ai_persona') {
    const personaName = interaction.fields.getTextInputValue('personaName').trim();
    const identityPrompt = interaction.fields.getTextInputValue('identityPrompt').trim();
    const soulPrompt = interaction.fields.getTextInputValue('soulPrompt').trim();
    const worldbook = interaction.fields.getTextInputValue('worldbook').trim();

    if (!personaName || !identityPrompt || !soulPrompt) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ai' },
          { type: 'error', text: '人格名称、身份设定与说话风格均不能为空。' },
        ),
      );
      return true;
    }

    ctx.repos.guildConfig.updateAi(guildId, {
      ...cfg.ai,
      preset: 'custom',
      activeCardId: null,
      personaName,
      identityPrompt,
      soulPrompt,
      worldbook,
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        { type: 'success', text: `已保存自定义人格 **${personaName}** 与世界书设定！` },
      ),
    );
    return true;
  }

  const modelInputRaw = interaction.fields.getTextInputValue('modelOverride').trim();
  let nextModelOverride: string | null = modelInputRaw || null;
  let nextFallbackModel: string | null = cfg.ai.fallbackModel;
  if (modelInputRaw.includes('|')) {
    const [leftRaw, ...rightParts] = modelInputRaw.split('|');
    const left = leftRaw?.trim() ?? '';
    const right = rightParts.join('|').trim();
    nextModelOverride = left || null;
    if (!right || /^(none|off|false|-)$/i.test(right)) {
      nextFallbackModel = null;
    } else {
      nextFallbackModel = right;
    }
  }
  const temperature = parseNumberInRange(
    interaction.fields.getTextInputValue('temperature'),
    0,
    2,
  );
  const maxTokens = parseIntInRange(
    interaction.fields.getTextInputValue('maxTokens'),
    128,
    8192,
  );
  const contextWindowMessages = parseIntInRange(
    interaction.fields.getTextInputValue('contextWindowMessages'),
    0,
    30,
  );
  const maxMemoriesPerScope = parseIntInRange(
    interaction.fields.getTextInputValue('maxMemoriesPerScope'),
    5,
    100,
  );

  if (
    temperature === null ||
    maxTokens === null ||
    contextWindowMessages === null ||
    maxMemoriesPerScope === null
  ) {
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        {
          type: 'error',
          text: '参数格式无效：温度需在 0~2，MaxTokens 128~8192，上下文条数 0~30，记忆上限 5~100。',
        },
      ),
    );
    return true;
  }

  ctx.repos.guildConfig.updateAi(guildId, {
    ...cfg.ai,
    modelOverride: nextModelOverride,
    fallbackModel: nextFallbackModel,
    temperature: Number(temperature.toFixed(2)),
    maxTokens,
    contextWindowMessages,
    maxMemoriesPerScope,
  });

  await respondFromModal(
    interaction,
    buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'admin_ai' },
      {
        type: 'success',
        text: `已更新 AI 模型与上下文参数（主模型：\`${nextModelOverride || ctx.services.ai.getDefaultModel() || '默认'}\`，兜底：\`${nextFallbackModel || '无'}\`，温度 ${Number(temperature.toFixed(2))}）。`,
      },
    ),
  );
  return true;
}
