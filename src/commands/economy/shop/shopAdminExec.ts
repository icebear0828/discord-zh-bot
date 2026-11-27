import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { SHOP_MYSTERY_BOX_MIN_PRICE } from '../../../config/economyConstants.js';
import type { AppContext } from '../../../core/context.js';
import { createErrorEmbed, createSuccessEmbed } from '../../../ui/embeds.js';

export async function executeShopAdmin(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  sub: string,
  guildId: string,
): Promise<void> {
  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const cfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;

  if (sub === 'add-role') {
    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const role = interaction.options.getRole('role', true);
    const description = interaction.options.getString('description') ?? '';
    const stock = interaction.options.getInteger('stock');
    const requiredRole = interaction.options.getRole('required-role');

    const created = ctx.services.shop.createRoleItem({
      guildId,
      name,
      description,
      price,
      roleId: role.id,
      stock,
      requiredRoleId: requiredRole?.id ?? null,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已上架身份组商品',
          `编号 **#${created.id}** · **${created.name}** → <@&${role.id}>（${price} ${cfg.currencyName}${requiredRole ? `，需前置 <@&${requiredRole.id}>` : ''}）`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add-title') {
    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const titleText = interaction.options.getString('title', true);
    const description = interaction.options.getString('description') ?? '';
    const stock = interaction.options.getInteger('stock');

    const created = ctx.services.shop.createTitleItem({
      guildId,
      name,
      description,
      price,
      titleText,
      stock,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已上架称号商品',
          `编号 **#${created.id}** · **${created.name}** → 「${titleText}」（${price} ${cfg.currencyName}）`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add-boost') {
    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const multiplier = interaction.options.getNumber('multiplier', true);
    const durationMin = interaction.options.getInteger('duration-min', true);
    const description = interaction.options.getString('description') ?? '';
    const stock = interaction.options.getInteger('stock');

    const created = ctx.services.shop.createBoostItem({
      guildId,
      name,
      description,
      price,
      boostMultiplier: multiplier,
      boostDurationSec: durationMin * 60,
      stock,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已上架经验卡商品',
          `编号 **#${created.id}** · **${created.name}**（${multiplier}x · ${durationMin}分钟 · ${price} ${cfg.currencyName}）`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add-stat') {
    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const minGain = interaction.options.getInteger('min-gain', true);
    const maxGain = Math.max(minGain, interaction.options.getInteger('max-gain', true));
    const description = interaction.options.getString('description') ?? '';
    const stock = interaction.options.getInteger('stock');

    const created = ctx.services.shop.createStatBoostItem({
      guildId,
      name,
      description,
      price,
      minGain,
      maxGain,
      stock,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已上架成长道具',
          `编号 **#${created.id}** · **${created.name}**（${lvlCfg.statName} +${minGain}~${maxGain} ${lvlCfg.statUnit} · ${price} ${cfg.currencyName}）`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add-custom-title') {
    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const description = interaction.options.getString('description') ?? '';
    const stock = interaction.options.getInteger('stock');

    const created = ctx.services.shop.createCustomTitleItem({
      guildId,
      name,
      description,
      price,
      stock,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已上架自定义称号券',
          `编号 **#${created.id}** · **${created.name}**（${price} ${cfg.currencyName}）`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add-pet-xp') {
    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const petXp = interaction.options.getInteger('pet-xp', true);
    const description = interaction.options.getString('description') ?? '';
    const stock = interaction.options.getInteger('stock');

    const created = ctx.services.shop.createPetXpItem({
      guildId,
      name,
      description,
      price,
      petXp,
      stock,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已上架宠物经验道具',
          `编号 **#${created.id}** · **${created.name}**（+${petXp} XP · ${price} ${cfg.currencyName}）`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add-box') {
    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const description = interaction.options.getString('description') ?? '';
    const stock = interaction.options.getInteger('stock');

    if (price < SHOP_MYSTERY_BOX_MIN_PRICE) {
      await interaction.reply({
        embeds: [
          createErrorEmbed(
            '❌ 价格过低',
            `神秘盲盒最低售价为 **${SHOP_MYSTERY_BOX_MIN_PRICE}** ${cfg.currencyName}，防止低价刷币套利。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const created = ctx.services.shop.createMysteryBoxItem({
      guildId,
      name,
      description,
      price,
      stock,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已上架神秘盲盒',
          `编号 **#${created.id}** · **${created.name}**（${created.price} ${cfg.currencyName}）`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add-credit') {
    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const creditGain = interaction.options.getInteger('credit-gain', true);
    const dailyLimit = interaction.options.getInteger('daily-limit') ?? 2;
    const description = interaction.options.getString('description') ?? '';
    const stock = interaction.options.getInteger('stock');

    const created = ctx.services.shop.createCreditBoostItem({
      guildId,
      name,
      description,
      price,
      creditGain,
      dailyLimit,
      stock,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已上架信用修复道具',
          `编号 **#${created.id}** · **${created.name}**（+${creditGain} 信用分 · 日限 ${dailyLimit} 次 · ${price} ${cfg.currencyName}）`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add-rpg-supply') {
    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const staminaGain = interaction.options.getInteger('stamina-gain', true);
    const lootBox = interaction.options.getBoolean('loot-box', true);
    const rawRarity = interaction.options.getString('min-rarity') ?? 'rare';
    const minRarity =
      rawRarity === 'epic' || rawRarity === 'legendary' ? rawRarity : ('rare' as const);
    const description = interaction.options.getString('description') ?? '';
    const stock = interaction.options.getInteger('stock');

    const created = ctx.services.shop.createRpgSupplyItem({
      guildId,
      name,
      description,
      price,
      staminaGain,
      lootBox,
      minRarity,
      stock,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已上架 RPG 补给道具',
          `编号 **#${created.id}** · **${created.name}**（体力 +${staminaGain}${lootBox ? ` · 保底 ${minRarity} 装备箱` : ''} · ${price} ${cfg.currencyName}）`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'add-cp-affinity') {
    const name = interaction.options.getString('name', true);
    const price = interaction.options.getInteger('price', true);
    const affinityGain = interaction.options.getInteger('affinity-gain', true);
    const description = interaction.options.getString('description') ?? '';
    const stock = interaction.options.getInteger('stock');

    const created = ctx.services.shop.createCpAffinityItem({
      guildId,
      name,
      description,
      price,
      affinityGain,
      stock,
    });
    await interaction.reply({
      embeds: [
        createSuccessEmbed(
          '✅ 已上架 CP 亲密度礼物',
          `编号 **#${created.id}** · **${created.name}**（亲密度 +${affinityGain} · ${price} ${cfg.currencyName}）`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'remove') {
    const itemId = interaction.options.getInteger('id', true);
    const removed = ctx.services.shop.removeItem(guildId, itemId);
    await interaction.reply({
      embeds: [
        removed
          ? createSuccessEmbed('✅ 商品已下架', `已移除商品 **#${itemId}**。`)
          : createErrorEmbed('❌ 未找到商品', `编号 **#${itemId}** 不存在。`),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
