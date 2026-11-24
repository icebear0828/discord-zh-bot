import {
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import {
  buildLeaderboardMessage,
  LEADERBOARD_MODULE_MAP,
  parseLeaderboardType,
} from '../commands/leveling/leaderboard.js';
import type { LeaderboardType } from '../services/levelingService.js';
import {
  createErrorEmbed,
  createSuccessEmbed,
  type AppContext,
} from '../ui/embeds.js';
import { sendChannelPublicNotice } from '../ui/soloFormatters.js';

function parsePage(raw: string | undefined): number {
  const num = Number(raw ?? '1');
  return Number.isFinite(num) && num >= 1 ? Math.floor(num) : 1;
}

export async function handleLeaderboardButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;

  const parts = interaction.customId.split(':');
  const isShare = parts[1] === 'share';

  let type: LeaderboardType;
  let page: number;
  let ownerId: string | undefined;

  if (isShare) {
    // Format: lb:share:<type>:<page>[:<ownerId>]
    type = parseLeaderboardType(parts[2]);
    page = parsePage(parts[3]);
    ownerId = parts[4] || undefined;
  } else {
    // Formats:
    // - lb:<type>:<page> (legacy)
    // - lb:<type>:<page>:prev|next (legacy)
    // - lb:<type>:<page>:prev|next|tab:<ownerId> (new)
    type = parseLeaderboardType(parts[1]);
    page = parsePage(parts[2]);
    const maybeAction = parts[3];
    if (maybeAction === 'prev' || maybeAction === 'next' || maybeAction === 'tab') {
      ownerId = parts[4] || undefined;
    } else if (maybeAction && /^\d+$/.test(maybeAction)) {
      ownerId = maybeAction;
    }
  }

  if (ownerId && ownerId !== interaction.user.id) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🚫 这不是你的排行榜面板',
          '请自行执行 `/排行榜` 查看并翻页，无法操作他人的面板。',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modInfo = LEADERBOARD_MODULE_MAP[type];
  const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
  if (!cfg.modules[modInfo.key]) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🚫 模块未开启',
          `当前服务器已关闭 **${modInfo.name}** 模块，无法查看该排行榜。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (isShare) {
    const publicMsg = buildLeaderboardMessage(ctx, interaction.guildId, type, page, undefined, {
      includeComponents: false,
    });
    const sent = await sendChannelPublicNotice(interaction, {
      content: `📢 <@${interaction.user.id}> 分享了本服排行榜：`,
      embeds: publicMsg.embeds,
      allowedMentions: { parse: [] },
    });
    await interaction.reply({
      embeds: [
        sent
          ? createSuccessEmbed('📢 已晒到公屏', '排行榜已分享到当前频道！')
          : createErrorEmbed('❌ 发送失败', '当前频道无法发送公开消息，请检查机器人发言权限。'),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await interaction.update(
      buildLeaderboardMessage(ctx, interaction.guildId, type, page, ownerId),
    );
  } catch {
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 翻页失败', '无法更新排行榜消息，请重新执行 `/排行榜`。')],
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleLeaderboardSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const parts = interaction.customId.split(':');
  const ownerId = parts[2] || undefined;

  if (ownerId && ownerId !== interaction.user.id) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🚫 这不是你的排行榜面板',
          '请自行执行 `/排行榜` 查看并切换榜单，无法操作他人的面板。',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selected = interaction.values[0];
  const type = parseLeaderboardType(selected);

  const modInfo = LEADERBOARD_MODULE_MAP[type];
  const cfg = ctx.repos.guildConfig.getOrCreate(interaction.guildId);
  if (!cfg.modules[modInfo.key]) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🚫 模块未开启',
          `当前服务器已关闭 **${modInfo.name}** 模块，无法查看该排行榜。`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await interaction.update(buildLeaderboardMessage(ctx, interaction.guildId, type, 1, ownerId));
  } catch {
    await interaction.reply({
      embeds: [createErrorEmbed('❌ 切换榜单失败', '无法更新排行榜消息，请重新执行 `/排行榜`。')],
      flags: MessageFlags.Ephemeral,
    });
  }
}
