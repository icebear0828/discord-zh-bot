import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { MAX_SOLO_GAMBLE_BET } from '../../config/economyConstants.js';
import {
  createErrorEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  sendChannelPublicNotice,
  truncateDescriptionLines,
} from '../../ui/soloFormatters.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

interface ExampleActionOutcome {
  ok: true;
  lines: string[];
  highlightText?: string;
}

interface ExampleActionFailure {
  ok: false;
  reason: 'insufficient_funds' | 'bet_too_large' | 'invalid_amount';
}

type ExampleActionResult = ExampleActionOutcome | ExampleActionFailure;

function runExampleDomainAction(
  amount: number,
  currencyName: string,
  currencyEmoji: string,
): ExampleActionResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }
  if (amount > MAX_SOLO_GAMBLE_BET) {
    return { ok: false, reason: 'bet_too_large' };
  }
  return {
    ok: true,
    lines: [
      `Executed action with ${currencyEmoji} **${amount}** ${currencyName}.`,
      'Replace this placeholder with a real ctx.services.<domain> call.',
    ],
  };
}

export const exampleCommand: CommandDefinition = {
  name: 'example',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('example')
      .setDescription('模板示例指令：替换为具体业务描述')
      .addUserOption((opt) =>
        applyZh(
          opt.setName('target').setDescription('目标成员（可选）').setRequired(false),
          '目标',
          '要操作的目标成员',
        ),
      )
      .addIntegerOption((opt) =>
        applyZh(
          opt
            .setName('amount')
            .setDescription('操作数量')
            .setMinValue(1)
            .setMaxValue(MAX_SOLO_GAMBLE_BET)
            .setRequired(true),
          '数量',
          '请输入大于 0 的整数',
        ),
      ),
    '示例指令',
    '模板示例指令：替换为具体业务描述',
  ),

  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    // 1. Guild & module guards (always Ephemeral on failure)
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    // 2. Reject bot targets before mutating state
    const target = interaction.options.getUser('target', false);
    if (target?.bot) {
      await interaction.reply({
        embeds: [createErrorEmbed('操作受限', '无法对机器人账号执行该操作，请选择真实成员。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 3. Read dynamic guild economy config (never hardcode currency names)
    const econCfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const amount = interaction.options.getInteger('amount', true);

    // 4. Execute domain service logic
    const res = runExampleDomainAction(amount, econCfg.currencyName, econCfg.currencyEmoji);
    if (!res.ok) {
      const errorMap: Record<ExampleActionFailure['reason'], string> = {
        insufficient_funds: `你的 ${econCfg.currencyName} 余额不足。`,
        bet_too_large: `单次上限为 **${MAX_SOLO_GAMBLE_BET.toLocaleString()}** ${econCfg.currencyName}。`,
        invalid_amount: '请输入有效的正整数金额。',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('操作未执行', errorMap[res.reason])],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 5. Safe 4096-char description truncation + Ephemeral solo response
    const description = truncateDescriptionLines(res.lines, '\n', '', 4096);
    await interaction.reply({
      embeds: [createSuccessEmbed('操作完成', description)],
      flags: MessageFlags.Ephemeral,
    });

    // 6. Optional public highlight notice with safe allowedMentions
    if (res.highlightText) {
      await sendChannelPublicNotice(interaction, {
        allowedMentions: { parse: [] },
        embeds: [createSuccessEmbed('频道高光播报', res.highlightText)],
      });
    }
  },
};
