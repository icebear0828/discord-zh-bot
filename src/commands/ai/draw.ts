import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  MAX_IMAGE_BATCH_COUNT,
  MAX_IMAGE_STEPS,
  VALID_IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
} from '../../config/defaults.js';
import { executeAndReplyImageBatch } from '../../interactions/imageHandler.js';
import type { NaiCharCaption } from '../../services/imageClient.js';
import {
  MAX_NAI_CHARACTERS,
  parseCharacterPromptsText,
} from '../../services/imagePromptProcessor.js';
import {
  createErrorEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { buildUserImageMenuView } from '../../ui/imageMenuBuilder.js';
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
      .setDescription('打开 AI 绘图交互菜单，或直接输入英文 Tag 生成图片')
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('prompt')
            .setDescription(
              '主提示词 Base Prompt（也可整段粘贴含 Character 1: / Undesired Content: 的完整词，留空开菜单）',
            )
            .setMinLength(1)
            .setMaxLength(4000)
            .setRequired(false),
          '提示词',
          'Base Prompt（支持整段粘贴多栏提示词，留空打开交互绘图菜单）',
        ),
      )
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('character_1')
            .setDescription('角色1提示词（可选，支持开头 @0.3,0.5 或 @B3 站位、末尾 | UC:负面词）')
            .setMinLength(1)
            .setMaxLength(1000),
          '角色1',
          'Character 1 外貌与服装（支持 @0.3,0.5 站位与 | UC:负面词）',
        ),
      )
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('character_2')
            .setDescription('角色2提示词（可选，支持开头 @0.7,0.5 或 @D3 站位、末尾 | UC:负面词）')
            .setMinLength(1)
            .setMaxLength(1000),
          '角色2',
          'Character 2 外貌与服装（支持 @0.7,0.5 站位与 | UC:负面词）',
        ),
      )
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('character_3')
            .setDescription('角色3提示词（可选，支持开头 @x,y 站位与末尾 | UC:负面词）')
            .setMinLength(1)
            .setMaxLength(1000),
          '角色3',
          'Character 3 外貌与服装（可选）',
        ),
      )
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('character_4')
            .setDescription('角色4提示词（可选，支持开头 @x,y 站位与末尾 | UC:负面词）')
            .setMinLength(1)
            .setMaxLength(1000),
          '角色4',
          'Character 4 外貌与服装（可选）',
        ),
      )
      .addBooleanOption((opt) =>
        applyZh(
          opt
            .setName('use_coords')
            .setDescription('是否启用角色自定义站位坐标（写了 @x,y 站位时会自动开启）'),
          '自定义站位',
          '开启后按角色坐标定位（默认 AI 自动排布）',
        ),
      )
      .addIntegerOption((opt) =>
        applyZh(
          opt
            .setName('count')
            .setDescription('连续生成张数（1 ~ 5，单线程串行 + 随机停顿防风控）')
            .setMinValue(1)
            .setMaxValue(MAX_IMAGE_BATCH_COUNT),
          '张数',
          '连续出图张数（1 ~ 5，串行防风控间隔）',
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
            .setDescription('额外负面提示词（自动与默认反打码 UC 合并去重，可选）')
            .setMinLength(1)
            .setMaxLength(1000),
          '负面词',
          '额外负面 Tag（自动保留默认反打码词，可选）',
        ),
      )
      .addIntegerOption((opt) =>
        applyZh(
          opt
            .setName('steps')
            .setDescription(`采样步数（1 ~ ${MAX_IMAGE_STEPS}，默认 28，Opus 0 Anlas 档位）`)
            .setMinValue(1)
            .setMaxValue(MAX_IMAGE_STEPS),
          '步数',
          `采样步数（1 ~ ${MAX_IMAGE_STEPS}，默认 28）`,
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
            .setDescription('固定随机种子（0 ~ 2147483647，连抽时自动递增，留空随机）')
            .setMinValue(0)
            .setMaxValue(2_147_483_647),
          '种子',
          '固定随机种子（留空随机，连抽自动递增）',
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
    '打开 AI 绘图交互菜单，或直接输入英文 Tag 生成图片',
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
    const count = interaction.options.getInteger('count', false) ?? undefined;
    const negativePrompt = interaction.options.getString('negative_prompt', false) ?? undefined;
    const steps = interaction.options.getInteger('steps', false) ?? undefined;
    const scale = interaction.options.getNumber('scale', false) ?? undefined;
    const seed = interaction.options.getInteger('seed', false);
    const spoiler = interaction.options.getBoolean('spoiler', false) ?? undefined;
    const rawPrivate = interaction.options.getBoolean('private', false) ?? undefined;
    const rawUseCoords = interaction.options.getBoolean('use_coords', false) ?? undefined;

    const charCaptions: NaiCharCaption[] = [];
    let hasOptionCoords = false;
    for (const optName of ['character_1', 'character_2', 'character_3', 'character_4'] as const) {
      const rawChar = interaction.options.getString(optName, false)?.trim();
      if (!rawChar) continue;
      const parsed = parseCharacterPromptsText(rawChar);
      if (parsed.hasExplicitCoords) {
        hasOptionCoords = true;
      }
      for (const item of parsed.charCaptions) {
        if (charCaptions.length < MAX_NAI_CHARACTERS) {
          charCaptions.push(item);
        }
      }
    }
    const useCoords = rawUseCoords ?? (hasOptionCoords ? true : undefined);

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

    await executeAndReplyImageBatch({
      interaction,
      imageService: imageSvc,
      input: {
        guildId: guildCtx.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        prompt,
        count,
        aspectRatio,
        negativePrompt,
        steps,
        scale,
        seed,
        ...(charCaptions.length > 0 ? { charCaptions } : {}),
        ...(useCoords !== undefined ? { useCoords } : {}),
        spoiler,
        ephemeral: isPrivate,
        isAdmin,
      },
      authorName: interaction.user.displayName,
      authorAvatarUrl: interaction.user.displayAvatarURL(),
    });
  },
};
