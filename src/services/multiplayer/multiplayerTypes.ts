import type Database from 'better-sqlite3';
import { MAX_COIN_AMOUNT } from '../../config/economyConstants.js';
import type { ChaosRepo } from '../../db/repositories/chaosRepo.js';
import type { DuelChallengeRecord, DuelRepo } from '../../db/repositories/duelRepo.js';
import type { ProfileRepo } from '../../db/repositories/profileRepo.js';
import type {
  RedPacket,
  RedPacketClaim,
  RedPacketRepo,
} from '../../db/repositories/redPacketRepo.js';
import type { CreditLoanService } from '../creditLoanService.js';

export { MAX_COIN_AMOUNT };

export interface MultiplayerDeps {
  db: Database.Database;
  profileRepo: ProfileRepo;
  redPacketRepo: RedPacketRepo;
  chaosRepo?: ChaosRepo;
  duelRepo?: DuelRepo;
  creditLoanService?: CreditLoanService;
}

export type CreateRedPacketResult =
  | { ok: true; packet: RedPacket; senderBalance: number }
  | {
      ok: false;
      reason:
        | 'invalid_count'
        | 'invalid_amount'
        | 'amount_too_small_for_count'
        | 'insufficient_funds';
    };

export type ClaimRedPacketResult =
  | {
      ok: true;
      amount: number;
      claimerBalance: number;
      packet: RedPacket;
      claims: RedPacketClaim[];
      bestLuckUserId: string | null;
      garnished?: number;
    }
  | {
      ok: false;
      reason: 'not_found' | 'expired' | 'finished' | 'already_claimed';
    };

export interface ExpiredRedPacketResult {
  packet: RedPacket;
  refundedAmount: number;
}

export interface RedPacketWithClaims {
  packet: RedPacket;
  claims: RedPacketClaim[];
  bestLuckUserId: string | null;
}

export type DuelStatus = 'pending' | 'completed' | 'declined' | 'expired';

export interface DuelChallenge {
  id: string;
  guildId: string;
  channelId: string;
  messageId?: string | null;
  challengerId: string;
  opponentId: string;
  bet: number;
  status: DuelStatus;
  createdAt: number;
  expiresAt: number;
}

export type CreateDuelResult =
  | { ok: true; duel: DuelChallenge; challengerBalance: number }
  | {
      ok: false;
      reason: 'self_target' | 'invalid_bet' | 'insufficient_funds' | 'deadbeat_blocked';
    };

export type AcceptDuelResult =
  | {
      ok: true;
      duel: DuelChallenge;
      challengerDice: [number, number, number];
      challengerSum: number;
      opponentDice: [number, number, number];
      opponentSum: number;
      tie: boolean;
      winnerId: string | null;
      loserId: string | null;
      challengerBalance: number;
      opponentBalance: number;
      bountyClaimed?: number;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_opponent'
        | 'already_resolved'
        | 'expired'
        | 'challenger_insufficient_funds'
        | 'opponent_insufficient_funds'
        | 'deadbeat_blocked';
    };

export type DeclineDuelResult =
  | { ok: true; duel: DuelChallenge; refunded: number }
  | {
      ok: false;
      reason: 'not_found' | 'not_participant' | 'already_resolved' | 'expired';
    };

export interface RandomDropShare {
  userId: string;
  amount: number;
  newBalance: number;
}

export type DistributeRandomRedPacketResult =
  | {
      ok: true;
      totalAmount: number;
      winnerCount: number;
      shares: RandomDropShare[];
      bestLuckUserId: string;
      bestLuckAmount: number;
    }
  | {
      ok: false;
      reason:
        | 'no_candidates'
        | 'invalid_count'
        | 'invalid_amount'
        | 'amount_too_small_for_count';
    };

export const MAX_RED_PACKET_COUNT = 100;
export const MAX_DUELS_IN_MEMORY = 100;
export const DEFAULT_RED_PACKET_TTL_MS = 24 * 3600 * 1000;
export const DEFAULT_GREETING = '恭喜发财，大吉大利！';

export function computeBestLuckUserId(packet: RedPacket, claims: RedPacketClaim[]): string | null {
  if (packet.status !== 'finished' || claims.length === 0) {
    return null;
  }
  let best: RedPacketClaim | undefined;
  for (const claim of claims) {
    if (!best || claim.amount > best.amount) {
      best = claim;
    }
  }
  return best ? best.userId : null;
}

export function mapDuelRecord(record: DuelChallengeRecord): DuelChallenge {
  return {
    id: record.id,
    guildId: record.guildId,
    channelId: record.channelId,
    messageId: record.messageId,
    challengerId: record.challengerId,
    opponentId: record.opponentId,
    bet: record.bet,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}
