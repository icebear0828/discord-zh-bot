import { EmbedBuilder, type MessageCreateOptions } from 'discord.js';
import type { EconomyConfig } from '../config/defaults.js';
import {
  BANK_ROB_ATTACKER_MIN_ASSETS,
  BANK_ROB_TARGET_MIN,
  MAX_SOLO_GAMBLE_BET,
  ROB_ATTACKER_MIN_ASSETS,
  ROB_TARGET_MIN_COINS,
} from '../config/economyConstants.js';
import {
  evaluateHand,
  formatHand,
  type BlackjackGame,
  type Card,
} from '../services/blackjackService.js';
import type {
  BankRobResult,
  DiceChoice,
  DiceResult,
  RobResult,
  RobTargetHints,
  SlotsResult,
  WorkResult,
} from '../services/economyService.js';
import type { FortuneDrawResult } from '../services/funService.js';
import {
  COLORS,
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  formatDurationZh,
} from './embeds.js';

export type EconomyDisplayConfig = Pick<EconomyConfig, 'currencyName' | 'currencyEmoji'>;

export function truncateDescriptionLines(
  lines: readonly string[],
  separator: string,
  footer = '',
  maxLen = 4096,
): string {
  const safeFooter = footer.length > 0 ? footer : '';
  const suffixReserve = 40 + safeFooter.length;
  const budget = Math.max(64, maxLen - suffixReserve);
  const included: string[] = [];
  let used = 0;

  for (const line of lines) {
    const addition = included.length === 0 ? line.length : separator.length + line.length;
    if (used + addition > budget) {
      break;
    }
    included.push(line);
    used += addition;
  }

  const omitted = lines.length - included.length;
  let body = included.join(separator);
  if (omitted > 0) {
    const omittedNotice = `\n…（其余 ${omitted} 项已省略）`;
    body = `${body}${omittedNotice}`;
  }
  const combined = safeFooter ? `${body}${safeFooter}` : body;
  if (combined.length <= maxLen) {
    return combined;
  }
  return `${combined.slice(0, Math.max(0, maxLen - 1))}…`;
}

export function formatWorkResultEmbed(
  res: Extract<WorkResult, { ok: true }>,
  cfg: EconomyDisplayConfig,
): EmbedBuilder {
  const lines = [
    `你${res.story}，赚取了 ${cfg.currencyEmoji} **+${res.reward}** ${cfg.currencyName}！`,
    ...(res.cursed ? ['😈 **衰神符生效！** 本次打工收益减半（已消耗 1 次诅咒）。'] : []),
    `当前钱包余额：**${res.balance}** ${cfg.currencyName}`,
  ];
  const embed = res.cursed
    ? new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setTitle('💼 打工完成（衰神附体）')
        .setDescription(lines.join('\n'))
        .setTimestamp()
    : createSuccessEmbed('💼 打工完成！', lines.join('\n'));
  return embed;
}

export function formatPocketRobError(
  reason: string,
  targetId: string,
  cfg: EconomyDisplayConfig,
  retryAfterSec = 0,
): string {
  switch (reason) {
    case 'self_target':
      return '不能打劫自己！';
    case 'cooldown':
      return `打劫冷却中，请等待 **${formatDurationZh(retryAfterSec * 1000)}**。`;
    case 'target_shielded':
      return `<@${targetId}> 刚被光顾过，护盾剩余 **${formatDurationZh(retryAfterSec * 1000)}**。`;
    case 'target_too_poor':
      return `<@${targetId}> 钱包太干净了（口袋现金不足 **${ROB_TARGET_MIN_COINS}** ${cfg.currencyName}），放过 TA 吧。`;
    case 'attacker_too_poor':
      return `你的总资产（现金+银行）不足 **${ROB_ATTACKER_MIN_ASSETS}** ${cfg.currencyName}，空口袋无法白嫖打劫！`;
    default:
      return '当前无法执行打劫，请稍后再试。';
  }
}

export function formatBankRobError(
  reason: string,
  targetId: string,
  cfg: EconomyDisplayConfig,
  retryAfterSec = 0,
): string {
  switch (reason) {
    case 'self_target':
      return '不能抢自己的银行金库！';
    case 'cooldown':
      return `打劫冷却中，请等待 **${formatDurationZh(retryAfterSec * 1000)}**。`;
    case 'target_shielded':
      return `<@${targetId}> 刚被光顾过，护盾剩余 **${formatDurationZh(retryAfterSec * 1000)}**。`;
    case 'target_bank_too_poor':
      return `<@${targetId}> 银行金库存款不足 **${BANK_ROB_TARGET_MIN}** ${cfg.currencyName}，不值得动手。`;
    case 'attacker_too_poor':
      return `你的总资产（现金+银行）不足 **${BANK_ROB_ATTACKER_MIN_ASSETS}** ${cfg.currencyName}，无法发起强抢银行金库！`;
    default:
      return '当前无法执行劫金库，请稍后再试。';
  }
}

export interface RobTargetUserLike {
  username?: string | null;
  displayName?: string | null;
  globalName?: string | null;
}

export interface RobTargetMemberLike {
  displayName?: string | null;
  nickname?: string | null;
  roles?: {
    cache?: {
      values?: () => Iterable<{ name?: string | null }>;
    };
  };
}

export function buildRobTargetHints(
  user?: RobTargetUserLike | null,
  member?: RobTargetMemberLike | null,
): RobTargetHints {
  const displayNames: string[] = [];
  const pushUnique = (list: string[], value: string | null | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed && !list.includes(trimmed)) {
      list.push(trimmed);
    }
  };
  pushUnique(displayNames, user?.displayName);
  pushUnique(displayNames, user?.username);
  pushUnique(displayNames, user?.globalName);
  pushUnique(displayNames, member?.displayName);
  pushUnique(displayNames, member?.nickname);

  const roleNames: string[] = [];
  if (member?.roles?.cache?.values) {
    for (const role of member.roles.cache.values()) {
      pushUnique(roleNames, role?.name);
    }
  }
  return { displayNames, roleNames };
}

export function formatPocketRobResultEmbed(
  res: Extract<RobResult, { ok: true }>,
  targetId: string,
  cfg: EconomyDisplayConfig,
): EmbedBuilder {
  if (res.success) {
    const lines = [
      `你${res.usedLockpick ? '（🗝️ 万能撬锁生效）' : ''}成功从 <@${targetId}> 兜里顺走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
      ...(res.bountyClaimed && res.bountyClaimed > 0
        ? [`🎯 **通缉令兑现**：额外独吞赏金 **+${res.bountyClaimed}** ${cfg.currencyName}！`]
        : []),
      `你的现金：**${res.attackerBalance}** ${cfg.currencyName} ｜ 对方剩余现金：**${res.targetBalance}** ｜ 对方已开启防盗护盾。`,
    ];
    return createSuccessEmbed('🥷 打劫得手！', lines.join('\n'));
  }

  const fineFromBank = res.fineFromBank ?? 0;
  const fineFromPocket = res.fineFromPocket ?? res.amount;
  const fineDetail =
    fineFromBank > 0
      ? `（扣口袋现金 **${fineFromPocket}** + 联动划扣银行存款 **${fineFromBank}**）`
      : '';
  const bankSuffix =
    typeof res.attackerBankBalance === 'number' && (fineFromBank > 0 || res.easterEggTriggered)
      ? `（银行 **${res.attackerBankBalance}**）`
      : '';

  if (res.easterEggTriggered) {
    const story =
      res.easterEggStory ??
      `👑 试图打劫 <@${targetId}> 触发王者反噬，被当场罚没总资产 10%（**${res.amount}** ${cfg.currencyName}）！`;
    const lines = [
      story,
      `💸 罚没总资产 10%：${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}`,
      `劫匪当前现金：**${res.attackerBalance}** ${cfg.currencyName}${bankSuffix} ｜ 对方当前现金：**${res.targetBalance}** ${cfg.currencyName}`,
    ];
    return createErrorEmbed('👑 王者反噬！敢动黑吊王？', lines.join('\n'));
  }

  const lines = [
    res.trapped
      ? `踩雷了！你一脚踩中 <@${targetId}> 预设的【🪤 防盗捕兽夹】，被反抓重罚赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}！`
      : `失手了！你向 <@${targetId}> 赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName} 精神损失费${fineDetail}。`,
    ...(res.usedLockpick ? ['🗝️ 本次行动已消耗【万能撬锁】。'] : []),
    `你的当前现金：**${res.attackerBalance}** ${cfg.currencyName}${bankSuffix}`,
  ];
  return createErrorEmbed(
    res.trapped ? '🪤 踩中捕兽夹！打劫反被重罚！' : '🚨 打劫翻车被抓现行！',
    lines.join('\n'),
  );
}

export function formatBankRobResultEmbed(
  res: Extract<BankRobResult, { ok: true }>,
  targetId: string,
  cfg: EconomyDisplayConfig,
): EmbedBuilder {
  if (res.success) {
    const lines = [
      `你${res.usedLockpick ? '（🗝️ 万能撬锁生效）' : ''}突破安保从 <@${targetId}> 的银行金库撬走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
      ...(res.bountyClaimed && res.bountyClaimed > 0
        ? [`🎯 **通缉令兑现**：额外独吞赏金 **+${res.bountyClaimed}** ${cfg.currencyName}！`]
        : []),
      `你的现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）｜ 对方金库剩余：**${res.targetBankBalance}** ｜ 已触发防盗护盾。`,
    ];
    return createSuccessEmbed('🏦 银行金库劫案得手！', lines.join('\n'));
  }

  const fineDetail =
    res.fineFromBank > 0
      ? `（扣口袋现金 **${res.fineFromPocket}** + 联动划扣银行存款 **${res.fineFromBank}**）`
      : '';

  if (res.easterEggTriggered) {
    const story =
      res.easterEggStory ??
      `👑 试图强抢 <@${targetId}> 的皇家金库触发王者反噬，被当场罚没总资产 10%（**${res.amount}** ${cfg.currencyName}）！`;
    const lines = [
      story,
      `💸 罚没总资产 10%：${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}`,
      `劫匪当前现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）｜ 对方当前金库：**${res.targetBankBalance}** ${cfg.currencyName}`,
    ];
    return createErrorEmbed('👑 皇家金库禁令触发！敢抢黑吊王？', lines.join('\n'));
  }

  const lines = [
    res.trapped
      ? `潜入金库一脚踩中 <@${targetId}> 预设的【🪤 防盗捕兽夹】！重罚赔偿 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}！`
      : `潜入金库失手！你向 <@${targetId}> 重罚赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}。`,
    ...(res.usedLockpick ? ['🗝️ 本次行动已消耗【万能撬锁】。'] : []),
    `你的当前现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）`,
  ];
  return createErrorEmbed(
    res.trapped ? '🪤 金库捕兽夹重创劫匪！' : '🚨 抢银行金库翻车被捕！',
    lines.join('\n'),
  );
}

export function formatBlackjackDealerHand(
  dealerHand: readonly Card[],
  finished: boolean,
): string {
  if (!finished) {
    const hiddenCards = Array.from({ length: Math.max(2, dealerHand.length) }, () => '`🂠`').join(
      ' ',
    );
    return `${hiddenCards}（结算前隐藏）`;
  }
  const dealerEval = evaluateHand(dealerHand);
  return `${formatHand(dealerHand)}（总计 **${dealerEval.total}** 点）`;
}

export function buildBlackjackPublicReportEmbed(params: {
  playerId: string;
  playerDisplayName: string;
  playerAvatarUrl?: string;
  game: BlackjackGame;
  cfg: EconomyDisplayConfig;
}): EmbedBuilder {
  const { playerId, playerDisplayName, playerAvatarUrl, game, cfg } = params;
  const playerEval = evaluateHand(game.playerHand);
  const dealerEval = evaluateHand(game.dealerHand);
  const net = game.payout - game.bet;
  const netText = net > 0 ? `+${net}` : `${net}`;

  const headlineMap: Record<BlackjackGame['status'], string> = {
    playing: '对局进行中',
    player_blackjack: '🎉 天胡 Blackjack！',
    player_bust: '💥 玩家爆牌落败',
    dealer_bust: '🎉 庄家爆牌，玩家胜出！',
    player_win: '🎉 玩家点数胜出！',
    dealer_win: '😔 庄家点数胜出',
    push: '🤝 双方平局退注',
  };

  const color =
    net > 0 ? COLORS.SUCCESS : net === 0 ? COLORS.WARNING : COLORS.ERROR;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🃏 二十一点战报 — ${headlineMap[game.status]}`)
    .setDescription(`玩家：<@${playerId}>（**${playerDisplayName}**）`)
    .addFields(
      {
        name: '🧑 玩家手牌',
        value: `${formatHand(game.playerHand)}（**${playerEval.total}** 点）`,
        inline: true,
      },
      {
        name: '🎩 庄家手牌',
        value: `${formatHand(game.dealerHand)}（**${dealerEval.total}** 点）`,
        inline: true,
      },
      {
        name: '💰 结算明细',
        value: `下注 **${game.bet}** ｜ 返还 ${cfg.currencyEmoji} **${game.payout}** ｜ 净盈亏 **${netText}** ${cfg.currencyName}`,
      },
    )
    .setTimestamp();

  if (playerAvatarUrl) {
    embed.setThumbnail(playerAvatarUrl);
  }
  return embed;
}

export function formatSoloBetError(
  reason: string,
  bet: number,
  currencyName: string,
): string {
  if (reason === 'insufficient_funds') {
    return `你的 ${currencyName} 不足以支付 **${bet}** 下注。`;
  }
  if (reason === 'bet_too_large') {
    return `单局最高下注上限为 **${MAX_SOLO_GAMBLE_BET.toLocaleString()}** ${currencyName}。`;
  }
  if (reason === 'deadbeat_blocked') {
    return '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与博弈！';
  }
  return '下注金额必须为大于 0 的有效整数。';
}

export function buildSlotsResultEmbed(
  res: Extract<SlotsResult, { ok: true }>,
  cfg: EconomyDisplayConfig,
): EmbedBuilder {
  const reelDisplay = `【 ${res.reels.join('  |  ')} 】`;
  const netText = res.netChange >= 0 ? `+${res.netChange}` : String(res.netChange);
  const desc = [
    reelDisplay,
    `倍率：**${res.multiplier}x** ｜ 返还：**${res.payout}** ${cfg.currencyName}`,
    `净变动：**${netText}** ${cfg.currencyName} ｜ 余额：**${res.balance}**`,
  ].join('\n');

  if (res.netChange > 0) {
    return createSuccessEmbed('🎰 老虎机中奖！', desc);
  }
  if (res.netChange === 0) {
    return createInfoEmbed('🎰 刚好保本', desc);
  }
  return createErrorEmbed('🎰 再接再厉', desc);
}

export function buildSlotsHighlightEmbed(
  playerId: string,
  res: Extract<SlotsResult, { ok: true }>,
  cfg: EconomyDisplayConfig,
): EmbedBuilder {
  const reelDisplay = `【 ${res.reels.join('  |  ')} 】`;
  const title =
    res.multiplier >= 100
      ? '🧊 频道核爆喜报：冰冰冰 100 倍超级大奖！'
      : '🎰 频道喜报：老虎机爆大奖！';
  return createSuccessEmbed(
    title,
    `<@${playerId}> 拉出 ${reelDisplay}（**${res.multiplier}x**），返还 ${cfg.currencyEmoji} **${res.payout}** ${cfg.currencyName}（净赚 **+${res.netChange}**）！`,
  );
}

const DICE_CHOICE_LABEL: Record<DiceChoice, string> = {
  big: '大 (11~17)',
  small: '小 (4~10)',
  triple: '豹子 (三同点 10x)',
};

export function buildDiceResultEmbed(
  choice: DiceChoice,
  bet: number,
  res: Extract<DiceResult, { ok: true }>,
  cfg: EconomyDisplayConfig,
): EmbedBuilder {
  const diceText = res.dice.map((d) => `🎲 **${d}**`).join('  ');
  const outcomeText = res.isTriple
    ? `豹子（${res.sum} 点）`
    : `${res.sum} 点（${res.sum >= 11 ? '大' : '小'}）`;

  return res.won
    ? createSuccessEmbed(
        '🎉 猜大小中奖！',
        [
          `你的投注：**${DICE_CHOICE_LABEL[choice]}** ｜ 下注：**${bet}**`,
          `开奖结果：${diceText} → **${outcomeText}**`,
          `净赚：${cfg.currencyEmoji} **+${res.netChange}** ${cfg.currencyName} ｜ 当前余额：**${res.balance}**`,
        ].join('\n'),
      )
    : createErrorEmbed(
        '💨 差一点就中了',
        [
          `你的投注：**${DICE_CHOICE_LABEL[choice]}** ｜ 下注：**${bet}**`,
          `开奖结果：${diceText} → **${outcomeText}**`,
          `净损：**${res.netChange}** ${cfg.currencyName} ｜ 当前余额：**${res.balance}**`,
        ].join('\n'),
      );
}

export function buildDiceHighlightEmbed(
  playerId: string,
  res: Extract<DiceResult, { ok: true }>,
  cfg: EconomyDisplayConfig,
): EmbedBuilder {
  const diceText = res.dice.map((d) => `🎲 **${d}**`).join('  ');
  return createSuccessEmbed(
    '🎲 频道喜报：豹子通杀！',
    `<@${playerId}> 在猜大小掷出 ${diceText}（**豹子 ${res.sum} 点**），一举净赚 ${cfg.currencyEmoji} **+${res.netChange}** ${cfg.currencyName}！`,
  );
}

export function buildFortuneHighlightEmbed(
  playerId: string,
  res: FortuneDrawResult,
  cfg: EconomyDisplayConfig,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('🎋 频道喜报：今日大吉！')
    .setDescription(
      `<@${playerId}> 今日首抽运势抽中 **【${res.record.luckTier}】**！获赠 ${cfg.currencyEmoji} **+${res.record.bonusCoins}** ${cfg.currencyName}（今日宜：${res.record.goodFor}，幸运数字 **${res.record.luckyNumber}**）！`,
    )
    .setTimestamp();
}

export interface ChannelBroadcastLikeInteraction {
  channel: {
    isSendable?: () => boolean;
    send?: (payload: MessageCreateOptions) => Promise<unknown>;
  } | null;
  channelId?: string | null;
  client?: {
    channels?: {
      fetch?: (id: string) => Promise<unknown>;
    };
  };
}

export async function sendChannelPublicNotice(
  interaction: ChannelBroadcastLikeInteraction,
  payload: MessageCreateOptions,
): Promise<boolean> {
  const safePayload: MessageCreateOptions = {
    allowedMentions: { parse: [] },
    ...payload,
  };
  try {
    const direct = interaction.channel;
    if (direct && typeof direct.isSendable === 'function' && direct.isSendable() && typeof direct.send === 'function') {
      await direct.send(safePayload);
      return true;
    }
    if (interaction.channelId && interaction.client?.channels?.fetch) {
      const fetched = (await interaction.client.channels
        .fetch(interaction.channelId)
        .catch(() => null)) as {
        isSendable?: () => boolean;
        send?: (p: MessageCreateOptions) => Promise<unknown>;
      } | null;
      if (fetched && typeof fetched.isSendable === 'function' && fetched.isSendable() && typeof fetched.send === 'function') {
        await fetched.send(safePayload);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
