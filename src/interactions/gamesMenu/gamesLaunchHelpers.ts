import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  UserSelectMenuInteraction,
} from 'discord.js';
import type { AppContext } from '../../core/context.js';
import type { PropKey } from '../../db/repositories/chaosRepo.js';
import { PROP_KEYS } from '../../services/chaosService.js';
import { buildNumberBombCard, buildRouletteCard } from '../../ui/chaosMenuBuilder.js';
import type { MenuActor, MenuFeedback } from '../../ui/menuShared.js';
import { buildProposalCard } from '../../ui/socialPetMenuBuilder.js';
import { buildWorldBossCard, buildWorldChestCard } from '../../ui/worldEventMenuBuilder.js';
import {
  checkModuleDisabled,
  editChannelMessage,
  resolveGameChatChannelId,
  sendPublicBroadcast,
  sendToChannel,
} from '../menuHelpers.js';

export function isValidPropKey(raw: string | undefined): raw is PropKey {
  return PROP_KEYS.includes(raw as PropKey);
}

export async function launchRouletteRoom(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  entryFee: number,
  maxPlayers: number,
): Promise<MenuFeedback> {
  const disabledMsg =
    checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
    checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) return { type: 'error', text: disabledMsg };

  if (!interaction.channel?.isSendable()) {
    return { type: 'error', text: '当前频道不支持发送公开轮盘卡片，请切换普通文字频道。' };
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.chaos.createRoulette({
    guildId,
    channelId: interaction.channel.id,
    hostId: actor.id,
    entryFee,
    maxPlayers,
  });
  if (!res.ok) {
    if (res.reason === 'deadbeat_blocked') {
      return {
        type: 'error',
        text: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止开轮盘局！',
      };
    }
    if (res.reason === 'insufficient_funds') {
      return {
        type: 'error',
        text: `你的口袋现金不足以支付入场费 **${entryFee}** ${cfg.currencyName}。`,
      };
    }
    if (res.reason === 'invalid_max_players') {
      return { type: 'error', text: '房间人数上限必须在 2 ~ 6 人之间。' };
    }
    return { type: 'error', text: '轮盘入场费必须为 50 ~ 1,000,000,000 之间的整数。' };
  }

  const broadcast = await sendPublicBroadcast(interaction, {
    content: `🔫 <@${actor.id}> 开了一桌 **${entryFee}** ${cfg.currencyName} 的俄罗斯轮盘吃鸡局（最多 ${maxPlayers} 人），快来上桌！`,
    ...buildRouletteCard(res.game, cfg),
  });

  if (!broadcast.sent || !broadcast.messageId) {
    ctx.services.chaos.cancelRoulette(res.game.id, actor.id, true);
    return {
      type: 'error',
      text: '无法在当前频道发送轮盘牌桌消息，入场费已自动退回。',
    };
  }

  ctx.services.chaos.bindRouletteMessage(res.game.id, broadcast.messageId);
  return {
    type: 'success',
    text: `🔫 轮盘房间 **#${res.game.id}** 已开桌（入场 **${entryFee}** ${cfg.currencyName}），当前现金 **${res.hostBalance}**！`,
  };
}

export async function launchNumberBomb(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  penalty: number,
): Promise<MenuFeedback> {
  const disabledMsg =
    checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
    checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) return { type: 'error', text: disabledMsg };

  if (!interaction.channel?.isSendable()) {
    return { type: 'error', text: '当前频道不支持发送数字炸弹，请切换普通文字频道。' };
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.chaos.createNumberBomb({
    guildId,
    channelId: interaction.channel.id,
    hostId: actor.id,
    penalty,
  });
  if (!res.ok) {
    const text =
      res.reason === 'deadbeat_blocked'
        ? '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止发起数字炸弹！'
        : res.reason === 'insufficient_funds'
          ? `你自己的口袋现金需 >= **${penalty}** ${cfg.currencyName} 才能发起该档位数字炸弹。`
          : '数字炸弹罚金必须在 100 ~ 1,000,000,000 之间。';
    return { type: 'error', text };
  }

  const broadcast = await sendPublicBroadcast(interaction, {
    content: `💣 <@${actor.id}> 在频道丢下了一颗罚金 **${penalty}** ${cfg.currencyName} 的数字炸弹！`,
    ...buildNumberBombCard(res.game, cfg),
  });

  if (!broadcast.sent || !broadcast.messageId) {
    ctx.services.chaos.cancelNumberBomb(res.game.id);
    return { type: 'error', text: '无法在当前频道发送数字炸弹消息，请检查发送权限。' };
  }

  ctx.services.chaos.bindNumberBombMessage(res.game.id, broadcast.messageId);
  return {
    type: 'success',
    text: `💣 数字炸弹 **#${res.game.id}** 已扔进当前频道，快和群友一起抢猜！`,
  };
}

export async function spawnAndPostWorldEvent(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  kind: 'chest' | 'boss',
): Promise<MenuFeedback> {
  const disabledMsg =
    checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件') ??
    checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return { type: 'error', text: disabledMsg };
  }

  const activeEvents = ctx.services.worldEvent.listActiveWorldEvents(guildId);
  if (activeEvents.length > 0) {
    const existing = activeEvents[0]!;
    return {
      type: 'error',
      text: `⚠️ 当前已有活跃世界事件「**${existing.name}**」（#${existing.id}）正在进行中，请待其结束后再手动召唤！`,
    };
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const targetChannelId = resolveGameChatChannelId(
    interaction.guild,
    cfg,
    ctx.repos.guildConfig,
  );
  if (!targetChannelId) {
    return {
      type: 'error',
      text: '未绑定世界事件频道且未找到 #游戏聊天，请先在下方频道选择器指定游戏聊天频道！',
    };
  }

  const event =
    kind === 'chest'
      ? ctx.services.worldEvent.spawnChest(guildId, targetChannelId)
      : ctx.services.worldEvent.spawnBoss(guildId, targetChannelId);

  const payload =
    kind === 'chest'
      ? {
          content: `🎁 天降大宝箱！<#${targetChannelId}> 刷出了 **${event.name}**，快抢！`,
          ...buildWorldChestCard(event, [], cfg.economy),
        }
      : {
          content: `👹 警报！世界 Boss **${event.name}** 降临 <#${targetChannelId}>，快来合力讨伐！`,
          ...buildWorldBossCard(event, [], cfg.economy),
        };

  const msgId = await sendToChannel(interaction.client, targetChannelId, payload);
  if (!msgId) {
    ctx.repos.worldEvent.saveWorldEvent({ ...event, status: 'expired' });
    return { type: 'error', text: `无法向频道 <#${targetChannelId}> 发送事件卡片，请检查权限。` };
  }
  ctx.services.worldEvent.bindWorldEventMessage(event.id, msgId, targetChannelId);
  return {
    type: 'success',
    text: `已在 <#${targetChannelId}> 召唤 ${kind === 'chest' ? '🎁 宝箱' : '👹 Boss'}「**${event.name}**」（#${event.id}）！`,
  };
}

export async function repostWorldEventCard(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  eventId: number,
): Promise<MenuFeedback> {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const detail = ctx.services.worldEvent.getWorldEventDetail(eventId);
  if (!detail || detail.event.status !== 'active') {
    return { type: 'error', text: '事件已结束，无法重复推送卡片。' };
  }

  const oldChannelId = detail.event.channelId;
  const oldMessageId = detail.event.messageId;
  const payload =
    detail.event.eventType === 'chest'
      ? {
          content: `🎁 天降宝箱 **${detail.event.name}** 来啦，快来抢！`,
          ...buildWorldChestCard(detail.event, detail.participants, cfg.economy),
        }
      : {
          content: `👹 世界 Boss **${detail.event.name}** 正在肆虐，快来集火！`,
          ...buildWorldBossCard(detail.event, detail.participants, cfg.economy),
        };

  const gameChatChannelId = resolveGameChatChannelId(
    interaction.guild,
    cfg,
    ctx.repos.guildConfig,
  );
  let sent = false;
  let sentMsgId: string | null = null;
  let targetChannelId = oldChannelId;
  if (gameChatChannelId && gameChatChannelId !== interaction.channelId) {
    sentMsgId = await sendToChannel(interaction.client, gameChatChannelId, payload);
    sent = Boolean(sentMsgId);
    targetChannelId = gameChatChannelId;
  } else {
    const broadcast = await sendPublicBroadcast(interaction, payload);
    sent = broadcast.sent;
    sentMsgId = broadcast.messageId;
    targetChannelId = gameChatChannelId ?? interaction.channelId ?? oldChannelId;
  }

  if (sent && sentMsgId) {
    ctx.services.worldEvent.bindWorldEventMessage(detail.event.id, sentMsgId, targetChannelId);
    if (oldMessageId && (oldMessageId !== sentMsgId || oldChannelId !== targetChannelId)) {
      await editChannelMessage(
        interaction.client,
        oldChannelId,
        oldMessageId,
        { components: [] },
        interaction.guild,
      );
    }
  }

  return sent
    ? { type: 'success', text: `📢 事件卡片已发送到 <#${targetChannelId}>（旧卡片按钮已禁用）！` }
    : { type: 'error', text: '无法在目标频道发送消息。' };
}

export async function launchCpProposal(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  targetId: string,
  relType: 'marriage' | 'sworn',
): Promise<MenuFeedback> {
  if (!interaction.channel?.isSendable()) {
    return { type: 'error', text: '当前频道不支持发送公开仪式卡片。' };
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.socialPet.createProposal({
    guildId,
    channelId: interaction.channel.id,
    proposerId: actor.id,
    targetId,
    relType,
  });
  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      self_target: '不能选自己！',
      already_related: `你和 <@${targetId}> 已经绑定过关系了！`,
      pending_proposal_exists: `你与 <@${targetId}> 之间已有未过期的待处理邀请，请先等待对方回应或撤回后再试！`,
      proposer_married: '你已经结婚啦，婚姻严格 1 对 1（如需重新绑定请先解除）。',
      target_married: `<@${targetId}> 已经有伴侣啦！`,
      proposer_max_sworn: `你的结拜/死党人数已达上限（${res.maxSworn ?? 3}人）。`,
      target_max_sworn: `<@${targetId}> 的结拜人数已满。`,
      insufficient_funds: `口袋现金不足，发起仪式需要 **${res.cost}** ${cfg.currencyName}。`,
    };
    return { type: 'error', text: msgMap[res.reason] };
  }

  const broadcast = await sendPublicBroadcast(interaction, {
    allowedMentions: { users: [targetId] },
    content:
      relType === 'marriage'
        ? `💍 <@${actor.id}> 当众单膝跪地向 <@${targetId}> 求婚啦！快来看 TA 答不答应！`
        : `🍻 <@${actor.id}> 向 <@${targetId}> 发出桃园结拜邀请！`,
    ...buildProposalCard(res.proposal, cfg),
  });
  if (!broadcast.sent || !broadcast.messageId) {
    ctx.services.socialPet.declineProposal(res.proposal.id, actor.id);
    return { type: 'error', text: '发送仪式卡片失败，费用已退回。' };
  }

  ctx.services.socialPet.bindProposalMessage(res.proposal.id, broadcast.messageId);
  return {
    type: 'success',
    text: `🎉 已向 <@${targetId}> 发出公开${relType === 'marriage' ? '求婚' : '结拜'}邀请（仪式编号 #${res.proposal.id}），剩余现金：**${res.balance}**！`,
  };
}
