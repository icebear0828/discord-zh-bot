import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AppContext, CommandDefinition } from '../../core/context.js';
import { createErrorEmbed } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  checkMemberIsBotAdmin,
  requireGuildMember,
  requireModuleEnabled,
} from '../guards.js';
import {
  executeAiMemoryGroup,
  executeAiResetSubcommand,
  executeAiUsageSubcommand,
  formatMemoryListDescription,
} from './subcommands/aiMemoryAndResetExec.js';
import {
  executeAiCardGroup,
  executeAiPresetGroup,
} from './subcommands/aiPackAndChannelExec.js';
import {
  executeAiDebugGroup,
  executeAiProfileGroup,
  executeAiRegexGroup,
} from './subcommands/aiRegexProfileSelfieDebugExec.js';
import { attachAiSlashPart1 } from './subcommands/aiSlashBuilderPart1.js';
import { attachAiSlashPart2 } from './subcommands/aiSlashBuilderPart2.js';

export { formatMemoryListDescription };

const baseBuilder = new SlashCommandBuilder()
  .setName('ai')
  .setDescription('AI 对话上下文重置与长期记忆管理');

export const aiCommand: CommandDefinition = {
  name: 'ai',
  data: applyZh(
    attachAiSlashPart2(attachAiSlashPart1(baseBuilder)),
    'ai',
    'AI 对话上下文重置与长期记忆管理',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const memberCtx = await requireGuildMember(interaction);
    if (!memberCtx) return;

    const enabled = await requireModuleEnabled(interaction, ctx, 'ai', 'AI 对话');
    if (!enabled) return;

    const { guildId, member } = memberCtx;
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    const isAdmin = checkMemberIsBotAdmin(member, cfg);

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!group && sub === 'reset') {
      await executeAiResetSubcommand(interaction, ctx, guildId);
      return;
    }

    if (!group && sub === 'usage') {
      await executeAiUsageSubcommand(interaction, ctx, guildId, cfg, isAdmin);
      return;
    }

    if (group === 'memory') {
      await executeAiMemoryGroup(interaction, ctx, guildId, member, sub, isAdmin);
      return;
    }

    if (group === 'regex') {
      await executeAiRegexGroup(interaction, ctx, guildId, sub, isAdmin);
      return;
    }

    if (group === 'profile') {
      await executeAiProfileGroup(interaction, ctx, guildId, sub, isAdmin);
      return;
    }

    if (group === 'preset' || group === 'card' || group === 'debug') {
      if (!isAdmin) {
        await interaction.reply({
          embeds: [
            createErrorEmbed(
              '🔒 权限不足',
              '只有服务器管理员或 Bot 管理员才能管理破限预设、角色卡与调试报文。',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (group === 'preset') {
        await executeAiPresetGroup(interaction, ctx, guildId, cfg, sub);
        return;
      }

      if (group === 'card') {
        await executeAiCardGroup(interaction, ctx, guildId, cfg, sub);
        return;
      }

      await executeAiDebugGroup(interaction, ctx, guildId, member, sub);
    }
  },
};
