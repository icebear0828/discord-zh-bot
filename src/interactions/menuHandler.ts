import {
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type GuildMember,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import type { ModuleKey } from '../config/defaults.js';
import type { BlackjackActionResult, BlackjackGame } from '../services/blackjackService.js';
import type { DiceChoice } from '../services/economyService.js';
import type { InteractionAction } from '../services/funService.js';
import type { LeaderboardType } from '../services/levelingService.js';
import {
  COLORS,
  createErrorEmbed,
  createSuccessEmbed,
  formatDurationZh,
  type AppContext,
} from '../ui/embeds.js';
import {
  buildDuelMessage,
  buildMenuMessage,
  buildPublicLeaderboardEmbed,
  buildPublicRankEmbed,
  buildRedPacketMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuFeedback,
  type MenuView,
} from '../ui/menuBuilder.js';

const VALID_SOCIAL_ACTIONS: ReadonlySet<string> = new Set([
  'pat',
  'hug',
  'cuddle',
  'poke',
  'feed',
  'snowball',
]);

function getActor(interaction: {
  user: { id: string; displayName: string; displayAvatarURL(): string };
}): MenuActor {
  return {
    id: interaction.user.id,
    displayName: interaction.user.displayName,
    avatarUrl: interaction.user.displayAvatarURL(),
  };
}

function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return num;
}

function parseDiceChoice(raw: string | undefined): DiceChoice {
  if (raw === 'small' || raw === 'triple') return raw;
  return 'big';
}

function parseSocialAction(raw: string | undefined): InteractionAction {
  if (raw && VALID_SOCIAL_ACTIONS.has(raw)) {
    return raw as InteractionAction;
  }
  return 'pat';
}

function parseLeaderboardType(raw: string | undefined): LeaderboardType {
  if (raw === 'coins' || raw === 'invites') return raw;
  return 'xp';
}

function checkModuleDisabled(
  ctx: AppContext,
  guildId: string,
  key: ModuleKey,
  displayName: string,
): string | null {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  if (!cfg.modules[key]) {
    return `当前服务器已关闭「${displayName}」模块，请联系管理员通过 \`/设置 开关模块\` 开启。`;
  }
  return null;
}

function detectHomeOrSolo(interaction: ButtonInteraction): 'home' | 'solo' {
  for (const row of interaction.message.components) {
    if (row.type !== ComponentType.ActionRow) continue;
    for (const comp of row.components) {
      if (comp.customId === 'menu:nav:slots') {
        return 'solo';
      }
    }
  }
  return 'home';
}

function buildAmountModal(
  customId: string,
  title: string,
  label: string,
  placeholder: string,
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setPlaceholder(placeholder)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

function buildRedPacketModal(): ModalBuilder {
  const totalAmount = new TextInputBuilder()
    .setCustomId('totalAmount')
    .setLabel('红包总金额（1 ~ 1,000,000 星币）')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(10)
    .setPlaceholder('例如：500')
    .setRequired(true);

  const totalCount = new TextInputBuilder()
    .setCustomId('totalCount')
    .setLabel('红包份数（2 ~ 20 份）')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(4)
    .setPlaceholder('例如：5')
    .setRequired(true);

  const greeting = new TextInputBuilder()
    .setCustomId('greeting')
    .setLabel('红包祝福语（可选）')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(50)
    .setPlaceholder('恭喜发财，大吉大利！')
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:redpacket')
    .setTitle('🧧 发拼手气红包')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(totalAmount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(totalCount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(greeting),
    );
}

async function respondFromModal(
  interaction: ModalSubmitInteraction,
  msg: BuiltMenuMessage,
): Promise<void> {
  if (interaction.isFromMessage()) {
    await interaction.update(msg);
  } else {
    await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
  }
}

type MenuSupportedInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

interface ActionWithHighlight {
  msg: BuiltMenuMessage;
  highlight?: MessageCreateOptions;
}

async function sendPublicBroadcast(
  interaction: MenuSupportedInteraction,
  payload: MessageCreateOptions,
): Promise<boolean> {
  try {
    const direct = interaction.channel;
    if (direct && direct.isSendable()) {
      await direct.send(payload);
      return true;
    }
    if (interaction.channelId) {
      const fetched = await interaction.client.channels
        .fetch(interaction.channelId)
        .catch(() => null);
      if (fetched && fetched.isSendable()) {
        await fetched.send(payload);
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error('[menu] 发送频道公开播报失败:', err);
    return false;
  }
}

function buildBlackjackOutcomeFeedback(
  game: BlackjackGame,
  balance: number,
  currencyName: string,
): MenuFeedback {
  switch (game.status) {
    case 'playing':
      return { type: 'info', text: '请选择你的操作：要牌、停牌或双倍下注。' };
    case 'player_blackjack':
      return {
        type: 'success',
        text: `🎉 天胡 Blackjack！赢得 **${game.payout}** ${currencyName}，当前现金 **${balance}**。`,
      };
    case 'dealer_bust':
      return {
        type: 'success',
        text: `🎉 庄家爆牌！赢得 **${game.payout}** ${currencyName}，当前现金 **${balance}**。`,
      };
    case 'player_win':
      return {
        type: 'success',
        text: `🎉 你的点数更大！赢得 **${game.payout}** ${currencyName}，当前现金 **${balance}**。`,
      };
    case 'push':
      return {
        type: 'info',
        text: `🤝 双方平局！退回下注 **${game.payout}** ${currencyName}，当前现金 **${balance}**。`,
      };
    case 'player_bust':
      return {
        type: 'error',
        text: `💥 爆牌了（超过 21 点），庄家获胜。当前现金 **${balance}** ${currencyName}。`,
      };
    case 'dealer_win':
      return {
        type: 'error',
        text: `😔 庄家点数更大，本局失利。当前现金 **${balance}** ${currencyName}。`,
      };
  }
}

function runSlotsAction(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  bet: number,
): ActionWithHighlight {
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return {
      msg: buildMenuMessage(ctx, guildId, actor, { page: 'slots' }, { type: 'error', text: disabledMsg }),
    };
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.economy.playSlots(guildId, actor.id, bet);
  if (!res.ok) {
    const text =
      res.reason === 'insufficient_funds'
        ? `口袋现金不足，无法下注 **${bet}** ${cfg.currencyName}。`
        : '下注金额无效，请输入大于 0 的整数。';
    return {
      msg: buildMenuMessage(ctx, guildId, actor, { page: 'slots' }, { type: 'error', text }),
    };
  }

  const reelDisplay = `【 ${res.reels.join('  |  ')} 】`;
  const netStr = res.netChange >= 0 ? `+${res.netChange}` : String(res.netChange);
  const feedback: MenuFeedback = {
    type: res.netChange > 0 ? 'success' : res.netChange === 0 ? 'info' : 'error',
    text: `${reelDisplay}\n倍率：**${res.multiplier}x** ｜ 返还：**${res.payout}** ${cfg.currencyName} ｜ 净变动：**${netStr}** ｜ 现金：**${res.balance}**`,
  };
  const highlight: MessageCreateOptions | undefined =
    res.multiplier >= 4
      ? {
          content: `🎰 欧皇降临！<@${actor.id}> 在老虎机转出 ${reelDisplay}（${res.multiplier}x），狂赚 **+${res.netChange}** ${cfg.currencyName}！`,
          embeds: [
            createSuccessEmbed(
              '🎰 频道喜报：老虎机爆大奖！',
              `<@${actor.id}> 拉出 ${reelDisplay}（**${res.multiplier}x**），返还 ${cfg.currencyEmoji} **${res.payout}** ${cfg.currencyName}（净赚 **+${res.netChange}**）！`,
            ),
          ],
        }
      : undefined;

  return {
    msg: buildMenuMessage(ctx, guildId, actor, { page: 'slots' }, feedback),
    highlight,
  };
}

function runDiceAction(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  choice: DiceChoice,
  bet: number,
): ActionWithHighlight {
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return {
      msg: buildMenuMessage(ctx, guildId, actor, { page: 'dice', choice }, { type: 'error', text: disabledMsg }),
    };
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.economy.playDice(guildId, actor.id, bet, choice);
  if (!res.ok) {
    const text =
      res.reason === 'insufficient_funds'
        ? `口袋现金不足，无法下注 **${bet}** ${cfg.currencyName}。`
        : '下注金额无效，请输入大于 0 的整数。';
    return {
      msg: buildMenuMessage(ctx, guildId, actor, { page: 'dice', choice }, { type: 'error', text }),
    };
  }

  const diceText = res.dice.map((d) => `🎲 **${d}**`).join(' ');
  const outcome = res.isTriple
    ? `豹子（${res.sum} 点）`
    : `${res.sum} 点（${res.sum >= 11 ? '大' : '小'}）`;
  const netStr = res.netChange >= 0 ? `+${res.netChange}` : String(res.netChange);
  const feedback: MenuFeedback = {
    type: res.won ? 'success' : 'error',
    text: `开骰：${diceText} → **${outcome}**\n${res.won ? '中奖！' : '未中奖，'}净变动：**${netStr}** ${cfg.currencyName} ｜ 现金：**${res.balance}**`,
  };
  const highlight: MessageCreateOptions | undefined =
    res.won && res.isTriple
      ? {
          content: `🎲 欧皇降临！<@${actor.id}> 在猜大小押中豹子（10x），狂赚 **+${res.netChange}** ${cfg.currencyName}！`,
          embeds: [
            createSuccessEmbed(
              '🎲 频道喜报：豹子通杀！',
              `<@${actor.id}> 掷出 ${diceText}（**${outcome}**），一举赢走 ${cfg.currencyEmoji} **+${res.netChange}** ${cfg.currencyName}！`,
            ),
          ],
        }
      : undefined;

  return {
    msg: buildMenuMessage(ctx, guildId, actor, { page: 'dice', choice }, feedback),
    highlight,
  };
}

function buildBlackjackResponse(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  res: BlackjackActionResult,
): ActionWithHighlight {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      invalid_bet: '下注金额无效，请输入大于 0 的整数。',
      insufficient_funds: `口袋现金不足！`,
      game_already_active: '你还有一局未结束的二十一点，请先完成当前对局。',
      no_active_game: '当前没有进行中的牌局，请先下注开局。',
      cannot_double: '只能在首轮两张牌时双倍下注。',
    };
    return {
      msg: buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'bj' },
        { type: 'error', text: msgMap[res.reason] },
      ),
    };
  }

  const feedback = buildBlackjackOutcomeFeedback(res.game, res.balance, cfg.currencyName);
  const view: MenuView =
    res.game.status === 'playing'
      ? { page: 'bj' }
      : { page: 'bj', finishedGame: res.game, balanceAfterFinish: res.balance };

  const netWin = res.game.payout - res.game.bet;
  const isBigWin =
    res.game.status !== 'playing' &&
    (res.game.status === 'player_blackjack' || netWin >= 500);
  const headline = res.game.status === 'player_blackjack' ? '打出天胡 Blackjack' : '大获全胜';
  const highlight: MessageCreateOptions | undefined = isBigWin
    ? {
        content: `🃏 牌神降临！<@${actor.id}> 在二十一点${headline}，赢得 **${res.game.payout}** ${cfg.currencyName}！`,
        embeds: [
          createSuccessEmbed(
            `🃏 频道喜报：二十一点${headline}！`,
            `<@${actor.id}> 本局下注 **${res.game.bet}**，赢得 ${cfg.currencyEmoji} **${res.game.payout}** ${cfg.currencyName}（净赚 **+${netWin}**）！`,
          ),
        ],
      }
    : undefined;

  return {
    msg: buildMenuMessage(ctx, guildId, actor, view, feedback),
    highlight,
  };
}

function runBankTransferAction(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  direction: 'deposit' | 'withdraw',
  amount: number,
): BuiltMenuMessage {
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text: disabledMsg });
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res =
    direction === 'deposit'
      ? ctx.services.economy.deposit(guildId, actor.id, amount)
      : ctx.services.economy.withdraw(guildId, actor.id, amount);

  if (!res.ok) {
    const text =
      res.reason === 'insufficient_funds'
        ? direction === 'deposit'
          ? '口袋现金余额不足，无法存入该金额。'
          : '银行存款余额不足，无法取出该金额。'
        : '请输入有效的正整数金额。';
    return buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text });
  }

  const verb = direction === 'deposit' ? '存入银行' : '从银行取出';
  return buildMenuMessage(
    ctx,
    guildId,
    actor,
    { page: 'bank' },
    {
      type: 'success',
      text: `已成功${verb} ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！（现金 **${res.coins}** ｜ 银行 **${res.bankCoins}**）`,
    },
  );
}

export async function handleMenuButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = getActor(interaction);
  const parts = interaction.customId.split(':');
  const section = parts[1];

  if (section === 'open') {
    await interaction.reply({
      ...buildMenuMessage(ctx, guildId, actor, { page: 'home' }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (section === 'nav') {
    const target = parts[2];
    if (target === 'rank') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'leveling', '等级与热度');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'rank' }));
      return;
    }

    const viewMap: Record<string, MenuView> = {
      home: { page: 'home' },
      solo: { page: 'solo' },
      slots: { page: 'slots' },
      dice: { page: 'dice', choice: 'big' },
      bj: { page: 'bj' },
      bank: { page: 'bank' },
      multi: { page: 'multi' },
      rob: { page: 'rob' },
      pay: { page: 'pay' },
      duel: { page: 'duel' },
      shop: { page: 'shop' },
      bag: { page: 'bag' },
    };

    const view: MenuView =
      target === 'social'
        ? { page: 'social', action: parseSocialAction(parts[3]) }
        : (viewMap[target ?? 'home'] ?? { page: 'home' });

    await interaction.update(buildMenuMessage(ctx, guildId, actor, view));
    return;
  }

  if (section === 'act') {
    const action = parts[2];
    const sourcePage = detectHomeOrSolo(interaction);
    const view: MenuView = { page: sourcePage };

    if (action === 'daily') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, view, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.economy.claimDaily(guildId, actor.id);
      const feedback: MenuFeedback = res.ok
        ? {
            type: 'success',
            text: `每日签到成功！获得 ${cfg.currencyEmoji} **+${res.reward}** ${cfg.currencyName}${res.bonus > 0 ? `（含连签加成 +${res.bonus}）` : ''}，已连签 **${res.streak}** 天！`,
          }
        : {
            type: 'error',
            text: `今天已经签过到啦（已连签 **${res.streak}** 天），请明天再来！`,
          };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, view, feedback));
      return;
    }

    if (action === 'work') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, view, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.economy.work(guildId, actor.id);
      const feedback: MenuFeedback = res.ok
        ? {
            type: 'success',
            text: `你${res.story}，赚取了 ${cfg.currencyEmoji} **+${res.reward}** ${cfg.currencyName}！`,
          }
        : {
            type: 'error',
            text: `打工冷却中，还需等待 **${formatDurationZh(res.retryAfterSec * 1000)}**。`,
          };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, view, feedback));
      return;
    }

    if (action === 'fortune') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'fun', '娱乐互动');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, view, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.fun.drawDailyFortune(guildId, actor.id);
      if (!res.alreadyDrawn && res.record.luckTier === '大吉') {
        await sendPublicBroadcast(interaction, {
          content: `🎋 欧皇抽签！<@${actor.id}> 今日抽到【大吉】，获赠 **+${res.record.bonusCoins}** ${cfg.currencyName}！`,
          embeds: [
            createSuccessEmbed(
              '🎋 频道喜报：今日运势【大吉】！',
              `<@${actor.id}> 抽中上上签【大吉】，获得 ${cfg.currencyEmoji} **+${res.record.bonusCoins}** ${cfg.currencyName}，幸运数字 **${res.record.luckyNumber}**！`,
            ),
          ],
        });
      }
      const feedback: MenuFeedback = {
        type: res.alreadyDrawn ? 'info' : 'success',
        text: [
          `🎋 今日运势：**【${res.record.luckTier}】**${res.alreadyDrawn ? '（今日已抽签）' : ` · 首抽获赠 ${cfg.currencyEmoji} **+${res.record.bonusCoins}** ${cfg.currencyName}！`}`,
          `🟢 宜：${res.record.goodFor} ｜ 🔴 忌：${res.record.avoid} ｜ 🔢 幸运数字：**${res.record.luckyNumber}**`,
        ].join('\n'),
      };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, view, feedback));
      return;
    }
  }

  if (section === 'slots') {
    const bet = parsePositiveInt(parts[2] ?? '') ?? 0;
    const out = runSlotsAction(ctx, guildId, actor, bet);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    await interaction.update(out.msg);
    return;
  }

  if (section === 'dice_pick') {
    const choice = parseDiceChoice(parts[2]);
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'dice', choice }));
    return;
  }

  if (section === 'dice_bet') {
    const choice = parseDiceChoice(parts[2]);
    const bet = parsePositiveInt(parts[3] ?? '') ?? 0;
    const out = runDiceAction(ctx, guildId, actor, choice, bet);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    await interaction.update(out.msg);
    return;
  }

  if (section === 'bj_start') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'bj' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    const bet = parsePositiveInt(parts[2] ?? '') ?? 0;
    const res = ctx.services.blackjack.startGame(guildId, actor.id, bet);
    const out = buildBlackjackResponse(ctx, guildId, actor, res);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    await interaction.update(out.msg);
    return;
  }

  if (section === 'bj') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'bj' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    const action = parts[2];
    const res =
      action === 'hit'
        ? ctx.services.blackjack.hit(guildId, actor.id)
        : action === 'double'
          ? ctx.services.blackjack.doubleDown(guildId, actor.id)
          : ctx.services.blackjack.stand(guildId, actor.id);
    const out = buildBlackjackResponse(ctx, guildId, actor, res);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    await interaction.update(out.msg);
    return;
  }

  if (section === 'bank') {
    const sub = parts[2];
    if (sub === 'interest') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.economy.claimBankInterest(guildId, actor.id);
      const feedback: MenuFeedback = res.ok
        ? {
            type: 'success',
            text: `成功领取今日银行利息 ${cfg.currencyEmoji} **+${res.interest}** ${cfg.currencyName}！当前银行存款：**${res.bankCoins}**。`,
          }
        : res.reason === 'already_claimed'
          ? { type: 'error', text: '你今天已经领过银行利息啦，请明天再来！' }
          : {
              type: 'error',
              text: `银行存款需至少达到 **${res.minDeposit ?? cfg.bankInterestMinDeposit}** ${cfg.currencyName} 才可领取每日利息。`,
            };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, feedback));
      return;
    }

    if (sub === 'dep' || sub === 'wd') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
      const source = sub === 'dep' ? profile.coins : profile.bankCoins;
      const mode = parts[3];
      const amount =
        mode === 'all'
          ? source
          : mode === '50'
            ? Math.floor(source * 0.5)
            : Math.floor(source * 0.25);

      if (amount < 1) {
        const text =
          sub === 'dep'
            ? '口袋现金不足，按比例计算不足 1 星币，无法存入。'
            : '银行存款不足，按比例计算不足 1 星币，无法取出。';
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text }),
        );
        return;
      }

      await interaction.update(
        runBankTransferAction(ctx, guildId, actor, sub === 'dep' ? 'deposit' : 'withdraw', amount),
      );
      return;
    }
  }

  if (section === 'bag' && parts[2] === 'clear_title') {
    ctx.services.fun.clearTitle(guildId, actor.id);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'bag' },
        { type: 'success', text: '已卸下当前佩戴的专属称号。' },
      ),
    );
    return;
  }

  if (section === 'rank') {
    const lbType = parseLeaderboardType(parts[2]);
    const lbPage = parsePositiveInt(parts[3] ?? '') ?? 1;

    const moduleMap: Record<LeaderboardType, { key: ModuleKey; name: string }> = {
      xp: { key: 'leveling', name: '等级与热度' },
      coins: { key: 'economy', name: '经济系统' },
      invites: { key: 'invites', name: '邀请追踪' },
    };
    const mod = moduleMap[lbType];
    const disabledMsg = checkModuleDisabled(ctx, guildId, mod.key, mod.name);
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'home' },
          { type: 'error', text: disabledMsg },
        ),
      );
      return;
    }

    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'leaderboard', lbType, lbPage }),
    );
    return;
  }

  if (section === 'share') {
    const shareTarget = parts[2];
    if (shareTarget === 'rank') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'leveling', '等级与热度');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'rank' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const publicEmbed = buildPublicRankEmbed(ctx, guildId, actor);
      const sent = await sendPublicBroadcast(interaction, {
        content: `📢 <@${actor.id}> 晒出了个人等级名片：`,
        embeds: [publicEmbed],
      });
      const feedback: MenuFeedback = sent
        ? { type: 'success', text: '已将你的等级名片晒出到当前频道！' }
        : { type: 'error', text: '无法在当前频道发送公开消息，请检查机器人发言权限。' };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'rank' }, feedback));
      return;
    }

    if (shareTarget === 'lb') {
      const lbType = parseLeaderboardType(parts[3]);
      const lbPage = parsePositiveInt(parts[4] ?? '') ?? 1;
      const moduleMap: Record<LeaderboardType, { key: ModuleKey; name: string }> = {
        xp: { key: 'leveling', name: '等级与热度' },
        coins: { key: 'economy', name: '经济系统' },
        invites: { key: 'invites', name: '邀请追踪' },
      };
      const mod = moduleMap[lbType];
      const disabledMsg = checkModuleDisabled(ctx, guildId, mod.key, mod.name);
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'leaderboard', lbType, lbPage },
            { type: 'error', text: disabledMsg },
          ),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const lbNameMap: Record<LeaderboardType, string> = {
        xp: '等级经验排行榜',
        coins: `${cfg.currencyName}富豪榜`,
        invites: '邀请贡献排行榜',
      };
      const publicEmbed = buildPublicLeaderboardEmbed(ctx, guildId, lbType, lbPage);
      const sent = await sendPublicBroadcast(interaction, {
        content: `📢 <@${actor.id}> 晒出了服务器「${lbNameMap[lbType]}」：`,
        embeds: [publicEmbed],
      });
      const feedback: MenuFeedback = sent
        ? { type: 'success', text: `已将${lbNameMap[lbType]}晒出到当前频道！` }
        : { type: 'error', text: '无法在当前频道发送公开消息，请检查机器人发言权限。' };
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'leaderboard', lbType, lbPage }, feedback),
      );
      return;
    }
  }

  if (section === 'modal') {
    const modalType = parts[2];
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      const fallbackView: MenuView =
        modalType === 'slots'
          ? { page: 'slots' }
          : modalType === 'dice'
            ? { page: 'dice', choice: parseDiceChoice(parts[3]) }
            : modalType === 'bj'
              ? { page: 'bj' }
              : modalType === 'bank_dep' || modalType === 'bank_wd'
                ? { page: 'bank' }
                : { page: 'multi' };
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, fallbackView, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    if (modalType === 'slots') {
      await interaction.showModal(
        buildAmountModal('menu:modal_sub:slots', '🎰 老虎机自定义下注', '下注金额（正整数）', '例如：200'),
      );
      return;
    }
    if (modalType === 'dice') {
      const choice = parseDiceChoice(parts[3]);
      await interaction.showModal(
        buildAmountModal(
          `menu:modal_sub:dice:${choice}`,
          '🎲 猜大小自定义下注',
          '下注金额（正整数）',
          '例如：200',
        ),
      );
      return;
    }
    if (modalType === 'bj') {
      await interaction.showModal(
        buildAmountModal('menu:modal_sub:bj', '🃏 二十一点自定义下注', '下注金额（正整数）', '例如：200'),
      );
      return;
    }
    if (modalType === 'bank_dep') {
      await interaction.showModal(
        buildAmountModal('menu:modal_sub:bank_dep', '📥 自定义存入银行', '存入金额（正整数）', '例如：500'),
      );
      return;
    }
    if (modalType === 'bank_wd') {
      await interaction.showModal(
        buildAmountModal('menu:modal_sub:bank_wd', '📤 自定义从银行取出', '取出金额（正整数）', '例如：500'),
      );
      return;
    }
    if (modalType === 'redpacket') {
      if (!interaction.channel?.isSendable()) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'multi' },
            { type: 'error', text: '当前频道不支持发送公开红包消息，请在普通文字频道中重试。' },
          ),
        );
        return;
      }
      await interaction.showModal(buildRedPacketModal());
    }
  }
}

export async function handleMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = getActor(interaction);
  const parts = interaction.customId.split(':');
  const section = parts[1];
  const selected = interaction.values[0];

  if (section === 'social_act') {
    const action = parseSocialAction(selected);
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'social', action }));
    return;
  }

  if (section === 'shop_buy') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'shop' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    const itemId = parsePositiveInt(selected ?? '');
    if (!itemId) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'shop' }, { type: 'error', text: '无效的商品编号。' }),
      );
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.shop.buyItem(guildId, actor.id, itemId);
    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '该商品不存在或已被管理员下架。',
        out_of_stock: '该商品已售罄。',
        insufficient_funds: `口袋现金不足！购买需要消耗口袋星币。`,
        already_owned: '你已经拥有该专属称号了，无需重复购买。',
      };
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'shop' }, { type: 'error', text: msgMap[res.reason] }),
      );
      return;
    }

    if (res.grantRoleId) {
      let member: GuildMember | null = null;
      if (interaction.inCachedGuild()) {
        member = interaction.member;
      } else if (interaction.guild) {
        member = await interaction.guild.members.fetch(actor.id).catch(() => null);
      }

      if (!member) {
        ctx.services.shop.refundRolePurchase(guildId, actor.id, res.item.id, res.item.price);
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'shop' },
            { type: 'error', text: '无法获取成员身份信息，已自动全额退款。' },
          ),
        );
        return;
      }

      try {
        await member.roles.add(res.grantRoleId, `购买商店商品 #${res.item.id}`);
      } catch {
        ctx.services.shop.refundRolePurchase(guildId, actor.id, res.item.id, res.item.price);
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'shop' },
            {
              type: 'error',
              text: '身份组发放失败（机器人权限不足或身份组层级过低），已自动全额退还星币与库存。',
            },
          ),
        );
        return;
      }
    }

    const detail = res.grantRoleId
      ? `已自动发放身份组 <@&${res.grantRoleId}>。`
      : res.equippedTitle
        ? `已解锁并自动佩戴称号 **「${res.equippedTitle}」**！`
        : '道具已放入你的背包，随时可切换到「🎒 背包与称号」激活使用！';

    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'shop' },
        {
          type: 'success',
          text: `购买成功：**${res.item.name}**（花费 ${cfg.currencyEmoji} ${res.item.price}）\n${detail} 剩余现金：**${res.balance}**。`,
        },
      ),
    );
    return;
  }

  if (section === 'bag_use') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'bag' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    const invId = parsePositiveInt(selected ?? '');
    if (!invId) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'bag' }, { type: 'error', text: '无效的背包道具编号。' }),
      );
      return;
    }

    const res = ctx.services.shop.useInventoryItem(guildId, actor.id, invId);
    if (!res.ok) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'bag' },
          { type: 'error', text: '未找到该道具或数量不足。' },
        ),
      );
      return;
    }

    const text =
      res.boostMultiplier && res.boostExpiresAt
        ? `⚡ 经验加成卡已激活！生效 **${res.boostMultiplier}x** 倍率，剩余 **${formatDurationZh(Math.max(0, res.boostExpiresAt - Date.now()))}**。`
        : res.equippedTitle
          ? `🏷️ 已将展示称号切换为 **「${res.equippedTitle}」**！`
          : '道具使用成功！';

    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'bag' }, { type: 'success', text }),
    );
  }
}

export async function handleMenuUserSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = getActor(interaction);
  const parts = interaction.customId.split(':');
  const actionType = parts[2];

  const targetId = interaction.values[0];
  if (!targetId) {
    return;
  }
  const targetUser = interaction.users.get(targetId) ?? interaction.users.first();

  if (actionType === 'rob') {
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'rob' },
          { type: 'error', text: '机器人没有钱包，换个真实群友试试吧！' },
        ),
      );
      return;
    }
    if (targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, { type: 'error', text: '不能打劫自己！' }),
      );
      return;
    }

    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.economy.rob(guildId, actor.id, targetId);
    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        self_target: '不能打劫自己！',
        cooldown: `打劫冷却中，请等待 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
        target_shielded: `<@${targetId}> 防盗护盾生效中，剩余 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
        target_too_poor: `<@${targetId}> 口袋现金不足 100 ${cfg.currencyName}，放过 TA 吧。`,
      };
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, { type: 'error', text: msgMap[res.reason] }),
      );
      return;
    }

    const broadcastSent = await sendPublicBroadcast(
      interaction,
      res.success
        ? {
            content: `🥷 <@${actor.id}> 抢了 <@${targetId}> **${res.amount}** ${cfg.currencyName}！`,
            embeds: [
              createSuccessEmbed(
                '🥷 频道快报：抢钱得手！',
                [
                  `<@${actor.id}> 从 <@${targetId}> 的口袋里抢走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
                  `受害者剩余现金：**${res.targetBalance}** ｜ 抢劫者当前现金：**${res.attackerBalance}**`,
                  `🛡️ <@${targetId}> 已自动触发防盗护盾（快把现金存进银行防偷吧！）`,
                ].join('\n'),
              ),
            ],
          }
        : {
            content: `🚨 <@${actor.id}> 抢 <@${targetId}> 翻车被抓，反赔了 **${res.amount}** ${cfg.currencyName}！`,
            embeds: [
              createErrorEmbed(
                '🚨 频道快报：抢钱翻车现场！',
                [
                  `<@${actor.id}> 企图打劫 <@${targetId}> 时翻车被抓，现场赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
                  `抢劫者当前现金：**${res.attackerBalance}** ｜ 受害者当前现金：**${res.targetBalance}**`,
                ].join('\n'),
              ),
            ],
          },
    );

    const warnSuffix = broadcastSent
      ? ''
      : '\n⚠️ 当前频道未能发出公开快报，请检查机器人发言权限。';

    const feedback: MenuFeedback = res.success
      ? {
          type: 'success',
          text: `🥷 打劫得手！从 <@${targetId}> 口袋顺走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}，你的现金：**${res.attackerBalance}**。${warnSuffix}`,
        }
      : {
          type: 'error',
          text: `🚨 打劫翻车被抓现行！向 <@${targetId}> 赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}，你的现金：**${res.attackerBalance}**。${warnSuffix}`,
        };

    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, feedback));
    return;
  }

  if (actionType === 'pay') {
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: '不能向机器人转账。' }),
      );
      return;
    }
    if (targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: '不能给自己转账！' }),
      );
      return;
    }
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    await interaction.showModal(
      buildAmountModal(
        `menu:modal_sub:pay:${targetId}`,
        '💸 向群友转账',
        '转账金额（正整数）',
        '例如：100',
      ),
    );
    return;
  }

  if (actionType === 'duel') {
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '机器人不会掷骰子，请选择一位真实群友决斗！' },
        ),
      );
      return;
    }
    if (targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: '不能向自己发起决斗！' }),
      );
      return;
    }
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    if (!interaction.channel?.isSendable()) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '当前频道不支持发送公开决斗卡片，请在普通文字频道中重试。' },
        ),
      );
      return;
    }

    await interaction.showModal(
      buildAmountModal(
        `menu:modal_sub:duel:${targetId}`,
        '⚔️ 发起骰子决斗',
        '决斗赌注（1 ~ 1,000,000 星币）',
        '例如：100',
      ),
    );
    return;
  }

  if (actionType === 'social') {
    const action = parseSocialAction(parts[3]);
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'social', action },
          { type: 'error', text: '机器人不懂得情感互动，选一位真实群友试试吧~' },
        ),
      );
      return;
    }
    if (targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'social', action },
          { type: 'error', text: '虽然自爱很好，但还是找一位群友互动吧~' },
        ),
      );
      return;
    }
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'fun', '娱乐互动');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'social', action },
          { type: 'error', text: disabledMsg },
        ),
      );
      return;
    }

    const res = ctx.services.fun.performInteraction(guildId, actor.id, targetId, action);
    const publicEmbed = new EmbedBuilder()
      .setColor(COLORS.FUN)
      .setDescription(
        `${res.emoji} <@${actor.id}> ${res.verbPhrase} <@${targetId}>！\n*（你们之间的「${res.label}」累计已达 **${res.count}** 次）*`,
      )
      .setTimestamp();
    await sendPublicBroadcast(interaction, {
      content: `${res.emoji} <@${actor.id}> ${res.verbPhrase} <@${targetId}>！`,
      embeds: [publicEmbed],
    });

    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'social', action },
        {
          type: 'success',
          text: `${res.emoji} 已对 <@${targetId}> 发起「${res.label}」（累计 **${res.count}** 次）！`,
        },
      ),
    );
  }
}

export async function handleMenuModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = getActor(interaction);
  const parts = interaction.customId.split(':');
  const modalType = parts[2];

  if (modalType === 'slots') {
    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'slots' }, { type: 'error', text: '请输入有效的正整数下注金额。' }),
      );
      return;
    }
    const out = runSlotsAction(ctx, guildId, actor, amount);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    await respondFromModal(interaction, out.msg);
    return;
  }

  if (modalType === 'dice') {
    const choice = parseDiceChoice(parts[3]);
    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'dice', choice },
          { type: 'error', text: '请输入有效的正整数下注金额。' },
        ),
      );
      return;
    }
    const out = runDiceAction(ctx, guildId, actor, choice, amount);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    await respondFromModal(interaction, out.msg);
    return;
  }

  if (modalType === 'bj') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'bj' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'bj' }, { type: 'error', text: '请输入有效的正整数下注金额。' }),
      );
      return;
    }
    const res = ctx.services.blackjack.startGame(guildId, actor.id, amount);
    const out = buildBlackjackResponse(ctx, guildId, actor, res);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    await respondFromModal(interaction, out.msg);
    return;
  }

  if (modalType === 'bank_dep' || modalType === 'bank_wd') {
    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text: '请输入有效的正整数金额。' }),
      );
      return;
    }
    await respondFromModal(
      interaction,
      runBankTransferAction(ctx, guildId, actor, modalType === 'bank_dep' ? 'deposit' : 'withdraw', amount),
    );
    return;
  }

  if (modalType === 'pay') {
    const targetId = parts[3];
    if (!targetId) return;

    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: '请输入有效的正整数转账金额。' }),
      );
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.economy.transferCoins(guildId, actor.id, targetId, amount);
    if (!res.ok) {
      const reasonMap: Record<typeof res.reason, string> = {
        self_target: '不能给自己转账。',
        invalid_amount: '转账金额无效。',
        insufficient_funds: `口袋现金不足，无法转出 **${amount}** ${cfg.currencyName}。`,
      };
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: reasonMap[res.reason] }),
      );
      return;
    }

    await sendPublicBroadcast(interaction, {
      content: `💸 <@${actor.id}> 给 <@${targetId}> 转账了 **${res.amount}** ${cfg.currencyName}！`,
      embeds: [
        createSuccessEmbed(
          '💸 群友转账通知',
          `<@${actor.id}> 向 <@${targetId}> 转出了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
        ),
      ],
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'pay' },
        {
          type: 'success',
          text: `已向 <@${targetId}> 转账 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！剩余现金：**${res.fromBalance}**。`,
        },
      ),
    );
    return;
  }

  if (modalType === 'duel') {
    const opponentId = parts[3];
    if (!opponentId) return;

    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    if (!interaction.channel?.isSendable()) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '当前频道不支持发送公开决斗卡片。' },
        ),
      );
      return;
    }

    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: '请输入有效的正整数赌注金额。' }),
      );
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.multiplayer.createDuel(
      guildId,
      interaction.channel.id,
      actor.id,
      opponentId,
      amount,
    );
    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        self_target: '不能向自己发起决斗！',
        invalid_bet: '决斗赌注必须在 1 ~ 1,000,000 之间。',
        insufficient_funds: `你的口袋现金不足以支付 **${amount}** ${cfg.currencyName} 赌注。`,
      };
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: msgMap[res.reason] }),
      );
      return;
    }

    try {
      await interaction.channel.send({
        content: `⚔️ <@${opponentId}>，你收到了一条骰子决斗挑战！`,
        ...buildDuelMessage(res.duel, cfg),
      });
    } catch {
      ctx.services.multiplayer.declineDuel(res.duel.id, actor.id);
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '在当前频道发送决斗卡片失败，请检查机器人发言权限。' },
        ),
      );
      return;
    }

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'duel' },
        {
          type: 'success',
          text: `已向 <@${opponentId}> 发起 **${amount}** ${cfg.currencyName} 的骰子决斗！等待对方点击应战。`,
        },
      ),
    );
    return;
  }

  if (modalType === 'redpacket') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'multi' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    if (!interaction.channel?.isSendable()) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'multi' },
          { type: 'error', text: '当前频道不支持发送公开红包消息，请在普通文字频道中重试。' },
        ),
      );
      return;
    }

    const totalAmount = parsePositiveInt(interaction.fields.getTextInputValue('totalAmount'));
    const totalCount = parsePositiveInt(interaction.fields.getTextInputValue('totalCount'));
    const greeting = interaction.fields.getTextInputValue('greeting').trim();

    if (!totalAmount || !totalCount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'multi' },
          { type: 'error', text: '红包总金额与份数必须为正整数（份数 2 ~ 20）。' },
        ),
      );
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.multiplayer.createRedPacket({
      guildId,
      channelId: interaction.channel.id,
      senderId: actor.id,
      totalAmount,
      totalCount,
      greeting,
    });

    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        invalid_count: '红包份数必须在 2 ~ 20 份之间。',
        invalid_amount: '红包总金额必须在 1 ~ 1,000,000 之间。',
        amount_too_small_for_count: '红包总金额不能小于红包份数（每份至少 1 星币）。',
        insufficient_funds: `你的口袋现金不足以包出 **${totalAmount}** ${cfg.currencyName} 的红包。`,
      };
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'multi' }, { type: 'error', text: msgMap[res.reason] }),
      );
      return;
    }

    try {
      const sentMsg = await interaction.channel.send({
        content: `🧧 <@${actor.id}> 发了一个 **${res.packet.totalAmount}** ${cfg.currencyName} 的拼手气红包（${res.packet.totalCount} 份），快来抢！`,
        ...buildRedPacketMessage(res.packet, [], null, cfg),
      });
      ctx.services.multiplayer.bindRedPacketMessage(res.packet.id, sentMsg.id);
    } catch {
      ctx.db.transaction(() => {
        const marked = ctx.repos.redPacket.markExpired(res.packet.id);
        if (marked) {
          ctx.repos.profile.addCoins(guildId, actor.id, res.packet.totalAmount);
        }
      })();
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'multi' },
          { type: 'error', text: '发送红包消息失败，请检查机器人发言与嵌入链接权限（星币已自动退回）。' },
        ),
      );
      return;
    }

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'multi' },
        {
          type: 'success',
          text: `🧧 拼手气红包已发出！总额 ${cfg.currencyEmoji} **${res.packet.totalAmount}** ${cfg.currencyName}（${res.packet.totalCount} 份），剩余现金：**${res.senderBalance}**。`,
        },
      ),
    );
  }
}
