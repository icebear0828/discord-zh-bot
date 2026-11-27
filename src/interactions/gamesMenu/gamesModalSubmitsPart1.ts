import { PermissionFlagsBits, type ModalSubmitInteraction } from 'discord.js';
import { PREDICTION_MAX_BET } from '../../config/economyConstants.js';
import type { AppContext } from '../../core/context.js';
import { isBotAdmin } from '../../services/permissionService.js';
import { buildNumberBombCard } from '../../ui/chaosMenuBuilder.js';
import { createSuccessEmbed } from '../../ui/embeds.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../../ui/menuShared.js';
import { buildPredictionCard } from '../../ui/worldEventMenuBuilder.js';
import { dispatchByAction, type ActionRouteTable } from '../menu/subRouter.js';
import {
  checkModuleDisabled,
  editChannelMessage,
  parseIntInRange,
  parsePositiveInt,
  respondFromModal,
  sendPublicBroadcast,
} from '../menuHelpers.js';
import { launchNumberBomb, launchRouletteRoom } from './gamesLaunchHelpers.js';

interface GamesModalInput {
  interaction: ModalSubmitInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: readonly string[];
}

async function replyModalMenu(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  view: MenuView,
  feedback: MenuFeedback,
): Promise<true> {
  await respondFromModal(interaction, buildMenuMessage(ctx, guildId, actor, view, feedback));
  return true;
}

const MODAL_PART1_ROUTES: ActionRouteTable<GamesModalInput> = {
  exact: {
    prop_nick: async ({ interaction, ctx, guildId, actor, parts }) => {
      const targetId = parts[3];
      if (!targetId) return false;
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
      if (disabledMsg) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: disabledMsg });
      }
      const newNick = interaction.fields.getTextInputValue('nickname').trim();
      if (!newNick || newNick.length > 32) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: '新昵称长度必须在 1 ~ 32 个字符之间。' });
      }
      if (interaction.guild?.ownerId === targetId) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: '⚠️ Discord 限制机器人无法修改服务器群主的昵称（未扣除道具）。' });
      }
      if (!ctx.services.chaos.reserveProp(guildId, actor.id, 'nickname')) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: '你没有可用的「🎭 改昵称卡」。' });
      }

      const member = await interaction.guild?.members.fetch(targetId).catch(() => null);
      if (!member) {
        ctx.services.chaos.refundProp(guildId, actor.id, 'nickname');
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: '无法获取目标群友信息（已退回道具）。' });
      }

      const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
      const isTargetAdmin = isBotAdmin({
        isGuildAdmin: Boolean(member.permissions?.has(PermissionFlagsBits.Administrator)),
        hasManageGuild: Boolean(member.permissions?.has(PermissionFlagsBits.ManageGuild)),
        memberRoleIds: member.roles?.cache ? [...member.roles.cache.keys()] : [],
        configuredAdminRoleIds: guildCfg.adminRoleIds,
        userId: targetId,
        configuredAdminUserIds: guildCfg.adminUserIds,
      });
      if (isTargetAdmin) {
        ctx.services.chaos.refundProp(guildId, actor.id, 'nickname');
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: '🛡️ 不能对服务器管理员或 Bot 管理员使用「改昵称卡」（已退回道具）。' });
      }

      const oldName = member.displayName;
      try {
        await member.setNickname(newNick, `被 ${actor.displayName} 使用了黑市改昵称卡`);
      } catch {
        ctx.services.chaos.refundProp(guildId, actor.id, 'nickname');
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: '⚠️ 修改失败（对方身份组高于 Bot 或权限不足），已退回你的改昵称卡！' },
        );
      }

      await sendPublicBroadcast(interaction, {
        content: `🎭 整蛊成功！<@${actor.id}> 使用「改昵称卡」强行把 **${oldName}** (<@${targetId}>) 的昵称改成了 **「${newNick}」**！`,
      });
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'props' },
        { type: 'success', text: `🎭 已将 <@${targetId}> 强制改名为 **「${newNick}」**！` },
      );
    },

    bounty: async ({ interaction, ctx, guildId, actor, parts }) => {
      const targetId = parts[3];
      if (!targetId) return false;
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'bounty' }, { type: 'error', text: disabledMsg });
      }
      const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
      if (!amount) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'bounty' }, { type: 'error', text: '悬赏金额必须是大于 0 的正整数。' });
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.chaos.placeBounty(guildId, actor.id, targetId, amount);
      if (!res.ok) {
        const text =
          res.reason === 'below_min'
            ? `最低悬赏金额为 **${res.minAmount}** ${cfg.currencyName}。`
            : res.reason === 'insufficient_funds'
              ? `你的口袋现金不足 **${amount}** ${cfg.currencyName}。`
              : '不能悬赏自己！';
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'bounty' }, { type: 'error', text });
      }

      await sendPublicBroadcast(interaction, {
        allowedMentions: { users: [targetId] },
        content: `🎯 全服通缉令！<@${actor.id}> 出资 **${amount}** ${cfg.currencyName} 悬赏 <@${targetId}>（累计赏金池 **${res.totalTargetBounty}** ${cfg.currencyName}）！偷赢或决斗击败即可领走！`,
        embeds: [
          createSuccessEmbed(
            '🎯 全服通缉令发布！',
            `<@${targetId}> 当前累计赏金池：${cfg.currencyEmoji} **${res.totalTargetBounty}** ${cfg.currencyName}\n成功**偷钱得手**或**骰子决斗获胜**的群友将立即独吞全部赏金！`,
          ),
        ],
      });
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'bounty' },
        { type: 'success', text: `🎯 已成功对 <@${targetId}> 悬赏 **${amount}** ${cfg.currencyName}（当前赏金池 **${res.totalTargetBounty}**）！` },
      );
    },

    roulette: async ({ interaction, ctx, guildId, actor }) => {
      const fee = parsePositiveInt(interaction.fields.getTextInputValue('entryFee')) ?? 0;
      const maxP = parseIntInRange(interaction.fields.getTextInputValue('maxPlayers'), 2, 6) ?? 0;
      if (fee < 50 || maxP < 2 || maxP > 6) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'roulette' },
          { type: 'error', text: '入场费需 >= 50，座位数必须在 2 ~ 6 之间。' },
        );
      }
      const fb = await launchRouletteRoom(interaction, ctx, guildId, actor, fee, maxP);
      return replyModalMenu(interaction, ctx, guildId, actor, { page: 'roulette' }, fb);
    },

    bomb: async ({ interaction, ctx, guildId, actor }) => {
      const penalty = parsePositiveInt(interaction.fields.getTextInputValue('penalty')) ?? 0;
      const fb = await launchNumberBomb(interaction, ctx, guildId, actor, penalty);
      return replyModalMenu(interaction, ctx, guildId, actor, { page: 'bomb' }, fb);
    },

    bomb_guess: async ({ interaction, ctx, guildId, actor, parts }) => {
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'bomb' }, { type: 'error', text: disabledMsg });
      }
      const gameId = Number(parts[3]);
      if (!Number.isInteger(gameId) || gameId <= 0) return false;
      const guess = parseIntInRange(interaction.fields.getTextInputValue('guess'), 1, 100);
      if (guess === null) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'bomb' }, { type: 'error', text: '请输入 1 ~ 100 范围内的整数。' });
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.chaos.guessNumberBomb(gameId, actor.id, guess);
      if (!res.ok) {
        if (res.reason === 'expired' || res.reason === 'not_open') {
          const latest = ctx.services.chaos.getNumberBomb(gameId);
          if (latest) {
            await editChannelMessage(
              interaction.client,
              latest.channelId,
              latest.messageId,
              buildNumberBombCard(latest, cfg),
              interaction.guild,
            );
          }
        }
        const msgMap: Record<typeof res.reason, string> = {
          not_found: '找不到这颗炸弹。',
          not_open: '这颗炸弹已经引爆或结束了！',
          expired: '这颗炸弹已经过期。',
          invalid_guess: `请输入当前区间 **${res.minBound} ~ ${res.maxBound}** 之间的整数！`,
          consecutive_guess: '不能连续猜两次，等别人猜一次吧！',
          insufficient_funds: `现金不足 **${res.penalty}** ${cfg.currencyName}，无法参与抢猜。`,
          deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与数字炸弹！',
        };
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'bomb' }, { type: 'error', text: msgMap[res.reason] });
      }

      await editChannelMessage(
        interaction.client,
        res.game.channelId,
        res.game.messageId,
        buildNumberBombCard(res.game, cfg, res.payouts),
        interaction.guild,
      );
      const fb: MenuFeedback = res.exploded
        ? { type: 'error', text: `💥 踩雷了！猜中 **${res.guess}** 被扣除 **${res.penaltyPaid}** ${cfg.currencyName}！` }
        : { type: 'success', text: `😅 没炸！安全区间缩小为 **[${res.game.minBound} ~ ${res.game.maxBound}]**！` };
      return replyModalMenu(interaction, ctx, guildId, actor, { page: 'bomb' }, fb);
    },

    pred_create: async ({ interaction, ctx, guildId, actor }) => {
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'predictions' }, { type: 'error', text: disabledMsg });
      }
      if (!interaction.channel?.isSendable()) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'predictions' }, { type: 'error', text: '当前频道不支持发消息。' });
      }

      const title = interaction.fields.getTextInputValue('title').trim();
      const opt1 = interaction.fields.getTextInputValue('opt1').trim();
      const opt2 = interaction.fields.getTextInputValue('opt2').trim();
      const extraRaw = interaction.fields.getTextInputValue('extraOpts').trim();
      const extras = extraRaw
        ? extraRaw
            .split(/[/,，]/)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 2)
        : [];
      const closeMinutes = parseIntInRange(interaction.fields.getTextInputValue('closeMinutes'), 1, 10_080);

      if (!closeMinutes) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'predictions' },
          { type: 'error', text: '封盘时间必须是 1 ~ 10080 之间的正整数分钟。' },
        );
      }

      const res = ctx.services.worldEvent.createPrediction({
        guildId,
        channelId: interaction.channel.id,
        creatorId: actor.id,
        title,
        options: [opt1, opt2, ...extras],
        closeMinutes,
      });
      if (!res.ok) {
        const text =
          res.reason === 'invalid_options'
            ? '请提供 2 ~ 4 个不重复的有效选项（每项不超过 40 字）。'
            : '盘口标题无效或超出长度限制。';
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'predictions' }, { type: 'error', text });
      }

      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const broadcast = await sendPublicBroadcast(interaction, {
        content: `📊 <@${actor.id}> 发起了新吃瓜盘口「**${res.summary.prediction.title}**」，快来押宝分奖池！`,
        ...buildPredictionCard(res.summary, cfg),
      });
      if (broadcast.sent && broadcast.messageId) {
        ctx.services.worldEvent.bindPredictionMessage(
          res.summary.prediction.id,
          broadcast.messageId,
          interaction.channel.id,
        );
      }
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'pred_detail', predictionId: res.summary.prediction.id },
        { type: 'success', text: `📊 吃瓜盘口 **#${res.summary.prediction.id}** 已发起并在频道公开开盘！` },
      );
    },

    pred_bet: async ({ interaction, ctx, guildId, actor, parts }) => {
      const predId = Number(parts[3]);
      const optionIndex = Number(parts[4]);
      if (!Number.isInteger(predId) || !Number.isInteger(optionIndex)) return false;

      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: disabledMsg },
        );
      }

      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
      if (!amount) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          {
            type: 'error',
            text: `下注金额必须是 1 ~ ${PREDICTION_MAX_BET.toLocaleString()} ${cfg.currencyName} 的正整数。`,
          },
        );
      }

      const res = ctx.services.worldEvent.placeBet({
        predictionId: predId,
        userId: actor.id,
        optionIndex,
        amount,
      });
      if (!res.ok) {
        if (res.reason === 'closed' || res.reason === 'not_open') {
          const latest = ctx.services.worldEvent.getPredictionSummary(predId);
          if (latest) {
            await editChannelMessage(
              interaction.client,
              latest.prediction.channelId,
              latest.prediction.messageId,
              buildPredictionCard(latest, cfg),
              interaction.guild,
            );
          }
        }
        const msgMap: Record<typeof res.reason, string> = {
          not_found: '盘口不存在。',
          not_open: '盘口已封盘或已结束。',
          closed: '已经超过封盘时间啦。',
          creator_cannot_bet: '开盘人不能押注自己发起的盘口，以保证公平！',
          invalid_option: '无效选项。',
          invalid_amount: `下注金额必须为 1 ~ ${PREDICTION_MAX_BET.toLocaleString()} ${cfg.currencyName}。`,
          insufficient_funds: `口袋现金不足 **${amount}** ${cfg.currencyName}。`,
          deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与吃瓜押注！',
        };
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: msgMap[res.reason] },
        );
      }

      await editChannelMessage(
        interaction.client,
        res.summary.prediction.channelId,
        res.summary.prediction.messageId,
        buildPredictionCard(res.summary, cfg),
        interaction.guild,
      );
      const optName = res.summary.prediction.options[optionIndex] ?? '';
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'pred_detail', predictionId: predId },
        {
          type: 'success',
          text: `🪙 已成功押注「**${optName}**」${cfg.currencyEmoji} **${res.betAmount}** ${cfg.currencyName}，剩余现金 **${res.balance}** ${cfg.currencyName}！`,
        },
      );
    },
  },
};

export async function tryHandleGamesModalPart1(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return dispatchByAction(parts[2], { interaction, ctx, guildId, actor, parts }, MODAL_PART1_ROUTES);
}
