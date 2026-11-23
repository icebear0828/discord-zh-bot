import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { COLORS, type AppContext, type CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const balanceCommand: CommandDefinition = {
  name: 'balance',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('balance')
      .setDescription('查看自己或他人的星币钱包与连签状态')
      .addUserOption((opt) =>
        applyZh(
          opt.setName('user').setDescription('目标成员（留空则看自己）'),
          '用户',
          '要查询钱包的成员',
        ),
      ),
    '钱包',
    '查看自己或他人的星币钱包与连签状态',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const target = interaction.options.getUser('user') ?? interaction.user;
    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const profile = ctx.repos.profile.getOrCreate(guildCtx.guildId, target.id);

    const embed = new EmbedBuilder()
      .setColor(COLORS.GOLD)
      .setAuthor({
        name: `${target.displayName} 的钱包`,
        iconURL: target.displayAvatarURL(),
      })
      .addFields(
        {
          name: `${cfg.currencyEmoji} 当前余额`,
          value: `**${profile.coins}** ${cfg.currencyName}`,
          inline: true,
        },
        {
          name: '🔥 连续签到',
          value: `**${profile.dailyStreak}** 天`,
          inline: true,
        },
        {
          name: '🏷️ 佩戴称号',
          value: profile.equippedTitle ? `「${profile.equippedTitle}」` : '无',
          inline: true,
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
