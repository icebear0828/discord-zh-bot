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
import { MAX_AI_REGEX_RULES, type AiRegexRuleScope } from '../services/aiRegex.js';
import { COLORS, type AppContext } from './embeds.js';
import {
  buttonRow,
  makeButton,
  paginateSlice,
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

const REGEX_SCOPE_LABELS: Record<AiRegexRuleScope, string> = {
  both: '双向',
  input: '仅输入',
  output: '仅输出',
};

const REGEX_PAGE_SIZE = 10;

export function buildAdminAiView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  tab: 'basic' | 'channels' | 'regex' = 'basic',
  regexPage = 1,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const ai = cfg.ai;
  const aiEnabled = cfg.modules.ai;
  const llmConfigured = ctx.services.ai.isConfigured();
  const defaultModel = ctx.services.ai.getDefaultModel() || '未配置';
  const effectiveModel = ai.modelOverride?.trim() || defaultModel;
  const memCounts = ctx.services.ai.countMemories(guildId);
  const enabledRegexCount = ai.regexRules.filter((r) => r.enabled).length;

  if (tab === 'regex') {
    const paged = paginateSlice(ai.regexRules, regexPage, REGEX_PAGE_SIZE);
    const rulesLines =
      paged.slice.length > 0
        ? paged.slice.map((rule) => {
            const status = rule.enabled ? '✅' : '⏸️';
            const scopeLabel = REGEX_SCOPE_LABELS[rule.scope];
            const repText = rule.replacement ? `\`${truncateText(rule.replacement, 24)}\`` : '*(删除)*';
            return `${status} \`${rule.id}\` **[${scopeLabel}] ${rule.label}**\n  \`/${truncateText(rule.pattern, 48)}/${rule.flags}\` → ${repText}`;
          })
        : ['当前没有正则替换规则，可点击下方「➕ 新增正则规则」或「♻️ 恢复默认规则」。'];

    const description = [
      `🧹 **反八股系统提示词**：${ai.antiClichePromptEnabled ? '✅ 已开启' : '⛔ 已关闭'} ｜ **生效规则**：**${enabledRegexCount}/${ai.regexRules.length}** 条（上限 ${MAX_AI_REGEX_RULES} 条）`,
      `📌 **说明**：\`input\`/\`both\` 在发送给 AI 前归一化昵称、@提及、历史消息与记忆；\`output\`/\`both\` 在 AI 回复前清洗八股与代称（自动跳过 \`\`\`代码块\`\`\`）。`,
      '',
      ...rulesLines,
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(resolveColor(COLORS.PRIMARY, feedback))
      .setAuthor({ name: `${actor.displayName} · AI 正则替换与反八股`, iconURL: actor.avatarUrl })
      .setTitle(`🔧 AI 正则规则管理（第 ${paged.page}/${paged.totalPages} 页）`)
      .setDescription(withFeedback(truncateText(description, 4000), feedback))
      .setFooter({ text: '🔒 仅管理员可见；也可在频道用 /ai 正则 管理或测试' })
      .setTimestamp();

    const components: MenuComponentRow[] = [];

    if (paged.slice.length > 0) {
      const toggleSelect = new StringSelectMenuBuilder()
        .setCustomId(`menu:admin_ai_regex_toggle:${paged.page}`)
        .setPlaceholder('🔘 选择一条规则切换启用/停用...')
        .addOptions(
          paged.slice.map((rule) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(truncateText(`${rule.enabled ? '✅' : '⏸️'} [${rule.id}] ${rule.label}`, 100))
              .setValue(rule.id)
              .setDescription(
                truncateText(
                  `${REGEX_SCOPE_LABELS[rule.scope]} | /${rule.pattern}/${rule.flags} → ${rule.replacement || '(删除)'}`,
                  100,
                ),
              ),
          ),
        );
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(toggleSelect));

      const deleteSelect = new StringSelectMenuBuilder()
        .setCustomId(`menu:admin_ai_regex_delete:${paged.page}`)
        .setPlaceholder('🗑️ 选择一条规则永久删除...')
        .addOptions(
          paged.slice.map((rule) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(truncateText(`🗑️ [${rule.id}] ${rule.label}`, 100))
              .setValue(rule.id)
              .setDescription(truncateText(`删除规则 /${rule.pattern}/${rule.flags}`, 100)),
          ),
        );
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(deleteSelect));
    }

    components.push(
      buttonRow(
        makeButton('menu:modal:admin_ai_regex_add', '➕ 新增正则规则', ButtonStyle.Primary),
        makeButton(
          'menu:admin:ai_toggle_cliche_prompt',
          `🧹 反八股提示词: ${ai.antiClichePromptEnabled ? '开' : '关'}`,
          ai.antiClichePromptEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
        makeButton('menu:admin:ai_regex_reset', '♻️ 恢复默认规则', ButtonStyle.Danger),
      ),
    );

    const navButtons = [];
    if (paged.totalPages > 1) {
      navButtons.push(
        makeButton(
          `menu:nav:admin_ai:regex:${Math.max(1, paged.page - 1)}`,
          '⬅️ 上页',
          ButtonStyle.Secondary,
          paged.page <= 1,
        ),
        makeButton(
          `menu:nav:admin_ai:regex:${Math.min(paged.totalPages, paged.page + 1)}`,
          '➡️ 下页',
          ButtonStyle.Secondary,
          paged.page >= paged.totalPages,
        ),
      );
    }
    navButtons.push(
      makeButton('menu:nav:admin_ai:basic', '🎭 人设与参数', ButtonStyle.Primary),
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    );
    components.push(buttonRow(...navButtons));

    return { embeds: [embed], components };
  }

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
    `🔌 **网关状态**：${llmConfigured ? '✅ 已连接配置' : '⚠️ 未配置网关参数'} ｜ **模块总开关**：${aiEnabled ? '✅ 已开启' : '⛔ 已关闭'}`,
    `🎭 **当前人格**：**${ai.personaName}**（预设：${AI_PRESET_LABELS[ai.preset] ?? ai.preset}）`,
    `🤖 **当前模型**：\`${effectiveModel}\`${ai.modelOverride ? '（后台覆盖）' : '（默认）'} ｜ 温度 **${ai.temperature}** ｜ MaxTokens **${ai.maxTokens}**`,
    `💬 **上下文与记忆**：滑窗 **${ai.contextWindowMessages}** 条 ｜ 记忆抽取 ${ai.memoryEnabled ? `✅ 开（每域上限 ${ai.maxMemoriesPerScope} 条）` : '⛔ 关'} ｜ 图片识图 ${ai.visionEnabled ? '✅ 开' : '⛔ 关'}`,
    `🔧 **正则替换与反八股**：启用 **${enabledRegexCount}/${ai.regexRules.length}** 条规则 ｜ 反八股提示词 ${ai.antiClichePromptEnabled ? '✅ 开' : '⛔ 关'}`,
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
    .setTitle(tab === 'channels' ? '📡 AI 频道范围配置（免@ / 白名单 / 屏蔽）' : '🤖 AI 对话与人格记忆管理')
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

  const allowedChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('menu:chan:admin_ai_allowed')
    .setPlaceholder('📌 设置 AI 白名单限定频道（清空即全频道允许）...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    )
    .setMinValues(0)
    .setMaxValues(10);
  if (ai.allowedChannelIds.length > 0) {
    allowedChanSelect.setDefaultChannels(ai.allowedChannelIds.slice(0, 10));
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

  if (tab === 'channels') {
    const components: MenuComponentRow[] = [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(freeChanSelect),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(allowedChanSelect),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(ignoreChanSelect),
      buttonRow(
        makeButton('menu:admin:ai_toggle_allowed_here', '📌 切换本频道白名单', ButtonStyle.Secondary),
        makeButton(
          'menu:admin:ai_clear_allowed',
          '🌐 解除白名单限制',
          ButtonStyle.Secondary,
          ai.allowedChannelIds.length === 0,
        ),
        makeButton('menu:nav:admin_ai:basic', '🎭 人设与参数', ButtonStyle.Primary),
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ];
    return { embeds: [embed], components };
  }

  const components: MenuComponentRow[] = [
    presetRow,
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(allowedChanSelect),
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(freeChanSelect),
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
      makeButton('menu:admin:ai_toggle_allowed_here', '📌 切换本频道白名单', ButtonStyle.Secondary),
      makeButton('menu:nav:admin_ai:regex', '🔧 正则与反八股', ButtonStyle.Primary),
      makeButton('menu:nav:admin_ai:channels', '🔕 屏蔽与全部频道', ButtonStyle.Primary),
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  ];

  return { embeds: [embed], components };
}
