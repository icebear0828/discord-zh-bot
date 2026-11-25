import {
  ActionRowBuilder,
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type MessageCreateOptions,
  type MessageEditOptions,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import type { ModuleKey } from '../config/defaults.js';
import { checkMemberIsBotAdmin } from '../commands/guards.js';
import type { AppContext } from '../ui/embeds.js';
import { truncateText, type BuiltMenuMessage, type MenuActor, type MenuFeedback } from '../ui/menuShared.js';
import { buildRobTargetHints } from '../ui/soloFormatters.js';

export type MenuSupportedInteraction =
  | ButtonInteraction
  | ChannelSelectMenuInteraction
  | RoleSelectMenuInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

export const ADMIN_DENIED_FEEDBACK: MenuFeedback = {
  type: 'error',
  text: '🔒 权限不足：仅服务器管理员或已授权的 Bot 管理员可进入管理后台。',
};

export const SUPER_ADMIN_DENIED_FEEDBACK: MenuFeedback = {
  type: 'error',
  text: '🔒 权限不足：该高危操作仅限拥有服务器「管理员」或「管理服务器」权限的超级管理员执行。',
};

function hasSuperAdminPerms(
  perms: { has(permission: bigint): boolean } | null | undefined,
): boolean {
  if (!perms) return false;
  return (
    perms.has(PermissionFlagsBits.Administrator) ||
    perms.has(PermissionFlagsBits.ManageGuild)
  );
}

export function isGuildSuperAdmin(
  interaction: MenuSupportedInteraction,
  _ctx?: AppContext,
  _guildId?: string,
): boolean {
  if (interaction.inCachedGuild()) {
    return hasSuperAdminPerms(interaction.member.permissions);
  }
  return hasSuperAdminPerms(interaction.memberPermissions);
}

export function getActor(
  interaction: MenuSupportedInteraction,
  ctx: AppContext,
  guildId: string,
): MenuActor {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const isSuperAdmin = isGuildSuperAdmin(interaction, ctx, guildId);
  const isAdmin = interaction.inCachedGuild()
    ? checkMemberIsBotAdmin(interaction.member, cfg)
    : isSuperAdmin || cfg.adminUserIds.includes(interaction.user.id);
  const roleIds = interaction.inCachedGuild()
    ? [...interaction.member.roles.cache.keys()]
    : undefined;
  const hints = buildRobTargetHints(
    interaction.user,
    interaction.inCachedGuild() ? interaction.member : null,
  );
  return {
    id: interaction.user.id,
    displayName: interaction.user.displayName,
    avatarUrl: interaction.user.displayAvatarURL(),
    isAdmin,
    isSuperAdmin,
    roleIds,
    hints,
  };
}

export async function resolveActor(
  interaction: MenuSupportedInteraction,
  ctx: AppContext,
  guildId: string,
): Promise<MenuActor> {
  if (interaction.inCachedGuild()) {
    return getActor(interaction, ctx, guildId);
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  let fetchedMember: GuildMember | null = null;
  if (interaction.guild?.members?.fetch) {
    fetchedMember = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
  }

  if (fetchedMember) {
    const isSuperAdmin = hasSuperAdminPerms(fetchedMember.permissions);
    const isAdmin = checkMemberIsBotAdmin(fetchedMember, cfg);
    const roleIds = fetchedMember.roles?.cache
      ? [...fetchedMember.roles.cache.keys()]
      : undefined;
    return {
      id: interaction.user.id,
      displayName: interaction.user.displayName,
      avatarUrl: interaction.user.displayAvatarURL(),
      isAdmin,
      isSuperAdmin,
      roleIds,
      hints: buildRobTargetHints(interaction.user, fetchedMember),
    };
  }

  const isSuperAdmin = hasSuperAdminPerms(interaction.memberPermissions);
  const isAdmin = isSuperAdmin || cfg.adminUserIds.includes(interaction.user.id);
  return {
    id: interaction.user.id,
    displayName: interaction.user.displayName,
    avatarUrl: interaction.user.displayAvatarURL(),
    isAdmin,
    isSuperAdmin,
    roleIds: undefined,
    hints: buildRobTargetHints(interaction.user, null),
  };
}

export function isInteractionAdmin(
  interaction: MenuSupportedInteraction,
  ctx: AppContext,
  guildId: string,
): boolean {
  return Boolean(getActor(interaction, ctx, guildId).isAdmin);
}

export function extractDiscordErrorCode(err: unknown): number | null {
  if (err instanceof DiscordAPIError) {
    const numeric = Number(err.code);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const raw = (err as { code?: unknown }).code;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  }
  return null;
}

export function isTokenOrMessageExpiredError(err: unknown): boolean {
  const code = extractDiscordErrorCode(err);
  if (code === 10008 || code === 50027) {
    return true;
  }
  if (err instanceof Error) {
    return (
      err.message.includes('10008') ||
      err.message.includes('50027') ||
      err.message.includes('Unknown Message') ||
      err.message.includes('Invalid Webhook Token')
    );
  }
  return false;
}

export function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return num;
}

export function parseNonNegativeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num < 0) return null;
  return num;
}

export function parseIntInRange(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num < min || num > max) return null;
  return num;
}

export function parseNumberInRange(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
}

export function prefilledField(
  customId: string,
  label: string,
  value: string | number,
  maxLength = 12,
): ActionRowBuilder<TextInputBuilder> {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(truncateText(label, 45))
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(maxLength)
      .setValue(String(value))
      .setRequired(true),
  );
}

export function checkModuleDisabled(
  ctx: AppContext,
  guildId: string,
  key: ModuleKey,
  displayName: string,
): string | null {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  if (!cfg.modules[key]) {
    return `当前服务器已关闭「${displayName}」模块，请联系管理员通过 \`/菜单\` → 管理后台开启。`;
  }
  return null;
}

export async function respondFromModal(
  interaction: ModalSubmitInteraction,
  msg: BuiltMenuMessage,
): Promise<void> {
  if (interaction.isFromMessage()) {
    try {
      await interaction.update(msg);
      return;
    } catch {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.followUp({ ...msg, flags: MessageFlags.Ephemeral });
      return;
    }
  }
  await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
}

export async function safeEditOrFollowUp(
  interaction: MenuSupportedInteraction,
  msg: BuiltMenuMessage,
): Promise<void> {
  try {
    await interaction.editReply(msg);
  } catch (err) {
    if (isTokenOrMessageExpiredError(err)) {
      await interaction.followUp({ ...msg, flags: MessageFlags.Ephemeral });
      return;
    }
    throw err;
  }
}

export async function sendPublicBroadcast(
  interaction: MenuSupportedInteraction,
  payload: MessageCreateOptions,
): Promise<{ sent: boolean; messageId: string | null }> {
  const safePayload: MessageCreateOptions = {
    allowedMentions: { parse: [] },
    ...payload,
  };
  try {
    const direct = interaction.channel;
    if (direct && direct.isSendable()) {
      const m = await direct.send(safePayload);
      return { sent: true, messageId: m.id };
    }
    if (interaction.channelId && interaction.client?.channels) {
      const fetched = await interaction.client.channels
        .fetch(interaction.channelId)
        .catch(() => null);
      if (fetched && fetched.isSendable()) {
        const m = await fetched.send(safePayload);
        return { sent: true, messageId: m.id };
      }
    }
    return { sent: false, messageId: null };
  } catch (err) {
    console.error('[menu] 发送频道公开播报失败:', err);
    return { sent: false, messageId: null };
  }
}

export async function sendToChannel(
  client: Client,
  channelId: string,
  payload: MessageCreateOptions,
): Promise<string | null> {
  try {
    const cached = client.channels.cache.get(channelId);
    const ch = cached ?? (await client.channels.fetch(channelId).catch(() => null));
    if (ch && ch.isSendable()) {
      const m = await ch.send(payload);
      return m.id;
    }
    return null;
  } catch {
    return null;
  }
}

export async function editChannelMessage(
  client: Client,
  channelId: string,
  messageId: string | null,
  payload: MessageEditOptions,
  guild?: Guild | null,
): Promise<void> {
  if (!messageId) return;
  try {
    const ch =
      guild?.channels.cache.get(channelId) ??
      client.channels.cache.get(channelId) ??
      (await client.channels.fetch(channelId).catch(() => null));
    if (!ch || !ch.isTextBased()) return;
    const msg = await ch.messages.fetch(messageId).catch(() => null);
    if (msg) {
      await msg.edit(payload).catch(() => undefined);
    }
  } catch {
    // Message may have been deleted or channel inaccessible
  }
}
