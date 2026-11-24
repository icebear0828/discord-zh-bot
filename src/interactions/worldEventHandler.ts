import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { PREDICTION_MAX_BET } from '../config/economyConstants.js';
import type { BossAttackMode } from '../services/worldEventService.js';
import { createErrorEmbed, createInfoEmbed, createSuccessEmbed, type AppContext } from '../ui/embeds.js';
import { truncateText } from '../ui/menuShared.js';
import {
  buildPredictionCard,
  buildWorldBossCard,
  buildWorldChestCard,
  formatBossAttackLog,
} from '../ui/worldEventMenuBuilder.js';
import {
  editChannelMessage,
  isInteractionAdmin,
  parsePositiveInt,
} from './menuHelpers.js';

export function buildPredictionBetModal(
  customId: string,
  optionLabel: string,
  currencyName = '星币',
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(truncateText(`押注「${optionLabel.slice(0, 16)}」金额 (${currencyName})`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setPlaceholder(`1 ~ ${PREDICTION_MAX_BET.toLocaleString()}`)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('📊 吃瓜盘口下注')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export async function handleWorldEventButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  const parts = interaction.customId.split(':');
  const category = parts[1];
  const action = parts[2];

  if (category === 'pred') {
    const predId = Number(parts[3]);
    if (!Number.isInteger(predId) || predId <= 0) return;

    if (action === 'bet') {
      if (!cfg.modules.worldEvents || !cfg.modules.economy) {
        await interaction.reply({
          embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭吃瓜与世界事件或经济系统。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const optIdx = Number(parts[4]);
      const summary = ctx.services.worldEvent.getPredictionSummary(predId);
      if (
        !summary ||
        summary.prediction.status !== 'open' ||
        summary.prediction.closesAt <= Date.now()
      ) {
        if (summary && summary.prediction.status === 'open' && summary.prediction.closesAt <= Date.now()) {
          ctx.services.worldEvent.lockPredictionIfDue(predId);
        }
        await interaction.reply({
          embeds: [createErrorEmbed('🔒 无法下注', '该吃瓜盘口已封盘或已结束！')],
          flags: MessageFlags.Ephemeral,
        });
        const latest = ctx.services.worldEvent.getPredictionSummary(predId);
        if (latest) {
          await interaction.message
            .edit(buildPredictionCard(latest, cfg.economy))
            .catch(() => undefined);
        }
        return;
      }

      if (summary.prediction.creatorId === interaction.user.id) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 无法下注', '开盘人不能押注自己发起的盘口，以保证公平！')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const optLabel = summary.prediction.options[optIdx];
      if (!optLabel) return;

      await interaction.showModal(
        buildPredictionBetModal(
          `ev:pred_bet_sub:${predId}:${optIdx}`,
          optLabel,
          cfg.economy.currencyName,
        ),
      );
      return;
    }

    if (action === 'refresh') {
      if (!cfg.modules.worldEvents) {
        await interaction.reply({
          embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭吃瓜与世界事件模块。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      ctx.services.worldEvent.lockPredictionIfDue(predId);
      const summary = ctx.services.worldEvent.getPredictionSummary(predId);
      if (!summary) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 找不到盘口', '该盘口不存在。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.update(buildPredictionCard(summary, cfg.economy));
      return;
    }

    if (action === 'lock') {
      if (!cfg.modules.worldEvents || !cfg.modules.economy) {
        await interaction.reply({
          embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭吃瓜与世界事件或经济系统。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const isAdmin = isInteractionAdmin(interaction, ctx, guildId);
      const res = ctx.services.worldEvent.lockPrediction(predId, interaction.user.id, isAdmin);
      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          not_found: '找不到该盘口。',
          no_permission: '只有开盘人或 Bot 管理员才能提前封盘！',
          invalid_status: '当前盘口不是开放状态，无法封盘。',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 封盘失败', msgMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.update(
        buildPredictionCard(res.summary, cfg.economy, `🔒 已由 <@${interaction.user.id}> 封盘，等待宣布胜方结果`),
      );
      return;
    }

    if (action === 'cancel') {
      if (!cfg.modules.worldEvents || !cfg.modules.economy) {
        await interaction.reply({
          embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭吃瓜与世界事件或经济系统。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const isAdmin = isInteractionAdmin(interaction, ctx, guildId);
      const res = ctx.services.worldEvent.cancelPrediction(predId, interaction.user.id, isAdmin);
      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          not_found: '找不到该盘口。',
          no_permission: '只有开盘人或 Bot 管理员才能作废盘口！',
          invalid_status: '该盘口已经结算或已作废。',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 作废失败', msgMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.update(
        buildPredictionCard(
          res.summary,
          cfg.economy,
          `❌ 已由 <@${interaction.user.id}> 作废，全部 **${res.refunds.length}** 位下注人已全额退币。`,
        ),
      );
      return;
    }
  }

  if (category === 'chest' && action === 'claim') {
    if (!cfg.modules.worldEvents || !cfg.modules.economy) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭吃瓜与世界事件或经济系统。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const eventId = Number(parts[3]);
    if (!Number.isInteger(eventId) || eventId <= 0) return;

    const res = ctx.services.worldEvent.claimChest(eventId, interaction.user.id);
    if (res.ok) {
      await interaction.update(buildWorldChestCard(res.event, res.participants, cfg.economy));
      await interaction.followUp({
        embeds: [
          createSuccessEmbed(
            '🎁 开箱成功！',
            `你从「${res.event.name}」抢到了 ${cfg.economy.currencyEmoji} **+${res.amount}** ${cfg.economy.currencyName}！\n当前现金：**${res.balance}** ${cfg.economy.currencyName}`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (res.reason === 'expired') {
      ctx.services.worldEvent.expireWorldEventIfDue(eventId);
    }

    const msgMap: Record<typeof res.reason, string> = {
      not_found: '宝箱不存在。',
      not_chest: '该事件不是宝箱。',
      not_active: '手慢啦，宝箱已经被抢光或已消失！',
      expired: '宝箱时间已到消失了。',
      already_claimed: '你已经抢过这个宝箱啦，机会留给其他人吧！',
    };
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 无法开箱', msgMap[res.reason])],
      flags: MessageFlags.Ephemeral,
    });

    if (res.reason === 'expired' || res.reason === 'not_active') {
      const detail = ctx.services.worldEvent.getWorldEventDetail(eventId);
      if (detail && detail.event.status !== 'active') {
        await interaction.message
          .edit(buildWorldChestCard(detail.event, detail.participants, cfg.economy))
          .catch(() => undefined);
      }
    }
    return;
  }

  if (category === 'boss' && action === 'hit') {
    if (!cfg.modules.worldEvents || !cfg.modules.economy) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭吃瓜与世界事件或经济系统。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const eventId = Number(parts[3]);
    const modeRaw = parts[4];
    const mode: BossAttackMode = modeRaw === 'heavy' ? 'heavy' : 'normal';
    if (!Number.isInteger(eventId) || eventId <= 0) return;

    const res = ctx.services.worldEvent.attackBoss(eventId, interaction.user.id, mode);
    if (!res.ok) {
      if (res.reason === 'expired') {
        ctx.services.worldEvent.expireWorldEventIfDue(eventId);
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这个世界 Boss。',
        not_boss: '该事件不是世界 Boss。',
        not_active: 'Boss 已经被击败或已撤退啦！',
        expired: '讨伐时间已结束，Boss 已经逃走了！',
        cooldown: `技能冷却中！还需等待 **${res.retryAfterSec ?? 1}** 秒后再出手。`,
      };
      await interaction.reply({
        embeds: [createErrorEmbed('⏳ 无法出手', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });

      if (res.reason === 'expired' || res.reason === 'not_active') {
        const detail = ctx.services.worldEvent.getWorldEventDetail(eventId);
        if (detail && detail.event.status !== 'active') {
          await interaction.message
            .edit(buildWorldBossCard(detail.event, detail.participants, cfg.economy))
            .catch(() => undefined);
        }
      }
      return;
    }

    const logText = formatBossAttackLog(interaction.user.id, mode, res, cfg.economy);
    await interaction.update(
      buildWorldBossCard(res.event, res.participants, cfg.economy, logText, res.rewards),
    );

    const mvpBonus = Math.floor(res.event.rewardPool * 0.25);
    await interaction.followUp({
      embeds: [
        res.missed
          ? createInfoEmbed('💨 蓄力重击空大了！', '差一点就命中了，等冷却结束再来一击！')
          : createSuccessEmbed(
              res.crit ? '💥 暴击命中！' : '⚔️ 攻击命中！',
              `造成 **${res.damage}** 点伤害${res.petName ? `（含出战宠物「${res.petName}」助战 +${res.petBonus}）` : ''}！${res.killed ? `\n🏆 **恭喜你拿下尾刀绝杀！额外获得 25% 尾刀奖 +${mvpBonus} ${cfg.economy.currencyName}！**` : ''}`,
            ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleWorldEventStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  const parts = interaction.customId.split(':');
  if (parts[1] !== 'pred' || parts[2] !== 'settle') return;
  const predId = Number(parts[3]);
  const winningOption = Number(interaction.values[0]);
  if (!Number.isInteger(predId) || !Number.isInteger(winningOption)) return;

  if (!cfg.modules.worldEvents || !cfg.modules.economy) {
    await interaction.reply({
      embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭吃瓜与世界事件或经济系统。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const isAdmin = isInteractionAdmin(interaction, ctx, guildId);
  const res = ctx.services.worldEvent.settlePrediction(
    predId,
    interaction.user.id,
    isAdmin,
    winningOption,
  );
  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      not_found: '找不到该盘口。',
      no_permission: '只有开盘人或 Bot 管理员才能公布结果并结算！',
      not_locked: '请先封盘（锁定押注）后再公布胜出结果并结算！',
      invalid_status: '该盘口已结算或已作废。',
      invalid_option: '无效的胜出选项。',
    };
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 结算失败', msgMap[res.reason])],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const winLabel = res.summary.prediction.options[res.winningOption] ?? '';
  const note = res.refundedNoWinner
    ? `🏆 胜方：**${winLabel}**（无人押中，已全额退还全部押注）`
    : `🏆 胜方：**${winLabel}** ｜ 奖池 **${res.totalPool}** ${cfg.economy.currencyName} 已派发给 **${res.payouts.length}** 位赢家！`;

  await interaction.update(buildPredictionCard(res.summary, cfg.economy, note));
}

export async function handleWorldEventModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  const parts = interaction.customId.split(':');
  if (parts[1] !== 'pred_bet_sub') return;

  const predId = Number(parts[2]);
  const optionIndex = Number(parts[3]);
  if (!Number.isInteger(predId) || !Number.isInteger(optionIndex)) return;

  if (!cfg.modules.worldEvents || !cfg.modules.economy) {
    await interaction.reply({
      embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭吃瓜与世界事件或经济系统。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
  if (!amount) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '❌ 金额无效',
          `下注金额必须是 1 ~ ${PREDICTION_MAX_BET.toLocaleString()} ${cfg.economy.currencyName} 的正整数。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const res = ctx.services.worldEvent.placeBet({
    predictionId: predId,
    userId: interaction.user.id,
    optionIndex,
    amount,
  });

  if (!res.ok) {
    if (res.reason === 'closed' || res.reason === 'not_open') {
      const latest = ctx.services.worldEvent.getPredictionSummary(predId);
      if (latest) {
        await editChannelMessage(
          interaction.client,
          latest.prediction.channelId,
          latest.prediction.messageId,
          buildPredictionCard(latest, cfg.economy),
          interaction.guild,
        );
      }
    }
    const msgMap: Record<typeof res.reason, string> = {
      not_found: '找不到该吃瓜盘口。',
      not_open: '盘口已封盘或已结算，无法继续押注。',
      closed: '盘口已经到封盘时间啦！',
      creator_cannot_bet: '开盘人不能押注自己发起的盘口，以保证公平！',
      invalid_option: '选项无效。',
      invalid_amount: `下注金额必须为 1 ~ ${PREDICTION_MAX_BET.toLocaleString()} ${cfg.economy.currencyName}。`,
      insufficient_funds: `你的口袋现金不足以押注 **${amount}** ${cfg.economy.currencyName}。`,
    };
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 下注失败', msgMap[res.reason])],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const optName = res.summary.prediction.options[optionIndex] ?? '';
  const cardPayload = buildPredictionCard(res.summary, cfg.economy);
  if (interaction.isFromMessage()) {
    await interaction.update(cardPayload);
    await interaction.followUp({
      embeds: [
        createSuccessEmbed(
          '✅ 下注成功！',
          `已在盘口 #${predId} 押注「**${optName}**」${cfg.economy.currencyEmoji} **${res.betAmount}** ${cfg.economy.currencyName}，剩余现金：**${res.balance}** ${cfg.economy.currencyName}。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await editChannelMessage(
      interaction.client,
      res.summary.prediction.channelId,
      res.summary.prediction.messageId,
      cardPayload,
      interaction.guild,
    );
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 下注成功！',
          `已在盘口 #${predId} 押注「**${optName}**」${cfg.economy.currencyEmoji} **${res.betAmount}** ${cfg.economy.currencyName}，剩余现金：**${res.balance}** ${cfg.economy.currencyName}。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
