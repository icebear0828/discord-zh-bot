import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { LeaderboardType } from '../../services/levelingService.js';
import { COLORS, type AppContext, type CommandDefinition } from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireGuildMember } from '../guards.js';

const ALL_LEADERBOARD_TYPES: ReadonlySet<string> = new Set<LeaderboardType>([
  'xp',
  'coins',
  'invites',
  'stat',
  'credit',
  'deadbeat',
  'hustle',
  'gambling_profit',
  'gambling_loss',
  'rpg',
]);

export function parseLeaderboardType(raw: string | null | undefined): LeaderboardType {
  if (raw && ALL_LEADERBOARD_TYPES.has(raw)) {
    return raw as LeaderboardType;
  }
  return 'xp';
}

export function buildLeaderboardMessage(
  ctx: AppContext,
  guildId: string,
  type: LeaderboardType,
  page: number,
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
    credit: '🏦 服务器信用分红榜',
    deadbeat: '💀 服务器失信老赖黑榜',
    hustle: '🪩 服务器下海捞金榜',
    gambling_profit: '🎰 服务器赌神盈利榜',
    gambling_loss: '🪦 服务器慈善赌圣亏损榜',
    rpg: '⚔️ 服务器奇幻RPG地牢榜',
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
    if (type === 'credit') {
      return `${medal} <@${item.userId}> — 🏦 信用分 **${item.primaryValue}**`;
    }
    if (type === 'deadbeat') {
      return `${medal} <@${item.userId}> — 💀 逾期欠款 **${item.primaryValue.toLocaleString()}** ${cfg.economy.currencyName}（信用分 ${item.secondaryValue}）`;
    }
    if (type === 'hustle') {
      return `${medal} <@${item.userId}> — 🪩 累计营收 **${item.primaryValue.toLocaleString()}** ${cfg.economy.currencyName}（营业 ${item.secondaryValue} 次）`;
    }
    if (type === 'gambling_profit' || type === 'gambling_loss') {
      const sign = item.primaryValue >= 0 ? '+' : '';
      return `${medal} <@${item.userId}> — 🎰 净盈亏 **${sign}${item.primaryValue.toLocaleString()}** ${cfg.economy.currencyName}（${item.secondaryValue} 局）`;
    }
    if (type === 'rpg') {
      return `${medal} <@${item.userId}> — ⚔️ 已通第 **${item.primaryValue}** 章（Lv.${item.secondaryValue}）`;
    }
    return `${medal} <@${item.userId}> — 成功邀请 **${item.primaryValue}** 人`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle(titleMap[type])
    .setDescription(lines.length > 0 ? lines.join('\n') : '暂无上榜数据，快去聊聊天吧！')
    .setFooter({ text: `第 ${res.page} / ${res.totalPages} 页 · 共 ${res.totalItems} 名成员` })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`lb:${type}:${Math.max(1, res.page - 1)}:prev`)
      .setLabel('上一页')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(res.page <= 1),
    new ButtonBuilder()
      .setCustomId(`lb:${type}:${Math.min(res.totalPages, res.page + 1)}:next`)
      .setLabel('下一页')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(res.page >= res.totalPages),
    new ButtonBuilder()
      .setCustomId('lb:xp:1')
      .setLabel('经验榜')
      .setStyle(type === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('lb:coins:1')
      .setLabel('富豪榜')
      .setStyle(type === 'coins' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('lb:invites:1')
      .setLabel('邀请榜')
      .setStyle(type === 'invites' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  const statRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('lb:stat:1')
      .setLabel(`📏 ${cfg.leveling.statName}榜`)
      .setStyle(type === 'stat' ? ButtonStyle.Primary : ButtonStyle.Secondary),
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
              { name: '信用分红榜', value: 'credit' },
              { name: '失信老赖黑榜', value: 'deadbeat' },
              { name: '下海捞金榜', value: 'hustle' },
              { name: '赌神盈利榜', value: 'gambling_profit' },
              { name: '慈善赌圣亏损榜', value: 'gambling_loss' },
              { name: 'RPG地牢榜', value: 'rpg' },
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

    const type = parseLeaderboardType(interaction.options.getString('type'));

    await interaction.reply(buildLeaderboardMessage(ctx, guildCtx.guildId, type, 1));
  },
};
