import {
  MessageFlags,
  type ButtonInteraction,
  type Guild,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { MAX_COIN_AMOUNT } from '../config/economyConstants.js';
import type { RpsMove } from '../db/repositories/duelRepo.js';
import {
  formatRpsMoveLabel,
  getDuelArenaService,
  MAX_CUSTOM_WAGER_LEN,
  VALID_RENAME_HOURS,
  VALID_TIMEOUT_MINUTES,
} from '../services/duelArenaService.js';
import {
  buildRenameTargetModal,
  buildRouletteDuelCard,
  buildRpsDuelCard,
} from '../ui/duelArenaBuilder.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  formatDurationZh,
  type AppContext,
} from '../ui/embeds.js';
import { buildMenuMessage } from '../ui/menuBuilder.js';
import {
  checkModuleDisabled,
  parseIntInRange,
  parseNonNegativeInt,
  resolveActor,
  respondFromModal,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from './menuHelpers.js';

const VALID_RPS_MOVES = new Set<string>(['rock', 'paper', 'scissors']);

export interface WinnerRenameExecutionResult {
  ok: boolean;
  fallback: boolean;
  nickname?: string;
  expiresAt?: number;
  privateText: string;
  publicText?: string;
}

export async function applyWinnerNicknameRename(input: {
  ctx: AppContext;
  guild: Guild | null;
  guildId: string;
  winnerId: string;
  winnerName: string;
  targetId: string;
  rawNickname: string;
  nowMs?: number;
}): Promise<WinnerRenameExecutionResult> {
  const nowMs = input.nowMs ?? Date.now();
  const arena = getDuelArenaService(input.ctx);
  const validation = arena.validateWinnerRename(
    input.guildId,
    input.winnerId,
    input.targetId,
    input.rawNickname,
    nowMs,
  );

  if (!validation.ok) {
    if (validation.reason === 'invalid_nickname') {
      return {
        ok: false,
        fallback: false,
        privateText: '新昵称长度必须在 1 ~ 32 个字符之间。',
      };
    }
    if (validation.reason === 'cooldown') {
      return {
        ok: false,
        fallback: false,
        privateText: `操作太快啦！每 10 秒可改名一次，请 **${validation.retryAfterSec ?? 1}** 秒后再试。`,
      };
    }
    return {
      ok: false,
      fallback: false,
      privateText: '你当前没有针对该成员的有效改名权（可能已过期或已被其他胜者接管）。',
    };
  }

  const newNick = validation.nickname;
  const targetMember = input.guild
    ? await input.guild.members.fetch(input.targetId).catch(() => null)
    : null;
  const isOwner = input.guild?.ownerId === input.targetId;

  if (!isOwner && targetMember) {
    const previousServerNick = targetMember.nickname ?? null;
    try {
      await targetMember.setNickname(newNick, `决斗胜者 ${input.winnerName} 行使限时改名权`);
      arena.commitDiscordRename(
        input.guildId,
        input.targetId,
        previousServerNick,
        newNick,
        nowMs,
      );
      const expUnix = Math.floor(validation.lock.expiresAt / 1000);
      return {
        ok: true,
        fallback: false,
        nickname: newNick,
        expiresAt: validation.lock.expiresAt,
        privateText: `🎭 已将 <@${input.targetId}> 的服务器昵称锁定为 **「${newNick}」**（有效至 <t:${expUnix}:R>，期间内可反复改名）！`,
        publicText: `🎭 **决斗胜者赐名！**<@${input.winnerId}> 行使胜利权利，将败方 <@${input.targetId}> 的服务器昵称改成了 **「${newNick}」**（持续至 <t:${expUnix}:R>）！`,
      };
    } catch {
      // Fall through to fallback card/title lock when Discord hierarchy/50013 blocks nickname edit
    }
  }

  arena.commitFallbackRename(input.guildId, input.targetId, newNick, nowMs);
  const expUnix = Math.floor(validation.lock.expiresAt / 1000);
  return {
    ok: true,
    fallback: true,
    nickname: newNick,
    expiresAt: validation.lock.expiresAt,
    privateText: `🎭 因对方为群主或身份组高于 Bot，无法改其 Discord 昵称；已自动降级为**强制锁定 Bot 名片昵称/称号「${newNick}」并全群挂牌通告**（至 <t:${expUnix}:R>）！`,
    publicText: `📢 **公开挂牌处刑！**败方 <@${input.targetId}> 身份组高于 Bot（或为群主）无法强改服务器昵称，已由胜者 <@${input.winnerId}> 强行锁定 Bot 名片昵称与专属称号为 **「${newNick}」**（持续至 <t:${expUnix}:R>）！`,
  };
}

export async function applyRouletteTimeoutPenalty(input: {
  guild: Guild | null;
  targetId: string;
  timeoutDurationMs: number;
  winnerName: string;
}): Promise<string | null> {
  if (input.timeoutDurationMs <= 0) return null;
  const durationLabel = formatDurationZh(input.timeoutDurationMs);

  const isOwner = input.guild?.ownerId === input.targetId;
  const member = input.guild
    ? await input.guild.members.fetch(input.targetId).catch(() => null)
    : null;

  if (!isOwner && member) {
    try {
      await member.timeout(
        input.timeoutDurationMs,
        `1v1 俄罗斯轮盘败给 ${input.winnerName} 的限时禁言惩罚`,
      );
      return `已对 <@${input.targetId}> 执行 **${durationLabel}** 禁言惩罚！`;
    } catch {
      // Fall through to public shame fallback on 50013 / role hierarchy
    }
  }

  return `⚠️ <@${input.targetId}> 为群主或身份组高于 Bot 无法禁言，已改由系统**全群公开挂牌处刑**（原定禁言 ${durationLabel}）！`;
}

export async function handleDuelArenaButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const parts = interaction.customId.split(':');
  const category = parts[1];
  const arena = getDuelArenaService(ctx);

  if (category === 'nick_btn') {
    const targetId = parts[2];
    if (!targetId) return;
    const lock = arena.getActiveNicknameLock(guildId, targetId);
    if (!lock || lock.winnerId !== interaction.user.id) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '❌ 无改名权限',
            '只有当前有效的决斗胜者才能在有效期内给败方改名（或该改名权已到期）。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(buildRenameTargetModal(targetId, 'card'));
    return;
  }

  if (category === 'rps') {
    const action = parts[2];
    const duelId = parts[3];
    if (!action || !duelId) return;

    if (!cfg.modules.socialGames) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭整蛊与博弈模块。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'accept') {
      const current = arena.getRpsDuel(duelId);
      if (current && current.bet > 0 && !cfg.modules.economy) {
        await interaction.reply({
          embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭经济系统，无法结算带赌注决斗。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const res = arena.acceptRpsDuel(duelId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRpsDuelCard(res.duel, cfg.economy));
        return;
      }

      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这场石头剪刀布决斗记录。',
        not_opponent: '只有被挑战者本人才能点击接受决斗！',
        already_resolved: '这场决斗已经开始或结束了！',
        expired: '这场决斗邀请已超时过期，冻结赌注已自动退还。',
        opponent_insufficient_funds: `你的口袋现金不足以支付本次附加赌注（${cfg.economy.currencyName}）。`,
        deadbeat_blocked: '参与方存在逾期未还贷款（失信老赖限制），还清欠款前禁止参与带赌注决斗！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法应战', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = arena.getRpsDuel(duelId);
      if (latest && latest.status !== 'pending') {
        await interaction.message.edit(buildRpsDuelCard(latest, cfg.economy)).catch(() => undefined);
      }
      return;
    }

    if (action === 'decline') {
      const res = arena.declineRpsDuel(duelId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRpsDuelCard(res.duel, cfg.economy));
        return;
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这场决斗记录。',
        not_participant: '只有决斗双方才能取消或拒绝本次挑战！',
        already_resolved: '这场决斗已经开始或结束了！',
        expired: '这场决斗邀请已超时过期，冻结赌注已自动退还。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法取消', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = arena.getRpsDuel(duelId);
      if (latest && latest.status !== 'pending') {
        await interaction.message.edit(buildRpsDuelCard(latest, cfg.economy)).catch(() => undefined);
      }
      return;
    }

    if (action === 'move') {
      const moveRaw = parts[4];
      if (!moveRaw || !VALID_RPS_MOVES.has(moveRaw)) return;
      const move = moveRaw as RpsMove;

      const res = arena.submitRpsMove(duelId, interaction.user.id, move);
      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          not_found: '找不到这场石头剪刀布决斗。',
          not_playing: '这场决斗尚未开始或已经结束啦！',
          not_participant: '你不是本场决斗的参赛选手！',
          already_moved: '本回合你已经锁定过出拳啦，请等待对手出拳！',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('⏳ 无法出拳', msgMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        const latest = arena.getRpsDuel(duelId);
        if (latest && latest.status !== 'playing') {
          await interaction.message.edit(buildRpsDuelCard(latest, cfg.economy)).catch(() => undefined);
        }
        return;
      }

      await interaction.update(buildRpsDuelCard(res.duel, cfg.economy));
      if (!res.roundResolved) {
        await interaction.followUp({
          embeds: [
            createInfoEmbed(
              '🔒 出拳已锁定',
              `你本回合选择了 **${formatRpsMoveLabel(move)}**，等待对手出拳后同时亮牌！`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      } else if (res.matchFinished && res.winnerId && res.loserId) {
        await sendPublicBroadcast(interaction, {
          allowedMentions: { users: [res.winnerId, res.loserId] },
          content: `🏆 <@${res.winnerId}> 在石头剪刀布 Bo5 决斗中击败了 <@${res.loserId}>！快点击战报卡片上的 **🎭 给败方改名** 行使改名权吧！`,
        });
      }
      return;
    }
  }

  if (category === 'rl') {
    const action = parts[2];
    const duelId = parts[3];
    if (!action || !duelId) return;

    if (!cfg.modules.socialGames) {
      await interaction.reply({
        embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭整蛊与博弈模块。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'accept') {
      const current = arena.getRouletteDuel(duelId);
      if (current && current.bet > 0 && !cfg.modules.economy) {
        await interaction.reply({
          embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器已关闭经济系统，无法结算带赌注轮盘。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const res = arena.acceptRouletteDuel(duelId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRouletteDuelCard(res.duel, cfg.economy));
        return;
      }

      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这局 1v1 俄罗斯轮盘记录。',
        not_opponent: '只有被挑战者本人才能接受赌局！',
        already_resolved: '这局 1v1 轮盘已经开局或结束了！',
        expired: '这局轮盘邀请已超时过期，冻结赌注已退回。',
        opponent_insufficient_funds: `你的口袋现金不足以支付本局赌注（${cfg.economy.currencyName}）。`,
        deadbeat_blocked: '参与方存在逾期未还贷款（失信老赖限制），还清欠款前禁止参与带赌注轮盘！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法应战', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = arena.getRouletteDuel(duelId);
      if (latest && latest.status !== 'pending') {
        await interaction.message
          .edit(buildRouletteDuelCard(latest, cfg.economy))
          .catch(() => undefined);
      }
      return;
    }

    if (action === 'decline') {
      const res = arena.declineRouletteDuel(duelId, interaction.user.id);
      if (res.ok) {
        await interaction.update(buildRouletteDuelCard(res.duel, cfg.economy));
        return;
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这局 1v1 俄罗斯轮盘记录。',
        not_participant: '只有对局双方才能取消或拒绝本次挑战！',
        already_resolved: '这局 1v1 轮盘已经开局或结束了！',
        expired: '这局轮盘邀请已超时过期，冻结赌注已退回。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法取消', msgMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      const latest = arena.getRouletteDuel(duelId);
      if (latest && latest.status !== 'pending') {
        await interaction.message
          .edit(buildRouletteDuelCard(latest, cfg.economy))
          .catch(() => undefined);
      }
      return;
    }

    if (action === 'fire') {
      const res = arena.pullRouletteDuelTrigger(duelId, interaction.user.id);
      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          not_found: '找不到这局 1v1 俄罗斯轮盘。',
          not_playing: '这局轮盘还未开始或已经结束啦！',
          not_your_turn: '还没轮到你扣扳机，请等待对手！',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('⏳ 请稍等', msgMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        const latest = arena.getRouletteDuel(duelId);
        if (latest && latest.status !== 'playing') {
          await interaction.message
            .edit(buildRouletteDuelCard(latest, cfg.economy))
            .catch(() => undefined);
        }
        return;
      }

      let penaltyNote: string | undefined;
      if (res.fired && res.loserId && res.timeoutDurationMs > 0) {
        penaltyNote =
          (await applyRouletteTimeoutPenalty({
            guild: interaction.guild,
            targetId: res.loserId,
            timeoutDurationMs: res.timeoutDurationMs,
            winnerName: res.winnerId ?? '胜者',
          })) ?? undefined;
      }

      await interaction.update(buildRouletteDuelCard(res.duel, cfg.economy, penaltyNote));
    }
  }
}

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
