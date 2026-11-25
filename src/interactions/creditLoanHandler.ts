import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { buildLeaderboardMessage } from '../commands/leveling/leaderboard.js';
import type { CreditReviewKind } from '../db/repositories/creditLoanRepo.js';
import type {
  RepayLoanResult,
  ReviewResult,
  TakeBankLoanResult,
  TakeUsuryLoanResult,
} from '../services/creditLoanService.js';
import {
  buildCreditReviewTargetView,
  buildCreditView,
  buildHustleView,
  buildLoanView,
  buildSellButtPublicEmbed,
} from '../ui/creditLoanMenuBuilder.js';
import { createErrorEmbed, formatDurationZh, type AppContext } from '../ui/embeds.js';
import {
  formatRatePercent,
  truncateText,
  type MenuFeedback,
} from '../ui/menuShared.js';
import {
  getActor,
  parsePositiveInt,
  respondFromModal,
  sendPublicBroadcast,
} from './menuHelpers.js';

function isCreditLoanModuleEnabled(ctx: AppContext, guildId: string): boolean {
  return ctx.repos.guildConfig.getOrCreate(guildId).modules.creditLoan;
}

async function replyModuleDisabled(
  interaction: ButtonInteraction | ModalSubmitInteraction | UserSelectMenuInteraction,
): Promise<void> {
  await interaction.reply({
    embeds: [
      createErrorEmbed(
        '🚫 模块未开启',
        '当前服务器已关闭「信用与借贷」模块，请联系管理员通过 `/菜单` → 管理后台开启。',
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

function parseUseBankFlag(raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === '是' ||
    normalized === 'y' ||
    normalized === 'yes' ||
    normalized === 'true' ||
    normalized === '1'
  );
}

function safeGetModalField(interaction: ModalSubmitInteraction, customId: string): string {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {
    return '';
  }
}

export function buildBankLoanModal(
  minAmount: number,
  maxAmount: number,
  maxDays: number,
  currencyName: string,
): ModalBuilder {
  const amountLabel =
    maxAmount > 0
      ? `贷款金额 (${minAmount}~${maxAmount} ${currencyName})`
      : '贷款金额 (需信用分≥300)';
  const termLabel = maxDays > 0 ? `借款天数 (1~${maxDays} 天)` : '借款天数 (至少 1 天)';

  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(truncateText(amountLabel, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setPlaceholder(maxAmount > 0 ? `输入 ${minAmount} ~ ${maxAmount} 之间的整数` : '信用分不足 300 暂不可申请')
    .setRequired(true);

  const termInput = new TextInputBuilder()
    .setCustomId('term_days')
    .setLabel(truncateText(termLabel, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(3)
    .setPlaceholder(maxDays > 0 ? `输入 1 ~ ${maxDays} 之间的天数` : '1')
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId('cl:submit:bank_loan')
    .setTitle(truncateText('🏦 申请银行信用贷', 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(termInput),
    );
}

export function buildUsuryLoanModal(
  minAmount: number,
  maxAmount: number,
  currencyName: string,
): ModalBuilder {
  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(truncateText(`高利贷金额 (${minAmount}~${maxAmount} ${currencyName})`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setPlaceholder(`输入 ${minAmount} ~ ${maxAmount} 之间的整数`)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId('cl:submit:usury_loan')
    .setTitle(truncateText('🩸 申请黑市高利贷', 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput));
}

export function buildRepayLoanModal(
  loanId: number,
  totalOwed: number,
  currencyName: string,
): ModalBuilder {
  const amountInput = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(truncateText(`还款金额 (当前应还 ${totalOwed} ${currencyName})`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setValue(String(totalOwed))
    .setPlaceholder(`输入还款金额，最高 ${totalOwed}`)
    .setRequired(true);

  const useBankInput = new TextInputBuilder()
    .setCustomId('use_bank')
    .setLabel(truncateText('口袋不足时动用银行存款？(是/否，默认否)', 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(0)
    .setMaxLength(6)
    .setValue('否')
    .setPlaceholder('填「是」允许银行补差，默认「否」')
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(`cl:submit:repay:${loanId}`)
    .setTitle(truncateText(`💸 偿还贷款 #${loanId}`, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(useBankInput),
    );
}

function formatReviewFeedback(
  kind: CreditReviewKind,
  targetId: string,
  res: ReviewResult,
): MenuFeedback {
  if (res.ok) {
    if (kind === 'endorse') {
      return {
        type: 'success',
        text: `👍 已为 <@${targetId}> 信用背书！对方信用分 **+${res.delta}**（当前 **${res.targetScore}** · ${res.targetTier.label}），今日剩余互评 **${res.remainingReviewsToday}** 次。`,
      };
    }
    return {
      type: 'success',
      text: `🚨 已举报 <@${targetId}>${res.targetIsOverdue ? '（命中逾期老赖加重处罚！）' : ''}！对方信用分 **${res.delta}**（当前 **${res.targetScore}** · ${res.targetTier.label}），今日剩余互评 **${res.remainingReviewsToday}** 次。`,
    };
  }

  const msgMap: Record<typeof res.reason, string> = {
    self_target: '不能对自己进行点赞或举报操作哦！',
    daily_limit_reached: `今日群友互评次数已达上限（每日限 **${res.dailyLimit ?? 3}** 次），请明天再来！`,
    target_cooldown: `你最近已经评价过 <@${targetId}> 了，请等待 **${formatDurationZh((res.retryAfterSec ?? 1) * 1000)}** 后再试。`,
    target_daily_cap: `<@${targetId}> 今日通过群友互评的信用变动已达上限，请改日再评。`,
  };
  return { type: 'error', text: msgMap[res.reason] };
}

function formatBankLoanFeedback(
  res: TakeBankLoanResult,
  currencyName: string,
  currencyEmoji: string,
): MenuFeedback {
  if (res.ok) {
    const dueUnix = Math.floor(res.loan.dueAt / 1000);
    return {
      type: 'success',
      text: [
        `🏦 银行信用贷 **#${res.loan.id}** 放款成功！已到账 ${currencyEmoji} **+${res.loan.principal.toLocaleString()}** ${currencyName}。`,
        `日息 **${formatRatePercent(res.loan.dailyRate)}** ｜ 期限 **${res.loan.termDays}** 天 ｜ 到期 <t:${dueUnix}:R> ｜ 当前现金 **${res.balance.toLocaleString()}** ${currencyName}。`,
      ].join('\n'),
    };
  }

  const msgMap: Record<typeof res.reason, string> = {
    credit_too_low: `信用分不足（当前 **${res.score ?? 0}**，银行信用贷需 ≥ **${res.minScore ?? 300}**），暂无法申请。`,
    has_overdue_loan: '你当前存在逾期未还贷款，请先结清逾期欠款后再申请银行信用贷！',
    active_bank_loan_exists: '你已有一笔未结清的银行信用贷，请先结清后再借新账。',
    invalid_amount: `贷款金额须在 **${(res.minAmount ?? 500).toLocaleString()} ~ ${(res.maxAmount ?? 0).toLocaleString()}** ${currencyName} 之间。`,
    invalid_term: `借款期限须在 **${res.minDays ?? 1} ~ ${res.maxDays ?? 1}** 天之间。`,
  };
  return { type: 'error', text: msgMap[res.reason] };
}

function formatUsuryLoanFeedback(
  res: TakeUsuryLoanResult,
  currencyName: string,
  currencyEmoji: string,
): MenuFeedback {
  if (res.ok) {
    const dueUnix = Math.floor(res.loan.dueAt / 1000);
    return {
      type: 'success',
      text: [
        `🩸 黑市高利贷 **#${res.loan.id}** 到账 ${currencyEmoji} **+${res.loan.principal.toLocaleString()}** ${currencyName}！当前现金 **${res.balance.toLocaleString()}** ${currencyName}。`,
        `⚠️ 日息 **${formatRatePercent(res.loan.dailyRate)}**，请务必在 <t:${dueUnix}:R> 前还清，逾期将被强制划扣并发布全服通缉！`,
      ].join('\n'),
    };
  }

  const msgMap: Record<typeof res.reason, string> = {
    active_usury_loan_exists: '你已背着一笔未结清的黑市高利贷，黑市老板拒绝重复放款！',
    invalid_amount: `高利贷金额须在 **${(res.minAmount ?? 1000).toLocaleString()} ~ ${(res.maxAmount ?? 100000).toLocaleString()}** ${currencyName} 之间。`,
  };
  return { type: 'error', text: msgMap[res.reason] };
}

function formatRepayFeedback(
  res: RepayLoanResult,
  currencyName: string,
  currencyEmoji: string,
  pocketCoins?: number,
  bankCoins?: number,
): MenuFeedback {
  if (res.ok) {
    const splitNote =
      res.paidFromBank > 0
        ? `（口袋 ${res.paidFromPocket.toLocaleString()} ＋ 银行 ${res.paidFromBank.toLocaleString()}）`
        : '';
    const lines = [
      `💸 已偿还贷款 **#${res.loan.id}** 共 ${currencyEmoji} **${res.paidAmount.toLocaleString()}** ${currencyName}${splitNote}（冲抵利息 ${res.interestPaid.toLocaleString()} ＋ 本金 ${res.principalPaid.toLocaleString()}）。`,
    ];
    if (res.fullyRepaid) {
      lines.push(
        res.creditDelta > 0
          ? `🎉 **贷款已全额结清！** 按期履约奖励信用分 **+${res.creditDelta}**（当前 **${res.creditScore}**）！`
          : '🎉 **贷款已全额结清！**',
      );
      if (res.deadbeatCleared) {
        lines.push('✨ 你的失信老赖限制已全部解除，恢复正常金融与博弈资格！');
      }
    } else {
      lines.push(`剩余应还：**${res.remainingDebt.toLocaleString()}** ${currencyName}。`);
    }
    return { type: 'success', text: lines.join('\n') };
  }

  if (res.reason === 'insufficient_funds') {
    const extraHint =
      pocketCoins !== undefined && bankCoins !== undefined
        ? `（口袋 ${pocketCoins.toLocaleString()} / 银行 ${bankCoins.toLocaleString()}）`
        : '';
    return {
      type: 'error',
      text: `余额不足！本次需还 **${(res.required ?? 0).toLocaleString()}** ${currencyName}，可用仅 **${(res.available ?? 0).toLocaleString()}** ${currencyName}${extraHint}。`,
    };
  }

  const msgMap: Record<Exclude<typeof res.reason, 'insufficient_funds'>, string> = {
    invalid_amount: '请输入有效的正整数还款金额。',
    loan_not_found: '找不到该笔贷款记录，请刷新页面后重试。',
    already_repaid: '该笔贷款已经全部结清啦！',
  };
  return { type: 'error', text: msgMap[res.reason] };
}

export async function handleCreditLoanButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  if (!isCreditLoanModuleEnabled(ctx, guildId)) {
    await replyModuleDisabled(interaction);
    return;
  }

  const nowMs = Date.now();
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const creditCfg = ctx.services.creditLoan.getConfig(guildId);
  const actor = getActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  const category = parts[1];
  const action = parts[2];

  if (category === 'nav' && action === 'review') {
    const kind = parts[3];
    if (kind !== 'endorse' && kind !== 'report') return;
    await interaction.update(
      buildCreditReviewTargetView(ctx, guildId, actor, kind, undefined, nowMs),
    );
    return;
  }

  if (category === 'open') {
    if (action === 'loan') {
      await interaction.reply({
        ...buildLoanView(ctx, guildId, actor, undefined, nowMs),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (action === 'credit') {
      await interaction.reply({
        ...buildCreditView(ctx, guildId, actor, undefined, nowMs),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (action === 'hustle') {
      await interaction.reply({
        ...buildHustleView(ctx, guildId, actor, undefined, nowMs),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (action === 'hustle_lb') {
      await interaction.reply({
        ...buildLeaderboardMessage(ctx, guildId, 'hustle', 1),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    return;
  }

  if (category === 'modal') {
    if (action === 'bank_loan') {
      const summary = ctx.services.creditLoan.getCreditProfile(guildId, actor.id, nowMs);
      const maxAmount = Math.min(summary.tier.bankLoanMax, creditCfg.bankLoanMaxCap);
      await interaction.showModal(
        buildBankLoanModal(
          creditCfg.bankLoanMin,
          maxAmount,
          summary.tier.bankMaxDays,
          cfg.economy.currencyName,
        ),
      );
      return;
    }

    if (action === 'usury_loan') {
      await interaction.showModal(
        buildUsuryLoanModal(
          creditCfg.usuryLoanMin,
          creditCfg.usuryLoanMax,
          cfg.economy.currencyName,
        ),
      );
      return;
    }

    if (action === 'repay') {
      const loanId = parsePositiveInt(parts[3] ?? '');
      if (!loanId) {
        await interaction.update(
          buildLoanView(ctx, guildId, actor, { type: 'error', text: '无效的贷款编号。' }, nowMs),
        );
        return;
      }

      const loan = ctx.repos.creditLoan.getLoanById(loanId);
      if (!loan || loan.guildId !== guildId || loan.userId !== actor.id || loan.status === 'repaid') {
        await interaction.update(
          buildLoanView(
            ctx,
            guildId,
            actor,
            { type: 'error', text: '该笔贷款不存在或已结清。' },
            nowMs,
          ),
        );
        return;
      }

      const totalOwed = loan.remainingPrincipal + loan.accruedInterest;
      await interaction.showModal(
        buildRepayLoanModal(loan.id, totalOwed, cfg.economy.currencyName),
      );
      return;
    }
    return;
  }

  if (category === 'act') {
    if (action === 'repay_full') {
      const loanId = parsePositiveInt(parts[3] ?? '');
      if (!loanId) {
        await interaction.update(
          buildLoanView(ctx, guildId, actor, { type: 'error', text: '无效的贷款编号。' }, nowMs),
        );
        return;
      }

      const loan = ctx.repos.creditLoan.getLoanById(loanId);
      if (!loan || loan.guildId !== guildId || loan.userId !== actor.id) {
        await interaction.update(
          buildLoanView(
            ctx,
            guildId,
            actor,
            { type: 'error', text: '找不到该笔贷款记录。' },
            nowMs,
          ),
        );
        return;
      }

      if (loan.status === 'repaid') {
        await interaction.update(
          buildLoanView(
            ctx,
            guildId,
            actor,
            { type: 'info', text: '该笔贷款已经结清啦！' },
            nowMs,
          ),
        );
        return;
      }

      const totalOwed = loan.remainingPrincipal + loan.accruedInterest;
      const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
      const useBank = profile.coins < totalOwed && profile.coins + profile.bankCoins >= totalOwed;
      const res = ctx.services.creditLoan.repayLoan(guildId, actor.id, loanId, totalOwed, nowMs, {
        useBank,
      });

      const feedback = formatRepayFeedback(
        res,
        cfg.economy.currencyName,
        cfg.economy.currencyEmoji,
        profile.coins,
        profile.bankCoins,
      );
      await interaction.update(buildLoanView(ctx, guildId, actor, feedback, nowMs));
      return;
    }

    if (action === 'sell_butt') {
      const res = ctx.services.creditLoan.sellButt(guildId, actor.id, nowMs);
      if (!res.ok) {
        await interaction.update(
          buildHustleView(
            ctx,
            guildId,
            actor,
            {
              type: 'error',
              text: `⏳ 还在恢复体力中！还需等待 **${formatDurationZh(res.retryAfterSec * 1000)}** 才能再次上街营业。`,
            },
            nowMs,
          ),
        );
        return;
      }

      const feedbackLines = [
        `🍑 触发「${res.eventTitle}」（${res.multiplier}x）：你${res.story}！`,
        `${cfg.economy.currencyEmoji} 营收 **+${res.grossReward.toLocaleString()}** ${cfg.economy.currencyName}${res.garnished > 0 ? `（逾期自动抵债 -${res.garnished.toLocaleString()}，实到手 +${res.netReward.toLocaleString()}）` : ''} ｜ 信用分 **${res.creditDelta}**（当前 **${res.creditScore}**）`,
      ];

      await interaction.update(
        buildHustleView(
          ctx,
          guildId,
          actor,
          { type: 'success', text: feedbackLines.join('\n') },
          nowMs,
        ),
      );

      const publicEmbed = buildSellButtPublicEmbed(
        res,
        actor,
        cfg.economy.currencyName,
        cfg.economy.currencyEmoji,
        creditCfg.hustleCooldownSec,
      );
      await sendPublicBroadcast(interaction, { embeds: [publicEmbed] });
      return;
    }
  }
}

export async function handleCreditLoanUserSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  if (!isCreditLoanModuleEnabled(ctx, guildId)) {
    await replyModuleDisabled(interaction);
    return;
  }

  const parts = interaction.customId.split(':');
  if (parts[1] !== 'review_user') return;
  const kind = parts[2];
  if (kind !== 'endorse' && kind !== 'report') return;

  const nowMs = Date.now();
  const actor = getActor(interaction, ctx, guildId);
  const targetId = interaction.values[0];
  if (!targetId) {
    await interaction.update(
      buildCreditView(ctx, guildId, actor, { type: 'error', text: '未选择有效成员。' }, nowMs),
    );
    return;
  }

  const res =
    kind === 'endorse'
      ? ctx.services.creditLoan.endorseUser(guildId, actor.id, targetId, nowMs)
      : ctx.services.creditLoan.reportUser(guildId, actor.id, targetId, nowMs);

  const feedback = formatReviewFeedback(kind, targetId, res);
  await interaction.update(buildCreditView(ctx, guildId, actor, feedback, nowMs));
}

export async function handleCreditLoanModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  if (!isCreditLoanModuleEnabled(ctx, guildId)) {
    await replyModuleDisabled(interaction);
    return;
  }

  const nowMs = Date.now();
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const actor = getActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  if (parts[1] !== 'submit') return;
  const modalType = parts[2];

  if (modalType === 'bank_loan') {
    const amount = parsePositiveInt(safeGetModalField(interaction, 'amount'));
    const termDays = parsePositiveInt(safeGetModalField(interaction, 'term_days'));
    if (amount === null || termDays === null) {
      await respondFromModal(
        interaction,
        buildLoanView(
          ctx,
          guildId,
          actor,
          { type: 'error', text: '请输入有效的正整数贷款金额与借款天数。' },
          nowMs,
        ),
      );
      return;
    }

    const res = ctx.services.creditLoan.takeBankLoan(guildId, actor.id, amount, termDays, nowMs);
    const feedback = formatBankLoanFeedback(
      res,
      cfg.economy.currencyName,
      cfg.economy.currencyEmoji,
    );
    await respondFromModal(interaction, buildLoanView(ctx, guildId, actor, feedback, nowMs));
    return;
  }

  if (modalType === 'usury_loan') {
    const amount = parsePositiveInt(safeGetModalField(interaction, 'amount'));
    if (amount === null) {
      await respondFromModal(
        interaction,
        buildLoanView(
          ctx,
          guildId,
          actor,
          { type: 'error', text: '请输入有效的正整数高利贷金额。' },
          nowMs,
        ),
      );
      return;
    }

    const res = ctx.services.creditLoan.takeUsuryLoan(guildId, actor.id, amount, nowMs);
    const feedback = formatUsuryLoanFeedback(
      res,
      cfg.economy.currencyName,
      cfg.economy.currencyEmoji,
    );
    await respondFromModal(interaction, buildLoanView(ctx, guildId, actor, feedback, nowMs));
    return;
  }

  if (modalType === 'repay') {
    const loanId = parsePositiveInt(parts[3] ?? '');
    const amount = parsePositiveInt(safeGetModalField(interaction, 'amount'));
    if (loanId === null || amount === null) {
      await respondFromModal(
        interaction,
        buildLoanView(
          ctx,
          guildId,
          actor,
          { type: 'error', text: '请输入有效的正整数还款金额。' },
          nowMs,
        ),
      );
      return;
    }

    const useBank = parseUseBankFlag(safeGetModalField(interaction, 'use_bank'));
    const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
    const res = ctx.services.creditLoan.repayLoan(guildId, actor.id, loanId, amount, nowMs, {
      useBank,
    });
    const feedback = formatRepayFeedback(
      res,
      cfg.economy.currencyName,
      cfg.economy.currencyEmoji,
      profile.coins,
      profile.bankCoins,
    );
    await respondFromModal(interaction, buildLoanView(ctx, guildId, actor, feedback, nowMs));
    return;
  }
}
