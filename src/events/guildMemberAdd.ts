import { ChannelType, EmbedBuilder, Events, type Client, type TextChannel } from 'discord.js';
import { renderTemplate } from '../services/welcomeService.js';
import { COLORS, type AppContext } from '../ui/embeds.js';

export function registerGuildMemberAddEvent(client: Client, ctx: AppContext): void {
  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.bot) return;

    const cfg = ctx.repos.guildConfig.getOrCreate(member.guild.id);
    let inviterText = '未知（链接或社区发现）';

    if (cfg.modules.invites) {
      try {
        const invites = await member.guild.invites.fetch();
        const match = ctx.services.invite.detectAndRecordJoin(
          member.guild.id,
          member.id,
          [...invites.values()].map((inv) => ({
            code: inv.code,
            uses: inv.uses ?? 0,
            inviterId: inv.inviterId,
          })),
        );
        if (match) {
          inviterText = `<@${match.inviterId}>`;
        }
      } catch {
        // Missing ManageGuild permission — keep fallback text
      }
    }

    if (cfg.welcome.autoRoleIds.length > 0) {
      await member.roles.add(cfg.welcome.autoRoleIds, '入群自动发放身份组').catch((err) => {
        console.warn(`[welcome] 自动发放身份组失败 (${member.guild.id}):`, err);
      });
    }

    if (!cfg.modules.welcome || !cfg.welcome.welcomeEnabled || !cfg.welcome.welcomeChannelId) {
      return;
    }

    const ch = member.guild.channels.cache.get(cfg.welcome.welcomeChannelId);
    if (!ch || ch.type !== ChannelType.GuildText) return;

    const body = renderTemplate(cfg.welcome.welcomeTemplate, {
      user: `<@${member.id}>`,
      username: member.user.username,
      server: member.guild.name,
      memberCount: member.guild.memberCount,
      inviter: inviterText,
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(cfg.welcome.welcomeTitle)
      .setDescription(body)
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: `当前服务器成员数：${member.guild.memberCount}` })
      .setTimestamp();

    await (ch as TextChannel).send({ content: `<@${member.id}>`, embeds: [embed] }).catch(() => undefined);
  });
}
