import {
  ActivityType,
  Events,
  type Client,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { DEFAULT_LEVELING_CONFIG, type GuildConfig } from '../config/defaults.js';
import { MONITOR_RETENTION_MS } from '../config/economyConstants.js';
import { buildGiveawayMessage } from '../commands/giveaways/giveaway.js';
import { applyRouletteTimeoutPenalty } from '../interactions/duelArenaHandler.js';
import { editChannelMessage, sendToChannel } from '../interactions/menuHelpers.js';
import { getDuelArenaService } from '../services/duelArenaService.js';
import { renderLevelUpTemplate, type AwardXpResult } from '../services/levelingService.js';
import { buildNumberBombCard, buildRouletteCard } from '../ui/chaosMenuBuilder.js';
import { buildRouletteDuelCard, buildRpsDuelCard } from '../ui/duelArenaBuilder.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
} from '../ui/embeds.js';
import { buildDuelMessage, buildRedPacketMessage } from '../ui/menuBuilder.js';
import { truncateText } from '../ui/menuShared.js';
import { buildPublicTrialCard } from '../ui/rpgMenuBuilder.js';
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
    stat: res.statValue,
    statGained: res.statGained,
    statUnit: cfg.leveling.statUnit,
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
  if (
    cfg.leveling.statEnabled &&
    res.statGained > 0 &&
    !rawTemplate.includes('{stat}') &&
    !rawTemplate.includes('{statGained}')
  ) {
    rewardLines.push(
      `📏 ${cfg.leveling.statName}：+${res.statGained} ${cfg.leveling.statUnit}（当前 **${res.statValue}** ${cfg.leveling.statUnit}）`,
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

  const ch =
    guild.channels.cache.get(targetChannelId) ??
    (await guild.channels.fetch(targetChannelId).catch(() => null));
  if (!ch || !ch.isSendable()) return;

  const embed = buildLevelUpEmbed(cfg, member, res);

  await ch.send({ embeds: [embed] }).catch(() => undefined);
}

export interface BackgroundSchedulers {
  stop(): void;
}

const MONITOR_PRUNE_INTERVAL_MS = 60 * 60_000;

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

export async function runRedPacketTick(readyClient: Client, ctx: AppContext): Promise<void> {
  try {
    const expiredList = ctx.services.multiplayer.expireDueRedPackets();
    for (const { packet, refundedAmount } of expiredList) {
      try {
        if (!packet.messageId) continue;

        const guild = readyClient.guilds.cache.get(packet.guildId);
        const ch =
          guild?.channels.cache.get(packet.channelId) ??
          (await guild?.channels.fetch(packet.channelId).catch(() => null)) ??
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
      } catch (itemErr) {
        console.error(`[timer:redpacket:item:${packet.id}]`, itemErr);
      }
    }
  } catch (err) {
    console.error('[timer:redpacket]', err);
  }
}

export async function runGamesTick(readyClient: Client, ctx: AppContext): Promise<void> {
  try {
    try {
      const rouletteUpdates = ctx.services.chaos.processTimedOutRoulettes();
      for (const upd of rouletteUpdates) {
        try {
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
        } catch (itemErr) {
          console.error(`[timer:games:roulette:${upd.game.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:roulette]', subErr);
    }

    try {
      const expiredBombs = ctx.services.chaos.expireDueNumberBombs();
      for (const bomb of expiredBombs) {
        try {
          const cfg = ctx.repos.guildConfig.getOrCreate(bomb.guildId).economy;
          const guild = readyClient.guilds.cache.get(bomb.guildId);
          await editChannelMessage(
            readyClient,
            bomb.channelId,
            bomb.messageId,
            buildNumberBombCard(bomb, cfg),
            guild,
          );
        } catch (itemErr) {
          console.error(`[timer:games:bomb:${bomb.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:bomb]', subErr);
    }

    try {
      const lockedPreds = ctx.services.worldEvent.autoLockDuePredictions();
      for (const summary of lockedPreds) {
        try {
          const cfg = ctx.repos.guildConfig.getOrCreate(summary.prediction.guildId).economy;
          const guild = readyClient.guilds.cache.get(summary.prediction.guildId);
          await editChannelMessage(
            readyClient,
            summary.prediction.channelId,
            summary.prediction.messageId,
            buildPredictionCard(summary, cfg, '🔒 封盘倒计时结束，等待开盘人或管理员宣布胜出结果'),
            guild,
          );
        } catch (itemErr) {
          console.error(`[timer:games:prediction:${summary.prediction.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:prediction]', subErr);
    }

    try {
      const expiredWorldEvents = ctx.services.worldEvent.expireDueWorldEvents();
      for (const item of expiredWorldEvents) {
        try {
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
        } catch (itemErr) {
          console.error(`[timer:games:worldEvent:${item.event.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:worldEvent]', subErr);
    }

    try {
      const settledTrials = ctx.services.rpg?.settleDuePublicTrials?.() ?? [];
      for (const item of settledTrials) {
        if (!item.ok) continue;
        try {
          const economy = ctx.repos.guildConfig.getOrCreate(item.trial.guildId).economy;
          const guild = readyClient.guilds.cache.get(item.trial.guildId);
          await editChannelMessage(
            readyClient,
            item.trial.channelId,
            item.trial.messageId,
            buildPublicTrialCard(item.trial, economy, item.supporterPayouts),
            guild,
          );
          if (item.succeeded) {
            const candyNote =
              item.supporterPayouts.length > 0
                ? `\n🍬 助威喜糖已发放：${item.supporterPayouts.map((p) => `<@${p.userId}> +${p.amount}`).join('、')}`
                : '';
            await sendToChannel(
              readyClient,
              item.trial.channelId,
              {
                allowedMentions: { parse: ['users'] },
                embeds: [
                  createSuccessEmbed(
                    '⚡ 公开破境试炼捷报！',
                    `恭喜 <@${item.trial.userId}> 成功从 **${item.fromRealm.fullLabel}** 晋升为 **${item.toRealm.fullLabel}**（赏金 **+${item.netCoins.toLocaleString('en-US')}** ${economy.currencyName}）！${candyNote}`,
                  ),
                ],
              },
              guild,
            );
          }
        } catch (itemErr) {
          console.error(`[timer:games:rpgTrial:${item.trial.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:rpgTrial]', subErr);
    }

    try {
      const expiredProposals = ctx.services.socialPet.expireDueProposals();
      for (const prop of expiredProposals) {
        try {
          const cfg = ctx.repos.guildConfig.getOrCreate(prop.guildId).economy;
          const guild = readyClient.guilds.cache.get(prop.guildId);
          await editChannelMessage(
            readyClient,
            prop.channelId,
            prop.messageId,
            buildProposalCard(prop, cfg),
            guild,
          );
        } catch (itemErr) {
          console.error(`[timer:games:proposal:${prop.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:proposal]', subErr);
    }

    try {
      const expiredBattles = ctx.services.socialPet.expireDuePetBattles();
      for (const battle of expiredBattles) {
        try {
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
        } catch (itemErr) {
          console.error(`[timer:games:petBattle:${battle.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:petBattle]', subErr);
    }
    try {
      ctx.services.blackjack.expireDueGames();
    } catch (subErr) {
      console.error('[timer:games:blackjack]', subErr);
    }

    try {
      const expiredDuels = ctx.services.multiplayer.expireDueDuels();
      for (const duel of expiredDuels) {
        try {
          if (!duel.messageId) continue;
          const cfg = ctx.repos.guildConfig.getOrCreate(duel.guildId).economy;
          const guild = readyClient.guilds.cache.get(duel.guildId);
          await editChannelMessage(
            readyClient,
            duel.channelId,
            duel.messageId,
            buildDuelMessage(duel, cfg),
            guild,
          );
        } catch (itemErr) {
          console.error(`[timer:games:duel:${duel.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:duel]', subErr);
    }

    try {
      const duelArena = getDuelArenaService(ctx);
      const rpsUpdates = duelArena.processTimedOutRpsDuels();
      for (const upd of rpsUpdates) {
        try {
          if (!upd.duel.messageId) continue;
          const cfg = ctx.repos.guildConfig.getOrCreate(upd.duel.guildId).economy;
          const guild = readyClient.guilds.cache.get(upd.duel.guildId);
          await editChannelMessage(
            readyClient,
            upd.duel.channelId,
            upd.duel.messageId,
            buildRpsDuelCard(upd.duel, cfg),
            guild,
          );
          if (upd.kind === 'round_forfeit' && upd.matchFinished && upd.winnerId && upd.loserId) {
            await sendToChannel(readyClient, upd.duel.channelId, {
              content: `⌛ 回合超时判负！🏆 <@${upd.winnerId}> 赢得石头剪刀布决斗（击败 <@${upd.loserId}>），请点击战报卡片行使改名权！`,
            });
          }
        } catch (itemErr) {
          console.error(`[timer:games:rpsDuel:${upd.duel.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:rpsDuel]', subErr);
    }

    try {
      const duelArena = getDuelArenaService(ctx);
      const rouletteDuelUpdates = duelArena.processTimedOutRouletteDuels();
      for (const upd of rouletteDuelUpdates) {
        try {
          const cfg = ctx.repos.guildConfig.getOrCreate(upd.duel.guildId).economy;
          const guild = readyClient.guilds.cache.get(upd.duel.guildId) ?? null;
          let penaltyNote: string | undefined;
          if (
            upd.kind === 'turn_timeout' &&
            upd.fired &&
            upd.loserId &&
            upd.timeoutDurationMs > 0
          ) {
            penaltyNote =
              (await applyRouletteTimeoutPenalty({
                guild,
                targetId: upd.loserId,
                timeoutDurationMs: upd.timeoutDurationMs,
                winnerName: upd.winnerId ?? '胜者',
              })) ?? undefined;
          }
          if (upd.duel.messageId) {
            await editChannelMessage(
              readyClient,
              upd.duel.channelId,
              upd.duel.messageId,
              buildRouletteDuelCard(upd.duel, cfg, penaltyNote),
              guild,
            );
          }
          if (upd.kind === 'turn_timeout' && upd.fired && upd.winnerId && upd.loserId) {
            await sendToChannel(readyClient, upd.duel.channelId, {
              content: `⌛ 超时自动扣扳机💥！🏆 <@${upd.winnerId}> 赢得 1v1 俄罗斯轮盘（击败 <@${upd.loserId}>）！`,
            });
          }
        } catch (itemErr) {
          console.error(`[timer:games:rouletteDuel:${upd.duel.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:rouletteDuel]', subErr);
    }

    try {
      const duelArena = getDuelArenaService(ctx);
      const expiredLocks = duelArena.expireDueNicknameLocks();
      for (const lock of expiredLocks) {
        if (lock.fallbackMode || !lock.originalNicknameCaptured) continue;
        try {
          const guild =
            readyClient.guilds.cache.get(lock.guildId) ??
            (await readyClient.guilds.fetch(lock.guildId).catch(() => null));
          if (!guild) continue;
          const member = await guild.members.fetch(lock.targetId).catch(() => null);
          if (!member) continue;
          await member
            .setNickname(lock.originalNickname, '决斗改名惩罚到期，自动恢复原昵称')
            .catch(() => undefined);
        } catch (itemErr) {
          console.error(`[timer:games:nickLock:${lock.guildId}:${lock.targetId}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:nickLock]', subErr);
    }

    try {
      const expiredLockedPreds = ctx.services.worldEvent.expireDueLockedPredictions();
      for (const { summary } of expiredLockedPreds) {
        try {
          const cfg = ctx.repos.guildConfig.getOrCreate(summary.prediction.guildId).economy;
          const guild = readyClient.guilds.cache.get(summary.prediction.guildId);
          await editChannelMessage(
            readyClient,
            summary.prediction.channelId,
            summary.prediction.messageId,
            buildPredictionCard(
              summary,
              cfg,
              '⌛ 封盘超过 72 小时未结算，系统已自动作废并全额退还全部押注',
            ),
            guild,
          );
        } catch (itemErr) {
          console.error(`[timer:games:predictionExpire:${summary.prediction.id}]`, itemErr);
        }
      }
    } catch (subErr) {
      console.error('[timer:games:predictionExpire]', subErr);
    }
  } catch (err) {
    console.error('[timer:games]', err);
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

export async function runOverdueLoanTick(readyClient: Client, ctx: AppContext): Promise<void> {
  try {
    const notices = ctx.services.creditLoan.processOverdueLoans(Date.now());
    for (const notice of notices) {
      try {
        const guild = readyClient.guilds.cache.get(notice.guildId);
        if (!guild) continue;
        const guildCfg = ctx.repos.guildConfig.getOrCreate(notice.guildId);
        const targetChannelId =
          guildCfg.games.eventChannelId ?? guildCfg.leveling.announceChannelId;
        if (!targetChannelId) continue;

        const currency = guildCfg.economy.currencyName;
        const loanLabel = notice.loanType === 'bank' ? '🏦 银行贷款' : '🩸 黑市高利贷';
        const lines = [
          `债务人：<@${notice.userId}> ｜ 借据：**${loanLabel} #${notice.loanId}**`,
          `💸 今日罚息：**+${notice.penaltyAdded.toLocaleString()}** ${currency}`,
          `📉 信用扣分：**${notice.creditDelta}**（当前信用分 **${notice.creditScore}**）`,
        ];
        if (notice.totalSeized > 0) {
          lines.push(
            `🚨 强制划扣：**${notice.totalSeized.toLocaleString()}** ${currency}（口袋 ${notice.seizedFromPocket.toLocaleString()} / 银行 ${notice.seizedFromBank.toLocaleString()}）`,
          );
        }
        lines.push(
          notice.clearedBySeize
            ? '✅ 本次强扣已将全部欠款结清！'
            : `⚠️ 剩余欠款：**${notice.remainingDebt.toLocaleString()}** ${currency}（逾期期间禁赌禁转账，收益自动强扣还债）`,
        );
        if (notice.bountyPostedNow) {
          lines.push(
            `🎯 **黑市追杀令已发布**：系统已对其追加悬赏 **${notice.bountyAmount.toLocaleString()}** ${currency}！`,
          );
        }

        await sendToChannel(readyClient, targetChannelId, {
          content: `📢 <@${notice.userId}> 贷款逾期催收通告！`,
          embeds: [createErrorEmbed('📢 失信老赖催收大字报', lines.join('\n'))],
        });
      } catch (itemErr) {
        console.error(`[timer:overdue:loan:${notice.loanId}]`, itemErr);
      }
    }
  } catch (err) {
    console.error('[timer:overdue]', err);
  }
}

export function registerReadyEvent(client: Client, ctx: AppContext): BackgroundSchedulers {
  let voiceTimer: NodeJS.Timeout | null = null;
  let giveawayTimer: NodeJS.Timeout | null = null;
  let redPacketTimer: NodeJS.Timeout | null = null;
  let gamesTimer: NodeJS.Timeout | null = null;
  let overdueTimer: NodeJS.Timeout | null = null;
  let monitorPruneTimer: NodeJS.Timeout | null = null;
  let giveawayRunning = false;
  let redPacketRunning = false;
  let gamesRunning = false;
  let overdueRunning = false;

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[bot] 已登录为 ${readyClient.user.tag}，正在守护 ${readyClient.guilds.cache.size} 个服务器`);
    readyClient.user.setActivity('输入 /菜单 开始游玩 | /帮助', { type: ActivityType.Watching });

    // Sync invite cache & migrate legacy AI persona configs into ai-packs for all guilds
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        ctx.services.ai.migrateLegacyGuildConfigToPacks(guild.id);
      } catch (err) {
        console.error(`[ai:migrate:${guild.id}]`, err);
      }
      try {
        const invites = await guild.invites.fetch();
        ctx.services.invite.syncGuildInvites(
          guild.id,
          [...invites.values()].map((inv) => ({
            code: inv.code,
            uses: inv.uses ?? 0,
            inviterId: inv.inviterId,
            maxUses: inv.maxUses,
          })),
        );
      } catch {
        // Missing ManageGuild permission on this guild — skip invite cache gracefully
      }
    }

    // Voice XP tick (every 60s)
    voiceTimer = setInterval(() => {
      runVoiceXpTick(readyClient, ctx);
    }, 60_000);

    // Giveaway due tick (every 10s, with overlap guard)
    giveawayTimer = setInterval(() => {
      if (giveawayRunning) return;
      giveawayRunning = true;
      void runGiveawayTick(readyClient, ctx).finally(() => {
        giveawayRunning = false;
      });
    }, 10_000);

    // Red packet expiration tick (every 15s, with overlap guard)
    redPacketTimer = setInterval(() => {
      if (redPacketRunning) return;
      redPacketRunning = true;
      void runRedPacketTick(readyClient, ctx).finally(() => {
        redPacketRunning = false;
      });
    }, 15_000);

    // Games & events tick (every 5s, with overlap guard)
    gamesTimer = setInterval(() => {
      if (gamesRunning) return;
      gamesRunning = true;
      void runGamesTick(readyClient, ctx).finally(() => {
        gamesRunning = false;
      });
    }, 5_000);

    // Overdue loan collection & public shaming tick (every 60s, with overlap guard)
    overdueTimer = setInterval(() => {
      if (overdueRunning) return;
      overdueRunning = true;
      void runOverdueLoanTick(readyClient, ctx).finally(() => {
        overdueRunning = false;
      });
    }, 60_000);

    // Low-frequency monitor log retention cleanup (every 1h)
    monitorPruneTimer = setInterval(() => {
      runMonitorPruneTick(ctx);
    }, MONITOR_PRUNE_INTERVAL_MS);
  });

  return {
    stop(): void {
      if (voiceTimer) clearInterval(voiceTimer);
      if (giveawayTimer) clearInterval(giveawayTimer);
      if (redPacketTimer) clearInterval(redPacketTimer);
      if (gamesTimer) clearInterval(gamesTimer);
      if (overdueTimer) clearInterval(overdueTimer);
      if (monitorPruneTimer) clearInterval(monitorPruneTimer);
      voiceTimer = null;
      giveawayTimer = null;
      redPacketTimer = null;
      gamesTimer = null;
      overdueTimer = null;
      monitorPruneTimer = null;
    },
  };
}
