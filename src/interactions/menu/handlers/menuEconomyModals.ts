import { createSuccessEmbed } from '../../../ui/embeds.js';
import {
  buildDuelMessage,
  buildRedPacketMessage,
} from '../../../ui/menuBuilder.js';
import { formatShopBuyError } from '../../../ui/menuShared.js';
import {
  checkModuleDisabled,
  parsePositiveInt,
  respondFromModal,
  sendPublicBroadcast,
} from '../../menuHelpers.js';
import { dispatchByAction, type ActionRouteTable } from '../subRouter.js';
import { runBankTransferAction } from './economyBankRobButtons.js';
import {
  deferModalForWrite,
  editModalPage,
  parseDiceChoice,
  replyModalPage,
  type MenuModalContext,
} from './menuSharedModalsAndParsers.js';
import {
  buildBlackjackResponse,
  runDiceAction,
  runSlotsAction,
} from './soloGameButtons.js';

async function handleSlotsModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor } = input;
  const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
  if (!amount) {
    await replyModalPage(input, { page: 'slots' }, { type: 'error', text: '请输入有效的正整数下注金额。' });
    return;
  }
  const out = runSlotsAction(ctx, guildId, actor, amount);
  await respondFromModal(interaction, out.msg);
  if (out.highlight) {
    await sendPublicBroadcast(interaction, out.highlight);
  }
}

async function handleDiceModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor, parts } = input;
  const choice = parseDiceChoice(parts[3]);
  const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
  if (!amount) {
    await replyModalPage(input, { page: 'dice', choice }, { type: 'error', text: '请输入有效的正整数下注金额。' });
    return;
  }
  const out = runDiceAction(ctx, guildId, actor, choice, amount);
  await respondFromModal(interaction, out.msg);
  if (out.highlight) {
    await sendPublicBroadcast(interaction, out.highlight);
  }
}

async function handleBlackjackModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor } = input;
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await replyModalPage(input, { page: 'bj' }, { type: 'error', text: disabledMsg });
    return;
  }
  const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
  if (!amount) {
    await replyModalPage(input, { page: 'bj' }, { type: 'error', text: '请输入有效的正整数下注金额。' });
    return;
  }
  const res = ctx.services.blackjack.startGame(guildId, actor.id, amount);
  const out = buildBlackjackResponse(ctx, guildId, actor, res);
  await respondFromModal(interaction, out.msg);
  if (out.highlight) {
    await sendPublicBroadcast(interaction, out.highlight);
  }
}

async function handleBankModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor, modalType } = input;
  const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
  if (!amount) {
    await replyModalPage(input, { page: 'bank' }, { type: 'error', text: '请输入有效的正整数金额。' });
    return;
  }
  await respondFromModal(
    interaction,
    runBankTransferAction(ctx, guildId, actor, modalType === 'bank_dep' ? 'deposit' : 'withdraw', amount),
  );
}

async function handlePayModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor, parts } = input;
  const targetId = parts[3];
  if (!targetId) return;

  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await replyModalPage(input, { page: 'pay' }, { type: 'error', text: disabledMsg });
    return;
  }

  const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
  if (!amount) {
    await replyModalPage(input, { page: 'pay' }, { type: 'error', text: '请输入有效的正整数转账金额。' });
    return;
  }

  await deferModalForWrite(interaction);
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.economy.transferCoins(guildId, actor.id, targetId, amount);
  if (!res.ok) {
    const reasonMap: Record<typeof res.reason, string> = {
      self_target: '不能给自己转账。',
      invalid_amount: '转账金额无效。',
      insufficient_funds: `口袋现金不足，无法转出 **${amount}** ${cfg.currencyName}。`,
      deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止转账！',
    };
    await editModalPage(input, { page: 'pay' }, { type: 'error', text: reasonMap[res.reason] });
    return;
  }

  await sendPublicBroadcast(interaction, {
    content: `💸 <@${actor.id}> 给 <@${targetId}> 转账了 **${res.amount}** ${cfg.currencyName}！`,
    embeds: [
      createSuccessEmbed(
        '💸 群友转账通知',
        `<@${actor.id}> 向 <@${targetId}> 转出了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
      ),
    ],
  });

  await editModalPage(input, { page: 'pay' }, {
    type: 'success',
    text: `已向 <@${targetId}> 转账 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！剩余现金：**${res.fromBalance}**。`,
  });
}

async function handleDuelModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor, parts } = input;
  const opponentId = parts[3];
  if (!opponentId) return;

  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await replyModalPage(input, { page: 'duel' }, { type: 'error', text: disabledMsg });
    return;
  }
  if (!interaction.channel?.isSendable()) {
    await replyModalPage(input, { page: 'duel' }, { type: 'error', text: '当前频道不支持发送公开决斗卡片。' });
    return;
  }

  const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
  if (!amount) {
    await replyModalPage(input, { page: 'duel' }, { type: 'error', text: '请输入有效的正整数赌注金额。' });
    return;
  }

  await deferModalForWrite(interaction);
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.multiplayer.createDuel(guildId, interaction.channel.id, actor.id, opponentId, amount);
  if (!res.ok) {
    const msgMap: Record<string, string> = {
      self_target: '不能向自己发起决斗！',
      invalid_bet: '决斗赌注必须在 1 ~ 1,000,000,000 之间。',
      insufficient_funds: `你的口袋现金不足以支付 **${amount}** ${cfg.currencyName} 赌注。`,
      deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与带赌注决斗！',
    };
    await editModalPage(input, { page: 'duel' }, { type: 'error', text: msgMap[res.reason] ?? '发起决斗失败，请重试。' });
    return;
  }

  const broadcast = await sendPublicBroadcast(interaction, {
    allowedMentions: { users: [opponentId] },
    content: `⚔️ <@${opponentId}>，你收到了一条骰子决斗挑战！`,
    ...buildDuelMessage(res.duel, cfg),
  });
  if (!broadcast.sent) {
    ctx.services.multiplayer.declineDuel(res.duel.id, actor.id);
    await editModalPage(input, { page: 'duel' }, {
      type: 'error',
      text: `在当前频道发送决斗卡片失败，请检查机器人发言权限（已自动退回冻结的 **${amount}** ${cfg.currencyName}）。`,
    });
    return;
  }

  if (broadcast.messageId) {
    ctx.services.multiplayer.bindDuelMessage(res.duel.id, broadcast.messageId);
  }
  await editModalPage(input, { page: 'duel' }, {
    type: 'success',
    text: `已向 <@${opponentId}> 发起 **${amount}** ${cfg.currencyName} 的骰子决斗！等待对方点击应战。`,
  });
}

async function handleRedPacketModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor } = input;
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await replyModalPage(input, { page: 'multi' }, { type: 'error', text: disabledMsg });
    return;
  }
  if (!interaction.channel?.isSendable()) {
    await replyModalPage(input, { page: 'multi' }, {
      type: 'error',
      text: '当前频道不支持发送公开红包消息，请在普通文字频道中重试。',
    });
    return;
  }

  const totalAmount = parsePositiveInt(interaction.fields.getTextInputValue('totalAmount'));
  const totalCount = parsePositiveInt(interaction.fields.getTextInputValue('totalCount'));
  const greeting = interaction.fields.getTextInputValue('greeting').trim();

  if (!totalAmount || !totalCount) {
    await replyModalPage(input, { page: 'multi' }, {
      type: 'error',
      text: '红包总金额与份数必须为正整数（份数 2 ~ 100）。',
    });
    return;
  }

  await deferModalForWrite(interaction);
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.multiplayer.createRedPacket({
    guildId,
    channelId: interaction.channel.id,
    senderId: actor.id,
    totalAmount,
    totalCount,
    greeting,
  });

  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      invalid_count: '红包份数必须在 2 ~ 100 份之间。',
      invalid_amount: '红包总金额必须在 1 ~ 1,000,000,000 之间。',
      amount_too_small_for_count: `红包总金额不能小于红包份数（每份至少 1 ${cfg.currencyName}）。`,
      insufficient_funds: `你的口袋现金不足以包出 **${totalAmount}** ${cfg.currencyName} 的红包。`,
    };
    await editModalPage(input, { page: 'multi' }, { type: 'error', text: msgMap[res.reason] });
    return;
  }

  const sent = await sendPublicBroadcast(interaction, {
    content: `🧧 <@${actor.id}> 发了一个 **${res.packet.totalAmount}** ${cfg.currencyName} 的拼手气红包（${res.packet.totalCount} 份），快来抢！`,
    ...buildRedPacketMessage(res.packet, [], null, cfg),
  });
  if (!sent.sent || !sent.messageId) {
    ctx.db.transaction(() => {
      const marked = ctx.repos.redPacket.markExpired(res.packet.id);
      if (marked) {
        ctx.repos.profile.addCoins(guildId, actor.id, res.packet.totalAmount);
      }
    })();
    await editModalPage(input, { page: 'multi' }, {
      type: 'error',
      text: `发送红包消息失败，请检查机器人发言与嵌入链接权限（${cfg.currencyName}已自动退回）。`,
    });
    return;
  }

  ctx.services.multiplayer.bindRedPacketMessage(res.packet.id, sent.messageId);
  await editModalPage(input, { page: 'multi' }, {
    type: 'success',
    text: `🧧 拼手气红包已发出！总额 ${cfg.currencyEmoji} **${res.packet.totalAmount}** ${cfg.currencyName}（${res.packet.totalCount} 份），剩余现金：**${res.senderBalance}**。`,
  });
}

async function handleShopCustomTitleModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor, parts } = input;
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await replyModalPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
    return;
  }
  const itemId = parsePositiveInt(parts[3] ?? '');
  const titleText = interaction.fields.getTextInputValue('titleText').trim();
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  if (!itemId) {
    await replyModalPage(input, { page: 'shop' }, { type: 'error', text: '无效的商品编号。' });
    return;
  }
  const res = ctx.services.shop.buyCustomTitle(guildId, actor.id, itemId, titleText);
  if (!res.ok) {
    await replyModalPage(input, { page: 'shop' }, {
      type: 'error',
      text: formatShopBuyError(res.reason, cfg.currencyName, res.dailyLimit),
    });
    return;
  }
  await replyModalPage(input, { page: 'shop' }, {
    type: 'success',
    text: `✍️ 兑换成功！已花费 ${cfg.currencyEmoji} **${res.item.price}** 并为你佩戴专属称号 **「${res.equippedTitle}」**！剩余现金：**${res.balance}**。`,
  });
}

async function handleBagCustomTitleModal(input: MenuModalContext): Promise<void> {
  const { interaction, ctx, guildId, actor, parts } = input;
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await replyModalPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
    return;
  }
  const invId = parsePositiveInt(parts[3] ?? '');
  const titleText = interaction.fields.getTextInputValue('titleText').trim();
  if (!invId) {
    await replyModalPage(input, { page: 'bag' }, { type: 'error', text: '无效的兑换券编号。' });
    return;
  }
  const res = ctx.services.shop.redeemCustomTitleVoucher(guildId, actor.id, invId, titleText);
  if (!res.ok) {
    const errText =
      res.reason === 'already_owned'
        ? `你已经拥有称号「${titleText}」，请换一个称号名称（券未消耗）。`
        : res.reason === 'invalid_title'
          ? '称号需在 1 ~ 20 个字之间（券未消耗）。'
          : '兑换券不存在或已消耗。';
    await replyModalPage(input, { page: 'bag' }, { type: 'error', text: errText });
    return;
  }
  await replyModalPage(input, { page: 'bag' }, {
    type: 'success',
    text: `✍️ 自定义称号兑换成功！当前已佩戴 **「${res.equippedTitle}」**！`,
  });
}

const ECONOMY_MODAL_ROUTES: ActionRouteTable<MenuModalContext> = {
  exact: {
    shop_custom_title: handleShopCustomTitleModal,
    bag_custom_title: handleBagCustomTitleModal,
    slots: handleSlotsModal,
    dice: handleDiceModal,
    bj: handleBlackjackModal,
    bank_dep: handleBankModal,
    bank_wd: handleBankModal,
    pay: handlePayModal,
    duel: handleDuelModal,
    redpacket: handleRedPacketModal,
  },
};

export async function tryHandleEconomyModal(input: MenuModalContext): Promise<boolean> {
  return dispatchByAction(input.modalType, input, ECONOMY_MODAL_ROUTES);
}
