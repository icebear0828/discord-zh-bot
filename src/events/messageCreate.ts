import { Events, type Client } from 'discord.js';
import { sendToChannel } from '../interactions/menuHelpers.js';
import type { AppContext } from '../ui/embeds.js';
import { buildWorldBossCard, buildWorldChestCard } from '../ui/worldEventMenuBuilder.js';
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
    if (res.awarded && res.leveledUp) {
      await syncLevelRewardRoles(message.member, res);
      await sendLevelUpNotice(message.guild, message.channelId, message.member, res, ctx);
    }

    const spawned = ctx.services.worldEvent.tryAutoSpawnOnMessage(
      message.guild.id,
      message.channelId,
    );
    if (spawned) {
      const cfg = ctx.repos.guildConfig.getOrCreate(message.guild.id).economy;
      const payload =
        spawned.eventType === 'chest'
          ? {
              content: `🎁 群聊热闹起来了！天降 **${spawned.name}**，快来抢先开箱！`,
              ...buildWorldChestCard(spawned, [], cfg),
            }
          : {
              content: `👹 警报！世界 Boss **${spawned.name}** 被热闹气氛吸引降临本频道，快来集火讨伐！`,
              ...buildWorldBossCard(spawned, [], cfg),
            };
      const msgId = await sendToChannel(client, spawned.channelId, payload);
      if (msgId) {
        ctx.services.worldEvent.bindWorldEventMessage(spawned.id, msgId);
      } else {
        ctx.repos.worldEvent.saveWorldEvent({ ...spawned, status: 'expired' });
      }
    }
  });
}
