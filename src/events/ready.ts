import {
  ActivityType,
  ChannelType,
  Events,
  type Client,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { DEFAULT_LEVELING_CONFIG, type GuildConfig } from '../config/defaults.js';
import { buildGiveawayMessage } from '../commands/giveaways/giveaway.js';
import { editChannelMessage, sendToChannel } from '../interactions/menuHelpers.js';
import { renderLevelUpTemplate, type AwardXpResult } from '../services/levelingService.js';
import { buildNumberBombCard, buildRouletteCard } from '../ui/chaosMenuBuilder.js';
import { createInfoEmbed, createSuccessEmbed, type AppContext } from '../ui/embeds.js';
import { buildRedPacketMessage } from '../ui/menuBuilder.js';
import { truncateText } from '../ui/menuShared.js';
import { buildPetBattleCard, buildProposalCard } from '../ui/socialPetMenuBuilder.js';
import {
  buildPredictionCard,
  buildWorldBossCard,
  buildWorldChestCard,
} from '../ui/worldEventMenuBuilder.js';

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

export function buildLevelUpEmbed(
  cfg: GuildConfig,
  member: { id: string; displayName: string; displayAvatarURL(): string },
  res: AwardXpResult,
): EmbedBuilder {
  const rolesText =
    res.rolesToAdd.length > 0 ? res.rolesToAdd.map((r) => `<@&${r}>`).join('、') : '无';
  const vars = {
    user: `<@${member.id}>`,
    username: member.displayName,
    level: res.newLevel,
    oldLevel: res.oldLevel,
    coins: res.coinsAwarded,
    currency: cfg.economy.currencyName,
    roles: rolesText,
  };

  const rawTitle = cfg.leveling.levelUpTitle.trim() || DEFAULT_LEVELING_CONFIG.levelUpTitle;
  const rawTemplate = cfg.leveling.levelUpTemplate.trim() || DEFAULT_LEVELING_CONFIG.levelUpTemplate;

  const title = truncateText(renderLevelUpTemplate(rawTitle, vars), 256);
  const mainLine = renderLevelUpTemplate(rawTemplate, vars);

  const rewardLines: string[] = [];
  if (res.coinsAwarded > 0 && !rawTemplate.includes('{coins}')) {
    rewardLines.push(
      `获得升级奖励：${cfg.economy.currencyEmoji} **+${res.coinsAwarded}** ${cfg.economy.currencyName}`,
    );
  }
  if (res.rolesToAdd.length > 0 && !rawTemplate.includes('{roles}')) {
    rewardLines.push(`解锁新身份组：${rolesText}`);
  }

  return createSuccessEmbed(
    title,
    truncateText([mainLine, ...rewardLines].join('\n'), 4096),
  ).setThumbnail(member.displayAvatarURL());
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

  const embed = buildLevelUpEmbed(cfg, member, res);

  await (ch as TextChannel).send({ embeds: [embed] }).catch(() => undefined);
}

export interface BackgroundSchedulers {
  stop(): void;
}

export function registerReadyEvent(client: Client, ctx: AppContext): BackgroundSchedulers {
  let voiceTimer: NodeJS.Timeout | null = null;
  let giveawayTimer: NodeJS.Timeout | null = null;
  let redPacketTimer: NodeJS.Timeout | null = null;
  let gamesTimer: NodeJS.Timeout | null = null;
  let giveawayRunning = false;
  let redPacketRunning = false;
  let gamesRunning = false;

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

    // Games & events tick (every 5s, with overlap guard)
    gamesTimer = setInterval(() => {
      if (gamesRunning) return;
      gamesRunning = true;
      void (async () => {
        try {
          const rouletteUpdates = ctx.services.chaos.processTimedOutRoulettes();
          for (const upd of rouletteUpdates) {
            const cfg = ctx.repos.guildConfig.getOrCreate(upd.game.guildId).economy;
            const guild = readyClient.guilds.cache.get(upd.game.guildId);
            await editChannelMessage(
              readyClient,
              upd.game.channelId,
              upd.game.messageId,
              buildRouletteCard(upd.game, cfg),
              guild,
            );
            if (upd.kind === 'turn_timeout' && upd.game.status === 'finished' && upd.winnerId) {
              await sendToChannel(readyClient, upd.game.channelId, {
                content: `⌛ 超时自动结算！🏆 轮盘 **#${upd.game.id}** 由 <@${upd.winnerId}> 独吞 **${upd.prizePool ?? 0}** ${cfg.currencyName}！`,
              });
            }
          }

          const expiredBombs = ctx.services.chaos.expireDueNumberBombs();
          for (const bomb of expiredBombs) {
            const cfg = ctx.repos.guildConfig.getOrCreate(bomb.guildId).economy;
            const guild = readyClient.guilds.cache.get(bomb.guildId);
            await editChannelMessage(
              readyClient,
              bomb.channelId,
              bomb.messageId,
              buildNumberBombCard(bomb, cfg),
              guild,
            );
          }

          const lockedPreds = ctx.services.worldEvent.autoLockDuePredictions();
          for (const summary of lockedPreds) {
            const cfg = ctx.repos.guildConfig.getOrCreate(summary.prediction.guildId).economy;
            const guild = readyClient.guilds.cache.get(summary.prediction.guildId);
            await editChannelMessage(
              readyClient,
              summary.prediction.channelId,
              summary.prediction.messageId,
              buildPredictionCard(summary, cfg, '🔒 封盘倒计时结束，等待开盘人或管理员宣布胜出结果'),
              guild,
            );
          }

          const expiredWorldEvents = ctx.services.worldEvent.expireDueWorldEvents();
          for (const item of expiredWorldEvents) {
            const cfg = ctx.repos.guildConfig.getOrCreate(item.event.guildId).economy;
            const guild = readyClient.guilds.cache.get(item.event.guildId);
            const payload =
              item.event.eventType === 'chest'
                ? buildWorldChestCard(item.event, item.participants, cfg)
                : buildWorldBossCard(item.event, item.participants, cfg);
            await editChannelMessage(
              readyClient,
              item.event.channelId,
              item.event.messageId,
              payload,
              guild,
            );
            if (item.event.eventType === 'boss' && item.consolations.length > 0) {
              await sendToChannel(readyClient, item.event.channelId, {
                embeds: [
                  createInfoEmbed(
                    `🏃 世界 Boss「${item.event.name}」已逃走`,
                    `已向参与输出的 **${item.consolations.length}** 位勇士发放参与安慰奖（30~150 ${cfg.currencyName}）。`,
                  ),
                ],
              });
            }
          }

          const expiredProposals = ctx.services.socialPet.expireDueProposals();
          for (const prop of expiredProposals) {
            const cfg = ctx.repos.guildConfig.getOrCreate(prop.guildId).economy;
            const guild = readyClient.guilds.cache.get(prop.guildId);
            await editChannelMessage(
              readyClient,
              prop.channelId,
              prop.messageId,
              buildProposalCard(prop, cfg),
              guild,
            );
          }

          const expiredBattles = ctx.services.socialPet.expireDuePetBattles();
          for (const battle of expiredBattles) {
            const cfg = ctx.repos.guildConfig.getOrCreate(battle.guildId).economy;
            const guild = readyClient.guilds.cache.get(battle.guildId);
            const cPet = ctx.services.socialPet.getPetById(battle.challengerPetId);
            await editChannelMessage(
              readyClient,
              battle.channelId,
              battle.messageId,
              buildPetBattleCard(battle, cPet, null, cfg),
              guild,
            );
          }
        } finally {
          gamesRunning = false;
        }
      })();
    }, 5_000);
  });

  return {
    stop(): void {
      if (voiceTimer) clearInterval(voiceTimer);
      if (giveawayTimer) clearInterval(giveawayTimer);
      if (redPacketTimer) clearInterval(redPacketTimer);
      if (gamesTimer) clearInterval(gamesTimer);
      voiceTimer = null;
      giveawayTimer = null;
      redPacketTimer = null;
      gamesTimer = null;
    },
  };
}
