import {
  EmbedBuilder,
  ModalBuilder,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
} from 'discord.js';
import { MAX_COIN_AMOUNT } from '../../../config/economyConstants.js';
import type { AppContext } from '../../../core/context.js';
import { COLORS } from '../../../ui/embeds.js';
import { buildRouletteDuelModal, buildRpsDuelModal } from '../../../ui/duelArenaBuilder.js';
import { buildMenuMessage, truncateText } from '../../../ui/menuBuilder.js';
import type { MenuActor, MenuFeedback, MenuView } from '../../../ui/menuShared.js';
import { tryHandleAiMenuChannelSelect } from '../../aiMenuHandler.js';
import {
  tryHandleConfigMenuChannelSelect,
  tryHandleConfigMenuRoleSelect,
} from '../../configMenuHandler.js';
import { tryHandleAdminImageChannelSelect } from '../../imageHandler.js';
import {
  ADMIN_DENIED_FEEDBACK,
  SUPER_ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  isGuildSuperAdmin,
  prefilledField,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from '../../menuHelpers.js';
import { chainMenuHandlers, dispatchByAction, type ActionRouteTable } from '../subRouter.js';
import {
  handleBankRobUserSelect,
  handlePocketRobUserSelect,
} from './economyBankRobButtons.js';
import {
  buildAmountModal,
  parseSocialAction,
  type MenuUserSelectContext,
} from './menuSharedModalsAndParsers.js';

async function updateUserSelectPage(
  input: MenuUserSelectContext,
  view: MenuView,
  feedback?: MenuFeedback,
): Promise<void> {
  await input.interaction.update(
    buildMenuMessage(input.ctx, input.guildId, input.actor, view, feedback),
  );
}

async function handleAdminGrantUserSelect(input: MenuUserSelectContext): Promise<void> {
  const { interaction, ctx, guildId, actor, targetId, targetUser } = input;
  if (!actor.isAdmin) {
    await updateUserSelectPage(input, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
    return;
  }
  const currencyName = ctx.repos.guildConfig.getOrCreate(guildId).economy.currencyName;
  if (targetUser?.bot) {
    await updateUserSelectPage(input, { page: 'admin_ops' }, {
      type: 'error',
      text: `不能给机器人发放或扣除${currencyName}。`,
    });
    return;
  }
  await interaction.showModal(
    buildAmountModal(
      `menu:modal_sub:admin_grant:${targetId}`,
      `💸 发放或扣除群友${currencyName}`,
      `增减${currencyName}（正数加币，负数扣币）`,
      '例如：10000 或 -500',
    ),
  );
}

async function handleAdminSetStatUserSelect(input: MenuUserSelectContext): Promise<void> {
  const { interaction, ctx, guildId, actor, targetId, targetUser } = input;
  if (!actor.isAdmin) {
    await updateUserSelectPage(input, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
    return;
  }
  if (targetUser?.bot) {
    await updateUserSelectPage(input, { page: 'admin_ops' }, {
      type: 'error',
      text: '不能修改机器人的成长数值。',
    });
    return;
  }
  const profile = ctx.repos.profile.getOrCreate(guildId, targetId);
  const lvl = ctx.repos.guildConfig.getOrCreate(guildId).leveling;
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`menu:modal_sub:admin_set_stat:${targetId}`)
      .setTitle(truncateText(`📏 设置成员${lvl.statName}`, 45))
      .addComponents(
        prefilledField(
          'statValue',
          truncateText(`目标${lvl.statName}（0 ~ 1000000000 ${lvl.statUnit}）`, 45),
          profile.statValue,
          10,
        ),
      ),
  );
}

async function handleAdminToggleUserSelect(input: MenuUserSelectContext): Promise<void> {
  const { interaction, ctx, guildId, actor, targetId, targetUser } = input;
  if (!actor.isAdmin) {
    await updateUserSelectPage(input, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
    return;
  }
  const superAdmin = Boolean(actor.isSuperAdmin || isGuildSuperAdmin(interaction, ctx, guildId));
  if (!superAdmin) {
    await updateUserSelectPage(input, { page: 'admin_ops' }, SUPER_ADMIN_DENIED_FEEDBACK);
    return;
  }
  if (targetUser?.bot) {
    await updateUserSelectPage(input, { page: 'admin_ops' }, {
      type: 'error',
      text: '不能将机器人设为 Bot 管理员。',
    });
    return;
  }
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const exists = cfg.adminUserIds.includes(targetId);
  const next = exists
    ? cfg.adminUserIds.filter((id) => id !== targetId)
    : [...cfg.adminUserIds, targetId];
  ctx.repos.guildConfig.updateAdminUsers(guildId, next);
  await updateUserSelectPage(input, { page: 'admin_ops' }, {
    type: 'success',
    text: exists
      ? `已移除 <@${targetId}> 的指定 Bot 管理员权限。`
      : `✅ 已授权 <@${targetId}> 成为 Bot 管理员（TA 打开 \`/菜单\` 即可看到「⚙️ 管理后台」）。`,
  });
}

async function handlePayUserSelect(input: MenuUserSelectContext): Promise<void> {
  const { interaction, ctx, guildId, actor, targetId, targetUser } = input;
  if (targetUser?.bot) {
    await updateUserSelectPage(input, { page: 'pay' }, { type: 'error', text: '不能向机器人转账。' });
    return;
  }
  if (targetId === actor.id) {
    await updateUserSelectPage(input, { page: 'pay' }, { type: 'error', text: '不能给自己转账！' });
    return;
  }
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await updateUserSelectPage(input, { page: 'pay' }, { type: 'error', text: disabledMsg });
    return;
  }
  await interaction.showModal(
    buildAmountModal(`menu:modal_sub:pay:${targetId}`, '💸 向群友转账', '转账金额（正整数）', '例如：100'),
  );
}

async function handleDiceDuelUserSelect(input: MenuUserSelectContext): Promise<void> {
  const { interaction, ctx, guildId, actor, targetId, targetUser } = input;
  if (targetUser?.bot) {
    await updateUserSelectPage(input, { page: 'duel' }, {
      type: 'error',
      text: '机器人不会掷骰子，请选择一位真实群友决斗！',
    });
    return;
  }
  if (targetId === actor.id) {
    await updateUserSelectPage(input, { page: 'duel' }, { type: 'error', text: '不能向自己发起决斗！' });
    return;
  }
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await updateUserSelectPage(input, { page: 'duel' }, { type: 'error', text: disabledMsg });
    return;
  }
  if (!interaction.channel?.isSendable()) {
    await updateUserSelectPage(input, { page: 'duel' }, {
      type: 'error',
      text: '当前频道不支持发送公开决斗卡片，请在普通文字频道中重试。',
    });
    return;
  }
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  await interaction.showModal(
    buildAmountModal(
      `menu:modal_sub:duel:${targetId}`,
      '⚔️ 发起骰子决斗',
      `决斗赌注（1 ~ ${MAX_COIN_AMOUNT.toLocaleString('en-US')} ${cfg.currencyName}）`,
      '例如：10000',
    ),
  );
}

async function handleArenaDuelUserSelect(input: MenuUserSelectContext): Promise<void> {
  const { interaction, ctx, guildId, actor, actionType, targetId, targetUser } = input;
  if (targetUser?.bot) {
    await updateUserSelectPage(input, { page: 'duel' }, {
      type: 'error',
      text: '不能向机器人发起决斗，请选择一位真实群友！',
    });
    return;
  }
  if (targetId === actor.id) {
    await updateUserSelectPage(input, { page: 'duel' }, { type: 'error', text: '不能向自己发起决斗！' });
    return;
  }
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
  if (disabledMsg) {
    await updateUserSelectPage(input, { page: 'duel' }, { type: 'error', text: disabledMsg });
    return;
  }
  if (!interaction.channel?.isSendable()) {
    await updateUserSelectPage(input, { page: 'duel' }, {
      type: 'error',
      text: '当前频道不支持发送公开决斗卡片，请在普通文字频道中重试。',
    });
    return;
  }
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  await interaction.showModal(
    actionType === 'rps_duel'
      ? buildRpsDuelModal(targetId, cfg.currencyName)
      : buildRouletteDuelModal(targetId, cfg.currencyName),
  );
}

async function handleSocialUserSelect(input: MenuUserSelectContext): Promise<void> {
  const { interaction, ctx, guildId, actor, parts, targetId, targetUser } = input;
  const action = parseSocialAction(parts[3]);
  if (targetUser?.bot) {
    await updateUserSelectPage(input, { page: 'social', action }, {
      type: 'error',
      text: '机器人不懂得情感互动，选一位真实群友试试吧~',
    });
    return;
  }
  if (targetId === actor.id) {
    await updateUserSelectPage(input, { page: 'social', action }, {
      type: 'error',
      text: '虽然自爱很好，但还是找一位群友互动吧~',
    });
    return;
  }
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'fun', '娱乐互动');
  if (disabledMsg) {
    await updateUserSelectPage(input, { page: 'social', action }, { type: 'error', text: disabledMsg });
    return;
  }

  await interaction.deferUpdate();
  const res = ctx.services.fun.performInteraction(guildId, actor.id, targetId, action);
  const publicEmbed = new EmbedBuilder()
    .setColor(COLORS.FUN)
    .setDescription(
      `${res.emoji} <@${actor.id}> ${res.verbPhrase} <@${targetId}>！\n*（你们之间的「${res.label}」累计已达 **${res.count}** 次）*`,
    )
    .setTimestamp();
  await sendPublicBroadcast(interaction, {
    content: `${res.emoji} <@${actor.id}> ${res.verbPhrase} <@${targetId}>！`,
    embeds: [publicEmbed],
  });

  await safeEditOrFollowUp(
    interaction,
    buildMenuMessage(ctx, guildId, actor, { page: 'social', action }, {
      type: 'success',
      text: `${res.emoji} 已对 <@${targetId}> 发起「${res.label}」（累计 **${res.count}** 次）！`,
    }),
  );
}

const USER_SELECT_ROUTES: ActionRouteTable<MenuUserSelectContext> = {
  exact: {
    admin_grant: handleAdminGrantUserSelect,
    admin_set_stat: handleAdminSetStatUserSelect,
    admin_toggle_user: handleAdminToggleUserSelect,
    rob: handlePocketRobUserSelect,
    rob_bank: handleBankRobUserSelect,
    pay: handlePayUserSelect,
    duel: handleDiceDuelUserSelect,
    rps_duel: handleArenaDuelUserSelect,
    roulette_duel: handleArenaDuelUserSelect,
    social: handleSocialUserSelect,
  },
};

export async function tryHandleMenuUserSelect(input: MenuUserSelectContext): Promise<boolean> {
  return dispatchByAction(input.actionType, input, USER_SELECT_ROUTES);
}

export async function dispatchMenuRoleSelect(
  interaction: RoleSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: string[],
): Promise<boolean> {
  return tryHandleConfigMenuRoleSelect(interaction, ctx, guildId, actor, parts);
}

export async function dispatchMenuChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: string[],
): Promise<boolean> {
  return chainMenuHandlers(
    [
      (i, c, g, a, p) => tryHandleConfigMenuChannelSelect(i, c, g, a, p),
      (i, c, g, a, p) => tryHandleAiMenuChannelSelect(i, c, g, a, p),
      (i, c, g, a) => tryHandleAdminImageChannelSelect(i, c, g, a),
    ],
    interaction,
    ctx,
    guildId,
    actor,
    parts,
  );
}
