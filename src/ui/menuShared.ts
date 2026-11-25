import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  type EmbedBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { ShopItem, ShopItemType } from '../db/repositories/shopRepo.js';
import type { BlackjackGame } from '../services/blackjackService.js';
import type { DiceChoice, RobTargetHints } from '../services/economyService.js';
import type { InteractionAction } from '../services/funService.js';
import type { LeaderboardType } from '../services/levelingService.js';
import {
  DEFAULT_STAT_BOOST_DAILY_LIMIT,
  parseCpAffinityPayload,
  parseCreditBoostPayload,
  parsePetXpPayload,
  parseRolePayload,
  parseRpgSupplyPayload,
  parseStatBoostPayload,
  type BuyFailureReason,
} from '../services/shopService.js';
import { COLORS, formatDurationZh } from './embeds.js';

export interface MenuActor {
  id: string;
  displayName: string;
  avatarUrl: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  roleIds?: readonly string[];
  hints?: RobTargetHints;
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
  | { page: 'credit' }
  | { page: 'loan' }
  | { page: 'hustle' }
  | { page: 'rpg' }
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
  | { page: 'shop'; listPage?: number }
  | { page: 'bag'; listPage?: number }
  | { page: 'rank' }
  | { page: 'self_roles'; panelId?: number; panelPage?: number }
  | { page: 'leaderboard'; lbType: LeaderboardType; lbPage: number }
  | { page: 'admin' }
  | { page: 'admin_econ'; confirmReset?: boolean }
  | { page: 'admin_lvl'; confirmReset?: boolean }
  | { page: 'admin_lvl_rewards'; listPage?: number }
  | {
      page: 'admin_roles';
      panelId?: number;
      panelPage?: number;
      optPage?: number;
      confirmDeletePanelId?: number;
    }
  | { page: 'admin_shop'; listPage?: number; confirmDeleteItemId?: number }
  | { page: 'admin_games' }
  | { page: 'admin_mod' }
  | { page: 'admin_ops' }
  | { page: 'admin_ai'; tab?: 'basic' | 'channels' }
  | { page: 'admin_credit_rpg' }
  | { page: 'admin_monitor'; filter?: 'issues' | 'all'; confirmClear?: boolean };

export const MENU_SELECT_PAGE_SIZE = 20;

export function paginateSlice<T>(
  items: readonly T[],
  requestedPage: number | undefined,
  pageSize = MENU_SELECT_PAGE_SIZE,
): {
  slice: T[];
  page: number;
  totalPages: number;
  startIndex: number;
} {
  const safeSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safeSize));
  const page = Math.max(1, Math.min(totalPages, Math.floor(requestedPage ?? 1)));
  const startIndex = (page - 1) * safeSize;
  return {
    slice: items.slice(startIndex, startIndex + safeSize),
    page,
    totalPages,
    startIndex,
  };
}

export type MenuComponentRow =
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<ChannelSelectMenuBuilder>
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
    const { requiredRoleId } = parseRolePayload(item.payloadJson);
    if (compact) {
      return requiredRoleId ? '身份组奖励（需前置身份组）' : '身份组奖励';
    }
    return requiredRoleId
      ? `身份组 <@&${item.roleId}>（需先有 <@&${requiredRoleId}>）`
      : `身份组 <@&${item.roleId}>`;
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
  if (item.type === 'credit_boost') {
    const p = parseCreditBoostPayload(item.payloadJson);
    return compact
      ? `信用修复 +${p.creditGain} 分（日限${p.dailyLimit}次）`
      : `买即生效 · 信用分 +${p.creditGain}（封顶 1000，日限 ${p.dailyLimit} 次）`;
  }
  if (item.type === 'rpg_supply') {
    const p = parseRpgSupplyPayload(item.payloadJson);
    const rarityLabelMap: Record<string, string> = {
      common: '白装+',
      uncommon: '绿装+',
      rare: '蓝装+',
      epic: '紫装+',
      legendary: '传说橙装',
    };
    const parts: string[] = [];
    if (p.staminaGain > 0) parts.push(`体力+${p.staminaGain}`);
    if (p.lootBox) parts.push(`必出${rarityLabelMap[p.minRarity] ?? '蓝装+'}`);
    const summary = parts.join(' + ') || '地牢补给';
    return compact ? `RPG补给 · ${summary}` : `买即生效 · 西幻RPG ${summary}`;
  }
  if (item.type === 'cp_affinity') {
    const p = parseCpAffinityPayload(item.payloadJson);
    return compact ? `CP亲密度 +${p.affinityGain}` : `买即生效 · 结婚/结拜 CP 亲密度 +${p.affinityGain}`;
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
  requiredRoleId?: string,
): string {
  const limit = dailyLimit ?? DEFAULT_STAT_BOOST_DAILY_LIMIT;
  const map: Record<BuyFailureReason, string> = {
    not_found: '该商品不存在或已被管理员下架。',
    out_of_stock: '该商品已售罄。',
    insufficient_funds: `你的口袋 ${currencyName} 余额不足！`,
    already_owned: '你已经拥有该专属称号或身份组了，无需重复购买。',
    daily_limit_reached: `今日该类限购道具使用已达上限（每日限 **${limit}** 次），请明天再来！`,
    no_active_pet: '你当前没有出战宠物，请先前往「🐾 宠物屋」抽取并设置出战宠物（本次未扣款）。',
    invalid_title: '自定义称号需在 1 ~ 20 个字之间，请重新输入（本次未扣款）。',
    missing_required_role: requiredRoleId
      ? `需先拥有前置身份组 <@&${requiredRoleId}> 才可购买此商品（本次未扣款）。`
      : '尚未满足该身份组的前置条件（本次未扣款）。',
    credit_already_max: '你的信用分已达到 **1000** 满分上限，无需再使用信用修复道具（本次未扣款）。',
    no_rpg_character: '你尚未创建西幻 RPG 冒险角色，请先打开「⚔️ 西幻冒险」选择职业后再购买（本次未扣款）。',
    rpg_bag_full: '你的西幻 RPG 装备背包已满，请先前往「⚔️ 西幻冒险 → 🎒 背包」分解或清理装备后再买（本次未扣款）。',
    no_relationship: '你当前尚未绑定结婚或结拜 CP 关系，请先前往「💞 关系与CP」建立关系后再购买（本次未扣款）。',
  };
  return map[reason];
}
