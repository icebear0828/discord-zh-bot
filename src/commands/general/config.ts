import {
  ChannelType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { ModuleKey } from '../../config/defaults.js';
import {
  createErrorEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireBotAdmin } from '../guards.js';

const MODULE_LABELS: Record<ModuleKey, string> = {
  leveling: '等级与热度',
  economy: '经济系统',
  fun: '娱乐互动',
  welcome: '欢迎与离开',
  tickets: '工单系统',
  giveaways: '抽奖系统',
  invites: '邀请追踪',
  rolePanels: '自助身份组',
  socialGames: '整蛊与博弈',
  worldEvents: '吃瓜与世界事件',
  petsAndCp: '关系与宠物',
};

const MODULE_CHOICES: ReadonlyArray<{ name: string; value: ModuleKey }> = [
  { name: '等级与热度 (leveling)', value: 'leveling' },
  { name: '经济系统 (economy)', value: 'economy' },
  { name: '娱乐互动 (fun)', value: 'fun' },
  { name: '欢迎与离开 (welcome)', value: 'welcome' },
  { name: '工单系统 (tickets)', value: 'tickets' },
  { name: '抽奖系统 (giveaways)', value: 'giveaways' },
  { name: '邀请追踪 (invites)', value: 'invites' },
  { name: '自助身份组 (rolePanels)', value: 'rolePanels' },
  { name: '整蛊与博弈 (socialGames)', value: 'socialGames' },
  { name: '吃瓜与世界事件 (worldEvents)', value: 'worldEvents' },
  { name: '关系与宠物 (petsAndCp)', value: 'petsAndCp' },
];

export const configCommand: CommandDefinition = {
  name: 'config',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('config')
      .setDescription('查看或修改服务器 Bot 总配置')
      .addSubcommand((sub) =>
        applyZh(
          sub.setName('view').setDescription('查看当前服务器各模块开关与管理员配置'),
          '查看',
          '查看当前服务器各模块开关与管理员配置',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('toggle-module')
            .setDescription('开启或关闭指定功能模块')
            .addStringOption((opt) =>
              applyZh(
                opt
                  .setName('module')
                  .setDescription('功能模块')
                  .setRequired(true)
                  .addChoices(...MODULE_CHOICES),
                '模块',
                '选择要开关的功能模块',
              ),
            )
            .addBooleanOption((opt) =>
              applyZh(
                opt.setName('enabled').setDescription('是否启用').setRequired(true),
                '启用',
                'true 为开启，false 为关闭',
              ),
            ),
          '开关模块',
          '开启或关闭指定功能模块',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-admin-role')
            .setDescription('添加可管理本 Bot 的管理员身份组')
            .addRoleOption((opt) =>
              applyZh(
                opt.setName('role').setDescription('身份组').setRequired(true),
                '身份组',
                '要授予 Bot 管理权限的身份组',
              ),
            ),
          '添加管理员身份组',
          '添加可管理本 Bot 的管理员身份组',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('remove-admin-role')
            .setDescription('移除一个 Bot 管理员身份组')
            .addRoleOption((opt) =>
              applyZh(
                opt.setName('role').setDescription('身份组').setRequired(true),
                '身份组',
                '要移除的身份组',
              ),
            ),
          '移除管理员身份组',
          '移除一个 Bot 管理员身份组',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('ignore-channel')
            .setDescription('将频道加入或移出经验获取黑名单')
            .addChannelOption((opt) =>
              applyZh(
                opt
                  .setName('channel')
                  .setDescription('目标频道')
                  .addChannelTypes(ChannelType.GuildText)
                  .setRequired(true),
                '频道',
                '要设置忽略经验的文字频道',
              ),
            )
            .addBooleanOption((opt) =>
              applyZh(
                opt.setName('ignored').setDescription('true 为忽略，false 为恢复').setRequired(true),
                '忽略',
                'true 为忽略经验，false 为恢复经验',
              ),
            ),
          '忽略经验频道',
          '将频道加入或移出经验获取黑名单',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('channel-multiplier')
            .setDescription('为指定频道设置聊天经验倍率（1.0 为默认）')
            .addChannelOption((opt) =>
              applyZh(
                opt
                  .setName('channel')
                  .setDescription('目标频道')
                  .addChannelTypes(ChannelType.GuildText)
                  .setRequired(true),
                '频道',
                '要调整经验倍率的频道',
              ),
            )
            .addNumberOption((opt) =>
              applyZh(
                opt
                  .setName('multiplier')
                  .setDescription('经验倍率（0.1 ~ 5.0）')
                  .setMinValue(0.1)
                  .setMaxValue(5.0)
                  .setRequired(true),
                '倍率',
                '经验倍率（1.0 为恢复默认）',
              ),
            ),
          '频道经验倍率',
          '为指定频道设置聊天经验倍率',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('grant-coins')
            .setDescription('【管理】为指定成员发放或扣除口袋星币')
            .addUserOption((opt) =>
              applyZh(opt.setName('user').setDescription('目标成员').setRequired(true), '用户', '目标群友'),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('amount')
                  .setDescription('增减星币数量（正数发放，负数扣除）')
                  .setMinValue(-1_000_000)
                  .setMaxValue(1_000_000)
                  .setRequired(true),
                '金额',
                '正数为发放，负数为扣除',
              ),
            ),
          '发放星币',
          '为指定成员发放或扣除口袋星币',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('grant-all-coins')
            .setDescription('【管理】向服务器所有真实成员统一发放口袋星币')
            .addIntegerOption((opt) =>
              applyZh(
                opt
                  .setName('amount')
                  .setDescription('每位成员发放的星币数量（1 ~ 1,000,000）')
                  .setMinValue(1)
                  .setMaxValue(1_000_000)
                  .setRequired(true),
                '金额',
                '每人发放的星币数量',
              ),
            ),
          '全员发币',
          '向服务器所有真实成员统一发放口袋星币',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('add-admin-user')
            .setDescription('添加可管理本 Bot 的指定管理员用户')
            .addUserOption((opt) =>
              applyZh(opt.setName('user').setDescription('成员').setRequired(true), '用户', '要授予 Bot 管理权限的群友'),
            ),
          '添加管理员用户',
          '添加可管理本 Bot 的指定管理员用户',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('remove-admin-user')
            .setDescription('移除一个指定 Bot 管理员用户')
            .addUserOption((opt) =>
              applyZh(opt.setName('user').setDescription('成员').setRequired(true), '用户', '要移除 Bot 管理权限的群友'),
            ),
          '移除管理员用户',
          '移除一个指定 Bot 管理员用户',
        ),
      ),
    '设置',
    '查看或修改服务器 Bot 总配置',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const adminCtx = await requireBotAdmin(interaction, ctx);
    if (!adminCtx) return;

    const { guildId } = adminCtx;
    const sub = interaction.options.getSubcommand();
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (sub === 'view') {
      const moduleStatus = (Object.keys(MODULE_LABELS) as ModuleKey[])
        .map((key) => `${cfg.modules[key] ? '✅' : '⛔'} **${MODULE_LABELS[key]}**`)
        .join('\n');

      const adminRolesText =
        cfg.adminRoleIds.length > 0
          ? cfg.adminRoleIds.map((id) => `<@&${id}>`).join('、')
          : '未额外配置';

      const adminUsersText =
        cfg.adminUserIds.length > 0
          ? cfg.adminUserIds.map((id) => `<@${id}>`).join('、')
          : '未额外配置（仅限服务器管理员）';

      const ignoredText =
        cfg.leveling.ignoredChannelIds.length > 0
          ? cfg.leveling.ignoredChannelIds.map((id) => `<#${id}>`).join('、')
          : '无';

      const multEntries = Object.entries(cfg.leveling.channelMultipliers);
      const multText =
        multEntries.length > 0
          ? multEntries.map(([ch, m]) => `<#${ch}>: **${m}x**`).join('\n')
          : '无自定义频道倍率';

      const embed = createInfoEmbed('⚙️ 当前服务器 Bot 配置')
        .addFields(
          { name: '📦 功能模块状态', value: moduleStatus, inline: true },
          {
            name: '🛡️ Bot 管理员身份组',
            value: adminRolesText,
            inline: true,
          },
          {
            name: '👑 Bot 管理员用户',
            value: adminUsersText,
            inline: true,
          },
          {
            name: '📈 等级与热度参数',
            value: [
              `冷却：${cfg.leveling.cooldownSec}秒 | 热度窗口：${cfg.leveling.heatWindowSec}秒（上限 ${cfg.leveling.heatMaxMultiplier}x）`,
              `每小时经验上限：${cfg.leveling.hourlyXpCap} | 升级奖励：${cfg.leveling.levelUpCoinReward} ${cfg.economy.currencyName}`,
              `语音经验：${cfg.leveling.voiceEnabled ? `开启 (${cfg.leveling.voiceXpPerMin}/分钟)` : '关闭'}`,
            ].join('\n'),
          },
          { name: '🔕 忽略经验频道', value: ignoredText, inline: true },
          { name: '⚡ 频道经验倍率', value: multText, inline: true },
        );

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'toggle-module') {
      const moduleKey = interaction.options.getString('module', true) as ModuleKey;
      const enabled = interaction.options.getBoolean('enabled', true);
      ctx.repos.guildConfig.updateModules(guildId, { ...cfg.modules, [moduleKey]: enabled });
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 模块状态已更新',
            `已将 **${MODULE_LABELS[moduleKey]}** 设置为：**${enabled ? '开启' : '关闭'}**。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'add-admin-role') {
      const role = interaction.options.getRole('role', true);
      const next = cfg.adminRoleIds.includes(role.id)
        ? cfg.adminRoleIds
        : [...cfg.adminRoleIds, role.id];
      ctx.repos.guildConfig.updateAdminRoles(guildId, next);
      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 已添加管理员身份组', `现在拥有 <@&${role.id}> 的成员也可管理本 Bot。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove-admin-role') {
      const role = interaction.options.getRole('role', true);
      const next = cfg.adminRoleIds.filter((id) => id !== role.id);
      ctx.repos.guildConfig.updateAdminRoles(guildId, next);
      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 已移除管理员身份组', `已从 Bot 管理员列表移除 <@&${role.id}>。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'ignore-channel') {
      const channel = interaction.options.getChannel('channel', true);
      const ignored = interaction.options.getBoolean('ignored', true);
      const set = new Set(cfg.leveling.ignoredChannelIds);
      if (ignored) {
        set.add(channel.id);
      } else {
        set.delete(channel.id);
      }
      ctx.repos.guildConfig.updateLeveling(guildId, {
        ...cfg.leveling,
        ignoredChannelIds: [...set],
      });
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 忽略频道已更新',
            `<#${channel.id}> 已${ignored ? '加入' : '移出'}经验黑名单。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'channel-multiplier') {
      const channel = interaction.options.getChannel('channel', true);
      const multiplier = interaction.options.getNumber('multiplier', true);
      const nextMult = { ...cfg.leveling.channelMultipliers };
      if (multiplier === 1) {
        delete nextMult[channel.id];
      } else {
        nextMult[channel.id] = Number(multiplier.toFixed(2));
      }
      ctx.repos.guildConfig.updateLeveling(guildId, {
        ...cfg.leveling,
        channelMultipliers: nextMult,
      });
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 频道倍率已更新',
            multiplier === 1
              ? `已将 <#${channel.id}> 恢复为默认 **1.0x** 倍率。`
              : `已将 <#${channel.id}> 聊天经验倍率设为 **${multiplier.toFixed(2)}x**。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'grant-coins') {
      const target = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      if (target.bot) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 操作无效', '不能给机器人发放或扣除星币。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (amount === 0) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 金额无效', '发放或扣除金额不能为 0。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const updated = ctx.repos.profile.addCoins(guildId, target.id, amount);
      if (amount > 0) {
        await interaction.reply({
          content: `🎁 <@${target.id}> 收到管理员发放的星币福利！`,
          embeds: [
            createSuccessEmbed(
              '🎁 管理员发放星币',
              `管理员 <@${adminCtx.member.id}> 向 <@${target.id}> 发放了 ${cfg.economy.currencyEmoji} **+${amount}** ${cfg.economy.currencyName}！\n当前口袋现金：**${updated.coins}** ${cfg.economy.currencyName}`,
            ),
          ],
        });
      } else {
        await interaction.reply({
          embeds: [
            createSuccessEmbed(
              '💸 管理员扣除星币',
              `已从 <@${target.id}> 的口袋扣除 ${cfg.economy.currencyEmoji} **${Math.abs(amount)}** ${cfg.economy.currencyName}，当前剩余：**${updated.coins}** ${cfg.economy.currencyName}。`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (sub === 'grant-all-coins') {
      const amount = interaction.options.getInteger('amount', true);
      if (!interaction.guild) return;

      await interaction.deferReply();
      const members = await interaction.guild.members.fetch();
      const humanIds = [...members.values()].filter((m) => !m.user.bot).map((m) => m.id);

      ctx.db.transaction(() => {
        for (const uid of humanIds) {
          ctx.repos.profile.addCoins(guildId, uid, amount);
        }
      })();

      await interaction.editReply({
        embeds: [
          createSuccessEmbed(
            '🎉 全服福利发放！',
            `管理员 <@${adminCtx.member.id}> 向全服 **${humanIds.length}** 位真实群友每人发放了 ${cfg.economy.currencyEmoji} **+${amount}** ${cfg.economy.currencyName}！`,
          ),
        ],
      });
      return;
    }

    if (sub === 'add-admin-user') {
      const target = interaction.options.getUser('user', true);
      if (target.bot) {
        await interaction.reply({
          embeds: [createErrorEmbed('❌ 操作无效', '不能将机器人添加为 Bot 管理员。')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const next = cfg.adminUserIds.includes(target.id)
        ? cfg.adminUserIds
        : [...cfg.adminUserIds, target.id];
      ctx.repos.guildConfig.updateAdminUsers(guildId, next);
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 已添加 Bot 管理员用户',
            `已授予 <@${target.id}> 管理本 Bot 与调参权限（可通过 \`/菜单\` 中的「⚙️ 管理后台」调整参数）。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove-admin-user') {
      const target = interaction.options.getUser('user', true);
      const next = cfg.adminUserIds.filter((id) => id !== target.id);
      ctx.repos.guildConfig.updateAdminUsers(guildId, next);
      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 已移除 Bot 管理员用户', `已移除 <@${target.id}> 的指定 Bot 管理员权限。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
