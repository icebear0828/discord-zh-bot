import type { ModalSubmitInteraction } from 'discord.js';
import { MAX_COIN_AMOUNT } from '../../config/economyConstants.js';
import type { AppContext } from '../../core/context.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../../ui/menuShared.js';
import { buildPetBattleCard } from '../../ui/socialPetMenuBuilder.js';
import { dispatchByAction, type ActionRouteTable } from '../menu/subRouter.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  parseIntInRange,
  parseNonNegativeInt,
  parseNumberInRange,
  respondFromModal,
  sendPublicBroadcast,
} from '../menuHelpers.js';

interface GamesModalPart2Input {
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

async function handlePetBattleModal({
  interaction,
  ctx,
  guildId,
  actor,
  parts,
}: GamesModalPart2Input): Promise<boolean> {
  const modalType = parts[2];
  const disabledMsg =
    checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物') ??
    checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return replyModalMenu(interaction, ctx, guildId, actor, { page: 'pet_arena' }, { type: 'error', text: disabledMsg });
  }
  const opponentId = modalType === 'pet_battle' ? (parts[3] ?? null) : null;
  const bet = parseNonNegativeInt(interaction.fields.getTextInputValue('bet'));
  if (bet === null || bet > MAX_COIN_AMOUNT) {
    return replyModalMenu(
      interaction,
      ctx,
      guildId,
      actor,
      { page: 'pet_arena' },
      { type: 'error', text: `赌注必须是 0 ~ ${MAX_COIN_AMOUNT.toLocaleString()} 之间的整数（0 为友谊赛）。` },
    );
  }
  if (!interaction.channel?.isSendable()) {
    return replyModalMenu(interaction, ctx, guildId, actor, { page: 'pet_arena' }, { type: 'error', text: '当前频道不支持发送挑战卡片。' });
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
      deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止发起带赌注斗兽场！',
      pvp_cooldown: `斗兽场冷却中，请等待 **${res.retryAfterSec ?? 1}** 秒后再发起有赌注挑战！`,
    };
    return replyModalMenu(interaction, ctx, guildId, actor, { page: 'pet_arena' }, { type: 'error', text: msgMap[res.reason] });
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
    return replyModalMenu(interaction, ctx, guildId, actor, { page: 'pet_arena' }, { type: 'error', text: '发送擂台挑战卡失败。' });
  }

  ctx.services.socialPet.bindPetBattleMessage(res.battle.id, broadcast.messageId);
  return replyModalMenu(
    interaction,
    ctx,
    guildId,
    actor,
    { page: 'pet_arena' },
    { type: 'success', text: `🏟️ 宠物擂台 **#${res.battle.id}** 已发出！等待对手派宠应战。` },
  );
}

const MODAL_PART2_ROUTES: ActionRouteTable<GamesModalPart2Input> = {
  exact: {
    pet_rename: async ({ interaction, ctx, guildId, actor }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
      if (disabledMsg) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'pets' }, { type: 'error', text: disabledMsg });
      }
      const active = ctx.services.socialPet.getActivePet(guildId, actor.id);
      if (!active) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'pets' }, { type: 'error', text: '找不到你的出战宠物。' });
      }
      const nickname = interaction.fields.getTextInputValue('nickname');
      const res = ctx.services.socialPet.renamePet(guildId, actor.id, active.id, nickname);
      const fb: MenuFeedback = res.ok
        ? { type: 'success', text: `✏️ 已将出战宠物改名为 **「${res.pet.nickname}」**！` }
        : { type: 'error', text: '宠物昵称必须在 1 ~ 20 个字符之间。' };
      return replyModalMenu(interaction, ctx, guildId, actor, { page: 'pets' }, fb);
    },

    pet_battle: handlePetBattleModal,
    pet_open_battle: handlePetBattleModal,

    admin_props: async ({ interaction, ctx, guildId, actor }) => {
      if (!actor.isAdmin) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      const trap = parseIntInRange(interaction.fields.getTextInputValue('trap'), 0, 100_000);
      const lockpick = parseIntInRange(interaction.fields.getTextInputValue('lockpick'), 0, 100_000);
      const shield = parseIntInRange(interaction.fields.getTextInputValue('shield'), 0, 100_000);
      const curse = parseIntInRange(interaction.fields.getTextInputValue('curse'), 0, 100_000);
      const nickname = parseIntInRange(interaction.fields.getTextInputValue('nickname'), 0, 100_000);
      if (trap === null || lockpick === null || shield === null || curse === null || nickname === null) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'error', text: '道具价格必须是 0 ~ 100,000 之间的整数。' },
        );
      }
      ctx.repos.guildConfig.updateGames(guildId, {
        ...cfg.games,
        propTrapPrice: trap,
        propLockpickPrice: lockpick,
        propShieldPrice: shield,
        propCursePrice: curse,
        propNicknamePrice: nickname,
      });
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_games' },
        {
          type: 'success',
          text: `🧰 已更新黑市道具定价（捕兽夹 ${trap} / 撬锁 ${lockpick} / 护盾 ${shield} / 衰神 ${curse} / 改名 ${nickname}）。`,
        },
      );
    },

    admin_events: async ({ interaction, ctx, guildId, actor }) => {
      if (!actor.isAdmin) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
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
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'error', text: '输入无效，宝箱范围请填写如 800-2000 且 min <= max。' },
        );
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
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_games' },
        {
          type: 'success',
          text: `🎁 已更新事件参数（每 ${threshold} 发言 / ${cooldown}s 冷却，Boss ${bossHp} HP / 池 ${bossPool}，宝箱 ${chestMin}~${chestMax}）。`,
        },
      );
    },

    admin_pets_cp: async ({ interaction, ctx, guildId, actor }) => {
      if (!actor.isAdmin) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
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
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'error', text: '输入数值超出允许范围。' },
        );
      }

      ctx.repos.guildConfig.updateGames(guildId, {
        ...cfg.games,
        petGachaPrice,
        petFeedPrice,
        petMaxOwned,
        cpProposeCost,
        cpMaxSworn,
      });
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_games' },
        {
          type: 'success',
          text: `🐾 已更新宠物与 CP 参数（抽宠 ${petGachaPrice} / 喂食 ${petFeedPrice} / 上限 ${petMaxOwned}，仪式费 ${cpProposeCost} / 结拜 ${cpMaxSworn}）。`,
        },
      );
    },

    admin_bounty: async ({ interaction, ctx, guildId, actor }) => {
      if (!actor.isAdmin) {
        return replyModalMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      const minAmount = parseIntInRange(interaction.fields.getTextInputValue('minAmount'), 1, 100_000);
      const clearMult = parseNumberInRange(interaction.fields.getTextInputValue('clearMult'), 1, 5);
      if (minAmount === null || clearMult === null) {
        return replyModalMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'error', text: '悬赏最低额需 1~100000，自清倍率需 1.0~5.0。' },
        );
      }
      ctx.repos.guildConfig.updateGames(guildId, {
        ...cfg.games,
        bountyMinAmount: minAmount,
        bountyClearMultiplier: clearMult,
      });
      return replyModalMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_games' },
        { type: 'success', text: `🎯 已更新悬赏参数（最低 ${minAmount}，自清倍率 ${clearMult}x）。` },
      );
    },
  },
};

export async function tryHandleGamesModalPart2(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return dispatchByAction(parts[2], { interaction, ctx, guildId, actor, parts }, MODAL_PART2_ROUTES);
}
