import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  buildCreditInspectEmbed,
  buildCreditView,
} from '../../ui/creditLoanMenuBuilder.js';
import type { AppContext, CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  checkMemberIsBotAdmin,
  requireGuildMember,
  requireModuleEnabled,
} from '../guards.js';

export const creditCommand: CommandDefinition = {
  name: '信用',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('信用')
      .setDescription('查看自己或群友的信用分档案、等级权益与近期信用记录')
      .addUserOption((opt) =>
        applyZh(
          opt
            .setName('成员')
            .setDescription('要查验信用档案的群友（留空则打开自己的互动信用面板）'),
          '成员',
          '要查验信用档案的群友（留空则打开自己的互动信用面板）',
          '成員',
          '要查驗信用檔案的群友（留空則開啟自己的互動信用面板）',
        ),
      ),
    '信用',
    '查看自己或群友的信用分档案、等级权益与近期信用记录',
    '信用',
    '查看自己或群友的信用分檔案、等級權益與近期信用記錄',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'creditLoan', '信用与借贷'))) return;

    const target = interaction.options.getUser('成员');
    if (target && target.id !== interaction.user.id) {
      const embed = buildCreditInspectEmbed(ctx, guildCtx.guildId, {
        id: target.id,
        displayName: target.displayName,
        avatarUrl: target.displayAvatarURL(),
      });
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const isAdmin = checkMemberIsBotAdmin(guildCtx.member, cfg);
    const msg = buildCreditView(ctx, guildCtx.guildId, {
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
