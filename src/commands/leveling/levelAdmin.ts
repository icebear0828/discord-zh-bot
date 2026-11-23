import {
  ChannelType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  createInfoEmbed,
  createSuccessEmbed,
  type AppContext,
  type CommandDefinition,
} from '../../ui/embeds.js';
import { applyZh } from '../../ui/localization.js';
import { requireBotAdmin } from '../guards.js';

export const levelAdminCommand: CommandDefinition = {
  name: 'level-admin',
  data: applyZh(
    new SlashCommandBuilder()
      .setName('level-admin')
      .setDescription('管理等级奖励身份组、热度倍率、语音经验与用户经验')
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('set-reward')
            .setDescription('设置达到指定等级时自动发放的身份组')
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('level').setDescription('等级要求').setMinValue(1).setMaxValue(200).setRequired(true),
                '等级',
                '触发奖励的等级',
              ),
            )
            .addRoleOption((opt) =>
              applyZh(
                opt.setName('role').setDescription('奖励身份组').setRequired(true),
                '身份组',
                '到达该等级时赠送的身份组',
              ),
            ),
          '设置升级奖励',
          '设置达到指定等级时自动发放的身份组',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('remove-reward')
            .setDescription('移除某个等级的奖励身份组')
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('level').setDescription('等级').setMinValue(1).setRequired(true),
                '等级',
                '要移除奖励的等级',
              ),
            ),
          '移除升级奖励',
          '移除某个等级的奖励身份组',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub.setName('list-rewards').setDescription('查看当前所有等级奖励身份组'),
          '查看奖励列表',
          '查看当前所有等级奖励身份组',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('set-announce')
            .setDescription('设置升级播报开关与指定播报频道')
            .addBooleanOption((opt) =>
              applyZh(
                opt.setName('enabled').setDescription('是否开启升级提示').setRequired(true),
                '开启',
                'true 为开启升级通知',
              ),
            )
            .addChannelOption((opt) =>
              applyZh(
                opt
                  .setName('channel')
                  .setDescription('播报频道（留空则在当前发言频道提示）')
                  .addChannelTypes(ChannelType.GuildText),
                '频道',
                '指定统一播报频道',
              ),
            ),
          '升级播报设置',
          '设置升级播报开关与指定播报频道',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('toggle-voice')
            .setDescription('开关语音挂机经验及每分钟经验值')
            .addBooleanOption((opt) =>
              applyZh(
                opt.setName('enabled').setDescription('是否开启语音经验').setRequired(true),
                '开启',
                '是否允许语音挂机涨经验',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('xp-per-min').setDescription('每分钟经验值').setMinValue(1).setMaxValue(100),
                '每分钟经验',
                '每分钟语音可获得的经验值',
              ),
            ),
          '语音经验设置',
          '开关语音挂机经验及每分钟经验值',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('set-params')
            .setDescription('调整聊天热度倍率上限、冷却、每小时上限与升级星币奖励')
            .addNumberOption((opt) =>
              applyZh(
                opt.setName('heat-max').setDescription('聊天连击最高倍率 (1.0~3.0)').setMinValue(1.0).setMaxValue(3.0),
                '热度上限',
                '聊天热度连击最高倍率',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('cooldown-sec').setDescription('发言经验冷却秒数').setMinValue(5).setMaxValue(300),
                '冷却秒数',
                '两次有效获取经验的最小间隔',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('hourly-cap').setDescription('每小时经验上限（0 为不限）').setMinValue(0).setMaxValue(50000),
                '小时上限',
                '每小时防刷经验上限',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('level-coins').setDescription('每次升级额外奖励的星币').setMinValue(0).setMaxValue(10000),
                '升级奖励星币',
                '每升一级发放的星币数',
              ),
            )
            .addBooleanOption((opt) =>
              applyZh(
                opt.setName('stack-roles').setDescription('是否叠加保留旧等级身份组'),
                '叠加身份组',
                'true 为保留低级身份组，false 为替换',
              ),
            ),
          '参数设置',
          '调整聊天热度倍率上限、冷却、每小时上限与升级星币奖励',
        ),
      )
      .addSubcommand((sub) =>
        applyZh(
          sub
            .setName('set-xp')
            .setDescription('手动设置指定用户的总经验值')
            .addUserOption((opt) =>
              applyZh(
                opt.setName('user').setDescription('目标成员').setRequired(true),
                '用户',
                '要修改经验值的成员',
              ),
            )
            .addIntegerOption((opt) =>
              applyZh(
                opt.setName('xp').setDescription('目标总经验值').setMinValue(0).setMaxValue(10000000).setRequired(true),
                '经验值',
                '设置后的总经验值',
              ),
            ),
          '设置用户经验',
          '手动设置指定用户的总经验值',
        ),
      ),
    '等级管理',
    '管理等级奖励身份组、热度倍率、语音经验与用户经验',
  ),
  async execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
    const adminCtx = await requireBotAdmin(interaction, ctx);
    if (!adminCtx) return;

    const { guildId } = adminCtx;
    const sub = interaction.options.getSubcommand();
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (sub === 'set-reward') {
      const level = interaction.options.getInteger('level', true);
      const role = interaction.options.getRole('role', true);
      ctx.repos.profile.setLevelReward(guildId, level, role.id);
      await interaction.reply({
        embeds: [
          createSuccessEmbed('✅ 等级奖励已设置', `达到 **Lv.${level}** 时将自动获得 <@&${role.id}>。`),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove-reward') {
      const level = interaction.options.getInteger('level', true);
      const removed = ctx.repos.profile.removeLevelReward(guildId, level);
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            removed ? '✅ 等级奖励已移除' : 'ℹ️ 未找到该奖励',
            removed ? `已删除 **Lv.${level}** 的身份组奖励。` : `Lv.${level} 未配置奖励身份组。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'list-rewards') {
      const rewards = ctx.repos.profile.listLevelRewards(guildId);
      const text =
        rewards.length > 0
          ? rewards.map((r) => `• Lv.**${r.level}** → <@&${r.roleId}>`).join('\n')
          : '暂未配置任何等级身份组奖励。';
      await interaction.reply({
        embeds: [createInfoEmbed('🎖️ 等级身份组奖励列表', text)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'set-announce') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const channel = interaction.options.getChannel('channel');
      ctx.repos.guildConfig.updateLeveling(guildId, {
        ...cfg.leveling,
        announceEnabled: enabled,
        announceChannelId: channel ? channel.id : null,
      });
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 升级播报已更新',
            `升级播报：**${enabled ? '开启' : '关闭'}**${channel ? `\n播报频道：<#${channel.id}>` : '\n播报频道：原发言频道'}`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'toggle-voice') {
      const enabled = interaction.options.getBoolean('enabled', true);
      const xpPerMin = interaction.options.getInteger('xp-per-min');
      ctx.repos.guildConfig.updateLeveling(guildId, {
        ...cfg.leveling,
        voiceEnabled: enabled,
        voiceXpPerMin: xpPerMin ?? cfg.leveling.voiceXpPerMin,
      });
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 语音经验设置已更新',
            `状态：**${enabled ? '开启' : '关闭'}**\n每分钟经验：**${xpPerMin ?? cfg.leveling.voiceXpPerMin} XP**`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'set-params') {
      const heatMax = interaction.options.getNumber('heat-max');
      const cooldownSec = interaction.options.getInteger('cooldown-sec');
      const hourlyCap = interaction.options.getInteger('hourly-cap');
      const levelCoins = interaction.options.getInteger('level-coins');
      const stackRoles = interaction.options.getBoolean('stack-roles');

      const next = {
        ...cfg.leveling,
        heatMaxMultiplier: heatMax ?? cfg.leveling.heatMaxMultiplier,
        cooldownSec: cooldownSec ?? cfg.leveling.cooldownSec,
        hourlyXpCap: hourlyCap ?? cfg.leveling.hourlyXpCap,
        levelUpCoinReward: levelCoins ?? cfg.leveling.levelUpCoinReward,
        stackRoles: stackRoles ?? cfg.leveling.stackRoles,
      };
      ctx.repos.guildConfig.updateLeveling(guildId, next);
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 等级参数已保存',
            [
              `热度最高倍率：**${next.heatMaxMultiplier}x**`,
              `发言冷却：**${next.cooldownSec}秒**`,
              `每小时上限：**${next.hourlyXpCap === 0 ? '不限' : `${next.hourlyXpCap} XP`}**`,
              `升级星币奖励：**${next.levelUpCoinReward}**`,
              `身份组叠加：**${next.stackRoles ? '保留旧身份组' : '仅保留最高等级身份组'}**`,
            ].join('\n'),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'set-xp') {
      const user = interaction.options.getUser('user', true);
      const xp = interaction.options.getInteger('xp', true);
      const res = ctx.services.leveling.setUserXp(guildId, user.id, xp);
      await interaction.reply({
        embeds: [
          createSuccessEmbed(
            '✅ 经验已调整',
            `已将 <@${user.id}> 的总经验设为 **${res.totalXp} XP**（当前 Lv.**${res.newLevel}**）。`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
