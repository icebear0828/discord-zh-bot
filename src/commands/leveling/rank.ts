import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { parseCardColor } from '../../services/levelingService.js';
import { getRpgRealmInfo } from '../../services/rpgService.js';
import { PET_SPECIES_MAP } from '../../services/socialPetService.js';
import {
  COLORS,
  createErrorEmbed,
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
    if (target.bot) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法查询', '机器人没有等级名片，请选择真实群友查询。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const data = ctx.services.leveling.getRankCardData(guildCtx.guildId, target.id);
    const creditProfile = ctx.services.creditLoan.getCreditProfile(guildCtx.guildId, target.id);
    const gamblingStats = ctx.services.creditLoan.getGamblingStats(guildCtx.guildId, target.id);
    const hustleStats = ctx.services.creditLoan.getHustleStats(guildCtx.guildId, target.id);
    const rpgChar = ctx.repos.rpg.getCharacter(guildCtx.guildId, target.id);
    const netSign = gamblingStats.netProfit >= 0 ? '+' : '';
    const rpgProgress = rpgChar
      ? `${getRpgRealmInfo(rpgChar.level).fullLabel}（Lv.**${rpgChar.level}** · 破境 ${rpgChar.totalBreakthroughs} 次）`
      : '尚未踏入勇者殿堂';

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

    const rels = ctx.services.socialPet.listUserRelationships(guildCtx.guildId, target.id);
    const marriage = rels.find((r) => r.relType === 'marriage');
    const swornCount = rels.filter((r) => r.relType === 'sworn').length;
    const partnerText = marriage
      ? `💍 <@${marriage.userA === target.id ? marriage.userB : marriage.userA}>（亲密 ${marriage.affinity}）`
      : swornCount > 0
        ? `🍻 结拜死党 ${swornCount} 人`
        : '暂无 CP 绑定';

    const activePet = ctx.services.socialPet.getActivePet(guildCtx.guildId, target.id);
    const petSpecies = activePet ? PET_SPECIES_MAP.get(activePet.speciesKey) : undefined;
    const petText = activePet
      ? `${petSpecies?.emoji ?? '🐾'} **${activePet.nickname}** [${activePet.rarity} Lv.${activePet.level}]`
      : '暂无出战宠';

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
          name: `${cfg.economy.currencyEmoji} 总资产 (${cfg.economy.currencyName})`,
          value: `**${data.profile.coins + data.profile.bankCoins}**（现金 ${data.profile.coins} / 银行 ${data.profile.bankCoins}）`,
          inline: true,
        },
        ...(cfg.leveling.statEnabled
          ? [
              {
                name: `📏 ${cfg.leveling.statName}`,
                value: `**${data.profile.statValue}** ${cfg.leveling.statUnit}`,
                inline: true,
              },
            ]
          : []),
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
          name: '💞 关系 / 出战宠物',
          value: `${partnerText} ｜ ${petText}`,
        },
        {
          name: '💬 活跃统计',
          value: `有效发言 **${data.profile.messageCount}** 条 ｜ 语音挂机 **${data.profile.voiceMinutes}** 分钟`,
        },
        {
          name: '📜 征信与江湖档案',
          value: [
            `信用分：**${creditProfile.account.score}**（${creditProfile.tier.label}）${creditProfile.overdueLoans.length > 0 ? ' ⚠️ 逾期老赖' : ''}`,
            `博弈战绩：净盈亏 **${netSign}${gamblingStats.netProfit.toLocaleString()}** ${cfg.economy.currencyName}（${gamblingStats.gamesPlayed} 局） ｜ 卖屁股：**${hustleStats.totalCount}** 次`,
            `⚔️ 西幻RPG：${rpgProgress}`,
          ].join('\n'),
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
