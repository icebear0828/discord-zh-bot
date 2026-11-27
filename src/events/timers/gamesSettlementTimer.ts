import type { Client } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { applyRouletteTimeoutPenalty } from '../../interactions/duelArenaHandler.js';
import { editChannelMessage, sendToChannel } from '../../interactions/menuHelpers.js';
import { getDuelArenaService } from '../../services/duelArenaService.js';
import { buildNumberBombCard, buildRouletteCard } from '../../ui/chaosMenuBuilder.js';
import { buildRouletteDuelCard, buildRpsDuelCard } from '../../ui/duelArenaBuilder.js';
import { createInfoEmbed, createSuccessEmbed } from '../../ui/embeds.js';
import { buildDuelMessage } from '../../ui/menuBuilder.js';
import {
  buildPublicTrialCard,
  buildRpgCoopRaidCard,
  buildRpgPublicDuelCard,
} from '../../ui/rpgMenuBuilder.js';
import { buildPetBattleCard, buildProposalCard } from '../../ui/socialPetMenuBuilder.js';
import {
  buildPredictionCard,
  buildWorldBossCard,
  buildWorldChestCard,
} from '../../ui/worldEventMenuBuilder.js';

async function settleChaosAndWorldEvents(readyClient: Client, ctx: AppContext): Promise<void> {
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
}

async function settleRpgEvents(readyClient: Client, ctx: AppContext): Promise<void> {
  try {
    // settleDuePublicTrials internally calls settlePublicTrial(trial.id, null, nowMs)
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
    const expiredRpgDuels = ctx.services.rpg?.expireDuePublicDuels?.() ?? [];
    for (const duel of expiredRpgDuels) {
      try {
        if (!duel.messageId) continue;
        const economy = ctx.repos.guildConfig.getOrCreate(duel.guildId).economy;
        const guild = readyClient.guilds.cache.get(duel.guildId);
        await editChannelMessage(
          readyClient,
          duel.channelId,
          duel.messageId,
          buildRpgPublicDuelCard(duel, economy),
          guild,
        );
      } catch (itemErr) {
        console.error(`[timer:games:rpgDuel:${duel.id}]`, itemErr);
      }
    }
  } catch (subErr) {
    console.error('[timer:games:rpgDuel]', subErr);
  }

  try {
    const settledRaids = ctx.services.rpg?.settleDueCoopRaids?.() ?? [];
    for (const item of settledRaids) {
      try {
        const economy = ctx.repos.guildConfig.getOrCreate(item.raid.guildId).economy;
        const guild = readyClient.guilds.cache.get(item.raid.guildId);
        await editChannelMessage(
          readyClient,
          item.raid.channelId,
          item.raid.messageId,
          buildRpgCoopRaidCard(item.raid, economy),
          guild,
        );
        const humanTags = item.payouts
          .filter((p) => !p.isMercenary)
          .map((p) => `<@${p.userId}>`)
          .join('、');
        const mvpPayout = item.payouts.find((p) => p.isMvp);
        const mvpNote = mvpPayout
          ? ` ｜ 🏅 MVP：${mvpPayout.isMercenary ? `**${mvpPayout.name}**` : `<@${mvpPayout.userId}>`}`
          : '';
        const embed = item.succeeded
          ? createSuccessEmbed(
              `🐉 集结团本 #${item.raid.id} 讨伐捷报！`,
              `${item.raid.resultSummary}\n👥 参战勇者：${humanTags || `<@${item.raid.leaderId}>`}${mvpNote}`,
            )
          : createInfoEmbed(
              `🐉 集结团本 #${item.raid.id} 结算通告`,
              `${item.raid.resultSummary}\n👥 参战勇者：${humanTags || `<@${item.raid.leaderId}>`}${mvpNote}`,
            );
        await sendToChannel(
          readyClient,
          item.raid.channelId,
          {
            allowedMentions: { parse: ['users'] },
            embeds: [embed],
          },
          guild,
        );
      } catch (itemErr) {
        console.error(`[timer:games:rpgCoop:${item.raid.id}]`, itemErr);
      }
    }
  } catch (subErr) {
    console.error('[timer:games:rpgCoop]', subErr);
  }
}

async function settleSocialAndDuelArena(readyClient: Client, ctx: AppContext): Promise<void> {
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
}

export async function runGamesTick(readyClient: Client, ctx: AppContext): Promise<void> {
  try {
    await settleChaosAndWorldEvents(readyClient, ctx);
    await settleRpgEvents(readyClient, ctx);
    await settleSocialAndDuelArena(readyClient, ctx);
  } catch (err) {
    console.error('[timer:games]', err);
  }
}
