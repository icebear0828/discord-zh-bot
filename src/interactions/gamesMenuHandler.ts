import {
  ActionRowBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { DEFAULT_GAMES_CONFIG } from '../config/defaults.js';
import type { PropKey } from '../db/repositories/chaosRepo.js';
import { PROP_CATALOG, PROP_KEYS, getPropPrice } from '../services/chaosService.js';
import { isBotAdmin } from '../services/permissionService.js';
import { PET_SPECIES_MAP } from '../services/socialPetService.js';
import type { BossAttackMode } from '../services/worldEventService.js';
import { buildNumberBombCard, buildRouletteCard } from '../ui/chaosMenuBuilder.js';
import { createSuccessEmbed, formatDurationZh, type AppContext } from '../ui/embeds.js';
import { buildMenuMessage, truncateText } from '../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../ui/menuShared.js';
import {
  buildPetBattleCard,
  buildProposalCard,
  buildPublicAffinityLeaderboardEmbed,
} from '../ui/socialPetMenuBuilder.js';
import {
  buildPredictionCard,
  buildWorldBossCard,
  buildWorldChestCard,
} from '../ui/worldEventMenuBuilder.js';
import { buildBombGuessModal } from './chaosHandler.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  editChannelMessage,
  parseIntInRange,
  parseNonNegativeInt,
  parseNumberInRange,
  parsePositiveInt,
  prefilledField,
  respondFromModal,
  sendPublicBroadcast,
  sendToChannel,
} from './menuHelpers.js';

function isValidPropKey(raw: string | undefined): raw is PropKey {
  return PROP_KEYS.includes(raw as PropKey);
}

function buildTextModal(input: {
  customId: string;
  title: string;
  fieldId: string;
  label: string;
  placeholder: string;
  maxLength?: number;
  defaultValue?: string;
}): ModalBuilder {
  const field = new TextInputBuilder()
    .setCustomId(input.fieldId)
    .setLabel(truncateText(input.label, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(input.maxLength ?? 32)
    .setPlaceholder(input.placeholder)
    .setRequired(true);

  if (input.defaultValue !== undefined) {
    field.setValue(input.defaultValue);
  }

  return new ModalBuilder()
    .setCustomId(input.customId)
    .setTitle(truncateText(input.title, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(field));
}

function buildCreatePredictionModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('menu:modal_sub:pred_create')
    .setTitle('📊 发起全群吃瓜盘口')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('盘口问题 / 吃瓜标题（1~100字）')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(100)
          .setPlaceholder('例如：今晚群主会不会发大红包？')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('opt1')
          .setLabel('选项 1')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(40)
          .setPlaceholder('例如：一定会发')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('opt2')
          .setLabel('选项 2')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(40)
          .setPlaceholder('例如：绝对鸽了')
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('extraOpts')
          .setLabel('额外选项（可选，用 / 分隔最多再填2个）')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(80)
          .setPlaceholder('例如：只发1块钱/半夜才发')
          .setRequired(false),
      ),
      prefilledField('closeMinutes', '封盘倒计时分钟（1 ~ 10080）', 60, 8),
    );
}

async function launchRouletteRoom(
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

async function launchNumberBomb(
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
    return {
      type: 'error',
      text:
        res.reason === 'insufficient_funds'
          ? `你自己的口袋现金需 >= **${penalty}** ${cfg.currencyName} 才能发起该档位数字炸弹。`
          : '数字炸弹罚金必须在 100 ~ 1,000,000,000 之间。',
    };
  }

  const broadcast = await sendPublicBroadcast(interaction, {
    content: `💣 <@${actor.id}> 在频道丢下了一颗罚金 **${penalty}** ${cfg.currencyName} 的数字炸弹！`,
    ...buildNumberBombCard(res.game, cfg),
  });

  if (!broadcast.sent || !broadcast.messageId) {
    ctx.services.chaos.expireDueNumberBombs(res.game.expiresAt + 1);
    return { type: 'error', text: '无法在当前频道发送数字炸弹消息，请检查发送权限。' };
  }

  ctx.services.chaos.bindNumberBombMessage(res.game.id, broadcast.messageId);
  return {
    type: 'success',
    text: `💣 数字炸弹 **#${res.game.id}** 已扔进当前频道，快和群友一起抢猜！`,
  };
}

async function spawnAndPostWorldEvent(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  kind: 'chest' | 'boss',
): Promise<MenuFeedback> {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const targetChannelId = cfg.games.eventChannelId ?? interaction.channelId;
  if (!targetChannelId) {
    return { type: 'error', text: '找不到可用频道以发送事件卡片。' };
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
  ctx.services.worldEvent.bindWorldEventMessage(event.id, msgId);
  return {
    type: 'success',
    text: `已在 <#${targetChannelId}> 召唤 ${kind === 'chest' ? '🎁 宝箱' : '👹 Boss'}「**${event.name}**」（#${event.id}）！`,
  };
}

export async function tryHandleGamesMenuButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const section = parts[1];

  if (section === 'nav') {
    const target = parts[2];
    if (target === 'admin_games') {
      if (!actor.isAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
        );
        return true;
      }
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'admin_games' }));
      return true;
    }

    if (target === 'cp_lb') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'social_hub' }, { type: 'error', text: disabledMsg }),
        );
        return true;
      }
      const lbPage = parsePositiveInt(parts[3] ?? '') ?? 1;
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'cp_lb', lbPage }),
      );
      return true;
    }

    const simpleNav: Record<string, MenuView> = {
      props: { page: 'props' },
      bounty: { page: 'bounty' },
      roulette: { page: 'roulette' },
      bomb: { page: 'bomb' },
      events: { page: 'events' },
      predictions: { page: 'predictions' },
      world_status: { page: 'world_status' },
      social_hub: { page: 'social_hub' },
      cp: { page: 'cp' },
      pets: { page: 'pets' },
      pet_arena: { page: 'pet_arena' },
    };
    const nextView = target ? simpleNav[target] : undefined;
    if (!nextView) return false;

    if (target === 'props' || target === 'bounty' || target === 'roulette' || target === 'bomb') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'multi' }, { type: 'error', text: disabledMsg }),
        );
        return true;
      }
    } else if (target === 'events' || target === 'predictions' || target === 'world_status') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return true;
      }
    } else {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return true;
      }
    }

    await interaction.update(buildMenuMessage(ctx, guildId, actor, nextView));
    return true;
  }

  if (section === 'prop_use') {
    const rawKey = parts[2];
    if (!isValidPropKey(rawKey)) return false;
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'props' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    const res = ctx.services.chaos.useSelfProp(guildId, actor.id, rawKey);
    const feedback: MenuFeedback = res.ok
      ? rawKey === 'trap'
        ? { type: 'success', text: `🪤 捕兽夹已在你的口袋门口部署完毕（24h 内有效），剩余 ${res.remainingQuantity} 个！` }
        : rawKey === 'lockpick'
          ? { type: 'success', text: `🗝️ 万能撬锁已握在手中！下次打劫成功率 +25%，剩余 ${res.remainingQuantity} 个。` }
          : {
              type: 'success',
              text: `🛡️ 防盗保险已激活！护盾持续至 <t:${Math.floor((res.shieldUntil ?? Date.now()) / 1000)}:R>，剩余 ${res.remainingQuantity} 个。`,
            }
      : { type: 'error', text: '你当前没有该道具，先从上方下拉菜单购买吧！' };
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'props' }, feedback));
    return true;
  }

  if (section === 'bounty' && parts[2] === 'clear') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'bounty' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.chaos.clearOwnBounty(guildId, actor.id);
    if (!res.ok) {
      const text =
        res.reason === 'no_bounty'
          ? '你身上目前没有任何待兑现悬赏！'
          : `现金不足！撤销悬赏需支付 **${res.cost}** ${cfg.currencyName}。`;
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'bounty' }, { type: 'error', text }),
      );
      return true;
    }
    await sendPublicBroadcast(interaction, {
      content: `🧹 <@${actor.id}> 自掏腰包花费 **${res.cost}** ${cfg.currencyName}，强行抹除了自己身上 **${res.clearedAmount}** ${cfg.currencyName} 的通缉令！`,
    });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'bounty' },
        { type: 'success', text: `🧹 已花费 **${res.cost}** 撤销了 **${res.clearedAmount}** 赏金通缉！` },
      ),
    );
    return true;
  }

  if (section === 'roulette' && parts[2] === 'new') {
    const fee = parsePositiveInt(parts[3] ?? '') ?? 100;
    const feedback = await launchRouletteRoom(interaction, ctx, guildId, actor, fee, 6);
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'roulette' }, feedback));
    return true;
  }

  if (section === 'bomb' && parts[2] === 'new') {
    const penalty = parsePositiveInt(parts[3] ?? '') ?? 100;
    const feedback = await launchNumberBomb(interaction, ctx, guildId, actor, penalty);
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'bomb' }, feedback));
    return true;
  }

  if (section === 'pred_view') {
    const predId = Number(parts[2]);
    if (!Number.isInteger(predId) || predId <= 0) return false;
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'pred_detail', predictionId: predId }),
    );
    return true;
  }

  if (section === 'pred_bet') {
    const predId = Number(parts[2]);
    const optIdx = Number(parts[3]);
    if (!Number.isInteger(predId) || !Number.isInteger(optIdx)) return false;

    const disabledMsg =
      checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件') ??
      checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: disabledMsg },
        ),
      );
      return true;
    }

    const summary = ctx.services.worldEvent.getPredictionSummary(predId);
    const optLabel = summary?.prediction.options[optIdx];
    if (!summary || !optLabel || summary.prediction.status !== 'open') {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: '该盘口当前不可下注或已封盘。' },
        ),
      );
      return true;
    }

    await interaction.showModal(
      buildTextModal({
        customId: `menu:modal_sub:pred_bet:${predId}:${optIdx}`,
        title: '📊 吃瓜盘口押注',
        fieldId: 'amount',
        label: `押注「${optLabel.slice(0, 18)}」的金额`,
        placeholder: '例如：200',
        maxLength: 12,
      }),
    );
    return true;
  }

  if (section === 'pred_lock' || section === 'pred_cancel' || section === 'pred_post') {
    const predId = Number(parts[2]);
    if (!Number.isInteger(predId) || predId <= 0) return false;
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;

    if (section === 'pred_lock') {
      const res = ctx.services.worldEvent.lockPrediction(predId, actor.id, Boolean(actor.isAdmin));
      const feedback: MenuFeedback = res.ok
        ? { type: 'success', text: '🔒 已提前封盘，接下来可从下方下拉菜单宣布胜出结果。' }
        : { type: 'error', text: '封盘失败：仅开盘人或 Bot 管理员可对开放中盘口封盘。' };
      if (res.ok) {
        await editChannelMessage(
          interaction.client,
          res.summary.prediction.channelId,
          res.summary.prediction.messageId,
          buildPredictionCard(res.summary, cfg),
          interaction.guild,
        );
      }
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'pred_detail', predictionId: predId }, feedback),
      );
      return true;
    }

    if (section === 'pred_cancel') {
      const res = ctx.services.worldEvent.cancelPrediction(predId, actor.id, Boolean(actor.isAdmin));
      const feedback: MenuFeedback = res.ok
        ? { type: 'success', text: `❌ 盘口已作废，全部 **${res.refunds.length}** 位下注人已全额退币！` }
        : { type: 'error', text: '作废失败：仅开盘人或 Bot 管理员可操作未结算盘口。' };
      if (res.ok) {
        await editChannelMessage(
          interaction.client,
          res.summary.prediction.channelId,
          res.summary.prediction.messageId,
          buildPredictionCard(res.summary, cfg),
          interaction.guild,
        );
      }
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'pred_detail', predictionId: predId }, feedback),
      );
      return true;
    }

    const summary = ctx.services.worldEvent.getPredictionSummary(predId);
    if (!summary) return true;
    const broadcast = await sendPublicBroadcast(interaction, {
      content: `📊 <@${summary.prediction.creatorId}> 发起吃瓜盘口「**${summary.prediction.title}**」，快来押注！`,
      ...buildPredictionCard(summary, cfg),
    });
    if (broadcast.sent && broadcast.messageId) {
      ctx.services.worldEvent.bindPredictionMessage(predId, broadcast.messageId);
    }
    const feedback: MenuFeedback = broadcast.sent
      ? { type: 'success', text: '📢 吃瓜盘口卡片已发送到当前频道！' }
      : { type: 'error', text: '发送盘口卡片失败，请检查机器人发言权限。' };
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'pred_detail', predictionId: predId }, feedback),
    );
    return true;
  }

  if (section === 'world') {
    const action = parts[2];
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (action === 'claim_chest') {
      const eventId = Number(parts[3]);
      if (!Number.isInteger(eventId) || eventId <= 0) return false;
      const res = ctx.services.worldEvent.claimChest(eventId, actor.id);
      if (res.ok) {
        await editChannelMessage(
          interaction.client,
          res.event.channelId,
          res.event.messageId,
          buildWorldChestCard(res.event, res.participants, cfg.economy),
          interaction.guild,
        );
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'world_status' },
            {
              type: 'success',
              text: `🎁 开箱抢到 ${cfg.economy.currencyEmoji} **+${res.amount}** ${cfg.economy.currencyName}！（当前现金 **${res.balance}**）`,
            },
          ),
        );
      } else {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'world_status' },
            {
              type: 'error',
              text:
                res.reason === 'already_claimed'
                  ? '你已经领过这只宝箱啦！'
                  : '手慢一步，宝箱已被抢空或已消失！',
            },
          ),
        );
      }
      return true;
    }

    if (action === 'boss_hit') {
      const eventId = Number(parts[3]);
      const mode: BossAttackMode = parts[4] === 'heavy' ? 'heavy' : 'normal';
      if (!Number.isInteger(eventId) || eventId <= 0) return false;

      const res = ctx.services.worldEvent.attackBoss(eventId, actor.id, mode);
      if (!res.ok) {
        const text =
          res.reason === 'cooldown'
            ? `技能冷却中，还需等待 **${res.retryAfterSec ?? 1}** 秒！`
            : '世界 Boss 已结束或已撤退！';
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'world_status' }, { type: 'error', text }),
        );
        return true;
      }

      const logText = res.missed
        ? `<@${actor.id}> 蓄力重击挥空了！`
        : `<@${actor.id}> ${mode === 'heavy' ? '蓄力重击' : '普通攻击'}${res.crit ? '💥暴击' : ''}造成了 **${res.damage}** 伤害！`;

      await editChannelMessage(
        interaction.client,
        res.event.channelId,
        res.event.messageId,
        buildWorldBossCard(res.event, res.participants, cfg.economy, logText, res.rewards),
        interaction.guild,
      );

      if (res.killed) {
        await sendPublicBroadcast(interaction, {
          content: `🏆 <@${actor.id}> 拿下世界 Boss「**${res.event.name}**」尾刀绝杀，全群瓜分 **${res.event.rewardPool}** ${cfg.economy.currencyName}！`,
        });
      }

      const fb: MenuFeedback = res.missed
        ? { type: 'info', text: '💨 蓄力重击空大了！稍后再来补刀！' }
        : {
            type: 'success',
            text: `${res.crit ? '💥 暴击！' : '⚔️ 命中！'}造成 **${res.damage}** 伤害${res.petName ? `（🐾 ${res.petName}助战+${res.petBonus}）` : ''}${res.killed ? '\n🏆 恭喜你拿下尾刀绝杀奖！' : ''}`,
          };

      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'world_status' }, fb),
      );
      return true;
    }

    if (action === 'post_card') {
      const eventId = Number(parts[3]);
      const detail = ctx.services.worldEvent.getWorldEventDetail(eventId);
      if (!detail || detail.event.status !== 'active') {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'world_status' },
            { type: 'error', text: '事件已结束，无法重复推送卡片。' },
          ),
        );
        return true;
      }
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
      const broadcast = await sendPublicBroadcast(interaction, payload);
      if (broadcast.sent && broadcast.messageId) {
        ctx.services.worldEvent.bindWorldEventMessage(detail.event.id, broadcast.messageId);
      }
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'world_status' },
          broadcast.sent
            ? { type: 'success', text: '📢 事件卡片已发送到当前频道！' }
            : { type: 'error', text: '无法在当前频道发送消息。' },
        ),
      );
      return true;
    }

    if (action === 'spawn_chest' || action === 'spawn_boss') {
      if (!actor.isAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'world_status' }, ADMIN_DENIED_FEEDBACK),
        );
        return true;
      }
      const fb = await spawnAndPostWorldEvent(
        interaction,
        ctx,
        guildId,
        action === 'spawn_chest' ? 'chest' : 'boss',
      );
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'world_status' }, fb));
      return true;
    }
  }

  if (section === 'share' && parts[2] === 'cp_lb') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'cp' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    const lbPage = parsePositiveInt(parts[3] ?? '') ?? 1;
    const { embed } = buildPublicAffinityLeaderboardEmbed(ctx, guildId, lbPage);
    const broadcast = await sendPublicBroadcast(interaction, {
      content: `💕 <@${actor.id}> 晒出了全服 CP 亲密度排行榜：`,
      embeds: [embed],
    });
    const fb: MenuFeedback = broadcast.sent
      ? { type: 'success', text: '已将全服 CP 亲密度榜晒出到当前频道！' }
      : { type: 'error', text: '无法在当前频道发送公开消息。' };
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'cp_lb', lbPage }, fb));
    return true;
  }

  if (section === 'pet') {
    const disabledMsg =
      checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物') ??
      checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'pets' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }

    const action = parts[2];
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;

    if (action === 'gacha') {
      const res = ctx.services.socialPet.pullPetGacha(guildId, actor.id);
      if (!res.ok) {
        const text =
          res.reason === 'max_owned_reached'
            ? `宠物栏已满（上限 **${res.maxOwned}** 只），先放生不需要的宠物再来抽吧！`
            : `口袋现金不足！盲盒抽宠需要 **${res.price}** ${cfg.currencyName}。`;
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'pets' }, { type: 'error', text }),
        );
        return true;
      }

      if (res.isHighRarity) {
        await sendPublicBroadcast(interaction, {
          content: `🌟 欧皇出货！<@${actor.id}> 在宠物盲盒一发入魂抽出了 **[${res.pet.rarity}] ${res.species.emoji} ${res.species.name}**（性格：${res.pet.trait}）！`,
          embeds: [
            createSuccessEmbed(
              `🌟 频道喜报：[${res.pet.rarity}] 稀有宠物降临！`,
              `<@${actor.id}> 开出了 ${res.species.emoji} **${res.species.name}**（HP ${res.pet.hp} / ATK ${res.pet.atk} / SPD ${res.pet.spd}）！`,
            ),
          ],
        });
      }

      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pets' },
          {
            type: 'success',
            text: `🎁 盲盒开出 **[${res.pet.rarity}] ${res.species.emoji} ${res.species.name}**（性格：${res.pet.trait}）！剩余现金：**${res.balance}**`,
          },
        ),
      );
      return true;
    }

    const active = ctx.services.socialPet.getActivePet(guildId, actor.id);
    if (!active) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pets' },
          { type: 'error', text: '你还没有宠物，先点击「🎁 抽盲盒」吧！' },
        ),
      );
      return true;
    }

    if (action === 'feed') {
      const res = ctx.services.socialPet.feedPet(guildId, actor.id, active.id);
      const fb: MenuFeedback = res.ok
        ? {
            type: 'success',
            text: `🍖 给 **${res.pet.nickname}** 喂了大餐（-${res.cost} ${cfg.currencyName}），+40 XP！${res.leveledUp ? `🎉 升到 **Lv.${res.pet.level}**！` : ''}`,
          }
        : res.reason === 'already_fed_today'
          ? { type: 'error', text: '这只宠物今天已经吃饱啦，明天再来喂食！' }
          : { type: 'error', text: `现金不足 **${res.cost}** ${cfg.currencyName}，无法喂食。` };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'pets' }, fb));
      return true;
    }

    if (action === 'train') {
      const res = ctx.services.socialPet.trainPet(guildId, actor.id, active.id);
      const fb: MenuFeedback = res.ok
        ? {
            type: 'success',
            text: `🏋️ 特训完成！**${res.pet.nickname}** 获得 **+${res.gainXp}** XP！${res.leveledUp ? `🎉 升到 **Lv.${res.pet.level}**！` : ''}`,
          }
        : {
            type: 'error',
            text: `宠物训练冷却中，还需休息 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
          };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'pets' }, fb));
      return true;
    }

    if (action === 'work') {
      const res = ctx.services.socialPet.workWithPet(guildId, actor.id, active.id);
      const fb: MenuFeedback = res.ok
        ? {
            type: 'success',
            text: `💼 **${res.pet.nickname}** 打工赚了 ${cfg.currencyEmoji} **+${res.coinsEarned}** ${cfg.currencyName}（+${res.gainXp} XP）！${res.leveledUp ? `🎉 升到 **Lv.${res.pet.level}**！` : ''}`,
          }
        : {
            type: 'error',
            text: `宠物打工疲惫冷却中，还需 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
          };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'pets' }, fb));
      return true;
    }

    if (action === 'release') {
      const res = ctx.services.socialPet.releasePet(guildId, actor.id, active.id);
      const fb: MenuFeedback = res.ok
        ? {
            type: 'info',
            text: `🕊️ 已放生 [${res.releasedPet.rarity}] **${res.releasedPet.nickname}**，获得遣散费 **+${res.refund}** ${cfg.currencyName}。`,
          }
        : { type: 'error', text: '找不到该宠物。' };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'pets' }, fb));
      return true;
    }
  }

  if (section === 'admin') {
    const adminAction = parts[2];
    const adminActions = new Set([
      'toggle_auto_event',
      'toggle_event_channel',
      'spawn_chest',
      'spawn_boss',
      'reset_games',
    ]);
    if (!adminAction || !adminActions.has(adminAction)) return false;

    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (adminAction === 'toggle_auto_event') {
      const next = !cfg.games.eventAutoEnabled;
      ctx.repos.guildConfig.updateGames(guildId, { ...cfg.games, eventAutoEnabled: next });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'success', text: `⚡ 世界事件自动触发已切换为：**${next ? '开启' : '关闭'}**。` },
        ),
      );
      return true;
    }

    if (adminAction === 'toggle_event_channel') {
      const nextCh = cfg.games.eventChannelId ? null : interaction.channelId;
      ctx.repos.guildConfig.updateGames(guildId, { ...cfg.games, eventChannelId: nextCh });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          {
            type: 'success',
            text: nextCh
              ? `📌 已绑定 <#${nextCh}> 为世界事件专属发布频道。`
              : '📌 已解绑专属事件频道，改为在活跃发言频道随机降临。',
          },
        ),
      );
      return true;
    }

    if (adminAction === 'spawn_chest' || adminAction === 'spawn_boss') {
      const fb = await spawnAndPostWorldEvent(
        interaction,
        ctx,
        guildId,
        adminAction === 'spawn_chest' ? 'chest' : 'boss',
      );
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'admin_games' }, fb));
      return true;
    }

    if (adminAction === 'reset_games') {
      ctx.repos.guildConfig.updateGames(guildId, {
        ...DEFAULT_GAMES_CONFIG,
        eventChannelId: cfg.games.eventChannelId,
      });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'success', text: '♻️ 已将道具定价、悬赏、事件、宠物与 CP 参数恢复默认值。' },
        ),
      );
      return true;
    }
  }

  if (section === 'modal') {
    const modalType = parts[2];
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (modalType === 'roulette') {
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId('menu:modal_sub:roulette')
          .setTitle('🔫 创建自定义轮盘房间')
          .addComponents(
            prefilledField('entryFee', '入场费（50 ~ 1000000000）', 200, 12),
            prefilledField('maxPlayers', '最大座位数（2 ~ 6 人）', 6, 2),
          ),
      );
      return true;
    }

    if (modalType === 'bomb') {
      await interaction.showModal(
        buildTextModal({
          customId: 'menu:modal_sub:bomb',
          title: '💣 投放数字炸弹',
          fieldId: 'penalty',
          label: '踩雷罚金（100 ~ 1000000000 星币）',
          placeholder: '例如：300',
          maxLength: 12,
          defaultValue: '200',
        }),
      );
      return true;
    }

    if (modalType === 'pred_create') {
      await interaction.showModal(buildCreatePredictionModal());
      return true;
    }

    if (modalType === 'pet_rename') {
      const active = ctx.services.socialPet.getActivePet(guildId, actor.id);
      if (!active) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'pets' },
            { type: 'error', text: '当前没有出战宠物，无法改名。' },
          ),
        );
        return true;
      }
      await interaction.showModal(
        buildTextModal({
          customId: 'menu:modal_sub:pet_rename',
          title: '✏️ 修改出战宠物昵称',
          fieldId: 'nickname',
          label: '新宠物昵称（1 ~ 20 字）',
          placeholder: '例如：旺财大魔王',
          maxLength: 20,
          defaultValue: active.nickname,
        }),
      );
      return true;
    }

    if (modalType === 'pet_open_battle') {
      await interaction.showModal(
        buildTextModal({
          customId: 'menu:modal_sub:pet_open_battle',
          title: '🏟️ 全群公开宠物摆擂台',
          fieldId: 'bet',
          label: '擂台赌注（0 = 友谊赛，可填正整数）',
          placeholder: '例如：200',
          maxLength: 12,
          defaultValue: '200',
        }),
      );
      return true;
    }

    if (
      modalType === 'admin_props' ||
      modalType === 'admin_events' ||
      modalType === 'admin_pets_cp' ||
      modalType === 'admin_bounty'
    ) {
      if (!actor.isAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
        );
        return true;
      }
      const g = cfg.games;

      if (modalType === 'admin_props') {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('menu:modal_sub:admin_props')
            .setTitle('🧰 修改黑市道具定价')
            .addComponents(
              prefilledField('trap', '捕兽夹价格', g.propTrapPrice),
              prefilledField('lockpick', '万能撬锁价格', g.propLockpickPrice),
              prefilledField('shield', '防盗保险价格', g.propShieldPrice),
              prefilledField('curse', '衰神符价格', g.propCursePrice),
              prefilledField('nickname', '改昵称卡价格', g.propNicknamePrice),
            ),
        );
        return true;
      }

      if (modalType === 'admin_events') {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('menu:modal_sub:admin_events')
            .setTitle('🎁 修改世界事件/Boss/宝箱')
            .addComponents(
              prefilledField('threshold', '自动触发发言数（5~500）', g.eventMsgThreshold),
              prefilledField('cooldown', '事件冷却秒数（60~86400）', g.eventCooldownSec),
              prefilledField('bossHp', 'Boss基础血量（100~100000）', g.bossBaseHp),
              prefilledField('bossPool', 'Boss讨伐奖池（100~1000000000）', g.bossRewardPool),
              prefilledField('chestRange', '宝箱总额范围(min-max)', `${g.chestRewardMin}-${g.chestRewardMax}`, 24),
            ),
        );
        return true;
      }

      if (modalType === 'admin_pets_cp') {
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId('menu:modal_sub:admin_pets_cp')
            .setTitle('🐾 修改宠物与CP参数')
            .addComponents(
              prefilledField('petGachaPrice', '盲盒抽宠价格（0~100000）', g.petGachaPrice),
              prefilledField('petFeedPrice', '每日喂食费用（0~10000）', g.petFeedPrice),
              prefilledField('petMaxOwned', '单人宠物上限（1~25）', g.petMaxOwned),
              prefilledField('cpProposeCost', '求婚/结拜仪式费（0~100000）', g.cpProposeCost),
              prefilledField('cpMaxSworn', '最多结拜人数（1~10）', g.cpMaxSworn),
            ),
        );
        return true;
      }

      await interaction.showModal(
        new ModalBuilder()
          .setCustomId('menu:modal_sub:admin_bounty')
          .setTitle('🎯 修改悬赏通缉参数')
          .addComponents(
            prefilledField('minAmount', '最低悬赏金额（1~100000）', g.bountyMinAmount),
            prefilledField('clearMult', '自费撤单倍率（1.0~5.0）', g.bountyClearMultiplier),
          ),
      );
      return true;
    }
  }

  return false;
}

export async function tryHandleGamesMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const section = parts[1];
  const selected = interaction.values[0];
  if (!selected) return false;

  if (section === 'prop_buy') {
    const disabledMsg =
      checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
      checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'props' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    if (!isValidPropKey(selected)) return true;

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    const res = ctx.services.chaos.buyProp(guildId, actor.id, selected);
    const def = PROP_CATALOG[selected];
    const fb: MenuFeedback = res.ok
      ? {
          type: 'success',
          text: `购买成功！${def.emoji} **${def.name}**（-${res.price} ${cfg.economy.currencyName}），当前持有 **${res.quantity}** 个，现金 **${res.balance}**。`,
        }
      : {
          type: 'error',
          text: `现金不足！购买 **${def.name}** 需要 ${getPropPrice(cfg.games, selected)} ${cfg.economy.currencyName}。`,
        };
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'props' }, fb));
    return true;
  }

  if (section === 'roulette_join') {
    const gameId = Number(selected);
    if (!Number.isInteger(gameId) || gameId <= 0) return true;
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.chaos.joinRoulette(gameId, actor.id);
    if (res.ok) {
      await editChannelMessage(
        interaction.client,
        res.game.channelId,
        res.game.messageId,
        buildRouletteCard(res.game, cfg),
        interaction.guild,
      );
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'roulette' },
          {
            type: 'success',
            text: `🪑 已成功加入轮盘 **#${gameId}**！扣除入场费 **${res.game.entryFee}**，当前现金 **${res.balance}**。`,
          },
        ),
      );
    } else {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'roulette' },
          { type: 'error', text: '无法加入该轮盘房间（可能已满员、已开局或现金不足）。' },
        ),
      );
    }
    return true;
  }

  if (section === 'bomb_pick') {
    const gameId = Number(selected);
    const game = ctx.services.chaos.getNumberBomb(gameId);
    if (!game || game.status !== 'open' || game.expiresAt <= Date.now()) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'bomb' },
          { type: 'error', text: '这颗炸弹已经引爆或过期啦！' },
        ),
      );
      return true;
    }
    await interaction.showModal(
      buildBombGuessModal(
        `menu:modal_sub:bomb_guess:${game.id}`,
        game.minBound,
        game.maxBound,
        game.penalty,
      ),
    );
    return true;
  }

  if (section === 'pred_select') {
    const predId = Number(selected);
    if (!Number.isInteger(predId) || predId <= 0) return true;
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'pred_detail', predictionId: predId }),
    );
    return true;
  }

  if (section === 'pred_settle') {
    const predId = Number(parts[2]);
    const winningOption = Number(selected);
    if (!Number.isInteger(predId) || !Number.isInteger(winningOption)) return true;

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.worldEvent.settlePrediction(
      predId,
      actor.id,
      Boolean(actor.isAdmin),
      winningOption,
    );
    if (!res.ok) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: '结算失败：仅开盘人或 Bot 管理员可操作。' },
        ),
      );
      return true;
    }

    const winLabel = res.summary.prediction.options[res.winningOption] ?? '';
    const note = res.refundedNoWinner
      ? `🏆 胜方：**${winLabel}**（无人押中，已全额退币）`
      : `🏆 胜方：**${winLabel}** ｜ 奖池 **${res.totalPool}** ${cfg.currencyName} 已派发给 **${res.payouts.length}** 位赢家！`;

    await editChannelMessage(
      interaction.client,
      res.summary.prediction.channelId,
      res.summary.prediction.messageId,
      buildPredictionCard(res.summary, cfg, note),
      interaction.guild,
    );
    await sendPublicBroadcast(interaction, {
      content: `📊 吃瓜盘口 **#${predId}「${res.summary.prediction.title}」** 已结算！${note}`,
    });

    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'pred_detail', predictionId: predId },
        { type: 'success', text: `结算完成！${note}` },
      ),
    );
    return true;
  }

  if (section === 'cp_checkin') {
    const relId = Number(selected);
    if (!Number.isInteger(relId) || relId <= 0) return true;
    const res = ctx.services.socialPet.checkinRelationship(relId, actor.id);
    if (!res.ok) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'cp' },
          {
            type: 'error',
            text:
              res.reason === 'already_checked_in'
                ? '这段关系今天已经打过卡啦，明天再来贴贴！'
                : '无法对该关系打卡。',
          },
        ),
      );
      return true;
    }

    const otherId = res.relationship.userA === actor.id ? res.relationship.userB : res.relationship.userA;
    if (res.unlockedTitles.length > 0) {
      await sendPublicBroadcast(interaction, {
        content: `🎊 <@${actor.id}> 与 <@${otherId}> 亲密度突破 **${res.relationship.affinity}**，双双解锁专属 CP 称号 **${res.unlockedTitles.join('、')}**！`,
      });
    }
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'cp' },
        {
          type: 'success',
          text: `💕 打卡成功！与 <@${otherId}> 亲密度 **+${res.gain}**（当前 **${res.relationship.affinity}**）！${res.unlockedTitles.length > 0 ? `\n🏷️ 已向双方发放新称号：**${res.unlockedTitles.join('、')}**` : ''}`,
        },
      ),
    );
    return true;
  }

  if (section === 'cp_dissolve') {
    const relId = Number(selected);
    if (!Number.isInteger(relId) || relId <= 0) return true;
    const res = ctx.services.socialPet.dissolveRelationship(relId, actor.id);
    const fb: MenuFeedback = res.ok
      ? { type: 'info', text: '💔 已和平解除该关系。' }
      : { type: 'error', text: '找不到该关系或你不是当事方。' };
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'cp' }, fb));
    return true;
  }

  if (section === 'pet_select') {
    const petId = Number(selected);
    if (!Number.isInteger(petId) || petId <= 0) return true;
    const pet = ctx.services.socialPet.setActivePet(guildId, actor.id, petId);
    const sp = pet ? PET_SPECIES_MAP.get(pet.speciesKey) : undefined;
    const fb: MenuFeedback = pet
      ? { type: 'success', text: `⭐ 已切换 ${sp?.emoji ?? '🐾'} **${pet.nickname}** 为当前出战宠物！` }
      : { type: 'error', text: '找不到该宠物。' };
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'pets' }, fb));
    return true;
  }

  return false;
}

export async function tryHandleGamesMenuUserSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  actionType: string | undefined,
  targetId: string,
  targetBot: boolean,
): Promise<boolean> {
  if (actionType === 'prop_curse') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'props' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    if (targetBot || targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: '不能对机器人或自己使用衰神符！' },
        ),
      );
      return true;
    }

    const res = ctx.services.chaos.useCurseProp(guildId, actor.id, targetId);
    if (!res.ok) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: '你身上没有「🧿 衰神符」，先去黑市商店买一张！' },
        ),
      );
      return true;
    }

    await sendPublicBroadcast(interaction, {
      content: `🧿 哈哈哈哈！<@${actor.id}> 偷偷给 <@${targetId}> 贴了一张「**衰神符**」，TA 下次打工收益直接减半！`,
    });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'props' },
        {
          type: 'success',
          text: `🧿 已对 <@${targetId}> 贴上衰神符（剩余 **${res.remainingQuantity}** 张）！`,
        },
      ),
    );
    return true;
  }

  if (actionType === 'prop_nick') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'props' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    if (targetBot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: '不能给机器人使用改昵称卡。' },
        ),
      );
      return true;
    }
    if (!ctx.services.chaos.hasProp(guildId, actor.id, 'nickname')) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: '你没有「🎭 改昵称卡」，请先在上方商店购买！' },
        ),
      );
      return true;
    }

    await interaction.showModal(
      buildTextModal({
        customId: `menu:modal_sub:prop_nick:${targetId}`,
        title: '🎭 强制修改群友昵称',
        fieldId: 'nickname',
        label: '输入想整蛊的新昵称（1 ~ 32 字）',
        placeholder: '例如：我是超级大显眼包',
        maxLength: 32,
      }),
    );
    return true;
  }

  if (actionType === 'bounty') {
    const disabledMsg =
      checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
      checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'bounty' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    if (targetBot || targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'bounty' },
          { type: 'error', text: '不能悬赏机器人或自己！' },
        ),
      );
      return true;
    }
    const minAmt = ctx.repos.guildConfig.getOrCreate(guildId).games.bountyMinAmount;
    await interaction.showModal(
      buildTextModal({
        customId: `menu:modal_sub:bounty:${targetId}`,
        title: '🎯 发布悬赏通缉令',
        fieldId: 'amount',
        label: `悬赏金额（至少 ${minAmt}）`,
        placeholder: `例如：${minAmt}`,
        maxLength: 12,
      }),
    );
    return true;
  }

  if (actionType === 'cp_marry' || actionType === 'cp_sworn') {
    const disabledMsg =
      checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物') ??
      checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'cp' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    if (targetBot || targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'cp' },
          { type: 'error', text: '不能向自己或机器人发起关系仪式！' },
        ),
      );
      return true;
    }
    if (!interaction.channel?.isSendable()) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'cp' },
          { type: 'error', text: '当前频道不支持发送公开仪式卡片。' },
        ),
      );
      return true;
    }

    const relType = actionType === 'cp_marry' ? 'marriage' : 'sworn';
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
        proposer_married: '你已经结婚啦，婚姻严格 1 对 1（如需重新绑定请先解除）。',
        target_married: `<@${targetId}> 已经有伴侣啦！`,
        proposer_max_sworn: `你的结拜/死党人数已达上限（${res.maxSworn ?? 3}人）。`,
        target_max_sworn: `<@${targetId}> 的结拜人数已满。`,
        insufficient_funds: `口袋现金不足，发起仪式需要 **${res.cost}** ${cfg.currencyName}。`,
      };
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'cp' }, { type: 'error', text: msgMap[res.reason] }),
      );
      return true;
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
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'cp' },
          { type: 'error', text: '发送仪式卡片失败，费用已退回。' },
        ),
      );
      return true;
    }

    ctx.services.socialPet.bindProposalMessage(res.proposal.id, broadcast.messageId);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'cp' },
        {
          type: 'success',
          text: `🎉 已向 <@${targetId}> 发出公开${relType === 'marriage' ? '求婚' : '结拜'}邀请（仪式编号 #${res.proposal.id}），剩余现金：**${res.balance}**！`,
        },
      ),
    );
    return true;
  }

  if (actionType === 'pet_battle') {
    const disabledMsg =
      checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物') ??
      checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'pet_arena' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    if (targetBot || targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pet_arena' },
          { type: 'error', text: '不能向自己或机器人发起宠物对决！' },
        ),
      );
      return true;
    }
    const active = ctx.services.socialPet.getActivePet(guildId, actor.id);
    if (!active) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pet_arena' },
          { type: 'error', text: '你还没有宠物，先去「宠物屋」抽取盲盒宠物再出战！' },
        ),
      );
      return true;
    }
    await interaction.showModal(
      buildTextModal({
        customId: `menu:modal_sub:pet_battle:${targetId}`,
        title: '🏟️ 发起宠物斗兽场挑战',
        fieldId: 'bet',
        label: '赌注金额（0 = 友谊切磋）',
        placeholder: '例如：200',
        maxLength: 12,
        defaultValue: '200',
      }),
    );
    return true;
  }

  return false;
}

export async function tryHandleGamesMenuModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const modalType = parts[2];

  if (modalType === 'prop_nick') {
    const targetId = parts[3];
    if (!targetId) return false;
    const newNick = interaction.fields.getTextInputValue('nickname').trim();
    if (!newNick || newNick.length > 32) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: '新昵称长度必须在 1 ~ 32 个字符之间。' },
        ),
      );
      return true;
    }

    if (!ctx.services.chaos.hasProp(guildId, actor.id, 'nickname')) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: '你没有可用的「🎭 改昵称卡」。' },
        ),
      );
      return true;
    }

    if (interaction.guild?.ownerId === targetId) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: '⚠️ Discord 限制机器人无法修改服务器群主的昵称（未扣除道具）。' },
        ),
      );
      return true;
    }

    const member = await interaction.guild?.members.fetch(targetId).catch(() => null);
    if (!member) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: '无法获取目标群友信息（未扣除道具）。' },
        ),
      );
      return true;
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
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: '🛡️ 不能对服务器管理员或 Bot 管理员使用「改昵称卡」（未扣除道具）。' },
        ),
      );
      return true;
    }

    const oldName = member.displayName;
    try {
      await member.setNickname(newNick, `被 ${actor.displayName} 使用了黑市改昵称卡`);
    } catch {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'props' },
          {
            type: 'error',
            text: '⚠️ 修改失败（对方身份组高于 Bot 或权限不足），已退回你的改昵称卡未扣除！',
          },
        ),
      );
      return true;
    }

    ctx.services.chaos.consumeProp(guildId, actor.id, 'nickname');
    await sendPublicBroadcast(interaction, {
      content: `🎭 整蛊成功！<@${actor.id}> 使用「改昵称卡」强行把 **${oldName}** (<@${targetId}>) 的昵称改成了 **「${newNick}」**！`,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'props' },
        { type: 'success', text: `🎭 已将 <@${targetId}> 强制改名为 **「${newNick}」**！` },
      ),
    );
    return true;
  }

  if (modalType === 'bounty') {
    const targetId = parts[3];
    if (!targetId) return false;
    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'bounty' },
          { type: 'error', text: '悬赏金额必须是大于 0 的正整数。' },
        ),
      );
      return true;
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
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'bounty' }, { type: 'error', text }),
      );
      return true;
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
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'bounty' },
        {
          type: 'success',
          text: `🎯 已成功对 <@${targetId}> 悬赏 **${amount}** ${cfg.currencyName}（当前赏金池 **${res.totalTargetBounty}**）！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'roulette') {
    const fee = parsePositiveInt(interaction.fields.getTextInputValue('entryFee')) ?? 0;
    const maxP = parseIntInRange(interaction.fields.getTextInputValue('maxPlayers'), 2, 6) ?? 0;
    if (fee < 50 || maxP < 2 || maxP > 6) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'roulette' },
          { type: 'error', text: '入场费需 >= 50，座位数必须在 2 ~ 6 之间。' },
        ),
      );
      return true;
    }
    const fb = await launchRouletteRoom(interaction, ctx, guildId, actor, fee, maxP);
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'roulette' }, fb),
    );
    return true;
  }

  if (modalType === 'bomb') {
    const penalty = parsePositiveInt(interaction.fields.getTextInputValue('penalty')) ?? 0;
    const fb = await launchNumberBomb(interaction, ctx, guildId, actor, penalty);
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'bomb' }, fb),
    );
    return true;
  }

  if (modalType === 'bomb_guess') {
    const gameId = Number(parts[3]);
    if (!Number.isInteger(gameId) || gameId <= 0) return false;
    const guess = parseIntInRange(interaction.fields.getTextInputValue('guess'), 1, 100);
    if (guess === null) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'bomb' },
          { type: 'error', text: '请输入 1 ~ 100 范围内的整数。' },
        ),
      );
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.chaos.guessNumberBomb(gameId, actor.id, guess);
    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到这颗炸弹。',
        not_open: '这颗炸弹已经引爆或结束了！',
        expired: '这颗炸弹已经过期。',
        invalid_guess: `请输入当前区间 **${res.minBound} ~ ${res.maxBound}** 之间的整数！`,
        consecutive_guess: '不能连续猜两次，等别人猜一次吧！',
        insufficient_funds: `现金不足 **${res.penalty}** ${cfg.currencyName}，无法参与抢猜。`,
      };
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'bomb' }, { type: 'error', text: msgMap[res.reason] }),
      );
      return true;
    }

    await editChannelMessage(
      interaction.client,
      res.game.channelId,
      res.game.messageId,
      buildNumberBombCard(res.game, cfg, res.payouts),
      interaction.guild,
    );

    if (res.exploded) {
      const payoutSummary =
        res.payouts.length > 0
          ? res.payouts.map((p) => `<@${p.userId}> +${p.amount}`).join('、')
          : '无其他存活分红者';
      await sendPublicBroadcast(interaction, {
        content: `💥 轰隆！<@${actor.id}> 在数字炸弹 **#${res.game.id}** 踩中了 **${res.guess}**，爆出 **${res.penaltyPaid}** ${cfg.currencyName}！\n💰 分红：${payoutSummary}`,
      });
    }

    const fb: MenuFeedback = res.exploded
      ? { type: 'error', text: `💥 踩雷了！猜中 **${res.guess}** 被扣除 **${res.penaltyPaid}** ${cfg.currencyName}！` }
      : { type: 'success', text: `😅 没炸！安全区间缩小为 **[${res.game.minBound} ~ ${res.game.maxBound}]**！` };
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'bomb' }, fb),
    );
    return true;
  }

  if (modalType === 'pred_create') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'predictions' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    if (!interaction.channel?.isSendable()) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'predictions' },
          { type: 'error', text: '当前频道不支持发消息。' },
        ),
      );
      return true;
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
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'predictions' },
          { type: 'error', text: '封盘时间必须是 1 ~ 10080 之间的正整数分钟。' },
        ),
      );
      return true;
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
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'predictions' }, { type: 'error', text }),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const broadcast = await sendPublicBroadcast(interaction, {
      content: `📊 <@${actor.id}> 发起了新吃瓜盘口「**${res.summary.prediction.title}**」，快来押宝分奖池！`,
      ...buildPredictionCard(res.summary, cfg),
    });
    if (broadcast.sent && broadcast.messageId) {
      ctx.services.worldEvent.bindPredictionMessage(res.summary.prediction.id, broadcast.messageId);
    }

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'pred_detail', predictionId: res.summary.prediction.id },
        { type: 'success', text: `📊 吃瓜盘口 **#${res.summary.prediction.id}** 已发起并在频道公开开盘！` },
      ),
    );
    return true;
  }

  if (modalType === 'pred_bet') {
    const predId = Number(parts[3]);
    const optionIndex = Number(parts[4]);
    if (!Number.isInteger(predId) || !Number.isInteger(optionIndex)) return false;

    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: '下注金额必须是大于 0 的正整数。' },
        ),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.worldEvent.placeBet({
      predictionId: predId,
      userId: actor.id,
      optionIndex,
      amount,
    });
    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '盘口不存在。',
        not_open: '盘口已封盘或已结束。',
        closed: '已经超过封盘时间啦。',
        invalid_option: '无效选项。',
        invalid_amount: '下注金额无效。',
        insufficient_funds: `口袋现金不足 **${amount}** ${cfg.currencyName}。`,
      };
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: msgMap[res.reason] },
        ),
      );
      return true;
    }

    await editChannelMessage(
      interaction.client,
      res.summary.prediction.channelId,
      res.summary.prediction.messageId,
      buildPredictionCard(res.summary, cfg),
      interaction.guild,
    );

    const optName = res.summary.prediction.options[optionIndex] ?? '';
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'pred_detail', predictionId: predId },
        {
          type: 'success',
          text: `🪙 已成功押注「**${optName}**」${cfg.currencyEmoji} **${res.betAmount}** ${cfg.currencyName}，剩余现金 **${res.balance}**！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'pet_rename') {
    const active = ctx.services.socialPet.getActivePet(guildId, actor.id);
    if (!active) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pets' },
          { type: 'error', text: '找不到你的出战宠物。' },
        ),
      );
      return true;
    }
    const nickname = interaction.fields.getTextInputValue('nickname');
    const res = ctx.services.socialPet.renamePet(guildId, actor.id, active.id, nickname);
    const fb: MenuFeedback = res.ok
      ? { type: 'success', text: `✏️ 已将出战宠物改名为 **「${res.pet.nickname}」**！` }
      : { type: 'error', text: '宠物昵称必须在 1 ~ 20 个字符之间。' };
    await respondFromModal(interaction, buildMenuMessage(ctx, guildId, actor, { page: 'pets' }, fb));
    return true;
  }

  if (modalType === 'pet_battle' || modalType === 'pet_open_battle') {
    const opponentId = modalType === 'pet_battle' ? (parts[3] ?? null) : null;
    const bet = parseNonNegativeInt(interaction.fields.getTextInputValue('bet'));
    if (bet === null || bet > 1_000_000_000) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pet_arena' },
          { type: 'error', text: '赌注必须是 0 ~ 1,000,000,000 之间的整数（0 为友谊赛）。' },
        ),
      );
      return true;
    }
    if (!interaction.channel?.isSendable()) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pet_arena' },
          { type: 'error', text: '当前频道不支持发送挑战卡片。' },
        ),
      );
      return true;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.socialPet.createPetBattle({
      guildId,
      channelId: interaction.channel.id,
      challengerId: actor.id,
      opponentId,
      bet,
    });
    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        self_target: '不能挑战自己。',
        invalid_bet: '赌注无效。',
        no_active_pet: '你还没有出战宠物，先抽一只吧！',
        insufficient_funds: `口袋现金不足 **${bet}** ${cfg.currencyName}。`,
      };
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pet_arena' },
          { type: 'error', text: msgMap[res.reason] },
        ),
      );
      return true;
    }

    const broadcast = await sendPublicBroadcast(interaction, {
      allowedMentions: opponentId ? { users: [opponentId] } : { parse: [] },
      content: opponentId
        ? `🏟️ <@${actor.id}> 派出了 **${res.challengerPet.nickname}**，向 <@${opponentId}> 发起宠物决斗（赌注 **${bet}** ${cfg.currencyName}）！`
        : `🏟️ <@${actor.id}> 携爱宠 **${res.challengerPet.nickname}** 在频道公开摆下擂台（赌注 **${bet}** ${cfg.currencyName}），谁敢来战？`,
      ...buildPetBattleCard(res.battle, res.challengerPet, null, cfg),
    });

    if (!broadcast.sent || !broadcast.messageId) {
      ctx.services.socialPet.declinePetBattle(res.battle.id, actor.id);
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'pet_arena' },
          { type: 'error', text: '发送擂台挑战卡失败。' },
        ),
      );
      return true;
    }

    ctx.services.socialPet.bindPetBattleMessage(res.battle.id, broadcast.messageId);
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'pet_arena' },
        {
          type: 'success',
          text: `🏟️ 宠物擂台 **#${res.battle.id}** 已发出！等待对手派宠应战。`,
        },
      ),
    );
    return true;
  }

  if (
    modalType === 'admin_props' ||
    modalType === 'admin_events' ||
    modalType === 'admin_pets_cp' ||
    modalType === 'admin_bounty'
  ) {
    if (!actor.isAdmin) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (modalType === 'admin_props') {
      const trap = parseIntInRange(interaction.fields.getTextInputValue('trap'), 0, 100_000);
      const lockpick = parseIntInRange(interaction.fields.getTextInputValue('lockpick'), 0, 100_000);
      const shield = parseIntInRange(interaction.fields.getTextInputValue('shield'), 0, 100_000);
      const curse = parseIntInRange(interaction.fields.getTextInputValue('curse'), 0, 100_000);
      const nickname = parseIntInRange(interaction.fields.getTextInputValue('nickname'), 0, 100_000);
      if (
        trap === null ||
        lockpick === null ||
        shield === null ||
        curse === null ||
        nickname === null
      ) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_games' },
            { type: 'error', text: '道具价格必须是 0 ~ 100,000 之间的整数。' },
          ),
        );
        return true;
      }
      ctx.repos.guildConfig.updateGames(guildId, {
        ...cfg.games,
        propTrapPrice: trap,
        propLockpickPrice: lockpick,
        propShieldPrice: shield,
        propCursePrice: curse,
        propNicknamePrice: nickname,
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'success', text: `🧰 已更新黑市道具定价（捕兽夹 ${trap} / 撬锁 ${lockpick} / 护盾 ${shield} / 衰神 ${curse} / 改名 ${nickname}）。` },
        ),
      );
      return true;
    }

    if (modalType === 'admin_events') {
      const threshold = parseIntInRange(interaction.fields.getTextInputValue('threshold'), 5, 500);
      const cooldown = parseIntInRange(interaction.fields.getTextInputValue('cooldown'), 60, 86_400);
      const bossHp = parseIntInRange(interaction.fields.getTextInputValue('bossHp'), 100, 100_000);
      const bossPool = parseIntInRange(interaction.fields.getTextInputValue('bossPool'), 100, 1_000_000_000);
      const rangeParts = interaction.fields
        .getTextInputValue('chestRange')
        .trim()
        .split(/[-~,，\s]+/);
      const chestMin =
        rangeParts.length === 2 ? parseIntInRange(rangeParts[0] ?? '', 10, 1_000_000_000) : null;
      const chestMax =
        rangeParts.length === 2 ? parseIntInRange(rangeParts[1] ?? '', 10, 1_000_000_000) : null;

      if (
        threshold === null ||
        cooldown === null ||
        bossHp === null ||
        bossPool === null ||
        chestMin === null ||
        chestMax === null ||
        chestMin > chestMax
      ) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_games' },
            { type: 'error', text: '输入无效，宝箱范围请填写如 800-2000 且 min <= max。' },
          ),
        );
        return true;
      }

      ctx.repos.guildConfig.updateGames(guildId, {
        ...cfg.games,
        eventMsgThreshold: threshold,
        eventCooldownSec: cooldown,
        bossBaseHp: bossHp,
        bossRewardPool: bossPool,
        chestRewardMin: chestMin,
        chestRewardMax: chestMax,
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'success', text: `🎁 已更新事件参数（每 ${threshold} 发言 / ${cooldown}s 冷却，Boss ${bossHp} HP / 池 ${bossPool}，宝箱 ${chestMin}~${chestMax}）。` },
        ),
      );
      return true;
    }

    if (modalType === 'admin_pets_cp') {
      const petGachaPrice = parseIntInRange(interaction.fields.getTextInputValue('petGachaPrice'), 0, 100_000);
      const petFeedPrice = parseIntInRange(interaction.fields.getTextInputValue('petFeedPrice'), 0, 10_000);
      const petMaxOwned = parseIntInRange(interaction.fields.getTextInputValue('petMaxOwned'), 1, 25);
      const cpProposeCost = parseIntInRange(interaction.fields.getTextInputValue('cpProposeCost'), 0, 100_000);
      const cpMaxSworn = parseIntInRange(interaction.fields.getTextInputValue('cpMaxSworn'), 1, 10);

      if (
        petGachaPrice === null ||
        petFeedPrice === null ||
        petMaxOwned === null ||
        cpProposeCost === null ||
        cpMaxSworn === null
      ) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_games' },
            { type: 'error', text: '输入数值超出允许范围。' },
          ),
        );
        return true;
      }

      ctx.repos.guildConfig.updateGames(guildId, {
        ...cfg.games,
        petGachaPrice,
        petFeedPrice,
        petMaxOwned,
        cpProposeCost,
        cpMaxSworn,
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'success', text: `🐾 已更新宠物与 CP 参数（抽宠 ${petGachaPrice} / 喂食 ${petFeedPrice} / 上限 ${petMaxOwned}，仪式费 ${cpProposeCost} / 结拜 ${cpMaxSworn}）。` },
        ),
      );
      return true;
    }

    const minAmount = parseIntInRange(interaction.fields.getTextInputValue('minAmount'), 1, 100_000);
    const clearMult = parseNumberInRange(interaction.fields.getTextInputValue('clearMult'), 1, 5);
    if (minAmount === null || clearMult === null) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'error', text: '悬赏最低额需 1~100000，自清倍率需 1.0~5.0。' },
        ),
      );
      return true;
    }
    ctx.repos.guildConfig.updateGames(guildId, {
      ...cfg.games,
      bountyMinAmount: minAmount,
      bountyClearMultiplier: clearMult,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_games' },
        { type: 'success', text: `🎯 已更新悬赏参数（最低 ${minAmount}，自清倍率 ${clearMult}x）。` },
      ),
    );
    return true;
  }

  return false;
}
