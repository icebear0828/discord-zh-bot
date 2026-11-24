import {
  ChannelType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import {
  createErrorEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { checkMemberIsBotAdmin, requireGuildMember } from '../guards.js';

export const ticketCommand: CommandDefinition = {
  name: 'ticket',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('在当前工单频道内添加/移除成员或关闭工单')
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add')
            .setDescription('将指定成员拉入当前工单频道')
            .addUserOption((opt) =>
              applyZh(opt.setName('user').setDescription('成员').setRequired(true), '用户', '要拉入工单的成员'),
            ),
          '添加成员',
          '将指定成员拉入当前工单频道',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('remove')
            .setDescription('将指定成员移出当前工单频道')
            .addUserOption((opt) =>
              applyZh(opt.setName('user').setDescription('成员').setRequired(true), '用户', '要移出工单的成员'),
            ),
          '移除成员',
          '将指定成员移出当前工单频道',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(sub.setName('close').setDescription('关闭当前工单并归档删除频道'), '关闭', '关闭当前工单并归档删除频道'),
      ),
    '工单',
    '在当前工单频道内添加/移除成员或关闭工单',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;

    const ticket = ctx.services.ticket.getByChannel(interaction.channelId);
    if (!ticket || ticket.status !== 'open') {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 非有效工单频道', '请在开启中的工单频道内使用此指令。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const memberRoles = [...guildCtx.member.roles.cache.keys()];
    const isAdminOrStaff =
      checkMemberIsBotAdmin(guildCtx.member, cfg) ||
      cfg.ticket.staffRoleIds.some((id) => memberRoles.includes(id));

    if (!isAdminOrStaff && interaction.user.id !== ticket.creatorId) {
      await interaction.reply({
        embeds: [createErrorEmbed('🔒 权限不足', '只有工单创建者、客服或管理员可以操作当前工单。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      return;
    }

    if (sub === 'add') {
      if (!isAdminOrStaff) {
        await interaction.reply({
          embeds: [createErrorEmbed('🔒 权限不足', '只有客服或管理员可以向工单拉入成员。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const user = interaction.options.getUser('user', true);
      await (channel as TextChannel).permissionOverwrites.edit(user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
      await interaction.reply({
        embeds: [createSuccessEmbed('✅ 已添加成员', `已允许 <@${user.id}> 查看并回复此工单。`)],
      });
      return;
    }

    if (sub === 'remove') {
      if (!isAdminOrStaff) {
        await interaction.reply({
          embeds: [createErrorEmbed('🔒 权限不足', '只有客服或管理员可以从工单移除成员。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const user = interaction.options.getUser('user', true);
      if (user.id === ticket.creatorId) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 无法移除', '不能移除工单创建者本人。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await (channel as TextChannel).permissionOverwrites.delete(user.id);
      await interaction.reply({
        embeds: [createSuccessEmbed('✅ 已移除成员', `已移除 <@${user.id}> 对此工单的访问权限。`)],
      });
      return;
    }

    if (sub === 'close') {
      ctx.services.ticket.closeTicket(channel.id, interaction.user.id);
      await interaction.reply({
        embeds: [createSuccessEmbed('🔒 工单即将关闭', '本工单已标记关闭，频道将在 5 秒后删除。')],
      });

      if (cfg.ticket.logChannelId && interaction.guild) {
        const logCh =
          interaction.guild.channels.cache.get(cfg.ticket.logChannelId) ??
          (await interaction.guild.channels.fetch(cfg.ticket.logChannelId).catch(() => null));
        if (logCh && logCh.isSendable()) {
          await logCh
            .send({
              embeds: [
                createSuccessEmbed(
                  `🎫 工单 #${String(ticket.ticketNumber).padStart(4, '0')} 已关闭`,
                  [
                    `主题：**${ticket.subject}**`,
                    `创建人：<@${ticket.creatorId}>`,
                    `关闭人：<@${interaction.user.id}>`,
                  ].join('\n'),
                ),
              ],
            })
            .catch(() => undefined);
        }
      }

      setTimeout(() => {
        void (channel as TextChannel).delete(`工单由 ${interaction.user.tag} 关闭`).catch(() => undefined);
      }, 5000);
    }
  },
};
