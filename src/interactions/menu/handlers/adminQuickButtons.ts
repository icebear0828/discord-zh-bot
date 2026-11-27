import { ModalBuilder } from 'discord.js';
import {
  DEFAULT_ECONOMY_CONFIG,
  DEFAULT_LEVELING_CONFIG,
} from '../../../config/defaults.js';
import { MonitorRepo } from '../../../db/repositories/monitorRepo.js';
import { buildLobbyMessage, buildMenuMessage } from '../../../ui/menuBuilder.js';
import type { MenuFeedback } from '../../../ui/menuShared.js';
import {
  ADMIN_DENIED_FEEDBACK,
  SUPER_ADMIN_DENIED_FEEDBACK,
  isGuildSuperAdmin,
  prefilledField,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from '../../menuHelpers.js';
import { dispatchByAction, type ActionRouteTable } from '../subRouter.js';
import {
  buildAdminRedPacketModal,
  buildAmountModal,
  updateButtonPage,
  type MenuButtonContext,
} from './menuSharedModalsAndParsers.js';

const SIMPLE_ADMIN_NAV_TARGETS = new Set([
  'admin',
  'admin_econ',
  'admin_lvl',
  'admin_mod',
  'admin_ops',
  'admin_credit_rpg',
  'admin_monitor',
] as const);

type SimpleAdminNavPage =
  | 'admin'
  | 'admin_econ'
  | 'admin_lvl'
  | 'admin_mod'
  | 'admin_ops'
  | 'admin_credit_rpg'
  | 'admin_monitor';

function isSuperAdminActor(input: MenuButtonContext): boolean {
  return Boolean(
    input.actor.isSuperAdmin || isGuildSuperAdmin(input.interaction, input.ctx, input.guildId),
  );
}

async function handleAdminNavButton(input: MenuButtonContext): Promise<boolean> {
  const target = input.parts[2];
  if (target === 'admin_image') {
    if (!input.actor.isAdmin) {
      await updateButtonPage(input, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      return true;
    }
    const tab = input.parts[3] === 'channels' ? 'channels' : 'basic';
    await updateButtonPage(input, { page: 'admin_image', tab });
    return true;
  }

  if (target && SIMPLE_ADMIN_NAV_TARGETS.has(target as SimpleAdminNavPage)) {
    if (!input.actor.isAdmin) {
      await updateButtonPage(input, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
      return true;
    }
    await updateButtonPage(input, { page: target as SimpleAdminNavPage });
    return true;
  }

  return false;
}

async function handleAdminQuickAction(input: MenuButtonContext): Promise<boolean> {
  const { interaction, ctx, guildId, actor, parts } = input;
  if (!actor.isAdmin) {
    await updateButtonPage(input, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
    return true;
  }

  const adminAction = parts[2];
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const superAdmin = isSuperAdminActor(input);

  if (adminAction === 'send_lobby') {
    await interaction.deferUpdate();
    const sent = await sendPublicBroadcast(interaction, buildLobbyMessage(interaction.guild?.name));
    const feedback: MenuFeedback = sent.sent
      ? { type: 'success', text: '✅ 已在当前频道发送永久「打开我的互动菜单」大厅卡片！' }
      : { type: 'error', text: '无法在当前频道发送大厅消息，请检查机器人发言与嵌入链接权限。' };
    await safeEditOrFollowUp(interaction, buildMenuMessage(ctx, guildId, actor, { page: 'admin' }, feedback));
    return true;
  }

  if (adminAction === 'reset_econ') {
    if (!superAdmin) {
      await updateButtonPage(input, { page: 'admin_econ' }, SUPER_ADMIN_DENIED_FEEDBACK);
      return true;
    }
    if (parts[3] !== 'confirm') {
      await updateButtonPage(input, { page: 'admin_econ', confirmReset: true }, {
        type: 'info',
        text: '⚠️ 确认将签到、打工、抢钱与银行利息参数恢复为默认值？（自定义货币名称与图标将被保留）',
      });
      return true;
    }
    ctx.repos.guildConfig.updateEconomy(guildId, {
      ...DEFAULT_ECONOMY_CONFIG,
      currencyName: cfg.economy.currencyName,
      currencyEmoji: cfg.economy.currencyEmoji,
    });
    await updateButtonPage(input, { page: 'admin_econ' }, {
      type: 'success',
      text: `♻️ 已将签到、打工、抢钱与银行利息参数恢复默认值（保留货币 **${cfg.economy.currencyName}** ${cfg.economy.currencyEmoji}）。`,
    });
    return true;
  }

  if (adminAction === 'reset_lvl') {
    if (!superAdmin) {
      await updateButtonPage(input, { page: 'admin_lvl' }, SUPER_ADMIN_DENIED_FEEDBACK);
      return true;
    }
    if (parts[3] !== 'confirm') {
      await updateButtonPage(input, { page: 'admin_lvl', confirmReset: true }, {
        type: 'info',
        text: '⚠️ 确认将等级经验、热度连击、语音与升级奖励参数恢复为默认值？（频道配置将被保留）',
      });
      return true;
    }
    ctx.repos.guildConfig.updateLeveling(guildId, {
      ...DEFAULT_LEVELING_CONFIG,
      announceChannelId: cfg.leveling.announceChannelId,
      allowedChannelIds: cfg.leveling.allowedChannelIds,
      ignoredChannelIds: cfg.leveling.ignoredChannelIds,
      channelMultipliers: cfg.leveling.channelMultipliers,
    });
    await updateButtonPage(input, { page: 'admin_lvl' }, {
      type: 'success',
      text: '♻️ 已将等级经验、热度连击、语音与升级奖励参数恢复默认值（保留频道配置）。',
    });
    return true;
  }

  if (adminAction === 'toggle_voice') {
    const next = !cfg.leveling.voiceEnabled;
    ctx.repos.guildConfig.updateLeveling(guildId, { ...cfg.leveling, voiceEnabled: next });
    await updateButtonPage(input, { page: 'admin_lvl' }, {
      type: 'success',
      text: `已将语音挂机经验设为：**${next ? '开启' : '关闭'}**。`,
    });
    return true;
  }

  if (adminAction === 'toggle_announce') {
    const next = !cfg.leveling.announceEnabled;
    ctx.repos.guildConfig.updateLeveling(guildId, { ...cfg.leveling, announceEnabled: next });
    await updateButtonPage(input, { page: 'admin_lvl' }, {
      type: 'success',
      text: `已将升级公告播报设为：**${next ? '开启' : '关闭'}**。`,
    });
    return true;
  }

  return false;
}

async function handleAdminMonitorButton(input: MenuButtonContext): Promise<boolean> {
  const { ctx, guildId, actor, parts } = input;
  if (!actor.isAdmin) {
    await updateButtonPage(input, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
    return true;
  }
  const subAction = parts[2];
  const monitorRepo = ctx.repos.monitor ?? new MonitorRepo(ctx.db);
  if (subAction === 'filter' || subAction === 'refresh') {
    const filter: 'issues' | 'all' = parts[3] === 'all' ? 'all' : 'issues';
    await updateButtonPage(input, { page: 'admin_monitor', filter });
    return true;
  }
  if (subAction === 'clear') {
    if (!isSuperAdminActor(input)) {
      await updateButtonPage(input, { page: 'admin_monitor', filter: 'issues' }, SUPER_ADMIN_DENIED_FEEDBACK);
      return true;
    }
    if (parts[3] !== 'confirm') {
      await updateButtonPage(input, { page: 'admin_monitor', filter: 'issues', confirmClear: true }, {
        type: 'info',
        text: '⚠️ 确认清空本服务器全部交互监控日志？此操作不可撤销。',
      });
      return true;
    }
    const deleted = monitorRepo.clearGuildLogs(guildId);
    await updateButtonPage(input, { page: 'admin_monitor', filter: 'issues' }, {
      type: 'success',
      text: `🧹 已清理本服务器 **${deleted}** 条历史交互监控日志。`,
    });
    return true;
  }
  return false;
}

async function handleAdminModalTrigger(input: MenuButtonContext): Promise<boolean> {
  const { interaction, ctx, guildId, actor, parts } = input;
  const modalType = parts[2];
  if (!modalType?.startsWith('admin_')) {
    return false;
  }
  if (!actor.isAdmin) {
    await updateButtonPage(input, { page: 'home' }, ADMIN_DENIED_FEEDBACK);
    return true;
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
  const currencyName = cfg.economy.currencyName;
  const superAdmin = isSuperAdminActor(input);

  if (modalType === 'admin_daily') {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId('menu:modal_sub:admin_daily')
        .setTitle('📅 修改签到与货币参数')
        .addComponents(
          prefilledField('currencyName', '货币名称（1~16字）', cfg.economy.currencyName, 16),
          prefilledField('currencyEmoji', '货币图标 Emoji', cfg.economy.currencyEmoji, 16),
          prefilledField('dailyBase', '每日签到基础奖励（0 ~ 100000）', cfg.economy.dailyBase),
          prefilledField('dailyStreakBonus', '连签每日递增奖励（0 ~ 50000）', cfg.economy.dailyStreakBonus),
          prefilledField('dailyMaxStreakBonus', '连签递增上限（0 ~ 500000）', cfg.economy.dailyMaxStreakBonus),
        ),
    );
    return true;
  }

  if (modalType === 'admin_work') {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId('menu:modal_sub:admin_work')
        .setTitle('💼 修改打工参数')
        .addComponents(
          prefilledField('workMin', '打工最低收益（1 ~ 100000）', cfg.economy.workMin),
          prefilledField('workMax', '打工最高收益（1 ~ 100000）', cfg.economy.workMax),
          prefilledField('workCooldownSec', '打工冷却秒数（0 ~ 86400）', cfg.economy.workCooldownSec),
        ),
    );
    return true;
  }

  if (modalType === 'admin_rob') {
    const pct = Number((cfg.economy.robSuccessRate * 100).toFixed(2));
    const bankPct = Number((cfg.economy.robBankSuccessRate * 100).toFixed(2));
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId('menu:modal_sub:admin_rob')
        .setTitle('🥷 修改抢钱与劫金库参数')
        .addComponents(
          prefilledField('robSuccessPct', '抢口袋现金成功率 %（5 ~ 95）', pct),
          prefilledField('robBankSuccessPct', '抢银行金库成功率 %（1 ~ 80）', bankPct),
          prefilledField('robCooldownSec', '抢钱攻击冷却秒数（0 ~ 86400）', cfg.economy.robCooldownSec),
          prefilledField('robTargetShieldSec', '被抢后护盾秒数（0 ~ 86400）', cfg.economy.robTargetShieldSec),
        ),
    );
    return true;
  }

  if (modalType === 'admin_bank') {
    const pct = Number((cfg.economy.bankInterestRate * 100).toFixed(2));
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId('menu:modal_sub:admin_bank')
        .setTitle('🏦 修改银行利息参数')
        .addComponents(
          prefilledField('bankInterestPct', '每日利率 %（0.1 ~ 50）', pct),
          prefilledField('bankInterestMax', '每日利息上限（1 ~ 1000000000）', cfg.economy.bankInterestMax),
          prefilledField('bankInterestMinDeposit', '起息最低存款额（1 ~ 1000000000）', cfg.economy.bankInterestMinDeposit),
        ),
    );
    return true;
  }

  if (modalType === 'admin_xp') {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId('menu:modal_sub:admin_xp')
        .setTitle('💬 修改发言经验与冷却')
        .addComponents(
          prefilledField('baseMinXp', '单次发言最小 XP（1 ~ 1000）', cfg.leveling.baseMinXp),
          prefilledField('baseMaxXp', '单次发言最大 XP（1 ~ 1000）', cfg.leveling.baseMaxXp),
          prefilledField('cooldownSec', '发言经验冷却秒数（0 ~ 3600）', cfg.leveling.cooldownSec),
          prefilledField('hourlyXpCap', '每小时经验上限（0 = 不限）', cfg.leveling.hourlyXpCap),
        ),
    );
    return true;
  }

  if (modalType === 'admin_heat') {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId('menu:modal_sub:admin_heat')
        .setTitle('🔥 修改热度连击与奖励')
        .addComponents(
          prefilledField('heatWindowSec', '热度连击窗口秒数（10 ~ 3600）', cfg.leveling.heatWindowSec),
          prefilledField('heatMaxMultiplier', '热度倍率上限（1.0 ~ 5.0）', cfg.leveling.heatMaxMultiplier),
          prefilledField('voiceXpPerMin', '语音每分钟经验（0 ~ 1000）', cfg.leveling.voiceXpPerMin),
          prefilledField('levelUpCoinReward', `每次升级奖励${currencyName}（0 ~ 100000）`, cfg.leveling.levelUpCoinReward),
        ),
    );
    return true;
  }

  if (modalType === 'admin_grant_all') {
    if (!superAdmin) {
      await updateButtonPage(input, { page: 'admin_ops' }, SUPER_ADMIN_DENIED_FEEDBACK);
      return true;
    }
    await interaction.showModal(
      buildAmountModal(
        'menu:modal_sub:admin_grant_all',
        `🎉 全服全员发放${currencyName}`,
        '每位真实群友发放数量（1 ~ 1000000000）',
        '例如：1000000',
      ),
    );
    return true;
  }

  if (modalType === 'admin_random_redpacket') {
    if (!superAdmin) {
      await updateButtonPage(input, { page: 'admin_ops' }, SUPER_ADMIN_DENIED_FEEDBACK);
      return true;
    }
    await interaction.showModal(
      buildAdminRedPacketModal(
        'menu:modal_sub:admin_random_redpacket',
        '🎲 管理员随机派发红包',
        1,
        currencyName,
      ),
    );
    return true;
  }

  if (modalType === 'admin_sys_redpacket') {
    await interaction.showModal(
      buildAdminRedPacketModal(
        'menu:modal_sub:admin_sys_redpacket',
        '🧧 管理员发系统抢红包',
        2,
        currencyName,
      ),
    );
    return true;
  }

  return false;
}

const ADMIN_QUICK_BUTTON_ROUTES: ActionRouteTable<MenuButtonContext> = {
  exact: {
    nav: handleAdminNavButton,
    admin: handleAdminQuickAction,
    admin_monitor: handleAdminMonitorButton,
    modal: handleAdminModalTrigger,
  },
};

export async function tryHandleAdminQuickButton(input: MenuButtonContext): Promise<boolean> {
  return dispatchByAction(input.parts[1], input, ADMIN_QUICK_BUTTON_ROUTES);
}
