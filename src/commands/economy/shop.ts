import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { SHOP_MYSTERY_BOX_MIN_PRICE } from '../../config/economyConstants.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { formatShopBuyError, formatShopItemTag } from '../../ui/menuShared.js';
import { truncateDescriptionLines } from '../../ui/soloFormatters.js';
import { requireBotAdmin, requireGuildMember, requireModuleEnabled } from '../guards.js';

export const shopCommand: CommandDefinition = {
  name: 'shop',
  data: applyZh(
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
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;

    const sub = interaction.options.getSubcommand();
    const guildCfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId);
    const cfg = guildCfg.economy;
    const lvlCfg = guildCfg.leveling;

    if (sub === 'list' || sub === 'buy') {
      if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;
    }

    if (sub === 'list') {
      const items = ctx.services.shop.listItems(guildCtx.guildId);
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
      return;
    }

    if (sub === 'buy') {
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
            createErrorEmbed('❌ 购买失败', formatShopBuyError(res.reason, cfg.currencyName, res.dailyLimit)),
          ],
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
            res.item.price,
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
            `已购买 **${res.item.name}**（花费 ${cfg.currencyEmoji} ${res.item.price}）\n${detail}\n剩余余额：**${res.balance}** ${cfg.currencyName}`,
          ),
        ],
        allowedMentions: { parse: [] },
      });
      return;
    }

    // Admin management subcommands
    const adminCtx = await requireBotAdmin(interaction, ctx);
    if (!adminCtx) return;

    if (sub === 'add-role') {
      const name = interaction.options.getString('name', true);
      const price = interaction.options.getInteger('price', true);
      const role = interaction.options.getRole('role', true);
      const description = interaction.options.getString('description') ?? '';
      const stock = interaction.options.getInteger('stock');

      const created = ctx.services.shop.createRoleItem({
        guildId: adminCtx.guildId,
        name,
        description,
        price,
        roleId: role.id,
        stock,
      });
      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 已上架身份组商品', `编号 **#${created.id}** · **${created.name}** → <@&${role.id}>（${price} ${cfg.currencyName}）`),
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
        guildId: adminCtx.guildId,
        name,
        description,
        price,
        titleText,
        stock,
      });
      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 已上架称号商品', `编号 **#${created.id}** · **${created.name}** → 「${titleText}」（${price} ${cfg.currencyName}）`),
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
        guildId: adminCtx.guildId,
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
        guildId: adminCtx.guildId,
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
        guildId: adminCtx.guildId,
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
        guildId: adminCtx.guildId,
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
        guildId: adminCtx.guildId,
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

    if (sub === 'remove') {
      const itemId = interaction.options.getInteger('id', true);
      const removed = ctx.services.shop.removeItem(adminCtx.guildId, itemId);
      await interaction.reply({
        embeds: [
          removed
            ? createSuccessEmbed('✅ 商品已下架', `已移除商品 **#${itemId}**。`)
            : createErrorEmbed('❌ 未找到商品', `编号 **#${itemId}** 不存在。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
