import type { ModalSubmitInteraction } from 'discord.js';
import { SHOP_MYSTERY_BOX_MIN_PRICE } from '../../config/economyConstants.js';
import type { AppContext } from '../../core/context.js';
import { buildMenuMessage } from '../../ui/menuBuilder.js';
import type { MenuActor } from '../../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  parseIntInRange,
  respondFromModal,
} from '../menuHelpers.js';

export const SPECIAL_KIND_BOX: ReadonlySet<string> = new Set([
  '盲盒',
  '神秘盲盒',
  'mystery_box',
  'box',
]);

export const SPECIAL_KIND_TITLE: ReadonlySet<string> = new Set([
  '称号券',
  '自定义称号券',
  'custom_title',
  'title',
]);

const SHOP_SUBMIT_TYPES: ReadonlySet<string> = new Set([
  'admin_shop_role',
  'admin_shop_title',
  'admin_shop_boost',
  'admin_shop_stat',
  'admin_shop_pet',
  'admin_shop_special',
]);

function readOptionalModalField(interaction: ModalSubmitInteraction, customId: string): string {
  try {
    return interaction.fields.getTextInputValue(customId).trim();
  } catch {
    return '';
  }
}

export async function tryHandleConfigShopModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  parts: readonly string[],
): Promise<boolean> {
  const modalType = parts[2];
  if (!modalType || !SHOP_SUBMIT_TYPES.has(modalType)) {
    return false;
  }

  if (!actor.isAdmin) {
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
    );
    return true;
  }

  const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const econCfg = guildCfg.economy;
  const lvlCfg = guildCfg.leveling;

  const fail = async (text: string): Promise<boolean> => {
    await respondFromModal(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'admin_shop' }, { type: 'error', text }),
    );
    return true;
  };

  const name = interaction.fields.getTextInputValue('name').trim();
  const price = parseIntInRange(interaction.fields.getTextInputValue('price'), 0, 10_000_000);
  if (name.length < 1 || name.length > 40 || price === null) {
    return fail('商品名称需 1~40 字，售价需为 0 ~ 10,000,000 之间的整数。');
  }

  const description = readOptionalModalField(interaction, 'description');

  let stock: number | null = null;
  const rawStock = readOptionalModalField(interaction, 'stock');
  if (rawStock.length > 0) {
    const parsedStock = parseIntInRange(rawStock, 1, 100_000);
    if (parsedStock === null) {
      return fail('限量库存必须为 1 ~ 100,000 的正整数（留空表示无限）。');
    }
    stock = parsedStock;
  }

  if (modalType === 'admin_shop_role') {
    const roleId = parts[3];
    if (!roleId) {
      return fail('未指定有效身份组。');
    }
    const created = ctx.services.shop.createRoleItem({
      guildId,
      name,
      description,
      price,
      roleId,
      stock,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        {
          type: 'success',
          text: `✅ 已上架身份组商品 **#${created.id} ${created.name}** → <@&${roleId}>（${price} ${econCfg.currencyName}）！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_shop_title') {
    const titleText = interaction.fields.getTextInputValue('titleText').trim();
    if (titleText.length < 1 || titleText.length > 20) {
      return fail('佩戴称号文本需在 1 ~ 20 字之间。');
    }
    const created = ctx.services.shop.createTitleItem({
      guildId,
      name,
      description,
      price,
      titleText,
      stock,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        {
          type: 'success',
          text: `✅ 已上架称号商品 **#${created.id} ${created.name}** → 「${titleText}」（${price} ${econCfg.currencyName}）！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_shop_boost') {
    const multNum = Number(interaction.fields.getTextInputValue('multiplier').trim());
    const durationMin = parseIntInRange(interaction.fields.getTextInputValue('durationMin'), 5, 10_080);
    if (!Number.isFinite(multNum) || multNum < 1.1 || multNum > 5.0 || durationMin === null) {
      return fail('经验倍率需在 1.1 ~ 5.0 之间，持续分钟数需为 5 ~ 10080 的整数。');
    }
    const multiplier = Math.round(multNum * 100) / 100;
    const created = ctx.services.shop.createBoostItem({
      guildId,
      name,
      description,
      price,
      boostMultiplier: multiplier,
      boostDurationSec: durationMin * 60,
      stock,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        {
          type: 'success',
          text: `✅ 已上架经验卡 **#${created.id} ${created.name}**（${multiplier}x · ${durationMin}分钟）！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_shop_stat') {
    const minGain = parseIntInRange(interaction.fields.getTextInputValue('minGain'), 1, 1000);
    const maxGain = parseIntInRange(interaction.fields.getTextInputValue('maxGain'), 1, 1000);
    if (minGain === null || maxGain === null || maxGain < minGain) {
      return fail('最小/最大增量需为 1 ~ 1000 的整数，且最大增量不能小于最小增量。');
    }
    const created = ctx.services.shop.createStatBoostItem({
      guildId,
      name,
      description,
      price,
      minGain,
      maxGain,
      stock,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        {
          type: 'success',
          text: `✅ 已上架成长道具 **#${created.id} ${created.name}**（${lvlCfg.statName} +${minGain}~${maxGain} ${lvlCfg.statUnit}）！`,
        },
      ),
    );
    return true;
  }

  if (modalType === 'admin_shop_pet') {
    const petXp = parseIntInRange(interaction.fields.getTextInputValue('petXp'), 10, 10_000);
    if (petXp === null) {
      return fail('宠物经验值需为 10 ~ 10,000 之间的整数。');
    }
    const created = ctx.services.shop.createPetXpItem({
      guildId,
      name,
      description,
      price,
      petXp,
      stock,
    });
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_shop' },
        {
          type: 'success',
          text: `✅ 已上架宠物经验道具 **#${created.id} ${created.name}**（+${petXp} XP）！`,
        },
      ),
    );
    return true;
  }

  const rawKind = interaction.fields.getTextInputValue('kind').trim().toLowerCase();
  const isCustomTitle = SPECIAL_KIND_TITLE.has(rawKind);
  const isMysteryBox = SPECIAL_KIND_BOX.has(rawKind);
  if (!isCustomTitle && !isMysteryBox) {
    return fail('商品类型无效：请填写「盲盒」或「称号券」（或 mystery_box / custom_title）。');
  }
  if (isMysteryBox && price < SHOP_MYSTERY_BOX_MIN_PRICE) {
    return fail(`神秘盲盒售价不能低于 **${SHOP_MYSTERY_BOX_MIN_PRICE}** ${econCfg.currencyName}。`);
  }

  const created = isCustomTitle
    ? ctx.services.shop.createCustomTitleItem({ guildId, name, description, price, stock })
    : ctx.services.shop.createMysteryBoxItem({ guildId, name, description, price, stock });

  await respondFromModal(
    interaction,
    buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'admin_shop' },
      {
        type: 'success',
        text: `✅ 已上架${isCustomTitle ? '自定义称号券' : '神秘盲盒'} **#${created.id} ${created.name}**（${price} ${econCfg.currencyName}）！`,
      },
    ),
  );
  return true;
}
