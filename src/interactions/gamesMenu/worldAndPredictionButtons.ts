import type { ButtonInteraction } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import type { BossAttackMode } from '../../services/worldEventService.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../../ui/menuShared.js';
import {
  buildPredictionCard,
  buildPredictionsListView,
  buildWorldBossCard,
  buildWorldChestCard,
  formatBossAttackLog,
} from '../../ui/worldEventMenuBuilder.js';
import { dispatchByAction, type ActionRouteTable } from '../menu/subRouter.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  editChannelMessage,
  parsePositiveInt,
  sendPublicBroadcast,
} from '../menuHelpers.js';
import { repostWorldEventCard, spawnAndPostWorldEvent } from './gamesLaunchHelpers.js';
import { buildCreatePredictionModal, buildPredBetModal } from './gamesModalBuilders.js';

interface WorldButtonInput {
  interaction: ButtonInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: readonly string[];
}

const WORLD_NAV_VIEWS: Readonly<Record<string, MenuView>> = {
  events: { page: 'events' },
  predictions: { page: 'predictions' },
  world_status: { page: 'world_status' },
};

async function updateMenu(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  view: MenuView,
  feedback?: MenuFeedback,
): Promise<true> {
  await interaction.update(buildMenuMessage(ctx, guildId, actor, view, feedback));
  return true;
}

async function handlePredictionControl({
  interaction,
  ctx,
  guildId,
  actor,
  parts,
}: WorldButtonInput): Promise<boolean> {
  const section = parts[1];
  const predId = Number(parts[2]);
  if (!Number.isInteger(predId) || predId <= 0) return false;
  const disabledMsg =
    checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件') ??
    checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return updateMenu(
      interaction,
      ctx,
      guildId,
      actor,
      { page: 'pred_detail', predictionId: predId },
      { type: 'error', text: disabledMsg },
    );
  }
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;

  if (section === 'pred_lock') {
    const res = ctx.services.worldEvent.lockPrediction(predId, actor.id, Boolean(actor.isAdmin));
    const feedback: MenuFeedback = res.ok
      ? { type: 'success', text: '🔒 已提前封盘，接下来可从下方下拉菜单宣布胜出结果。' }
      : { type: 'error', text: '封盘失败：仅开盘人或 Bot 管理员可对开放中盘口封盘。' };
    if (res.ok) {
      await editChannelMessage(
        interaction.client,
        res.summary.prediction.channelId,
        res.summary.prediction.messageId,
        buildPredictionCard(res.summary, cfg),
        interaction.guild,
      );
    }
    return updateMenu(interaction, ctx, guildId, actor, { page: 'pred_detail', predictionId: predId }, feedback);
  }

  if (section === 'pred_cancel') {
    const res = ctx.services.worldEvent.cancelPrediction(predId, actor.id, Boolean(actor.isAdmin));
    const feedback: MenuFeedback = res.ok
      ? { type: 'success', text: `❌ 盘口已作废，全部 **${res.refunds.length}** 位下注人已全额退币！` }
      : { type: 'error', text: '作废失败：仅开盘人或 Bot 管理员可操作未结算盘口。' };
    if (res.ok) {
      await editChannelMessage(
        interaction.client,
        res.summary.prediction.channelId,
        res.summary.prediction.messageId,
        buildPredictionCard(res.summary, cfg),
        interaction.guild,
      );
    }
    return updateMenu(interaction, ctx, guildId, actor, { page: 'pred_detail', predictionId: predId }, feedback);
  }

  const summary = ctx.services.worldEvent.getPredictionSummary(predId);
  if (!summary) return true;
  if (actor.id !== summary.prediction.creatorId && !actor.isAdmin) {
    return updateMenu(
      interaction,
      ctx,
      guildId,
      actor,
      { page: 'pred_detail', predictionId: predId },
      { type: 'error', text: '仅开盘人或 Bot 管理员可重发盘口卡片。' },
    );
  }
  const oldChannelId = summary.prediction.channelId;
  const oldMessageId = summary.prediction.messageId;
  const broadcast = await sendPublicBroadcast(interaction, {
    content: `📊 <@${summary.prediction.creatorId}> 发起吃瓜盘口「**${summary.prediction.title}**」，快来押注！`,
    ...buildPredictionCard(summary, cfg),
  });
  if (broadcast.sent && broadcast.messageId) {
    const targetChannelId = interaction.channelId ?? oldChannelId;
    ctx.services.worldEvent.bindPredictionMessage(predId, broadcast.messageId, targetChannelId);
    if (oldMessageId && (oldMessageId !== broadcast.messageId || oldChannelId !== targetChannelId)) {
      await editChannelMessage(
        interaction.client,
        oldChannelId,
        oldMessageId,
        { components: [] },
        interaction.guild,
      );
    }
  }
  const feedback: MenuFeedback = broadcast.sent
    ? { type: 'success', text: '📢 吃瓜盘口卡片已发送到当前频道（旧卡片按钮已自动禁用）！' }
    : { type: 'error', text: '发送盘口卡片失败，请检查机器人发言权限。' };
  return updateMenu(interaction, ctx, guildId, actor, { page: 'pred_detail', predictionId: predId }, feedback);
}

async function handleWorldEventSection({
  interaction,
  ctx,
  guildId,
  actor,
  parts,
}: WorldButtonInput): Promise<boolean> {
  const action = parts[2];
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (action === 'claim_chest') {
    const disabledMsg =
      checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件') ??
      checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      return updateMenu(interaction, ctx, guildId, actor, { page: 'world_status' }, { type: 'error', text: disabledMsg });
    }
    const eventId = Number(parts[3]);
    if (!Number.isInteger(eventId) || eventId <= 0) return false;
    const res = ctx.services.worldEvent.claimChest(eventId, actor.id);
    if (res.ok) {
      await editChannelMessage(
        interaction.client,
        res.event.channelId,
        res.event.messageId,
        buildWorldChestCard(res.event, res.participants, cfg.economy),
        interaction.guild,
      );
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'world_status' },
        {
          type: 'success',
          text: `🎁 开箱抢到 ${cfg.economy.currencyEmoji} **+${res.amount}** ${cfg.economy.currencyName}！（当前现金 **${res.balance}** ${cfg.economy.currencyName}）`,
        },
      );
    }
    if (res.reason === 'expired') {
      ctx.services.worldEvent.expireWorldEventIfDue(eventId);
    }
    if (res.reason === 'expired' || res.reason === 'not_active') {
      const detail = ctx.services.worldEvent.getWorldEventDetail(eventId);
      if (detail && detail.event.status !== 'active') {
        await editChannelMessage(
          interaction.client,
          detail.event.channelId,
          detail.event.messageId,
          buildWorldChestCard(detail.event, detail.participants, cfg.economy),
          interaction.guild,
        );
      }
    }
    return updateMenu(
      interaction,
      ctx,
      guildId,
      actor,
      { page: 'world_status' },
      {
        type: 'error',
        text:
          res.reason === 'already_claimed'
            ? '你已经领过这只宝箱啦！'
            : '手慢一步，宝箱已被抢空或已消失！',
      },
    );
  }

  if (action === 'boss_hit') {
    const disabledMsg =
      checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件') ??
      checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      return updateMenu(interaction, ctx, guildId, actor, { page: 'world_status' }, { type: 'error', text: disabledMsg });
    }
    const eventId = Number(parts[3]);
    const mode: BossAttackMode = parts[4] === 'heavy' ? 'heavy' : 'normal';
    if (!Number.isInteger(eventId) || eventId <= 0) return false;

    const res = ctx.services.worldEvent.attackBoss(eventId, actor.id, mode);
    if (!res.ok) {
      if (res.reason === 'expired') {
        ctx.services.worldEvent.expireWorldEventIfDue(eventId);
      }
      if (res.reason === 'expired' || res.reason === 'not_active') {
        const detail = ctx.services.worldEvent.getWorldEventDetail(eventId);
        if (detail && detail.event.status !== 'active') {
          await editChannelMessage(
            interaction.client,
            detail.event.channelId,
            detail.event.messageId,
            buildWorldBossCard(detail.event, detail.participants, cfg.economy),
            interaction.guild,
          );
        }
      }
      const text =
        res.reason === 'cooldown'
          ? `技能冷却中，还需等待 **${res.retryAfterSec ?? 1}** 秒！`
          : '世界 Boss 已结束或已撤退！';
      return updateMenu(interaction, ctx, guildId, actor, { page: 'world_status' }, { type: 'error', text });
    }

    const logText = formatBossAttackLog(actor.id, mode, res, cfg.economy);
    await editChannelMessage(
      interaction.client,
      res.event.channelId,
      res.event.messageId,
      buildWorldBossCard(res.event, res.participants, cfg.economy, logText, res.rewards),
      interaction.guild,
    );

    const mvpBonus = Math.floor(res.event.rewardPool * 0.25);
    const fb: MenuFeedback = res.missed
      ? { type: 'info', text: '💨 蓄力重击空大了！稍后再来补刀！' }
      : {
          type: 'success',
          text: `${res.crit ? '💥 暴击！' : '⚔️ 命中！'}造成 **${res.damage}** 伤害${res.petName ? `（🐾 ${res.petName}助战+${res.petBonus}）` : ''}${res.killed ? `\n🏆 恭喜你拿下尾刀绝杀！额外获得 25% 尾刀奖 **+${mvpBonus}** ${cfg.economy.currencyName}！` : ''}`,
        };
    return updateMenu(interaction, ctx, guildId, actor, { page: 'world_status' }, fb);
  }

  if (action === 'post_card') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件');
    if (disabledMsg) {
      return updateMenu(interaction, ctx, guildId, actor, { page: 'world_status' }, { type: 'error', text: disabledMsg });
    }
    if (!actor.isAdmin) {
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'world_status' },
        { type: 'error', text: '🔒 仅 Bot 管理员可向频道重发世界事件卡片，防止刷屏。' },
      );
    }
    const fb = await repostWorldEventCard(interaction, ctx, guildId, Number(parts[3]));
    return updateMenu(interaction, ctx, guildId, actor, { page: 'world_status' }, fb);
  }

  if (action === 'spawn_chest' || action === 'spawn_boss') {
    if (!actor.isAdmin) {
      return updateMenu(interaction, ctx, guildId, actor, { page: 'world_status' }, ADMIN_DENIED_FEEDBACK);
    }
    const fb = await spawnAndPostWorldEvent(
      interaction,
      ctx,
      guildId,
      action === 'spawn_chest' ? 'chest' : 'boss',
    );
    return updateMenu(interaction, ctx, guildId, actor, { page: 'world_status' }, fb);
  }

  return false;
}

const WORLD_AND_PRED_ROUTES: ActionRouteTable<WorldButtonInput> = {
  exact: {
    nav: async ({ interaction, ctx, guildId, actor, parts }) => {
      const target = parts[2];
      const nextView = target ? WORLD_NAV_VIEWS[target] : undefined;
      if (!nextView) return false;
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg });
      }
      return updateMenu(interaction, ctx, guildId, actor, nextView);
    },

    pred_page: async ({ interaction, ctx, guildId, actor, parts }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg });
      }
      const nextPage = parsePositiveInt(parts[2] ?? '') ?? 1;
      await interaction.update(buildPredictionsListView(ctx, guildId, actor, undefined, nextPage));
      return true;
    },

    pred_view: async ({ interaction, ctx, guildId, actor, parts }) => {
      const predId = Number(parts[2]);
      if (!Number.isInteger(predId) || predId <= 0) return false;
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg });
      }
      ctx.services.worldEvent.lockPredictionIfDue(predId);
      return updateMenu(interaction, ctx, guildId, actor, { page: 'pred_detail', predictionId: predId });
    },

    pred_bet: async ({ interaction, ctx, guildId, actor, parts }) => {
      const predId = Number(parts[2]);
      const optIdx = Number(parts[3]);
      if (!Number.isInteger(predId) || !Number.isInteger(optIdx)) return false;

      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: disabledMsg },
        );
      }

      ctx.services.worldEvent.lockPredictionIfDue(predId);
      const summary = ctx.services.worldEvent.getPredictionSummary(predId);
      const optLabel = summary?.prediction.options[optIdx];
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      if (!summary || !optLabel || summary.prediction.status !== 'open') {
        if (summary) {
          await editChannelMessage(
            interaction.client,
            summary.prediction.channelId,
            summary.prediction.messageId,
            buildPredictionCard(summary, cfg),
            interaction.guild,
          );
        }
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: '该盘口当前不可下注或已封盘。' },
        );
      }
      if (summary.prediction.creatorId === actor.id) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: '开盘人不能押注自己发起的盘口，以保证公平！' },
        );
      }

      await interaction.showModal(buildPredBetModal(predId, optIdx, optLabel, cfg.currencyName));
      return true;
    },

    pred_lock: handlePredictionControl,
    pred_cancel: handlePredictionControl,
    pred_post: handlePredictionControl,
    world: handleWorldEventSection,

    modal: async ({ interaction, ctx, guildId, actor, parts }) => {
      if (parts[2] !== 'pred_create') return false;
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'predictions' }, { type: 'error', text: disabledMsg });
      }
      await interaction.showModal(buildCreatePredictionModal());
      return true;
    },
  },
};

export async function tryHandleWorldAndPredictionButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return dispatchByAction(parts[1], { interaction, ctx, guildId, actor, parts }, WORLD_AND_PRED_ROUTES);
}
