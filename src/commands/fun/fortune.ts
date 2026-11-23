import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { COLORS, type AppContext, type CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const fortuneCommand: CommandDefinition = {
  name: 'fortune',
  data: applyZh(
    new SlashCommandBuilder().setName('fortune').setDescription('抽取今日运势签（每天首次抽签赠送幸运星币）'),
    '运势',
    '抽取今日运势签（每天首次抽签赠送幸运星币）',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'fun', '娱乐互动'))) return;

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const res = ctx.services.fun.drawDailyFortune(guildCtx.guildId, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(COLORS.FUN)
      .setTitle(`🎋 ${interaction.user.displayName} 的今日运势 (${res.record.dateKey})`)
      .setDescription(
        `运势等级：**【${res.record.luckTier}】**${res.alreadyDrawn ? '（今日已抽签，展示同款签文）' : ''}`,
      )
      .addFields(
        { name: '🟢 今日宜', value: res.record.goodFor, inline: true },
        { name: '🔴 今日忌', value: res.record.avoid, inline: true },
        { name: '🔢 幸运数字', value: `**${res.record.luckyNumber}**`, inline: true },
        {
          name: `${cfg.currencyEmoji} 运势彩头`,
          value: res.alreadyDrawn
            ? `今日首抽已领 **+${res.record.bonusCoins}** ${cfg.currencyName}（当前余额 ${res.balance}）`
            : `首次抽签获赠 **+${res.record.bonusCoins}** ${cfg.currencyName}！（当前余额 ${res.balance}）`,
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
