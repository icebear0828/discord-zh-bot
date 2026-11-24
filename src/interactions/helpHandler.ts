import { MessageFlags, type StringSelectMenuInteraction } from 'discord.js';
import { buildHelpMessage } from '../commands/general/help.js';
import { createErrorEmbed } from '../ui/embeds.js';

export async function handleHelpSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(':');
  const ownerId = parts[2] || undefined;

  if (ownerId && ownerId !== interaction.user.id) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🚫 这不是你的帮助面板',
          '请自行执行 `/帮助` 查看功能说明，无法切换他人的帮助菜单。',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selected = interaction.values[0] ?? 'overview';
  await interaction.update(buildHelpMessage(selected, ownerId)).catch(async () => {
    await interaction.reply({
      ...buildHelpMessage(selected, ownerId),
      flags: MessageFlags.Ephemeral,
    });
  });
}
