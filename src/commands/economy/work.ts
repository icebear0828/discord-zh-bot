import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  createErrorEmbed,
  createSuccessEmbed,
  formatDurationZh,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const workCommand: CommandDefinition = {
  name: 'work',
  data: applyZh(
    new SlashCommandBuilder().setName('work').setDescription('打工赚取星币'),
    '打工',
    '打工赚取星币',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const res = ctx.services.economy.work(guildCtx.guildId, interaction.user.id);

    if (!res.ok) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '⏳ 打工冷却中',
            `先休息一会儿吧！还需等待 **${formatDurationZh(res.retryAfterSec * 1000)}** 才能继续打工。`,
          ),
        ],
      });
      return;
    }

    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '💼 打工完成！',
          [
            `你${res.story}，赚取了 ${cfg.currencyEmoji} **+${res.reward}** ${cfg.currencyName}！`,
            `当前钱包余额：**${res.balance}** ${cfg.currencyName}`,
          ].join('\n'),
        ),
      ],
    });
  },
};
