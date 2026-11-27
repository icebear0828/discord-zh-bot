import { PET_MAX_LEVEL } from '../../config/economyConstants.js';
import type { ShopRepo } from '../../db/repositories/shopRepo.js';
import type { PetRarity, Relationship, UserPet } from '../../db/repositories/socialPetRepo.js';
import {
  GROWTH_BY_RARITY,
  MARRIAGE_MILESTONES,
  RELEASE_REFUND_RATIOS,
  SWORN_MILESTONES,
} from './socialPetCatalogAndTypes.js';

export function unlockRelationshipMilestoneTitles(
  shopRepo: ShopRepo,
  rel: Relationship,
  oldAffinity: number,
  nextAffinity: number,
  nowMs: number,
): string[] {
  const milestones = rel.relType === 'marriage' ? MARRIAGE_MILESTONES : SWORN_MILESTONES;
  const unlockedTitles: string[] = [];
  for (const m of milestones) {
    if (oldAffinity < m.threshold && nextAffinity >= m.threshold) {
      for (const uid of [rel.userA, rel.userB]) {
        const owned = shopRepo.findInventoryByTypeAndName(rel.guildId, uid, 'title', m.title);
        if (!owned) {
          shopRepo.addInventoryItem({
            guildId: rel.guildId,
            userId: uid,
            itemType: 'title',
            itemName: m.title,
            payloadJson: JSON.stringify({ titleText: m.title }),
            quantity: 1,
            acquiredAt: nowMs,
          });
        }
      }
      unlockedTitles.push(m.title);
    }
  }
  return unlockedTitles;
}

export function calculatePetReleaseRefund(rarity: PetRarity, petGachaPrice: number): number {
  const safePrice = Math.max(0, Math.floor(petGachaPrice));
  return Math.max(1, Math.floor(safePrice * RELEASE_REFUND_RATIOS[rarity]));
}

export function xpNeededForPetLevel(level: number): number {
  return Math.max(60, level * 60);
}

export function applyPetXp(
  pet: UserPet,
  gainXp: number,
): { updatedPet: UserPet; leveledUp: boolean; levelsGained: number } {
  if (pet.level >= PET_MAX_LEVEL) {
    return {
      updatedPet: { ...pet, level: PET_MAX_LEVEL, xp: 0 },
      leveledUp: false,
      levelsGained: 0,
    };
  }

  let level = pet.level;
  let xp = pet.xp + Math.max(0, Math.floor(gainXp));
  let hp = pet.hp;
  let atk = pet.atk;
  let spd = pet.spd;
  let levelsGained = 0;
  const growth = GROWTH_BY_RARITY[pet.rarity];

  while (level < PET_MAX_LEVEL && xp >= xpNeededForPetLevel(level)) {
    xp -= xpNeededForPetLevel(level);
    level += 1;
    levelsGained += 1;
    hp += growth.hp;
    atk += growth.atk;
    spd += growth.spd;
  }

  if (level >= PET_MAX_LEVEL) {
    level = PET_MAX_LEVEL;
    xp = 0;
  }

  return {
    updatedPet: { ...pet, level, xp, hp, atk, spd },
    leveledUp: levelsGained > 0,
    levelsGained,
  };
}

export function generatePetStats(
  rarity: PetRarity,
  rng: () => number,
): { hp: number; atk: number; spd: number; critRate: number } {
  const pickInt = (min: number, max: number): number =>
    min + Math.floor(rng() * (max - min + 1));
  const pickRate = (min: number, max: number): number =>
    Number((min + rng() * (max - min)).toFixed(2));

  switch (rarity) {
    case 'N':
      return {
        hp: pickInt(95, 120),
        atk: pickInt(16, 22),
        spd: pickInt(12, 18),
        critRate: pickRate(0.08, 0.12),
      };
    case 'R':
      return {
        hp: pickInt(120, 150),
        atk: pickInt(22, 29),
        spd: pickInt(16, 24),
        critRate: pickRate(0.12, 0.16),
      };
    case 'SR':
      return {
        hp: pickInt(155, 190),
        atk: pickInt(29, 38),
        spd: pickInt(22, 30),
        critRate: pickRate(0.16, 0.22),
      };
    case 'SSR':
      return {
        hp: pickInt(195, 240),
        atk: pickInt(38, 50),
        spd: pickInt(28, 38),
        critRate: pickRate(0.22, 0.30),
      };
  }
}

export function simulatePetBattle(
  challengerPet: UserPet,
  opponentPet: UserPet,
  rng: () => number = Math.random,
): { winnerSide: 'challenger' | 'opponent' | 'draw'; draw: boolean; logs: string[] } {
  let cHp = challengerPet.hp;
  let oHp = opponentPet.hp;
  const logs: string[] = [];

  const challengerFirst =
    challengerPet.spd > opponentPet.spd
      ? true
      : challengerPet.spd < opponentPet.spd
        ? false
        : rng() < 0.5;

  const strike = (
    attacker: UserPet,
    defender: UserPet,
    defenderHp: number,
  ): { nextHp: number; line: string } => {
    if (rng() < 0.08) {
      return {
        nextHp: defenderHp,
        line: `💨 **${attacker.nickname}** 猛扑过去，但 **${defender.nickname}** 灵巧闪避！`,
      };
    }
    const isCrit = rng() < attacker.critRate;
    const raw = attacker.atk * (0.85 + rng() * 0.3) * (isCrit ? 1.6 : 1);
    const dmg = Math.max(5, Math.round(raw));
    const nextHp = Math.max(0, defenderHp - dmg);
    const critTag = isCrit ? '💥 暴击！' : '';
    return {
      nextHp,
      line: `${critTag}**${attacker.nickname}** 造成 **${dmg}** 伤害（${defender.nickname} HP: ${nextHp}/${defender.hp}）`,
    };
  };

  for (let round = 1; round <= 12; round++) {
    const roundHeader = `【第 ${round} 回合】`;
    if (challengerFirst) {
      const hit1 = strike(challengerPet, opponentPet, oHp);
      oHp = hit1.nextHp;
      logs.push(`${roundHeader}${hit1.line}`);
      if (oHp <= 0) break;

      const hit2 = strike(opponentPet, challengerPet, cHp);
      cHp = hit2.nextHp;
      logs.push(`${roundHeader}${hit2.line}`);
      if (cHp <= 0) break;
    } else {
      const hit1 = strike(opponentPet, challengerPet, cHp);
      cHp = hit1.nextHp;
      logs.push(`${roundHeader}${hit1.line}`);
      if (cHp <= 0) break;

      const hit2 = strike(challengerPet, opponentPet, oHp);
      oHp = hit2.nextHp;
      logs.push(`${roundHeader}${hit2.line}`);
      if (oHp <= 0) break;
    }
  }

  let winnerSide: 'challenger' | 'opponent' | 'draw';
  if (oHp <= 0 && cHp > 0) {
    winnerSide = 'challenger';
  } else if (cHp <= 0 && oHp > 0) {
    winnerSide = 'opponent';
  } else if (cHp <= 0 && oHp <= 0) {
    winnerSide = 'draw';
    logs.push('⌛ 回合耗尽！双方同归于尽，本场判为平局，赌注原路退还！');
  } else {
    const cRatio = cHp / Math.max(1, challengerPet.hp);
    const oRatio = oHp / Math.max(1, opponentPet.hp);
    const cPct = Math.round(cRatio * 100);
    const oPct = Math.round(oRatio * 100);
    if (Math.abs(cRatio - oRatio) < 1e-9) {
      winnerSide = 'draw';
      logs.push(`⌛ 回合耗尽！双方剩余血量比例相同（${cPct}%），本场判为平局，赌注原路退还！`);
    } else if (cRatio > oRatio) {
      winnerSide = 'challenger';
      logs.push(
        `⌛ 回合耗尽！按血量比例判定 **${challengerPet.nickname}** 险胜（${cPct}% vs ${oPct}%）。`,
      );
    } else {
      winnerSide = 'opponent';
      logs.push(
        `⌛ 回合耗尽！按血量比例判定 **${opponentPet.nickname}** 险胜（${oPct}% vs ${cPct}%）。`,
      );
    }
  }

  return { winnerSide, draw: winnerSide === 'draw', logs: logs.slice(-8) };
}
