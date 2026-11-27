import {
  AttachmentBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { GuildConfig } from '../../../config/defaults.js';
import type { AppContext } from '../../../core/context.js';
import { slugifyPackId } from '../../../services/aiPackStore.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
} from '../../../ui/embeds.js';
import { truncateText } from '../../../ui/menuShared.js';

export async function executeAiPresetGroup(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  guildId: string,
  cfg: GuildConfig,
  sub: string,
): Promise<void> {
  const binding = ctx.services.ai.resolveEffectiveBinding(guildId, interaction.channelId);

  if (sub === 'list') {
    const presets = ctx.services.ai.listPresets();
    const lines = presets.map((p) => {
      const isGuild = (cfg.ai.activePresetId || 'default-chat') === p.id;
      const isChan = binding.channelOverride?.presetId === p.id;
      const tags = [isGuild ? '🌐全服默认' : '', isChan ? '🧪本频道覆盖' : '']
        .filter(Boolean)
        .join(' ');
      const tagBadge = tags ? ` — **${tags}**` : '';
      const histCount = ctx.services.ai.listPackHistory('preset', p.id).length;
      return `• \`${p.id}\` **${p.name}** \`v${p.version}\`（Prompt块 ${p.prompts.length} · 历史快照 ${histCount}）${tagBadge}`;
    });

    await interaction.reply({
      embeds: [
        createInfoEmbed(
          `🔓 AI 破限预设库（共 ${presets.length} 套）`,
          truncateText(
            [
              `当前频道生效预设：\`${binding.preset.id}\`（**${binding.preset.name}** \`v${binding.preset.version}\`）`,
              '',
              ...lines,
            ].join('\n'),
            4096,
          ),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'use') {
    const id = interaction.options.getString('id', true).trim();
    const scope = interaction.options.getString('scope') === 'channel' ? 'channel' : 'guild';
    if (scope === 'channel') {
      const res = ctx.services.ai.setChannelOverride(guildId, interaction.channelId, {
        presetId: id,
      });
      if (!res.ok) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 切换预设失败', res.error)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '🧪 已挂载当前频道测试预设',
            `频道 <#${interaction.channelId}> 已独立挂载破限预设 \`${id}\`（不影响其他频道）。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const res = ctx.services.ai.setGuildActivePreset(guildId, id);
    if (!res.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 切换预设失败', res.error)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '🌐 已更新全服默认破限预设',
          `全服默认破限预设已切换为 \`${res.preset.id}\`（**${res.preset.name}** \`v${res.preset.version}\`）。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'import') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const att = interaction.options.getAttachment('file', true);
    const customId = interaction.options.getString('id')?.trim();
    const activate = interaction.options.getString('activate') ?? 'none';

    const dl = await ctx.services.ai.downloadTextAttachment(att.url);
    if (!dl.ok) {
      await interaction.editReply({
        embeds: [createErrorEmbed('❌ 下载预设附件失败', dl.error)],
      });
      return;
    }

    const baseName = (att.name ?? 'preset').replace(/\.json$/i, '');
    const fallbackId = customId || slugifyPackId(baseName, 'preset');
    const imported = ctx.services.ai.importPresetJson(
      dl.text,
      customId ? { fallbackId: customId } : { fallbackId, fallbackName: baseName },
    );
    if (!imported.ok) {
      await interaction.editReply({
        embeds: [createErrorEmbed('❌ 导入破限预设失败', imported.error)],
      });
      return;
    }

    let finalPack = imported.pack;
    if (customId && finalPack.id !== slugifyPackId(customId, 'preset')) {
      const store = ctx.services.ai.getPackStore();
      const forcedId = slugifyPackId(customId, 'preset');
      if (store) {
        const savedAgain = store.savePreset({ ...finalPack, id: forcedId });
        if (savedAgain.ok) {
          finalPack = savedAgain.pack;
        }
      }
    }

    let bindNote = '仅入库保存（未改动当前挂载）';
    if (activate === 'channel') {
      ctx.services.ai.setChannelOverride(guildId, interaction.channelId, {
        presetId: finalPack.id,
      });
      bindNote = `已挂载至当前频道 <#${interaction.channelId}> 独立测试`;
    } else if (activate === 'guild') {
      ctx.services.ai.setGuildActivePreset(guildId, finalPack.id);
      bindNote = '已设为全服默认破限预设';
    }

    const srcLabel =
      imported.sourceFormat === 'sillytavern_preset'
        ? '酒馆 SillyTavern 预设（自动转换）'
        : '自研标准 Preset JSON';

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          '✅ 已导入破限预设',
          [
            `• **编号**：\`${finalPack.id}\` ｜ **名称**：**${finalPack.name}** \`v${finalPack.version}\``,
            `• **来源格式**：${srcLabel}`,
            `• **编排块数**：**${finalPack.prompts.length}** 块 ｜ **Prefill**：${finalPack.assistantPrefill.enabled ? '✅ 开启' : '关闭'}`,
            `• **历史快照**：${imported.archivedPrevious ? '已自动备份覆盖前旧版本（可一键回滚）' : '全新入库'}`,
            `• **挂载状态**：${bindNote}`,
          ].join('\n'),
        ),
      ],
    });
    return;
  }

  if (sub === 'export') {
    const id = interaction.options.getString('id')?.trim();
    const pack = ctx.services.ai.exportPreset(guildId, id, interaction.channelId);
    if (!pack) {
      await interaction.reply({
        embeds: [createErrorEmbed('❓ 未找到预设', `找不到编号为 \`${id}\` 的破限预设。`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const jsonBuf = Buffer.from(`${JSON.stringify(pack, null, 2)}\n`, 'utf8');
    const file = new AttachmentBuilder(jsonBuf, {
      name: `${pack.id}-v${pack.version}.preset.json`,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          `📤 已导出破限预设：${pack.name}`,
          `编号 \`${pack.id}\`（\`v${pack.version}\`），请下载下方 JSON 附件保存或提交 Git。`,
        ),
      ],
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'rollback') {
    const id = interaction.options.getString('id', true).trim();
    const res = ctx.services.ai.rollbackPreset(id);
    if (!res.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 回滚预设失败', res.error)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '⏪ 已回滚破限预设',
          `预设 \`${res.restored.id}\` 已恢复至上一版本：**${res.restored.name}** \`v${res.restored.version}\`。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function executeAiCardGroup(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  guildId: string,
  cfg: GuildConfig,
  sub: string,
): Promise<void> {
  const binding = ctx.services.ai.resolveEffectiveBinding(guildId, interaction.channelId);

  if (sub === 'list') {
    const cards = ctx.services.ai.listCards();
    const lines = cards.map((c) => {
      const isGuild = cfg.ai.activeCardId === c.id;
      const isChan = binding.channelOverride?.cardId === c.id;
      const tags = [isGuild ? '🌐全服默认' : '', isChan ? '🧪本频道覆盖' : '']
        .filter(Boolean)
        .join(' ');
      const tagBadge = tags ? ` — **${tags}**` : '';
      const histCount = ctx.services.ai.listPackHistory('card', c.id).length;
      return `• \`${c.id}\` **${c.personaName}**（${c.name} \`v${c.version}\` · 词条 ${c.lorebookEntries.length} · 快照 ${histCount}）${tagBadge}`;
    });

    await interaction.reply({
      embeds: [
        createInfoEmbed(
          `🎭 AI 角色人设卡库（共 ${cards.length} 张）`,
          truncateText(
            [
              `当前频道生效角色：**${binding.card.personaName}**（卡 \`${binding.card.id}\` \`v${binding.card.version}\`）`,
              '',
              ...lines,
            ].join('\n'),
            4096,
          ),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'use') {
    const id = interaction.options.getString('id', true).trim();
    const scope = interaction.options.getString('scope') === 'channel' ? 'channel' : 'guild';
    if (scope === 'channel') {
      const res = ctx.services.ai.setChannelOverride(guildId, interaction.channelId, {
        cardId: id,
      });
      if (!res.ok) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 切换角色卡失败', res.error)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '🧪 已挂载当前频道测试角色卡',
            `频道 <#${interaction.channelId}> 已独立挂载角色卡 \`${id}\`（不影响其他频道）。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const res = ctx.services.ai.setGuildActiveCard(guildId, id);
    if (!res.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 切换角色卡失败', res.error)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '🌐 已更新全服默认角色卡',
          `全服默认角色卡已切换为 \`${res.card.id}\`（角色名：**${res.card.personaName}** \`v${res.card.version}\`）。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'import') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const att = interaction.options.getAttachment('file', true);
    const customId = interaction.options.getString('id')?.trim();
    const activate = interaction.options.getString('activate') ?? 'none';

    const dl = await ctx.services.ai.downloadTextAttachment(att.url);
    if (!dl.ok) {
      await interaction.editReply({
        embeds: [createErrorEmbed('❌ 下载角色卡附件失败', dl.error)],
      });
      return;
    }

    const baseName = (att.name ?? 'card').replace(/\.json$/i, '');
    const fallbackId = customId || slugifyPackId(baseName, 'card');
    const imported = ctx.services.ai.importCardJson(
      dl.text,
      customId ? { fallbackId: customId } : { fallbackId, fallbackName: baseName },
    );
    if (!imported.ok) {
      await interaction.editReply({
        embeds: [createErrorEmbed('❌ 导入角色卡失败', imported.error)],
      });
      return;
    }

    let finalCard = imported.pack;
    if (customId && finalCard.id !== slugifyPackId(customId, 'card')) {
      const store = ctx.services.ai.getPackStore();
      const forcedId = slugifyPackId(customId, 'card');
      if (store) {
        const savedAgain = store.saveCard({ ...finalCard, id: forcedId });
        if (savedAgain.ok) {
          finalCard = savedAgain.pack;
        }
      }
    }

    let bindNote = '仅入库保存（未改动当前挂载）';
    if (activate === 'channel') {
      ctx.services.ai.setChannelOverride(guildId, interaction.channelId, {
        cardId: finalCard.id,
      });
      bindNote = `已挂载至当前频道 <#${interaction.channelId}> 独立测试`;
    } else if (activate === 'guild') {
      ctx.services.ai.setGuildActiveCard(guildId, finalCard.id);
      bindNote = '已设为全服默认角色卡';
    }

    const srcLabel =
      imported.sourceFormat === 'sillytavern_card'
        ? '酒馆 SillyTavern 角色卡（自动转换）'
        : '自研标准 Card JSON';

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          '✅ 已导入角色人设卡',
          [
            `• **编号**：\`${finalCard.id}\` ｜ **角色名**：**${finalCard.personaName}** \`v${finalCard.version}\``,
            `• **来源格式**：${srcLabel}`,
            `• **世界书词条**：**${finalCard.lorebookEntries.length}** 条 ｜ **局部正则**：**${finalCard.regexRules.length}** 条`,
            `• **历史快照**：${imported.archivedPrevious ? '已自动备份覆盖前旧版本（可一键回滚）' : '全新入库'}`,
            `• **挂载状态**：${bindNote}`,
          ].join('\n'),
        ),
      ],
    });
    return;
  }

  if (sub === 'export') {
    const id = interaction.options.getString('id')?.trim();
    const pack = ctx.services.ai.exportCard(guildId, id, interaction.channelId);
    if (!pack) {
      await interaction.reply({
        embeds: [createErrorEmbed('❓ 未找到角色卡', `找不到编号为 \`${id}\` 的角色卡。`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const jsonBuf = Buffer.from(`${JSON.stringify(pack, null, 2)}\n`, 'utf8');
    const file = new AttachmentBuilder(jsonBuf, {
      name: `${pack.id}-v${pack.version}.card.json`,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          `📤 已导出角色卡：${pack.personaName}`,
          `编号 \`${pack.id}\`（\`v${pack.version}\`），请下载下方 JSON 附件保存或提交 Git。`,
        ),
      ],
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'rollback') {
    const id = interaction.options.getString('id', true).trim();
    const res = ctx.services.ai.rollbackCard(id);
    if (!res.ok) {
      await interaction.reply({
        embeds: [createErrorEmbed('❌ 回滚角色卡失败', res.error)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '⏪ 已回滚角色卡',
          `角色卡 \`${res.restored.id}\` 已恢复至上一版本：**${res.restored.personaName}** \`v${res.restored.version}\`。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
