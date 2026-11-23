import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { BlackjackGame } from '../services/blackjackService.js';
import type { DiceChoice } from '../services/economyService.js';
import type { InteractionAction } from '../services/funService.js';
import type { LeaderboardType } from '../services/levelingService.js';
import { COLORS } from './embeds.js';

export interface MenuActor {
  id: string;
  displayName: string;
  avatarUrl: string;
  isAdmin?: boolean;
}

export interface MenuFeedback {
  type: 'success' | 'error' | 'info';
  text: string;
}

export type MenuView =
  | { page: 'home' }
  | { page: 'solo' }
  | { page: 'slots' }
  | { page: 'dice'; choice: DiceChoice }
  | { page: 'bj'; finishedGame?: BlackjackGame; balanceAfterFinish?: number }
  | { page: 'bank' }
  | { page: 'multi' }
  | { page: 'rob' }
  | { page: 'pay' }
  | { page: 'duel' }
  | { page: 'social'; action: InteractionAction }
  | { page: 'props' }
  | { page: 'bounty' }
  | { page: 'roulette' }
  | { page: 'bomb' }
  | { page: 'events' }
  | { page: 'predictions' }
  | { page: 'pred_detail'; predictionId: number }
  | { page: 'world_status' }
  | { page: 'social_hub' }
  | { page: 'cp' }
  | { page: 'cp_lb'; lbPage: number }
  | { page: 'pets' }
  | { page: 'pet_arena' }
  | { page: 'shop' }
  | { page: 'bag' }
  | { page: 'rank' }
  | { page: 'leaderboard'; lbType: LeaderboardType; lbPage: number }
  | { page: 'admin' }
  | { page: 'admin_econ' }
  | { page: 'admin_lvl' }
  | { page: 'admin_games' }
  | { page: 'admin_mod' }
  | { page: 'admin_ops' };

export type MenuComponentRow =
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<StringSelectMenuBuilder>
  | ActionRowBuilder<UserSelectMenuBuilder>;

export interface BuiltMenuMessage {
  embeds: EmbedBuilder[];
  components: MenuComponentRow[];
}

export interface BuiltButtonMessage {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  if (maxLen <= 1) return text.slice(0, maxLen);
  return `${text.slice(0, maxLen - 1)}…`;
}

export function makeButton(
  customId: string,
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary,
  disabled = false,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(truncateText(label, 80))
    .setStyle(style)
    .setDisabled(disabled);
}

export function buttonRow(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

export function resolveColor(defaultColor: number, feedback?: MenuFeedback): number {
  if (!feedback) return defaultColor;
  if (feedback.type === 'success') return COLORS.SUCCESS;
  if (feedback.type === 'error') return COLORS.ERROR;
  return defaultColor;
}

export function withFeedback(description: string, feedback?: MenuFeedback): string {
  if (!feedback) return truncateText(description, 4096);
  const icon = feedback.type === 'success' ? '✅' : feedback.type === 'error' ? '❌' : 'ℹ️';
  const banner = feedback.text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return truncateText(`> **${icon} 操作提示**\n${banner}\n\n${description}`, 4096);
}

export function formatRatePercent(rate: number): string {
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}
