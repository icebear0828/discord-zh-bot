import { EmbedBuilder } from 'discord.js';
export type { AppContext, CommandDefinition } from '../core/context.js';

export const COLORS = {
  PRIMARY: 0x5865f2,
  SUCCESS: 0x57f287,
  WARNING: 0xfee75c,
  ERROR: 0xed4245,
  GOLD: 0xf1c40f,
  FUN: 0xeb459e,
} as const;

export function renderProgressBar(ratio: number, width = 12): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export function formatDurationZh(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (mins > 0) parts.push(`${mins}分钟`);
  if (parts.length === 0 || secs > 0) parts.push(`${secs}秒`);
  return parts.join('');
}

export function createInfoEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle(title).setTimestamp();
  if (description) {
    embed.setDescription(description);
  }
  return embed;
}

export function createSuccessEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLORS.SUCCESS).setTitle(title).setTimestamp();
  if (description) {
    embed.setDescription(description);
  }
  return embed;
}

export function createErrorEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(COLORS.ERROR).setTitle(title).setTimestamp();
  if (description) {
    embed.setDescription(description);
  }
  return embed;
}
