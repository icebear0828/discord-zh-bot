import { ButtonStyle, EmbedBuilder } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { getDateKey } from '../../services/economyService.js';
import { COLORS, formatDurationZh, renderProgressBar } from '../embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  withFeedback,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuFeedback,
} from '../menuShared.js';

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
        '• 🎨 **AI 独立生图**：`/画图` 与工作台出图、中文直译、比例/步数/种子与一键重绘',
        '• 💳 **银行借贷与卖屁股**：存钱降险领息、信用分权益、银行信用贷/黑市高利贷、1h 卖屁股与老赖通缉',
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

export function buildHomeView(
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

  const imageRow = buttonRow(
    makeButton('menu:nav:image', '🎨 AI 绘图', ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [navRow, quickRow, extraRow, imageRow] };
}
