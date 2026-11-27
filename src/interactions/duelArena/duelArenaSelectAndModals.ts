import {
  MessageFlags,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { MAX_COIN_AMOUNT } from '../../config/economyConstants.js';
import type { AppContext } from '../../core/context.js';
import {
  getDuelArenaService,
  MAX_CUSTOM_WAGER_LEN,
  VALID_RENAME_HOURS,
  VALID_TIMEOUT_MINUTES,
} from '../../services/duelArenaService.js';
import {
  buildRenameTargetModal,
  buildRouletteDuelCard,
  buildRpsDuelCard,
} from '../../ui/duelArenaBuilder.js';
import { createErrorEmbed, createSuccessEmbed } from '../../ui/embeds.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import {
  checkModuleDisabled,
  parseIntInRange,
  parseNonNegativeInt,
  resolveActor,
  respondFromModal,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from '../menuHelpers.js';
import { applyWinnerNicknameRename } from './nicknamePenaltyHelper.js';

export async function handleDuelArenaStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  if (interaction.customId !== 'da:nick_pick') return;

  const targetId = interaction.values[0];
  if (!targetId) return;

  const arena = getDuelArenaService(ctx);
  const lock = arena.getActiveNicknameLock(interaction.guildId, targetId);
  if (!lock || lock.winnerId !== interaction.user.id) {
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 无改名权限', '该改名权已过期或已归属其他胜者。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildRenameTargetModal(targetId, 'menu'));
}

export async function handleDuelArenaModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  const modalType = parts[2];
  const targetId = parts[3];
  if (!modalType || !targetId) return;

  if (modalType === 'rename') {
    const source = parts[4] === 'menu' ? 'menu' : 'card';
    const rawNickname = interaction.fields.getTextInputValue('nickname');
    const res = await applyWinnerNicknameRename({
      ctx,
      guild: interaction.guild,
      guildId,
      winnerId: actor.id,
      winnerName: actor.displayName,
      targetId,
      rawNickname,
    });

    if (!res.ok) {
      if (source === 'menu') {
        await respondFromModal(
          interaction,
          buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: res.privateText }),
        );
      } else {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 改名失败', res.privateText)],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (res.publicText) {
      await sendPublicBroadcast(interaction, {
        allowedMentions: { users: [actor.id, targetId] },
        content: res.publicText,
      });
    }

    if (source === 'menu') {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'success', text: res.privateText }),
      );
    } else {
      await interaction.reply({
        embeds: [createSuccessEmbed('🎭 改名成功', res.privateText)],
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
  if (disabledMsg) {
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: disabledMsg }),
    );
    return;
  }

  if (!interaction.channel?.isSendable()) {
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'duel' },
        { type: 'error', text: '当前频道不支持发送公开决斗卡片。' },
      ),
    );
    return;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const arena = getDuelArenaService(ctx);

  if (modalType === 'rps') {
    const renameHours = parseIntInRange(interaction.fields.getTextInputValue('renameHours'), 1, 24);
    const bet = parseNonNegativeInt(interaction.fields.getTextInputValue('bet'));
    if (renameHours === null || !(VALID_RENAME_HOURS as readonly number[]).includes(renameHours)) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '改名时长仅支持填 **1**、**6** 或 **24**（小时）。' },
        ),
      );
      return;
    }
    if (bet === null || bet > MAX_COIN_AMOUNT) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: `附加赌注必须为 0 ~ ${MAX_COIN_AMOUNT.toLocaleString()} 的整数。` },
        ),
      );
      return;
    }
    if (bet > 0) {
      const econDisabled = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (econDisabled) {
        await respondFromModal(
          interaction,
          buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: econDisabled }),
        );
        return;
      }
    }

    if (interaction.isFromMessage()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const res = arena.createRpsDuel({
      guildId,
      channelId: interaction.channelId ?? interaction.channel.id,
      challengerId: actor.id,
      opponentId: targetId,
      renameHours,
      bet,
    });
    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        self_target: '不能向自己发起决斗！',
        invalid_bet: `附加赌注必须在 0 ~ ${MAX_COIN_AMOUNT.toLocaleString()} 之间。`,
        invalid_rename_hours: '改名时长仅支持 1 / 6 / 24 小时。',
        insufficient_funds: `你的口袋现金不足以支付 **${bet}** ${cfg.currencyName} 赌注。`,
        deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清欠款前禁止发起带赌注决斗！',
      };
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: msgMap[res.reason] }),
      );
      return;
    }

    const broadcast = await sendPublicBroadcast(interaction, {
      allowedMentions: { users: [targetId] },
      content: `✊✌️🖐️ <@${targetId}>，你收到了一条石头剪刀布 Bo5 决斗挑战！`,
      ...buildRpsDuelCard(res.duel, cfg),
    });
    if (!broadcast.sent || !broadcast.messageId) {
      arena.declineRpsDuel(res.duel.id, actor.id);
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '无法在当前频道发送决斗卡片，冻结赌注已自动退回。' },
        ),
      );
      return;
    }

    arena.bindRpsMessage(res.duel.id, broadcast.messageId);
    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'duel' },
        {
          type: 'success',
          text: `✊ 已向 <@${targetId}> 发起石头剪刀布 Bo5 决斗（胜者获 **${renameHours}h** 改名权${bet > 0 ? ` + **${bet}** ${cfg.currencyName}` : ''}）！`,
        },
      ),
    );
    return;
  }

  if (modalType === 'rl1v1') {
    const bullets = parseIntInRange(interaction.fields.getTextInputValue('bullets'), 1, 3);
    const bet = parseNonNegativeInt(interaction.fields.getTextInputValue('bet'));
    const renameHours = parseIntInRange(interaction.fields.getTextInputValue('renameHours'), 0, 24);
    const timeoutMinutes = parseIntInRange(
      interaction.fields.getTextInputValue('timeoutMinutes'),
      0,
      30,
    );
    const customWager = interaction.fields.getTextInputValue('customWager').trim();

    if (bullets === null) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: '实弹数仅支持 1、2 或 3 发。' }),
      );
      return;
    }
    if (bet === null || bet > MAX_COIN_AMOUNT) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: `黑吊币赌注必须为 0 ~ ${MAX_COIN_AMOUNT.toLocaleString()} 的整数。` },
        ),
      );
      return;
    }
    if (
      renameHours === null ||
      (renameHours !== 0 && !(VALID_RENAME_HOURS as readonly number[]).includes(renameHours))
    ) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '改名时长仅支持 0（不赌）、1、6 或 24 小时。' },
        ),
      );
      return;
    }
    if (
      timeoutMinutes === null ||
      (timeoutMinutes !== 0 &&
        !(VALID_TIMEOUT_MINUTES as readonly number[]).includes(timeoutMinutes))
    ) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '禁言时长仅支持 0（不赌）、5、10 或 30 分钟。' },
        ),
      );
      return;
    }
    if (customWager.length > MAX_CUSTOM_WAGER_LEN) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: `自定义文字赌约不能超过 ${MAX_CUSTOM_WAGER_LEN} 字。` },
        ),
      );
      return;
    }
    if (bet === 0 && renameHours === 0 && timeoutMinutes === 0 && customWager.length === 0) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '至少选择一项赌注（黑吊币、改名权、禁言或自定义文字赌约）！' },
        ),
      );
      return;
    }
    if (bet > 0) {
      const econDisabled = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (econDisabled) {
        await respondFromModal(
          interaction,
          buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: econDisabled }),
        );
        return;
      }
    }

    if (interaction.isFromMessage()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const res = arena.createRouletteDuel({
      guildId,
      channelId: interaction.channelId ?? interaction.channel.id,
      challengerId: actor.id,
      opponentId: targetId,
      bullets,
      bet,
      renameHours,
      timeoutMinutes,
      customWager,
    });
    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        self_target: '不能向自己发起 1v1 俄罗斯轮盘！',
        invalid_bullets: '实弹数必须为 1~3 发。',
        invalid_bet: '黑吊币赌注无效。',
        invalid_rename_hours: '改名时长仅支持 0/1/6/24 小时。',
        invalid_timeout_minutes: '禁言时长仅支持 0/5/10/30 分钟。',
        invalid_custom_wager: `文字赌约不得超过 ${MAX_CUSTOM_WAGER_LEN} 字。`,
        no_stake: '至少选择一项赌注！',
        insufficient_funds: `你的口袋现金不足以支付 **${bet}** ${cfg.currencyName} 赌注。`,
        deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清欠款前禁止发起带赌注轮盘！',
      };
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: msgMap[res.reason] }),
      );
      return;
    }

    const broadcast = await sendPublicBroadcast(interaction, {
      allowedMentions: { users: [targetId] },
      content: `🔫 <@${targetId}>，你收到了一条 1v1 俄罗斯轮盘生死赌局挑战！`,
      ...buildRouletteDuelCard(res.duel, cfg),
    });
    if (!broadcast.sent || !broadcast.messageId) {
      arena.declineRouletteDuel(res.duel.id, actor.id);
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '无法在当前频道发送 1v1 轮盘卡片，冻结赌注已退回。' },
        ),
      );
      return;
    }

    arena.bindRouletteDuelMessage(res.duel.id, broadcast.messageId);
    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'duel' },
        {
          type: 'success',
          text: `🔫 已向 <@${targetId}> 发起 1v1 俄罗斯轮盘决斗（${bullets} 发实弹）！`,
        },
      ),
    );
  }
}
