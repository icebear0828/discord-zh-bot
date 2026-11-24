import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireBotAdmin, requireGuildMember, requireModuleEnabled } from '../guards.js';

export const titleCommand: CommandDefinition = {
  name: 'title',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('title')
      .setDescription('查看、佩戴、卸下或授予专属头衔称号')
      .addSubcommand((sub) =>
        applyZh(sub.setName('list').setDescription('查看我已解锁的全部称号'), '列表', '查看我已解锁的全部称号'),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('equip')
            .setDescription('佩戴指定称号')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('称号文本').setRequired(true), '名称', '要佩戴的称号'),
            ),
          '佩戴',
          '佩戴指定称号',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(sub.setName('clear').setDescription('卸下当前佩戴的称号'), '卸下', '卸下当前佩戴的称号'),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('grant')
            .setDescription('【管理】直接授予指定成员一个专属称号')
            .addUserOption((opt) =>
              applyZh(opt.setName('user').setDescription('目标成员').setRequired(true), '用户', '接收称号的成员'),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('称号文本').setMaxLength(20).setRequired(true), '名称', '称号文字'),
            ),
          '授予',
          '授予指定成员一个专属称号',
        ),
      ),
    '称号',
    '查看、佩戴、卸下或授予专属头衔称号',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'grant') {
      const adminCtx = await requireBotAdmin(interaction, ctx);
      if (!adminCtx) return;

      const user = interaction.options.getUser('user', true);
      if (user.bot) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 无法授予', '不能给机器人授予专属称号，请选择真实群友。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const name = interaction.options.getString('name', true);
      const { created } = ctx.services.fun.grantTitle(adminCtx.guildId, user.id, name);
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            created ? '✅ 称号授予成功' : 'ℹ️ 成员已拥有该称号',
            `已为 <@${user.id}> 添加称号 **「${name}」**。`,
          ),
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (!(await requireModuleEnabled(interaction, ctx, 'fun', '娱乐互动'))) return;

    if (sub === 'list') {
      const profile = ctx.repos.profile.getOrCreate(guildCtx.guildId, interaction.user.id);
      const titles = ctx.services.fun.listTitles(guildCtx.guildId, interaction.user.id);
      const desc =
        titles.length > 0
          ? titles
              .map((t) => `• 「${t}」${profile.equippedTitle === t ? ' **(当前佩戴)**' : ''}`)
              .join('\n')
          : '你还没有解锁任何称号，可以去 `/商店 列表` 看看或等管理员授予！';
      await interaction.reply({
        embeds: [createInfoEmbed('🏷️ 我的专属称号', desc)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'equip') {
      const name = interaction.options.getString('name', true);
      const res = ctx.services.fun.equipTitle(guildCtx.guildId, interaction.user.id, name);
      if (!res.ok) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 未拥有该称号', `你还没有解锁「${name}」，请先用 \`/称号 列表\` 查看。`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [createSuccessEmbed('✅ 称号已佩戴', `你的名片与排行榜已展示称号 **「${res.title}」**！`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'clear') {
      ctx.services.fun.clearTitle(guildCtx.guildId, interaction.user.id);
      await interaction.reply({
        embeds: [createSuccessEmbed('✅ 已卸下称号', '已清除当前佩戴的展示称号。')],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
