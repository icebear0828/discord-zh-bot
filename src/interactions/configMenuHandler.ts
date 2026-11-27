import type {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { DEFAULT_LEVELING_CONFIG } from '../config/defaults.js';
import type { AppContext } from '../core/context.js';
import type { MenuActor } from '../ui/menuShared.js';
import { chainMenuHandlers } from './menu/subRouter.js';
import { tryHandleConfigMenuButton as handleConfigMenuButton } from './configMenu/configButtons.js';
import { handleRolePanelModalSubmit } from './configMenu/configRolePanelHandlers.js';
import {
  tryHandleConfigMenuChannelSelect as handleConfigMenuChannelSelect,
  tryHandleConfigMenuRoleSelect as handleConfigMenuRoleSelect,
  tryHandleConfigMenuStringSelect as handleConfigMenuStringSelect,
} from './configMenu/configSelects.js';
import { tryHandleConfigShopModal } from './configMenu/configShopModalSubmits.js';
import { tryHandleConfigSystemModal } from './configMenu/configSystemModalSubmits.js';

export async function tryHandleConfigMenuButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return handleConfigMenuButton(interaction, ctx, guildId, actor, parts);
}

export async function tryHandleConfigMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return handleConfigMenuStringSelect(interaction, ctx, guildId, actor, parts);
}

export async function tryHandleConfigMenuChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return handleConfigMenuChannelSelect(interaction, ctx, guildId, actor, parts);
}

export async function tryHandleConfigMenuRoleSelect(
  interaction: RoleSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return handleConfigMenuRoleSelect(interaction, ctx, guildId, actor, parts);
}

export async function tryHandleConfigMenuModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return chainMenuHandlers(
    [tryHandleConfigSystemModal, handleRolePanelModalSubmit, tryHandleConfigShopModal],
    interaction,
    ctx,
    guildId,
    actor,
    parts,
  );
}

export { DEFAULT_LEVELING_CONFIG };
