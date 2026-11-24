import { MessageFlags, type ButtonInteraction } from 'discord.js';
import type { EconomyConfig } from '../config/defaults.js';
import { createErrorEmbed, createSuccessEmbed, type AppContext } from '../ui/embeds.js';
import { buildDuelMessage, buildRedPacketMessage } from '../ui/menuBuilder.js';

async function clearStaleDuelButtons(
  interaction: ButtonInteraction,
  ctx: AppContext,
  duelId: string,
  economyCfg: EconomyConfig,
): Promise<void> {
  const duel = ctx.services.multiplayer.getDuel(duelId);
  if (duel && (duel.status === 'expired' || duel.status === 'declined')) {
    await interaction.message.edit(buildDuelMessage(duel, economyCfg)).catch(() => undefined);
    return;
  }
  await interaction.message.edit({ components: [] }).catch(() => undefined);
}

export async function handleMultiplayerButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const parts = interaction.customId.split(':');
  const category = parts[1];
  const action = parts[2];
  const targetId = parts[3];

  if (!targetId) return;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (category === 'duel') {
    if (action === 'accept') {
      if (!cfg.modules.economy) {
        await interaction.reply({
          embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭经济系统，无法结算决斗。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const res = ctx.services.multiplayer.acceptDuel(targetId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildDuelMessage(res.duel, cfg.economy, res));
        return;
      }

      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这场决斗记录（可能已过期或服务器已重启）。',
        not_opponent: '只有被挑战者本人才能点击接受决斗！',
        already_resolved: '这场决斗已经结束啦！',
        expired: '这场决斗已超时过期。',
        challenger_insufficient_funds: '发起人当前口袋现金不足，无法完成结算。',
        opponent_insufficient_funds: `你的口袋现金不足以支付本次赌注（银行存款不参与决斗，请先从银行取出）。`,
        deadbeat_blocked: '参与方存在逾期未还贷款（失信老赖限制），还清逾期欠款前禁止进行带赌注决斗！',
      };

      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法应战', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });

      if (
        res.reason === 'already_resolved' ||
        res.reason === 'expired' ||
        res.reason === 'not_found'
      ) {
        await clearStaleDuelButtons(interaction, ctx, targetId, cfg.economy);
      }
      return;
    }

    if (action === 'decline') {
      const res = ctx.services.multiplayer.declineDuel(targetId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildDuelMessage(res.duel, cfg.economy));
        return;
      }

      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这场决斗记录（可能已过期或服务器已重启）。',
        not_participant: '只有决斗双方才能取消或拒绝本次挑战！',
        already_resolved: '这场决斗已经结束啦！',
        expired: '这场决斗已超时过期。',
      };

      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法取消决斗', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });

      if (
        res.reason === 'already_resolved' ||
        res.reason === 'expired' ||
        res.reason === 'not_found'
      ) {
        await clearStaleDuelButtons(interaction, ctx, targetId, cfg.economy);
      }
      return;
    }
  }

  if (category === 'rp' && action === 'claim') {
    if (!cfg.modules.economy) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭经济系统，暂无法领取红包。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const packetId = Number(targetId);
    if (!Number.isInteger(packetId) || packetId <= 0) return;

    const res = ctx.services.multiplayer.claimRedPacket(packetId, interaction.user.id);
    if (res.ok) {
      await interaction.update(
        buildRedPacketMessage(res.packet, res.claims, res.bestLuckUserId, cfg.economy),
      );
      await interaction.followUp({
        embeds: [
          createSuccessEmbed(
            '🧧 抢到红包啦！',
            [
              `你抢到了 ${cfg.economy.currencyEmoji} **${res.amount}** ${cfg.economy.currencyName}！`,
              `当前口袋现金：**${res.claimerBalance}** ${cfg.economy.currencyName}`,
              ...(res.bestLuckUserId === interaction.user.id
                ? ['👑 **恭喜成为本轮手气最佳！**']
                : []),
            ].join('\n'),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (res.reason === 'expired') {
      ctx.services.multiplayer.expireDueRedPackets();
    }

    const msgMap: Record<typeof res.reason, string> = {
      not_found: '该红包不存在或已被清理。',
      expired: '手慢啦，这个红包已经过期了。',
      finished: '手慢啦，红包已经被抢光了！',
      already_claimed: '你已经抢过这个红包啦，把机会留给其他群友吧！',
    };

    await interaction.reply({
      embeds: [createErrorEmbed('❌ 无法领取红包', msgMap[res.reason])],
      flags: MessageFlags.Ephemeral,
    });

    if (res.reason === 'finished' || res.reason === 'expired') {
      const detail = ctx.services.multiplayer.getRedPacketWithClaims(packetId);
      if (detail && detail.packet.status !== 'open') {
        await interaction.message
          .edit(
            buildRedPacketMessage(
              detail.packet,
              detail.claims,
              detail.bestLuckUserId,
              cfg.economy,
            ),
          )
          .catch(() => undefined);
      }
    }
  }
}
