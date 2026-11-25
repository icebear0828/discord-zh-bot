import {
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { buildSellButtPublicEmbed } from '../../ui/creditLoanMenuBuilder.js';
import {
  createErrorEmbed,
  formatDurationZh,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { buttonRow, makeButton } from '../../ui/menuShared.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const hustleCommand: CommandDefinition = {
  name: '卖屁股',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('卖屁股')
      .setDescription('立刻上街下海营业赚快钱还债（1小时冷却，扣信用分并公开播报）'),
    '卖屁股',
    '立刻上街下海营业赚快钱还债（1小时冷却，扣信用分并公开播报）',
    '賣屁股',
    '立刻上街下海營業賺快錢還債（1小時冷卻，扣信用分並公開播報）',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'creditLoan', '信用与借贷'))) return;

    const nowMs = Date.now();
    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const res = ctx.services.creditLoan.sellButt(guildCtx.guildId, interaction.user.id, nowMs);

    if (!res.ok) {
      const stats = ctx.services.creditLoan.getHustleStats(guildCtx.guildId, interaction.user.id);
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '⏳ 体力恢复中',
            [
              `刚下海营业完别太拼命！还需等待 **${formatDurationZh(res.retryAfterSec * 1000)}** 才能再次上街。`,
              '',
              `📈 **个人战绩**：累计营业 **${stats.totalCount}** 次 ｜ 累计创收 ${cfg.economy.currencyEmoji} **${stats.totalEarned.toLocaleString()}** ${cfg.economy.currencyName} ｜ 最高单次 **${stats.bestPayout.toLocaleString()}**`,
            ].join('\n'),
          ),
        ],
        components: [
          buttonRow(
            makeButton('cl:open:hustle_lb', '🏆 卖屁股榜', ButtonStyle.Secondary),
            makeButton('cl:open:loan', '💳 打开借贷面板', ButtonStyle.Primary),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = buildSellButtPublicEmbed(
      res,
      {
        id: interaction.user.id,
        displayName: interaction.user.displayName,
        avatarUrl: interaction.user.displayAvatarURL(),
      },
      cfg.economy.currencyName,
      cfg.economy.currencyEmoji,
      cfg.creditLoan.hustleCooldownSec,
    );

    await interaction.reply({
      embeds: [embed],
      components: [
        buttonRow(
          makeButton('cl:open:hustle_lb', '🏆 卖屁股榜', ButtonStyle.Secondary),
          makeButton('cl:open:loan', '💳 打开借贷面板', ButtonStyle.Primary),
        ),
      ],
    });
  },
};
