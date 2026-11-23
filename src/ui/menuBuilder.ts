import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { EconomyConfig } from '../config/defaults.js';
import type { RedPacket, RedPacketClaim } from '../db/repositories/redPacketRepo.js';
import {
  evaluateHand,
  formatHand,
  type BlackjackGame,
} from '../services/blackjackService.js';
import { getDateKey, type DiceChoice } from '../services/economyService.js';
import type { InteractionAction } from '../services/funService.js';
import type { LeaderboardType } from '../services/levelingService.js';
import type { AcceptDuelResult, DuelChallenge } from '../services/multiplayerService.js';
import {
  COLORS,
  formatDurationZh,
  renderProgressBar,
  type AppContext,
} from './embeds.js';

export interface MenuActor {
  id: string;
  displayName: string;
  avatarUrl: string;
}

export interface MenuFeedback {
  type: 'success' | 'error' | 'info';
  text: string;
}

export type MenuView =
  | { page: 'home' }
  | { page: 'solo' }
  | { page: 'slots' }
  | { page: 'dice'; choice: DiceChoice }
  | { page: 'bj'; finishedGame?: BlackjackGame; balanceAfterFinish?: number }
  | { page: 'bank' }
  | { page: 'multi' }
  | { page: 'rob' }
  | { page: 'pay' }
  | { page: 'duel' }
  | { page: 'social'; action: InteractionAction }
  | { page: 'shop' }
  | { page: 'bag' }
  | { page: 'rank' }
  | { page: 'leaderboard'; lbType: LeaderboardType; lbPage: number };

export type MenuComponentRow =
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<StringSelectMenuBuilder>
  | ActionRowBuilder<UserSelectMenuBuilder>;

export interface BuiltMenuMessage {
  embeds: EmbedBuilder[];
  components: MenuComponentRow[];
}

export interface BuiltButtonMessage {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

export const SOCIAL_ACTIONS: ReadonlyArray<{
  value: InteractionAction;
  label: string;
  description: string;
}> = [
  { value: 'pat', label: '🫂 摸头', description: '轻轻摸摸群友的头' },
  { value: 'hug', label: '🤗 抱抱', description: '给群友一个大大的拥抱' },
  { value: 'cuddle', label: '🥰 贴贴', description: '开心地和群友贴贴' },
  { value: 'poke', label: '👉 戳一戳', description: '调皮地戳一戳群友' },
  { value: 'feed', label: '🍰 投喂', description: '投喂一块美味小蛋糕' },
  { value: 'snowball', label: '❄️ 丢雪球', description: '朝群友丢出一颗雪球' },
];

const DICE_CHOICE_LABELS: Record<DiceChoice, string> = {
  big: '大 (11~17点，1倍净利)',
  small: '小 (4~10点，1倍净利)',
  triple: '豹子 (三同点，10倍净利)',
};

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  if (maxLen <= 1) return text.slice(0, maxLen);
  return `${text.slice(0, maxLen - 1)}…`;
}

function makeButton(
  customId: string,
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary,
  disabled = false,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(truncateText(label, 80))
    .setStyle(style)
    .setDisabled(disabled);
}

function buttonRow(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

function resolveColor(defaultColor: number, feedback?: MenuFeedback): number {
  if (!feedback) return defaultColor;
  if (feedback.type === 'success') return COLORS.SUCCESS;
  if (feedback.type === 'error') return COLORS.ERROR;
  return defaultColor;
}

function withFeedback(description: string, feedback?: MenuFeedback): string {
  if (!feedback) return truncateText(description, 4096);
  const icon = feedback.type === 'success' ? '✅' : feedback.type === 'error' ? '❌' : 'ℹ️';
  const banner = feedback.text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return truncateText(`> **${icon} 操作提示**\n${banner}\n\n${description}`, 4096);
}

function formatRatePercent(rate: number): string {
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

export function buildLobbyMessage(guildName?: string): BuiltButtonMessage {
  const titlePrefix = guildName ? `${guildName} · ` : '';
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🎛️ ${titlePrefix}服务器互动大厅`)
    .setDescription(
      [
        '点击下方按钮即可打开**仅你自己可见**的一站式互动面板，无需记忆指令也不刷屏频道！',
        '',
        '• 🎮 **独立游玩**：每日签到、打工赚币、今日运势、老虎机、猜大小、二十一点',
        '• 👥 **多人互动**：偷钱打劫、群友转账、骰子决斗、拼手气红包、趣味互动',
        '• 🏦 **银行保险柜**：存钱防被偷，存款满额每日还能领利息',
        '• 🛒 **商店与名片**：购买身份组/称号/经验卡、查看等级进度与排行榜',
      ].join('\n'),
    )
    .setFooter({ text: '提示：也可随时发送斜杠指令 /菜单 打开个人面板' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(makeButton('menu:open', '🎛️ 打开我的互动菜单', ButtonStyle.Primary)),
    ],
  };
}

function buildHomeView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const rankData = ctx.services.leveling.getRankCardData(guildId, actor.id, nowMs);
  const profile = rankData.profile;
  const today = getDateKey(nowMs, ctx.timezone);
  const checkedInToday = profile.lastDailyDate === today;
  const fortuneToday = ctx.repos.fun.getFortune(guildId, actor.id, today);
  const workRemainMs =
    profile.lastWorkAt > 0
      ? Math.max(0, profile.lastWorkAt + cfg.economy.workCooldownSec * 1000 - nowMs)
      : 0;
  const shieldRemainMs = Math.max(0, profile.robShieldUntil - nowMs);
  const titleBadge = profile.equippedTitle ? `「${profile.equippedTitle}」` : '';
  const bar = renderProgressBar(rankData.progress.progressRatio, 12);
  const pct = Math.round(rankData.progress.progressRatio * 100);

  const description = [
    `🏅 **Lv.${rankData.progress.level}**（全服第 **#${rankData.rank}** / ${rankData.totalMembers} 名）`,
    `\`${bar}\` **${pct}%**（${rankData.progress.currentLevelXp} / ${rankData.progress.nextLevelXp} XP）`,
    '',
    `📅 每日签到：${checkedInToday ? `✅ 今日已签（连签 ${profile.dailyStreak} 天）` : '⏰ 今日未签到'}`,
    `💼 打工状态：${workRemainMs > 0 ? `⏳ 冷却剩余 ${formatDurationZh(workRemainMs)}` : '✅ 当前可打工'}`,
    `🎴 今日运势：${fortuneToday ? `🎋 【${fortuneToday.luckTier}】幸运数 ${fortuneToday.luckyNumber}` : '✨ 今日未抽签'}`,
    `🛡️ 防盗护盾：${shieldRemainMs > 0 ? `剩余 ${formatDurationZh(shieldRemainMs)}` : '未开启（现金可能被偷）'}`,
    '',
    '🔒 **仅自己可见**：银行存/取、领利息、日常签到/打工、单人小游戏（高倍大奖自动全群播报）、商店背包',
    '📢 **全群公开**：偷钱打劫、群友转账、骰子决斗、抢红包、趣味互动、名片/排行榜晒出',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({
      name: `${titleBadge}${actor.displayName} 的互动主菜单`,
      iconURL: actor.avatarUrl,
    })
    .setThumbnail(actor.avatarUrl)
    .setDescription(withFeedback(description, feedback))
    .addFields(
      {
        name: `${cfg.economy.currencyEmoji} 口袋现金`,
        value: `**${profile.coins}** ${cfg.economy.currencyName}`,
        inline: true,
      },
      {
        name: '🏦 银行存款',
        value: `**${profile.bankCoins}** ${cfg.economy.currencyName}`,
        inline: true,
      },
      {
        name: '💎 总资产',
        value: `**${profile.coins + profile.bankCoins}** ${cfg.economy.currencyName}`,
        inline: true,
      },
    )
    .setFooter({ text: '提示：私密面板仅自己可见；银行存款不会被偷且每日可领利息！' })
    .setTimestamp();

  const navRow = buttonRow(
    makeButton('menu:nav:solo', '🎮 独立游玩', ButtonStyle.Primary),
    makeButton('menu:nav:multi', '👥 多人互动', ButtonStyle.Primary),
    makeButton('menu:nav:bank', '🏦 银行存钱', ButtonStyle.Success),
    makeButton('menu:nav:shop', '🛒 商店背包', ButtonStyle.Secondary),
    makeButton('menu:nav:rank', '🏆 排行名片', ButtonStyle.Secondary),
  );

  const quickRow = buttonRow(
    makeButton('menu:act:daily', '📅 每日签到', ButtonStyle.Success),
    makeButton('menu:act:work', '💼 立即打工', ButtonStyle.Secondary),
    makeButton('menu:act:fortune', '🎴 今日运势', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🔄 刷新', ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [navRow, quickRow] };
}

function buildSoloView(
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
    `• 🎴 今日运势：${fortuneToday ? `【${fortuneToday.luckTier}】宜 ${fortuneToday.goodFor}` : '尚未抽签（首抽送星币）'}`,
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
        makeButton('menu:act:daily', '📅 每日签到', ButtonStyle.Success),
        makeButton('menu:act:work', '💼 立即打工', ButtonStyle.Secondary),
        makeButton('menu:act:fortune', '🎴 今日运势', ButtonStyle.Secondary),
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

function buildSlotsView(
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

function buildDiceView(
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

function buildBlackjackView(
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
    .setFooter({ text: '🔒 私密牌局（天胡 Blackjack 或净赢 ≥500 将自动全群播报！）' })
    .setTimestamp();

  if (game) {
    const playerEval = evaluateHand(game.playerHand);
    const dealerEval = evaluateHand(game.dealerHand);
    const dealerLine = isPlaying
      ? `\`${game.dealerHand[0]!.suit}${game.dealerHand[0]!.rank}\` \`🂠\``
      : `${formatHand(game.dealerHand)}（总计 **${dealerEval.total}** 点）`;

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
            !game.canDouble || game.playerHand.length !== 2,
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

function buildBankView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const today = getDateKey(nowMs, ctx.timezone);
  const interestClaimed = profile.lastBankInterestDate === today;
  const estimatedInterest =
    profile.bankCoins >= cfg.bankInterestMinDeposit
      ? Math.max(
          1,
          Math.min(cfg.bankInterestMax, Math.floor(profile.bankCoins * cfg.bankInterestRate)),
        )
      : 0;

  const interestStatus = interestClaimed
    ? '✅ 今日利息已领取'
    : profile.bankCoins >= cfg.bankInterestMinDeposit
      ? `✨ 今日可领预计 **+${estimatedInterest}** ${cfg.currencyName}`
      : `🔒 存款需满 **${cfg.bankInterestMinDeposit}** ${cfg.currencyName} 才能领息`;

  const description = [
    `• 日利率：**${formatRatePercent(cfg.bankInterestRate)}**（每日上限 **${cfg.bankInterestMax}** ${cfg.currencyName}，起息门槛 **${cfg.bankInterestMinDeposit}**）`,
    `• 利息状态：${interestStatus}`,
    '• 银行存款**绝对防偷**；游玩游戏、发红包、决斗、转账均使用**口袋现金**。',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 星币银行`, iconURL: actor.avatarUrl })
    .setTitle('🏦 银行保险柜')
    .setDescription(withFeedback(description, feedback))
    .addFields(
      {
        name: `${cfg.currencyEmoji} 口袋现金 (可被偷)`,
        value: `**${profile.coins}** ${cfg.currencyName}`,
        inline: true,
      },
      {
        name: '🏦 银行存款 (防偷安全)',
        value: `**${profile.bankCoins}** ${cfg.currencyName}`,
        inline: true,
      },
      {
        name: '💎 总资产',
        value: `**${profile.coins + profile.bankCoins}** ${cfg.currencyName}`,
        inline: true,
      },
    )
    .setFooter({ text: '🔒 银行私密操作（仅你自己可见，存取款与领息不会在频道刷屏）' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:bank:dep:25', '📥 存 25%', ButtonStyle.Success),
        makeButton('menu:bank:dep:50', '📥 存 50%', ButtonStyle.Success),
        makeButton('menu:bank:dep:all', '📥 全部存入', ButtonStyle.Success),
        makeButton('menu:modal:bank_dep', '⌨️ 自定义存入', ButtonStyle.Secondary),
      ),
      buttonRow(
        makeButton('menu:bank:wd:25', '📤 取 25%', ButtonStyle.Primary),
        makeButton('menu:bank:wd:50', '📤 取 50%', ButtonStyle.Primary),
        makeButton('menu:bank:wd:all', '📤 全部取出', ButtonStyle.Primary),
        makeButton('menu:modal:bank_wd', '⌨️ 自定义取出', ButtonStyle.Secondary),
      ),
      buttonRow(
        makeButton('menu:bank:interest', '💹 领取今日利息', ButtonStyle.Success),
        makeButton('menu:nav:solo', '🎮 独立游玩', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 返回主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildMultiView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const robRemainMs =
    profile.lastRobAt > 0
      ? Math.max(0, profile.lastRobAt + cfg.robCooldownSec * 1000 - nowMs)
      : 0;
  const shieldRemainMs = Math.max(0, profile.robShieldUntil - nowMs);

  const description = [
    `${cfg.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.currencyName} ｜ 🏦 银行存款：**${profile.bankCoins}** ${cfg.currencyName}`,
    `🥷 打劫冷却：${robRemainMs > 0 ? `还需 ${formatDurationZh(robRemainMs)}` : '✅ 可出手'} ｜ 🛡️ 个人护盾：${shieldRemainMs > 0 ? `剩余 ${formatDurationZh(shieldRemainMs)}` : '未开启'}`,
    '',
    '📢 **本页操作均为全群公开互动，结果将在当前频道播报，大家都能看到！**',
    '',
    '• **🥷 偷钱**：查看肥羊榜并选择群友偷取口袋现金（银行存款安全不可偷）',
    '• **💸 群友转账**：选中群友输入金额直接转账',
    '• **⚔️ 骰子决斗**：在当前频道发起公开 3 骰押注对战',
    '• **🧧 发拼手气红包**：在当前频道派发 2~20 份随机金额红包',
    '• **💕 趣味互动**：摸头、抱抱、贴贴、戳一戳、投喂、丢雪球',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 多人互动`, iconURL: actor.avatarUrl })
    .setTitle('👥 多人互动大厅')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 公开互动区：偷钱、转账、决斗、红包、趣味互动全群都看得到！' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:nav:rob', '🥷 偷钱', ButtonStyle.Danger),
        makeButton('menu:nav:pay', '💸 群友转账', ButtonStyle.Primary),
        makeButton('menu:nav:duel', '⚔️ 骰子决斗', ButtonStyle.Primary),
        makeButton('menu:modal:redpacket', '🧧 发拼手气红包', ButtonStyle.Success),
        makeButton('menu:nav:social:pat', '💕 趣味互动', ButtonStyle.Secondary),
      ),
      buttonRow(
        makeButton('menu:nav:bank', '🏦 存钱防偷', ButtonStyle.Secondary),
        makeButton('menu:rank:coins:1', '🏆 富豪榜', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 返回主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildRobView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const targets = ctx.repos.profile.listRobTargets(guildId, actor.id, 8);
  const robRemainMs =
    profile.lastRobAt > 0
      ? Math.max(0, profile.lastRobAt + cfg.robCooldownSec * 1000 - nowMs)
      : 0;

  const targetLines =
    targets.length > 0
      ? targets.map((t, idx) => {
          const shieldMs = Math.max(0, t.robShieldUntil - nowMs);
          const shieldText =
            shieldMs > 0 ? `🛡️ 护盾剩余 ${formatDurationZh(shieldMs)}` : '✅ 可下手';
          return `${idx + 1}. <@${t.userId}> — ${cfg.currencyEmoji} **${t.coins}** ${cfg.currencyName}（${shieldText}）`;
        })
      : ['当前暂无口袋现金 ≥ 100 的可下手目标。'];

  const description = [
    `${cfg.currencyEmoji} 你的口袋现金：**${profile.coins}** ${cfg.currencyName} ｜ 冷却状态：${robRemainMs > 0 ? `⏳ ${formatDurationZh(robRemainMs)}` : '✅ 可下手'}`,
    '💡 *仅可偷取对方「口袋现金」，存在银行保险柜中的存款绝对安全！*',
    '📢 *选中群友出手后，将在当前频道公开播报「谁抢了谁多少钱 / 翻车赔款」！*',
    '',
    '**🎯 肥羊榜（口袋现金前 8 名）：**',
    ...targetLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.ERROR, feedback))
    .setAuthor({ name: `${actor.displayName} · 偷钱打劫`, iconURL: actor.avatarUrl })
    .setTitle('🥷 偷钱与肥羊榜')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 公开互动：抢钱得手或翻车被抓都会在当前频道全群播报！' })
    .setTimestamp();

  const userSelectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:rob')
      .setPlaceholder('选择要偷钱的群友（选中即出手）...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  return {
    embeds: [embed],
    components: [
      userSelectRow,
      buttonRow(
        makeButton('menu:nav:rob', '🔄 刷新肥羊榜', ButtonStyle.Primary),
        makeButton('menu:nav:bank', '🏦 去存钱', ButtonStyle.Success),
        makeButton('menu:nav:multi', '⬅️ 多人互动', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildPayView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);

  const description = [
    `${cfg.currencyEmoji} 你的口袋现金：**${profile.coins}** ${cfg.currencyName}（银行存款：**${profile.bankCoins}**）`,
    '',
    '在下方选择收款群友后，将弹出金额输入框完成转账（转账成功后会在当前频道公开通知）。',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 群友转账`, iconURL: actor.avatarUrl })
    .setTitle('💸 群友转账')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 公开互动：转账完成后将在当前频道公开播报并 @双方' })
    .setTimestamp();

  const userSelectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:pay')
      .setPlaceholder('选择要转账的群友...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  return {
    embeds: [embed],
    components: [
      userSelectRow,
      buttonRow(
        makeButton('menu:nav:multi', '⬅️ 多人互动', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildDuelView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);

  const description = [
    `${cfg.currencyEmoji} 你的口袋现金：**${profile.coins}** ${cfg.currencyName}`,
    '',
    '**⚔️ 骰子决斗规则：**',
    '1. 选择一名群友并在弹窗中输入赌注金额（1 ~ 1,000,000）。',
    '2. 系统将在当前频道发送公开挑战卡片，对方需在 3 分钟内应战。',
    '3. 双方各掷 3 颗骰子比拼总点数，大者赢走全部赌注，平局不扣款！',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.WARNING, feedback))
    .setAuthor({ name: `${actor.displayName} · 骰子决斗`, iconURL: actor.avatarUrl })
    .setTitle('⚔️ 发起骰子决斗')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 公开互动：决斗邀请卡片与胜负结算均在当前频道公开展示' })
    .setTimestamp();

  const userSelectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:duel')
      .setPlaceholder('选择要发起骰子决斗的群友...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  return {
    embeds: [embed],
    components: [
      userSelectRow,
      buttonRow(
        makeButton('menu:nav:multi', '⬅️ 多人互动', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildSocialView(
  actor: MenuActor,
  action: InteractionAction,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const currentMeta = SOCIAL_ACTIONS.find((a) => a.value === action) ?? SOCIAL_ACTIONS[0]!;

  const description = [
    `当前已选动作：**${currentMeta.label}**`,
    '',
    '1. 在第一个下拉框中切换想要使用的互动动作。',
    '2. 在第二个群友选择器中选中对方，即可在频道发送趣味互动通知并累计次数！',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 趣味互动`, iconURL: actor.avatarUrl })
    .setTitle('💕 群友趣味互动')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 公开互动：选中对象后会在当前频道公开播报互动瞬间' })
    .setTimestamp();

  const actionRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu:social_act')
      .setPlaceholder('选择互动动作...')
      .addOptions(
        SOCIAL_ACTIONS.map((opt) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(opt.label, 100))
            .setValue(opt.value)
            .setDescription(truncateText(opt.description, 100))
            .setDefault(opt.value === currentMeta.value),
        ),
      ),
  );

  const userRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`menu:user:social:${currentMeta.value}`)
      .setPlaceholder('选择互动对象...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  return {
    embeds: [embed],
    components: [
      actionRow,
      userRow,
      buttonRow(
        makeButton('menu:nav:multi', '⬅️ 多人互动', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildShopView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const items = ctx.services.shop.listItems(guildId);
  const displayItems = items.slice(0, 25);

  const lines =
    displayItems.length > 0
      ? displayItems.map((item) => {
          const stockText = item.stock === null ? '无限' : `剩 ${item.stock}`;
          const typeTag =
            item.type === 'role'
              ? `身份组 <@&${item.roleId}>`
              : item.type === 'title'
                ? `称号「${item.titleText}」`
                : `经验卡 ${item.boostMultiplier ?? 1.5}x (${formatDurationZh((item.boostDurationSec ?? 3600) * 1000)})`;
          return `**#${item.id} ${truncateText(item.name, 40)}** — ${cfg.currencyEmoji} **${item.price}**（${stockText}）\n> ${typeTag}${item.description ? ` · ${truncateText(item.description, 60)}` : ''}`;
        })
      : ['商店目前还没有商品，请联系管理员使用 `/商店 上架*` 指令添加商品。'];

  if (items.length > 25) {
    lines.push(`\n*（共 ${items.length} 件商品，当前展示前 25 件）*`);
  }

  const description = [
    `${cfg.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.currencyName}`,
    '',
    ...lines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 服务器商店`, iconURL: actor.avatarUrl })
    .setTitle('🛒 服务器商店')
    .setDescription(withFeedback(description, feedback))
    .setTimestamp();

  const tabRow = buttonRow(
    makeButton('menu:nav:shop', '🛒 商店', ButtonStyle.Primary),
    makeButton('menu:nav:bag', '🎒 背包与称号', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  );

  if (displayItems.length === 0) {
    return { embeds: [embed], components: [tabRow] };
  }

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu:shop_buy')
      .setPlaceholder('选择要购买的商品...')
      .addOptions(
        displayItems.map((item) => {
          const stockTag = item.stock === null ? '无限' : `剩${item.stock}`;
          const typeDesc =
            item.type === 'role'
              ? '身份组奖励'
              : item.type === 'title'
                ? `称号「${item.titleText ?? item.name}」`
                : `经验卡 ${item.boostMultiplier ?? 1.5}x`;
          const rawDesc = item.description ? `${typeDesc} · ${item.description}` : `${typeDesc} · 库存:${stockTag}`;
          return new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(`#${item.id} ${item.name} (${item.price} ${cfg.currencyName})`, 100))
            .setValue(String(item.id))
            .setDescription(truncateText(rawDesc, 100));
        }),
      ),
  );

  return { embeds: [embed], components: [selectRow, tabRow] };
}

function buildBagView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const inventory = ctx.services.shop.listInventory(guildId, actor.id);
  const displayInv = inventory.slice(0, 25);

  const activeBoostText =
    profile.xpBoostExpiresAt > nowMs && profile.xpBoostMultiplier > 1
      ? `⚡ **${profile.xpBoostMultiplier}x** 生效中（剩余 ${formatDurationZh(profile.xpBoostExpiresAt - nowMs)}）`
      : '未激活';

  const invLines =
    displayInv.length > 0
      ? displayInv.map((item) => {
          const typeLabel = item.itemType === 'xp_boost' ? '经验加成卡' : '专属称号';
          return `• **#${item.id}** [${typeLabel}] **${truncateText(item.itemName, 40)}** × ${item.quantity}`;
        })
      : ['背包里暂时空空如也，去商店逛逛吧！'];

  if (inventory.length > 25) {
    invLines.push(`\n*（共 ${inventory.length} 项道具，当前展示前 25 项）*`);
  }

  const description = [
    `🏷️ 当前佩戴称号：${profile.equippedTitle ? `**「${profile.equippedTitle}」**` : '无'}`,
    `🚀 经验卡状态：${activeBoostText}`,
    '',
    '**🎒 背包道具列表：**',
    ...invLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 背包与称号`, iconURL: actor.avatarUrl })
    .setTitle('🎒 我的背包与称号')
    .setDescription(withFeedback(description, feedback))
    .setTimestamp();

  const tabButtons = [
    makeButton('menu:nav:shop', '🛒 商店', ButtonStyle.Secondary),
    makeButton('menu:nav:bag', '🎒 背包与称号', ButtonStyle.Primary),
  ];
  if (profile.equippedTitle) {
    tabButtons.push(makeButton('menu:bag:clear_title', '❌ 卸下称号', ButtonStyle.Danger));
  }
  tabButtons.push(makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary));
  const tabRow = buttonRow(...tabButtons);

  if (displayInv.length === 0) {
    return { embeds: [embed], components: [tabRow] };
  }

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu:bag_use')
      .setPlaceholder('选择要使用或佩戴的道具...')
      .addOptions(
        displayInv.map((inv) => {
          const desc =
            inv.itemType === 'xp_boost'
              ? '点击立即激活经验加成卡'
              : inv.itemType === 'title'
                ? '点击佩戴此专属称号'
                : '使用背包道具';
          return new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(`#${inv.id} ${inv.itemName} (×${inv.quantity})`, 100))
            .setValue(String(inv.id))
            .setDescription(desc);
        }),
      ),
  );

  return { embeds: [embed], components: [selectRow, tabRow] };
}

function createRankEmbed(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): EmbedBuilder {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const data = ctx.services.leveling.getRankCardData(guildId, actor.id, nowMs);
  const titleBadge = data.profile.equippedTitle ? `「${data.profile.equippedTitle}」` : '';
  const bar = renderProgressBar(data.progress.progressRatio, 14);
  const pct = Math.round(data.progress.progressRatio * 100);
  const boostText =
    data.activeBoostMultiplier > 1 && data.boostExpiresAt > nowMs
      ? `⚡ **${data.activeBoostMultiplier}x**（剩余 ${formatDurationZh(data.boostExpiresAt - nowMs)}）`
      : '未启用';

  return new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({
      name: `${titleBadge}${actor.displayName} 的等级名片`,
      iconURL: actor.avatarUrl,
    })
    .setThumbnail(actor.avatarUrl)
    .setDescription(
      withFeedback(
        `🏅 **Lv.${data.progress.level}** ｜ 全服第 **#${data.rank}** / ${data.totalMembers} 名\n\`${bar}\` **${pct}%**（${data.progress.currentLevelXp} / ${data.progress.nextLevelXp} XP，累计 ${data.profile.xp} XP）`,
        feedback,
      ),
    )
    .addFields(
      {
        name: `${cfg.currencyEmoji} 总资产`,
        value: `**${data.profile.coins + data.profile.bankCoins}** ${cfg.currencyName}\n（现金 ${data.profile.coins} / 银行 ${data.profile.bankCoins}）`,
        inline: true,
      },
      {
        name: '🔥 聊天热度 / 经验卡',
        value: `热度 **${data.heatMultiplier}x**（连击 ${data.profile.heatStreak}）\n经验卡：${boostText}`,
        inline: true,
      },
      {
        name: '💬 活跃统计',
        value: `有效发言 **${data.profile.messageCount}** 条 ｜ 语音挂机 **${data.profile.voiceMinutes}** 分钟`,
      },
    )
    .setTimestamp();
}

export function buildPublicRankEmbed(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  nowMs = Date.now(),
): EmbedBuilder {
  return createRankEmbed(ctx, guildId, actor, undefined, nowMs);
}

function buildRankView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const embed = createRankEmbed(ctx, guildId, actor, feedback, nowMs).setFooter({
    text: '🔒 当前仅自己可见；点击「📢 晒出我的名片」可发送到当前频道展示',
  });

  const row = buttonRow(
    makeButton('menu:nav:rank', '🪪 我的名片', ButtonStyle.Primary),
    makeButton('menu:rank:xp:1', '📈 经验榜', ButtonStyle.Secondary),
    makeButton('menu:rank:coins:1', '💰 富豪榜', ButtonStyle.Secondary),
    makeButton('menu:rank:invites:1', '📨 邀请榜', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  );

  const shareRow = buttonRow(
    makeButton('menu:share:rank', '📢 晒出我的名片', ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row, shareRow] };
}

function createLeaderboardEmbedAndMeta(
  ctx: AppContext,
  guildId: string,
  lbType: LeaderboardType,
  lbPage: number,
  feedback: MenuFeedback | undefined,
): { embed: EmbedBuilder; page: number; totalPages: number } {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.leveling.getLeaderboard(guildId, lbType, lbPage, 10);

  const titleMap: Record<LeaderboardType, string> = {
    xp: '📈 服务器等级经验排行榜',
    coins: `💰 服务器${cfg.currencyName}富豪榜`,
    invites: '📨 服务器邀请贡献排行榜',
  };

  const lines = res.items.map((item, idx) => {
    const rankNum = (res.page - 1) * 10 + idx + 1;
    const medal =
      rankNum === 1 ? '🥇' : rankNum === 2 ? '🥈' : rankNum === 3 ? '🥉' : `**#${rankNum}**`;
    const titleTag = item.equippedTitle ? `「${item.equippedTitle}」` : '';
    if (lbType === 'xp') {
      return `${medal} <@${item.userId}> ${titleTag} — Lv.**${item.secondaryValue}**（${item.primaryValue} XP）`;
    }
    if (lbType === 'coins') {
      return `${medal} <@${item.userId}> ${titleTag} — ${cfg.currencyEmoji} **${item.primaryValue}** ${cfg.currencyName}（银行 ${item.secondaryValue}）`;
    }
    return `${medal} <@${item.userId}> — 成功邀请 **${item.primaryValue}** 人`;
  });

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setTitle(titleMap[lbType])
    .setDescription(
      withFeedback(
        lines.length > 0 ? lines.join('\n') : '暂无上榜数据，快去频道活跃互动吧！',
        feedback,
      ),
    )
    .setFooter({ text: `第 ${res.page} / ${res.totalPages} 页 · 共 ${res.totalItems} 名成员` })
    .setTimestamp();

  return { embed, page: res.page, totalPages: res.totalPages };
}

export function buildPublicLeaderboardEmbed(
  ctx: AppContext,
  guildId: string,
  lbType: LeaderboardType,
  lbPage: number,
): EmbedBuilder {
  return createLeaderboardEmbedAndMeta(ctx, guildId, lbType, lbPage, undefined).embed;
}

function buildLeaderboardView(
  ctx: AppContext,
  guildId: string,
  lbType: LeaderboardType,
  lbPage: number,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const { embed, page, totalPages } = createLeaderboardEmbedAndMeta(
    ctx,
    guildId,
    lbType,
    lbPage,
    feedback,
  );

  const tabRow = buttonRow(
    makeButton('menu:nav:rank', '🪪 我的名片', ButtonStyle.Secondary),
    makeButton(
      'menu:rank:xp:1',
      '📈 经验榜',
      lbType === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary,
    ),
    makeButton(
      'menu:rank:coins:1',
      '💰 富豪榜',
      lbType === 'coins' ? ButtonStyle.Primary : ButtonStyle.Secondary,
    ),
    makeButton(
      'menu:rank:invites:1',
      '📨 邀请榜',
      lbType === 'invites' ? ButtonStyle.Primary : ButtonStyle.Secondary,
    ),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  );

  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  const pagerRow = buttonRow(
    makeButton(
      `menu:rank:${lbType}:${prevPage}:prev`,
      '⬅️ 上一页',
      ButtonStyle.Secondary,
      page <= 1,
    ),
    makeButton(
      `menu:rank:${lbType}:${nextPage}:next`,
      '➡️ 下一页',
      ButtonStyle.Secondary,
      page >= totalPages,
    ),
    makeButton(`menu:share:lb:${lbType}:${page}`, '📢 晒出排行榜', ButtonStyle.Success),
  );

  return { embeds: [embed], components: [tabRow, pagerRow] };
}

export function buildMenuMessage(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  view: MenuView,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  switch (view.page) {
    case 'home':
      return buildHomeView(ctx, guildId, actor, feedback, nowMs);
    case 'solo':
      return buildSoloView(ctx, guildId, actor, feedback, nowMs);
    case 'slots':
      return buildSlotsView(ctx, guildId, actor, feedback);
    case 'dice':
      return buildDiceView(ctx, guildId, actor, view.choice, feedback);
    case 'bj':
      return buildBlackjackView(ctx, guildId, actor, view, feedback);
    case 'bank':
      return buildBankView(ctx, guildId, actor, feedback, nowMs);
    case 'multi':
      return buildMultiView(ctx, guildId, actor, feedback, nowMs);
    case 'rob':
      return buildRobView(ctx, guildId, actor, feedback, nowMs);
    case 'pay':
      return buildPayView(ctx, guildId, actor, feedback);
    case 'duel':
      return buildDuelView(ctx, guildId, actor, feedback);
    case 'social':
      return buildSocialView(actor, view.action, feedback);
    case 'shop':
      return buildShopView(ctx, guildId, actor, feedback);
    case 'bag':
      return buildBagView(ctx, guildId, actor, feedback, nowMs);
    case 'rank':
      return buildRankView(ctx, guildId, actor, feedback, nowMs);
    case 'leaderboard':
      return buildLeaderboardView(ctx, guildId, view.lbType, view.lbPage, feedback);
  }
}

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
      : `🏆 胜者：<@${result.winnerId}> 赢得 ${economyCfg.currencyEmoji} **+${duel.bet}** ${economyCfg.currencyName}！`;

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

export function buildRedPacketMessage(
  packet: RedPacket,
  claims: readonly RedPacketClaim[],
  bestLuckUserId: string | null,
  economyCfg: EconomyConfig,
): BuiltButtonMessage {
  const claimLines = claims.map((c) => {
    const crown = packet.status === 'finished' && bestLuckUserId === c.userId ? '👑 ' : '• ';
    return `${crown}<@${c.userId}> 抢到了 ${economyCfg.currencyEmoji} **${c.amount}** ${economyCfg.currencyName}`;
  });

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
