import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  evaluateHand,
  formatHand,
  type BlackjackGame,
} from '../../services/blackjackService.js';
import {
  COLORS,
  createErrorEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export function buildBlackjackMessage(
  game: BlackjackGame,
  balance: number,
  currencyName: string,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const playerEval = evaluateHand(game.playerHand);
  const dealerEval = evaluateHand(game.dealerHand);
  const finished = game.status !== 'playing';

  const dealerLine = finished
    ? `${formatHand(game.dealerHand)}（总计 **${dealerEval.total}** 点）`
    : `\`${game.dealerHand[0]!.suit}${game.dealerHand[0]!.rank}\` \`🂠\``;

  const statusTextMap: Record<BlackjackGame['status'], string> = {
    playing: '请选择你的操作：要牌、停牌或双倍下注。',
    player_blackjack: `🎉 天胡 Blackjack！赢得 **${game.payout}** ${currencyName}！`,
    player_bust: '💥 爆牌了（超过 21 点），庄家获胜。',
    dealer_bust: `🎉 庄家爆牌！赢得 **${game.payout}** ${currencyName}！`,
    player_win: `🎉 你的点数更大！赢得 **${game.payout}** ${currencyName}！`,
    dealer_win: '😔 庄家点数更大，本局失利。',
    push: `🤝 平局！退回下注 **${game.payout}** ${currencyName}。`,
  };

  const color = !finished
    ? COLORS.PRIMARY
    : game.payout > game.bet
      ? COLORS.SUCCESS
      : game.payout === game.bet
        ? COLORS.WARNING
        : COLORS.ERROR;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🃏 二十一点 (Blackjack)')
    .setDescription(statusTextMap[game.status])
    .addFields(
      {
        name: '🧑 你的手牌',
        value: `${formatHand(game.playerHand)}（总计 **${playerEval.total}** 点）`,
      },
      {
        name: '🎩 庄家手牌',
        value: dealerLine,
      },
      {
        name: '🪙 下注 / 余额',
        value: `本局下注：**${game.bet}** ｜ 当前余额：**${balance}** ${currencyName}`,
      },
    )
    .setTimestamp();

  if (finished) {
    return { embeds: [embed], components: [] };
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj:hit:${game.userId}`)
      .setLabel('要牌 (Hit)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`bj:stand:${game.userId}`)
      .setLabel('停牌 (Stand)')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bj:double:${game.userId}`)
      .setLabel('双倍下注 (Double)')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!game.canDouble || game.playerHand.length !== 2),
  );

  return { embeds: [embed], components: [row] };
}

export const blackjackCommand: CommandDefinition = {
  name: 'blackjack',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('blackjack')
      .setDescription('开始一局互动二十一点扑克')
      .addIntegerOption((opt) =>
        applyZh(
          opt.setName('bet').setDescription('下注金额').setMinValue(1).setRequired(true),
          '下注',
          '下注的星币数量',
        ),
      ),
    '二十一点',
    '开始一局互动二十一点扑克',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const bet = interaction.options.getInteger('bet', true);
    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;
    const res = ctx.services.blackjack.startGame(guildCtx.guildId, interaction.user.id, bet);

    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        invalid_bet: '下注金额必须大于 0。',
        insufficient_funds: `余额不足，无法下注 **${bet}** ${cfg.currencyName}。`,
        game_already_active: '你还有一局未结束的二十一点，请先完成当前对局！',
        no_active_game: '当前没有进行中的对局。',
        cannot_double: '当前无法双倍下注。',
        deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与博弈！',
      };
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无法开局', msgMap[res.reason])],
      });
      return;
    }

    await interaction.reply(buildBlackjackMessage(res.game, res.balance, cfg.currencyName));
  },
};
