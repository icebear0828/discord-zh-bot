import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { EconomyConfig } from '../config/defaults.js';
import {
  PET_BOSS_BONUS_CAP,
  PREDICTION_LOCKED_EXPIRE_MS,
  PREDICTION_MAX_BET,
} from '../config/economyConstants.js';
import type { WorldEvent, WorldEventParticipant } from '../db/repositories/worldEventRepo.js';
import type {
  BossAttackMode,
  BossRewardEntry,
  PredictionSummary,
} from '../services/worldEventService.js';
import { COLORS, renderProgressBar, type AppContext } from './embeds.js';
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

const PREDICTION_STATUS_LABELS: Record<string, string> = {
  open: '🟢 押注开放中',
  locked: '🔒 已封盘待结算',
  settled: '🏆 已结算完结',
  cancelled: '❌ 已作废退币',
};

const PREDICTIONS_PAGE_SIZE = 15;

export function formatBossAttackLog(
  userId: string,
  mode: BossAttackMode,
  res: {
    missed: boolean;
    crit: boolean;
    damage: number;
    petName: string | null;
    petBonus: number;
    killed: boolean;
    event?: Pick<WorldEvent, 'rewardPool'>;
  },
  economyCfg?: Pick<EconomyConfig, 'currencyName'>,
): string {
  if (res.missed) {
    return `<@${userId}> 蓄力重击挥空了！（0 伤害）`;
  }
  const petTag = res.petName ? `（🐾${res.petName}助战+${res.petBonus}）` : '';
  const mvpBonus = res.event ? Math.floor(res.event.rewardPool * 0.25) : 0;
  const currencyName = economyCfg?.currencyName ?? '';
  const killTag = res.killed
    ? mvpBonus > 0 && currencyName
      ? ` 🏆 拿下尾刀绝杀（额外 25% 尾刀奖 +${mvpBonus} ${currencyName}）！`
      : ' 🏆 拿下尾刀绝杀（额外 25% 尾刀奖）！'
    : '';
  return `<@${userId}> ${mode === 'heavy' ? '蓄力重击' : '普通攻击'}${res.crit ? '💥暴击' : ''}造成了 **${res.damage}** 伤害！${petTag}${killTag}`;
}

export function parseBossRewardsJson(raw: string): BossRewardEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list: BossRewardEntry[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      if (
        typeof obj.userId === 'string' &&
        typeof obj.damage === 'number' &&
        typeof obj.baseReward === 'number' &&
        typeof obj.mvpBonus === 'number' &&
        typeof obj.totalReward === 'number'
      ) {
        list.push({
          userId: obj.userId,
          damage: obj.damage,
          baseReward: obj.baseReward,
          mvpBonus: obj.mvpBonus,
          totalReward: obj.totalReward,
        });
      }
    }
    return list;
  } catch {
    return [];
  }
}

export function parseBossConsolationsJson(raw: string): Array<{ userId: string; amount: number }> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list: Array<{ userId: string; amount: number }> = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.userId === 'string' && typeof obj.amount === 'number') {
        list.push({ userId: obj.userId, amount: obj.amount });
      }
    }
    return list;
  } catch {
    return [];
  }
}

export function buildEventsHubView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const activeEvents = ctx.services.worldEvent.listActiveWorldEvents(guildId);
  const openPreds = ctx.services.worldEvent.listPredictionsPaginated(guildId, 1, 1, ['open', 'locked']);

  let eventLine = '🌌 当前暂无进行中的全服事件（群聊活跃达标后自动降临）';
  if (activeEvents.length > 0) {
    eventLine = activeEvents
      .slice(0, 3)
      .map((ev) => {
        if (ev.eventType === 'chest') {
          return `🎁 **#${ev.id} ${ev.name}**（剩余 **${ev.remainingShares}/${ev.totalShares}** 份｜总池 **${ev.rewardPool}** ${cfg.economy.currencyName}）`;
        }
        const ratio = ev.currentHp / Math.max(1, ev.maxHp);
        return `👹 **#${ev.id} ${ev.name}** HP **${ev.currentHp}/${ev.maxHp}** \`${renderProgressBar(ratio, 8)}\`（奖池 **${ev.rewardPool}** ${cfg.economy.currencyName}）`;
      })
      .join('\n  ');
  }

  const description = [
    '欢迎来到全群吃瓜与世界事件中心！',
    '',
    `📊 **进行中盘口**：当前共有 **${openPreds.total}** 个开放/待结算吃瓜盘口`,
    `⚡ **突发事件**：${activeEvents.length > 1 ? `当前共 **${activeEvents.length}** 个活跃事件\n  ` : ''}${eventLine}`,
    '',
    `• **📊 自由开盘押注**：任何群友均可发起 2~4 选项盘口（开盘人不可押自身盘口，单笔上限 ${PREDICTION_MAX_BET.toLocaleString()} ${cfg.economy.currencyName}），需封盘后再由开盘人/管理员结算`,
    `• **🎁 天降宝箱**：群聊活跃自动空投，先到先得随机瓜分 ${cfg.economy.currencyName}`,
    `• **👹 合力打 Boss**：普通攻击(12s)/蓄力重击(25s)协同击杀（出战宠物可助战增伤，上限 +${PET_BOSS_BONUS_CAP}），按伤害占比瓜分奖池 + **25% 尾刀暴击大奖**！`,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 吃瓜与世界事件`, iconURL: actor.avatarUrl })
    .setTitle('🎯 吃瓜事件中心')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '📢 吃瓜盘口、天降宝箱与世界 Boss 均为全群公开联动玩法' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton('menu:nav:predictions', '📊 吃瓜开盘列表', ButtonStyle.Primary),
        makeButton('menu:modal:pred_create', '📝 发起新盘口', ButtonStyle.Success),
        makeButton('menu:nav:world_status', '👹 宝箱与Boss', ButtonStyle.Danger),
        makeButton('menu:nav:events', '🔄 刷新', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildPredictionsListView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  page = 1,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const paged = ctx.services.worldEvent.listPredictionsPaginated(
    guildId,
    page,
    PREDICTIONS_PAGE_SIZE,
    ['open', 'locked'],
  );
  const preds = paged.items;

  const lines =
    preds.length > 0
      ? preds.map((p) => {
          const sum = ctx.services.worldEvent.getPredictionSummary(p.id);
          const pool = sum?.totalPool ?? 0;
          const statusLabel = PREDICTION_STATUS_LABELS[p.status] ?? p.status;
          return `• **#${p.id}** [${statusLabel}] **${truncateText(p.title, 40)}**\n  总奖池：**${pool}** ${cfg.currencyName} ｜ 发起：<@${p.creatorId}>`;
        })
      : ['当前暂无开放中的吃瓜盘口，点击下方「发起新盘口」吃第一口瓜！'];

  const description = [
    '从下方列表选择盘口查看赔率详情、下注押宝或进行封盘/结算管理：',
    '',
    ...lines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 吃瓜盘口大厅`, iconURL: actor.avatarUrl })
    .setTitle('📊 全群吃瓜开盘大厅')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: `第 ${paged.page} / ${paged.totalPages} 页 ｜ 共 ${paged.total} 个进行中盘口` })
    .setTimestamp();

  const components: MenuComponentRow[] = [];

  if (preds.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('menu:pred_select')
          .setPlaceholder('🎯 选择一个盘口查看详情与押注/管理...')
          .addOptions(
            preds.slice(0, 25).map((p) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(`#${p.id} ${p.title}`, 100))
                .setValue(String(p.id))
                .setDescription(
                  truncateText(
                    `${PREDICTION_STATUS_LABELS[p.status] ?? p.status} · ${p.options.length} 个选项`,
                    100,
                  ),
                ),
            ),
          ),
      ),
    );
  }

  if (paged.totalPages > 1) {
    const prevPage = Math.max(1, paged.page - 1);
    const nextPage = Math.min(paged.totalPages, paged.page + 1);
    components.push(
      buttonRow(
        makeButton(`menu:pred_page:${prevPage}:prev`, '⬅️ 上一页', ButtonStyle.Secondary, paged.page <= 1),
        makeButton(
          `menu:pred_page:${nextPage}:next`,
          '➡️ 下一页',
          ButtonStyle.Secondary,
          paged.page >= paged.totalPages,
        ),
      ),
    );
  }

  components.push(
    buttonRow(
      makeButton('menu:modal:pred_create', '📝 发起新盘口', ButtonStyle.Success),
      makeButton(`menu:pred_page:${paged.page}:refresh`, '🔄 刷新列表', ButtonStyle.Secondary),
      makeButton('menu:nav:events', '🎯 吃瓜事件', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

export function buildPredDetailView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  predictionId: number,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const summary = ctx.services.worldEvent.getPredictionSummary(predictionId);

  if (!summary || summary.prediction.guildId !== guildId) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ 盘口不存在')
      .setDescription('找不到该吃瓜盘口，可能已被清理或属于其他服务器。');
    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton('menu:nav:predictions', '⬅️ 盘口列表', ButtonStyle.Secondary),
          makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
        ),
      ],
    };
  }

  const pred = summary.prediction;
  const isCreator = actor.id === pred.creatorId;
  const canManage = isCreator || Boolean(actor.isAdmin);
  const closeUnix = Math.floor(pred.closesAt / 1000);
  const lockedExpireHours = Math.round(PREDICTION_LOCKED_EXPIRE_MS / 3600_000);

  const myBetsByOpt = new Map<number, number>();
  for (const bet of summary.bets) {
    if (bet.userId === actor.id) {
      myBetsByOpt.set(bet.optionIndex, (myBetsByOpt.get(bet.optionIndex) ?? 0) + bet.amount);
    }
  }

  const optLines = summary.optionStats.map((st) => {
    const winTag = pred.winningOption === st.index ? '🏆 ' : '';
    const myStake = myBetsByOpt.get(st.index) ?? 0;
    const myTag = myStake > 0 ? ` ｜ 你已押 **${myStake}**` : '';
    return `${winTag}**[${st.index + 1}] ${st.label}**\n  奖池 **${st.totalAmount}** ${cfg.currencyName}（${st.bettorCount} 人）｜ 实时赔率 **${st.oddsText}**${myTag}`;
  });

  const extraHints: string[] = [];
  if (isCreator && pred.status === 'open') {
    extraHints.push('⚠️ 为防止自押自结，开盘人不可下注自己发起的盘口。');
  }
  if (canManage && pred.status === 'open') {
    extraHints.push('💡 需先点击「🔒 立即封盘」，封盘后即可在此宣布胜出选项并结算。');
  } else if (pred.status === 'locked') {
    extraHints.push(`⏳ 已封盘待结算（封盘超过 ${lockedExpireHours} 小时未结算将自动作废并全额退币）。`);
  }

  const description = [
    `状态：**${PREDICTION_STATUS_LABELS[pred.status] ?? pred.status}** ｜ 发起：<@${pred.creatorId}>`,
    `总奖池：${cfg.currencyEmoji} **${summary.totalPool}** ${cfg.currencyName} ｜ 封盘：<t:${closeUnix}:R>`,
    `你的口袋现金：**${profile.coins}** ${cfg.currencyName}`,
    '',
    ...optLines,
    ...(extraHints.length > 0 ? ['', ...extraHints] : []),
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `吃瓜盘口 #${pred.id}`, iconURL: actor.avatarUrl })
    .setTitle(truncateText(`📊 ${pred.title}`, 256))
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '开盘人或 Bot 管理员可在此封盘、宣布胜出选项结算或作废退币' })
    .setTimestamp();

  const components: MenuComponentRow[] = [];

  if (pred.status === 'open') {
    components.push(
      buttonRow(
        ...pred.options.slice(0, 4).map((opt, idx) =>
          makeButton(
            `menu:pred_bet:${pred.id}:${idx}`,
            `押「${truncateText(opt, 18)}」`,
            ButtonStyle.Primary,
            isCreator,
          ),
        ),
      ),
    );
  }

  if (canManage && pred.status === 'locked') {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`menu:pred_settle:${pred.id}`)
          .setPlaceholder('🏆 宣布胜出结果并全池派奖...')
          .addOptions(
            pred.options.map((opt, idx) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(`胜出：[${idx + 1}] ${opt}`, 100))
                .setValue(String(idx))
                .setDescription('点击立即按比例结算全部押注奖池'),
            ),
          ),
      ),
    );
  }

  if (canManage && (pred.status === 'open' || pred.status === 'locked')) {
    components.push(
      buttonRow(
        makeButton(
          `menu:pred_lock:${pred.id}`,
          '🔒 立即封盘',
          ButtonStyle.Secondary,
          pred.status !== 'open',
        ),
        makeButton(`menu:pred_cancel:${pred.id}`, '❌ 作废退币', ButtonStyle.Danger),
        makeButton(`menu:pred_post:${pred.id}`, '📢 发频道盘口卡', ButtonStyle.Success),
      ),
    );
  }

  components.push(
    buttonRow(
      makeButton('menu:nav:predictions', '⬅️ 盘口列表', ButtonStyle.Secondary),
      makeButton(`menu:pred_view:${pred.id}`, '🔄 刷新详情', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components };
}

export function buildWorldStatusView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const activeEvents = ctx.services.worldEvent.listActiveWorldEvents(guildId);
  const active = activeEvents[0] ?? null;
  const recent = ctx.services.worldEvent.listRecentWorldEvents(guildId, 3);
  const activePet = ctx.services.socialPet.getActivePet(guildId, actor.id);

  const lines: string[] = [];
  const components: MenuComponentRow[] = [];

  if (active) {
    const expUnix = Math.floor(active.expiresAt / 1000);
    const participants = ctx.repos.worldEvent.listParticipants(active.id);
    if (active.eventType === 'chest') {
      lines.push(
        `🎁 **正在进行：${active.name}**（#${active.id}）`,
        `${active.flavor}`,
        `剩余份数：**${active.remainingShares} / ${active.totalShares}** ｜ 剩余总额：**${active.remainingAmount}** ${cfg.economy.currencyName}`,
        `⏳ 消失时间：<t:${expUnix}:R>`,
      );
      components.push(
        buttonRow(
          makeButton(`menu:world:claim_chest:${active.id}`, '🎁 立即抢宝箱', ButtonStyle.Success),
          ...(actor.isAdmin
            ? [makeButton(`menu:world:post_card:${active.id}`, '📢 重发到当前频道', ButtonStyle.Primary)]
            : []),
        ),
      );
    } else {
      const ratio = active.currentHp / Math.max(1, active.maxHp);
      const topHitters = participants
        .slice(0, 5)
        .map((p, idx) => `${idx + 1}. <@${p.userId}> — **${p.damageOrReward}** 伤害`);
      const petBonus = activePet
        ? Math.min(PET_BOSS_BONUS_CAP, Math.floor(activePet.atk * 0.5))
        : 0;
      lines.push(
        `👹 **世界 Boss：${active.name}**（#${active.id}）`,
        `${active.flavor}`,
        `❤️ HP：**${active.currentHp} / ${active.maxHp}** \`${renderProgressBar(ratio, 12)}\``,
        `💰 奖池：**${active.rewardPool}** ${cfg.economy.currencyName}（尾刀额外 **+${Math.floor(active.rewardPool * 0.25)}** ${cfg.economy.currencyName}）`,
        `⏳ 撤退时间：<t:${expUnix}:R>`,
        ...(activePet
          ? [`🐾 出战宠物 **${activePet.nickname}** 将助战 **+${petBonus}** 伤害（上限 +${PET_BOSS_BONUS_CAP}）！`]
          : []),
        ...(topHitters.length > 0 ? ['', '**当前伤害榜 Top5：**', ...topHitters] : []),
      );
      components.push(
        buttonRow(
          makeButton(`menu:world:boss_hit:${active.id}:normal`, '⚔️ 普通攻击 (12s)', ButtonStyle.Primary),
          makeButton(`menu:world:boss_hit:${active.id}:heavy`, '💥 蓄力重击 (25s)', ButtonStyle.Danger),
          ...(actor.isAdmin
            ? [makeButton(`menu:world:post_card:${active.id}`, '📢 重发到当前频道', ButtonStyle.Secondary)]
            : []),
        ),
      );
    }

    if (activeEvents.length > 1) {
      lines.push(
        '',
        `**其他活跃世界事件（共 ${activeEvents.length} 个进行中）：**`,
        ...activeEvents.slice(1).map((ev) => {
          const icon = ev.eventType === 'chest' ? '🎁' : '👹';
          const detailText =
            ev.eventType === 'chest'
              ? `剩余 ${ev.remainingShares}/${ev.totalShares} 份`
              : `HP ${ev.currentHp}/${ev.maxHp}`;
          return `• ${icon} #${ev.id} **${ev.name}**（${detailText}，频道 <#${ev.channelId}>）`;
        }),
      );
    }
  } else {
    lines.push(
      '🌌 **当前暂无活跃宝箱或 Boss。**',
      `自动触发条件：每 **${cfg.games.eventMsgThreshold}** 条活跃发言且距上次 >= **${cfg.games.eventCooldownSec}** 秒。`,
    );
    if (actor.isAdmin) {
      components.push(
        buttonRow(
          makeButton('menu:world:spawn_chest', '🎁 管理员放宝箱', ButtonStyle.Success),
          makeButton('menu:world:spawn_boss', '👹 管理员召 Boss', ButtonStyle.Danger),
        ),
      );
    }
  }

  if (recent.length > 0) {
    lines.push(
      '',
      '**近期世界事件：**',
      ...recent.map((e) => {
        const icon = e.eventType === 'chest' ? '🎁' : '👹';
        const status =
          e.status === 'active' ? '进行中' : e.status === 'completed' ? '已完结' : '已过期';
        return `• ${icon} #${e.id} **${e.name}**（${status}${e.killerId ? `，尾刀 <@${e.killerId}>` : ''}）`;
      }),
    );
  }

  components.push(
    buttonRow(
      makeButton('menu:nav:world_status', '🔄 刷新状态', ButtonStyle.Secondary),
      makeButton('menu:nav:events', '🎯 吃瓜事件', ButtonStyle.Secondary),
      makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
    ),
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.ERROR, feedback))
    .setAuthor({ name: `${actor.displayName} · 宝箱与世界 Boss`, iconURL: actor.avatarUrl })
    .setTitle('👹 天降宝箱与世界 Boss')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setTimestamp();

  return { embeds: [embed], components };
}

export function buildPredictionCard(
  summary: PredictionSummary,
  economyCfg: EconomyConfig,
  extraNote?: string,
): BuiltMenuMessage {
  const pred = summary.prediction;
  const closeUnix = Math.floor(pred.closesAt / 1000);
  const optLines = summary.optionStats.map((st) => {
    const winTag = pred.winningOption === st.index ? '🏆 ' : '';
    return `${winTag}**[${st.index + 1}] ${st.label}** — 押注 **${st.totalAmount}** ${economyCfg.currencyName}（${st.bettorCount}人｜${st.oddsText}）`;
  });

  const baseDesc = [
    `状态：**${PREDICTION_STATUS_LABELS[pred.status] ?? pred.status}** ｜ 开盘人：<@${pred.creatorId}>`,
    `总奖池：${economyCfg.currencyEmoji} **${summary.totalPool}** ${economyCfg.currencyName} ｜ 封盘：<t:${closeUnix}:R>`,
    '',
    ...optLines,
    ...(extraNote ? ['', extraNote] : []),
  ].join('\n');

  const color =
    pred.status === 'settled'
      ? COLORS.SUCCESS
      : pred.status === 'cancelled'
        ? COLORS.ERROR
        : pred.status === 'locked'
          ? COLORS.WARNING
          : COLORS.PRIMARY;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(truncateText(`📊 吃瓜盘口 #${pred.id}：${pred.title}`, 256))
    .setDescription(truncateText(baseDesc, 4096))
    .setFooter({ text: `盘口 #${pred.id} · 开盘人或管理员请前往 /菜单 → 吃瓜事件 封盘/结算/作废` })
    .setTimestamp();

  if (pred.status === 'settled' || pred.status === 'cancelled') {
    return { embeds: [embed], components: [] };
  }

  const components: MenuComponentRow[] = [];

  if (pred.status === 'open') {
    components.push(
      buttonRow(
        ...pred.options.slice(0, 4).map((opt, idx) =>
          makeButton(
            `ev:pred:bet:${pred.id}:${idx}`,
            `🪙 押「${truncateText(opt, 18)}」`,
            ButtonStyle.Primary,
          ),
        ),
      ),
    );
  }

  components.push(
    buttonRow(makeButton(`ev:pred:refresh:${pred.id}`, '🔄 刷新赔率', ButtonStyle.Secondary)),
  );

  return { embeds: [embed], components };
}

export function buildWorldChestCard(
  event: WorldEvent,
  participants: readonly WorldEventParticipant[],
  economyCfg: EconomyConfig,
): BuiltButtonMessage {
  const claimLines = participants.map(
    (p) => `• <@${p.userId}> 抢到了 ${economyCfg.currencyEmoji} **${p.damageOrReward}** ${economyCfg.currencyName}`,
  );

  if (event.status === 'active') {
    const expUnix = Math.floor(event.expiresAt / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.GOLD)
      .setTitle(`🎁 天降宝箱：${event.name}`)
      .setDescription(
        truncateText(
          [
            event.flavor,
            '',
            `总奖池：${economyCfg.currencyEmoji} **${event.rewardPool}** ${economyCfg.currencyName} ｜ 剩余：**${event.remainingShares}/${event.totalShares}** 份`,
            `⏳ 消失倒计时：<t:${expUnix}:R>`,
            ...(claimLines.length > 0 ? ['', '**已开启记录：**', ...claimLines] : []),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `世界事件 #${event.id}` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(
            `ev:chest:claim:${event.id}`,
            `🎁 抢宝箱！(剩余 ${event.remainingShares}/${event.totalShares})`,
            ButtonStyle.Success,
          ),
        ),
      ],
    };
  }

  const embed = new EmbedBuilder()
    .setColor(event.status === 'completed' ? COLORS.SUCCESS : COLORS.WARNING)
    .setTitle(
      event.status === 'completed'
        ? `🎁 宝箱「${event.name}」已被抢空！`
        : `⌛ 宝箱「${event.name}」已消失`,
    )
    .setDescription(
      truncateText(
        [
          `本轮宝箱总额 **${event.rewardPool}** ${economyCfg.currencyName}（共 ${event.totalShares} 份）。`,
          ...(claimLines.length > 0 ? ['', '**幸运开启记录：**', ...claimLines] : ['无人前来开启。']),
        ].join('\n'),
        4096,
      ),
    )
    .setFooter({ text: `世界事件 #${event.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}

export function buildWorldBossCard(
  event: WorldEvent,
  participants: readonly WorldEventParticipant[],
  economyCfg: EconomyConfig,
  extraLog?: string,
  rewards?: readonly BossRewardEntry[],
): BuiltButtonMessage {
  const ratio = event.currentHp / Math.max(1, event.maxHp);
  const topHitters = participants
    .slice(0, 8)
    .map((p, idx) => `**${idx + 1}.** <@${p.userId}> — **${p.damageOrReward}** 伤害（${p.hits}次）`);

  if (event.status === 'active') {
    const expUnix = Math.floor(event.expiresAt / 1000);
    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle(`👹 世界 Boss 来袭：${event.name}`)
      .setDescription(
        truncateText(
          [
            event.flavor,
            '',
            `❤️ 血量：**${event.currentHp} / ${event.maxHp}** \`${renderProgressBar(ratio, 14)}\``,
            `💰 讨伐奖池：${economyCfg.currencyEmoji} **${event.rewardPool}** ${economyCfg.currencyName}（尾刀 MVP 额外 **+${Math.floor(event.rewardPool * 0.25)}** ${economyCfg.currencyName}）`,
            `⏳ 逃跑倒计时：<t:${expUnix}:R>`,
            ...(extraLog ? ['', `⚡ ${extraLog}`] : []),
            ...(topHitters.length > 0 ? ['', '**讨伐伤害榜：**', ...topHitters] : []),
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `世界事件 #${event.id} · 出战宠物可自动助战增伤（上限 +${PET_BOSS_BONUS_CAP}）` })
      .setTimestamp();

    return {
      embeds: [embed],
      components: [
        buttonRow(
          makeButton(`ev:boss:hit:${event.id}:normal`, '⚔️ 普通攻击 (12s)', ButtonStyle.Primary),
          makeButton(`ev:boss:hit:${event.id}:heavy`, '💥 蓄力重击 (25s)', ButtonStyle.Danger),
        ),
      ],
    };
  }

  if (event.status === 'completed') {
    const resolvedRewards =
      rewards && rewards.length > 0 ? rewards : parseBossRewardsJson(event.rewardsJson);
    const rewardLines =
      resolvedRewards.length > 0
        ? resolvedRewards
            .slice(0, 10)
            .map(
              (r) =>
                `• <@${r.userId}>（伤害 ${r.damage}）分得 **+${r.totalReward}** ${economyCfg.currencyName}${r.mvpBonus > 0 ? ` 👑 含尾刀+${r.mvpBonus}` : ''}`,
            )
        : topHitters;

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`🏆 世界 Boss「${event.name}」已被全群讨伐！`)
      .setDescription(
        truncateText(
          [
            `💥 **尾刀绝杀英雄：<@${event.killerId}>**`,
            `💰 奖池分配结果（总池 ${event.rewardPool} + 尾刀暴击 ${Math.floor(event.rewardPool * 0.25)} ${economyCfg.currencyName}）：`,
            '',
            ...rewardLines,
          ].join('\n'),
          4096,
        ),
      )
      .setFooter({ text: `世界事件 #${event.id} · 讨伐成功` })
      .setTimestamp();

    return { embeds: [embed], components: [] };
  }

  const consolations = parseBossConsolationsJson(event.rewardsJson);
  const consolationLines =
    consolations.length > 0
      ? consolations
          .slice(0, 10)
          .map((c) => `• <@${c.userId}> 获得参与安慰奖 **+${c.amount}** ${economyCfg.currencyName}`)
      : topHitters;

  const embed = new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle(`🏃 世界 Boss「${event.name}」趁乱逃跑了`)
    .setDescription(
      truncateText(
        [
          `时间耗尽，Boss 仍剩余 **${event.currentHp}/${event.maxHp}** HP。所有参与讨伐的勇士已获得参与安慰奖！`,
          ...(consolationLines.length > 0
            ? ['', consolations.length > 0 ? '**本次参与安慰奖：**' : '**本次输出榜：**', ...consolationLines]
            : []),
        ].join('\n'),
        4096,
      ),
    )
    .setFooter({ text: `世界事件 #${event.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}
