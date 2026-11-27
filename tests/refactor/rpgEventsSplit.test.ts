import { describe, expect, it, vi } from 'vitest';
import type { ButtonInteraction, Client, Guild } from 'discord.js';
import type { AppContext } from '../../src/core/context.js';
import { DEFAULT_ECONOMY_CONFIG, createDefaultGuildConfig } from '../../src/config/defaults.js';
import type { RpgDuel, RpgItem, RpgRaid, RpgTrial } from '../../src/db/repositories/rpgRepo.js';
import * as rpgMenuBuilder from '../../src/ui/rpgMenuBuilder.js';
import {
  RPG_RARITY_BADGE,
  RPG_SLOT_META,
  formatBpPercent,
  formatCompactGearItem,
  formatEffectiveStats,
  formatIdleDuration,
  formatRpgItemDisplay,
  formatRpgRarityTag,
  formatSuccessRate,
} from '../../src/ui/rpg/rpgFormatters.js';
import {
  buildRpgClassSwitchView,
  buildRpgHomeView,
} from '../../src/ui/rpg/rpgHomeAndClassViews.js';
import { buildRpgGearView } from '../../src/ui/rpg/rpgGearView.js';
import { buildPublicTrialCard, buildRpgTrialView } from '../../src/ui/rpg/rpgTrialViews.js';
import {
  buildRpgDuelBetModal,
  buildRpgPublicDuelCard,
  buildRpgPvpView,
} from '../../src/ui/rpg/rpgPvpViews.js';
import { buildRpgCoopRaidCard, buildRpgCoopView } from '../../src/ui/rpg/rpgCoopViews.js';
import * as rpgHandler from '../../src/interactions/rpgHandler.js';
import {
  formatLootNotes,
  isDuelRulesMode,
  isRpgClassKey,
  parseLockAffixArg,
} from '../../src/interactions/rpg/rpgInteractionHelpers.js';
import {
  handleRpgModal,
  handleRpgStringSelect,
  handleRpgUserSelect,
} from '../../src/interactions/rpg/rpgSelectsAndModals.js';
import * as readyModule from '../../src/events/ready.js';
import {
  buildLevelUpEmbed,
  sendLevelUpNotice,
  syncLevelRewardRoles,
} from '../../src/events/timers/levelUpNotifier.js';
import {
  runGiveawayTick,
  runMonitorPruneTick,
  runVoiceXpTick,
} from '../../src/events/timers/voiceAndGiveawayTimers.js';
import {
  runOverdueLoanTick,
  runRedPacketTick,
} from '../../src/events/timers/redPacketAndLoanTimers.js';
import { runGamesTick } from '../../src/events/timers/gamesSettlementTimer.js';

function makeSampleItem(overrides: Partial<RpgItem> = {}): RpgItem {
  return {
    id: 42,
    guildId: 'g1',
    userId: 'u1',
    slot: 'weapon',
    name: '星陨圣剑',
    rarity: 'legendary',
    tier: 5,
    enhanceLevel: 3,
    hpBonus: 120,
    atkBonus: 85,
    defBonus: 10,
    critBpBonus: 450,
    affixes: [],
    legendaryEffect: null,
    equipped: false,
    locked: true,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('refactor split: rpg ui, interactions, and ready timers', () => {
  it('formats RPG stats, items, durations, and preserves rpgMenuBuilder re-exports', () => {
    expect(formatBpPercent(450)).toBe('4.5%');
    expect(formatBpPercent(500)).toBe('5%');
    expect(formatSuccessRate(0.754)).toBe('75%');
    expect(formatIdleDuration(0)).toBe('0 分钟');
    expect(formatIdleDuration(45 * 60_000)).toBe('45 分钟');
    expect(formatIdleDuration(120 * 60_000)).toBe('2 小时');
    expect(formatIdleDuration(135 * 60_000)).toBe('2 小时 15 分钟');

    expect(formatEffectiveStats({ hp: 100, atk: 20, def: 0, critBp: 300 })).toBe(
      'HP +100 / ATK +20 / 暴击 +3%',
    );
    expect(formatEffectiveStats({ hp: 0, atk: 0, def: 0, critBp: 0 })).toBe('无附加属性');

    const item = makeSampleItem();
    expect(formatRpgRarityTag('legendary')).toBe('🟧传说');
    expect(formatRpgItemDisplay(item)).toBe('🟧传说 **星陨圣剑** **+3** 🔒');
    expect(formatCompactGearItem(item)).toBe('🟧星陨圣剑+3🔒');
    expect(formatCompactGearItem(undefined)).toBe('空');

    // Re-export identity checks
    expect(rpgMenuBuilder.RPG_SLOT_META).toBe(RPG_SLOT_META);
    expect(rpgMenuBuilder.RPG_RARITY_BADGE).toBe(RPG_RARITY_BADGE);
    expect(rpgMenuBuilder.formatBpPercent).toBe(formatBpPercent);
    expect(rpgMenuBuilder.formatEffectiveStats).toBe(formatEffectiveStats);
    expect(rpgMenuBuilder.formatRpgRarityTag).toBe(formatRpgRarityTag);
    expect(rpgMenuBuilder.formatRpgItemDisplay).toBe(formatRpgItemDisplay);
    expect(rpgMenuBuilder.buildRpgHomeView).toBe(buildRpgHomeView);
    expect(rpgMenuBuilder.buildRpgClassSwitchView).toBe(buildRpgClassSwitchView);
    expect(rpgMenuBuilder.buildRpgGearView).toBe(buildRpgGearView);
    expect(rpgMenuBuilder.buildRpgTrialView).toBe(buildRpgTrialView);
    expect(rpgMenuBuilder.buildPublicTrialCard).toBe(buildPublicTrialCard);
    expect(rpgMenuBuilder.buildRpgPvpView).toBe(buildRpgPvpView);
    expect(rpgMenuBuilder.buildRpgDuelBetModal).toBe(buildRpgDuelBetModal);
    expect(rpgMenuBuilder.buildRpgPublicDuelCard).toBe(buildRpgPublicDuelCard);
    expect(rpgMenuBuilder.buildRpgCoopView).toBe(buildRpgCoopView);
    expect(rpgMenuBuilder.buildRpgCoopRaidCard).toBe(buildRpgCoopRaidCard);
  });

  it('truncates duel bet modal title and input label to 45 chars and builds public cards', () => {
    const longCurrency = '超级无敌究极宇宙闪耀星辰皇家帝国传奇金币单位名称测试超长字符串';
    const modal = buildRpgDuelBetModal('equalized', 'u-target-9', longCurrency).toJSON();
    expect(modal.title.length).toBeLessThanOrEqual(45);
    const firstRow = modal.components[0];
    const firstInput = firstRow?.components[0];
    expect(firstInput && 'label' in firstInput ? firstInput.label.length : 0).toBeLessThanOrEqual(
      45,
    );

    const pendingTrial: RpgTrial = {
      id: 7,
      guildId: 'g1',
      channelId: 'ch-game',
      messageId: 'm1',
      userId: 'u1',
      fromLevel: 9,
      targetTier: 2,
      baseChanceBp: 6500,
      pillsUsed: 1,
      usedGuard: true,
      supporters: ['u2'],
      saboteurs: [],
      status: 'pending',
      resultSummary: '',
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_060_000,
      resolvedAt: 0,
    };
    const trialCard = buildPublicTrialCard(pendingTrial, DEFAULT_ECONOMY_CONFIG);
    expect(trialCard.components).toHaveLength(1);

    const pendingDuel: RpgDuel = {
      id: 9,
      guildId: 'g1',
      channelId: 'ch-game',
      messageId: 'm2',
      challengerId: 'u1',
      opponentId: null,
      rulesMode: 'full',
      betAmount: 500,
      status: 'pending',
      winnerId: null,
      resultSummary: '',
      highlights: [],
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_600_000,
      resolvedAt: 0,
    };
    const duelCard = buildRpgPublicDuelCard(pendingDuel, DEFAULT_ECONOMY_CONFIG);
    expect(duelCard.components).toHaveLength(1);

    const recruitingRaid: RpgRaid = {
      id: 11,
      guildId: 'g1',
      channelId: 'ch-game',
      messageId: 'm3',
      leaderId: 'u1',
      tier: 2,
      bossName: '熔岩魔像',
      bossMaxHp: 1000,
      bossRemainingHp: 1000,
      members: ['u1', 'u2'],
      status: 'recruiting',
      resultSummary: '',
      highlights: [],
      payouts: [],
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_180_000,
      resolvedAt: 0,
    };
    const raidCard = buildRpgCoopRaidCard(recruitingRaid, DEFAULT_ECONOMY_CONFIG);
    expect(raidCard.components).toHaveLength(1);
  });

  it('validates RPG interaction helpers, re-exports, and 10062 reply-first behavior', async () => {
    expect(isRpgClassKey('warrior')).toBe(true);
    expect(isRpgClassKey('ninja')).toBe(false);
    expect(isDuelRulesMode('equalized')).toBe(true);
    expect(isDuelRulesMode('ranked')).toBe(false);
    expect(parseLockAffixArg('none')).toBeNull();
    expect(parseLockAffixArg('1')).toBe(1);
    expect(parseLockAffixArg('9')).toBeNull();

    const lootNotes = formatLootNotes({
      legendaryAndEpicPreviewItems: [makeSampleItem()],
      autoSalvagedCount: 2,
      autoSalvagedCoins: 150,
      autoSalvagedDust: 12,
      pillsFound: 1,
      elixirsFound: 1,
      currencyEmoji: '🪙',
    });
    expect(lootNotes).toHaveLength(3);
    expect(lootNotes[0]).toContain('晋升秘药×1');
    expect(lootNotes[2]).toContain('+12 魔尘');

    // Re-export identity checks
    expect(rpgHandler.handleRpgStringSelect).toBe(handleRpgStringSelect);
    expect(rpgHandler.handleRpgUserSelect).toBe(handleRpgUserSelect);
    expect(rpgHandler.handleRpgModal).toBe(handleRpgModal);

    // 10062 check: own_trial replies ephemeral and never edits original card
    const callOrder: string[] = [];
    const reply = vi.fn(async () => {
      callOrder.push('reply');
    });
    const edit = vi.fn(async () => {
      callOrder.push('edit');
    });
    const fakeInteraction = {
      guildId: 'g1',
      customId: 'rpg:trial_help:7',
      user: { id: 'u1' },
      reply,
      message: { edit },
    } as unknown as ButtonInteraction;

    const fakeCtx = {
      repos: {
        guildConfig: {
          getOrCreate: () => createDefaultGuildConfig('g1'),
        },
      },
      services: {
        rpg: {
          interactPublicTrial: () => ({ ok: false as const, reason: 'own_trial' as const }),
          getTrialById: vi.fn(),
        },
      },
    } as unknown as AppContext;

    await rpgHandler.handleRpgButton(fakeInteraction, fakeCtx);
    expect(callOrder).toEqual(['reply']);
    expect(edit).not.toHaveBeenCalled();

    // already_resolved: replies FIRST, then edits expired trial card
    callOrder.length = 0;
    const resolvedTrial: RpgTrial = {
      id: 7,
      guildId: 'g1',
      channelId: 'ch-game',
      messageId: 'm1',
      userId: 'u2',
      fromLevel: 9,
      targetTier: 2,
      baseChanceBp: 6500,
      pillsUsed: 0,
      usedGuard: false,
      supporters: [],
      saboteurs: [],
      status: 'succeeded',
      resultSummary: 'done',
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_060_000,
      resolvedAt: 1_700_000_050_000,
    };
    const fakeCtxResolved = {
      repos: {
        guildConfig: {
          getOrCreate: () => createDefaultGuildConfig('g1'),
        },
      },
      services: {
        rpg: {
          interactPublicTrial: () => ({ ok: false as const, reason: 'already_resolved' as const }),
          getTrialById: () => resolvedTrial,
        },
      },
    } as unknown as AppContext;

    await rpgHandler.handleRpgButton(fakeInteraction, fakeCtxResolved);
    expect(callOrder).toEqual(['reply', 'edit']);
  });

  it('preserves ready.ts timer re-exports, level-up embed formatting, and monitor prune safety', async () => {
    expect(readyModule.syncLevelRewardRoles).toBe(syncLevelRewardRoles);
    expect(readyModule.buildLevelUpEmbed).toBe(buildLevelUpEmbed);
    expect(readyModule.sendLevelUpNotice).toBe(sendLevelUpNotice);
    expect(readyModule.runVoiceXpTick).toBe(runVoiceXpTick);
    expect(readyModule.runGiveawayTick).toBe(runGiveawayTick);
    expect(readyModule.runRedPacketTick).toBe(runRedPacketTick);
    expect(readyModule.runGamesTick).toBe(runGamesTick);
    expect(readyModule.runMonitorPruneTick).toBe(runMonitorPruneTick);
    expect(readyModule.runOverdueLoanTick).toBe(runOverdueLoanTick);
    expect(typeof readyModule.registerReadyEvent).toBe('function');

    const guildCfg = createDefaultGuildConfig('g1');
    const embed = buildLevelUpEmbed(
      guildCfg,
      {
        id: 'u1',
        displayName: '勇者小明',
        displayAvatarURL: () => 'https://example.com/a.png',
      },
      {
        awarded: true,
        leveledUp: true,
        oldLevel: 4,
        newLevel: 5,
        coinsAwarded: 200,
        rolesToAdd: ['r1'],
        rolesToRemove: [],
        statValue: 18,
        statGained: 2,
      },
    );
    expect(embed.data.description).toContain('<@u1>');
    expect(embed.data.description).toContain('<@&r1>');

    const emptyCtx = {
      repos: {},
    } as unknown as AppContext;
    expect(runMonitorPruneTick(emptyCtx, 1_700_000_000_000)).toBe(0);

    // runGamesTick isolates failures and still invokes rpg.settleDuePublicTrials
    const settleDuePublicTrials = vi.fn(() => []);
    const expireDuePublicDuels = vi.fn(() => []);
    const settleDueCoopRaids = vi.fn(() => []);
    const fakeClient = {
      guilds: { cache: new Map<string, Guild>() },
      channels: { cache: new Map(), fetch: vi.fn(async () => null) },
    } as unknown as Client;
    const gameCtx = {
      repos: {
        guildConfig: { getOrCreate: () => guildCfg },
      },
      services: {
        chaos: {
          processTimedOutRoulettes: () => {
            throw new Error('boom');
          },
          expireDueNumberBombs: () => [],
        },
        worldEvent: {
          autoLockDuePredictions: () => [],
          expireDueWorldEvents: () => [],
          expireDueLockedPredictions: () => [],
        },
        rpg: {
          settleDuePublicTrials,
          expireDuePublicDuels,
          settleDueCoopRaids,
        },
        socialPet: {
          expireDueProposals: () => [],
          expireDuePetBattles: () => [],
        },
        blackjack: {
          expireDueGames: () => [],
        },
        multiplayer: {
          expireDueDuels: () => [],
        },
        duelArena: {
          processTimedOutRpsDuels: () => [],
          processTimedOutRouletteDuels: () => [],
          expireDueNicknameLocks: () => [],
        },
      },
    } as unknown as AppContext;

    await expect(runGamesTick(fakeClient, gameCtx)).resolves.toBeUndefined();
    expect(settleDuePublicTrials).toHaveBeenCalledTimes(1);
    expect(expireDuePublicDuels).toHaveBeenCalledTimes(1);
    expect(settleDueCoopRaids).toHaveBeenCalledTimes(1);
  });
});
