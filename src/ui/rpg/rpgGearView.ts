import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { AppContext } from '../../core/context.js';
import {
  formatAffixList,
  formatAffixTag,
  formatLegendaryEffect,
  getReforgeCost,
  getSalvageArcaneDust,
} from '../../services/rpgAffixes.js';
import {
  MAX_ENHANCE_LEVEL,
  RARITY_ORDER,
  computeItemEffectiveStats,
  getEnhanceInfo,
  getSalvageValue,
} from '../../services/rpgService.js';
import { COLORS } from '../embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
} from '../menuShared.js';
import {
  GEAR_SLOTS_ORDER,
  RPG_RARITY_BADGE,
  RPG_SLOT_META,
  formatBpPercent,
  formatEffectiveStats,
  formatRpgItemDisplay,
  formatSuccessRate,
} from './rpgFormatters.js';
import { buildClassOnboardingView } from './rpgHomeAndClassViews.js';

export function buildRpgGearView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  selectedItemId?: number | null,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
  lockedAffixIndex?: number | null,
): BuiltMenuMessage {
  const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
  if (!character.classSelected) {
    return buildClassOnboardingView(actor, feedback);
  }

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const rpgCfg = ctx.services.rpg.getConfig(guildId);
  const economy = guildCfg.economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const items = ctx.services.rpg.listItems(guildId, actor.id);
  const stats = ctx.services.rpg.computeCombatStats(guildId, actor.id, nowMs);

  const selectedItem =
    (selectedItemId ? items.find((item) => item.id === selectedItemId) : undefined) ??
    items[0] ??
    null;

  const salvageableLowCount = items.filter(
    (item) =>
      !item.equipped && !item.locked && RARITY_ORDER[item.rarity] <= RARITY_ORDER.uncommon,
  ).length;

  const lines: string[] = [
    `${economy.currencyEmoji} 现金：**${profile.coins.toLocaleString('en-US')}** ${economy.currencyName} ｜ ✨ 奥术魔尘：**${character.arcaneDust.toLocaleString('en-US')}** ｜ 🎒 背包：**${items.length}/${rpgCfg.bagCapacity}**`,
    `⚔️ 战力：❤️ ${stats.maxHp} ｜ ⚔️ ${stats.atk} ｜ 🛡️ ${stats.def} ｜ 💥 暴击 ${formatBpPercent(stats.critBp)}`,
    '',
    '**🛡️ 已穿戴装备**',
  ];

  for (const slot of GEAR_SLOTS_ORDER) {
    const slotMeta = RPG_SLOT_META[slot];
    const eq = stats.equippedItems.find((item) => item.slot === slot);
    if (eq) {
      const eff = computeItemEffectiveStats(eq);
      const affixSummary = eq.affixes.length > 0 ? ` ｜ 词条：${formatAffixList(eq.affixes)}` : '';
      const legSummary = eq.legendaryEffect
        ? `\n  └ 🟧 ${formatLegendaryEffect(eq.legendaryEffect, false)}`
        : '';
      lines.push(
        `• ${slotMeta.emoji} ${slotMeta.label}：${formatRpgItemDisplay(eq)}（${formatEffectiveStats(eff)}${affixSummary}）${legSummary}`,
      );
    } else {
      lines.push(`• ${slotMeta.emoji} ${slotMeta.label}：*未装备*`);
    }
  }

  const components: MenuComponentRow[] = [];

  if (selectedItem) {
    const slotMeta = RPG_SLOT_META[selectedItem.slot];
    const eff = computeItemEffectiveStats(selectedItem);
    const enhanceInfo = getEnhanceInfo(selectedItem);
    const salvageVal = getSalvageValue(selectedItem);
    const salvageDust = getSalvageArcaneDust(selectedItem);

    const effectiveLockIdx =
      typeof lockedAffixIndex === 'number' &&
      Number.isInteger(lockedAffixIndex) &&
      lockedAffixIndex >= 0 &&
      lockedAffixIndex < selectedItem.affixes.length
        ? lockedAffixIndex
        : null;

    const reforgeCost = getReforgeCost(selectedItem, effectiveLockIdx !== null);
    const lockToken = effectiveLockIdx === null ? 'none' : String(effectiveLockIdx);

    let nextLockToken = 'none';
    if (selectedItem.affixes.length >= 2) {
      if (effectiveLockIdx === null) {
        nextLockToken = '0';
      } else if (effectiveLockIdx + 1 < selectedItem.affixes.length) {
        nextLockToken = String(effectiveLockIdx + 1);
      } else {
        nextLockToken = 'none';
      }
    }

    const lockCycleLabel =
      effectiveLockIdx === null ? '不锁' : `锁第${effectiveLockIdx + 1}条`;

    lines.push(
      '',
      `**🔍 当前选中：${formatRpgItemDisplay(selectedItem)}** ${selectedItem.equipped ? '✅ *[穿戴中]*' : '*[背包中]*'} ${selectedItem.locked ? '*(已锁定保护)*' : ''}`,
      `• ${slotMeta.emoji} ${slotMeta.label} ｜ **${formatEffectiveStats(eff)}**`,
      `• ✨ 随机词条：${formatAffixList(selectedItem.affixes, '无随机词条（白装不可重铸）')}`,
    );

    if (effectiveLockIdx !== null && selectedItem.affixes[effectiveLockIdx]) {
      lines.push(
        `• 🔒 重铸锁定：**第 ${effectiveLockIdx + 1} 条**（${formatAffixTag(selectedItem.affixes[effectiveLockIdx]!)}，消耗 2.5x）`,
      );
    }

    if (selectedItem.legendaryEffect) {
      lines.push(`• 🟧 神铸特效：${formatLegendaryEffect(selectedItem.legendaryEffect, true)}`);
    }

    lines.push(
      enhanceInfo
        ? `• 🔨 强化至 **+${enhanceInfo.nextLevel}**：${economy.currencyEmoji} **${enhanceInfo.cost.toLocaleString('en-US')}**（成功率 **${formatSuccessRate(enhanceInfo.successRate)}**，失败不碎）`
        : `• ✨ 已强化至满级（**+${MAX_ENHANCE_LEVEL}**）`,
      reforgeCost
        ? `• 🔮 重铸消耗：${economy.currencyEmoji} **${reforgeCost.coins.toLocaleString('en-US')}** ＋ ✨ **${reforgeCost.dust}** 魔尘${effectiveLockIdx !== null ? ' *(含锁词条 2.5x)*' : ''}`
        : '• 🔮 普通品质装备不含随机词条，无法重铸',
      `• 💰 单件拆解：${economy.currencyEmoji} **+${salvageVal.toLocaleString('en-US')}** ＋ ✨ **+${salvageDust}** 魔尘${
        selectedItem.equipped
          ? '（需先卸下）'
          : selectedItem.locked
            ? '（已上锁，解锁后可拆）'
            : ''
      }`,
    );

    const previewItems = items.slice(0, 5);
    if (items.length > 1) {
      lines.push('', `**📦 背包（前 ${previewItems.length}/${items.length} 件）**`);
      for (const item of previewItems) {
        const mark = item.id === selectedItem.id ? '👉 ' : '• ';
        const eqTag = item.equipped ? ' [穿戴]' : '';
        const itemEff = computeItemEffectiveStats(item);
        lines.push(`${mark}${formatRpgItemDisplay(item)}${eqTag} — ${formatEffectiveStats(itemEff)}`);
      }
    }

    const selectOptions = items.slice(0, 25).map((item) => {
      const itemSlot = RPG_SLOT_META[item.slot];
      const itemEff = computeItemEffectiveStats(item);
      const affixShort = item.affixes.length > 0 ? ` · ${formatAffixList(item.affixes)}` : '';
      const label = truncateText(
        `${item.equipped ? '✅' : ''}${item.locked ? '🔒' : ''}${RPG_RARITY_BADGE[item.rarity].emoji}[${RPG_RARITY_BADGE[item.rarity].label}] ${item.name}${item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : ''}`,
        80,
      );
      const desc = truncateText(`${itemSlot.label} · ${formatEffectiveStats(itemEff)}${affixShort}`, 100);
      return new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(String(item.id))
        .setDescription(desc)
        .setDefault(item.id === selectedItem.id);
    });

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('rpg:gear_select')
          .setPlaceholder('🎒 选择一件装备进行穿戴 / 强化 / 重铸 / 拆解...')
          .addOptions(selectOptions),
      ),
    );

    components.push(
      buttonRow(
        selectedItem.equipped
          ? makeButton(`rpg:gear_unequip:${selectedItem.id}`, '⬇️ 卸下', ButtonStyle.Secondary)
          : makeButton(`rpg:gear_equip:${selectedItem.id}`, '✅ 装备', ButtonStyle.Success),
        makeButton(
          `rpg:gear_enhance:${selectedItem.id}`,
          enhanceInfo ? `🔨 强化 (${enhanceInfo.cost})` : '✨ 已满级',
          ButtonStyle.Primary,
          !enhanceInfo,
        ),
        makeButton(
          `rpg:gear_lock:${selectedItem.id}`,
          selectedItem.locked ? '🔓 解锁装备' : '🔒 锁定装备',
          selectedItem.locked ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
        makeButton(
          `rpg:gear_salvage:${selectedItem.id}`,
          `💰 拆解 (+${salvageVal}/+${salvageDust}尘)`,
          ButtonStyle.Danger,
          selectedItem.equipped || selectedItem.locked,
        ),
      ),
    );

    components.push(
      buttonRow(
        makeButton(
          `rpg:gear_reforge:${selectedItem.id}:${lockToken}`,
          reforgeCost
            ? `✨ 重铸词条 (${reforgeCost.coins}币/${reforgeCost.dust}尘)`
            : '✨ 白装不可重铸',
          ButtonStyle.Primary,
          !reforgeCost,
        ),
        makeButton(
          `rpg:gear_cycle_lock:${selectedItem.id}:${nextLockToken}`,
          `🔒 锁词条切换 (${lockCycleLabel})`,
          effectiveLockIdx !== null ? ButtonStyle.Success : ButtonStyle.Secondary,
          selectedItem.affixes.length < 2,
        ),
      ),
    );

    components.push(
      buttonRow(
        makeButton('rpg:gear_equip_best', '⚡ 一键穿最强', ButtonStyle.Success),
        makeButton(
          'rpg:gear_bulk_salvage',
          salvageableLowCount > 0 ? `♻️ 一键拆白绿装 (${salvageableLowCount})` : '♻️ 一键拆白绿装',
          ButtonStyle.Danger,
          salvageableLowCount === 0,
        ),
        makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
      ),
    );
  } else {
    lines.push('', '📭 你的装备背包还是空的！快去领取挂机、速刷 Boss 或挑战深渊收集词条神装吧！');
    components.push(
      buttonRow(
        makeButton('rpg:act:raid_one', '⚔️ 速刷Boss (1体)', ButtonStyle.Success),
        makeButton('rpg:act:abyss', '💀 深渊挑战', ButtonStyle.Danger),
        makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
      ),
    );
  }

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 铁匠铺与词条重铸`, iconURL: actor.avatarUrl })
    .setTitle('🎒 装备管理、强化与词条重铸')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({
      text: '每级强化全属性 +15%（最高 +10，失败不碎）；锁定装备不会被拆解；传说橙装必带专属神铸特效',
    })
    .setTimestamp();

  return {
    embeds: [embed],
    components,
  };
}
