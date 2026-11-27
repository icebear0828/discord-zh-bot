import {
  MessageFlags,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import type { AppContext } from '../core/context.js';
import { buildMenuMessage } from '../ui/menuBuilder.js';
import {
  tryHandleAiMenuButton,
  tryHandleAiMenuModal,
  tryHandleAiMenuStringSelect,
  tryHandleAiMenuUserSelect,
} from './aiMenuHandler.js';
import {
  tryHandleConfigMenuButton,
  tryHandleConfigMenuModal,
  tryHandleConfigMenuStringSelect,
} from './configMenuHandler.js';
import {
  tryHandleGamesMenuButton,
  tryHandleGamesMenuModal,
  tryHandleGamesMenuStringSelect,
  tryHandleGamesMenuUserSelect,
} from './gamesMenuHandler.js';
import {
  tryHandleAdminImageButton,
  tryHandleAdminImageModal,
} from './imageHandler.js';
import { resolveActor } from './menuHelpers.js';
import { tryHandleAdminQuickButton } from './menu/handlers/adminQuickButtons.js';
import { tryHandleEconomyBankRobButton } from './menu/handlers/economyBankRobButtons.js';
import { tryHandleAdminAndMiscModal } from './menu/handlers/menuAdminAndMiscModals.js';
import { tryHandleEconomyModal } from './menu/handlers/menuEconomyModals.js';
import { tryHandleMenuStringSelect } from './menu/handlers/menuStringSelects.js';
import {
  dispatchMenuChannelSelect,
  dispatchMenuRoleSelect,
  tryHandleMenuUserSelect,
} from './menu/handlers/menuUserRoleChannelSelects.js';
import { tryHandleShopBagSocialRankButton } from './menu/handlers/shopBagSocialRankButtons.js';
import { tryHandleSoloGameButton } from './menu/handlers/soloGameButtons.js';
import { chainMenuHandlers, splitCustomId } from './menu/subRouter.js';

export async function handleMenuButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const { section, parts } = splitCustomId(interaction.customId);

  if (section === 'open') {
    await interaction.reply({
      ...buildMenuMessage(ctx, guildId, actor, { page: 'home' }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const buttonCtx = { interaction, ctx, guildId, actor, parts };
  await chainMenuHandlers(
    [
      () => tryHandleGamesMenuButton(interaction, ctx, guildId, actor, parts),
      () => tryHandleConfigMenuButton(interaction, ctx, guildId, actor, parts),
      () => tryHandleAiMenuButton(interaction, ctx, guildId, actor, parts),
      () => tryHandleAdminImageButton(interaction, ctx, guildId, actor),
      () => tryHandleAdminQuickButton(buttonCtx),
      () => tryHandleShopBagSocialRankButton(buttonCtx),
      () => tryHandleSoloGameButton(buttonCtx),
      () => tryHandleEconomyBankRobButton(buttonCtx),
    ],
  );
}

export async function handleMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const { parts } = splitCustomId(interaction.customId);
  const selected = interaction.values[0];

  await chainMenuHandlers([
    () => tryHandleGamesMenuStringSelect(interaction, ctx, guildId, actor, parts),
    () => tryHandleConfigMenuStringSelect(interaction, ctx, guildId, actor, parts),
    () => tryHandleAiMenuStringSelect(interaction, ctx, guildId, actor, parts),
    () => tryHandleMenuStringSelect({ interaction, ctx, guildId, actor, parts, selected }),
  ]);
}

export async function handleMenuUserSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const { parts, action: actionType } = splitCustomId(interaction.customId);

  const targetId = interaction.values[0];
  if (!targetId) return;
  const targetUser = interaction.users.get(targetId) ?? interaction.users.first();
  const isTargetBot = Boolean(targetUser?.bot);

  await chainMenuHandlers([
    () => tryHandleAiMenuUserSelect(interaction, ctx, guildId, actor, parts, targetId, isTargetBot),
    () => tryHandleGamesMenuUserSelect(interaction, ctx, guildId, actor, actionType, targetId, isTargetBot),
    () =>
      tryHandleMenuUserSelect({
        interaction,
        ctx,
        guildId,
        actor,
        parts,
        actionType,
        targetId,
        targetUser,
      }),
  ]);
}

export async function handleMenuModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const { parts, action: modalType } = splitCustomId(interaction.customId);
  const modalCtx = { interaction, ctx, guildId, actor, parts, modalType };

  await chainMenuHandlers([
    () => tryHandleGamesMenuModal(interaction, ctx, guildId, actor, parts),
    () => tryHandleConfigMenuModal(interaction, ctx, guildId, actor, parts),
    () => tryHandleAiMenuModal(interaction, ctx, guildId, actor, parts),
    () => tryHandleAdminImageModal(interaction, ctx, guildId, actor),
    () => tryHandleAdminAndMiscModal(modalCtx),
    () => tryHandleEconomyModal(modalCtx),
  ]);
}

export async function handleMenuRoleSelect(
  interaction: RoleSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const { parts } = splitCustomId(interaction.customId);
  await dispatchMenuRoleSelect(interaction, ctx, guildId, actor, parts);
}

export async function handleMenuChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const { parts } = splitCustomId(interaction.customId);
  await dispatchMenuChannelSelect(interaction, ctx, guildId, actor, parts);
}
