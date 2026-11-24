import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AiMemoryScopeType } from '../../db/repositories/aiMemoryRepo.js';
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
                        .setDescription('记忆分类（默认 general）')
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
        const lines =
          items.length > 0
            ? items.map((m) => `• \`#${m.id}\` **[${m.category}]** ${m.content}`)
            : ['当前作用域下暂无记忆条目。'];

        await interaction.reply({
          embeds: [
            createInfoEmbed(
              `🧠 AI 长期记忆（${formatScopeLabel(scope)} · 共 ${items.length} 条）`,
              lines.join('\n'),
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
    }
  },
};
