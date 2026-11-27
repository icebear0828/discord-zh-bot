import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../../db/repositories/profileRepo.js';
import type { ShopRepo } from '../../db/repositories/shopRepo.js';
import type {
  PetBattle,
  PetRarity,
  Relationship,
  RelationshipProposal,
  SocialPetRepo,
  UserPet,
} from '../../db/repositories/socialPetRepo.js';
import type { CreditLoanService } from '../creditLoanService.js';

export interface SocialPetOpsDeps {
  db: Database.Database;
  configRepo: GuildConfigRepo;
  profileRepo: ProfileRepo;
  shopRepo: ShopRepo;
  socialPetRepo: SocialPetRepo;
  timezone: string;
  creditLoanService?: CreditLoanService;
}

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

export const PET_TRAITS = ['贪吃', '暴躁', '幸运', '摸鱼', '社牛', '铁头', '腹黑', '佛系'];

export const MARRIAGE_MILESTONES: ReadonlyArray<{ threshold: number; title: string }> = [
  { threshold: 50, title: '💞 甜蜜新婚' },
  { threshold: 150, title: '💍 灵魂伴侣' },
  { threshold: 400, title: '👑 模范神仙眷侣' },
];

export const SWORN_MILESTONES: ReadonlyArray<{ threshold: number; title: string }> = [
  { threshold: 50, title: '🍻 铁血死党' },
  { threshold: 150, title: '🔥 生死之交' },
  { threshold: 400, title: '⚔️ 传奇结拜兄弟' },
];

export const RELEASE_REFUND_RATIOS: Readonly<Record<PetRarity, number>> = {
  N: 0.25,
  R: 0.45,
  SR: 0.75,
  SSR: 1.0,
};

export const GROWTH_BY_RARITY: Record<PetRarity, { hp: number; atk: number; spd: number }> = {
  N: { hp: 12, atk: 3, spd: 2 },
  R: { hp: 16, atk: 4, spd: 2 },
  SR: { hp: 20, atk: 5, spd: 3 },
  SSR: { hp: 26, atk: 6, spd: 4 },
};

export const PROPOSAL_TTL_MS = 15 * 60 * 1000;
export const PET_TRAIN_COOLDOWN_MS = 3600 * 1000;
export const PET_BATTLE_TTL_MS = 10 * 60 * 1000;

export type CreateProposalResult =
  | { ok: true; proposal: RelationshipProposal; cost: number; balance: number }
  | {
      ok: false;
      reason:
        | 'self_target'
        | 'already_related'
        | 'pending_proposal_exists'
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
  | {
      ok: false;
      reason: 'max_owned_reached' | 'insufficient_funds' | 'deadbeat_blocked';
      price?: number;
      maxOwned?: number;
    };

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
  | { ok: false; reason: 'not_found' | 'pet_in_battle' };

export type CreatePetBattleResult =
  | { ok: true; battle: PetBattle; challengerPet: UserPet; challengerBalance: number }
  | {
      ok: false;
      reason:
        | 'self_target'
        | 'invalid_bet'
        | 'no_active_pet'
        | 'insufficient_funds'
        | 'deadbeat_blocked'
        | 'pvp_cooldown';
      retryAfterSec?: number;
    };

export type AcceptPetBattleResult =
  | {
      ok: true;
      battle: PetBattle;
      challengerPet: UserPet;
      opponentPet: UserPet;
      draw: boolean;
      winnerId: string | null;
      loserId: string | null;
      winnerPet: UserPet | null;
      loserPet: UserPet | null;
      challengerXpGained: number;
      opponentXpGained: number;
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
        | 'opponent_insufficient_funds'
        | 'deadbeat_blocked'
        | 'pvp_cooldown';
      retryAfterSec?: number;
    };

export type DeclinePetBattleResult =
  | { ok: true; battle: PetBattle; refunded: number }
  | { ok: false; reason: 'not_found' | 'not_participant' | 'already_resolved' | 'expired' };
