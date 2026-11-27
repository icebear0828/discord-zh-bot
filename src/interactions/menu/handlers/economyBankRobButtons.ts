import {
  BANK_ROB_ATTACKER_MIN_ASSETS,
  BANK_ROB_TARGET_MIN,
  ROB_ATTACKER_MIN_ASSETS,
  ROB_TARGET_MIN_COINS,
} from '../../../config/economyConstants.js';
import type { AppContext } from '../../../core/context.js';
import type { RobTargetHints } from '../../../services/economyService.js';
import { createErrorEmbed, createSuccessEmbed, formatDurationZh } from '../../../ui/embeds.js';
import { buildMenuMessage } from '../../../ui/menuBuilder.js';
import type { BuiltMenuMessage, MenuActor, MenuFeedback, MenuView } from '../../../ui/menuShared.js';
import {
  buildRobTargetHints,
  checkRobTargetIsAdmin,
  formatBankRobResultEmbed,
  formatPocketRobResultEmbed,
} from '../../../ui/soloFormatters.js';
import {
  checkModuleDisabled,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from '../../menuHelpers.js';
import { dispatchByAction, type ActionRouteTable } from '../subRouter.js';
import {
  buildAmountModal,
  buildRedPacketModal,
  parseDiceChoice,
  updateButtonPage,
  type MenuButtonContext,
  type MenuUserSelectContext,
} from './menuSharedModalsAndParsers.js';

export function runBankTransferAction(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  direction: 'deposit' | 'withdraw',
  amount: number,
): BuiltMenuMessage {
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text: disabledMsg });
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res =
    direction === 'deposit'
      ? ctx.services.economy.deposit(guildId, actor.id, amount)
      : ctx.services.economy.withdraw(guildId, actor.id, amount);

  if (!res.ok) {
    const text =
      res.reason === 'insufficient_funds'
        ? direction === 'deposit'
          ? '口袋现金余额不足，无法存入该金额。'
          : '银行存款余额不足，无法取出该金额。'
        : '请输入有效的正整数金额。';
    return buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text });
  }

  const verb = direction === 'deposit' ? '存入银行' : '从银行取出';
  return buildMenuMessage(
    ctx,
    guildId,
    actor,
    { page: 'bank' },
    {
      type: 'success',
      text: `已成功${verb} ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！（现金 **${res.coins}** ｜ 银行 **${res.bankCoins}**）`,
    },
  );
}

async function handleBankButton(input: MenuButtonContext): Promise<boolean> {
  const { ctx, guildId, actor, parts } = input;
  const sub = parts[2];

  if (sub === 'interest') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await updateButtonPage(input, { page: 'bank' }, { type: 'error', text: disabledMsg });
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.economy.claimBankInterest(guildId, actor.id);
    const feedback: MenuFeedback = res.ok
      ? {
          type: 'success',
          text: `成功领取今日银行利息 ${cfg.currencyEmoji} **+${res.interest}** ${cfg.currencyName}！当前银行存款：**${res.bankCoins}**。`,
        }
      : res.reason === 'already_claimed'
        ? { type: 'error', text: '你今天已经领过银行利息啦，请明天再来！' }
        : {
            type: 'error',
            text: `银行存款需至少达到 **${res.minDeposit ?? cfg.bankInterestMinDeposit}** ${cfg.currencyName} 才可领取每日利息。`,
          };
    await updateButtonPage(input, { page: 'bank' }, feedback);
    return true;
  }

  if (sub === 'dep' || sub === 'wd') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await updateButtonPage(input, { page: 'bank' }, { type: 'error', text: disabledMsg });
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
    const source = sub === 'dep' ? profile.coins : profile.bankCoins;
    const mode = parts[3];
    const amount =
      mode === 'all' ? source : mode === '50' ? Math.floor(source * 0.5) : Math.floor(source * 0.25);

    if (amount < 1) {
      const text =
        sub === 'dep'
          ? `口袋现金不足，按比例计算不足 1 ${cfg.currencyName}，无法存入。`
          : `银行存款不足，按比例计算不足 1 ${cfg.currencyName}，无法取出。`;
      await updateButtonPage(input, { page: 'bank' }, { type: 'error', text });
      return true;
    }

    await input.interaction.update(
      runBankTransferAction(ctx, guildId, actor, sub === 'dep' ? 'deposit' : 'withdraw', amount),
    );
    return true;
  }

  return false;
}

async function handleEconomyModalTrigger(input: MenuButtonContext): Promise<boolean> {
  const { interaction, ctx, guildId, parts } = input;
  const modalType = parts[2];
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    const fallbackView: MenuView =
      modalType === 'slots'
        ? { page: 'slots' }
        : modalType === 'dice'
          ? { page: 'dice', choice: parseDiceChoice(parts[3]) }
          : modalType === 'bj'
            ? { page: 'bj' }
            : modalType === 'bank_dep' || modalType === 'bank_wd'
              ? { page: 'bank' }
              : { page: 'multi' };
    await updateButtonPage(input, fallbackView, { type: 'error', text: disabledMsg });
    return true;
  }

  if (modalType === 'slots') {
    await interaction.showModal(
      buildAmountModal('menu:modal_sub:slots', '🎰 老虎机自定义下注', '下注金额（正整数）', '例如：200'),
    );
    return true;
  }
  if (modalType === 'dice') {
    const choice = parseDiceChoice(parts[3]);
    await interaction.showModal(
      buildAmountModal(`menu:modal_sub:dice:${choice}`, '🎲 猜大小自定义下注', '下注金额（正整数）', '例如：200'),
    );
    return true;
  }
  if (modalType === 'bj') {
    await interaction.showModal(
      buildAmountModal('menu:modal_sub:bj', '🃏 二十一点自定义下注', '下注金额（正整数）', '例如：200'),
    );
    return true;
  }
  if (modalType === 'bank_dep') {
    await interaction.showModal(
      buildAmountModal('menu:modal_sub:bank_dep', '📥 自定义存入银行', '存入金额（正整数）', '例如：500'),
    );
    return true;
  }
  if (modalType === 'bank_wd') {
    await interaction.showModal(
      buildAmountModal('menu:modal_sub:bank_wd', '📤 自定义从银行取出', '取出金额（正整数）', '例如：500'),
    );
    return true;
  }
  if (modalType === 'redpacket') {
    if (!interaction.channel?.isSendable()) {
      await updateButtonPage(input, { page: 'multi' }, {
        type: 'error',
        text: '当前频道不支持发送公开红包消息，请在普通文字频道中重试。',
      });
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    await interaction.showModal(buildRedPacketModal(cfg.currencyName));
    return true;
  }

  return false;
}

const ECONOMY_BANK_BUTTON_ROUTES: ActionRouteTable<MenuButtonContext> = {
  exact: {
    bank: handleBankButton,
    modal: handleEconomyModalTrigger,
  },
};

export async function tryHandleEconomyBankRobButton(input: MenuButtonContext): Promise<boolean> {
  return dispatchByAction(input.parts[1], input, ECONOMY_BANK_BUTTON_ROUTES);
}

async function resolveRobTargetHintsForSelect(
  input: MenuUserSelectContext,
): Promise<RobTargetHints> {
  const { interaction, ctx, guildId, targetId, targetUser } = input;
  const fullCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const targetMember =
    interaction.guild?.members?.cache?.get(targetId) ??
    (typeof interaction.guild?.members?.fetch === 'function'
      ? await interaction.guild.members.fetch(targetId).catch(() => null)
      : null);
  const isTargetAdmin = checkRobTargetIsAdmin(
    targetId,
    targetMember,
    fullCfg,
    interaction.guild?.ownerId,
  );
  return buildRobTargetHints(targetUser, targetMember, isTargetAdmin);
}

async function guardRobPreconditions(
  input: MenuUserSelectContext,
  botErrorText: string,
  selfErrorText: string,
): Promise<boolean> {
  const { interaction, ctx, guildId, actor, targetId, targetUser } = input;
  const errText = targetUser?.bot
    ? botErrorText
    : targetId === actor.id
      ? selfErrorText
      : checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (!errText) return true;
  await interaction.update(
    buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, { type: 'error', text: errText }),
  );
  return false;
}

export async function handlePocketRobUserSelect(input: MenuUserSelectContext): Promise<void> {
  if (!(await guardRobPreconditions(input, '机器人没有钱包，换个真实群友试试吧！', '不能打劫自己！'))) {
    return;
  }
  const { interaction, ctx, guildId, actor, targetId, targetUser } = input;

  await interaction.deferUpdate();
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const targetHints = await resolveRobTargetHintsForSelect(input);
  const res = ctx.services.economy.rob(guildId, actor.id, targetId, Date.now(), Math.random, targetHints);
  if (!res.ok) {
    const msgMap: Record<string, string> = {
      self_target: '不能打劫自己！',
      cooldown: `打劫冷却中，请等待 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
      target_shielded: `<@${targetId}> 防盗护盾生效中，剩余 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
      target_too_poor: `<@${targetId}> 口袋现金不足 ${ROB_TARGET_MIN_COINS} ${cfg.currencyName}，放过 TA 吧。`,
      attacker_too_poor: `你的总资产（现金+存款）不足 **${ROB_ATTACKER_MIN_ASSETS}** ${cfg.currencyName}，无法发起打劫！`,
    };
    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, { type: 'error', text: msgMap[res.reason] ?? '当前无法发起打劫，请稍后再试。' }),
    );
    return;
  }

  const targetName = targetUser?.displayName ?? '群友';
  const hasBounty = Boolean(res.success && res.bountyClaimed && res.bountyClaimed > 0);
  const fineFromBank = !res.success ? (res.fineFromBank ?? 0) : 0;
  const fineFromPocket = !res.success ? (res.fineFromPocket ?? res.amount) : 0;
  const fineDetail =
    !res.success && fineFromBank > 0
      ? `（扣口袋现金 **${fineFromPocket}** + 联动划扣银行存款 **${fineFromBank}**）`
      : '';
  const bankSuffix =
    !res.success &&
    typeof res.attackerBankBalance === 'number' &&
    (fineFromBank > 0 || res.easterEggTriggered)
      ? `（银行 **${res.attackerBankBalance}**）`
      : '';

  const broadcast = await sendPublicBroadcast(
    interaction,
    res.success
      ? {
          allowedMentions: hasBounty ? { users: [targetId] } : { parse: [] },
          content: hasBounty
            ? `🥷 <@${actor.id}> 抢了 <@${targetId}> **${res.amount}** ${cfg.currencyName}！顺手领走通缉赏金 **+${res.bountyClaimed}**！`
            : `🥷 **${actor.displayName}** 抢了 **${targetName}** **${res.amount}** ${cfg.currencyName}！`,
          embeds: [
            createSuccessEmbed(
              '🥷 频道快报：抢钱得手！',
              [
                `<@${actor.id}>${res.usedLockpick ? '（🗝️ 使用万能撬锁）' : ''} 从 <@${targetId}> 的口袋里抢走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
                ...(res.bountyClaimed && res.bountyClaimed > 0
                  ? [`🎯 **通缉令兑现**：成功击破通缉目标，额外独吞赏金 **+${res.bountyClaimed}** ${cfg.currencyName}！`]
                  : []),
                `受害者剩余现金：**${res.targetBalance}** ｜ 抢劫者当前现金：**${res.attackerBalance}**`,
                `🛡️ <@${targetId}> 已自动触发防盗护盾（快把现金存进银行降低风险吧！）`,
              ].join('\n'),
            ),
          ],
        }
      : res.easterEggTriggered
        ? {
            allowedMentions: { parse: [] },
            content: `🚨 **${actor.displayName}** 抢 **${targetName}** 翻车被抓，反赔了 **${res.amount}** ${cfg.currencyName}！`,
            embeds: [formatPocketRobResultEmbed(res, targetId, cfg)],
          }
        : {
            allowedMentions: { parse: [] },
            content: res.trapped
              ? `🪤 **${actor.displayName}** 偷 **${targetName}** 时一脚踩中防盗捕兽夹，双倍赔了 **${res.amount}** ${cfg.currencyName}！`
              : `🚨 **${actor.displayName}** 抢 **${targetName}** 翻车被抓，反赔了 **${res.amount}** ${cfg.currencyName}！`,
            embeds: [
              createErrorEmbed(
                res.trapped ? '🪤 频道快报：捕兽夹反抓小偷！' : '🚨 频道快报：抢钱翻车现场！',
                [
                  res.trapped
                    ? `<@${actor.id}> 偷钱时一头撞进 <@${targetId}> 预设的【🪤 捕兽夹】，被反抓双倍赔款 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}！`
                    : `<@${actor.id}> 企图打劫 <@${targetId}> 时翻车被抓，现场赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}！`,
                  ...(res.usedLockpick ? ['🗝️ 本次行动已消耗【万能撬锁】。'] : []),
                  `抢劫者当前现金：**${res.attackerBalance}**${bankSuffix} ｜ 受害者当前现金：**${res.targetBalance}**`,
                ].join('\n'),
              ),
            ],
          },
  );

  const warnSuffix = broadcast.sent ? '' : '\n⚠️ 当前频道未能发出公开快报，请检查机器人发言权限。';
  const feedback: MenuFeedback = res.success
    ? {
        type: 'success',
        text: `🥷 打劫得手！${res.usedLockpick ? '（🗝️ 撬锁生效）' : ''}从 <@${targetId}> 口袋顺走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${res.bountyClaimed ? `，并兑现悬赏 **+${res.bountyClaimed}**` : ''}，你的现金：**${res.attackerBalance}**。${warnSuffix}`,
      }
    : res.easterEggTriggered
      ? {
          type: 'error',
          text: `${res.easterEggStory ?? `🚨 打劫翻车被抓现行！向 <@${targetId}> 赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}。`}${fineDetail ? `\n💸 扣款明细：${fineDetail}` : ''}\n你的当前现金：**${res.attackerBalance}**${bankSuffix}。${warnSuffix}`,
        }
      : {
          type: 'error',
          text: res.trapped
            ? `🪤 踩雷了！对方提前埋了【捕兽夹】，强制翻倍赔偿 <@${targetId}> ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}，你的现金：**${res.attackerBalance}**${bankSuffix}。${warnSuffix}`
            : `🚨 打劫翻车被抓现行！向 <@${targetId}> 赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}，你的现金：**${res.attackerBalance}**${bankSuffix}。${warnSuffix}`,
        };

  await safeEditOrFollowUp(interaction, buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, feedback));
}

export async function handleBankRobUserSelect(input: MenuUserSelectContext): Promise<void> {
  if (!(await guardRobPreconditions(input, '机器人没有银行金库，换个真实群友试试吧！', '不能抢自己的银行金库！'))) {
    return;
  }
  const { interaction, ctx, guildId, actor, targetId, targetUser } = input;

  await interaction.deferUpdate();
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const targetHints = await resolveRobTargetHintsForSelect(input);
  const res = ctx.services.economy.robBank(guildId, actor.id, targetId, Date.now(), Math.random, targetHints);
  if (!res.ok) {
    const msgMap: Record<string, string> = {
      self_target: '不能抢自己的银行金库！',
      cooldown: `打劫冷却中，请等待 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
      target_shielded: `<@${targetId}> 防盗护盾生效中，剩余 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
      target_bank_too_poor: `<@${targetId}> 银行金库余额不足 ${BANK_ROB_TARGET_MIN} ${cfg.currencyName}，不值得动手。`,
      attacker_too_poor: `你的总资产（现金+存款）不足 **${BANK_ROB_ATTACKER_MIN_ASSETS}** ${cfg.currencyName}，无法发起强抢银行金库！`,
    };
    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, { type: 'error', text: msgMap[res.reason] ?? '当前无法强抢银行金库，请稍后再试。' }),
    );
    return;
  }

  const targetName = targetUser?.displayName ?? '群友';
  const hasBounty = Boolean(res.success && res.bountyClaimed && res.bountyClaimed > 0);
  const fineDetail =
    !res.success && (res.fineFromBank ?? 0) > 0
      ? `（扣口袋现金 **${res.fineFromPocket ?? 0}** + 划扣银行存款 **${res.fineFromBank ?? 0}**）`
      : '';

  const broadcast = await sendPublicBroadcast(
    interaction,
    res.success
      ? {
          allowedMentions: hasBounty ? { users: [targetId] } : { parse: [] },
          content: hasBounty
            ? `🏦💥 <@${actor.id}> 潜入银行金库撬开了 <@${targetId}> 的保险柜，劫走 **${res.amount}** ${cfg.currencyName} 并领走悬赏 **+${res.bountyClaimed}**！`
            : `🏦💥 **${actor.displayName}** 强攻银行金库得手，从 **${targetName}** 的保险柜里撬走了 **${res.amount}** ${cfg.currencyName}！`,
          embeds: [
            createSuccessEmbed(
              '🏦 频道快报：银行金库大劫案！',
              [
                `<@${actor.id}>${res.usedLockpick ? '（🗝️ 使用万能撬锁）' : ''} 突破重重安保，从 <@${targetId}> 的银行金库撬走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
                ...(res.bountyClaimed && res.bountyClaimed > 0
                  ? [`🎯 **通缉令兑现**：顺手击破通缉目标，额外独吞赏金 **+${res.bountyClaimed}** ${cfg.currencyName}！`]
                  : []),
                `受害者剩余金库：**${res.targetBankBalance}** ｜ 劫匪当前现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）`,
                `🛡️ <@${targetId}> 已触发金库最高级别防盗护盾！`,
              ].join('\n'),
            ),
          ],
        }
      : res.easterEggTriggered
        ? {
            allowedMentions: { parse: [] },
            content: `🚨🏦 **${actor.displayName}** 强抢 **${targetName}** 的银行金库触发警报被捕，重罚赔偿 **${res.amount}** ${cfg.currencyName}！`,
            embeds: [formatBankRobResultEmbed(res, targetId, cfg)],
          }
        : {
            allowedMentions: { parse: [] },
            content: res.trapped
              ? `🪤🏦 **${actor.displayName}** 强闯 **${targetName}** 的银行金库一脚踩中防盗捕兽夹，被重罚 **${res.amount}** ${cfg.currencyName}！`
              : `🚨🏦 **${actor.displayName}** 强抢 **${targetName}** 的银行金库触发警报被捕，重罚赔偿 **${res.amount}** ${cfg.currencyName}！`,
            embeds: [
              createErrorEmbed(
                res.trapped ? '🪤 频道快报：金库捕兽夹重创劫匪！' : '🚨 频道快报：抢银行金库翻车被捕！',
                [
                  res.trapped
                    ? `<@${actor.id}> 潜入 <@${targetId}> 的银行金库时触发【🪤 捕兽夹】与金库电网，被强制重罚 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}！`
                    : `<@${actor.id}> 企图爆破 <@${targetId}> 的银行金库时被巡逻警卫当场抓获，重罚赔偿 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}！`,
                  `劫匪剩余现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）｜ 受害者当前金库：**${res.targetBankBalance}**`,
                ].join('\n'),
              ),
            ],
          },
  );

  const warnSuffix = broadcast.sent ? '' : '\n⚠️ 当前频道未能发出公开快报，请检查机器人发言权限。';
  const feedback: MenuFeedback = res.success
    ? {
        type: 'success',
        text: `🏦 金库劫案得手！${res.usedLockpick ? '（🗝️ 撬锁生效）' : ''}从 <@${targetId}> 银行金库撬走 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${res.bountyClaimed ? `，并兑现悬赏 **+${res.bountyClaimed}**` : ''}，你的现金：**${res.attackerBalance}**。${warnSuffix}`,
      }
    : res.easterEggTriggered
      ? {
          type: 'error',
          text: `${res.easterEggStory ?? `🚨 抢金库翻车被抓！向 <@${targetId}> 赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}。`}${fineDetail ? `\n💸 扣款明细：${fineDetail}` : ''}\n你的当前现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）。${warnSuffix}`,
        }
      : {
          type: 'error',
          text: res.trapped
            ? `🪤 金库踩雷！触发对方【捕兽夹】，重罚赔偿 <@${targetId}> ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}，你的现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）。${warnSuffix}`
            : `🚨 抢金库触发警报被抓！向 <@${targetId}> 赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}，你的现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）。${warnSuffix}`,
        };

  await safeEditOrFollowUp(interaction, buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, feedback));
}
