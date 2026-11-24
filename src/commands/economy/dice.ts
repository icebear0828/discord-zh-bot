import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { MAX_SOLO_GAMBLE_BET } from '../../config/economyConstants.js';
import type { DiceChoice } from '../../services/economyService.js';
import {
  createErrorEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  buildDiceHighlightEmbed,
  buildDiceResultEmbed,
  formatSoloBetError,
  sendChannelPublicNotice,
} from '../../ui/soloFormatters.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const diceCommand: CommandDefinition = {
  name: 'dice',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('dice')
      .setDescription('三颗骰子猜大小或豹子')
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
      )
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('choice')
            .setDescription('投注选项')
            .setRequired(true)
            .addChoices(
              { name: '大 (11~17 点，1倍净利)', value: 'big' },
              { name: '小 (4~10 点，1倍净利)', value: 'small' },
              { name: '豹子 (三颗同点，10倍净利)', value: 'triple' },
            ),
          '选项',
          '选择押大、押小或豹子',
        ),
      ),
    '猜大小',
    '三颗骰子猜大小或豹子',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const bet = interaction.options.getInteger('bet', true);
    const choice = interaction.options.getString('choice', true) as DiceChoice;
    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;

    const res = ctx.services.economy.playDice(guildCtx.guildId, interaction.user.id, bet, choice);
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
      embeds: [buildDiceResultEmbed(choice, bet, res, cfg)],
      flags: MessageFlags.Ephemeral,
    });

    if (res.won && res.isTriple) {
      await sendChannelPublicNotice(interaction, {
        embeds: [buildDiceHighlightEmbed(interaction.user.id, res, cfg)],
      });
    }
  },
};
