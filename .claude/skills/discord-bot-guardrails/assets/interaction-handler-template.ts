import {
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { createErrorEmbed, createSuccessEmbed, type AppContext } from '../ui/embeds.js';
import type { BuiltMenuMessage } from '../ui/menuShared.js';
import {
  checkModuleDisabled,
  parsePositiveInt,
  resolveActor,
  respondFromModal,
  safeEditOrFollowUp,
} from './menuHelpers.js';

/**
 * Custom ID format:
 *   example:<action>:<ownerId>:<recordId>
 */
function parseExampleCustomId(
  customId: string,
): { action: string; ownerId: string; recordId: number } | null {
  const parts = customId.split(':');
  if (parts.length < 4 || parts[0] !== 'example') {
    return null;
  }
  const recordId = parsePositiveInt(parts[3] ?? '');
  if (!parts[1] || !parts[2] || recordId === null) {
    return null;
  }
  return {
    action: parts[1],
    ownerId: parts[2],
    recordId,
  };
}

function buildUpdatedPanel(title: string, description: string): BuiltMenuMessage {
  return {
    embeds: [createSuccessEmbed(title, description)],
    components: [],
  };
}

export async function handleExampleButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;

  // 1. Module toggle guard on every component entry point
  const disabledMsg = checkModuleDisabled(ctx, interaction.guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await interaction.reply({
      embeds: [createErrorEmbed('模块未开启', disabledMsg)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Parse customId & verify ownerId before touching state
  const parsed = parseExampleCustomId(interaction.customId);
  if (!parsed) {
    await interaction.reply({
      embeds: [createErrorEmbed('参数无效', '按钮标识已失效，请重新打开面板。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsed.ownerId !== interaction.user.id) {
    await interaction.reply({
      embeds: [createErrorEmbed('无权操作', '只能由发起本人点击该操作按钮。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 3. Acknowledge immediately to avoid Discord 3-second timeout (10062)
  await interaction.deferUpdate();

  // 4. Refresh only the target record by single ID (never call expireDue* here)
  // Example: ctx.services.multiplayer.expireDuelIfDue(String(parsed.recordId));
  const actor = await resolveActor(interaction, ctx, interaction.guildId);
  const econCfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId).economy;

  // 5. Render updated panel with 15-minute token expiry degradation (10008 / 50027)
  const panel = buildUpdatedPanel(
    '操作已更新',
    `操作人：**${actor.displayName}** ｜ 记录 #${parsed.recordId} ｜ 货币：${econCfg.currencyName}`,
  );
  await safeEditOrFollowUp(interaction, panel);
}

export async function handleExampleModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;

  // 1. Module toggle guard
  const disabledMsg = checkModuleDisabled(ctx, interaction.guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await interaction.reply({
      embeds: [createErrorEmbed('模块未开启', disabledMsg)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Validate modal input via shared menuHelpers parsers
  const rawAmount = interaction.fields.getTextInputValue('amount');
  const amount = parsePositiveInt(rawAmount);
  if (amount === null) {
    await interaction.reply({
      embeds: [createErrorEmbed('输入无效', '请输入大于 0 的有效整数。')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 3. Respond with automatic message-update / Ephemeral fallback
  const econCfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId).economy;
  const panel = buildUpdatedPanel(
    '提交成功',
    `已处理 **${amount}** ${econCfg.currencyName}。`,
  );
  await respondFromModal(interaction, panel);
}
