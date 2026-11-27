import type {
  RelationshipProposal,
  RelationshipType,
} from '../../db/repositories/socialPetRepo.js';
import { getDateKey } from '../economyService.js';
import { unlockRelationshipMilestoneTitles } from './petMathAndBattleSim.js';
import {
  PROPOSAL_TTL_MS,
  type AcceptProposalResult,
  type CheckinRelationshipResult,
  type CreateProposalResult,
  type DeclineProposalResult,
  type DissolveRelationshipResult,
  type SocialPetOpsDeps,
} from './socialPetCatalogAndTypes.js';

function checkRelationshipLimit(
  deps: SocialPetOpsDeps,
  guildId: string,
  proposerId: string,
  targetId: string,
  relType: RelationshipType,
  cpMaxSworn: number,
): 'proposer_married' | 'target_married' | 'proposer_max_sworn' | 'target_max_sworn' | null {
  const proposerRels = deps.socialPetRepo.listUserRelationships(guildId, proposerId);
  const targetRels = deps.socialPetRepo.listUserRelationships(guildId, targetId);

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

export function createProposalOp(
  deps: SocialPetOpsDeps,
  input: {
    guildId: string;
    channelId: string;
    proposerId: string;
    targetId: string;
    relType: RelationshipType;
    nowMs?: number;
  },
): CreateProposalResult {
  if (input.proposerId === input.targetId) {
    return { ok: false, reason: 'self_target' };
  }
  const nowMs = input.nowMs ?? Date.now();
  const cfg = deps.configRepo.getOrCreate(input.guildId).games;
  const cost = Math.max(0, Math.floor(cfg.cpProposeCost));

  return deps.db.transaction((): CreateProposalResult => {
    const existingBetween = deps.socialPetRepo.findRelationshipBetween(
      input.guildId,
      input.proposerId,
      input.targetId,
    );
    if (existingBetween) {
      return { ok: false, reason: 'already_related' };
    }

    const pendingRow = deps.db
      .prepare(
        `SELECT id FROM relationship_proposals
         WHERE guild_id = ?
           AND status = 'pending'
           AND expires_at > ?
           AND ((proposer_id = ? AND target_id = ?) OR (proposer_id = ? AND target_id = ?))
         LIMIT 1`,
      )
      .get(
        input.guildId,
        nowMs,
        input.proposerId,
        input.targetId,
        input.targetId,
        input.proposerId,
      ) as { id: number } | undefined;
    if (pendingRow) {
      return { ok: false, reason: 'pending_proposal_exists' };
    }

    const conflict = checkRelationshipLimit(
      deps,
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

    const proposer = deps.profileRepo.getOrCreate(input.guildId, input.proposerId);
    if (proposer.coins < cost) {
      return { ok: false, reason: 'insufficient_funds', cost };
    }
    const balance = proposer.coins - cost;
    if (cost > 0) {
      deps.profileRepo.save({ ...proposer, coins: balance });
    }

    const proposal = deps.socialPetRepo.createProposal({
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

export function acceptProposalOp(
  deps: SocialPetOpsDeps,
  proposalId: number,
  actorId: string,
  nowMs = Date.now(),
): AcceptProposalResult {
  return deps.db.transaction((): AcceptProposalResult => {
    const proposal = deps.socialPetRepo.getProposalById(proposalId);
    if (!proposal) return { ok: false, reason: 'not_found' };
    if (proposal.status === 'expired') return { ok: false, reason: 'expired' };
    if (proposal.status !== 'pending') return { ok: false, reason: 'already_resolved' };

    if (proposal.expiresAt <= nowMs) {
      deps.socialPetRepo.updateProposalStatus(proposal.id, 'expired');
      if (proposal.cost > 0) {
        deps.profileRepo.addCoins(proposal.guildId, proposal.proposerId, proposal.cost);
      }
      return { ok: false, reason: 'expired' };
    }

    if (actorId !== proposal.targetId) return { ok: false, reason: 'not_target' };

    const cfg = deps.configRepo.getOrCreate(proposal.guildId).games;
    const existingBetween = deps.socialPetRepo.findRelationshipBetween(
      proposal.guildId,
      proposal.proposerId,
      proposal.targetId,
    );
    const conflict = checkRelationshipLimit(
      deps,
      proposal.guildId,
      proposal.proposerId,
      proposal.targetId,
      proposal.relType,
      cfg.cpMaxSworn,
    );

    if (existingBetween || conflict) {
      deps.socialPetRepo.updateProposalStatus(proposal.id, 'declined');
      if (proposal.cost > 0) {
        deps.profileRepo.addCoins(proposal.guildId, proposal.proposerId, proposal.cost);
      }
      return { ok: false, reason: 'conflict_refunded' };
    }

    deps.socialPetRepo.updateProposalStatus(proposal.id, 'accepted');
    const relationship = deps.socialPetRepo.createRelationship({
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

export function declineProposalOp(
  deps: SocialPetOpsDeps,
  proposalId: number,
  actorId: string,
  nowMs = Date.now(),
): DeclineProposalResult {
  return deps.db.transaction((): DeclineProposalResult => {
    const proposal = deps.socialPetRepo.getProposalById(proposalId);
    if (!proposal) return { ok: false, reason: 'not_found' };
    if (proposal.status === 'expired') return { ok: false, reason: 'expired' };
    if (proposal.status !== 'pending') return { ok: false, reason: 'already_resolved' };

    if (proposal.expiresAt <= nowMs) {
      deps.socialPetRepo.updateProposalStatus(proposal.id, 'expired');
      if (proposal.cost > 0) {
        deps.profileRepo.addCoins(proposal.guildId, proposal.proposerId, proposal.cost);
      }
      return { ok: false, reason: 'expired' };
    }

    if (actorId !== proposal.targetId && actorId !== proposal.proposerId) {
      return { ok: false, reason: 'not_participant' };
    }

    deps.socialPetRepo.updateProposalStatus(proposal.id, 'declined');
    if (proposal.cost > 0) {
      deps.profileRepo.addCoins(proposal.guildId, proposal.proposerId, proposal.cost);
    }

    return {
      ok: true,
      proposal: { ...proposal, status: 'declined' },
      refunded: proposal.cost,
    };
  })();
}

export function expireProposalIfDueOp(
  deps: SocialPetOpsDeps,
  proposalId: number,
  nowMs = Date.now(),
): RelationshipProposal | null {
  return deps.db.transaction((): RelationshipProposal | null => {
    const current = deps.socialPetRepo.getProposalById(proposalId);
    if (!current || current.status !== 'pending' || current.expiresAt > nowMs) return null;
    deps.socialPetRepo.updateProposalStatus(current.id, 'expired');
    if (current.cost > 0) {
      deps.profileRepo.addCoins(current.guildId, current.proposerId, current.cost);
    }
    return { ...current, status: 'expired' };
  })();
}

export function expireDueProposalsOp(
  deps: SocialPetOpsDeps,
  nowMs = Date.now(),
): RelationshipProposal[] {
  const due = deps.socialPetRepo.listDueProposals(nowMs);
  const expired: RelationshipProposal[] = [];

  for (const item of due) {
    const res = expireProposalIfDueOp(deps, item.id, nowMs);
    if (res) expired.push(res);
  }

  return expired;
}

export function checkinRelationshipOp(
  deps: SocialPetOpsDeps,
  relationshipId: number,
  actorId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): CheckinRelationshipResult {
  const today = getDateKey(nowMs, deps.timezone);

  return deps.db.transaction((): CheckinRelationshipResult => {
    const rel = deps.socialPetRepo.getRelationshipById(relationshipId);
    if (!rel) return { ok: false, reason: 'not_found' };
    if (actorId !== rel.userA && actorId !== rel.userB) {
      return { ok: false, reason: 'not_member' };
    }
    if (rel.lastCheckinDate === today) {
      return { ok: false, reason: 'already_checked_in' };
    }

    const gain = 10 + Math.floor(rng() * 11);
    const nextAffinity = rel.affinity + gain;
    deps.socialPetRepo.updateRelationshipAffinity(rel.id, nextAffinity, today);

    const unlockedTitles = unlockRelationshipMilestoneTitles(
      deps.shopRepo,
      rel,
      rel.affinity,
      nextAffinity,
      nowMs,
    );

    return {
      ok: true,
      relationship: { ...rel, affinity: nextAffinity, lastCheckinDate: today },
      gain,
      unlockedTitles,
    };
  })();
}

export function dissolveRelationshipOp(
  deps: SocialPetOpsDeps,
  relationshipId: number,
  actorId: string,
): DissolveRelationshipResult {
  return deps.db.transaction((): DissolveRelationshipResult => {
    const rel = deps.socialPetRepo.getRelationshipById(relationshipId);
    if (!rel) return { ok: false, reason: 'not_found' };
    if (actorId !== rel.userA && actorId !== rel.userB) {
      return { ok: false, reason: 'not_member' };
    }
    deps.socialPetRepo.deleteRelationship(rel.id);
    return { ok: true, relationship: rel };
  })();
}
