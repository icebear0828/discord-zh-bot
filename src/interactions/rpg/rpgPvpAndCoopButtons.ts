import { MessageFlags } from 'discord.js';
import type { RpgDuelRulesMode } from '../../db/repositories/rpgRepo.js';
import {
  DAILY_COOP_TICKETS,
  MIN_COOP_PARTY_SIZE,
  getRpgRealmInfo,
} from '../../services/rpgService.js';
import { createErrorEmbed } from '../../ui/embeds.js';
import type { MenuActor } from '../../ui/menuShared.js';
import {
  buildRpgCoopRaidCard,
  buildRpgCoopView,
  buildRpgDuelBetModal,
  buildRpgPublicDuelCard,
  buildRpgPvpView,
} from '../../ui/rpgMenuBuilder.js';
import { parsePositiveInt, resolveGameChatChannelId } from '../menuHelpers.js';
import {
  buildLegendaryDropPublicEmbed,
  isDuelRulesMode,
  sendToGameChat,
  type RpgButtonContext,
} from './rpgInteractionHelpers.js';

export async function handleRpgPublicPvpOrCoopButton(input: RpgButtonContext): Promise<boolean> {
  const { interaction, ctx, guildId, cfg, nowMs, section, arg } = input;

  if (section === 'duel_accept' || section === 'duel_cancel') {
    const duelId = parsePositiveInt(arg ?? '');
    if (!duelId) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 无效战书', '找不到该公屏约战编号。')],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (section === 'duel_cancel') {
      const res = ctx.services.rpg.cancelPublicDuelAndRefund(duelId, interaction.user.id, nowMs);
      if (!res.ok) {
        const errMap: Record<typeof res.reason, string> = {
          not_found: '找不到该约战记录。',
          already_resolved: '该场约战已经结束或已撤回！',
          not_challenger: '只有发起战书的勇者本人才能撤回战书。',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('⛔ 无法撤回战书', errMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        if (res.reason === 'already_resolved') {
          const latest = ctx.services.rpg.getPublicDuelById(duelId);
          if (latest && typeof interaction.message?.edit === 'function') {
            await interaction.message
              .edit(buildRpgPublicDuelCard(latest, cfg.economy))
              .catch(() => undefined);
          }
        }
        return true;
      }
      await interaction.update(buildRpgPublicDuelCard(res.duel, cfg.economy));
      return true;
    }

    const res = ctx.services.rpg.acceptPublicDuel(duelId, interaction.user.id, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该约战记录。',
        already_resolved: '该场约战已经完成对决或已取消！',
        expired: '该战书已超过 10 分钟有效期，系统已自动退回押注。',
        own_duel: '不能接下自己发起的战书哦！',
        wrong_opponent: `这是一封指定挑战书，仅限 <@${res.expectedOpponentId ?? ''}> 拔剑应战！`,
        no_class_selected: '你尚未创建西幻 RPG 勇者角色，请先输入 `/冒险` 选择初始职业！',
        challenger_unavailable: '发起人角色状态不可用，无法开战。',
        deadbeat_blocked: '你当前存在逾期未还贷款，结清前禁止参与带赌注约战！',
        insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！应战需要 **${(res.required ?? 0).toLocaleString('en-US')}** ${cfg.economy.currencyName}。`,
      };
      await interaction.reply({
        embeds: [createErrorEmbed('⛔ 无法应战', errMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      if (res.reason === 'already_resolved' || res.reason === 'expired') {
        const latest = ctx.services.rpg.getPublicDuelById(duelId);
        if (latest && typeof interaction.message?.edit === 'function') {
          await interaction.message
            .edit(buildRpgPublicDuelCard(latest, cfg.economy))
            .catch(() => undefined);
        }
      }
      return true;
    }

    await interaction.update(buildRpgPublicDuelCard(res.duel, cfg.economy));
    return true;
  }

  if (section === 'coop_join' || section === 'coop_launch') {
    const raidId = parsePositiveInt(arg ?? '');
    if (!raidId) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 无效团本', '找不到该集结团本编号。')],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (section === 'coop_join') {
      const res = ctx.services.rpg.joinCoopRaidLobby(raidId, interaction.user.id, nowMs);
      if (!res.ok) {
        const errMap: Record<typeof res.reason, string> = {
          not_found: '找不到该集结团本记录。',
          already_started_or_closed: '该车队已经发车或结束集结啦！',
          already_joined: '你已经在车队里了，等待队长或倒计时发车即可！',
          party_full: '车队 4 人席位已满，等下一班车吧！',
          no_class_selected: '你尚未创建西幻 RPG 勇者角色，请先输入 `/冒险` 选择初始职业！',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('⛔ 无法上车助战', errMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        if (res.reason === 'already_started_or_closed') {
          const latest = ctx.services.rpg.getCoopRaidById(raidId);
          if (latest && typeof interaction.message?.edit === 'function') {
            await interaction.message
              .edit(buildRpgCoopRaidCard(latest, cfg.economy))
              .catch(() => undefined);
          }
        }
        return true;
      }

      await interaction.update(buildRpgCoopRaidCard(res.raid, cfg.economy));
      return true;
    }

    const res = ctx.services.rpg.launchCoopRaid(raidId, interaction.user.id, nowMs);
    if (!res.ok) {
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该集结团本记录。',
        already_resolved: '该团本车队已经发车结算完毕！',
        not_leader: '只有发起集结的队长可以手动提前发车（未满人时 3 分钟倒计时结束会自动征召佣兵发车）。',
        not_enough_members: `手动提前发车至少需要 **${res.minMembers ?? MIN_COOP_PARTY_SIZE}** 名真人队员（若无人加入，等待 3 分钟结束将自动补齐佣兵发车）！`,
      };
      await interaction.reply({
        embeds: [createErrorEmbed('⛔ 无法立即发车', errMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      if (res.reason === 'already_resolved') {
        const latest = ctx.services.rpg.getCoopRaidById(raidId);
        if (latest && typeof interaction.message?.edit === 'function') {
          await interaction.message
            .edit(buildRpgCoopRaidCard(latest, cfg.economy))
            .catch(() => undefined);
        }
      }
      return true;
    }

    await interaction.update(buildRpgCoopRaidCard(res.raid, cfg.economy));

    if (res.legendaryDrops.length > 0) {
      const leaderChar = ctx.services.rpg.getOrCreateCharacter(guildId, res.raid.leaderId, nowMs);
      const dropEmbed = buildLegendaryDropPublicEmbed({
        userId: res.raid.leaderId,
        sourceLabel: `集结团本「${res.raid.bossName}」`,
        legendaryDrops: res.legendaryDrops,
        realm: getRpgRealmInfo(leaderChar.level),
      });
      await sendToGameChat(interaction, ctx, cfg, {
        content: `🟧 团本红光：<@${res.raid.leaderId}> 率队讨伐 **${res.raid.bossName}** 爆出传说神装！`,
        embeds: [dropEmbed],
      });
    }
    return true;
  }

  if (section === 'duel_open') {
    const mode: RpgDuelRulesMode = isDuelRulesMode(arg) ? arg : 'full';
    await interaction.showModal(buildRpgDuelBetModal(mode, 'open', cfg.economy.currencyName));
    return true;
  }

  return false;
}

export async function handleRpgPrivatePvpOrCoopButton(
  input: RpgButtonContext,
  actor: MenuActor,
): Promise<boolean> {
  const { interaction, ctx, guildId, cfg, nowMs, section } = input;

  if (section === 'arena_claim') {
    const res = ctx.services.rpg.claimDailyArenaReward(guildId, actor.id, nowMs);
    if (!res.ok) {
      const msg =
        res.reason === 'no_class_selected'
          ? '请先选择初始职业后再领取天梯俸禄！'
          : '今日的天梯段位俸禄已经领取过了，明天再来吧！';
      await interaction.update(
        buildRpgPvpView(ctx, guildId, actor, { type: 'info', text: msg }, nowMs),
      );
      return true;
    }

    await interaction.update(
      buildRpgPvpView(
        ctx,
        guildId,
        actor,
        {
          type: 'success',
          text: `🎁 **天梯每日俸禄领取成功！**（${res.tierLabel} · ${res.rating} 分）\n获得 ${cfg.economy.currencyEmoji} **+${res.netCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName} ＋ ✨ **+${res.dustEarned}** 奥术魔尘！`,
        },
        nowMs,
      ),
    );
    return true;
  }

  if (section === 'coop_start') {
    const targetChannelId = resolveGameChatChannelId(
      interaction.guild,
      cfg,
      ctx.repos.guildConfig,
    );
    if (!targetChannelId) {
      await interaction.update(
        buildRpgCoopView(
          ctx,
          guildId,
          actor,
          {
            type: 'error',
            text: '⚠️ 未找到「#游戏聊天」频道，无法发起公屏集结团本，请联系管理员配置世界事件频道。',
          },
          nowMs,
        ),
      );
      return true;
    }

    const started = ctx.services.rpg.startCoopRaidLobby(guildId, targetChannelId, actor.id, nowMs);
    if (!started.ok) {
      const errMap: Record<typeof started.reason, string> = {
        no_class_selected: '请先选择初始职业后再发起集结团本！',
        active_raid_exists: '你已有一支正在招募中的集结车队，请先前往 `#游戏聊天` 发车或等待结算！',
        no_coop_tickets: `今日队长发车券已用完（每日限 ${started.dailyLimit ?? DAILY_COOP_TICKETS} 次），你仍可在 \`#游戏聊天\` 无限次数免费上车助战群友！`,
      };
      await interaction.update(
        buildRpgCoopView(ctx, guildId, actor, { type: 'error', text: errMap[started.reason] }, nowMs),
      );
      return true;
    }

    const card = buildRpgCoopRaidCard(started.raid, cfg.economy);
    const pub = await sendToGameChat(interaction, ctx, cfg, {
      content: `🐉 远征集结：<@${actor.id}> 发起了第 **${started.raid.tier}** 阶团本「**${started.raid.bossName}**」！点击下方按钮零消耗上车助战分魔尘！`,
      embeds: card.embeds,
      components: card.components,
    });

    if (!pub.sent || !pub.messageId) {
      ctx.services.rpg.cancelCoopRaidAndRefund(started.raid.id, nowMs);
      await interaction.update(
        buildRpgCoopView(
          ctx,
          guildId,
          actor,
          {
            type: 'error',
            text: `❌ 无法向 <#${targetChannelId}> 发送团本集结卡（已自动取消并退还今日发车券）。`,
          },
          nowMs,
        ),
      );
      return true;
    }

    ctx.services.rpg.bindCoopRaidMessage(started.raid.id, pub.messageId, targetChannelId);
    await interaction.update(
      buildRpgCoopView(
        ctx,
        guildId,
        actor,
        {
          type: 'success',
          text: `🐉 集结招募卡已发送至 <#${targetChannelId}>！满 2 人即可提前发车，3 分钟后自动征召佣兵补位开打（今日余券 **${started.ticketsRemaining}/${DAILY_COOP_TICKETS}**）。`,
        },
        nowMs,
      ),
    );
    return true;
  }

  return false;
}
