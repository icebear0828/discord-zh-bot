import {
  ActionRowBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { AI_PERSONA_PRESETS } from '../config/defaults.js';
import { COLORS, type AppContext } from './embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
} from './menuShared.js';

const AI_PRESET_LABELS: Record<string, string> = {
  community: AI_PERSONA_PRESETS.community.label,
  roast: AI_PERSONA_PRESETS.roast.label,
  assistant: AI_PERSONA_PRESETS.assistant.label,
  beauty: AI_PERSONA_PRESETS.beauty.label,
  custom: '🛠️ 自定义人格',
};

export function buildAdminAiView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const ai = cfg.ai;
  const aiEnabled = cfg.modules.ai;
  const llmConfigured = ctx.services.ai.isConfigured();
  const defaultModel = ctx.services.ai.getDefaultModel() || '未配置';
  const effectiveModel = ai.modelOverride?.trim() || defaultModel;
  const memCounts = ctx.services.ai.countMemories(guildId);

  const freeText =
    ai.freeChatChannelIds.length > 0
      ? ai.freeChatChannelIds.map((id) => `<#${id}>`).join('、')
      : '未设置（仅支持 @Bot 或回复触发）';
  const allowedText =
    ai.allowedChannelIds.length > 0
      ? ai.allowedChannelIds.map((id) => `<#${id}>`).join('、')
      : '全频道允许（除屏蔽频道）';
  const ignoredText =
    ai.ignoredChannelIds.length > 0
      ? ai.ignoredChannelIds.map((id) => `<#${id}>`).join('、')
      : '无';

  const description = [
    `🔌 **网关状态**：${llmConfigured ? '✅ 已连接配置' : '⚠️ 未配置 `.env` (`LLM_BASE_URL` / `LLM_API_KEY`)'} ｜ **模块总开关**：${aiEnabled ? '✅ 已开启' : '⛔ 已关闭'}`,
    `🎭 **当前人格**：**${ai.personaName}**（预设：${AI_PRESET_LABELS[ai.preset] ?? ai.preset}）`,
    `🤖 **当前模型**：\`${effectiveModel}\`${ai.modelOverride ? '（后台覆盖）' : '（`.env` 默认）'} ｜ 温度 **${ai.temperature}** ｜ MaxTokens **${ai.maxTokens}**`,
    `💬 **上下文与记忆**：滑窗 **${ai.contextWindowMessages}** 条 ｜ 记忆抽取 ${ai.memoryEnabled ? `✅ 开（每域上限 ${ai.maxMemoriesPerScope} 条）` : '⛔ 关'} ｜ 图片识图 ${ai.visionEnabled ? '✅ 开' : '⛔ 关'}`,
    `🧠 **SQLite 记忆库**：共 **${memCounts.total}** 条（用户 ${memCounts.user} / 频道 ${memCounts.channel} / 全服 ${memCounts.guild}）`,
    `🗨️ **免 @ 直聊频道**：${freeText}`,
    `📌 **白名单限定频道**：${allowedText}`,
    `🔕 **屏蔽频道**：${ignoredText}`,
    '',
    `> **人设简介**：${truncateText(ai.identityPrompt, 90)}`,
    `> **说话风格**：${truncateText(ai.soulPrompt, 90)}`,
    ...(ai.worldbook.trim()
      ? [`> **世界书**：${truncateText(ai.worldbook.trim(), 90)}`]
      : []),
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · AI 对话配置中心`, iconURL: actor.avatarUrl })
    .setTitle('🤖 AI 对话与人格记忆管理')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 仅管理员可见；修改立即生效，群友可用 /ai 重置 与 /ai 记忆' })
    .setTimestamp();

  const presetRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu:admin_ai_preset')
      .setPlaceholder('🎭 一键切换内置 AI 人格预设...')
      .addOptions(
        Object.values(AI_PERSONA_PRESETS).map((preset) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(preset.label)
            .setValue(preset.key)
            .setDescription(truncateText(preset.description, 100))
            .setDefault(ai.preset === preset.key),
        ),
      ),
  );

  const freeChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('menu:chan:admin_ai_free')
    .setPlaceholder('🗨️ 设置免 @ 直接对话频道（清空即取消）...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    )
    .setMinValues(0)
    .setMaxValues(10);
  if (ai.freeChatChannelIds.length > 0) {
    freeChanSelect.setDefaultChannels(ai.freeChatChannelIds.slice(0, 10));
  }

  const ignoreChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('menu:chan:admin_ai_ignore')
    .setPlaceholder('🔕 设置 AI 屏蔽频道（清空即取消）...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    )
    .setMinValues(0)
    .setMaxValues(10);
  if (ai.ignoredChannelIds.length > 0) {
    ignoreChanSelect.setDefaultChannels(ai.ignoredChannelIds.slice(0, 10));
  }

  const components: MenuComponentRow[] = [
    presetRow,
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(freeChanSelect),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ignoreChanSelect),
    buttonRow(
      makeButton('menu:modal:admin_ai_persona', '✍️ 编辑人设/世界书', ButtonStyle.Primary),
      makeButton('menu:modal:admin_ai_params', '🎛️ 模型与参数', ButtonStyle.Primary),
      makeButton(
        'menu:admin:ai_toggle_memory',
        `🧠 记忆提取: ${ai.memoryEnabled ? '开' : '关'}`,
        ai.memoryEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
      makeButton(
        'menu:admin:ai_toggle_vision',
        `🖼️ 图片识图: ${ai.visionEnabled ? '开' : '关'}`,
        ai.visionEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
      makeButton('menu:admin:ai_reset_config', '♻️ 恢复默认', ButtonStyle.Danger),
    ),
    buttonRow(
      makeButton(
        'menu:admin:ai_toggle_allowed_here',
        '📌 切换本频道白名单',
        ButtonStyle.Secondary,
      ),
      makeButton(
        'menu:admin:ai_clear_allowed',
        '🌐 解除白名单限制',
        ButtonStyle.Secondary,
        ai.allowedChannelIds.length === 0,
      ),
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  ];

  return { embeds: [embed], components };
}
