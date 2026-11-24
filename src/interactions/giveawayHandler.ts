import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
} from 'discord.js';
import { buildGiveawayMessage } from '../commands/giveaways/giveaway.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
} from '../ui/embeds.js';
import { editChannelMessage } from './menuHelpers.js';

export async function handleGiveawayButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId || !interaction.inCachedGuild()) return;

  const [, action, idStr] = interaction.customId.split(':');
  if (action !== 'join' && action !== 'leave') return;

  const giveawayId = Number(idStr);
  if (!Number.isFinite(giveawayId)) return;

  if (action === 'join') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
    if (!cfg.modules.giveaways) {
      await interaction.editReply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器暂未开启抽奖系统。')],
      });
      return;
    }

    const profile = ctx.repos.profile.getOrCreate(interaction.guildId, interaction.user.id);
    const memberRoles = [...interaction.member.roles.cache.keys()];

    const res = ctx.services.giveaway.joinEntry(
      giveawayId,
      interaction.user.id,
      profile.level,
      memberRoles,
    );

    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '该抽奖活动不存在或已被清理。',
        ended: '该抽奖已经截止或开奖结束了！',
        level_too_low: `参与该抽奖需要达到 **Lv.${res.minLevel ?? 0}**，你当前为 Lv.${profile.level}。`,
        missing_role: `参与该抽奖需要持有身份组 <@&${res.requiredRoleId}>。`,
      };
      await interaction.editReply({
        embeds: [createErrorEmbed('❌ 无法参与抽奖', msgMap[res.reason])],
      });
      return;
    }

    if (res.alreadyJoined) {
      const leaveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway:leave:${giveawayId}`)
          .setLabel('确认退出抽奖')
          .setEmoji('👋')
          .setStyle(ButtonStyle.Danger),
      );

      await interaction.editReply({
        embeds: [
          createInfoEmbed(
            'ℹ️ 你已报名该抽奖',
            `你已经在参与名单中（当前共有 **${res.entryCount}** 人参与）。\n如确需退赛，请点击下方按钮确认。`,
          ),
        ],
        components: [leaveRow],
      });
      return;
    }

    const gw = ctx.services.giveaway.getById(giveawayId);
    if (gw) {
      await interaction.message.edit(buildGiveawayMessage(gw, res.entryCount)).catch(() => undefined);
    }

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          '🎉 报名成功！',
          `你已成功参与本轮抽奖，当前共有 **${res.entryCount}** 人参与，祝你好运！`,
        ),
      ],
    });
    return;
  }

  // action === 'leave' (from Ephemeral confirmation button)
  await interaction.deferUpdate();

  const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
  if (!cfg.modules.giveaways) {
    await interaction.editReply({
      embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器暂未开启抽奖系统。')],
      components: [],
    });
    return;
  }

  const res = ctx.services.giveaway.leaveEntry(giveawayId, interaction.user.id);
  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      not_found: '该抽奖活动不存在或已被清理。',
      ended: '该抽奖已经截止或开奖结束了，无法再退出。',
    };
    await interaction.editReply({
      embeds: [createErrorEmbed('❌ 无法退出抽奖', msgMap[res.reason])],
      components: [],
    });
    return;
  }

  if (res.left) {
    const gw = ctx.services.giveaway.getById(giveawayId);
    if (gw) {
      await editChannelMessage(
        interaction.client,
        gw.channelId,
        gw.messageId,
        buildGiveawayMessage(gw, res.entryCount),
        interaction.guild,
      );
    }

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          '👋 已退出抽奖',
          `你已退出本轮抽奖，当前共有 **${res.entryCount}** 人参与。`,
        ),
      ],
      components: [],
    });
    return;
  }

  await interaction.editReply({
    embeds: [createInfoEmbed('ℹ️ 未在报名名单中', '你当前并未报名该抽奖活动。')],
    components: [],
  });
}
