import {
  PET_WORK_COOLDOWN_MS,
  PET_WORK_LEVEL_BONUS_CAP,
} from '../../config/economyConstants.js';
import type { PetRarity, UserPet } from '../../db/repositories/socialPetRepo.js';
import { getDateKey } from '../economyService.js';
import {
  applyPetXp,
  calculatePetReleaseRefund,
  generatePetStats,
} from './petMathAndBattleSim.js';
import {
  PET_SPECIES,
  PET_TRAIN_COOLDOWN_MS,
  PET_TRAITS,
  type PetFeedResult,
  type PetReleaseResult,
  type PetRenameResult,
  type PetTrainResult,
  type PetWorkResult,
  type PullPetGachaResult,
  type SocialPetOpsDeps,
} from './socialPetCatalogAndTypes.js';

export function hasPendingBattleForPetOp(
  deps: SocialPetOpsDeps,
  petId: number,
  nowMs = Date.now(),
): boolean {
  const row = deps.db
    .prepare(
      `SELECT id FROM pet_battles
       WHERE status = 'pending'
         AND expires_at > ?
         AND (challenger_pet_id = ? OR opponent_pet_id = ?)
       LIMIT 1`,
    )
    .get(nowMs, petId, petId) as { id: number } | undefined;
  return row !== undefined;
}

export function pullPetGachaOp(
  deps: SocialPetOpsDeps,
  guildId: string,
  ownerId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): PullPetGachaResult {
  const cfg = deps.configRepo.getOrCreate(guildId).games;
  const price = Math.max(0, cfg.petGachaPrice);
  const maxOwned = Math.max(1, cfg.petMaxOwned);

  return deps.db.transaction((): PullPetGachaResult => {
    if (deps.creditLoanService?.isDeadbeatBlocked(guildId, ownerId, nowMs).blocked) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }
    const owned = deps.socialPetRepo.listUserPets(guildId, ownerId);
    if (owned.length >= maxOwned) {
      return { ok: false, reason: 'max_owned_reached', maxOwned };
    }

    const profile = deps.profileRepo.getOrCreate(guildId, ownerId);
    if (profile.coins < price) {
      return { ok: false, reason: 'insufficient_funds', price };
    }

    const balance = profile.coins - price;
    deps.profileRepo.save({ ...profile, coins: balance });

    const roll = rng();
    let rarity: PetRarity = 'N';
    if (roll >= 0.97) {
      rarity = 'SSR';
    } else if (roll >= 0.85) {
      rarity = 'SR';
    } else if (roll >= 0.55) {
      rarity = 'R';
    }

    const pool = PET_SPECIES.filter((s) => s.rarity === rarity);
    const species = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
    const stats = generatePetStats(rarity, rng);
    const trait =
      PET_TRAITS[Math.min(PET_TRAITS.length - 1, Math.floor(rng() * PET_TRAITS.length))]!;

    const pet = deps.socialPetRepo.createPet({
      guildId,
      ownerId,
      speciesKey: species.key,
      nickname: species.name,
      rarity,
      hp: stats.hp,
      atk: stats.atk,
      spd: stats.spd,
      critRate: stats.critRate,
      trait,
      isActive: owned.length === 0,
      createdAt: nowMs,
    });

    return {
      ok: true,
      pet,
      species,
      price,
      balance,
      isHighRarity: rarity === 'SSR',
    };
  })();
}

export function setActivePetOp(
  deps: SocialPetOpsDeps,
  guildId: string,
  ownerId: string,
  petId: number,
): UserPet | null {
  const pet = deps.socialPetRepo.getPetById(petId);
  if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) return null;
  deps.socialPetRepo.setActivePet(guildId, ownerId, petId);
  return deps.socialPetRepo.getPetById(petId);
}

export function renamePetOp(
  deps: SocialPetOpsDeps,
  guildId: string,
  ownerId: string,
  petId: number,
  rawName: string,
): PetRenameResult {
  const clean = rawName.trim();
  if (clean.length === 0 || clean.length > 20) {
    return { ok: false, reason: 'invalid_name' };
  }
  const pet = deps.socialPetRepo.getPetById(petId);
  if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) {
    return { ok: false, reason: 'not_found' };
  }
  const updated: UserPet = { ...pet, nickname: clean };
  deps.socialPetRepo.savePet(updated);
  return { ok: true, pet: updated };
}

export function releasePetOp(
  deps: SocialPetOpsDeps,
  guildId: string,
  ownerId: string,
  petId: number,
  nowMs = Date.now(),
): PetReleaseResult {
  const cfg = deps.configRepo.getOrCreate(guildId).games;
  return deps.db.transaction((): PetReleaseResult => {
    const pet = deps.socialPetRepo.getPetById(petId);
    if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) {
      return { ok: false, reason: 'not_found' };
    }

    const pendingBattles = deps.db
      .prepare(
        `SELECT id, expires_at FROM pet_battles
         WHERE status = 'pending' AND (challenger_pet_id = ? OR opponent_pet_id = ?)`,
      )
      .all(petId, petId) as Array<{ id: number; expires_at: number }>;

    for (const row of pendingBattles) {
      if (row.expires_at > nowMs) {
        return { ok: false, reason: 'pet_in_battle' };
      }
      const stale = deps.socialPetRepo.getPetBattleById(row.id);
      if (stale && stale.status === 'pending' && stale.expiresAt <= nowMs) {
        deps.socialPetRepo.savePetBattle({ ...stale, status: 'expired' });
        if (stale.bet > 0) {
          deps.profileRepo.addCoins(stale.guildId, stale.challengerId, stale.bet);
        }
      }
    }

    deps.socialPetRepo.deletePet(petId, guildId, ownerId);
    const refund = calculatePetReleaseRefund(pet.rarity, cfg.petGachaPrice);
    const updatedProfile = deps.profileRepo.addCoins(guildId, ownerId, refund);

    if (pet.isActive) {
      const remaining = deps.socialPetRepo.listUserPets(guildId, ownerId);
      if (remaining.length > 0) {
        deps.socialPetRepo.setActivePet(guildId, ownerId, remaining[0]!.id);
      }
    }

    return { ok: true, releasedPet: pet, refund, balance: updatedProfile.coins };
  })();
}

export function feedPetOp(
  deps: SocialPetOpsDeps,
  guildId: string,
  ownerId: string,
  petId: number,
  nowMs = Date.now(),
): PetFeedResult {
  const cfg = deps.configRepo.getOrCreate(guildId).games;
  const cost = Math.max(0, cfg.petFeedPrice);
  const today = getDateKey(nowMs, deps.timezone);

  return deps.db.transaction((): PetFeedResult => {
    const pet = deps.socialPetRepo.getPetById(petId);
    if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) {
      return { ok: false, reason: 'not_found' };
    }
    if (pet.lastFeedDate === today) {
      return { ok: false, reason: 'already_fed_today' };
    }

    const profile = deps.profileRepo.getOrCreate(guildId, ownerId);
    if (profile.coins < cost) {
      return { ok: false, reason: 'insufficient_funds', cost };
    }
    const balance = profile.coins - cost;
    if (cost > 0) {
      deps.profileRepo.save({ ...profile, coins: balance });
    }

    const { updatedPet, leveledUp } = applyPetXp({ ...pet, lastFeedDate: today }, 40);
    deps.socialPetRepo.savePet(updatedPet);

    return { ok: true, pet: updatedPet, cost, balance, leveledUp };
  })();
}

export function trainPetOp(
  deps: SocialPetOpsDeps,
  guildId: string,
  ownerId: string,
  petId: number,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): PetTrainResult {
  return deps.db.transaction((): PetTrainResult => {
    const pet = deps.socialPetRepo.getPetById(petId);
    if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) {
      return { ok: false, reason: 'not_found' };
    }
    const elapsed = nowMs - pet.lastTrainAt;
    if (pet.lastTrainAt > 0 && elapsed < PET_TRAIN_COOLDOWN_MS) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterSec: Math.ceil((PET_TRAIN_COOLDOWN_MS - elapsed) / 1000),
      };
    }

    const gainXp = 20 + Math.floor(rng() * 16);
    const { updatedPet, leveledUp } = applyPetXp({ ...pet, lastTrainAt: nowMs }, gainXp);
    deps.socialPetRepo.savePet(updatedPet);
    return { ok: true, pet: updatedPet, gainXp, leveledUp };
  })();
}

export function workWithPetOp(
  deps: SocialPetOpsDeps,
  guildId: string,
  ownerId: string,
  petId: number,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): PetWorkResult {
  return deps.db.transaction((): PetWorkResult => {
    const pet = deps.socialPetRepo.getPetById(petId);
    if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) {
      return { ok: false, reason: 'not_found' };
    }
    const profile = deps.profileRepo.getOrCreate(guildId, ownerId);
    const lastWork = Math.max(profile.lastPetWorkAt, pet.lastWorkAt);
    const elapsed = nowMs - lastWork;
    if (lastWork > 0 && elapsed < PET_WORK_COOLDOWN_MS) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterSec: Math.ceil((PET_WORK_COOLDOWN_MS - elapsed) / 1000),
      };
    }

    const rangeByRarity: Record<PetRarity, [number, number]> = {
      N: [60, 110],
      R: [90, 150],
      SR: [130, 210],
      SSR: [180, 280],
    };
    const [min, max] = rangeByRarity[pet.rarity];
    const baseEarned = min + Math.floor(rng() * (max - min + 1));
    const levelBonus = Math.min(PET_WORK_LEVEL_BONUS_CAP, Math.max(0, pet.level - 1) * 15);
    const coinsEarned = baseEarned + levelBonus;
    const gainXp = 15;

    const nextCoins = profile.coins + coinsEarned;
    deps.profileRepo.save({ ...profile, coins: nextCoins, lastPetWorkAt: nowMs });
    const { updatedPet, leveledUp } = applyPetXp({ ...pet, lastWorkAt: nowMs }, gainXp);
    deps.socialPetRepo.savePet(updatedPet);

    return {
      ok: true,
      pet: updatedPet,
      coinsEarned,
      balance: nextCoins,
      gainXp,
      leveledUp,
    };
  })();
}
