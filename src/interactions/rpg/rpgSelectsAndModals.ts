import {
  MessageFlags,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import type { AppContext } from '../../core/context.js';
import type { RpgDuelRulesMode } from '../../db/repositories/rpgRepo.js';
import {
  DAILY_ARENA_FIGHTS,
  MAX_RPG_DUEL_BET,
  RPG_CLASSES,
  RPG_CLASS_MAP,
} from '../../services/rpgService.js';
import { createErrorEmbed } from '../../ui/embeds.js';
import {
  buildRpgDuelBetModal,
  buildRpgGearView,
  buildRpgHomeView,
  buildRpgPublicDuelCard,
  buildRpgPvpView,
} from '../../ui/rpgMenuBuilder.js';
import {
  getActor,
  parseIntInRange,
  parsePositiveInt,
  resolveGameChatChannelId,
  respondFromModal,
} from '../menuHelpers.js';
import {
  isDuelRulesMode,
  replyModuleDisabled,
  sendToGameChat,
} from './rpgInteractionHelpers.js';

export async function handleRpgStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (!cfg.modules.rpg) {
    await replyModuleDisabled(interaction);
    return;
  }

  const actor = getActor(interaction, ctx, guildId);
  const nowMs = Date.now();
  const section = interaction.customId.split(':')[1];

  if (section === 'gear_select') {
    const selectedId = parsePositiveInt(interaction.values[0] ?? '');
    await interaction.update(buildRpgGearView(ctx, guildId, actor, selectedId, undefined, nowMs));
    return;
  }

  if (section === 'arena_fight') {
    const targetId = interaction.values[0] ?? '';
    const res = ctx.services.rpg.challengeArenaOpponent(guildId, actor.id, targetId, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        self_target: '不能在天梯中挑战自己的镜像哦！',
        no_class_selected: '请先选择初始职业后再参加天梯竞技！',
        daily_limit_reached: `今日免费天梯挑战已满 **${res.dailyLimit ?? DAILY_ARENA_FIGHTS}** 次，明天再来或试试 \`#游戏聊天\` 公屏约战吧！`,
        target_not_found: '未找到该勇者镜像，已为你刷新竞技场列表。',
      };
      await interaction.update(
        buildRpgPvpView(ctx, guildId, actor, { type: 'error', text: errMap[res.reason] }, nowMs),
      );
      return;
    }

    const deltaStr = res.ratingDelta >= 0 ? `+${res.ratingDelta}` : `${res.ratingDelta}`;
    const targetCls = RPG_CLASS_MAP.get(res.targetCharacter.classKey) ?? RPG_CLASSES[0]!;
    const headline = res.won
      ? `🏆 **天梯挑战胜利！** 第 **${res.report.roundsPlayed}** 回合击败 ${targetCls.emoji} <@${res.targetCharacter.userId}> 镜像（评级 **${res.report.rating}**）`
      : `⚔️ **天梯挑战惜败…** 鏖战 **${res.report.roundsPlayed}** 回合不敌 ${targetCls.emoji} <@${res.targetCharacter.userId}> 镜像`;
    const rewardLine = `📈 天梯积分：**${res.ratingBefore} → ${res.ratingAfter}**（**${deltaStr}**） ｜ ${cfg.economy.currencyEmoji} **+${res.netCoins.toLocaleString('en-US')}** ＋ ✨ **+${res.dustEarned}** 魔尘（今日余 **${res.fightsRemaining}/${DAILY_ARENA_FIGHTS}** 次）`;

    const summaryLines = [headline, rewardLine, ...res.highlights.slice(0, 5)];
    await interaction.update(
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        { type: res.won ? 'success' : 'info', text: summaryLines.join('\n') },
        nowMs,
      ),
    );
    return;
  }

  await interaction.update(
    buildRpgHomeView(
      ctx,
      guildId,
      actor,
      { type: 'error', text: '未知的冒险选择操作，已返回冒险大厅。' },
      nowMs,
    ),
  );
}

export async function handleRpgUserSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (!cfg.modules.rpg) {
    await replyModuleDisabled(interaction);
    return;
  }

  const [, section, rawMode] = interaction.customId.split(':');
  if (section !== 'duel_target') {
    const actor = getActor(interaction, ctx, guildId);
    await interaction.update(buildRpgPvpView(ctx, guildId, actor));
    return;
  }

  const targetId = interaction.values[0];
  const targetUser = targetId ? interaction.users.get(targetId) : undefined;
  if (!targetId || targetId === interaction.user.id) {
    await interaction.reply({
      embeds: [createErrorEmbed('⚠️ 无效约战对象', '不能向自己发起公屏约战哦！')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (targetUser?.bot) {
    await interaction.reply({
      embeds: [createErrorEmbed('⚠️ 无效约战对象', '不能向机器人发起约战，请选择真人勇者！')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mode: RpgDuelRulesMode = isDuelRulesMode(rawMode) ? rawMode : 'full';
  await interaction.showModal(buildRpgDuelBetModal(mode, targetId, cfg.economy.currencyName));
}

export async function handleRpgModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (!cfg.modules.rpg) {
    await replyModuleDisabled(interaction);
    return;
  }

  const nowMs = Date.now();
  const actor = getActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  // rpg:modal:duel:<mode>:<targetIdOrOpen>
  const modalKind = parts[2];
  const rawMode = parts[3];
  const targetToken = parts[4] ?? 'open';

  if (modalKind !== 'duel') {
    await respondFromModal(interaction, buildRpgHomeView(ctx, guildId, actor, undefined, nowMs));
    return;
  }

  const rulesMode: RpgDuelRulesMode = isDuelRulesMode(rawMode) ? rawMode : 'full';
  const rawBet = interaction.fields.getTextInputValue('bet_amount');
  const betAmount = parseIntInRange(rawBet, 0, MAX_RPG_DUEL_BET);
  if (betAmount === null) {
    await respondFromModal(
      interaction,
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        {
          type: 'error',
          text: `请输入有效的整数赌注（**0 ~ ${MAX_RPG_DUEL_BET.toLocaleString('en-US')}** ${cfg.economy.currencyName}，填 0 为荣誉切磋）。`,
        },
        nowMs,
      ),
    );
    return;
  }

  const targetChannelId = resolveGameChatChannelId(
    interaction.guild,
    cfg,
    ctx.repos.guildConfig,
  );
  if (!targetChannelId) {
    await respondFromModal(
      interaction,
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        {
          type: 'error',
          text: '⚠️ 未找到「#游戏聊天」频道，无法投递公屏战书（本次未扣除任何星币）。',
        },
        nowMs,
      ),
    );
    return;
  }

  const opponentId = targetToken === 'open' ? null : targetToken;
  const created = ctx.services.rpg.createPublicDuel({
    guildId,
    channelId: targetChannelId,
    challengerId: actor.id,
    opponentId,
    rulesMode,
    betAmount,
    nowMs,
  });

  if (!created.ok) {
    const errMap: Record<typeof created.reason, string> = {
      self_target: '不能向自己发起公屏约战！',
      invalid_bet_amount: `赌注金额须在 **0 ~ ${MAX_RPG_DUEL_BET.toLocaleString('en-US')}** 之间。`,
      no_class_selected: '请先选择初始职业后再发起约战！',
      pending_duel_exists: '你已有一封尚未结算的公屏战书，请先前往 `#游戏聊天` 完成或撤回！',
      deadbeat_blocked: '⚠️ 你当前存在逾期未还贷款，结清逾期欠款前禁止发起带赌注约战（你仍可填 0 发起无赌注荣誉切磋）！',
      insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！托管赌注需要 **${(created.required ?? betAmount).toLocaleString('en-US')}** ${cfg.economy.currencyName}。`,
    };
    await respondFromModal(
      interaction,
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        { type: 'error', text: errMap[created.reason] },
        nowMs,
      ),
    );
    return;
  }

  const card = buildRpgPublicDuelCard(created.duel, cfg.economy);
  const modeShort = rulesMode === 'equalized' ? '⚖️ 同阶拉平约战' : '🔥 满配神装约战';
  const mentionTarget = opponentId ? `向 <@${opponentId}> ` : '面向全服 ';
  const pub = await sendToGameChat(interaction, ctx, cfg, {
    content: `⚔️ 勇者战书：<@${actor.id}> ${mentionTarget}发起了 **${modeShort}**！`,
    embeds: card.embeds,
    components: card.components,
  });

  if (!pub.sent || !pub.messageId) {
    ctx.services.rpg.cancelPublicDuelAndRefund(created.duel.id, null, nowMs);
    await respondFromModal(
      interaction,
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        {
          type: 'error',
          text: `❌ 无法向 <#${targetChannelId}> 发送公屏战书（已自动撤回并全额退还托管押注）。`,
        },
        nowMs,
      ),
    );
    return;
  }

  ctx.services.rpg.bindPublicDuelMessage(created.duel.id, pub.messageId, targetChannelId);
  await respondFromModal(
    interaction,
    buildRpgPvpView(
      ctx,
      guildId,
      actor,
      {
        type: 'success',
        text: `📣 **${modeShort}**战书已发送至 <#${targetChannelId}>！10 分钟内无人应战将自动全额退还押注。`,
      },
      nowMs,
    ),
  );
}
