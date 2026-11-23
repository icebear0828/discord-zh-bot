import {
  ActivityType,
  ChannelType,
  Events,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { buildGiveawayMessage } from '../commands/giveaways/giveaway.js';
import type { AwardXpResult } from '../services/levelingService.js';
import { createInfoEmbed, createSuccessEmbed, type AppContext } from '../ui/embeds.js';
import { buildRedPacketMessage } from '../ui/menuBuilder.js';

export async function syncLevelRewardRoles(
  member: GuildMember,
  res: AwardXpResult,
): Promise<void> {
  if (res.rolesToRemove.length > 0) {
    await member.roles.remove(res.rolesToRemove, '等级身份组更新').catch(() => undefined);
  }
  if (res.rolesToAdd.length > 0) {
    await member.roles.add(res.rolesToAdd, `升级至 Lv.${res.newLevel}`).catch(() => undefined);
  }
}

export async function sendLevelUpNotice(
  guild: Guild,
  fallbackChannelId: string | null,
  member: GuildMember,
  res: AwardXpResult,
  ctx: AppContext,
): Promise<void> {
  const cfg = ctx.repos.guildConfig.getOrCreate(guild.id);
  if (!cfg.leveling.announceEnabled || !res.leveledUp) {
    return;
  }

  const targetChannelId = cfg.leveling.announceChannelId ?? fallbackChannelId;
  if (!targetChannelId) return;

  const ch = guild.channels.cache.get(targetChannelId);
  if (!ch || ch.type !== ChannelType.GuildText) return;

  const rewardLines: string[] = [];
  if (res.coinsAwarded > 0) {
    rewardLines.push(`获得升级奖励：${cfg.economy.currencyEmoji} **+${res.coinsAwarded}** ${cfg.economy.currencyName}`);
  }
  if (res.rolesToAdd.length > 0) {
    rewardLines.push(`解锁新身份组：${res.rolesToAdd.map((r) => `<@&${r}>`).join('、')}`);
  }

  const embed = createSuccessEmbed(
    '🎉 等级提升！',
    [
      `恭喜 <@${member.id}> 升到 **Lv.${res.newLevel}**！`,
      ...rewardLines,
    ].join('\n'),
  ).setThumbnail(member.displayAvatarURL());

  await (ch as TextChannel).send({ embeds: [embed] }).catch(() => undefined);
}

export interface BackgroundSchedulers {
  stop(): void;
}

export function registerReadyEvent(client: Client, ctx: AppContext): BackgroundSchedulers {
  let voiceTimer: NodeJS.Timeout | null = null;
  let giveawayTimer: NodeJS.Timeout | null = null;
  let redPacketTimer: NodeJS.Timeout | null = null;
  let giveawayRunning = false;
  let redPacketRunning = false;

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[bot] 已登录为 ${readyClient.user.tag}，正在守护 ${readyClient.guilds.cache.size} 个服务器`);
    readyClient.user.setActivity('输入 /菜单 开始游玩 | /帮助', { type: ActivityType.Watching });

    // Sync invite cache for all guilds
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        const invites = await guild.invites.fetch();
        ctx.services.invite.syncGuildInvites(
          guild.id,
          [...invites.values()].map((inv) => ({
            code: inv.code,
            uses: inv.uses ?? 0,
            inviterId: inv.inviterId,
          })),
        );
      } catch {
        // Missing ManageGuild permission on this guild — skip invite cache gracefully
      }
    }

    // Voice XP tick (every 60s)
    voiceTimer = setInterval(() => {
      for (const guild of readyClient.guilds.cache.values()) {
        for (const voiceState of guild.voiceStates.cache.values()) {
          const member = voiceState.member;
          if (!member || member.user.bot) continue;
          if (!voiceState.channelId || voiceState.channelId === guild.afkChannelId) continue;
          if (voiceState.selfMute && voiceState.selfDeaf) continue;

          const activeHumans = voiceState.channel?.members.filter((m) => !m.user.bot).size ?? 0;
          if (activeHumans < 1) continue;

          const res = ctx.services.leveling.awardVoiceXp(guild.id, member.id);
          if (res.awarded && res.leveledUp) {
            void syncLevelRewardRoles(member, res);
            void sendLevelUpNotice(guild, null, member, res, ctx);
          }
        }
      }
    }, 60_000);

    // Giveaway due tick (every 10s, with overlap guard)
    giveawayTimer = setInterval(() => {
      if (giveawayRunning) return;
      giveawayRunning = true;
      void (async () => {
        try {
          const due = ctx.services.giveaway.getDueGiveaways();
          for (const item of due) {
            const finalized = ctx.services.giveaway.finalizeGiveaway(item.id);
            if (!finalized) continue;

            const guild = readyClient.guilds.cache.get(finalized.guildId);
            const ch = guild?.channels.cache.get(finalized.channelId);
            if (!ch || ch.type !== ChannelType.GuildText) continue;

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
          }
        } finally {
          giveawayRunning = false;
        }
      })();
    }, 10_000);

    // Red packet expiration tick (every 15s, with overlap guard)
    redPacketTimer = setInterval(() => {
      if (redPacketRunning) return;
      redPacketRunning = true;
      void (async () => {
        try {
          const expiredList = ctx.services.multiplayer.expireDueRedPackets();
          for (const { packet, refundedAmount } of expiredList) {
            if (!packet.messageId) continue;

            const guild = readyClient.guilds.cache.get(packet.guildId);
            const ch =
              guild?.channels.cache.get(packet.channelId) ??
              (await readyClient.channels.fetch(packet.channelId).catch(() => null));
            if (!ch || !ch.isTextBased()) continue;

            const cfg = ctx.repos.guildConfig.getOrCreate(packet.guildId).economy;
            const detail = ctx.services.multiplayer.getRedPacketWithClaims(packet.id);
            const msg = await ch.messages.fetch(packet.messageId).catch(() => null);
            if (msg && detail) {
              await msg
                .edit(buildRedPacketMessage(detail.packet, detail.claims, detail.bestLuckUserId, cfg))
                .catch(() => undefined);
            }

            if (refundedAmount > 0 && ch.isSendable()) {
              await ch
                .send({
                  embeds: [
                    createInfoEmbed(
                      '🧧 红包过期退回',
                      `<@${packet.senderId}> 的红包（#${packet.id}）已过期，剩余 ${cfg.currencyEmoji} **${refundedAmount}** ${cfg.currencyName} 已自动退回钱包。`,
                    ),
                  ],
                })
                .catch(() => undefined);
            }
          }
        } finally {
          redPacketRunning = false;
        }
      })();
    }, 15_000);
  });

  return {
    stop(): void {
      if (voiceTimer) clearInterval(voiceTimer);
      if (giveawayTimer) clearInterval(giveawayTimer);
      if (redPacketTimer) clearInterval(redPacketTimer);
      voiceTimer = null;
      giveawayTimer = null;
      redPacketTimer = null;
    },
  };
}
