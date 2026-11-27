import { MessageFlags } from 'discord.js';
import { GUARD_ELIXIR_PRICE, PROMO_PILL_PRICE } from '../../services/rpgService.js';
import { createErrorEmbed } from '../../ui/embeds.js';
import type { MenuActor } from '../../ui/menuShared.js';
import {
  buildPublicTrialCard,
  buildRpgHomeView,
  buildRpgTrialView,
} from '../../ui/rpgMenuBuilder.js';
import { parsePositiveInt, resolveGameChatChannelId } from '../menuHelpers.js';
import {
  buildBreakthroughCelebrationEmbed,
  sendToGameChat,
  type RpgButtonContext,
} from './rpgInteractionHelpers.js';

export async function handleRpgPublicTrialButton(input: RpgButtonContext): Promise<boolean> {
  const { interaction, ctx, cfg, nowMs, section, arg } = input;

  if (section === 'trial_help' || section === 'trial_jeer') {
    const trialId = parsePositiveInt(arg ?? '');
    if (!trialId) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 无效试炼', '找不到该破境试炼编号。')],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const mode = section === 'trial_help' ? 'help' : 'jeer';
    const res = ctx.services.rpg.interactPublicTrial(trialId, interaction.user.id, mode, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该公开试炼记录。',
        already_resolved: '该场破境试炼已经结算结束！',
        own_trial: '不能给自己的破境试炼助威或起哄哦！',
        already_joined: '你已经参与过这场试炼的表态了，每人限一次。',
        supporters_full: '助威席位已满（最多 5 人）！',
        saboteurs_full: '起哄席位已满（最多 3 人）！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('⛔ 无法参与试炼', errMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      if (res.reason === 'already_resolved') {
        const latest = ctx.services.rpg.getTrialById(trialId);
        if (latest && typeof interaction.message?.edit === 'function') {
          await interaction.message
            .edit(buildPublicTrialCard(latest, cfg.economy, undefined, nowMs))
            .catch(() => undefined);
        }
      }
      return true;
    }

    await interaction.update(buildPublicTrialCard(res.trial, cfg.economy, undefined, nowMs));
    return true;
  }

  if (section === 'trial_settle') {
    const trialId = parsePositiveInt(arg ?? '');
    if (!trialId) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 无效试炼', '找不到该破境试炼编号。')],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const res = ctx.services.rpg.settlePublicTrial(trialId, interaction.user.id, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该破境试炼记录。',
        already_resolved: '该场试炼已经完成结算！',
        not_owner: '只有发起渡劫的勇者本人可以提前引动天劫（其他人请等待 60 秒自动结算）。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('⛔ 无法引动天劫', errMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      if (res.reason === 'already_resolved') {
        const latest = ctx.services.rpg.getTrialById(trialId);
        if (latest && typeof interaction.message?.edit === 'function') {
          await interaction.message
            .edit(buildPublicTrialCard(latest, cfg.economy, undefined, nowMs))
            .catch(() => undefined);
        }
      }
      return true;
    }

    await interaction.update(
      buildPublicTrialCard(res.trial, cfg.economy, res.supporterPayouts, nowMs),
    );
    return true;
  }

  return false;
}

export async function handleRpgPrivateTrialButton(
  input: RpgButtonContext,
  actor: MenuActor,
): Promise<boolean> {
  const { interaction, ctx, guildId, cfg, nowMs, section, arg } = input;

  if (section === 'alchemy') {
    const kind = arg === 'buy_elixir' ? 'elixir' : 'pill';
    const res = ctx.services.rpg.buyAlchemyItem(guildId, actor.id, kind, nowMs);
    if (res.ok) {
      const label = kind === 'pill' ? '🧪 晋升秘药' : '🛡️ 护魂圣水';
      const stock = kind === 'pill' ? res.character.promoPills : res.character.guardElixirs;
      await interaction.update(
        buildRpgTrialView(
          ctx,
          guildId,
          actor,
          {
            type: 'success',
            text: `✅ 购入 ${label}×1 成功（库存 **${stock}**）！消耗 ${cfg.economy.currencyEmoji} **${res.cost.toLocaleString('en-US')}** ${cfg.economy.currencyName}，今日还可购 **${res.buysRemaining}** 次。`,
          },
          nowMs,
        ),
      );
      return true;
    }
    const defaultPrice = kind === 'pill' ? PROMO_PILL_PRICE : GUARD_ELIXIR_PRICE;
    const errText =
      res.reason === 'daily_limit_reached'
        ? `该秘药今日购买次数已达上限（${res.dailyLimit ?? 0} 次）。`
        : `口袋 ${cfg.economy.currencyName} 不足！购买需要 **${(res.cost ?? defaultPrice).toLocaleString('en-US')}** ${cfg.economy.currencyName}。`;
    await interaction.update(
      buildRpgTrialView(ctx, guildId, actor, { type: 'error', text: errText }, nowMs),
    );
    return true;
  }

  if (section !== 'trial') {
    return false;
  }

  if (arg === 'cycle_pills' || arg === 'toggle_guard') {
    const action = arg === 'cycle_pills' ? 'cycle_pills' : 'toggle_guard';
    const res = ctx.services.rpg.configureTrialLoadout(guildId, actor.id, action, nowMs);
    if (!res.ok) {
      await interaction.update(
        buildRpgTrialView(
          ctx,
          guildId,
          actor,
          { type: 'error', text: '你背包里还没有 🛡️ 护魂圣水，请先在上方炼金工坊购买！' },
          nowMs,
        ),
      );
      return true;
    }
    const feedbackText =
      action === 'cycle_pills'
        ? `💊 已调整上阵 🧪 晋升秘药为 **${res.character.trialPillsStaged}** 颗（成功率 +${res.character.trialPillsStaged * 12}%）。`
        : `🛡️ 已**${res.character.trialUseGuard ? '开启' : '关闭'}** 护魂圣水防护。`;
    await interaction.update(
      buildRpgTrialView(ctx, guildId, actor, { type: 'info', text: feedbackText }, nowMs),
    );
    return true;
  }

  if (arg === 'solo') {
    const res = ctx.services.rpg.attemptSoloBreakthrough(guildId, actor.id, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        no_class_selected: '请先选择初始职业！',
        at_max_tier: '你已登临十阶神座巅峰，无需继续突破。',
        not_at_gate: '当前阶位九重经验尚未满额，请先挂机或速刷 Boss 攒够突破经验！',
        pending_trial_exists: '你有一场进行中的公开试炼，请先完成结算！',
      };
      await interaction.update(
        buildRpgTrialView(ctx, guildId, actor, { type: 'error', text: errMap[res.reason] }, nowMs),
      );
      return true;
    }

    if (res.succeeded) {
      const text = [
        `⚡ **破境成功！** 你正式从 **${res.fromRealm.fullLabel}** 晋升为 **${res.toRealm.fullLabel}**（成功率 ${res.finalRatePct}%）！`,
        `${cfg.economy.currencyEmoji} 赏金 **+${res.netCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName} ｜ 📜 信用分 **+${res.creditDelta}** ｜ 🔓 已解锁「${res.toRealm.tierDef.zoneName}」`,
      ].join('\n');
      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'success', text }, nowMs),
      );

      const celeb = buildBreakthroughCelebrationEmbed({
        userId: actor.id,
        fromRealm: res.fromRealm,
        toRealm: res.toRealm,
        grossCoins: res.grossCoins,
        currencyEmoji: cfg.economy.currencyEmoji,
        currencyName: cfg.economy.currencyName,
        isPublicTrial: false,
      });
      await sendToGameChat(interaction, ctx, cfg, {
        content: `⚡ 喜报：<@${actor.id}> 单人冲关成功，踏入 **${res.toRealm.fullLabel}**！`,
        embeds: [celeb],
      });
      return true;
    }

    const failText = [
      `💥 **破境失败…** 雷劫失手（本次成功率 ${res.finalRatePct}%）。`,
      `📉 经验损耗 **-${res.xpLost.toLocaleString('en-US')} XP**${
        res.usedGuard
          ? '（🛡️ 护魂圣水生效：减免大量经验损失并免疫重伤！）'
          : ' ｜ 🤕 进入 **1小时重伤状态**（挂机收益 0.5x，可治愈）'
      }`,
      `🔥 已触发连败保底：当前累计保底 **+${res.character.breakthroughPity * 10}%**！`,
    ].join('\n');
    await interaction.update(
      buildRpgTrialView(ctx, guildId, actor, { type: 'error', text: failText }, nowMs),
    );
    return true;
  }

  if (arg === 'public') {
    const targetChannelId = resolveGameChatChannelId(
      interaction.guild,
      cfg,
      ctx.repos.guildConfig,
    );
    if (!targetChannelId) {
      await interaction.update(
        buildRpgTrialView(
          ctx,
          guildId,
          actor,
          {
            type: 'error',
            text: '⚠️ 未找到「#游戏聊天」频道，无法发起公开渡劫试炼（你仍可使用「⚡ 单人立即破境」）。',
          },
          nowMs,
        ),
      );
      return true;
    }

    const started = ctx.services.rpg.startPublicBreakthroughTrial(
      guildId,
      targetChannelId,
      actor.id,
      nowMs,
    );
    if (!started.ok) {
      const errMap: Record<typeof started.reason, string> = {
        no_class_selected: '请先选择初始职业！',
        at_max_tier: '你已登临十阶神座巅峰，无需继续突破。',
        not_at_gate: '当前阶位九重经验尚未满额，请先攒够突破经验！',
        pending_trial_exists: '你已有一场公开试炼正在进行中，请前往试炼卡片结算。',
      };
      await interaction.update(
        buildRpgTrialView(
          ctx,
          guildId,
          actor,
          { type: 'error', text: errMap[started.reason] },
          nowMs,
        ),
      );
      return true;
    }

    const card = buildPublicTrialCard(started.trial, cfg.economy, undefined, nowMs);
    const pub = await sendToGameChat(interaction, ctx, cfg, {
      content: `🌩️ 天劫降临：<@${actor.id}> 在 <#${targetChannelId}> 发起了全服公开破境试炼！快来助威或起哄！`,
      embeds: card.embeds,
      components: card.components,
    });

    if (!pub.sent || !pub.messageId) {
      ctx.services.rpg.cancelPublicTrialAndRefund(started.trial.id, nowMs);
      await interaction.update(
        buildRpgTrialView(
          ctx,
          guildId,
          actor,
          {
            type: 'error',
            text: `❌ 无法向 <#${targetChannelId}> 发送试炼卡片（已自动取消试炼并全额退还秘药/圣水）。`,
          },
          nowMs,
        ),
      );
      return true;
    }

    ctx.services.rpg.bindTrialMessage(started.trial.id, pub.messageId, targetChannelId);
    await interaction.update(
      buildRpgTrialView(
        ctx,
        guildId,
        actor,
        {
          type: 'success',
          text: `📣 公开试炼卡片已发送至 <#${targetChannelId}>！等待 60 秒全服围观，或直接去试炼卡片提前引动天劫！`,
        },
        nowMs,
      ),
    );
    return true;
  }

  return false;
}
