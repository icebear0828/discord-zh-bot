import { formatAffixList, formatAffixTag } from '../../services/rpgAffixes.js';
import { RARITY_META } from '../../services/rpgService.js';
import type { MenuActor, MenuFeedback } from '../../ui/menuShared.js';
import {
  RPG_SLOT_META,
  buildRpgGearView,
  formatRpgItemDisplay,
} from '../../ui/rpgMenuBuilder.js';
import { parsePositiveInt } from '../menuHelpers.js';
import { dispatchByAction } from '../menu/subRouter.js';
import { parseLockAffixArg, type RpgButtonContext } from './rpgInteractionHelpers.js';

interface GearActionContext extends RpgButtonContext {
  actor: MenuActor;
}

async function handleEquipBest(gc: GearActionContext): Promise<void> {
  const { interaction, ctx, guildId, actor, nowMs } = gc;
  const res = ctx.services.rpg.equipBestGear(guildId, actor.id, nowMs);
  if (!res.ok) {
    await interaction.update(
      buildRpgGearView(
        ctx,
        guildId,
        actor,
        null,
        { type: 'error', text: '📭 背包里还没有装备，先去领挂机或刷 Boss 吧！' },
        nowMs,
      ),
    );
    return;
  }

  const feedback: MenuFeedback =
    res.changed.length > 0
      ? {
          type: 'success',
          text: `⚡ 一键换装完成（已按职业权重+词条评分优选）！已更换 **${res.changed.length}** 个部位：${res.changed
            .map((c) => `${RPG_SLOT_META[c.slot].emoji} ${formatRpgItemDisplay(c.item)}`)
            .join('、')}。`,
        }
      : {
          type: 'info',
          text: '✨ 你当前穿戴的已经是背包里契合当前职业评分最高的一套装备了！',
        };

  await interaction.update(
    buildRpgGearView(ctx, guildId, actor, res.changed[0]?.item.id ?? null, feedback, nowMs),
  );
}

async function handleBulkSalvage(gc: GearActionContext): Promise<void> {
  const { interaction, ctx, guildId, cfg, actor, nowMs } = gc;
  const res = ctx.services.rpg.bulkSalvageItems(guildId, actor.id, 'uncommon', nowMs);
  if (!res.ok) {
    await interaction.update(
      buildRpgGearView(
        ctx,
        guildId,
        actor,
        null,
        { type: 'info', text: '🧹 背包里没有可拆解的未装备、未锁定普通/精良装备。' },
        nowMs,
      ),
    );
    return;
  }

  const breakdown: string[] = [];
  if (res.byRarity.common) breakdown.push(`${RARITY_META.common.label}×${res.byRarity.common}`);
  if (res.byRarity.uncommon) {
    breakdown.push(`${RARITY_META.uncommon.label}×${res.byRarity.uncommon}`);
  }
  const detail = breakdown.length > 0 ? `（${breakdown.join('、')}）` : '';

  await interaction.update(
    buildRpgGearView(
      ctx,
      guildId,
      actor,
      null,
      {
        type: 'success',
        text: `♻️ 一键拆解 **${res.salvagedCount}** 件白绿装${detail}，获得 ${cfg.economy.currencyEmoji} **+${res.totalCoins.toLocaleString('en-US')}** ${cfg.economy.currencyName} ＋ ✨ **+${res.totalDust}** 奥术魔尘（当前魔尘 **${res.arcaneDust}**）！`,
      },
      nowMs,
    ),
  );
}

async function handleCycleLock(gc: GearActionContext): Promise<void> {
  const { interaction, ctx, guildId, actor, nowMs, arg, subArg } = gc;
  const itemId = parsePositiveInt(arg ?? '');
  const nextLockIdx = parseLockAffixArg(subArg);
  const label = nextLockIdx === null ? '不锁定任何词条' : `锁定第 ${nextLockIdx + 1} 条词条`;
  await interaction.update(
    buildRpgGearView(
      ctx,
      guildId,
      actor,
      itemId,
      { type: 'info', text: `🔒 已切换重铸策略为：**${label}**` },
      nowMs,
      nextLockIdx,
    ),
  );
}

async function handleReforge(gc: GearActionContext): Promise<void> {
  const { interaction, ctx, guildId, cfg, actor, nowMs, arg, subArg } = gc;
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
  const lockIdx = parseLockAffixArg(subArg);
  const res = ctx.services.rpg.reforgeItemAffixes(guildId, actor.id, itemId, lockIdx, nowMs);
  if (!res.ok) {
    const errMap: Record<typeof res.reason, string> = {
      not_found: '找不到该装备，可能已被拆解。',
      cannot_reforge_common: '普通品质装备没有随机词条槽位，无法重铸。',
      invalid_lock_index: '锁定的词条序号无效，已为你刷新面板。',
      insufficient_funds: `口袋 ${cfg.economy.currencyName} 不足！本次重铸需要 **${(res.costCoins ?? 0).toLocaleString('en-US')}** ${cfg.economy.currencyName}。`,
      insufficient_dust: `✨ 奥术魔尘不足！本次重铸需要 **${res.costDust ?? 0}** 魔尘（当前 **${res.currentDust ?? 0}**），可通过拆解装备、深渊、天梯或团本获取。`,
    };
    await interaction.update(
      buildRpgGearView(
        ctx,
        guildId,
        actor,
        itemId,
        { type: 'error', text: errMap[res.reason] },
        nowMs,
        lockIdx,
      ),
    );
    return;
  }

  const lockNote = res.lockedAffix ? `（已保留 ${formatAffixTag(res.lockedAffix)}）` : '';
  const preservedIdx = res.lockedAffix ? 0 : null;
  await interaction.update(
    buildRpgGearView(
      ctx,
      guildId,
      actor,
      res.item.id,
      {
        type: 'success',
        text: `✨ **重铸成功！** ${formatRpgItemDisplay(res.item)} 新词条：**${formatAffixList(res.item.affixes)}**${lockNote}\n消耗 ${cfg.economy.currencyEmoji} **${res.costCoins.toLocaleString('en-US')}** ＋ ✨ **${res.costDust}** 魔尘（剩余魔尘 **${res.arcaneDust}**）。`,
      },
      nowMs,
      preservedIdx,
    ),
  );
}

async function handleSingleItemOp(gc: GearActionContext): Promise<void> {
  const { interaction, ctx, guildId, cfg, actor, nowMs, section, arg } = gc;
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

  if (section === 'gear_lock') {
    const res = ctx.services.rpg.toggleItemLock(guildId, actor.id, itemId);
    if (!res.ok) {
      await interaction.update(
        buildRpgGearView(
          ctx,
          guildId,
          actor,
          null,
          { type: 'error', text: '找不到该装备，可能已被拆解。' },
          nowMs,
        ),
      );
      return;
    }
    await interaction.update(
      buildRpgGearView(
        ctx,
        guildId,
        actor,
        res.item.id,
        {
          type: 'info',
          text: res.locked
            ? `🔒 已锁定 ${formatRpgItemDisplay(res.item)}（锁定期间无法单件拆解或被一键拆解波及）。`
            : `🔓 已解锁 ${formatRpgItemDisplay(res.item)}。`,
        },
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
          { type: 'success', text: `✅ 已装备 ${formatRpgItemDisplay(res.item)}${swapNote}！` },
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

  const res = ctx.services.rpg.salvageItem(guildId, actor.id, itemId, nowMs);
  if (res.ok) {
    await interaction.update(
      buildRpgGearView(
        ctx,
        guildId,
        actor,
        null,
        {
          type: 'success',
          text: `💰 已拆解 ${formatRpgItemDisplay(res.salvagedItem)}，获得 ${cfg.economy.currencyEmoji} **+${res.coinsEarned}** ${cfg.economy.currencyName} ＋ ✨ **+${res.dustEarned}** 奥术魔尘（当前余额 **${res.balance}**，魔尘 **${res.arcaneDust}**）。`,
        },
        nowMs,
      ),
    );
    return;
  }
  const errMap: Record<typeof res.reason, string> = {
    not_found: '找不到该装备，可能已被拆解。',
    item_equipped: '该装备正在穿戴中，请先点击「卸下」后再拆解！',
    item_locked: '🔒 该装备已锁定保护，请先点击「🔓 解锁装备」后再拆解！',
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
}

export async function handleRpgGearButton(
  input: RpgButtonContext,
  actor: MenuActor,
): Promise<boolean> {
  const gc: GearActionContext = { ...input, actor };
  return dispatchByAction(input.section, gc, {
    exact: {
      gear_equip_best: handleEquipBest,
      gear_bulk_salvage: handleBulkSalvage,
      gear_cycle_lock: handleCycleLock,
      gear_reforge: handleReforge,
      gear_equip: handleSingleItemOp,
      gear_unequip: handleSingleItemOp,
      gear_enhance: handleSingleItemOp,
      gear_lock: handleSingleItemOp,
      gear_salvage: handleSingleItemOp,
    },
  });
}
