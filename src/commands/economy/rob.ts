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
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;

    if (mode === 'bank') {
      const bankRes = ctx.services.economy.robBank(guildCtx.guildId, interaction.user.id, target.id);
      if (!bankRes.ok) {
        const msgMap: Record<typeof bankRes.reason, string> = {
          self_target: '不能抢自己的银行金库！',
          cooldown: `打劫冷却中，请等待 **${formatDurationZh((bankRes.retryAfterSec ?? 0) * 1000)}**。`,
          target_shielded: `<@${target.id}> 刚被光顾过，护盾剩余 **${formatDurationZh((bankRes.retryAfterSec ?? 0) * 1000)}**。`,
          target_bank_too_poor: `<@${target.id}> 银行金库存款不足 100 ${cfg.currencyName}，不值得动手。`,
          attacker_too_poor: `你的总资产（现金+银行）不足 **100** ${cfg.currencyName}，不够支付劫金库翻车保底罚金！`,
        };
        await interaction.reply({
          allowedMentions: { parse: [] },
          embeds: [createErrorEmbed('❌ 劫金库未执行', msgMap[bankRes.reason])],
        });
        return;
      }

      if (bankRes.success) {
        await interaction.reply({
          allowedMentions: { parse: [] },
          embeds: [
            createSuccessEmbed(
              '🏦 银行金库劫案得手！',
              [
                `你突破安保从 <@${target.id}> 的银行金库撬走了 ${cfg.currencyEmoji} **${bankRes.amount}** ${cfg.currencyName}！`,
                `你的现金：**${bankRes.attackerBalance}**（银行 **${bankRes.attackerBankBalance}**）｜ 对方金库已触发最高护盾。`,
              ].join('\n'),
            ),
          ],
        });
        return;
      }

      const fineDetail =
        (bankRes.fineFromBank ?? 0) > 0
          ? `（扣口袋现金 **${bankRes.fineFromPocket ?? 0}** + 划扣银行存款 **${bankRes.fineFromBank ?? 0}**）`
          : '';
      await interaction.reply({
        allowedMentions: { parse: [] },
        embeds: [
          createErrorEmbed(
            bankRes.trapped ? '🪤 金库捕兽夹重创劫匪！' : '🚨 抢银行金库翻车被捕！',
            [
              `潜入金库失手！你向 <@${target.id}> 重罚赔偿了 ${cfg.currencyEmoji} **${bankRes.amount}** ${cfg.currencyName}${fineDetail}。`,
              `你的当前现金：**${bankRes.attackerBalance}**（银行 **${bankRes.attackerBankBalance}**）`,
            ].join('\n'),
          ),
        ],
      });
      return;
    }

    const res = ctx.services.economy.rob(guildCtx.guildId, interaction.user.id, target.id);

    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        self_target: '不能打劫自己！',
        cooldown: `打劫冷却中，请等待 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
        target_shielded: `<@${target.id}> 刚被光顾过，护盾剩余 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
        target_too_poor: `<@${target.id}> 钱包太干净了（不足 100 ${cfg.currencyName}），放过 TA 吧。`,
      };
      await interaction.reply({
        allowedMentions: { parse: [] },
        embeds: [createErrorEmbed('❌ 打劫未执行', msgMap[res.reason])],
      });
      return;
    }

    if (res.success) {
      await interaction.reply({
        allowedMentions: { parse: [] },
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
      allowedMentions: { parse: [] },
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
