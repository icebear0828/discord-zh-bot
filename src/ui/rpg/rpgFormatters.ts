import type { RpgItem, RpgItemRarity, RpgItemSlot } from '../../db/repositories/rpgRepo.js';
import { RARITY_META, type EffectiveItemStats } from '../../services/rpgService.js';

export const RPG_SLOT_META: Readonly<Record<RpgItemSlot, { label: string; emoji: string }>> = {
  weapon: { label: '武器', emoji: '🗡️' },
  armor: { label: '防具', emoji: '🛡️' },
  accessory: { label: '饰品', emoji: '💍' },
};

export const RPG_RARITY_BADGE: Readonly<Record<RpgItemRarity, { emoji: string; label: string }>> = {
  common: { emoji: '⬜', label: RARITY_META.common.label },
  uncommon: { emoji: '🟩', label: RARITY_META.uncommon.label },
  rare: { emoji: '🟦', label: RARITY_META.rare.label },
  epic: { emoji: '🟪', label: RARITY_META.epic.label },
  legendary: { emoji: '🟧', label: RARITY_META.legendary.label },
};

export const GEAR_SLOTS_ORDER: readonly RpgItemSlot[] = ['weapon', 'armor', 'accessory'];

export function formatBpPercent(bp: number): string {
  return `${(bp / 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export function formatEffectiveStats(stats: EffectiveItemStats): string {
  const parts: string[] = [];
  if (stats.hp > 0) parts.push(`HP +${stats.hp}`);
  if (stats.atk > 0) parts.push(`ATK +${stats.atk}`);
  if (stats.def > 0) parts.push(`DEF +${stats.def}`);
  if (stats.critBp > 0) parts.push(`暴击 +${formatBpPercent(stats.critBp)}`);
  return parts.length > 0 ? parts.join(' / ') : '无附加属性';
}

export function formatRpgRarityTag(rarity: RpgItemRarity): string {
  const badge = RPG_RARITY_BADGE[rarity];
  return `${badge.emoji}${badge.label}`;
}

export function formatRpgItemDisplay(item: RpgItem): string {
  const enhanceTag = item.enhanceLevel > 0 ? ` **+${item.enhanceLevel}**` : '';
  const lockTag = item.locked ? ' 🔒' : '';
  return `${formatRpgRarityTag(item.rarity)} **${item.name}**${enhanceTag}${lockTag}`;
}

export function formatSuccessRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function formatCompactGearItem(item: RpgItem | undefined): string {
  if (!item) return '空';
  const badge = RPG_RARITY_BADGE[item.rarity];
  const enh = item.enhanceLevel > 0 ? `+${item.enhanceLevel}` : '';
  const lock = item.locked ? '🔒' : '';
  return `${badge.emoji}${item.name}${enh}${lock}`;
}

export function formatIdleDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} 分钟`;
  if (minutes <= 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}
