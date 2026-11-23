import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { buildBlackjackMessage } from '../commands/economy/blackjack.js';
import { createErrorEmbed, type AppContext } from '../ui/embeds.js';

export async function handleBlackjackButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;

  const [, action, ownerId] = interaction.customId.split(':');
  if (ownerId !== interaction.user.id) {
    await interaction.reply({
      embeds: [createErrorEmbed('🚫 这不是你的牌局', '只能由开局本人点击操作按钮哦！')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const res =
    action === 'hit'
      ? ctx.services.blackjack.hit(interaction.guildId, interaction.user.id)
      : action === 'double'
        ? ctx.services.blackjack.doubleDown(interaction.guildId, interaction.user.id)
        : ctx.services.blackjack.stand(interaction.guildId, interaction.user.id);

  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      invalid_bet: '下注无效。',
      insufficient_funds: '余额不足以双倍下注！',
      game_already_active: '对局仍在进行中。',
      no_active_game: '该局游戏已结束或已过期。',
      cannot_double: '只能在首轮两张牌时双倍下注。',
    };
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 操作失败', msgMap[res.reason])],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId).economy;
  await interaction.update(buildBlackjackMessage(res.game, res.balance, cfg.currencyName));
}
