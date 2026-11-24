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
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'admin_ai' }));
    return true;
  }

  if (section === 'modal' && (parts[2] === 'admin_ai_persona' || parts[2] === 'admin_ai_params')) {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    if (parts[2] === 'admin_ai_persona') {
      await interaction.showModal(buildAiPersonaModal(cfg.ai));
    } else {
      await interaction.showModal(buildAiParamsModal(cfg.ai, ctx.services.ai.getDefaultModel()));
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
          { type: 'success', text: '已将 AI 人设与频道配置恢复为默认设置（历史记忆库保留）。' },
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
  if (target !== 'admin_ai_free' && target !== 'admin_ai_ignore') {
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

  ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, ignoredChannelIds: channelIds });
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
  if (modalType !== 'admin_ai_persona' && modalType !== 'admin_ai_params') {
    return false;
  }

  if (!actor.isAdmin) {
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
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
