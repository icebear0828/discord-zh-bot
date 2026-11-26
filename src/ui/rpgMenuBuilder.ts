import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { EconomyConfig } from '../config/defaults.js';
import type {
  RpgItem,
  RpgItemRarity,
  RpgItemSlot,
  RpgTrial,
} from '../db/repositories/rpgRepo.js';
import {
  GUARD_ELIXIR_DAILY_LIMIT,
  GUARD_ELIXIR_PRICE,
  MAX_ENHANCE_LEVEL,
  MAX_RPG_LEVEL,
  MAX_TRIAL_PILLS,
  MAX_TRIAL_SABOTEURS,
  MAX_TRIAL_SUPPORTERS,
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

function formatCompactGearItem(item: RpgItem | undefined): string {
  if (!item) return '空';
  const badge = RPG_RARITY_BADGE[item.rarity];
  const enh = item.enhanceLevel > 0 ? `+${item.enhanceLevel}` : '';
  return `${badge.emoji}${item.name}${enh}`;
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
    '欢迎踏入艾尔登西亚西幻大陆！挑选你的初始职业，即可免费开启 **十阶九重境** 秘境挂机、每日体力速刷 Boss、炼金秘药与 **60秒全服围观破境** 冒险：',
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
    `⚔️ 战力：**❤️ ${stats.maxHp}** · **⚔️ ${stats.atk}** · **🛡️ ${stats.def}** · **💥 ${formatBpPercent(stats.critBp)}** ｜ 试炼秘药 **🧪×${character.promoPills}** · 护魂 **🛡️×${character.guardElixirs}**`,
  );

  if (stats.petSynergy) {
    lines.push(
      `🐾 出战战宠：${stats.petSynergy.emoji} **${stats.petSynergy.nickname}**（Lv.${stats.petSynergy.level}，提供 HP+${stats.petSynergy.bonusHp} / ATK+${stats.petSynergy.bonusAtk} / 破境加成）`,
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
    `${preview.realm.tierDef.bossEmoji} **秘境速刷 Boss：${preview.realm.tierDef.bossName}**`,
    `> 消耗 **1 体力/次** 即时判定 S/A/B 评级，掉落大量经验、${economy.currencyName}、当前阶位装备与随机秘药！`,
  );

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 西幻秘境冒险大厅`, iconURL: actor.avatarUrl })
    .setTitle('⚔️ 艾尔登西亚 · 十阶秘境与破境大厅')
    .setDescription(withFeedback(lines.join('\n'), feedback))
    .setFooter({
      text: `共 ${RPG_TIERS.length} 大阶 × 9 重（Lv.1~90）｜ 挂机最多累计 24 小时 ｜ 公开破境仅在 #游戏聊天 发起`,
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
      'rpg:nav:trial',
      preview.atGate || pendingTrial ? '⚡ 立即破境试炼' : '🧪 秘药与破境',
      preview.atGate || pendingTrial ? ButtonStyle.Success : ButtonStyle.Secondary,
    ),
  ];

  if (preview.isInjuredNow) {
    row1Buttons.push(
      makeButton(
        'rpg:act:heal_injury',
        `💚 治愈重伤 (${healCost})`,
        ButtonStyle.Danger,
      ),
    );
  }

  return {
    embeds: [embed],
    components: [
      buttonRow(...row1Buttons),
      buttonRow(
        makeButton('rpg:nav:gear', '🎒 装备管理', ButtonStyle.Secondary),
        makeButton(
          'rpg:act:buy_stamina',
          `🧪 买体力药 (${rpgCfg.staminaPotionPrice})`,
          ButtonStyle.Secondary,
          potionBuysLeft === 0,
        ),
        makeButton('rpg:nav:class', '🔄 转职', ButtonStyle.Secondary),
        makeButton('rpg:act:share_profile', '📣 晒出战绩', ButtonStyle.Secondary),
        makeButton('menu:rank:rpg:1', '🏆 阶位榜', ButtonStyle.Secondary),
      ),
      buttonRow(
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
        makeButton('rpg:nav:gear', '🎒 装备管理', ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildPublicTrialCard(
  trial: RpgTrial,
  economy: EconomyConfig,
  supporterPayouts?: readonly SupporterPayout[],
  _nowMs = Date.now(),
): BuiltMenuMessage {
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
    .setDescription(lines.join('\n'))
    .setFooter({ text: `试炼仅在 #游戏聊天 举办 · 每名围观玩家仅可选择助威或起哄一次` })
    .setTimestamp(trial.resolvedAt ?? trial.createdAt);

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
        makeButton(
          `rpg:trial_settle:${trial.id}`,
          '⚡ 立刻引动天劫',
          ButtonStyle.Primary,
        ),
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
    lines.push('', '📭 你的装备背包还是空的！快去领取挂机或速刷秘境 Boss 收集装备吧！');
    components.push(
      buttonRow(
        makeButton('rpg:act:raid_one', '⚔️ 速刷Boss (1体)', ButtonStyle.Success),
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
    .setFooter({ text: '转职后保留勇者阶位、经验、秘药库存与全部装备' })
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
