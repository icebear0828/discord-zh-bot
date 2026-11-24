import { EmbedBuilder, Events, type Client } from 'discord.js';
import { renderTemplate } from '../services/welcomeService.js';
import { COLORS, type AppContext } from '../ui/embeds.js';
import { truncateText } from '../ui/menuShared.js';

export function registerGuildMemberRemoveEvent(client: Client, ctx: AppContext): void {
  client.on(Events.GuildMemberRemove, async (member) => {
    if (member.user?.bot) return;

    const cfg = ctx.repos.guildConfig.getOrCreate(member.guild.id);
    if (!cfg.modules.welcome || !cfg.welcome.leaveEnabled || !cfg.welcome.leaveChannelId) {
      return;
    }

    const ch =
      member.guild.channels.cache.get(cfg.welcome.leaveChannelId) ??
      (await member.guild.channels.fetch(cfg.welcome.leaveChannelId).catch(() => null));
    if (!ch || !ch.isSendable()) return;

    const username = member.user?.username ?? '未知成员';
    const body = renderTemplate(cfg.welcome.leaveTemplate, {
      user: username,
      username,
      server: member.guild.name,
      memberCount: member.guild.memberCount,
      inviter: '未知',
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setDescription(truncateText(body, 4096))
      .setTimestamp();

    await ch.send({ embeds: [embed] }).catch(() => undefined);
  });
}
