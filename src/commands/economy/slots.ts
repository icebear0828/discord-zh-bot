import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { MAX_SOLO_GAMBLE_BET } from '../../config/economyConstants.js';
import {
  createErrorEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  buildRobTargetHints,
  buildSlotsHighlightEmbed,
  buildSlotsResultEmbed,
  formatSoloBetError,
  sendChannelPublicNotice,
} from '../../ui/soloFormatters.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const slotsCommand: CommandDefinition = {
  name: 'slots',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('slots')
      .setDescription('拉动幸运老虎机，三连 🧊 赢取 100 倍、三连 7️⃣ 赢取 15 倍奖金')
      .addIntegerOption((opt) =>
        applyZh(
          opt
            .setName('bet')
            .setDescription(`下注金额（1 ~ ${MAX_SOLO_GAMBLE_BET.toLocaleString()}）`)
            .setMinValue(1)
            .setMaxValue(MAX_SOLO_GAMBLE_BET)
            .setRequired(true),
          '下注',
          '下注的星币数量',
        ),
      ),
    '老虎机',
    '拉动幸运老虎机，三连 🧊 赢取 100 倍、三连 7️⃣ 赢取 15 倍奖金',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const bet = interaction.options.getInteger('bet', true);
    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const playerHints = buildRobTargetHints(interaction.user, guildCtx.member);
    const res = ctx.services.economy.playSlots(
      guildCtx.guildId,
      interaction.user.id,
      bet,
      Math.random,
      Date.now(),
      playerHints,
    );

    if (!res.ok) {
      await interaction.reply({
        embeds: [
          createErrorEmbed('❌ 下注失败', formatSoloBetError(res.reason, bet, cfg.currencyName)),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [buildSlotsResultEmbed(res, cfg)],
      flags: MessageFlags.Ephemeral,
    });

    if (res.multiplier >= 4) {
      await sendChannelPublicNotice(interaction, {
        embeds: [buildSlotsHighlightEmbed(interaction.user.id, res, cfg)],
      });
    }
  },
};
