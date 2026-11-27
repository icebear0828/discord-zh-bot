import type { ButtonInteraction } from 'discord.js';
import type { AppContext } from '../core/context.js';
import { buildRpgHomeView } from '../ui/rpgMenuBuilder.js';
import { getActor } from './menuHelpers.js';
import { chainMenuHandlers, splitCustomId } from './menu/subRouter.js';
import { handleRpgGearButton } from './rpg/rpgGearButtons.js';
import { handleRpgHomeAndBossButton } from './rpg/rpgHomeAndBossButtons.js';
import { replyModuleDisabled, type RpgButtonContext } from './rpg/rpgInteractionHelpers.js';
import {
  handleRpgPrivatePvpOrCoopButton,
  handleRpgPublicPvpOrCoopButton,
} from './rpg/rpgPvpAndCoopButtons.js';
import {
  handleRpgPrivateTrialButton,
  handleRpgPublicTrialButton,
} from './rpg/rpgTrialButtons.js';

export {
  handleRpgModal,
  handleRpgStringSelect,
  handleRpgUserSelect,
} from './rpg/rpgSelectsAndModals.js';

export async function handleRpgButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (!cfg.modules.rpg) {
    await replyModuleDisabled(interaction);
    return;
  }

  const nowMs = Date.now();
  const parsed = splitCustomId(interaction.customId);
  const input: RpgButtonContext = {
    interaction,
    ctx,
    guildId,
    cfg,
    nowMs,
    section: parsed.section,
    arg: parsed.action,
    subArg: parsed.parts[3],
  };

  const handledPublic = await chainMenuHandlers(
    [handleRpgPublicTrialButton, handleRpgPublicPvpOrCoopButton],
    input,
  );
  if (handledPublic) return;

  const actor = getActor(interaction, ctx, guildId);
  const handledPrivate = await chainMenuHandlers(
    [
      handleRpgHomeAndBossButton,
      handleRpgPrivatePvpOrCoopButton,
      handleRpgPrivateTrialButton,
      handleRpgGearButton,
    ],
    input,
    actor,
  );
  if (handledPrivate) return;

  await interaction.update(
    buildRpgHomeView(
      ctx,
      guildId,
      actor,
      { type: 'error', text: '未知的冒险操作，已为你刷新冒险大厅。' },
      nowMs,
    ),
  );
}
