import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { buildGiveawayMessage } from '../commands/giveaways/giveaway.js';
import { createErrorEmbed, createSuccessEmbed, type AppContext } from '../ui/embeds.js';

export async function handleGiveawayButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId || !interaction.inCachedGuild()) return;

  const [, action, idStr] = interaction.customId.split(':');
  if (action !== 'join') return;

  const giveawayId = Number(idStr);
  if (!Number.isFinite(giveawayId)) return;

  const profile = ctx.repos.profile.getOrCreate(interaction.guildId, interaction.user.id);
  const memberRoles = [...interaction.member.roles.cache.keys()];

  const res = ctx.services.giveaway.toggleEntry(
    giveawayId,
    interaction.user.id,
    profile.level,
    memberRoles,
  );

  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      not_found: '该抽奖活动不存在或已被清理。',
      ended: '该抽奖已经开奖结束了！',
      level_too_low: `参与该抽奖需要达到 **Lv.${res.minLevel ?? 0}**，你当前为 Lv.${profile.level}。`,
      missing_role: `参与该抽奖需要持有身份组 <@&${res.requiredRoleId}>。`,
    };
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 无法参与抽奖', msgMap[res.reason])],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const gw = ctx.services.giveaway.getById(giveawayId);
  if (gw) {
    await interaction.message.edit(buildGiveawayMessage(gw, res.entryCount)).catch(() => undefined);
  }

  await interaction.reply({
    embeds: [
      createSuccessEmbed(
        res.joined ? '🎉 报名成功！' : '👋 已取消报名',
        res.joined
          ? `你已成功参与本轮抽奖，当前共有 **${res.entryCount}** 人参与，祝你好运！`
          : `你已退出本轮抽奖，当前共有 **${res.entryCount}** 人参与。`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
