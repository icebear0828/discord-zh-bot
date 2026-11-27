import type { Client } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { sendToChannel } from '../../interactions/menuHelpers.js';
import { createErrorEmbed, createInfoEmbed } from '../../ui/embeds.js';
import { buildRedPacketMessage } from '../../ui/menuBuilder.js';

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
