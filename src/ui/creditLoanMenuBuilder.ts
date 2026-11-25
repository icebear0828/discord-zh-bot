import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { CreditReviewKind, Loan } from '../db/repositories/creditLoanRepo.js';
import {
  CREDIT_SCORE_MAX,
  type CreditTierKey,
  type SellButtResult,
} from '../services/creditLoanService.js';
import { getDateKey } from '../services/economyService.js';
import {
  COLORS,
  formatDurationZh,
  renderProgressBar,
  type AppContext,
} from './embeds.js';
import {
  buttonRow,
  formatRatePercent,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
} from './menuShared.js';

export interface CreditInspectTarget {
  id: string;
  displayName: string;
  avatarUrl: string;
}

function getTierColor(tierKey: CreditTierKey): number {
  if (tierKey === 'noble') return COLORS.GOLD;
  if (tierKey === 'platinum') return COLORS.SUCCESS;
  if (tierKey === 'normal') return COLORS.PRIMARY;
  if (tierKey === 'graylist') return COLORS.WARNING;
  return COLORS.ERROR;
}

function formatMultiplierTag(mult: number): string {
  const pct = Math.round((mult - 1) * 100);
  if (pct > 0) return `${mult}x (+${pct}%)`;
  if (pct < 0) return `${mult}x (${pct}%)`;
  return `${mult}x (标准)`;
}

function formatShopMultiplierTag(mult: number): string {
  if (mult < 1) {
    const discount = (mult * 10).toFixed(1).replace(/\.0$/, '');
    return `打 ${discount} 折 (${mult}x)`;
  }
  if (mult > 1) {
    const surcharge = Math.round((mult - 1) * 100);
    return `加价 +${surcharge}% (${mult}x)`;
  }
  return '原价 (1.0x)';
}

function isLoanOverdue(loan: Loan, nowMs: number): boolean {
  return loan.status === 'overdue' || (loan.status === 'active' && nowMs > loan.dueAt);
}

function formatLoanTypeLabel(loan: Loan): string {
  return loan.loanType === 'bank' ? '🏦 银行信用贷' : '🩸 黑市高利贷';
}

function formatLoanShortTag(loan: Loan): string {
  return loan.loanType === 'bank' ? '银行贷' : '高利贷';
}

export function buildCreditView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const creditCfg = ctx.services.creditLoan.getConfig(guildId);
  const summary = ctx.services.creditLoan.getCreditProfile(guildId, actor.id, nowMs);
  const logsPage = ctx.services.creditLoan.listCreditLogs(guildId, actor.id, 8, 0);

  const { account, tier, openLoans, overdueLoans, totalDebt, totalOverdueDebt } = summary;
  const currencyName = cfg.economy.currencyName;
  const currencyEmoji = cfg.economy.currencyEmoji;
  const progressBar = renderProgressBar(account.score / CREDIT_SCORE_MAX, 14);
  const effectiveBankCap = Math.min(tier.bankLoanMax, creditCfg.bankLoanMaxCap);
  const effectiveInterestMax = Math.max(
    1,
    Math.round(cfg.economy.bankInterestMax * tier.bankInterestCapMult),
  );

  const bankPerkLine =
    effectiveBankCap > 0 && tier.bankMaxDays > 0
      ? `最高 **${effectiveBankCap.toLocaleString()}** ${currencyName} ｜ 日息 **${formatRatePercent(tier.bankDailyRate)}** ｜ 最长 **${tier.bankMaxDays}** 天`
      : '❌ 禁止申请（信用分需 ≥ 300）';

  const statusLines: string[] = [];
  if (overdueLoans.length > 0) {
    statusLines.push(
      `🚨 **老赖失信警报**：你有 **${overdueLoans.length}** 笔逾期贷款，逾期欠款共 ${currencyEmoji} **${totalOverdueDebt.toLocaleString()}** ${currencyName}！`,
    );
    statusLines.push(
      `> 逾期期间禁止参与赌博与申请银行贷，所有收入将被自动划扣 **${formatRatePercent(creditCfg.garnishRate)}** 抵债，请尽快前往「💳 借贷中心」或「🍑 卖屁股」还清！`,
    );
  } else if (openLoans.length > 0) {
    statusLines.push(
      `💳 **在贷提示**：当前有 **${openLoans.length}** 笔计息中贷款，待还总额 ${currencyEmoji} **${totalDebt.toLocaleString()}** ${currencyName}，按期结清可获信用分奖励！`,
    );
  } else {
    statusLines.push('✅ **履约状态**：当前无任何未结清贷款，信用记录良好。');
  }

  const logLines =
    logsPage.items.length > 0
      ? logsPage.items.map((log) => {
          const sign = log.delta >= 0 ? '+' : '';
          const ts = Math.floor(log.createdAt / 1000);
          return `• <t:${ts}:R> \`${sign}${log.delta}\` → **${log.scoreAfter}** · ${truncateText(log.reason, 48)}`;
        })
      : ['暂无信用变动记录，按期还贷或获得群友点赞可提升信用分。'];

  const description = [
    `📊 **信用评分**：**${account.score} / ${CREDIT_SCORE_MAX}** ｜ 等级：**${tier.label}**`,
    `\`[${progressBar}]\` (${Math.round((account.score / CREDIT_SCORE_MAX) * 100)}%)`,
    '',
    '🎁 **当前等级权益 / 惩罚：**',
    `• 💼 打工收益倍率：**${formatMultiplierTag(tier.workMult)}**`,
    `• 🏦 银行日息上限：**${tier.bankInterestCapMult}x**（最高 **${effectiveInterestMax.toLocaleString()}** ${currencyName}/日）`,
    `• 🛒 商店 / 黑市价格：**${formatShopMultiplierTag(tier.shopMult)}**`,
    `• 💳 银行信用贷资格：${bankPerkLine}`,
    '',
    ...statusLines,
    '',
    `📜 **最近信用记录（${logsPage.items.length}/${logsPage.total}）：**`,
    ...logLines,
  ].join('\n');

  const baseColor = overdueLoans.length > 0 ? COLORS.ERROR : getTierColor(tier.key);
  const embed = new EmbedBuilder()
    .setColor(resolveColor(baseColor, feedback))
    .setAuthor({ name: `${actor.displayName} · 个人信用档案`, iconURL: actor.avatarUrl })
    .setTitle(`📜 信用档案 · ${tier.label}`)
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '按期还贷 / 获群友点赞可涨信用；逾期违约 / 被举报 / 卖屁股将扣信用' })
    .setTimestamp();

  const row1 = buttonRow(
    makeButton('cl:nav:review:endorse', '👍 点赞群友(+信用)', ButtonStyle.Success),
    makeButton('cl:nav:review:report', '🚨 举报老赖(-信用)', ButtonStyle.Danger),
    makeButton('menu:nav:loan', '💳 借贷中心', ButtonStyle.Primary),
  );

  const row2 = buttonRow(
    makeButton('menu:rank:credit:1', '🏆 信用榜', ButtonStyle.Secondary),
    makeButton('menu:rank:deadbeat:1', '💀 老赖榜', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🔙 返回主菜单', ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [row1, row2],
  };
}

export function buildCreditInspectEmbed(
  ctx: AppContext,
  guildId: string,
  target: CreditInspectTarget,
  nowMs = Date.now(),
): EmbedBuilder {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const summary = ctx.services.creditLoan.getCreditProfile(guildId, target.id, nowMs);
  const logsPage = ctx.services.creditLoan.listCreditLogs(guildId, target.id, 6, 0);

  const { account, tier, openLoans, overdueLoans, totalDebt, totalOverdueDebt } = summary;
  const currencyName = cfg.economy.currencyName;
  const currencyEmoji = cfg.economy.currencyEmoji;
  const progressBar = renderProgressBar(account.score / CREDIT_SCORE_MAX, 14);

  const debtLine =
    overdueLoans.length > 0
      ? `🚨 **失信老赖**：存在 **${overdueLoans.length}** 笔逾期贷款，逾期欠款 ${currencyEmoji} **${totalOverdueDebt.toLocaleString()}** ${currencyName}（总欠款 ${totalDebt.toLocaleString()}）`
      : openLoans.length > 0
        ? `💳 在贷笔数：**${openLoans.length}** 笔，待还总额 ${currencyEmoji} **${totalDebt.toLocaleString()}** ${currencyName}`
        : '✅ 当前无逾期或未结清债务';

  const logLines =
    logsPage.items.length > 0
      ? logsPage.items.map((log) => {
          const sign = log.delta >= 0 ? '+' : '';
          const ts = Math.floor(log.createdAt / 1000);
          return `• <t:${ts}:R> \`${sign}${log.delta}\` → **${log.scoreAfter}** · ${truncateText(log.reason, 48)}`;
        })
      : ['暂无信用变动记录。'];

  const description = [
    `👤 查询对象：<@${target.id}>`,
    `📊 **信用评分**：**${account.score} / ${CREDIT_SCORE_MAX}** ｜ 等级：**${tier.label}**`,
    `\`[${progressBar}]\` (${Math.round((account.score / CREDIT_SCORE_MAX) * 100)}%)`,
    '',
    debtLine,
    '',
    `📜 **近期信用流水（最近 ${logsPage.items.length} 条）：**`,
    ...logLines,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(overdueLoans.length > 0 ? COLORS.ERROR : getTierColor(tier.key))
    .setAuthor({ name: `${target.displayName} · 信用档案（只读）`, iconURL: target.avatarUrl })
    .setTitle(`🔍 群友信用查验 · ${tier.label}`)
    .setDescription(truncateText(description, 4096))
    .setFooter({ text: '如需点赞背书或举报老赖，请执行 /信用 打开自己的互动信用档案' })
    .setTimestamp();
}

export function buildCreditReviewTargetView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  kind: CreditReviewKind,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const creditCfg = ctx.services.creditLoan.getConfig(guildId);
  const dateKey = getDateKey(nowMs, ctx.timezone);
  const usedToday = ctx.repos.creditLoan.countReviewsByReviewerOnDate(guildId, actor.id, dateKey);
  const remainingToday = Math.max(0, creditCfg.dailyReviewLimit - usedToday);
  const cooldownHours = Math.max(1, Math.round(creditCfg.reviewTargetCooldownSec / 3600));

  const isEndorse = kind === 'endorse';
  const title = isEndorse ? '👍 群友信用背书 (+信用)' : '🚨 举报失信老赖 (-信用)';
  const ruleLine = isEndorse
    ? '• 选中群友后将为其增加 **+10** 信用分，助其冲击更高信用等级。'
    : '• 正常举报扣目标 **-8** 信用分；若目标正处于**逾期老赖状态**，将触发加重举报扣 **-15** 信用分！';

  const description = [
    `📅 今日剩余互评次数：**${remainingToday} / ${creditCfg.dailyReviewLimit}** 次`,
    '',
    '📋 **互评规则与防刷说明：**',
    ruleLine,
    `• 不可对自己操作；同一目标 **${cooldownHours} 小时**内仅可评价 1 次。`,
    `• 每位成员每日通过互评累计变动上限为 **±${creditCfg.reviewTargetDailyCap}** 分。`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(isEndorse ? COLORS.SUCCESS : COLORS.ERROR, feedback))
    .setAuthor({ name: `${actor.displayName} · 群友信用互评`, iconURL: actor.avatarUrl })
    .setTitle(title)
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '请在下方下拉框选择要评价的服务器成员' })
    .setTimestamp();

  const userSelectRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`cl:review_user:${kind}`)
      .setPlaceholder(isEndorse ? '👍 选择要点赞背书的群友...' : '🚨 选择要举报失信的群友...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  const navRow = buttonRow(
    makeButton('menu:nav:credit', '🔙 返回信用档案', ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [userSelectRow, navRow],
  };
}

export function buildLoanView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const creditCfg = ctx.services.creditLoan.getConfig(guildId);
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const summary = ctx.services.creditLoan.getCreditProfile(guildId, actor.id, nowMs);

  const currencyName = cfg.economy.currencyName;
  const currencyEmoji = cfg.economy.currencyEmoji;
  const { account, tier, openLoans, overdueLoans } = summary;
  const bankMax = Math.min(tier.bankLoanMax, creditCfg.bankLoanMaxCap);

  const bankOfferLine =
    account.score < 300 || bankMax <= 0 || tier.bankMaxDays <= 0
      ? '❌ 信用分不足 300（当前无法申请，请先提升信用或还清逾期）'
      : `额度 **${creditCfg.bankLoanMin.toLocaleString()} ~ ${bankMax.toLocaleString()}** ${currencyName} ｜ 日息 **${formatRatePercent(tier.bankDailyRate)}** ｜ 期限 **1 ~ ${tier.bankMaxDays}** 天`;

  const usuryOfferLine = `不看信用分 · 额度 **${creditCfg.usuryLoanMin.toLocaleString()} ~ ${creditCfg.usuryLoanMax.toLocaleString()}** ${currencyName} ｜ 日息 **${formatRatePercent(creditCfg.usuryDailyRate)}** ｜ 期限 **${creditCfg.usuryTermDays}** 天`;

  const loanLines =
    openLoans.length > 0
      ? openLoans.map((loan) => {
          const overdue = isLoanOverdue(loan, nowMs);
          const totalOwed = loan.remainingPrincipal + loan.accruedInterest;
          const badge = overdue ? '🚨 已逾期' : '🟢 计息中';
          const dueUnix = Math.floor(loan.dueAt / 1000);
          return [
            `• **#${loan.id} ${formatLoanTypeLabel(loan)}** [${badge}]（日息 ${formatRatePercent(loan.dailyRate)}）`,
            `  剩余本金 **${loan.remainingPrincipal.toLocaleString()}** ＋ 累计利息 **${loan.accruedInterest.toLocaleString()}** ＝ 应还 **${totalOwed.toLocaleString()}** ${currencyName} ｜ 到期 <t:${dueUnix}:R>`,
          ].join('\n');
        })
      : ['✅ 当前无在贷或逾期账单，财务清白！'];

  const description = [
    `${currencyEmoji} 口袋现金：**${profile.coins.toLocaleString()}** ${currencyName} ｜ 🏦 银行存款：**${profile.bankCoins.toLocaleString()}** ${currencyName}`,
    `📊 信用评分：**${account.score}**（**${tier.label}**）`,
    '',
    '🏦 **银行信用贷方案：**',
    bankOfferLine,
    '',
    '🩸 **黑市高利贷方案：**',
    usuryOfferLine,
    '> ⚠️ 高利贷逾期每日加收 20% 罚息、扣 30 信用分，强制划扣并自动发布全服悬赏通缉！',
    '',
    `📋 **当前待还账单（${openLoans.length} 笔）：**`,
    ...loanLines,
  ].join('\n');

  const baseColor = overdueLoans.length > 0 ? COLORS.ERROR : COLORS.PRIMARY;
  const embed = new EmbedBuilder()
    .setColor(resolveColor(baseColor, feedback))
    .setAuthor({ name: `${actor.displayName} · 借贷中心`, iconURL: actor.avatarUrl })
    .setTitle('💳 银行信用贷 & 黑市高利贷')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '按期结清银行贷奖励 +15~35 信用分，按期结清高利贷奖励 +10 信用分' })
    .setTimestamp();

  const components: MenuComponentRow[] = [];

  components.push(
    buttonRow(
      makeButton('cl:modal:bank_loan', '🏦 申请银行信用贷', ButtonStyle.Primary),
      makeButton('cl:modal:usury_loan', '🩸 申请黑市高利贷', ButtonStyle.Danger),
    ),
  );

  for (const loan of openLoans.slice(0, 2)) {
    const totalOwed = loan.remainingPrincipal + loan.accruedInterest;
    const tag = formatLoanShortTag(loan);
    components.push(
      buttonRow(
        makeButton(`cl:modal:repay:${loan.id}`, `💸 还款(自定义)·${tag}`, ButtonStyle.Primary),
        makeButton(
          `cl:act:repay_full:${loan.id}`,
          `✅ 一键结清·${tag} (${totalOwed.toLocaleString()})`,
          ButtonStyle.Success,
        ),
      ),
    );
  }

  components.push(
    buttonRow(
      makeButton('menu:nav:hustle', '🍑 卖屁股还债', ButtonStyle.Danger),
      makeButton('menu:nav:credit', '📜 我的信用', ButtonStyle.Secondary),
      makeButton('menu:nav:bank', '🏦 返回银行', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🔙 主菜单', ButtonStyle.Secondary),
    ),
  );

  return {
    embeds: [embed],
    components,
  };
}

export function buildHustleView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const creditCfg = ctx.services.creditLoan.getConfig(guildId);
  const stats = ctx.services.creditLoan.getHustleStats(guildId, actor.id);
  const deadbeat = ctx.services.creditLoan.isDeadbeatBlocked(guildId, actor.id, nowMs);

  const currencyName = cfg.economy.currencyName;
  const currencyEmoji = cfg.economy.currencyEmoji;

  const cooldownMs = creditCfg.hustleCooldownSec * 1000;
  const remainingMs = stats.lastHustleAt > 0 ? Math.max(0, stats.lastHustleAt + cooldownMs - nowMs) : 0;
  const onCooldown = remainingMs > 0;

  const workMin = Math.max(1, Math.min(cfg.economy.workMin, cfg.economy.workMax));
  const workMax = Math.max(workMin, Math.max(cfg.economy.workMin, cfg.economy.workMax));
  const minBase = Math.max(1, Math.floor(workMin * creditCfg.hustleMinMultiplier));
  const maxBase = Math.max(minBase, Math.floor(workMax * creditCfg.hustleMaxMultiplier));

  const cooldownText = formatDurationZh(cooldownMs);
  const cooldownLine = onCooldown
    ? `⏳ **冷却状态**：体力恢复中，剩余 **${formatDurationZh(remainingMs)}**`
    : `✅ **冷却状态**：精力充沛，现在就能上街营业！（${cooldownText}冷却）`;

  const lines = [
    `📈 **营业履历**：累计 **${stats.totalCount}** 次 ｜ 累计创收 ${currencyEmoji} **${stats.totalEarned.toLocaleString()}** ${currencyName} ｜ 历史单次最高 **${stats.bestPayout.toLocaleString()}**`,
    cooldownLine,
    '',
    `💰 **预计基础收益**：${currencyEmoji} **${minBase.toLocaleString()} ~ ${maxBase.toLocaleString()}** ${currencyName}（打工基准 ${creditCfg.hustleMinMultiplier}x ~ ${creditCfg.hustleMaxMultiplier}x）`,
    '🎲 **随机奇遇**：💎 VIP 金主包场 (1.8~2.2x) / 👀 撞见熟人封口费 (1.3~1.5x) / 🕺 常规营业 (1.0x) / 🚨 扫黄跑单 (0.85x)',
    `⚠️ **代价提醒**：每次上街营业将扣除 **-${creditCfg.hustleCreditPenalty}** 信用分，并在当前频道触发公开抽象快报！`,
  ];

  if (deadbeat.blocked) {
    lines.push(
      '',
      `🚨 **逾期自动划扣提醒**：你当前背负 **${deadbeat.totalOverdueDebt.toLocaleString()}** ${currencyName} 逾期欠款，本次营收将自动划扣 **${formatRatePercent(creditCfg.garnishRate)}** 用于偿还逾期债务！`,
    );
  }

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 下海营业还债`, iconURL: actor.avatarUrl })
    .setTitle('🍑 赛博霓虹街 · 卖屁股还债')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '赚快钱虽爽，但别忘了信用分和频道社死播报哦' })
    .setTimestamp();

  const row = buttonRow(
    makeButton('cl:act:sell_butt', '🍑 立刻上街卖屁股', ButtonStyle.Danger, onCooldown),
    makeButton('menu:rank:hustle:1', '🏆 卖屁股榜', ButtonStyle.Secondary),
    makeButton('menu:nav:loan', '💳 去还贷款', ButtonStyle.Primary),
    makeButton('menu:nav:home', '🔙 返回主菜单', ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [row],
  };
}

export function buildSellButtPublicEmbed(
  result: Extract<SellButtResult, { ok: true }>,
  actor: CreditInspectTarget,
  currencyName: string,
  currencyEmoji: string,
  cooldownSec = 3600,
): EmbedBuilder {
  const colorMap: Record<Extract<SellButtResult, { ok: true }>['eventKey'], number> = {
    vip: COLORS.GOLD,
    acquaintance: COLORS.FUN,
    normal: COLORS.PRIMARY,
    bust: COLORS.WARNING,
  };

  const detailLines = [
    result.publicAnnouncement,
    '',
    `🎬 **触发事件**：${result.eventTitle}（收益倍率 **${result.multiplier}x**）`,
    `${currencyEmoji} **本次营收**：**+${result.grossReward.toLocaleString()}** ${currencyName}`,
  ];

  if (result.garnished > 0) {
    detailLines.push(
      `⚖️ **逾期自动抵债**：-${result.garnished.toLocaleString()} ${currencyName} ｜ 实际到手 **+${result.netReward.toLocaleString()}** ${currencyName}${result.clearedLoanIds.length > 0 ? `（🎉 已顺带结清 ${result.clearedLoanIds.length} 笔逾期贷款！）` : ''}`,
    );
  }

  detailLines.push(
    `📉 **信用变动**：**${result.creditDelta}**（当前 **${result.creditScore}** · ${result.creditTier.label}）`,
    `🏆 **个人战绩**：累计营业 **${result.stats.totalCount}** 次 ｜ 总创收 **${result.stats.totalEarned.toLocaleString()}** ${currencyName}`,
  );

  return new EmbedBuilder()
    .setColor(colorMap[result.eventKey])
    .setAuthor({ name: `${actor.displayName} · 下海快报`, iconURL: actor.avatarUrl })
    .setTitle(`🍑 ${result.eventTitle}`)
    .setDescription(truncateText(detailLines.join('\n'), 4096))
    .setFooter({
      text: `${formatDurationZh(cooldownSec * 1000)}后可再次上街营业 · 使用 /贷款 或 /卖屁股 随时开启致富之路`,
    })
    .setTimestamp();
}
