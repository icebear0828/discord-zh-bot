import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { createErrorEmbed, createSuccessEmbed, type AppContext, type CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { buildLobbyMessage, buildMenuMessage } from '../../ui/menuBuilder.js';
import { checkMemberIsBotAdmin, requireBotAdmin, requireGuildMember } from '../guards.js';

export const menuCommand: CommandDefinition = {
  name: 'menu',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('menu')
      .setDescription('打开全功能互动控制面板（游戏、银行、红包、决斗、商店与排行）')
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('mode')
            .setDescription('面板打开模式（默认为个人互动面板）')
            .setRequired(false)
            .addChoices(
              { name: '个人互动面板（默认）', value: 'personal' },
              { name: '发送频道永久大厅入口（仅管理员）', value: 'lobby' },
            ),
          '模式',
          '面板打开模式（默认为个人互动面板）',
          '模式',
          '面板開啟模式（預設為個人互動面板）',
        ),
      ),
    '菜单',
    '打开全功能互动控制面板（游戏、银行、红包、决斗、商店与排行）',
    '選單',
    '開啟全功能互動控制面板（遊戲、銀行、紅包、決鬥、商店與排行）',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;

    const mode = interaction.options.getString('mode') ?? 'personal';
    if (mode === 'lobby') {
      const adminCtx = await requireBotAdmin(interaction, ctx);
      if (!adminCtx) return;

      if (!interaction.channel || !interaction.channel.isSendable()) {
        await interaction.reply({
          embeds: [
            createErrorEmbed('❌ 无法发送大厅入口', '当前频道不支持发送公开消息，请在普通文字频道中重试。'),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        await interaction.channel.send(buildLobbyMessage(interaction.guild?.name));
      } catch {
        await interaction.reply({
          embeds: [
            createErrorEmbed('❌ 发送失败', '无法在该频道发送公开大厅消息，请检查机器人发言与嵌入链接权限。'),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 已发送频道互动大厅入口',
            '群友现在可随时点击该消息下的「🎛️ 打开我的互动菜单」按钮打开自己的专属面板。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const isAdmin = checkMemberIsBotAdmin(guildCtx.member, cfg);

    const msg = buildMenuMessage(
      ctx,
      guildCtx.guildId,
      {
        id: interaction.user.id,
        displayName: interaction.user.displayName,
        avatarUrl: interaction.user.displayAvatarURL(),
        isAdmin,
      },
      { page: 'home' },
    );

    await interaction.reply({
      ...msg,
      flags: MessageFlags.Ephemeral,
    });
  },
};
