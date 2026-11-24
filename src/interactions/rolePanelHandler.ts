import {
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { computeRoleDiff } from '../services/rolePanelService.js';
import { createErrorEmbed, createSuccessEmbed, type AppContext } from '../ui/embeds.js';

async function applyRolePanelDiff(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  ctx: AppContext,
  panelId: number,
  selectedRoleIds: readonly string[],
  trigger: 'button' | 'select',
): Promise<void> {
  if (!interaction.guildId || !interaction.inCachedGuild()) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
  if (!cfg.modules.rolePanels) {
    await interaction.editReply({
      embeds: [createErrorEmbed('🚫 模块未开启', '当前服务器暂未开启自助身份组功能。')],
    });
    return;
  }

  const data = ctx.services.rolePanel.getPanelWithOptions(interaction.guildId, panelId);
  if (!data) {
    await interaction.editReply({
      embeds: [createErrorEmbed('❌ 面板不存在', '该身份组面板已被管理员删除。')],
    });
    return;
  }

  const panelRoleIds = data.options.map((o) => o.roleId);
  const currentRoles = [...interaction.member.roles.cache.keys()];
  const diff = computeRoleDiff(
    panelRoleIds,
    currentRoles,
    selectedRoleIds,
    trigger,
    data.panel.selectionMode,
  );

  try {
    if (diff.toRemove.length > 0) {
      await interaction.member.roles.remove(diff.toRemove, `自助身份组面板 #${panelId}`);
    }
    if (diff.toAdd.length > 0) {
      await interaction.member.roles.add(diff.toAdd, `自助身份组面板 #${panelId}`);
    }
  } catch {
    await interaction.editReply({
      embeds: [
        createErrorEmbed(
          '⚠️ 身份组更新失败',
          '机器人缺少「管理身份组」权限，或 Bot 自身身份组排序低于目标身份组。请联系管理员在服务器设置中把 Bot 身份组拖动到目标身份组上方。',
        ),
      ],
    });
    return;
  }

  const parts: string[] = [];
  if (diff.toAdd.length > 0) {
    parts.push(`✅ 已领取：${diff.toAdd.map((r) => `<@&${r}>`).join('、')}`);
  }
  if (diff.toRemove.length > 0) {
    parts.push(`➖ 已移除：${diff.toRemove.map((r) => `<@&${r}>`).join('、')}`);
  }
  if (parts.length === 0) {
    parts.push('当前身份组状态未发生变更。');
  }

  await interaction.editReply({
    embeds: [createSuccessEmbed('🎭 身份组已更新', parts.join('\n'))],
  });
}

export async function handleRolePanelButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  const [, , panelIdStr, roleId] = interaction.customId.split(':');
  const panelId = Number(panelIdStr);
  if (!Number.isFinite(panelId) || !roleId) return;
  await applyRolePanelDiff(interaction, ctx, panelId, [roleId], 'button');
}

export async function handleRolePanelSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  const [, , panelIdStr] = interaction.customId.split(':');
  const panelId = Number(panelIdStr);
  if (!Number.isFinite(panelId)) return;
  await applyRolePanelDiff(interaction, ctx, panelId, interaction.values, 'select');
}
