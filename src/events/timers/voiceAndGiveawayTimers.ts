import type { Client } from 'discord.js';
import { MONITOR_RETENTION_MS } from '../../config/economyConstants.js';
import { buildGiveawayMessage } from '../../commands/giveaways/giveaway.js';
import type { AppContext } from '../../core/context.js';
import { sendLevelUpNotice, syncLevelRewardRoles } from './levelUpNotifier.js';

export function runVoiceXpTick(readyClient: Client, ctx: AppContext): void {
  try {
    for (const guild of readyClient.guilds.cache.values()) {
      for (const voiceState of guild.voiceStates.cache.values()) {
        try {
          const member = voiceState.member;
          if (!member || member.user.bot) continue;
          if (!voiceState.channelId || voiceState.channelId === guild.afkChannelId) continue;
          if (voiceState.selfMute && voiceState.selfDeaf) continue;
          if (voiceState.serverMute && voiceState.serverDeaf) continue;

          const activeHumans = voiceState.channel?.members.filter((m) => !m.user.bot).size ?? 0;
          if (activeHumans < 2) continue;

          const res = ctx.services.leveling.awardVoiceXp(guild.id, member.id);
          if (res.awarded && res.leveledUp) {
            void syncLevelRewardRoles(member, res).catch((err) => {
              console.error('[timer:voice:roles]', err);
            });
            void sendLevelUpNotice(guild, null, member, res, ctx).catch((err) => {
              console.error('[timer:voice:notice]', err);
            });
          }
        } catch (err) {
          console.error('[timer:voice:member]', err);
        }
      }
    }
  } catch (err) {
    console.error('[timer:voice]', err);
  }
}

export async function runGiveawayTick(readyClient: Client, ctx: AppContext): Promise<void> {
  try {
    const due = ctx.services.giveaway.getDueGiveaways();
    for (const item of due) {
      try {
        const finalized = ctx.services.giveaway.finalizeGiveaway(item.id);
        if (!finalized) continue;

        const guild = readyClient.guilds.cache.get(finalized.guildId);
        const ch =
          guild?.channels.cache.get(finalized.channelId) ??
          (await guild?.channels.fetch(finalized.channelId).catch(() => null)) ??
          (await readyClient.channels.fetch(finalized.channelId).catch(() => null));
        if (!ch || !ch.isSendable()) continue;

        const entryCount = ctx.services.giveaway.countEntries(finalized.id);
        const msg = await ch.messages.fetch(finalized.messageId).catch(() => null);
        if (msg) {
          await msg.edit(buildGiveawayMessage(finalized, entryCount)).catch(() => undefined);
        }

        const announceText =
          finalized.winners.length > 0
            ? `🎉 恭喜 ${finalized.winners.map((w) => `<@${w}>`).join('、')} 在抽奖 **#${finalized.id}「${finalized.prize}」** 中获奖！`
            : `抽奖 **#${finalized.id}「${finalized.prize}」** 已结束，因无人参与流拍。`;
        await ch.send(announceText).catch(() => undefined);
      } catch (itemErr) {
        console.error(`[timer:giveaway:item:${item.id}]`, itemErr);
      }
    }
  } catch (err) {
    console.error('[timer:giveaway]', err);
  }
}

export function runMonitorPruneTick(ctx: AppContext, nowMs = Date.now()): number {
  try {
    return ctx.repos.monitor?.pruneOlderThan(nowMs - MONITOR_RETENTION_MS) ?? 0;
  } catch (err) {
    console.error('[timer:monitor_prune]', err);
    return 0;
  }
}
