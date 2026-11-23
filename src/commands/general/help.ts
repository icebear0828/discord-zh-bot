import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { ModuleKey } from '../../config/defaults.js';
import { COLORS, type AppContext, type CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';

export const HELP_CATEGORIES: ReadonlyArray<{
  key: 'overview' | ModuleKey;
  label: string;
  emoji: string;
  description: string;
  lines: readonly string[];
}> = [
  {
    key: 'overview',
    label: '总览菜单',
    emoji: '📖',
    description: '查看机器人所有模块概览与核心指令',
    lines: [
      '• **✨ 一站式互动入口**：`/菜单`（推荐！点点按钮即可玩转签到、打工、小游戏、银行、红包、决斗、商店与排行）',
      '• **等级热度**：`/等级` `/排行榜` `/等级管理`（聊天频率连击最高 2.0x + 语音挂机经验）',
      '• **经济与多人**：`/菜单` `/签到` `/打工` `/打劫` `/钱包` `/转账` `/猜大小` `/老虎机` `/二十一点`（含银行、红包、决斗）',
      '• **商店与趣味**：`/商店` `/背包` `/运势` `/互动` `/称号`',
      '• **服务器工具**：`/欢迎设置` `/工单设置` `/工单` `/抽奖` `/邀请` `/身份组面板` `/设置`',
    ],
  },
  {
    key: 'leveling',
    label: '等级与热度',
    emoji: '📈',
    description: '聊天连击倍率、语音经验、排行榜与升级奖励',
    lines: [
      '`/等级 [用户]` — 查看当前等级、经验进度条、排名、活跃热度倍率与经验卡状态',
      '`/排行榜 [类型]` — 查看经验榜 / 星币榜 / 邀请榜（支持按钮翻页）',
      '`/等级管理` — 管理员设置升级奖励身份组、升级播报频道、频道倍率、忽略频道、语音经验等',
    ],
  },
  {
    key: 'economy',
    label: '经济与商店',
    emoji: '🪙',
    description: '签到、打工、银行、红包、决斗、小游戏与商店道具',
    lines: [
      '**✨ 推荐统一入口：`/菜单`** — 可视化交互面板直达全部经济、银行与多人玩法！',
      '`/签到` `/打工` `/打劫 <目标>` `/钱包 [用户]` `/转账 <用户> <金额>`',
      '**🏦 银行保险柜**（`/菜单` → 银行存钱）：存钱防偷安全，存款满额每日可领利息',
      '**⚔️ 骰子决斗 & 🧧 拼手气红包**（`/菜单` → 多人互动）：群聊发起 3 骰押注决斗、派发随机拼手气红包',
      '`/猜大小 <金额> <选项>` — 押大 / 押小 / 豹子（豹子 10 倍赔率）',
      '`/老虎机 <金额>` — 三连 7️⃣ 最高 15 倍奖金',
      '`/二十一点 <金额>` — 互动按钮：要牌 / 停牌 / 双倍下注',
      '`/商店` `/背包` — 购买与使用身份组、专属称号、双倍经验卡',
    ],
  },
  {
    key: 'fun',
    label: '娱乐与称号',
    emoji: '🎴',
    description: '每日运势、群友互动与自定义称号',
    lines: [
      '`/运势` — 抽取今日运势签（大吉~小凶、宜/忌、幸运数字及每日首抽奖励）',
      '`/互动 <动作> <对象>` — 摸头、抱抱、贴贴、戳一戳、投喂、丢雪球（累计互动次数）',
      '`/称号` — 查看、佩戴、卸下或由管理员授予专属称号',
    ],
  },
  {
    key: 'welcome',
    label: '欢迎与离开',
    emoji: '👋',
    description: '入群欢迎语、退群提示与自动身份组',
    lines: [
      '`/欢迎设置 设置欢迎` — 绑定欢迎频道与支持 `{user}` `{username}` `{server}` `{memberCount}` `{inviter}` 的模板',
      '`/欢迎设置 设置离开` — 配置成员离开提示',
      '`/欢迎设置 添加自动身份组` / `预览` — 入群自动发放身份组并实时预览效果',
    ],
  },
  {
    key: 'tickets',
    label: '工单系统',
    emoji: '🎫',
    description: '私密客服工单频道与权限管理',
    lines: [
      '`/工单设置 配置` — 设置工单分类、客服身份组、日志频道与单人最大开启数',
      '`/工单设置 发送面板` — 发送带「创建工单」按钮的面板，点击后弹窗填写主题并建私密频道',
      '`/工单 添加成员` / `移除成员` / `关闭` — 在工单频道内管理成员与关闭工单',
    ],
  },
  {
    key: 'giveaways',
    label: '抽奖系统',
    emoji: '🎁',
    description: '按钮参与、定时开奖与门槛限制',
    lines: [
      '`/抽奖 发起` — 支持 `10m` / `2h` / `3d` 或 `10分钟` 等时长，可限制最低等级或指定身份组',
      '`/抽奖 开奖` / `重抽` / `列表` — 提前开奖、重新抽取获奖者或查看进行中抽奖',
    ],
  },
  {
    key: 'invites',
    label: '邀请追踪',
    emoji: '📨',
    description: '自动识别邀请链接与邀请排行榜',
    lines: [
      '`/邀请 [用户]` — 查看个人累计邀请人数与近期邀请记录',
      '可与欢迎消息 `{inviter}` 模板及 `/排行榜` 邀请榜联动展示',
    ],
  },
  {
    key: 'rolePanels',
    label: '自助身份组',
    emoji: '🎭',
    description: '按钮/下拉菜单、单选互斥与多选面板',
    lines: [
      '`/身份组面板 创建` — 选择按钮或下拉菜单、单选互斥或自由多选模式',
      '`/身份组面板 添加选项` / `发送` — 最多 25 个身份组选项，一键发布到频道',
    ],
  },
];

export function buildHelpMessage(categoryKey: string): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const cat =
    HELP_CATEGORIES.find((c) => c.key === categoryKey) ?? HELP_CATEGORIES[0]!;

  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`${cat.emoji} 帮助中心 — ${cat.label}`)
    .setDescription(`${cat.description}\n\n${cat.lines.join('\n')}`)
    .setFooter({ text: '提示：可通过下方菜单切换不同功能模块查看详细说明' })
    .setTimestamp();

  const select = new StringSelectMenuBuilder()
    .setCustomId('help:category')
    .setPlaceholder('选择要查看的功能模块...')
    .addOptions(
      HELP_CATEGORIES.map((c) => ({
        label: c.label,
        value: c.key,
        description: c.description,
        emoji: c.emoji,
        default: c.key === cat.key,
      })),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  return { embeds: [embed], components: [row] };
}

export const helpCommand: CommandDefinition = {
  name: 'help',
  data: applyZh(
    new SlashCommandBuilder().setName('help').setDescription('查看全部功能说明与指令菜单'),
    '帮助',
    '查看全部功能说明与指令菜单',
  ),
  async execute(interaction: ChatInputCommandInteraction, _ctx: AppContext): Promise<void> {
    await interaction.reply(buildHelpMessage('overview'));
  },
};
