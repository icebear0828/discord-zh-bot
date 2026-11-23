import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { buildLeaderboardMessage } from '../commands/leveling/leaderboard.js';
import type { LeaderboardType } from '../services/levelingService.js';
import { createErrorEmbed, type AppContext } from '../ui/embeds.js';

export async function handleLeaderboardButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;

  const parts = interaction.customId.split(':');
  const rawType = parts[1];
  const rawPage = Number(parts[2] ?? '1');
  const type: LeaderboardType =
    rawType === 'coins' || rawType === 'invites' ? rawType : 'xp';
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

  try {
    await interaction.update(buildLeaderboardMessage(ctx, interaction.guildId, type, page));
  } catch {
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 翻页失败', '无法更新排行榜消息，请重新执行 `/排行榜`。')],
      flags: MessageFlags.Ephemeral,
    });
  }
}
