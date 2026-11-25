import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import {
  AI_PERSONA_PRESETS,
  DEFAULT_AI_CONFIG,
  type AiConfig,
  type AiPersonaPresetKey,
} from '../config/defaults.js';
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

function buildAiParamsModal(ai: AiConfig, defaultModel: string): ModalBuilder {
  const modelField = new TextInputBuilder()
    .setCustomId('modelOverride')
    .setLabel('模型覆盖（留空则使用 .env 默认模型）')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setPlaceholder(defaultModel ? `当前默认: ${truncateText(defaultModel, 60)}` : '例如：gpt-4o-mini')
    .setRequired(false);
  if (ai.modelOverride?.trim()) {
    modelField.setValue(truncateText(ai.modelOverride.trim(), 100));
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
          .setPlaceholder('例如：布丁酱代称→黑吊王')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('pattern')
          .setLabel(truncateText(`正则表达式（1~${MAX_AI_REGEX_PATTERN_LEN}字符）`, 45))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(MAX_AI_REGEX_PATTERN_LEN)
          .setPlaceholder('例如：草莓布丁酱|布丁酱')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('replacement')
          .setLabel(truncateText(`替换为（留空表示删除，最多${MAX_AI_REGEX_REPLACEMENT_LEN}字）`, 45))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(MAX_AI_REGEX_REPLACEMENT_LEN)
          .setPlaceholder('例如：黑吊王')
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
    const tab: 'basic' | 'channels' | 'regex' =
      tabRaw === 'channels' ? 'channels' : tabRaw === 'regex' ? 'regex' : 'basic';
    const parsedPage = parts[4] ? Number.parseInt(parts[4], 10) : 1;
    const regexPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'admin_ai', tab, regexPage }),
    );
    return true;
  }

  if (
    section === 'modal' &&
    (parts[2] === 'admin_ai_persona' ||
      parts[2] === 'admin_ai_params' ||
      parts[2] === 'admin_ai_regex_add')
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
      await interaction.showModal(buildAiParamsModal(cfg.ai, ctx.services.ai.getDefaultModel()));
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
      'ai_toggle_allowed_here',
      'ai_clear_allowed',
      'ai_reset_config',
      'ai_toggle_cliche_prompt',
      'ai_regex_reset',
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
          { type: 'success', text: '已将 AI 人设、正则与频道配置恢复为默认设置（历史记忆库保留）。' },
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

  if (parts[1] !== 'admin_ai_preset') {
    return false;
  }

  if (!actor.isAdmin) {
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  const selected = interaction.values[0] as Exclude<AiPersonaPresetKey, 'custom'> | undefined;
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
  ctx.repos.guildConfig.updateAi(guildId, {
    ...cfg.ai,
    preset: preset.key,
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
    modalType !== 'admin_ai_regex_add'
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

  const modelOverrideRaw = interaction.fields.getTextInputValue('modelOverride').trim();
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
    modelOverride: modelOverrideRaw || null,
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
        text: `已更新 AI 模型与上下文参数（模型：\`${modelOverrideRaw || ctx.services.ai.getDefaultModel() || '默认'}\`，温度 ${Number(temperature.toFixed(2))}）。`,
      },
    ),
  );
  return true;
}
