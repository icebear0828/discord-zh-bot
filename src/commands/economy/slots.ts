import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  createErrorEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const slotsCommand: CommandDefinition = {
  name: 'slots',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('slots')
      .setDescription('拉动幸运老虎机，三连 7️⃣ 赢取 15 倍奖金')
      .addIntegerOption((opt) =>
        applyZh(
          opt.setName('bet').setDescription('下注金额').setMinValue(1).setRequired(true),
          '下注',
          '下注的星币数量',
        ),
      ),
    '老虎机',
    '拉动幸运老虎机，三连 7️⃣ 赢取 15 倍奖金',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const bet = interaction.options.getInteger('bet', true);
    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const res = ctx.services.economy.playSlots(guildCtx.guildId, interaction.user.id, bet);

    if (!res.ok) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '❌ 下注失败',
            res.reason === 'insufficient_funds'
              ? `你的 ${cfg.currencyName} 不足以支付 **${bet}** 下注。`
              : '下注金额无效。',
          ),
        ],
      });
      return;
    }

    const reelDisplay = `【 ${res.reels.join('  |  ')} 】`;
    const isProfit = res.netChange > 0;
    const embed = (isProfit ? createSuccessEmbed : createErrorEmbed)(
      isProfit ? '🎰 老虎机中奖！' : '🎰 再接再厉',
      [
        reelDisplay,
        `倍率：**${res.multiplier}x** ｜ 返还：**${res.payout}** ${cfg.currencyName}`,
        `净变动：**${res.netChange >= 0 ? `+${res.netChange}` : res.netChange}** ${cfg.currencyName} ｜ 余额：**${res.balance}**`,
      ].join('\n'),
    );

    await interaction.reply({ embeds: [embed] });
  },
};
