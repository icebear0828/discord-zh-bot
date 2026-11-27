import type {
  ChannelSelectMenuInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { computeRoleDiff } from '../../services/rolePanelService.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../../ui/menuShared.js';
import { dispatchByAction, type ActionRouteTable } from '../menu/subRouter.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  parsePositiveInt,
  safeEditOrFollowUp,
} from '../menuHelpers.js';
import {
  buildAddRoleOptionModal,
  buildLevelRewardAddModal,
} from './configModalBuilders.js';
import { syncPublishedRolePanel } from './configRolePanelHandlers.js';
import { buildShopRoleModal } from './configShopModalBuilders.js';

interface StringSelectInput {
  interaction: StringSelectMenuInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: readonly string[];
  selected: string | undefined;
}

async function updateMenu(
  interaction: StringSelectMenuInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction,
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
    admin_shop_del: async ({ interaction, ctx, guildId, actor, parts, selected }) => {
      if (!actor.isAdmin) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const listPage = parsePositiveInt(parts[2] ?? '') ?? 1;
      const itemId = parsePositiveInt(selected ?? '');
      if (!itemId) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'admin_shop', listPage }, { type: 'error', text: '无效的商品编号。' });
      }
      const targetItem = ctx.repos.shop.getItemById(guildId, itemId);
      if (!targetItem) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'admin_shop', listPage }, { type: 'error', text: `未找到商品 **#${itemId}**。` });
      }
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_shop', listPage, confirmDeleteItemId: itemId },
        {
          type: 'info',
          text: `⚠️ 确认下架商店商品 **#${targetItem.id}「${targetItem.name}」**？点击下方「✅ 确认下架」完成操作。`,
        },
      );
    },

    admin_lvl_reward_del: async ({ interaction, ctx, guildId, actor, parts, selected }) => {
      if (!actor.isAdmin) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const listPage = parsePositiveInt(parts[2] ?? '') ?? 1;
      const level = parsePositiveInt(selected ?? '');
      if (!level) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'admin_lvl_rewards', listPage }, { type: 'error', text: '无效的等级参数。' });
      }
      const removed = ctx.repos.profile.removeLevelReward(guildId, level);
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_lvl_rewards', listPage },
        removed
          ? { type: 'success', text: `已移除 **Lv.${level}** 的升级身份组奖励。` }
          : { type: 'error', text: `未找到 Lv.${level} 的奖励记录。` },
      );
    },

    admin_rp_select: async ({ interaction, ctx, guildId, actor, parts, selected }) => {
      if (!actor.isAdmin) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const panelPage = parsePositiveInt(parts[2] ?? '') ?? undefined;
      const panelId = parsePositiveInt(selected ?? '');
      return updateMenu(interaction, ctx, guildId, actor, {
        page: 'admin_roles',
        panelId: panelId ?? undefined,
        panelPage,
      });
    },

    admin_rp_del_opt: async ({ interaction, ctx, guildId, actor, parts, selected }) => {
      if (!actor.isAdmin) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      }
      const panelId = parsePositiveInt(parts[2] ?? '');
      const optPage = parsePositiveInt(parts[3] ?? '') ?? 1;
      if (!panelId || !selected) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'admin_roles' }, { type: 'error', text: '无效的面板或身份组选项。' });
      }
      await interaction.deferUpdate();
      const removed = ctx.services.rolePanel.removeOption(guildId, panelId, selected);
      const synced = removed
        ? await syncPublishedRolePanel(interaction, ctx, guildId, panelId)
        : false;
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles', panelId, optPage },
          removed
            ? {
                type: 'success',
                text: `已从面板 **#${panelId}** 移除 <@&${selected}>${synced ? '（已同步刷新频道卡片）' : ''}。`,
              }
            : { type: 'error', text: `面板 **#${panelId}** 中未找到该身份组选项。` },
        ),
      );
      return true;
    },

    self_rp_select: async ({ interaction, ctx, guildId, actor, parts, selected }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'rolePanels', '自助身份组');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg });
      }
      const panelPage = parsePositiveInt(parts[2] ?? '') ?? undefined;
      const panelId = parsePositiveInt(selected ?? '');
      return updateMenu(interaction, ctx, guildId, actor, {
        page: 'self_roles',
        panelId: panelId ?? undefined,
        panelPage,
      });
    },

    self_role_pick: async ({ interaction, ctx, guildId, actor, parts }) => {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'rolePanels', '自助身份组');
      if (disabledMsg) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg });
      }
      const panelId = parsePositiveInt(parts[2] ?? '');
      if (!panelId) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'self_roles' }, { type: 'error', text: '无法识别身份组面板编号。' });
      }
      const data = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
      if (!data) {
        return updateMenu(interaction, ctx, guildId, actor, { page: 'self_roles' }, { type: 'error', text: '该自助身份组面板已被管理员删除。' });
      }

      await interaction.deferUpdate();
      const member = interaction.inCachedGuild()
        ? interaction.member
        : ((await interaction.guild?.members?.fetch(actor.id).catch(() => null)) ?? null);
      if (!member) {
        await safeEditOrFollowUp(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'self_roles', panelId },
            { type: 'error', text: '无法识别服务器成员上下文，请稍后重试。' },
          ),
        );
        return true;
      }

      const panelRoleIds = data.options.map((o) => o.roleId);
      const currentRoles = [...member.roles.cache.keys()];
      const diff = computeRoleDiff(
        panelRoleIds,
        currentRoles,
        interaction.values,
        'select',
        data.panel.selectionMode,
      );

      try {
        if (diff.toRemove.length > 0) {
          await member.roles.remove(diff.toRemove, `菜单自助身份组 #${panelId}`);
        }
        if (diff.toAdd.length > 0) {
          await member.roles.add(diff.toAdd, `菜单自助身份组 #${panelId}`);
        }
      } catch {
        await safeEditOrFollowUp(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'self_roles', panelId },
            {
              type: 'error',
              text: '身份组更新失败：机器人缺少「管理身份组」权限，或 Bot 身份组排序低于目标身份组。',
            },
          ),
        );
        return true;
      }

      const removeSet = new Set(diff.toRemove);
      const nextRoleIds = [
        ...new Set([...currentRoles.filter((id) => !removeSet.has(id)), ...diff.toAdd]),
      ];
      const nextActor: MenuActor = { ...actor, roleIds: nextRoleIds };

      const changeParts: string[] = [];
      if (diff.toAdd.length > 0) {
        changeParts.push(`✅ 已领取：${diff.toAdd.map((r) => `<@&${r}>`).join('、')}`);
      }
      if (diff.toRemove.length > 0) {
        changeParts.push(`➖ 已移除：${diff.toRemove.map((r) => `<@&${r}>`).join('、')}`);
      }
      const feedback: MenuFeedback =
        changeParts.length > 0
          ? { type: 'success', text: changeParts.join('\n') }
          : { type: 'info', text: '你的身份组配置未发生变更。' };

      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(ctx, guildId, nextActor, { page: 'self_roles', panelId }, feedback),
      );
      return true;
    },
  },
};

export async function tryHandleConfigMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return dispatchByAction(
    parts[1],
    { interaction, ctx, guildId, actor, parts, selected: interaction.values[0] },
    STRING_SELECT_ROUTES,
  );
}

export async function tryHandleConfigMenuChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  if (parts[1] !== 'chan') {
    return false;
  }
  const target = parts[2];
  if (target !== 'admin_lvl_announce' && target !== 'admin_games_event') {
    return false;
  }

  if (!actor.isAdmin) {
    return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
  }

  const channelId = interaction.values[0] ?? null;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (target === 'admin_lvl_announce') {
    ctx.repos.guildConfig.updateLeveling(guildId, {
      ...cfg.leveling,
      announceChannelId: channelId,
    });
    return updateMenu(
      interaction,
      ctx,
      guildId,
      actor,
      { page: 'admin_lvl' },
      {
        type: 'success',
        text: channelId
          ? `已将升级播报频道设为 <#${channelId}>。`
          : '已清空固定升级播报频道，将在成员当前发言频道发送通知。',
      },
    );
  }

  ctx.repos.guildConfig.updateGames(guildId, {
    ...cfg.games,
    eventChannelId: channelId,
  });
  return updateMenu(
    interaction,
    ctx,
    guildId,
    actor,
    { page: 'admin_games' },
    {
      type: 'success',
      text: channelId
        ? `已将世界事件指定频道设为 <#${channelId}>。`
        : '已清空世界事件指定频道，将自动锁定 #游戏聊天（未找到则暂停刷出）。',
    },
  );
}

export async function tryHandleConfigMenuRoleSelect(
  interaction: RoleSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const actionType = parts[2];
  if (
    actionType !== 'admin_lvl_reward_add' &&
    actionType !== 'admin_rp_add' &&
    actionType !== 'admin_shop_add_role'
  ) {
    return false;
  }

  if (!actor.isAdmin) {
    return updateMenu(interaction, ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
  }

  const roleId = interaction.values[0];
  if (!roleId) return true;
  const selectedRole = interaction.roles.get(roleId);

  if (actionType === 'admin_shop_add_role') {
    if (roleId === guildId || selectedRole?.managed) {
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        { type: 'error', text: '不能将 `@everyone` 或机器人/系统托管身份组上架到商店。' },
      );
    }
    const defaultName = selectedRole?.name ? `身份组：${selectedRole.name}` : '';
    await interaction.showModal(buildShopRoleModal(roleId, defaultName));
    return true;
  }

  if (actionType === 'admin_lvl_reward_add') {
    if (roleId === guildId || selectedRole?.managed) {
      return updateMenu(
        interaction,
        ctx,
        guildId,
        actor,
        { page: 'admin_lvl_rewards' },
        { type: 'error', text: '不能将 `@everyone` 或机器人/系统托管身份组设为升级奖励。' },
      );
    }
    await interaction.showModal(buildLevelRewardAddModal(roleId));
    return true;
  }

  const panelId = parsePositiveInt(parts[3] ?? '');
  if (!panelId) {
    return updateMenu(
      interaction,
      ctx,
      guildId,
      actor,
      { page: 'admin_roles' },
      { type: 'error', text: '无效的身份组面板编号。' },
    );
  }

  if (roleId === guildId || selectedRole?.managed) {
    return updateMenu(
      interaction,
      ctx,
      guildId,
      actor,
      { page: 'admin_roles', panelId },
      { type: 'error', text: '不能将 `@everyone` 或机器人/系统托管身份组添加到自助面板。' },
    );
  }

  const data = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
  if (!data) {
    return updateMenu(
      interaction,
      ctx,
      guildId,
      actor,
      { page: 'admin_roles' },
      { type: 'error', text: `未找到面板 **#${panelId}**。` },
    );
  }
  if (data.options.length >= 25) {
    return updateMenu(
      interaction,
      ctx,
      guildId,
      actor,
      { page: 'admin_roles', panelId },
      { type: 'error', text: '单个面板最多支持 25 个身份组选项。' },
    );
  }
  if (data.options.some((o) => o.roleId === roleId)) {
    return updateMenu(
      interaction,
      ctx,
      guildId,
      actor,
      { page: 'admin_roles', panelId },
      { type: 'error', text: `面板中已存在 <@&${roleId}>。` },
    );
  }

  await interaction.showModal(buildAddRoleOptionModal(panelId, roleId, selectedRole?.name));
  return true;
}
