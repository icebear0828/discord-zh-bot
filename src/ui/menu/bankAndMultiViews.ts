import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import {
  BANK_ROB_ATTACKER_MIN_ASSETS,
  BANK_ROB_FINE_RATE,
  BANK_ROB_STEAL_MAX_RATE,
  BANK_ROB_STEAL_MIN_RATE,
  BANK_ROB_TARGET_MIN,
  BANK_ROB_TRAP_FINE_RATE,
  ROB_ATTACKER_MIN_ASSETS,
  ROB_FINE_RATE,
  ROB_STEAL_MAX_RATE,
  ROB_STEAL_MIN_RATE,
  ROB_TARGET_MIN_COINS,
  ROB_TRAP_FINE_RATE,
} from '../../config/economyConstants.js';
import type { AppContext } from '../../core/context.js';
import { getDateKey } from '../../services/economyService.js';
import type { InteractionAction } from '../../services/funService.js';
import { COLORS, formatDurationZh } from '../embeds.js';
import {
  buttonRow,
  formatRatePercent,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuFeedback,
} from '../menuShared.js';

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

export function buildBankView(
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
    `• 银行金库有重兵把守（强抢成功率仅 **${formatRatePercent(cfg.robBankSuccessRate)}**，得手可刮走 **${formatRatePercent(BANK_ROB_STEAL_MIN_RATE)}~${formatRatePercent(BANK_ROB_STEAL_MAX_RATE)}**，翻车按总资产重罚 **${formatRatePercent(BANK_ROB_FINE_RATE)}~${formatRatePercent(BANK_ROB_TRAP_FINE_RATE)}**）；游玩游戏、发红包、决斗、转账均使用**口袋现金**。`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · ${cfg.currencyName}银行`, iconURL: actor.avatarUrl })
    .setTitle('🏦 银行保险柜')
    .setDescription(withFeedback(description, feedback))
    .addFields(
      { name: `${cfg.currencyEmoji} 口袋现金 (易被偷)`, value: `**${profile.coins}** ${cfg.currencyName}`, inline: true },
      { name: '🏦 银行金库 (低概率被劫)', value: `**${profile.bankCoins}** ${cfg.currencyName}`, inline: true },
      { name: '💎 总资产', value: `**${profile.coins + profile.bankCoins}** ${cfg.currencyName}`, inline: true },
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

export function buildMultiView(
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
    '• **⚔️ 多人决斗大厅**：骰子决斗（最高 10 亿）、石头剪刀布 Bo5（赢家限时反复改名）、1v1 俄罗斯轮盘（赌币/改名/禁言/文字赌约）',
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
        makeButton('menu:nav:duel', '⚔️ 决斗大厅', ButtonStyle.Primary),
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

export function buildRobView(
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
          const shieldText = shieldMs > 0 ? `🛡️ 护盾剩余 ${formatDurationZh(shieldMs)}` : '✅ 可下手';
          return `${idx + 1}. <@${t.userId}> — ${cfg.currencyEmoji} **${t.coins}** ${cfg.currencyName}（${shieldText}）`;
        })
      : [`当前暂无口袋现金 ≥ ${ROB_TARGET_MIN_COINS} ${cfg.currencyName}的可下手目标。`];

  const bankTargetLines =
    bankTargets.length > 0
      ? bankTargets.map((t, idx) => {
          const shieldMs = Math.max(0, t.robShieldUntil - nowMs);
          const shieldText = shieldMs > 0 ? `🛡️ 护盾剩余 ${formatDurationZh(shieldMs)}` : '🏦 可强攻';
          return `${idx + 1}. <@${t.userId}> — 🏦 **${t.bankCoins}** ${cfg.currencyName}（${shieldText}）`;
        })
      : [`当前暂无银行存款 ≥ ${BANK_ROB_TARGET_MIN} ${cfg.currencyName}的金库目标。`];

  const description = [
    `${cfg.currencyEmoji} 你的口袋现金：**${profile.coins}** ｜ 🏦 银行存款：**${profile.bankCoins}** ｜ 冷却：${robRemainMs > 0 ? `⏳ ${formatDurationZh(robRemainMs)}` : '✅ 可下手'}`,
    `• **🥷 偷口袋现金**：成功率 **${formatRatePercent(cfg.robSuccessRate)}**（需自身总资产≥${ROB_ATTACKER_MIN_ASSETS}、目标现金≥${ROB_TARGET_MIN_COINS}；可偷 **${formatRatePercent(ROB_STEAL_MIN_RATE)}~${formatRatePercent(ROB_STEAL_MAX_RATE)}** 无金额上限；失败罚总资产 **${formatRatePercent(ROB_FINE_RATE)}**，踩夹罚 **${formatRatePercent(ROB_TRAP_FINE_RATE)}**）`,
    `• **🏦 强抢银行金库**：成功率仅 **${formatRatePercent(cfg.robBankSuccessRate)}**（需自身总资产≥${BANK_ROB_ATTACKER_MIN_ASSETS}、目标存款≥${BANK_ROB_TARGET_MIN}；得手刮走 **${formatRatePercent(BANK_ROB_STEAL_MIN_RATE)}~${formatRatePercent(BANK_ROB_STEAL_MAX_RATE)}** 无金额上限；失败重罚总资产 **${formatRatePercent(BANK_ROB_FINE_RATE)}**，踩夹罚 **${formatRatePercent(BANK_ROB_TRAP_FINE_RATE)}**，现金不够扣银行存款！）`,
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

export function buildPayView(
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

export function buildSocialView(
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
