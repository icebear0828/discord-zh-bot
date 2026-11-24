import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { buildLoanView } from '../../ui/creditLoanMenuBuilder.js';
import type { AppContext, CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  checkMemberIsBotAdmin,
  requireGuildMember,
  requireModuleEnabled,
} from '../guards.js';

export const loanCommand: CommandDefinition = {
  name: '贷款',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('贷款')
      .setDescription('打开银行信用贷与黑市高利贷借贷中心'),
    '贷款',
    '打开银行信用贷与黑市高利贷借贷中心',
    '貸款',
    '開啟銀行信用貸與黑市高利貸借貸中心',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'creditLoan', '信用与借贷'))) return;

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const isAdmin = checkMemberIsBotAdmin(guildCtx.member, cfg);
    const msg = buildLoanView(ctx, guildCtx.guildId, {
      id: interaction.user.id,
      displayName: interaction.user.displayName,
      avatarUrl: interaction.user.displayAvatarURL(),
      isAdmin,
      roleIds: [...guildCtx.member.roles.cache.keys()],
    });

    await interaction.reply({
      ...msg,
      flags: MessageFlags.Ephemeral,
    });
  },
};
