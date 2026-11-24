import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import type { RolePanel, RolePanelDisplayMode, RolePanelOption, RolePanelSelectionMode } from '../../db/repositories/rolePanelRepo.js';
import { isValidDiscordEmoji } from '../../services/rolePanelService.js';
import {
  COLORS,
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireBotAdmin, requireModuleEnabled } from '../guards.js';

export function buildRolePanelMessage(
  panel: RolePanel,
  options: readonly RolePanelOption[],
): {
  embeds: EmbedBuilder[];
  components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>>;
} {
  const modeLabel = panel.selectionMode === 'single' ? '单选互斥' : '自由多选';
  const roleListLines = options.map(
    (o) => `${o.emoji ? `${o.emoji} ` : ''}<@&${o.roleId}>${o.description ? ` — ${o.description}` : ''}`,
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🎭 ${panel.title}`)
    .setDescription(
      `${panel.description}\n\n${roleListLines.length > 0 ? roleListLines.join('\n') : '暂未配置身份组选项'}`,
    )
    .setFooter({ text: `面板 #${panel.id} · 模式：${modeLabel}` })
    .setTimestamp();

  if (options.length === 0) {
    return { embeds: [embed], components: [] };
  }

  if (panel.displayMode === 'select') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`rolepanel:select:${panel.id}`)
      .setPlaceholder(panel.selectionMode === 'single' ? '请选择一个身份组（单选）...' : '请选择要领取的身份组（可多选）...')
      .setMinValues(0)
      .setMaxValues(panel.selectionMode === 'single' ? 1 : options.length)
      .addOptions(
        options.map((o) => ({
          label: o.label.slice(0, 100),
          value: o.roleId,
          ...(o.description ? { description: o.description.slice(0, 100) } : {}),
          ...(o.emoji && isValidDiscordEmoji(o.emoji) ? { emoji: o.emoji.trim() } : {}),
        })),
      );

    return {
      embeds: [embed],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    };
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < options.length; i += 5) {
    const slice = options.slice(i, i + 5);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      slice.map((o) => {
        const btn = new ButtonBuilder()
          .setCustomId(`rolepanel:btn:${panel.id}:${o.roleId}`)
          .setLabel(o.label.slice(0, 80))
          .setStyle(ButtonStyle.Secondary);
        if (o.emoji && isValidDiscordEmoji(o.emoji)) {
          btn.setEmoji(o.emoji.trim());
        }
        return btn;
      }),
    );
    rows.push(row);
  }

  return { embeds: [embed], components: rows };
}

export const rolePanelCommand: CommandDefinition = {
  name: 'role-panel',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('role-panel')
      .setDescription('创建与管理自助领取身份组面板（支持按钮/下拉菜单、单选/多选）')
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('create')
            .setDescription('创建一个新的身份组面板草稿')
            .addStringOption((opt) =>
              applyZh(opt.setName('title').setDescription('面板标题').setRequired(true), '标题', '面板标题'),
            )
            .addStringOption((opt) =>
              applyZh(
                opt
                  .setName('display')
                  .setDescription('交互样式')
                  .setRequired(true)
                  .addChoices(
                    { name: '按钮点击 (button)', value: 'button' },
                    { name: '下拉菜单 (select)', value: 'select' },
                  ),
                '样式',
                '按钮或下拉菜单',
              ),
            )
            .addStringOption((opt) =>
              applyZh(
                opt
                  .setName('selection')
                  .setDescription('选择模式')
                  .setRequired(true)
                  .addChoices(
                    { name: '多选 (multi)', value: 'multi' },
                    { name: '单选互斥 (single)', value: 'single' },
                  ),
                '模式',
                '单选互斥或自由多选',
              ),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('面板描述说明'), '说明', '面板描述文本'),
            ),
          '创建',
          '创建一个新的身份组面板草稿',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-option')
            .setDescription('向指定面板添加一个身份组选项（最多 25 个）')
            .addIntegerOption((opt) =>
              applyZh(opt.setName('panel-id').setDescription('面板 ID').setMinValue(1).setRequired(true), '面板编号', '面板 ID'),
            )
            .addRoleOption((opt) =>
              applyZh(opt.setName('role').setDescription('对应身份组').setRequired(true), '身份组', '发放的身份组'),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('label').setDescription('按钮或菜单显示文字').setRequired(true), '标签', '显示文字'),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('emoji').setDescription('可选 Emoji'), '图标', '可选 Emoji 图标'),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('可选说明文本'), '说明', '选项说明文本'),
            ),
          '添加选项',
          '向指定面板添加一个身份组选项',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('remove-option')
            .setDescription('从面板移除指定身份组选项')
            .addIntegerOption((opt) =>
              applyZh(opt.setName('panel-id').setDescription('面板 ID').setMinValue(1).setRequired(true), '面板编号', '面板 ID'),
            )
            .addRoleOption((opt) =>
              applyZh(opt.setName('role').setDescription('要移除的身份组').setRequired(true), '身份组', '要移除的身份组'),
            ),
          '移除选项',
          '从面板移除指定身份组选项',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('send')
            .setDescription('将面板发送（或刷新）到频道')
            .addIntegerOption((opt) =>
              applyZh(opt.setName('panel-id').setDescription('面板 ID').setMinValue(1).setRequired(true), '面板编号', '面板 ID'),
            )
            .addChannelOption((opt) =>
              applyZh(
                opt
                  .setName('channel')
                  .setDescription('目标频道（默认当前频道）')
                  .addChannelTypes(ChannelType.GuildText),
                '频道',
                '发送面板的文字频道',
              ),
            ),
          '发送',
          '将面板发送（或刷新）到频道',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(sub.setName('list').setDescription('查看本服务器所有身份组面板'), '列表', '查看本服务器所有身份组面板'),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('delete')
            .setDescription('删除指定身份组面板记录')
            .addIntegerOption((opt) =>
              applyZh(opt.setName('panel-id').setDescription('面板 ID').setMinValue(1).setRequired(true), '面板编号', '面板 ID'),
            ),
          '删除',
          '删除指定身份组面板记录',
        ),
      ),
    '身份组面板',
    '创建与管理自助领取身份组面板',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const adminCtx = await requireBotAdmin(interaction, ctx);
    if (!adminCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'rolePanels', '自助身份组'))) return;

    const { guildId } = adminCtx;
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const title = interaction.options.getString('title', true);
      const displayMode = interaction.options.getString('display', true) as RolePanelDisplayMode;
      const selectionMode = interaction.options.getString('selection', true) as RolePanelSelectionMode;
      const description =
        interaction.options.getString('description') ?? '点击下方选项即可自助领取或取消对应身份组。';

      const panel = ctx.services.rolePanel.createPanel({
        guildId,
        title,
        description,
        displayMode,
        selectionMode,
      });

      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 面板创建成功',
            `面板编号：**#${panel.id}**（${displayMode === 'button' ? '按钮' : '下拉菜单'} / ${selectionMode === 'single' ? '单选互斥' : '多选'}）\n接下来请用 \`/身份组面板 添加选项\` 添加身份组，再使用 \`/身份组面板 发送\` 发布。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'add-option') {
      const panelId = interaction.options.getInteger('panel-id', true);
      const role = interaction.options.getRole('role', true);
      const label = interaction.options.getString('label', true);
      const emojiRaw = interaction.options.getString('emoji');
      const emoji = emojiRaw?.trim() || null;
      const description = interaction.options.getString('description');

      if (emoji && !isValidDiscordEmoji(emoji)) {
        await interaction.reply({
          embeds: [
            createErrorEmbed(
              '❌ 无效的 Emoji 图标',
              '图标必须是单个标准 Unicode 表情（如 `🎮`）或自定义表情（如 `<:name:123456789012345678>`），不能填普通文字。',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const res = ctx.services.rolePanel.addOption(guildId, panelId, {
        roleId: role.id,
        label,
        emoji,
        description,
      });

      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          panel_not_found: `未找到面板 **#${panelId}**。`,
          limit_reached: '单个面板最多支持 25 个身份组选项。',
          duplicate_role: `面板中已存在 <@&${role.id}>。`,
        };
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 添加失败', msgMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 已添加选项', `已将 <@&${role.id}>（${label}）添加到面板 **#${panelId}**。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove-option') {
      const panelId = interaction.options.getInteger('panel-id', true);
      const role = interaction.options.getRole('role', true);
      const removed = ctx.services.rolePanel.removeOption(guildId, panelId, role.id);
      await interaction.reply({
        embeds: [
          removed
            ? createSuccessEmbed('✅ 已移除选项', `已从面板 **#${panelId}** 移除 <@&${role.id}>。`)
            : createErrorEmbed('❌ 未找到选项', `面板 **#${panelId}** 中没有该身份组。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'send') {
      const panelId = interaction.options.getInteger('panel-id', true);
      const data = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
      if (!data) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 未找到面板', `面板 **#${panelId}** 不存在。`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (data.options.length === 0) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 面板为空', '请先通过 `/身份组面板 添加选项` 至少添加一个身份组。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;
      if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 发送失败', '请选择一个文字频道发送面板。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const payload = buildRolePanelMessage(data.panel, data.options);
      const sent = await (targetChannel as TextChannel).send(payload);
      ctx.services.rolePanel.setPanelMessage(panelId, targetChannel.id, sent.id);

      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 面板已发布', `身份组面板 **#${panelId}** 已发送至 <#${targetChannel.id}>。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'list') {
      const panels = ctx.services.rolePanel.listPanels(guildId);
      const desc =
        panels.length > 0
          ? panels
              .map(
                (p) =>
                  `• **#${p.id} ${p.title}**（${p.displayMode === 'button' ? '按钮' : '菜单'} / ${p.selectionMode === 'single' ? '单选' : '多选'}）${p.channelId ? ` · <#${p.channelId}>` : ' · 未发送'}`,
              )
              .join('\n')
          : '暂未创建任何身份组面板。';
      await interaction.reply({
        embeds: [createInfoEmbed('🎭 身份组面板列表', desc)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'delete') {
      const panelId = interaction.options.getInteger('panel-id', true);
      const deleted = ctx.services.rolePanel.deletePanel(guildId, panelId);
      await interaction.reply({
        embeds: [
          deleted
            ? createSuccessEmbed('✅ 面板已删除', `已删除身份组面板 **#${panelId}**。`)
            : createErrorEmbed('❌ 未找到面板', `面板 **#${panelId}** 不存在。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
