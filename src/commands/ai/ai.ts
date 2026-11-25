import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AiMemoryRecord, AiMemoryScopeType } from '../../db/repositories/aiMemoryRepo.js';
import {
  isValidAiRegexScope,
  MAX_AI_REGEX_LABEL_LEN,
  MAX_AI_REGEX_PATTERN_LEN,
  MAX_AI_REGEX_REPLACEMENT_LEN,
  type AiRegexRuleScope,
} from '../../services/aiRegex.js';
import { truncateText } from '../../ui/menuShared.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  checkMemberIsBotAdmin,
  requireGuildMember,
  requireModuleEnabled,
} from '../guards.js';

const SCOPE_CHOICES: ReadonlyArray<{ name: string; value: AiMemoryScopeType }> = [
  { name: '我的个人记忆 (user)', value: 'user' },
  { name: '当前频道记忆 (channel)', value: 'channel' },
  { name: '全服共同记忆 (guild)', value: 'guild' },
];

const REGEX_SCOPE_CHOICES: ReadonlyArray<{ name: string; value: AiRegexRuleScope }> = [
  { name: '双向生效（输入与输出）', value: 'both' },
  { name: '仅输入（传给 AI 前）', value: 'input' },
  { name: '仅输出（AI 回复前）', value: 'output' },
];

const REGEX_TEST_STAGE_CHOICES: ReadonlyArray<{ name: string; value: 'input' | 'output' }> = [
  { name: '输出阶段（反八股 + 双向代称）', value: 'output' },
  { name: '输入阶段（输入归一化 + 双向代称）', value: 'input' },
];

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

export const aiCommand: CommandDefinition = {
  name: 'ai',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('ai')
      .setDescription('AI 对话上下文重置与长期记忆管理')
      .addSubcommand((sub) =>
        applyZh(
          sub.setName('reset').setDescription('清空当前频道的短期对话上下文（长期记忆仍保留）'),
          '重置',
          '清空当前频道的短期对话上下文（长期记忆仍保留）',
        ),
      )
      .addSubcommandGroup((group) =>
        applyZh(
          group
            .setName('memory')
            .setDescription('查看或管理 AI 长期记忆')
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('list')
                  .setDescription('查看已保存的长期记忆列表')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('记忆作用域（默认查看你的个人记忆）')
                        .addChoices(...SCOPE_CHOICES),
                      '作用域',
                      '选择查看个人、当前频道或全服记忆',
                    ),
                  ),
                '查看',
                '查看已保存的长期记忆列表',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('add')
                  .setDescription('手动添加一条长期记忆')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('content')
                        .setDescription('要记住的内容（1~200字）')
                        .setMinLength(1)
                        .setMaxLength(200)
                        .setRequired(true),
                      '内容',
                      '要长期记住的内容（1~200字）',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('category')
                        .setDescription('记忆分类（默认 manual）')
                        .setMaxLength(24),
                      '分类',
                      '可选分类标签，如 preference / identity',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('作用域（频道/全服仅管理员可写入）')
                        .addChoices(...SCOPE_CHOICES),
                      '作用域',
                      '默认写入你的个人记忆；频道/全服需管理员权限',
                    ),
                  ),
                '添加',
                '手动添加一条长期记忆',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('delete')
                  .setDescription('按记忆 ID 删除一条长期记忆')
                  .addIntegerOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('记忆条目 ID（可通过 /ai 记忆 查看 获取）')
                        .setMinValue(1)
                        .setRequired(true),
                      '编号',
                      '要删除的记忆 ID',
                    ),
                  ),
                '删除',
                '按记忆 ID 删除一条长期记忆',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('clear')
                  .setDescription('清空指定作用域下的所有长期记忆')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('作用域（频道/全服仅管理员可清空）')
                        .addChoices(...SCOPE_CHOICES),
                      '作用域',
                      '默认清空你的个人记忆；频道/全服需管理员权限',
                    ),
                  ),
                '清空',
                '清空指定作用域下的所有长期记忆',
              ),
            ),
          '记忆',
          '查看或管理 AI 长期记忆',
        ),
      )
      .addSubcommandGroup((group) =>
        applyZh(
          group
            .setName('regex')
            .setDescription('管理员配置 AI 代称与反八股正则规则')
            .addSubcommand((sub) =>
              applyZh(
                sub.setName('list').setDescription('查看当前正则替换规则列表'),
                '查看',
                '查看当前正则替换规则列表',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('add')
                  .setDescription('新增一条 AI 正则替换规则')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('label')
                        .setDescription(`规则名称（1~${MAX_AI_REGEX_LABEL_LEN}字）`)
                        .setMinLength(1)
                        .setMaxLength(MAX_AI_REGEX_LABEL_LEN)
                        .setRequired(true),
                      '名称',
                      `规则名称（1~${MAX_AI_REGEX_LABEL_LEN}字）`,
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('pattern')
                        .setDescription(`正则表达式（1~${MAX_AI_REGEX_PATTERN_LEN}字符）`)
                        .setMinLength(1)
                        .setMaxLength(MAX_AI_REGEX_PATTERN_LEN)
                        .setRequired(true),
                      '正则',
                      `正则表达式（1~${MAX_AI_REGEX_PATTERN_LEN}字符）`,
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('replacement')
                        .setDescription('替换文本（不填表示删除匹配内容）')
                        .setMaxLength(MAX_AI_REGEX_REPLACEMENT_LEN),
                      '替换为',
                      '替换文本（不填表示删除）',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('生效范围（默认 both 双向）')
                        .addChoices(...REGEX_SCOPE_CHOICES),
                      '范围',
                      '生效范围（默认 both 双向）',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('flags')
                        .setDescription('正则标志（默认 gi，仅支持 g/i/m/u）')
                        .setMaxLength(8),
                      '标志',
                      '正则标志（默认 gi，支持 g/i/m/u）',
                    ),
                  ),
                '添加',
                '新增一条 AI 正则替换规则',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('toggle')
                  .setDescription('启用或停用指定编号的正则规则')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('规则编号（如 r1 或 alias_heidiowang）')
                        .setMinLength(1)
                        .setMaxLength(32)
                        .setRequired(true),
                      '编号',
                      '要切换状态的规则编号',
                    ),
                  ),
                '开关',
                '启用或停用指定编号的正则规则',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('delete')
                  .setDescription('删除指定编号的正则规则')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('id')
                        .setDescription('规则编号（可通过 /ai 正则 查看 获取）')
                        .setMinLength(1)
                        .setMaxLength(32)
                        .setRequired(true),
                      '编号',
                      '要删除的规则编号',
                    ),
                  ),
                '删除',
                '删除指定编号的正则规则',
              ),
            )
            .addSubcommand((sub) =>
              applyZh(
                sub
                  .setName('test')
                  .setDescription('测试当前启用的正则规则对一段文本的替换效果')
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('text')
                        .setDescription('待测试的文本内容（1~1000字）')
                        .setMinLength(1)
                        .setMaxLength(1000)
                        .setRequired(true),
                      '测试文本',
                      '待测试的文本内容（1~1000字）',
                    ),
                  )
                  .addStringOption((opt) =>
                    applyZh(
                      opt
                        .setName('scope')
                        .setDescription('模拟阶段（默认 output 输出阶段）')
                        .addChoices(...REGEX_TEST_STAGE_CHOICES),
                      '环节',
                      '模拟阶段（input 或 output）',
                    ),
                  ),
                '测试',
                '测试当前启用的正则规则对一段文本的替换效果',
              ),
            ),
          '正则',
          '管理员配置 AI 代称与反八股正则规则',
        ),
      ),
    'ai',
    'AI 对话上下文重置与长期记忆管理',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const memberCtx = await requireGuildMember(interaction);
    if (!memberCtx) return;

    const enabled = await requireModuleEnabled(interaction, ctx, 'ai', 'AI 对话');
    if (!enabled) return;

    const { guildId, member } = memberCtx;
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    const isAdmin = checkMemberIsBotAdmin(member, cfg);

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!group && sub === 'reset') {
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
      return;
    }

    if (group === 'memory') {
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

        const canDelete =
          isAdmin || (target.scopeType === 'user' && target.scopeId === member.id);
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
      return;
    }

    if (group === 'regex') {
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
  },
};
