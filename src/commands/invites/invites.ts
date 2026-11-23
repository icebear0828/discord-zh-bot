import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { COLORS, type AppContext, type CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const invitesCommand: CommandDefinition = {
  name: 'invites',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('invites')
      .setDescription('查看自己或指定成员的邀请统计与近期邀请记录')
      .addUserOption((opt) =>
        applyZh(opt.setName('user').setDescription('目标成员（留空则看自己）'), '用户', '要查询的成员'),
      ),
    '邀请',
    '查看自己或指定成员的邀请统计与近期邀请记录',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'invites', '邀请追踪'))) return;

    const target = interaction.options.getUser('user') ?? interaction.user;
    const stats = ctx.services.invite.getUserStats(guildCtx.guildId, target.id);

    const recentText =
      stats.recent.length > 0
        ? stats.recent
            .slice(0, 8)
            .map(
              (r) =>
                `• <@${r.inviteeId}>（邀请码 \`${r.inviteCode}\` · <t:${Math.floor(r.joinedAt / 1000)}:R>）`,
            )
            .join('\n')
        : '暂无近期邀请记录';

    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setAuthor({
        name: `${target.displayName} 的邀请战绩`,
        iconURL: target.displayAvatarURL(),
      })
      .addFields(
        { name: '📨 累计成功邀请', value: `**${stats.count}** 人`, inline: true },
        { name: '🕒 近期邀请成员', value: recentText },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
