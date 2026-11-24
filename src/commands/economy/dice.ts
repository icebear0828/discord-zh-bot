import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { DiceChoice } from '../../services/economyService.js';
import {
  createErrorEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

const CHOICE_LABEL: Record<DiceChoice, string> = {
  big: '大 (11~17)',
  small: '小 (4~10)',
  triple: '豹子 (三同点 10x)',
};

export const diceCommand: CommandDefinition = {
  name: 'dice',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('dice')
      .setDescription('三颗骰子猜大小或豹子')
      .addIntegerOption((opt) =>
        applyZh(
          opt.setName('bet').setDescription('下注金额').setMinValue(1).setRequired(true),
          '下注',
          '下注的星币数量',
        ),
      )
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('choice')
            .setDescription('投注选项')
            .setRequired(true)
            .addChoices(
              { name: '大 (11~17 点，1倍净利)', value: 'big' },
              { name: '小 (4~10 点，1倍净利)', value: 'small' },
              { name: '豹子 (三颗同点，10倍净利)', value: 'triple' },
            ),
          '选项',
          '选择押大、押小或豹子',
        ),
      ),
    '猜大小',
    '三颗骰子猜大小或豹子',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const bet = interaction.options.getInteger('bet', true);
    const choice = interaction.options.getString('choice', true) as DiceChoice;
    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;

    const res = ctx.services.economy.playDice(guildCtx.guildId, interaction.user.id, bet, choice);
    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        invalid_bet: '下注金额无效。',
        insufficient_funds: `你的 ${cfg.currencyName} 不足以支付 **${bet}** 下注。`,
        deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与博弈！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 下注失败', msgMap[res.reason])],
      });
      return;
    }

    const diceText = res.dice.map((d) => `🎲 **${d}**`).join('  ');
    const outcomeText = res.isTriple
      ? `豹子（${res.sum} 点）`
      : `${res.sum} 点（${res.sum >= 11 ? '大' : '小'}）`;

    const embed = res.won
      ? createSuccessEmbed(
          '🎉 猜大小中奖！',
          [
            `你的投注：**${CHOICE_LABEL[choice]}** ｜ 下注：**${bet}**`,
            `开奖结果：${diceText} → **${outcomeText}**`,
            `净赚：${cfg.currencyEmoji} **+${res.netChange}** ${cfg.currencyName} ｜ 当前余额：**${res.balance}**`,
          ].join('\n'),
        )
      : createErrorEmbed(
          '💨 差一点就中了',
          [
            `你的投注：**${CHOICE_LABEL[choice]}** ｜ 下注：**${bet}**`,
            `开奖结果：${diceText} → **${outcomeText}**`,
            `净损：**${res.netChange}** ${cfg.currencyName} ｜ 当前余额：**${res.balance}**`,
          ].join('\n'),
        );

    await interaction.reply({ embeds: [embed] });
  },
};
