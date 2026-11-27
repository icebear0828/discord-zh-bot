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
import type { ModuleKey } from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import { COLORS } from '../embeds.js';
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
} from '../menuShared.js';

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
  { key: 'imageGen', label: 'AI 绘图', emoji: '🎨' },
  { key: 'creditLoan', label: '征信与借贷', emoji: '🏦' },
  { key: 'rpg', label: '奇幻RPG地牢', emoji: '⚔️' },
];

function buildOptionalChannelSelectRow(
  customId: string,
  placeholder: string,
  defaultChannelId: string | null,
): ActionRowBuilder<ChannelSelectMenuBuilder> {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread)
    .setMinValues(0)
    .setMaxValues(1);
  if (defaultChannelId) {
    select.setDefaultChannels([defaultChannelId]);
  }
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select);
}

function buildSingleUserSelectRow(
  customId: string,
  placeholder: string,
): ActionRowBuilder<UserSelectMenuBuilder> {
  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1),
  );
}

function appendResetFooterRows(
  components: MenuComponentRow[],
  confirmReset: boolean,
  opts: {
    confirmId: string;
    confirmLabel: string;
    cancelId: string;
    resetId: string;
    resetLabel: string;
  },
): void {
  if (confirmReset) {
    components.push(
      buttonRow(
        makeButton(opts.confirmId, opts.confirmLabel, ButtonStyle.Danger),
        makeButton(opts.cancelId, '❌ 取消恢复', ButtonStyle.Secondary),
      ),
    );
  }
  components.push(
    buttonRow(
      ...(confirmReset ? [] : [makeButton(opts.resetId, opts.resetLabel, ButtonStyle.Danger)]),
      makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );
}

export function buildAdminOverviewView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const modLine = MODULE_META.map((m) => `${cfg.modules[m.key] ? '✅' : '⛔'} ${m.label}`).join(' ｜ ');
  const adminUsersText =
    cfg.adminUserIds.length > 0
      ? cfg.adminUserIds.map((id) => `<@${id}>`).join('、')
      : '未单独指定（仅限服务器管理员）';
  const adminRolesText =
    cfg.adminRoleIds.length > 0 ? cfg.adminRoleIds.map((id) => `<@&${id}>`).join('、') : '无';

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
        makeButton('menu:nav:admin_image', '🎨 AI 生图配置', ButtonStyle.Primary),
        makeButton('menu:nav:admin', '🔄 刷新配置', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildAdminCreditRpgView(
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
        makeButton('menu:admin:reset_hustle_cd', '🔄 重置全服卖屁股冷却', ButtonStyle.Secondary),
        makeButton('menu:admin:reset_credit_rpg', '♻️ 恢复默认参数', ButtonStyle.Danger),
        makeButton('menu:nav:admin', '⬅️ 管理后台', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildAdminEconView(
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
  appendResetFooterRows(components, confirmReset, {
    confirmId: 'menu:admin:reset_econ:confirm',
    confirmLabel: '✅ 确认恢复经济默认',
    cancelId: 'menu:nav:admin_econ:cancel',
    resetId: 'menu:admin:reset_econ',
    resetLabel: '♻️ 恢复经济默认',
  });

  return { embeds: [embed], components };
}

export function buildAdminLvlView(
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

  const components: MenuComponentRow[] = [
    buildOptionalChannelSelectRow(
      'menu:chan:admin_lvl_announce',
      '📢 选择统一升级播报频道（清空则随当前发言频道）...',
      l.announceChannelId,
    ),
    buttonRow(
      makeButton('menu:modal:admin_xp', '💬 经验与冷却', ButtonStyle.Primary),
      makeButton('menu:modal:admin_heat', '🔥 热度与奖励', ButtonStyle.Primary),
      makeButton('menu:modal:admin_lvl_msg', '📝 升级提示语', ButtonStyle.Primary),
      makeButton('menu:nav:admin_lvl_rewards', '🎖️ 升级奖励身份组', ButtonStyle.Primary),
    ),
    buttonRow(
      makeButton('menu:admin:toggle_voice', `🎙️ 语音经验: ${l.voiceEnabled ? '开' : '关'}`, l.voiceEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      makeButton('menu:admin:toggle_announce', `📢 升级播报: ${l.announceEnabled ? '开' : '关'}`, l.announceEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
      makeButton('menu:admin:toggle_announce_channel', l.announceChannelId ? '📌 解绑播报频道' : '📌 设当前为播报频道', ButtonStyle.Secondary),
      makeButton('menu:admin:toggle_stack_roles', `🏷️ 叠加身份组: ${l.stackRoles ? '保留旧组' : '仅留最高'}`, l.stackRoles ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  ];
  appendResetFooterRows(components, confirmReset, {
    confirmId: 'menu:admin:reset_lvl:confirm',
    confirmLabel: '✅ 确认恢复等级默认',
    cancelId: 'menu:nav:admin_lvl:cancel',
    resetId: 'menu:admin:reset_lvl',
    resetLabel: '♻️ 恢复等级默认',
  });

  return { embeds: [embed], components };
}

export function buildAdminModView(
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

export function buildAdminOpsView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const adminUsersText =
    cfg.adminUserIds.length > 0 ? cfg.adminUserIds.map((id) => `<@${id}>`).join('、') : '暂无单独授权用户';
  const adminRolesText =
    cfg.adminRoleIds.length > 0 ? cfg.adminRoleIds.map((id) => `<@&${id}>`).join('、') : '无';
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

  return {
    embeds: [embed],
    components: [
      buildSingleUserSelectRow('menu:user:admin_grant', truncateText(`💸 选择一位群友发放/扣除${currencyName}（最高 10 亿）...`, 150)),
      buildSingleUserSelectRow('menu:user:admin_toggle_user', '👑 选择一位群友添加或移除 Bot 管理员...'),
      buildSingleUserSelectRow('menu:user:admin_set_stat', truncateText(`📏 选择一位群友设置${cfg.leveling.statName}（${cfg.leveling.statUnit}）...`, 150)),
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

export function buildAdminGamesView(
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
    `⚡ **世界事件 / Boss / 宝箱**：自动触发 ${g.eventAutoEnabled ? '✅ 开启' : '⛔ 关闭'} ｜ 指定频道 ${g.eventChannelId ? `<#${g.eventChannelId}>` : '自动锁定 #游戏聊天（未找到则暂停刷出）'}`,
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

  return {
    embeds: [embed],
    components: [
      buildOptionalChannelSelectRow(
        'menu:chan:admin_games_event',
        '⚡ 选择世界事件指定频道（默认自动锁定 #游戏聊天）...',
        g.eventChannelId,
      ),
      buttonRow(
        makeButton('menu:modal:admin_props', '🧰 道具价格', ButtonStyle.Primary),
        makeButton('menu:modal:admin_events', '🎁 事件与Boss', ButtonStyle.Primary),
        makeButton('menu:modal:admin_pets_cp', '🐾 宠物与CP', ButtonStyle.Primary),
        makeButton('menu:modal:admin_bounty', '🎯 悬赏参数', ButtonStyle.Primary),
      ),
      buttonRow(
        makeButton('menu:admin:toggle_auto_event', `⚡ 自动事件: ${g.eventAutoEnabled ? '开' : '关'}`, g.eventAutoEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        makeButton('menu:admin:toggle_event_channel', g.eventChannelId ? '📌 解绑事件频道' : '📌 设当前为事件频道', ButtonStyle.Secondary),
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
