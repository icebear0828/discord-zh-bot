import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { EconomyConfig } from '../config/defaults.js';
import type { NumberBombGame, RouletteGame } from '../db/repositories/chaosRepo.js';
import {
  getPropPrice,
  PROP_CATALOG,
  PROP_KEYS,
  type BombPayout,
} from '../services/chaosService.js';
import { COLORS, formatDurationZh, type AppContext } from './embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltButtonMessage,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
} from './menuShared.js';

export function buildPropsView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const props = ctx.services.chaos.listUserProps(guildId, actor.id);
  const qtyMap = new Map(props.map((p) => [p.propKey, p.quantity]));
  const effects = ctx.services.chaos.listActiveEffects(guildId, actor.id, nowMs);

  const trapQty = qtyMap.get('trap') ?? 0;
  const lockQty = qtyMap.get('lockpick') ?? 0;
  const shieldQty = qtyMap.get('shield') ?? 0;
  const curseQty = qtyMap.get('curse') ?? 0;
  const nickQty = qtyMap.get('nickname') ?? 0;

  const activeStatusLines: string[] = [];
  if (effects.some((e) => e.effectKey === 'trap_armed')) {
    activeStatusLines.push('🪤 **捕兽夹已部署**：下位小偷将踩坑双倍赔款');
  }
  if (effects.some((e) => e.effectKey === 'lockpick_ready')) {
    activeStatusLines.push('🗝️ **万能撬锁已就绪**：下次打劫成功率 +25%');
  }
  if (effects.some((e) => e.effectKey === 'work_cursed')) {
    activeStatusLines.push('🧿 **衰神附体中**：下次打工收益减半');
  }
  if (profile.robShieldUntil > nowMs) {
    activeStatusLines.push(`🛡️ **防盗护盾**：剩余 ${formatDurationZh(profile.robShieldUntil - nowMs)}`);
  }

  const catalogLines = PROP_KEYS.map((key) => {
    const def = PROP_CATALOG[key];
    const price = getPropPrice(cfg.games, key);
    const owned = qtyMap.get(key) ?? 0;
    return `• ${def.emoji} **${def.name}**（**${price}** ${cfg.economy.currencyName}｜持有 **${owned}** 个）\n  ${def.description}`;
  });

  const description = [
    `${cfg.economy.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.economy.currencyName}`,
    '',
    ...catalogLines,
    ...(activeStatusLines.length > 0 ? ['', '**当前生效状态：**', ...activeStatusLines] : []),
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.WARNING, feedback))
    .setAuthor({ name: `${actor.displayName} · 黑市攻防道具`, iconURL: actor.avatarUrl })
    .setTitle('🧰 黑市整蛊与攻防道具')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '🔒 购买与自用仅自己可见；对群友使用衰神符/改昵称卡将在频道公开播报' })
    .setTimestamp();

  const buySelectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu:prop_buy')
      .setPlaceholder('🛒 选择要购买的黑市道具...')
      .addOptions(
        PROP_KEYS.map((key) => {
          const def = PROP_CATALOG[key];
          const price = getPropPrice(cfg.games, key);
          return new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(`${def.emoji} ${def.name} (${price} ${cfg.economy.currencyName})`, 100))
            .setValue(key)
            .setDescription(truncateText(def.description, 100));
        }),
      ),
  );

  const selfBtnRow = buttonRow(
    makeButton('menu:prop_use:trap', `🪤 部署捕兽夹(${trapQty})`, ButtonStyle.Success, trapQty <= 0),
    makeButton(
      'menu:prop_use:lockpick',
      `🗝️ 激活撬锁(${lockQty})`,
      ButtonStyle.Primary,
      lockQty <= 0,
    ),
    makeButton(
      'menu:prop_use:shield',
      `🛡️ 开防盗盾(${shieldQty})`,
      ButtonStyle.Success,
      shieldQty <= 0,
    ),
  );

  const curseRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:prop_curse')
      .setPlaceholder(`🧿 选择群友贴「衰神符」(持有 ${curseQty} 个)...`)
      .setMinValues(1)
      .setMaxValues(1),
  );

  const nickRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:prop_nick')
      .setPlaceholder(`🎭 选择群友用「改昵称卡」(持有 ${nickQty} 张)...`)
      .setMinValues(1)
      .setMaxValues(1),
  );

  const navRow = buttonRow(
    makeButton('menu:nav:multi', '👥 多人博弈', ButtonStyle.Secondary),
    makeButton('menu:nav:shop', '🛒 服务器商店', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [buySelectRow, selfBtnRow, curseRow, nickRow, navRow],
  };
}

export function buildBountyView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const ownBounty = ctx.services.chaos.getOpenBountyTotal(guildId, actor.id);
  const clearCost = ownBounty > 0 ? Math.ceil(ownBounty * cfg.games.bountyClearMultiplier) : 0;
  const list = ctx.services.chaos.listActiveBounties(guildId, 10);

  const boardLines =
    list.length > 0
      ? list.map(
          (item, i) =>
            `**${i + 1}.** <@${item.targetId}> — 赏金池 ${cfg.economy.currencyEmoji} **${item.totalAmount}** ${cfg.economy.currencyName}（${item.bountyCount} 笔叠加）`,
        )
      : ['当前服务器暂无通缉目标，快去悬赏个显眼包！'];

  const description = [
    `${cfg.economy.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.economy.currencyName} ｜ 最低悬赏：**${cfg.games.bountyMinAmount}** ${cfg.economy.currencyName}`,
    ownBounty > 0
      ? `🚨 **你当前被悬赏**：**${ownBounty}** ${cfg.economy.currencyName}（花 **${clearCost}** 可自费撤单）`
      : '✅ 你当前清白无悬赏在身',
    '',
    '📜 **规则**：多人可叠加悬赏同一人；任何人对该目标**偷钱成功**或**骰子决斗获胜**，立即独吞全额赏金池！',
    '',
    '🎯 **当前通缉榜：**',
    ...boardLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.ERROR, feedback))
    .setAuthor({ name: `${actor.displayName} · 全服悬赏通缉`, iconURL: actor.avatarUrl })
    .setTitle('🎯 悬赏通缉令')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 发起悬赏与自清通缉都会在当前频道公开广播' })
    .setTimestamp();

  const userRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('menu:user:bounty')
      .setPlaceholder('🎯 选择要悬赏通缉的群友...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  const btnRow = buttonRow(
    makeButton(
      'menu:bounty:clear',
      ownBounty > 0 ? `🧹 自费撤单(${clearCost})` : '🧹 自费撤单',
      ButtonStyle.Danger,
      ownBounty <= 0,
    ),
    makeButton('menu:nav:rob', '🥷 去打劫领赏', ButtonStyle.Primary),
    makeButton('menu:nav:duel', '⚔️ 决斗领赏', ButtonStyle.Secondary),
    makeButton('menu:nav:multi', '👥 多人博弈', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [userRow, btnRow] };
}

export function buildRouletteView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const games = ctx.services.chaos.listActiveRoulettes(guildId, 10);
  const recruiting = games.filter((g) => g.status === 'recruiting').slice(0, 25);

  const gameLines =
    games.length > 0
      ? games.map((g) => {
          const tag = g.status === 'recruiting' ? '🟡 招募中' : '🔴 激战中';
          return `• **#${g.id}** [${tag}] 房主 <@${g.hostId}>｜入场 **${g.entryFee}**｜人数 **${g.players.length}/${g.maxPlayers}**`;
        })
      : ['当前暂无进行中的轮盘房间，点下方按钮立即在频道开一桌！'];

  const description = [
    `${cfg.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.currencyName}`,
    '',
    '🔫 **2~6人吃鸡规则**：6孔左轮装1发实弹，顺位轮流扣扳机（30秒超时自动代扣），中弹淘汰后重装弹匣，最后唯一幸存者**独吞总奖池**！',
    '',
    '**进行中的牌桌：**',
    ...gameLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.ERROR, feedback))
    .setAuthor({ name: `${actor.displayName} · 俄罗斯轮盘`, iconURL: actor.avatarUrl })
    .setTitle('🔫 俄罗斯轮盘赌局')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 建房后将在当前频道发出公开赌桌卡片，群友均可点击上桌' })
    .setTimestamp();

  const components: MenuComponentRow[] = [];

  if (recruiting.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('menu:roulette_join')
          .setPlaceholder('🪑 选择一个招募中的房间快速上桌...')
          .addOptions(
            recruiting.map((g) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(
                  truncateText(
                    `#${g.id} 轮盘 (入场 ${g.entryFee} ${cfg.currencyName} | ${g.players.length}/${g.maxPlayers}人)`,
                    100,
                  ),
                )
                .setValue(String(g.id))
                .setDescription('点击立即支付入场费上桌'),
            ),
          ),
      ),
    );
  }

  components.push(
    buttonRow(
      makeButton('menu:roulette:new:100', '🔫 开100币局', ButtonStyle.Danger),
      makeButton('menu:roulette:new:300', '🔫 开300币局', ButtonStyle.Danger),
      makeButton('menu:roulette:new:500', '🔫 开500币局', ButtonStyle.Danger),
      makeButton('menu:modal:roulette', '⌨️ 自定义建房', ButtonStyle.Secondary),
    ),
  );

  components.push(
    buttonRow(
      makeButton('menu:nav:roulette', '🔄 刷新房间', ButtonStyle.Secondary),
      makeButton('menu:nav:multi', '👥 多人博弈', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

export function buildBombView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const bombs = ctx.services.chaos.listOpenNumberBombs(guildId, 10);

  const bombLines =
    bombs.length > 0
      ? bombs.map(
          (b) =>
            `• **#${b.id}** 范围 **[${b.minBound} ~ ${b.maxBound}]**｜踩雷罚金 **${b.penalty}**｜存活参与者 **${b.participants.length}** 人`,
        )
      : ['当前暂无进行中的数字炸弹，点下方按钮立即向频道丢一颗！'];

  const description = [
    `${cfg.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.currencyName}`,
    '',
    '💣 **规则**：系统在 2~99 埋下一颗炸弹，群友在频道自由抢猜缩小区间（不可连猜，需现金 >= 罚金）。谁猜中雷谁掏罚金，**平分给本局其他所有存活参与者**！',
    '',
    '**进行中的炸弹：**',
    ...bombLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.WARNING, feedback))
    .setAuthor({ name: `${actor.displayName} · 数字炸弹`, iconURL: actor.avatarUrl })
    .setTitle('💣 频道数字炸弹')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 丢出炸弹后在频道发出公开卡片，点击按钮抢猜即可！' })
    .setTimestamp();

  const components: MenuComponentRow[] = [];

  if (bombs.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('menu:bomb_pick')
          .setPlaceholder('💣 选择进行中的炸弹直接开猜...')
          .addOptions(
            bombs.slice(0, 25).map((b) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(
                  truncateText(
                    `#${b.id} 范围 [${b.minBound}~${b.maxBound}] (罚金 ${b.penalty})`,
                    100,
                  ),
                )
                .setValue(String(b.id))
                .setDescription(`已有 ${b.participants.length} 人安全逃生`),
            ),
          ),
      ),
    );
  }

  components.push(
    buttonRow(
      makeButton('menu:bomb:new:100', '💣 100币炸弹', ButtonStyle.Danger),
      makeButton('menu:bomb:new:300', '💣 300币炸弹', ButtonStyle.Danger),
      makeButton('menu:bomb:new:500', '💣 500币炸弹', ButtonStyle.Danger),
      makeButton('menu:modal:bomb', '⌨️ 自定义罚金', ButtonStyle.Secondary),
    ),
  );

  components.push(
    buttonRow(
      makeButton('menu:nav:bomb', '🔄 刷新', ButtonStyle.Secondary),
      makeButton('menu:nav:multi', '👥 多人博弈', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

export function buildRouletteCard(
  game: RouletteGame,
  economyCfg: EconomyConfig,
): BuiltButtonMessage {
  const prizePool = game.entryFee * game.players.length;
  const playersText = game.players
    .map((uid) => {
      const alive = game.alivePlayers.includes(uid);
      return alive ? `<@${uid}>` : `~~<@${uid}>~~ 💀`;
    })
    .join(' · ');
  const recentLogs = game.logs.slice(-5);

  if (game.status === 'recruiting') {
    const deadlineUnix = Math.floor(game.turnDeadline / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`🔫 俄罗斯轮盘赌局 #${game.id}（招募中）`)
      .setDescription(
        truncateText(
          [
            `房主：<@${game.hostId}> ｜ 入场费：${economyCfg.currencyEmoji} **${game.entryFee}** ${economyCfg.currencyName}`,
            `当前奖池：**${prizePool}** ${economyCfg.currencyName} ｜ 席位：**${game.players.length} / ${game.maxPlayers}** 人`,
            `已上桌：${playersText}`,
            `⏳ 招募截止：<t:${deadlineUnix}:R>`,
            '',
            '至少 **2 人**即可由房主开局！2~6人吃鸡，最后幸存者独吞总奖池！',
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `轮盘房间 #${game.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(`ch:rl:join:${game.id}`, '🪑 交钱上桌', ButtonStyle.Success),
          makeButton(`ch:rl:leave:${game.id}`, '🚪 退出退币', ButtonStyle.Secondary),
          makeButton(`ch:rl:start:${game.id}`, '🔥 房主开局', ButtonStyle.Danger),
          makeButton(`ch:rl:cancel:${game.id}`, '❌ 取消散桌', ButtonStyle.Secondary),
        ),
      ],
    };
  }

  if (game.status === 'playing' && game.alivePlayers.length > 0) {
    const currentId = game.alivePlayers[game.turnIndex % game.alivePlayers.length]!;
    const deadlineUnix = Math.floor(game.turnDeadline / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle(`🔫 俄罗斯轮盘 #${game.id}（死斗中）`)
      .setDescription(
        truncateText(
          [
            `💰 总奖池：${economyCfg.currencyEmoji} **${prizePool}** ${economyCfg.currencyName} ｜ 存活：**${game.alivePlayers.length}/${game.players.length}**`,
            `玩家席位：${playersText}`,
            '',
            `👉 **当前轮到：<@${currentId}>**（已空枪 ${game.chamberPos}/6）`,
            `⏰ 请在 <t:${deadlineUnix}:R> 前扣动扳机（超时将自动代扣）`,
            ...(recentLogs.length > 0 ? ['', '**战况记录：**', ...recentLogs] : []),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `轮盘房间 #${game.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(makeButton(`ch:rl:fire:${game.id}`, '👉 扣动扳机！', ButtonStyle.Danger)),
      ],
    };
  }

  if (game.status === 'finished') {
    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`🏆 俄罗斯轮盘 #${game.id} 已吃鸡！`)
      .setDescription(
        truncateText(
          [
            `🏆 **唯一幸存大赢家：<@${game.winnerId}>**`,
            `💰 独吞奖池：${economyCfg.currencyEmoji} **+${prizePool}** ${economyCfg.currencyName}`,
            `参战名单：${playersText}`,
            ...(recentLogs.length > 0 ? ['', '**战况回放：**', ...recentLogs] : []),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `轮盘房间 #${game.id}` })
      .setTimestamp();

    return { embeds: [embed], components: [] };
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle(`❌ 俄罗斯轮盘 #${game.id} 已取消`)
    .setDescription(
      truncateText(
        [
          `本局已解散，所有已上桌成员的入场费已全额原路退回。`,
          ...(recentLogs.length > 0 ? ['', ...recentLogs] : []),
        ].join('\n'),
        4096,
      ),
    )
    .setFooter({ text: `轮盘房间 #${game.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}

export function buildNumberBombCard(
  game: NumberBombGame,
  economyCfg: EconomyConfig,
  payouts?: readonly BombPayout[],
): BuiltButtonMessage {
  const historyLines = game.guesses.slice(-6).map((g) => {
    return g.exploded
      ? `• 💥 <@${g.userId}> 猜了 **${g.guess}** — **踩雷爆炸！**`
      : `• <@${g.userId}> 猜了 **${g.guess}** — 安全过关`;
  });

  if (game.status === 'open') {
    const expUnix = Math.floor(game.expiresAt / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.PRIMARY)
      .setTitle(`💣 频道数字炸弹 #${game.id}`)
      .setDescription(
        truncateText(
          [
            `发起人：<@${game.hostId}> ｜ 踩雷罚金：${economyCfg.currencyEmoji} **${game.penalty}** ${economyCfg.currencyName}`,
            `🎯 当前安全区间：**[ ${game.minBound} ~ ${game.maxBound} ]**`,
            `👥 已安全逃生（待分红）：**${game.participants.length}** 人 ｜ ⏳ <t:${expUnix}:R> 过期`,
            ...(historyLines.length > 0 ? ['', '**最近猜数：**', ...historyLines] : []),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `规则：不得连续猜两次，需口袋现金 >= ${game.penalty} ${economyCfg.currencyName}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(
            `ch:bomb:guess:${game.id}`,
            `💣 抢猜数字 (${game.minBound}~${game.maxBound})`,
            ButtonStyle.Danger,
          ),
        ),
      ],
    };
  }

  if (game.status === 'exploded') {
    const payoutLines =
      payouts && payouts.length > 0
        ? payouts.map((p) => `• <@${p.userId}> 分得 **+${p.amount}** ${economyCfg.currencyName}`)
        : ['• 无其他存活分红者，罚金已由系统没收'];
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle(`💥 数字炸弹 #${game.id} 引爆了！`)
      .setDescription(
        truncateText(
          [
            `💀 倒霉蛋：<@${game.loserId}> 踩中了炸弹数字 **【${game.secretNumber}】**！`,
            `💸 被扣除罚金：${economyCfg.currencyEmoji} **${game.penalty}** ${economyCfg.currencyName}`,
            '',
            '**💰 战利品分红：**',
            ...payoutLines,
            ...(historyLines.length > 0 ? ['', '**最后几轮：**', ...historyLines] : []),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `数字炸弹 #${game.id} · 已引爆` })
      .setTimestamp();

    return { embeds: [embed], components: [] };
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle(`⌛ 数字炸弹 #${game.id} 已超时拆弹`)
    .setDescription(
      `炸弹超时自动销毁，安全结束。本局谜底数字为 **【${game.secretNumber}】**。`,
    )
    .setFooter({ text: `数字炸弹 #${game.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}
