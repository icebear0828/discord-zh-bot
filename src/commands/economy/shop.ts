import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  formatDurationZh,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireBotAdmin, requireGuildMember, requireModuleEnabled } from '../guards.js';

export const shopCommand: CommandDefinition = {
  name: 'shop',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('shop')
      .setDescription('浏览商店或购买身份组、称号、双倍经验卡')
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
    '浏览商店或购买身份组、称号、双倍经验卡',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const guildCtx = await requireGuildMember(interaction);
    if (!guildCtx) return;
    if (!(await requireModuleEnabled(interaction, ctx, 'economy', '经济系统'))) return;

    const sub = interaction.options.getSubcommand();
    const cfg = ctx.repos.guildConfig.getOrCreate(guildCtx.guildId).economy;

    if (sub === 'list') {
      const items = ctx.services.shop.listItems(guildCtx.guildId);
      if (items.length === 0) {
        await interaction.reply({
          embeds: [
            createInfoEmbed(
              '🛒 服务器商店',
              '商店目前空空如也，管理员可使用 `/商店 上架身份组`、`/商店 上架称号` 或 `/商店 上架经验卡` 添加商品。',
            ),
          ],
        });
        return;
      }

      const lines = items.map((item) => {
        const stockText = item.stock === null ? '无限' : `剩 ${item.stock}`;
        const typeTag =
          item.type === 'role'
            ? `身份组 <@&${item.roleId}>`
            : item.type === 'title'
              ? `称号「${item.titleText}」`
              : `经验卡 ${item.boostMultiplier}x (${formatDurationZh((item.boostDurationSec ?? 0) * 1000)})`;
        return `**#${item.id} ${item.name}** — ${cfg.currencyEmoji} **${item.price}** ${cfg.currencyName}（${stockText}）\n> ${typeTag}${item.description ? ` · ${item.description}` : ''}`;
      });

      await interaction.reply({
        embeds: [
          createInfoEmbed('🛒 服务器商店', `${lines.join('\n\n')}\n\n使用 \`/商店 购买 编号\` 进行购买。`),
        ],
      });
      return;
    }

    if (sub === 'buy') {
      const itemId = interaction.options.getInteger('id', true);
      const res = ctx.services.shop.buyItem(guildCtx.guildId, interaction.user.id, itemId);

      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          not_found: `未找到编号为 **#${itemId}** 的商品。`,
          out_of_stock: '该商品已售罄。',
          insufficient_funds: `你的 ${cfg.currencyName} 余额不足！`,
          already_owned: '你已经拥有这个称号了，无需重复购买。',
        };
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 购买失败', msgMap[res.reason])],
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

      const detail = res.grantRoleId
        ? `已为你发放身份组 <@&${res.grantRoleId}>。`
        : res.equippedTitle
          ? `已为你解锁并自动佩戴称号 **「${res.equippedTitle}」**！`
          : '经验卡已放入你的 `/背包`，随时可使用激活！';

      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '🛍️ 购买成功！',
            `已购买 **${res.item.name}**（花费 ${cfg.currencyEmoji} ${res.item.price}）\n${detail}\n剩余余额：**${res.balance}** ${cfg.currencyName}`,
          ),
        ],
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
