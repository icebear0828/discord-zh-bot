import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  createErrorEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const payCommand: CommandDefinition = {
  name: 'pay',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('pay')
      .setDescription('向指定群友转账星币')
      .addUserOption((opt) =>
        applyZh(opt.setName('user').setDescription('收款人').setRequired(true), '用户', '收款成员'),
      )
      .addIntegerOption((opt) =>
        applyZh(
          opt.setName('amount').setDescription('转账金额').setMinValue(1).setRequired(true),
          '金额',
          '要转出的星币数量',
        ),
      ),
    '转账',
    '向指定群友转账星币',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const receiver = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    if (receiver.bot) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 转账失败', '不能向机器人转账。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const res = ctx.services.economy.transferCoins(
      guildCtx.guildId,
      interaction.user.id,
      receiver.id,
      amount,
    );

    if (!res.ok) {
      const reasonMap: Record<typeof res.reason, string> = {
        self_target: '不能给自己转账。',
        invalid_amount: '转账金额必须大于 0。',
        insufficient_funds: `余额不足！无法转出 **${amount}** ${cfg.currencyName}。`,
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 转账失败', reasonMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '💸 转账成功',
          [
            `<@${interaction.user.id}> 向 <@${receiver.id}> 转出了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}。`,
            `你的剩余余额：**${res.fromBalance}** ${cfg.currencyName}`,
          ].join('\n'),
        ),
      ],
      allowedMentions: { users: [receiver.id] },
    });
  },
};
