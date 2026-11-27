import type { ButtonInteraction } from 'discord.js';
import {
  DEFAULT_CREDIT_LOAN_CONFIG,
  DEFAULT_RPG_CONFIG,
} from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor } from '../../ui/menuShared.js';
import { dispatchByAction, type ActionRouteTable } from '../menu/subRouter.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  parsePositiveInt,
} from '../menuHelpers.js';
import {
  buildCreateRolePanelModal,
  buildCreditLoanConfigModal,
  buildEditCardModal,
  buildHustleConfigModal,
  buildLevelMsgModal,
  buildRpgConfigModal,
} from './configModalBuilders.js';
import {
  handleRolePanelAdminButton,
  ROLE_PANEL_ADMIN_ACTIONS,
} from './configRolePanelHandlers.js';
import { buildShopCreateModal, SHOP_MODAL_TYPES } from './configShopModalBuilders.js';

interface ConfigButtonInput {
  interaction: ButtonInteraction;
  ctx: AppContext;
  guildId: string;
  actor: MenuActor;
  parts: readonly string[];
}

async function handleNavButton({
  interaction,
  ctx,
  guildId,
  actor,
  parts,
}: ConfigButtonInput): Promise<boolean> {
  const target = parts[2];
  if (target === 'self_roles') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'rolePanels', '自助身份组');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    const panelId = parsePositiveInt(parts[3] ?? '') ?? undefined;
    const panelPage = parsePositiveInt(parts[4] ?? '') ?? undefined;
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'self_roles', panelId, panelPage }),
    );
    return true;
  }

  if (target === 'admin_lvl_rewards' || target === 'admin_roles' || target === 'admin_shop') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    if (target === 'admin_lvl_rewards') {
      const listPage = parsePositiveInt(parts[3] ?? '') ?? 1;
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'admin_lvl_rewards', listPage }),
      );
      return true;
    }
    if (target === 'admin_roles') {
      const panelId = parsePositiveInt(parts[3] ?? '') ?? undefined;
      const panelPage = parsePositiveInt(parts[4] ?? '') ?? undefined;
      const optPage = parsePositiveInt(parts[5] ?? '') ?? undefined;
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, {
          page: 'admin_roles',
          panelId,
          panelPage,
          optPage,
        }),
      );
      return true;
    }
    const listPage = parsePositiveInt(parts[3] ?? '') ?? 1;
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'admin_shop', listPage }),
    );
    return true;
  }

  return false;
}

const ADMIN_CONFIG_ACTIONS: ReadonlySet<string> = new Set([
  'toggle_announce_channel',
  'toggle_stack_roles',
  'toggle_stack_roles_rewards',
  'reset_credit_rpg',
  'reset_hustle_cd',
  'shop_del_confirm',
  ...ROLE_PANEL_ADMIN_ACTIONS,
]);

async function handleAdminButton({
  interaction,
  ctx,
  guildId,
  actor,
  parts,
}: ConfigButtonInput): Promise<boolean> {
  const action = parts[2];
  if (!action || !ADMIN_CONFIG_ACTIONS.has(action)) {
    return false;
  }

  if (!actor.isAdmin) {
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  if (action === 'shop_del_confirm') {
    const itemId = parsePositiveInt(parts[3] ?? '');
    const listPage = parsePositiveInt(parts[4] ?? '') ?? 1;
    if (!itemId) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_shop', listPage },
          { type: 'error', text: '无效的商品编号。' },
        ),
      );
      return true;
    }
    const removed = ctx.services.shop.removeItem(guildId, itemId);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop', listPage },
        removed
          ? { type: 'success', text: `🗑️ 已下架商店商品 **#${itemId}**。` }
          : { type: 'error', text: `未找到商品 **#${itemId}**。` },
      ),
    );
    return true;
  }

  if (action === 'reset_hustle_cd') {
    const cleared = ctx.services.creditLoan.resetAllHustleCooldowns(guildId);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_credit_rpg' },
        {
          type: 'success',
          text: `✅ 已重置本服所有成员的卖屁股冷却时间（共解除 **${cleared}** 名成员冷却）！`,
        },
      ),
    );
    return true;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (action === 'reset_credit_rpg') {
    ctx.repos.guildConfig.updateCreditLoan(guildId, { ...DEFAULT_CREDIT_LOAN_CONFIG });
    ctx.repos.guildConfig.updateRpg(guildId, { ...DEFAULT_RPG_CONFIG });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_credit_rpg' },
        { type: 'success', text: '已将信用借贷、卖屁股与西幻 RPG 参数全部恢复为默认值！' },
      ),
    );
    return true;
  }

  if (action === 'toggle_announce_channel') {
    const nextChannelId = cfg.leveling.announceChannelId ? null : interaction.channelId;
    ctx.repos.guildConfig.updateLeveling(guildId, {
      ...cfg.leveling,
      announceChannelId: nextChannelId,
    });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_lvl' },
        {
          type: 'success',
          text: nextChannelId
            ? `已将 <#${nextChannelId}> 设为统一升级播报频道。`
            : '已解绑固定播报频道，将在成员当前发言频道发送升级通知。',
        },
      ),
    );
    return true;
  }

  if (action === 'toggle_stack_roles' || action === 'toggle_stack_roles_rewards') {
    const nextStack = !cfg.leveling.stackRoles;
    ctx.repos.guildConfig.updateLeveling(guildId, {
      ...cfg.leveling,
      stackRoles: nextStack,
    });
    const returnPage = action === 'toggle_stack_roles_rewards' ? 'admin_lvl_rewards' : 'admin_lvl';
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: returnPage },
        {
          type: 'success',
          text: `身份组叠加模式已切换为：**${nextStack ? '保留旧等级身份组' : '仅保留最高等级身份组'}**。`,
        },
      ),
    );
    return true;
  }

  return handleRolePanelAdminButton(interaction, ctx, guildId, actor, action, parts);
}

async function handleModalOpenButton({
  interaction,
  ctx,
  guildId,
  actor,
  parts,
}: ConfigButtonInput): Promise<boolean> {
  const modalType = parts[2];

  if (modalType === 'edit_card') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'leveling', '等级与热度');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
      );
      return true;
    }
    const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
    await interaction.showModal(buildEditCardModal(profile));
    return true;
  }

  if (modalType === 'admin_lvl_msg' || modalType === 'admin_rp_create') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    if (modalType === 'admin_lvl_msg') {
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      await interaction.showModal(
        buildLevelMsgModal(cfg.leveling.levelUpTitle, cfg.leveling.levelUpTemplate),
      );
      return true;
    }
    await interaction.showModal(buildCreateRolePanelModal());
    return true;
  }

  if (modalType && SHOP_MODAL_TYPES.has(modalType)) {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    await interaction.showModal(buildShopCreateModal(modalType, ctx, guildId));
    return true;
  }

  if (modalType === 'admin_cl_loan' || modalType === 'admin_cl_hustle' || modalType === 'admin_rpg_cfg') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return true;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    if (modalType === 'admin_cl_loan') {
      await interaction.showModal(buildCreditLoanConfigModal(cfg.creditLoan));
      return true;
    }
    if (modalType === 'admin_cl_hustle') {
      await interaction.showModal(buildHustleConfigModal(cfg.creditLoan));
      return true;
    }
    await interaction.showModal(buildRpgConfigModal(cfg.rpg));
    return true;
  }

  return false;
}

const CONFIG_BUTTON_ROUTES: ActionRouteTable<ConfigButtonInput> = {
  exact: {
    nav: handleNavButton,
    admin: handleAdminButton,
    modal: handleModalOpenButton,
  },
};

export async function tryHandleConfigMenuButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return dispatchByAction(parts[1], { interaction, ctx, guildId, actor, parts }, CONFIG_BUTTON_ROUTES);
}
