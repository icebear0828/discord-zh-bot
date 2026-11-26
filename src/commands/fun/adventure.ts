import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { AppContext, CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { buildRpgHomeView } from '../../ui/rpgMenuBuilder.js';
import { checkMemberIsBotAdmin, requireGuildMember, requireModuleEnabled } from '../guards.js';

export const adventureCommand: CommandDefinition = {
  name: '冒险',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('冒险')
      .setDescription('开启西幻十阶挂机、速刷秘境Boss、炼金秘药与60秒全服破境试炼'),
    '冒险',
    '开启西幻十阶挂机、速刷秘境Boss、炼金秘药与60秒全服破境试炼',
    '冒險',
    '開啟西幻十階掛機、速刷秘境Boss、煉金秘藥與60秒全服破境試煉',
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
    const msg = buildRpgHomeView(ctx, guildCtx.guildId, actor, undefined, nowMs);

    await interaction.reply({
      ...msg,
      flags: MessageFlags.Ephemeral,
    });
  },
};
