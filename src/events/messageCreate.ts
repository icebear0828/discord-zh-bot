import { Events, type Client } from 'discord.js';
import type { AppContext } from '../ui/embeds.js';
import { sendLevelUpNotice, syncLevelRewardRoles } from './ready.js';

export function registerMessageCreateEvent(client: Client, ctx: AppContext): void {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild || !message.member) {
      return;
    }

    const res = ctx.services.leveling.awardMessageXp(
      message.guild.id,
      message.author.id,
      message.channelId,
    );
    if (!res.awarded || !res.leveledUp) {
      return;
    }

    await syncLevelRewardRoles(message.member, res);
    await sendLevelUpNotice(message.guild, message.channelId, message.member, res, ctx);
  });
}
