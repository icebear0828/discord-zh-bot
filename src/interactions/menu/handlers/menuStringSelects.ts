import type { GuildMember, MessageCreateOptions } from 'discord.js';
import type { ModuleKey } from '../../../config/defaults.js';
import type { BuyResult } from '../../../services/shopService.js';
import { createSuccessEmbed, formatDurationZh } from '../../../ui/embeds.js';
import { buildMenuMessage } from '../../../ui/menuBuilder.js';
import { formatShopBuyError, type MenuActor, type MenuFeedback, type MenuView } from '../../../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  parsePositiveInt,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from '../../menuHelpers.js';
import { dispatchByAction, type ActionRouteTable } from '../subRouter.js';
import {
  buildCustomTitleModal,
  LEADERBOARD_MODULE_MAP,
  parseLeaderboardType,
  parseSocialAction,
  VALID_MODULE_KEYS,
  type MenuStringSelectContext,
} from './menuSharedModalsAndParsers.js';

async function updateSelectPage(
  input: MenuStringSelectContext,
  view: MenuView,
  feedback?: MenuFeedback,
): Promise<void> {
  await input.interaction.update(
    buildMenuMessage(input.ctx, input.guildId, input.actor, view, feedback),
  );
}

function buildShopBuyOutcome(
  res: Extract<BuyResult, { ok: true }>,
  actor: MenuActor,
  lvlCfg: { statName: string; statUnit: string },
): { detail: string; highlightBroadcast?: MessageCreateOptions } {
  if (res.grantRoleId) {
    return { detail: `已自动发放身份组 <@&${res.grantRoleId}>。` };
  }
  if (res.equippedTitle) {
    return { detail: `已解锁并自动佩戴称号 **「${res.equippedTitle}」**！` };
  }
  if (res.statBoostResult) {
    const s = res.statBoostResult;
    const header =
      s.outcome === 'crit'
        ? `💥 **触发双倍暴击！** ${lvlCfg.statName} **+${s.delta}** ${lvlCfg.statUnit}`
        : s.outcome === 'backfire'
          ? `😵 **轻微反噬！** ${lvlCfg.statName} **${s.delta >= 0 ? `+${s.delta}` : s.delta}** ${lvlCfg.statUnit}`
          : `✨ **效果生效！** ${lvlCfg.statName} **+${s.delta}** ${lvlCfg.statUnit}`;
    const detail = `${header}（当前 **${s.newStatValue}** ${lvlCfg.statUnit}，今日剩余 **${s.dailyLimit - s.usedToday}/${s.dailyLimit}** 次）`;
    const highlightBroadcast =
      s.outcome === 'crit'
        ? {
            embeds: [
              createSuccessEmbed(
                '💥 商店道具大暴击！',
                `**${actor.displayName}** 使用了【**${res.item.name}**】触发 **2x 暴击**，${lvlCfg.statName}暴增 **+${s.delta}** ${lvlCfg.statUnit}（现已达 **${s.newStatValue}** ${lvlCfg.statUnit}）！`,
              ),
            ],
          }
        : undefined;
    return { detail, highlightBroadcast };
  }
  if (res.petXpResult) {
    const p = res.petXpResult;
    return {
      detail: `🐾 出战宠物 **${p.petName}** 获得 **+${p.xpGained} XP**${p.levelsGained > 0 ? `，升级至 **Lv.${p.newLevel}**（连升 ${p.levelsGained} 级）！` : '！'}`,
    };
  }
  if (res.creditBoostResult) {
    const c = res.creditBoostResult;
    return {
      detail: `🧾 信用分 **+${c.delta}**（当前 **${c.newScore}** · ${c.tierLabel}，今日剩余 **${c.dailyLimit - c.usedToday}/${c.dailyLimit}** 次）！`,
    };
  }
  if (res.rpgSupplyResult) {
    const r = res.rpgSupplyResult;
    const parts: string[] = [];
    if (r.staminaGained > 0) parts.push(`恢复体力 **+${r.staminaGained}**（现 **${r.newStamina}** 点）`);
    if (r.droppedItem) parts.push(`获得装备 **[${r.droppedItem.rarity}] ${r.droppedItem.name}**`);
    return { detail: `⚔️ 西幻 RPG 补给已到账：${parts.join('，')}！` };
  }
  if (res.cpAffinityResult) {
    const cp = res.cpAffinityResult;
    const titleNote =
      cp.unlockedTitles.length > 0 ? `（解锁双人称号：**${cp.unlockedTitles.join('、')}**）` : '';
    return {
      detail: `💞 与 <@${cp.partnerId}> 的亲密度 **+${cp.affinityGained}**（现 **${cp.newAffinity}**）${titleNote}！`,
    };
  }
  if (res.mysteryBoxResult) {
    const detail = `🎁 **盲盒开启**：${res.mysteryBoxResult.summary}`;
    const highlightBroadcast = res.mysteryBoxResult.isJackpot
      ? {
          embeds: [
            createSuccessEmbed(
              '🎁 神秘盲盒欧皇降临！',
              `**${actor.displayName}** 开启【**${res.item.name}**】开出大奖！\n${res.mysteryBoxResult.summary}`,
            ),
          ],
        }
      : undefined;
    return { detail, highlightBroadcast };
  }
  return { detail: '道具已放入你的背包，随时可切换到「🎒 背包与称号」激活使用！' };
}

async function handleLeaderboardSelect(input: MenuStringSelectContext): Promise<void> {
  const { ctx, guildId, selected } = input;
  if (!selected) return;
  if (selected === 'cp_lb') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
    if (disabledMsg) {
      await updateSelectPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
      return;
    }
    await updateSelectPage(input, { page: 'cp_lb', lbPage: 1 });
    return;
  }
  if (selected === 'bounty') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
    if (disabledMsg) {
      await updateSelectPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
      return;
    }
    await updateSelectPage(input, { page: 'bounty' });
    return;
  }
  const lbType = parseLeaderboardType(selected);
  const mod = LEADERBOARD_MODULE_MAP[lbType];
  const disabledMsg = checkModuleDisabled(ctx, guildId, mod.key, mod.name);
  if (disabledMsg) {
    await updateSelectPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
    return;
  }
  await updateSelectPage(input, { page: 'leaderboard', lbType, lbPage: 1 });
}

async function handleAdminToggleModSelect(input: MenuStringSelectContext): Promise<void> {
  const { ctx, guildId, actor, selected } = input;
  if (!actor.isAdmin) {
    await updateSelectPage(input, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
    return;
  }
  if (!selected || !VALID_MODULE_KEYS.has(selected)) {
    await updateSelectPage(input, { page: 'admin_mod' }, { type: 'error', text: '无效的功能模块标识。' });
    return;
  }
  const modKey = selected as ModuleKey;
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const next = !cfg.modules[modKey];
  ctx.repos.guildConfig.updateModules(guildId, { ...cfg.modules, [modKey]: next });
  await updateSelectPage(input, { page: 'admin_mod' }, {
    type: 'success',
    text: `已将模块 **${modKey}** 切换为：**${next ? '开启' : '关闭'}**。`,
  });
}

async function handleSocialActSelect(input: MenuStringSelectContext): Promise<void> {
  const disabledMsg = checkModuleDisabled(input.ctx, input.guildId, 'fun', '娱乐互动');
  if (disabledMsg) {
    await updateSelectPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
    return;
  }
  await updateSelectPage(input, { page: 'social', action: parseSocialAction(input.selected) });
}

async function handleShopBuySelect(input: MenuStringSelectContext): Promise<void> {
  const { interaction, ctx, guildId, actor, parts, selected } = input;
  const listPage = parsePositiveInt(parts[2] ?? '') ?? 1;
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await updateSelectPage(input, { page: 'shop', listPage }, { type: 'error', text: disabledMsg });
    return;
  }

  const itemId = parsePositiveInt(selected ?? '');
  if (!itemId) {
    await updateSelectPage(input, { page: 'shop', listPage }, { type: 'error', text: '无效的商品编号。' });
    return;
  }

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const cfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;
  const item = ctx.repos.shop.getItemById(guildId, itemId);

  if (item?.type === 'custom_title') {
    if (item.stock !== null && item.stock <= 0) {
      await updateSelectPage(input, { page: 'shop', listPage }, {
        type: 'error',
        text: formatShopBuyError('out_of_stock', cfg.currencyName),
      });
      return;
    }
    const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
    if (profile.coins < item.price) {
      await updateSelectPage(input, { page: 'shop', listPage }, {
        type: 'error',
        text: formatShopBuyError('insufficient_funds', cfg.currencyName),
      });
      return;
    }
    await interaction.showModal(buildCustomTitleModal(`menu:modal_sub:shop_custom_title:${item.id}`));
    return;
  }

  const ownedRoleIds = actor.roleIds ? new Set(actor.roleIds) : undefined;
  const res = ctx.services.shop.buyItem(guildId, actor.id, itemId, Date.now(), Math.random, ownedRoleIds);
  if (!res.ok) {
    await updateSelectPage(input, { page: 'shop', listPage }, {
      type: 'error',
      text: formatShopBuyError(res.reason, cfg.currencyName, res.dailyLimit, res.requiredRoleId),
    });
    return;
  }

  const isRoleItem = Boolean(res.grantRoleId);
  if (isRoleItem) {
    await interaction.deferUpdate();
  }

  if (res.grantRoleId) {
    let member: GuildMember | null = null;
    if (interaction.inCachedGuild()) {
      member = interaction.member;
    } else if (interaction.guild) {
      member = await interaction.guild.members.fetch(actor.id).catch(() => null);
    }

    if (!member) {
      ctx.services.shop.refundRolePurchase(guildId, actor.id, res.item.id, res.finalPrice ?? res.item.price);
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'shop', listPage }, {
          type: 'error',
          text: '无法获取成员身份信息，已自动全额退款。',
        }),
      );
      return;
    }

    if (member.roles.cache.has(res.grantRoleId)) {
      ctx.services.shop.refundRolePurchase(guildId, actor.id, res.item.id, res.finalPrice ?? res.item.price);
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'shop', listPage }, {
          type: 'error',
          text: formatShopBuyError('already_owned', cfg.currencyName),
        }),
      );
      return;
    }

    try {
      await member.roles.add(res.grantRoleId, `购买商店商品 #${res.item.id}`);
    } catch {
      ctx.services.shop.refundRolePurchase(guildId, actor.id, res.item.id, res.finalPrice ?? res.item.price);
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'shop', listPage }, {
          type: 'error',
          text: `身份组发放失败（机器人权限不足或身份组层级过低），已自动全额退还${cfg.currencyName}与库存。`,
        }),
      );
      return;
    }
  }

  const { detail, highlightBroadcast } = buildShopBuyOutcome(res, actor, lvlCfg);
  const okMsg = buildMenuMessage(ctx, guildId, actor, { page: 'shop', listPage }, {
    type: 'success',
    text: `购买成功：**${res.item.name}**（花费 ${cfg.currencyEmoji} ${res.finalPrice}）\n${detail}\n剩余现金：**${res.balance}**。`,
  });
  if (isRoleItem) {
    await safeEditOrFollowUp(interaction, okMsg);
  } else {
    await interaction.update(okMsg);
  }
  if (highlightBroadcast) {
    await sendPublicBroadcast(interaction, highlightBroadcast);
  }
}

async function handleBagUseSelect(input: MenuStringSelectContext): Promise<void> {
  const { interaction, ctx, guildId, actor, parts, selected } = input;
  const listPage = parsePositiveInt(parts[2] ?? '') ?? 1;
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await updateSelectPage(input, { page: 'bag', listPage }, { type: 'error', text: disabledMsg });
    return;
  }

  const invId = parsePositiveInt(selected ?? '');
  if (!invId) {
    await updateSelectPage(input, { page: 'bag', listPage }, { type: 'error', text: '无效的背包道具编号。' });
    return;
  }

  const existingInv = ctx.repos.shop.getInventoryItem(guildId, actor.id, invId);
  if (existingInv?.itemType === 'custom_title' && existingInv.quantity > 0) {
    await interaction.showModal(buildCustomTitleModal(`menu:modal_sub:bag_custom_title:${existingInv.id}`));
    return;
  }

  const res = ctx.services.shop.useInventoryItem(guildId, actor.id, invId);
  if (!res.ok) {
    const errMap: Record<string, string> = {
      not_found: '未找到该道具或数量不足。',
      unsupported: '该道具暂不支持在此直接使用。',
      boost_multiplier_conflict:
        '当前已有不同倍率的经验加成卡生效中，需等待当前经验卡到期后再使用其他倍率卡（未消耗）。',
    };
    await updateSelectPage(input, { page: 'bag', listPage }, {
      type: 'error',
      text: errMap[res.reason] ?? '未找到该道具或数量不足。',
    });
    return;
  }

  const text =
    res.boostMultiplier && res.boostExpiresAt
      ? `⚡ 经验加成卡已激活！生效 **${res.boostMultiplier}x** 倍率，剩余 **${formatDurationZh(Math.max(0, res.boostExpiresAt - Date.now()))}**。`
      : res.equippedTitle
        ? `🏷️ 已将展示称号切换为 **「${res.equippedTitle}」**！`
        : '道具使用成功！';

  await updateSelectPage(input, { page: 'bag', listPage }, { type: 'success', text });
}

const STRING_SELECT_ROUTES: ActionRouteTable<MenuStringSelectContext> = {
  exact: {
    lb_select: handleLeaderboardSelect,
    admin_toggle_mod: handleAdminToggleModSelect,
    social_act: handleSocialActSelect,
    shop_buy: handleShopBuySelect,
    bag_use: handleBagUseSelect,
  },
};

export async function tryHandleMenuStringSelect(input: MenuStringSelectContext): Promise<boolean> {
  return dispatchByAction(input.parts[1], input, STRING_SELECT_ROUTES);
}
