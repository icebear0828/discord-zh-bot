import { ModalBuilder } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { truncateText } from '../../ui/menuShared.js';
import { optionalInput, reqInput } from './configModalBuilders.js';

export const SHOP_MODAL_TYPES: ReadonlySet<string> = new Set([
  'admin_shop_title',
  'admin_shop_boost',
  'admin_shop_stat',
  'admin_shop_pet',
  'admin_shop_special',
]);

export function buildShopCreateModal(
  modalType: string,
  ctx: AppContext,
  guildId: string,
): ModalBuilder {
  const lvlCfg = ctx.repos.guildConfig.getOrCreate(guildId).leveling;

  if (modalType === 'admin_shop_title') {
    return new ModalBuilder()
      .setCustomId('menu:modal_sub:admin_shop_title')
      .setTitle(truncateText('🏷️ 上架专属称号商品', 45))
      .addComponents(
        reqInput('name', '商品名称（1~40字）', '例如：🏷️ 称号：本服合法公民', 40),
        reqInput('price', '售价（整数 >= 0）', '例如：3000', 12),
        reqInput('titleText', '佩戴称号文本（1~20字）', '例如：合法公民', 20),
        optionalInput({
          customId: 'description',
          label: '商品简介（可留空）',
          placeholder: '购买后自动佩戴专属称号',
          maxLength: 80,
        }),
        optionalInput({
          customId: 'stock',
          label: '限量库存（正整数，留空为无限）',
          placeholder: '留空表示无限库存',
          maxLength: 8,
        }),
      );
  }

  if (modalType === 'admin_shop_boost') {
    return new ModalBuilder()
      .setCustomId('menu:modal_sub:admin_shop_boost')
      .setTitle(truncateText('⚡ 上架经验加成卡', 45))
      .addComponents(
        reqInput('name', '商品名称（1~40字）', '例如：🔥 2.0x 狂肝经验卡', 40),
        reqInput('price', '售价（整数 >= 0）', '例如：1800', 12),
        reqInput('multiplier', '经验倍率（1.1 ~ 5.0）', '例如：2.0', 8),
        reqInput('durationMin', '持续分钟数（5 ~ 10080）', '例如：120', 8),
        optionalInput({
          customId: 'description',
          label: '商品简介（可留空）',
          placeholder: '激活后双倍聊天/语音经验',
          maxLength: 80,
        }),
      );
  }

  if (modalType === 'admin_shop_stat') {
    return new ModalBuilder()
      .setCustomId('menu:modal_sub:admin_shop_stat')
      .setTitle(truncateText(`💊 上架${truncateText(lvlCfg.statName, 12)}道具`, 45))
      .addComponents(
        reqInput('name', '商品名称（1~40字）', '例如：💊 初级成长药水', 40),
        reqInput('price', '售价（整数 >= 0）', '例如：1200', 12),
        reqInput('minGain', '数值最小增量（整数 >= 1）', '例如：1', 8),
        reqInput('maxGain', '数值最大增量（整数 >= 最小增量）', '例如：4', 8),
        optionalInput({
          customId: 'description',
          label: '商品简介（可留空）',
          placeholder: `增加 ${lvlCfg.statName}，含暴击与日限3次`,
          maxLength: 80,
        }),
      );
  }

  if (modalType === 'admin_shop_pet') {
    return new ModalBuilder()
      .setCustomId('menu:modal_sub:admin_shop_pet')
      .setTitle(truncateText('🥫 上架宠物经验道具', 45))
      .addComponents(
        reqInput('name', '商品名称（1~40字）', '例如：🥫 黄金猫罐头', 40),
        reqInput('price', '售价（整数 >= 0）', '例如：800', 12),
        reqInput('petXp', '增加的宠物经验（10 ~ 10000）', '例如：180', 8),
        optionalInput({
          customId: 'description',
          label: '商品简介（可留空）',
          placeholder: '买即生效，直接喂给出战宠物',
          maxLength: 80,
        }),
        optionalInput({
          customId: 'stock',
          label: '限量库存（正整数，留空为无限）',
          placeholder: '留空表示无限库存',
          maxLength: 8,
        }),
      );
  }

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:admin_shop_special')
    .setTitle(truncateText('🎁 上架盲盒或自定义称号券', 45))
    .addComponents(
      reqInput('kind', '商品类型（输入：盲盒 或 称号券）', '盲盒 / 称号券', 16, '盲盒'),
      reqInput('name', '商品名称（1~40字）', '例如：🎁 神秘幸运盲盒', 40),
      reqInput('price', '售价（整数 >= 0）', '例如：1500', 12),
      optionalInput({
        customId: 'description',
        label: '商品简介（可留空）',
        placeholder: '神秘混合奖池 / 自拟1~20字称号',
        maxLength: 80,
      }),
      optionalInput({
        customId: 'stock',
        label: '限量库存（正整数，留空为无限）',
        placeholder: '留空表示无限库存',
        maxLength: 8,
      }),
    );
}

export function buildShopRoleModal(roleId: string, defaultName: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`menu:modal_sub:admin_shop_role:${roleId}`)
    .setTitle(truncateText('✨ 上架身份组商品', 45))
    .addComponents(
      reqInput('name', '商品名称（1~40字）', '例如：✨ 身份组：夜店霓虹王', 40, defaultName),
      reqInput('price', '售价（整数 >= 0）', '例如：15000', 12),
      optionalInput({
        customId: 'description',
        label: '商品简介（可留空）',
        placeholder: '购买后自动发放该身份组',
        maxLength: 80,
      }),
      optionalInput({
        customId: 'stock',
        label: '限量库存（正整数，留空为无限）',
        placeholder: '例如：5',
        maxLength: 8,
      }),
    );
}
