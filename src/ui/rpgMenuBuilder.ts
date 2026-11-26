import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import type { EconomyConfig } from '../config/defaults.js';
import type {
  RpgDuel,
  RpgDuelRulesMode,
  RpgItem,
  RpgItemRarity,
  RpgItemSlot,
  RpgRaid,
  RpgTrial,
} from '../db/repositories/rpgRepo.js';
import {
  formatAffixList,
  formatAffixTag,
  formatLegendaryEffect,
  getReforgeCost,
  getSalvageArcaneDust,
} from '../services/rpgAffixes.js';
import {
  DAILY_ARENA_FIGHTS,
  DAILY_COOP_TICKETS,
  GUARD_ELIXIR_DAILY_LIMIT,
  GUARD_ELIXIR_PRICE,
  MAX_COOP_PARTY_SIZE,
  MAX_ENHANCE_LEVEL,
  MAX_RPG_DUEL_BET,
  MAX_RPG_LEVEL,
  MAX_TRIAL_PILLS,
  MAX_TRIAL_SABOTEURS,
  MAX_TRIAL_SUPPORTERS,
  MIN_COOP_PARTY_SIZE,
  PITY_BONUS_PER_FAIL_PCT,
  PROMO_PILL_BONUS_PCT,
  PROMO_PILL_DAILY_LIMIT,
  PROMO_PILL_PRICE,
  RARITY_META,
  RARITY_ORDER,
  RPG_CLASSES,
  RPG_CLASS_MAP,
  RPG_TIERS,
  RPG_TIER_MAP,
  SABOTEUR_PENALTY_PCT,
  SABOTEUR_POOL_BONUS_PCT,
  SUPPORTER_BONUS_PCT,
  computeHealInjuryCost,
  computeItemEffectiveStats,
  computeTrialEffectiveRate,
  getArenaTierLabel,
  getEnhanceInfo,
  getRpgRealmInfo,
  getSalvageValue,
  xpNeededForRpgLevel,
  type EffectiveItemStats,
  type SupporterPayout,
} from '../services/rpgService.js';
import { COLORS, renderProgressBar, type AppContext } from './embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltButtonMessage,
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
  const lockTag = item.locked ? ' 🔒' : '';
  return `${formatRpgRarityTag(item.rarity)} **${item.name}**${enhanceTag}${lockTag}`;
}

function formatSuccessRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatCompactGearItem(item: RpgItem | undefined): string {
  if (!item) return '空';
  const badge = RPG_RARITY_BADGE[item.rarity];
  const enh = item.enhanceLevel > 0 ? `+${item.enhanceLevel}` : '';
  const lock = item.locked ? '🔒' : '';
  return `${badge.emoji}${item.name}${enh}${lock}`;
}

function formatIdleDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} 分钟`;
  if (minutes <= 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
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
    '欢迎踏入艾尔登西亚西幻大陆！挑选你的初始职业，即可免费开启 **十阶九重境** 秘境挂机、深渊词条刷宝、异步天梯、押注切磋与 **2~4人集结团本** 冒险：',
    '',
    ...classLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 冒险者公会登记`, iconURL: actor.avatarUrl })
    .setTitle('🏰 西幻秘境冒险 · 选择你的初始职业')
    .setDescription(withFeedback(description, feedback))
    .setFooter({ text: '首次选择职业完全免费，挂机最高累计 24 小时经验与星币收益' })
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
  const preview = ctx.services.rpg.previewIdleHarvest(guildId, actor.id, nowMs);
  const btPreview = ctx.services.rpg.computeBreakthroughPreview(guildId, actor.id, nowMs);
  const pendingTrial = ctx.services.rpg.getPendingTrialForUser(guildId, actor.id);
  const classDef = RPG_CLASS_MAP.get(character.classKey) ?? RPG_CLASSES[0]!;
  const needXp = xpNeededForRpgLevel(character.level);
  const xpRatio = character.xp / Math.max(1, needXp);
  const potionBuysLeft = Math.max(0, rpgCfg.staminaPotionDailyLimit - character.staminaBuysToday);
  const healCost = computeHealInjuryCost(character.level);
  const isFirstAbyss = preview.realm.tier > character.abyssClearedTier;
  const arenaTierLabel = getArenaTierLabel(character.arenaRating);

  const lines: string[] = [];

  if (pendingTrial) {
    const expSec = Math.floor(pendingTrial.expiresAt / 1000);
    lines.push(
      `⚡ **公开破境试炼进行中**：前往 <#${pendingTrial.channelId}> 查看天劫进度（<t:${expSec}:R> 自动结算 · 助威 **${pendingTrial.supporters.length}/${MAX_TRIAL_SUPPORTERS}** · 起哄 **${pendingTrial.saboteurs.length}/${MAX_TRIAL_SABOTEURS}**）`,
      '',
    );
  } else if (preview.atGate && btPreview.targetTierDef) {
    lines.push(
      `🔥 **已达当前阶位九重巅峰！** 经验已达瓶颈（**${character.xp}/${needXp} XP**），前往「⚡ 秘药与破境试炼」即可冲击 **${btPreview.targetTierDef.emoji} ${btPreview.targetTierDef.name}**（预计成功率 **${btPreview.totalRatePct}%**）！`,
      '',
    );
  }

  if (preview.isInjuredNow) {
    const minsLeft = Math.max(1, Math.ceil(preview.injuredRemainingMs / 60_000));
    lines.push(
      `🤕 **破境反噬重伤**：挂机收益减半 **0.5x**（剩余约 **${minsLeft}** 分钟 · 立即治愈需 ${economy.currencyEmoji} **${healCost.toLocaleString('en-US')}** ${economy.currencyName}）`,
      '',
    );
  }

  const realmSuffix =
    character.level >= MAX_RPG_LEVEL
      ? ' · 👑 已登神座'
      : preview.atGate
        ? ' · 🔥 待破境'
        : '';

  lines.push(
    `${classDef.emoji} **${classDef.name}** ｜ **${preview.realm.fullLabel}**（Lv.**${character.level}**/${MAX_RPG_LEVEL}${realmSuffix}）`,
    `✨ 经验 \`${renderProgressBar(xpRatio, 8)}\` **${character.xp.toLocaleString('en-US')}/${needXp.toLocaleString('en-US')} XP** ｜ 🌟 破境 **${character.totalBreakthroughs}** 次 ｜ 💀 击杀 Boss **${character.totalBossKills}**`,
    `⚡ 体力 **${character.stamina}/${rpgCfg.dailyStamina}**（药水 ${economy.currencyEmoji}${rpgCfg.staminaPotionPrice.toLocaleString('en-US')}，今日余 ${potionBuysLeft}） ｜ ${economy.currencyEmoji} 余额 **${profile.coins.toLocaleString('en-US')}** ${economy.currencyName}`,
    `✨ 奥术魔尘：**${character.arcaneDust.toLocaleString('en-US')}** ｜ 🏆 天梯分：**${character.arenaRating.toLocaleString('en-US')}**（${arenaTierLabel}） ｜ 💀 深渊进度：**第 ${character.abyssClearedTier}/${RPG_TIERS.length} 阶**（${isFirstAbyss ? '本阶首通免体' : '本阶已首通'}）`,
    `⚔️ 战力：**❤️ ${stats.maxHp}** · **⚔️ ${stats.atk}** · **🛡️ ${stats.def}** · **💥 ${formatBpPercent(stats.critBp)}** ｜ 试炼秘药 **🧪×${character.promoPills}** · 护魂 **🛡️×${character.guardElixirs}**`,
  );

  if (stats.affixes.legendaryEffects.length > 0) {
    const legTags = stats.affixes.legendaryEffects
      .map((eff) => formatLegendaryEffect(eff, false))
      .join(' · ');
    lines.push(`🟧 激活神铸：${legTags}`);
  }

  if (stats.petSynergy) {
    lines.push(
      `🐾 出战战宠：${stats.petSynergy.emoji} **${stats.petSynergy.nickname}**（Lv.${stats.petSynergy.level}，提供 HP+${stats.petSynergy.bonusHp} / ATK+${stats.petSynergy.bonusAtk} / 战斗协战）`,
    );
  }

  const eqMap = new Map<RpgItemSlot, RpgItem>(stats.equippedItems.map((it) => [it.slot, it]));
  lines.push(
    `🎒 已装备：🗡️ ${formatCompactGearItem(eqMap.get('weapon'))} ｜ 🛡️ ${formatCompactGearItem(eqMap.get('armor'))} ｜ 💍 ${formatCompactGearItem(eqMap.get('accessory'))}`,
    '',
    `⏳ **秘境挂机（${preview.realm.tierDef.zoneEmoji} ${preview.realm.tierDef.zoneName}）**`,
    `> 累计：**${formatIdleDuration(preview.accruedMs)}**${preview.isCapped ? ' *(已满 24h 上限)*' : ''} ｜ 战力倍率 **${preview.powerMultiplier.toFixed(2)}x**${preview.isInjuredNow ? ' *(重伤 ×0.5)*' : ''}`,
    `> 预计可领：✨ **~${preview.estimatedXp.toLocaleString('en-US')} XP** ｜ ${economy.currencyEmoji} **~${preview.estimatedCoins.toLocaleString('en-US')}** ${economy.currencyName}${preview.canClaim ? ' ｜ ✅ *已可领取*' : ` ｜ ⏳ *还需 ${preview.waitSeconds} 秒*`}`,
    '',
    `${preview.realm.tierDef.bossEmoji} **秘境讨伐 & 深渊领主：${preview.realm.tierDef.bossName}**`,
    `> 普通讨伐（1体）产出经验、${economy.currencyName}、词条装备与奥术魔尘；💀 **深渊挑战**战败不扣体力，首通免体力必爆紫/橙装与巨额魔尘！`,
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 西幻秘境冒险大厅`, iconURL: actor.avatarUrl })
    .setTitle('⚔️ 艾尔登西亚 · 十阶秘境与破境大厅')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({
      text: `共 ${RPG_TIERS.length} 大阶 × 9 重（Lv.1~90）｜ 挂机最多累计 24 小时 ｜ 公开切磋/团本/渡劫仅在 #游戏聊天 发起`,
    })
    .setTimestamp();

  const row1Buttons = [
    makeButton(
      'rpg:act:claim_idle',
      preview.canClaim ? '🌾 领取挂机收益' : '🌾 挂机蓄力中',
      ButtonStyle.Success,
      !preview.canClaim,
    ),
    makeButton('rpg:act:raid_one', '⚔️ 速刷Boss (1体)', ButtonStyle.Primary, character.stamina < 1),
    makeButton(
      'rpg:act:raid_all',
      `🔥 扫荡全部 (${character.stamina}体)`,
      ButtonStyle.Primary,
      character.stamina < 1,
    ),
    makeButton(
      'rpg:act:abyss',
      isFirstAbyss ? '💀 深渊挑战 (首通0体)' : '💀 深渊挑战 (1体)',
      ButtonStyle.Danger,
      !isFirstAbyss && character.stamina < 1,
    ),
  ];

  if (preview.isInjuredNow) {
    row1Buttons.push(
      makeButton('rpg:act:heal_injury', `💚 治愈重伤 (${healCost})`, ButtonStyle.Danger),
    );
  }

  return {
    embeds: [embed],
    components: [
      buttonRow(...row1Buttons),
      buttonRow(
        makeButton('rpg:nav:gear', '🎒 铁匠与装备', ButtonStyle.Secondary),
        makeButton('rpg:nav:pvp', '🏆 竞技与切磋', ButtonStyle.Primary),
        makeButton('rpg:nav:coop', '🐉 组队团本', ButtonStyle.Success),
        makeButton(
          'rpg:nav:trial',
          preview.atGate || pendingTrial ? '⚡ 立即破境试炼' : '🧪 秘药与破境',
          preview.atGate || pendingTrial ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
        makeButton(
          'rpg:act:buy_stamina',
          `🧪 买体力药 (${rpgCfg.staminaPotionPrice})`,
          ButtonStyle.Secondary,
          potionBuysLeft === 0,
        ),
      ),
      buttonRow(
        makeButton('rpg:nav:class', '🔄 转职', ButtonStyle.Secondary),
        makeButton('rpg:act:share_profile', '📣 晒出战绩', ButtonStyle.Secondary),
        makeButton('menu:rank:rpg:1', '🏆 阶位榜', ButtonStyle.Secondary),
        makeButton('rpg:nav:home', '🔄 刷新挂机', ButtonStyle.Secondary),
        makeButton('menu:nav:home', '🏠 返回主菜单', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildRpgTrialView(
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
  const economy = guildCfg.economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const btPreview = ctx.services.rpg.computeBreakthroughPreview(guildId, actor.id, nowMs);
  const pendingTrial = ctx.services.rpg.getPendingTrialForUser(guildId, actor.id);
  const pillBuysLeft = Math.max(0, PROMO_PILL_DAILY_LIMIT - character.pillBuysToday);
  const elixirBuysLeft = Math.max(0, GUARD_ELIXIR_DAILY_LIMIT - character.elixirBuysToday);

  const lines: string[] = [
    `🏅 当前境界：**${btPreview.fromRealm.fullLabel}**（Lv.${character.level}） → 冲击目标：${
      btPreview.targetTierDef
        ? `**${btPreview.targetTierDef.emoji} ${btPreview.targetTierDef.name}·一重**`
        : '👑 **已达最高神座阶**'
    }`,
    `${economy.currencyEmoji} 口袋余额：**${profile.coins.toLocaleString('en-US')}** ${economy.currencyName} ｜ ✨ 突破经验：**${btPreview.currentXp.toLocaleString('en-US')} / ${btPreview.needXp.toLocaleString('en-US')} XP**（${
      btPreview.atMaxTier
        ? '已满阶'
        : btPreview.eligible
          ? '✅ 已达破境门槛'
          : '⏳ 需当前阶九重经验满额'
    }）`,
  ];

  if (pendingTrial) {
    const expSec = Math.floor(pendingTrial.expiresAt / 1000);
    lines.push(
      '',
      `🔥 **公开试炼进行中**：已在 <#${pendingTrial.channelId}> 发起渡劫，截止 <t:${expSec}:R>（助威 ${pendingTrial.supporters.length}/${MAX_TRIAL_SUPPORTERS} ｜ 起哄 ${pendingTrial.saboteurs.length}/${MAX_TRIAL_SABOTEURS}），请在试炼卡片中等待天劫或提前引动！`,
    );
  }

  if (!btPreview.atMaxTier) {
    const creditSign = btPreview.creditBonusPct >= 0 ? '+' : '';
    lines.push(
      '',
      '📊 **破境成功率明细（综合上限 5%~95%）**',
      `• 阶位基础率：**${btPreview.baseRatePct}%**`,
      `• 晋升秘药：**+${btPreview.pillBonusPct}%**（上阵 **${btPreview.pillsUsed}/${MAX_TRIAL_PILLS}** 颗，每颗 +${PROMO_PILL_BONUS_PCT}%）`,
      `• 战宠协同：**+${btPreview.petBonusPct}%**（${btPreview.petName ? `🐾 ${btPreview.petName}` : '未出战宠物'}）`,
      `• 信用分影响：**${creditSign}${btPreview.creditBonusPct}%**（当前信用分 ${btPreview.creditScore}）`,
      `• 连败保底：**+${btPreview.pityBonusPct}%**（已累计失败 ${character.breakthroughPity} 次，每次 +${PITY_BONUS_PER_FAIL_PCT}%）`,
      `• 🎯 **预计单人成功率：${btPreview.totalRatePct}%**`,
      `• 🛡️ 护魂圣水配置：**${btPreview.usedGuard ? '已开启' : '未开启'}**（${
        btPreview.usedGuard
          ? '失败仅扣 10% 经验且免疫 1 小时重伤'
          : '未开启时失败扣 40% 经验并重伤 1 小时（挂机 0.5x）'
      }）`,
    );
  }

  lines.push(
    '',
    '⚗️ **秘药工坊（每天刷新限购）**',
    `• 🧪 **晋升秘药**：库存 **${character.promoPills}** 颗 ｜ 单价 ${economy.currencyEmoji} **${PROMO_PILL_PRICE.toLocaleString('en-US')}** ｜ 今日限购余 **${pillBuysLeft}/${PROMO_PILL_DAILY_LIMIT}**`,
    `• 🛡️ **护魂圣水**：库存 **${character.guardElixirs}** 瓶 ｜ 单价 ${economy.currencyEmoji} **${GUARD_ELIXIR_PRICE.toLocaleString('en-US')}** ｜ 今日限购余 **${elixirBuysLeft}/${GUARD_ELIXIR_DAILY_LIMIT}**`,
    '',
    '📣 **60秒公开渡劫规则（#游戏聊天）**：',
    `> • 助威（≤${MAX_TRIAL_SUPPORTERS}人）：每人成功率 **+${SUPPORTER_BONUS_PCT}%**，破境成功每人获赠 **${(btPreview.targetTierDef?.tier ?? 2) * 600}** 喜糖 ${economy.currencyName}！`,
    `> • 起哄（≤${MAX_TRIAL_SABOTEURS}人）：每人成功率 **-${SABOTEUR_PENALTY_PCT}%**，但破境成功总奖池额外 **+${SABOTEUR_POOL_BONUS_PCT}%**！`,
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 炼金工坊与破境试炼`, iconURL: actor.avatarUrl })
    .setTitle('⚡ 炼金秘药工坊 & 十阶破境试炼')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '发起破境时将消耗已上阵的晋升秘药与护魂圣水；连败每次提供 +10% 永久保底直至成功' })
    .setTimestamp();

  const locked = Boolean(pendingTrial);

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(
          'rpg:alchemy:buy_pill',
          `🧪 买秘药 (${PROMO_PILL_PRICE})`,
          ButtonStyle.Primary,
          pillBuysLeft === 0,
        ),
        makeButton(
          'rpg:alchemy:buy_elixir',
          `🛡️ 买护魂 (${GUARD_ELIXIR_PRICE})`,
          ButtonStyle.Primary,
          elixirBuysLeft === 0,
        ),
        makeButton(
          'rpg:trial:cycle_pills',
          `💊 上阵秘药 (${btPreview.pillsUsed}/${MAX_TRIAL_PILLS})`,
          ButtonStyle.Secondary,
          locked || (character.promoPills === 0 && btPreview.pillsUsed === 0),
        ),
        makeButton(
          'rpg:trial:toggle_guard',
          `🛡️ 护魂: ${btPreview.usedGuard ? '已开' : '关'}`,
          btPreview.usedGuard ? ButtonStyle.Success : ButtonStyle.Secondary,
          locked || (character.guardElixirs === 0 && !btPreview.usedGuard),
        ),
      ),
      buttonRow(
        makeButton(
          'rpg:trial:solo',
          '⚡ 单人立即破境',
          ButtonStyle.Primary,
          !btPreview.eligible || btPreview.hasPendingTrial || btPreview.atMaxTier,
        ),
        makeButton(
          'rpg:trial:public',
          '📣 发起60秒公开渡劫',
          ButtonStyle.Success,
          !btPreview.eligible || btPreview.hasPendingTrial || btPreview.atMaxTier,
        ),
      ),
      buttonRow(
        makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
        makeButton('rpg:nav:gear', '🎒 铁匠与装备', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildPublicTrialCard(
  trial: RpgTrial,
  economy: EconomyConfig,
  supporterPayouts?: readonly SupporterPayout[],
  _nowMs = Date.now(),
): BuiltButtonMessage {
  const fromRealm = getRpgRealmInfo(trial.fromLevel);
  const toTier = RPG_TIER_MAP.get(trial.targetTier);
  const targetLabel = toTier ? `${toTier.emoji} ${toTier.name}·一重` : `第 ${trial.targetTier} 阶`;
  const effectiveRate = computeTrialEffectiveRate(
    trial.baseChanceBp,
    trial.supporters.length,
    trial.saboteurs.length,
  );
  const basePct = Math.round(trial.baseChanceBp / 100);
  const candyPool = trial.targetTier * 600;
  const expSec = Math.floor(trial.expiresAt / 1000);

  const supporterList =
    trial.supporters.length > 0 ? trial.supporters.map((u) => `<@${u}>`).join('、') : '暂无（快来助威！）';
  const saboteurList =
    trial.saboteurs.length > 0 ? trial.saboteurs.map((u) => `<@${u}>`).join('、') : '暂无';

  const statusHeading =
    trial.status === 'pending'
      ? '🌩️ 天劫正在凝聚中！全服围观助威或起哄加奖'
      : trial.status === 'succeeded'
        ? '🎉 破境成功 · 金榜题名！'
        : trial.status === 'failed'
          ? '💥 渡劫失败 · 灵力反噬'
          : '⚪ 试炼已取消';

  const color =
    trial.status === 'succeeded'
      ? COLORS.SUCCESS
      : trial.status === 'failed'
        ? COLORS.ERROR
        : trial.status === 'cancelled'
          ? COLORS.PRIMARY
          : COLORS.GOLD;

  const lines: string[] = [
    `⚔️ 渡劫勇者：<@${trial.userId}>`,
    `🏅 冲击境界：**${fromRealm.fullLabel}** → **${targetLabel}**`,
    `🎯 当前成功率：**${effectiveRate}%**（个人底率 ${basePct}% ｜ 助威 +${trial.supporters.length * SUPPORTER_BONUS_PCT}% ｜ 起哄 -${trial.saboteurs.length * SABOTEUR_PENALTY_PCT}%）`,
    `⚗️ 已投入：🧪 晋升秘药 **${trial.pillsUsed}** 颗 ｜ 🛡️ 护魂圣水：**${trial.usedGuard ? '✅ 已防护' : '未开启'}**`,
    `🙏 助威团（${trial.supporters.length}/${MAX_TRIAL_SUPPORTERS} · 成功每人获赠 ${economy.currencyEmoji} **${candyPool.toLocaleString('en-US')}** 喜糖）：${supporterList}`,
    `😈 起哄团（${trial.saboteurs.length}/${MAX_TRIAL_SABOTEURS} · 每人 +${SABOTEUR_POOL_BONUS_PCT}% 成功赏金池）：${saboteurList}`,
  ];

  if (trial.status === 'pending') {
    lines.push(`⏱️ 倒计时：将在 <t:${expSec}:R> 自动结算（本人可点击下方按钮立刻引动天劫）`);
  } else if (trial.resultSummary) {
    lines.push('', `📜 **试炼结果**：${trial.resultSummary}`);
  }

  if (supporterPayouts && supporterPayouts.length > 0) {
    const payoutTags = supporterPayouts.map((p) => `<@${p.userId}> +${p.amount}`).join('、');
    lines.push(`🍬 **助威喜糖发放**：${payoutTags}`);
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⚡ 全服破境试炼 #${trial.id} — ${statusHeading}`)
    .setDescription(truncateText(lines.join('\n'), 4096))
    .setFooter({ text: '试炼仅在 #游戏聊天 举办 · 每名围观玩家仅可选择助威或起哄一次' })
    .setTimestamp(trial.resolvedAt || trial.createdAt);

  if (trial.status !== 'pending') {
    return { embeds: [embed], components: [] };
  }

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(
          `rpg:trial_help:${trial.id}`,
          `🙏 助威加运 (${trial.supporters.length}/${MAX_TRIAL_SUPPORTERS})`,
          ButtonStyle.Success,
          trial.supporters.length >= MAX_TRIAL_SUPPORTERS,
        ),
        makeButton(
          `rpg:trial_jeer:${trial.id}`,
          `😈 起哄加奖 (${trial.saboteurs.length}/${MAX_TRIAL_SABOTEURS})`,
          ButtonStyle.Danger,
          trial.saboteurs.length >= MAX_TRIAL_SABOTEURS,
        ),
        makeButton(`rpg:trial_settle:${trial.id}`, '⚡ 立刻引动天劫', ButtonStyle.Primary),
      ),
    ],
  };
}

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

export function buildRpgPvpView(
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
  const economy = guildCfg.economy;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const arenaPreview = ctx.services.rpg.previewDailyArenaReward(guildId, actor.id, nowMs);
  const arenaRank = ctx.services.rpg.getArenaRank(guildId, actor.id);
  const arenaLb = ctx.services.rpg.getArenaLeaderboard(guildId, 5, 0);
  const candidates = ctx.services.rpg.listArenaCandidates(guildId, actor.id, 25);
  const pendingDuel = ctx.services.rpg.getPendingDuelForUser(guildId, actor.id);

  const rankText = arenaRank ? `第 **#${arenaRank.rank}** / ${arenaRank.total} 名` : '暂未上榜';

  const lines: string[] = [
    `🏆 天梯积分：**${arenaPreview.rating.toLocaleString('en-US')}**（${arenaPreview.tierLabel} · ${rankText}）`,
    `⚔️ 今日免费天梯挑战：剩余 **${arenaPreview.fightsRemaining}/${DAILY_ARENA_FIGHTS}** 次 ｜ 🎁 每日段位俸禄：${economy.currencyEmoji} **+${arenaPreview.coins.toLocaleString('en-US')}** ＋ ✨ **+${arenaPreview.dust}** 魔尘（${arenaPreview.claimedToday ? '✅ 今日已领' : '🔥 可领取'}）`,
    `${economy.currencyEmoji} 口袋现金：**${profile.coins.toLocaleString('en-US')}** ${economy.currencyName} ｜ ✨ 奥术魔尘：**${character.arcaneDust.toLocaleString('en-US')}**`,
  ];

  if (pendingDuel) {
    const expSec = Math.floor(pendingDuel.expiresAt / 1000);
    const modeTag = pendingDuel.rulesMode === 'equalized' ? '⚖️ 同阶拉平局' : '🔥 满配神装局';
    lines.push(
      '',
      `📣 **你有进行中的公屏战书（#${pendingDuel.id} · ${modeTag}）**：已发布于 <#${pendingDuel.channelId}>，截止 <t:${expSec}:R>（可在战书卡片撤回）`,
    );
  }

  if (arenaLb.items.length > 0) {
    lines.push('', '👑 **本服天梯战神榜（Top 5）**');
    arenaLb.items.forEach((hero, idx) => {
      const cls = RPG_CLASS_MAP.get(hero.classKey) ?? RPG_CLASSES[0]!;
      const realm = getRpgRealmInfo(hero.level);
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`#${idx + 1}\``;
      lines.push(
        `${medal} <@${hero.userId}> — **${hero.arenaRating}** 分 ｜ ${cls.emoji} ${realm.fullLabel}`,
      );
    });
  }

  lines.push(
    '',
    '⚔️ **#游戏聊天 公屏押注约战（10分钟有效）**',
    `• **🔥 满配神装局**：全额代入真实等级、强化装备、词条与战宠，巅峰硬碰硬！`,
    `• **⚖️ 同阶拉平局**：双方白值统一拉平至 Lv.45 公平模板，保留职业流派、强化比例与词条/神铸搭配！`,
    `• 赌注范围：**0 ~ ${MAX_RPG_DUEL_BET.toLocaleString('en-US')}** ${economy.currencyName}（填 **0** 为无赌注荣誉切磋；逾期老赖禁押注但可 0 赌注切磋）`,
  );

  const components: MenuComponentRow[] = [];

  if (candidates.length > 0) {
    const options = candidates.slice(0, 25).map((cand) => {
      const cls = RPG_CLASS_MAP.get(cand.classKey) ?? RPG_CLASSES[0]!;
      const realm = getRpgRealmInfo(cand.level);
      const candProfile = ctx.repos.profile.getOrCreate(guildId, cand.userId);
      const heroName = candProfile.cardNickname?.trim() || `勇者 ${cand.userId.slice(-4)}`;
      return new StringSelectMenuOptionBuilder()
        .setLabel(truncateText(`${cls.emoji} ${heroName}（天梯 ${cand.arenaRating} 分）`, 80))
        .setValue(cand.userId)
        .setDescription(
          truncateText(`${realm.fullLabel} · Lv.${cand.level} · 击败防守镜像不扣对方星币`, 100),
        );
    });

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('rpg:arena_fight')
          .setPlaceholder(
            arenaPreview.fightsRemaining > 0
              ? `⚔️ 选择本服勇者镜像立即天梯挑战（余 ${arenaPreview.fightsRemaining}/${DAILY_ARENA_FIGHTS} 次）...`
              : '⏳ 今日 5 次天梯挑战已用完，明日再来！',
          )
          .setDisabled(arenaPreview.fightsRemaining <= 0)
          .addOptions(options),
      ),
    );
  } else {
    lines.push('', '> 💡 本服暂未发现其他已选职的勇者镜像，快喊群友输入 `/冒险` 创建角色吧！');
  }

  components.push(
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('rpg:duel_target:full')
        .setPlaceholder('🔥 指定群友发起【满配神装】押注约战 (#游戏聊天)...')
        .setDisabled(Boolean(pendingDuel)),
    ),
  );

  components.push(
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('rpg:duel_target:equalized')
        .setPlaceholder('⚖️ 指定群友发起【同阶拉平】押注约战 (#游戏聊天)...')
        .setDisabled(Boolean(pendingDuel)),
    ),
  );

  components.push(
    buttonRow(
      makeButton(
        'rpg:arena_claim',
        arenaPreview.claimedToday ? '🎁 今日俸禄已领' : '🎁 领取每日天梯俸禄',
        ButtonStyle.Success,
        !arenaPreview.canClaim,
      ),
      makeButton(
        'rpg:duel_open:full',
        '🔥 发起满配约战',
        ButtonStyle.Danger,
        Boolean(pendingDuel),
      ),
      makeButton(
        'rpg:duel_open:equalized',
        '⚖️ 发起同阶拉平约战',
        ButtonStyle.Primary,
        Boolean(pendingDuel),
      ),
    ),
  );

  components.push(
    buttonRow(
      makeButton('rpg:nav:pvp', '🔄 刷新竞技场', ButtonStyle.Secondary),
      makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
    ),
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 竞技场与公屏切磋`, iconURL: actor.avatarUrl })
    .setTitle('🏆 勇者异步天梯 & #游戏聊天 押注切磋')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '异步天梯防守方零损失；公屏约战仅投递至 #游戏聊天，10分钟无人应战自动退还押注' })
    .setTimestamp();

  return {
    embeds: [embed],
    components,
  };
}

export function buildRpgDuelBetModal(
  mode: RpgDuelRulesMode,
  targetIdOrOpen: string,
  currencyName: string,
): ModalBuilder {
  const modeTitle = mode === 'equalized' ? '⚖️ 发起同阶拉平约战' : '🔥 发起满配神装约战';
  const targetSuffix = targetIdOrOpen === 'open' ? '（公开摆擂）' : '（指定挑战）';

  const betInput = new TextInputBuilder()
    .setCustomId('bet_amount')
    .setLabel(truncateText(`押注 ${currencyName} (0~10亿，填0为荣誉切磋)`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(10)
    .setValue('0')
    .setPlaceholder('填 0 为无赌注荣誉切磋，最高 1000000000')
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`rpg:modal:duel:${mode}:${targetIdOrOpen}`)
    .setTitle(truncateText(`${modeTitle}${targetSuffix}`, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(betInput));
}

export function buildRpgPublicDuelCard(
  duel: RpgDuel,
  economy: EconomyConfig,
): BuiltButtonMessage {
  const modeLabel =
    duel.rulesMode === 'equalized'
      ? '⚖️ 同阶拉平局（统一 Lv.45 公平模板 · 纯拼流派与词条）'
      : '🔥 满配神装局（真实等级与强化神装全开）';
  const betLine =
    duel.betAmount > 0
      ? `${economy.currencyEmoji} **${duel.betAmount.toLocaleString('en-US')}** ${economy.currencyName}（胜者独揽 **${(duel.betAmount * 2).toLocaleString('en-US')}** 奖池！）`
      : '🏅 **0 赌注 · 荣誉切磋**';
  const targetLine = duel.opponentId
    ? `🎯 指定对手：<@${duel.opponentId}>`
    : '🌐 挑战对象：**全服公开摆擂（任意已选职勇者可接）**';

  const statusHeading =
    duel.status === 'pending'
      ? '⚔️ 战书已立 · 等待拔剑应战！'
      : duel.status === 'completed'
        ? duel.winnerId
          ? '🏆 对决落幕 · 胜负已分！'
          : '🤝 棋逢对手 · 握手言和！'
        : duel.status === 'expired'
          ? '⌛ 逾时未战 · 押注退回'
          : '🏳️ 战书已撤回';

  const color =
    duel.status === 'completed'
      ? COLORS.SUCCESS
      : duel.status === 'pending'
        ? COLORS.GOLD
        : COLORS.PRIMARY;

  const lines: string[] = [
    `🗡️ 发起勇者：<@${duel.challengerId}> ｜ ${targetLine}`,
    `📜 竞技规则：**${modeLabel}**`,
    `🪙 切磋赌注：${betLine}`,
  ];

  if (duel.status === 'pending') {
    const expSec = Math.floor(duel.expiresAt / 1000);
    lines.push(`⏱️ 战书有效期：<t:${expSec}:R> 超时自动退回押注`);
  } else {
    if (duel.resultSummary) {
      lines.push('', `📣 **结算战果**：${duel.resultSummary}`);
    }
    if (duel.highlights.length > 0) {
      lines.push('', '🎬 **高光回合实录**：', ...duel.highlights.slice(0, 8).map((h) => `> ${h}`));
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⚔️ 西幻勇者约战 #${duel.id} — ${statusHeading}`)
    .setDescription(truncateText(lines.join('\n'), 4096))
    .setFooter({ text: '西幻 RPG 公屏切磋仅在 #游戏聊天 进行' })
    .setTimestamp(duel.resolvedAt || duel.createdAt);

  if (duel.status !== 'pending') {
    return { embeds: [embed], components: [] };
  }

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(`rpg:duel_accept:${duel.id}`, '⚔️ 拔剑应战', ButtonStyle.Success),
        makeButton(`rpg:duel_cancel:${duel.id}`, '🏳️ 撤回战书', ButtonStyle.Danger),
      ),
    ],
  };
}

export function buildRpgCoopView(
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

  const realm = getRpgRealmInfo(character.level);
  const ticketsLeft = Math.max(0, DAILY_COOP_TICKETS - character.coopTicketsToday);
  const activeRaid = ctx.services.rpg.getRecruitingRaidForLeader(guildId, actor.id);

  const lines: string[] = [
    `🏅 当前境界：**${realm.fullLabel}**（Lv.${character.level}） ｜ ✨ 奥术魔尘：**${character.arcaneDust.toLocaleString('en-US')}**`,
    `🐉 本阶集结首领：**${realm.tierDef.bossEmoji} ${realm.tierDef.bossName}**（第 ${realm.tier} 阶团本）`,
    `🎫 今日队长发车券：**${ticketsLeft}/${DAILY_COOP_TICKETS}** 张 ｜ 🤝 上车助战他人：**每日不限次数（完全免费）**`,
  ];

  if (activeRaid) {
    const expSec = Math.floor(activeRaid.expiresAt / 1000);
    lines.push(
      '',
      `🔥 **你的团本车队 #${activeRaid.id} 正在集结中**：前往 <#${activeRaid.channelId}> 查看（当前 **${activeRaid.members.length}/${MAX_COOP_PARTY_SIZE}** 人，<t:${expSec}:R> 自动补齐佣兵发车）！`,
    );
  }

  lines.push(
    '',
    '📜 **2~4 人集结团本规则（#游戏聊天）**',
    `• **队长发车（日限 ${DAILY_COOP_TICKETS} 次）**：向 \`#游戏聊天\` 发送 3 分钟集结卡，满 **${MIN_COOP_PARTY_SIZE}** 人队长可提前立即发车，满 **${MAX_COOP_PARTY_SIZE}** 人激活高额满编羁绊增伤！`,
    '• **前排承伤 & 职业配合**：战士/圣骑士自动顶前排吸引火力，法师/游侠后排全力倾泻怒气大招；输出最高者荣膺 **🏅 MVP** 额外奖励魔尘！',
    '• **无限助战白嫖**：群友点击招募卡「⚔️ 上车助战」不扣任何体力或门票，通关共享协战星币与奥术魔尘；队长额外斩获本阶蓝/紫/橙词条装备！',
    '• **3分钟防鬼服兜底**：倒计时结束若真人不足 2 人，系统自动征召本服高战勇者「雇佣兵镜像」补齐席位照常开打，绝不流局！',
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.SUCCESS, feedback))
    .setAuthor({ name: `${actor.displayName} · 远征集结大厅`, iconURL: actor.avatarUrl })
    .setTitle('🐉 西幻 2~4 人集结团本大厅')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '集结招募卡仅投递至 #游戏聊天；发送失败将自动退还发车券' })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(
          'rpg:coop_start',
          `🐉 发起集结团本 (余${ticketsLeft}/${DAILY_COOP_TICKETS})`,
          ButtonStyle.Success,
          ticketsLeft <= 0 || Boolean(activeRaid),
        ),
        makeButton('rpg:nav:coop', '🔄 刷新团本状态', ButtonStyle.Secondary),
      ),
      buttonRow(
        makeButton('rpg:nav:home', '🔙 返回冒险大厅', ButtonStyle.Secondary),
        makeButton('rpg:nav:gear', '🎒 铁匠与装备', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildRpgCoopRaidCard(
  raid: RpgRaid,
  economy: EconomyConfig,
): BuiltButtonMessage {
  const tierDef = RPG_TIER_MAP.get(raid.tier) ?? RPG_TIERS[0]!;
  const hpRatio = raid.bossRemainingHp / Math.max(1, raid.bossMaxHp);

  const statusHeading =
    raid.status === 'recruiting'
      ? `📣 车队集结中 (${raid.members.length}/${MAX_COOP_PARTY_SIZE}) · 快来上车助战！`
      : raid.status === 'completed'
        ? '🎉 讨伐大捷 · 首领陨落！'
        : raid.status === 'failed'
          ? '💥 鏖战惜败 · 发放抚恤'
          : '⚪ 集结已取消';

  const color =
    raid.status === 'completed'
      ? COLORS.SUCCESS
      : raid.status === 'failed'
        ? COLORS.ERROR
        : raid.status === 'recruiting'
          ? COLORS.GOLD
          : COLORS.PRIMARY;

  const lines: string[] = [
    `${tierDef.bossEmoji} **第 ${raid.tier} 阶团本首领：${raid.bossName}**`,
    `❤️ 首领生命：\`${renderProgressBar(hpRatio, 12)}\` **${raid.bossRemainingHp.toLocaleString('en-US')} / ${raid.bossMaxHp.toLocaleString('en-US')} HP**`,
  ];

  if (raid.status === 'recruiting') {
    const expSec = Math.floor(raid.expiresAt / 1000);
    const memberTags = raid.members
      .map((uid) => (uid === raid.leaderId ? `👑 <@${uid}> *(队长)*` : `⚔️ <@${uid}>`))
      .join('、');
    lines.push(
      `👥 当前编队（**${raid.members.length}/${MAX_COOP_PARTY_SIZE}**）：${memberTags}`,
      `⏱️ 自动发车：<t:${expSec}:R>（满 ${MIN_COOP_PARTY_SIZE} 人队长可立即发车；超时不足 2 人自动征召佣兵补位！）`,
      `🎁 助战福利：点击下方「⚔️ 上车助战」零消耗白嫖 ${economy.currencyName} 与 ✨ 奥术魔尘！`,
    );
  } else {
    if (raid.resultSummary) {
      lines.push('', `📜 **战局结果**：${raid.resultSummary}`);
    }

    if (raid.payouts.length > 0) {
      lines.push('', '👥 **远征小队战绩 & 掉落分配**：');
      for (const p of raid.payouts) {
        const cls = RPG_CLASS_MAP.get(p.classKey) ?? RPG_CLASSES[0]!;
        const actorTag = p.isMercenary ? `🤖 **${p.name}** *(佣兵镜像)*` : `<@${p.userId}>`;
        const badges = [
          p.isLeader ? '👑队长' : '',
          p.isMvp ? '🏅MVP' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const badgeStr = badges ? ` [${badges}]` : '';
        const dropTags =
          p.itemsDropped.length > 0
            ? ` ｜ 🎁 ${p.itemsDropped.map((d) => `${RPG_RARITY_BADGE[d.rarity].emoji}${d.name}`).join('、')}`
            : '';
        const rewardStr = p.isMercenary
          ? '协战镜像（无收益）'
          : `${economy.currencyEmoji}+${p.netCoins.toLocaleString('en-US')} · ✨+${p.dustEarned}尘${dropTags}`;
        lines.push(
          `• ${cls.emoji} ${actorTag}${badgeStr} — 输出 **${p.damageDealt.toLocaleString('en-US')}** / 承伤 **${p.damageTaken.toLocaleString('en-US')}** ｜ ${rewardStr}`,
        );
      }
    }

    if (raid.highlights.length > 0) {
      lines.push('', '🎬 **高光战斗纪实**：', ...raid.highlights.slice(0, 7).map((h) => `> ${h}`));
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🐉 远征集结团本 #${raid.id} — ${statusHeading}`)
    .setDescription(truncateText(lines.join('\n'), 4096))
    .setFooter({ text: '西幻 RPG 集结团本仅在 #游戏聊天 进行 · 助战每日不限次数' })
    .setTimestamp(raid.resolvedAt || raid.createdAt);

  if (raid.status !== 'recruiting') {
    return { embeds: [embed], components: [] };
  }

  return {
    embeds: [embed],
    components: [
      buttonRow(
        makeButton(
          `rpg:coop_join:${raid.id}`,
          `⚔️ 上车助战 (${raid.members.length}/${MAX_COOP_PARTY_SIZE})`,
          ButtonStyle.Success,
          raid.members.length >= MAX_COOP_PARTY_SIZE,
        ),
        makeButton(
          `rpg:coop_launch:${raid.id}`,
          '🚀 立即发车 (队长)',
          ButtonStyle.Primary,
          raid.members.length < MIN_COOP_PARTY_SIZE,
        ),
      ),
    ],
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
  const hasPendingTrial = ctx.services.rpg.getPendingTrialForUser(guildId, actor.id) !== null;
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
      ? `👤 当前职业：**${currentClass.emoji} ${currentClass.name}**（${getRpgRealmInfo(character.level).fullLabel}）`
      : '👤 当前职业：尚未选职（首次选职免费）',
    `💰 转职费用：${economy.currencyEmoji} **${switchCost}** ${economy.currencyName} ｜ 口袋余额：**${profile.coins}** ${economy.currencyName}`,
  ];

  if (hasPendingTrial) {
    lines.push('> ⚠️ 当前有进行中的公开破境试炼，需结算后才可转职。');
  }

  lines.push('', ...classCards);

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.FUN, feedback))
    .setAuthor({ name: `${actor.displayName} · 职业圣殿`, iconURL: actor.avatarUrl })
    .setTitle('🔄 西幻职业转职大厅')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({ text: '转职后保留勇者阶位、经验、秘药库存、魔尘与全部词条装备' })
    .setTimestamp();

  const classButtons = RPG_CLASSES.map((c) => {
    const isCurrent = character.classSelected && c.key === character.classKey;
    return makeButton(
      `rpg:pick_class:${c.key}`,
      isCurrent ? `${c.emoji} ${c.name} (当前)` : `${c.emoji} 转职 ${c.name}`,
      isCurrent ? ButtonStyle.Success : ButtonStyle.Primary,
      isCurrent || hasPendingTrial,
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
