import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
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
      '• **✨ 一站式互动入口**：`/菜单`（推荐！点点按钮即可玩转签到、打工、小游戏、银行借贷、卖屁股、西幻RPG地牢、红包、决斗、黑市道具、悬赏、轮盘、数字炸弹、吃瓜开盘、宝箱/Boss、CP与宠物！）',
      '• **等级与榜单**：`/等级` `/排行榜` `/等级管理`（聊天连击倍率 + 语音挂机经验，12 大榜单：经验/富豪/成长/邀请/信用/老赖/卖屁股/赌神/冤大头/RPG/CP亲密/悬赏）',
      '• **经济与借贷**：`/签到` `/打工` `/打劫` `/钱包` `/转账` `/决斗` `/信用` `/贷款` `/卖屁股` `/猜大小` `/老虎机` `/二十一点`（含银行、红包、整蛊与吃瓜）',
      '• **冒险与趣味**：`/冒险`（西幻 Roguelike 地下城） `/商店` `/背包` `/运势` `/互动` `/称号`',
      '• **AI 陪聊与记忆**：`@机器人` 或直接回复即可对话（支持识图与长期记忆），`/ai 重置` `/ai 记忆`',
      '• **AI 独立生图**：`/画图` 或 `/菜单` → 「🎨 AI 绘图」（独立生图模型，与聊天记忆完全隔离）',
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
      '`/排行榜 [类型]` — 查看经验榜 / 富豪榜 / 成长榜 / 邀请榜（默认私密展示，支持翻页与晒到公屏）',
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
      '**🏦 银行金库**（`/菜单` → 银行存钱）：风险远低于口袋现金，存款满额每日可领利息（仍需防范低概率金库劫案）',
      '**⚔️ 多人决斗大厅 & 🧧 拼手气红包**（`/决斗` 或 `/菜单` → 多人博弈）：骰子决斗、石头剪刀布 Bo5（赢家限时反复改名）、1v1 俄罗斯轮盘（赌币/改名/禁言/文字赌约）与拼手气红包',
      '`/猜大小 <金额> <选项>` — 押大 / 押小 / 豹子（豹子 10 倍赔率）',
      '`/老虎机 <金额>` — 三连 7️⃣ 最高 15 倍奖金',
      '`/二十一点 <金额>` — 互动按钮：要牌 / 停牌 / 双倍下注',
      '`/商店` `/背包` — 购买与使用身份组、专属称号、经验卡、成长道具、宠物经验、自定义称号券与盲盒',
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
  {
    key: 'socialGames',
    label: '整蛊与博弈',
    emoji: '💣',
    description: '黑市攻防道具、悬赏通缉、俄罗斯轮盘、数字炸弹',
    lines: [
      '全部入口已收纳进 **`/菜单` → 多人博弈**：',
      '• **🧰 黑市道具**：捕兽夹反抓小偷、万能撬锁提高打劫率、防盗盾、衰神符减半打工、改昵称卡',
      '• **🎯 悬赏通缉**：多人叠加悬赏，成功偷钱或决斗击败目标即领走全额赏金池',
      '• **⚔️ 决斗大厅**（`/决斗`）：石头剪刀布 Bo5 限时改名、1v1 俄罗斯轮盘多赌注对决、3 骰押注决斗',
      '• **🔫 多人俄罗斯轮盘 & 💣 数字炸弹**：2~6人上桌吃鸡、频道自由抢猜踩雷分罚金',
    ],
  },
  {
    key: 'worldEvents',
    label: '吃瓜与世界事件',
    emoji: '🎯',
    description: '自由吃瓜开盘押注、天降宝箱与合力打世界 Boss',
    lines: [
      '全部入口已收纳进 **`/菜单` → 吃瓜事件**：',
      '• **📊 吃瓜开盘**：任意群友发起 2~4 选项盘口，动态赔率平分总奖池',
      '• **🎁 天降宝箱 & 👹 世界 Boss**：活跃发言自动/管理员召唤触发，全群抢宝箱或合力打 Boss 分奖池+尾刀大奖',
    ],
  },
  {
    key: 'petsAndCp',
    label: '关系与宠物',
    emoji: '💞',
    description: '结婚/结拜 CP 打卡称号、盲盒电子宠物与斗兽场 PVP',
    lines: [
      '全部入口已收纳进 **`/菜单` → 关系宠物**：',
      '• **💍 结婚/结拜 CP**：公开求婚/结拜仪式，每日打卡涨亲密度解锁专属称号并登亲密榜',
      '• **🐾 盲盒宠物 & 🏟️ 斗兽场**：N/R/SR/SSR 盲盒抽宠、喂食训练打工、频道公开宠物回合制 PVP 押注',
    ],
  },
  {
    key: 'ai',
    label: 'AI 对话',
    emoji: '🤖',
    description: '人格陪聊、图片识图、上下文记忆与后台热切换',
    lines: [
      '• **触发对话**：在群聊中 `@机器人` 或直接**回复**机器人消息（或在管理员设置的免 `@` 频道直接说话）即可对话，支持发图识图',
      '• **`/ai 重置`**：清空当前频道短期上下文，开启新话题（长期记忆不受影响）',
      '• **`/ai 记忆 查看/添加/删除/清空`**：管理个人、频道或全服级 AI 长期记忆',
      '• **管理员配置**：在 `/菜单` → 「⚙️ 管理后台 → 🤖 AI 对话配置」切换人格预设、编辑人设/世界书与频道规则',
    ],
  },
  {
    key: 'imageGen',
    label: 'AI 绘图',
    emoji: '🎨',
    description: '独立生图模型、交互式绘图工作台、比例/步数/种子与历史复用',
    lines: [
      '`/画图`（不填参数直接回车）— 打开**仅自己可见**的交互式绘图工作台菜单，一键切换画幅比例、公私密出图、剧透遮罩、常驻负面词并复用最近画作',
      '`/画图 <提示词>` — 一步直接出图，支持比例、负面词、步数、引导系数、种子、剧透遮罩与私密出图（与 `@机器人` 聊天完全独立）',
      '`/菜单` → **「🎨 AI 绘图」** — 同款交互工作台；出图卡片支持下拉换比例直接重绘、再画一张、改词调参、撤回',
      '• **管理员配置**：可在工作台或 `/菜单` → 「⚙️ 管理后台 → 🎨 AI 生图配置」发送频道常驻生图入口面板、调整模型参数与频道黑白名单',
    ],
  },
  {
    key: 'creditLoan',
    label: '征信与借贷',
    emoji: '💳',
    description: '个人信用分、银行信用贷、黑市高利贷、卖屁股还债与赌徒榜',
    lines: [
      '`/信用 [用户]` — 查看信用分（0~1000）、信用等级与权益折扣/加价、群友点赞背书与举报老赖',
      '`/贷款` — 申请银行低息信用贷或黑市高利贷，支持自定义还款与一键结清（逾期禁赌禁转账、强扣还债并上催收大字报）',
      '`/卖屁股` — 1h 冷却高收益整活营业（4 种随机事件，信用分 -5，逾期自动抵债）',
      '`/排行榜` — 支持切换信用榜、老赖黑名单、卖屁股榜、赌神榜、冤大头榜等 12 大榜单',
    ],
  },
  {
    key: 'rpg',
    label: '西幻RPG秘境',
    emoji: '⚔️',
    description: '10 阶 9 重境挂机收菜、每日体力速刷 Boss、炼金秘药与全服公开渡劫',
    lines: [
      '`/冒险` 或 `/菜单` → 「⚔️ 西幻冒险」 — 免费选择 4 大职业踏入艾尔登西亚大陆',
      '• **24小时秘境挂机**：离线自动累计经验、星币与随机奇遇装备，战力与战宠提升挂机倍率',
      '• **每日体力速刷 Boss**：消耗体力瞬间扫荡当前阶 Boss（S/A/B 评级），掉落装备与晋升秘药/护魂圣水',
      '• **九重破境试炼**：满阶经验后可在 `#游戏聊天` 发起 60 秒公开渡劫，围观战友助威获赠喜糖或起哄加奖',
    ],
  },
];

export function buildHelpMessage(
  categoryKey: string,
  ownerId?: string,
): {
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
    .setCustomId(ownerId ? `help:category:${ownerId}` : 'help:category')
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
    await interaction.reply({
      ...buildHelpMessage('overview', interaction.user.id),
      flags: MessageFlags.Ephemeral,
    });
  },
};
