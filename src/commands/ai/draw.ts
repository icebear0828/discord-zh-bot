import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import { executeAndReplyImageBatch } from '../../interactions/imageHandler.js';
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
import {
  addCharacterImageOptions,
  addTuningImageOptions,
  parseSharedImageOptions,
} from './imageCommandOptions.js';

function buildDrawCommandData(): SlashCommandOptionsOnlyBuilder {
  const base = applyZh(
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
      ),
    '画图',
    '打开 AI 绘图交互菜单，或直接输入英文 Tag 生成图片',
  );

  const withChars = addCharacterImageOptions(base);
  return addTuningImageOptions(withChars);
}

export const drawCommand: CommandDefinition = {
  name: 'draw',
  data: buildDrawCommandData(),
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

    const shared = parseSharedImageOptions(interaction);

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
    const isPrivate = shared.isPrivate ?? userPrefs.ephemeral;
    await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});

    await executeAndReplyImageBatch({
      interaction,
      imageService: imageSvc,
      input: {
        guildId: guildCtx.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        prompt,
        count: shared.count,
        aspectRatio: shared.aspectRatio,
        negativePrompt: shared.negativePrompt,
        steps: shared.steps,
        scale: shared.scale,
        seed: shared.seed,
        ...(shared.charCaptions.length > 0 ? { charCaptions: shared.charCaptions } : {}),
        ...(shared.useCoords !== undefined ? { useCoords: shared.useCoords } : {}),
        spoiler: shared.spoiler,
        ephemeral: isPrivate,
        isAdmin,
      },
      authorName: interaction.user.displayName,
      authorAvatarUrl: interaction.user.displayAvatarURL(),
    });
  },
};
