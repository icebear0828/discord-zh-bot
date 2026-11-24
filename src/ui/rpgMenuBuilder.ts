import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { RpgItem, RpgItemRarity, RpgItemSlot } from '../db/repositories/rpgRepo.js';
import {
  FLOORS_PER_CHAPTER,
  MAX_ENHANCE_LEVEL,
  RARITY_META,
  RARITY_ORDER,
  RPG_CHAPTER_MAP,
  RPG_CHAPTERS,
  RPG_CLASS_MAP,
  RPG_CLASSES,
  TABLETOP_CATALOG,
  computeItemEffectiveStats,
  getEnhanceInfo,
  getSalvageValue,
  xpNeededForRpgLevel,
  type EffectiveItemStats,
  type TabletopRollOutcome,
} from '../services/rpgService.js';
import { TABLETOP_STAT_META } from '../services/rpgTabletopCatalog.js';
import {
  computeChoicePreview,
  getCreditTierLabel,
  getCurrentTabletopView,
  type TabletopChoiceDef,
  type TabletopChoicePreview,
} from '../services/rpgTabletopCore.js';
import { COLORS, renderProgressBar, type AppContext } from './embeds.js';
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
} from './menuShared.js';

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

const GEAR_SLOTS_ORDER: readonly RpgItemSlot[] = ['weapon', 'armor', 'accessory'];
const CHOICE_NUM_EMOJIS: readonly string[] = ['1️⃣', '2️⃣', '3️⃣'];

export function formatBpPercent(bp: number): string {
  return `${(bp / 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export function formatTabletopModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
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
  return `${formatRpgRarityTag(item.rarity)} **${item.name}**${enhanceTag}`;
}

function formatSuccessRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatCompactGearItem(item: RpgItem | undefined): string {
  if (!item) return '空';
  const badge = RPG_RARITY_BADGE[item.rarity];
  const enh = item.enhanceLevel > 0 ? `+${item.enhanceLevel}` : '';
  return `${badge.emoji}${item.name}${enh}`;
}

function buildClassOnboardingView(
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const classLines = RPG_CLASSES.map((c) =>
    [
      `${c.emoji} **${c.name}** — ${c.description}`,
      `> ❤️ HP ${c.baseHp} ｜ ⚔️ ATK ${c.baseAtk} ｜ 🛡️ DEF ${c.baseDef} ｜ ✨ 招牌技「**${c.skillName}**」`,
    ].join('\n'),
  );

  const description = [
    '欢迎踏入艾尔登西亚西幻地下城！挑选你的初始职业，即可免费开启 **博德跑团（D20）** 与 **经典回合制** 双模式 **6 大章节** 冒险：',
    '',
    ...classLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 冒险者公会登记`, iconURL: actor.avatarUrl })
    .setTitle('🏰 西幻地下城冒险 · 选择你的初始职业')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '首次选择职业完全免费，之后可随时在冒险大厅消耗星币转职' })
    .setTimestamp();

  const classButtons = RPG_CLASSES.map((c) =>
    makeButton(`rpg:pick_class:${c.key}`, `${c.emoji} ${c.name}`, ButtonStyle.Primary),
  );

  return {
    embeds: [embed],
    components: [
      buttonRow(...classButtons),
      buttonRow(makeButton('menu:nav:home', '🔙 返回主菜单', ButtonStyle.Secondary)),
    ],
  };
}

export function buildRpgHomeView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
  if (!character.classSelected) {
    return buildClassOnboardingView(actor, feedback);
  }

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const rpgCfg = ctx.services.rpg.getConfig(guildId);
  const economy = guildCfg.economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const stats = ctx.services.rpg.computeCombatStats(guildId, actor.id, nowMs);
  const attrs = ctx.services.rpg.getTabletopAttributes(guildId, actor.id, nowMs);
  const creditScore = ctx.services.rpg.getUserCreditScore(guildId, actor.id);
  const activeTabletopRun = ctx.services.rpg.getActiveTabletopRun(guildId, actor.id);
  const activeClassicRun = activeTabletopRun
    ? null
    : ctx.services.rpg.getActiveRun(guildId, actor.id);
  const hasActiveRun = Boolean(activeTabletopRun || activeClassicRun);
  const classDef = RPG_CLASS_MAP.get(character.classKey) ?? RPG_CLASSES[0]!;
  const needXp = xpNeededForRpgLevel(character.level);
  const xpRatio = character.xp / Math.max(1, needXp);
  const potionBuysLeft = Math.max(0, rpgCfg.staminaPotionDailyLimit - character.staminaBuysToday);

  const lines: string[] = [];

  if (activeTabletopRun) {
    const chDef = RPG_CHAPTER_MAP.get(activeTabletopRun.chapter);
    const stageText =
      activeTabletopRun.bossStage > 0
        ? `👑 终幕 Boss 阶段 ${activeTabletopRun.bossStage}/2`
        : `第 **${activeTabletopRun.act}/5** 幕`;
    lines.push(
      `🎲 **进行中的博德跑团**：${chDef?.emoji ?? '🎲'} 第 ${activeTabletopRun.chapter} 章「**${chDef?.name ?? `章节#${activeTabletopRun.chapter}`}**」· ${stageText}`,
      `> ❤️ HP **${activeTabletopRun.playerHp}/${activeTabletopRun.playerMaxHp}** ｜ 🎒 暂存 ${economy.currencyEmoji} **${activeTabletopRun.pendingCoins.toLocaleString('en-US')}** / 🎁 **${activeTabletopRun.pendingItems.length}** 装 ｜ 🧪 药水×**${activeTabletopRun.potionsLeft}**`,
      '',
    );
  } else if (activeClassicRun) {
    const chDef = RPG_CHAPTER_MAP.get(activeClassicRun.chapter);
    lines.push(
      `⚔️ **进行中的地下城冒险**：${chDef?.emoji ?? '⚔️'} 第 ${activeClassicRun.chapter} 章「**${chDef?.name ?? `章节#${activeClassicRun.chapter}`}**」· 第 **${activeClassicRun.floor}/${FLOORS_PER_CHAPTER}** 层`,
      `> ❤️ HP **${activeClassicRun.playerHp}/${activeClassicRun.playerMaxHp}** ｜ 🎒 暂存 ${economy.currencyEmoji} **${activeClassicRun.pendingCoins.toLocaleString('en-US')}** / 🎁 **${activeClassicRun.pendingItems.length}** 装 ｜ 🧪 药水×**${activeClassicRun.potionsLeft}**`,
      '',
    );
  }

  lines.push(
    `${classDef.emoji} **${classDef.name}** · **Lv.${character.level}** \`${renderProgressBar(xpRatio, 8)}\` **${character.xp}/${needXp} XP**`,
    `⚡ 体力 **${character.stamina}/${rpgCfg.dailyStamina}**（药水 ${economy.currencyEmoji}${rpgCfg.staminaPotionPrice}，余 ${potionBuysLeft}） ｜ 🗺️ 进度 **${character.maxChapterCleared} / ${RPG_CHAPTERS.length}** 章 ｜ 🏆 通关 **${character.totalClears}**`,
    `${economy.currencyEmoji} 现金 **${profile.coins.toLocaleString('en-US')}** ${economy.currencyName} ｜ ❤️ ${stats.maxHp} · ⚔️ ${stats.atk} · 🛡️ ${stats.def}`,
    '',
    `⚔️ 武力 **${formatTabletopModifier(attrs.mightMod)}** ｜ 🔮 奥术 **${formatTabletopModifier(attrs.arcanaMod)}** ｜ 🗡️ 灵巧 **${formatTabletopModifier(attrs.agilityMod)}** ｜ 🛡️ 魅力 **${formatTabletopModifier(attrs.charmMod)}**`,
  );

  const bonusTags: string[] = [];
  if (attrs.creditCharmBonus !== 0) {
    const creditEmoji = attrs.creditCharmBonus > 0 ? '👑' : '⚠️';
    bonusTags.push(
      `${creditEmoji} ${getCreditTierLabel(creditScore)}${formatTabletopModifier(attrs.creditCharmBonus)}`,
    );
  }
  if (stats.petSynergy) {
    bonusTags.push(
      `🐾 ${stats.petSynergy.emoji}${stats.petSynergy.nickname}+${attrs.petCheckBonus}`,
    );
  }
  if (bonusTags.length > 0) {
    lines.push(`✨ 跑团加成：${bonusTags.join(' · ')}`);
  }

  const weaponEq = stats.equippedItems.find((i) => i.slot === 'weapon');
  const armorEq = stats.equippedItems.find((i) => i.slot === 'armor');
  const accessoryEq = stats.equippedItems.find((i) => i.slot === 'accessory');
  lines.push(
    `🎒 装备：🗡️ ${formatCompactGearItem(weaponEq)} · 🛡️ ${formatCompactGearItem(armorEq)} · 💍 ${formatCompactGearItem(accessoryEq)}`,
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 西幻地下城冒险大厅`, iconURL: actor.avatarUrl })
    .setTitle(`🏰 ${classDef.emoji} ${classDef.name} · 勇者档案`)
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '首通章节、传说橙装与博德跑团自然20/自然1名场面将触发全服播报！' })
    .setTimestamp();

  const row1 = hasActiveRun
    ? buttonRow(
        activeTabletopRun
          ? makeButton('rpg:nav:tabletop_run', '🎲 继续博德跑团', ButtonStyle.Success)
          : makeButton('rpg:nav:run', '⚔️ 继续经典冒险', ButtonStyle.Success),
        makeButton('rpg:nav:gear', '🎒 装备与强化', ButtonStyle.Primary),
        makeButton('rpg:act:buy_stamina', '🧪 体力药水', ButtonStyle.Secondary, potionBuysLeft <= 0),
        makeButton('rpg:nav:class', '🔄 转职', ButtonStyle.Secondary, true),
      )
    : buttonRow(
        makeButton('rpg:nav:chapters:tabletop', '🎲 博德跑团（推荐）', ButtonStyle.Success),
        makeButton('rpg:nav:chapters:classic', '⚔️ 经典战斗', ButtonStyle.Primary),
        makeButton('rpg:nav:gear', '🎒 装备与强化', ButtonStyle.Primary),
        makeButton('rpg:act:buy_stamina', '🧪 体力药水', ButtonStyle.Secondary, potionBuysLeft <= 0),
        makeButton('rpg:nav:class', '🔄 转职', ButtonStyle.Secondary),
      );

  const row2 = buttonRow(
    makeButton('menu:rank:rpg:1', '🏆 西幻RPG榜', ButtonStyle.Primary),
    makeButton('rpg:nav:home', '🔄 刷新', ButtonStyle.Secondary),
    makeButton('menu:nav:home', '🔙 返回主菜单', ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [row1, row2],
  };
}

export function buildRpgChaptersView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
  mode: 'tabletop' | 'classic' = 'tabletop',
): BuiltMenuMessage {
  const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
  if (!character.classSelected) {
    return buildClassOnboardingView(actor, feedback);
  }

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const rpgCfg = ctx.services.rpg.getConfig(guildId);
  const economy = guildCfg.economy;
  const activeMode = ctx.services.rpg.getAnyActiveRunMode(guildId, actor.id);
  const hasActiveRun = activeMode !== null;
  const maxUnlocked = Math.min(RPG_CHAPTERS.length, character.maxChapterCleared + 1);

  const lines: string[] = [
    mode === 'tabletop'
      ? '🎲 **博德跑团模式**：5 幕沉浸剧情 + D20 检定 + 信用/战宠特权 + 双阶段首领（首通 2x 赏金 & +25 信用分）'
      : '⚔️ **经典战斗模式**：5 层回合制地下城 + 职业技能 + 战宠追击（首通 2x 赏金 & +25 信用分）',
    `⚡ 体力 **${character.stamina}/${rpgCfg.dailyStamina}**（消耗 1 体力） ｜ 勇者 **Lv.${character.level}**`,
  ];

  if (hasActiveRun) {
    lines.push(
      `> ⚠️ 你已有进行中的${activeMode === 'tabletop' ? '博德跑团' : '经典冒险'}，请先继续或撤退当前进度。`,
    );
  }

  lines.push('');

  for (const ch of RPG_CHAPTERS) {
    const cleared = ch.chapter <= character.maxChapterCleared;
    const unlocked = ch.chapter <= maxUnlocked;
    const statusIcon = cleared ? '✅' : unlocked ? '🔓首通2x' : '🔒';
    const rewardCoins = cleared
      ? ch.clearBaseCoins
      : Math.round(ch.clearBaseCoins * ch.firstClearMultiplier);
    lines.push(
      `${ch.emoji} **第${ch.chapter}章 ${ch.name}** · ${statusIcon} · Lv.${ch.recommendedLevel} · ${ch.boss.emoji}${ch.boss.name} · ${economy.currencyEmoji}${rewardCoins.toLocaleString('en-US')}`,
    );
  }

  const embed = new EmbedBuilder()
    .setColor(resolveColor(mode === 'tabletop' ? COLORS.FUN : COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 地下城世界地图`, iconURL: actor.avatarUrl })
    .setTitle(mode === 'tabletop' ? '🎲 选择博德跑团章节' : '⚔️ 选择经典战斗章节')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '两种模式共享章节进度、角色等级与装备库；通关后自动解锁下一章' })
    .setTimestamp();

  const startPrefix = mode === 'tabletop' ? 'rpg:start_tt' : 'rpg:start';
  const makeChapterButton = (ch: (typeof RPG_CHAPTERS)[number]) => {
    const unlocked = ch.chapter <= maxUnlocked;
    const cleared = ch.chapter <= character.maxChapterCleared;
    const style = !unlocked
      ? ButtonStyle.Secondary
      : cleared
        ? ButtonStyle.Primary
        : ButtonStyle.Success;
    const prefix = unlocked ? ch.emoji : '🔒';
    return makeButton(
      `${startPrefix}:${ch.chapter}`,
      `${prefix} 第${ch.chapter}章 ${ch.name}`,
      style,
      !unlocked || hasActiveRun,
    );
  };

  const row1 = buttonRow(...RPG_CHAPTERS.slice(0, 3).map(makeChapterButton));
  const row2 = buttonRow(...RPG_CHAPTERS.slice(3, 6).map(makeChapterButton));

  const navButtons = [
    ...(activeMode === 'tabletop'
      ? [makeButton('rpg:nav:tabletop_run', '🎲 继续跑团', ButtonStyle.Success)]
      : activeMode === 'classic'
        ? [makeButton('rpg:nav:run', '⚔️ 继续战斗', ButtonStyle.Success)]
        : []),
    mode === 'tabletop'
      ? makeButton('rpg:nav:chapters:classic', '⚔️ 切换经典战斗', ButtonStyle.Primary)
      : makeButton('rpg:nav:chapters:tabletop', '🎲 切换博德跑团', ButtonStyle.Success),
    makeButton('rpg:act:buy_stamina', '🧪 买体力药水', ButtonStyle.Secondary),
    makeButton('rpg:nav:home', '🔙 返回大厅', ButtonStyle.Secondary),
  ];

  return {
    embeds: [embed],
    components: [row1, row2, buttonRow(...navButtons)],
  };
}

function formatOutcomeBlockquote(
  outcome: TabletopRollOutcome,
  currencyEmoji: string,
  currencyName: string,
): string[] {
  const modStr = formatTabletopModifier(outcome.modifier);
  let header: string;
  if (outcome.outcome === 'crit_success') {
    header = `> 🌟 **自然20大成功！** D20(**20**)${modStr} vs DC ${outcome.dc ?? '-'} ·「${outcome.choiceLabel}」`;
  } else if (outcome.outcome === 'crit_fail') {
    header = `> 💀 **自然1大失败！** D20(**1**)${modStr} vs DC ${outcome.dc ?? '-'} ·「${outcome.choiceLabel}」`;
  } else if (outcome.outcome === 'auto') {
    header = outcome.stat
      ? `> 👑 **金卡刷脸 · 免检通过**「${outcome.choiceLabel}」`
      : `> 💰 **金币开道 · 免检通过**「${outcome.choiceLabel}」`;
  } else if (outcome.outcome === 'success') {
    header = `> 🎲 **D20 检定成功**（掷出 **${outcome.rolled}**${modStr} = **${outcome.total}** ≥ DC ${outcome.dc ?? '-'}）·「${outcome.choiceLabel}」`;
  } else {
    header = `> 🎲 **D20 检定失利**（掷出 **${outcome.rolled}**${modStr} = **${outcome.total}** < DC ${outcome.dc ?? '-'}）·「${outcome.choiceLabel}」`;
  }

  const block: string[] = [header, `> ${outcome.narrative}`];
  if (outcome.petLine) {
    block.push(`> ${outcome.petLine}`);
  }

  const deltas: string[] = [];
  if (outcome.coinsDelta > 0) {
    deltas.push(`${currencyEmoji} +${outcome.coinsDelta.toLocaleString('en-US')} ${currencyName}`);
  } else if (outcome.coinsDelta < 0) {
    deltas.push(`${currencyEmoji} ${outcome.coinsDelta.toLocaleString('en-US')} ${currencyName}`);
  }
  if (outcome.xpDelta > 0) {
    deltas.push(`✨ +${outcome.xpDelta} XP`);
  }
  if (outcome.hpDelta > 0) {
    deltas.push(`💚 +${outcome.hpDelta} HP`);
  } else if (outcome.hpDelta < 0) {
    deltas.push(`❤️ ${outcome.hpDelta} HP`);
  }
  if (outcome.itemDroppedLabel) {
    deltas.push(`🎁 ${outcome.itemDroppedLabel}`);
  }
  if (deltas.length > 0) {
    block.push(`> ${deltas.join(' · ')}`);
  }

  return block;
}

function formatChoiceLine(
  index: number,
  choice: TabletopChoiceDef,
  preview: TabletopChoicePreview,
): string {
  const numEmoji = CHOICE_NUM_EMOJIS[index] ?? `${index + 1}.`;
  let tag: string;
  if (preview.creditPerkActive && preview.autoSuccess) {
    tag = `【👑 ${preview.creditPerkTag ?? '金卡刷脸'} 100%】`;
  } else if (preview.autoSuccess && preview.coinCost > 0) {
    const affordNote = preview.canAfford ? '必过' : '余额不足';
    tag = `【💰 贿赂 -${preview.coinCost.toLocaleString('en-US')} · ${affordNote}】`;
  } else if (preview.autoSuccess) {
    tag = '【✨ 必过 100%】';
  } else {
    const meta = TABLETOP_STAT_META[preview.stat ?? 'might'];
    const extras: string[] = [];
    if (preview.creditPerkTag) extras.push(preview.creditPerkTag);
    if (choice.requiredClass) extras.push('职业专属');
    if (choice.weakenBoss) extras.push('破防');
    const suffix = extras.length > 0 ? ` · ${extras.join('/')}` : '';
    tag = `【${meta.emoji} ${meta.label} ${preview.successChancePct}%${suffix}】`;
  }

  return `${numEmoji} ${tag} **${choice.label}** — ${choice.detail}`;
}

function buildChoiceButton(
  index: number,
  choice: TabletopChoiceDef,
  preview: TabletopChoicePreview,
) {
  let label: string;
  let style: ButtonStyle;
  if (preview.creditPerkActive && preview.autoSuccess) {
    label = `👑 ${choice.label} (100%)`;
    style = ButtonStyle.Success;
  } else if (preview.autoSuccess && preview.coinCost > 0) {
    label = preview.canAfford
      ? `💰 ${choice.label} (-${preview.coinCost.toLocaleString('en-US')})`
      : `💰 ${choice.label} (币不足)`;
    style = preview.canAfford ? ButtonStyle.Success : ButtonStyle.Secondary;
  } else if (preview.autoSuccess) {
    label = `✨ ${choice.label} (100%)`;
    style = ButtonStyle.Success;
  } else {
    const meta = TABLETOP_STAT_META[preview.stat ?? 'might'];
    label = `${meta.emoji} ${choice.label} (${preview.successChancePct}%)`;
    style =
      choice.requiredClass || choice.weakenBoss || index === 0
        ? ButtonStyle.Primary
        : ButtonStyle.Secondary;
  }

  return makeButton(`rpg:tt_choice:${choice.id}`, truncateText(label, 80), style);
}

export function buildRpgTabletopRunView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const run = ctx.services.rpg.getActiveTabletopRun(guildId, actor.id);
  if (!run) {
    return buildRpgHomeView(ctx, guildId, actor, feedback, nowMs);
  }

  const currentView = getCurrentTabletopView(run, TABLETOP_CATALOG);
  if (!currentView) {
    return buildRpgHomeView(ctx, guildId, actor, feedback, nowMs);
  }

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const economy = guildCfg.economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const chapterDef = RPG_CHAPTER_MAP.get(run.chapter);

  const lines: string[] = [];

  if (run.lastOutcome) {
    lines.push(
      ...formatOutcomeBlockquote(run.lastOutcome, economy.currencyEmoji, economy.currencyName),
      '',
    );
  }

  const sceneHeader =
    run.bossStage > 0
      ? `👑 **终幕 Boss（阶段 ${run.bossStage}/2）· ${currentView.title}**${run.bossStage === 2 && run.bossWeakened ? ' *(已破防 DC-3)*' : ''}`
      : `${currentView.emoji} **第 ${run.act}/5 幕 · ${currentView.title}**`;

  lines.push(sceneHeader, '', currentView.narrative, '');

  const previews = currentView.choices.map((choice) =>
    computeChoicePreview({
      choice,
      attrs: run.attrs,
      creditScore: run.creditScore,
      pocketCoins: profile.coins,
      chapter: run.chapter,
      bossStage: run.bossStage,
      bossWeakened: run.bossWeakened,
    }),
  );

  currentView.choices.forEach((choice, idx) => {
    lines.push(formatChoiceLine(idx, choice, previews[idx]!));
  });

  lines.push(
    '',
    `❤️ HP **${run.playerHp}/${run.playerMaxHp}** ｜ 🎒 暂存 **${run.pendingCoins.toLocaleString('en-US')}** 币 / **${run.pendingItems.length}** 装 ｜ 🧪 药水×**${run.potionsLeft}**`,
  );

  const embedColor =
    run.bossStage > 0
      ? COLORS.ERROR
      : run.lastOutcome?.outcome === 'crit_success'
        ? COLORS.GOLD
        : run.lastOutcome?.outcome === 'crit_fail'
          ? COLORS.ERROR
          : COLORS.FUN;

  const embed = new EmbedBuilder()
    .setColor(resolveColor(embedColor, feedback))
    .setAuthor({
      name: `${actor.displayName} · 博德跑团中`,
      iconURL: actor.avatarUrl,
    })
    .setTitle(
      `${chapterDef?.emoji ?? '🎲'} 第 ${run.chapter} 章「${chapterDef?.name ?? `章节#${run.chapter}`}」`,
    )
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '掷出 20 战利品翻倍全服高光 ｜ 掷出 1 触发社死反噬 ｜ 随时可撤退保底' })
    .setTimestamp();

  const choiceButtons = currentView.choices.map((choice, idx) =>
    buildChoiceButton(idx, choice, previews[idx]!),
  );

  const actionRow2 = buttonRow(
    makeButton(
      'rpg:tt_act:potion',
      `🧪 喝药 (余${run.potionsLeft})`,
      ButtonStyle.Secondary,
      run.potionsLeft <= 0 || run.playerHp >= run.playerMaxHp,
    ),
    makeButton('rpg:tt_share', '📢 晒出名场面', ButtonStyle.Primary),
    makeButton('rpg:tt_act:retreat', '🏃 撤退保底', ButtonStyle.Danger),
    makeButton('rpg:nav:home', '🏰 暂离大厅', ButtonStyle.Secondary),
  );

  const components: MenuComponentRow[] = [];
  if (choiceButtons.length > 0) {
    components.push(buttonRow(...choiceButtons));
  }
  components.push(actionRow2);

  return {
    embeds: [embed],
    components,
  };
}

export function buildRpgRunView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const run = ctx.services.rpg.getActiveRun(guildId, actor.id);
  if (!run) {
    return buildRpgHomeView(ctx, guildId, actor, feedback, nowMs);
  }

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const economy = guildCfg.economy;
  const chapterDef = RPG_CHAPTER_MAP.get(run.chapter);
  const classDef = RPG_CLASS_MAP.get(run.classKey) ?? RPG_CLASSES[0]!;
  const hpRatio = run.playerHp / Math.max(1, run.playerMaxHp);

  const lines: string[] = [
    `❤️ **勇者 HP**：\`${renderProgressBar(hpRatio, 10)}\` **${run.playerHp}/${run.playerMaxHp}**`,
    `${classDef.emoji} ${classDef.name} ｜ ✨ ${classDef.skillName}：${run.skillCooldown > 0 ? `CD ${run.skillCooldown}` : '✅就绪'} ｜ 🧪 药水×${run.potionsLeft}${run.petSynergy ? ` ｜ ${run.petSynergy.emoji}${run.petSynergy.nickname}` : ''}`,
    `🎒 暂存：${economy.currencyEmoji} **${run.pendingCoins.toLocaleString('en-US')}** ｜ ✨ **${run.pendingXp}** XP ｜ 🎁 **${run.pendingItems.length}** 装`,
    '',
  ];

  const components: MenuComponentRow[] = [];

  if (run.phase === 'combat' && run.enemy) {
    const enemy = run.enemy;
    const enemyRatio = enemy.hp / Math.max(1, enemy.maxHp);
    const kindLabel =
      enemy.kind === 'boss'
        ? '👑 首领'
        : enemy.kind === 'elite'
          ? '💀 精英'
          : '👹 魔物';
    const debuffs: string[] = [];
    if (enemy.armorBreakTurns > 0) debuffs.push(`破甲(${enemy.armorBreakTurns})`);
    if (enemy.burnTurns > 0) debuffs.push(`灼烧(${enemy.burnTurns})`);

    lines.push(
      `🩸 **${kindLabel} ${enemy.emoji} ${enemy.name}**：\`${renderProgressBar(enemyRatio, 10)}\` **${enemy.hp}/${enemy.maxHp}**${debuffs.length > 0 ? ` · ${debuffs.join(' ')}` : ''}`,
    );

    const skillLabel =
      run.skillCooldown > 0
        ? `✨ ${classDef.skillName}(CD${run.skillCooldown})`
        : '✨ 职业技能';

    components.push(
      buttonRow(
        makeButton('rpg:act:attack', '⚔️ 普攻', ButtonStyle.Primary),
        makeButton('rpg:act:skill', skillLabel, ButtonStyle.Success, run.skillCooldown > 0),
        makeButton('rpg:act:defend', '🛡️ 防御', ButtonStyle.Secondary),
        makeButton(
          'rpg:act:potion',
          `🧪 喝药 (余${run.potionsLeft})`,
          ButtonStyle.Secondary,
          run.potionsLeft <= 0,
        ),
        makeButton('rpg:act:retreat', '🏃 撤退保底', ButtonStyle.Danger),
      ),
    );
  } else if (run.phase === 'event' && run.event) {
    const ev = run.event;
    lines.push(
      `**✨ 地下城奇遇：${ev.title}**`,
      ev.description,
      `• 🅰️ ${ev.optionALabel}`,
      `• 🅱️ ${ev.optionBLabel}`,
    );

    components.push(
      buttonRow(
        makeButton('rpg:act:event_a', '🅰️ 选项A', ButtonStyle.Primary),
        makeButton('rpg:act:event_b', '🅱️ 选项B', ButtonStyle.Success),
        makeButton('rpg:act:retreat', '🏃 撤退保底', ButtonStyle.Danger),
      ),
    );
  } else {
    lines.push(
      `**✅ 第 ${run.floor} 层已清空！**`,
      `可深入第 **${Math.min(FLOORS_PER_CHAPTER, run.floor + 1)}** 层或见好就收带走暂存战利品。`,
    );

    components.push(
      buttonRow(
        makeButton('rpg:act:next_floor', '➡️ 前往下一层', ButtonStyle.Success),
        makeButton(
          'rpg:act:potion',
          `🧪 喝药 (余${run.potionsLeft})`,
          ButtonStyle.Secondary,
          run.potionsLeft <= 0 || run.playerHp >= run.playerMaxHp,
        ),
        makeButton('rpg:act:retreat', '🏃 撤退保底', ButtonStyle.Danger),
      ),
    );
  }

  components.push(
    buttonRow(makeButton('rpg:nav:home', '🏰 暂离大厅（保留进度）', ButtonStyle.Secondary)),
  );

  const recentLogs = run.logs.slice(-4);
  if (recentLogs.length > 0) {
    lines.push('', '**📜 战报**', ...recentLogs.map((l) => `• ${l}`));
  }

  const embedColor =
    run.phase === 'combat' && run.enemy?.kind === 'boss'
      ? COLORS.ERROR
      : run.phase === 'event'
        ? COLORS.FUN
        : run.phase === 'floor_clear'
          ? COLORS.SUCCESS
          : COLORS.PRIMARY;

  const embed = new EmbedBuilder()
    .setColor(resolveColor(embedColor, feedback))
    .setAuthor({ name: `${actor.displayName} · 经典地下城探险中`, iconURL: actor.avatarUrl })
    .setTitle(
      `${chapterDef?.emoji ?? '⚔️'} 第 ${run.chapter} 章「${chapterDef?.name ?? `章节#${run.chapter}`}」 · 第 ${run.floor}/${FLOORS_PER_CHAPTER} 层`,
    )
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '⚠️ 战败将遗失本局暂存战利品；随时可点击撤退安全带出！' })
    .setTimestamp();

  return {
    embeds: [embed],
    components,
  };
}

export function buildRpgGearView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  selectedItemId?: number | null,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
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
    (item) => !item.equipped && RARITY_ORDER[item.rarity] <= RARITY_ORDER.uncommon,
  ).length;

  const lines: string[] = [
    `${economy.currencyEmoji} 现金：**${profile.coins.toLocaleString('en-US')}** ${economy.currencyName} ｜ 🎒 背包：**${items.length}/${rpgCfg.bagCapacity}**`,
    `⚔️ 战力：❤️ ${stats.maxHp} ｜ ⚔️ ${stats.atk} ｜ 🛡️ ${stats.def} ｜ 💥 暴击 ${formatBpPercent(stats.critBp)}`,
    '',
    '**🛡️ 已穿戴装备**',
  ];

  for (const slot of GEAR_SLOTS_ORDER) {
    const slotMeta = RPG_SLOT_META[slot];
    const eq = stats.equippedItems.find((item) => item.slot === slot);
    if (eq) {
      const eff = computeItemEffectiveStats(eq);
      lines.push(
        `• ${slotMeta.emoji} ${slotMeta.label}：${formatRpgItemDisplay(eq)}（${formatEffectiveStats(eff)}）`,
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

    lines.push(
      '',
      `**🔍 当前选中：${formatRpgItemDisplay(selectedItem)}** ${selectedItem.equipped ? '✅ *[穿戴中]*' : '*[背包中]*'}`,
      `• ${slotMeta.emoji} ${slotMeta.label} ｜ **${formatEffectiveStats(eff)}**`,
      enhanceInfo
        ? `• 🔨 强化至 **+${enhanceInfo.nextLevel}**：${economy.currencyEmoji} **${enhanceInfo.cost}**（成功率 **${formatSuccessRate(enhanceInfo.successRate)}**，失败不碎）`
        : `• ✨ 已强化至满级（**+${MAX_ENHANCE_LEVEL}**）`,
      `• 💰 单件拆解：${economy.currencyEmoji} **+${salvageVal}**${selectedItem.equipped ? '（需先卸下）' : ''}`,
    );

    const previewItems = items.slice(0, 6);
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
      const label = truncateText(
        `${item.equipped ? '✅' : ''}${RPG_RARITY_BADGE[item.rarity].emoji}[${RPG_RARITY_BADGE[item.rarity].label}] ${item.name}${item.enhanceLevel > 0 ? ` +${item.enhanceLevel}` : ''}`,
        80,
      );
      const desc = truncateText(`${itemSlot.label} · ${formatEffectiveStats(itemEff)}`, 100);
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
          .setPlaceholder('🎒 选择一件装备进行穿戴 / 强化 / 拆解...')
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
          `rpg:gear_salvage:${selectedItem.id}`,
          `💰 拆解 (+${salvageVal})`,
          ButtonStyle.Danger,
          selectedItem.equipped,
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
    lines.push('', '📭 你的装备背包还是空的！快去开启博德跑团或经典战斗收集装备吧！');
    components.push(
      buttonRow(
        makeButton('rpg:nav:chapters:tabletop', '🎲 开启博德跑团', ButtonStyle.Success),
        makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
      ),
    );
  }

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 铁匠铺与装备栏`, iconURL: actor.avatarUrl })
    .setTitle('🎒 装备管理与锻造强化')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '每级强化提升全属性 +15%（最高 +10，失败不碎）；一键拆白绿装不会拆已穿戴件' })
    .setTimestamp();

  return {
    embeds: [embed],
    components,
  };
}

export function buildRpgClassSwitchView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback?: MenuFeedback,
  nowMs = Date.now(),
): BuiltMenuMessage {
  const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const rpgCfg = ctx.services.rpg.getConfig(guildId);
  const economy = guildCfg.economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const hasActiveRun = ctx.services.rpg.getAnyActiveRunMode(guildId, actor.id) !== null;
  const currentClass = RPG_CLASS_MAP.get(character.classKey) ?? RPG_CLASSES[0]!;
  const switchCost = character.classSelected ? rpgCfg.classSwitchCost : 0;

  const classCards = RPG_CLASSES.map((c) => {
    const isCurrent = character.classSelected && c.key === character.classKey;
    return [
      `${c.emoji} **${c.name}**${isCurrent ? ' ✅ *(当前)*' : ''} — ${c.description}`,
      `> 基础 HP ${c.baseHp} / ATK ${c.baseAtk} / DEF ${c.baseDef} ｜ ✨「**${c.skillName}**」${c.skillDescription}`,
    ].join('\n');
  });

  const lines: string[] = [
    character.classSelected
      ? `👤 当前职业：**${currentClass.emoji} ${currentClass.name}**（Lv.${character.level}）`
      : '👤 当前职业：尚未选职（首次选职免费）',
    `💰 转职费用：${economy.currencyEmoji} **${switchCost}** ${economy.currencyName} ｜ 口袋余额：**${profile.coins}** ${economy.currencyName}`,
  ];

  if (hasActiveRun) {
    lines.push('> ⚠️ 当前正处于冒险中，需完成或撤退本局后才可转职。');
  }

  lines.push('', ...classCards);

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 职业圣殿`, iconURL: actor.avatarUrl })
    .setTitle('🔄 西幻职业转职大厅')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '转职后保留勇者等级、经验、章节进度与全部装备' })
    .setTimestamp();

  const classButtons = RPG_CLASSES.map((c) => {
    const isCurrent = character.classSelected && c.key === character.classKey;
    return makeButton(
      `rpg:pick_class:${c.key}`,
      isCurrent ? `${c.emoji} ${c.name} (当前)` : `${c.emoji} 转职 ${c.name}`,
      isCurrent ? ButtonStyle.Success : ButtonStyle.Primary,
      isCurrent || hasActiveRun,
    );
  });

  return {
    embeds: [embed],
    components: [
      buttonRow(...classButtons),
      buttonRow(makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary)),
    ],
  };
}
