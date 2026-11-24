# 原生中文轻量 Discord 多功能社群 Bot

零 Docker、零外置数据库（单进程 TypeScript ESM + `discord.js` v14 + SQLite WAL 单文件 `data/bot.db`），内置全部 **25 个斜杠指令** 与 Discord 客户端原生中文指令本地化（`/菜单`、`/等级`、`/排行榜`、`/签到`、`/商店`、`/抽奖`、`/工单`、`/身份组面板` 等）。

> 📘 完整系统分层、交互树、`customId` 路由、数值公式与 28 表数据库说明请查看：**[架构与运维文档 (`docs/ARCHITECTURE.md`)](docs/ARCHITECTURE.md)**

---

## 核心功能亮点

- **🎛️ 一站式可视化 `/菜单`（`/menu`）控制面板**：
  - **个人面板（默认）**：Ephemeral 仅自己可见、就地刷新不刷屏，直达独立游玩、多人博弈、吃瓜事件、关系宠物、银行保险柜、商店背包、名片（支持 `✏️ 编辑身份证` 自定义昵称/标签/简介/颜色）、`🎭 自助领身份组`、排行榜（点击即在频道公开可翻页/切榜的互动排行榜，群友都能看到）及管理员 `⚙️ 管理后台`（含经济/等级/等级奖励/自定义升级语/自助身份组/新玩法与事件/11 模块开关/发币设数值与管理员授权等 **8 个**可视化配置界面）。
  - **永久大厅入口（`/菜单 模式:lobby`）**：管理员可在频道发送永久大厅卡片，群友点击「🎛️ 打开我的互动菜单」即可唤醒个人面板。
- **💣 多人整蛊与博弈（`/菜单` → 多人博弈）**：
  - **黑市道具**：`🪤 捕兽夹`（反抓小偷双倍赔款）、`🗝️ 万能撬锁`（偷钱率 `+25%`）、`🛡️ 防盗保险`（立即开 4h 盾）、`🧿 衰神符`（目标下次打工减半）、`🎭 改昵称卡`（强改昵称；群主、服务器管理员、Bot 管理员及更高身份组成员均受保护且不扣卡）。
  - **🎯 悬赏通缉**：多人叠加悬赏，成功偷钱或决斗击败目标即领走全额赏金池（支持 `1.5x` 自费撤单）。
  - **🔫 俄罗斯轮盘 & 💣 数字炸弹**：2~6 人吃鸡轮流扣扳机（30s 超时代扣）；频道自由抢猜缩小安全区间，踩雷赔金平分给存活者。
  - **🔕 通知防打扰分级**：普通打劫/偷钱、转账、趣味互动、游戏喜报、名片与排行榜等常规广播默认关闭 `@` 推送；仅悬赏通缉、决斗约战、CP 求婚/结拜与定向宠物对战等需响应事件会真实艾特当事成员。
- **🎯 全群吃瓜开盘 & 世界事件（`/菜单` → 吃瓜事件）**：
  - **自由吃瓜开盘**：任意群友发起 2~4 选项话题盘口，动态赔率平分总奖池，开盘人/管理员结算或作废退币。
  - **🎁 天降宝箱 & 👹 世界 Boss**：活跃发言达阈值后自动刷出或管理员一键召唤；协同讨伐按伤害占比瓜分奖池 + 尾刀 MVP `+25%` 暴击大奖。
- **💞 结婚 / 结拜 CP & 🐾 盲盒宠物斗兽场（`/菜单` → 关系宠物）**：
  - **轻量 CP 绑定**：1v1 求婚与多人结拜（无共同金库/不分割财产），每日打卡涨亲密度解锁专属称号并登亲密榜。
  - **盲盒抽宠与 PVP**：20 种 N/R/SR/SSR 搞怪宠物，支持喂食/训练/打工升级与频道公开回合制斗兽场押注对战。
- **🏦 银行保险柜与每日利息**：区分「口袋现金」与「银行存款」，银行存款**完全免疫打劫与偷钱**，满额每天还可按配置利率领取每日利息（按 `TIMEZONE` 日切重置，富豪榜按总资产排行）。
- **⚔️ PVP 骰子决斗 & 🧧 拼手气红包**：支持公开 3 骰押注决斗，以及 2~20 份二倍均值随机拼手气红包（过期未领完自动退回）。
- **📈 等级、热度与独立成长数值**：前期快速升级、后期陡峭的三次经验曲线 + 聊天防刷冷却（默认 15 秒）+ 活跃连击热度倍率（最高 `2.0x`）+ 频道白名单 (`allowedChannelIds`) / 忽略频道 / 自定义倍率 + 语音挂机经验 + 自定义升级公告标题/文案模板 + 升级奖励星币与身份组（支持叠加或替换）+ 与等级解耦的独立成长数值（可自定义名称 `statName` 与单位 `statUnit`，支持专属排行榜及 `/等级管理 set-stat` / 管理后台自由设置）+ 个人身份证名片定制（昵称/标签/简介/颜色）。
- **🪙 经济与娱乐系统**：`/签到`（连签加成）、`/打工`、`/打劫`（防盗护盾 + 肥羊榜）、`/钱包`、`/转账`、`/猜大小`、`/老虎机`、`/二十一点`（按钮互动）、`/商店` & `/背包`（身份组、专属称号、经验加成卡）。
- **🎴 轻娱乐互动**：`/运势`（每日一签）、`/互动`（摸头/抱抱/贴贴/戳一戳/投喂/丢雪球并累计次数）、`/称号`。
- **👋 欢迎与离开**：支持 `{user}` `{username}` `{server}` `{memberCount}` `{inviter}` 模板、离开通知、入群自动身份组与预览。
- **🎫 工单与 🎁 抽奖**：弹窗提交创建私密工单频道、拉人/踢人、关闭归档日志；支持 `10m`/`2h`/`3d`/`30分钟` 定时抽奖、等级与身份组门槛、重抽。
- **📨 邀请追踪 & 🎭 自助身份组面板**：实时追踪邀请码与欢迎联动；支持按钮/下拉菜单、单选互斥/自由多选（最多 25 项）。
- **🛡️ 权限隔离与模块化控制**：支持通过 `/设置 添加管理员身份组`、`/设置 添加管理员用户` 或 `/菜单` 管理后台可视化授权 Bot 管理员，并支持全部 11 大功能模块独立开关与 `GamesConfig` 21 项玩法数值实时调参。

---

## 全部 25 个斜杠指令一览

| 模块 | 指令（英文 / 中文） |
| --- | --- |
| **通用与总控** | `/menu`（`/菜单` · 繁 `/選單`）、`/help`（`/帮助`）、`/config`（`/设置`） |
| **等级与排行** | `/rank`（`/等级`）、`/leaderboard`（`/排行榜`）、`/level-admin`（`/等级管理`） |
| **经济与小游戏** | `/balance`（`/钱包`）、`/daily`（`/签到`）、`/work`（`/打工`）、`/rob`（`/打劫`）、`/pay`（`/转账`）、`/dice`（`/猜大小`）、`/slots`（`/老虎机`）、`/blackjack`（`/二十一点`）、`/shop`（`/商店`）、`/inventory`（`/背包`） |
| **娱乐互动** | `/fortune`（`/运势`）、`/interact`（`/互动`）、`/title`（`/称号`） |
| **社群运维工具** | `/welcome-config`（`/欢迎设置`）、`/ticket-config`（`/工单设置`）、`/ticket`（`/工单`）、`/giveaway`（`/抽奖`）、`/invites`（`/邀请`）、`/role-panel`（`/身份组面板`） |

---

## 第一步：创建并配置 Discord Bot（Developer Portal）

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications) 新建应用并进入 **Bot（机器人）** 页面：
   - 点击 **Reset Token** 获取 `DISCORD_TOKEN`（妥善保管，切勿提交到仓库）。
   - 在 **Public Bot（公开机器人）** 下，**关闭第 2 个开关 `Requires OAuth2 Code Grant`**（避免邀请进服时报错 `Integration requires code grant`）。
   - 打开全部 3 个 **Privileged Gateway Intents**：
     - `Presence Intent`
     - `Server Members Intent`（欢迎消息、自动身份组、工单/抽奖身份组校验必需）
     - `Message Content Intent`（聊天经验统计必需）
2. 进入 **OAuth2 → URL Generator**：
   - Scopes 勾选 `bot`、`applications.commands`
   - Bot Permissions 勾选：`Manage Roles`、`Manage Channels`、`Manage Guild`（用于邀请追踪）、`Send Messages`、`Embed Links`、`Read Message History`、`View Channels`
   - 复制生成的 URL 将 Bot 邀请进你的服务器。
   - ⚠️ 在服务器设置 → **身份组** 中，务必把 Bot 自己的身份组拖动到需要发放的奖励/商店/自选身份组**上方**。

---

## 第二步：安装、测试与注册斜杠指令

```bash
cp .env.example .env
# 编辑 .env 填入 <YOUR_BOT_TOKEN> 和 <YOUR_CLIENT_ID>
# 可选填测试服 DISCORD_GUILD_ID 实现秒级同步；留空则全局注册

pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
pnpm run deploy-commands
```

验证真实 Discord REST API 连通性（连续 3 次请求校验）：

```bash
pnpm run e2e
```

---

## 第三步：在 VPS 上长期运行

### 方式 A：systemd 服务（推荐）

将项目部署到 `<YOUR_VPS_HOST>` 的 `/opt/zh-discord-bot` 后（若在 VPS 上裁剪 dev 依赖，请务必在 `npm prune --omit=dev` **之前**执行 `npm run deploy-commands` 与 `npm run e2e`，因为二者依赖 `devDependencies` 中的 `tsx`）：

```bash
npm install
npm run build
npm run deploy-commands
npm run e2e
npm prune --omit=dev
sudo cp deploy/discord-bot.service /etc/systemd/system/zh-discord-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now zh-discord-bot
sudo journalctl -u zh-discord-bot -f
```

### 方式 B：PM2 守护

```bash
npm install -g pm2
pnpm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## 数据备份

所有配置与玩家数据全部保存在 `data/bot.db`（开启了 SQLite `WAL` 模式）。停服冷备时请直接打包复制整个 `data/` 目录；热备时请使用 `sqlite3 data/bot.db ".backup '/path/to/backup/bot.db'"` 导出一致性快照。
