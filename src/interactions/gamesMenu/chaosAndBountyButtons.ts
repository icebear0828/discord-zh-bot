import type { ButtonInteraction } from 'discord.js';
import { DEFAULT_GAMES_CONFIG } from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../../ui/menuShared.js';
import { dispatchByAction, type ActionRouteTable } from '../menu/subRouter.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  parsePositiveInt,
  sendPublicBroadcast,
} from '../menuHelpers.js';
import {
  isValidPropKey,
  launchNumberBomb,
  launchRouletteRoom,
  spawnAndPostWorldEvent,
} from './gamesLaunchHelpers.js';
import {
  buildAdminBountyModal,
  buildAdminEventsModal,
  buildAdminPetsCpModal,
  buildAdminPropsModal,
  buildNumberBombModal,
  buildRouletteModal,
} from './gamesModalBuilders.js';

interface ChaosButtonInput {
  interaction: ButtonInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: readonly string[];
}

const CHAOS_NAV_VIEWS: Readonly<Record<string, MenuView>> = {
  props: { page: 'props' },
  bounty: { page: 'bounty' },
  roulette: { page: 'roulette' },
  bomb: { page: 'bomb' },
};

const GAMES_ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  'toggle_auto_event',
  'toggle_event_channel',
  'spawn_chest',
  'spawn_boss',
  'reset_games',
]);

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

const CHAOS_AND_ADMIN_ROUTES: ActionRouteTable<ChaosButtonInput> = {
  exact: {
    nav: async ({ interaction, ctx, guildId, actor, parts }) => {
      const target = parts[2];
      if (target === 'admin_games') {
        if (!actor.isAdmin) {
          return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
        }
        return updateMenu(interaction, ctx, guildId, actor, { page: 'admin_games' });
      }
      const nextView = target ? CHAOS_NAV_VIEWS[target] : undefined;
      if (!nextView) return false;

      const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
      if (disabledMsg) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'multi' },
          { type: 'error', text: disabledMsg },
        );
      }
      return updateMenu(interaction, ctx, guildId, actor, nextView);
    },

    prop_use: async ({ interaction, ctx, guildId, actor, parts }) => {
      const rawKey = parts[2];
      if (!isValidPropKey(rawKey)) return false;
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
      if (disabledMsg) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'props' },
          { type: 'error', text: disabledMsg },
        );
      }
      const res = ctx.services.chaos.useSelfProp(guildId, actor.id, rawKey);
      const feedback: MenuFeedback = res.ok
        ? rawKey === 'trap'
          ? { type: 'success', text: `🪤 捕兽夹已在你的口袋门口部署完毕（24h 内有效），剩余 ${res.remainingQuantity} 个！` }
          : rawKey === 'lockpick'
            ? { type: 'success', text: `🗝️ 万能撬锁已握在手中！下次口袋打劫 +25% / 抢银行 +10%，剩余 ${res.remainingQuantity} 个。` }
            : {
                type: 'success',
                text: `🛡️ 防盗保险已激活！护盾持续至 <t:${Math.floor((res.shieldUntil ?? Date.now()) / 1000)}:R>，剩余 ${res.remainingQuantity} 个。`,
              }
        : res.reason === 'already_active'
          ? { type: 'error', text: '⚠️ 该道具效果仍在生效中，无需重复使用（本次未消耗道具）！' }
          : { type: 'error', text: '你当前没有该道具，先从上方下拉菜单购买吧！' };
      return updateMenu(interaction, ctx, guildId, actor, { page: 'props' }, feedback);
    },

    bounty: async ({ interaction, ctx, guildId, actor, parts }) => {
      if (parts[2] !== 'clear') return false;
      const disabledMsg =
        checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
        checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'bounty' },
          { type: 'error', text: disabledMsg },
        );
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.chaos.clearOwnBounty(guildId, actor.id);
      if (!res.ok) {
        const text =
          res.reason === 'no_bounty'
            ? '你身上目前没有任何待兑现悬赏！'
            : `现金不足！撤销悬赏需支付 **${res.cost}** ${cfg.currencyName}。`;
        return updateMenu(interaction, ctx, guildId, actor, { page: 'bounty' }, { type: 'error', text });
      }
      await sendPublicBroadcast(interaction, {
        content: `🧹 <@${actor.id}> 自掏腰包花费 **${res.cost}** ${cfg.currencyName}，强行抹除了自己身上 **${res.clearedAmount}** ${cfg.currencyName} 的通缉令！`,
      });
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'bounty' },
        { type: 'success', text: `🧹 已花费 **${res.cost}** 撤销了 **${res.clearedAmount}** 赏金通缉！` },
      );
    },

    roulette: async ({ interaction, ctx, guildId, actor, parts }) => {
      if (parts[2] !== 'new') return false;
      const fee = parsePositiveInt(parts[3] ?? '') ?? 100;
      const feedback = await launchRouletteRoom(interaction, ctx, guildId, actor, fee, 6);
      return updateMenu(interaction, ctx, guildId, actor, { page: 'roulette' }, feedback);
    },

    bomb: async ({ interaction, ctx, guildId, actor, parts }) => {
      if (parts[2] !== 'new') return false;
      const penalty = parsePositiveInt(parts[3] ?? '') ?? 100;
      const feedback = await launchNumberBomb(interaction, ctx, guildId, actor, penalty);
      return updateMenu(interaction, ctx, guildId, actor, { page: 'bomb' }, feedback);
    },

    admin: async ({ interaction, ctx, guildId, actor, parts }) => {
      const adminAction = parts[2];
      if (!adminAction || !GAMES_ADMIN_ACTIONS.has(adminAction)) return false;
      if (!actor.isAdmin) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }

      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

      if (adminAction === 'toggle_auto_event') {
        const next = !cfg.games.eventAutoEnabled;
        ctx.repos.guildConfig.updateGames(guildId, { ...cfg.games, eventAutoEnabled: next });
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          { type: 'success', text: `⚡ 世界事件自动触发已切换为：**${next ? '开启' : '关闭'}**。` },
        );
      }

      if (adminAction === 'toggle_event_channel') {
        const nextCh = cfg.games.eventChannelId ? null : interaction.channelId;
        ctx.repos.guildConfig.updateGames(guildId, { ...cfg.games, eventChannelId: nextCh });
        return updateMenu(
          interaction,
          ctx,
          guildId,
          actor,
          { page: 'admin_games' },
          {
            type: 'success',
            text: nextCh
              ? `📌 已绑定 <#${nextCh}> 为世界事件专属发布频道。`
              : '📌 已解绑专属事件频道，将自动锁定 #游戏聊天（未找到则暂停刷出）。',
          },
        );
      }

      if (adminAction === 'spawn_chest' || adminAction === 'spawn_boss') {
        const fb = await spawnAndPostWorldEvent(
          interaction,
          ctx,
          guildId,
          adminAction === 'spawn_chest' ? 'chest' : 'boss',
        );
        return updateMenu(interaction, ctx, guildId, actor, { page: 'admin_games' }, fb);
      }

      ctx.repos.guildConfig.updateGames(guildId, {
        ...DEFAULT_GAMES_CONFIG,
        eventChannelId: cfg.games.eventChannelId,
      });
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_games' },
        { type: 'success', text: '♻️ 已将道具定价、悬赏、事件、宠物与 CP 参数恢复默认值。' },
      );
    },

    modal: async ({ interaction, ctx, guildId, actor, parts }) => {
      const modalType = parts[2];
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

      if (modalType === 'roulette') {
        const disabledMsg =
          checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
          checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
        if (disabledMsg) {
          return updateMenu(
            interaction,
            ctx,
            guildId,
            actor,
            { page: 'roulette' },
            { type: 'error', text: disabledMsg },
          );
        }
        await interaction.showModal(buildRouletteModal(cfg.economy.currencyName));
        return true;
      }

      if (modalType === 'bomb') {
        const disabledMsg =
          checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈') ??
          checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
        if (disabledMsg) {
          return updateMenu(
            interaction,
            ctx,
            guildId,
            actor,
            { page: 'bomb' },
            { type: 'error', text: disabledMsg },
          );
        }
        await interaction.showModal(buildNumberBombModal(cfg.economy.currencyName));
        return true;
      }

      if (
        modalType === 'admin_props' ||
        modalType === 'admin_events' ||
        modalType === 'admin_pets_cp' ||
        modalType === 'admin_bounty'
      ) {
        if (!actor.isAdmin) {
          return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
        }
        if (modalType === 'admin_props') {
          await interaction.showModal(buildAdminPropsModal(cfg.games));
          return true;
        }
        if (modalType === 'admin_events') {
          await interaction.showModal(buildAdminEventsModal(cfg.games));
          return true;
        }
        if (modalType === 'admin_pets_cp') {
          await interaction.showModal(buildAdminPetsCpModal(cfg.games));
          return true;
        }
        await interaction.showModal(buildAdminBountyModal(cfg.games));
        return true;
      }

      return false;
    },
  },
};

export async function tryHandleChaosAndBountyButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return dispatchByAction(parts[1], { interaction, ctx, guildId, actor, parts }, CHAOS_AND_ADMIN_ROUTES);
}
