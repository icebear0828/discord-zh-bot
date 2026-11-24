import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { InteractionAction } from '../../services/funService.js';
import {
  COLORS,
  createErrorEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const interactCommand: CommandDefinition = {
  name: 'interact',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('interact')
      .setDescription('对群友发起趣味互动（摸头/抱抱/贴贴/戳一戳/投喂/丢雪球）')
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('action')
            .setDescription('互动动作')
            .setRequired(true)
            .addChoices(
              { name: '🫂 摸头', value: 'pat' },
              { name: '🤗 抱抱', value: 'hug' },
              { name: '🥰 贴贴', value: 'cuddle' },
              { name: '👉 戳一戳', value: 'poke' },
              { name: '🍰 投喂', value: 'feed' },
              { name: '❄️ 丢雪球', value: 'snowball' },
            ),
          '动作',
          '选择互动方式',
        ),
      )
      .addUserOption((opt) =>
        applyZh(opt.setName('target').setDescription('互动对象').setRequired(true), '对象', '要互动的群友'),
      ),
    '互动',
    '对群友发起趣味互动（摸头/抱抱/贴贴/戳一戳/投喂/丢雪球）',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'fun', '娱乐互动'))) return;

    const action = interaction.options.getString('action', true) as InteractionAction;
    const target = interaction.options.getUser('target', true);

    if (target.id === interaction.user.id) {
      await interaction.reply({
        embeds: [createErrorEmbed('😅 换个人吧', '虽然自爱很好，但还是找一位群友互动吧~')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const res = ctx.services.fun.performInteraction(
      guildCtx.guildId,
      interaction.user.id,
      target.id,
      action,
    );

    const embed = new EmbedBuilder()
      .setColor(COLORS.FUN)
      .setDescription(
        `${res.emoji} <@${interaction.user.id}> ${res.verbPhrase} <@${target.id}>！\n*（你们之间的「${res.label}」累计已达 **${res.count}** 次）*`,
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
