import {
  ActionRowBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { COLORS, formatDurationZh } from '../embeds.js';
import {
  buttonRow,
  formatInventoryTypeLabel,
  formatShopItemTag,
  makeButton,
  MENU_SELECT_PAGE_SIZE,
  paginateSlice,
  resolveColor,
  truncateText,
  withFeedback,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuComponentRow,
  type MenuFeedback,
} from '../menuShared.js';

export function buildShopView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
  listPage?: number,
): BuiltMenuMessage {
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const cfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const items = ctx.services.shop.listItems(guildId);
  const { slice: displayItems, page, totalPages } = paginateSlice(
    items,
    listPage,
    MENU_SELECT_PAGE_SIZE,
  );
  const hasStatBoost = items.some((i) => i.type === 'stat_boost');
  const boostQuota = ctx.services.shop.getStatBoostRemainingToday(guildId, actor.id, nowMs);

  const lines =
    displayItems.length > 0
      ? displayItems.map((item) => {
          const stockText = item.stock === null ? '无限' : `剩 ${item.stock}`;
          const typeTag = formatShopItemTag(item, lvlCfg.statName, lvlCfg.statUnit);
          return `**#${item.id} ${truncateText(item.name, 40)}** — ${cfg.currencyEmoji} **${item.price}**（${stockText}）\n> ${typeTag}${item.description ? ` · ${truncateText(item.description, 60)}` : ''}`;
        })
      : ['商店目前还没有商品，管理员可在「⚙️ 管理后台 → 🛒 商店管理」或 `/商店 上架*` 添加商品。'];

  if (totalPages > 1) {
    lines.push(`\n*（第 ${page} / ${totalPages} 页 · 共 ${items.length} 件商品）*`);
  }

  const statQuotaLine = hasStatBoost
    ? ` ｜ 💊 今日成长道具剩余：**${boostQuota.remaining}/${boostQuota.dailyLimit}** 次`
    : '';

  const description = [
    `${cfg.currencyEmoji} 口袋现金：**${profile.coins}** ${cfg.currencyName}${statQuotaLine}`,
    '',
    ...lines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.GOLD, feedback))
    .setAuthor({ name: `${actor.displayName} · 服务器商店`, iconURL: actor.avatarUrl })
    .setTitle('🛒 服务器商店')
    .setDescription(withFeedback(description, feedback))
    .setFooter({
      text: totalPages > 1 ? `第 ${page} / ${totalPages} 页 · 共 ${items.length} 件商品` : '🔒 商店购买仅自己可见',
    })
    .setTimestamp();

  const tabRow = buttonRow(
    makeButton('menu:nav:shop', '🛒 商店', ButtonStyle.Primary),
    makeButton('menu:nav:bag', '🎒 背包与称号', ButtonStyle.Secondary),
    makeButton('menu:nav:props', '🧰 黑市攻防道具', ButtonStyle.Danger),
    makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary),
  );

  if (displayItems.length === 0) {
    return { embeds: [embed], components: [tabRow] };
  }

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`menu:shop_buy:${page}`)
      .setPlaceholder(
        totalPages > 1 ? `选择要购买的商品（第 ${page}/${totalPages} 页）...` : '选择要购买的商品...',
      )
      .addOptions(
        displayItems.map((item) => {
          const stockTag = item.stock === null ? '无限' : `剩${item.stock}`;
          const typeDesc = formatShopItemTag(item, lvlCfg.statName, lvlCfg.statUnit, true);
          const rawDesc = item.description ? `${typeDesc} · ${item.description}` : `${typeDesc} · 库存:${stockTag}`;
          return new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(`#${item.id} ${item.name} (${item.price} ${cfg.currencyName})`, 100))
            .setValue(String(item.id))
            .setDescription(truncateText(rawDesc, 100));
        }),
      ),
  );

  const components: MenuComponentRow[] = [selectRow];
  if (totalPages > 1) {
    const prevPage = Math.max(1, page - 1);
    const nextPage = Math.min(totalPages, page + 1);
    components.push(
      buttonRow(
        makeButton(`menu:nav:shop:${prevPage}:prev`, '⬅️ 上一页', ButtonStyle.Secondary, page <= 1),
        makeButton(`menu:nav:shop:${nextPage}:next`, '➡️ 下一页', ButtonStyle.Secondary, page >= totalPages),
      ),
    );
  }
  components.push(tabRow);

  return { embeds: [embed], components };
}

export function buildBagView(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  feedback: MenuFeedback | undefined,
  nowMs: number,
  listPage?: number,
): BuiltMenuMessage {
  const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
  const inventory = ctx.services.shop.listInventory(guildId, actor.id);
  const { slice: displayInv, page, totalPages } = paginateSlice(
    inventory,
    listPage,
    MENU_SELECT_PAGE_SIZE,
  );

  const activeBoostText =
    profile.xpBoostExpiresAt > nowMs && profile.xpBoostMultiplier > 1
      ? `⚡ **${profile.xpBoostMultiplier}x** 生效中（剩余 ${formatDurationZh(profile.xpBoostExpiresAt - nowMs)}）`
      : '未激活';

  const invLines =
    displayInv.length > 0
      ? displayInv.map((item) => {
          const typeLabel = formatInventoryTypeLabel(item.itemType);
          return `• **#${item.id}** [${typeLabel}] **${truncateText(item.itemName, 40)}** × ${item.quantity}`;
        })
      : ['背包里暂时空空如也，去商店逛逛吧！'];

  if (totalPages > 1) {
    invLines.push(`\n*（第 ${page} / ${totalPages} 页 · 共 ${inventory.length} 项道具）*`);
  }

  const description = [
    `🏷️ 当前佩戴称号：${profile.equippedTitle ? `**「${profile.equippedTitle}」**` : '无'}`,
    `🚀 经验卡状态：${activeBoostText}`,
    '',
    '**🎒 背包道具列表：**',
    ...invLines,
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(resolveColor(COLORS.PRIMARY, feedback))
    .setAuthor({ name: `${actor.displayName} · 背包与称号`, iconURL: actor.avatarUrl })
    .setTitle('🎒 我的背包与称号')
    .setDescription(withFeedback(description, feedback))
    .setFooter({
      text: totalPages > 1 ? `第 ${page} / ${totalPages} 页 · 共 ${inventory.length} 项道具` : '🔒 背包仅自己可见',
    })
    .setTimestamp();

  const tabButtons = [
    makeButton('menu:nav:shop', '🛒 商店', ButtonStyle.Secondary),
    makeButton('menu:nav:bag', '🎒 背包与称号', ButtonStyle.Primary),
  ];
  if (profile.equippedTitle) {
    tabButtons.push(makeButton('menu:bag:clear_title', '❌ 卸下称号', ButtonStyle.Danger));
  }
  tabButtons.push(makeButton('menu:nav:home', '🏠 主菜单', ButtonStyle.Secondary));
  const tabRow = buttonRow(...tabButtons);

  if (displayInv.length === 0) {
    return { embeds: [embed], components: [tabRow] };
  }

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`menu:bag_use:${page}`)
      .setPlaceholder(
        totalPages > 1 ? `选择要使用或佩戴的道具（第 ${page}/${totalPages} 页）...` : '选择要使用或佩戴的道具...',
      )
      .addOptions(
        displayInv.map((inv) => {
          const desc =
            inv.itemType === 'xp_boost'
              ? '点击立即激活经验加成卡'
              : inv.itemType === 'title'
                ? '点击佩戴此专属称号'
                : inv.itemType === 'custom_title'
                  ? '点击弹窗自拟并佩戴专属称号'
                  : '使用背包道具';
          return new StringSelectMenuOptionBuilder()
            .setLabel(truncateText(`#${inv.id} ${inv.itemName} (×${inv.quantity})`, 100))
            .setValue(String(inv.id))
            .setDescription(desc);
        }),
      ),
  );

  const components: MenuComponentRow[] = [selectRow];
  if (totalPages > 1) {
    const prevPage = Math.max(1, page - 1);
    const nextPage = Math.min(totalPages, page + 1);
    components.push(
      buttonRow(
        makeButton(`menu:nav:bag:${prevPage}:prev`, '⬅️ 上一页', ButtonStyle.Secondary, page <= 1),
        makeButton(`menu:nav:bag:${nextPage}:next`, '➡️ 下一页', ButtonStyle.Secondary, page >= totalPages),
      ),
    );
  }
  components.push(tabRow);

  return { embeds: [embed], components };
}
