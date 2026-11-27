import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GAMES_CONFIG } from '../../src/config/defaults.js';
import { MAX_COIN_AMOUNT } from '../../src/config/economyConstants.js';
import { initSchema } from '../../src/db/schema.js';
import {
  DUEL_SCHEMA_SQL,
  DuelRepo,
  initDuelSchema,
} from '../../src/db/repositories/duelRepo.js';
import {
  mapDuelChallengeRow,
  mapNicknameLockRow,
  mapRouletteDuelRow,
  mapRpsRow,
} from '../../src/db/repositories/duel/duelMappers.js';
import {
  DuelArenaService,
  formatRpsMoveLabel,
  getDuelArenaService,
  MAX_CUSTOM_WAGER_LEN,
  RENAME_COOLDOWN_MS,
  ROULETTE_1V1_INVITE_TTL_MS,
  ROULETTE_1V1_TURN_TTL_MS,
  RPS_INVITE_TTL_MS,
  RPS_ROUND_TTL_MS,
  RPS_WINS_NEEDED,
  VALID_RENAME_HOURS,
  VALID_TIMEOUT_MINUTES,
} from '../../src/services/duelArenaService.js';
import {
  formatRpsMoveLabel as subFormatRpsMoveLabel,
  isValidRenameHours,
  isValidTimeoutMinutes,
  resolveRpsWinner,
} from '../../src/services/duelArena/duelArenaTypes.js';
import {
  applyRouletteTimeoutPenalty,
  applyWinnerNicknameRename,
  handleDuelArenaButton,
  handleDuelArenaModal,
  handleDuelArenaStringSelect,
} from '../../src/interactions/duelArenaHandler.js';
import {
  ChaosService,
  getPropPrice,
  PROP_CATALOG,
  PROP_KEYS,
} from '../../src/services/chaosService.js';
import {
  getPropPrice as subGetPropPrice,
  PROP_CATALOG as subPropCatalog,
  PROP_KEYS as subPropKeys,
} from '../../src/services/chaos/chaosCatalogAndTypes.js';
import {
  MAX_COIN_AMOUNT as MP_MAX_COIN_AMOUNT,
  MAX_RED_PACKET_COUNT,
  MultiplayerService,
} from '../../src/services/multiplayerService.js';
import { computeBestLuckUserId } from '../../src/services/multiplayer/multiplayerTypes.js';
import {
  applyPetXp,
  calculatePetReleaseRefund,
  PET_SPECIES,
  PET_SPECIES_MAP,
  simulatePetBattle,
  SocialPetService,
  unlockRelationshipMilestoneTitles,
  xpNeededForPetLevel,
} from '../../src/services/socialPetService.js';
import {
  applyPetXp as subApplyPetXp,
  calculatePetReleaseRefund as subCalculatePetReleaseRefund,
  generatePetStats,
  simulatePetBattle as subSimulatePetBattle,
  xpNeededForPetLevel as subXpNeededForPetLevel,
} from '../../src/services/socialPet/petMathAndBattleSim.js';
import {
  PET_SPECIES as subPetSpecies,
  PET_SPECIES_MAP as subPetSpeciesMap,
} from '../../src/services/socialPet/socialPetCatalogAndTypes.js';
import {
  RPG_BOSS_HEAVY_BONUS_CAP,
  RPG_BOSS_NORMAL_BONUS_CAP,
  WorldEventService,
} from '../../src/services/worldEventService.js';
import { buildPredictionSummary } from '../../src/services/worldEvent/worldEventTypesAndCatalog.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { WorldEventRepo } from '../../src/db/repositories/worldEventRepo.js';
import type { UserPet } from '../../src/db/repositories/socialPetRepo.js';

function makePet(overrides: Partial<UserPet> = {}): UserPet {
  return {
    id: 1,
    guildId: 'g1',
    ownerId: 'u1',
    speciesKey: 'shiba',
    nickname: '柴犬汪财',
    rarity: 'N',
    level: 1,
    xp: 0,
    hp: 100,
    atk: 20,
    spd: 15,
    critRate: 0.1,
    trait: '贪吃',
    isActive: true,
    wins: 0,
    losses: 0,
    lastFeedDate: null,
    lastTrainAt: 0,
    lastWorkAt: 0,
    createdAt: 1000,
    ...overrides,
  };
}

describe('games & social refactor split: pure functions and facade compatibility', () => {
  it('computes prop prices and preserves chaos catalog re-exports', () => {
    const gamesCfg = DEFAULT_GAMES_CONFIG;
    expect(PROP_CATALOG).toBe(subPropCatalog);
    expect(PROP_KEYS).toBe(subPropKeys);
    expect(getPropPrice).toBe(subGetPropPrice);
    expect(PROP_KEYS).toEqual(['trap', 'lockpick', 'shield', 'curse', 'nickname']);

    expect(getPropPrice(gamesCfg, 'trap')).toBe(gamesCfg.propTrapPrice);
    expect(getPropPrice(gamesCfg, 'lockpick')).toBe(gamesCfg.propLockpickPrice);
    expect(getPropPrice(gamesCfg, 'shield')).toBe(gamesCfg.propShieldPrice);
    expect(getPropPrice(gamesCfg, 'curse')).toBe(gamesCfg.propCursePrice);
    expect(getPropPrice(gamesCfg, 'nickname')).toBe(gamesCfg.propNicknamePrice);
    expect(typeof ChaosService).toBe('function');
  });

  it('resolves RPS matchups, labels, and duelArena option validators', () => {
    expect(formatRpsMoveLabel).toBe(subFormatRpsMoveLabel);
    expect(formatRpsMoveLabel('rock')).toBe('✊ 石头');
    expect(formatRpsMoveLabel('paper')).toBe('🖐️ 布');
    expect(formatRpsMoveLabel('scissors')).toBe('✌️ 剪刀');

    expect(resolveRpsWinner('rock', 'rock')).toBe('tie');
    expect(resolveRpsWinner('rock', 'scissors')).toBe('challenger');
    expect(resolveRpsWinner('scissors', 'paper')).toBe('challenger');
    expect(resolveRpsWinner('paper', 'rock')).toBe('challenger');
    expect(resolveRpsWinner('rock', 'paper')).toBe('opponent');
    expect(resolveRpsWinner('paper', 'scissors')).toBe('opponent');
    expect(resolveRpsWinner('scissors', 'rock')).toBe('opponent');

    expect(isValidRenameHours(0, false)).toBe(false);
    expect(isValidRenameHours(0, true)).toBe(true);
    expect(isValidRenameHours(1, false)).toBe(true);
    expect(isValidRenameHours(6, false)).toBe(true);
    expect(isValidRenameHours(24, false)).toBe(true);
    expect(isValidRenameHours(12, true)).toBe(false);

    expect(isValidTimeoutMinutes(0)).toBe(true);
    expect(isValidTimeoutMinutes(5)).toBe(true);
    expect(isValidTimeoutMinutes(10)).toBe(true);
    expect(isValidTimeoutMinutes(30)).toBe(true);
    expect(isValidTimeoutMinutes(15)).toBe(false);

    expect(VALID_RENAME_HOURS).toEqual([1, 6, 24]);
    expect(VALID_TIMEOUT_MINUTES).toEqual([5, 10, 30]);
    expect(RPS_WINS_NEEDED).toBe(3);
    expect(RPS_INVITE_TTL_MS).toBe(5 * 60 * 1000);
    expect(RPS_ROUND_TTL_MS).toBe(60 * 1000);
    expect(ROULETTE_1V1_INVITE_TTL_MS).toBe(5 * 60 * 1000);
    expect(ROULETTE_1V1_TURN_TTL_MS).toBe(30 * 1000);
    expect(RENAME_COOLDOWN_MS).toBe(10 * 1000);
    expect(MAX_CUSTOM_WAGER_LEN).toBe(100);
    expect(typeof DuelArenaService).toBe('function');
    expect(typeof getDuelArenaService).toBe('function');
  });

  it('calculates pet XP, stats, release refunds, and deterministic pet battles', () => {
    expect(PET_SPECIES).toBe(subPetSpecies);
    expect(PET_SPECIES_MAP).toBe(subPetSpeciesMap);
    expect(xpNeededForPetLevel).toBe(subXpNeededForPetLevel);
    expect(applyPetXp).toBe(subApplyPetXp);
    expect(calculatePetReleaseRefund).toBe(subCalculatePetReleaseRefund);
    expect(simulatePetBattle).toBe(subSimulatePetBattle);
    expect(typeof unlockRelationshipMilestoneTitles).toBe('function');
    expect(typeof SocialPetService).toBe('function');

    expect(xpNeededForPetLevel(1)).toBe(60);
    expect(xpNeededForPetLevel(5)).toBe(300);

    expect(calculatePetReleaseRefund('N', 500)).toBe(125);
    expect(calculatePetReleaseRefund('R', 500)).toBe(225);
    expect(calculatePetReleaseRefund('SR', 500)).toBe(375);
    expect(calculatePetReleaseRefund('SSR', 500)).toBe(500);

    const pet = makePet({ rarity: 'SSR', level: 1, xp: 0, hp: 200, atk: 40, spd: 30 });
    const gained = applyPetXp(pet, 180); // Lv1->2 needs 60, Lv2->3 needs 120 => Lv3, 0 xp
    expect(gained.leveledUp).toBe(true);
    expect(gained.levelsGained).toBe(2);
    expect(gained.updatedPet.level).toBe(3);
    expect(gained.updatedPet.xp).toBe(0);
    expect(gained.updatedPet.hp).toBe(252);
    expect(gained.updatedPet.atk).toBe(52);
    expect(gained.updatedPet.spd).toBe(38);

    const ssrStats = generatePetStats('SSR', () => 0);
    expect(ssrStats).toEqual({ hp: 195, atk: 38, spd: 28, critRate: 0.22 });

    const strong = makePet({ id: 1, nickname: '霸王龙', hp: 500, atk: 120, spd: 40, critRate: 0.5 });
    const weak = makePet({ id: 2, nickname: '小脆鸭', hp: 60, atk: 10, spd: 10, critRate: 0.05 });
    const sim = simulatePetBattle(strong, weak, () => 0.5);
    expect(sim.winnerSide).toBe('challenger');
    expect(sim.draw).toBe(false);
    expect(sim.logs.length).toBeGreaterThan(0);
  });

  it('computes dynamic prediction odds and preserves WorldEventService RPG boss bridge', () => {
    const summary = buildPredictionSummary(
      {
        id: 1,
        guildId: 'g1',
        channelId: 'c1',
        messageId: null,
        creatorId: 'u0',
        title: '今晚会下雨吗',
        options: ['会下', '不下', '下冰雹'],
        status: 'open',
        winningOption: null,
        closesAt: 9999,
        createdAt: 1000,
        lockedAt: 0,
        settledAt: null,
      },
      [
        { id: 1, predictionId: 1, userId: 'u1', optionIndex: 0, amount: 100, createdAt: 1001 },
        { id: 2, predictionId: 1, userId: 'u2', optionIndex: 1, amount: 300, createdAt: 1002 },
      ],
    );

    expect(summary.totalPool).toBe(400);
    expect(summary.optionStats[0]).toMatchObject({
      index: 0,
      label: '会下',
      totalAmount: 100,
      bettorCount: 1,
      oddsText: '4.00x',
    });
    expect(summary.optionStats[1]).toMatchObject({
      index: 1,
      label: '不下',
      totalAmount: 300,
      bettorCount: 1,
      oddsText: '1.33x',
    });
    expect(summary.optionStats[2]).toMatchObject({
      index: 2,
      label: '下冰雹',
      totalAmount: 0,
      bettorCount: 0,
      oddsText: '待开赔率',
    });

    expect(RPG_BOSS_NORMAL_BONUS_CAP).toBe(120);
    expect(RPG_BOSS_HEAVY_BONUS_CAP).toBe(180);

    const db = new Database(':memory:');
    initSchema(db);
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const worldEventRepo = new WorldEventRepo(db);
    const svc = new WorldEventService(db, configRepo, profileRepo, worldEventRepo);
    const dustCalls: Array<{ ids: readonly string[]; mvp: string }> = [];
    svc.setRpgBridge({
      getBossAttackBonus: () => ({ bonusDamage: 999, classEmoji: '⚔️', realmLabel: '三阶' }),
      awardBossKillDust: (_guildId, ids, mvp) => {
        dustCalls.push({ ids, mvp });
        return new Map([[mvp, 18]]);
      },
    });

    const boss = svc.spawnBoss('g1', 'c1', 1000, () => 0);
    worldEventRepo.saveWorldEvent({ ...boss, currentHp: 100 });
    const atk = svc.attackBoss(boss.id, 'u1', 'normal', 2000, () => 0.5);
    expect(atk.ok).toBe(true);
    if (atk.ok) {
      expect(atk.rpgBonus).toBe(RPG_BOSS_NORMAL_BONUS_CAP);
      expect(atk.killed).toBe(true);
      expect(atk.rewards[0]?.dustAwarded).toBe(18);
    }
    expect(dustCalls).toHaveLength(1);
    db.close();
  });

  it('preserves duelRepo mappers, MultiplayerService exports, and duelArenaHandler exports', () => {
    expect(DUEL_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS duel_challenges');
    expect(typeof initDuelSchema).toBe('function');
    expect(typeof DuelRepo).toBe('function');
    expect(MP_MAX_COIN_AMOUNT).toBe(MAX_COIN_AMOUNT);
    expect(MAX_RED_PACKET_COUNT).toBe(100);
    expect(typeof MultiplayerService).toBe('function');

    expect(typeof applyWinnerNicknameRename).toBe('function');
    expect(typeof applyRouletteTimeoutPenalty).toBe('function');
    expect(typeof handleDuelArenaButton).toBe('function');
    expect(typeof handleDuelArenaStringSelect).toBe('function');
    expect(typeof handleDuelArenaModal).toBe('function');

    expect(
      computeBestLuckUserId(
        {
          id: 1,
          guildId: 'g1',
          channelId: 'c1',
          messageId: null,
          senderId: 'u0',
          totalAmount: 100,
          totalCount: 2,
          remainingAmount: 0,
          remainingCount: 0,
          greeting: 'hi',
          status: 'finished',
          systemFunded: false,
          expiresAt: 9999,
          createdAt: 1000,
        },
        [
          { id: 1, packetId: 1, userId: 'u1', amount: 30, claimedAt: 1001 },
          { id: 2, packetId: 1, userId: 'u2', amount: 70, claimedAt: 1002 },
        ],
      ),
    ).toBe('u2');

    expect(
      mapDuelChallengeRow({
        id: 'd1',
        guild_id: 'g1',
        channel_id: 'c1',
        message_id: null,
        challenger_id: 'u1',
        opponent_id: 'u2',
        bet: 100,
        status: 'invalid_status',
        created_at: 1,
        expires_at: 2,
      }).status,
    ).toBe('pending');

    expect(
      mapRpsRow({
        id: 'rps_1',
        guild_id: 'g1',
        channel_id: 'c1',
        message_id: null,
        challenger_id: 'u1',
        opponent_id: 'u2',
        bet: 0,
        rename_duration_ms: 3600000,
        status: 'playing',
        round_number: 1,
        challenger_wins: 0,
        opponent_wins: 0,
        challenger_move: 'rock',
        opponent_move: 'bad_move',
        history_json: 'not-json',
        winner_id: null,
        loser_id: null,
        bounty_claimed: 0,
        round_deadline: 0,
        created_at: 1,
        expires_at: 2,
        updated_at: 3,
      }),
    ).toMatchObject({
      challengerMove: 'rock',
      opponentMove: null,
      history: [],
    });

    expect(
      mapRouletteDuelRow({
        id: 'rl1_1',
        guild_id: 'g1',
        channel_id: 'c1',
        message_id: null,
        challenger_id: 'u1',
        opponent_id: 'u2',
        bullets: 1,
        bet: 0,
        rename_duration_ms: 0,
        timeout_duration_ms: 0,
        custom_wager: 'drink water',
        status: 'pending',
        turn_order_json: '["u1","u2"]',
        turn_index: 0,
        chamber_pos: 0,
        bullet_positions_json: '[2]',
        logs_json: '["start"]',
        winner_id: null,
        loser_id: null,
        bounty_claimed: 0,
        turn_deadline: 0,
        created_at: 1,
        expires_at: 2,
        updated_at: 3,
      }),
    ).toMatchObject({
      turnOrder: ['u1', 'u2'],
      bulletPositions: [2],
      logs: ['start'],
    });

    expect(
      mapNicknameLockRow({
        guild_id: 'g1',
        target_id: 'u2',
        winner_id: 'u1',
        source_type: 'roulette_1v1',
        source_id: 'rl1_1',
        original_nickname: 'old',
        original_nickname_captured: 1,
        locked_nickname: 'new',
        fallback_mode: 1,
        original_card_nickname: 'card',
        original_equipped_title: 'title',
        last_renamed_at: 10,
        expires_at: 20,
        created_at: 1,
        updated_at: 10,
      }),
    ).toMatchObject({
      sourceType: 'roulette_1v1',
      originalNicknameCaptured: true,
      fallbackMode: true,
    });
  });
});
