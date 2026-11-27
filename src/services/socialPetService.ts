import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { ShopRepo } from '../db/repositories/shopRepo.js';
import type {
  PetBattle,
  Relationship,
  RelationshipProposal,
  RelationshipType,
  SocialPetRepo,
  UserPet,
} from '../db/repositories/socialPetRepo.js';
import type { CreditLoanService } from './creditLoanService.js';
import {
  acceptPetBattleOp,
  createPetBattleOp,
  declinePetBattleOp,
  expireDuePetBattlesOp,
  expirePetBattleIfDueOp,
  type PetArenaState,
} from './socialPet/petArenaPvpOps.js';
import {
  feedPetOp,
  hasPendingBattleForPetOp,
  pullPetGachaOp,
  releasePetOp,
  renamePetOp,
  setActivePetOp,
  trainPetOp,
  workWithPetOp,
} from './socialPet/petCareOps.js';
import {
  acceptProposalOp,
  checkinRelationshipOp,
  createProposalOp,
  declineProposalOp,
  dissolveRelationshipOp,
  expireDueProposalsOp,
  expireProposalIfDueOp,
} from './socialPet/relationshipOps.js';
import type {
  AcceptPetBattleResult,
  AcceptProposalResult,
  CheckinRelationshipResult,
  CreatePetBattleResult,
  CreateProposalResult,
  DeclinePetBattleResult,
  DeclineProposalResult,
  DissolveRelationshipResult,
  PetFeedResult,
  PetReleaseResult,
  PetRenameResult,
  PetTrainResult,
  PetWorkResult,
  PullPetGachaResult,
  SocialPetOpsDeps,
} from './socialPet/socialPetCatalogAndTypes.js';

export {
  PET_SPECIES,
  PET_SPECIES_MAP,
  type AcceptPetBattleResult,
  type AcceptProposalResult,
  type CheckinRelationshipResult,
  type CreatePetBattleResult,
  type CreateProposalResult,
  type DeclinePetBattleResult,
  type DeclineProposalResult,
  type DissolveRelationshipResult,
  type PetFeedResult,
  type PetReleaseResult,
  type PetRenameResult,
  type PetSpecies,
  type PetTrainResult,
  type PetWorkResult,
  type PullPetGachaResult,
} from './socialPet/socialPetCatalogAndTypes.js';

export {
  applyPetXp,
  calculatePetReleaseRefund,
  simulatePetBattle,
  unlockRelationshipMilestoneTitles,
  xpNeededForPetLevel,
} from './socialPet/petMathAndBattleSim.js';

export class SocialPetService {
  private readonly arenaState: PetArenaState = { lastPaidPvpAt: new Map<string, number>() };
  private readonly deps: SocialPetOpsDeps;

  constructor(
    db: Database.Database,
    configRepo: GuildConfigRepo,
    profileRepo: ProfileRepo,
    shopRepo: ShopRepo,
    private readonly socialPetRepo: SocialPetRepo,
    timezone = 'Asia/Shanghai',
    creditLoanService?: CreditLoanService,
  ) {
    this.deps = {
      db,
      configRepo,
      profileRepo,
      shopRepo,
      socialPetRepo,
      timezone,
      creditLoanService,
    };
  }

  // Relationships
  listUserRelationships(guildId: string, userId: string): Relationship[] {
    return this.socialPetRepo.listUserRelationships(guildId, userId);
  }

  getRelationshipById(relationshipId: number): Relationship | null {
    return this.socialPetRepo.getRelationshipById(relationshipId);
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
    return createProposalOp(this.deps, input);
  }

  acceptProposal(proposalId: number, actorId: string, nowMs = Date.now()): AcceptProposalResult {
    return acceptProposalOp(this.deps, proposalId, actorId, nowMs);
  }

  declineProposal(proposalId: number, actorId: string, nowMs = Date.now()): DeclineProposalResult {
    return declineProposalOp(this.deps, proposalId, actorId, nowMs);
  }

  expireProposalIfDue(proposalId: number, nowMs = Date.now()): RelationshipProposal | null {
    return expireProposalIfDueOp(this.deps, proposalId, nowMs);
  }

  expireDueProposals(nowMs = Date.now()): RelationshipProposal[] {
    return expireDueProposalsOp(this.deps, nowMs);
  }

  checkinRelationship(
    relationshipId: number,
    actorId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): CheckinRelationshipResult {
    return checkinRelationshipOp(this.deps, relationshipId, actorId, nowMs, rng);
  }

  dissolveRelationship(relationshipId: number, actorId: string): DissolveRelationshipResult {
    return dissolveRelationshipOp(this.deps, relationshipId, actorId);
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

  hasPendingBattleForPet(petId: number, nowMs = Date.now()): boolean {
    return hasPendingBattleForPetOp(this.deps, petId, nowMs);
  }

  pullPetGacha(
    guildId: string,
    ownerId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): PullPetGachaResult {
    return pullPetGachaOp(this.deps, guildId, ownerId, nowMs, rng);
  }

  setActivePet(guildId: string, ownerId: string, petId: number): UserPet | null {
    return setActivePetOp(this.deps, guildId, ownerId, petId);
  }

  renamePet(
    guildId: string,
    ownerId: string,
    petId: number,
    rawName: string,
  ): PetRenameResult {
    return renamePetOp(this.deps, guildId, ownerId, petId, rawName);
  }

  releasePet(
    guildId: string,
    ownerId: string,
    petId: number,
    nowMs = Date.now(),
  ): PetReleaseResult {
    return releasePetOp(this.deps, guildId, ownerId, petId, nowMs);
  }

  feedPet(
    guildId: string,
    ownerId: string,
    petId: number,
    nowMs = Date.now(),
  ): PetFeedResult {
    return feedPetOp(this.deps, guildId, ownerId, petId, nowMs);
  }

  trainPet(
    guildId: string,
    ownerId: string,
    petId: number,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): PetTrainResult {
    return trainPetOp(this.deps, guildId, ownerId, petId, nowMs, rng);
  }

  workWithPet(
    guildId: string,
    ownerId: string,
    petId: number,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): PetWorkResult {
    return workWithPetOp(this.deps, guildId, ownerId, petId, nowMs, rng);
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
    return createPetBattleOp(this.deps, this.arenaState, input);
  }

  acceptPetBattle(
    battleId: number,
    acceptorId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): AcceptPetBattleResult {
    return acceptPetBattleOp(this.deps, this.arenaState, battleId, acceptorId, nowMs, rng);
  }

  declinePetBattle(
    battleId: number,
    actorId: string,
    nowMs = Date.now(),
  ): DeclinePetBattleResult {
    return declinePetBattleOp(this.deps, battleId, actorId, nowMs);
  }

  expirePetBattleIfDue(battleId: number, nowMs = Date.now()): PetBattle | null {
    return expirePetBattleIfDueOp(this.deps, battleId, nowMs);
  }

  expireDuePetBattles(nowMs = Date.now()): PetBattle[] {
    return expireDuePetBattlesOp(this.deps, nowMs);
  }
}
