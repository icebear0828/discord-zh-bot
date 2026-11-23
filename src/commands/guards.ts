import {
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { GuildConfig, ModuleKey } from '../config/defaults.js';
import { isBotAdmin } from '../services/permissionService.js';
import type { AppContext } from '../ui/embeds.js';
import { createErrorEmbed } from '../ui/embeds.js';

export function checkMemberIsBotAdmin(member: GuildMember, cfg: GuildConfig): boolean {
  const perms = member.permissions;
  return isBotAdmin({
    isGuildAdmin: perms.has(PermissionFlagsBits.Administrator),
    hasManageGuild: perms.has(PermissionFlagsBits.ManageGuild),
    memberRoleIds: [...member.roles.cache.keys()],
    configuredAdminRoleIds: cfg.adminRoleIds,
    userId: member.id,
    configuredAdminUserIds: cfg.adminUserIds,
  });
}

export async function requireGuildMember(
  interaction: ChatInputCommandInteraction,
): Promise<{ guildId: string; member: GuildMember } | null> {
  if (!interaction.guildId || !interaction.inCachedGuild()) {
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 仅限服务器内使用', '该指令只能在 Discord 服务器频道中使用。')],
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return {
    guildId: interaction.guildId,
    member: interaction.member,
  };
}

export async function requireModuleEnabled(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  moduleKey: ModuleKey,
  moduleDisplayName: string,
): Promise<boolean> {
  if (!interaction.guildId) {
    return false;
  }
  const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
  if (!cfg.modules[moduleKey]) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🚫 模块未开启',
          `当前服务器已关闭 **${moduleDisplayName}** 模块，请联系管理员通过 \`/设置 开关模块\` 开启。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

export async function requireBotAdmin(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
): Promise<{ guildId: string; member: GuildMember } | null> {
  const ctxGuild = await requireGuildMember(interaction);
  if (!ctxGuild) {
    return null;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(ctxGuild.guildId);
  const allowed = checkMemberIsBotAdmin(ctxGuild.member, cfg);

  if (!allowed) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🔒 权限不足',
          '需要服务器管理员、`管理服务器` 权限，或已配置的 Bot 管理员用户/身份组才能执行此操作。',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return ctxGuild;
}
