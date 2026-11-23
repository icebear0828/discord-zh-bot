import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  createErrorEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const dailyCommand: CommandDefinition = {
  name: 'daily',
  data: applyZh(
    new SlashCommandBuilder().setName('daily').setDescription('领取每日签到星币，连签越久奖励越多'),
    '签到',
    '领取每日签到星币，连签越久奖励越多',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const res = ctx.services.economy.claimDaily(guildCtx.guildId, interaction.user.id);

    if (!res.ok) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '🗓️ 今天已经签过到啦',
            `你当前已连续签到 **${res.streak}** 天，请明天（北京时间 00:00 后）再来领取！`,
          ),
        ],
      });
      return;
    }

    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 每日签到成功！',
          [
            `获得 ${cfg.currencyEmoji} **+${res.reward}** ${cfg.currencyName}${res.bonus > 0 ? `（含连签加成 +${res.bonus}）` : ''}`,
            `连续签到：**${res.streak} 天**`,
            `当前钱包余额：**${res.balance}** ${cfg.currencyName}`,
          ].join('\n'),
        ),
      ],
    });
  },
};
