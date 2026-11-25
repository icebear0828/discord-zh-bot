import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { EconomyConfig } from '../config/defaults.js';
import type {
  DuelRouletteRecord,
  RpsDuelRecord,
  RpsRoundEntry,
} from '../db/repositories/duelRepo.js';
import {
  formatRpsMoveLabel,
  getDuelArenaService,
  MAX_CUSTOM_WAGER_LEN,
  RPS_WINS_NEEDED,
} from '../services/duelArenaService.js';
import { COLORS, formatDurationZh, type AppContext } from './embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
} from './menuShared.js';

function formatRpsHistoryLine(entry: RpsRoundEntry): string {
  if (entry.timeoutBy) {
    return `• 第 ${entry.round} 局：<@${entry.timeoutBy}> 超时判负 → <@${entry.winnerId}> 胜`;
  }
  const cLabel = entry.challengerMove ? formatRpsMoveLabel(entry.challengerMove) : '⏱️ 未出';
  const oLabel = entry.opponentMove ? formatRpsMoveLabel(entry.opponentMove) : '⏱️ 未出';
  if (entry.tie) {
    return `• 第 ${entry.round} 局：${cLabel} vs ${oLabel} → 🤝 平局重赛`;
  }
  return `• 第 ${entry.round} 局：${cLabel} vs ${oLabel} → <@${entry.winnerId}> 胜`;
}

export function buildRpsDuelCard(
  duel: RpsDuelRecord,
  economyCfg: EconomyConfig,
): BuiltButtonMessage {
  const durationText = formatDurationZh(duel.renameDurationMs);
  const betLine =
    duel.bet > 0
      ? `🪙 附加赌注：${economyCfg.currencyEmoji} **${duel.bet.toLocaleString()}** ${economyCfg.currencyName}`
      : '🪙 附加赌注：无（纯赌改名权）';

  if (duel.status === 'pending') {
    const expUnix = Math.floor(duel.expiresAt / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle('✊✌️🖐️ 石头剪刀布 Bo5 决斗挑战')
      .setDescription(
        truncateText(
          [
            `<@${duel.challengerId}> 向 <@${duel.opponentId}> 发起五局三胜石头剪刀布决斗！`,
            '',
            `🎭 胜者战利品：获得败方 **${durationText}** 改名权（有效期内可反复改名 + 防偷改锁，到期恢复原昵称）`,
            betLine,
            `📜 规则：先赢 **${RPS_WINS_NEEDED}** 局立即获胜（平局重出不计回合数），每回合 60 秒出拳限时。`,
            `⏳ 邀请过期：<t:${expUnix}:R>`,
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `石头剪刀布决斗 #${duel.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(`da:rps:accept:${duel.id}`, '⚔️ 接受决斗', ButtonStyle.Success),
          makeButton(`da:rps:decline:${duel.id}`, '❌ 拒绝 / 取消', ButtonStyle.Danger),
        ),
      ],
    };
  }

  const recentHistory = duel.history.slice(-8).map(formatRpsHistoryLine);

  if (duel.status === 'playing') {
    const roundUnix = Math.floor(duel.roundDeadline / 1000);
    const cStatus = duel.challengerMove ? '✅ 已锁定出拳' : '⏳ 思考中';
    const oStatus = duel.opponentMove ? '✅ 已锁定出拳' : '⏳ 思考中';

    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`✊✌️🖐️ 石头剪刀布 Bo5 · 第 ${duel.roundNumber} 局（先赢 ${RPS_WINS_NEEDED} 局胜）`)
      .setDescription(
        truncateText(
          [
            `📊 **当前比分**：<@${duel.challengerId}> **${duel.challengerWins}** : **${duel.opponentWins}** <@${duel.opponentId}>`,
            `🎭 胜者改名权：**${durationText}** ｜ ${betLine}`,
            '',
            `• <@${duel.challengerId}>：${cStatus}`,
            `• <@${duel.opponentId}>：${oStatus}`,
            `⏰ 本回合出拳截止：<t:${roundUnix}:R>`,
            ...(recentHistory.length > 0 ? ['', '**战况记录：**', ...recentHistory] : []),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `石头剪刀布决斗 #${duel.id} · 盲选出拳，双方锁定后同时揭晓` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(`da:rps:move:${duel.id}:rock`, '✊ 石头', ButtonStyle.Primary),
          makeButton(`da:rps:move:${duel.id}:paper`, '🖐️ 布', ButtonStyle.Primary),
          makeButton(`da:rps:move:${duel.id}:scissors`, '✌️ 剪刀', ButtonStyle.Primary),
        ),
      ],
    };
  }

  if (duel.status === 'completed' && duel.winnerId && duel.loserId) {
    const lockExpUnix = Math.floor((duel.updatedAt + duel.renameDurationMs) / 1000);
    const coinWinLine =
      duel.bet > 0
        ? `🪙 赢得赌注：${economyCfg.currencyEmoji} **+${duel.bet.toLocaleString()}** ${economyCfg.currencyName}`
        : '';
    const bountyLine =
      duel.bountyClaimed > 0
        ? `🎯 兑现通缉悬赏：${economyCfg.currencyEmoji} **+${duel.bountyClaimed.toLocaleString()}** ${economyCfg.currencyName}`
        : '';

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle('🏆 石头剪刀布 Bo5 决斗已分出胜负！')
      .setDescription(
        truncateText(
          [
            `🏆 **胜者：<@${duel.winnerId}>** ｜ 💀 **败者：<@${duel.loserId}>**`,
            `📊 最终比分：<@${duel.challengerId}> **${duel.challengerWins}** : **${duel.opponentWins}** <@${duel.opponentId}>`,
            `🎭 **战利品**：<@${duel.winnerId}> 获得 <@${duel.loserId}> 的 **${durationText}** 改名权（截止 <t:${lockExpUnix}:R>）！`,
            ...(coinWinLine ? [coinWinLine] : []),
            ...(bountyLine ? [bountyLine] : []),
            ...(recentHistory.length > 0 ? ['', '**对局回放：**', ...recentHistory] : []),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `石头剪刀布决斗 #${duel.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(`da:nick_btn:${duel.loserId}`, '🎭 给败方改名', ButtonStyle.Danger),
        ),
      ],
    };
  }

  const statusMeta: Record<'declined' | 'expired' | 'cancelled', { title: string; color: number; text: string }> = {
    declined: {
      title: '🏃 石头剪刀布决斗已拒绝',
      color: COLORS.ERROR,
      text: `<@${duel.challengerId}> 向 <@${duel.opponentId}> 发起的决斗已被取消或拒绝。`,
    },
    expired: {
      title: '⌛ 石头剪刀布决斗已过期',
      color: COLORS.WARNING,
      text: `<@${duel.challengerId}> 向 <@${duel.opponentId}> 发起的决斗已超时失效${duel.bet > 0 ? `，已退回 ${duel.bet.toLocaleString()} ${economyCfg.currencyName}` : ''}。`,
    },
    cancelled: {
      title: '⌛ 石头剪刀布决斗流局',
      color: COLORS.WARNING,
      text: `双方均未在限时内出拳，决斗已自动流局${duel.bet > 0 ? `并退回双方 ${duel.bet.toLocaleString()} ${economyCfg.currencyName}` : ''}。`,
    },
  };
  const meta =
    statusMeta[
      duel.status === 'declined' || duel.status === 'expired' || duel.status === 'cancelled'
        ? duel.status
        : 'cancelled'
    ];

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.title)
    .setDescription(truncateText(meta.text, 4096))
    .setFooter({ text: `石头剪刀布决斗 #${duel.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}

export function formatRouletteDuelStakes(
  duel: DuelRouletteRecord,
  economyCfg: EconomyConfig,
): string[] {
  const lines: string[] = [];
  if (duel.bet > 0) {
    lines.push(
      `🪙 **黑吊币**：${economyCfg.currencyEmoji} **${duel.bet.toLocaleString()}** ${economyCfg.currencyName}（胜者赢走对手赌注）`,
    );
  }
  if (duel.renameDurationMs > 0) {
    lines.push(`🎭 **限时改名权**：胜者可反复修改败方昵称 **${formatDurationZh(duel.renameDurationMs)}**`);
  }
  if (duel.timeoutDurationMs > 0) {
    lines.push(`🔇 **限时禁言**：败方立即禁言 **${formatDurationZh(duel.timeoutDurationMs)}**`);
  }
  if (duel.customWager.trim().length > 0) {
    lines.push(`📝 **自定义赌约**：「${duel.customWager}」`);
  }
  return lines;
}

export function buildRouletteDuelCard(
  duel: DuelRouletteRecord,
  economyCfg: EconomyConfig,
  penaltyNote?: string,
): BuiltButtonMessage {
  const stakes = formatRouletteDuelStakes(duel, economyCfg);
  const recentLogs = duel.logs.slice(-6);

  if (duel.status === 'pending') {
    const expUnix = Math.floor(duel.expiresAt / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('🔫 1v1 俄罗斯轮盘决斗挑战')
      .setDescription(
        truncateText(
          [
            `<@${duel.challengerId}> 向 <@${duel.opponentId}> 发起生死俄罗斯轮盘决斗！`,
            `🔫 **弹巢装填**：6 孔左轮装入 **${duel.bullets}** 发实弹（随机先手，轮流扣扳机，30 秒超时自动代扣）`,
            '',
            '**💰 赌注内容：**',
            ...stakes,
            '',
            `⏳ 邀请过期：<t:${expUnix}:R>`,
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `1v1 轮盘决斗 #${duel.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(`da:rl:accept:${duel.id}`, '🔫 接受赌局', ButtonStyle.Success),
          makeButton(`da:rl:decline:${duel.id}`, '❌ 拒绝 / 取消', ButtonStyle.Danger),
        ),
      ],
    };
  }

  if (duel.status === 'playing' && duel.turnOrder.length === 2) {
    const currentId = duel.turnOrder[duel.turnIndex % 2]!;
    const turnUnix = Math.floor(duel.turnDeadline / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle(`🔫 1v1 俄罗斯轮盘 #${duel.id}（死斗中）`)
      .setDescription(
        truncateText(
          [
            `对阵：<@${duel.challengerId}> vs <@${duel.opponentId}> ｜ 实弹：**${duel.bullets}/6**`,
            ...stakes,
            '',
            `👉 **当前轮到：<@${currentId}>**（已空枪 **${duel.chamberPos}/6**）`,
            `⏰ 请在 <t:${turnUnix}:R> 前扣动扳机（超时将自动代扣）`,
            ...(recentLogs.length > 0 ? ['', '**战况记录：**', ...recentLogs] : []),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `1v1 轮盘决斗 #${duel.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(makeButton(`da:rl:fire:${duel.id}`, '👉 扣动扳机！', ButtonStyle.Danger)),
      ],
    };
  }

  if (duel.status === 'completed' && duel.winnerId && duel.loserId) {
    const settleLines: string[] = [];
    if (duel.bet > 0) {
      settleLines.push(
        `🪙 **赢得赌注**：${economyCfg.currencyEmoji} **+${duel.bet.toLocaleString()}** ${economyCfg.currencyName}`,
      );
    }
    if (duel.bountyClaimed > 0) {
      settleLines.push(
        `🎯 **兑现通缉悬赏**：${economyCfg.currencyEmoji} **+${duel.bountyClaimed.toLocaleString()}** ${economyCfg.currencyName}`,
      );
    }
    if (duel.renameDurationMs > 0) {
      const lockExpUnix = Math.floor((duel.updatedAt + duel.renameDurationMs) / 1000);
      settleLines.push(
        `🎭 **改名权解锁**：<@${duel.winnerId}> 可在 <t:${lockExpUnix}:R> 前反复修改 <@${duel.loserId}> 的昵称`,
      );
    }
    if (duel.timeoutDurationMs > 0) {
      settleLines.push(
        `🔇 **禁言惩罚**：${penaltyNote ?? `已对 <@${duel.loserId}> 执行 ${formatDurationZh(duel.timeoutDurationMs)} 禁言`}`,
      );
    }
    if (duel.customWager.trim().length > 0) {
      settleLines.push(`📝 **赌约兑现**：<@${duel.loserId}> 需履行「${duel.customWager}」`);
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`🏆 1v1 俄罗斯轮盘 #${duel.id} 已决出胜负！`)
      .setDescription(
        truncateText(
          [
            `🏆 **胜者：<@${duel.winnerId}>** ｜ 💀 **中弹败者：<@${duel.loserId}>**`,
            '',
            '**💰 结算清单：**',
            ...settleLines,
            ...(recentLogs.length > 0 ? ['', '**战况回放：**', ...recentLogs] : []),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `1v1 轮盘决斗 #${duel.id}` })
      .setTimestamp();

    const components =
      duel.renameDurationMs > 0
        ? [
            buttonRow(
              makeButton(`da:nick_btn:${duel.loserId}`, '🎭 给败方改名', ButtonStyle.Danger),
            ),
          ]
        : [];

    return { embeds: [embed], components };
  }

  const isExpired = duel.status === 'expired';
  const embed = new EmbedBuilder()
    .setColor(isExpired ? COLORS.WARNING : COLORS.ERROR)
    .setTitle(isExpired ? '⌛ 1v1 俄罗斯轮盘已过期' : '🏃 1v1 俄罗斯轮盘已拒绝')
    .setDescription(
      truncateText(
        `<@${duel.challengerId}> 向 <@${duel.opponentId}> 发起的 1v1 俄罗斯轮盘${isExpired ? '已超时失效' : '已被取消或拒绝'}${duel.bet > 0 ? `，冻结的 ${duel.bet.toLocaleString()} ${economyCfg.currencyName} 已退回` : ''}。`,
        4096,
      ),
    )
    .setFooter({ text: `1v1 轮盘决斗 #${duel.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}

export function buildDuelLobbyView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const arena = getDuelArenaService(ctx);
  const ownedLocks = arena.listWinnerNicknameLocks(guildId, actor.id, nowMs);
  const selfLock = arena.getActiveNicknameLock(guildId, actor.id, nowMs);

  const lockLines =
    ownedLocks.length > 0
      ? ownedLocks.map(
          (l) =>
            `• <@${l.targetId}>：${l.lockedNickname ? `当前锁定为「**${l.lockedNickname}**」` : '待你赐名'}（<t:${Math.floor(l.expiresAt / 1000)}:R> 到期）`,
        )
      : ['• 暂无待行使的败方改名权，快去决斗赢取吧！'];

  const description = [
    `${cfg.currencyEmoji} 你的口袋现金：**${profile.coins.toLocaleString()}** ${cfg.currencyName}`,
    ...(selfLock
      ? [
          `🔒 **你当前正处于败方改名锁中**：由 <@${selfLock.winnerId}> 控制至 <t:${Math.floor(selfLock.expiresAt / 1000)}:R>`,
        ]
      : []),
    '',
    '**⚔️ 三大决斗模式：**',
    '1. **🎲 骰子决斗**：各掷 3 颗骰子比拼总点数，押注 1 ~ 10 亿。',
    '2. **✊✌️🖐️ 石头剪刀布 Bo5**：五局三胜（平局重出），胜者获 **1h/6h/24h** 败方反复改名权（防偷改锁+到期恢复原昵称），可附加黑吊币赌注。',
    '3. **🔫 1v1 俄罗斯轮盘**：6 孔装 **1~3 发**实弹，自由组合赌 **黑吊币 / 改名权 / 禁言 / 自定义文字赌约**！',
    '',
    '**🎭 我当前拥有的改名权：**',
    ...lockLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.WARNING, feedback))
    .setAuthor({ name: `${actor.displayName} · 决斗大厅`, iconURL: actor.avatarUrl })
    .setTitle('⚔️ 多人决斗大厅')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 公开互动：也可直接使用 /决斗 指令发起挑战或快速改名' })
    .setTimestamp();

  const components: MenuComponentRow[] = [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('menu:user:duel')
        .setPlaceholder('🎲 选择群友发起「骰子决斗」...')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('menu:user:rps_duel')
        .setPlaceholder('✊ 选择群友发起「石头剪刀布 Bo5（赢家改名）」...')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('menu:user:roulette_duel')
        .setPlaceholder('🔫 选择群友发起「1v1 俄罗斯轮盘（多赌注）」...')
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];

  if (ownedLocks.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('da:nick_pick')
          .setPlaceholder('🎭 选择一位败方立即行使改名权...')
          .addOptions(
            ownedLocks.slice(0, 25).map((lock) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(
                  truncateText(
                    lock.lockedNickname
                      ? `修改用户 ${lock.targetId}（当前：${lock.lockedNickname}）`
                      : `给用户 ${lock.targetId} 改名`,
                    100,
                  ),
                )
                .setValue(lock.targetId)
                .setDescription(
                  truncateText(`有效期至 ${new Date(lock.expiresAt).toLocaleString('zh-CN')}`, 100),
                ),
            ),
          ),
      ),
    );
  }

  components.push(
    buttonRow(
      makeButton('menu:nav:duel', '🔄 刷新大厅', ButtonStyle.Secondary),
      makeButton('menu:nav:multi', '⬅️ 多人博弈', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

export function buildRpsDuelModal(opponentId: string, currencyName: string): ModalBuilder {
  const renameHours = new TextInputBuilder()
    .setCustomId('renameHours')
    .setLabel(truncateText('胜者改名时长（填 1、6 或 24 小时）', 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(2)
    .setValue('24')
    .setPlaceholder('1 / 6 / 24')
    .setRequired(true);

  const bet = new TextInputBuilder()
    .setCustomId('bet')
    .setLabel(truncateText(`附加${currencyName}赌注（0 = 纯赌改名）`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setValue('0')
    .setPlaceholder('0 ~ 1000000000')
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`da:modal:rps:${opponentId}`)
    .setTitle('✊✌️🖐️ 发起石头剪刀布 Bo5 决斗')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(renameHours),
      new ActionRowBuilder<TextInputBuilder>().addComponents(bet),
    );
}

export function buildRouletteDuelModal(opponentId: string, currencyName: string): ModalBuilder {
  const bullets = new TextInputBuilder()
    .setCustomId('bullets')
    .setLabel(truncateText('实弹数量（6 孔弹巢填 1、2 或 3）', 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(1)
    .setValue('1')
    .setPlaceholder('1 / 2 / 3')
    .setRequired(true);

  const bet = new TextInputBuilder()
    .setCustomId('bet')
    .setLabel(truncateText(`附加${currencyName}赌注（0 = 不赌币）`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setValue('0')
    .setPlaceholder('0 ~ 1000000000')
    .setRequired(true);

  const renameHours = new TextInputBuilder()
    .setCustomId('renameHours')
    .setLabel(truncateText('赌改名时长（0=不赌，或填 1/6/24 小时）', 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(2)
    .setValue('0')
    .setPlaceholder('0 / 1 / 6 / 24')
    .setRequired(true);

  const timeoutMinutes = new TextInputBuilder()
    .setCustomId('timeoutMinutes')
    .setLabel(truncateText('赌禁言时长（0=不赌，或填 5/10/30 分钟）', 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(2)
    .setValue('0')
    .setPlaceholder('0 / 5 / 10 / 30')
    .setRequired(true);

  const customWager = new TextInputBuilder()
    .setCustomId('customWager')
    .setLabel(truncateText('自定义文字赌约（可选，最多 100 字）', 45))
    .setStyle(TextInputStyle.Short)
    .setMaxLength(MAX_CUSTOM_WAGER_LEN)
    .setPlaceholder('例如：输了发 50 字真情实感夸赞')
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(`da:modal:rl1v1:${opponentId}`)
    .setTitle('🔫 发起 1v1 俄罗斯轮盘赌局')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(bullets),
      new ActionRowBuilder<TextInputBuilder>().addComponents(bet),
      new ActionRowBuilder<TextInputBuilder>().addComponents(renameHours),
      new ActionRowBuilder<TextInputBuilder>().addComponents(timeoutMinutes),
      new ActionRowBuilder<TextInputBuilder>().addComponents(customWager),
    );
}

export function buildRenameTargetModal(
  targetId: string,
  source: 'menu' | 'card' = 'card',
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('nickname')
    .setLabel(truncateText('输入败方新昵称（1 ~ 32 个字符）', 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(32)
    .setPlaceholder('例如：我是大冤种')
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`da:modal:rename:${targetId}:${source}`)
    .setTitle('🎭 行使决斗胜者改名权')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}
