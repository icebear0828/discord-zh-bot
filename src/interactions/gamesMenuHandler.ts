import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js';
import type { AppContext } from '../core/context.js';
import type { MenuActor } from '../ui/menuShared.js';
import { chainMenuHandlers } from './menu/subRouter.js';
import { tryHandleChaosAndBountyButton } from './gamesMenu/chaosAndBountyButtons.js';
import { tryHandleCpAndPetButton } from './gamesMenu/cpAndPetButtons.js';
import { tryHandleGamesModalPart1 } from './gamesMenu/gamesModalSubmitsPart1.js';
import { tryHandleGamesModalPart2 } from './gamesMenu/gamesModalSubmitsPart2.js';
import {
  tryHandleGamesMenuStringSelect as handleGamesMenuStringSelect,
  tryHandleGamesMenuUserSelect as handleGamesMenuUserSelect,
} from './gamesMenu/gamesStringAndUserSelects.js';
import { tryHandleWorldAndPredictionButton } from './gamesMenu/worldAndPredictionButtons.js';

export async function tryHandleGamesMenuButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return chainMenuHandlers(
    [
      tryHandleChaosAndBountyButton,
      tryHandleWorldAndPredictionButton,
      tryHandleCpAndPetButton,
    ],
    interaction,
    ctx,
    guildId,
    actor,
    parts,
  );
}

export async function tryHandleGamesMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return handleGamesMenuStringSelect(interaction, ctx, guildId, actor, parts);
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
  return handleGamesMenuUserSelect(
    interaction,
    ctx,
    guildId,
    actor,
    actionType,
    targetId,
    targetBot,
  );
}

export async function tryHandleGamesMenuModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  return chainMenuHandlers(
    [tryHandleGamesModalPart1, tryHandleGamesModalPart2],
    interaction,
    ctx,
    guildId,
    actor,
    parts,
  );
}
