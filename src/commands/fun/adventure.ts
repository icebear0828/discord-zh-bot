import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { AppContext, CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import {
  buildRpgHomeView,
  buildRpgRunView,
  buildRpgTabletopRunView,
} from '../../ui/rpgMenuBuilder.js';
import { checkMemberIsBotAdmin, requireGuildMember, requireModuleEnabled } from '../guards.js';

export const adventureCommand: CommandDefinition = {
  name: '冒险',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('冒险')
      .setDescription('开启或继续西幻地下城文字冒险（4职业/6章节/装备强化/战宠助战）'),
    '冒险',
    '开启或继续西幻地下城文字冒险（4职业/6章节/装备强化/战宠助战）',
    '冒險',
    '開啟或繼續西幻地下城文字冒險（4職業/6章節/裝備強化/戰寵助戰）',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'rpg', '奇幻RPG地牢'))) return;

    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const isAdmin = checkMemberIsBotAdmin(guildCtx.member, cfg);
    const actor = {
      id: interaction.user.id,
      displayName: interaction.user.displayName,
      avatarUrl: interaction.user.displayAvatarURL(),
      isAdmin,
      roleIds: [...guildCtx.member.roles.cache.keys()],
    };

    const nowMs = Date.now();
    const activeMode = ctx.services.rpg.getAnyActiveRunMode(guildCtx.guildId, interaction.user.id);
    const msg =
      activeMode === 'tabletop'
        ? buildRpgTabletopRunView(ctx, guildCtx.guildId, actor, undefined, nowMs)
        : activeMode === 'classic'
          ? buildRpgRunView(ctx, guildCtx.guildId, actor, undefined, nowMs)
          : buildRpgHomeView(ctx, guildCtx.guildId, actor, undefined, nowMs);

    await interaction.reply({
      ...msg,
      flags: MessageFlags.Ephemeral,
    });
  },
};
