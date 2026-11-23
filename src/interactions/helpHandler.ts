import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';
import { buildHelpMessage } from '../commands/general/help.js';

export async function handleHelpSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const selected = interaction.values[0] ?? 'overview';
  await interaction.update(buildHelpMessage(selected)).catch(async () => {
    await interaction.reply({ ...buildHelpMessage(selected), flags: MessageFlags.Ephemeral });
  });
}
