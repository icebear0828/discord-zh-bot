import {
  ActionRowBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { AI_PERSONA_PRESETS } from '../config/defaults.js';
import {
  formatAiRelationBadge,
  MAX_AI_USER_PROFILES,
} from '../services/aiProfiles.js';
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
const PROFILE_PAGE_SIZE = 10;

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0.0000';
  if (amount < 0.01) return `$${amount.toFixed(6)}`;
  return `$${amount.toFixed(4)}`;
}

export function buildAdminAiView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  tab: 'basic' | 'channels' | 'regex' | 'usage' | 'profiles' = 'basic',
  regexPage = 1,
  profilePage = 1,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const ai = cfg.ai;
  const aiEnabled = cfg.modules.ai;
  const llmConfigured = ctx.services.ai.isConfigured();
  const defaultModel = ctx.services.ai.getDefaultModel() || '未配置';
  const effectiveModel = ai.modelOverride?.trim() || defaultModel;
  const memCounts = ctx.services.ai.countMemories(guildId);
  const enabledRegexCount = ai.regexRules.filter((r) => r.enabled).length;
  const usage24h = ctx.services.ai.getUsageSummary(guildId, 24);

  if (tab === 'profiles') {
    const paged = paginateSlice(ai.userProfiles, profilePage, PROFILE_PAGE_SIZE);
    const lines =
      paged.slice.length > 0
        ? paged.slice.map((p) => {
            const badge = formatAiRelationBadge(p.relation);
            const noteStr = p.note ? `\n  备注：${p.note}` : '';
            return `• ${badge} <@${p.userId}> · **${p.alias}**${noteStr}`;
          })
        : ['当前还没有配置任何人物档案，请在下方直接选择一名群友添加。'];

    const description = [
      `👥 **已绑定人物档案**：**${ai.userProfiles.length}/${MAX_AI_USER_PROFILES}** 人`,
      `📌 **说明**：按 Discord 账号 ID 精确绑定称呼、关系档位（核心偏爱 / 熟人 / 重点怼）与态度备注，群友改昵称也不会认错人，且仅在本轮对话出场时自动注入。`,
      '',
      ...lines,
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(resolveColor(COLORS.PRIMARY, feedback))
      .setAuthor({ name: `${actor.displayName} · AI 精确人物关系档案`, iconURL: actor.avatarUrl })
      .setTitle(`👤 AI 人物档案管理（第 ${paged.page}/${paged.totalPages} 页）`)
      .setDescription(withFeedback(truncateText(description, 4000), feedback))
      .setFooter({ text: '🔒 仅管理员可见；也可在频道用 /ai 档案 查看/设置/删除' })
      .setTimestamp();

    const components: MenuComponentRow[] = [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('menu:user:admin_ai_profile_pick')
          .setPlaceholder('👤 选择一名群友新增或编辑人物档案...')
          .setMinValues(1)
          .setMaxValues(1),
      ),
    ];

    if (paged.slice.length > 0) {
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`menu:admin_ai_profile_delete:${paged.page}`)
            .setPlaceholder('🗑️ 选择一条人物档案移除...')
            .addOptions(
              paged.slice.map((p) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(truncateText(`${formatAiRelationBadge(p.relation)} ${p.alias}`, 100))
                  .setValue(p.userId)
                  .setDescription(truncateText(`ID: ${p.userId}${p.note ? ` | ${p.note}` : ''}`, 100)),
              ),
            ),
        ),
      );
    }

    const navButtons = [];
    if (paged.totalPages > 1) {
      navButtons.push(
        makeButton(
          `menu:nav:admin_ai:profiles:${Math.max(1, paged.page - 1)}`,
          '⬅️ 上页',
          ButtonStyle.Secondary,
          paged.page <= 1,
        ),
        makeButton(
          `menu:nav:admin_ai:profiles:${Math.min(paged.totalPages, paged.page + 1)}`,
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

  if (tab === 'usage') {
    const usage7d = ctx.services.ai.getUsageSummary(guildId, 24 * 7);
    const recentLogs = ctx.services.ai.listRecentUsageLogs(guildId, 5);
    const hasPricing = ai.inputPricePer1MUsd > 0 || ai.outputPricePer1MUsd > 0;
    const pricingLine = hasPricing
      ? `输入 **$${ai.inputPricePer1MUsd}**/1M tokens ｜ 输出 **$${ai.outputPricePer1MUsd}**/1M tokens`
      : '未配置单价（当前估算费用为 $0，点击下方「💲 设置 Token 单价」配置）';

    const modelLines =
      usage24h.byModel.length > 0
        ? usage24h.byModel
            .slice(0, 5)
            .map(
              (m) =>
                `• \`${m.model}\`：${m.calls} 次 ｜ ${m.totalTokens.toLocaleString('en-US')} tok（${m.promptTokens}/${m.completionTokens}） ｜ ${formatUsd(m.costUsd)}`,
            )
        : ['• 近 24 小时暂无调用记录'];

    const userLines =
      usage24h.topUsers.length > 0
        ? usage24h.topUsers.map(
            (u) =>
              `• <@${u.userId}>：${u.calls} 次 ｜ ${u.totalTokens.toLocaleString('en-US')} tok ｜ ${formatUsd(u.costUsd)}`,
          )
        : ['• 暂无成员消费记录'];

    const recentLines =
      recentLogs.length > 0
        ? recentLogs.map((log) => {
            const statusIcon = log.status === 'ok' ? '✅' : `❌(${log.errorCode ?? 'err'})`;
            const estTag = log.usageEstimated ? '(估)' : '';
            return `• ${statusIcon} \`${truncateText(log.model, 24)}\` <@${log.userId}> ${log.promptTokens}+${log.completionTokens}=${log.totalTokens}${estTag} tok · ${log.latencyMs}ms`;
          })
        : ['• 暂无调用明细'];

    const description = [
      `💵 **当前计费单价**：${pricingLine}`,
      '',
      `📊 **近 24 小时统计**`,
      `• 调用：**${usage24h.totalCalls}** 次（成功 ${usage24h.okCalls} / 失败 ${usage24h.errorCalls} / 估算 ${usage24h.estimatedCalls}） ｜ 平均耗时 **${usage24h.avgLatencyMs}ms**`,
      `• Token：**${usage24h.totalTokens.toLocaleString('en-US')}**（输入 ${usage24h.promptTokens.toLocaleString('en-US')} + 输出 ${usage24h.completionTokens.toLocaleString('en-US')}）`,
      `• 估算花费：**${formatUsd(usage24h.estimatedCostUsd)}**`,
      '',
      `📅 **近 7 天汇总**：**${usage7d.totalCalls}** 次 ｜ **${usage7d.totalTokens.toLocaleString('en-US')}** tok ｜ **${formatUsd(usage7d.estimatedCostUsd)}**`,
      '',
      '🤖 **24h 按模型分布**',
      ...modelLines,
      '',
      '👥 **24h 消耗 Top 5**',
      ...userLines,
      '',
      '🕒 **最近 5 次调用**',
      ...recentLines,
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(resolveColor(COLORS.PRIMARY, feedback))
      .setAuthor({ name: `${actor.displayName} · AI Token 与计费统计`, iconURL: actor.avatarUrl })
      .setTitle('📊 AI Token 用量与费用监控')
      .setDescription(withFeedback(truncateText(description, 4000), feedback))
      .setFooter({ text: '🔒 仅管理员可见；也可在频道用 /ai 用量 [小时] 查看' })
      .setTimestamp();

    const components: MenuComponentRow[] = [
      buttonRow(
        makeButton('menu:modal:admin_ai_pricing', '💲 设置 Token 单价', ButtonStyle.Primary),
        makeButton('menu:nav:admin_ai:usage', '🔄 刷新统计', ButtonStyle.Secondary),
        makeButton(
          'menu:admin:ai_clear_usage',
          '🗑️ 清空用量日志',
          ButtonStyle.Danger,
          usage7d.totalCalls === 0 && recentLogs.length === 0,
        ),
      ),
      buttonRow(
        makeButton('menu:nav:admin_ai:basic', '🎭 人设与参数', ButtonStyle.Primary),
        makeButton('menu:nav:admin_ai:regex', '🔧 正则与反八股', ButtonStyle.Secondary),
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ];

    return { embeds: [embed], components };
  }

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
    `👤 **人物关系档案**：已绑定 **${ai.userProfiles.length}/${MAX_AI_USER_PROFILES}** 人`,
    `📊 **近 24h 用量**：**${usage24h.totalCalls}** 次（失败 ${usage24h.errorCalls}） ｜ **${usage24h.totalTokens.toLocaleString('en-US')}** Tokens ｜ 估算 **${formatUsd(usage24h.estimatedCostUsd)}**`,
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
      makeButton('menu:nav:admin_ai:profiles', '👤 人物档案', ButtonStyle.Primary),
      makeButton('menu:nav:admin_ai:regex', '🔧 正则与反八股', ButtonStyle.Primary),
      makeButton('menu:nav:admin_ai:usage', '📊 用量与计费', ButtonStyle.Primary),
      makeButton('menu:nav:admin_ai:channels', '🔕 频道范围', ButtonStyle.Primary),
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
    ),
  ];

  return { embeds: [embed], components };
}
