import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import { executeAndReplyImageBatch } from '../../interactions/imageHandler.js';
import {
  downloadInitImageAttachment,
  validateInitAttachmentMeta,
} from '../../services/image/imageInitLoader.js';
import {
  DEFAULT_IMG2IMG_NOISE,
  DEFAULT_IMG2IMG_STRENGTH,
} from '../../services/imageService.js';
import {
  createErrorEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  checkMemberIsBotAdmin,
  requireGuildMember,
  requireModuleEnabled,
} from '../guards.js';
import {
  addCharacterImageOptions,
  addTuningImageOptions,
  parseSharedImageOptions,
} from './imageCommandOptions.js';

function buildImg2ImgCommandData(): SlashCommandOptionsOnlyBuilder {
  const base = applyZh(
    new SlashCommandBuilder()
      .setName('img2img')
      .setDescription('上传参考图进行 NovelAI V5 垫图重绘（Img2Img），零 LLM 消耗且 Opus 免费')
      .addAttachmentOption((opt) =>
        applyZh(
          opt
            .setName('image')
            .setDescription('待重绘的参考垫图（支持 PNG / JPG / WebP / GIF，10MB 以内）')
            .setRequired(true),
          '垫图',
          '上传底图（PNG / JPG / WebP / GIF，≤10MB）',
        ),
      )
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('prompt')
            .setDescription('目标画面英文 Tag（支持整段粘贴 Character 1: / Undesired Content:）')
            .setMinLength(1)
            .setMaxLength(4000)
            .setRequired(true),
          '提示词',
          '修改后的目标英文 Tag（支持多栏粘贴）',
        ),
      )
      .addNumberOption((opt) =>
        applyZh(
          opt
            .setName('strength')
            .setDescription('重绘强度 Strength（0.05 ~ 0.99，默认 0.60；越大改动越明显）')
            .setMinValue(0.05)
            .setMaxValue(0.99),
          '重绘强度',
          '改动幅度 0.05~0.99（默认 0.60；局部精修建议 0.35，换装建议 0.55~0.70）',
        ),
      )
      .addNumberOption((opt) =>
        applyZh(
          opt
            .setName('noise')
            .setDescription('附加噪点 Noise（0.00 ~ 0.99，默认 0.00；通常保持 0 或 0.05）')
            .setMinValue(0.0)
            .setMaxValue(0.99),
          '噪点',
          '附加随机细节 0~0.99（默认 0.00）',
        ),
      ),
    '改图',
    '上传图片进行 NovelAI V5 垫图重绘（Img2Img），零 LLM 消耗且 Opus 免费',
  );

  const withTuning = addTuningImageOptions(base, {
    ratioDescription: '输出画幅比例（留空自动匹配底图最接近的 Opus 免费比例）',
    ratioZhDescription: '输出比例（留空自动匹配底图比例）',
  });
  return addCharacterImageOptions(withTuning);
}

export const img2imgCommand: CommandDefinition = {
  name: 'img2img',
  data: buildImg2ImgCommandData(),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;

    const moduleEnabled = await requireModuleEnabled(interaction, ctx, 'imageGen', 'AI 绘图');
    if (!moduleEnabled) return;

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

    const attachment = interaction.options.getAttachment('image', true);
    if (!attachment) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 缺少垫图', '请随指令上传一张需要改图的参考图片。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const metaCheck = validateInitAttachmentMeta(attachment);
    if (!metaCheck.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 垫图格式或大小无效', metaCheck.errorMessage)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const prompt = interaction.options.getString('prompt', true).trim();
    if (!prompt) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 提示词为空', '请描述改图后的目标画面英文 Tag。')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const isAdmin = checkMemberIsBotAdmin(guildCtx.member, cfg);

    // Run precheck before deferReply so rejected/cooled-down users get instant ephemeral feedback.
    const precheck = imageSvc.precheckRequest({
      guildId: guildCtx.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      isAdmin,
    });
    if (!precheck.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('⚠️ 暂无法改图', precheck.errorMessage)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const shared = parseSharedImageOptions(interaction);
    const rawStrength = interaction.options.getNumber('strength', false);
    const rawNoise = interaction.options.getNumber('noise', false);
    const strength =
      rawStrength !== null && Number.isFinite(rawStrength)
        ? Number(Math.max(0.05, Math.min(0.99, rawStrength)).toFixed(2))
        : DEFAULT_IMG2IMG_STRENGTH;
    const noise =
      rawNoise !== null && Number.isFinite(rawNoise)
        ? Number(Math.max(0, Math.min(0.99, rawNoise)).toFixed(2))
        : DEFAULT_IMG2IMG_NOISE;

    const userPrefs = imageSvc.getUserPrefs(guildCtx.guildId, interaction.user.id);
    const isPrivate = shared.isPrivate ?? userPrefs.ephemeral;
    await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});

    const dl = await downloadInitImageAttachment(attachment);
    if (!dl.ok) {
      await interaction.editReply({
        embeds: [createErrorEmbed('❌ 垫图读取失败', dl.errorMessage)],
        components: [],
      });
      return;
    }

    await executeAndReplyImageBatch({
      interaction,
      imageService: imageSvc,
      input: {
        guildId: guildCtx.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        prompt,
        count: shared.count,
        aspectRatio: shared.aspectRatio ?? dl.inferredAspectRatio ?? undefined,
        negativePrompt: shared.negativePrompt,
        steps: shared.steps,
        scale: shared.scale,
        seed: shared.seed,
        initImageDataUrl: dl.dataUrl,
        strength,
        noise,
        ...(shared.charCaptions.length > 0 ? { charCaptions: shared.charCaptions } : {}),
        ...(shared.useCoords !== undefined ? { useCoords: shared.useCoords } : {}),
        spoiler: shared.spoiler,
        ephemeral: isPrivate,
        isAdmin,
      },
      authorName: interaction.user.displayName,
      authorAvatarUrl: interaction.user.displayAvatarURL(),
      failTitle: '⚠️ 改图失败',
    });
  },
};
