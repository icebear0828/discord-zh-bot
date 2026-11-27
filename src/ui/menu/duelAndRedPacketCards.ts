import { ButtonStyle, EmbedBuilder } from 'discord.js';
import type { EconomyConfig } from '../../config/defaults.js';
import type { RedPacket, RedPacketClaim } from '../../db/repositories/redPacketRepo.js';
import type { AcceptDuelResult, DuelChallenge } from '../../services/multiplayerService.js';
import { COLORS } from '../embeds.js';
import { buttonRow, makeButton, truncateText, type BuiltButtonMessage } from '../menuShared.js';

export function buildDuelMessage(
  duel: DuelChallenge,
  economyCfg: EconomyConfig,
  result?: Extract<AcceptDuelResult, { ok: true }>,
): BuiltButtonMessage {
  if (duel.status === 'pending') {
    const expUnix = Math.floor(duel.expiresAt / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle('⚔️ 骰子决斗挑战')
      .setDescription(
        [
          `<@${duel.challengerId}> 向 <@${duel.opponentId}> 发起了骰子决斗！`,
          `赌注金额：${economyCfg.currencyEmoji} **${duel.bet}** ${economyCfg.currencyName}`,
          '',
          '规则：双方各掷 3 颗骰子比较总点数，大者赢走全部赌注；平局双方不扣款。',
          `⏳ 有效期：<t:${expUnix}:R>`,
        ].join('\n'),
      )
      .setFooter({ text: `决斗编号 #${duel.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(`mp:duel:accept:${duel.id}`, '⚔️ 接受决斗', ButtonStyle.Success),
          makeButton(`mp:duel:decline:${duel.id}`, '🏃 认怂拒绝', ButtonStyle.Danger),
        ),
      ],
    };
  }

  if (duel.status === 'completed' && result) {
    const challengerDiceText = result.challengerDice.map((d) => `🎲 **${d}**`).join(' ');
    const opponentDiceText = result.opponentDice.map((d) => `🎲 **${d}**`).join(' ');
    const outcomeLine = result.tie
      ? `🤝 **双方平局！** 赌注 **${duel.bet}** ${economyCfg.currencyName} 各自保留。`
      : [
          `🏆 胜者：<@${result.winnerId}> 赢得 ${economyCfg.currencyEmoji} **+${duel.bet}** ${economyCfg.currencyName}！`,
          ...(result.bountyClaimed && result.bountyClaimed > 0
            ? [`🎯 顺手击毙通缉犯 <@${result.loserId}>，额外独吞悬赏赏金 **+${result.bountyClaimed}** ${economyCfg.currencyName}！`]
            : []),
        ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(result.tie ? COLORS.WARNING : COLORS.SUCCESS)
      .setTitle('⚔️ 骰子决斗已结算')
      .setDescription(
        [
          `<@${duel.challengerId}>：${challengerDiceText} → 总计 **${result.challengerSum}** 点`,
          `<@${duel.opponentId}>：${opponentDiceText} → 总计 **${result.opponentSum}** 点`,
          '',
          outcomeLine,
        ].join('\n'),
      )
      .setFooter({ text: `决斗编号 #${duel.id}` })
      .setTimestamp();

    return { embeds: [embed], components: [] };
  }

  if (duel.status === 'expired') {
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle('⌛ 骰子决斗已过期')
      .setDescription(
        `<@${duel.challengerId}> 向 <@${duel.opponentId}> 发起的 **${duel.bet}** ${economyCfg.currencyName} 决斗已超时失效。`,
      )
      .setFooter({ text: `决斗编号 #${duel.id}` })
      .setTimestamp();

    return { embeds: [embed], components: [] };
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.ERROR)
    .setTitle('🏃 骰子决斗已拒绝')
    .setDescription(
      `<@${duel.challengerId}> 向 <@${duel.opponentId}> 发起的 **${duel.bet}** ${economyCfg.currencyName} 决斗已被取消或拒绝。`,
    )
    .setFooter({ text: `决斗编号 #${duel.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}

const MAX_VISIBLE_RED_PACKET_CLAIMS = 25;

export function buildRedPacketMessage(
  packet: RedPacket,
  claims: readonly RedPacketClaim[],
  bestLuckUserId: string | null,
  economyCfg: EconomyConfig,
): BuiltButtonMessage {
  const visibleClaims = claims.slice(0, MAX_VISIBLE_RED_PACKET_CLAIMS);
  const claimLines = visibleClaims.map((c) => {
    const crown = packet.status === 'finished' && bestLuckUserId === c.userId ? '👑 ' : '• ';
    return `${crown}<@${c.userId}> 抢到了 ${economyCfg.currencyEmoji} **${c.amount}** ${economyCfg.currencyName}`;
  });
  if (claims.length > MAX_VISIBLE_RED_PACKET_CLAIMS) {
    claimLines.push(`*… 仅展示前 ${MAX_VISIBLE_RED_PACKET_CLAIMS} 条，共 ${claims.length} 人已领*`);
  }

  if (packet.status === 'open') {
    const expUnix = Math.floor(packet.expiresAt / 1000);
    const description = [
      `发红包人：<@${packet.senderId}>`,
      `红包总额：${economyCfg.currencyEmoji} **${packet.totalAmount}** ${economyCfg.currencyName} ｜ 共 **${packet.totalCount}** 份`,
      `剩余进度：还剩 **${packet.remainingCount} / ${packet.totalCount}** 份（剩余 ${packet.remainingAmount} ${economyCfg.currencyName}）`,
      `⏳ 过期时间：<t:${expUnix}:R>`,
      ...(claimLines.length > 0 ? ['', '**领取记录：**', ...claimLines] : []),
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle(truncateText(`🧧 ${packet.greeting}`, 256))
      .setDescription(truncateText(description, 4096))
      .setFooter({ text: `红包编号 #${packet.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(
            `mp:rp:claim:${packet.id}`,
            `🧧 抢红包 (剩余 ${packet.remainingCount}/${packet.totalCount} 份)`,
            ButtonStyle.Danger,
          ),
        ),
      ],
    };
  }

  if (packet.status === 'finished') {
    const description = [
      `发红包人：<@${packet.senderId}> ｜ 祝福语：${packet.greeting}`,
      `红包总额：${economyCfg.currencyEmoji} **${packet.totalAmount}** ${economyCfg.currencyName}（共 ${packet.totalCount} 份已全部分发）`,
      `👑 手气最佳：${bestLuckUserId ? `<@${bestLuckUserId}>` : '无'}`,
      ...(claimLines.length > 0 ? ['', '**领取详情：**', ...claimLines] : []),
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(COLORS.GOLD)
      .setTitle('🧧 红包已被抢光啦！')
      .setDescription(truncateText(description, 4096))
      .setFooter({ text: `红包编号 #${packet.id}` })
      .setTimestamp();

    return { embeds: [embed], components: [] };
  }

  const claimedCount = packet.totalCount - packet.remainingCount;
  const description = [
    `发红包人：<@${packet.senderId}> ｜ 祝福语：${packet.greeting}`,
    `共 **${packet.totalCount}** 份（已领取 **${claimedCount}** 份），剩余 **${packet.remainingAmount}** ${economyCfg.currencyName} 已退回发红包人。`,
    ...(claimLines.length > 0 ? ['', '**已领取记录：**', ...claimLines] : []),
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('⌛ 红包已过期')
    .setDescription(truncateText(description, 4096))
    .setFooter({ text: `红包编号 #${packet.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}
