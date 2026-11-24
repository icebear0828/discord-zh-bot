import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type GuildMember,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import {
  DEFAULT_ECONOMY_CONFIG,
  DEFAULT_LEVELING_CONFIG,
  type ModuleKey,
} from '../config/defaults.js';
import {
  BANK_ROB_ATTACKER_MIN_ASSETS,
  BANK_ROB_TARGET_MIN,
  MAX_COIN_AMOUNT,
  MAX_SOLO_GAMBLE_BET,
  ROB_ATTACKER_MIN_ASSETS,
  ROB_TARGET_MIN_COINS,
} from '../config/economyConstants.js';
import { MonitorRepo } from '../db/repositories/monitorRepo.js';
import type { BlackjackActionResult, BlackjackGame } from '../services/blackjackService.js';
import type { DiceChoice } from '../services/economyService.js';
import type { InteractionAction } from '../services/funService.js';
import type { LeaderboardType } from '../services/levelingService.js';
import {
  COLORS,
  createErrorEmbed,
  createSuccessEmbed,
  formatDurationZh,
  type AppContext,
} from '../ui/embeds.js';
import {
  buildDuelMessage,
  buildLobbyMessage,
  buildMenuMessage,
  buildPublicLeaderboardEmbed,
  buildPublicRankEmbed,
  buildRedPacketMessage,
  truncateText,
} from '../ui/menuBuilder.js';
import {
  formatShopBuyError,
  type BuiltMenuMessage,
  type MenuActor,
  type MenuFeedback,
  type MenuView,
} from '../ui/menuShared.js';
import {
  buildBlackjackPublicReportEmbed,
  buildRobTargetHints,
  formatBankRobResultEmbed,
  formatPocketRobResultEmbed,
} from '../ui/soloFormatters.js';
import {
  tryHandleConfigMenuButton,
  tryHandleConfigMenuChannelSelect,
  tryHandleConfigMenuModal,
  tryHandleConfigMenuRoleSelect,
  tryHandleConfigMenuStringSelect,
} from './configMenuHandler.js';
import {
  tryHandleAiMenuButton,
  tryHandleAiMenuChannelSelect,
  tryHandleAiMenuModal,
  tryHandleAiMenuStringSelect,
} from './aiMenuHandler.js';
import {
  tryHandleGamesMenuButton,
  tryHandleGamesMenuModal,
  tryHandleGamesMenuStringSelect,
  tryHandleGamesMenuUserSelect,
} from './gamesMenuHandler.js';
import {
  ADMIN_DENIED_FEEDBACK,
  SUPER_ADMIN_DENIED_FEEDBACK,
  checkModuleDisabled,
  isGuildSuperAdmin,
  parseIntInRange,
  parseNumberInRange,
  parsePositiveInt,
  prefilledField,
  resolveActor,
  respondFromModal,
  safeEditOrFollowUp,
  sendPublicBroadcast,
} from './menuHelpers.js';

const VALID_SOCIAL_ACTIONS: ReadonlySet<string> = new Set([
  'pat',
  'hug',
  'cuddle',
  'poke',
  'feed',
  'snowball',
]);

const VALID_MODULE_KEYS: ReadonlySet<string> = new Set<ModuleKey>([
  'leveling',
  'economy',
  'fun',
  'welcome',
  'tickets',
  'giveaways',
  'invites',
  'rolePanels',
  'socialGames',
  'worldEvents',
  'petsAndCp',
  'ai',
  'creditLoan',
  'rpg',
]);

function parseDiceChoice(raw: string | undefined): DiceChoice {
  if (raw === 'small' || raw === 'triple') return raw;
  return 'big';
}

function parseSocialAction(raw: string | undefined): InteractionAction {
  if (raw && VALID_SOCIAL_ACTIONS.has(raw)) {
    return raw as InteractionAction;
  }
  return 'pat';
}

function parseLeaderboardType(raw: string | undefined): LeaderboardType {
  if (
    raw === 'coins' ||
    raw === 'invites' ||
    raw === 'stat' ||
    raw === 'credit' ||
    raw === 'deadbeat' ||
    raw === 'hustle' ||
    raw === 'gambling_profit' ||
    raw === 'gambling_loss' ||
    raw === 'rpg'
  ) {
    return raw;
  }
  return 'xp';
}

function buildAmountModal(
  customId: string,
  title: string,
  label: string,
  placeholder: string,
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel(truncateText(label, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setPlaceholder(placeholder)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(truncateText(title, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

function buildRedPacketModal(currencyName: string): ModalBuilder {
  const totalAmount = new TextInputBuilder()
    .setCustomId('totalAmount')
    .setLabel(truncateText(`红包总金额（1 ~ 1,000,000,000 ${currencyName}）`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setPlaceholder('例如：50000')
    .setRequired(true);

  const totalCount = new TextInputBuilder()
    .setCustomId('totalCount')
    .setLabel('红包份数（2 ~ 100 份）')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(4)
    .setPlaceholder('例如：5')
    .setRequired(true);

  const greeting = new TextInputBuilder()
    .setCustomId('greeting')
    .setLabel('红包祝福语（可选）')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(50)
    .setPlaceholder('恭喜发财，大吉大利！')
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId('menu:modal_sub:redpacket')
    .setTitle('🧧 发拼手气红包')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(totalAmount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(totalCount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(greeting),
    );
}

function buildAdminRedPacketModal(
  customId: string,
  title: string,
  minCount: number,
  currencyName: string,
): ModalBuilder {
  const totalAmount = new TextInputBuilder()
    .setCustomId('totalAmount')
    .setLabel(truncateText(`红包总金额（1 ~ 1,000,000,000 ${currencyName}）`, 45))
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(12)
    .setPlaceholder('例如：5000000')
    .setRequired(true);

  const totalCount = new TextInputBuilder()
    .setCustomId('totalCount')
    .setLabel(`红包份数（${minCount} ~ 100 份）`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(4)
    .setPlaceholder('例如：10')
    .setRequired(true);

  const greeting = new TextInputBuilder()
    .setCustomId('greeting')
    .setLabel('红包祝福语（可选）')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(50)
    .setPlaceholder('管理员天降大红包，见者有份！')
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(truncateText(title, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(totalAmount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(totalCount),
      new ActionRowBuilder<TextInputBuilder>().addComponents(greeting),
    );
}

async function deferModalForWrite(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
}

interface ActionWithHighlight {
  msg: BuiltMenuMessage;
  highlight?: MessageCreateOptions;
}

function buildBlackjackOutcomeFeedback(
  game: BlackjackGame,
  balance: number,
  currencyName: string,
): MenuFeedback {
  const net = game.payout - game.bet;
  switch (game.status) {
    case 'playing':
      return { type: 'info', text: '请选择你的操作：要牌、停牌或双倍下注（15 分钟未操作将自动退注）。' };
    case 'player_blackjack':
      return {
        type: 'success',
        text: `🎉 天胡 Blackjack！返还 **${game.payout}** ${currencyName}（净赚 **+${net}**），当前现金 **${balance}**。`,
      };
    case 'dealer_bust':
      return {
        type: 'success',
        text: `🎉 庄家爆牌！返还 **${game.payout}** ${currencyName}（净赚 **+${net}**），当前现金 **${balance}**。`,
      };
    case 'player_win':
      return {
        type: 'success',
        text: `🎉 你的点数更大！返还 **${game.payout}** ${currencyName}（净赚 **+${net}**），当前现金 **${balance}**。`,
      };
    case 'push':
      return {
        type: 'info',
        text: `🤝 双方平局！全额返还下注 **${game.payout}** ${currencyName}（净变动 **0**），当前现金 **${balance}**。`,
      };
    case 'player_bust':
      return {
        type: 'error',
        text: `💥 爆牌了（超过 21 点），庄家获胜（返还 **0**，净损 **${net}** ${currencyName}）。当前现金 **${balance}** ${currencyName}。`,
      };
    case 'dealer_win':
      return {
        type: 'error',
        text: `😔 庄家点数更大，本局失利（返还 **0**，净损 **${net}** ${currencyName}）。当前现金 **${balance}** ${currencyName}。`,
      };
  }
}

function runSlotsAction(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  bet: number,
): ActionWithHighlight {
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return {
      msg: buildMenuMessage(ctx, guildId, actor, { page: 'slots' }, { type: 'error', text: disabledMsg }),
    };
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.economy.playSlots(guildId, actor.id, bet);
  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      invalid_bet: '下注金额无效，请输入大于 0 的整数。',
      bet_too_large: `单局下注不能超过 **${MAX_SOLO_GAMBLE_BET.toLocaleString('en-US')}** ${cfg.currencyName}。`,
      insufficient_funds: `口袋现金不足，无法下注 **${bet}** ${cfg.currencyName}。`,
      deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与博弈！',
    };
    return {
      msg: buildMenuMessage(ctx, guildId, actor, { page: 'slots' }, { type: 'error', text: msgMap[res.reason] }),
    };
  }

  const reelDisplay = `【 ${res.reels.join('  |  ')} 】`;
  const netStr = res.netChange >= 0 ? `+${res.netChange}` : String(res.netChange);
  const feedback: MenuFeedback = {
    type: res.netChange > 0 ? 'success' : res.netChange === 0 ? 'info' : 'error',
    text: `${reelDisplay}\n倍率：**${res.multiplier}x** ｜ 返还：**${res.payout}** ${cfg.currencyName} ｜ 净变动：**${netStr}** ｜ 现金：**${res.balance}**`,
  };
  const highlight: MessageCreateOptions | undefined =
    res.multiplier >= 4
      ? {
          content: `🎰 欧皇降临！<@${actor.id}> 在老虎机转出 ${reelDisplay}（${res.multiplier}x），狂赚 **+${res.netChange}** ${cfg.currencyName}！`,
          embeds: [
            createSuccessEmbed(
              '🎰 频道喜报：老虎机爆大奖！',
              `<@${actor.id}> 拉出 ${reelDisplay}（**${res.multiplier}x**），返还 ${cfg.currencyEmoji} **${res.payout}** ${cfg.currencyName}（净赚 **+${res.netChange}**）！`,
            ),
          ],
        }
      : undefined;

  return {
    msg: buildMenuMessage(ctx, guildId, actor, { page: 'slots' }, feedback),
    highlight,
  };
}

function runDiceAction(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  choice: DiceChoice,
  bet: number,
): ActionWithHighlight {
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return {
      msg: buildMenuMessage(ctx, guildId, actor, { page: 'dice', choice }, { type: 'error', text: disabledMsg }),
    };
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res = ctx.services.economy.playDice(guildId, actor.id, bet, choice);
  if (!res.ok) {
    const msgMap: Record<typeof res.reason, string> = {
      invalid_bet: '下注金额无效，请输入大于 0 的整数。',
      bet_too_large: `单局下注不能超过 **${MAX_SOLO_GAMBLE_BET.toLocaleString('en-US')}** ${cfg.currencyName}。`,
      insufficient_funds: `口袋现金不足，无法下注 **${bet}** ${cfg.currencyName}。`,
      deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与博弈！',
    };
    return {
      msg: buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'dice', choice },
        { type: 'error', text: msgMap[res.reason] },
      ),
    };
  }

  const diceText = res.dice.map((d) => `🎲 **${d}**`).join(' ');
  const outcome = res.isTriple
    ? `豹子（${res.sum} 点）`
    : `${res.sum} 点（${res.sum >= 11 ? '大' : '小'}）`;
  const netStr = res.netChange >= 0 ? `+${res.netChange}` : String(res.netChange);
  const feedback: MenuFeedback = {
    type: res.won ? 'success' : 'error',
    text: `开骰：${diceText} → **${outcome}**\n${res.won ? '中奖！' : '未中奖，'}净变动：**${netStr}** ${cfg.currencyName} ｜ 现金：**${res.balance}**`,
  };
  const highlight: MessageCreateOptions | undefined =
    res.won && res.isTriple
      ? {
          content: `🎲 欧皇降临！<@${actor.id}> 在猜大小押中豹子（10x），狂赚 **+${res.netChange}** ${cfg.currencyName}！`,
          embeds: [
            createSuccessEmbed(
              '🎲 频道喜报：豹子通杀！',
              `<@${actor.id}> 掷出 ${diceText}（**${outcome}**），一举赢走 ${cfg.currencyEmoji} **+${res.netChange}** ${cfg.currencyName}！`,
            ),
          ],
        }
      : undefined;

  return {
    msg: buildMenuMessage(ctx, guildId, actor, { page: 'dice', choice }, feedback),
    highlight,
  };
}

function buildBlackjackResponse(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  res: BlackjackActionResult,
): ActionWithHighlight {
  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  if (!res.ok) {
    const msgMap: Record<string, string> = {
      invalid_bet: '下注金额无效，请输入大于 0 的整数。',
      bet_too_large: `单局下注不能超过 **${MAX_SOLO_GAMBLE_BET.toLocaleString('en-US')}** ${cfg.currencyName}。`,
      insufficient_funds: '口袋现金不足！',
      game_already_active: '你还有一局未结束的二十一点，请先完成当前对局。',
      no_active_game: '当前没有进行中的牌局，请先下注开局。',
      cannot_double: '只能在首轮两张牌时双倍下注。',
      deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与博弈！',
    };
    return {
      msg: buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'bj' },
        { type: 'error', text: msgMap[res.reason] ?? '当前牌局操作失败，请重试。' },
      ),
    };
  }

  const feedback = buildBlackjackOutcomeFeedback(res.game, res.balance, cfg.currencyName);
  const view: MenuView =
    res.game.status === 'playing'
      ? { page: 'bj' }
      : { page: 'bj', finishedGame: res.game, balanceAfterFinish: res.balance };

  const highlight: MessageCreateOptions | undefined =
    res.game.status !== 'playing'
      ? {
          embeds: [
            buildBlackjackPublicReportEmbed({
              playerId: actor.id,
              playerDisplayName: actor.displayName,
              playerAvatarUrl: actor.avatarUrl,
              game: res.game,
              cfg,
            }),
          ],
        }
      : undefined;

  return {
    msg: buildMenuMessage(ctx, guildId, actor, view, feedback),
    highlight,
  };
}

function runBankTransferAction(
  ctx: AppContext,
  guildId: string,
  actor: MenuActor,
  direction: 'deposit' | 'withdraw',
  amount: number,
): BuiltMenuMessage {
  const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
  if (disabledMsg) {
    return buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text: disabledMsg });
  }

  const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
  const res =
    direction === 'deposit'
      ? ctx.services.economy.deposit(guildId, actor.id, amount)
      : ctx.services.economy.withdraw(guildId, actor.id, amount);

  if (!res.ok) {
    const text =
      res.reason === 'insufficient_funds'
        ? direction === 'deposit'
          ? '口袋现金余额不足，无法存入该金额。'
          : '银行存款余额不足，无法取出该金额。'
        : '请输入有效的正整数金额。';
    return buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text });
  }

  const verb = direction === 'deposit' ? '存入银行' : '从银行取出';
  return buildMenuMessage(
    ctx,
    guildId,
    actor,
    { page: 'bank' },
    {
      type: 'success',
      text: `已成功${verb} ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！（现金 **${res.coins}** ｜ 银行 **${res.bankCoins}**）`,
    },
  );
}

export async function handleMenuButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  const section = parts[1];

  if (section === 'open') {
    await interaction.reply({
      ...buildMenuMessage(ctx, guildId, actor, { page: 'home' }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (await tryHandleGamesMenuButton(interaction, ctx, guildId, actor, parts)) {
    return;
  }

  if (await tryHandleConfigMenuButton(interaction, ctx, guildId, actor, parts)) {
    return;
  }

  if (await tryHandleAiMenuButton(interaction, ctx, guildId, actor, parts)) {
    return;
  }

  if (section === 'nav') {
    const target = parts[2];
    if (
      target === 'admin' ||
      target === 'admin_econ' ||
      target === 'admin_lvl' ||
      target === 'admin_mod' ||
      target === 'admin_ops' ||
      target === 'admin_credit_rpg' ||
      target === 'admin_monitor'
    ) {
      if (!actor.isAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
        );
        return;
      }
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: target }));
      return;
    }

    if (target === 'credit' || target === 'loan' || target === 'hustle') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'creditLoan', '信用与借贷');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: target }));
      return;
    }

    if (target === 'rpg') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'rpg', '奇幻RPG地牢');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'rpg' }));
      return;
    }

    if (target === 'rank') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'leveling', '等级与热度');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'rank' }));
      return;
    }

    const econPages = new Set(['slots', 'dice', 'bj', 'bank', 'rob', 'pay', 'duel', 'shop', 'bag']);
    if (target && econPages.has(target)) {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
    }

    if (target === 'social') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'fun', '娱乐互动');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
    }

    if (target === 'solo') {
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      if (!cfg.modules.economy && !cfg.modules.fun) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'home' },
            {
              type: 'error',
              text: '当前服务器已关闭「经济系统」与「娱乐互动」模块，暂无法进入独立游玩页面。',
            },
          ),
        );
        return;
      }
    }

    if (target === 'multi') {
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      if (!cfg.modules.economy && !cfg.modules.fun && !cfg.modules.socialGames) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'home' },
            {
              type: 'error',
              text: '当前服务器已关闭「经济系统」「娱乐互动」与「整蛊与博弈」模块，暂无法进入多人博弈大厅。',
            },
          ),
        );
        return;
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

    await interaction.update(buildMenuMessage(ctx, guildId, actor, view));
    return;
  }

  if (section === 'act') {
    const action = parts[2];
    const sourcePage: 'home' | 'solo' = parts[3] === 'solo' ? 'solo' : 'home';
    const view: MenuView = { page: sourcePage };

    if (action === 'daily') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, view, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.economy.claimDaily(guildId, actor.id);
      const feedback: MenuFeedback = res.ok
        ? {
            type: 'success',
            text: `每日签到成功！获得 ${cfg.currencyEmoji} **+${res.reward}** ${cfg.currencyName}${res.bonus > 0 ? `（含连签加成 +${res.bonus}）` : ''}，已连签 **${res.streak}** 天！`,
          }
        : {
            type: 'error',
            text: `今天已经签过到啦（已连签 **${res.streak}** 天），请明天再来！`,
          };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, view, feedback));
      return;
    }

    if (action === 'work') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, view, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.economy.work(guildId, actor.id);
      const feedback: MenuFeedback = res.ok
        ? {
            type: 'success',
            text: `你${res.story}，赚取了 ${cfg.currencyEmoji} **+${res.reward}** ${cfg.currencyName}！${res.cursed ? '\n🧿 *（你中了衰神符诅咒，本次打工收益已减半！）*' : ''}`,
          }
        : {
            type: 'error',
            text: `打工冷却中，还需等待 **${formatDurationZh(res.retryAfterSec * 1000)}**。`,
          };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, view, feedback));
      return;
    }

    if (action === 'fortune') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'fun', '娱乐互动');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, view, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.fun.drawDailyFortune(guildId, actor.id);
      const feedback: MenuFeedback = {
        type: res.alreadyDrawn ? 'info' : 'success',
        text: [
          `🎋 今日运势：**【${res.record.luckTier}】**${res.alreadyDrawn ? '（今日已抽签）' : ` · 首抽获赠 ${cfg.currencyEmoji} **+${res.record.bonusCoins}** ${cfg.currencyName}！`}`,
          `🟢 宜：${res.record.goodFor} ｜ 🔴 忌：${res.record.avoid} ｜ 🔢 幸运数字：**${res.record.luckyNumber}**`,
        ].join('\n'),
      };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, view, feedback));
      if (!res.alreadyDrawn && res.record.luckTier === '大吉') {
        await sendPublicBroadcast(interaction, {
          content: `🎋 欧皇抽签！<@${actor.id}> 今日抽到【大吉】，获赠 **+${res.record.bonusCoins}** ${cfg.currencyName}！`,
          embeds: [
            createSuccessEmbed(
              '🎋 频道喜报：今日运势【大吉】！',
              `<@${actor.id}> 抽中上上签【大吉】，获得 ${cfg.currencyEmoji} **+${res.record.bonusCoins}** ${cfg.currencyName}，幸运数字 **${res.record.luckyNumber}**！`,
            ),
          ],
        });
      }
      return;
    }
  }

  if (section === 'slots') {
    const bet = parsePositiveInt(parts[2] ?? '') ?? 0;
    const out = runSlotsAction(ctx, guildId, actor, bet);
    await interaction.update(out.msg);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    return;
  }

  if (section === 'dice_pick') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    const choice = parseDiceChoice(parts[2]);
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'dice', choice }));
    return;
  }

  if (section === 'dice_bet') {
    const choice = parseDiceChoice(parts[2]);
    const bet = parsePositiveInt(parts[3] ?? '') ?? 0;
    const out = runDiceAction(ctx, guildId, actor, choice, bet);
    await interaction.update(out.msg);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    return;
  }

  if (section === 'bj_start') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'bj' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    const bet = parsePositiveInt(parts[2] ?? '') ?? 0;
    const res = ctx.services.blackjack.startGame(guildId, actor.id, bet);
    const out = buildBlackjackResponse(ctx, guildId, actor, res);
    await interaction.update(out.msg);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    return;
  }

  if (section === 'bj') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'bj' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    const action = parts[2];
    const res =
      action === 'hit'
        ? ctx.services.blackjack.hit(guildId, actor.id)
        : action === 'double'
          ? ctx.services.blackjack.doubleDown(guildId, actor.id)
          : ctx.services.blackjack.stand(guildId, actor.id);
    const out = buildBlackjackResponse(ctx, guildId, actor, res);
    await interaction.update(out.msg);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    return;
  }

  if (section === 'bank') {
    const sub = parts[2];
    if (sub === 'interest') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const res = ctx.services.economy.claimBankInterest(guildId, actor.id);
      const feedback: MenuFeedback = res.ok
        ? {
            type: 'success',
            text: `成功领取今日银行利息 ${cfg.currencyEmoji} **+${res.interest}** ${cfg.currencyName}！当前银行存款：**${res.bankCoins}**。`,
          }
        : res.reason === 'already_claimed'
          ? { type: 'error', text: '你今天已经领过银行利息啦，请明天再来！' }
          : {
              type: 'error',
              text: `银行存款需至少达到 **${res.minDeposit ?? cfg.bankInterestMinDeposit}** ${cfg.currencyName} 才可领取每日利息。`,
            };
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, feedback));
      return;
    }

    if (sub === 'dep' || sub === 'wd') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
      const source = sub === 'dep' ? profile.coins : profile.bankCoins;
      const mode = parts[3];
      const amount =
        mode === 'all'
          ? source
          : mode === '50'
            ? Math.floor(source * 0.5)
            : Math.floor(source * 0.25);

      if (amount < 1) {
        const text =
          sub === 'dep'
            ? `口袋现金不足，按比例计算不足 1 ${cfg.currencyName}，无法存入。`
            : `银行存款不足，按比例计算不足 1 ${cfg.currencyName}，无法取出。`;
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text }),
        );
        return;
      }

      await interaction.update(
        runBankTransferAction(ctx, guildId, actor, sub === 'dep' ? 'deposit' : 'withdraw', amount),
      );
      return;
    }
  }

  if (section === 'bag' && parts[2] === 'clear_title') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    ctx.services.fun.clearTitle(guildId, actor.id);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'bag' },
        { type: 'success', text: '已卸下当前佩戴的专属称号。' },
      ),
    );
    return;
  }

  if (section === 'rank') {
    const lbType = parseLeaderboardType(parts[2]);
    const lbPage = parsePositiveInt(parts[3] ?? '') ?? 1;

    const moduleMap: Record<LeaderboardType, { key: ModuleKey; name: string }> = {
      xp: { key: 'leveling', name: '等级与热度' },
      coins: { key: 'economy', name: '经济系统' },
      invites: { key: 'invites', name: '邀请追踪' },
      stat: { key: 'leveling', name: '等级与热度' },
      credit: { key: 'creditLoan', name: '征信与借贷' },
      deadbeat: { key: 'creditLoan', name: '征信与借贷' },
      hustle: { key: 'creditLoan', name: '征信与借贷' },
      gambling_profit: { key: 'creditLoan', name: '征信与借贷' },
      gambling_loss: { key: 'creditLoan', name: '征信与借贷' },
      rpg: { key: 'rpg', name: '奇幻RPG地牢' },
    };
    const mod = moduleMap[lbType];
    const disabledMsg = checkModuleDisabled(ctx, guildId, mod.key, mod.name);
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'home' },
          { type: 'error', text: disabledMsg },
        ),
      );
      return;
    }

    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'leaderboard', lbType, lbPage }),
    );
    return;
  }

  if (section === 'share') {
    const shareTarget = parts[2];
    if (shareTarget === 'rank') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'leveling', '等级与热度');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'rank' }, { type: 'error', text: disabledMsg }),
        );
        return;
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
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'rank' }, feedback),
      );
      return;
    }

    if (shareTarget === 'lb') {
      const lbType = parseLeaderboardType(parts[3]);
      const lbPage = parsePositiveInt(parts[4] ?? '') ?? 1;
      const moduleMap: Record<LeaderboardType, { key: ModuleKey; name: string }> = {
        xp: { key: 'leveling', name: '等级与热度' },
        coins: { key: 'economy', name: '经济系统' },
        invites: { key: 'invites', name: '邀请追踪' },
        stat: { key: 'leveling', name: '等级与热度' },
        credit: { key: 'creditLoan', name: '征信与借贷' },
        deadbeat: { key: 'creditLoan', name: '征信与借贷' },
        hustle: { key: 'creditLoan', name: '征信与借贷' },
        gambling_profit: { key: 'creditLoan', name: '征信与借贷' },
        gambling_loss: { key: 'creditLoan', name: '征信与借贷' },
        rpg: { key: 'rpg', name: '奇幻RPG地牢' },
      };
      const mod = moduleMap[lbType];
      const disabledMsg = checkModuleDisabled(ctx, guildId, mod.key, mod.name);
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'leaderboard', lbType, lbPage },
            { type: 'error', text: disabledMsg },
          ),
        );
        return;
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
      return;
    }
  }

  if (section === 'admin') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return;
    }

    const adminAction = parts[2];
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    const superAdmin = Boolean(actor.isSuperAdmin || isGuildSuperAdmin(interaction, ctx, guildId));

    if (adminAction === 'send_lobby') {
      await interaction.deferUpdate();
      const sent = await sendPublicBroadcast(
        interaction,
        buildLobbyMessage(interaction.guild?.name),
      );
      const feedback: MenuFeedback = sent.sent
        ? { type: 'success', text: '✅ 已在当前频道发送永久「打开我的互动菜单」大厅卡片！' }
        : { type: 'error', text: '无法在当前频道发送大厅消息，请检查机器人发言与嵌入链接权限。' };
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'admin' }, feedback),
      );
      return;
    }

    if (adminAction === 'reset_econ') {
      if (!superAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'admin_econ' }, SUPER_ADMIN_DENIED_FEEDBACK),
        );
        return;
      }
      if (parts[3] !== 'confirm') {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_econ', confirmReset: true },
            {
              type: 'info',
              text: '⚠️ 确认将签到、打工、抢钱与银行利息参数恢复为默认值？（自定义货币名称与图标将被保留）',
            },
          ),
        );
        return;
      }
      ctx.repos.guildConfig.updateEconomy(guildId, {
        ...DEFAULT_ECONOMY_CONFIG,
        currencyName: cfg.economy.currencyName,
        currencyEmoji: cfg.economy.currencyEmoji,
      });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_econ' },
          {
            type: 'success',
            text: `♻️ 已将签到、打工、抢钱与银行利息参数恢复默认值（保留货币 **${cfg.economy.currencyName}** ${cfg.economy.currencyEmoji}）。`,
          },
        ),
      );
      return;
    }

    if (adminAction === 'reset_lvl') {
      if (!superAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'admin_lvl' }, SUPER_ADMIN_DENIED_FEEDBACK),
        );
        return;
      }
      if (parts[3] !== 'confirm') {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_lvl', confirmReset: true },
            {
              type: 'info',
              text: '⚠️ 确认将等级经验、热度连击、语音与升级奖励参数恢复为默认值？（频道配置将被保留）',
            },
          ),
        );
        return;
      }
      ctx.repos.guildConfig.updateLeveling(guildId, {
        ...DEFAULT_LEVELING_CONFIG,
        announceChannelId: cfg.leveling.announceChannelId,
        allowedChannelIds: cfg.leveling.allowedChannelIds,
        ignoredChannelIds: cfg.leveling.ignoredChannelIds,
        channelMultipliers: cfg.leveling.channelMultipliers,
      });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl' },
          { type: 'success', text: '♻️ 已将等级经验、热度连击、语音与升级奖励参数恢复默认值（保留频道配置）。' },
        ),
      );
      return;
    }

    if (adminAction === 'toggle_voice') {
      const next = !cfg.leveling.voiceEnabled;
      ctx.repos.guildConfig.updateLeveling(guildId, { ...cfg.leveling, voiceEnabled: next });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl' },
          { type: 'success', text: `已将语音挂机经验设为：**${next ? '开启' : '关闭'}**。` },
        ),
      );
      return;
    }

    if (adminAction === 'toggle_announce') {
      const next = !cfg.leveling.announceEnabled;
      ctx.repos.guildConfig.updateLeveling(guildId, { ...cfg.leveling, announceEnabled: next });
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl' },
          { type: 'success', text: `已将升级公告播报设为：**${next ? '开启' : '关闭'}**。` },
        ),
      );
      return;
    }
  }

  if (section === 'admin_monitor') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return;
    }
    const subAction = parts[2];
    const monitorRepo = ctx.repos.monitor ?? new MonitorRepo(ctx.db);
    if (subAction === 'filter' || subAction === 'refresh') {
      const filter: 'issues' | 'all' = parts[3] === 'all' ? 'all' : 'issues';
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'admin_monitor', filter }),
      );
      return;
    }
    if (subAction === 'clear') {
      const superAdmin = Boolean(actor.isSuperAdmin || isGuildSuperAdmin(interaction, ctx, guildId));
      if (!superAdmin) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_monitor', filter: 'issues' },
            SUPER_ADMIN_DENIED_FEEDBACK,
          ),
        );
        return;
      }
      if (parts[3] !== 'confirm') {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_monitor', filter: 'issues', confirmClear: true },
            {
              type: 'info',
              text: '⚠️ 确认清空本服务器全部交互监控日志？此操作不可撤销。',
            },
          ),
        );
        return;
      }
      const deleted = monitorRepo.clearGuildLogs(guildId);
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_monitor', filter: 'issues' },
          { type: 'success', text: `🧹 已清理本服务器 **${deleted}** 条历史交互监控日志。` },
        ),
      );
      return;
    }
  }

  if (section === 'modal') {
    const modalType = parts[2];
    if (modalType?.startsWith('admin_')) {
      if (!actor.isAdmin) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
        );
        return;
      }

      const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
      const currencyName = cfg.economy.currencyName;
      const superAdmin = Boolean(actor.isSuperAdmin || isGuildSuperAdmin(interaction, ctx, guildId));

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
        return;
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
        return;
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
        return;
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
        return;
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
        return;
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
              prefilledField(
                'levelUpCoinReward',
                `每次升级奖励${currencyName}（0 ~ 100000）`,
                cfg.leveling.levelUpCoinReward,
              ),
            ),
        );
        return;
      }

      if (modalType === 'admin_grant_all') {
        if (!superAdmin) {
          await interaction.update(
            buildMenuMessage(ctx, guildId, actor, { page: 'admin_ops' }, SUPER_ADMIN_DENIED_FEEDBACK),
          );
          return;
        }
        await interaction.showModal(
          buildAmountModal(
            'menu:modal_sub:admin_grant_all',
            `🎉 全服全员发放${currencyName}`,
            '每位真实群友发放数量（1 ~ 1000000000）',
            '例如：1000000',
          ),
        );
        return;
      }

      if (modalType === 'admin_random_redpacket') {
        if (!superAdmin) {
          await interaction.update(
            buildMenuMessage(ctx, guildId, actor, { page: 'admin_ops' }, SUPER_ADMIN_DENIED_FEEDBACK),
          );
          return;
        }
        await interaction.showModal(
          buildAdminRedPacketModal(
            'menu:modal_sub:admin_random_redpacket',
            '🎲 管理员随机派发红包',
            1,
            currencyName,
          ),
        );
        return;
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
        return;
      }
    }

    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      const fallbackView: MenuView =
        modalType === 'slots'
          ? { page: 'slots' }
          : modalType === 'dice'
            ? { page: 'dice', choice: parseDiceChoice(parts[3]) }
            : modalType === 'bj'
              ? { page: 'bj' }
              : modalType === 'bank_dep' || modalType === 'bank_wd'
                ? { page: 'bank' }
                : { page: 'multi' };
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, fallbackView, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    if (modalType === 'slots') {
      await interaction.showModal(
        buildAmountModal('menu:modal_sub:slots', '🎰 老虎机自定义下注', '下注金额（正整数）', '例如：200'),
      );
      return;
    }
    if (modalType === 'dice') {
      const choice = parseDiceChoice(parts[3]);
      await interaction.showModal(
        buildAmountModal(
          `menu:modal_sub:dice:${choice}`,
          '🎲 猜大小自定义下注',
          '下注金额（正整数）',
          '例如：200',
        ),
      );
      return;
    }
    if (modalType === 'bj') {
      await interaction.showModal(
        buildAmountModal('menu:modal_sub:bj', '🃏 二十一点自定义下注', '下注金额（正整数）', '例如：200'),
      );
      return;
    }
    if (modalType === 'bank_dep') {
      await interaction.showModal(
        buildAmountModal('menu:modal_sub:bank_dep', '📥 自定义存入银行', '存入金额（正整数）', '例如：500'),
      );
      return;
    }
    if (modalType === 'bank_wd') {
      await interaction.showModal(
        buildAmountModal('menu:modal_sub:bank_wd', '📤 自定义从银行取出', '取出金额（正整数）', '例如：500'),
      );
      return;
    }
    if (modalType === 'redpacket') {
      if (!interaction.channel?.isSendable()) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'multi' },
            { type: 'error', text: '当前频道不支持发送公开红包消息，请在普通文字频道中重试。' },
          ),
        );
        return;
      }
      const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
      await interaction.showModal(buildRedPacketModal(cfg.currencyName));
    }
  }
}

export async function handleMenuStringSelect(
  interaction: StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  const section = parts[1];
  const selected = interaction.values[0];

  if (await tryHandleGamesMenuStringSelect(interaction, ctx, guildId, actor, parts)) {
    return;
  }

  if (await tryHandleConfigMenuStringSelect(interaction, ctx, guildId, actor, parts)) {
    return;
  }

  if (await tryHandleAiMenuStringSelect(interaction, ctx, guildId, actor, parts)) {
    return;
  }

  if (section === 'lb_select') {
    if (!selected) return;
    if (selected === 'cp_lb') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'petsAndCp', '关系与宠物');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'cp_lb', lbPage: 1 }));
      return;
    }
    if (selected === 'bounty') {
      const disabledMsg = checkModuleDisabled(ctx, guildId, 'socialGames', '整蛊与博弈');
      if (disabledMsg) {
        await interaction.update(
          buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
        );
        return;
      }
      await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'bounty' }));
      return;
    }
    const lbType = parseLeaderboardType(selected);
    const moduleMap: Record<LeaderboardType, { key: ModuleKey; name: string }> = {
      xp: { key: 'leveling', name: '等级与热度' },
      coins: { key: 'economy', name: '经济系统' },
      invites: { key: 'invites', name: '邀请追踪' },
      stat: { key: 'leveling', name: '等级与热度' },
      credit: { key: 'creditLoan', name: '征信与借贷' },
      deadbeat: { key: 'creditLoan', name: '征信与借贷' },
      hustle: { key: 'creditLoan', name: '征信与借贷' },
      gambling_profit: { key: 'creditLoan', name: '征信与借贷' },
      gambling_loss: { key: 'creditLoan', name: '征信与借贷' },
      rpg: { key: 'rpg', name: '奇幻RPG地牢' },
    };
    const mod = moduleMap[lbType];
    const disabledMsg = checkModuleDisabled(ctx, guildId, mod.key, mod.name);
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'leaderboard', lbType, lbPage: 1 }),
    );
    return;
  }

  if (section === 'admin_toggle_mod') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return;
    }
    if (!selected || !VALID_MODULE_KEYS.has(selected)) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_mod' },
          { type: 'error', text: '无效的功能模块标识。' },
        ),
      );
      return;
    }
    const modKey = selected as ModuleKey;
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    const next = !cfg.modules[modKey];
    ctx.repos.guildConfig.updateModules(guildId, { ...cfg.modules, [modKey]: next });
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_mod' },
        { type: 'success', text: `已将模块 **${modKey}** 切换为：**${next ? '开启' : '关闭'}**。` },
      ),
    );
    return;
  }

  if (section === 'social_act') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'fun', '娱乐互动');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    const action = parseSocialAction(selected);
    await interaction.update(buildMenuMessage(ctx, guildId, actor, { page: 'social', action }));
    return;
  }

  if (section === 'shop_buy') {
    const listPage = parsePositiveInt(parts[2] ?? '') ?? 1;
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'shop', listPage },
          { type: 'error', text: disabledMsg },
        ),
      );
      return;
    }

    const itemId = parsePositiveInt(selected ?? '');
    if (!itemId) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'shop', listPage },
          { type: 'error', text: '无效的商品编号。' },
        ),
      );
      return;
    }

    const guildCfg = ctx.repos.guildConfig.getOrCreate(guildId);
    const cfg = guildCfg.economy;
    const lvlCfg = guildCfg.leveling;
    const item = ctx.repos.shop.getItemById(guildId, itemId);

    if (item?.type === 'custom_title') {
      if (item.stock !== null && item.stock <= 0) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'shop', listPage },
            { type: 'error', text: formatShopBuyError('out_of_stock', cfg.currencyName) },
          ),
        );
        return;
      }
      const profile = ctx.repos.profile.getOrCreate(guildId, actor.id);
      if (profile.coins < item.price) {
        await interaction.update(
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'shop', listPage },
            { type: 'error', text: formatShopBuyError('insufficient_funds', cfg.currencyName) },
          ),
        );
        return;
      }
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`menu:modal_sub:shop_custom_title:${item.id}`)
          .setTitle('✍️ 兑换自定义专属称号')
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('titleText')
                .setLabel('输入你的专属称号（1 ~ 20 字）')
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(20)
                .setPlaceholder('例如：全服第一大冤种')
                .setRequired(true),
            ),
          ),
      );
      return;
    }

    const ownedRoleIds = actor.roleIds ? new Set(actor.roleIds) : undefined;
    const res = ctx.services.shop.buyItem(
      guildId,
      actor.id,
      itemId,
      Date.now(),
      Math.random,
      ownedRoleIds,
    );
    if (!res.ok) {
      const errMsg = buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'shop', listPage },
        { type: 'error', text: formatShopBuyError(res.reason, cfg.currencyName, res.dailyLimit) },
      );
      await interaction.update(errMsg);
      return;
    }

    const isRoleItem = Boolean(res.grantRoleId);
    if (isRoleItem) {
      await interaction.deferUpdate();
    }

    if (res.grantRoleId) {
      let member: GuildMember | null = null;
      if (interaction.inCachedGuild()) {
        member = interaction.member;
      } else if (interaction.guild) {
        member = await interaction.guild.members.fetch(actor.id).catch(() => null);
      }

      if (!member) {
        ctx.services.shop.refundRolePurchase(
          guildId,
          actor.id,
          res.item.id,
          res.finalPrice ?? res.item.price,
        );
        await safeEditOrFollowUp(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'shop', listPage },
            { type: 'error', text: '无法获取成员身份信息，已自动全额退款。' },
          ),
        );
        return;
      }

      if (member.roles.cache.has(res.grantRoleId)) {
        ctx.services.shop.refundRolePurchase(
          guildId,
          actor.id,
          res.item.id,
          res.finalPrice ?? res.item.price,
        );
        await safeEditOrFollowUp(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'shop', listPage },
            { type: 'error', text: formatShopBuyError('already_owned', cfg.currencyName) },
          ),
        );
        return;
      }

      try {
        await member.roles.add(res.grantRoleId, `购买商店商品 #${res.item.id}`);
      } catch {
        ctx.services.shop.refundRolePurchase(
          guildId,
          actor.id,
          res.item.id,
          res.finalPrice ?? res.item.price,
        );
        await safeEditOrFollowUp(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'shop', listPage },
            {
              type: 'error',
              text: `身份组发放失败（机器人权限不足或身份组层级过低），已自动全额退还${cfg.currencyName}与库存。`,
            },
          ),
        );
        return;
      }
    }

    let detail: string;
    let highlightBroadcast: MessageCreateOptions | undefined;
    if (res.grantRoleId) {
      detail = `已自动发放身份组 <@&${res.grantRoleId}>。`;
    } else if (res.equippedTitle) {
      detail = `已解锁并自动佩戴称号 **「${res.equippedTitle}」**！`;
    } else if (res.statBoostResult) {
      const s = res.statBoostResult;
      const header =
        s.outcome === 'crit'
          ? `💥 **触发双倍暴击！** ${lvlCfg.statName} **+${s.delta}** ${lvlCfg.statUnit}`
          : s.outcome === 'backfire'
            ? `😵 **轻微反噬！** ${lvlCfg.statName} **${s.delta >= 0 ? `+${s.delta}` : s.delta}** ${lvlCfg.statUnit}`
            : `✨ **效果生效！** ${lvlCfg.statName} **+${s.delta}** ${lvlCfg.statUnit}`;
      detail = `${header}（当前 **${s.newStatValue}** ${lvlCfg.statUnit}，今日剩余 **${s.dailyLimit - s.usedToday}/${s.dailyLimit}** 次）`;
      if (s.outcome === 'crit') {
        highlightBroadcast = {
          embeds: [
            createSuccessEmbed(
              '💥 商店道具大暴击！',
              `**${actor.displayName}** 使用了【**${res.item.name}**】触发 **2x 暴击**，${lvlCfg.statName}暴增 **+${s.delta}** ${lvlCfg.statUnit}（现已达 **${s.newStatValue}** ${lvlCfg.statUnit}）！`,
            ),
          ],
        };
      }
    } else if (res.petXpResult) {
      const p = res.petXpResult;
      detail = `🐾 出战宠物 **${p.petName}** 获得 **+${p.xpGained} XP**${p.levelsGained > 0 ? `，升级至 **Lv.${p.newLevel}**（连升 ${p.levelsGained} 级）！` : '！'}`;
    } else if (res.mysteryBoxResult) {
      detail = `🎁 **盲盒开启**：${res.mysteryBoxResult.summary}`;
      if (res.mysteryBoxResult.isJackpot) {
        highlightBroadcast = {
          embeds: [
            createSuccessEmbed(
              '🎁 神秘盲盒欧皇降临！',
              `**${actor.displayName}** 开启【**${res.item.name}**】开出大奖！\n${res.mysteryBoxResult.summary}`,
            ),
          ],
        };
      }
    } else {
      detail = '道具已放入你的背包，随时可切换到「🎒 背包与称号」激活使用！';
    }

    const okMsg = buildMenuMessage(
      ctx,
      guildId,
      actor,
      { page: 'shop', listPage },
      {
        type: 'success',
        text: `购买成功：**${res.item.name}**（花费 ${cfg.currencyEmoji} ${res.item.price}）\n${detail}\n剩余现金：**${res.balance}**。`,
      },
    );
    if (isRoleItem) {
      await safeEditOrFollowUp(interaction, okMsg);
    } else {
      await interaction.update(okMsg);
    }
    if (highlightBroadcast) {
      await sendPublicBroadcast(interaction, highlightBroadcast);
    }
    return;
  }

  if (section === 'bag_use') {
    const listPage = parsePositiveInt(parts[2] ?? '') ?? 1;
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'bag', listPage },
          { type: 'error', text: disabledMsg },
        ),
      );
      return;
    }

    const invId = parsePositiveInt(selected ?? '');
    if (!invId) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'bag', listPage },
          { type: 'error', text: '无效的背包道具编号。' },
        ),
      );
      return;
    }

    const existingInv = ctx.repos.shop.getInventoryItem(guildId, actor.id, invId);
    if (existingInv?.itemType === 'custom_title' && existingInv.quantity > 0) {
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`menu:modal_sub:bag_custom_title:${existingInv.id}`)
          .setTitle('✍️ 兑换自定义专属称号')
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId('titleText')
                .setLabel('输入你的专属称号（1 ~ 20 字）')
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(20)
                .setPlaceholder('例如：全服第一大冤种')
                .setRequired(true),
            ),
          ),
      );
      return;
    }

    const res = ctx.services.shop.useInventoryItem(guildId, actor.id, invId);
    if (!res.ok) {
      const errMap: Record<string, string> = {
        not_found: '未找到该道具或数量不足。',
        unsupported: '该道具暂不支持在此直接使用。',
        boost_multiplier_conflict:
          '当前已有不同倍率的经验加成卡生效中，需等待当前经验卡到期后再使用其他倍率卡（未消耗）。',
      };
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'bag', listPage },
          { type: 'error', text: errMap[res.reason] ?? '未找到该道具或数量不足。' },
        ),
      );
      return;
    }

    const text =
      res.boostMultiplier && res.boostExpiresAt
        ? `⚡ 经验加成卡已激活！生效 **${res.boostMultiplier}x** 倍率，剩余 **${formatDurationZh(Math.max(0, res.boostExpiresAt - Date.now()))}**。`
        : res.equippedTitle
          ? `🏷️ 已将展示称号切换为 **「${res.equippedTitle}」**！`
          : '道具使用成功！';

    await interaction.update(
      buildMenuMessage(ctx, guildId, actor, { page: 'bag', listPage }, { type: 'success', text }),
    );
  }
}

export async function handleMenuUserSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  const actionType = parts[2];

  const targetId = interaction.values[0];
  if (!targetId) {
    return;
  }
  const targetUser = interaction.users.get(targetId) ?? interaction.users.first();

  if (
    await tryHandleGamesMenuUserSelect(
      interaction,
      ctx,
      guildId,
      actor,
      actionType,
      targetId,
      Boolean(targetUser?.bot),
    )
  ) {
    return;
  }

  if (actionType === 'admin_grant') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return;
    }
    const currencyName = ctx.repos.guildConfig.getOrCreate(guildId).economy.currencyName;
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ops' },
          { type: 'error', text: `不能给机器人发放或扣除${currencyName}。` },
        ),
      );
      return;
    }
    await interaction.showModal(
      buildAmountModal(
        `menu:modal_sub:admin_grant:${targetId}`,
        `💸 发放或扣除群友${currencyName}`,
        `增减${currencyName}（正数加币，负数扣币）`,
        '例如：10000 或 -500',
      ),
    );
    return;
  }

  if (actionType === 'admin_set_stat') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return;
    }
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ops' },
          { type: 'error', text: '不能修改机器人的成长数值。' },
        ),
      );
      return;
    }
    const profile = ctx.repos.profile.getOrCreate(guildId, targetId);
    const lvl = ctx.repos.guildConfig.getOrCreate(guildId).leveling;
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`menu:modal_sub:admin_set_stat:${targetId}`)
        .setTitle(truncateText(`📏 设置成员${lvl.statName}`, 45))
        .addComponents(
          prefilledField(
            'statValue',
            truncateText(`目标${lvl.statName}（0 ~ 1000000000 ${lvl.statUnit}）`, 45),
            profile.statValue,
            10,
          ),
        ),
    );
    return;
  }

  if (actionType === 'admin_toggle_user') {
    if (!actor.isAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return;
    }
    const superAdmin = Boolean(actor.isSuperAdmin || isGuildSuperAdmin(interaction, ctx, guildId));
    if (!superAdmin) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'admin_ops' }, SUPER_ADMIN_DENIED_FEEDBACK),
      );
      return;
    }
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ops' },
          { type: 'error', text: '不能将机器人设为 Bot 管理员。' },
        ),
      );
      return;
    }
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);
    const exists = cfg.adminUserIds.includes(targetId);

    const next = exists
      ? cfg.adminUserIds.filter((id) => id !== targetId)
      : [...cfg.adminUserIds, targetId];
    ctx.repos.guildConfig.updateAdminUsers(guildId, next);
    await interaction.update(
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'admin_ops' },
        {
          type: 'success',
          text: exists
            ? `已移除 <@${targetId}> 的指定 Bot 管理员权限。`
            : `✅ 已授权 <@${targetId}> 成为 Bot 管理员（TA 打开 \`/菜单\` 即可看到「⚙️ 管理后台」）。`,
        },
      ),
    );
    return;
  }

  if (actionType === 'rob') {
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'rob' },
          { type: 'error', text: '机器人没有钱包，换个真实群友试试吧！' },
        ),
      );
      return;
    }
    if (targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, { type: 'error', text: '不能打劫自己！' }),
      );
      return;
    }

    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    await interaction.deferUpdate();
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const targetMember = interaction.guild?.members?.cache?.get(targetId);
    const targetHints = buildRobTargetHints(targetUser, targetMember);
    const res = ctx.services.economy.rob(
      guildId,
      actor.id,
      targetId,
      Date.now(),
      Math.random,
      targetHints,
    );
    if (!res.ok) {
      const msgMap: Record<string, string> = {
        self_target: '不能打劫自己！',
        cooldown: `打劫冷却中，请等待 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
        target_shielded: `<@${targetId}> 防盗护盾生效中，剩余 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
        target_too_poor: `<@${targetId}> 口袋现金不足 ${ROB_TARGET_MIN_COINS} ${cfg.currencyName}，放过 TA 吧。`,
        attacker_too_poor: `你的总资产（现金+存款）不足 **${ROB_ATTACKER_MIN_ASSETS}** ${cfg.currencyName}，无法发起打劫！`,
      };
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'rob' },
          { type: 'error', text: msgMap[res.reason] ?? '当前无法发起打劫，请稍后再试。' },
        ),
      );
      return;
    }

    const targetName = targetUser?.displayName ?? '群友';
    const hasBounty = Boolean(res.success && res.bountyClaimed && res.bountyClaimed > 0);
    const fineFromBank = !res.success ? (res.fineFromBank ?? 0) : 0;
    const fineFromPocket = !res.success ? (res.fineFromPocket ?? res.amount) : 0;
    const fineDetail =
      !res.success && fineFromBank > 0
        ? `（扣口袋现金 **${fineFromPocket}** + 联动划扣银行存款 **${fineFromBank}**）`
        : '';
    const bankSuffix =
      !res.success &&
      typeof res.attackerBankBalance === 'number' &&
      (fineFromBank > 0 || res.easterEggTriggered)
        ? `（银行 **${res.attackerBankBalance}**）`
        : '';
    const broadcast = await sendPublicBroadcast(
      interaction,
      res.success
        ? {
            allowedMentions: hasBounty ? { users: [targetId] } : { parse: [] },
            content: hasBounty
              ? `🥷 <@${actor.id}> 抢了 <@${targetId}> **${res.amount}** ${cfg.currencyName}！顺手领走通缉赏金 **+${res.bountyClaimed}**！`
              : `🥷 **${actor.displayName}** 抢了 **${targetName}** **${res.amount}** ${cfg.currencyName}！`,
            embeds: [
              createSuccessEmbed(
                '🥷 频道快报：抢钱得手！',
                [
                  `<@${actor.id}>${res.usedLockpick ? '（🗝️ 使用万能撬锁）' : ''} 从 <@${targetId}> 的口袋里抢走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
                  ...(res.bountyClaimed && res.bountyClaimed > 0
                    ? [`🎯 **通缉令兑现**：成功击破通缉目标，额外独吞赏金 **+${res.bountyClaimed}** ${cfg.currencyName}！`]
                    : []),
                  `受害者剩余现金：**${res.targetBalance}** ｜ 抢劫者当前现金：**${res.attackerBalance}**`,
                  `🛡️ <@${targetId}> 已自动触发防盗护盾（快把现金存进银行降低风险吧！）`,
                ].join('\n'),
              ),
            ],
          }
        : res.easterEggTriggered
          ? {
              allowedMentions: { parse: [] },
              content: `👑 频道吃瓜！**${actor.displayName}** 竟敢打劫 **${targetName}**，触发王者反噬被当场罚没 10% 总资产（**${res.amount}** ${cfg.currencyName}）！`,
              embeds: [formatPocketRobResultEmbed(res, targetId, cfg)],
            }
          : {
              allowedMentions: { parse: [] },
              content: res.trapped
                ? `🪤 **${actor.displayName}** 偷 **${targetName}** 时一脚踩中防盗捕兽夹，双倍赔了 **${res.amount}** ${cfg.currencyName}！`
                : `🚨 **${actor.displayName}** 抢 **${targetName}** 翻车被抓，反赔了 **${res.amount}** ${cfg.currencyName}！`,
              embeds: [
                createErrorEmbed(
                  res.trapped ? '🪤 频道快报：捕兽夹反抓小偷！' : '🚨 频道快报：抢钱翻车现场！',
                  [
                    res.trapped
                      ? `<@${actor.id}> 偷钱时一头撞进 <@${targetId}> 预设的【🪤 捕兽夹】，被反抓双倍赔款 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}！`
                      : `<@${actor.id}> 企图打劫 <@${targetId}> 时翻车被抓，现场赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}！`,
                    ...(res.usedLockpick ? ['🗝️ 本次行动已消耗【万能撬锁】。'] : []),
                    `抢劫者当前现金：**${res.attackerBalance}**${bankSuffix} ｜ 受害者当前现金：**${res.targetBalance}**`,
                  ].join('\n'),
                ),
              ],
            },
    );

    const warnSuffix = broadcast.sent
      ? ''
      : '\n⚠️ 当前频道未能发出公开快报，请检查机器人发言权限。';

    const feedback: MenuFeedback = res.success
      ? {
          type: 'success',
          text: `🥷 打劫得手！${res.usedLockpick ? '（🗝️ 撬锁生效）' : ''}从 <@${targetId}> 口袋顺走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${res.bountyClaimed ? `，并兑现悬赏 **+${res.bountyClaimed}**` : ''}，你的现金：**${res.attackerBalance}**。${warnSuffix}`,
        }
      : res.easterEggTriggered
        ? {
            type: 'error',
            text: `${res.easterEggStory ?? '👑 触发王者反噬，以下犯上必遭天谴！'}\n💸 罚没总资产 10%（${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}），你的现金：**${res.attackerBalance}**${bankSuffix}。${warnSuffix}`,
          }
        : {
            type: 'error',
            text: res.trapped
              ? `🪤 踩雷了！对方提前埋了【捕兽夹】，强制翻倍赔偿 <@${targetId}> ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}，你的现金：**${res.attackerBalance}**${bankSuffix}。${warnSuffix}`
              : `🚨 打劫翻车被抓现行！向 <@${targetId}> 赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}，你的现金：**${res.attackerBalance}**${bankSuffix}。${warnSuffix}`,
          };

    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, feedback),
    );
    return;
  }

  if (actionType === 'rob_bank') {
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'rob' },
          { type: 'error', text: '机器人没有银行金库，换个真实群友试试吧！' },
        ),
      );
      return;
    }
    if (targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, { type: 'error', text: '不能抢自己的银行金库！' }),
      );
      return;
    }

    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    await interaction.deferUpdate();
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const targetMember = interaction.guild?.members?.cache?.get(targetId);
    const targetHints = buildRobTargetHints(targetUser, targetMember);
    const res = ctx.services.economy.robBank(
      guildId,
      actor.id,
      targetId,
      Date.now(),
      Math.random,
      targetHints,
    );
    if (!res.ok) {
      const msgMap: Record<string, string> = {
        self_target: '不能抢自己的银行金库！',
        cooldown: `打劫冷却中，请等待 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
        target_shielded: `<@${targetId}> 防盗护盾生效中，剩余 **${formatDurationZh((res.retryAfterSec ?? 0) * 1000)}**。`,
        target_bank_too_poor: `<@${targetId}> 银行金库余额不足 ${BANK_ROB_TARGET_MIN} ${cfg.currencyName}，不值得动手。`,
        attacker_too_poor: `你的总资产（现金+存款）不足 **${BANK_ROB_ATTACKER_MIN_ASSETS}** ${cfg.currencyName}，不够支付劫金库翻车保底罚金！`,
      };
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'rob' },
          { type: 'error', text: msgMap[res.reason] ?? '当前无法强抢银行金库，请稍后再试。' },
        ),
      );
      return;
    }

    const targetName = targetUser?.displayName ?? '群友';
    const hasBounty = Boolean(res.success && res.bountyClaimed && res.bountyClaimed > 0);
    const fineDetail =
      !res.success && (res.fineFromBank ?? 0) > 0
        ? `（扣口袋现金 **${res.fineFromPocket ?? 0}** + 划扣银行存款 **${res.fineFromBank ?? 0}**）`
        : '';

    const broadcast = await sendPublicBroadcast(
      interaction,
      res.success
        ? {
            allowedMentions: hasBounty ? { users: [targetId] } : { parse: [] },
            content: hasBounty
              ? `🏦💥 <@${actor.id}> 潜入银行金库撬开了 <@${targetId}> 的保险柜，劫走 **${res.amount}** ${cfg.currencyName} 并领走悬赏 **+${res.bountyClaimed}**！`
              : `🏦💥 **${actor.displayName}** 强攻银行金库得手，从 **${targetName}** 的保险柜里撬走了 **${res.amount}** ${cfg.currencyName}！`,
            embeds: [
              createSuccessEmbed(
                '🏦 频道快报：银行金库大劫案！',
                [
                  `<@${actor.id}>${res.usedLockpick ? '（🗝️ 使用万能撬锁）' : ''} 突破重重安保，从 <@${targetId}> 的银行金库撬走了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
                  ...(res.bountyClaimed && res.bountyClaimed > 0
                    ? [`🎯 **通缉令兑现**：顺手击破通缉目标，额外独吞赏金 **+${res.bountyClaimed}** ${cfg.currencyName}！`]
                    : []),
                  `受害者剩余金库：**${res.targetBankBalance}** ｜ 劫匪当前现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）`,
                  `🛡️ <@${targetId}> 已触发金库最高级别防盗护盾！`,
                ].join('\n'),
              ),
            ],
          }
        : res.easterEggTriggered
          ? {
              allowedMentions: { parse: [] },
              content: `👑🏦 频道吃瓜！**${actor.displayName}** 竟敢强抢 **${targetName}** 的皇家金库，触发王者反噬被当场罚没 10% 总资产（**${res.amount}** ${cfg.currencyName}）！`,
              embeds: [formatBankRobResultEmbed(res, targetId, cfg)],
            }
          : {
              allowedMentions: { parse: [] },
              content: res.trapped
                ? `🪤🏦 **${actor.displayName}** 强闯 **${targetName}** 的银行金库一脚踩中防盗捕兽夹，被重罚 **${res.amount}** ${cfg.currencyName}！`
                : `🚨🏦 **${actor.displayName}** 强抢 **${targetName}** 的银行金库触发警报被捕，重罚赔偿 **${res.amount}** ${cfg.currencyName}！`,
              embeds: [
                createErrorEmbed(
                  res.trapped ? '🪤 频道快报：金库捕兽夹重创劫匪！' : '🚨 频道快报：抢银行金库翻车被捕！',
                  [
                    res.trapped
                      ? `<@${actor.id}> 潜入 <@${targetId}> 的银行金库时触发【🪤 捕兽夹】与金库电网，被强制重罚 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}！`
                      : `<@${actor.id}> 企图爆破 <@${targetId}> 的银行金库时被巡逻警卫当场抓获，重罚赔偿 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}！`,
                    `劫匪剩余现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）｜ 受害者当前金库：**${res.targetBankBalance}**`,
                  ].join('\n'),
                ),
              ],
            },
    );

    const warnSuffix = broadcast.sent
      ? ''
      : '\n⚠️ 当前频道未能发出公开快报，请检查机器人发言权限。';

    const feedback: MenuFeedback = res.success
      ? {
          type: 'success',
          text: `🏦 金库劫案得手！${res.usedLockpick ? '（🗝️ 撬锁生效）' : ''}从 <@${targetId}> 银行金库撬走 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${res.bountyClaimed ? `，并兑现悬赏 **+${res.bountyClaimed}**` : ''}，你的现金：**${res.attackerBalance}**。${warnSuffix}`,
        }
      : res.easterEggTriggered
        ? {
            type: 'error',
            text: `${res.easterEggStory ?? '👑 触发皇家金库禁令！'}\n💸 罚没总资产 10%（${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}），你的现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）。${warnSuffix}`,
          }
        : {
            type: 'error',
            text: res.trapped
              ? `🪤 金库踩雷！触发对方【捕兽夹】，重罚赔偿 <@${targetId}> ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}，你的现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）。${warnSuffix}`
              : `🚨 抢金库触发警报被抓！向 <@${targetId}> 赔偿了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}${fineDetail}，你的现金：**${res.attackerBalance}**（银行 **${res.attackerBankBalance}**）。${warnSuffix}`,
          };

    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(ctx, guildId, actor, { page: 'rob' }, feedback),
    );
    return;
  }

  if (actionType === 'pay') {
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: '不能向机器人转账。' }),
      );
      return;
    }
    if (targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: '不能给自己转账！' }),
      );
      return;
    }
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    await interaction.showModal(
      buildAmountModal(
        `menu:modal_sub:pay:${targetId}`,
        '💸 向群友转账',
        '转账金额（正整数）',
        '例如：100',
      ),
    );
    return;
  }

  if (actionType === 'duel') {
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '机器人不会掷骰子，请选择一位真实群友决斗！' },
        ),
      );
      return;
    }
    if (targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: '不能向自己发起决斗！' }),
      );
      return;
    }
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    if (!interaction.channel?.isSendable()) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '当前频道不支持发送公开决斗卡片，请在普通文字频道中重试。' },
        ),
      );
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    await interaction.showModal(
      buildAmountModal(
        `menu:modal_sub:duel:${targetId}`,
        '⚔️ 发起骰子决斗',
        `决斗赌注（1 ~ ${MAX_COIN_AMOUNT.toLocaleString('en-US')} ${cfg.currencyName}）`,
        '例如：10000',
      ),
    );
    return;
  }

  if (actionType === 'social') {
    const action = parseSocialAction(parts[3]);
    if (targetUser?.bot) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'social', action },
          { type: 'error', text: '机器人不懂得情感互动，选一位真实群友试试吧~' },
        ),
      );
      return;
    }
    if (targetId === actor.id) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'social', action },
          { type: 'error', text: '虽然自爱很好，但还是找一位群友互动吧~' },
        ),
      );
      return;
    }
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'fun', '娱乐互动');
    if (disabledMsg) {
      await interaction.update(
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'social', action },
          { type: 'error', text: disabledMsg },
        ),
      );
      return;
    }

    await interaction.deferUpdate();
    const res = ctx.services.fun.performInteraction(guildId, actor.id, targetId, action);
    const publicEmbed = new EmbedBuilder()
      .setColor(COLORS.FUN)
      .setDescription(
        `${res.emoji} <@${actor.id}> ${res.verbPhrase} <@${targetId}>！\n*（你们之间的「${res.label}」累计已达 **${res.count}** 次）*`,
      )
      .setTimestamp();
    await sendPublicBroadcast(interaction, {
      content: `${res.emoji} <@${actor.id}> ${res.verbPhrase} <@${targetId}>！`,
      embeds: [publicEmbed],
    });

    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'social', action },
        {
          type: 'success',
          text: `${res.emoji} 已对 <@${targetId}> 发起「${res.label}」（累计 **${res.count}** 次）！`,
        },
      ),
    );
  }
}

export async function handleMenuModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  const modalType = parts[2];

  if (await tryHandleGamesMenuModal(interaction, ctx, guildId, actor, parts)) {
    return;
  }

  if (await tryHandleConfigMenuModal(interaction, ctx, guildId, actor, parts)) {
    return;
  }

  if (await tryHandleAiMenuModal(interaction, ctx, guildId, actor, parts)) {
    return;
  }

  if (modalType === 'shop_custom_title') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    const itemId = parsePositiveInt(parts[3] ?? '');
    const titleText = interaction.fields.getTextInputValue('titleText').trim();
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    if (!itemId) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'shop' }, { type: 'error', text: '无效的商品编号。' }),
      );
      return;
    }
    const res = ctx.services.shop.buyCustomTitle(guildId, actor.id, itemId, titleText);
    if (!res.ok) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'shop' },
          { type: 'error', text: formatShopBuyError(res.reason, cfg.currencyName, res.dailyLimit) },
        ),
      );
      return;
    }
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'shop' },
        {
          type: 'success',
          text: `✍️ 兑换成功！已花费 ${cfg.currencyEmoji} **${res.item.price}** 并为你佩戴专属称号 **「${res.equippedTitle}」**！剩余现金：**${res.balance}**。`,
        },
      ),
    );
    return;
  }

  if (modalType === 'bag_custom_title') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    const invId = parsePositiveInt(parts[3] ?? '');
    const titleText = interaction.fields.getTextInputValue('titleText').trim();
    if (!invId) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'bag' }, { type: 'error', text: '无效的兑换券编号。' }),
      );
      return;
    }
    const res = ctx.services.shop.redeemCustomTitleVoucher(guildId, actor.id, invId, titleText);
    if (!res.ok) {
      const errText =
        res.reason === 'already_owned'
          ? `你已经拥有称号「${titleText}」，请换一个称号名称（券未消耗）。`
          : res.reason === 'invalid_title'
            ? '称号需在 1 ~ 20 个字之间（券未消耗）。'
            : '兑换券不存在或已消耗。';
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'bag' }, { type: 'error', text: errText }),
      );
      return;
    }
    await respondFromModal(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'bag' },
        { type: 'success', text: `✍️ 自定义称号兑换成功！当前已佩戴 **「${res.equippedTitle}」**！` },
      ),
    );
    return;
  }

  if (modalType?.startsWith('admin_')) {
    if (!actor.isAdmin) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'home' }, ADMIN_DENIED_FEEDBACK),
      );
      return;
    }

    const cfg = ctx.repos.guildConfig.getOrCreate(guildId);

    if (modalType === 'admin_daily') {
      const currencyName = interaction.fields.getTextInputValue('currencyName').trim();
      const currencyEmoji = interaction.fields.getTextInputValue('currencyEmoji').trim();
      const dailyBase = parseIntInRange(interaction.fields.getTextInputValue('dailyBase'), 0, 100_000);
      const dailyStreakBonus = parseIntInRange(interaction.fields.getTextInputValue('dailyStreakBonus'), 0, 50_000);
      const dailyMaxStreakBonus = parseIntInRange(interaction.fields.getTextInputValue('dailyMaxStreakBonus'), 0, 500_000);

      if (
        currencyName.length < 1 ||
        currencyName.length > 16 ||
        currencyEmoji.length < 1 ||
        currencyEmoji.length > 16 ||
        dailyBase === null ||
        dailyStreakBonus === null ||
        dailyMaxStreakBonus === null
      ) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_econ' },
            { type: 'error', text: '输入格式无效，请检查货币名称长度及各项整数范围。' },
          ),
        );
        return;
      }

      ctx.repos.guildConfig.updateEconomy(guildId, {
        ...cfg.economy,
        currencyName,
        currencyEmoji,
        dailyBase,
        dailyStreakBonus,
        dailyMaxStreakBonus,
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_econ' },
          { type: 'success', text: `已更新货币与签到参数：**${currencyName}**（${currencyEmoji}），基础 **${dailyBase}**。` },
        ),
      );
      return;
    }

    if (modalType === 'admin_work') {
      const workMin = parseIntInRange(interaction.fields.getTextInputValue('workMin'), 1, 100_000);
      const workMax = parseIntInRange(interaction.fields.getTextInputValue('workMax'), 1, 100_000);
      const workCooldownSec = parseIntInRange(interaction.fields.getTextInputValue('workCooldownSec'), 0, 86_400);

      if (workMin === null || workMax === null || workCooldownSec === null || workMin > workMax) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_econ' },
            { type: 'error', text: '打工参数无效：最低收益不能高于最高收益，冷却需在 0~86400 秒。' },
          ),
        );
        return;
      }

      ctx.repos.guildConfig.updateEconomy(guildId, {
        ...cfg.economy,
        workMin,
        workMax,
        workCooldownSec,
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_econ' },
          { type: 'success', text: `已更新打工参数：收益 **${workMin} ~ ${workMax}**，冷却 **${workCooldownSec}** 秒。` },
        ),
      );
      return;
    }

    if (modalType === 'admin_rob') {
      const pct = parseNumberInRange(interaction.fields.getTextInputValue('robSuccessPct'), 5, 95);
      let rawBankPct = '';
      try {
        rawBankPct = interaction.fields.getTextInputValue('robBankSuccessPct');
      } catch {
        rawBankPct = '';
      }
      const bankPct =
        rawBankPct.trim().length > 0
          ? parseNumberInRange(rawBankPct, 1, 80)
          : Number((cfg.economy.robBankSuccessRate * 100).toFixed(2));
      const robCooldownSec = parseIntInRange(interaction.fields.getTextInputValue('robCooldownSec'), 0, 86_400);
      const robTargetShieldSec = parseIntInRange(interaction.fields.getTextInputValue('robTargetShieldSec'), 0, 86_400);

      if (pct === null || bankPct === null || robCooldownSec === null || robTargetShieldSec === null) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_econ' },
            { type: 'error', text: '抢钱参数无效：口袋成功率需 5~95%，金库成功率需 1~80%，冷却/护盾需为 0~86400 秒。' },
          ),
        );
        return;
      }

      const robSuccessRate = Number((pct / 100).toFixed(4));
      const robBankSuccessRate = Number((bankPct / 100).toFixed(4));
      ctx.repos.guildConfig.updateEconomy(guildId, {
        ...cfg.economy,
        robSuccessRate,
        robBankSuccessRate,
        robCooldownSec,
        robTargetShieldSec,
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_econ' },
          {
            type: 'success',
            text: `已更新抢钱参数：口袋成功率 **${pct}%**，银行金库成功率 **${bankPct}%**，冷却 **${robCooldownSec}s**，护盾 **${robTargetShieldSec}s**。`,
          },
        ),
      );
      return;
    }

    if (modalType === 'admin_bank') {
      const pct = parseNumberInRange(interaction.fields.getTextInputValue('bankInterestPct'), 0.1, 50);
      const bankInterestMax = parseIntInRange(interaction.fields.getTextInputValue('bankInterestMax'), 1, 1_000_000_000);
      const bankInterestMinDeposit = parseIntInRange(interaction.fields.getTextInputValue('bankInterestMinDeposit'), 1, 1_000_000_000);

      if (pct === null || bankInterestMax === null || bankInterestMinDeposit === null) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_econ' },
            { type: 'error', text: '银行参数无效：日利率需为 0.1~50%，上限/起息额需为 1 ~ 1,000,000,000。' },
          ),
        );
        return;
      }

      const bankInterestRate = Number((pct / 100).toFixed(4));
      ctx.repos.guildConfig.updateEconomy(guildId, {
        ...cfg.economy,
        bankInterestRate,
        bankInterestMax,
        bankInterestMinDeposit,
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_econ' },
          { type: 'success', text: `已更新银行参数：日利率 **${pct}%**，每日上限 **${bankInterestMax}**，起息门槛 **${bankInterestMinDeposit}**。` },
        ),
      );
      return;
    }

    if (modalType === 'admin_xp') {
      const baseMinXp = parseIntInRange(interaction.fields.getTextInputValue('baseMinXp'), 1, 1000);
      const baseMaxXp = parseIntInRange(interaction.fields.getTextInputValue('baseMaxXp'), 1, 1000);
      const cooldownSec = parseIntInRange(interaction.fields.getTextInputValue('cooldownSec'), 0, 3600);
      const hourlyXpCap = parseIntInRange(interaction.fields.getTextInputValue('hourlyXpCap'), 0, 1_000_000);

      if (
        baseMinXp === null ||
        baseMaxXp === null ||
        cooldownSec === null ||
        hourlyXpCap === null ||
        baseMinXp > baseMaxXp
      ) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_lvl' },
            { type: 'error', text: '经验参数无效：最小 XP 不能大于最大 XP，冷却需为 0~3600 秒。' },
          ),
        );
        return;
      }

      ctx.repos.guildConfig.updateLeveling(guildId, {
        ...cfg.leveling,
        baseMinXp,
        baseMaxXp,
        cooldownSec,
        hourlyXpCap,
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl' },
          { type: 'success', text: `已更新发言经验：**${baseMinXp} ~ ${baseMaxXp}** XP，冷却 **${cooldownSec}s**，时限上限 **${hourlyXpCap}**。` },
        ),
      );
      return;
    }

    if (modalType === 'admin_heat') {
      const heatWindowSec = parseIntInRange(interaction.fields.getTextInputValue('heatWindowSec'), 10, 3600);
      const rawHeatMax = parseNumberInRange(interaction.fields.getTextInputValue('heatMaxMultiplier'), 1, 5);
      const voiceXpPerMin = parseIntInRange(interaction.fields.getTextInputValue('voiceXpPerMin'), 0, 1000);
      const levelUpCoinReward = parseIntInRange(interaction.fields.getTextInputValue('levelUpCoinReward'), 0, 100_000);

      if (
        heatWindowSec === null ||
        rawHeatMax === null ||
        voiceXpPerMin === null ||
        levelUpCoinReward === null
      ) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_lvl' },
            { type: 'error', text: '热度/奖励参数无效，请检查倍率(1.0~5.0)和数值范围。' },
          ),
        );
        return;
      }

      const heatMaxMultiplier = Number(rawHeatMax.toFixed(2));
      ctx.repos.guildConfig.updateLeveling(guildId, {
        ...cfg.leveling,
        heatWindowSec,
        heatMaxMultiplier,
        voiceXpPerMin,
        levelUpCoinReward,
      });
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_lvl' },
          { type: 'success', text: `已更新热度参数：窗口 **${heatWindowSec}s**，上限 **${heatMaxMultiplier}x**，语音 **${voiceXpPerMin}/分**，升级奖 **+${levelUpCoinReward}**。` },
        ),
      );
      return;
    }

    if (modalType === 'admin_grant') {
      const targetId = parts[3];
      if (!targetId) return;
      const amount = parseIntInRange(
        interaction.fields.getTextInputValue('amount'),
        -MAX_COIN_AMOUNT,
        MAX_COIN_AMOUNT,
      );
      if (amount === null || amount === 0) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ops' },
            { type: 'error', text: '请输入 -1,000,000,000 ~ 1,000,000,000 之间的非零整数。' },
          ),
        );
        return;
      }

      if (amount > 0) {
        await deferModalForWrite(interaction);
      }
      const updated = ctx.repos.profile.addCoins(guildId, targetId, amount);
      if (amount > 0) {
        await sendPublicBroadcast(interaction, {
          content: `🎁 <@${targetId}> 收到管理员发放的${cfg.economy.currencyName}福利！`,
          embeds: [
            createSuccessEmbed(
              `🎁 管理员发放${cfg.economy.currencyName}`,
              `管理员 <@${actor.id}> 向 <@${targetId}> 发放了 ${cfg.economy.currencyEmoji} **+${amount}** ${cfg.economy.currencyName}！\n当前口袋现金：**${updated.coins}** ${cfg.economy.currencyName}`,
            ),
          ],
        });
        await safeEditOrFollowUp(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ops' },
            {
              type: 'success',
              text: `已向 <@${targetId}> 发放 **+${amount}** ${cfg.economy.currencyName}（当前现金 **${updated.coins}**）。`,
            },
          ),
        );
        return;
      }

      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ops' },
          {
            type: 'success',
            text: `已从 <@${targetId}> 扣除 **${Math.abs(amount)}** ${cfg.economy.currencyName}（剩余现金 **${updated.coins}**）。`,
          },
        ),
      );
      return;
    }

    if (modalType === 'admin_set_stat') {
      const targetId = parts[3];
      if (!targetId) return;
      const value = parseIntInRange(
        interaction.fields.getTextInputValue('statValue'),
        0,
        MAX_COIN_AMOUNT,
      );
      if (value === null) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ops' },
            { type: 'error', text: '请输入 0 ~ 1,000,000,000 之间的整数。' },
          ),
        );
        return;
      }

      const updated = ctx.repos.profile.setStatValue(guildId, targetId, value);
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ops' },
          {
            type: 'success',
            text: `✅ 已将 <@${targetId}> 的 **${cfg.leveling.statName}** 设为 **${updated.statValue}** ${cfg.leveling.statUnit}！`,
          },
        ),
      );
      return;
    }

    if (modalType === 'admin_grant_all') {
      const superAdmin = Boolean(actor.isSuperAdmin || isGuildSuperAdmin(interaction, ctx, guildId));
      if (!superAdmin) {
        await respondFromModal(
          interaction,
          buildMenuMessage(ctx, guildId, actor, { page: 'admin_ops' }, SUPER_ADMIN_DENIED_FEEDBACK),
        );
        return;
      }
      const amount = parseIntInRange(
        interaction.fields.getTextInputValue('amount'),
        1,
        MAX_COIN_AMOUNT,
      );
      if (amount === null) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ops' },
            { type: 'error', text: '请输入 1 ~ 1,000,000,000 之间的正整数。' },
          ),
        );
        return;
      }

      if (!interaction.guild) return;
      await deferModalForWrite(interaction);

      const members = await interaction.guild.members.fetch();
      const humanIds = [...members.values()].filter((m) => !m.user.bot).map((m) => m.id);
      ctx.db.transaction(() => {
        for (const uid of humanIds) {
          ctx.repos.profile.addCoins(guildId, uid, amount);
        }
      })();

      await sendPublicBroadcast(interaction, {
        embeds: [
          createSuccessEmbed(
            '🎉 全服福利发放！',
            `管理员 <@${actor.id}> 向全服 **${humanIds.length}** 位真实群友每人发放了 ${cfg.economy.currencyEmoji} **+${amount}** ${cfg.economy.currencyName}！`,
          ),
        ],
      });

      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ops' },
          { type: 'success', text: `🎉 已向全服 **${humanIds.length}** 位群友每人发放 **+${amount}** ${cfg.economy.currencyName}！` },
        ),
      );
      return;
    }

    if (modalType === 'admin_random_redpacket') {
      const superAdmin = Boolean(actor.isSuperAdmin || isGuildSuperAdmin(interaction, ctx, guildId));
      if (!superAdmin) {
        await respondFromModal(
          interaction,
          buildMenuMessage(ctx, guildId, actor, { page: 'admin_ops' }, SUPER_ADMIN_DENIED_FEEDBACK),
        );
        return;
      }
      const totalAmount = parseIntInRange(
        interaction.fields.getTextInputValue('totalAmount'),
        1,
        MAX_COIN_AMOUNT,
      );
      const totalCount = parseIntInRange(
        interaction.fields.getTextInputValue('totalCount'),
        1,
        100,
      );
      let greeting = '';
      try {
        greeting = interaction.fields.getTextInputValue('greeting').trim();
      } catch {
        greeting = '';
      }
      if (!greeting) {
        greeting = '管理员天降随机大红包，见者有份！';
      }

      if (totalAmount === null || totalCount === null || totalAmount < totalCount) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ops' },
            {
              type: 'error',
              text: '随机红包参数无效：总金额需在 1 ~ 1,000,000,000 之间，份数 1 ~ 100，且总金额不能小于份数。',
            },
          ),
        );
        return;
      }

      await deferModalForWrite(interaction);

      let candidateIds: string[] = [];
      if (interaction.guild?.members?.fetch) {
        const fetched = await interaction.guild.members.fetch().catch(() => null);
        if (fetched) {
          candidateIds = [...fetched.values()].filter((m) => !m.user?.bot).map((m) => m.id);
        }
      }
      if (candidateIds.length === 0) {
        const rows = ctx.db
          .prepare('SELECT user_id FROM member_profiles WHERE guild_id = ? LIMIT 200')
          .all(guildId) as Array<{ user_id: string }>;
        candidateIds = rows.map((r) => r.user_id);
      }

      const res = ctx.services.multiplayer.distributeRandomRedPacket({
        guildId,
        candidateUserIds: candidateIds,
        totalAmount,
        count: totalCount,
      });

      if (!res.ok) {
        const errText =
          res.reason === 'no_candidates'
            ? '当前没有可派发红包的真实群友。'
            : '红包金额或份数参数超出有效范围。';
        await safeEditOrFollowUp(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ops' },
            { type: 'error', text: errText },
          ),
        );
        return;
      }

      const shareLines = res.shares.slice(0, 30).map((s, idx) => {
        const crown = res.bestLuckUserId === s.userId ? '👑 ' : `${idx + 1}. `;
        return `${crown}<@${s.userId}> 随机分得 ${cfg.economy.currencyEmoji} **+${s.amount}** ${cfg.economy.currencyName}（余额 **${s.newBalance}**）`;
      });
      if (res.shares.length > 30) {
        shareLines.push(`*…等共 ${res.shares.length} 位幸运群友*`);
      }

      await sendPublicBroadcast(interaction, {
        content: `🧧 管理员 <@${actor.id}> 随机派发了 **${res.totalAmount}** ${cfg.economy.currencyName} 拼手气大红包（共 **${res.winnerCount}** 份）！`,
        embeds: [
          createSuccessEmbed(
            `🧧 ${greeting}`,
            [
              `派发管理员：<@${actor.id}>`,
              `红包总额：${cfg.economy.currencyEmoji} **${res.totalAmount}** ${cfg.economy.currencyName} ｜ 随机抽取：**${res.winnerCount}** 位群友`,
              `👑 **手气最佳**：<@${res.bestLuckUserId}>（独揽 **+${res.bestLuckAmount}** ${cfg.economy.currencyName}）`,
              '',
              '**🎲 随机派发明细：**',
              ...shareLines,
            ].join('\n'),
          ),
        ],
      });

      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ops' },
          {
            type: 'success',
            text: `🎲 已随机抽取 **${res.winnerCount}** 位群友派发共计 **${res.totalAmount}** ${cfg.economy.currencyName}！手气最佳：<@${res.bestLuckUserId}>（+${res.bestLuckAmount}）。`,
          },
        ),
      );
      return;
    }

    if (modalType === 'admin_sys_redpacket') {
      if (!interaction.channel?.isSendable()) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ops' },
            { type: 'error', text: '当前频道不支持发送公开红包卡片，请在普通文字频道操作。' },
          ),
        );
        return;
      }

      const totalAmount = parsePositiveInt(interaction.fields.getTextInputValue('totalAmount'));
      const totalCount = parsePositiveInt(interaction.fields.getTextInputValue('totalCount'));
      let greeting = '';
      try {
        greeting = interaction.fields.getTextInputValue('greeting').trim();
      } catch {
        greeting = '';
      }

      if (!totalAmount || !totalCount) {
        await respondFromModal(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ops' },
            { type: 'error', text: '红包总金额与份数必须为正整数（份数 2 ~ 100，金额最高 10 亿）。' },
          ),
        );
        return;
      }

      await deferModalForWrite(interaction);
      const res = ctx.services.multiplayer.createRedPacket({
        guildId,
        channelId: interaction.channel.id,
        senderId: actor.id,
        totalAmount,
        totalCount,
        greeting: greeting || '🎁 管理员福利拼手气大红包！',
        systemFunded: true,
      });

      if (!res.ok) {
        const msgMap: Record<typeof res.reason, string> = {
          invalid_count: '红包份数必须在 2 ~ 100 份之间。',
          invalid_amount: '红包总金额必须在 1 ~ 1,000,000,000 之间。',
          amount_too_small_for_count: `红包总金额不能小于红包份数（每份至少 1 ${cfg.economy.currencyName}）。`,
          insufficient_funds: '余额不足。',
        };
        await safeEditOrFollowUp(
          interaction,
          buildMenuMessage(ctx, guildId, actor, { page: 'admin_ops' }, { type: 'error', text: msgMap[res.reason] }),
        );
        return;
      }

      const sent = await sendPublicBroadcast(interaction, {
        content: `🧧 管理员 <@${actor.id}> 派发了 **${res.packet.totalAmount}** ${cfg.economy.currencyName} 的系统福利大红包（共 ${res.packet.totalCount} 份），快来抢！`,
        ...buildRedPacketMessage(res.packet, [], null, cfg.economy),
      });
      if (!sent.sent || !sent.messageId) {
        ctx.repos.redPacket.markExpired(res.packet.id);
        await safeEditOrFollowUp(
          interaction,
          buildMenuMessage(
            ctx,
            guildId,
            actor,
            { page: 'admin_ops' },
            { type: 'error', text: '发送系统红包卡片失败，请检查机器人发言权限。' },
          ),
        );
        return;
      }

      ctx.services.multiplayer.bindRedPacketMessage(res.packet.id, sent.messageId);
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'admin_ops' },
          {
            type: 'success',
            text: `🧧 系统福利抢红包已发出！总额 ${cfg.economy.currencyEmoji} **${res.packet.totalAmount}** ${cfg.economy.currencyName}（${res.packet.totalCount} 份，系统出资不扣个人余额）。`,
          },
        ),
      );
      return;
    }
  }

  if (modalType === 'slots') {
    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'slots' }, { type: 'error', text: '请输入有效的正整数下注金额。' }),
      );
      return;
    }
    const out = runSlotsAction(ctx, guildId, actor, amount);
    await respondFromModal(interaction, out.msg);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    return;
  }

  if (modalType === 'dice') {
    const choice = parseDiceChoice(parts[3]);
    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'dice', choice },
          { type: 'error', text: '请输入有效的正整数下注金额。' },
        ),
      );
      return;
    }
    const out = runDiceAction(ctx, guildId, actor, choice, amount);
    await respondFromModal(interaction, out.msg);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    return;
  }

  if (modalType === 'bj') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'bj' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }
    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'bj' }, { type: 'error', text: '请输入有效的正整数下注金额。' }),
      );
      return;
    }
    const res = ctx.services.blackjack.startGame(guildId, actor.id, amount);
    const out = buildBlackjackResponse(ctx, guildId, actor, res);
    await respondFromModal(interaction, out.msg);
    if (out.highlight) {
      await sendPublicBroadcast(interaction, out.highlight);
    }
    return;
  }

  if (modalType === 'bank_dep' || modalType === 'bank_wd') {
    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'bank' }, { type: 'error', text: '请输入有效的正整数金额。' }),
      );
      return;
    }
    await respondFromModal(
      interaction,
      runBankTransferAction(ctx, guildId, actor, modalType === 'bank_dep' ? 'deposit' : 'withdraw', amount),
    );
    return;
  }

  if (modalType === 'pay') {
    const targetId = parts[3];
    if (!targetId) return;

    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: '请输入有效的正整数转账金额。' }),
      );
      return;
    }

    await deferModalForWrite(interaction);
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.economy.transferCoins(guildId, actor.id, targetId, amount);
    if (!res.ok) {
      const reasonMap: Record<typeof res.reason, string> = {
        self_target: '不能给自己转账。',
        invalid_amount: '转账金额无效。',
        insufficient_funds: `口袋现金不足，无法转出 **${amount}** ${cfg.currencyName}。`,
        deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止转账！',
      };
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'pay' }, { type: 'error', text: reasonMap[res.reason] }),
      );
      return;
    }

    await sendPublicBroadcast(interaction, {
      content: `💸 <@${actor.id}> 给 <@${targetId}> 转账了 **${res.amount}** ${cfg.currencyName}！`,
      embeds: [
        createSuccessEmbed(
          '💸 群友转账通知',
          `<@${actor.id}> 向 <@${targetId}> 转出了 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！`,
        ),
      ],
    });

    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'pay' },
        {
          type: 'success',
          text: `已向 <@${targetId}> 转账 ${cfg.currencyEmoji} **${res.amount}** ${cfg.currencyName}！剩余现金：**${res.fromBalance}**。`,
        },
      ),
    );
    return;
  }

  if (modalType === 'duel') {
    const opponentId = parts[3];
    if (!opponentId) return;

    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    if (!interaction.channel?.isSendable()) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: '当前频道不支持发送公开决斗卡片。' },
        ),
      );
      return;
    }

    const amount = parsePositiveInt(interaction.fields.getTextInputValue('amount'));
    if (!amount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'duel' }, { type: 'error', text: '请输入有效的正整数赌注金额。' }),
      );
      return;
    }

    await deferModalForWrite(interaction);
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.multiplayer.createDuel(
      guildId,
      interaction.channel.id,
      actor.id,
      opponentId,
      amount,
    );
    if (!res.ok) {
      const msgMap: Record<string, string> = {
        self_target: '不能向自己发起决斗！',
        invalid_bet: '决斗赌注必须在 1 ~ 1,000,000,000 之间。',
        insufficient_funds: `你的口袋现金不足以支付 **${amount}** ${cfg.currencyName} 赌注。`,
        deadbeat_blocked: '你当前有逾期未还贷款，已被列入失信名单，还清逾期欠款前禁止参与带赌注决斗！',
      };
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          { type: 'error', text: msgMap[res.reason] ?? '发起决斗失败，请重试。' },
        ),
      );
      return;
    }

    const broadcast = await sendPublicBroadcast(interaction, {
      allowedMentions: { users: [opponentId] },
      content: `⚔️ <@${opponentId}>，你收到了一条骰子决斗挑战！`,
      ...buildDuelMessage(res.duel, cfg),
    });
    if (!broadcast.sent) {
      ctx.services.multiplayer.declineDuel(res.duel.id, actor.id);
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'duel' },
          {
            type: 'error',
            text: `在当前频道发送决斗卡片失败，请检查机器人发言权限（已自动退回冻结的 **${amount}** ${cfg.currencyName}）。`,
          },
        ),
      );
      return;
    }

    if (broadcast.messageId) {
      ctx.services.multiplayer.bindDuelMessage(res.duel.id, broadcast.messageId);
    }

    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'duel' },
        {
          type: 'success',
          text: `已向 <@${opponentId}> 发起 **${amount}** ${cfg.currencyName} 的骰子决斗！等待对方点击应战。`,
        },
      ),
    );
    return;
  }

  if (modalType === 'redpacket') {
    const disabledMsg = checkModuleDisabled(ctx, guildId, 'economy', '经济系统');
    if (disabledMsg) {
      await respondFromModal(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'multi' }, { type: 'error', text: disabledMsg }),
      );
      return;
    }

    if (!interaction.channel?.isSendable()) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'multi' },
          { type: 'error', text: '当前频道不支持发送公开红包消息，请在普通文字频道中重试。' },
        ),
      );
      return;
    }

    const totalAmount = parsePositiveInt(interaction.fields.getTextInputValue('totalAmount'));
    const totalCount = parsePositiveInt(interaction.fields.getTextInputValue('totalCount'));
    const greeting = interaction.fields.getTextInputValue('greeting').trim();

    if (!totalAmount || !totalCount) {
      await respondFromModal(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'multi' },
          { type: 'error', text: '红包总金额与份数必须为正整数（份数 2 ~ 100）。' },
        ),
      );
      return;
    }

    await deferModalForWrite(interaction);
    const cfg = ctx.repos.guildConfig.getOrCreate(guildId).economy;
    const res = ctx.services.multiplayer.createRedPacket({
      guildId,
      channelId: interaction.channel.id,
      senderId: actor.id,
      totalAmount,
      totalCount,
      greeting,
    });

    if (!res.ok) {
      const msgMap: Record<typeof res.reason, string> = {
        invalid_count: '红包份数必须在 2 ~ 100 份之间。',
        invalid_amount: '红包总金额必须在 1 ~ 1,000,000,000 之间。',
        amount_too_small_for_count: `红包总金额不能小于红包份数（每份至少 1 ${cfg.currencyName}）。`,
        insufficient_funds: `你的口袋现金不足以包出 **${totalAmount}** ${cfg.currencyName} 的红包。`,
      };
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(ctx, guildId, actor, { page: 'multi' }, { type: 'error', text: msgMap[res.reason] }),
      );
      return;
    }

    const sent = await sendPublicBroadcast(interaction, {
      content: `🧧 <@${actor.id}> 发了一个 **${res.packet.totalAmount}** ${cfg.currencyName} 的拼手气红包（${res.packet.totalCount} 份），快来抢！`,
      ...buildRedPacketMessage(res.packet, [], null, cfg),
    });
    if (!sent.sent || !sent.messageId) {
      ctx.db.transaction(() => {
        const marked = ctx.repos.redPacket.markExpired(res.packet.id);
        if (marked) {
          ctx.repos.profile.addCoins(guildId, actor.id, res.packet.totalAmount);
        }
      })();
      await safeEditOrFollowUp(
        interaction,
        buildMenuMessage(
          ctx,
          guildId,
          actor,
          { page: 'multi' },
          {
            type: 'error',
            text: `发送红包消息失败，请检查机器人发言与嵌入链接权限（${cfg.currencyName}已自动退回）。`,
          },
        ),
      );
      return;
    }

    ctx.services.multiplayer.bindRedPacketMessage(res.packet.id, sent.messageId);
    await safeEditOrFollowUp(
      interaction,
      buildMenuMessage(
        ctx,
        guildId,
        actor,
        { page: 'multi' },
        {
          type: 'success',
          text: `🧧 拼手气红包已发出！总额 ${cfg.currencyEmoji} **${res.packet.totalAmount}** ${cfg.currencyName}（${res.packet.totalCount} 份），剩余现金：**${res.senderBalance}**。`,
        },
      ),
    );
  }
}

export async function handleMenuRoleSelect(
  interaction: RoleSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  await tryHandleConfigMenuRoleSelect(interaction, ctx, guildId, actor, parts);
}

export async function handleMenuChannelSelect(
  interaction: ChannelSelectMenuInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const actor = await resolveActor(interaction, ctx, guildId);
  const parts = interaction.customId.split(':');
  if (await tryHandleConfigMenuChannelSelect(interaction, ctx, guildId, actor, parts)) {
    return;
  }
  await tryHandleAiMenuChannelSelect(interaction, ctx, guildId, actor, parts);
}
