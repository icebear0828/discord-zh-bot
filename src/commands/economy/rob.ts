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

export const robCommand: CommandDefinition = {
  name: 'rob',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('rob')
      .setDescription('尝试打劫另一位群友的钱包（失败会赔款）')
      .addUserOption((opt) =>
        applyZh(
          opt.setName('target').setDescription('打劫目标').setRequired(true),
          '目标',
          '要打劫的群友',
        ),
      ),
    '打劫',
    '尝试打劫另一位群友的钱包（失败会赔款）',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const target = interaction.options.getUser('target', true);
    if (target.bot) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法打劫', '机器人没有钱包，换个活人试试吧！')],
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const res = ctx.services.economy.rob(guildCtx.guildId, interaction.user.id, target.id);

    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        self_target: '不能打劫自己！',
        cooldown: `打劫冷却中，请等待 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
        target_shielded: `<@${target.id}> 刚被光顾过，护盾剩余 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
        target_too_poor: `<@${target.id}> 钱包太干净了（不足 100 ${cfg.currencyName}），放过 TA 吧。`,
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 打劫未执行', msgMap[res.reason])],
      });
      return;
    }

    if (res.success) {
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '🥷 打劫得手！',
            [
              `你成功从 <@${target.id}> 兜里顺走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
              `你的余额：**${res.attackerBalance}** ｜ 对方开启了防盗护盾。`,
            ].join('\n'),
          ),
        ],
      });
      return;
    }

    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🚨 打劫翻车被抓现行！',
          [
            `失手了！你向 <@${target.id}> 赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName} 精神损失费。`,
            `你的当前余额：**${res.attackerBalance}** ${cfg.currencyName}`,
          ].join('\n'),
        ),
      ],
    });
  },
};
