import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { renderTemplate } from '../../services/welcomeService.js';
import {
  COLORS,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireBotAdmin } from '../guards.js';

export const welcomeConfigCommand: CommandDefinition = {
  name: 'welcome-config',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('welcome-config')
      .setDescription('设置入群欢迎消息、离开提示与自动发放身份组')
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('set-welcome')
            .setDescription('配置欢迎频道、标题和欢迎语模板')
            .addChannelOption((opt) =>
              applyZh(
                opt
                  .setName('channel')
                  .setDescription('欢迎消息发送频道')
                  .addChannelTypes(ChannelType.GuildText)
                  .setRequired(true),
                '频道',
                '发送入群欢迎的频道',
              ),
            )
            .addStringOption((opt) =>
              applyZh(
                opt
                  .setName('template')
                  .setDescription('支持 {user} {username} {server} {memberCount} {inviter}'),
                '模板',
                '欢迎消息内容模板',
              ),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('title').setDescription('欢迎卡片标题'), '标题', '欢迎 Embed 标题'),
            ),
          '设置欢迎',
          '配置欢迎频道、标题和欢迎语模板',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('set-leave')
            .setDescription('配置成员离开通知频道与模板')
            .addChannelOption((opt) =>
              applyZh(
                opt
                  .setName('channel')
                  .setDescription('离开通知频道')
                  .addChannelTypes(ChannelType.GuildText)
                  .setRequired(true),
                '频道',
                '发送离开通知的频道',
              ),
            )
            .addStringOption((opt) =>
              applyZh(
                opt
                  .setName('template')
                  .setDescription('支持 {username} {server} {memberCount}'),
                '模板',
                '离开消息内容模板',
              ),
            ),
          '设置离开',
          '配置成员离开通知频道与模板',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('toggle')
            .setDescription('单独开关欢迎消息或离开通知')
            .addBooleanOption((opt) =>
              applyZh(opt.setName('welcome').setDescription('开启欢迎消息'), '开启欢迎', 'true 开启 / false 关闭'),
            )
            .addBooleanOption((opt) =>
              applyZh(opt.setName('leave').setDescription('开启离开通知'), '开启离开', 'true 开启 / false 关闭'),
            ),
          '开关状态',
          '单独开关欢迎消息或离开通知',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-autorole')
            .setDescription('添加新成员入群时自动赋予的身份组')
            .addRoleOption((opt) =>
              applyZh(opt.setName('role').setDescription('自动身份组').setRequired(true), '身份组', '自动赋予的身份组'),
            ),
          '添加自动身份组',
          '添加新成员入群时自动赋予的身份组',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('remove-autorole')
            .setDescription('移除一个入群自动身份组')
            .addRoleOption((opt) =>
              applyZh(opt.setName('role').setDescription('自动身份组').setRequired(true), '身份组', '要移除的身份组'),
            ),
          '移除自动身份组',
          '移除一个入群自动身份组',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(sub.setName('preview').setDescription('预览当前欢迎消息效果'), '预览', '预览当前欢迎消息效果'),
      ),
    '欢迎设置',
    '设置入群欢迎消息、离开提示与自动发放身份组',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const adminCtx = await requireBotAdmin(interaction, ctx);
    if (!adminCtx) return;

    const { guildId } = adminCtx;
    const sub = interaction.options.getSubcommand();
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (sub === 'set-welcome') {
      const channel = interaction.options.getChannel('channel', true);
      const template = interaction.options.getString('template');
      const title = interaction.options.getString('title');

      ctx.repos.guildConfig.updateWelcome(guildId, {
        ...cfg.welcome,
        welcomeEnabled: true,
        welcomeChannelId: channel.id,
        welcomeTemplate: template ?? cfg.welcome.welcomeTemplate,
        welcomeTitle: title ?? cfg.welcome.welcomeTitle,
      });

      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 欢迎配置已更新',
            `已绑定欢迎频道：<#${channel.id}>（已自动开启欢迎通知）。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'set-leave') {
      const channel = interaction.options.getChannel('channel', true);
      const template = interaction.options.getString('template');

      ctx.repos.guildConfig.updateWelcome(guildId, {
        ...cfg.welcome,
        leaveEnabled: true,
        leaveChannelId: channel.id,
        leaveTemplate: template ?? cfg.welcome.leaveTemplate,
      });

      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 离开通知已更新',
            `已绑定离开频道：<#${channel.id}>（已自动开启离开通知）。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'toggle') {
      const welcome = interaction.options.getBoolean('welcome');
      const leave = interaction.options.getBoolean('leave');
      const next = {
        ...cfg.welcome,
        welcomeEnabled: welcome ?? cfg.welcome.welcomeEnabled,
        leaveEnabled: leave ?? cfg.welcome.leaveEnabled,
      };
      ctx.repos.guildConfig.updateWelcome(guildId, next);
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 开关已更新',
            `入群欢迎：**${next.welcomeEnabled ? '开启' : '关闭'}**\n离开通知：**${next.leaveEnabled ? '开启' : '关闭'}**`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'add-autorole') {
      const role = interaction.options.getRole('role', true);
      const nextRoles = cfg.welcome.autoRoleIds.includes(role.id)
        ? cfg.welcome.autoRoleIds
        : [...cfg.welcome.autoRoleIds, role.id];
      ctx.repos.guildConfig.updateWelcome(guildId, { ...cfg.welcome, autoRoleIds: nextRoles });
      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 已添加入群自动身份组', `新成员加入时将自动获得 <@&${role.id}>。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove-autorole') {
      const role = interaction.options.getRole('role', true);
      const nextRoles = cfg.welcome.autoRoleIds.filter((id) => id !== role.id);
      ctx.repos.guildConfig.updateWelcome(guildId, { ...cfg.welcome, autoRoleIds: nextRoles });
      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 已移除入群自动身份组', `已从自动身份组列表移除 <@&${role.id}>。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'preview') {
      const rendered = renderTemplate(cfg.welcome.welcomeTemplate, {
        user: `<@${interaction.user.id}>`,
        username: interaction.user.username,
        server: interaction.guild?.name ?? '本服务器',
        memberCount: interaction.guild?.memberCount ?? 1,
        inviter: `<@${interaction.user.id}>`,
      });
      const autoRolesText =
        cfg.welcome.autoRoleIds.length > 0
          ? cfg.welcome.autoRoleIds.map((id) => `<@&${id}>`).join('、')
          : '无';

      const previewEmbed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle(cfg.welcome.welcomeTitle)
        .setDescription(rendered)
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields({ name: '入群自动身份组（预览）', value: autoRolesText })
        .setFooter({ text: `当前状态：${cfg.welcome.welcomeEnabled ? '已开启' : '未开启'}` })
        .setTimestamp();

      await interaction.reply({ embeds: [previewEmbed], flags: MessageFlags.Ephemeral });
    }
  },
};
