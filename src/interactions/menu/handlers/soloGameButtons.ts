import type { MessageCreateOptions } from 'discord.js';
import { MAX_SOLO_GAMBLE_BET } from '../../../config/economyConstants.js';
import type { AppContext } from '../../../core/context.js';
import type { BlackjackActionResult, BlackjackGame } from '../../../services/blackjackService.js';
import type { DiceChoice } from '../../../services/economyService.js';
import { createSuccessEmbed, formatDurationZh } from '../../../ui/embeds.js';
import { buildMenuMessage } from '../../../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../../../ui/menuShared.js';
import { buildBlackjackPublicReportEmbed } from '../../../ui/soloFormatters.js';
import {
  checkModuleDisabled,
  parsePositiveInt,
  sendPublicBroadcast,
} from '../../menuHelpers.js';
import { dispatchByAction, type ActionRouteTable } from '../subRouter.js';
import {
  parseDiceChoice,
  updateButtonPage,
  type ActionWithHighlight,
  type MenuButtonContext,
} from './menuSharedModalsAndParsers.js';

export function buildBlackjackOutcomeFeedback(
  game: BlackjackGame,
  balance: number,
  currencyName: string,
): MenuFeedback {
  const net = game.payout - game.bet;
  switch (game.status) {
    case 'playing':
      return { type: 'info', text: '请选择你的操作：要牌、停牌或双倍下注（15 分钟未操作将自动退注）。' };
    case 'player_blackjack':
      return {
        type: 'success',
        text: `🎉 天胡 Blackjack！返还 **${game.payout}** ${currencyName}（净赚 **+${net}**），当前现金 **${balance}**。`,
      };
    case 'dealer_bust':
      return {
        type: 'success',
        text: `🎉 庄家爆牌！返还 **${game.payout}** ${currencyName}（净赚 **+${net}**），当前现金 **${balance}**。`,
      };
    case 'player_win':
      return {
        type: 'success',
        text: `🎉 你的点数更大！返还 **${game.payout}** ${currencyName}（净赚 **+${net}**），当前现金 **${balance}**。`,
      };
    case 'push':
      return {
        type: 'info',
        text: `🤝 双方平局！全额返还下注 **${game.payout}** ${currencyName}（净变动 **0**），当前现金 **${balance}**。`,
      };
    case 'player_bust':
      return {
        type: 'error',
        text: `💥 爆牌了（超过 21 点），庄家获胜（返还 **0**，净损 **${net}** ${currencyName}）。当前现金 **${balance}** ${currencyName}。`,
      };
    case 'dealer_win':
      return {
        type: 'error',
        text: `😔 庄家点数更大，本局失利（返还 **0**，净损 **${net}** ${currencyName}）。当前现金 **${balance}** ${currencyName}。`,
      };
  }
}

export function runSlotsAction(
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
  const res = ctx.services.economy.playSlots(
    guildId,
    actor.id,
    bet,
    Math.random,
    Date.now(),
    actor.hints,
  );
  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      invalid_bet: '下注金额无效，请输入大于 0 的整数。',
      bet_too_large: `单局下注不能超过 **${MAX_SOLO_GAMBLE_BET.toLocaleString('en-US')}** ${cfg.currencyName}。`,
      insufficient_funds: `口袋现金不足，无法下注 **${bet}** ${cfg.currencyName}。`,
      deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与博弈！',
    };
    return {
      msg: buildMenuMessage(ctx, guildId, actor, { page: 'slots' }, { type: 'error', text: msgMap[res.reason] }),
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
          content:
            res.multiplier >= 100
              ? `🧊 核爆级欧皇降临！<@${actor.id}> 在老虎机转出 ${reelDisplay}（${res.multiplier}x 冰冰冰大奖），狂赚 **+${res.netChange}** ${cfg.currencyName}！`
              : `🎰 欧皇降临！<@${actor.id}> 在老虎机转出 ${reelDisplay}（${res.multiplier}x），狂赚 **+${res.netChange}** ${cfg.currencyName}！`,
          embeds: [
            createSuccessEmbed(
              res.multiplier >= 100
                ? '🧊 频道核爆喜报：冰冰冰 100 倍超级大奖！'
                : '🎰 频道喜报：老虎机爆大奖！',
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

export function runDiceAction(
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
    const msgMap: Record<typeof res.reason, string> = {
      invalid_bet: '下注金额无效，请输入大于 0 的整数。',
      bet_too_large: `单局下注不能超过 **${MAX_SOLO_GAMBLE_BET.toLocaleString('en-US')}** ${cfg.currencyName}。`,
      insufficient_funds: `口袋现金不足，无法下注 **${bet}** ${cfg.currencyName}。`,
      deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与博弈！',
    };
    return {
      msg: buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'dice', choice },
        { type: 'error', text: msgMap[res.reason] },
      ),
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

export function buildBlackjackResponse(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  res: BlackjackActionResult,
): ActionWithHighlight {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  if (!res.ok) {
    const msgMap: Record<string, string> = {
      invalid_bet: '下注金额无效，请输入大于 0 的整数。',
      bet_too_large: `单局下注不能超过 **${MAX_SOLO_GAMBLE_BET.toLocaleString('en-US')}** ${cfg.currencyName}。`,
      insufficient_funds: '口袋现金不足！',
      game_already_active: '你还有一局未结束的二十一点，请先完成当前对局。',
      no_active_game: '当前没有进行中的牌局，请先下注开局。',
      cannot_double: '只能在首轮两张牌时双倍下注。',
      deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与博弈！',
    };
    return {
      msg: buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'bj' },
        { type: 'error', text: msgMap[res.reason] ?? '当前牌局操作失败，请重试。' },
      ),
    };
  }

  const feedback = buildBlackjackOutcomeFeedback(res.game, res.balance, cfg.currencyName);
  const view: MenuView =
    res.game.status === 'playing'
      ? { page: 'bj' }
      : { page: 'bj', finishedGame: res.game, balanceAfterFinish: res.balance };

  const highlight: MessageCreateOptions | undefined =
    res.game.status !== 'playing'
      ? {
          embeds: [
            buildBlackjackPublicReportEmbed({
              playerId: actor.id,
              playerDisplayName: actor.displayName,
              playerAvatarUrl: actor.avatarUrl,
              game: res.game,
              cfg,
            }),
          ],
        }
      : undefined;

  return {
    msg: buildMenuMessage(ctx, guildId, actor, view, feedback),
    highlight,
  };
}

async function handleSoloActButton(input: MenuButtonContext): Promise<boolean> {
  const { interaction, ctx, guildId, actor, parts } = input;
  const action = parts[2];
  const sourcePage: 'home' | 'solo' = parts[3] === 'solo' ? 'solo' : 'home';
  const view: MenuView = { page: sourcePage };

  if (action === 'daily') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await updateButtonPage(input, view, { type: 'error', text: disabledMsg });
      return true;
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
    await updateButtonPage(input, view, feedback);
    return true;
  }

  if (action === 'work') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await updateButtonPage(input, view, { type: 'error', text: disabledMsg });
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.economy.work(guildId, actor.id);
    const feedback: MenuFeedback = res.ok
      ? {
          type: 'success',
          text: `你${res.story}，赚取了 ${cfg.currencyEmoji} **+${res.reward}** ${cfg.currencyName}！${res.cursed ? '\n🧿 *（你中了衰神符诅咒，本次打工收益已减半！）*' : ''}`,
        }
      : {
          type: 'error',
          text: `打工冷却中，还需等待 **${formatDurationZh(res.retryAfterSec * 1000)}**。`,
        };
    await updateButtonPage(input, view, feedback);
    return true;
  }

  if (action === 'fortune') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'fun', '娱乐互动');
    if (disabledMsg) {
      await updateButtonPage(input, view, { type: 'error', text: disabledMsg });
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.fun.drawDailyFortune(guildId, actor.id);
    const feedback: MenuFeedback = {
      type: res.alreadyDrawn ? 'info' : 'success',
      text: [
        `🎋 今日运势：**【${res.record.luckTier}】**${res.alreadyDrawn ? '（今日已抽签）' : ` · 首抽获赠 ${cfg.currencyEmoji} **+${res.record.bonusCoins}** ${cfg.currencyName}！`}`,
        `🟢 宜：${res.record.goodFor} ｜ 🔴 忌：${res.record.avoid} ｜ 🔢 幸运数字：**${res.record.luckyNumber}**`,
      ].join('\n'),
    };
    await updateButtonPage(input, view, feedback);
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
    return true;
  }

  return false;
}

const SOLO_BUTTON_ROUTES: ActionRouteTable<MenuButtonContext> = {
  exact: {
    act: handleSoloActButton,
    slots: async (input) => {
      const bet = parsePositiveInt(input.parts[2] ?? '') ?? 0;
      const out = runSlotsAction(input.ctx, input.guildId, input.actor, bet);
      await input.interaction.update(out.msg);
      if (out.highlight) {
        await sendPublicBroadcast(input.interaction, out.highlight);
      }
    },
    dice_pick: async (input) => {
      const disabledMsg = checkModuleDisabled(input.ctx, input.guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await updateButtonPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
        return;
      }
      const choice = parseDiceChoice(input.parts[2]);
      await updateButtonPage(input, { page: 'dice', choice });
    },
    dice_bet: async (input) => {
      const choice = parseDiceChoice(input.parts[2]);
      const bet = parsePositiveInt(input.parts[3] ?? '') ?? 0;
      const out = runDiceAction(input.ctx, input.guildId, input.actor, choice, bet);
      await input.interaction.update(out.msg);
      if (out.highlight) {
        await sendPublicBroadcast(input.interaction, out.highlight);
      }
    },
    bj_start: async (input) => {
      const disabledMsg = checkModuleDisabled(input.ctx, input.guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await updateButtonPage(input, { page: 'bj' }, { type: 'error', text: disabledMsg });
        return;
      }
      const bet = parsePositiveInt(input.parts[2] ?? '') ?? 0;
      const res = input.ctx.services.blackjack.startGame(input.guildId, input.actor.id, bet);
      const out = buildBlackjackResponse(input.ctx, input.guildId, input.actor, res);
      await input.interaction.update(out.msg);
      if (out.highlight) {
        await sendPublicBroadcast(input.interaction, out.highlight);
      }
    },
    bj: async (input) => {
      const disabledMsg = checkModuleDisabled(input.ctx, input.guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await updateButtonPage(input, { page: 'bj' }, { type: 'error', text: disabledMsg });
        return;
      }
      const action = input.parts[2];
      const res =
        action === 'hit'
          ? input.ctx.services.blackjack.hit(input.guildId, input.actor.id)
          : action === 'double'
            ? input.ctx.services.blackjack.doubleDown(input.guildId, input.actor.id)
            : input.ctx.services.blackjack.stand(input.guildId, input.actor.id);
      const out = buildBlackjackResponse(input.ctx, input.guildId, input.actor, res);
      await input.interaction.update(out.msg);
      if (out.highlight) {
        await sendPublicBroadcast(input.interaction, out.highlight);
      }
    },
  },
};

export async function tryHandleSoloGameButton(input: MenuButtonContext): Promise<boolean> {
  return dispatchByAction(input.parts[1], input, SOLO_BUTTON_ROUTES);
}
