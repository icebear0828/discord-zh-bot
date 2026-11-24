import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { buildBlackjackMessage } from '../commands/economy/blackjack.js';
import { createErrorEmbed, type AppContext } from '../ui/embeds.js';
import {
  buildBlackjackPublicReportEmbed,
  sendChannelPublicNotice,
} from '../ui/soloFormatters.js';

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
      bet_too_large: '下注超过单局上限。',
      insufficient_funds: '余额不足以双倍下注！',
      game_already_active: '对局仍在进行中。',
      no_active_game: '该局游戏已结束或已超时自动退注，请使用 `/二十一点` 重新开局。',
      cannot_double: '只能在首轮两张牌时双倍下注。',
      deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与博弈！',
    };
    if (res.reason === 'no_active_game') {
      await interaction
        .update({
          embeds: [createErrorEmbed('❌ 牌局已结束', msgMap[res.reason])],
          components: [],
        })
        .catch(async () => {
          await interaction.reply({
            embeds: [createErrorEmbed('❌ 牌局已结束', msgMap[res.reason])],
            flags: MessageFlags.Ephemeral,
          });
        });
      return;
    }
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 操作失败', msgMap[res.reason])],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId).economy;
  await interaction.update(buildBlackjackMessage(res.game, res.balance, cfg.currencyName));

  if (res.game.status !== 'playing') {
    const reportEmbed = buildBlackjackPublicReportEmbed({
      playerId: interaction.user.id,
      playerDisplayName: interaction.user.displayName,
      playerAvatarUrl: interaction.user.displayAvatarURL(),
      game: res.game,
      cfg,
    });
    await sendChannelPublicNotice(interaction, { embeds: [reportEmbed] });
  }
}
