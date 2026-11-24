import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  createErrorEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  buildRobTargetHints,
  formatBankRobError,
  formatBankRobResultEmbed,
  formatPocketRobError,
  formatPocketRobResultEmbed,
} from '../../ui/soloFormatters.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const robCommand: CommandDefinition = {
  name: 'rob',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('rob')
      .setDescription('尝试打劫另一位群友的钱包或强抢银行金库（失败会赔款）')
      .addUserOption((opt) =>
        applyZh(
          opt.setName('target').setDescription('打劫目标').setRequired(true),
          '目标',
          '要打劫的群友',
        ),
      )
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('mode')
            .setDescription('打劫类型：口袋现金（默认）或银行金库（低成功率高风险）')
            .setRequired(false)
            .addChoices(
              { name: '🥷 口袋现金 (默认)', value: 'pocket' },
              { name: '🏦 银行金库 (低概率·高赔款)', value: 'bank' },
            ),
          '类型',
          '选择偷口袋现金还是强抢银行金库',
        ),
      ),
    '打劫',
    '尝试打劫另一位群友的钱包或强抢银行金库（失败会赔款）',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const target = interaction.options.getUser('target', true);
    const mode = interaction.options.getString('mode', false) ?? 'pocket';
    if (target.bot) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法打劫', '机器人没有钱包或银行金库，换个活人试试吧！')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const targetMember = interaction.guild?.members?.cache?.get(target.id);
    const targetHints = buildRobTargetHints(target, targetMember);

    if (mode === 'bank') {
      const bankRes = ctx.services.economy.robBank(
        guildCtx.guildId,
        interaction.user.id,
        target.id,
        Date.now(),
        Math.random,
        targetHints,
      );
      if (!bankRes.ok) {
        await interaction.reply({
          allowedMentions: { parse: [] },
          embeds: [
            createErrorEmbed(
              '❌ 劫金库未执行',
              formatBankRobError(bankRes.reason, target.id, cfg, bankRes.retryAfterSec),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        allowedMentions: { parse: [] },
        embeds: [formatBankRobResultEmbed(bankRes, target.id, cfg)],
      });
      return;
    }

    const res = ctx.services.economy.rob(
      guildCtx.guildId,
      interaction.user.id,
      target.id,
      Date.now(),
      Math.random,
      targetHints,
    );

    if (!res.ok) {
      await interaction.reply({
        allowedMentions: { parse: [] },
        embeds: [
          createErrorEmbed(
            '❌ 打劫未执行',
            formatPocketRobError(res.reason, target.id, cfg, res.retryAfterSec),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      allowedMentions: { parse: [] },
      embeds: [formatPocketRobResultEmbed(res, target.id, cfg)],
    });
  },
};
