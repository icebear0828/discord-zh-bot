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
  RPG_CHAPTER_MAP,
  RPG_CHAPTERS,
  RPG_CLASS_MAP,
  RPG_CLASSES,
  computeItemEffectiveStats,
  getEnhanceInfo,
  getSalvageValue,
  xpNeededForRpgLevel,
  type EffectiveItemStats,
} from '../services/rpgService.js';
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
  return `${formatRpgRarityTag(item.rarity)} **${item.name}**${enhanceTag}`;
}

function formatSuccessRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function buildClassOnboardingView(
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
): BuiltMenuMessage {
  const classLines = RPG_CLASSES.map((c) =>
    [
      `${c.emoji} **${c.name}** — ${c.description}`,
      `> ❤️ HP ${c.baseHp} ｜ ⚔️ ATK ${c.baseAtk} ｜ 🛡️ DEF ${c.baseDef} ｜ 💥 暴击 ${formatBpPercent(c.baseCritBp)} ｜ 💨 闪避 ${formatBpPercent(c.baseDodgeBp)}`,
      `> ✨ 招牌技能「**${c.skillName}**」（CD ${c.skillCooldown}回合）：${c.skillDescription}`,
    ].join('\n'),
  );

  const description = [
    '欢迎踏入艾尔登西亚西幻地下城！挑选你的初始职业，即可免费开启 **6 大史诗章节**、装备强化锻造与战宠助战征程：',
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
  const activeRun = ctx.services.rpg.getActiveRun(guildId, actor.id);
  const classDef = RPG_CLASS_MAP.get(character.classKey) ?? RPG_CLASSES[0]!;
  const needXp = xpNeededForRpgLevel(character.level);
  const xpRatio = character.xp / Math.max(1, needXp);
  const potionBuysLeft = Math.max(0, rpgCfg.staminaPotionDailyLimit - character.staminaBuysToday);

  const lines: string[] = [];

  if (activeRun) {
    const chDef = RPG_CHAPTER_MAP.get(activeRun.chapter);
    lines.push(
      `🔥 **进行中的地下城冒险**：${chDef?.emoji ?? '⚔️'} 第 ${activeRun.chapter} 章「**${chDef?.name ?? `章节#${activeRun.chapter}`}**」· 第 **${activeRun.floor}/${FLOORS_PER_CHAPTER}** 层`,
      `> ❤️ 当前生命 **${activeRun.playerHp}/${activeRun.playerMaxHp}** ｜ 🎒 暂存战利品：${economy.currencyEmoji} **${activeRun.pendingCoins}** ${economy.currencyName} / ✨ **${activeRun.pendingXp}** XP / 🎁 **${activeRun.pendingItems.length}** 件装备`,
      '',
    );
  }

  lines.push(
    `👤 职业：**${classDef.emoji} ${classDef.name}** ｜ 等级 **Lv.${character.level}**`,
    `📈 经验：\`${renderProgressBar(xpRatio, 10)}\` **${character.xp} / ${needXp} XP**`,
    `⚡ 体力：**${character.stamina} / ${rpgCfg.dailyStamina}**（药水 ${economy.currencyEmoji}${rpgCfg.staminaPotionPrice}，今日余 **${potionBuysLeft}** 次）`,
    `${economy.currencyEmoji} 口袋现金：**${profile.coins}** ${economy.currencyName}`,
    '',
    '**⚔️ 综合战斗属性**',
    `❤️ 生命 **${stats.maxHp}** ｜ ⚔️ 攻击 **${stats.atk}** ｜ 🛡️ 防御 **${stats.def}** ｜ 💥 暴击率 **${formatBpPercent(stats.critBp)}** ｜ 💨 闪避 **${formatBpPercent(stats.dodgeBp)}**`,
    `✨ 招牌技能：**${classDef.skillName}**（CD ${classDef.skillCooldown}回合）— ${classDef.skillDescription}`,
  );

  if (stats.petSynergy) {
    const pet = stats.petSynergy;
    lines.push(
      `🐾 战宠助战：${pet.emoji} **${pet.nickname}** [${pet.rarity} Lv.${pet.level}]（+${pet.bonusHp} HP / +${pet.bonusAtk} ATK / +${formatBpPercent(pet.bonusCritBp)} 暴击 ｜ ${formatSuccessRate(pet.assistChance)} 追击 **${pet.assistDamage}** 伤）`,
    );
  } else {
    lines.push('🐾 战宠助战：暂无出战宠物（在「宠物屋」设置出战宠物可获得属性与回合追击加成）');
  }

  lines.push('', '**🎒 当前穿戴装备**');
  for (const slot of GEAR_SLOTS_ORDER) {
    const slotMeta = RPG_SLOT_META[slot];
    const eq = stats.equippedItems.find((item) => item.slot === slot);
    if (eq) {
      const eff = computeItemEffectiveStats(eq);
      lines.push(`• ${slotMeta.emoji} ${slotMeta.label}：${formatRpgItemDisplay(eq)}（${formatEffectiveStats(eff)}）`);
    } else {
      lines.push(`• ${slotMeta.emoji} ${slotMeta.label}：*未装备*`);
    }
  }

  lines.push(
    '',
    `🗺️ 章节进度：**${character.maxChapterCleared} / ${RPG_CHAPTERS.length}** ｜ 🏆 总通关：**${character.totalClears}** 次 ｜ 💀 斩杀 Boss：**${character.totalBossKills}** 次`,
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 西幻地下城冒险大厅`, iconURL: actor.avatarUrl })
    .setTitle(`🏰 ${classDef.emoji} ${classDef.name} · 勇者档案`)
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '首通章节与掉落传说橙装将在当前频道全服播报！' })
    .setTimestamp();

  const row1 = buttonRow(
    activeRun
      ? makeButton('rpg:nav:run', '⚔️ 继续当前冒险', ButtonStyle.Success)
      : makeButton('rpg:nav:chapters', '🗺️ 选择章节下本', ButtonStyle.Success),
    makeButton('rpg:nav:gear', '🎒 装备与强化', ButtonStyle.Primary),
    makeButton('rpg:act:buy_stamina', '🧪 买体力药水', ButtonStyle.Secondary, potionBuysLeft <= 0),
    makeButton('rpg:nav:class', '🔄 转职', ButtonStyle.Secondary, Boolean(activeRun)),
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
): BuiltMenuMessage {
  const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
  if (!character.classSelected) {
    return buildClassOnboardingView(actor, feedback);
  }

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const rpgCfg = ctx.services.rpg.getConfig(guildId);
  const economy = guildCfg.economy;
  const activeRun = ctx.services.rpg.getActiveRun(guildId, actor.id);
  const maxUnlocked = Math.min(RPG_CHAPTERS.length, character.maxChapterCleared + 1);

  const lines: string[] = [
    `⚡ 当前体力：**${character.stamina} / ${rpgCfg.dailyStamina}**（每次下本消耗 **1** 体力） ｜ 勇者等级：**Lv.${character.level}**`,
    '📌 每个章节共 **5 层**（第 5 层为章节首领 Boss），首通享 **2 倍** 基础金币奖励与 **+25 信用分**！',
  ];

  if (activeRun) {
    const runCh = RPG_CHAPTER_MAP.get(activeRun.chapter);
    lines.push(
      `> ⚠️ 你当前正在探索第 ${activeRun.chapter} 章「**${runCh?.name ?? ''}**」第 ${activeRun.floor}/${FLOORS_PER_CHAPTER} 层，请先继续或撤退当前冒险。`,
    );
  }

  lines.push('');

  for (const ch of RPG_CHAPTERS) {
    const cleared = ch.chapter <= character.maxChapterCleared;
    const unlocked = ch.chapter <= maxUnlocked;
    const statusBadge = cleared
      ? '✅ 已通关'
      : unlocked
        ? '🔓 可挑战（首通 2x）'
        : '🔒 未解锁';
    const firstClearCoins = Math.round(ch.clearBaseCoins * ch.firstClearMultiplier);
    const rewardNote = cleared
      ? `基础奖励 ${economy.currencyEmoji} **${ch.clearBaseCoins}** ${economy.currencyName}`
      : `基础 ${economy.currencyEmoji} **${ch.clearBaseCoins}**（首通 2x → **${firstClearCoins}** ${economy.currencyName}）`;

    lines.push(
      `${ch.emoji} **第 ${ch.chapter} 章 · ${ch.name}** ｜ ${statusBadge}`,
      `> 推荐 **Lv.${ch.recommendedLevel}** ｜ 首领：${ch.boss.emoji} **${ch.boss.name}** ｜ ${rewardNote}`,
    );
  }

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 地下城世界地图`, iconURL: actor.avatarUrl })
    .setTitle('🗺️ 选择西幻地下城章节')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '通关当前最高章节后自动解锁下一章；战斗中可随时见好就收撤退保底' })
    .setTimestamp();

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
      `rpg:start:${ch.chapter}`,
      `${prefix} 第${ch.chapter}章 ${ch.name}`,
      style,
      !unlocked || Boolean(activeRun),
    );
  };

  const row1 = buttonRow(...RPG_CHAPTERS.slice(0, 3).map(makeChapterButton));
  const row2 = buttonRow(...RPG_CHAPTERS.slice(3, 6).map(makeChapterButton));

  const navButtons = [
    ...(activeRun ? [makeButton('rpg:nav:run', '⚔️ 继续当前冒险', ButtonStyle.Success)] : []),
    makeButton('rpg:act:buy_stamina', '🧪 买体力药水', ButtonStyle.Secondary),
    makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
  ];

  return {
    embeds: [embed],
    components: [row1, row2, buttonRow(...navButtons)],
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
  const effectiveAtk = Math.round(run.playerAtk * (1 + run.atkBuffPct));
  const hpRatio = run.playerHp / Math.max(1, run.playerMaxHp);

  const lines: string[] = [
    `❤️ 勇者 HP：**${run.playerHp} / ${run.playerMaxHp}** \`${renderProgressBar(hpRatio, 10)}\``,
    `${classDef.emoji} **${classDef.name}** ｜ ⚔️ ATK **${effectiveAtk}**${run.atkBuffPct > 0 ? ` (+${Math.round(run.atkBuffPct * 100)}%)` : ''} ｜ 🛡️ DEF **${run.playerDef}** ｜ 💥 暴击 **${formatBpPercent(run.playerCritBp)}**`,
    `✨ 技能「**${classDef.skillName}**」：${run.skillCooldown > 0 ? `冷却中（余 ${run.skillCooldown} 回合）` : '✅ 就绪'} ｜ 🧪 药水：**余 ${run.potionsLeft} 瓶**`,
  ];

  if (run.petSynergy) {
    const pet = run.petSynergy;
    lines.push(
      `🐾 战宠助战：${pet.emoji} **${pet.nickname}** [${pet.rarity} Lv.${pet.level}]（${formatSuccessRate(pet.assistChance)} 追击 **${pet.assistDamage}** 伤）`,
    );
  }

  lines.push(
    `🎒 待带出战利品：${economy.currencyEmoji} **${run.pendingCoins}** ${economy.currencyName} ｜ ✨ **${run.pendingXp}** XP ｜ 🎁 装备 **${run.pendingItems.length}** 件`,
    '',
  );

  const components: MenuComponentRow[] = [];

  if (run.phase === 'combat' && run.enemy) {
    const enemy = run.enemy;
    const enemyRatio = enemy.hp / Math.max(1, enemy.maxHp);
    const kindLabel =
      enemy.kind === 'boss'
        ? '👑 章节首领'
        : enemy.kind === 'elite'
          ? '💀 精英强敌'
          : '👹 魔物遭遇';
    const debuffs: string[] = [];
    if (enemy.armorBreakTurns > 0) debuffs.push(`破甲(余${enemy.armorBreakTurns}回合)`);
    if (enemy.burnTurns > 0) debuffs.push(`灼烧(${enemy.burnDamage}/回合,余${enemy.burnTurns}回合)`);

    lines.push(
      `**${kindLabel}：${enemy.emoji} ${enemy.name}**`,
      `🩸 敌方 HP：**${enemy.hp} / ${enemy.maxHp}** \`${renderProgressBar(enemyRatio, 10)}\``,
      `⚔️ ATK **${enemy.atk}** ｜ 🛡️ DEF **${enemy.def}**${debuffs.length > 0 ? ` ｜ 🌀 状态：${debuffs.join('、')}` : ''}`,
    );

    const skillLabel =
      run.skillCooldown > 0
        ? `✨ ${classDef.skillName}(CD${run.skillCooldown})`
        : `✨ 职业技能`;

    components.push(
      buttonRow(
        makeButton('rpg:act:attack', '⚔️ 普攻', ButtonStyle.Primary),
        makeButton('rpg:act:skill', skillLabel, ButtonStyle.Success, run.skillCooldown > 0),
        makeButton('rpg:act:defend', '🛡️ 防御', ButtonStyle.Secondary),
        makeButton('rpg:act:potion', `🧪 喝药 (余${run.potionsLeft})`, ButtonStyle.Secondary, run.potionsLeft <= 0),
        makeButton('rpg:act:retreat', '🏃 见好就收撤退', ButtonStyle.Danger),
      ),
    );
  } else if (run.phase === 'event' && run.event) {
    const ev = run.event;
    lines.push(
      `**✨ 地下城奇遇：${ev.title}**`,
      ev.description,
      `• 🅰️ **选项A**：${ev.optionALabel}`,
      `• 🅱️ **选项B**：${ev.optionBLabel}`,
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
      `你可以继续深入第 **${Math.min(FLOORS_PER_CHAPTER, run.floor + 1)}** 层挑战更高回报，或见好就收带走全部暂存战利品。`,
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
        makeButton('rpg:act:retreat', '🏃 见好就收撤退', ButtonStyle.Danger),
      ),
    );
  }

  components.push(
    buttonRow(makeButton('rpg:nav:home', '🏰 暂离回大厅（保留进度）', ButtonStyle.Secondary)),
  );

  const recentLogs = run.logs.slice(-6);
  if (recentLogs.length > 0) {
    lines.push('', '**📜 冒险战报**', ...recentLogs.map((l) => `• ${l}`));
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
    .setAuthor({ name: `${actor.displayName} · 地下城探险中`, iconURL: actor.avatarUrl })
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

  const lines: string[] = [
    `${economy.currencyEmoji} 口袋现金：**${profile.coins}** ${economy.currencyName} ｜ 🎒 背包：**${items.length} / ${rpgCfg.bagCapacity}**`,
    `⚔️ 当前战力：❤️ HP **${stats.maxHp}** ｜ ⚔️ ATK **${stats.atk}** ｜ 🛡️ DEF **${stats.def}** ｜ 💥 暴击 **${formatBpPercent(stats.critBp)}**`,
    '',
    '**🛡️ 已穿戴装备**',
  ];

  for (const slot of GEAR_SLOTS_ORDER) {
    const slotMeta = RPG_SLOT_META[slot];
    const eq = stats.equippedItems.find((item) => item.slot === slot);
    if (eq) {
      const eff = computeItemEffectiveStats(eq);
      lines.push(`• ${slotMeta.emoji} ${slotMeta.label}：${formatRpgItemDisplay(eq)}（${formatEffectiveStats(eff)}）`);
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
      `**🔍 当前选中：${formatRpgItemDisplay(selectedItem)}** ${selectedItem.equipped ? '✅ *[已装备]*' : '*[背包中]*'}`,
      `• 部位：${slotMeta.emoji} ${slotMeta.label} ｜ 属性：**${formatEffectiveStats(eff)}**`,
      enhanceInfo
        ? `• 🔨 强化至 **+${enhanceInfo.nextLevel}**：花费 ${economy.currencyEmoji} **${enhanceInfo.cost}** ${economy.currencyName} ｜ 成功率 **${formatSuccessRate(enhanceInfo.successRate)}**（失败不碎）`
        : `• ✨ 已强化至满级（**+${MAX_ENHANCE_LEVEL}**）`,
      `• 💰 拆解换币：可获得 ${economy.currencyEmoji} **${salvageVal}** ${economy.currencyName}${selectedItem.equipped ? '（需先卸下才可拆解）' : ''}`,
    );

    const previewItems = items.slice(0, 8);
    if (items.length > 1) {
      lines.push('', `**📦 背包一览（前 ${previewItems.length} / ${items.length} 件）**`);
      for (const item of previewItems) {
        const mark = item.id === selectedItem.id ? '👉 ' : '• ';
        const eqTag = item.equipped ? ' [穿戴中]' : '';
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
          `💰 拆解换币 (+${salvageVal})`,
          ButtonStyle.Danger,
          selectedItem.equipped,
        ),
        makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
      ),
    );
  } else {
    lines.push(
      '',
      '📭 你的装备背包还是空的！快去「选择章节下本」击败魔物与首领收集强力装备吧！',
    );
    components.push(
      buttonRow(
        makeButton('rpg:nav:chapters', '🗺️ 选择章节下本', ButtonStyle.Success),
        makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
      ),
    );
  }

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 铁匠铺与装备栏`, iconURL: actor.avatarUrl })
    .setTitle('🎒 装备管理与锻造强化')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '每级强化提升装备全属性 +15%，最高 +10；强化失败不损毁装备' })
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
  const activeRun = ctx.services.rpg.getActiveRun(guildId, actor.id);
  const currentClass = RPG_CLASS_MAP.get(character.classKey) ?? RPG_CLASSES[0]!;
  const switchCost = character.classSelected ? rpgCfg.classSwitchCost : 0;

  const classCards = RPG_CLASSES.map((c) => {
    const isCurrent = character.classSelected && c.key === character.classKey;
    return [
      `${c.emoji} **${c.name}**${isCurrent ? ' ✅ *(当前职业)*' : ''} — ${c.description}`,
      `> 基础：HP ${c.baseHp} (+${c.hpPerLevel}/级) ｜ ATK ${c.baseAtk} (+${c.atkPerLevel}/级) ｜ DEF ${c.baseDef} (+${c.defPerLevel}/级) ｜ 暴击 ${formatBpPercent(c.baseCritBp)} ｜ 闪避 ${formatBpPercent(c.baseDodgeBp)}`,
      `> ✨ 招牌技能「**${c.skillName}**」(CD ${c.skillCooldown}回合)：${c.skillDescription}`,
    ].join('\n');
  });

  const lines: string[] = [
    character.classSelected
      ? `👤 当前职业：**${currentClass.emoji} ${currentClass.name}**（Lv.${character.level}）`
      : '👤 当前职业：尚未选职（首次选职免费）',
    `💰 转职费用：${economy.currencyEmoji} **${switchCost}** ${economy.currencyName} ｜ 口袋余额：**${profile.coins}** ${economy.currencyName}`,
  ];

  if (activeRun) {
    lines.push('> ⚠️ 当前正处于地下城冒险中，需完成或撤退本局后才可转职。');
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
      isCurrent || Boolean(activeRun),
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
