import { ChannelType, EmbedBuilder, Events, type Client, type TextChannel } from 'discord.js';
import { renderTemplate } from '../services/welcomeService.js';
import { COLORS, type AppContext } from '../ui/embeds.js';

export function registerGuildMemberRemoveEvent(client: Client, ctx: AppContext): void {
  client.on(Events.GuildMemberRemove, async (member) => {
    if (member.user?.bot) return;

    const cfg = ctx.repos.guildConfig.getOrCreate(member.guild.id);
    if (!cfg.modules.welcome || !cfg.welcome.leaveEnabled || !cfg.welcome.leaveChannelId) {
      return;
    }

    const ch = member.guild.channels.cache.get(cfg.welcome.leaveChannelId);
    if (!ch || ch.type !== ChannelType.GuildText) return;

    const body = renderTemplate(cfg.welcome.leaveTemplate, {
      user: member.user.username,
      username: member.user.username,
      server: member.guild.name,
      memberCount: member.guild.memberCount,
      inviter: '未知',
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setDescription(body)
      .setTimestamp();

    await (ch as TextChannel).send({ embeds: [embed] }).catch(() => undefined);
  });
}
