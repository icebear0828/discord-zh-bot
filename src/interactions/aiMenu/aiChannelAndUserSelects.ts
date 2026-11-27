import type {
  ChannelSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor } from '../../ui/menuShared.js';
import { ADMIN_DENIED_FEEDBACK } from '../menuHelpers.js';
import { buildAiUserProfileModal } from './aiModals.js';

export async function tryHandleAiMenuChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  if (parts[1] !== 'chan') {
    return false;
  }
  const target = parts[2];
  if (
    target !== 'admin_ai_free' &&
    target !== 'admin_ai_allowed' &&
    target !== 'admin_ai_ignore'
  ) {
    return false;
  }

  if (!actor.isAdmin) {
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  const channelIds = [...new Set(interaction.values)].slice(0, 10);
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (target === 'admin_ai_free') {
    ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, freeChatChannelIds: channelIds });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        {
          type: 'success',
          text:
            channelIds.length > 0
              ? `已更新免 @ 直聊频道：${channelIds.map((id) => `<#${id}>`).join('、')}`
              : '已清空免 @ 直聊频道（恢复为仅 @Bot 或回复触发）。',
        },
      ),
    );
    return true;
  }

  if (target === 'admin_ai_allowed') {
    ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, allowedChannelIds: channelIds });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai' },
        {
          type: 'success',
          text:
            channelIds.length > 0
              ? `已更新 AI 白名单限定频道：${channelIds.map((id) => `<#${id}>`).join('、')}`
              : '已清空 AI 频道白名单限制（全频道可用，除屏蔽频道）。',
        },
      ),
    );
    return true;
  }

  ctx.repos.guildConfig.updateAi(guildId, { ...cfg.ai, ignoredChannelIds: channelIds });
  await interaction.update(
    buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'admin_ai', tab: 'channels' },
      {
        type: 'success',
        text:
          channelIds.length > 0
            ? `已更新 AI 屏蔽频道：${channelIds.map((id) => `<#${id}>`).join('、')}`
            : '已清空 AI 屏蔽频道列表。',
      },
    ),
  );
  return true;
}

export async function tryHandleAiMenuUserSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
  targetId: string,
  targetIsBot: boolean,
): Promise<boolean> {
  if (parts[1] !== 'user' || parts[2] !== 'admin_ai_profile_pick') {
    return false;
  }

  if (!actor.isAdmin) {
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  if (targetIsBot) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ai', tab: 'profiles', profilePage: 1 },
        { type: 'error', text: '只能为真实群友配置人物档案，不能选择机器人账号。' },
      ),
    );
    return true;
  }

  const targetUser = interaction.users.get(targetId) ?? interaction.users.first();
  const member = interaction.members?.get?.(targetId);
  const memberDisplayName =
    member && 'displayName' in member && typeof member.displayName === 'string'
      ? member.displayName
      : undefined;
  const fallbackName =
    memberDisplayName?.trim() || targetUser?.displayName?.trim() || targetUser?.username || '群友';
  const existing = ctx.services.ai.listUserProfiles(guildId).find((p) => p.userId === targetId);

  await interaction.showModal(buildAiUserProfileModal(targetId, fallbackName, existing));
  return true;
}
