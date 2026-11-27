import {
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { buildRolePanelMessage } from '../../commands/roles/rolePanel.js';
import type { AppContext } from '../../core/context.js';
import { isValidDiscordEmoji } from '../../services/rolePanelService.js';
import { createInfoEmbed } from '../../ui/embeds.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor } from '../../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  editChannelMessage,
  parsePositiveInt,
  respondFromModal,
  safeEditOrFollowUp,
  sendPublicBroadcast,
  type MenuSupportedInteraction,
} from '../menuHelpers.js';

const SELECTION_MODE_SINGLE: ReadonlySet<string> = new Set(['single', '单选', '单选互斥']);
const SELECTION_MODE_MULTI: ReadonlySet<string> = new Set(['multi', '多选', '自由多选']);
const DISPLAY_MODE_BUTTON: ReadonlySet<string> = new Set(['button', '按钮', '按钮点击']);
const DISPLAY_MODE_SELECT: ReadonlySet<string> = new Set(['select', '菜单', '下拉', '下拉菜单']);

export const ROLE_PANEL_ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  'rp_send',
  'rp_toggle_display',
  'rp_toggle_mode',
  'rp_delete',
]);

export async function syncPublishedRolePanel(
  interaction: MenuSupportedInteraction,
  ctx: AppContext,
  guildId: string,
  panelId: number,
): Promise<boolean> {
  const data = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
  if (!data || !data.panel.channelId || !data.panel.messageId) {
    return false;
  }
  await editChannelMessage(
    interaction.client,
    data.panel.channelId,
    data.panel.messageId,
    buildRolePanelMessage(data.panel, data.options),
    interaction.guild,
  );
  return true;
}

export async function handleRolePanelAdminButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  action: string,
  parts: readonly string[],
): Promise<boolean> {
  if (!ROLE_PANEL_ADMIN_ACTIONS.has(action)) {
    return false;
  }

  const panelId = parsePositiveInt(parts[3] ?? '');
  if (!panelId) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles' },
        { type: 'error', text: '无效的身份组面板编号。' },
      ),
    );
    return true;
  }

  if (action === 'rp_send') {
    const data = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
    if (!data) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles' },
          { type: 'error', text: `面板 #${panelId} 不存在或已被删除。` },
        ),
      );
      return true;
    }
    if (data.options.length === 0) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles', panelId },
          { type: 'error', text: '请先添加至少 1 个身份组选项后再发送到频道。' },
        ),
      );
      return true;
    }

    await interaction.deferUpdate();
    const payload = buildRolePanelMessage(data.panel, data.options);
    const sent = await sendPublicBroadcast(interaction, payload);
    if (!sent.sent || !sent.messageId) {
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles', panelId },
          { type: 'error', text: '在当前频道发布面板失败，请检查机器人发言与嵌入链接权限。' },
        ),
      );
      return true;
    }

    if (interaction.channelId) {
      ctx.services.rolePanel.setPanelMessage(panelId, interaction.channelId, sent.messageId);
    }
    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId },
        { type: 'success', text: `已将自助身份组面板 **#${panelId}** 发布到当前频道！` },
      ),
    );
    return true;
  }

  if (action === 'rp_toggle_display' || action === 'rp_toggle_mode') {
    const data = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
    if (!data) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles' },
          { type: 'error', text: `面板 #${panelId} 不存在。` },
        ),
      );
      return true;
    }

    await interaction.deferUpdate();
    const nextDisplay =
      action === 'rp_toggle_display'
        ? data.panel.displayMode === 'button'
          ? 'select'
          : 'button'
        : data.panel.displayMode;
    const nextSelection =
      action === 'rp_toggle_mode'
        ? data.panel.selectionMode === 'single'
          ? 'multi'
          : 'single'
        : data.panel.selectionMode;

    ctx.services.rolePanel.updatePanelModes(guildId, panelId, nextDisplay, nextSelection);
    const synced = await syncPublishedRolePanel(interaction, ctx, guildId, panelId);
    const baseText =
      action === 'rp_toggle_display'
        ? `频道展示样式已切换为：**${nextDisplay === 'button' ? '按钮点击' : '下拉菜单'}**。`
        : `选择模式已切换为：**${nextSelection === 'single' ? '单选互斥' : '自由多选'}**。`;
    const feedbackText = synced ? `${baseText}（已自动同步更新频道卡片）` : baseText;

    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId },
        { type: 'success', text: feedbackText },
      ),
    );
    return true;
  }

  const confirmed = parts[4] === 'confirm';
  const existing = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
  if (!existing) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles' },
        { type: 'error', text: `未找到面板 **#${panelId}**。` },
      ),
    );
    return true;
  }

  if (!confirmed) {
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId, confirmDeletePanelId: panelId },
        {
          type: 'info',
          text: `⚠️ 确认删除自助身份组面板 **#${panelId}「${existing.panel.title}」**？此操作不可撤销，已发布的频道卡片按钮将被停用。`,
        },
      ),
    );
    return true;
  }

  await interaction.deferUpdate();
  const deleted = ctx.services.rolePanel.deletePanel(guildId, panelId);
  if (deleted && existing.panel.channelId && existing.panel.messageId) {
    await editChannelMessage(
      interaction.client,
      existing.panel.channelId,
      existing.panel.messageId,
      {
        embeds: [
          createInfoEmbed(
            `⛔ ${existing.panel.title}（已停用）`,
            '该自助身份组面板已被管理员删除，自助领取已停止。',
          ),
        ],
        components: [],
      },
      interaction.guild,
    );
  }

  await safeEditOrFollowUp(
    interaction,
    buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'admin_roles' },
      deleted
        ? {
            type: 'success',
            text: `已删除身份组面板 **#${panelId}**${existing.panel.messageId ? '（原频道卡片已清空按钮并标记停用）' : ''}。`,
          }
        : { type: 'error', text: `未找到面板 **#${panelId}**。` },
    ),
  );
  return true;
}

export async function handleRolePanelModalSubmit(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const modalType = parts[2];
  if (modalType !== 'admin_rp_create' && modalType !== 'admin_rp_add') {
    return false;
  }

  if (!actor.isAdmin) {
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  if (modalType === 'admin_rp_create') {
    const title = interaction.fields.getTextInputValue('title').trim();
    const rawDesc = interaction.fields.getTextInputValue('description').trim();
    const rawSelection = interaction.fields.getTextInputValue('selectionMode').trim().toLowerCase();
    const rawDisplay = interaction.fields.getTextInputValue('displayMode').trim().toLowerCase();

    if (title.length < 1 || title.length > 80) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles' },
          { type: 'error', text: '面板标题需在 1 ~ 80 字之间。' },
        ),
      );
      return true;
    }

    const selectionMode = SELECTION_MODE_SINGLE.has(rawSelection)
      ? 'single'
      : SELECTION_MODE_MULTI.has(rawSelection)
        ? 'multi'
        : null;
    if (!selectionMode) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles' },
          { type: 'error', text: '选择模式无效：请填写「多选」或「单选」（或 multi / single）。' },
        ),
      );
      return true;
    }

    const displayMode = DISPLAY_MODE_SELECT.has(rawDisplay)
      ? 'select'
      : DISPLAY_MODE_BUTTON.has(rawDisplay)
        ? 'button'
        : null;
    if (!displayMode) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_roles' },
          { type: 'error', text: '频道展示样式无效：请填写「按钮」或「菜单」（或 button / select）。' },
        ),
      );
      return true;
    }

    const description = rawDesc || '点击下方选项即可自助领取或取消对应身份组。';
    const created = ctx.services.rolePanel.createPanel({
      guildId,
      title,
      description,
      displayMode,
      selectionMode,
    });

    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId: created.id },
        {
          type: 'success',
          text: `✅ 已创建身份组面板 **#${created.id} ${created.title}**！请用下方身份组选择器添加选项。`,
        },
      ),
    );
    return true;
  }

  const panelId = parsePositiveInt(parts[3] ?? '');
  const roleId = parts[4];
  const label = interaction.fields.getTextInputValue('label').trim();
  const emoji = interaction.fields.getTextInputValue('emoji').trim() || null;
  const description = interaction.fields.getTextInputValue('description').trim() || null;

  if (!panelId || !roleId || label.length < 1 || label.length > 80) {
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId: panelId ?? undefined },
        { type: 'error', text: '显示文字需在 1 ~ 80 字之间。' },
      ),
    );
    return true;
  }

  if (emoji !== null && !isValidDiscordEmoji(emoji)) {
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_roles', panelId },
        {
          type: 'error',
          text: '图标 Emoji 格式无效：请输入标准 Unicode 表情（如 🎮）或服务器自定义表情（如 `<:name:123456789012345678>`），也可留空。',
        },
      ),
    );
    return true;
  }

  const existingPanel = ctx.services.rolePanel.getPanelWithOptions(guildId, panelId);
  const shouldSyncChannel = Boolean(
    existingPanel?.panel.channelId && existingPanel.panel.messageId,
  );
  if (shouldSyncChannel) {
    if (interaction.isFromMessage()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
  }

  const res = ctx.services.rolePanel.addOption(guildId, panelId, {
    roleId,
    label,
    emoji,
    description,
  });
  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      panel_not_found: `未找到面板 **#${panelId}**。`,
      limit_reached: '单个面板最多支持 25 个身份组选项。',
      duplicate_role: `面板中已存在 <@&${roleId}>。`,
    };
    const errMsg = buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'admin_roles', panelId },
      { type: 'error', text: msgMap[res.reason] },
    );
    if (shouldSyncChannel) {
      await safeEditOrFollowUp(interaction, errMsg);
    } else {
      await respondFromModal(interaction, errMsg);
    }
    return true;
  }

  const synced = shouldSyncChannel
    ? await syncPublishedRolePanel(interaction, ctx, guildId, panelId)
    : false;
  const okMsg = buildMenuMessage(
    ctx,
    guildId,
    actor,
    { page: 'admin_roles', panelId },
    {
      type: 'success',
      text: `✅ 已将 <@&${roleId}>（${emoji ? `${emoji} ` : ''}${label}）添加到面板 **#${panelId}**${synced ? '（已自动同步刷新频道卡片）' : ''}！`,
    },
  );
  if (shouldSyncChannel) {
    await safeEditOrFollowUp(interaction, okMsg);
  } else {
    await respondFromModal(interaction, okMsg);
  }
  return true;
}
