import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  formatDurationZh,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { formatInventoryTypeLabel } from '../../ui/menuShared.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const inventoryCommand: CommandDefinition = {
  name: 'inventory',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('inventory')
      .setDescription('查看背包道具或使用经验卡/切换称号')
      .addSubcommand((sub) =>
        applyZh(sub.setName('list').setDescription('查看我拥有的道具与称号'), '列表', '查看我拥有的道具与称号'),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('use')
            .setDescription('使用背包中的道具（例如激活经验卡）')
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('id').setDescription('背包道具编号').setMinValue(1).setRequired(true),
                '编号',
                '背包中显示的道具编号',
              ),
            ),
          '使用',
          '使用背包中的道具',
        ),
      ),
    '背包',
    '查看背包道具或使用经验卡/切换称号',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const items = ctx.services.shop.listInventory(guildCtx.guildId, interaction.user.id);
      if (items.length === 0) {
        await interaction.reply({
          embeds: [createInfoEmbed('🎒 我的背包', '背包里还没有道具，去 `/商店 列表` 逛逛吧！')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const lines = items.map((item) => {
        const typeLabel = formatInventoryTypeLabel(item.itemType);
        return `**#${item.id}** [${typeLabel}] **${item.itemName}** × ${item.quantity}`;
      });
      await interaction.reply({
        embeds: [
          createInfoEmbed('🎒 我的背包', `${lines.join('\n')}\n\n使用 \`/背包 使用 编号\` 激活经验卡/佩戴称号；自定义称号券请在 \`/菜单\` →「🎒 背包与称号」兑换。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'use') {
      const invId = interaction.options.getInteger('id', true);
      const res = ctx.services.shop.useInventoryItem(
        guildCtx.guildId,
        interaction.user.id,
        invId,
      );

      if (!res.ok) {
        const errText =
          res.reason === 'unsupported_item'
            ? '自定义称号券需要在 `/菜单` →「🎒 背包与称号」下拉中选择后填写称号内容。'
            : '未找到该背包道具或数量不足。';
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 使用失败', errText)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (res.boostMultiplier && res.boostExpiresAt) {
        const remaining = Math.max(0, res.boostExpiresAt - Date.now());
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '⚡ 经验加成卡已激活！',
              `已生效 **${res.boostMultiplier}x** 经验倍率，剩余持续时间：**${formatDurationZh(remaining)}**。`,
            ),
          ],
        });
        return;
      }

      if (res.equippedTitle) {
        await interaction.reply({
          embeds: [
            createSuccessEmbed('🏷️ 称号已佩戴', `已将当前展示称号切换为 **「${res.equippedTitle}」**。`),
          ],
        });
      }
    }
  },
};
