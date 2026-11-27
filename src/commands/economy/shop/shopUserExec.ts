import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
} from 'discord.js';
import type { AppContext } from '../../../core/context.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
} from '../../../ui/embeds.js';
import { formatShopBuyError, formatShopItemTag } from '../../../ui/menuShared.js';
import { truncateDescriptionLines } from '../../../ui/soloFormatters.js';

export async function executeShopList(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  guildId: string,
): Promise<void> {
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const cfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;

  const items = ctx.services.shop.listItems(guildId);
  if (items.length === 0) {
    await interaction.reply({
      embeds: [
        createInfoEmbed(
          '🛒 服务器商店',
          '商店目前空空如也，管理员可使用 `/菜单` → 管理后台「🛒 商店管理」或 `/商店 上架*` 添加商品。',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = items.map((item) => {
    const stockText = item.stock === null ? '无限' : `剩 ${item.stock}`;
    const typeTag = formatShopItemTag(item, lvlCfg.statName, lvlCfg.statUnit);
    return `**#${item.id} ${item.name}** — ${cfg.currencyEmoji} **${item.price}** ${cfg.currencyName}（${stockText}）\n> ${typeTag}${item.description ? ` · ${item.description}` : ''}`;
  });
  const desc = truncateDescriptionLines(
    lines,
    '\n\n',
    '\n\n使用 `/商店 购买 编号` 或前往 `/菜单` →「🛒 商店」购买。',
  );

  await interaction.reply({
    embeds: [createInfoEmbed('🛒 服务器商店', desc)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function executeShopBuy(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  guildCtx: { guildId: string; member: GuildMember },
): Promise<void> {
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
  const cfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;

  const itemId = interaction.options.getInteger('id', true);
  const targetItem = ctx.repos.shop.getItemById(guildCtx.guildId, itemId);
  if (
    targetItem?.type === 'role' &&
    targetItem.roleId &&
    guildCtx.member.roles.cache.has(targetItem.roleId)
  ) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '❌ 无需重复购买',
          `你已经拥有身份组 <@&${targetItem.roleId}> 了（本次未扣款、未扣库存）。`,
        ),
      ],
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ownedRoleIds = new Set<string>(guildCtx.member.roles.cache.keys());
  const res = ctx.services.shop.buyItem(
    guildCtx.guildId,
    interaction.user.id,
    itemId,
    Date.now(),
    Math.random,
    ownedRoleIds,
  );

  if (!res.ok) {
    await interaction.reply({
      embeds: [
        createErrorEmbed(
          '❌ 购买失败',
          formatShopBuyError(res.reason, cfg.currencyName, res.dailyLimit, res.requiredRoleId),
        ),
      ],
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (res.grantRoleId) {
    try {
      await guildCtx.member.roles.add(res.grantRoleId, `购买商店商品 #${res.item.id}`);
    } catch {
      ctx.services.shop.refundRolePurchase(
        guildCtx.guildId,
        interaction.user.id,
        res.item.id,
        res.finalPrice ?? res.item.price,
      );
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '⚠️ 身份组发放失败（已自动退款）',
            '机器人的权限不足或身份组层级低于目标身份组，已全额退还星币与库存。请联系管理员调高 Bot 身份组顺序。',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  let detail: string;
  if (res.grantRoleId) {
    detail = `已为你发放身份组 <@&${res.grantRoleId}>。`;
  } else if (res.equippedTitle) {
    detail = `已为你解锁并自动佩戴称号 **「${res.equippedTitle}」**！`;
  } else if (res.statBoostResult) {
    const s = res.statBoostResult;
    const header =
      s.outcome === 'crit'
        ? `💥 **触发暴击翻倍！** ${lvlCfg.statName} **+${s.delta}** ${lvlCfg.statUnit}`
        : s.outcome === 'backfire'
          ? `😵 **发生轻微反噬！** ${lvlCfg.statName} **${s.delta >= 0 ? `+${s.delta}` : s.delta}** ${lvlCfg.statUnit}`
          : `✨ **药效生效！** ${lvlCfg.statName} **+${s.delta}** ${lvlCfg.statUnit}`;
    detail = `${header}\n当前${lvlCfg.statName}：**${s.newStatValue}** ${lvlCfg.statUnit}（今日已用 ${s.usedToday}/${s.dailyLimit} 次）`;
  } else if (res.petXpResult) {
    const p = res.petXpResult;
    detail = `🐾 出战宠物 **${p.petName}** 获得 **+${p.xpGained} XP**${p.levelsGained > 0 ? `，升级至 **Lv.${p.newLevel}**（连升 ${p.levelsGained} 级）！` : '！'}`;
  } else if (res.creditBoostResult) {
    const c = res.creditBoostResult;
    detail = `🧾 信用分 **+${c.delta}**（当前 **${c.newScore}** · ${c.tierLabel}，今日已用 ${c.usedToday}/${c.dailyLimit} 次）！`;
  } else if (res.rpgSupplyResult) {
    const r = res.rpgSupplyResult;
    const parts: string[] = [];
    if (r.staminaGained > 0) parts.push(`恢复体力 **+${r.staminaGained}**（现 **${r.newStamina}** 点）`);
    if (r.droppedItem) parts.push(`获得装备 **[${r.droppedItem.rarity}] ${r.droppedItem.name}**`);
    detail = `⚔️ 西幻 RPG 补给已送达：${parts.join('，')}！`;
  } else if (res.cpAffinityResult) {
    const cp = res.cpAffinityResult;
    const titleNote =
      cp.unlockedTitles.length > 0
        ? `（解锁双人称号：**${cp.unlockedTitles.join('、')}**）`
        : '';
    detail = `💞 与 <@${cp.partnerId}> 的亲密度 **+${cp.affinityGained}**（现 **${cp.newAffinity}**）${titleNote}！`;
  } else if (res.mysteryBoxResult) {
    detail = `🎁 **盲盒开启结果**：${res.mysteryBoxResult.summary}`;
  } else if (res.customTitleVoucher) {
    detail = '🎫 自定义称号券已放入你的 `/背包`，请前往 `/菜单` →「🎒 背包与称号」兑换自拟称号！';
  } else {
    detail = '经验卡已放入你的 `/背包`，随时可使用激活！';
  }

  await interaction.reply({
    embeds: [
      createSuccessEmbed(
        '🛍️ 购买成功！',
        `已购买 **${res.item.name}**（花费 ${cfg.currencyEmoji} ${res.finalPrice}）\n${detail}\n剩余余额：**${res.balance}** ${cfg.currencyName}`,
      ),
    ],
    allowedMentions: { parse: [] },
  });
}
