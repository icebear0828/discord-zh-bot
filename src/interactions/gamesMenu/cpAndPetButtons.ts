import type { ButtonInteraction } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { createSuccessEmbed, formatDurationZh } from '../../ui/embeds.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../../ui/menuShared.js';
import {
  buildPetReleaseConfirmView,
  buildPublicAffinityLeaderboardEmbed,
} from '../../ui/socialPetMenuBuilder.js';
import { dispatchByAction, type ActionRouteTable } from '../menu/subRouter.js';
import {
  checkModuleDisabled,
  parsePositiveInt,
  sendPublicBroadcast,
} from '../menuHelpers.js';
import { buildPetOpenBattleModal, buildPetRenameModal } from './gamesModalBuilders.js';

interface CpPetButtonInput {
  interaction: ButtonInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: readonly string[];
}

const CP_PET_NAV_VIEWS: Readonly<Record<string, MenuView>> = {
  social_hub: { page: 'social_hub' },
  cp: { page: 'cp' },
  pets: { page: 'pets' },
  pet_arena: { page: 'pet_arena' },
};

async function updateMenu(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  view: MenuView,
  feedback?: MenuFeedback,
): Promise<true> {
  await interaction.update(buildMenuMessage(ctx, guildId, actor, view, feedback));
  return true;
}

const CP_AND_PET_ROUTES: ActionRouteTable<CpPetButtonInput> = {
  exact: {
    nav: async ({ interaction, ctx, guildId, actor, parts }) => {
      const target = parts[2];
      if (target === 'cp_lb') {
        const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
        if (disabledMsg) {
          return updateMenu(
            interaction,
            ctx,
            guildId,
            actor,
            { page: 'social_hub' },
            { type: 'error', text: disabledMsg },
          );
        }
        const lbPage = parsePositiveInt(parts[3] ?? '') ?? 1;
        return updateMenu(interaction, ctx, guildId, actor, { page: 'cp_lb', lbPage });
      }

      const nextView = target ? CP_PET_NAV_VIEWS[target] : undefined;
      if (!nextView) return false;
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
      if (disabledMsg) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'home' },
          { type: 'error', text: disabledMsg },
        );
      }
      return updateMenu(interaction, ctx, guildId, actor, nextView);
    },

    share: async ({ interaction, ctx, guildId, actor, parts }) => {
      if (parts[2] !== 'cp_lb') return false;
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
      if (disabledMsg) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'cp' },
          { type: 'error', text: disabledMsg },
        );
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
      return updateMenu(interaction, ctx, guildId, actor, { page: 'cp_lb', lbPage }, fb);
    },

    pet: async ({ interaction, ctx, guildId, actor, parts }) => {
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pets' },
          { type: 'error', text: disabledMsg },
        );
      }

      const action = parts[2];
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;

      if (action === 'gacha') {
        const res = ctx.services.socialPet.pullPetGacha(guildId, actor.id);
        if (!res.ok) {
          const text =
            res.reason === 'deadbeat_blocked'
              ? '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止盲盒抽宠！'
              : res.reason === 'max_owned_reached'
                ? `宠物栏已满（上限 **${res.maxOwned}** 只），先放生不需要的宠物再来抽吧！`
                : `口袋现金不足！盲盒抽宠需要 **${res.price}** ${cfg.currencyName}。`;
          return updateMenu(interaction, ctx, guildId, actor, { page: 'pets' }, { type: 'error', text });
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

        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pets' },
          {
            type: 'success',
            text: `🎁 盲盒开出 **[${res.pet.rarity}] ${res.species.emoji} ${res.species.name}**（性格：${res.pet.trait}）！剩余现金：**${res.balance}**`,
          },
        );
      }

      const active = ctx.services.socialPet.getActivePet(guildId, actor.id);
      if (!active) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'pets' },
          { type: 'error', text: '你还没有宠物，先点击「🎁 抽盲盒」吧！' },
        );
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
        return updateMenu(interaction, ctx, guildId, actor, { page: 'pets' }, fb);
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
        return updateMenu(interaction, ctx, guildId, actor, { page: 'pets' }, fb);
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
        return updateMenu(interaction, ctx, guildId, actor, { page: 'pets' }, fb);
      }

      if (action === 'release') {
        if (ctx.services.socialPet.hasPendingBattleForPet(active.id)) {
          return updateMenu(
            interaction,
            ctx,
            guildId,
            actor,
            { page: 'pets' },
            {
              type: 'error',
              text: '该宠物正在斗兽场待战中，请先撤回擂台或等待对决结束后再放生！',
            },
          );
        }
        await interaction.update(buildPetReleaseConfirmView(ctx, guildId, actor, active.id));
        return true;
      }

      if (action === 'release_confirm') {
        const petId = Number(parts[3]);
        if (!Number.isInteger(petId) || petId <= 0) return false;
        const res = ctx.services.socialPet.releasePet(guildId, actor.id, petId);
        const fb: MenuFeedback = res.ok
          ? {
              type: 'info',
              text: `🕊️ 已放生 [${res.releasedPet.rarity}] **${res.releasedPet.nickname}**，获得遣散费 **+${res.refund}** ${cfg.currencyName}。`,
            }
          : res.reason === 'pet_in_battle'
            ? {
                type: 'error',
                text: '该宠物正在斗兽场待战中，请先撤回擂台或等待对决结束后再放生！',
              }
            : { type: 'error', text: '找不到该宠物。' };
        return updateMenu(interaction, ctx, guildId, actor, { page: 'pets' }, fb);
      }

      return false;
    },

    cp: async ({ interaction, ctx, guildId, actor, parts }) => {
      if (parts[2] !== 'dissolve_confirm') return false;
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
      if (disabledMsg) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'cp' },
          { type: 'error', text: disabledMsg },
        );
      }
      const relId = Number(parts[3]);
      if (!Number.isInteger(relId) || relId <= 0) return false;
      const res = ctx.services.socialPet.dissolveRelationship(relId, actor.id);
      const fb: MenuFeedback = res.ok
        ? { type: 'info', text: '💔 已和平解除该关系。' }
        : { type: 'error', text: '找不到该关系或你不是当事方。' };
      return updateMenu(interaction, ctx, guildId, actor, { page: 'cp' }, fb);
    },

    modal: async ({ interaction, ctx, guildId, actor, parts }) => {
      const modalType = parts[2];
      if (modalType === 'pet_rename') {
        const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
        if (disabledMsg) {
          return updateMenu(
            interaction,
            ctx,
            guildId,
            actor,
            { page: 'pets' },
            { type: 'error', text: disabledMsg },
          );
        }
        const active = ctx.services.socialPet.getActivePet(guildId, actor.id);
        if (!active) {
          return updateMenu(
            interaction,
            ctx,
            guildId,
            actor,
            { page: 'pets' },
            { type: 'error', text: '当前没有出战宠物，无法改名。' },
          );
        }
        await interaction.showModal(buildPetRenameModal(active.nickname));
        return true;
      }

      if (modalType === 'pet_open_battle') {
        const disabledMsg =
          checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物') ??
          checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
        if (disabledMsg) {
          return updateMenu(
            interaction,
            ctx,
            guildId,
            actor,
            { page: 'pet_arena' },
            { type: 'error', text: disabledMsg },
          );
        }
        const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
        await interaction.showModal(buildPetOpenBattleModal(cfg.currencyName));
        return true;
      }

      return false;
    },
  },
};

export async function tryHandleCpAndPetButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return dispatchByAction(parts[1], { interaction, ctx, guildId, actor, parts }, CP_AND_PET_ROUTES);
}
