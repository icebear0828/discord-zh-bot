import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import {
  COLORS,
  createErrorEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireBotAdmin, requireModuleEnabled } from '../guards.js';

export const ticketConfigCommand: CommandDefinition = {
  name: 'ticket-config',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('ticket-config')
      .setDescription('配置工单系统并发送客服工单创建面板')
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('setup')
            .setDescription('设置工单所在分类、客服身份组与日志频道')
            .addChannelOption((opt) =>
              applyZh(
                opt
                  .setName('category')
                  .setDescription('工单频道创建的分类目录')
                  .addChannelTypes(ChannelType.GuildCategory),
                '分类',
                '工单频道归属的频道分类',
              ),
            )
            .addRoleOption((opt) =>
              applyZh(
                opt.setName('staff-role').setDescription('可查看并处理工单的客服身份组'),
                '客服身份组',
                '拥有处理工单权限的身份组',
              ),
            )
            .addChannelOption((opt) =>
              applyZh(
                opt
                  .setName('log-channel')
                  .setDescription('关闭工单时发送记录摘要的日志频道')
                  .addChannelTypes(ChannelType.GuildText),
                '日志频道',
                '记录工单关闭摘要的频道',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('max-open')
                  .setDescription('每位成员同时可打开的最大工单数')
                  .setMinValue(1)
                  .setMaxValue(10),
                '并发上限',
                '单人同时可开启的工单数',
              ),
            ),
          '配置',
          '设置工单所在分类、客服身份组与日志频道',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('send-panel')
            .setDescription('在指定频道发送「创建工单」面板')
            .addChannelOption((opt) =>
              applyZh(
                opt
                  .setName('channel')
                  .setDescription('发送目标频道（默认当前频道）')
                  .addChannelTypes(ChannelType.GuildText),
                '频道',
                '发送面板的频道',
              ),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('title').setDescription('面板标题'), '标题', '工单面板标题'),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('面板说明'), '说明', '工单面板说明内容'),
            ),
          '发送面板',
          '在指定频道发送「创建工单」面板',
        ),
      ),
    '工单设置',
    '配置工单系统并发送客服工单创建面板',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const adminCtx = await requireBotAdmin(interaction, ctx);
    if (!adminCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'tickets', '工单系统'))) return;

    const { guildId } = adminCtx;
    const sub = interaction.options.getSubcommand();
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (sub === 'setup') {
      const category = interaction.options.getChannel('category');
      const staffRole = interaction.options.getRole('staff-role');
      const logChannel = interaction.options.getChannel('log-channel');
      const maxOpen = interaction.options.getInteger('max-open');

      const staffRoleIds = staffRole
        ? cfg.ticket.staffRoleIds.includes(staffRole.id)
          ? cfg.ticket.staffRoleIds
          : [...cfg.ticket.staffRoleIds, staffRole.id]
        : cfg.ticket.staffRoleIds;

      const next = {
        ...cfg.ticket,
        categoryId: category ? category.id : cfg.ticket.categoryId,
        staffRoleIds,
        logChannelId: logChannel ? logChannel.id : cfg.ticket.logChannelId,
        maxOpenPerUser: maxOpen ?? cfg.ticket.maxOpenPerUser,
      };
      ctx.repos.guildConfig.updateTicket(guildId, next);

      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 工单配置已更新',
            [
              `工单分类：${next.categoryId ? `<#${next.categoryId}>` : '默认根目录'}`,
              `客服身份组：${next.staffRoleIds.length > 0 ? next.staffRoleIds.map((r) => `<@&${r}>`).join('、') : '仅服务器管理员'}`,
              `日志频道：${next.logChannelId ? `<#${next.logChannelId}>` : '未设置'}`,
              `单人同时开启上限：**${next.maxOpenPerUser}** 个`,
            ].join('\n'),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'send-panel') {
      const channelOption = interaction.options.getChannel('channel') ?? interaction.channel;
      if (!channelOption || channelOption.type !== ChannelType.GuildText) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 发送失败', '请选择一个文字频道作为工单面板发送目标。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const title = interaction.options.getString('title') ?? '🎫 联系客服 / 提交工单';
      const description =
        interaction.options.getString('description') ??
        '遇到问题、需要申诉或反馈建议？请点击下方按钮创建一个私密工单频道，管理员与客服会尽快协助你处理。';

      const embed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: '点击下方按钮开启私密工单' })
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket:open')
          .setLabel('创建工单')
          .setEmoji('📩')
          .setStyle(ButtonStyle.Primary),
      );

      await (channelOption as TextChannel).send({ embeds: [embed], components: [row] });
      await interaction.reply({
        embeds: [createSuccessEmbed('✅ 工单面板已发送', `已在 <#${channelOption.id}> 发布工单创建面板。`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
