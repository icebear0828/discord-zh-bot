import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import type { GiveawayRecord } from '../../db/repositories/giveawayRepo.js';
import { parseDurationMs } from '../../services/giveawayService.js';
import {
  COLORS,
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireBotAdmin, requireModuleEnabled } from '../guards.js';

export function buildGiveawayMessage(
  gw: GiveawayRecord,
  entryCount: number,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const endUnix = Math.floor(gw.endsAt / 1000);
  const requirements: string[] = [];
  if (gw.minLevel > 0) requirements.push(`最低等级 **Lv.${gw.minLevel}**`);
  if (gw.requiredRoleId) requirements.push(`需持有身份组 <@&${gw.requiredRoleId}>`);
  const reqLine = requirements.length > 0 ? requirements.join(' ｜ ') : '无门槛，全员可参与';

  if (gw.ended) {
    const winnerMentions =
      gw.winners.length > 0
        ? gw.winners.map((id) => `<@${id}>`).join('、')
        : '无人参与，本次流拍';

    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`🎉 抽奖已开奖：${gw.prize}`)
      .setDescription(
        [
          `🏆 中奖者：${winnerMentions}`,
          `🎁 中奖名额：**${gw.winnerCount}** 人 ｜ 有效参与：**${entryCount}** 人`,
          `👤 发起人：<@${gw.hostId}>`,
        ].join('\n'),
      )
      .setFooter({ text: `抽奖编号 #${gw.id}` })
      .setTimestamp(gw.endsAt);

    return { embeds: [embed], components: [] };
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`🎁 抽奖进行中：${gw.prize}`)
    .setDescription(
      [
        `点击下方 **🎉 参与抽奖** 按钮即可报名（再点一次可取消）。`,
        `\n⏰ 开奖时间：<t:${endUnix}:R>（<t:${endUnix}:f>）`,
        `🏆 中奖名额：**${gw.winnerCount}** 人 ｜ 当前参与：**${entryCount}** 人`,
        `📌 参与门槛：${reqLine}`,
        `👤 发起人：<@${gw.hostId}>`,
      ].join('\n'),
    )
    .setFooter({ text: `抽奖编号 #${gw.id}` })
    .setTimestamp(gw.endsAt);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:join:${gw.id}`)
      .setLabel(`参与抽奖 (${entryCount})`)
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

export const giveawayCommand: CommandDefinition = {
  name: 'giveaway',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('发起、提前开奖、重抽或查看抽奖活动')
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('start')
            .setDescription('在指定频道发起一次抽奖')
            .addStringOption((opt) =>
              applyZh(opt.setName('prize').setDescription('奖品名称').setRequired(true), '奖品', '奖品描述'),
            )
            .addStringOption((opt) =>
              applyZh(
                opt.setName('duration').setDescription('持续时长（如 10m、2h、3d、30分钟）').setRequired(true),
                '时长',
                '例如 10m、2h、1d 或 30分钟',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('winners').setDescription('中奖人数').setMinValue(1).setMaxValue(20).setRequired(true),
                '中奖人数',
                '抽取的中奖人数',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('min-level').setDescription('最低等级门槛（默认 0）').setMinValue(0).setMaxValue(200),
                '最低等级',
                '参与所需最低等级',
              ),
            )
            .addRoleOption((opt) =>
              applyZh(opt.setName('required-role').setDescription('限制必须拥有的身份组'), '限定身份组', '参与所需的身份组'),
            )
            .addChannelOption((opt) =>
              applyZh(
                opt
                  .setName('channel')
                  .setDescription('发布频道（默认当前频道）')
                  .addChannelTypes(ChannelType.GuildText),
                '频道',
                '发送抽奖面板的频道',
              ),
            ),
          '发起',
          '在指定频道发起一次抽奖',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('end')
            .setDescription('提前结束抽奖并立刻开奖')
            .addIntegerOption((opt) =>
              applyZh(opt.setName('id').setDescription('抽奖编号').setMinValue(1).setRequired(true), '编号', '抽奖 ID'),
            ),
          '开奖',
          '提前结束抽奖并立刻开奖',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('reroll')
            .setDescription('对已结束的抽奖重新抽取中奖者')
            .addIntegerOption((opt) =>
              applyZh(opt.setName('id').setDescription('抽奖编号').setMinValue(1).setRequired(true), '编号', '抽奖 ID'),
            ),
          '重抽',
          '对已结束的抽奖重新抽取中奖者',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(sub.setName('list').setDescription('查看当前进行中的抽奖列表'), '列表', '查看当前进行中的抽奖列表'),
      ),
    '抽奖',
    '发起、提前开奖、重抽或查看抽奖活动',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const adminCtx = await requireBotAdmin(interaction, ctx);
    if (!adminCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'giveaways', '抽奖系统'))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const active = ctx.services.giveaway.listActive(adminCtx.guildId);
      if (active.length === 0) {
        await interaction.reply({
          embeds: [createInfoEmbed('🎁 进行中的抽奖', '当前没有正在进行的抽奖活动。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const lines = active.map(
        (gw) =>
          `• **#${gw.id}** **${gw.prize}**（${gw.winnerCount} 名）— <t:${Math.floor(gw.endsAt / 1000)}:R> 开奖 · <#${gw.channelId}>`,
      );
      await interaction.reply({
        embeds: [createInfoEmbed('🎁 进行中的抽奖', lines.join('\n'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'start') {
      const prize = interaction.options.getString('prize', true);
      const durationRaw = interaction.options.getString('duration', true);
      const winners = interaction.options.getInteger('winners', true);
      const minLevel = interaction.options.getInteger('min-level') ?? 0;
      const requiredRole = interaction.options.getRole('required-role');
      const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;

      if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 无法发布', '请选择一个文字频道发布抽奖。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const durationMs = parseDurationMs(durationRaw);
      if (!durationMs) {
        await interaction.reply({
          embeds: [
            createErrorEmbed(
              '❌ 时长格式无效',
              '支持 `10s`~`30d` 之间格式，例如 `30m`、`2h`、`1d12h`、`15分钟`、`2天`。',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const endsAt = Date.now() + durationMs;
      const placeholderMsg = await (targetChannel as TextChannel).send({
        embeds: [createInfoEmbed('🎁 正在初始化抽奖...', `奖品：${prize}`)],
      });

      const gw = ctx.services.giveaway.createGiveaway({
        guildId: adminCtx.guildId,
        channelId: targetChannel.id,
        messageId: placeholderMsg.id,
        hostId: interaction.user.id,
        prize,
        winnerCount: winners,
        minLevel,
        requiredRoleId: requiredRole ? requiredRole.id : null,
        endsAt,
      });

      await placeholderMsg.edit(buildGiveawayMessage(gw, 0));
      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 抽奖已发起', `抽奖 **#${gw.id}** 已发布到 <#${targetChannel.id}>。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'end' || sub === 'reroll') {
      const id = interaction.options.getInteger('id', true);
      const existing = ctx.services.giveaway.getById(id);
      if (!existing || existing.guildId !== adminCtx.guildId) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 未找到抽奖', `不存在编号为 **#${id}** 的抽奖。`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const updated =
        sub === 'end'
          ? ctx.services.giveaway.finalizeGiveaway(id)
          : ctx.services.giveaway.rerollGiveaway(id);
      if (!updated) return;

      const entryCount = ctx.services.giveaway.countEntries(updated.id);
      const ch = interaction.guild?.channels.cache.get(updated.channelId);
      if (ch && ch.type === ChannelType.GuildText) {
        const msg = await ch.messages.fetch(updated.messageId).catch(() => null);
        if (msg) {
          await msg.edit(buildGiveawayMessage(updated, entryCount)).catch(() => undefined);
        }
        const announceText =
          updated.winners.length > 0
            ? `🎉 恭喜 ${updated.winners.map((w) => `<@${w}>`).join('、')} 在抽奖 **#${updated.id}「${updated.prize}」** 中获奖！`
            : `抽奖 **#${updated.id}「${updated.prize}」** 已结束，因无人参与流拍。`;
        await ch.send(announceText).catch(() => undefined);
      }

      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            sub === 'end' ? '✅ 抽奖已提前开奖' : '✅ 已重新抽取获奖者',
            updated.winners.length > 0
              ? `本次中奖者：${updated.winners.map((w) => `<@${w}>`).join('、')}`
              : '没有符合条件的参与者。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
