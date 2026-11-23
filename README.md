# 原生中文轻量 Discord 多功能社群 Bot

零 Docker、零外置数据库（单进程 + SQLite WAL 单文件 `data/bot.db`），全中文交互与 Discord 客户端指令本地化（`/等级`、`/排行榜`、`/签到`、`/商店`、`/抽奖`、`/工单`、`/身份组面板` 等）。

## 功能一览

- **📈 等级与热度系统**：聊天防刷冷却（默认 15 秒）+ 活跃连击热度倍率（最高 `2.0x`）+ 频道自定义倍率/黑名单 + 语音挂机经验 + 升级奖励星币与身份组（支持叠加或替换）。
- **🪙 经济与娱乐系统**：`/签到`（连签加成）、`/打工`、`/打劫`（防盗护盾）、`/钱包`、`/转账`、`/猜大小`、`/老虎机`、`/二十一点`（按钮互动）、`/商店` & `/背包`（身份组、称号、经验加成卡）。
- **🎴 轻娱乐互动**：`/运势`（每日一签）、`/互动`（摸头/抱抱/贴贴/戳一戳/投喂/丢雪球累计次数）、`/称号`。
- **👋 欢迎与离开**：自定义 `{user}` `{username}` `{server}` `{memberCount}` `{inviter}` 模板、离开通知、入群自动身份组。
- **🎫 工单系统**：按钮弹窗创建私密客服频道、拉人/踢人、关闭归档发日志。
- **🎁 抽奖系统**：支持 `10m`/`2h`/`3d`/`30分钟` 格式、按钮报名/取消、最低等级与指定身份组门槛、重抽。
- **📨 邀请追踪**：实时追踪邀请码使用量，联动欢迎消息 `{inviter}` 与 `/排行榜` 邀请榜。
- **🎭 自助身份组面板**：支持按钮 / 下拉菜单、单选互斥 / 自由多选。
- **🛡️ 权限隔离**：支持通过 `/设置 添加管理员身份组` 配置 Bot 专属管理身份组。

---

## 第一步：创建 Discord Bot（Developer Portal）

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications) 新建应用并进入 **Bot** 页面：
   - 点击 **Reset Token** 获取 `DISCORD_TOKEN`
   - 打开全部 3 个 **Privileged Gateway Intents**：
     - `Presence Intent`
     - `Server Members Intent`（欢迎消息、自动身份组、工单/抽奖身份组校验必需）
     - `Message Content Intent`（聊天经验统计必需）
2. 进入 **OAuth2 → URL Generator**：
   - Scopes 勾选 `bot`、`applications.commands`
   - Bot Permissions 勾选：`Manage Roles`、`Manage Channels`、`Manage Guild`（用于邀请追踪）、`Send Messages`、`Embed Links`、`Read Message History`、`View Channels`
   - 复制链接将 Bot 邀请进你的服务器。
   - ⚠️ 在服务器设置 → **身份组** 中，把 Bot 自己的身份组拖动到需要发放的奖励/商店/自选身份组**上方**。

---

## 第二步：安装与注册斜杠指令

```bash
cp .env.example .env
# 编辑 .env 填入 DISCORD_TOKEN 和 DISCORD_CLIENT_ID（可选填测试服 DISCORD_GUILD_ID 秒级同步）

pnpm install
pnpm run build
pnpm run deploy-commands
```

验证真实 Discord API 连通性（连续 3 次请求校验）：

```bash
pnpm run e2e
```

---

## 第三步：在海外 VPS 上长期运行

### 方式 A：PM2 守护（推荐）

```bash
npm install -g pm2
pnpm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 方式 B：systemd 服务

将项目放在 `/opt/zh-discord-bot` 后：

```bash
sudo cp deploy/discord-bot.service /etc/systemd/system/discord-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now discord-bot
sudo journalctl -u discord-bot -f
```

## 数据备份

所有配置和玩家数据全部保存在 `data/bot.db`（开启了 WAL 模式）。备份时直接复制整个 `data/` 目录（或停止进程后复制 `data/bot.db`）即可完整迁移。
