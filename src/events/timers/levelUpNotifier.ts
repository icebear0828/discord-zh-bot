import type { EmbedBuilder, Guild, GuildMember } from 'discord.js';
import { DEFAULT_LEVELING_CONFIG, type GuildConfig } from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import { renderLevelUpTemplate, type AwardXpResult } from '../../services/levelingService.js';
import { createSuccessEmbed } from '../../ui/embeds.js';
import { truncateText } from '../../ui/menuShared.js';

export async function syncLevelRewardRoles(
  member: GuildMember,
  res: AwardXpResult,
): Promise<void> {
  if (res.rolesToRemove.length > 0) {
    await member.roles.remove(res.rolesToRemove, '等级身份组更新').catch(() => undefined);
  }
  if (res.rolesToAdd.length > 0) {
    await member.roles.add(res.rolesToAdd, `升级至 Lv.${res.newLevel}`).catch(() => undefined);
  }
}

export function buildLevelUpEmbed(
  cfg: GuildConfig,
  member: { id: string; displayName: string; displayAvatarURL(): string },
  res: AwardXpResult,
): EmbedBuilder {
  const rolesText =
    res.rolesToAdd.length > 0 ? res.rolesToAdd.map((r) => `<@&${r}>`).join('、') : '无';
  const vars = {
    user: `<@${member.id}>`,
    username: member.displayName,
    level: res.newLevel,
    oldLevel: res.oldLevel,
    coins: res.coinsAwarded,
    currency: cfg.economy.currencyName,
    roles: rolesText,
    stat: res.statValue,
    statGained: res.statGained,
    statUnit: cfg.leveling.statUnit,
  };

  const rawTitle = cfg.leveling.levelUpTitle.trim() || DEFAULT_LEVELING_CONFIG.levelUpTitle;
  const rawTemplate = cfg.leveling.levelUpTemplate.trim() || DEFAULT_LEVELING_CONFIG.levelUpTemplate;

  const title = truncateText(renderLevelUpTemplate(rawTitle, vars), 256);
  const mainLine = renderLevelUpTemplate(rawTemplate, vars);

  const rewardLines: string[] = [];
  if (res.coinsAwarded > 0 && !rawTemplate.includes('{coins}')) {
    rewardLines.push(
      `获得升级奖励：${cfg.economy.currencyEmoji} **+${res.coinsAwarded}** ${cfg.economy.currencyName}`,
    );
  }
  if (
    cfg.leveling.statEnabled &&
    res.statGained > 0 &&
    !rawTemplate.includes('{stat}') &&
    !rawTemplate.includes('{statGained}')
  ) {
    rewardLines.push(
      `📏 ${cfg.leveling.statName}：+${res.statGained} ${cfg.leveling.statUnit}（当前 **${res.statValue}** ${cfg.leveling.statUnit}）`,
    );
  }
  if (res.rolesToAdd.length > 0 && !rawTemplate.includes('{roles}')) {
    rewardLines.push(`解锁新身份组：${rolesText}`);
  }

  return createSuccessEmbed(
    title,
    truncateText([mainLine, ...rewardLines].join('\n'), 4096),
  ).setThumbnail(member.displayAvatarURL());
}

export async function sendLevelUpNotice(
  guild: Guild,
  fallbackChannelId: string | null,
  member: GuildMember,
  res: AwardXpResult,
  ctx: AppContext,
): Promise<void> {
  const cfg = ctx.repos.guildConfig.getOrCreate(guild.id);
  if (!cfg.leveling.announceEnabled || !res.leveledUp) {
    return;
  }

  const targetChannelId = cfg.leveling.announceChannelId ?? fallbackChannelId;
  if (!targetChannelId) return;

  const ch =
    guild.channels.cache.get(targetChannelId) ??
    (await guild.channels.fetch(targetChannelId).catch(() => null));
  if (!ch || !ch.isSendable()) return;

  const embed = buildLevelUpEmbed(cfg, member, res);

  await ch.send({ embeds: [embed] }).catch(() => undefined);
}
