import { EmbedBuilder } from 'discord.js';
import { formatAffixList, formatLegendaryEffect } from '../../services/rpgAffixes.js';
import {
  RPG_CLASS_MAP,
  RPG_TIERS,
  computeHealInjuryCost,
  getArenaTierLabel,
  getRpgRealmInfo,
} from '../../services/rpgService.js';
import { COLORS } from '../../ui/embeds.js';
import type { MenuActor } from '../../ui/menuShared.js';
import {
  RPG_SLOT_META,
  buildRpgClassSwitchView,
  buildRpgCoopView,
  buildRpgGearView,
  buildRpgHomeView,
  buildRpgPvpView,
  buildRpgTrialView,
  formatBpPercent,
  formatRpgItemDisplay,
} from '../../ui/rpgMenuBuilder.js';
import { dispatchByAction } from '../menu/subRouter.js';
import {
  buildLegendaryDropPublicEmbed,
  formatLootNotes,
  isRpgClassKey,
  sendToGameChat,
  type RpgButtonContext,
} from './rpgInteractionHelpers.js';

interface ActorActionContext extends RpgButtonContext {
  actor: MenuActor;
}

async function handleClaimIdle(ac: ActorActionContext): Promise<void> {
  const { interaction, ctx, guildId, cfg, nowMs, actor } = ac;
  const res = ctx.services.rpg.claimIdleHarvest(guildId, actor.id, nowMs);
  if (!res.ok) {
    const msg =
      res.reason === 'no_class_selected'
        ? '请先选择初始职业再领取挂机收益！'
        : `挂机时间未满 1 分钟，还需等待 **${res.waitSeconds ?? 1}** 秒。`;
    await interaction.update(
      buildRpgHomeView(ctx, guildId, actor, { type: 'info', text: msg }, nowMs),
    );
    return;
  }

  const realm = getRpgRealmInfo(res.character.level);
  const dustTag = res.dustEarned > 0 ? ` ｜ ✨ **+${res.dustEarned}** 魔尘` : '';
  const summaryLines = [
    `🌾 **挂机收菜成功！**（战力加成 **${res.powerMultiplier.toFixed(2)}x**）`,
    `✨ 获得 **+${res.xpEarned.toLocaleString('en-US')} XP**${
      res.levelsGained > 0 ? `（🎉 突破至 **${realm.fullLabel}**！）` : ''
    } ｜ ${cfg.economy.currencyEmoji} **+${res.netCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName}${
      res.garnishedCoins > 0 ? `（含抵债 ${res.garnishedCoins}）` : ''
    }${dustTag}`,
  ];
  if (res.hitGate) {
    summaryLines.push('🔥 **九重瓶颈经验已满！** 请前往「⚡ 立即破境试炼」突破至下一阶！');
  }
  if (res.adventures.length > 0) {
    summaryLines.push(...res.adventures.slice(0, 2));
  }
  summaryLines.push(
    ...formatLootNotes({
      legendaryAndEpicPreviewItems: res.bankedItems,
      autoSalvagedCount: res.autoSalvagedCount,
      autoSalvagedCoins: res.autoSalvagedCoins,
      autoSalvagedDust: res.autoSalvagedDust,
      pillsFound: res.pillsFound,
      elixirsFound: res.elixirsFound,
      currencyEmoji: cfg.economy.currencyEmoji,
    }),
  );

  await interaction.update(
    buildRpgHomeView(
      ctx,
      guildId,
      actor,
      { type: 'success', text: summaryLines.join('\n') },
      nowMs,
    ),
  );

  if (res.legendaryDrops.length > 0) {
    const dropEmbed = buildLegendaryDropPublicEmbed({
      userId: actor.id,
      sourceLabel: `${realm.tierDef.zoneName} 挂机奇遇`,
      legendaryDrops: res.legendaryDrops,
      realm,
    });
    await sendToGameChat(interaction, ctx, cfg, {
      content: `🟧 欧皇现世：<@${actor.id}> 在挂机探索中拾取传说装备！`,
      embeds: [dropEmbed],
    });
  }
}

async function handleRaidBoss(ac: ActorActionContext, mode: 'single' | 'all'): Promise<void> {
  const { interaction, ctx, guildId, cfg, nowMs, actor } = ac;
  const res = ctx.services.rpg.raidBoss(guildId, actor.id, mode, nowMs);
  if (!res.ok) {
    const msg =
      res.reason === 'no_class_selected'
        ? '请先选择初始职业后再挑战秘境 Boss！'
        : '⚡ 体力不足！可每日凌晨自动回满，或点击下方「🧪 买体力药」补充体力。';
    await interaction.update(
      buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: msg }, nowMs),
    );
    return;
  }

  const realm = getRpgRealmInfo(res.character.level);
  const summaryLines = [
    `${res.tierDef.bossEmoji} **${res.runsExecuted > 1 ? `扫荡 ${res.runsExecuted} 次` : '速刷'}「${res.tierDef.bossName}」胜利！**（第 ${res.roundsPlayed} 回合斩杀 · 评级 **${res.rating}**）`,
    `✨ **+${res.xpEarned.toLocaleString('en-US')} XP**${
      res.levelsGained > 0 ? `（🎉 升至 **${realm.fullLabel}**！）` : ''
    } ｜ ${cfg.economy.currencyEmoji} **+${res.netCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName}${
      res.garnishedCoins > 0 ? `（含抵债 ${res.garnishedCoins}）` : ''
    } ｜ ✨ **+${res.dustEarned}** 奥术魔尘`,
  ];
  if (res.highlights.length > 0) {
    summaryLines.push(...res.highlights.slice(0, 3));
  }
  if (res.hitGate) {
    summaryLines.push('🔥 **九重瓶颈经验已满！** 请点击「⚡ 立即破境试炼」进阶！');
  }
  summaryLines.push(
    ...formatLootNotes({
      legendaryAndEpicPreviewItems: res.bankedItems,
      autoSalvagedCount: res.autoSalvagedCount,
      autoSalvagedCoins: res.autoSalvagedCoins,
      autoSalvagedDust: res.autoSalvagedDust,
      pillsFound: res.pillsFound,
      elixirsFound: res.elixirsFound,
      currencyEmoji: cfg.economy.currencyEmoji,
    }),
  );

  await interaction.update(
    buildRpgHomeView(
      ctx,
      guildId,
      actor,
      { type: 'success', text: summaryLines.join('\n') },
      nowMs,
    ),
  );

  if (res.legendaryDrops.length > 0) {
    const dropEmbed = buildLegendaryDropPublicEmbed({
      userId: actor.id,
      sourceLabel: `速刷 ${res.tierDef.bossName}`,
      legendaryDrops: res.legendaryDrops,
      realm,
    });
    await sendToGameChat(interaction, ctx, cfg, {
      content: `🟧 神装降临：<@${actor.id}> 击杀 **${res.tierDef.bossName}** 爆出传说装备！`,
      embeds: [dropEmbed],
    });
  }
}

async function handleAbyss(ac: ActorActionContext): Promise<void> {
  const { interaction, ctx, guildId, cfg, nowMs, actor } = ac;
  const res = ctx.services.rpg.challengeAbyssBoss(guildId, actor.id, nowMs);
  if (!res.ok) {
    const msg =
      res.reason === 'no_class_selected'
        ? '请先选择初始职业后再挑战深渊领主！'
        : '⚡ 体力不足！已通关的本阶深渊需要 1 点体力（未首通的新阶深渊免体力挑战）。';
    await interaction.update(
      buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: msg }, nowMs),
    );
    return;
  }

  if (!res.won) {
    const failLines = [
      `💀 **深渊挑战失利…** 鏖战 **${res.roundsPlayed}** 回合未能击败「**${res.bossName}**」（剩余 HP **${res.bossRemainingHp}/${res.bossMaxHp}** · **本次未扣除体力**）！`,
      ...res.highlights.slice(0, 4),
      '💡 建议前往「🎒 铁匠与装备」强化装备或重铸嗜血/破甲/狂暴词条后再战！',
    ];
    await interaction.update(
      buildRpgHomeView(
        ctx,
        guildId,
        actor,
        { type: 'error', text: failLines.join('\n') },
        nowMs,
      ),
    );
    return;
  }

  const realm = getRpgRealmInfo(res.character.level);
  const clearBadge = res.isFirstClear
    ? '🏆 **本阶深渊首通达成！（0体力消耗）**'
    : '💀 **深渊领主讨伐胜利！**';
  const winLines = [
    `${clearBadge} 第 **${res.roundsPlayed}** 回合斩落「**${res.bossName}**」（评级 **${res.rating}**）`,
    `✨ **+${res.xpEarned.toLocaleString('en-US')} XP**${
      res.levelsGained > 0 ? `（🎉 升至 **${realm.fullLabel}**！）` : ''
    } ｜ ${cfg.economy.currencyEmoji} **+${res.netCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName} ｜ ✨ **+${res.dustEarned}** 奥术魔尘`,
    ...res.highlights.slice(0, 4),
    ...formatLootNotes({
      legendaryAndEpicPreviewItems: res.bankedItems,
      autoSalvagedCount: res.autoSalvagedCount,
      autoSalvagedCoins: res.autoSalvagedCoins,
      autoSalvagedDust: res.autoSalvagedDust,
      pillsFound: 0,
      elixirsFound: 0,
      currencyEmoji: cfg.economy.currencyEmoji,
    }),
  ];

  await interaction.update(
    buildRpgHomeView(
      ctx,
      guildId,
      actor,
      { type: 'success', text: winLines.join('\n') },
      nowMs,
    ),
  );

  if (res.legendaryDrops.length > 0) {
    const dropEmbed = buildLegendaryDropPublicEmbed({
      userId: actor.id,
      sourceLabel: `第 ${res.tier} 阶深渊领主「${res.bossName}」`,
      legendaryDrops: res.legendaryDrops,
      realm,
    });
    await sendToGameChat(interaction, ctx, cfg, {
      content: `🟧 深渊神装：<@${actor.id}> 征服深渊领主 **${res.bossName}** 斩获传说橙装！`,
      embeds: [dropEmbed],
    });
  }
}

async function handleBuyStamina(ac: ActorActionContext): Promise<void> {
  const { interaction, ctx, guildId, cfg, nowMs, actor } = ac;
  const res = ctx.services.rpg.buyStaminaPotion(guildId, actor.id, nowMs);
  if (res.ok) {
    await interaction.update(
      buildRpgHomeView(
        ctx,
        guildId,
        actor,
        {
          type: 'success',
          text: `🧪 购买体力药水成功！体力 **+1**（当前 **${res.character.stamina}**），消耗 ${cfg.economy.currencyEmoji} **${res.cost}**，今日还可购 **${res.buysRemaining}** 次。`,
        },
        nowMs,
      ),
    );
    return;
  }
  const rpgCfg = ctx.services.rpg.getConfig(guildId);
  const errText =
    res.reason === 'daily_limit_reached'
      ? `今日体力药水购买次数已达上限（${res.dailyLimit ?? rpgCfg.staminaPotionDailyLimit} 次），明日再买吧！`
      : `口袋 ${cfg.economy.currencyName} 不足！体力药水需要 **${res.cost ?? rpgCfg.staminaPotionPrice}** ${cfg.economy.currencyName}。`;
  await interaction.update(
    buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: errText }, nowMs),
  );
}

async function handleHealInjury(ac: ActorActionContext): Promise<void> {
  const { interaction, ctx, guildId, cfg, nowMs, actor } = ac;
  const res = ctx.services.rpg.healInjury(guildId, actor.id, nowMs);
  if (res.ok) {
    await interaction.update(
      buildRpgHomeView(
        ctx,
        guildId,
        actor,
        {
          type: 'success',
          text: `💚 **重伤已痊愈！** 消耗 ${cfg.economy.currencyEmoji} **${res.cost.toLocaleString('en-US')}** ${cfg.economy.currencyName}，秘境挂机收益已恢复 1.0x！`,
        },
        nowMs,
      ),
    );
    return;
  }
  const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
  const errText =
    res.reason === 'not_injured'
      ? '你当前状态健康，没有破境反噬重伤。'
      : `口袋 ${cfg.economy.currencyName} 不足！治愈重伤需要 **${res.cost ?? computeHealInjuryCost(character.level)}** ${cfg.economy.currencyName}。`;
  await interaction.update(
    buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: errText }, nowMs),
  );
}

async function handleShareProfile(ac: ActorActionContext): Promise<void> {
  const { interaction, ctx, guildId, cfg, nowMs, actor } = ac;
  const character = ctx.services.rpg.getOrCreateCharacter(guildId, actor.id, nowMs);
  if (!character.classSelected) {
    await interaction.update(
      buildRpgHomeView(
        ctx,
        guildId,
        actor,
        { type: 'error', text: '请先选择初始职业后再晒出战绩！' },
        nowMs,
      ),
    );
    return;
  }
  const stats = ctx.services.rpg.computeCombatStats(guildId, actor.id, nowMs);
  const realm = getRpgRealmInfo(character.level);
  const cls = RPG_CLASS_MAP.get(character.classKey);
  const gearLines =
    stats.equippedItems.length > 0
      ? stats.equippedItems.map((it) => {
          const affixNote = it.affixes.length > 0 ? `（${formatAffixList(it.affixes)}）` : '';
          const legNote = it.legendaryEffect
            ? ` ${formatLegendaryEffect(it.legendaryEffect, false)}`
            : '';
          return `• ${RPG_SLOT_META[it.slot].emoji} ${formatRpgItemDisplay(it)}${affixNote}${legNote}`;
        })
      : ['• 暂无穿戴装备'];

  const cardEmbed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setAuthor({ name: `${actor.displayName} · 勇者档案名片`, iconURL: actor.avatarUrl })
    .setTitle(
      `${cls?.emoji ?? '⚔️'} ${cls?.name ?? '冒险者'} · ${realm.fullLabel}（Lv.${character.level}）`,
    )
    .setDescription(
      [
        `⚔️ 战力：**❤️ ${stats.maxHp}** ｜ **⚔️ ${stats.atk}** ｜ **🛡️ ${stats.def}** ｜ **💥 暴击 ${formatBpPercent(stats.critBp)}**`,
        `🏆 天梯分：**${character.arenaRating.toLocaleString('en-US')}**（${getArenaTierLabel(character.arenaRating)}） ｜ 💀 深渊：**第 ${character.abyssClearedTier}/${RPG_TIERS.length} 阶** ｜ ✨ 魔尘：**${character.arcaneDust.toLocaleString('en-US')}**`,
        `🌟 成功破境：**${character.totalBreakthroughs}** 次 ｜ 💀 击杀 Boss：**${character.totalBossKills}** 次`,
        '🎒 **神装词条构筑：**',
        ...gearLines,
      ].join('\n'),
    )
    .setTimestamp();

  const pub = await sendToGameChat(interaction, ctx, cfg, {
    content: `📣 <@${actor.id}> 晒出了西幻冒险者档案！`,
    embeds: [cardEmbed],
  });
  await interaction.update(
    buildRpgHomeView(
      ctx,
      guildId,
      actor,
      pub.sent
        ? { type: 'success', text: `📣 已将你的勇者档案广播至 <#${pub.channelId}>！` }
        : {
            type: 'error',
            text: '⚠️ 未找到「#游戏聊天」频道或无发送权限，请联系管理员配置世界事件频道。',
          },
      nowMs,
    ),
  );
}

export async function handleRpgHomeAndBossButton(
  input: RpgButtonContext,
  actor: MenuActor,
): Promise<boolean> {
  const { interaction, ctx, guildId, cfg, nowMs, section, arg } = input;
  const ac: ActorActionContext = { ...input, actor };

  if (section === 'nav') {
    const handled = await dispatchByAction(arg, ac, {
      exact: {
        trial: async (a) => {
          await a.interaction.update(buildRpgTrialView(a.ctx, a.guildId, a.actor, undefined, a.nowMs));
        },
        gear: async (a) => {
          await a.interaction.update(buildRpgGearView(a.ctx, a.guildId, a.actor, null, undefined, a.nowMs));
        },
        pvp: async (a) => {
          await a.interaction.update(buildRpgPvpView(a.ctx, a.guildId, a.actor, undefined, a.nowMs));
        },
        coop: async (a) => {
          await a.interaction.update(buildRpgCoopView(a.ctx, a.guildId, a.actor, undefined, a.nowMs));
        },
        class: async (a) => {
          await a.interaction.update(buildRpgClassSwitchView(a.ctx, a.guildId, a.actor, undefined, a.nowMs));
        },
      },
    });
    if (!handled) {
      await interaction.update(buildRpgHomeView(ctx, guildId, actor, undefined, nowMs));
    }
    return true;
  }

  if (section === 'pick_class') {
    if (!isRpgClassKey(arg)) {
      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: '无效的职业编号。' }, nowMs),
      );
      return true;
    }
    const res = ctx.services.rpg.chooseOrSwitchClass(guildId, actor.id, arg, nowMs);
    if (!res.ok) {
      const rpgCfg = ctx.services.rpg.getConfig(guildId);
      const errMap: Record<typeof res.reason, string> = {
        same_class: '你当前已经是这个职业了，无需重复转职。',
        pending_trial: '当前有公开破境试炼进行中，需等待结算后再转职！',
        insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！转职需要 **${res.cost ?? rpgCfg.classSwitchCost}** ${cfg.economy.currencyName}。`,
      };
      await interaction.update(
        buildRpgClassSwitchView(ctx, guildId, actor, { type: 'error', text: errMap[res.reason] }, nowMs),
      );
      return true;
    }

    const cls = RPG_CLASS_MAP.get(arg)!;
    const text = res.isFirstSelection
      ? `🎉 你已正式成为 **${cls.emoji} ${cls.name}**！快去领取挂机经验、挑战深渊或参与团本吧！`
      : `🔄 转职成功！你已成为 **${cls.emoji} ${cls.name}**（消耗 ${cfg.economy.currencyEmoji} **${res.cost}** ${cfg.economy.currencyName}，余额 **${res.balance}**）。`;

    await interaction.update(
      buildRpgHomeView(ctx, guildId, actor, { type: 'success', text }, nowMs),
    );
    return true;
  }

  if (section === 'act') {
    return dispatchByAction(arg, ac, {
      exact: {
        claim_idle: handleClaimIdle,
        raid_one: (a) => handleRaidBoss(a, 'single'),
        raid_all: (a) => handleRaidBoss(a, 'all'),
        abyss: handleAbyss,
        buy_stamina: handleBuyStamina,
        heal_injury: handleHealInjury,
        share_profile: handleShareProfile,
      },
    });
  }

  return false;
}
