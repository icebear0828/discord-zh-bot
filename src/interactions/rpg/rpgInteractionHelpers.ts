import {
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type MessageCreateOptions,
} from 'discord.js';
import type { GuildConfig } from '../../config/defaults.js';
import type { AppContext } from '../../core/context.js';
import type { RpgClassKey, RpgDuelRulesMode, RpgItem } from '../../db/repositories/rpgRepo.js';
import { formatAffixList, formatLegendaryEffect } from '../../services/rpgAffixes.js';
import { computeItemEffectiveStats, type RpgRealmInfo } from '../../services/rpgService.js';
import { COLORS, createErrorEmbed } from '../../ui/embeds.js';
import { formatEffectiveStats, formatRpgItemDisplay } from '../../ui/rpgMenuBuilder.js';
import {
  resolveGameChatChannelId,
  sendPublicBroadcast,
  sendToChannel,
  type MenuSupportedInteraction,
} from '../menuHelpers.js';

export interface RpgButtonContext {
  interaction: ButtonInteraction;
  ctx: AppContext;
  guildId: string;
  cfg: GuildConfig;
  nowMs: number;
  section: string | undefined;
  arg: string | undefined;
  subArg: string | undefined;
}

const VALID_CLASS_KEYS: ReadonlySet<string> = new Set<RpgClassKey>([
  'warrior',
  'mage',
  'ranger',
  'paladin',
]);

export function isRpgClassKey(raw: string | undefined): raw is RpgClassKey {
  return typeof raw === 'string' && VALID_CLASS_KEYS.has(raw);
}

export function isDuelRulesMode(raw: string | undefined): raw is RpgDuelRulesMode {
  return raw === 'full' || raw === 'equalized';
}

export function parseLockAffixArg(raw: string | undefined): number | null {
  if (!raw || raw === 'none') return null;
  if (!/^\d+$/.test(raw)) return null;
  const num = Number(raw);
  return Number.isSafeInteger(num) && num >= 0 && num <= 2 ? num : null;
}

export async function sendToGameChat(
  interaction: MenuSupportedInteraction,
  ctx: AppContext,
  cfg: GuildConfig,
  payload: MessageCreateOptions,
): Promise<{ sent: boolean; channelId: string | null; messageId: string | null }> {
  const targetChannelId = resolveGameChatChannelId(
    interaction.guild,
    cfg,
    ctx.repos.guildConfig,
  );
  if (!targetChannelId) {
    return { sent: false, channelId: null, messageId: null };
  }
  const safePayload: MessageCreateOptions = {
    ...payload,
    allowedMentions: payload.allowedMentions ?? { parse: ['users'] },
  };
  const msgId = await sendToChannel(
    interaction.client,
    targetChannelId,
    safePayload,
    interaction.guild,
  );
  if (msgId) {
    return { sent: true, channelId: targetChannelId, messageId: msgId };
  }
  // Unit-test fallback when mock client.channels lacks cache, strictly only if current channel IS #游戏聊天
  if (targetChannelId === interaction.channelId) {
    const res = await sendPublicBroadcast(interaction, safePayload);
    return { sent: res.sent, channelId: targetChannelId, messageId: res.messageId };
  }
  return { sent: false, channelId: targetChannelId, messageId: null };
}

export function formatLootNotes(input: {
  legendaryAndEpicPreviewItems: readonly RpgItem[];
  autoSalvagedCount: number;
  autoSalvagedCoins: number;
  autoSalvagedDust?: number;
  pillsFound: number;
  elixirsFound: number;
  currencyEmoji: string;
}): string[] {
  const notes: string[] = [];
  if (input.pillsFound > 0 || input.elixirsFound > 0) {
    const parts: string[] = [];
    if (input.pillsFound > 0) parts.push(`🧪 晋升秘药×${input.pillsFound}`);
    if (input.elixirsFound > 0) parts.push(`🛡️ 护魂圣水×${input.elixirsFound}`);
    notes.push(`⚗️ 炼金收获：${parts.join('、')}`);
  }
  if (input.legendaryAndEpicPreviewItems.length > 0) {
    const preview = input.legendaryAndEpicPreviewItems
      .slice(0, 3)
      .map((item) => {
        const legTag = item.legendaryEffect
          ? ` ${formatLegendaryEffect(item.legendaryEffect, false)}`
          : '';
        return `${formatRpgItemDisplay(item)}${legTag}`;
      })
      .join('、');
    const extra =
      input.legendaryAndEpicPreviewItems.length > 3
        ? ` 等共 **${input.legendaryAndEpicPreviewItems.length}** 件`
        : '';
    notes.push(`🎁 获得装备：${preview}${extra}`);
  }
  if (input.autoSalvagedCount > 0) {
    const dustPart =
      input.autoSalvagedDust && input.autoSalvagedDust > 0
        ? ` / ✨ +${input.autoSalvagedDust} 魔尘`
        : '';
    notes.push(
      `♻️ 背包满自动分解 **${input.autoSalvagedCount}** 件多余装备（+${input.autoSalvagedCoins} ${input.currencyEmoji}${dustPart}）`,
    );
  }
  return notes;
}

export function buildLegendaryDropPublicEmbed(input: {
  userId: string;
  sourceLabel: string;
  legendaryDrops: readonly RpgItem[];
  realm: RpgRealmInfo;
}): EmbedBuilder {
  const dropLines = input.legendaryDrops.slice(0, 3).map((item) => {
    const effStr = formatEffectiveStats(computeItemEffectiveStats(item));
    const affixStr = item.affixes.length > 0 ? ` ｜ ${formatAffixList(item.affixes)}` : '';
    const legStr = item.legendaryEffect
      ? `\n> 🟧 ${formatLegendaryEffect(item.legendaryEffect, true)}`
      : '';
    return `> ${formatRpgItemDisplay(item)}（${effStr}${affixStr}）${legStr}`;
  });
  return new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle('🟧 传说神装降临 · 欧皇闪耀全服！')
    .setDescription(
      [
        `🎊 <@${input.userId}>（${input.realm.fullLabel}）在 **${input.sourceLabel}** 中斩获传说级橙装！`,
        '',
        '**🟧 传说掉落：**',
        ...dropLines,
      ].join('\n'),
    )
    .setTimestamp();
}

export function buildBreakthroughCelebrationEmbed(input: {
  userId: string;
  fromRealm: RpgRealmInfo;
  toRealm: RpgRealmInfo;
  grossCoins: number;
  currencyEmoji: string;
  currencyName: string;
  isPublicTrial: boolean;
  supportersCount?: number;
}): EmbedBuilder {
  const descLines = [
    `🎊 恭喜 <@${input.userId}> 冲破重重雷劫，正式从 **${input.fromRealm.fullLabel}** 晋升为 **${input.toRealm.fullLabel}**！`,
    `${input.currencyEmoji} 晋升赏金：**+${input.grossCoins.toLocaleString('en-US')}** ${input.currencyName} ｜ 🔓 已解锁全新挂机秘境「**${input.toRealm.tierDef.zoneEmoji} ${input.toRealm.tierDef.zoneName}**」！`,
  ];
  if (input.isPublicTrial && input.supportersCount && input.supportersCount > 0) {
    descLines.push(`🍬 **${input.supportersCount}** 位助威战友共同分享了晋升喜糖！`);
  }
  return new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle('⚡ 境界晋升喜报 · 强者诞生！')
    .setDescription(descLines.join('\n'))
    .setTimestamp();
}

export async function replyModuleDisabled(interaction: MenuSupportedInteraction): Promise<void> {
  await interaction.reply({
    embeds: [
      createErrorEmbed(
        '🚫 模块未开启',
        '当前服务器已关闭 **奇幻RPG秘境** 模块，请联系管理员通过 `/菜单` → 管理后台或 `/设置 开关模块` 开启。',
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
