import {
  ActionRowBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { EconomyConfig, ModuleKey } from '../config/defaults.js';
import {
  BANK_ROB_ATTACKER_MIN_ASSETS,
  BANK_ROB_FINE_RATE,
  BANK_ROB_STEAL_MAX,
  BANK_ROB_STEAL_MAX_RATE,
  BANK_ROB_STEAL_MIN_RATE,
  BANK_ROB_TARGET_MIN,
  BANK_ROB_TRAP_FINE_MAX,
  BANK_ROB_TRAP_FINE_RATE,
  ROB_ATTACKER_MIN_ASSETS,
  ROB_FINE_MAX,
  ROB_FINE_RATE,
  ROB_STEAL_MAX_AMOUNT,
  ROB_STEAL_MAX_RATE,
  ROB_STEAL_MIN_RATE,
  ROB_TARGET_MIN_COINS,
  ROB_TRAP_FINE_MAX,
  ROB_TRAP_FINE_RATE,
} from '../config/economyConstants.js';
import type { RedPacket, RedPacketClaim } from '../db/repositories/redPacketRepo.js';
import {
  evaluateHand,
  formatHand,
} from '../services/blackjackService.js';
import { getDateKey, type DiceChoice } from '../services/economyService.js';
import type { InteractionAction } from '../services/funService.js';
import { parseCardColor, type LeaderboardType } from '../services/levelingService.js';
import type { AcceptDuelResult, DuelChallenge } from '../services/multiplayerService.js';
import { PET_SPECIES_MAP } from '../services/socialPetService.js';
import {
  buildAdminLvlRewardsView,
  buildAdminMonitorView,
  buildAdminRolesView,
  buildAdminShopView,
  buildSelfRolesView,
} from './adminConfigMenuBuilder.js';
import { buildAdminAiView } from './aiAdminMenuBuilder.js';
import {
  buildBountyView,
  buildBombView,
  buildPropsView,
  buildRouletteView,
} from './chaosMenuBuilder.js';
import {
  buildCreditView,
  buildHustleView,
  buildLoanView,
} from './creditLoanMenuBuilder.js';
import {
  buildRpgHomeView,
  buildRpgRunView,
} from './rpgMenuBuilder.js';
import {
  COLORS,
  formatDurationZh,
  renderProgressBar,
  type AppContext,
} from './embeds.js';
import {
  buttonRow,
  formatInventoryTypeLabel,
  formatRatePercent,
  formatShopItemTag,
  makeButton,
  MENU_SELECT_PAGE_SIZE,
  paginateSlice,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
  type MenuView,
} from './menuShared.js';
import {
  buildCpLeaderboardView,
  buildCpView,
  buildPetArenaView,
  buildPetsView,
  buildSocialHubView,
} from './socialPetMenuBuilder.js';
import {
  buildEventsHubView,
  buildPredDetailView,
  buildPredictionsListView,
  buildWorldStatusView,
} from './worldEventMenuBuilder.js';
import { formatBlackjackDealerHand } from './soloFormatters.js';

export {
  truncateText,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
  type MenuView,
};

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
        '• ⚔️ **西幻 RPG 冒险**：4 大职业、6 大地下城 Roguelike 闯关、装备强化与宠物协同助战',
        '• 💳 **银行借贷与卖屁股**：存钱降险领息、信用分权益、银行信用贷/黑市高利贷、24h 卖屁股与老赖通缉',
        '• 👥 **多人博弈与吃瓜事件**：偷钱劫金库、转账、决斗、红包、黑市道具、悬赏、轮盘、数字炸弹、吃瓜开盘、天降宝箱与世界 Boss',
        '• 💞 **关系宠物与商店榜单**：结婚/结拜 CP、盲盒宠物斗兽场、商店背包与全服 12 大排行榜',
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
  const creditProfile = ctx.services.creditLoan.getCreditProfile(guildId, actor.id, nowMs);
  const deadbeatAlert =
    creditProfile.overdueLoans.length > 0
      ? ` ｜ 🚨 **失信老赖（逾期欠款 ${creditProfile.totalOverdueDebt.toLocaleString()}，禁赌禁转账）**`
      : '';

  const description = [
    `🏅 **Lv.${rankData.progress.level}**（全服第 **#${rankData.rank}** / ${rankData.totalMembers} 名）`,
    `\`${bar}\` **${pct}%**（${rankData.progress.currentLevelXp} / ${rankData.progress.nextLevelXp} XP）`,
    `📜 信用档案：**${creditProfile.account.score}** 分（${creditProfile.tier.label}）${deadbeatAlert}`,
    '',
    `📅 每日签到：${checkedInToday ? `✅ 今日已签（连签 ${profile.dailyStreak} 天）` : '⏰ 今日未签到'}`,
    `💼 打工状态：${workRemainMs > 0 ? `⏳ 冷却剩余 ${formatDurationZh(workRemainMs)}` : '✅ 当前可打工'}`,
    `🎴 今日运势：${fortuneToday ? `🎋 【${fortuneToday.luckTier}】幸运数 ${fortuneToday.luckyNumber}` : '✨ 今日未抽签'}`,
    `🛡️ 防盗护盾：${shieldRemainMs > 0 ? `剩余 ${formatDurationZh(shieldRemainMs)}` : '未开启（现金可能被偷）'}`,
    '',
    '🔒 **仅自己可见**：银行借贷、日常签到/打工、单人小游戏、西幻 RPG 探险、商店背包',
    '📢 **全群公开**：偷钱打劫、群友转账、骰子决斗、抢红包、卖屁股播报、名片/排行榜晒出',
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
    .setFooter({ text: '提示：私密面板仅自己可见；银行存款更安全（被劫率极低）且每日可领利息！' })
    .setTimestamp();

  const navRow = buttonRow(
    makeButton('menu:nav:solo', '🎮 独立游玩', ButtonStyle.Primary),
    makeButton('menu:nav:multi', '👥 多人博弈', ButtonStyle.Primary),
    makeButton('menu:nav:events', '🎯 吃瓜事件', ButtonStyle.Primary),
    makeButton('menu:nav:social_hub', '💞 关系宠物', ButtonStyle.Primary),
    makeButton('menu:nav:bank', '🏦 银行与借贷', ButtonStyle.Success),
  );

  const quickButtons = [
    makeButton('menu:act:daily:home', '📅 每日签到', ButtonStyle.Success, checkedInToday),
    makeButton('menu:act:work:home', '💼 立即打工', ButtonStyle.Secondary, workRemainMs > 0),
    makeButton('menu:act:fortune:home', '🎴 今日运势', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🔄 刷新', ButtonStyle.Secondary),
  ];
  if (actor.isAdmin) {
    quickButtons.push(makeButton('menu:nav:admin', '⚙️ 管理后台', ButtonStyle.Danger));
  }
  const quickRow = buttonRow(...quickButtons);

  const extraRow = buttonRow(
    makeButton('menu:nav:rpg', '⚔️ 西幻冒险', ButtonStyle.Primary),
    makeButton('menu:nav:hustle', '🍑 卖屁股', ButtonStyle.Danger),
    makeButton('menu:nav:shop', '🛒 商店与黑市', ButtonStyle.Secondary),
    makeButton('menu:nav:rank', '🏆 排行名片', ButtonStyle.Secondary),
    makeButton('menu:nav:self_roles', '🎭 自助身份组', ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [navRow, quickRow, extraRow] };
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

function buildBankView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const creditProfile = ctx.services.creditLoan.getCreditProfile(guildId, actor.id, nowMs);
  const effectiveInterestCap = Math.max(
    1,
    Math.round(cfg.bankInterestMax * creditProfile.tier.bankInterestCapMult),
  );
  const today = getDateKey(nowMs, ctx.timezone);
  const interestClaimed = profile.lastBankInterestDate === today;
  const estimatedInterest =
    profile.bankCoins >= cfg.bankInterestMinDeposit
      ? Math.max(
          1,
          Math.min(effectiveInterestCap, Math.floor(profile.bankCoins * cfg.bankInterestRate)),
        )
      : 0;

  const interestStatus = interestClaimed
    ? '✅ 今日利息已领取'
    : profile.bankCoins >= cfg.bankInterestMinDeposit
      ? `✨ 今日可领预计 **+${estimatedInterest}** ${cfg.currencyName}`
      : `🔒 存款需满 **${cfg.bankInterestMinDeposit}** ${cfg.currencyName} 才能领息`;

  const debtLine =
    creditProfile.totalDebt > 0
      ? `💳 **在途贷款**：共 **${creditProfile.openLoans.length}** 笔，待还 **${creditProfile.totalDebt.toLocaleString()}** ${cfg.currencyName}${creditProfile.totalOverdueDebt > 0 ? `（🚨 含逾期 **${creditProfile.totalOverdueDebt.toLocaleString()}**）` : ''}`
      : '💳 **在途贷款**：当前无欠款，信用记录良好';

  const description = [
    `• 日利率：**${formatRatePercent(cfg.bankInterestRate)}**（基础上限 **${cfg.bankInterestMax}** × 信用倍率 **${creditProfile.tier.bankInterestCapMult}x** = **${effectiveInterestCap}** ${cfg.currencyName}，起息门槛 **${cfg.bankInterestMinDeposit}**）`,
    `• 利息状态：${interestStatus}`,
    `• 📜 信用评级：**${creditProfile.account.score}** 分（${creditProfile.tier.label}）`,
    `• ${debtLine}`,
    `• 银行金库有重兵把守（强抢成功率仅 **${formatRatePercent(cfg.robBankSuccessRate)}**，得手仅刮走 **${formatRatePercent(BANK_ROB_STEAL_MIN_RATE)}~${formatRatePercent(BANK_ROB_STEAL_MAX_RATE)}** 封顶 **${BANK_ROB_STEAL_MAX.toLocaleString('en-US')}**，翻车高额重罚）；游玩游戏、发红包、决斗、转账均使用**口袋现金**。`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · ${cfg.currencyName}银行`, iconURL: actor.avatarUrl })
    .setTitle('🏦 银行保险柜')
    .setDescription(withFeedback(description, feedback))
    .addFields(
      {
        name: `${cfg.currencyEmoji} 口袋现金 (易被偷)`,
        value: `**${profile.coins}** ${cfg.currencyName}`,
        inline: true,
      },
      {
        name: '🏦 银行金库 (低概率被劫)',
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

  const canDeposit = profile.coins > 0;
  const canWithdraw = profile.bankCoins > 0;
  const canClaimInterest = !interestClaimed && profile.bankCoins >= cfg.bankInterestMinDeposit;

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:bank:dep:25', '📥 存 25%', ButtonStyle.Success, Math.floor(profile.coins * 0.25) < 1),
        makeButton('menu:bank:dep:50', '📥 存 50%', ButtonStyle.Success, Math.floor(profile.coins * 0.5) < 1),
        makeButton('menu:bank:dep:all', '📥 全部存入', ButtonStyle.Success, !canDeposit),
        makeButton('menu:modal:bank_dep', '⌨️ 自定义存入', ButtonStyle.Secondary, !canDeposit),
      ),
      buttonRow(
        makeButton('menu:bank:wd:25', '📤 取 25%', ButtonStyle.Primary, Math.floor(profile.bankCoins * 0.25) < 1),
        makeButton('menu:bank:wd:50', '📤 取 50%', ButtonStyle.Primary, Math.floor(profile.bankCoins * 0.5) < 1),
        makeButton('menu:bank:wd:all', '📤 全部取出', ButtonStyle.Primary, !canWithdraw),
        makeButton('menu:modal:bank_wd', '⌨️ 自定义取出', ButtonStyle.Secondary, !canWithdraw),
      ),
      buttonRow(
        makeButton('menu:bank:interest', '💹 领取今日利息', ButtonStyle.Success, !canClaimInterest),
        makeButton('menu:nav:loan', '💳 信用贷款中心', ButtonStyle.Primary),
        makeButton('menu:nav:credit', '📜 我的信用档案', ButtonStyle.Secondary),
        makeButton('menu:nav:solo', '🎮 独立游玩', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
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
    '• **🥷 偷钱 / 劫金库**：既可顺走群友口袋现金，也能高风险强抢银行金库',
    '• **💸 群友转账**：选中群友输入金额直接转账',
    '• **⚔️ 骰子决斗**：在当前频道发起公开 3 骰押注对战（最高 10 亿）',
    '• **🧧 发拼手气红包**：在当前频道派发 2~100 份随机金额红包（最高 10 亿）',
    '• **💕 趣味互动**：摸头、抱抱、贴贴、戳一戳、投喂、丢雪球',
    '• **🧰 黑市道具**：捕兽夹反抓小偷、万能撬锁、防盗盾、衰神符、改昵称卡',
    '• **🎯 悬赏通缉**：多人叠加悬赏，成功偷钱或决斗胜出即独吞全额赏金',
    '• **🔫 俄罗斯轮盘 & 💣 数字炸弹**：2~6人吃鸡局、频道抢猜踩雷分罚金',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 多人博弈`, iconURL: actor.avatarUrl })
    .setTitle('👥 多人互动与整蛊博弈大厅')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 公开互动区：偷钱、转账、决斗、红包、悬赏、轮盘、炸弹全群都能看到！' })
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
        makeButton('menu:nav:props', '🧰 黑市道具', ButtonStyle.Danger),
        makeButton('menu:nav:bounty', '🎯 悬赏通缉', ButtonStyle.Primary),
        makeButton('menu:nav:roulette', '🔫 俄罗斯轮盘', ButtonStyle.Danger),
        makeButton('menu:nav:bomb', '💣 数字炸弹', ButtonStyle.Primary),
      ),
      buttonRow(
        makeButton('menu:nav:bank', '🏦 银行存取', ButtonStyle.Secondary),
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
  const targets = ctx.repos.profile.listRobTargets(guildId, actor.id, 6);
  const bankTargets = ctx.repos.profile.listBankRobTargets(guildId, actor.id, 6);
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
      : [`当前暂无口袋现金 ≥ ${ROB_TARGET_MIN_COINS} ${cfg.currencyName}的可下手目标。`];

  const bankTargetLines =
    bankTargets.length > 0
      ? bankTargets.map((t, idx) => {
          const shieldMs = Math.max(0, t.robShieldUntil - nowMs);
          const shieldText =
            shieldMs > 0 ? `🛡️ 护盾剩余 ${formatDurationZh(shieldMs)}` : '🏦 可强攻';
          return `${idx + 1}. <@${t.userId}> — 🏦 **${t.bankCoins}** ${cfg.currencyName}（${shieldText}）`;
        })
      : [`当前暂无银行存款 ≥ ${BANK_ROB_TARGET_MIN} ${cfg.currencyName}的金库目标。`];

  const description = [
    `${cfg.currencyEmoji} 你的口袋现金：**${profile.coins}** ｜ 🏦 银行存款：**${profile.bankCoins}** ｜ 冷却：${robRemainMs > 0 ? `⏳ ${formatDurationZh(robRemainMs)}` : '✅ 可下手'}`,
    `• **🥷 偷口袋现金**：成功率 **${formatRatePercent(cfg.robSuccessRate)}**（需自身总资产≥${ROB_ATTACKER_MIN_ASSETS}、目标现金≥${ROB_TARGET_MIN_COINS}；可偷 ${formatRatePercent(ROB_STEAL_MIN_RATE)}~${formatRatePercent(ROB_STEAL_MAX_RATE)} 上限 ${ROB_STEAL_MAX_AMOUNT.toLocaleString('en-US')}；失败罚 ${formatRatePercent(ROB_FINE_RATE)} 最高 ${ROB_FINE_MAX}，踩夹罚 ${formatRatePercent(ROB_TRAP_FINE_RATE)} 最高 ${ROB_TRAP_FINE_MAX.toLocaleString('en-US')}）`,
    `• **🏦 强抢银行金库**：成功率仅 **${formatRatePercent(cfg.robBankSuccessRate)}**（需自身总资产≥${BANK_ROB_ATTACKER_MIN_ASSETS}、目标存款≥${BANK_ROB_TARGET_MIN}；得手刮走 ${formatRatePercent(BANK_ROB_STEAL_MIN_RATE)}~${formatRatePercent(BANK_ROB_STEAL_MAX_RATE)} 封顶 ${BANK_ROB_STEAL_MAX.toLocaleString('en-US')}；失败重罚 ${formatRatePercent(BANK_ROB_FINE_RATE)}~${formatRatePercent(BANK_ROB_TRAP_FINE_RATE)} 最高 ${BANK_ROB_TRAP_FINE_MAX.toLocaleString('en-US')}，现金不够扣银行存款！）`,
    '',
    '**🎯 口袋肥羊榜（现金前 6 名）：**',
    ...targetLines,
    '',
    '**🏦 银行金库榜（存款前 6 名）：**',
    ...bankTargetLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.ERROR, feedback))
    .setAuthor({ name: `${actor.displayName} · 偷钱与劫金库`, iconURL: actor.avatarUrl })
    .setTitle('🥷 偷口袋现金 & 🏦 强抢银行金库')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 公开互动：无论偷口袋还是抢银行金库，得手或翻车被抓都会在当前频道全群播报！' })
    .setTimestamp();

  const userSelectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:rob')
      .setPlaceholder(`🥷 选择群友偷取「口袋现金」（成功率 ${formatRatePercent(cfg.robSuccessRate)}）...`)
      .setMinValues(1)
      .setMaxValues(1),
  );

  const bankSelectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:rob_bank')
      .setPlaceholder(`🏦 选择群友强抢「银行金库」（成功率 ${formatRatePercent(cfg.robBankSuccessRate)} · 高风险高赔款）...`)
      .setMinValues(1)
      .setMaxValues(1),
  );

  return {
    embeds: [embed],
    components: [
      userSelectRow,
      bankSelectRow,
      buttonRow(
        makeButton('menu:nav:rob', '🔄 刷新榜单', ButtonStyle.Primary),
        makeButton('menu:nav:bank', '🏦 银行存取', ButtonStyle.Success),
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
    '1. 选择一名群友并在弹窗中输入赌注金额（1 ~ 1,000,000,000）。',
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
  nowMs: number,
  listPage?: number,
): BuiltMenuMessage {
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const cfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const items = ctx.services.shop.listItems(guildId);
  const { slice: displayItems, page, totalPages } = paginateSlice(
    items,
    listPage,
    MENU_SELECT_PAGE_SIZE,
  );
  const hasStatBoost = items.some((i) => i.type === 'stat_boost');
  const boostQuota = ctx.services.shop.getStatBoostRemainingToday(guildId, actor.id, nowMs);

  const lines =
    displayItems.length > 0
      ? displayItems.map((item) => {
          const stockText = item.stock === null ? '无限' : `剩 ${item.stock}`;
          const typeTag = formatShopItemTag(item, lvlCfg.statName, lvlCfg.statUnit);
          return `**#${item.id} ${truncateText(item.name, 40)}** — ${cfg.currencyEmoji} **${item.price}**（${stockText}）\n> ${typeTag}${item.description ? ` · ${truncateText(item.description, 60)}` : ''}`;
        })
      : ['商店目前还没有商品，管理员可在「⚙️ 管理后台 → 🛒 商店管理」或 `/商店 上架*` 添加商品。'];

  if (totalPages > 1) {
    lines.push(`\n*（第 ${page} / ${totalPages} 页 · 共 ${items.length} 件商品）*`);
  }

  const statQuotaLine = hasStatBoost
    ? ` ｜ 💊 今日成长道具剩余：**${boostQuota.remaining}/${boostQuota.dailyLimit}** 次`
    : '';

  const description = [
    `${cfg.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.currencyName}${statQuotaLine}`,
    '',
    ...lines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 服务器商店`, iconURL: actor.avatarUrl })
    .setTitle('🛒 服务器商店')
    .setDescription(withFeedback(description, feedback))
    .setFooter({
      text: totalPages > 1 ? `第 ${page} / ${totalPages} 页 · 共 ${items.length} 件商品` : '🔒 商店购买仅自己可见',
    })
    .setTimestamp();

  const tabRow = buttonRow(
    makeButton('menu:nav:shop', '🛒 商店', ButtonStyle.Primary),
    makeButton('menu:nav:bag', '🎒 背包与称号', ButtonStyle.Secondary),
    makeButton('menu:nav:props', '🧰 黑市攻防道具', ButtonStyle.Danger),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  );

  if (displayItems.length === 0) {
    return { embeds: [embed], components: [tabRow] };
  }

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`menu:shop_buy:${page}`)
      .setPlaceholder(
        totalPages > 1 ? `选择要购买的商品（第 ${page}/${totalPages} 页）...` : '选择要购买的商品...',
      )
      .addOptions(
        displayItems.map((item) => {
          const stockTag = item.stock === null ? '无限' : `剩${item.stock}`;
          const typeDesc = formatShopItemTag(item, lvlCfg.statName, lvlCfg.statUnit, true);
          const rawDesc = item.description ? `${typeDesc} · ${item.description}` : `${typeDesc} · 库存:${stockTag}`;
          return new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(`#${item.id} ${item.name} (${item.price} ${cfg.currencyName})`, 100))
            .setValue(String(item.id))
            .setDescription(truncateText(rawDesc, 100));
        }),
      ),
  );

  const components: MenuComponentRow[] = [selectRow];
  if (totalPages > 1) {
    const prevPage = Math.max(1, page - 1);
    const nextPage = Math.min(totalPages, page + 1);
    components.push(
      buttonRow(
        makeButton(`menu:nav:shop:${prevPage}:prev`, '⬅️ 上一页', ButtonStyle.Secondary, page <= 1),
        makeButton(`menu:nav:shop:${nextPage}:next`, '➡️ 下一页', ButtonStyle.Secondary, page >= totalPages),
      ),
    );
  }
  components.push(tabRow);

  return { embeds: [embed], components };
}

function buildBagView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
  listPage?: number,
): BuiltMenuMessage {
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const inventory = ctx.services.shop.listInventory(guildId, actor.id);
  const { slice: displayInv, page, totalPages } = paginateSlice(
    inventory,
    listPage,
    MENU_SELECT_PAGE_SIZE,
  );

  const activeBoostText =
    profile.xpBoostExpiresAt > nowMs && profile.xpBoostMultiplier > 1
      ? `⚡ **${profile.xpBoostMultiplier}x** 生效中（剩余 ${formatDurationZh(profile.xpBoostExpiresAt - nowMs)}）`
      : '未激活';

  const invLines =
    displayInv.length > 0
      ? displayInv.map((item) => {
          const typeLabel = formatInventoryTypeLabel(item.itemType);
          return `• **#${item.id}** [${typeLabel}] **${truncateText(item.itemName, 40)}** × ${item.quantity}`;
        })
      : ['背包里暂时空空如也，去商店逛逛吧！'];

  if (totalPages > 1) {
    invLines.push(`\n*（第 ${page} / ${totalPages} 页 · 共 ${inventory.length} 项道具）*`);
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
    .setFooter({
      text: totalPages > 1 ? `第 ${page} / ${totalPages} 页 · 共 ${inventory.length} 项道具` : '🔒 背包仅自己可见',
    })
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
      .setCustomId(`menu:bag_use:${page}`)
      .setPlaceholder(
        totalPages > 1 ? `选择要使用或佩戴的道具（第 ${page}/${totalPages} 页）...` : '选择要使用或佩戴的道具...',
      )
      .addOptions(
        displayInv.map((inv) => {
          const desc =
            inv.itemType === 'xp_boost'
              ? '点击立即激活经验加成卡'
              : inv.itemType === 'title'
                ? '点击佩戴此专属称号'
                : inv.itemType === 'custom_title'
                  ? '点击弹窗自拟并佩戴专属称号'
                  : '使用背包道具';
          return new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(`#${inv.id} ${inv.itemName} (×${inv.quantity})`, 100))
            .setValue(String(inv.id))
            .setDescription(desc);
        }),
      ),
  );

  const components: MenuComponentRow[] = [selectRow];
  if (totalPages > 1) {
    const prevPage = Math.max(1, page - 1);
    const nextPage = Math.min(totalPages, page + 1);
    components.push(
      buttonRow(
        makeButton(`menu:nav:bag:${prevPage}:prev`, '⬅️ 上一页', ButtonStyle.Secondary, page <= 1),
        makeButton(`menu:nav:bag:${nextPage}:next`, '➡️ 下一页', ButtonStyle.Secondary, page >= totalPages),
      ),
    );
  }
  components.push(tabRow);

  return { embeds: [embed], components };
}

function createRankEmbed(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): EmbedBuilder {
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const cfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;
  const data = ctx.services.leveling.getRankCardData(guildId, actor.id, nowMs);
  const titleBadge = data.profile.equippedTitle ? `「${data.profile.equippedTitle}」` : '';
  const bar = renderProgressBar(data.progress.progressRatio, 14);
  const pct = Math.round(data.progress.progressRatio * 100);
  const boostText =
    data.activeBoostMultiplier > 1 && data.boostExpiresAt > nowMs
      ? `⚡ **${data.activeBoostMultiplier}x**（剩余 ${formatDurationZh(data.boostExpiresAt - nowMs)}）`
      : '未启用';

  const rels = ctx.services.socialPet.listUserRelationships(guildId, actor.id);
  const marriage = rels.find((r) => r.relType === 'marriage');
  const swornCount = rels.filter((r) => r.relType === 'sworn').length;
  const activePet = ctx.services.socialPet.getActivePet(guildId, actor.id);
  const partnerPart = marriage
    ? `💍 <@${marriage.userA === actor.id ? marriage.userB : marriage.userA}>（亲密 ${marriage.affinity}）`
    : swornCount > 0
      ? `🍻 结拜死党 ${swornCount} 人`
      : '暂无 CP 绑定';
  const activeSp = activePet ? PET_SPECIES_MAP.get(activePet.speciesKey) : undefined;
  const petPart = activePet
    ? `${activeSp?.emoji ?? '🐾'} **${activePet.nickname}** [${activePet.rarity} Lv.${activePet.level}]`
    : '暂无出战宠';
  const creditProfile = ctx.services.creditLoan.getCreditProfile(guildId, actor.id, nowMs);
  const gamblingStats = ctx.services.creditLoan.getGamblingStats(guildId, actor.id);
  const hustleStats = ctx.services.creditLoan.getHustleStats(guildId, actor.id);
  const rpgChar = ctx.repos.rpg.getCharacter(guildId, actor.id);
  const netSign = gamblingStats.netProfit >= 0 ? '+' : '';
  const rpgPart = rpgChar
    ? `Lv.**${rpgChar.level}**（已通第 **${rpgChar.maxChapterCleared}** 章）`
    : '尚未踏入地下城';

  const parsedColor = parseCardColor(data.profile.cardColor);
  const customColor = parsedColor.ok ? parsedColor.colorInt : null;
  const displayCardName = data.profile.cardNickname || actor.displayName;
  const cardHeaderLines: string[] = [];
  if (data.profile.cardTag) {
    cardHeaderLines.push(`🏷️ **${data.profile.cardTag}**`);
  }
  if (data.profile.cardBio) {
    cardHeaderLines.push(`💬 *${data.profile.cardBio}*`);
  }
  const statLine = lvlCfg.statEnabled
    ? `📏 ${lvlCfg.statName}：**${data.profile.statValue}** ${lvlCfg.statUnit}`
    : null;
  const rankDescription = [
    ...cardHeaderLines,
    `🏅 **Lv.${data.progress.level}** ｜ 全服第 **#${data.rank}** / ${data.totalMembers} 名`,
    ...(statLine ? [statLine] : []),
    `\`${bar}\` **${pct}%**（${data.progress.currentLevelXp} / ${data.progress.nextLevelXp} XP，累计 ${data.profile.xp} XP）`,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(resolveColor(customColor ?? COLORS.PRIMARY, feedback))
    .setAuthor({
      name: `${titleBadge}${displayCardName} 的身份证名片`,
      iconURL: actor.avatarUrl,
    })
    .setThumbnail(actor.avatarUrl)
    .setDescription(withFeedback(rankDescription, feedback))
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
        name: '💞 社交与宠物',
        value: `${partnerPart}\n出战宠：${petPart}`,
      },
      {
        name: '💬 活跃统计',
        value: `有效发言 **${data.profile.messageCount}** 条 ｜ 语音挂机 **${data.profile.voiceMinutes}** 分钟`,
      },
      {
        name: '📜 征信与江湖档案',
        value: [
          `信用分：**${creditProfile.account.score}**（${creditProfile.tier.label}）${creditProfile.overdueLoans.length > 0 ? ' ⚠️ 逾期老赖' : ''}`,
          `博弈战绩：净盈亏 **${netSign}${gamblingStats.netProfit.toLocaleString()}** ${cfg.currencyName}（${gamblingStats.gamesPlayed} 局） ｜ 卖屁股：**${hustleStats.totalCount}** 次`,
          `⚔️ 西幻RPG：${rpgPart}`,
        ].join('\n'),
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
  const lvlCfg = ctx.repos.guildConfig.getOrCreate(guildId).leveling;
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
    makeButton('menu:modal:edit_card', '✏️ 编辑身份证', ButtonStyle.Primary),
    makeButton('menu:nav:self_roles', '🎭 自助身份组', ButtonStyle.Secondary),
    makeButton('menu:rank:stat:1', `📏 ${lvlCfg.statName}榜`, ButtonStyle.Secondary),
    makeButton('menu:share:rank', '📢 晒出我的名片', ButtonStyle.Success),
    makeButton('menu:nav:bag', '🎒 背包称号', ButtonStyle.Secondary),
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
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const cfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;
  const res = ctx.services.leveling.getLeaderboard(guildId, lbType, lbPage, 10);

  const titleMap: Record<LeaderboardType, string> = {
    xp: '📈 服务器等级经验排行榜',
    coins: `💰 服务器${cfg.currencyName}富豪榜`,
    invites: '📨 服务器邀请贡献排行榜',
    stat: `📏 服务器${lvlCfg.statName}排行榜`,
    credit: '📜 服务器信用分红榜',
    deadbeat: '💀 服务器老赖黑名单',
    hustle: '🍑 服务器卖屁股营收榜',
    gambling_profit: '🎰 服务器赌神盈利榜',
    gambling_loss: '🪦 服务器冤大头亏损榜',
    rpg: '⚔️ 服务器西幻RPG地牢榜',
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
    if (lbType === 'stat') {
      return `${medal} <@${item.userId}> ${titleTag} — 📏 **${item.primaryValue}** ${lvlCfg.statUnit}（Lv.${item.secondaryValue}）`;
    }
    if (lbType === 'credit') {
      return `${medal} <@${item.userId}> — 📜 信用分 **${item.primaryValue}**`;
    }
    if (lbType === 'deadbeat') {
      return `${medal} <@${item.userId}> — 💀 逾期欠款 **${item.primaryValue.toLocaleString()}** ${cfg.currencyName}（信用分 ${item.secondaryValue}）`;
    }
    if (lbType === 'hustle') {
      return `${medal} <@${item.userId}> — 🍑 累计营收 **${item.primaryValue.toLocaleString()}** ${cfg.currencyName}（营业 ${item.secondaryValue} 次）`;
    }
    if (lbType === 'gambling_profit' || lbType === 'gambling_loss') {
      const sign = item.primaryValue >= 0 ? '+' : '';
      const won = (item.totalWon ?? 0).toLocaleString();
      const lost = (item.totalLost ?? 0).toLocaleString();
      return `${medal} <@${item.userId}> — 🎰 净盈亏 **${sign}${item.primaryValue.toLocaleString()}** ${cfg.currencyName}（总赢 +${won} / 总亏 -${lost} · ${item.secondaryValue} 局）`;
    }
    if (lbType === 'rpg') {
      return `${medal} <@${item.userId}> — ⚔️ 已通第 **${item.primaryValue}** 章（Lv.${item.secondaryValue}）`;
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

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const lvlCfg = guildCfg.leveling;
  const ecoCfg = guildCfg.economy;
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
    makeButton(
      'menu:rank:stat:1',
      `📏 ${lvlCfg.statName}榜`,
      lbType === 'stat' ? ButtonStyle.Primary : ButtonStyle.Secondary,
    ),
    makeButton(`menu:share:lb:${lbType}:${page}`, '📢 晒出排行榜', ButtonStyle.Success),
  );

  const boardSelect = new StringSelectMenuBuilder()
    .setCustomId('menu:lb_select')
    .setPlaceholder('🔀 切换全服 12 大排行榜...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('📈 等级经验榜')
        .setValue('xp')
        .setDefault(lbType === 'xp'),
      new StringSelectMenuOptionBuilder()
        .setLabel(truncateText(`💰 ${ecoCfg.currencyName}富豪榜`, 100))
        .setValue('coins')
        .setDefault(lbType === 'coins'),
      new StringSelectMenuOptionBuilder()
        .setLabel(truncateText(`📏 ${lvlCfg.statName}榜`, 100))
        .setValue('stat')
        .setDefault(lbType === 'stat'),
      new StringSelectMenuOptionBuilder()
        .setLabel('📨 邀请贡献榜')
        .setValue('invites')
        .setDefault(lbType === 'invites'),
      new StringSelectMenuOptionBuilder()
        .setLabel('📜 信用分红榜')
        .setValue('credit')
        .setDefault(lbType === 'credit'),
      new StringSelectMenuOptionBuilder()
        .setLabel('💀 老赖黑名单')
        .setValue('deadbeat')
        .setDefault(lbType === 'deadbeat'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🍑 卖屁股营收榜')
        .setValue('hustle')
        .setDefault(lbType === 'hustle'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🎰 赌神盈利榜')
        .setValue('gambling_profit')
        .setDefault(lbType === 'gambling_profit'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🪦 冤大头亏损榜')
        .setValue('gambling_loss')
        .setDefault(lbType === 'gambling_loss'),
      new StringSelectMenuOptionBuilder()
        .setLabel('⚔️ 西幻RPG地牢榜')
        .setValue('rpg')
        .setDefault(lbType === 'rpg'),
      new StringSelectMenuOptionBuilder()
        .setLabel('💕 CP 亲密度榜')
        .setValue('cp_lb'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🎯 悬赏通缉榜')
        .setValue('bounty'),
    );

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(boardSelect);

  return { embeds: [embed], components: [tabRow, pagerRow, selectRow] };
}

const MODULE_META: ReadonlyArray<{ key: ModuleKey; label: string; emoji: string }> = [
  { key: 'leveling', label: '等级与热度', emoji: '📈' },
  { key: 'economy', label: '经济系统', emoji: '🪙' },
  { key: 'fun', label: '娱乐互动', emoji: '🎴' },
  { key: 'welcome', label: '欢迎与离开', emoji: '👋' },
  { key: 'tickets', label: '工单系统', emoji: '🎫' },
  { key: 'giveaways', label: '抽奖系统', emoji: '🎁' },
  { key: 'invites', label: '邀请追踪', emoji: '📨' },
  { key: 'rolePanels', label: '自助身份组', emoji: '🎭' },
  { key: 'socialGames', label: '整蛊与博弈', emoji: '💣' },
  { key: 'worldEvents', label: '吃瓜与事件', emoji: '🎯' },
  { key: 'petsAndCp', label: '关系与宠物', emoji: '💞' },
  { key: 'ai', label: 'AI 对话', emoji: '🤖' },
  { key: 'creditLoan', label: '征信与借贷', emoji: '🏦' },
  { key: 'rpg', label: '奇幻RPG地牢', emoji: '⚔️' },
];

function buildAdminOverviewView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const modLine = MODULE_META.map(
    (m) => `${cfg.modules[m.key] ? '✅' : '⛔'} ${m.label}`,
  ).join(' ｜ ');
  const adminUsersText =
    cfg.adminUserIds.length > 0
      ? cfg.adminUserIds.map((id) => `<@${id}>`).join('、')
      : '未单独指定（仅限服务器管理员）';
  const adminRolesText =
    cfg.adminRoleIds.length > 0
      ? cfg.adminRoleIds.map((id) => `<@&${id}>`).join('、')
      : '无';

  const description = [
    '欢迎进入可视化调参管理后台，所有修改将实时保存至 SQLite 并立即生效。',
    '',
    `🧩 **模块状态**：${modLine}`,
    `💰 **经济 / 抢钱 / 银行**：每日签到 ${cfg.economy.dailyBase}（连签+${cfg.economy.dailyStreakBonus}/天，封顶+${cfg.economy.dailyMaxStreakBonus}）｜ 打工 ${cfg.economy.workMin}~${cfg.economy.workMax}（冷却 ${cfg.economy.workCooldownSec}s）｜ 抢口袋 ${formatRatePercent(cfg.economy.robSuccessRate)} / 抢银行 ${formatRatePercent(cfg.economy.robBankSuccessRate)}（冷却 ${cfg.economy.robCooldownSec}s / 盾 ${cfg.economy.robTargetShieldSec}s）｜ 银行日息 ${formatRatePercent(cfg.economy.bankInterestRate)}（上限 ${cfg.economy.bankInterestMax}）`,
    `📈 **等级 / 热度 / 语音**：基础 XP ${cfg.leveling.baseMinXp}~${cfg.leveling.baseMaxXp}（冷却 ${cfg.leveling.cooldownSec}s）｜ 热度上限 ${cfg.leveling.heatMaxMultiplier}x（窗口 ${cfg.leveling.heatWindowSec}s）｜ 语音 ${cfg.leveling.voiceEnabled ? `${cfg.leveling.voiceXpPerMin} XP/分` : '关闭'} ｜ 升级奖励 +${cfg.leveling.levelUpCoinReward}`,
    `👑 **Bot 管理员用户**：${adminUsersText}`,
    `🛡️ **Bot 管理员身份组**：${adminRolesText}`,
    `🎯 **事件与宠物**：事件每 **${cfg.games.eventMsgThreshold}** 发言/冷却 **${cfg.games.eventCooldownSec}s**（${cfg.games.eventAutoEnabled ? '自动开' : '自动关'}）｜ Boss HP **${cfg.games.bossBaseHp}** / 池 **${cfg.games.bossRewardPool}** ｜ 宠盲盒 **${cfg.games.petGachaPrice}** / 求婚 **${cfg.games.cpProposeCost}**`,
    `💳 **信用与借贷**：银行贷上限 **${cfg.creditLoan.bankLoanMaxCap.toLocaleString()}** ｜ 高利贷上限 **${cfg.creditLoan.usuryLoanMax.toLocaleString()}**（日息 ${formatRatePercent(cfg.creditLoan.usuryDailyRate)} / ${cfg.creditLoan.usuryTermDays}天）｜ 强扣比例 ${formatRatePercent(cfg.creditLoan.garnishRate)} ｜ 卖屁股冷却 ${cfg.creditLoan.hustleCooldownSec}s`,
    `⚔️ **西幻 RPG**：每日体力 **${cfg.rpg.dailyStamina}** ｜ 体力药 **${cfg.rpg.staminaPotionPrice}**（日限 ${cfg.rpg.staminaPotionDailyLimit}）｜ 转职费 **${cfg.rpg.classSwitchCost}** ｜ 背包上限 **${cfg.rpg.bagCapacity}**`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.ERROR, feedback))
    .setAuthor({ name: `${actor.displayName} · 管理员控制中心`, iconURL: actor.avatarUrl })
    .setTitle('⚙️ 管理后台总览')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 仅管理员可见；点击下方按钮即可可视化调参、开关模块、发币或授权管理员' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:nav:admin_econ', '💰 经济/抢钱/银行', ButtonStyle.Primary),
        makeButton('menu:nav:admin_lvl', '📈 等级/热度/语音', ButtonStyle.Primary),
        makeButton('menu:nav:admin_games', '🎮 玩法与事件调参', ButtonStyle.Primary),
        makeButton('menu:nav:admin_mod', '🧩 模块开关', ButtonStyle.Secondary),
        makeButton('menu:nav:admin_ops', '👥 发币/红包/管理', ButtonStyle.Secondary),
      ),
      buttonRow(
        makeButton('menu:nav:admin_roles', '🎭 自助身份组', ButtonStyle.Primary),
        makeButton('menu:nav:admin_shop', '🛒 商店管理', ButtonStyle.Primary),
        makeButton('menu:nav:admin_ai', '🤖 AI 对话配置', ButtonStyle.Primary),
        makeButton('menu:nav:admin_monitor', '📊 运行监控与日志', ButtonStyle.Danger),
        makeButton('menu:admin:send_lobby', '📌 发送频道大厅入口', ButtonStyle.Success),
      ),
      buttonRow(
        makeButton('menu:nav:admin_credit_rpg', '💳 信用/借贷/RPG', ButtonStyle.Primary),
        makeButton('menu:nav:admin', '🔄 刷新配置', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildAdminCreditRpgView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const cl = cfg.creditLoan;
  const rpg = cfg.rpg;
  const currency = cfg.economy.currencyName;

  const description = [
    '点击下方对应按钮打开预填参数的弹窗，实时调整信用借贷、卖屁股与西幻 RPG 参数：',
    '',
    `🏦 **银行与高利贷参数**：银行贷全局上限 **${cl.bankLoanMaxCap.toLocaleString()}** ${currency} ｜ 高利贷上限 **${cl.usuryLoanMax.toLocaleString()}** ${currency}（日息 **${formatRatePercent(cl.usuryDailyRate)}** · 期限 **${cl.usuryTermDays}** 天）｜ 逾期强扣比例 **${formatRatePercent(cl.garnishRate)}**`,
    `🍑 **卖屁股与评价参数**：营业冷却 **${cl.hustleCooldownSec}** 秒 ｜ 基础倍率 **${cl.hustleMinMultiplier}x ~ ${cl.hustleMaxMultiplier}x** 打工档位 ｜ 每次信用扣分 **-${cl.hustleCreditPenalty}** ｜ 每日互评次数上限 **${cl.dailyReviewLimit}**`,
    `⚔️ **西幻 RPG 参数**：每日免费体力 **${rpg.dailyStamina}** ｜ 体力药售价 **${rpg.staminaPotionPrice.toLocaleString()}** ${currency}（日限购 **${rpg.staminaPotionDailyLimit}** 瓶）｜ 转职费用 **${rpg.classSwitchCost.toLocaleString()}** ${currency} ｜ 装备背包上限 **${rpg.bagCapacity}** 格`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 信用/借贷/RPG 调校`, iconURL: actor.avatarUrl })
    .setTitle('💳 信用 / 借贷 / 西幻 RPG 参数管理')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 修改后立即保存至 SQLite 并对全服生效' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:modal:admin_cl_loan', '🏦 贷款与强扣参数', ButtonStyle.Primary),
        makeButton('menu:modal:admin_cl_hustle', '🍑 卖屁股与评价', ButtonStyle.Primary),
        makeButton('menu:modal:admin_rpg_cfg', '⚔️ 西幻RPG参数', ButtonStyle.Primary),
      ),
      buttonRow(
        makeButton('menu:admin:reset_credit_rpg', '♻️ 恢复默认参数', ButtonStyle.Danger),
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildAdminEconView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  confirmReset = false,
): BuiltMenuMessage {
  const e = ctx.repos.guildConfig.getOrCreate(guildId).economy;

  const description = [
    '点击下方对应按钮打开预填参数的弹窗，直接修改数值并提交保存：',
    '',
    `📅 **货币与签到**：名称 **${e.currencyName}**（${e.currencyEmoji}）｜ 基础 **${e.dailyBase}** ｜ 每日连签 +**${e.dailyStreakBonus}** ｜ 连签加成上限 **${e.dailyMaxStreakBonus}**`,
    `💼 **打工参数**：每次收益 **${e.workMin} ~ ${e.workMax}** ${e.currencyName} ｜ 冷却 **${e.workCooldownSec}** 秒`,
    `🥷 **偷钱 / 劫金库参数**：口袋成功率 **${formatRatePercent(e.robSuccessRate)}** ｜ 银行金库成功率 **${formatRatePercent(e.robBankSuccessRate)}** ｜ 攻击冷却 **${e.robCooldownSec}** 秒 ｜ 被抢护盾 **${e.robTargetShieldSec}** 秒`,
    `🏦 **银行利息参数**：日利率 **${formatRatePercent(e.bankInterestRate)}** ｜ 每日利息上限 **${e.bankInterestMax}** ｜ 起息门槛 **${e.bankInterestMinDeposit}**`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 经济参数调校`, iconURL: actor.avatarUrl })
    .setTitle('💰 经济 / 抢钱 / 银行参数管理')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 修改后立即对全服生效（恢复默认将保留自定义货币名称与图标）' })
    .setTimestamp();

  const components: MenuComponentRow[] = [
    buttonRow(
      makeButton('menu:modal:admin_daily', '📅 签到与货币', ButtonStyle.Primary),
      makeButton('menu:modal:admin_work', '💼 打工参数', ButtonStyle.Primary),
      makeButton('menu:modal:admin_rob', '🥷 抢钱参数', ButtonStyle.Primary),
      makeButton('menu:modal:admin_bank', '🏦 银行利息', ButtonStyle.Primary),
    ),
  ];

  if (confirmReset) {
    components.push(
      buttonRow(
        makeButton('menu:admin:reset_econ:confirm', '✅ 确认恢复经济默认', ButtonStyle.Danger),
        makeButton('menu:nav:admin_econ:cancel', '❌ 取消恢复', ButtonStyle.Secondary),
      ),
    );
  }

  components.push(
    buttonRow(
      ...(confirmReset
        ? []
        : [makeButton('menu:admin:reset_econ', '♻️ 恢复经济默认', ButtonStyle.Danger)]),
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

function buildAdminLvlView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  confirmReset = false,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const l = cfg.leveling;
  const currencyName = cfg.economy.currencyName;
  const rewards = ctx.repos.profile.listLevelRewards(guildId);
  const rewardsSummary =
    rewards.length > 0
      ? rewards.slice(0, 6).map((r) => `Lv.${r.level}→<@&${r.roleId}>`).join('、') +
        (rewards.length > 6 ? ` 等共 ${rewards.length} 项` : '')
      : '未配置';

  const description = [
    '点击下方按钮修改聊天经验、冷却、热度、升级奖励身份组及升级提示语：',
    '',
    `💬 **发言经验与冷却**：每次基础 **${l.baseMinXp} ~ ${l.baseMaxXp}** XP ｜ 发言冷却 **${l.cooldownSec}** 秒 ｜ 每小时经验上限 **${l.hourlyXpCap === 0 ? '不限' : l.hourlyXpCap}** XP`,
    `🔥 **热度连击与奖励**：连击窗口 **${l.heatWindowSec}** 秒 ｜ 热度倍率上限 **${l.heatMaxMultiplier}x** ｜ 升级币奖 **${l.levelUpCoinReward}** ${currencyName}`,
    `🎖️ **升级身份组奖励**：${rewardsSummary}（${l.stackRoles ? '保留旧组' : '仅留最高'}）`,
    `🎙️ **语音挂机经验**：${l.voiceEnabled ? `✅ 已开启（每分钟 **${l.voiceXpPerMin}** XP）` : `⛔ 已关闭（预设 ${l.voiceXpPerMin} XP/分）`}`,
    `📢 **升级公告播报**：${l.announceEnabled ? '✅ 已开启' : '⛔ 已关闭'}${l.announceChannelId ? `（固定频道 <#${l.announceChannelId}>）` : '（当前发言频道）'}`,
    `📌 **限定经验频道**：${l.allowedChannelIds.length > 0 ? l.allowedChannelIds.map((id) => `<#${id}>`).join('、') : '全频道（除忽略列表）'}`,
    `📏 **独立成长数值**：${l.statEnabled ? `${l.statName}（每次升级 +${l.statMinGain}~${l.statMaxGain} ${l.statUnit}）` : '已关闭'}`,
    `📝 **升级提示语**：标题「${truncateText(l.levelUpTitle, 24)}」｜ 内容「${truncateText(l.levelUpTemplate, 48)}」`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 等级参数调校`, iconURL: actor.avatarUrl })
    .setTitle('📈 等级 / 热度 / 语音参数管理')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 支持直接配置升级提示语模板、升级身份组奖励与固定播报频道' })
    .setTimestamp();

  const announceChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('menu:chan:admin_lvl_announce')
    .setPlaceholder('📢 选择统一升级播报频道（清空则随当前发言频道）...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    )
    .setMinValues(0)
    .setMaxValues(1);
  if (l.announceChannelId) {
    announceChanSelect.setDefaultChannels([l.announceChannelId]);
  }

  const components: MenuComponentRow[] = [
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(announceChanSelect),
    buttonRow(
      makeButton('menu:modal:admin_xp', '💬 经验与冷却', ButtonStyle.Primary),
      makeButton('menu:modal:admin_heat', '🔥 热度与奖励', ButtonStyle.Primary),
      makeButton('menu:modal:admin_lvl_msg', '📝 升级提示语', ButtonStyle.Primary),
      makeButton('menu:nav:admin_lvl_rewards', '🎖️ 升级奖励身份组', ButtonStyle.Primary),
    ),
    buttonRow(
      makeButton(
        'menu:admin:toggle_voice',
        `🎙️ 语音经验: ${l.voiceEnabled ? '开' : '关'}`,
        l.voiceEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
      makeButton(
        'menu:admin:toggle_announce',
        `📢 升级播报: ${l.announceEnabled ? '开' : '关'}`,
        l.announceEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
      makeButton(
        'menu:admin:toggle_announce_channel',
        l.announceChannelId ? '📌 解绑播报频道' : '📌 设当前为播报频道',
        ButtonStyle.Secondary,
      ),
      makeButton(
        'menu:admin:toggle_stack_roles',
        `🏷️ 叠加身份组: ${l.stackRoles ? '保留旧组' : '仅留最高'}`,
        l.stackRoles ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
    ),
  ];

  if (confirmReset) {
    components.push(
      buttonRow(
        makeButton('menu:admin:reset_lvl:confirm', '✅ 确认恢复等级默认', ButtonStyle.Danger),
        makeButton('menu:nav:admin_lvl:cancel', '❌ 取消恢复', ButtonStyle.Secondary),
      ),
    );
  }

  components.push(
    buttonRow(
      ...(confirmReset
        ? []
        : [makeButton('menu:admin:reset_lvl', '♻️ 恢复等级默认', ButtonStyle.Danger)]),
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

function buildAdminModView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const modules = ctx.repos.guildConfig.getOrCreate(guildId).modules;
  const lines = MODULE_META.map(
    (m) => `${modules[m.key] ? '✅ 已开启' : '⛔ 已关闭'} — ${m.emoji} **${m.label}** (\`${m.key}\`)`,
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 功能模块开关`, iconURL: actor.avatarUrl })
    .setTitle('🧩 服务器功能模块开关')
    .setDescription(
      withFeedback(
        ['从下方下拉菜单选中任意模块即可立即切换「开启 / 关闭」状态：', '', ...lines].join('\n'),
        feedback,
      ),
    )
    .setTimestamp();

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu:admin_toggle_mod')
      .setPlaceholder('选择要切换开启/关闭的模块...')
      .addOptions(
        MODULE_META.map((m) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${m.emoji} ${m.label}（当前: ${modules[m.key] ? '开启' : '关闭'}）`)
            .setValue(m.key)
            .setDescription(`点击切换为 ${modules[m.key] ? '关闭' : '开启'}`),
        ),
      ),
  );

  return {
    embeds: [embed],
    components: [
      selectRow,
      buttonRow(
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildAdminOpsView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const adminUsersText =
    cfg.adminUserIds.length > 0
      ? cfg.adminUserIds.map((id) => `<@${id}>`).join('、')
      : '暂无单独授权用户';
  const adminRolesText =
    cfg.adminRoleIds.length > 0
      ? cfg.adminRoleIds.map((id) => `<@&${id}>`).join('、')
      : '无';

  const currencyName = cfg.economy.currencyName;
  const description = [
    `👑 **当前授权 Bot 管理员用户**：${adminUsersText}`,
    `🛡️ **当前授权管理员身份组**：${adminRolesText}`,
    '',
    `• 第一个选人框：给指定群友**发放或扣除口袋${currencyName}**（支持最高 **10 亿 \`1,000,000,000\`**；正数公开喜报，负数私密扣除）`,
    '• 第二个选人框：**添加或移除 Bot 管理员用户**（仅限服务器超级管理员操作）',
    `• 第三个选人框：自由设置指定群友的 **${cfg.leveling.statName}**（单位：${cfg.leveling.statUnit}）`,
    `• **🎉 全服全员发币**：向全服所有真实成员统一发放固定${currencyName}（最高 10 亿，限超级管理员）`,
    '• **🎲 随机派发红包**：管理员设定份数与总金额，系统自动抽取群友直接随机分钱并播报手气最佳（限超级管理员）',
    '• **🧧 发系统抢红包**：管理员设定份数与总金额，由系统出资在当前频道发出拼手气红包卡片供大家点击抢领',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 发币 / 红包 / 管理员`, iconURL: actor.avatarUrl })
    .setTitle('👥 发币 / 随机红包 / 成员数值 / 管理员管理')
    .setDescription(withFeedback(description, feedback))
    .setTimestamp();

  const grantUserRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:admin_grant')
      .setPlaceholder(truncateText(`💸 选择一位群友发放/扣除${currencyName}（最高 10 亿）...`, 150))
      .setMinValues(1)
      .setMaxValues(1),
  );

  const toggleAdminRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:admin_toggle_user')
      .setPlaceholder('👑 选择一位群友添加或移除 Bot 管理员...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  const setStatUserRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:admin_set_stat')
      .setPlaceholder(
        truncateText(`📏 选择一位群友设置${cfg.leveling.statName}（${cfg.leveling.statUnit}）...`, 150),
      )
      .setMinValues(1)
      .setMaxValues(1),
  );

  return {
    embeds: [embed],
    components: [
      grantUserRow,
      toggleAdminRow,
      setStatUserRow,
      buttonRow(
        makeButton('menu:modal:admin_grant_all', '🎉 全服全员发币', ButtonStyle.Success),
        makeButton('menu:modal:admin_random_redpacket', '🎲 随机派发红包', ButtonStyle.Danger),
        makeButton('menu:modal:admin_sys_redpacket', '🧧 发系统抢红包', ButtonStyle.Primary),
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildAdminGamesView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const g = cfg.games;
  const unit = cfg.economy.currencyName;

  const description = [
    '点击下方按钮即可通过预填弹窗修改新玩法定价、事件阈值、Boss/宝箱收益、宠物与 CP 参数：',
    '',
    `🧰 **黑市道具定价**：捕兽夹 **${g.propTrapPrice}** ｜ 撬锁 **${g.propLockpickPrice}** ｜ 护盾 **${g.propShieldPrice}** ｜ 衰神符 **${g.propCursePrice}** ｜ 改昵称 **${g.propNicknamePrice}** ${unit}`,
    `🎯 **悬赏参数**：最低悬赏 **${g.bountyMinAmount}** ${unit} ｜ 自清倍率 **${g.bountyClearMultiplier}x**`,
    `⚡ **世界事件 / Boss / 宝箱**：自动触发 ${g.eventAutoEnabled ? '✅ 开启' : '⛔ 关闭'} ｜ 指定频道 ${g.eventChannelId ? `<#${g.eventChannelId}>` : '随当前活跃频道'}`,
    `   触发阈值 **${g.eventMsgThreshold}** 条消息 / 冷却 **${g.eventCooldownSec}s** ｜ Boss HP **${g.bossBaseHp}** / 奖池 **${g.bossRewardPool}** ｜ 宝箱 **${g.chestRewardMin}~${g.chestRewardMax}** (${g.chestShares}份)`,
    `💞 **宠物与 CP**：抽宠盲盒 **${g.petGachaPrice}** ｜ 每日喂食 **${g.petFeedPrice}** ｜ 上限 **${g.petMaxOwned}** 只 ｜ 求婚/结拜费 **${g.cpProposeCost}** ｜ 结拜上限 **${g.cpMaxSworn}** 人`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 新玩法与事件调参`, iconURL: actor.avatarUrl })
    .setTitle('🎮 新玩法与世界事件管理')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 修改实时写入数据库并对新事件/购买立即生效' })
    .setTimestamp();

  const eventChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('menu:chan:admin_games_event')
    .setPlaceholder('⚡ 选择世界事件指定频道（清空则随当前活跃频道）...')
    .setChannelTypes(
      ChannelType.GuildText,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
    )
    .setMinValues(0)
    .setMaxValues(1);
  if (g.eventChannelId) {
    eventChanSelect.setDefaultChannels([g.eventChannelId]);
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(eventChanSelect),
      buttonRow(
        makeButton('menu:modal:admin_props', '🧰 道具价格', ButtonStyle.Primary),
        makeButton('menu:modal:admin_events', '🎁 事件与Boss', ButtonStyle.Primary),
        makeButton('menu:modal:admin_pets_cp', '🐾 宠物与CP', ButtonStyle.Primary),
        makeButton('menu:modal:admin_bounty', '🎯 悬赏参数', ButtonStyle.Primary),
      ),
      buttonRow(
        makeButton(
          'menu:admin:toggle_auto_event',
          `⚡ 自动事件: ${g.eventAutoEnabled ? '开' : '关'}`,
          g.eventAutoEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
        makeButton(
          'menu:admin:toggle_event_channel',
          g.eventChannelId ? '📌 解绑事件频道' : '📌 设当前为事件频道',
          ButtonStyle.Secondary,
        ),
        makeButton('menu:admin:spawn_chest', '🎁 放宝箱', ButtonStyle.Success),
        makeButton('menu:admin:spawn_boss', '👹 召Boss', ButtonStyle.Danger),
        makeButton('menu:admin:reset_games', '♻️ 恢复默认', ButtonStyle.Danger),
      ),
      buttonRow(
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
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
    case 'credit':
      return buildCreditView(ctx, guildId, actor, feedback, nowMs);
    case 'loan':
      return buildLoanView(ctx, guildId, actor, feedback, nowMs);
    case 'hustle':
      return buildHustleView(ctx, guildId, actor, feedback, nowMs);
    case 'rpg': {
      const activeRun = ctx.services.rpg.getActiveRun(guildId, actor.id);
      return activeRun
        ? buildRpgRunView(ctx, guildId, actor, feedback)
        : buildRpgHomeView(ctx, guildId, actor, feedback, nowMs);
    }
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
    case 'props':
      return buildPropsView(ctx, guildId, actor, feedback, nowMs);
    case 'bounty':
      return buildBountyView(ctx, guildId, actor, feedback);
    case 'roulette':
      return buildRouletteView(ctx, guildId, actor, feedback);
    case 'bomb':
      return buildBombView(ctx, guildId, actor, feedback);
    case 'events':
      return buildEventsHubView(ctx, guildId, actor, feedback);
    case 'predictions':
      return buildPredictionsListView(ctx, guildId, actor, feedback);
    case 'pred_detail':
      return buildPredDetailView(ctx, guildId, actor, view.predictionId, feedback);
    case 'world_status':
      return buildWorldStatusView(ctx, guildId, actor, feedback);
    case 'social_hub':
      return buildSocialHubView(ctx, guildId, actor, feedback);
    case 'cp':
      return buildCpView(ctx, guildId, actor, feedback, nowMs);
    case 'cp_lb':
      return buildCpLeaderboardView(ctx, guildId, view.lbPage, feedback);
    case 'pets':
      return buildPetsView(ctx, guildId, actor, feedback, nowMs);
    case 'pet_arena':
      return buildPetArenaView(ctx, guildId, actor, feedback);
    case 'shop':
      return buildShopView(ctx, guildId, actor, feedback, nowMs, view.listPage);
    case 'bag':
      return buildBagView(ctx, guildId, actor, feedback, nowMs, view.listPage);
    case 'rank':
      return buildRankView(ctx, guildId, actor, feedback, nowMs);
    case 'self_roles':
      return buildSelfRolesView(ctx, guildId, actor, view.panelId, feedback, view.panelPage);
    case 'leaderboard':
      return buildLeaderboardView(ctx, guildId, view.lbType, view.lbPage, feedback);
    case 'admin':
      return buildAdminOverviewView(ctx, guildId, actor, feedback);
    case 'admin_econ':
      return buildAdminEconView(ctx, guildId, actor, feedback, view.confirmReset);
    case 'admin_lvl':
      return buildAdminLvlView(ctx, guildId, actor, feedback, view.confirmReset);
    case 'admin_lvl_rewards':
      return buildAdminLvlRewardsView(ctx, guildId, actor, feedback, view.listPage);
    case 'admin_roles':
      return buildAdminRolesView(
        ctx,
        guildId,
        actor,
        {
          panelId: view.panelId,
          panelPage: view.panelPage,
          optPage: view.optPage,
          confirmDeletePanelId: view.confirmDeletePanelId,
        },
        feedback,
      );
    case 'admin_shop':
      return buildAdminShopView(ctx, guildId, actor, feedback, {
        listPage: view.listPage,
        confirmDeleteItemId: view.confirmDeleteItemId,
      });
    case 'admin_games':
      return buildAdminGamesView(ctx, guildId, actor, feedback);
    case 'admin_mod':
      return buildAdminModView(ctx, guildId, actor, feedback);
    case 'admin_ops':
      return buildAdminOpsView(ctx, guildId, actor, feedback);
    case 'admin_ai':
      return buildAdminAiView(ctx, guildId, actor, feedback, view.tab ?? 'basic');
    case 'admin_credit_rpg':
      return buildAdminCreditRpgView(ctx, guildId, actor, feedback);
    case 'admin_monitor':
      return buildAdminMonitorView(
        ctx,
        guildId,
        actor,
        view.filter ?? 'issues',
        feedback,
        nowMs,
        view.confirmClear ?? false,
      );
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
    claimLines.push(
      `*… 仅展示前 ${MAX_VISIBLE_RED_PACKET_CLAIMS} 条，共 ${claims.length} 人已领*`,
    );
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
