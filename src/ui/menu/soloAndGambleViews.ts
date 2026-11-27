import { ButtonStyle, EmbedBuilder } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { evaluateHand, formatHand } from '../../services/blackjackService.js';
import { getDateKey, type DiceChoice } from '../../services/economyService.js';
import { COLORS, formatDurationZh } from '../embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  withFeedback,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuFeedback,
  type MenuView,
} from '../menuShared.js';
import { formatBlackjackDealerHand } from '../soloFormatters.js';

const DICE_CHOICE_LABELS: Record<DiceChoice, string> = {
  big: '大 (11~17点，1倍净利)',
  small: '小 (4~10点，1倍净利)',
  triple: '豹子 (三同点，10倍净利)',
};

export function buildSoloView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const today = getDateKey(nowMs, ctx.timezone);
  const fortuneToday = ctx.repos.fun.getFortune(guildId, actor.id, today);
  const activeBj = ctx.services.blackjack.getActiveGame(guildId, actor.id);
  const workRemainMs =
    profile.lastWorkAt > 0
      ? Math.max(0, profile.lastWorkAt + cfg.workCooldownSec * 1000 - nowMs)
      : 0;

  const description = [
    `${cfg.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.currencyName} ｜ 🏦 银行存款：**${profile.bankCoins}** ${cfg.currencyName}`,
    '',
    `• 📅 今日签到：${profile.lastDailyDate === today ? `已签到（连签 ${profile.dailyStreak} 天）` : '可领取'}`,
    `• 💼 打工冷却：${workRemainMs > 0 ? `还需 ${formatDurationZh(workRemainMs)}` : '准备就绪'}`,
    `• 🎴 今日运势：${fortuneToday ? `【${fortuneToday.luckTier}】宜 ${fortuneToday.goodFor}` : `尚未抽签（首抽送${cfg.currencyName}）`}`,
    `• 🃏 二十一点：${activeBj ? `对局进行中（当前下注 ${activeBj.bet}）` : '暂无进行中牌局'}`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 独立游玩`, iconURL: actor.avatarUrl })
    .setTitle('🎮 独立游玩中心')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 私密面板（普通操作仅自己可见；开出高倍大奖/豹子/Blackjack/大吉将自动全群播报）' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:act:daily:solo', '📅 每日签到', ButtonStyle.Success, profile.lastDailyDate === today),
        makeButton('menu:act:work:solo', '💼 立即打工', ButtonStyle.Secondary, workRemainMs > 0),
        makeButton('menu:act:fortune:solo', '🎴 今日运势', ButtonStyle.Secondary),
      ),
      buttonRow(
        makeButton('menu:nav:slots', '🎰 老虎机', ButtonStyle.Primary),
        makeButton('menu:nav:dice', '🎲 猜大小', ButtonStyle.Primary),
        makeButton('menu:nav:bj', '🃏 二十一点', ButtonStyle.Primary),
      ),
      buttonRow(
        makeButton('menu:nav:bank', '🏦 银行存/取钱', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 返回主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildSlotsView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);

  const description = [
    `${cfg.currencyEmoji} 当前口袋现金：**${profile.coins}** ${cfg.currencyName}`,
    '',
    '**赔率规则：**',
    '• `🧊 🧊 🧊` 三连：**100x** 冰冰冰超级返还',
    '• `7️⃣ 7️⃣ 7️⃣` 三连：**15x** 返还',
    '• `💎 💎 💎` 三连：**8x** 返还',
    '• 其它符号三连：**4x** 返还 ｜ 任意两连：**1.5x** 返还',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 幸运老虎机`, iconURL: actor.avatarUrl })
    .setTitle('🎰 幸运老虎机')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 私密小游戏（三连 4x 以上大奖将自动全群播报！）' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:slots:50', '🪙 50', ButtonStyle.Primary),
        makeButton('menu:slots:100', '🪙 100', ButtonStyle.Primary),
        makeButton('menu:slots:500', '🪙 500', ButtonStyle.Primary),
        makeButton('menu:modal:slots', '⌨️ 自定义下注', ButtonStyle.Success),
      ),
      buttonRow(
        makeButton('menu:nav:solo', '⬅️ 独立游玩', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildDiceView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  choice: DiceChoice,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);

  const description = [
    `${cfg.currencyEmoji} 当前口袋现金：**${profile.coins}** ${cfg.currencyName}`,
    `🎯 当前选中投注：**${DICE_CHOICE_LABELS[choice]}**`,
    '',
    '先在第一排选择投注方向，再点击第二排金额立即开骰！',
    '*（三颗骰子若开出豹子，则仅「押豹子」中奖，通杀大小）*',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 猜大小`, iconURL: actor.avatarUrl })
    .setTitle('🎲 骰子猜大小')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 私密小游戏（押中 10x 豹子将自动全群播报！）' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(
          'menu:dice_pick:big',
          '📈 押大 (1x)',
          choice === 'big' ? ButtonStyle.Primary : ButtonStyle.Secondary,
        ),
        makeButton(
          'menu:dice_pick:small',
          '📉 押小 (1x)',
          choice === 'small' ? ButtonStyle.Primary : ButtonStyle.Secondary,
        ),
        makeButton(
          'menu:dice_pick:triple',
          '🎯 押豹子 (10x)',
          choice === 'triple' ? ButtonStyle.Primary : ButtonStyle.Secondary,
        ),
      ),
      buttonRow(
        makeButton(`menu:dice_bet:${choice}:50`, '🎲 50', ButtonStyle.Success),
        makeButton(`menu:dice_bet:${choice}:100`, '🎲 100', ButtonStyle.Success),
        makeButton(`menu:dice_bet:${choice}:500`, '🎲 500', ButtonStyle.Success),
        makeButton(`menu:modal:dice:${choice}`, '⌨️ 自定义下注', ButtonStyle.Secondary),
      ),
      buttonRow(
        makeButton('menu:nav:solo', '⬅️ 独立游玩', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildBlackjackView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  view: Extract<MenuView, { page: 'bj' }>,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const activeGame = ctx.services.blackjack.getActiveGame(guildId, actor.id);
  const game = activeGame ?? view.finishedGame ?? null;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const displayBalance =
    activeGame === null && view.balanceAfterFinish !== undefined
      ? view.balanceAfterFinish
      : profile.coins;

  const isPlaying = game !== null && game.status === 'playing';
  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 二十一点`, iconURL: actor.avatarUrl })
    .setTitle('🃏 二十一点 (Blackjack)')
    .setFooter({ text: '🔒 私密牌局（抽牌过程仅自己可见，结束后公屏自动发送战报）' })
    .setTimestamp();

  if (game) {
    const playerEval = evaluateHand(game.playerHand);
    const dealerLine = formatBlackjackDealerHand(game.dealerHand, !isPlaying);

    embed.setDescription(
      withFeedback(
        `${cfg.currencyEmoji} 当前口袋现金：**${displayBalance}** ${cfg.currencyName} ｜ 本局下注：**${game.bet}**`,
        feedback,
      ),
    );
    embed.addFields(
      {
        name: '🧑 你的手牌',
        value: `${formatHand(game.playerHand)}（总计 **${playerEval.total}** 点）`,
      },
      {
        name: '🎩 庄家手牌',
        value: dealerLine,
      },
    );
  } else {
    embed.setDescription(
      withFeedback(
        [
          `${cfg.currencyEmoji} 当前口袋现金：**${displayBalance}** ${cfg.currencyName}`,
          '',
          '选择下方下注金额即可发牌开局！天胡 Blackjack 赔付 **2.5x**，普通胜利赔付 **2x**。',
        ].join('\n'),
        feedback,
      ),
    );
  }

  if (isPlaying && game) {
    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton('menu:bj:hit', '🃏 要牌', ButtonStyle.Primary),
          makeButton('menu:bj:stand', '✋ 停牌', ButtonStyle.Secondary),
          makeButton(
            'menu:bj:double',
            '💎 双倍下注',
            ButtonStyle.Success,
            !game.canDouble || game.playerHand.length !== 2 || displayBalance < game.bet,
          ),
        ),
        buttonRow(
          makeButton('menu:nav:solo', '⬅️ 独立游玩', ButtonStyle.Secondary),
          makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
        ),
      ],
    };
  }

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:bj_start:50', '🪙 下注 50', ButtonStyle.Primary),
        makeButton('menu:bj_start:100', '🪙 下注 100', ButtonStyle.Primary),
        makeButton('menu:bj_start:500', '🪙 下注 500', ButtonStyle.Primary),
        makeButton('menu:modal:bj', '⌨️ 自定义下注', ButtonStyle.Success),
      ),
      buttonRow(
        makeButton('menu:nav:solo', '⬅️ 独立游玩', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}
