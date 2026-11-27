import type { LeaderboardType } from '../../../services/levelingService.js';
import {
  buildMenuMessage,
  buildPublicLeaderboardEmbed,
  buildPublicRankEmbed,
} from '../../../ui/menuBuilder.js';
import type { MenuFeedback, MenuView } from '../../../ui/menuShared.js';
import {
  checkModuleDisabled,
  parsePositiveInt,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from '../../menuHelpers.js';
import { dispatchByAction, type ActionRouteTable } from '../subRouter.js';
import {
  LEADERBOARD_MODULE_MAP,
  parseLeaderboardType,
  parseSocialAction,
  updateButtonPage,
  type MenuButtonContext,
} from './menuSharedModalsAndParsers.js';

const ECON_NAV_PAGES: ReadonlySet<string> = new Set([
  'slots',
  'dice',
  'bj',
  'bank',
  'rob',
  'pay',
  'duel',
  'shop',
  'bag',
]);

async function handleUserNavButton(input: MenuButtonContext): Promise<boolean> {
  const { ctx, guildId, parts } = input;
  const target = parts[2];

  if (target === 'image') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'imageGen', 'AI 绘图');
    if (disabledMsg) {
      await updateButtonPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
      return true;
    }
    await updateButtonPage(input, { page: 'image' });
    return true;
  }

  if (target === 'credit' || target === 'loan' || target === 'hustle') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'creditLoan', '信用与借贷');
    if (disabledMsg) {
      await updateButtonPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
      return true;
    }
    await updateButtonPage(input, { page: target });
    return true;
  }

  if (target === 'rpg') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'rpg', '奇幻RPG地牢');
    if (disabledMsg) {
      await updateButtonPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
      return true;
    }
    await updateButtonPage(input, { page: 'rpg' });
    return true;
  }

  if (target === 'rank') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'leveling', '等级与热度');
    if (disabledMsg) {
      await updateButtonPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
      return true;
    }
    await updateButtonPage(input, { page: 'rank' });
    return true;
  }

  if (target && ECON_NAV_PAGES.has(target)) {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await updateButtonPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
      return true;
    }
  }

  if (target === 'social') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'fun', '娱乐互动');
    if (disabledMsg) {
      await updateButtonPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
      return true;
    }
  }

  if (target === 'solo') {
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    if (!cfg.modules.economy && !cfg.modules.fun) {
      await updateButtonPage(input, { page: 'home' }, {
        type: 'error',
        text: '当前服务器已关闭「经济系统」与「娱乐互动」模块，暂无法进入独立游玩页面。',
      });
      return true;
    }
  }

  if (target === 'multi') {
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    if (!cfg.modules.economy && !cfg.modules.fun && !cfg.modules.socialGames) {
      await updateButtonPage(input, { page: 'home' }, {
        type: 'error',
        text: '当前服务器已关闭「经济系统」「娱乐互动」与「整蛊与博弈」模块，暂无法进入多人博弈大厅。',
      });
      return true;
    }
  }

  const listPage = parsePositiveInt(parts[3] ?? '') ?? undefined;
  const viewMap: Record<string, MenuView> = {
    home: { page: 'home' },
    solo: { page: 'solo' },
    slots: { page: 'slots' },
    dice: { page: 'dice', choice: 'big' },
    bj: { page: 'bj' },
    bank: { page: 'bank' },
    multi: { page: 'multi' },
    rob: { page: 'rob' },
    pay: { page: 'pay' },
    duel: { page: 'duel' },
    shop: { page: 'shop', listPage },
    bag: { page: 'bag', listPage },
  };

  const view: MenuView =
    target === 'social'
      ? { page: 'social', action: parseSocialAction(parts[3]) }
      : (viewMap[target ?? 'home'] ?? { page: 'home' });

  await updateButtonPage(input, view);
  return true;
}

async function handleBagButton(input: MenuButtonContext): Promise<boolean> {
  if (input.parts[2] !== 'clear_title') return false;
  const disabledMsg = checkModuleDisabled(input.ctx, input.guildId, 'economy', '经济系统');
  if (disabledMsg) {
    await updateButtonPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
    return true;
  }
  input.ctx.services.fun.clearTitle(input.guildId, input.actor.id);
  await updateButtonPage(input, { page: 'bag' }, {
    type: 'success',
    text: '已卸下当前佩戴的专属称号。',
  });
  return true;
}

async function handleRankButton(input: MenuButtonContext): Promise<boolean> {
  const lbType = parseLeaderboardType(input.parts[2]);
  const lbPage = parsePositiveInt(input.parts[3] ?? '') ?? 1;
  const mod = LEADERBOARD_MODULE_MAP[lbType];
  const disabledMsg = checkModuleDisabled(input.ctx, input.guildId, mod.key, mod.name);
  if (disabledMsg) {
    await updateButtonPage(input, { page: 'home' }, { type: 'error', text: disabledMsg });
    return true;
  }
  await updateButtonPage(input, { page: 'leaderboard', lbType, lbPage });
  return true;
}

async function handleShareButton(input: MenuButtonContext): Promise<boolean> {
  const { interaction, ctx, guildId, actor, parts } = input;
  const shareTarget = parts[2];

  if (shareTarget === 'rank') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'leveling', '等级与热度');
    if (disabledMsg) {
      await updateButtonPage(input, { page: 'rank' }, { type: 'error', text: disabledMsg });
      return true;
    }
    await interaction.deferUpdate();
    const publicEmbed = buildPublicRankEmbed(ctx, guildId, actor);
    const sent = await sendPublicBroadcast(interaction, {
      content: `📢 <@${actor.id}> 晒出了个人等级名片：`,
      embeds: [publicEmbed],
    });
    const feedback: MenuFeedback = sent.sent
      ? { type: 'success', text: '已将你的等级名片晒出到当前频道！' }
      : { type: 'error', text: '无法在当前频道发送公开消息，请检查机器人发言权限。' };
    await safeEditOrFollowUp(interaction, buildMenuMessage(ctx, guildId, actor, { page: 'rank' }, feedback));
    return true;
  }

  if (shareTarget === 'lb') {
    const lbType = parseLeaderboardType(parts[3]);
    const lbPage = parsePositiveInt(parts[4] ?? '') ?? 1;
    const mod = LEADERBOARD_MODULE_MAP[lbType];
    const disabledMsg = checkModuleDisabled(ctx, guildId, mod.key, mod.name);
    if (disabledMsg) {
      await updateButtonPage(input, { page: 'leaderboard', lbType, lbPage }, {
        type: 'error',
        text: disabledMsg,
      });
      return true;
    }
    await interaction.deferUpdate();
    const fullCfg = ctx.repos.guildConfig.getOrCreate(guildId);
    const cfg = fullCfg.economy;
    const lbNameMap: Record<LeaderboardType, string> = {
      xp: '等级经验排行榜',
      coins: `${cfg.currencyName}富豪榜`,
      invites: '邀请贡献排行榜',
      stat: `${fullCfg.leveling.statName}排行榜`,
      credit: '信用分红榜',
      deadbeat: '失信老赖黑榜',
      hustle: '下海捞金榜',
      gambling_profit: '赌神盈利榜',
      gambling_loss: '慈善赌圣亏损榜',
      rpg: '奇幻RPG地牢榜',
    };
    const publicEmbed = buildPublicLeaderboardEmbed(ctx, guildId, lbType, lbPage);
    const sent = await sendPublicBroadcast(interaction, {
      content: `📢 <@${actor.id}> 晒出了服务器「${lbNameMap[lbType]}」：`,
      embeds: [publicEmbed],
    });
    const feedback: MenuFeedback = sent.sent
      ? { type: 'success', text: `已将${lbNameMap[lbType]}晒出到当前频道！` }
      : { type: 'error', text: '无法在当前频道发送公开消息，请检查机器人发言权限。' };
    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'leaderboard', lbType, lbPage }, feedback),
    );
    return true;
  }

  return false;
}

const SHOP_BAG_SOCIAL_RANK_ROUTES: ActionRouteTable<MenuButtonContext> = {
  exact: {
    nav: handleUserNavButton,
    bag: handleBagButton,
    rank: handleRankButton,
    share: handleShareButton,
  },
};

export async function tryHandleShopBagSocialRankButton(input: MenuButtonContext): Promise<boolean> {
  return dispatchByAction(input.parts[1], input, SHOP_BAG_SOCIAL_RANK_ROUTES);
}
