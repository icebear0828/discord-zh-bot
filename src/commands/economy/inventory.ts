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
import { truncateDescriptionLines } from '../../ui/soloFormatters.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const inventoryCommand: CommandDefinition = {
  name: 'inventory',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('inventory')
      .setDescription('查看背包道具或使用经验卡/切换称号/兑换称号券')
      .addSubcommand((sub) =>
        applyZh(sub.setName('list').setDescription('查看我拥有的道具与称号'), '列表', '查看我拥有的道具与称号'),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('use')
            .setDescription('使用背包中的道具（激活经验卡、佩戴称号或兑换自定义称号券）')
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('id').setDescription('背包道具编号').setMinValue(1).setRequired(true),
                '编号',
                '背包中显示的道具编号',
              ),
            )
            .addStringOption((opt) =>
              applyZh(
                opt
                  .setName('title')
                  .setDescription('兑换自定义称号券时填写的自拟称号（1~20字，可选）')
                  .setMinLength(1)
                  .setMaxLength(20),
                '称号文本',
                '使用自定义称号券时要兑换的称号内容',
              ),
            ),
          '使用',
          '使用背包中的道具',
        ),
      ),
    '背包',
    '查看背包道具或使用经验卡/切换称号/兑换称号券',
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
      const desc = truncateDescriptionLines(
        lines,
        '\n',
        '\n\n使用 `/背包 使用 编号` 激活经验卡/佩戴称号；兑换自定义称号券请附带 `称号文本` 参数或前往 `/菜单` →「🎒 背包与称号」。',
      );
      await interaction.reply({
        embeds: [createInfoEmbed('🎒 我的背包', desc)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'use') {
      const invId = interaction.options.getInteger('id', true);
      const customTitle = interaction.options.getString('title');
      const existing = ctx.repos.shop.getInventoryItem(guildCtx.guildId, interaction.user.id, invId);

      if (existing && existing.quantity > 0 && existing.itemType === 'custom_title') {
        if (!customTitle || customTitle.trim().length === 0) {
          await interaction.reply({
            embeds: [
              createErrorEmbed(
                '✍️ 请提供称号文本',
                `道具 **#${invId}** 是自定义称号券，请使用 \`/背包 使用 编号:${invId} 称号文本:你的称号\`（1~20字）直接兑换，或在 \`/菜单\` →「🎒 背包与称号」弹窗兑换。`,
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const redeemRes = ctx.services.shop.redeemCustomTitleVoucher(
          guildCtx.guildId,
          interaction.user.id,
          invId,
          customTitle,
        );
        if (!redeemRes.ok) {
          const reasonMap: Record<typeof redeemRes.reason, string> = {
            not_found: '未找到该自定义称号券或数量不足。',
            unsupported_item: '该道具不支持此操作。',
            already_owned: `你已经拥有称号「${customTitle.trim()}」了，请换一个独一无二的称号。`,
            invalid_title: '自定义称号长度需在 1 ~ 20 个字之间。',
            boost_multiplier_conflict: '当前经验卡倍率冲突。',
          };
          await interaction.reply({
            embeds: [createErrorEmbed('❌ 兑换失败', reasonMap[redeemRes.reason])],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '🏷️ 自定义称号已兑换并佩戴！',
              `已消耗称号券，为你解锁并自动佩戴专属称号 **「${redeemRes.equippedTitle}」**！`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const res = ctx.services.shop.useInventoryItem(
        guildCtx.guildId,
        interaction.user.id,
        invId,
      );

      if (!res.ok) {
        let errText = '未找到该背包道具或数量不足。';
        if (res.reason === 'unsupported_item') {
          errText = '自定义称号券请使用 `/背包 使用 编号 称号文本` 或前往 `/菜单` →「🎒 背包与称号」兑换。';
        } else if (res.reason === 'boost_multiplier_conflict') {
          const remainMs = Math.max(0, (res.activeBoostExpiresAt ?? 0) - Date.now());
          errText = `当前已有 **${res.activeBoostMultiplier ?? ''}x** 经验加成卡生效中（剩余 ${formatDurationZh(remainMs)}），不同倍率经验卡不可混叠使用，请等待当前加成结束后再激活！`;
        }
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
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (res.equippedTitle) {
        await interaction.reply({
          embeds: [
            createSuccessEmbed('🏷️ 称号已佩戴', `已将当前展示称号切换为 **「${res.equippedTitle}」**。`),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
