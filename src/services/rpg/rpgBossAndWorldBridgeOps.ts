import type { RpgCharacter, RpgItem, RpgItemRarity } from '../../db/repositories/rpgRepo.js';
import { getSalvageArcaneDust } from '../rpgAffixes.js';
import {
  buildTierBossCombatant,
  simulateRpgBattle,
  type RpgBattleRating,
  type RpgBattleReport,
} from '../rpgCombatEngine.js';
import { generateTierItem, RARITY_ORDER } from './rpgCatalogBossesAndItems.js';
import { RPG_CLASSES, RPG_CLASS_MAP, type RpgTierDef } from './rpgCatalogClassesAndTiers.js';
import {
  applyCharacterXp,
  computeRatingMultiplier,
  getRpgRealmInfo,
  getSalvageValue,
  isAtBreakthroughGate,
} from './rpgPureMath.js';
import {
  clampUnit,
  WORLD_BOSS_HEAVY_BONUS_CAP,
  WORLD_BOSS_NORMAL_BONUS_CAP,
  type BankLootInput,
  type BankLootResult,
  type PendingRpgItem,
  type RpgOpsContext,
  type RpgWorldBossBridge,
} from './rpgTypesAndConfig.js';

export type RaidBossResult =
  | {
      ok: true;
      runsExecuted: number;
      rating: RpgBattleRating;
      roundsPlayed: number;
      highlights: string[];
      tierDef: RpgTierDef;
      xpEarned: number;
      levelsGained: number;
      hitGate: boolean;
      grossCoins: number;
      garnishedCoins: number;
      netCoins: number;
      dustEarned: number;
      pillsFound: number;
      elixirsFound: number;
      bankedItems: RpgItem[];
      legendaryDrops: RpgItem[];
      autoSalvagedCount: number;
      autoSalvagedCoins: number;
      autoSalvagedDust: number;
      character: RpgCharacter;
      balance: number;
    }
  | { ok: false; reason: 'no_class_selected' | 'insufficient_stamina' };

export type ChallengeAbyssBossResult =
  | {
      ok: true;
      won: boolean;
      isFirstClear: boolean;
      staminaSpent: number;
      tier: number;
      tierDef: RpgTierDef;
      bossName: string;
      bossMaxHp: number;
      bossRemainingHp: number;
      roundsPlayed: number;
      rating: RpgBattleRating;
      highlights: string[];
      xpEarned: number;
      levelsGained: number;
      hitGate: boolean;
      grossCoins: number;
      garnishedCoins: number;
      netCoins: number;
      dustEarned: number;
      bankedItems: RpgItem[];
      legendaryDrops: RpgItem[];
      autoSalvagedCount: number;
      autoSalvagedCoins: number;
      autoSalvagedDust: number;
      character: RpgCharacter;
      balance: number;
    }
  | { ok: false; reason: 'no_class_selected' | 'insufficient_stamina' };

export function bankLootInTx(ctx: RpgOpsContext, input: BankLootInput): BankLootResult {
  const cfg = ctx.getConfig(input.guildId);
  const currentItemCount = ctx.rpgRepo.countItems(input.guildId, input.userId);
  const availableSlots = Math.max(0, cfg.bagCapacity - currentItemCount);

  const sortedPending = [...input.pendingItems].sort(
    (a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity],
  );

  const bankedItems: RpgItem[] = [];
  let autoSalvagedCount = 0;
  let autoSalvagedCoins = 0;
  let autoSalvagedDust = 0;

  for (const item of sortedPending) {
    if (bankedItems.length < availableSlots) {
      const created = ctx.rpgRepo.createItem({
        guildId: input.guildId,
        userId: input.userId,
        name: item.name,
        slot: item.slot,
        rarity: item.rarity,
        baseHp: item.baseHp,
        baseAtk: item.baseAtk,
        baseDef: item.baseDef,
        baseCritBp: item.baseCritBp,
        enhanceLevel: 0,
        equipped: false,
        affixes: item.affixes,
        legendaryEffect: item.legendaryEffect,
        affixesAwakened: true,
        createdAt: input.nowMs,
      });
      bankedItems.push(created);
    } else {
      autoSalvagedCount += 1;
      autoSalvagedCoins += getSalvageValue({ rarity: item.rarity, enhanceLevel: 0 });
      autoSalvagedDust += getSalvageArcaneDust({ rarity: item.rarity, enhanceLevel: 0 });
    }
  }

  const coinRes = ctx.applyCoinRewardInTx(
    input.guildId,
    input.userId,
    Math.max(0, Math.floor(input.coinGain)) + autoSalvagedCoins,
    input.source,
    input.nowMs,
  );

  const dustEarned = Math.max(0, Math.floor(input.dustGain ?? 0)) + autoSalvagedDust;
  const { updated: leveledChar, levelsGained, hitGate } = applyCharacterXp(
    input.character,
    input.xpGain,
  );

  const legendaryDrops = bankedItems.filter((item) => item.rarity === 'legendary');

  return {
    bankedItems,
    legendaryDrops,
    autoSalvagedCount,
    autoSalvagedCoins,
    autoSalvagedDust,
    dustEarned,
    grossCoins: coinRes.grossCoins,
    garnishedCoins: coinRes.garnishedCoins,
    netCoins: coinRes.netCoins,
    levelsGained,
    hitGate,
    updatedCharacter: {
      ...leveledChar,
      arcaneDust: leveledChar.arcaneDust + dustEarned,
      updatedAt: input.nowMs,
    },
    balance: coinRes.balance,
  };
}

export function raidBoss(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  mode: 'single' | 'all',
  nowMs = Date.now(),
  rng: () => number = Math.random,
): RaidBossResult {
  return ctx.db.transaction((): RaidBossResult => {
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    if (!character.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }
    if (character.stamina < 1) {
      return { ok: false, reason: 'insufficient_stamina' };
    }

    const runsExecuted = mode === 'all' ? character.stamina : 1;
    const realm = getRpgRealmInfo(character.level);
    const tierDef = realm.tierDef;
    const heroSnapshot = ctx.buildCombatantForCharacter(character);
    const bossSnapshot = buildTierBossCombatant(tierDef.tier, 'normal');
    const greedMult = 1 + heroSnapshot.affixes.greedBp / 10_000;

    let totalXp = 0;
    let totalCoins = 0;
    let baseDustGain = 0;
    let pillsFound = 0;
    let elixirsFound = 0;
    const pendingItems: PendingRpgItem[] = [];
    let lastReport: RpgBattleReport | null = null;
    let lastRating: RpgBattleRating = 'B';

    for (let i = 0; i < runsExecuted; i++) {
      const report = simulateRpgBattle(heroSnapshot, bossSnapshot, { mode: 'full', rng });
      lastReport = report;
      const runRating: RpgBattleRating = report.winner === 'left' ? report.rating : 'B';
      lastRating = runRating;
      const ratingMult = computeRatingMultiplier(runRating);
      const dropChance = runRating === 'SSS' ? 0.92 : runRating === 'S' ? 0.85 : 0.75;

      const xpVar = 0.9 + clampUnit(rng()) * 0.2;
      const coinVar = 0.9 + clampUnit(rng()) * 0.2;
      totalXp += Math.max(10, Math.round(tierDef.idleXpPerHour * 0.75 * ratingMult * xpVar));
      totalCoins += Math.max(
        50,
        Math.round(tierDef.idleCoinsPerHour * 0.95 * ratingMult * coinVar * greedMult),
      );
      baseDustGain += Math.max(2, Math.round((4 + tierDef.tier * 3) * ratingMult * greedMult));

      if (clampUnit(rng()) < dropChance) {
        pendingItems.push(generateTierItem(tierDef.tier, 'boss', rng));
      }
      if (clampUnit(rng()) < 0.35) {
        pillsFound += 1;
      }
      if (clampUnit(rng()) < 0.15) {
        elixirsFound += 1;
      }
    }

    const banked = ctx.bankLootInTx({
      guildId,
      userId,
      character: {
        ...character,
        stamina: character.stamina - runsExecuted,
      },
      xpGain: totalXp,
      coinGain: totalCoins,
      dustGain: baseDustGain,
      pendingItems,
      source: `rpg_raid_tier${tierDef.tier}`,
      nowMs,
    });

    const finalCharacter: RpgCharacter = {
      ...banked.updatedCharacter,
      totalClears: banked.updatedCharacter.totalClears + runsExecuted,
      totalBossKills: banked.updatedCharacter.totalBossKills + runsExecuted,
      promoPills: banked.updatedCharacter.promoPills + pillsFound,
      guardElixirs: banked.updatedCharacter.guardElixirs + elixirsFound,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(finalCharacter);

    return {
      ok: true,
      runsExecuted,
      rating: lastRating,
      roundsPlayed: lastReport?.roundsPlayed ?? 1,
      highlights: lastReport?.highlights ?? [],
      tierDef,
      xpEarned: totalXp,
      levelsGained: banked.levelsGained,
      hitGate: banked.hitGate,
      grossCoins: banked.grossCoins,
      garnishedCoins: banked.garnishedCoins,
      netCoins: banked.netCoins,
      dustEarned: banked.dustEarned,
      pillsFound,
      elixirsFound,
      bankedItems: banked.bankedItems,
      legendaryDrops: banked.legendaryDrops,
      autoSalvagedCount: banked.autoSalvagedCount,
      autoSalvagedCoins: banked.autoSalvagedCoins,
      autoSalvagedDust: banked.autoSalvagedDust,
      character: finalCharacter,
      balance: banked.balance,
    };
  })();
}

export function challengeAbyssBoss(
  ctx: RpgOpsContext,
  guildId: string,
  userId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): ChallengeAbyssBossResult {
  return ctx.db.transaction((): ChallengeAbyssBossResult => {
    const character = ctx.getOrCreateCharacterInTx(guildId, userId, nowMs);
    if (!character.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }

    const realm = getRpgRealmInfo(character.level);
    const tier = realm.tier;
    const tierDef = realm.tierDef;
    const isFirstClearAttempt = tier > character.abyssClearedTier;

    if (!isFirstClearAttempt && character.stamina < 1) {
      return { ok: false, reason: 'insufficient_stamina' };
    }

    const heroSnapshot = ctx.buildCombatantForCharacter(character);
    const bossSnapshot = buildTierBossCombatant(tier, 'abyss');
    const report = simulateRpgBattle(heroSnapshot, bossSnapshot, { mode: 'full', rng });

    if (report.winner !== 'left') {
      const profile = ctx.profileRepo.getOrCreate(guildId, userId);
      return {
        ok: true,
        won: false,
        isFirstClear: false,
        staminaSpent: 0,
        tier,
        tierDef,
        bossName: bossSnapshot.name,
        bossMaxHp: bossSnapshot.maxHp,
        bossRemainingHp: report.rightRemainingHp,
        roundsPlayed: report.roundsPlayed,
        rating: report.rating,
        highlights: report.highlights,
        xpEarned: 0,
        levelsGained: 0,
        hitGate: isAtBreakthroughGate(character.level, character.xp),
        grossCoins: 0,
        garnishedCoins: 0,
        netCoins: 0,
        dustEarned: 0,
        bankedItems: [],
        legendaryDrops: [],
        autoSalvagedCount: 0,
        autoSalvagedCoins: 0,
        autoSalvagedDust: 0,
        character,
        balance: profile.coins,
      };
    }

    const greedMult = 1 + heroSnapshot.affixes.greedBp / 10_000;
    const staminaSpent = isFirstClearAttempt ? 0 : 1;
    const xpGain = isFirstClearAttempt
      ? Math.max(50, Math.round(tierDef.idleXpPerHour * 1.5))
      : Math.max(30, Math.round(tierDef.idleXpPerHour * 1.1));
    const coinGain = isFirstClearAttempt
      ? Math.round((tier * 12_000 + tierDef.idleCoinsPerHour * 2) * greedMult)
      : Math.round(tierDef.idleCoinsPerHour * 1.4 * greedMult);
    const baseDustGain = isFirstClearAttempt
      ? tier * 35
      : Math.max(10, Math.round((12 + tier * 6) * greedMult));

    const minDropRarity: RpgItemRarity = isFirstClearAttempt ? 'epic' : 'rare';
    const pendingItems: PendingRpgItem[] = [
      generateTierItem(tier, 'abyss', rng, minDropRarity),
    ];

    const banked = ctx.bankLootInTx({
      guildId,
      userId,
      character: {
        ...character,
        stamina: character.stamina - staminaSpent,
        abyssClearedTier: Math.max(character.abyssClearedTier, tier),
      },
      xpGain,
      coinGain,
      dustGain: baseDustGain,
      pendingItems,
      source: isFirstClearAttempt
        ? `rpg_abyss_first_clear_tier${tier}`
        : `rpg_abyss_farm_tier${tier}`,
      nowMs,
    });

    const finalCharacter: RpgCharacter = {
      ...banked.updatedCharacter,
      totalClears: banked.updatedCharacter.totalClears + 1,
      totalBossKills: banked.updatedCharacter.totalBossKills + 1,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(finalCharacter);

    return {
      ok: true,
      won: true,
      isFirstClear: isFirstClearAttempt,
      staminaSpent,
      tier,
      tierDef,
      bossName: bossSnapshot.name,
      bossMaxHp: bossSnapshot.maxHp,
      bossRemainingHp: report.rightRemainingHp,
      roundsPlayed: report.roundsPlayed,
      rating: report.rating,
      highlights: report.highlights,
      xpEarned: xpGain,
      levelsGained: banked.levelsGained,
      hitGate: banked.hitGate,
      grossCoins: banked.grossCoins,
      garnishedCoins: banked.garnishedCoins,
      netCoins: banked.netCoins,
      dustEarned: banked.dustEarned,
      bankedItems: banked.bankedItems,
      legendaryDrops: banked.legendaryDrops,
      autoSalvagedCount: banked.autoSalvagedCount,
      autoSalvagedCoins: banked.autoSalvagedCoins,
      autoSalvagedDust: banked.autoSalvagedDust,
      character: finalCharacter,
      balance: banked.balance,
    };
  })();
}

export function createWorldBossBridge(
  ctx: RpgOpsContext,
  rng: () => number = Math.random,
): RpgWorldBossBridge {
  return {
    getBossAttackBonus: (guildId, userId, mode, _nowMs) => {
      const character = ctx.rpgRepo.getCharacter(guildId, userId);
      if (!character || !character.classSelected) {
        return null;
      }
      const stats = ctx.computeCombatStatsForCharacter(character);
      const realm = getRpgRealmInfo(character.level);
      const classDef = RPG_CLASS_MAP.get(character.classKey) ?? RPG_CLASSES[0]!;

      const rawNormal = Math.max(8, Math.round(stats.atk * 0.35 + realm.tier * 6));
      const bonusDamage =
        mode === 'heavy'
          ? Math.min(WORLD_BOSS_HEAVY_BONUS_CAP, Math.round(rawNormal * 1.5))
          : Math.min(WORLD_BOSS_NORMAL_BONUS_CAP, rawNormal);

      return {
        bonusDamage,
        classEmoji: classDef.emoji,
        realmLabel: `${realm.tierDef.name}·${realm.stageZh}`,
      };
    },

    awardBossKillDust: (guildId, participantUserIds, mvpUserId, _nowMs) => {
      return ctx.db.transaction(() => {
        const awarded = new Map<string, number>();
        const uniqueUsers = new Set<string>(participantUserIds);
        for (const uid of uniqueUsers) {
          const character = ctx.rpgRepo.getCharacter(guildId, uid);
          if (!character || !character.classSelected) {
            continue;
          }
          const baseDust = 8 + Math.floor(clampUnit(rng()) * 11); // 8..18 inclusive
          const totalDust = baseDust + (uid === mvpUserId ? 8 : 0);
          ctx.rpgRepo.addArcaneDust(guildId, uid, totalDust);
          awarded.set(uid, totalDust);
        }
        return awarded;
      })();
    },
  };
}
