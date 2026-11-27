import { ButtonStyle, EmbedBuilder } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import type { RpgItem, RpgItemSlot } from '../../db/repositories/rpgRepo.js';
import { formatLegendaryEffect } from '../../services/rpgAffixes.js';
import {
  MAX_RPG_LEVEL,
  MAX_TRIAL_SABOTEURS,
  MAX_TRIAL_SUPPORTERS,
  RPG_CLASSES,
  RPG_CLASS_MAP,
  RPG_TIERS,
  computeHealInjuryCost,
  getArenaTierLabel,
  getRpgRealmInfo,
  xpNeededForRpgLevel,
} from '../../services/rpgService.js';
import { COLORS, renderProgressBar } from '../embeds.js';
import {
  buttonRow,
  makeButton,
  resolveColor,
  withFeedback,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuFeedback,
} from '../menuShared.js';
import { formatBpPercent, formatCompactGearItem, formatIdleDuration } from './rpgFormatters.js';

export function buildClassOnboardingView(
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
