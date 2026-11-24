import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import {
  buildNumberBombCard,
  buildRouletteCard,
} from '../ui/chaosMenuBuilder.js';
import { createErrorEmbed, createInfoEmbed, createSuccessEmbed, type AppContext } from '../ui/embeds.js';
import { truncateText } from '../ui/menuShared.js';
import {
  editChannelMessage,
  isInteractionAdmin,
  parseIntInRange,
  sendPublicBroadcast,
} from './menuHelpers.js';

export function buildBombGuessModal(
  customId: string,
  minBound: number,
  maxBound: number,
  penalty: number,
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('guess')
    .setLabel(truncateText(`输入猜测数字 (${minBound} ~ ${maxBound})，踩雷罚 ${penalty}`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(4)
    .setPlaceholder(`请输入 ${minBound} 到 ${maxBound} 之间的整数`)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle('💣 数字炸弹抢猜')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export async function handleChaosButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  const parts = interaction.customId.split(':');
  const category = parts[1];
  const action = parts[2];
  const gameId = Number(parts[3]);
  if (!Number.isInteger(gameId) || gameId <= 0) return;

  if (category === 'rl') {
    if (!cfg.modules.socialGames || !cfg.modules.economy) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭整蛊与博弈或经济系统。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'join') {
      const res = ctx.services.chaos.joinRoulette(gameId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRouletteCard(res.game, cfg.economy));
        await interaction.followUp({
          embeds: [
            createSuccessEmbed(
              '🪑 成功上桌！',
              `已扣除入场费 ${cfg.economy.currencyEmoji} **${res.game.entryFee}** ${cfg.economy.currencyName}，当前现金 **${res.balance}**。`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这个轮盘房间。',
        not_recruiting: '该轮盘局已经开局或已结束！',
        already_joined: '你已经在这桌牌局里啦！',
        room_full: '桌位已满！',
        insufficient_funds: '你的口袋现金不足以支付本桌入场费。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法上桌', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = ctx.services.chaos.getRoulette(gameId);
      if (latest && latest.status !== 'recruiting') {
        await interaction.message.edit(buildRouletteCard(latest, cfg.economy)).catch(() => undefined);
      }
      return;
    }

    if (action === 'leave') {
      const res = ctx.services.chaos.leaveRoulette(gameId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRouletteCard(res.game, cfg.economy));
        await interaction.followUp({
          embeds: [
            createInfoEmbed(
              '🚪 已离开牌桌',
              res.cancelled
                ? '房主离开已解散房间，全部成员入场费已原路退回。'
                : `已退回你的入场费 **${res.refunded}** ${cfg.economy.currencyName}。`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这个轮盘房间。',
        not_recruiting: '只有招募中的牌局才能退出。',
        not_joined: '你并不在这桌招募名单中。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法退出', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'start') {
      const isAdmin = isInteractionAdmin(interaction, ctx, guildId);
      const res = ctx.services.chaos.startRoulette(gameId, interaction.user.id, isAdmin);
      if (res.ok) {
        await interaction.update(buildRouletteCard(res.game, cfg.economy));
        const firstId = res.game.alivePlayers[0];
        if (firstId) {
          await sendPublicBroadcast(interaction, {
            content: `🔫 俄罗斯轮盘 **#${res.game.id}** 开枪了！首位扣扳机：<@${firstId}>（30秒倒计时）`,
          });
        }
        return;
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这个轮盘房间。',
        not_recruiting: '该轮盘局已经开局或已结束。',
        no_permission: '只有房主或 Bot 管理员才能开局！',
        not_enough_players: '至少需要 2 名玩家上桌才能开局！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法开局', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'cancel') {
      const isAdmin = isInteractionAdmin(interaction, ctx, guildId);
      const res = ctx.services.chaos.cancelRoulette(gameId, interaction.user.id, isAdmin);
      if (res.ok) {
        await interaction.update(buildRouletteCard(res.game, cfg.economy));
        return;
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这个轮盘房间。',
        not_recruiting: '只能取消招募中的房间。',
        no_permission: '只有房主或 Bot 管理员才能散桌！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法取消', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'fire') {
      const res = ctx.services.chaos.pullTrigger(gameId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRouletteCard(res.game, cfg.economy));
        if (res.game.status === 'finished' && res.winnerId) {
          await sendPublicBroadcast(interaction, {
            content: `🏆 轮盘 **#${res.game.id}** 吃鸡诞生！恭喜 <@${res.winnerId}> 独吞 **${res.prizePool}** ${cfg.economy.currencyName}！`,
            embeds: [
              createSuccessEmbed(
                '🏆 俄罗斯轮盘吃鸡结算！',
                `<@${res.eliminatedUserId}> 中弹倒下，<@${res.winnerId}> 成为最后唯一幸存者，赢得 ${cfg.economy.currencyEmoji} **+${res.prizePool}** ${cfg.economy.currencyName}！`,
              ),
            ],
          });
        } else if (res.game.status === 'playing') {
          const nextId =
            res.game.alivePlayers[res.game.turnIndex % res.game.alivePlayers.length];
          if (nextId) {
            await interaction.followUp({
              content: res.fired
                ? `💥 <@${res.eliminatedUserId}> 中弹淘汰！重新装弹，请 <@${nextId}> 扣动扳机！`
                : `😅 咔哒…空枪！请下一位 <@${nextId}> 在 30 秒内扣动扳机！`,
            });
          }
        }
        return;
      }

      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这个轮盘局。',
        not_playing: '这局轮盘还未开局或已经结束啦！',
        not_your_turn: '还没轮到你扣扳机，请等待当前回合玩家！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('⏳ 请稍等', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = ctx.services.chaos.getRoulette(gameId);
      if (latest && latest.status !== 'playing') {
        await interaction.message.edit(buildRouletteCard(latest, cfg.economy)).catch(() => undefined);
      }
      return;
    }
  }

  if (category === 'bomb' && action === 'guess') {
    if (!cfg.modules.socialGames || !cfg.modules.economy) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭整蛊与博弈或经济系统。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = ctx.services.chaos.getNumberBomb(gameId);
    if (!game || game.status !== 'open' || game.expiresAt <= Date.now()) {
      if (game && game.status === 'open' && game.expiresAt <= Date.now()) {
        ctx.services.chaos.expireDueNumberBombs();
      }
      await interaction.reply({
        embeds: [createErrorEmbed('⌛ 炸弹已结束', '这颗数字炸弹已经引爆或过期啦！')],
        flags: MessageFlags.Ephemeral,
      });
      const latest = ctx.services.chaos.getNumberBomb(gameId);
      if (latest) {
        await interaction.message.edit(buildNumberBombCard(latest, cfg.economy)).catch(() => undefined);
      }
      return;
    }

    await interaction.showModal(
      buildBombGuessModal(
        `ch:bomb_sub:${game.id}`,
        game.minBound,
        game.maxBound,
        game.penalty,
      ),
    );
  }
}

export async function handleChaosModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  const parts = interaction.customId.split(':');
  const modalType = parts[1];
  const gameId = Number(parts[2]);
  if (modalType !== 'bomb_sub' || !Number.isInteger(gameId) || gameId <= 0) return;

  if (!cfg.modules.socialGames || !cfg.modules.economy) {
    await interaction.reply({
      embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭整蛊与博弈或经济系统。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guess = parseIntInRange(interaction.fields.getTextInputValue('guess'), 1, 100);
  if (guess === null) {
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 无效数字', '请输入当前安全区间内的有效整数。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const res = ctx.services.chaos.guessNumberBomb(gameId, interaction.user.id, guess);
  if (!res.ok) {
    if (res.reason === 'expired' || res.reason === 'not_open') {
      const latest = ctx.services.chaos.getNumberBomb(gameId);
      if (latest) {
        await editChannelMessage(
          interaction.client,
          latest.channelId,
          latest.messageId,
          buildNumberBombCard(latest, cfg.economy),
          interaction.guild,
        );
      }
    }
    const msgMap: Record<typeof res.reason, string> = {
      not_found: '找不到这颗数字炸弹。',
      not_open: '这颗炸弹已经引爆或拆除了！',
      expired: '这颗炸弹已经超时过期！',
      invalid_guess: `请输入当前区间 **${res.minBound} ~ ${res.maxBound}** 之间的整数！`,
      consecutive_guess: '规则规定不能连续猜两次，等别人先猜一次吧！',
      insufficient_funds: `你的口袋现金不足 **${res.penalty}** ${cfg.economy.currencyName}，无法参与抢猜（防白嫖）！`,
    };
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 无法猜数', msgMap[res.reason])],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cardPayload = buildNumberBombCard(res.game, cfg.economy, res.payouts);
  if (interaction.isFromMessage()) {
    await interaction.update(cardPayload);
  } else {
    await editChannelMessage(
      interaction.client,
      res.game.channelId,
      res.game.messageId,
      cardPayload,
      interaction.guild,
    );
    await interaction.reply({
      embeds: [
        res.exploded
          ? createErrorEmbed(
              '💥 你踩雷啦！',
              `数字 **${res.guess}** 正是炸弹！已扣除罚金 **${res.penaltyPaid}** ${cfg.economy.currencyName}！`,
            )
          : createSuccessEmbed(
              '😅 安全过关！',
              `你猜了 **${res.guess}**，安全区间已缩小至 **[${res.game.minBound} ~ ${res.game.maxBound}]**！`,
            ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (res.exploded) {
    const payoutSummary =
      res.payouts.length > 0
        ? res.payouts.map((p) => `<@${p.userId}> +${p.amount}`).join('、')
        : '无其他存活分红者';
    await sendPublicBroadcast(interaction, {
      content: `💥 轰隆！<@${interaction.user.id}> 在数字炸弹 **#${res.game.id}** 踩中了 **${res.guess}**，爆出 **${res.penaltyPaid}** ${cfg.economy.currencyName}！\n💰 分红：${payoutSummary}`,
    });
  }
}
