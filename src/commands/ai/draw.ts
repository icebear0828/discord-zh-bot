import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  VALID_IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
} from '../../config/defaults.js';
import {
  createErrorEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import {
  buildImageResultMessage,
  buildUserImageMenuView,
} from '../../ui/imageMenuBuilder.js';
import { applyZh } from '../../ui/localization.js';
import type { MenuActor } from '../../ui/menuShared.js';
import {
  checkMemberIsBotAdmin,
  requireGuildMember,
  requireModuleEnabled,
} from '../guards.js';

const RATIO_CHOICES: ReadonlyArray<{ name: string; value: ImageAspectRatio }> = [
  { name: '2:3 竖图 (默认)', value: '2:3' },
  { name: '3:2 横图', value: '3:2' },
  { name: '1:1 方图', value: '1:1' },
  { name: '9:16 手机竖屏', value: '9:16' },
  { name: '16:9 宽屏横图', value: '16:9' },
];

export const drawCommand: CommandDefinition = {
  name: 'draw',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('draw')
      .setDescription('打开 AI 绘图交互菜单，或直接输入提示词生成图片')
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('prompt')
            .setDescription('画面提示词（不填直接回车则打开交互式绘图菜单面板）')
            .setMinLength(1)
            .setMaxLength(1500)
            .setRequired(false),
          '提示词',
          '画面描述或 Tag（留空则打开交互绘图菜单）',
        ),
      )
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('aspect_ratio')
            .setDescription('图片宽高比（默认使用后台设置，通常为 2:3）')
            .addChoices(...RATIO_CHOICES),
          '比例',
          '图片宽高比（默认 2:3）',
        ),
      )
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('negative_prompt')
            .setDescription('负面提示词（不想出现的元素，可选）')
            .setMinLength(1)
            .setMaxLength(1000),
          '负面词',
          '不想在画面中出现的内容（可选）',
        ),
      )
      .addIntegerOption((opt) =>
        applyZh(
          opt
            .setName('steps')
            .setDescription('采样步数（1 ~ 50，默认 28）')
            .setMinValue(1)
            .setMaxValue(50),
          '步数',
          '采样步数（1 ~ 50，默认 28）',
        ),
      )
      .addNumberOption((opt) =>
        applyZh(
          opt
            .setName('scale')
            .setDescription('引导系数 CFG Scale（1.0 ~ 10.0，默认 5.0）')
            .setMinValue(1.0)
            .setMaxValue(10.0),
          '引导系数',
          '提示词引导强度 CFG Scale（1.0 ~ 10.0，默认 5.0）',
        ),
      )
      .addIntegerOption((opt) =>
        applyZh(
          opt
            .setName('seed')
            .setDescription('固定随机种子（0 ~ 2147483647，留空随机）')
            .setMinValue(0)
            .setMaxValue(2_147_483_647),
          '种子',
          '固定随机种子（留空则随机）',
        ),
      )
      .addBooleanOption((opt) =>
        applyZh(
          opt
            .setName('spoiler')
            .setDescription('是否给生成图片加上剧透模糊遮罩（默认否）'),
          '剧透遮罩',
          '开启后发送模糊剧透遮罩图片',
        ),
      )
      .addBooleanOption((opt) =>
        applyZh(
          opt
            .setName('private')
            .setDescription('是否私密出图（开启后仅自己可见，默认公屏发送）'),
          '私密出图',
          '开启后结果仅你本人可见',
        ),
      ),
    '画图',
    '打开 AI 绘图交互菜单，或直接输入提示词生成图片',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;

    const moduleEnabled = await requireModuleEnabled(interaction, ctx, 'imageGen', 'AI 绘图');
    if (!moduleEnabled) return;

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const isAdmin = checkMemberIsBotAdmin(guildCtx.member, cfg);
    const prompt = interaction.options.getString('prompt', false)?.trim() ?? '';

    if (!prompt) {
      const actor: MenuActor = {
        id: interaction.user.id,
        displayName: interaction.user.displayName,
        avatarUrl: interaction.user.displayAvatarURL(),
        isAdmin,
        roleIds: [...guildCtx.member.roles.cache.keys()],
      };
      await interaction.reply({
        ...buildUserImageMenuView(ctx, guildCtx.guildId, actor, undefined, undefined),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const imageSvc = ctx.services.image;
    if (!imageSvc || !imageSvc.isConfigured()) {
      await interaction.reply({
        embeds: [
          createErrorEmbed('❌ 生图未配置', '生图服务尚未配置完成，请联系管理员检查环境变量。'),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rawRatio = interaction.options.getString('aspect_ratio', false);
    const aspectRatio =
      rawRatio && (VALID_IMAGE_ASPECT_RATIOS as readonly string[]).includes(rawRatio)
        ? (rawRatio as ImageAspectRatio)
        : undefined;
    const negativePrompt = interaction.options.getString('negative_prompt', false) ?? undefined;
    const steps = interaction.options.getInteger('steps', false) ?? undefined;
    const scale = interaction.options.getNumber('scale', false) ?? undefined;
    const seed = interaction.options.getInteger('seed', false);
    const spoiler = interaction.options.getBoolean('spoiler', false) ?? undefined;
    const rawPrivate = interaction.options.getBoolean('private', false) ?? undefined;

    const precheck = imageSvc.precheckRequest({
      guildId: guildCtx.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      isAdmin,
    });
    if (!precheck.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 暂无法生图', precheck.errorMessage)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const userPrefs = imageSvc.getUserPrefs(guildCtx.guildId, interaction.user.id);
    const isPrivate = rawPrivate ?? userPrefs.ephemeral;
    await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});

    const res = await imageSvc.generateImage({
      guildId: guildCtx.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      prompt,
      aspectRatio,
      negativePrompt,
      steps,
      scale,
      seed,
      spoiler,
      ephemeral: isPrivate,
      isAdmin,
    });

    if (!res.ok) {
      await interaction.editReply({
        embeds: [createErrorEmbed('⚠️ 生图失败', res.errorMessage)],
      });
      return;
    }

    const built = buildImageResultMessage({
      record: res.record,
      buffer: res.buffer,
      authorName: interaction.user.displayName,
      authorAvatarUrl: interaction.user.displayAvatarURL(),
      translated: res.translated,
      attempts: res.attempts,
    });

    await interaction.editReply(built);
  },
};
