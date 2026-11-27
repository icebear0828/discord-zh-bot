import {
  AttachmentBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { AppContext } from '../../../core/context.js';
import { formatAiRelationBadge } from '../../../services/aiProfiles.js';
import { isValidAiRegexScope, type AiRegexRuleScope } from '../../../services/aiRegex.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
} from '../../../ui/embeds.js';
import { truncateText } from '../../../ui/menuShared.js';

export async function executeAiRegexGroup(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  guildId: string,
  sub: string,
  isAdmin: boolean,
): Promise<void> {
  if (!isAdmin) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🔒 权限不足',
          '只有服务器管理员或 Bot 管理员才能管理 AI 正则替换规则。',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'list') {
    const rules = ctx.repos.guildConfig.getOrCreate(guildId).ai.regexRules;
    const antiCliche = ctx.repos.guildConfig.getOrCreate(guildId).ai.antiClichePromptEnabled;
    const lines =
      rules.length > 0
        ? rules.map((r) => {
            const icon = r.enabled ? '✅' : '⏸️';
            const rep = r.replacement ? `\`${truncateText(r.replacement, 30)}\`` : '*(删除)*';
            return `${icon} \`${r.id}\` **[${r.scope}] ${r.label}**\n  \`/${truncateText(r.pattern, 60)}/${r.flags}\` → ${rep}`;
          })
        : ['当前没有正则替换规则。'];

    await interaction.reply({
      embeds: [
        createInfoEmbed(
          `🔧 AI 正则规则列表（共 ${rules.length} 条）`,
          truncateText(
            [`🧹 反八股系统提示词：${antiCliche ? '✅ 开启' : '⛔ 关闭'}`, '', ...lines].join('\n'),
            4096,
          ),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add') {
    const label = interaction.options.getString('label', true);
    const pattern = interaction.options.getString('pattern', true);
    const replacement = interaction.options.getString('replacement') ?? '';
    const scopeRaw = interaction.options.getString('scope') ?? 'both';
    const flags = interaction.options.getString('flags') ?? 'gi';
    const scope: AiRegexRuleScope = isValidAiRegexScope(scopeRaw) ? scopeRaw : 'both';

    const res = ctx.services.ai.addRegexRule(guildId, {
      label,
      pattern,
      replacement,
      scope,
      flags,
    });
    if (!res.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 添加正则规则失败', res.error)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已添加正则规则',
          `编号 \`${res.rule.id}\` **${res.rule.label}**（${res.rule.scope}）\n\`/${res.rule.pattern}/${res.rule.flags}\` → ${res.rule.replacement ? `\`${res.rule.replacement}\`` : '*(删除)*'}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'toggle') {
    const id = interaction.options.getString('id', true).trim();
    const res = ctx.services.ai.toggleRegexRule(guildId, id);
    if (!res.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❓ 操作失败', res.error)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '🔘 已更新规则状态',
          `规则 \`${res.rule.id}\`（${res.rule.label}）已切换为：**${res.rule.enabled ? '启用' : '停用'}**。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'delete') {
    const id = interaction.options.getString('id', true).trim();
    const res = ctx.services.ai.deleteRegexRule(guildId, id);
    if (!res.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❓ 删除失败', res.error)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '🗑️ 已删除正则规则',
          `已移除规则 \`${res.rule.id}\`（${res.rule.label}）。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'test') {
    const text = interaction.options.getString('text', true);
    const stageRaw = interaction.options.getString('scope');
    const stage: 'input' | 'output' = stageRaw === 'input' ? 'input' : 'output';
    const preview = ctx.services.ai.previewRegexRules(guildId, text, stage);
    await interaction.reply({
      embeds: [
        createInfoEmbed(
          `🧪 正则测试预览（${stage === 'input' ? '输入阶段' : '输出阶段'}）`,
          truncateText(
            [
              `**原文**：\n${preview.before}`,
              '',
              `**结果**（${preview.changed ? '✅ 已命中替换' : '未命中任何规则'}）：\n${preview.after}`,
            ].join('\n'),
            4096,
          ),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function executeAiProfileGroup(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  guildId: string,
  sub: string,
  isAdmin: boolean,
): Promise<void> {
  if (!isAdmin) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🔒 权限不足',
          '只有服务器管理员或 Bot 管理员才能管理 AI 人物关系档案。',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'list') {
    const profiles = ctx.services.ai.listUserProfiles(guildId);
    const lines =
      profiles.length > 0
        ? profiles.map((p) => {
            const badge = formatAiRelationBadge(p.relation);
            const noteText = p.note ? ` — ${p.note}` : '';
            return `• ${badge} <@${p.userId}> · **${p.alias}**${noteText}`;
          })
        : ['当前尚未配置任何人物档案，可使用 `/ai 档案 设置` 或 `/菜单 → 管理后台 → AI 管理` 添加。'];

    await interaction.reply({
      embeds: [
        createInfoEmbed(
          `👤 AI 人物关系档案（共 ${profiles.length} 人）`,
          truncateText(lines.join('\n'), 4096),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'set') {
    const target = interaction.options.getUser('user', true);
    const relation = interaction.options.getString('relation', true);
    const alias = interaction.options.getString('alias', true);
    const note = interaction.options.getString('note') ?? '';

    const res = ctx.services.ai.upsertUserProfile(guildId, {
      userId: target.id,
      alias,
      relation,
      note,
    });
    if (!res.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 保存人物档案失败', res.error)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const badge = formatAiRelationBadge(res.profile.relation);
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          res.updated ? '✅ 已更新人物档案' : '✅ 已新增人物档案',
          `${badge} <@${res.profile.userId}> · 称呼：**${res.profile.alias}**${res.profile.note ? `\n备注：${res.profile.note}` : ''}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'delete') {
    const target = interaction.options.getUser('user', true);
    const res = ctx.services.ai.deleteUserProfile(guildId, target.id);
    if (!res.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❓ 删除失败', res.error)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '🗑️ 已移除人物档案',
          `已删除 <@${res.profile.userId}>（**${res.profile.alias}**）的人物关系档案。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function executeAiDebugGroup(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  guildId: string,
  member: GuildMember,
  sub: string,
): Promise<void> {
  if (sub === 'override') {
    const shouldClear = interaction.options.getBoolean('clear') === true;
    if (shouldClear) {
      const cleared = ctx.services.ai.clearChannelOverride(guildId, interaction.channelId);
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '🧹 已清除频道独立覆盖',
            cleared
              ? `频道 <#${interaction.channelId}> 的测试覆盖已移除，已恢复跟随全服默认配置。`
              : `频道 <#${interaction.channelId}> 当前没有独立覆盖配置。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const presetId = interaction.options.getString('preset')?.trim() || undefined;
    const cardId = interaction.options.getString('card')?.trim() || undefined;
    const modelOverride = interaction.options.getString('model')?.trim() || undefined;

    if (!presetId && !cardId && !modelOverride) {
      const current = ctx.services.ai.resolveEffectiveBinding(guildId, interaction.channelId);
      await interaction.reply({
        embeds: [
          createInfoEmbed(
            '🧪 当前频道 AI 挂载状态',
            [
              `• **独立覆盖状态**：${current.isChannelOverridden ? '✅ 已开启频道沙盒覆盖' : '跟随全服默认'}`,
              `• **生效破限预设**：\`${current.preset.id}\`（${current.preset.name} \`v${current.preset.version}\`）`,
              `• **生效角色卡**：\`${current.card.id}\`（**${current.card.personaName}** \`v${current.card.version}\`）`,
              `• **生效模型**：\`${current.effectiveModel || '未配置'}\``,
              `• **生效兜底模型**：\`${current.effectiveFallbackModel || '无'}\``,
            ].join('\n'),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const res = ctx.services.ai.setChannelOverride(guildId, interaction.channelId, {
      ...(presetId ? { presetId } : {}),
      ...(cardId ? { cardId } : {}),
      ...(modelOverride ? { modelOverride } : {}),
    });
    if (!res.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 设置频道覆盖失败', res.error)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = ctx.services.ai.resolveEffectiveBinding(guildId, interaction.channelId);
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '🧪 已更新当前频道测试覆盖',
          [
            `频道 <#${interaction.channelId}> 当前独立生效组合：`,
            `• **破限预设**：\`${updated.preset.id}\` \`v${updated.preset.version}\``,
            `• **角色卡**：\`${updated.card.id}\`（**${updated.card.personaName}** \`v${updated.card.version}\`）`,
            `• **模型**：\`${updated.effectiveModel || '未配置'}\``,
          ].join('\n'),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'dryrun') {
    const text = interaction.options.getString('text', true);
    const preview = ctx.services.ai.previewCompiledPrompt(guildId, {
      channelId: interaction.channelId,
      userId: member.id,
      userName: member.displayName,
      userHandle: interaction.user.username,
      userContent: text,
    });

    const payloadJson = `${JSON.stringify(preview, null, 2)}\n`;
    const file = new AttachmentBuilder(Buffer.from(payloadJson, 'utf8'), {
      name: `dryrun-${preview.presetId}-${preview.cardId}.json`,
    });

    const loreText =
      preview.triggeredLorebookIds.length > 0
        ? preview.triggeredLorebookIds.map((id) => `\`${id}\``).join('、')
        : '无（仅常驻设定）';

    await interaction.reply({
      embeds: [
        createInfoEmbed(
          '🔍 Dry-Run 破限编译报文预览',
          truncateText(
            [
              `• **挂载预设**：\`${preview.presetId}\`（${preview.presetName} \`v${preview.presetVersion}\`）`,
              `• **挂载角色卡**：\`${preview.cardId}\`（**${preview.personaName}** \`v${preview.cardVersion}\`）`,
              `• **目标模型**：\`${preview.model}\` ｜ **兜底模型**：\`${preview.fallbackModel || '无'}\` ｜ 温度 **${preview.sampling.temperature}** ｜ MaxTokens **${preview.sampling.maxTokens}**`,
              `• **消息块序列**：${preview.messages.map((m) => `\`${m.role}\``).join(' → ')}（共 ${preview.messages.length} 块）`,
              `• **命中世界书词条**：${loreText}`,
              '',
              '完整 `messages[]` 与采样参数已打包为下方私密 JSON 附件供逐字核查。',
            ].join('\n'),
            4096,
          ),
        ),
      ],
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'last') {
    const trace = ctx.services.ai.getLastChannelDebugTrace(guildId, interaction.channelId);
    if (!trace) {
      await interaction.reply({
        embeds: [
          createInfoEmbed(
            '📭 暂无调试报文记录',
            '本频道自上次启动以来尚未产生 AI 回复记录。先触发一次对话后再查看。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const file = new AttachmentBuilder(
      Buffer.from(`${JSON.stringify(trace, null, 2)}\n`, 'utf8'),
      { name: `last-trace-${interaction.channelId}.json` },
    );

    const cotPreview = trace.extractedCot
      ? `\`\`\`\n${truncateText(trace.extractedCot, 1200)}\n\`\`\``
      : '*(本次输出未包含 CoT 思维链标签)*';

    await interaction.reply({
      embeds: [
        createInfoEmbed(
          '🔬 本频道最近一次原始报文与 CoT 检视',
          truncateText(
            [
              `• **预设 / 角色卡**：\`${trace.presetId}@v${trace.presetVersion}\` + \`${trace.cardId}@v${trace.cardVersion}\`（**${trace.personaName}**）`,
              `• **实际模型**：\`${trace.model}\` ｜ **命中词条**：${trace.triggeredLorebookIds.length > 0 ? trace.triggeredLorebookIds.map((x) => `\`${x}\``).join('、') : '无'}`,
              '',
              '**🧠 剥离出的 CoT 思维链**',
              cotPreview,
              '',
              '**📝 网关原始输出片段**',
              `\`\`\`\n${truncateText(trace.rawResponse, 800)}\n\`\`\``,
            ].join('\n'),
            4096,
          ),
        ),
      ],
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'reload') {
    const stats = ctx.services.ai.reloadPacks();
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '🔄 已重新扫描磁盘预设库',
          `已从 \`data/ai-packs/\` 刷新加载：**${stats.presets}** 套破限预设、**${stats.cards}** 张角色人设卡。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
