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
  type GuildMember,
  type ModalSubmitInteraction,
  type OverwriteResolvable,
  type TextChannel,
} from 'discord.js';
import { checkMemberIsBotAdmin } from '../commands/guards.js';
import type { GuildConfig } from '../config/defaults.js';
import type { TicketRecord } from '../db/repositories/ticketRepo.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
} from '../ui/embeds.js';

const ticketCloseMessageIds = new Map<number, string>();

export function formatBlockquote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

function canCloseTicket(member: GuildMember, cfg: GuildConfig, ticket: TicketRecord): boolean {
  if (member.id === ticket.creatorId) {
    return true;
  }
  if (checkMemberIsBotAdmin(member, cfg)) {
    return true;
  }
  const memberRoles = [...member.roles.cache.keys()];
  return cfg.ticket.staffRoleIds.some((roleId) => memberRoles.includes(roleId));
}

function buildDisabledCloseRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('工单已关闭')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

export async function handleTicketButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId || !interaction.inCachedGuild()) return;

  const [, action, idStr] = interaction.customId.split(':');

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
    if (!canCloseTicket(interaction.member, cfg, ticket)) {
      await interaction.reply({
        embeds: [
          createErrorEmbed('🔒 权限不足', '只有工单创建者、客服身份组或 Bot 管理员可以关闭此工单。'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.message?.id) {
      ticketCloseMessageIds.set(ticket.id, interaction.message.id);
    }

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:confirm_close:${ticket.id}`)
        .setLabel('确认关闭工单')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ticket:cancel_close:${ticket.id}`)
        .setLabel('取消')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      embeds: [
        createInfoEmbed(
          '⚠️ 确认关闭工单？',
          `你即将关闭工单 **#${String(ticket.ticketNumber).padStart(4, '0')}**（主题：**${ticket.subject}**）。\n确认后工单将立刻归档，且频道会在 **5 秒后永久删除**。`,
        ),
      ],
      components: [confirmRow],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'cancel_close') {
    await interaction.update({
      embeds: [createInfoEmbed('✅ 已取消关闭', '本工单将继续保持开启状态。')],
      components: [],
    });
    return;
  }

  if (action === 'confirm_close') {
    const expectedTicketId = Number(idStr);
    const ticket = ctx.services.ticket.getByChannel(interaction.channelId);
    if (
      !ticket ||
      ticket.status !== 'open' ||
      (Number.isFinite(expectedTicketId) && ticket.id !== expectedTicketId)
    ) {
      await interaction.update({
        embeds: [createErrorEmbed('❌ 工单已关闭', '该工单已关闭或不存在，无需重复操作。')],
        components: [],
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
    if (!canCloseTicket(interaction.member, cfg, ticket)) {
      await interaction.update({
        embeds: [
          createErrorEmbed('🔒 权限不足', '只有工单创建者、客服身份组或 Bot 管理员可以关闭此工单。'),
        ],
        components: [],
      });
      return;
    }

    await interaction.deferUpdate();
    ctx.services.ticket.closeTicket(interaction.channelId, interaction.user.id);

    const ch = interaction.channel;
    const sourceMsgId = ticketCloseMessageIds.get(ticket.id);
    ticketCloseMessageIds.delete(ticket.id);

    if (sourceMsgId && ch && ch.isTextBased()) {
      const sourceMsg = await ch.messages.fetch(sourceMsgId).catch(() => null);
      if (sourceMsg) {
        await sourceMsg.edit({ components: [buildDisabledCloseRow()] }).catch(() => undefined);
      }
    }

    await interaction.editReply({
      embeds: [createSuccessEmbed('🔒 已确认关闭', '本工单已标记关闭，频道将在 5 秒后删除。')],
      components: [],
    });

    if (ch && ch.isSendable()) {
      await ch
        .send({
          embeds: [
            createSuccessEmbed(
              '🔒 工单即将关闭',
              `本工单已由 <@${interaction.user.id}> 标记关闭，频道将在 5 秒后删除。`,
            ),
          ],
        })
        .catch(() => undefined);
    }

    if (cfg.ticket.logChannelId) {
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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
  if (!cfg.modules.tickets) {
    await interaction.editReply({
      embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器暂未开启工单功能。')],
    });
    return;
  }

  const subject = interaction.fields.getTextInputValue('subject').trim();
  const detail = interaction.fields.getTextInputValue('detail').trim();

  const reserved = ctx.services.ticket.reserveTicketSlot(
    interaction.guildId,
    interaction.user.id,
    ctx.db,
  );
  if (!reserved.ok) {
    await interaction.editReply({
      embeds: [
        createErrorEmbed(
          '⚠️ 已达工单上限',
          `你当前已有 **${reserved.openCount}** 个未关闭工单（上限 ${reserved.maxOpen} 个），请先关闭旧工单。`,
        ),
      ],
    });
    return;
  }

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

  const padded = String(reserved.ticketNumber).padStart(4, '0');
  const safeName = `ticket-${padded}`;

  let createdChannel: TextChannel | null = null;
  let ticketCreated = false;

  try {
    createdChannel = await interaction.guild.channels.create({
      name: safeName,
      type: ChannelType.GuildText,
      ...(cfg.ticket.categoryId ? { parent: cfg.ticket.categoryId } : {}),
      permissionOverwrites: overwrites,
      topic: `工单创建者: ${interaction.user.tag} | 主题: ${subject}`,
    });

    const ticket = ctx.services.ticket.finalizeReservedTicket(
      {
        guildId: interaction.guildId,
        channelId: createdChannel.id,
        creatorId: interaction.user.id,
        subject,
        ticketNumber: reserved.ticketNumber,
        reservationId: reserved.reservationId,
      },
      ctx.db,
    );
    ticketCreated = true;

    const staffMentions =
      cfg.ticket.staffRoleIds.length > 0
        ? cfg.ticket.staffRoleIds.map((r) => `<@&${r}>`).join(' ')
        : '';

    const welcomeEmbed = createInfoEmbed(
      `🎫 工单 #${String(ticket.ticketNumber).padStart(4, '0')} — ${subject}`,
      [
        `提交人：<@${interaction.user.id}>`,
        detail
          ? `详情：\n${formatBlockquote(detail)}`
          : '请在下方直接发送你要反馈的详细内容或截图。',
      ].join('\n\n'),
    );

    const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:close')
        .setLabel('关闭工单')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger),
    );

    const welcomeMsg = await createdChannel.send({
      content: `<@${interaction.user.id}> ${staffMentions}`.trim(),
      embeds: [welcomeEmbed],
      components: [closeRow],
    });
    if (welcomeMsg?.id) {
      ticketCloseMessageIds.set(ticket.id, welcomeMsg.id);
    }

    await interaction.editReply({
      embeds: [
        createSuccessEmbed('✅ 工单已创建', `请前往 <#${createdChannel.id}> 与客服沟通。`),
      ],
    });
  } catch (err) {
    console.error('[ticket] 创建工单失败，正在回滚:', err);
    ctx.services.ticket.rollbackTicket(
      interaction.guildId,
      interaction.user.id,
      ticketCreated && createdChannel ? createdChannel.id : null,
      reserved.reservationId,
      ctx.db,
    );
    if (createdChannel) {
      await createdChannel.delete('工单初始化失败自动回滚').catch(() => undefined);
    }
    await interaction.editReply({
      embeds: [
        createErrorEmbed(
          '❌ 工单创建失败',
          '创建工单频道或发送初始化消息时出错，请检查机器人是否拥有「管理频道」权限后重试。',
        ),
      ],
    });
  }
}
