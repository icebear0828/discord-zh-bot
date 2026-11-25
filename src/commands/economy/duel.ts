import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { MAX_COIN_AMOUNT } from '../../config/economyConstants.js';
import {
  applyWinnerNicknameRename,
} from '../../interactions/duelArenaHandler.js';
import {
  getDuelArenaService,
  MAX_CUSTOM_WAGER_LEN,
} from '../../services/duelArenaService.js';
import {
  buildRouletteDuelCard,
  buildRpsDuelCard,
} from '../../ui/duelArenaBuilder.js';
import {
  createErrorEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { buildDuelMessage } from '../../ui/menuBuilder.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const duelCommand: CommandDefinition = {
  name: 'duel',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('duel')
      .setDescription('发起石头剪刀布、1v1 俄罗斯轮盘或骰子决斗，及行使改名权')
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('rps')
            .setDescription('发起五局三胜石头剪刀布决斗（胜者获限时改名权）')
            .addUserOption((opt) =>
              applyZh(
                opt.setName('opponent').setDescription('要挑战的群友').setRequired(true),
                '对手',
                '要挑战的群友',
                '對手',
                '要挑戰的群友',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('rename_hours')
                  .setDescription('胜者可给败方改名的时长（默认 24 小时）')
                  .addChoices(
                    { name: '1 小时', value: 1 },
                    { name: '6 小时', value: 6 },
                    { name: '24 小时', value: 24 },
                  ),
                '改名时长',
                '胜者可给败方改名的时长（默认 24 小时）',
                '改名時長',
                '勝者可給敗方改名的時長（預設 24 小時）',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('bet')
                  .setDescription(`可选附加赌注（0 ~ ${MAX_COIN_AMOUNT.toLocaleString()}，默认 0）`)
                  .setMinValue(0)
                  .setMaxValue(MAX_COIN_AMOUNT),
                '赌注',
                `可选附加赌注（0 ~ ${MAX_COIN_AMOUNT.toLocaleString()}，默认 0）`,
                '賭注',
                `可選附加賭注（0 ~ ${MAX_COIN_AMOUNT.toLocaleString()}，預設 0）`,
              ),
            ),
          '石头剪刀布',
          '发起五局三胜石头剪刀布决斗（胜者获限时改名权）',
          '石頭剪刀布',
          '發起五局三勝石頭剪刀布決鬥（勝者獲限時改名權）',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('roulette')
            .setDescription('发起 1v1 俄罗斯轮盘决斗（可自由组合多种赌注）')
            .addUserOption((opt) =>
              applyZh(
                opt.setName('opponent').setDescription('要挑战的群友').setRequired(true),
                '对手',
                '要挑战的群友',
                '對手',
                '要挑戰的群友',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('bullets')
                  .setDescription('6 孔弹巢装入实弹数（默认 1 发）')
                  .addChoices(
                    { name: '1 发实弹', value: 1 },
                    { name: '2 发实弹', value: 2 },
                    { name: '3 发实弹', value: 3 },
                  ),
                '装弹数',
                '6 孔弹巢装入实弹数（默认 1 发）',
                '裝彈數',
                '6 孔彈巢裝入實彈數（預設 1 發）',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('bet')
                  .setDescription(`可选货币赌注（0 ~ ${MAX_COIN_AMOUNT.toLocaleString()}，默认 0）`)
                  .setMinValue(0)
                  .setMaxValue(MAX_COIN_AMOUNT),
                '赌注',
                `可选货币赌注（0 ~ ${MAX_COIN_AMOUNT.toLocaleString()}，默认 0）`,
                '賭注',
                `可選貨幣賭注（0 ~ ${MAX_COIN_AMOUNT.toLocaleString()}，預設 0）`,
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('rename_hours')
                  .setDescription('可选败方被改名时长（默认不赌）')
                  .addChoices(
                    { name: '不赌改名', value: 0 },
                    { name: '1 小时', value: 1 },
                    { name: '6 小时', value: 6 },
                    { name: '24 小时', value: 24 },
                  ),
                '改名时长',
                '可选败方被改名时长（默认不赌）',
                '改名時長',
                '可選敗方被改名時長（預設不賭）',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('timeout_minutes')
                  .setDescription('可选败方被禁言时长（默认不赌）')
                  .addChoices(
                    { name: '不赌禁言', value: 0 },
                    { name: '5 分钟', value: 5 },
                    { name: '10 分钟', value: 10 },
                    { name: '30 分钟', value: 30 },
                  ),
                '禁言时长',
                '可选败方被禁言时长（默认不赌）',
                '禁言時長',
                '可選敗方被禁言時長（預設不賭）',
              ),
            )
            .addStringOption((opt) =>
              applyZh(
                opt
                  .setName('custom_wager')
                  .setDescription(`可选自定义文字赌约（最多 ${MAX_CUSTOM_WAGER_LEN} 字）`)
                  .setMaxLength(MAX_CUSTOM_WAGER_LEN),
                '文字赌约',
                `可选自定义文字赌约（最多 ${MAX_CUSTOM_WAGER_LEN} 字）`,
                '文字賭約',
                `可選自訂文字賭約（最多 ${MAX_CUSTOM_WAGER_LEN} 字）`,
              ),
            ),
          '轮盘赌',
          '发起 1v1 俄罗斯轮盘决斗（可自由组合多种赌注）',
          '輪盤賭',
          '發起 1v1 俄羅斯輪盤決鬥（可自由組合多種賭注）',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('dice')
            .setDescription('发起 3 骰押注决斗')
            .addUserOption((opt) =>
              applyZh(
                opt.setName('opponent').setDescription('要挑战的群友').setRequired(true),
                '对手',
                '要挑战的群友',
                '對手',
                '要挑戰的群友',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('bet')
                  .setDescription(`赌注金额（1 ~ ${MAX_COIN_AMOUNT.toLocaleString()}）`)
                  .setMinValue(1)
                  .setMaxValue(MAX_COIN_AMOUNT)
                  .setRequired(true),
                '赌注',
                `赌注金额（1 ~ ${MAX_COIN_AMOUNT.toLocaleString()}）`,
                '賭注',
                `賭注金額（1 ~ ${MAX_COIN_AMOUNT.toLocaleString()}）`,
              ),
            ),
          '骰子',
          '发起 3 骰押注决斗',
          '骰子',
          '發起 3 骰押注決鬥',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('rename')
            .setDescription('有效期内行使决斗胜者权利修改败方昵称')
            .addUserOption((opt) =>
              applyZh(
                opt.setName('target').setDescription('要修改昵称的败方群友').setRequired(true),
                '目标',
                '要修改昵称的败方群友',
                '目標',
                '要修改暱稱的敗方群友',
              ),
            )
            .addStringOption((opt) =>
              applyZh(
                opt
                  .setName('nickname')
                  .setDescription('新的服务器昵称（1 ~ 32 个字符）')
                  .setMinLength(1)
                  .setMaxLength(32)
                  .setRequired(true),
                '新昵称',
                '新的服务器昵称（1 ~ 32 个字符）',
                '新暱稱',
                '新的伺服器暱稱（1 ~ 32 個字元）',
              ),
            ),
          '改名',
          '有效期内行使决斗胜者权利修改败方昵称',
          '改名',
          '有效期內行使決鬥勝者權利修改敗方暱稱',
        ),
      ),
    '决斗',
    '发起石头剪刀布、1v1 俄罗斯轮盘或骰子决斗，及行使改名权',
    '決鬥',
    '發起石頭剪刀布、1v1 俄羅斯輪盤或骰子決鬥，及行使改名權',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;

    const sub = interaction.options.getSubcommand(true);
    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;

    if (sub === 'rename') {
      const target = interaction.options.getUser('target', true);
      const nickname = interaction.options.getString('nickname', true);
      const res = await applyWinnerNicknameRename({
        ctx,
        guild: interaction.guild,
        guildId: guildCtx.guildId,
        winnerId: interaction.user.id,
        winnerName: interaction.user.displayName,
        targetId: target.id,
        rawNickname: nickname,
      });
      if (!res.ok) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 改名失败', res.privateText)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (res.publicText && interaction.channel?.isSendable()) {
        await interaction.channel
          .send({
            allowedMentions: { users: [interaction.user.id, target.id] },
            content: res.publicText,
          })
          .catch(() => undefined);
      }
      await interaction.reply({
        embeds: [createSuccessEmbed('🎭 改名成功', res.privateText)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const opponent = interaction.options.getUser('opponent', true);
    if (opponent.bot) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无效对手', '不能向机器人发起决斗，请选择一位真实群友！')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (opponent.id === interaction.user.id) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 无效对手', '不能向自己发起决斗！')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'dice') {
      if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;
      const bet = interaction.options.getInteger('bet', true);
      const res = ctx.services.multiplayer.createDuel(
        guildCtx.guildId,
        interaction.channelId,
        interaction.user.id,
        opponent.id,
        bet,
      );
      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          self_target: '不能向自己发起决斗！',
          invalid_bet: `赌注必须在 1 ~ ${MAX_COIN_AMOUNT.toLocaleString()} 之间。`,
          insufficient_funds: `你的口袋现金不足以支付 **${bet}** ${cfg.currencyName} 赌注。`,
          deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清欠款前禁止参与带赌注决斗！',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 发起失败', msgMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const reply = await interaction.reply({
        allowedMentions: { users: [opponent.id] },
        content: `⚔️ <@${opponent.id}>，你收到了一条骰子决斗挑战！`,
        ...buildDuelMessage(res.duel, cfg),
        withResponse: true,
      });
      const msgId = reply.resource?.message?.id;
      if (msgId) {
        ctx.services.multiplayer.bindDuelMessage(res.duel.id, msgId);
      }
      return;
    }

    if (!(await requireModuleEnabled(interaction, ctx, 'socialGames', '整蛊与博弈'))) return;
    const arena = getDuelArenaService(ctx);

    if (sub === 'rps') {
      const renameHours = interaction.options.getInteger('rename_hours') ?? 24;
      const bet = interaction.options.getInteger('bet') ?? 0;
      if (bet > 0 && !(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

      const res = arena.createRpsDuel({
        guildId: guildCtx.guildId,
        channelId: interaction.channelId,
        challengerId: interaction.user.id,
        opponentId: opponent.id,
        renameHours,
        bet,
      });
      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          self_target: '不能向自己发起决斗！',
          invalid_bet: `附加赌注必须在 0 ~ ${MAX_COIN_AMOUNT.toLocaleString()} 之间。`,
          invalid_rename_hours: '改名时长仅支持 1 / 6 / 24 小时。',
          insufficient_funds: `你的口袋现金不足以支付 **${bet}** ${cfg.currencyName} 赌注。`,
          deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清欠款前禁止发起带赌注决斗！',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 发起失败', msgMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const reply = await interaction.reply({
        allowedMentions: { users: [opponent.id] },
        content: `✊✌️🖐️ <@${opponent.id}>，你收到了一条石头剪刀布 Bo5 决斗挑战！`,
        ...buildRpsDuelCard(res.duel, cfg),
        withResponse: true,
      });
      const msgId = reply.resource?.message?.id;
      if (msgId) {
        arena.bindRpsMessage(res.duel.id, msgId);
      }
      return;
    }

    if (sub === 'roulette') {
      const bullets = interaction.options.getInteger('bullets') ?? 1;
      const bet = interaction.options.getInteger('bet') ?? 0;
      const renameHours = interaction.options.getInteger('rename_hours') ?? 0;
      const timeoutMinutes = interaction.options.getInteger('timeout_minutes') ?? 0;
      const customWager = interaction.options.getString('custom_wager') ?? '';

      if (bet > 0 && !(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

      const res = arena.createRouletteDuel({
        guildId: guildCtx.guildId,
        channelId: interaction.channelId,
        challengerId: interaction.user.id,
        opponentId: opponent.id,
        bullets,
        bet,
        renameHours,
        timeoutMinutes,
        customWager,
      });
      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          self_target: '不能向自己发起 1v1 俄罗斯轮盘！',
          invalid_bullets: '实弹数必须为 1~3 发。',
          invalid_bet: `赌注必须在 0 ~ ${MAX_COIN_AMOUNT.toLocaleString()} 之间。`,
          invalid_rename_hours: '改名时长仅支持 0/1/6/24 小时。',
          invalid_timeout_minutes: '禁言时长仅支持 0/5/10/30 分钟。',
          invalid_custom_wager: `文字赌约不得超过 ${MAX_CUSTOM_WAGER_LEN} 字。`,
          no_stake: '请至少选择一项赌注（黑吊币、改名时长、禁言时长或文字赌约）！',
          insufficient_funds: `你的口袋现金不足以支付 **${bet}** ${cfg.currencyName} 赌注。`,
          deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清欠款前禁止发起带赌注轮盘！',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 发起失败', msgMap[res.reason])],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const reply = await interaction.reply({
        allowedMentions: { users: [opponent.id] },
        content: `🔫 <@${opponent.id}>，你收到了一条 1v1 俄罗斯轮盘生死赌局挑战！`,
        ...buildRouletteDuelCard(res.duel, cfg),
        withResponse: true,
      });
      const msgId = reply.resource?.message?.id;
      if (msgId) {
        arena.bindRouletteDuelMessage(res.duel.id, msgId);
      }
    }
  },
};
