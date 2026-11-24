import {
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { RpgClassKey, RpgItem } from '../db/repositories/rpgRepo.js';
import {
  RPG_CHAPTER_MAP,
  RPG_CLASS_MAP,
  computeItemEffectiveStats,
  type RunBankedReward,
  type RpgRunAction,
} from '../services/rpgService.js';
import { COLORS, createErrorEmbed, type AppContext } from '../ui/embeds.js';
import type { MenuFeedback } from '../ui/menuShared.js';
import {
  buildRpgChaptersView,
  buildRpgClassSwitchView,
  buildRpgGearView,
  buildRpgHomeView,
  buildRpgRunView,
  formatEffectiveStats,
  formatRpgItemDisplay,
} from '../ui/rpgMenuBuilder.js';
import { getActor, parsePositiveInt, sendPublicBroadcast } from './menuHelpers.js';

const VALID_CLASS_KEYS: ReadonlySet<string> = new Set<RpgClassKey>([
  'warrior',
  'mage',
  'ranger',
  'paladin',
]);

const VALID_RUN_ACTIONS: ReadonlySet<string> = new Set<RpgRunAction>([
  'attack',
  'skill',
  'defend',
  'potion',
  'retreat',
  'event_a',
  'event_b',
  'next_floor',
]);

function isRpgClassKey(raw: string | undefined): raw is RpgClassKey {
  return typeof raw === 'string' && VALID_CLASS_KEYS.has(raw);
}

function isRpgRunAction(raw: string | undefined): raw is RpgRunAction {
  return typeof raw === 'string' && VALID_RUN_ACTIONS.has(raw);
}

function formatBankedRewardSummary(input: {
  header: string;
  reward: RunBankedReward;
  balance: number;
  levelAfter: number;
  currencyEmoji: string;
  currencyName: string;
}): string {
  const { reward, currencyEmoji, currencyName } = input;
  const lines: string[] = [input.header];

  if (reward.grossCoins > 0) {
    const garnishNote =
      reward.garnishedCoins > 0
        ? `（实得 **+${reward.netCoins}**，其中 **${reward.garnishedCoins}** 自动抵扣逾期债务）`
        : '';
    lines.push(
      `${currencyEmoji} 收益：**+${reward.grossCoins}** ${currencyName}${garnishNote} ｜ 当前余额 **${input.balance}**`,
    );
  } else {
    lines.push(`${currencyEmoji} 当前口袋余额：**${input.balance}** ${currencyName}`);
  }

  if (reward.creditDelta > 0) {
    lines.push(`📜 信用奖励：信用分 **+${reward.creditDelta}**`);
  }

  if (reward.xpEarned > 0 || reward.levelsGained > 0) {
    const levelNote =
      reward.levelsGained > 0
        ? `（🎉 升级 **+${reward.levelsGained}** → **Lv.${input.levelAfter}**！）`
        : '';
    lines.push(`✨ 经验获得：**+${reward.xpEarned} XP**${levelNote}`);
  }

  if (reward.bankedItems.length > 0) {
    const preview = reward.bankedItems
      .slice(0, 5)
      .map((item) => formatRpgItemDisplay(item))
      .join('、');
    const extra = reward.bankedItems.length > 5 ? ` 等共 ${reward.bankedItems.length} 件` : '';
    lines.push(`🎁 入库装备：${preview}${extra}`);
  }

  if (reward.autoSalvagedCount > 0) {
    lines.push(
      `♻️ 背包已满自动拆解 **${reward.autoSalvagedCount}** 件溢出装备，折算 **+${reward.autoSalvagedCoins}** ${currencyName}。`,
    );
  }

  return lines.join('\n');
}

function buildPublicCelebrationEmbed(input: {
  userId: string;
  chapter: number;
  firstClear: boolean;
  legendaryDrops: readonly RpgItem[];
  bossBonusCoins: number;
  currencyEmoji: string;
  currencyName: string;
}): EmbedBuilder {
  const chDef = RPG_CHAPTER_MAP.get(input.chapter);
  const chTitle = chDef ? `${chDef.emoji} 第 ${chDef.chapter} 章「**${chDef.name}**」` : `第 ${input.chapter} 章`;

  let title = '🟧 欧皇时刻 · 西幻地下城掉落传说橙装！';
  if (input.firstClear && input.legendaryDrops.length > 0) {
    title = '👑 史诗喜报 · 章节首通 & 传说橙装降临！';
  } else if (input.firstClear) {
    title = '👑 全服捷报 · 勇者首通西幻地下城章节！';
  }

  const lines: string[] = [];
  if (input.firstClear) {
    const bossName = chDef ? `${chDef.boss.emoji} **${chDef.boss.name}**` : '章节首领';
    lines.push(
      `🎉 恭喜 <@${input.userId}> 首次斩杀 ${bossName}，成功首通 ${chTitle}！`,
      `💰 获得首通双倍赏金 ${input.currencyEmoji} **+${input.bossBonusCoins}** ${input.currencyName} 与 **+25 信用分**！`,
    );
  } else {
    lines.push(`🔥 欧皇 <@${input.userId}> 在 ${chTitle} 探险中喜提传说橙装！`);
  }

  if (input.legendaryDrops.length > 0) {
    lines.push('', '**🟧 传说装备掉落：**');
    for (const item of input.legendaryDrops) {
      const eff = computeItemEffectiveStats(item);
      lines.push(`• ${formatRpgItemDisplay(item)}（${formatEffectiveStats(eff)}）`);
    }
  }

  return new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setFooter({ text: '发送 /冒险 即可开启你的西幻地下城征程！' })
    .setTimestamp();
}

async function startChapterFromInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  ctx: AppContext,
  guildId: string,
  chapter: number,
  nowMs: number,
): Promise<void> {
  const actor = getActor(interaction, ctx, guildId);
  const res = ctx.services.rpg.startRun(guildId, actor.id, chapter, nowMs);

  if (res.ok) {
    const chDef = RPG_CHAPTER_MAP.get(chapter);
    const feedback: MenuFeedback = {
      type: 'success',
      text: `⚔️ 已消耗 1 点体力，踏入 ${chDef?.emoji ?? '🗺️'} 第 ${chapter} 章「**${chDef?.name ?? ''}**」（剩余体力 **${res.character.stamina}**）。`,
    };
    await interaction.update(buildRpgRunView(ctx, guildId, actor, feedback, nowMs));
    return;
  }

  if (res.reason === 'active_run_exists') {
    await interaction.update(
      buildRpgRunView(
        ctx,
        guildId,
        actor,
        { type: 'info', text: '你当前已有进行中的地下城探险，已为你恢复冒险进度！' },
        nowMs,
      ),
    );
    return;
  }

  const errMap: Record<Exclude<typeof res.reason, 'active_run_exists'>, string> = {
    invalid_chapter: '无效的章节编号，请重新选择。',
    chapter_locked: `该章节尚未解锁！你当前最高可挑战第 **${res.maxUnlockedChapter ?? 1}** 章，请先通关前置章节。`,
    insufficient_stamina: '体力不足（下本需要 1 点体力），请先购买体力药水或等待每日体力刷新！',
  };

  await interaction.update(
    buildRpgChaptersView(
      ctx,
      guildId,
      actor,
      { type: 'error', text: errMap[res.reason] },
      nowMs,
    ),
  );
}

export async function handleRpgButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (!cfg.modules.rpg) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🚫 模块未开启',
          '当前服务器已关闭 **奇幻RPG地牢** 模块，请联系管理员通过 `/菜单` → 管理后台或 `/设置 开关模块` 开启。',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const actor = getActor(interaction, ctx, guildId);
  const nowMs = Date.now();
  const parts = interaction.customId.split(':');
  const section = parts[1];
  const arg = parts[2];

  // Navigation
  if (section === 'nav') {
    if (arg === 'home') {
      await interaction.update(buildRpgHomeView(ctx, guildId, actor, undefined, nowMs));
      return;
    }
    if (arg === 'chapters') {
      await interaction.update(buildRpgChaptersView(ctx, guildId, actor, undefined, nowMs));
      return;
    }
    if (arg === 'run') {
      await interaction.update(buildRpgRunView(ctx, guildId, actor, undefined, nowMs));
      return;
    }
    if (arg === 'gear') {
      await interaction.update(buildRpgGearView(ctx, guildId, actor, null, undefined, nowMs));
      return;
    }
    if (arg === 'class') {
      await interaction.update(buildRpgClassSwitchView(ctx, guildId, actor, undefined, nowMs));
      return;
    }
  }

  // Pick / switch class
  if (section === 'pick_class') {
    if (!isRpgClassKey(arg)) {
      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: '无效的职业标识。' }, nowMs),
      );
      return;
    }
    const res = ctx.services.rpg.chooseOrSwitchClass(guildId, actor.id, arg, nowMs);
    if (res.ok) {
      const classDef = RPG_CLASS_MAP.get(arg)!;
      const text = res.isFirstSelection
        ? `🎉 欢迎加入冒险者公会！你已成为 ${classDef.emoji} **${classDef.name}**，快点击「选择章节下本」开启征程吧！`
        : `🔄 转职成功！你已转为 ${classDef.emoji} **${classDef.name}**（消耗 ${cfg.economy.currencyEmoji} **${res.cost}** ${cfg.economy.currencyName}，余额 **${res.balance}**）。`;
      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'success', text }, nowMs),
      );
      return;
    }

    const errMap: Record<typeof res.reason, string> = {
      same_class: '你当前已经是该职业了，无需重复转职。',
      insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！转职需要 **${res.cost ?? cfg.rpg.classSwitchCost}** ${cfg.economy.currencyName}。`,
      active_run: '你当前正在地下城冒险中，请先完成或撤退当前探险后再转职。',
    };
    await interaction.update(
      buildRpgClassSwitchView(ctx, guildId, actor, { type: 'error', text: errMap[res.reason] }, nowMs),
    );
    return;
  }

  // Start chapter run
  if (section === 'start') {
    const chapter = parsePositiveInt(arg ?? '');
    if (!chapter) {
      await interaction.update(
        buildRpgChaptersView(
          ctx,
          guildId,
          actor,
          { type: 'error', text: '无效的章节编号。' },
          nowMs,
        ),
      );
      return;
    }
    await startChapterFromInteraction(interaction, ctx, guildId, chapter, nowMs);
    return;
  }

  // Buy stamina potion or act in active run
  if (section === 'act') {
    if (arg === 'buy_stamina') {
      const res = ctx.services.rpg.buyStaminaPotion(guildId, actor.id, nowMs);
      if (res.ok) {
        const text = `🧪 购买体力药水成功！体力 **+1**（当前 **${res.character.stamina}**），消耗 ${cfg.economy.currencyEmoji} **${res.cost}** ${cfg.economy.currencyName}（余额 **${res.balance}**，今日余 **${res.buysRemaining}** 次）。`;
        await interaction.update(
          buildRpgHomeView(ctx, guildId, actor, { type: 'success', text }, nowMs),
        );
        return;
      }
      const errMap: Record<typeof res.reason, string> = {
        daily_limit_reached: `今日体力药水购买次数已达上限（每日限 **${res.dailyLimit ?? cfg.rpg.staminaPotionDailyLimit}** 次），明天再来吧！`,
        insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！购买体力药水需要 **${res.cost ?? cfg.rpg.staminaPotionPrice}** ${cfg.economy.currencyName}。`,
      };
      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: errMap[res.reason] }, nowMs),
      );
      return;
    }

    if (!isRpgRunAction(arg)) {
      await interaction.update(
        buildRpgRunView(
          ctx,
          guildId,
          actor,
          { type: 'error', text: '无效的战斗或探险指令。' },
          nowMs,
        ),
      );
      return;
    }

    const res = ctx.services.rpg.actInRun(guildId, actor.id, arg, nowMs);
    if (!res.ok) {
      if (res.reason === 'no_active_run') {
        await interaction.update(
          buildRpgHomeView(
            ctx,
            guildId,
            actor,
            { type: 'error', text: '当前没有进行中的地下城冒险，已返回冒险大厅。' },
            nowMs,
          ),
        );
        return;
      }

      const errMap: Record<Exclude<typeof res.reason, 'no_active_run'>, string> = {
        invalid_action_for_phase: '当前阶段无法执行该操作，已为你刷新最新战况。',
        skill_on_cooldown: `职业技能冷却中，还需 **${res.cooldownLeft ?? 1}** 回合！`,
        no_potions_left: '本局生命药水已经全部用完！',
      };
      await interaction.update(
        buildRpgRunView(ctx, guildId, actor, { type: 'error', text: errMap[res.reason] }, nowMs),
      );
      return;
    }

    if (res.outcome === 'ongoing' || res.outcome === 'floor_cleared') {
      const fbText =
        res.logs.length > 0
          ? res.logs.slice(-3).join('\n')
          : res.outcome === 'floor_cleared'
            ? '✅ 本层已清空，准备迈向下一层！'
            : '⚔️ 回合结算完成！';
      await interaction.update(
        buildRpgRunView(
          ctx,
          guildId,
          actor,
          { type: res.outcome === 'floor_cleared' ? 'success' : 'info', text: fbText },
          nowMs,
        ),
      );
      return;
    }

    if (res.outcome === 'victory') {
      const chDef = RPG_CHAPTER_MAP.get(res.chapter);
      const header = `🏆 **通关成功！** 击败 ${chDef?.boss.emoji ?? '👑'} **${chDef?.boss.name ?? '章节首领'}**，征服第 ${res.chapter} 章「**${chDef?.name ?? ''}**」${res.firstClear ? '（👑 首通双倍奖励！）' : ''}`;
      const summary = formatBankedRewardSummary({
        header,
        reward: res.reward,
        balance: res.balance,
        levelAfter: res.character.level,
        currencyEmoji: cfg.economy.currencyEmoji,
        currencyName: cfg.economy.currencyName,
      });

      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'success', text: summary }, nowMs),
      );

      if (res.firstClear || res.legendaryDrops.length > 0) {
        const publicEmbed = buildPublicCelebrationEmbed({
          userId: actor.id,
          chapter: res.chapter,
          firstClear: res.firstClear,
          legendaryDrops: res.legendaryDrops,
          bossBonusCoins: res.reward.bossBonusCoins,
          currencyEmoji: cfg.economy.currencyEmoji,
          currencyName: cfg.economy.currencyName,
        });
        await sendPublicBroadcast(interaction, {
          content: res.firstClear
            ? `👑 全服贺电：<@${actor.id}> 首通第 ${res.chapter} 章「${chDef?.name ?? ''}」！`
            : `🟧 欧皇降临：<@${actor.id}> 在地下城喜提传说橙装！`,
          embeds: [publicEmbed],
        });
      }
      return;
    }

    if (res.outcome === 'retreated') {
      const chDef = RPG_CHAPTER_MAP.get(res.chapter);
      const header = `🏃 **安全撤退！** 从第 ${res.chapter} 章「**${chDef?.name ?? ''}**」第 ${res.floor} 层见好就收，全部战利品已安全入库！`;
      const summary = formatBankedRewardSummary({
        header,
        reward: res.reward,
        balance: res.balance,
        levelAfter: res.character.level,
        currencyEmoji: cfg.economy.currencyEmoji,
        currencyName: cfg.economy.currencyName,
      });

      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'info', text: summary }, nowMs),
      );

      if (res.legendaryDrops.length > 0) {
        const publicEmbed = buildPublicCelebrationEmbed({
          userId: actor.id,
          chapter: res.chapter,
          firstClear: false,
          legendaryDrops: res.legendaryDrops,
          bossBonusCoins: 0,
          currencyEmoji: cfg.economy.currencyEmoji,
          currencyName: cfg.economy.currencyName,
        });
        await sendPublicBroadcast(interaction, {
          content: `🟧 欧皇降临：<@${actor.id}> 满载传说橙装安全撤出地下城！`,
          embeds: [publicEmbed],
        });
      }
      return;
    }

    if (res.outcome === 'defeat') {
      const chDef = RPG_CHAPTER_MAP.get(res.chapter);
      const defeatSummary = [
        `💀 **探险战败！** 你在第 ${res.chapter} 章「**${chDef?.name ?? ''}**」第 ${res.floor} 层力竭倒下。`,
        `📉 遗失未入库战利品：${cfg.economy.currencyEmoji} **${res.lostLoot.coins}** ${cfg.economy.currencyName} ｜ ✨ **${res.lostLoot.xp}** XP ｜ 🎁 **${res.lostLoot.itemCount}** 件装备。`,
        '💡 提示：前往「装备与强化」提升战力，或在残血时及时点击「见好就收撤退」保底带出战利品！',
      ].join('\n');

      await interaction.update(
        buildRpgHomeView(ctx, guildId, actor, { type: 'error', text: defeatSummary }, nowMs),
      );
      return;
    }

    return;
  }

  // Gear operations: equip / unequip / enhance / salvage
  if (
    section === 'gear_equip' ||
    section === 'gear_unequip' ||
    section === 'gear_enhance' ||
    section === 'gear_salvage'
  ) {
    const itemId = parsePositiveInt(arg ?? '');
    if (!itemId) {
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          null,
          { type: 'error', text: '无效的装备编号。' },
          nowMs,
        ),
      );
      return;
    }

    if (section === 'gear_equip') {
      const res = ctx.services.rpg.equipItem(guildId, actor.id, itemId, nowMs);
      if (res.ok) {
        const swapNote = res.unequippedItem
          ? `（已自动换下 **${res.unequippedItem.name}**）`
          : '';
        await interaction.update(
          buildRpgGearView(
            ctx,
            guildId,
            actor,
            res.item.id,
            {
              type: 'success',
              text: `✅ 已装备 ${formatRpgItemDisplay(res.item)}${swapNote}！`,
            },
            nowMs,
          ),
        );
        return;
      }
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该装备，可能已被拆解。',
        already_equipped: '该装备已经穿戴在身上了。',
      };
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          itemId,
          { type: 'error', text: errMap[res.reason] },
          nowMs,
        ),
      );
      return;
    }

    if (section === 'gear_unequip') {
      const res = ctx.services.rpg.unequipItem(guildId, actor.id, itemId, nowMs);
      if (res.ok) {
        await interaction.update(
          buildRpgGearView(
            ctx,
            guildId,
            actor,
            res.item.id,
            { type: 'success', text: `⬇️ 已卸下 ${formatRpgItemDisplay(res.item)}，放回背包。` },
            nowMs,
          ),
        );
        return;
      }
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该装备。',
        not_equipped: '该装备当前并未穿戴。',
      };
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          itemId,
          { type: 'error', text: errMap[res.reason] },
          nowMs,
        ),
      );
      return;
    }

    if (section === 'gear_enhance') {
      const res = ctx.services.rpg.enhanceItem(guildId, actor.id, itemId, nowMs);
      if (res.ok) {
        const feedback: MenuFeedback = res.success
          ? {
              type: 'success',
              text: `🔨 强化成功！${formatRpgItemDisplay(res.item)} 全属性大幅提升！（花费 ${cfg.economy.currencyEmoji} **${res.cost}** ${cfg.economy.currencyName}，余额 **${res.balance}**）`,
            }
          : {
              type: 'error',
              text: `💨 强化失败… ${formatRpgItemDisplay(res.item)} 等级保持不变（装备完好无损；花费 ${cfg.economy.currencyEmoji} **${res.cost}** ${cfg.economy.currencyName}，成功率 ${Math.round(res.successRate * 100)}%，余额 **${res.balance}**）。`,
            };
        await interaction.update(
          buildRpgGearView(ctx, guildId, actor, res.item.id, feedback, nowMs),
        );
        return;
      }
      const errMap: Record<typeof res.reason, string> = {
        not_found: '找不到该装备。',
        max_enhance_level: '该装备已经强化至满级（+10），无法继续强化！',
        insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！强化需要 **${res.cost ?? 0}** ${cfg.economy.currencyName}。`,
      };
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          itemId,
          { type: 'error', text: errMap[res.reason] },
          nowMs,
        ),
      );
      return;
    }

    // gear_salvage
    const res = ctx.services.rpg.salvageItem(guildId, actor.id, itemId);
    if (res.ok) {
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          null,
          {
            type: 'success',
            text: `💰 已拆解 ${formatRpgItemDisplay(res.salvagedItem)}，获得 ${cfg.economy.currencyEmoji} **+${res.coinsEarned}** ${cfg.economy.currencyName}（当前余额 **${res.balance}**）。`,
          },
          nowMs,
        ),
      );
      return;
    }
    const errMap: Record<typeof res.reason, string> = {
      not_found: '找不到该装备，可能已被拆解。',
      item_equipped: '该装备正在穿戴中，请先点击「卸下」后再拆解！',
    };
    await interaction.update(
      buildRpgGearView(
        ctx,
        guildId,
        actor,
        itemId,
        { type: 'error', text: errMap[res.reason] },
        nowMs,
      ),
    );
    return;
  }

  await interaction.update(
    buildRpgHomeView(
      ctx,
      guildId,
      actor,
      { type: 'error', text: '未知的冒险操作，已为你刷新冒险大厅。' },
      nowMs,
    ),
  );
}

export async function handleRpgStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

  if (!cfg.modules.rpg) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '🚫 模块未开启',
          '当前服务器已关闭 **奇幻RPG地牢** 模块，请联系管理员通过 `/菜单` → 管理后台或 `/设置 开关模块` 开启。',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const actor = getActor(interaction, ctx, guildId);
  const nowMs = Date.now();
  const section = interaction.customId.split(':')[1];

  if (section === 'gear_select') {
    const selectedId = parsePositiveInt(interaction.values[0] ?? '');
    await interaction.update(buildRpgGearView(ctx, guildId, actor, selectedId, undefined, nowMs));
    return;
  }

  if (section === 'start_select') {
    const chapter = parsePositiveInt(interaction.values[0] ?? '');
    if (!chapter) {
      await interaction.update(
        buildRpgChaptersView(
          ctx,
          guildId,
          actor,
          { type: 'error', text: '无效的章节编号。' },
          nowMs,
        ),
      );
      return;
    }
    await startChapterFromInteraction(interaction, ctx, guildId, chapter, nowMs);
    return;
  }

  await interaction.update(
    buildRpgHomeView(
      ctx,
      guildId,
      actor,
      { type: 'error', text: '未知的冒险选择操作，已返回冒险大厅。' },
      nowMs,
    ),
  );
}
