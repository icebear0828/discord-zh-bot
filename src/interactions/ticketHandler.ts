import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type OverwriteResolvable,
  type TextChannel,
} from 'discord.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
} from '../ui/embeds.js';

export async function handleTicketButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId || !interaction.inCachedGuild()) return;

  const [, action] = interaction.customId.split(':');

  if (action === 'open') {
    const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
    if (!cfg.modules.tickets) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器暂未开启工单功能。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const quota = ctx.services.ticket.canOpenTicket(interaction.guildId, interaction.user.id);
    if (!quota.allowed) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '⚠️ 已达工单上限',
            `你当前已有 **${quota.openCount}** 个未关闭工单（上限 ${quota.maxOpen} 个），请先处理或关闭现有工单。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('ticket:create')
      .setTitle('提交客服工单');

    const subjectInput = new TextInputBuilder()
      .setCustomId('subject')
      .setLabel('请简述你要咨询或反馈的主题')
      .setStyle(TextInputStyle.Short)
      .setMinLength(2)
      .setMaxLength(80)
      .setRequired(true);

    const detailInput = new TextInputBuilder()
      .setCustomId('detail')
      .setLabel('详细说明（可选）')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(800)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(subjectInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(detailInput),
    );

    await interaction.showModal(modal);
    return;
  }

  if (action === 'close') {
    const ticket = ctx.services.ticket.getByChannel(interaction.channelId);
    if (!ticket || ticket.status !== 'open') {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 工单已关闭', '该频道不是开启中的工单。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
    ctx.services.ticket.closeTicket(interaction.channelId, interaction.user.id);

    await interaction.reply({
      embeds: [createSuccessEmbed('🔒 工单即将关闭', '本工单已标记关闭，频道将在 5 秒后删除。')],
    });

    if (cfg.ticket.logChannelId) {
      const logCh = interaction.guild.channels.cache.get(cfg.ticket.logChannelId);
      if (logCh && logCh.type === ChannelType.GuildText) {
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

    const ch = interaction.channel;
    if (ch && ch.type === ChannelType.GuildText) {
      setTimeout(() => {
        void (ch as TextChannel).delete(`工单由 ${interaction.user.tag} 关闭`).catch(() => undefined);
      }, 5000);
    }
  }
}

export async function handleTicketModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId || !interaction.inCachedGuild()) return;

  const subject = interaction.fields.getTextInputValue('subject').trim();
  const detail = interaction.fields.getTextInputValue('detail').trim();

  const quota = ctx.services.ticket.canOpenTicket(interaction.guildId, interaction.user.id);
  if (!quota.allowed) {
    await interaction.reply({
      embeds: [createErrorEmbed('⚠️ 已达工单上限', '你已达到同时开启工单上限，请先关闭旧工单。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
  const botId = interaction.client.user.id;
  const overwrites: OverwriteResolvable[] = [
    {
      id: interaction.guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  for (const roleId of new Set([...cfg.ticket.staffRoleIds, ...cfg.adminRoleIds])) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const ticketNumberPreview = cfg.ticket.counter + 1;
  const padded = String(ticketNumberPreview).padStart(4, '0');
  const safeName = `ticket-${padded}`;

  const createdChannel = await interaction.guild.channels.create({
    name: safeName,
    type: ChannelType.GuildText,
    ...(cfg.ticket.categoryId ? { parent: cfg.ticket.categoryId } : {}),
    permissionOverwrites: overwrites,
    topic: `工单创建者: ${interaction.user.tag} | 主题: ${subject}`,
  });

  const ticket = ctx.services.ticket.createTicket(
    interaction.guildId,
    createdChannel.id,
    interaction.user.id,
    subject,
  );

  const staffMentions =
    cfg.ticket.staffRoleIds.length > 0
      ? cfg.ticket.staffRoleIds.map((r) => `<@&${r}>`).join(' ')
      : '';

  const welcomeEmbed = createInfoEmbed(
    `🎫 工单 #${String(ticket.ticketNumber).padStart(4, '0')} — ${subject}`,
    [
      `提交人：<@${interaction.user.id}>`,
      detail ? `详情：\n> ${detail}` : '请在下方直接发送你要反馈的详细内容或截图。',
    ].join('\n\n'),
  );

  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('关闭工单')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );

  await createdChannel.send({
    content: `<@${interaction.user.id}> ${staffMentions}`.trim(),
    embeds: [welcomeEmbed],
    components: [closeRow],
  });

  await interaction.reply({
    embeds: [
      createSuccessEmbed('✅ 工单已创建', `请前往 <#${createdChannel.id}> 与客服沟通。`),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
