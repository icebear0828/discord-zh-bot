import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { GuildConfig } from '../../../config/defaults.js';
import type { AppContext } from '../../../core/context.js';
import type { AiMemoryRecord, AiMemoryScopeType } from '../../../db/repositories/aiMemoryRepo.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
} from '../../../ui/embeds.js';
import { truncateText } from '../../../ui/menuShared.js';

function formatScopeLabel(scope: AiMemoryScopeType): string {
  if (scope === 'channel') return '当前频道';
  if (scope === 'guild') return '全服共同';
  return '个人';
}

function resolveScopeId(
  scope: AiMemoryScopeType,
  guildId: string,
  channelId: string,
  userId: string,
): string {
  if (scope === 'guild') return guildId;
  if (scope === 'channel') return channelId;
  return userId;
}

export function formatMemoryListDescription(
  items: readonly AiMemoryRecord[],
  maxLen = 4096,
): string {
  if (items.length === 0) {
    return '当前作用域下暂无记忆条目。';
  }

  const lines: string[] = [];
  let usedLen = 0;
  let omitted = 0;

  for (let i = 0; i < items.length; i++) {
    const m = items[i]!;
    const line = `• \`#${m.id}\` **[${m.category}]** ${m.content}`;
    const remainingAfterThis = items.length - (i + 1);
    const footerReserve =
      remainingAfterThis > 0
        ? `\n… 另有 ${remainingAfterThis} 条记忆因长度限制已省略（共 ${items.length} 条）`.length
        : 0;
    const sep = lines.length > 0 ? 1 : 0;

    if (usedLen + sep + line.length + footerReserve > maxLen) {
      omitted = items.length - i;
      break;
    }

    lines.push(line);
    usedLen += sep + line.length;
  }

  if (omitted > 0) {
    const footer = `… 另有 ${omitted} 条记忆因长度限制已省略（共 ${items.length} 条）`;
    if (lines.length === 0) {
      return truncateText(footer, maxLen);
    }
    return truncateText(`${lines.join('\n')}\n${footer}`, maxLen);
  }

  return truncateText(lines.join('\n'), maxLen);
}

export async function executeAiResetSubcommand(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  guildId: string,
): Promise<void> {
  ctx.services.ai.resetChannelContext(guildId, interaction.channelId);
  await interaction.reply({
    embeds: [
      createSuccessEmbed(
        '🧹 对话上下文已重置',
        '本频道之前的短期聊天记录已从 AI 视野截断，接下来将开启全新对话（长期记忆仍会保留）。',
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

export async function executeAiUsageSubcommand(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  guildId: string,
  cfg: GuildConfig,
  isAdmin: boolean,
): Promise<void> {
  if (!isAdmin) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🔒 权限不足',
          '只有服务器管理员或 Bot 管理员才能查看 AI Token 用量与计费统计。',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const hours = interaction.options.getInteger('hours') ?? 24;
  const summary = ctx.services.ai.getUsageSummary(guildId, hours);
  const costStr =
    summary.estimatedCostUsd <= 0
      ? '$0.0000'
      : summary.estimatedCostUsd < 0.01
        ? `$${summary.estimatedCostUsd.toFixed(6)}`
        : `$${summary.estimatedCostUsd.toFixed(4)}`;

  const modelLines =
    summary.byModel.length > 0
      ? summary.byModel
          .slice(0, 5)
          .map(
            (m) =>
              `• \`${m.model}\`：${m.calls} 次 ｜ ${m.totalTokens.toLocaleString('en-US')} tok（${m.promptTokens}/${m.completionTokens}）`,
          )
      : ['• 暂无调用记录'];

  const userLines =
    summary.topUsers.length > 0
      ? summary.topUsers.map(
          (u) => `• <@${u.userId}>：${u.calls} 次 ｜ ${u.totalTokens.toLocaleString('en-US')} tok`,
        )
      : ['• 暂无成员消费记录'];

  await interaction.reply({
    embeds: [
      createInfoEmbed(
        `📊 AI 近 ${hours} 小时用量统计`,
        truncateText(
          [
            `• **调用次数**：**${summary.totalCalls}** 次（成功 ${summary.okCalls} / 失败 ${summary.errorCalls} / 本地估算 ${summary.estimatedCalls}）`,
            `• **Token 消耗**：**${summary.totalTokens.toLocaleString('en-US')}**（输入 ${summary.promptTokens.toLocaleString('en-US')} + 输出 ${summary.completionTokens.toLocaleString('en-US')}）`,
            `• **平均延迟**：**${summary.avgLatencyMs}ms** ｜ **估算花费**：**${costStr}**`,
            `• **当前单价**：输入 $${cfg.ai.inputPricePer1MUsd}/1M ｜ 输出 $${cfg.ai.outputPricePer1MUsd}/1M`,
            '',
            '**按模型分布**',
            ...modelLines,
            '',
            '**消耗 Top 5**',
            ...userLines,
          ].join('\n'),
          4096,
        ),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

export async function executeAiMemoryGroup(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  guildId: string,
  member: GuildMember,
  sub: string,
  isAdmin: boolean,
): Promise<void> {
  const scopeRaw = interaction.options.getString('scope');
  const scope: AiMemoryScopeType =
    scopeRaw === 'channel' || scopeRaw === 'guild' ? scopeRaw : 'user';
  const scopeId = resolveScopeId(scope, guildId, interaction.channelId, member.id);

  if (sub === 'list') {
    const items = ctx.services.ai.listMemories(guildId, scope, scopeId, 30);
    const description = formatMemoryListDescription(items, 4096);

    await interaction.reply({
      embeds: [
        createInfoEmbed(
          `🧠 AI 长期记忆（${formatScopeLabel(scope)} · 共 ${items.length} 条）`,
          description,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add') {
    if ((scope === 'channel' || scope === 'guild') && !isAdmin) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '🔒 权限不足',
            '只有服务器管理员或 Bot 管理员才能添加频道/全服级长期记忆。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const content = interaction.options.getString('content', true).trim();
    const category = interaction.options.getString('category')?.trim() || 'manual';
    const record = ctx.services.ai.addMemory({
      guildId,
      scopeType: scope,
      scopeId,
      category,
      content,
      createdBy: member.id,
    });

    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已写入长期记忆',
          `已存入 **${formatScopeLabel(scope)}记忆** \`#${record.id}\`：**[${record.category}]** ${record.content}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'delete') {
    const id = interaction.options.getInteger('id', true);
    const target = ctx.services.ai.getMemoryById(guildId, id);
    if (!target) {
      await interaction.reply({
        embeds: [createErrorEmbed('❓ 未找到记忆', `找不到编号为 \`#${id}\` 的记忆条目。`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const canDelete = isAdmin || (target.scopeType === 'user' && target.scopeId === member.id);
    if (!canDelete) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '🔒 权限不足',
            '你只能删除自己的个人记忆；频道或全服记忆需要管理员删除。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    ctx.services.ai.deleteMemory(guildId, id);
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '🗑️ 已删除记忆',
          `已移除 \`#${id}\`：**[${target.category}]** ${target.content}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'clear') {
    if ((scope === 'channel' || scope === 'guild') && !isAdmin) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '🔒 权限不足',
            '只有服务器管理员或 Bot 管理员才能清空频道/全服级长期记忆。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const deleted = ctx.services.ai.clearMemories(guildId, scope, scopeId);
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '🧹 记忆已清空',
          `已清空 **${formatScopeLabel(scope)}记忆**，共移除 **${deleted}** 条记录。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
