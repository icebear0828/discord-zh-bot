import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { ShopItem, ShopItemType } from '../db/repositories/shopRepo.js';
import type { BlackjackGame } from '../services/blackjackService.js';
import type { DiceChoice } from '../services/economyService.js';
import type { InteractionAction } from '../services/funService.js';
import type { LeaderboardType } from '../services/levelingService.js';
import {
  DEFAULT_STAT_BOOST_DAILY_LIMIT,
  parsePetXpPayload,
  parseStatBoostPayload,
  type BuyFailureReason,
} from '../services/shopService.js';
import { COLORS, formatDurationZh } from './embeds.js';

export interface MenuActor {
  id: string;
  displayName: string;
  avatarUrl: string;
  isAdmin?: boolean;
  roleIds?: readonly string[];
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
  | { page: 'self_roles'; panelId?: number }
  | { page: 'leaderboard'; lbType: LeaderboardType; lbPage: number }
  | { page: 'admin' }
  | { page: 'admin_econ' }
  | { page: 'admin_lvl' }
  | { page: 'admin_lvl_rewards' }
  | { page: 'admin_roles'; panelId?: number }
  | { page: 'admin_shop' }
  | { page: 'admin_games' }
  | { page: 'admin_mod' }
  | { page: 'admin_ops' };

export type MenuComponentRow =
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<RoleSelectMenuBuilder>
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

export function formatShopItemTag(
  item: ShopItem,
  statName: string,
  statUnit: string,
  compact = false,
): string {
  if (item.type === 'role') {
    return compact ? '身份组奖励' : `身份组 <@&${item.roleId}>`;
  }
  if (item.type === 'title') {
    return `称号「${item.titleText ?? item.name}」`;
  }
  if (item.type === 'xp_boost') {
    const mult = item.boostMultiplier ?? 1.5;
    if (compact) return `经验卡 ${mult}x`;
    return `经验卡 ${mult}x (${formatDurationZh((item.boostDurationSec ?? 3600) * 1000)})`;
  }
  if (item.type === 'stat_boost') {
    const p = parseStatBoostPayload(item.payloadJson);
    return compact
      ? `${statName} +${p.minGain}~${p.maxGain} ${statUnit}（日限${p.dailyLimit}次）`
      : `买即生效 · ${statName} +${p.minGain}~${p.maxGain} ${statUnit}（含暴击/微反噬，日限 ${p.dailyLimit} 次）`;
  }
  if (item.type === 'custom_title') {
    return compact ? '自定义专属称号券（1~20字）' : '自拟 1~20 字专属称号并立即佩戴';
  }
  if (item.type === 'pet_xp') {
    const { petXp } = parsePetXpPayload(item.payloadJson);
    return compact ? `出战宠物 +${petXp} XP` : `买即生效 · 出战宠物 +${petXp} XP`;
  }
  return compact ? '神秘幸运盲盒（5%超级大奖）' : '买即开箱 · 返币/经验卡/黑市道具/成长暴涨';
}

export function formatInventoryTypeLabel(itemType: ShopItemType): string {
  if (itemType === 'xp_boost') return '经验加成卡';
  if (itemType === 'custom_title') return '自定义称号券';
  return '专属称号';
}

export function formatShopBuyError(
  reason: BuyFailureReason,
  currencyName: string,
  dailyLimit?: number,
): string {
  const limit = dailyLimit ?? DEFAULT_STAT_BOOST_DAILY_LIMIT;
  const map: Record<BuyFailureReason, string> = {
    not_found: '该商品不存在或已被管理员下架。',
    out_of_stock: '该商品已售罄。',
    insufficient_funds: `你的口袋 ${currencyName} 余额不足！`,
    already_owned: '你已经拥有该专属称号了，无需重复购买。',
    daily_limit_reached: `今日成长药水/增幅道具使用已达上限（每日共限 **${limit}** 次），请明天再来！`,
    no_active_pet: '你当前没有出战宠物，请先前往「🐾 宠物屋」抽取并设置出战宠物（本次未扣款）。',
    invalid_title: '自定义称号需在 1 ~ 20 个字之间，请重新输入（本次未扣款）。',
  };
  return map[reason];
}
