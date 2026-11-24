import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { ModuleKey } from '../../config/defaults.js';
import type { LeaderboardType } from '../../services/levelingService.js';
import { COLORS, type AppContext, type CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember, requireModuleEnabled } from '../guards.js';

export const LEADERBOARD_MODULE_MAP: Readonly<
  Record<LeaderboardType, { key: ModuleKey; name: string }>
> = {
  xp: { key: 'leveling', name: '等级与热度' },
  stat: { key: 'leveling', name: '等级与热度' },
  coins: { key: 'economy', name: '经济系统' },
  invites: { key: 'invites', name: '邀请追踪' },
};

export function buildLeaderboardMessage(
  ctx: AppContext,
  guildId: string,
  type: LeaderboardType,
  page: number,
  ownerId?: string,
  options?: { includeComponents?: boolean },
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const res = ctx.services.leveling.getLeaderboard(guildId, type, page, 10);

  const titleMap: Record<LeaderboardType, string> = {
    xp: '🏆 服务器等级经验排行榜',
    coins: `💰 服务器${cfg.economy.currencyName}富豪榜`,
    invites: '📨 服务器邀请贡献排行榜',
    stat: `📏 服务器${cfg.leveling.statName}排行榜`,
  };

  const lines = res.items.map((item, idx) => {
    const rankNum = (res.page - 1) * 10 + idx + 1;
    const medal = rankNum === 1 ? '🥇' : rankNum === 2 ? '🥈' : rankNum === 3 ? '🥉' : `**#${rankNum}**`;
    const titleTag = item.equippedTitle ? `「${item.equippedTitle}」` : '';
    if (type === 'xp') {
      return `${medal} <@${item.userId}> ${titleTag} — Lv.**${item.secondaryValue}**（${item.primaryValue} XP）`;
    }
    if (type === 'coins') {
      return `${medal} <@${item.userId}> ${titleTag} — ${cfg.economy.currencyEmoji} **${item.primaryValue}** ${cfg.economy.currencyName}（银行 ${item.secondaryValue}）`;
    }
    if (type === 'stat') {
      return `${medal} <@${item.userId}> ${titleTag} — 📏 **${item.primaryValue}** ${cfg.leveling.statUnit}（Lv.${item.secondaryValue}）`;
    }
    return `${medal} <@${item.userId}> — 成功邀请 **${item.primaryValue}** 人`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle(titleMap[type])
    .setDescription(lines.length > 0 ? lines.join('\n') : '暂无上榜数据，快去聊聊天吧！')
    .setFooter({ text: `第 ${res.page} / ${res.totalPages} 页 · 共 ${res.totalItems} 名成员` })
    .setTimestamp();

  if (options?.includeComponents === false) {
    return { embeds: [embed], components: [] };
  }

  const ownerSuffix = ownerId ? `:${ownerId}` : '';
  const prevId = `lb:${type}:${Math.max(1, res.page - 1)}:prev${ownerSuffix}`;
  const nextId = `lb:${type}:${Math.min(res.totalPages, res.page + 1)}:next${ownerSuffix}`;
  const tabId = (t: LeaderboardType): string =>
    ownerId ? `lb:${t}:1:tab:${ownerId}` : `lb:${t}:1`;
  const shareId = ownerId
    ? `lb:share:${type}:${res.page}:${ownerId}`
    : `lb:share:${type}:${res.page}`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(prevId)
      .setLabel('上一页')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(res.page <= 1),
    new ButtonBuilder()
      .setCustomId(nextId)
      .setLabel('下一页')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(res.page >= res.totalPages),
    new ButtonBuilder()
      .setCustomId(tabId('xp'))
      .setLabel('经验榜')
      .setStyle(type === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(tabId('coins'))
      .setLabel('富豪榜')
      .setStyle(type === 'coins' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(tabId('invites'))
      .setLabel('邀请榜')
      .setStyle(type === 'invites' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  const statRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(tabId('stat'))
      .setLabel(`📏 ${cfg.leveling.statName}榜`)
      .setStyle(type === 'stat' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(shareId)
      .setLabel('📢 晒到公屏')
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row, statRow] };
}

export const leaderboardCommand: CommandDefinition = {
  name: 'leaderboard',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('查看经验、星币、成长或邀请排行榜')
      .addStringOption((opt) =>
        applyZh(
          opt
            .setName('type')
            .setDescription('排行榜类型')
            .addChoices(
              { name: '经验等级榜', value: 'xp' },
              { name: '星币富豪榜', value: 'coins' },
              { name: '成长数值榜', value: 'stat' },
              { name: '邀请贡献榜', value: 'invites' },
            ),
          '类型',
          '选择要查看的排行榜类型',
        ),
      ),
    '排行榜',
    '查看经验、星币、成长或邀请排行榜',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;

    const rawType = interaction.options.getString('type');
    const type: LeaderboardType =
      rawType === 'coins' || rawType === 'invites' || rawType === 'stat' ? rawType : 'xp';

    const modInfo = LEADERBOARD_MODULE_MAP[type];
    if (!(await requireModuleEnabled(interaction, ctx, modInfo.key, modInfo.name))) return;

    await interaction.reply({
      ...buildLeaderboardMessage(ctx, guildCtx.guildId, type, 1, interaction.user.id),
      flags: MessageFlags.Ephemeral,
    });
  },
};
