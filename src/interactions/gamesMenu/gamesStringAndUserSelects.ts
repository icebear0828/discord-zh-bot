import type {
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { PROP_CATALOG, getPropPrice } from '../../services/chaosService.js';
import { PET_SPECIES_MAP } from '../../services/socialPetService.js';
import { buildNumberBombCard, buildRouletteCard } from '../../ui/chaosMenuBuilder.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../../ui/menuShared.js';
import { buildCpDissolveConfirmView } from '../../ui/socialPetMenuBuilder.js';
import { buildPredictionCard } from '../../ui/worldEventMenuBuilder.js';
import { buildBombGuessModal } from '../chaosHandler.js';
import { dispatchByAction, type ActionRouteTable } from '../menu/subRouter.js';
import {
  checkModuleDisabled,
  editChannelMessage,
  sendPublicBroadcast,
} from '../menuHelpers.js';
import { isValidPropKey, launchCpProposal } from './gamesLaunchHelpers.js';
import {
  buildBountyTargetModal,
  buildPetBattleChallengeModal,
  buildPropNickModal,
} from './gamesModalBuilders.js';

interface StringSelectInput {
  interaction: StringSelectMenuInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: readonly string[];
  selected: string;
}

interface UserSelectInput {
  interaction: UserSelectMenuInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  actionType: string;
  targetId: string;
  targetBot: boolean;
}

async function updateMenu(
  interaction: StringSelectMenuInteraction | UserSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  view: MenuView,
  feedback?: MenuFeedback,
): Promise<true> {
  await interaction.update(buildMenuMessage(ctx, guildId, actor, view, feedback));
  return true;
}

const STRING_SELECT_ROUTES: ActionRouteTable<StringSelectInput> = {
  exact: {
    prop_buy: async ({ interaction, ctx, guildId, actor, selected }) => {
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: disabledMsg });
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
      return updateMenu(interaction, ctx, guildId, actor, { page: 'props' }, fb);
    },

    roulette_join: async ({ interaction, ctx, guildId, actor, selected }) => {
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'roulette' }, { type: 'error', text: disabledMsg });
      }
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
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'roulette' },
          {
            type: 'success',
            text: `🪑 已成功加入轮盘 **#${gameId}**！扣除入场费 **${res.game.entryFee}** ${cfg.currencyName}，当前现金 **${res.balance}** ${cfg.currencyName}。`,
          },
        );
      }

      const latest = ctx.services.chaos.getRoulette(gameId);
      if (latest && latest.status !== 'recruiting') {
        await editChannelMessage(
          interaction.client,
          latest.channelId,
          latest.messageId,
          buildRouletteCard(latest, cfg),
          interaction.guild,
        );
      }
      const msgMap: Record<typeof res.reason, string> = {
        not_found: '找不到该轮盘房间。',
        not_recruiting: '该轮盘局已经开局或已结束！',
        expired: '该轮盘招募已超时自动解散，入场费已原路退回。',
        already_joined: '你已经在这桌轮盘局里啦！',
        room_full: '该轮盘房间已满员！',
        insufficient_funds: `你的口袋现金不足以支付本桌入场费（${cfg.currencyName}）。`,
        deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参加轮盘！',
      };
      return updateMenu(interaction, ctx, guildId, actor, { page: 'roulette' }, { type: 'error', text: msgMap[res.reason] });
    },

    bomb_pick: async ({ interaction, ctx, guildId, actor, selected }) => {
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'bomb' }, { type: 'error', text: disabledMsg });
      }
      const gameId = Number(selected);
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const game = ctx.services.chaos.getNumberBomb(gameId);
      if (!game || game.status !== 'open' || game.expiresAt <= Date.now()) {
        if (game && game.status === 'open' && game.expiresAt <= Date.now()) {
          const expired = ctx.services.chaos.expireNumberBombIfDue(gameId);
          if (expired) {
            await editChannelMessage(
              interaction.client,
              expired.channelId,
              expired.messageId,
              buildNumberBombCard(expired, cfg),
              interaction.guild,
            );
          }
        }
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'bomb' },
          { type: 'error', text: '这颗炸弹已经引爆或过期啦！' },
        );
      }
      await interaction.showModal(
        buildBombGuessModal(
          `menu:modal_sub:bomb_guess:${game.id}`,
          game.minBound,
          game.maxBound,
          game.penalty,
          cfg.currencyName,
        ),
      );
      return true;
    },

    pred_select: async ({ interaction, ctx, guildId, actor, selected }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'predictions' }, { type: 'error', text: disabledMsg });
      }
      const predId = Number(selected);
      if (!Number.isInteger(predId) || predId <= 0) return true;
      ctx.services.worldEvent.lockPredictionIfDue(predId);
      return updateMenu(interaction, ctx, guildId, actor, { page: 'pred_detail', predictionId: predId });
    },

    pred_settle: async ({ interaction, ctx, guildId, actor, parts, selected }) => {
      const predId = Number(parts[2]);
      const winningOption = Number(selected);
      if (!Number.isInteger(predId) || !Number.isInteger(winningOption)) return true;

      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'worldEvents', '吃瓜与世界事件') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: disabledMsg },
        );
      }

      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.worldEvent.settlePrediction(
        predId,
        actor.id,
        Boolean(actor.isAdmin),
        winningOption,
      );
      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          not_found: '找不到该盘口。',
          no_permission: '结算失败：仅开盘人或 Bot 管理员可操作。',
          not_locked: '结算失败：请先封盘（锁定押注）后再宣布胜出结果！',
          invalid_status: '该盘口已结算或已作废。',
          invalid_option: '无效的胜出选项。',
        };
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pred_detail', predictionId: predId },
          { type: 'error', text: msgMap[res.reason] },
        );
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
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'pred_detail', predictionId: predId },
        { type: 'success', text: `结算完成！${note}` },
      );
    },

    cp_checkin: async ({ interaction, ctx, guildId, actor, selected }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'cp' }, { type: 'error', text: disabledMsg });
      }
      const relId = Number(selected);
      if (!Number.isInteger(relId) || relId <= 0) return true;
      const res = ctx.services.socialPet.checkinRelationship(relId, actor.id);
      if (!res.ok) {
        return updateMenu(
          interaction,
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
        );
      }

      const otherId = res.relationship.userA === actor.id ? res.relationship.userB : res.relationship.userA;
      if (res.unlockedTitles.length > 0) {
        await sendPublicBroadcast(interaction, {
          content: `🎊 <@${actor.id}> 与 <@${otherId}> 亲密度突破 **${res.relationship.affinity}**，双双解锁专属 CP 称号 **${res.unlockedTitles.join('、')}**！`,
        });
      }
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'cp' },
        {
          type: 'success',
          text: `💕 打卡成功！与 <@${otherId}> 亲密度 **+${res.gain}**（当前 **${res.relationship.affinity}**）！${res.unlockedTitles.length > 0 ? `\n🏷️ 已向双方发放新称号：**${res.unlockedTitles.join('、')}**` : ''}`,
        },
      );
    },

    cp_dissolve: async ({ interaction, ctx, guildId, actor, selected }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'cp' }, { type: 'error', text: disabledMsg });
      }
      const relId = Number(selected);
      if (!Number.isInteger(relId) || relId <= 0) return true;
      await interaction.update(buildCpDissolveConfirmView(ctx, guildId, actor, relId));
      return true;
    },

    pet_select: async ({ interaction, ctx, guildId, actor, selected }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'pets' }, { type: 'error', text: disabledMsg });
      }
      const petId = Number(selected);
      if (!Number.isInteger(petId) || petId <= 0) return true;
      const pet = ctx.services.socialPet.setActivePet(guildId, actor.id, petId);
      const sp = pet ? PET_SPECIES_MAP.get(pet.speciesKey) : undefined;
      const fb: MenuFeedback = pet
        ? { type: 'success', text: `⭐ 已切换 ${sp?.emoji ?? '🐾'} **${pet.nickname}** 为当前出战宠物！` }
        : { type: 'error', text: '找不到该宠物。' };
      return updateMenu(interaction, ctx, guildId, actor, { page: 'pets' }, fb);
    },
  },
};

const USER_SELECT_ROUTES: ActionRouteTable<UserSelectInput> = {
  exact: {
    prop_curse: async ({ interaction, ctx, guildId, actor, targetId, targetBot }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: disabledMsg });
      }
      if (targetBot || targetId === actor.id) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: '不能对机器人或自己使用衰神符！' });
      }
      const res = ctx.services.chaos.useCurseProp(guildId, actor.id, targetId);
      if (!res.ok) {
        const text =
          res.reason === 'already_active'
            ? `⚠️ <@${targetId}> 当前已被衰神附体（48h 内有效），等生效后再贴吧（本次未消耗道具）！`
            : '你身上没有「🧿 衰神符」，先去黑市商店买一张！';
        return updateMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text });
      }
      await sendPublicBroadcast(interaction, {
        content: `🧿 哈哈哈哈！<@${actor.id}> 偷偷给 <@${targetId}> 贴了一张「**衰神符**」，TA 48 小时内下次打工收益直接减半！`,
      });
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'props' },
        { type: 'success', text: `🧿 已对 <@${targetId}> 贴上衰神符（剩余 **${res.remainingQuantity}** 张）！` },
      );
    },

    prop_nick: async ({ interaction, ctx, guildId, actor, targetId, targetBot }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: disabledMsg });
      }
      if (targetBot) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: '不能给机器人使用改昵称卡。' });
      }
      if (!ctx.services.chaos.hasProp(guildId, actor.id, 'nickname')) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'props' }, { type: 'error', text: '你没有「🎭 改昵称卡」，请先在上方商店购买！' });
      }
      await interaction.showModal(buildPropNickModal(targetId));
      return true;
    },

    bounty: async ({ interaction, ctx, guildId, actor, targetId, targetBot }) => {
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'bounty' }, { type: 'error', text: disabledMsg });
      }
      if (targetBot || targetId === actor.id) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'bounty' }, { type: 'error', text: '不能悬赏机器人或自己！' });
      }
      const minAmt = ctx.repos.guildConfig.getOrCreate(guildId).games.bountyMinAmount;
      await interaction.showModal(buildBountyTargetModal(targetId, minAmt));
      return true;
    },

    cp_marry: handleCpUserSelect,
    cp_sworn: handleCpUserSelect,

    pet_battle: async ({ interaction, ctx, guildId, actor, targetId, targetBot }) => {
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'pet_arena' }, { type: 'error', text: disabledMsg });
      }
      if (targetBot || targetId === actor.id) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'pet_arena' }, { type: 'error', text: '不能向自己或机器人发起宠物对决！' });
      }
      const active = ctx.services.socialPet.getActivePet(guildId, actor.id);
      if (!active) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'pet_arena' }, { type: 'error', text: '你还没有宠物，先去「宠物屋」抽取盲盒宠物再出战！' });
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      await interaction.showModal(buildPetBattleChallengeModal(targetId, cfg.currencyName));
      return true;
    },
  },
};

async function handleCpUserSelect({
  interaction,
  ctx,
  guildId,
  actor,
  actionType,
  targetId,
  targetBot,
}: UserSelectInput): Promise<boolean> {
  const disabledMsg =
    checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物') ??
    checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return updateMenu(interaction, ctx, guildId, actor, { page: 'cp' }, { type: 'error', text: disabledMsg });
  }
  if (targetBot || targetId === actor.id) {
    return updateMenu(interaction, ctx, guildId, actor, { page: 'cp' }, { type: 'error', text: '不能向自己或机器人发起关系仪式！' });
  }
  const relType = actionType === 'cp_marry' ? 'marriage' : 'sworn';
  const fb = await launchCpProposal(interaction, ctx, guildId, actor, targetId, relType);
  return updateMenu(interaction, ctx, guildId, actor, { page: 'cp' }, fb);
}

export async function tryHandleGamesMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const selected = interaction.values[0];
  if (!selected) return false;
  return dispatchByAction(
    parts[1],
    { interaction, ctx, guildId, actor, parts, selected },
    STRING_SELECT_ROUTES,
  );
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
  if (!actionType) return false;
  return dispatchByAction(
    actionType,
    { interaction, ctx, guildId, actor, actionType, targetId, targetBot },
    USER_SELECT_ROUTES,
  );
}
