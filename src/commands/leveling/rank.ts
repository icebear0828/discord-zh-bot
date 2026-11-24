import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { parseCardColor } from '../../services/levelingService.js';
import {
  COLORS,
  formatDurationZh,
  renderProgressBar,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const rankCommand: CommandDefinition = {
  name: 'rank',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('查看自己或指定成员的等级、经验进度与活跃热度')
      .addUserOption((opt) =>
        applyZh(
          opt.setName('user').setDescription('要查看的成员（留空则看自己）'),
          '用户',
          '要查看的成员（留空则看自己）',
        ),
      ),
    '等级',
    '查看自己或指定成员的等级、经验进度与活跃热度',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'leveling', '等级与热度'))) return;

    const target = interaction.options.getUser('user') ?? interaction.user;
    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const data = ctx.services.leveling.getRankCardData(guildCtx.guildId, target.id);

    const titleBadge = data.profile.equippedTitle ? `「${data.profile.equippedTitle}」 ` : '';
    const displayCardName = data.profile.cardNickname || target.displayName;
    const parsedColor = parseCardColor(data.profile.cardColor);
    const embedColor = (parsedColor.ok ? parsedColor.colorInt : null) ?? COLORS.PRIMARY;
    const bar = renderProgressBar(data.progress.progressRatio, 14);
    const pct = Math.round(data.progress.progressRatio * 100);

    const boostText =
      data.activeBoostMultiplier > 1 && data.boostExpiresAt > Date.now()
        ? `⚡ **${data.activeBoostMultiplier}x** 生效中（剩余 ${formatDurationZh(data.boostExpiresAt - Date.now())}）`
        : '未启用';

    const cardHeaderLines: string[] = [];
    if (data.profile.cardTag) {
      cardHeaderLines.push(`🏷️ **${data.profile.cardTag}**`);
    }
    if (data.profile.cardBio) {
      cardHeaderLines.push(`💬 *${data.profile.cardBio}*`);
    }

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setAuthor({
        name: `${titleBadge}${displayCardName} 的身份证名片`,
        iconURL: target.displayAvatarURL(),
      })
      .setThumbnail(target.displayAvatarURL());
    if (cardHeaderLines.length > 0) {
      embed.setDescription(cardHeaderLines.join('\n'));
    }
    embed
      .addFields(
        {
          name: '🏅 当前等级与排名',
          value: `Lv.**${data.progress.level}** ｜ 全服第 **#${data.rank}** / ${data.totalMembers} 名`,
          inline: true,
        },
        {
          name: `${cfg.economy.currencyEmoji} 持有${cfg.economy.currencyName}`,
          value: `**${data.profile.coins}**`,
          inline: true,
        },
        {
          name: '📊 本级经验进度',
          value: `\`${bar}\` **${pct}%**\n${data.progress.currentLevelXp} / ${data.progress.nextLevelXp} XP（累计 ${data.profile.xp} XP）`,
        },
        {
          name: '🔥 聊天热度倍率',
          value: `**${data.heatMultiplier}x**（连续活跃 ${data.profile.heatStreak} 次）`,
          inline: true,
        },
        {
          name: '🚀 经验卡加成',
          value: boostText,
          inline: true,
        },
        {
          name: '💬 活跃统计',
          value: `有效发言 **${data.profile.messageCount}** 条 ｜ 语音挂机 **${data.profile.voiceMinutes}** 分钟`,
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
