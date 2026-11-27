import { MessageFlags, type ButtonInteraction } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import type { RpsMove } from '../../db/repositories/duelRepo.js';
import { formatRpsMoveLabel, getDuelArenaService } from '../../services/duelArenaService.js';
import {
  buildRenameTargetModal,
  buildRouletteDuelCard,
  buildRpsDuelCard,
} from '../../ui/duelArenaBuilder.js';
import { createErrorEmbed, createInfoEmbed } from '../../ui/embeds.js';
import { sendPublicBroadcast } from '../menuHelpers.js';
import { applyRouletteTimeoutPenalty } from './nicknamePenaltyHelper.js';

const VALID_RPS_MOVES = new Set<string>(['rock', 'paper', 'scissors']);

export async function handleDuelArenaButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const parts = interaction.customId.split(':');
  const category = parts[1];
  const arena = getDuelArenaService(ctx);

  if (category === 'nick_btn') {
    const targetId = parts[2];
    if (!targetId) return;
    const lock = arena.getActiveNicknameLock(guildId, targetId);
    if (!lock || lock.winnerId !== interaction.user.id) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '❌ 无改名权限',
            '只有当前有效的决斗胜者才能在有效期内给败方改名（或该改名权已到期）。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(buildRenameTargetModal(targetId, 'card'));
    return;
  }

  if (category === 'rps') {
    const action = parts[2];
    const duelId = parts[3];
    if (!action || !duelId) return;

    if (!cfg.modules.socialGames) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭整蛊与博弈模块。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'accept') {
      const current = arena.getRpsDuel(duelId);
      if (current && current.bet > 0 && !cfg.modules.economy) {
        await interaction.reply({
          embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭经济系统，无法结算带赌注决斗。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const res = arena.acceptRpsDuel(duelId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRpsDuelCard(res.duel, cfg.economy));
        return;
      }

      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这场石头剪刀布决斗记录。',
        not_opponent: '只有被挑战者本人才能点击接受决斗！',
        already_resolved: '这场决斗已经开始或结束了！',
        expired: '这场决斗邀请已超时过期，冻结赌注已自动退还。',
        opponent_insufficient_funds: `你的口袋现金不足以支付本次附加赌注（${cfg.economy.currencyName}）。`,
        deadbeat_blocked: '参与方存在逾期未还贷款（失信老赖限制），还清欠款前禁止参与带赌注决斗！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法应战', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = arena.getRpsDuel(duelId);
      if (latest && latest.status !== 'pending') {
        await interaction.message.edit(buildRpsDuelCard(latest, cfg.economy)).catch(() => undefined);
      }
      return;
    }

    if (action === 'decline') {
      const res = arena.declineRpsDuel(duelId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRpsDuelCard(res.duel, cfg.economy));
        return;
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这场决斗记录。',
        not_participant: '只有决斗双方才能取消或拒绝本次挑战！',
        already_resolved: '这场决斗已经开始或结束了！',
        expired: '这场决斗邀请已超时过期，冻结赌注已自动退还。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法取消', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = arena.getRpsDuel(duelId);
      if (latest && latest.status !== 'pending') {
        await interaction.message.edit(buildRpsDuelCard(latest, cfg.economy)).catch(() => undefined);
      }
      return;
    }

    if (action === 'move') {
      const moveRaw = parts[4];
      if (!moveRaw || !VALID_RPS_MOVES.has(moveRaw)) return;
      const move = moveRaw as RpsMove;

      const res = arena.submitRpsMove(duelId, interaction.user.id, move);
      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          not_found: '找不到这场石头剪刀布决斗。',
          not_playing: '这场决斗尚未开始或已经结束啦！',
          not_participant: '你不是本场决斗的参赛选手！',
          already_moved: '本回合你已经锁定过出拳啦，请等待对手出拳！',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('⏳ 无法出拳', msgMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        const latest = arena.getRpsDuel(duelId);
        if (latest && latest.status !== 'playing') {
          await interaction.message.edit(buildRpsDuelCard(latest, cfg.economy)).catch(() => undefined);
        }
        return;
      }

      await interaction.update(buildRpsDuelCard(res.duel, cfg.economy));
      if (!res.roundResolved) {
        await interaction.followUp({
          embeds: [
            createInfoEmbed(
              '🔒 出拳已锁定',
              `你本回合选择了 **${formatRpsMoveLabel(move)}**，等待对手出拳后同时亮牌！`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      } else if (res.matchFinished && res.winnerId && res.loserId) {
        await sendPublicBroadcast(interaction, {
          allowedMentions: { users: [res.winnerId, res.loserId] },
          content: `🏆 <@${res.winnerId}> 在石头剪刀布 Bo5 决斗中击败了 <@${res.loserId}>！快点击战报卡片上的 **🎭 给败方改名** 行使改名权吧！`,
        });
      }
      return;
    }
  }

  if (category === 'rl') {
    const action = parts[2];
    const duelId = parts[3];
    if (!action || !duelId) return;

    if (!cfg.modules.socialGames) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭整蛊与博弈模块。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'accept') {
      const current = arena.getRouletteDuel(duelId);
      if (current && current.bet > 0 && !cfg.modules.economy) {
        await interaction.reply({
          embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭经济系统，无法结算带赌注轮盘。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const res = arena.acceptRouletteDuel(duelId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRouletteDuelCard(res.duel, cfg.economy));
        return;
      }

      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这局 1v1 俄罗斯轮盘记录。',
        not_opponent: '只有被挑战者本人才能接受赌局！',
        already_resolved: '这局 1v1 轮盘已经开局或结束了！',
        expired: '这局轮盘邀请已超时过期，冻结赌注已退回。',
        opponent_insufficient_funds: `你的口袋现金不足以支付本局赌注（${cfg.economy.currencyName}）。`,
        deadbeat_blocked: '参与方存在逾期未还贷款（失信老赖限制），还清欠款前禁止参与带赌注轮盘！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法应战', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = arena.getRouletteDuel(duelId);
      if (latest && latest.status !== 'pending') {
        await interaction.message
          .edit(buildRouletteDuelCard(latest, cfg.economy))
          .catch(() => undefined);
      }
      return;
    }

    if (action === 'decline') {
      const res = arena.declineRouletteDuel(duelId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRouletteDuelCard(res.duel, cfg.economy));
        return;
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这局 1v1 俄罗斯轮盘记录。',
        not_participant: '只有对局双方才能取消或拒绝本次挑战！',
        already_resolved: '这局 1v1 轮盘已经开局或结束了！',
        expired: '这局轮盘邀请已超时过期，冻结赌注已退回。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法取消', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = arena.getRouletteDuel(duelId);
      if (latest && latest.status !== 'pending') {
        await interaction.message
          .edit(buildRouletteDuelCard(latest, cfg.economy))
          .catch(() => undefined);
      }
      return;
    }

    if (action === 'fire') {
      const res = arena.pullRouletteDuelTrigger(duelId, interaction.user.id);
      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          not_found: '找不到这局 1v1 俄罗斯轮盘。',
          not_playing: '这局轮盘还未开始或已经结束啦！',
          not_your_turn: '还没轮到你扣扳机，请等待对手！',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('⏳ 请稍等', msgMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        const latest = arena.getRouletteDuel(duelId);
        if (latest && latest.status !== 'playing') {
          await interaction.message
            .edit(buildRouletteDuelCard(latest, cfg.economy))
            .catch(() => undefined);
        }
        return;
      }

      let penaltyNote: string | undefined;
      if (res.fired && res.loserId && res.timeoutDurationMs > 0) {
        penaltyNote =
          (await applyRouletteTimeoutPenalty({
            guild: interaction.guild,
            targetId: res.loserId,
            timeoutDurationMs: res.timeoutDurationMs,
            winnerName: res.winnerId ?? '胜者',
          })) ?? undefined;
      }

      await interaction.update(buildRouletteDuelCard(res.duel, cfg.economy, penaltyNote));
    }
  }
}
