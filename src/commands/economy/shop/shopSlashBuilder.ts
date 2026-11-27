import { SlashCommandBuilder } from 'discord.js';
import { SHOP_MYSTERY_BOX_MIN_PRICE } from '../../../config/economyConstants.js';
import { applyZh } from '../../../ui/localization.js';

export function buildShopSlashCommand(): { toJSON(): unknown } {
  return applyZh(
    new SlashCommandBuilder()
      .setName('shop')
      .setDescription('浏览商店或购买身份组、称号、经验卡与道具礼盒')
      .addSubcommand((sub) =>
        applyZh(sub.setName('list').setDescription('查看当前商店在售商品'), '列表', '查看当前商店在售商品'),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('buy')
            .setDescription('购买指定编号的商品')
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('id').setDescription('商品 ID（可在 /商店 列表 查看）').setMinValue(1).setRequired(true),
                '编号',
                '要购买的商品编号',
              ),
            ),
          '购买',
          '购买指定编号的商品',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-role')
            .setDescription('【管理】上架身份组商品')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('商品名称').setRequired(true), '名称', '商品展示名称'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('price').setDescription('售价').setMinValue(0).setRequired(true), '价格', '购买所需星币'),
            )
            .addRoleOption((opt) =>
              applyZh(opt.setName('role').setDescription('购买后发放的身份组').setRequired(true), '身份组', '发放的身份组'),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('商品简介'), '简介', '商品描述信息'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('stock').setDescription('库存数量（留空为无限）').setMinValue(1), '库存', '库存数量'),
            )
            .addRoleOption((opt) =>
              applyZh(opt.setName('required-role').setDescription('购买所需的门槛前置身份组'), '前置身份组', '需先拥有的身份组'),
            ),
          '上架身份组',
          '上架身份组商品',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-title')
            .setDescription('【管理】上架专属称号商品')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('商品名称').setRequired(true), '名称', '商品名称'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('price').setDescription('售价').setMinValue(0).setRequired(true), '价格', '购买所需星币'),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('title').setDescription('称号文本').setRequired(true), '称号文本', '实际佩戴的称号文字'),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('商品简介'), '简介', '商品描述'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('stock').setDescription('库存数量（留空为无限）').setMinValue(1), '库存', '库存数量'),
            ),
          '上架称号',
          '上架专属称号商品',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-boost')
            .setDescription('【管理】上架经验加成卡商品')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('商品名称').setRequired(true), '名称', '商品名称'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('price').setDescription('售价').setMinValue(0).setRequired(true), '价格', '购买所需星币'),
            )
            .addNumberOption((opt) =>
              applyZh(
                opt.setName('multiplier').setDescription('经验倍率（例如 2.0）').setMinValue(1.1).setMaxValue(5.0).setRequired(true),
                '倍率',
                '经验卡生效倍率',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('duration-min').setDescription('持续分钟数（如 60）').setMinValue(5).setMaxValue(10080).setRequired(true),
                '时长分钟',
                '持续生效的分钟数',
              ),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('商品简介'), '简介', '商品描述'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('stock').setDescription('库存数量（留空为无限）').setMinValue(1), '库存', '库存数量'),
            ),
          '上架经验卡',
          '上架经验加成卡商品',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-stat')
            .setDescription('【管理】上架成长数值增幅道具')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('商品名称').setRequired(true), '名称', '商品名称'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('price').setDescription('售价').setMinValue(0).setRequired(true), '价格', '购买所需星币'),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('min-gain').setDescription('单次最小增量（>=1）').setMinValue(1).setMaxValue(1000).setRequired(true),
                '最小增量',
                '单次保底增加的成长数值',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('max-gain').setDescription('单次最大增量（>=最小增量）').setMinValue(1).setMaxValue(1000).setRequired(true),
                '最大增量',
                '单次基础最多增加的成长数值',
              ),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('商品简介'), '简介', '商品描述'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('stock').setDescription('库存数量（留空为无限）').setMinValue(1), '库存', '库存数量'),
            ),
          '上架成长道具',
          '上架成长数值增幅道具',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-custom-title')
            .setDescription('【管理】上架自定义称号兑换券')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('商品名称').setRequired(true), '名称', '商品名称'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('price').setDescription('售价').setMinValue(0).setRequired(true), '价格', '购买所需星币'),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('商品简介'), '简介', '商品描述'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('stock').setDescription('库存数量（留空为无限）').setMinValue(1), '库存', '库存数量'),
            ),
          '上架自定称号券',
          '上架自定义称号兑换券',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-pet-xp')
            .setDescription('【管理】上架出战宠物经验道具')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('商品名称').setRequired(true), '名称', '商品名称'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('price').setDescription('售价').setMinValue(0).setRequired(true), '价格', '购买所需星币'),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('pet-xp').setDescription('宠物获得经验值（10~10000）').setMinValue(10).setMaxValue(10000).setRequired(true),
                '宠物经验',
                '购买后直接为出战宠物增加的经验值',
              ),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('商品简介'), '简介', '商品描述'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('stock').setDescription('库存数量（留空为无限）').setMinValue(1), '库存', '库存数量'),
            ),
          '上架宠物经验',
          '上架出战宠物经验道具',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-box')
            .setDescription('【管理】上架神秘幸运盲盒')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('商品名称').setRequired(true), '名称', '商品名称'),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('price')
                  .setDescription(`售价（最低 ${SHOP_MYSTERY_BOX_MIN_PRICE}）`)
                  .setMinValue(SHOP_MYSTERY_BOX_MIN_PRICE)
                  .setRequired(true),
                '价格',
                `购买所需星币（最低 ${SHOP_MYSTERY_BOX_MIN_PRICE}）`,
              ),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('商品简介'), '简介', '商品描述'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('stock').setDescription('库存数量（留空为无限）').setMinValue(1), '库存', '库存数量'),
            ),
          '上架盲盒礼盒',
          '上架神秘幸运盲盒',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-credit')
            .setDescription('【管理】上架信用修复道具')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('商品名称').setRequired(true), '名称', '商品名称'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('price').setDescription('售价').setMinValue(0).setRequired(true), '价格', '购买所需星币'),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('credit-gain').setDescription('恢复的信用分（1~200）').setMinValue(1).setMaxValue(200).setRequired(true),
                '信用增量',
                '购买后增加的信用分',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('daily-limit').setDescription('每日限购次数（默认 2）').setMinValue(1).setMaxValue(20),
                '每日限购',
                '每天最多购买次数',
              ),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('商品简介'), '简介', '商品描述'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('stock').setDescription('库存数量（留空为无限）').setMinValue(1), '库存', '库存数量'),
            ),
          '上架信用修复',
          '上架信用修复道具',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-rpg-supply')
            .setDescription('【管理】上架西幻 RPG 补给/装备箱')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('商品名称').setRequired(true), '名称', '商品名称'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('price').setDescription('售价').setMinValue(0).setRequired(true), '价格', '购买所需星币'),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('stamina-gain').setDescription('补充体力值（0~50）').setMinValue(0).setMaxValue(50).setRequired(true),
                '恢复体力',
                '购买后补充的体力值',
              ),
            )
            .addBooleanOption((opt) =>
              applyZh(opt.setName('loot-box').setDescription('是否附带随机装备箱').setRequired(true), '带装备箱', '是否开出装备'),
            )
            .addStringOption((opt) =>
              applyZh(
                opt
                  .setName('min-rarity')
                  .setDescription('保底品质（rare / epic / legendary）')
                  .addChoices(
                    { name: '精良蓝装 (rare)', value: 'rare' },
                    { name: '史诗紫装 (epic)', value: 'epic' },
                    { name: '传说橙装 (legendary)', value: 'legendary' },
                  ),
                '保底品质',
                '装备箱保底品质',
              ),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('商品简介'), '简介', '商品描述'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('stock').setDescription('库存数量（留空为无限）').setMinValue(1), '库存', '库存数量'),
            ),
          '上架地牢补给',
          '上架西幻 RPG 补给/装备箱',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-cp-affinity')
            .setDescription('【管理】上架 CP 亲密度礼物')
            .addStringOption((opt) =>
              applyZh(opt.setName('name').setDescription('商品名称').setRequired(true), '名称', '商品名称'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('price').setDescription('售价').setMinValue(0).setRequired(true), '价格', '购买所需星币'),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('affinity-gain').setDescription('增加的 CP 亲密度（1~1000）').setMinValue(1).setMaxValue(1000).setRequired(true),
                '亲密增量',
                '购买后直接增加的 CP 亲密度',
              ),
            )
            .addStringOption((opt) =>
              applyZh(opt.setName('description').setDescription('商品简介'), '简介', '商品描述'),
            )
            .addIntegerOption((opt) =>
              applyZh(opt.setName('stock').setDescription('库存数量（留空为无限）').setMinValue(1), '库存', '库存数量'),
            ),
          '上架亲密礼物',
          '上架 CP 亲密度礼物',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('remove')
            .setDescription('【管理】下架指定商品')
            .addIntegerOption((opt) =>
              applyZh(opt.setName('id').setDescription('商品 ID').setMinValue(1).setRequired(true), '编号', '要下架的商品编号'),
            ),
          '下架',
          '下架指定商品',
        ),
      ),
    '商店',
    '浏览商店或购买身份组、称号、经验卡与道具礼盒',
  );
}
