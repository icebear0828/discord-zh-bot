import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { ShopRepo } from '../db/repositories/shopRepo.js';
import type {
  PetBattle,
  PetRarity,
  Relationship,
  RelationshipProposal,
  RelationshipType,
  SocialPetRepo,
  UserPet,
} from '../db/repositories/socialPetRepo.js';
import { getDateKey } from './economyService.js';

export interface PetSpecies {
  key: string;
  name: string;
  emoji: string;
  rarity: PetRarity;
}

export const PET_SPECIES: readonly PetSpecies[] = [
  // N (7)
  { key: 'shiba', name: '柴犬汪财', emoji: '🐕', rarity: 'N' },
  { key: 'orange_cat', name: '摸鱼橘猫', emoji: '🐈', rarity: 'N' },
  { key: 'hamster', name: '社恐仓鼠', emoji: '🐹', rarity: 'N' },
  { key: 'koala', name: '熬夜考拉', emoji: '🐨', rarity: 'N' },
  { key: 'duck', name: '脆皮鸭', emoji: '🦆', rarity: 'N' },
  { key: 'cactus', name: '工位仙人掌', emoji: '🌵', rarity: 'N' },
  { key: 'hedgehog', name: '吃瓜刺猬', emoji: '🦔', rarity: 'N' },
  // R (6)
  { key: 'alpaca', name: '铁头羊驼', emoji: '🦙', rarity: 'R' },
  { key: 'parrot', name: '嘴强鹦鹉', emoji: '🦜', rarity: 'R' },
  { key: 'raccoon', name: '闪电干脆面', emoji: '🦝', rarity: 'R' },
  { key: 'collie', name: '卷王边牧', emoji: '🐶', rarity: 'R' },
  { key: 'blowfish', name: '暴躁河豚', emoji: '🐡', rarity: 'R' },
  { key: 'sloth', name: '带薪树懒', emoji: '🦥', rarity: 'R' },
  // SR (4)
  { key: 'cyber_wolf', name: '赛博机械狼', emoji: '🐺', rarity: 'SR' },
  { key: 'panther', name: '暗夜黑豹', emoji: '🐆', rarity: 'SR' },
  { key: 'fox', name: '炼丹九尾狐', emoji: '🦊', rarity: 'SR' },
  { key: 'koi', name: '欧皇锦鲤', emoji: '🎏', rarity: 'SR' },
  // SSR (3)
  { key: 'fish_dragon', name: '九天摸鱼神龙', emoji: '🐉', rarity: 'SSR' },
  { key: 'pixiu', name: '星界财神貔貅', emoji: '🦁', rarity: 'SSR' },
  { key: 'dino', name: '灭世暴龙兽', emoji: '🦖', rarity: 'SSR' },
];

export const PET_SPECIES_MAP: ReadonlyMap<string, PetSpecies> = new Map(
  PET_SPECIES.map((s) => [s.key, s]),
);

const PET_TRAITS = ['贪吃', '暴躁', '幸运', '摸鱼', '社牛', '铁头', '腹黑', '佛系'];

const MARRIAGE_MILESTONES: ReadonlyArray<{ threshold: number; title: string }> = [
  { threshold: 50, title: '💞 甜蜜新婚' },
  { threshold: 150, title: '💍 灵魂伴侣' },
  { threshold: 400, title: '👑 模范神仙眷侣' },
];

const SWORN_MILESTONES: ReadonlyArray<{ threshold: number; title: string }> = [
  { threshold: 50, title: '🍻 铁血死党' },
  { threshold: 150, title: '🔥 生死之交' },
  { threshold: 400, title: '⚔️ 传奇结拜兄弟' },
];

const RELEASE_REFUNDS: Record<PetRarity, number> = {
  N: 100,
  R: 200,
  SR: 400,
  SSR: 1000,
};

const GROWTH_BY_RARITY: Record<PetRarity, { hp: number; atk: number; spd: number }> = {
  N: { hp: 12, atk: 3, spd: 2 },
  R: { hp: 16, atk: 4, spd: 2 },
  SR: { hp: 20, atk: 5, spd: 3 },
  SSR: { hp: 26, atk: 6, spd: 4 },
};

const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const PET_TRAIN_COOLDOWN_MS = 3600 * 1000;
const PET_WORK_COOLDOWN_MS = 2 * 3600 * 1000;
const PET_BATTLE_TTL_MS = 10 * 60 * 1000;

export function xpNeededForPetLevel(level: number): number {
  return Math.max(60, level * 60);
}

export function applyPetXp(
  pet: UserPet,
  gainXp: number,
): { updatedPet: UserPet; leveledUp: boolean; levelsGained: number } {
  let level = pet.level;
  let xp = pet.xp + Math.max(0, Math.floor(gainXp));
  let hp = pet.hp;
  let atk = pet.atk;
  let spd = pet.spd;
  let levelsGained = 0;
  const growth = GROWTH_BY_RARITY[pet.rarity];

  while (xp >= xpNeededForPetLevel(level)) {
    xp -= xpNeededForPetLevel(level);
    level += 1;
    levelsGained += 1;
    hp += growth.hp;
    atk += growth.atk;
    spd += growth.spd;
  }

  return {
    updatedPet: { ...pet, level, xp, hp, atk, spd },
    leveledUp: levelsGained > 0,
    levelsGained,
  };
}

export function simulatePetBattle(
  challengerPet: UserPet,
  opponentPet: UserPet,
  rng: () => number = Math.random,
): { winnerSide: 'challenger' | 'opponent'; logs: string[] } {
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

  let winnerSide: 'challenger' | 'opponent';
  if (oHp <= 0 && cHp > 0) {
    winnerSide = 'challenger';
  } else if (cHp <= 0 && oHp > 0) {
    winnerSide = 'opponent';
  } else {
    const cRatio = cHp / Math.max(1, challengerPet.hp);
    const oRatio = oHp / Math.max(1, opponentPet.hp);
    winnerSide = cRatio >= oRatio ? 'challenger' : 'opponent';
  }

  return { winnerSide, logs: logs.slice(-8) };
}

export type CreateProposalResult =
  | { ok: true; proposal: RelationshipProposal; cost: number; balance: number }
  | {
      ok: false;
      reason:
        | 'self_target'
        | 'already_related'
        | 'proposer_married'
        | 'target_married'
        | 'proposer_max_sworn'
        | 'target_max_sworn'
        | 'insufficient_funds';
      cost?: number;
      maxSworn?: number;
    };

export type AcceptProposalResult =
  | { ok: true; proposal: RelationshipProposal; relationship: Relationship }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_target'
        | 'already_resolved'
        | 'expired'
        | 'conflict_refunded';
    };

export type DeclineProposalResult =
  | { ok: true; proposal: RelationshipProposal; refunded: number }
  | {
      ok: false;
      reason: 'not_found' | 'not_participant' | 'already_resolved' | 'expired';
    };

export type CheckinRelationshipResult =
  | {
      ok: true;
      relationship: Relationship;
      gain: number;
      unlockedTitles: string[];
    }
  | { ok: false; reason: 'not_found' | 'not_member' | 'already_checked_in' };

export type DissolveRelationshipResult =
  | { ok: true; relationship: Relationship }
  | { ok: false; reason: 'not_found' | 'not_member' };

export type PullPetGachaResult =
  | {
      ok: true;
      pet: UserPet;
      species: PetSpecies;
      price: number;
      balance: number;
      isHighRarity: boolean;
    }
  | { ok: false; reason: 'max_owned_reached' | 'insufficient_funds'; price?: number; maxOwned?: number };

export type PetFeedResult =
  | { ok: true; pet: UserPet; cost: number; balance: number; leveledUp: boolean }
  | { ok: false; reason: 'not_found' | 'already_fed_today' | 'insufficient_funds'; cost?: number };

export type PetTrainResult =
  | { ok: true; pet: UserPet; gainXp: number; leveledUp: boolean }
  | { ok: false; reason: 'not_found' | 'cooldown'; retryAfterSec?: number };

export type PetWorkResult =
  | { ok: true; pet: UserPet; coinsEarned: number; balance: number; gainXp: number; leveledUp: boolean }
  | { ok: false; reason: 'not_found' | 'cooldown'; retryAfterSec?: number };

export type PetRenameResult =
  | { ok: true; pet: UserPet }
  | { ok: false; reason: 'not_found' | 'invalid_name' };

export type PetReleaseResult =
  | { ok: true; releasedPet: UserPet; refund: number; balance: number }
  | { ok: false; reason: 'not_found' };

export type CreatePetBattleResult =
  | { ok: true; battle: PetBattle; challengerPet: UserPet }
  | { ok: false; reason: 'self_target' | 'invalid_bet' | 'no_active_pet' | 'insufficient_funds' };

export type AcceptPetBattleResult =
  | {
      ok: true;
      battle: PetBattle;
      challengerPet: UserPet;
      opponentPet: UserPet;
      winnerId: string;
      loserId: string;
      winnerPet: UserPet;
      loserPet: UserPet;
      challengerBalance: number;
      opponentBalance: number;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'already_resolved'
        | 'expired'
        | 'not_opponent'
        | 'cannot_accept_self'
        | 'no_active_pet'
        | 'challenger_no_pet'
        | 'challenger_insufficient_funds'
        | 'opponent_insufficient_funds';
    };

export type DeclinePetBattleResult =
  | { ok: true; battle: PetBattle }
  | { ok: false; reason: 'not_found' | 'not_participant' | 'already_resolved' | 'expired' };

export class SocialPetService {
  constructor(
    private readonly db: Database.Database,
    private readonly configRepo: GuildConfigRepo,
    private readonly profileRepo: ProfileRepo,
    private readonly shopRepo: ShopRepo,
    private readonly socialPetRepo: SocialPetRepo,
    private readonly timezone = 'Asia/Shanghai',
  ) {}

  // Relationships
  listUserRelationships(guildId: string, userId: string): Relationship[] {
    return this.socialPetRepo.listUserRelationships(guildId, userId);
  }

  listAffinityLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): { items: Relationship[]; total: number } {
    return this.socialPetRepo.listAffinityLeaderboard(guildId, limit, offset);
  }

  getProposal(proposalId: number): RelationshipProposal | null {
    return this.socialPetRepo.getProposalById(proposalId);
  }

  bindProposalMessage(proposalId: number, messageId: string): void {
    this.socialPetRepo.bindProposalMessageId(proposalId, messageId);
  }

  createProposal(input: {
    guildId: string;
    channelId: string;
    proposerId: string;
    targetId: string;
    relType: RelationshipType;
    nowMs?: number;
  }): CreateProposalResult {
    if (input.proposerId === input.targetId) {
      return { ok: false, reason: 'self_target' };
    }
    const nowMs = input.nowMs ?? Date.now();
    const cfg = this.configRepo.getOrCreate(input.guildId).games;
    const cost = Math.max(0, Math.floor(cfg.cpProposeCost));

    return this.db.transaction((): CreateProposalResult => {
      const existingBetween = this.socialPetRepo.findRelationshipBetween(
        input.guildId,
        input.proposerId,
        input.targetId,
      );
      if (existingBetween) {
        return { ok: false, reason: 'already_related' };
      }

      const conflict = this.checkRelationshipLimit(
        input.guildId,
        input.proposerId,
        input.targetId,
        input.relType,
        cfg.cpMaxSworn,
      );
      if (conflict) {
        return conflict === 'proposer_max_sworn' || conflict === 'target_max_sworn'
          ? { ok: false, reason: conflict, maxSworn: cfg.cpMaxSworn }
          : { ok: false, reason: conflict };
      }

      const proposer = this.profileRepo.getOrCreate(input.guildId, input.proposerId);
      if (proposer.coins < cost) {
        return { ok: false, reason: 'insufficient_funds', cost };
      }
      const balance = proposer.coins - cost;
      if (cost > 0) {
        this.profileRepo.save({ ...proposer, coins: balance });
      }

      const proposal = this.socialPetRepo.createProposal({
        guildId: input.guildId,
        channelId: input.channelId,
        proposerId: input.proposerId,
        targetId: input.targetId,
        relType: input.relType,
        cost,
        createdAt: nowMs,
        expiresAt: nowMs + PROPOSAL_TTL_MS,
      });

      return { ok: true, proposal, cost, balance };
    })();
  }

  acceptProposal(proposalId: number, actorId: string, nowMs = Date.now()): AcceptProposalResult {
    return this.db.transaction((): AcceptProposalResult => {
      const proposal = this.socialPetRepo.getProposalById(proposalId);
      if (!proposal) return { ok: false, reason: 'not_found' };
      if (actorId !== proposal.targetId) return { ok: false, reason: 'not_target' };
      if (proposal.status === 'expired') return { ok: false, reason: 'expired' };
      if (proposal.status !== 'pending') return { ok: false, reason: 'already_resolved' };

      if (proposal.expiresAt <= nowMs) {
        this.socialPetRepo.updateProposalStatus(proposal.id, 'expired');
        if (proposal.cost > 0) {
          this.profileRepo.addCoins(proposal.guildId, proposal.proposerId, proposal.cost);
        }
        return { ok: false, reason: 'expired' };
      }

      const cfg = this.configRepo.getOrCreate(proposal.guildId).games;
      const existingBetween = this.socialPetRepo.findRelationshipBetween(
        proposal.guildId,
        proposal.proposerId,
        proposal.targetId,
      );
      const conflict = this.checkRelationshipLimit(
        proposal.guildId,
        proposal.proposerId,
        proposal.targetId,
        proposal.relType,
        cfg.cpMaxSworn,
      );

      if (existingBetween || conflict) {
        this.socialPetRepo.updateProposalStatus(proposal.id, 'declined');
        if (proposal.cost > 0) {
          this.profileRepo.addCoins(proposal.guildId, proposal.proposerId, proposal.cost);
        }
        return { ok: false, reason: 'conflict_refunded' };
      }

      this.socialPetRepo.updateProposalStatus(proposal.id, 'accepted');
      const relationship = this.socialPetRepo.createRelationship({
        guildId: proposal.guildId,
        user1: proposal.proposerId,
        user2: proposal.targetId,
        relType: proposal.relType,
        createdAt: nowMs,
      });

      return {
        ok: true,
        proposal: { ...proposal, status: 'accepted' },
        relationship,
      };
    })();
  }

  declineProposal(proposalId: number, actorId: string, nowMs = Date.now()): DeclineProposalResult {
    return this.db.transaction((): DeclineProposalResult => {
      const proposal = this.socialPetRepo.getProposalById(proposalId);
      if (!proposal) return { ok: false, reason: 'not_found' };
      if (actorId !== proposal.targetId && actorId !== proposal.proposerId) {
        return { ok: false, reason: 'not_participant' };
      }
      if (proposal.status === 'expired') return { ok: false, reason: 'expired' };
      if (proposal.status !== 'pending') return { ok: false, reason: 'already_resolved' };

      if (proposal.expiresAt <= nowMs) {
        this.socialPetRepo.updateProposalStatus(proposal.id, 'expired');
        if (proposal.cost > 0) {
          this.profileRepo.addCoins(proposal.guildId, proposal.proposerId, proposal.cost);
        }
        return { ok: false, reason: 'expired' };
      }

      this.socialPetRepo.updateProposalStatus(proposal.id, 'declined');
      if (proposal.cost > 0) {
        this.profileRepo.addCoins(proposal.guildId, proposal.proposerId, proposal.cost);
      }

      return {
        ok: true,
        proposal: { ...proposal, status: 'declined' },
        refunded: proposal.cost,
      };
    })();
  }

  expireDueProposals(nowMs = Date.now()): RelationshipProposal[] {
    const due = this.socialPetRepo.listDueProposals(nowMs);
    const expired: RelationshipProposal[] = [];

    for (const item of due) {
      const res = this.db.transaction((): RelationshipProposal | null => {
        const current = this.socialPetRepo.getProposalById(item.id);
        if (!current || current.status !== 'pending') return null;
        this.socialPetRepo.updateProposalStatus(current.id, 'expired');
        if (current.cost > 0) {
          this.profileRepo.addCoins(current.guildId, current.proposerId, current.cost);
        }
        return { ...current, status: 'expired' };
      })();
      if (res) expired.push(res);
    }

    return expired;
  }

  checkinRelationship(
    relationshipId: number,
    actorId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): CheckinRelationshipResult {
    const today = getDateKey(nowMs, this.timezone);

    return this.db.transaction((): CheckinRelationshipResult => {
      const rel = this.socialPetRepo.getRelationshipById(relationshipId);
      if (!rel) return { ok: false, reason: 'not_found' };
      if (actorId !== rel.userA && actorId !== rel.userB) {
        return { ok: false, reason: 'not_member' };
      }
      if (rel.lastCheckinDate === today) {
        return { ok: false, reason: 'already_checked_in' };
      }

      const gain = 10 + Math.floor(rng() * 11);
      const nextAffinity = rel.affinity + gain;
      this.socialPetRepo.updateRelationshipAffinity(rel.id, nextAffinity, today);

      const milestones = rel.relType === 'marriage' ? MARRIAGE_MILESTONES : SWORN_MILESTONES;
      const unlockedTitles: string[] = [];
      for (const m of milestones) {
        if (rel.affinity < m.threshold && nextAffinity >= m.threshold) {
          for (const uid of [rel.userA, rel.userB]) {
            const owned = this.shopRepo.findInventoryByTypeAndName(
              rel.guildId,
              uid,
              'title',
              m.title,
            );
            if (!owned) {
              this.shopRepo.addInventoryItem({
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

      return {
        ok: true,
        relationship: { ...rel, affinity: nextAffinity, lastCheckinDate: today },
        gain,
        unlockedTitles,
      };
    })();
  }

  dissolveRelationship(relationshipId: number, actorId: string): DissolveRelationshipResult {
    return this.db.transaction((): DissolveRelationshipResult => {
      const rel = this.socialPetRepo.getRelationshipById(relationshipId);
      if (!rel) return { ok: false, reason: 'not_found' };
      if (actorId !== rel.userA && actorId !== rel.userB) {
        return { ok: false, reason: 'not_member' };
      }
      this.socialPetRepo.deleteRelationship(rel.id);
      return { ok: true, relationship: rel };
    })();
  }

  private checkRelationshipLimit(
    guildId: string,
    proposerId: string,
    targetId: string,
    relType: RelationshipType,
    cpMaxSworn: number,
  ): 'proposer_married' | 'target_married' | 'proposer_max_sworn' | 'target_max_sworn' | null {
    const proposerRels = this.socialPetRepo.listUserRelationships(guildId, proposerId);
    const targetRels = this.socialPetRepo.listUserRelationships(guildId, targetId);

    if (relType === 'marriage') {
      if (proposerRels.some((r) => r.relType === 'marriage')) return 'proposer_married';
      if (targetRels.some((r) => r.relType === 'marriage')) return 'target_married';
      return null;
    }

    const maxSworn = Math.max(1, cpMaxSworn);
    if (proposerRels.filter((r) => r.relType === 'sworn').length >= maxSworn) {
      return 'proposer_max_sworn';
    }
    if (targetRels.filter((r) => r.relType === 'sworn').length >= maxSworn) {
      return 'target_max_sworn';
    }
    return null;
  }

  // Pets
  listUserPets(guildId: string, ownerId: string): UserPet[] {
    return this.socialPetRepo.listUserPets(guildId, ownerId);
  }

  getActivePet(guildId: string, ownerId: string): UserPet | null {
    return this.socialPetRepo.getActivePet(guildId, ownerId);
  }

  getPetById(petId: number): UserPet | null {
    return this.socialPetRepo.getPetById(petId);
  }

  pullPetGacha(
    guildId: string,
    ownerId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): PullPetGachaResult {
    const cfg = this.configRepo.getOrCreate(guildId).games;
    const price = Math.max(0, cfg.petGachaPrice);
    const maxOwned = Math.max(1, cfg.petMaxOwned);

    return this.db.transaction((): PullPetGachaResult => {
      const owned = this.socialPetRepo.listUserPets(guildId, ownerId);
      if (owned.length >= maxOwned) {
        return { ok: false, reason: 'max_owned_reached', maxOwned };
      }

      const profile = this.profileRepo.getOrCreate(guildId, ownerId);
      if (profile.coins < price) {
        return { ok: false, reason: 'insufficient_funds', price };
      }

      const balance = profile.coins - price;
      this.profileRepo.save({ ...profile, coins: balance });

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
      const stats = this.generateStats(rarity, rng);
      const trait =
        PET_TRAITS[Math.min(PET_TRAITS.length - 1, Math.floor(rng() * PET_TRAITS.length))]!;

      const pet = this.socialPetRepo.createPet({
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
        isHighRarity: rarity === 'SR' || rarity === 'SSR',
      };
    })();
  }

  setActivePet(guildId: string, ownerId: string, petId: number): UserPet | null {
    const pet = this.socialPetRepo.getPetById(petId);
    if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) return null;
    this.socialPetRepo.setActivePet(guildId, ownerId, petId);
    return this.socialPetRepo.getPetById(petId);
  }

  renamePet(
    guildId: string,
    ownerId: string,
    petId: number,
    rawName: string,
  ): PetRenameResult {
    const clean = rawName.trim();
    if (clean.length === 0 || clean.length > 20) {
      return { ok: false, reason: 'invalid_name' };
    }
    const pet = this.socialPetRepo.getPetById(petId);
    if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) {
      return { ok: false, reason: 'not_found' };
    }
    const updated: UserPet = { ...pet, nickname: clean };
    this.socialPetRepo.savePet(updated);
    return { ok: true, pet: updated };
  }

  releasePet(guildId: string, ownerId: string, petId: number): PetReleaseResult {
    return this.db.transaction((): PetReleaseResult => {
      const pet = this.socialPetRepo.getPetById(petId);
      if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) {
        return { ok: false, reason: 'not_found' };
      }

      this.socialPetRepo.deletePet(petId, guildId, ownerId);
      const refund = RELEASE_REFUNDS[pet.rarity];
      const updatedProfile = this.profileRepo.addCoins(guildId, ownerId, refund);

      if (pet.isActive) {
        const remaining = this.socialPetRepo.listUserPets(guildId, ownerId);
        if (remaining.length > 0) {
          this.socialPetRepo.setActivePet(guildId, ownerId, remaining[0]!.id);
        }
      }

      return { ok: true, releasedPet: pet, refund, balance: updatedProfile.coins };
    })();
  }

  feedPet(
    guildId: string,
    ownerId: string,
    petId: number,
    nowMs = Date.now(),
  ): PetFeedResult {
    const cfg = this.configRepo.getOrCreate(guildId).games;
    const cost = Math.max(0, cfg.petFeedPrice);
    const today = getDateKey(nowMs, this.timezone);

    return this.db.transaction((): PetFeedResult => {
      const pet = this.socialPetRepo.getPetById(petId);
      if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) {
        return { ok: false, reason: 'not_found' };
      }
      if (pet.lastFeedDate === today) {
        return { ok: false, reason: 'already_fed_today' };
      }

      const profile = this.profileRepo.getOrCreate(guildId, ownerId);
      if (profile.coins < cost) {
        return { ok: false, reason: 'insufficient_funds', cost };
      }
      const balance = profile.coins - cost;
      if (cost > 0) {
        this.profileRepo.save({ ...profile, coins: balance });
      }

      const { updatedPet, leveledUp } = applyPetXp({ ...pet, lastFeedDate: today }, 40);
      this.socialPetRepo.savePet(updatedPet);

      return { ok: true, pet: updatedPet, cost, balance, leveledUp };
    })();
  }

  trainPet(
    guildId: string,
    ownerId: string,
    petId: number,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): PetTrainResult {
    return this.db.transaction((): PetTrainResult => {
      const pet = this.socialPetRepo.getPetById(petId);
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
      this.socialPetRepo.savePet(updatedPet);
      return { ok: true, pet: updatedPet, gainXp, leveledUp };
    })();
  }

  workWithPet(
    guildId: string,
    ownerId: string,
    petId: number,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): PetWorkResult {
    return this.db.transaction((): PetWorkResult => {
      const pet = this.socialPetRepo.getPetById(petId);
      if (!pet || pet.guildId !== guildId || pet.ownerId !== ownerId) {
        return { ok: false, reason: 'not_found' };
      }
      const elapsed = nowMs - pet.lastWorkAt;
      if (pet.lastWorkAt > 0 && elapsed < PET_WORK_COOLDOWN_MS) {
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
      const coinsEarned = baseEarned + (pet.level - 1) * 15;
      const gainXp = 15;

      const updatedProfile = this.profileRepo.addCoins(guildId, ownerId, coinsEarned);
      const { updatedPet, leveledUp } = applyPetXp({ ...pet, lastWorkAt: nowMs }, gainXp);
      this.socialPetRepo.savePet(updatedPet);

      return {
        ok: true,
        pet: updatedPet,
        coinsEarned,
        balance: updatedProfile.coins,
        gainXp,
        leveledUp,
      };
    })();
  }

  // Pet Battles
  getPetBattle(battleId: number): PetBattle | null {
    return this.socialPetRepo.getPetBattleById(battleId);
  }

  bindPetBattleMessage(battleId: number, messageId: string): void {
    this.socialPetRepo.bindPetBattleMessageId(battleId, messageId);
  }

  createPetBattle(input: {
    guildId: string;
    channelId: string;
    challengerId: string;
    opponentId: string | null;
    bet: number;
    nowMs?: number;
  }): CreatePetBattleResult {
    if (input.opponentId && input.opponentId === input.challengerId) {
      return { ok: false, reason: 'self_target' };
    }
    const bet = Math.floor(input.bet);
    if (!Number.isFinite(bet) || bet < 0 || bet > 1_000_000) {
      return { ok: false, reason: 'invalid_bet' };
    }
    const nowMs = input.nowMs ?? Date.now();

    const activePet = this.socialPetRepo.getActivePet(input.guildId, input.challengerId);
    if (!activePet) {
      return { ok: false, reason: 'no_active_pet' };
    }
    const profile = this.profileRepo.getOrCreate(input.guildId, input.challengerId);
    if (profile.coins < bet) {
      return { ok: false, reason: 'insufficient_funds' };
    }

    const battle = this.socialPetRepo.createPetBattle({
      guildId: input.guildId,
      channelId: input.channelId,
      challengerId: input.challengerId,
      challengerPetId: activePet.id,
      opponentId: input.opponentId,
      bet,
      createdAt: nowMs,
      expiresAt: nowMs + PET_BATTLE_TTL_MS,
    });

    return { ok: true, battle, challengerPet: activePet };
  }

  acceptPetBattle(
    battleId: number,
    acceptorId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): AcceptPetBattleResult {
    return this.db.transaction((): AcceptPetBattleResult => {
      const battle = this.socialPetRepo.getPetBattleById(battleId);
      if (!battle) return { ok: false, reason: 'not_found' };
      if (battle.status === 'expired') return { ok: false, reason: 'expired' };
      if (battle.status !== 'pending') return { ok: false, reason: 'already_resolved' };
      if (battle.expiresAt <= nowMs) {
        this.socialPetRepo.savePetBattle({ ...battle, status: 'expired' });
        return { ok: false, reason: 'expired' };
      }

      if (acceptorId === battle.challengerId) {
        return { ok: false, reason: 'cannot_accept_self' };
      }
      if (battle.opponentId && acceptorId !== battle.opponentId) {
        return { ok: false, reason: 'not_opponent' };
      }

      const challengerPet = this.socialPetRepo.getPetById(battle.challengerPetId);
      if (!challengerPet || challengerPet.ownerId !== battle.challengerId) {
        return { ok: false, reason: 'challenger_no_pet' };
      }

      const opponentPet = this.socialPetRepo.getActivePet(battle.guildId, acceptorId);
      if (!opponentPet) {
        return { ok: false, reason: 'no_active_pet' };
      }

      const challengerProfile = this.profileRepo.getOrCreate(battle.guildId, battle.challengerId);
      if (challengerProfile.coins < battle.bet) {
        return { ok: false, reason: 'challenger_insufficient_funds' };
      }
      const opponentProfile = this.profileRepo.getOrCreate(battle.guildId, acceptorId);
      if (opponentProfile.coins < battle.bet) {
        return { ok: false, reason: 'opponent_insufficient_funds' };
      }

      const sim = simulatePetBattle(challengerPet, opponentPet, rng);
      const challengerWon = sim.winnerSide === 'challenger';
      const winnerId = challengerWon ? battle.challengerId : acceptorId;
      const loserId = challengerWon ? acceptorId : battle.challengerId;

      const challengerBalance = challengerProfile.coins + (challengerWon ? battle.bet : -battle.bet);
      const opponentBalance = opponentProfile.coins + (challengerWon ? -battle.bet : battle.bet);

      if (battle.bet > 0) {
        this.profileRepo.save({ ...challengerProfile, coins: challengerBalance });
        this.profileRepo.save({ ...opponentProfile, coins: opponentBalance });
      }

      const cXp = challengerWon ? 30 : 12;
      const oXp = challengerWon ? 12 : 30;
      const nextChallengerPet = applyPetXp(
        {
          ...challengerPet,
          wins: challengerPet.wins + (challengerWon ? 1 : 0),
          losses: challengerPet.losses + (challengerWon ? 0 : 1),
        },
        cXp,
      ).updatedPet;
      const nextOpponentPet = applyPetXp(
        {
          ...opponentPet,
          wins: opponentPet.wins + (challengerWon ? 0 : 1),
          losses: opponentPet.losses + (challengerWon ? 1 : 0),
        },
        oXp,
      ).updatedPet;

      this.socialPetRepo.savePet(nextChallengerPet);
      this.socialPetRepo.savePet(nextOpponentPet);

      const updatedBattle: PetBattle = {
        ...battle,
        opponentId: acceptorId,
        opponentPetId: opponentPet.id,
        status: 'completed',
        winnerId,
        logs: sim.logs,
      };
      this.socialPetRepo.savePetBattle(updatedBattle);

      return {
        ok: true,
        battle: updatedBattle,
        challengerPet: nextChallengerPet,
        opponentPet: nextOpponentPet,
        winnerId,
        loserId,
        winnerPet: challengerWon ? nextChallengerPet : nextOpponentPet,
        loserPet: challengerWon ? nextOpponentPet : nextChallengerPet,
        challengerBalance,
        opponentBalance,
      };
    })();
  }

  declinePetBattle(
    battleId: number,
    actorId: string,
    nowMs = Date.now(),
  ): DeclinePetBattleResult {
    const battle = this.socialPetRepo.getPetBattleById(battleId);
    if (!battle) return { ok: false, reason: 'not_found' };
    if (actorId !== battle.challengerId && actorId !== battle.opponentId) {
      return { ok: false, reason: 'not_participant' };
    }
    if (battle.status === 'expired') return { ok: false, reason: 'expired' };
    if (battle.status !== 'pending') return { ok: false, reason: 'already_resolved' };
    if (battle.expiresAt <= nowMs) {
      const updated: PetBattle = { ...battle, status: 'expired' };
      this.socialPetRepo.savePetBattle(updated);
      return { ok: false, reason: 'expired' };
    }

    const updated: PetBattle = { ...battle, status: 'declined' };
    this.socialPetRepo.savePetBattle(updated);
    return { ok: true, battle: updated };
  }

  expireDuePetBattles(nowMs = Date.now()): PetBattle[] {
    const due = this.socialPetRepo.listDuePetBattles(nowMs);
    const expired: PetBattle[] = [];
    for (const b of due) {
      const updated: PetBattle = { ...b, status: 'expired' };
      this.socialPetRepo.savePetBattle(updated);
      expired.push(updated);
    }
    return expired;
  }

  private generateStats(
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
}
