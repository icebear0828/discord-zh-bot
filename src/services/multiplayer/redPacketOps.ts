import { MAX_COIN_AMOUNT } from '../../config/economyConstants.js';
import {
  computeBestLuckUserId,
  DEFAULT_GREETING,
  DEFAULT_RED_PACKET_TTL_MS,
  MAX_RED_PACKET_COUNT,
  type ClaimRedPacketResult,
  type CreateRedPacketResult,
  type DistributeRandomRedPacketResult,
  type ExpiredRedPacketResult,
  type MultiplayerDeps,
  type RandomDropShare,
  type RedPacketWithClaims,
} from './multiplayerTypes.js';

export function createRedPacketOp(
  deps: MultiplayerDeps,
  input: {
    guildId: string;
    channelId: string;
    senderId: string;
    totalAmount: number;
    totalCount: number;
    greeting?: string;
    nowMs?: number;
    ttlMs?: number;
    systemFunded?: boolean;
  },
): CreateRedPacketResult {
  if (
    !Number.isInteger(input.totalCount) ||
    input.totalCount < 2 ||
    input.totalCount > MAX_RED_PACKET_COUNT
  ) {
    return { ok: false, reason: 'invalid_count' };
  }
  if (
    !Number.isInteger(input.totalAmount) ||
    input.totalAmount <= 0 ||
    input.totalAmount > MAX_COIN_AMOUNT
  ) {
    return { ok: false, reason: 'invalid_amount' };
  }
  if (input.totalAmount < input.totalCount) {
    return { ok: false, reason: 'amount_too_small_for_count' };
  }

  const nowMs = input.nowMs ?? Date.now();
  const expiresAt = nowMs + (input.ttlMs ?? DEFAULT_RED_PACKET_TTL_MS);
  const greeting = input.greeting?.trim() || DEFAULT_GREETING;
  const systemFunded = Boolean(input.systemFunded);

  return deps.db.transaction((): CreateRedPacketResult => {
    const sender = deps.profileRepo.getOrCreate(input.guildId, input.senderId);
    let senderBalance = sender.coins;
    if (!systemFunded) {
      if (sender.coins < input.totalAmount) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      senderBalance = sender.coins - input.totalAmount;
      deps.profileRepo.save({ ...sender, coins: senderBalance });
    }

    const packet = deps.redPacketRepo.create({
      guildId: input.guildId,
      channelId: input.channelId,
      senderId: input.senderId,
      totalAmount: input.totalAmount,
      totalCount: input.totalCount,
      greeting,
      expiresAt,
      createdAt: nowMs,
      systemFunded,
    });

    return { ok: true, packet, senderBalance };
  })();
}

export function distributeRandomRedPacketOp(
  deps: MultiplayerDeps,
  input: {
    guildId: string;
    candidateUserIds: readonly string[];
    totalAmount: number;
    count: number;
    rng?: () => number;
  },
): DistributeRandomRedPacketResult {
  const uniqueCandidates = [...new Set(input.candidateUserIds)];
  if (uniqueCandidates.length === 0) {
    return { ok: false, reason: 'no_candidates' };
  }
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_RED_PACKET_COUNT) {
    return { ok: false, reason: 'invalid_count' };
  }
  if (
    !Number.isInteger(input.totalAmount) ||
    input.totalAmount <= 0 ||
    input.totalAmount > MAX_COIN_AMOUNT
  ) {
    return { ok: false, reason: 'invalid_amount' };
  }

  const winnerCount = Math.min(input.count, uniqueCandidates.length);
  if (input.totalAmount < winnerCount) {
    return { ok: false, reason: 'amount_too_small_for_count' };
  }

  const rng = input.rng ?? Math.random;
  const shuffled = [...uniqueCandidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  const winners = shuffled.slice(0, winnerCount);

  return deps.db.transaction((): DistributeRandomRedPacketResult => {
    let remainingAmount = input.totalAmount;
    let remainingCount = winnerCount;
    const shares: RandomDropShare[] = [];
    let bestLuckUserId = winners[0]!;
    let bestLuckAmount = -1;

    for (const userId of winners) {
      let share: number;
      if (remainingCount === 1) {
        share = remainingAmount;
      } else {
        const maxShare = Math.max(
          1,
          Math.min(
            remainingAmount - (remainingCount - 1),
            Math.floor((remainingAmount / remainingCount) * 2),
          ),
        );
        share = 1 + Math.min(maxShare - 1, Math.max(0, Math.floor(rng() * maxShare)));
      }
      remainingAmount -= share;
      remainingCount -= 1;

      const updated = deps.profileRepo.addCoins(input.guildId, userId, share);
      shares.push({
        userId,
        amount: share,
        newBalance: updated.coins,
      });
      if (share > bestLuckAmount) {
        bestLuckAmount = share;
        bestLuckUserId = userId;
      }
    }

    return {
      ok: true,
      totalAmount: input.totalAmount,
      winnerCount,
      shares,
      bestLuckUserId,
      bestLuckAmount,
    };
  })();
}

export function claimRedPacketOp(
  deps: MultiplayerDeps,
  packetId: number,
  userId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): ClaimRedPacketResult {
  return deps.db.transaction((): ClaimRedPacketResult => {
    const packet = deps.redPacketRepo.getById(packetId);
    if (!packet) {
      return { ok: false, reason: 'not_found' };
    }
    if (packet.status === 'expired') {
      return { ok: false, reason: 'expired' };
    }
    if (packet.status !== 'open' || packet.remainingCount <= 0) {
      return { ok: false, reason: 'finished' };
    }
    if (packet.expiresAt <= nowMs) {
      return { ok: false, reason: 'expired' };
    }
    if (deps.redPacketRepo.hasClaimed(packetId, userId)) {
      return { ok: false, reason: 'already_claimed' };
    }

    let share: number;
    if (packet.remainingCount === 1) {
      share = packet.remainingAmount;
    } else {
      const maxShare = Math.max(
        1,
        Math.min(
          packet.remainingAmount - (packet.remainingCount - 1),
          Math.floor((packet.remainingAmount / packet.remainingCount) * 2),
        ),
      );
      share = 1 + Math.min(maxShare - 1, Math.max(0, Math.floor(rng() * maxShare)));
    }

    let garnished = 0;
    let netShare = share;
    if (deps.creditLoanService) {
      const garnishRes = deps.creditLoanService.garnishIncomingCoins(
        packet.guildId,
        userId,
        share,
        'red_packet',
        nowMs,
      );
      garnished = garnishRes.garnished;
      netShare = garnishRes.netAmount;
    }

    const updatedClaimer =
      netShare > 0
        ? deps.profileRepo.addCoins(packet.guildId, userId, netShare)
        : deps.profileRepo.getOrCreate(packet.guildId, userId);
    const updatedPacket = deps.redPacketRepo.recordClaimAndDecrement(
      packetId,
      userId,
      share,
      nowMs,
    );
    const claims = deps.redPacketRepo.listClaims(packetId);
    const bestLuckUserId = computeBestLuckUserId(updatedPacket, claims);

    return {
      ok: true,
      amount: share,
      claimerBalance: updatedClaimer.coins,
      packet: updatedPacket,
      claims,
      bestLuckUserId,
      ...(deps.creditLoanService ? { garnished } : {}),
    };
  })();
}

export function expireRedPacketIfDueOp(
  deps: MultiplayerDeps,
  packetId: number,
  nowMs = Date.now(),
): ExpiredRedPacketResult | null {
  return deps.db.transaction((): ExpiredRedPacketResult | null => {
    const current = deps.redPacketRepo.getById(packetId);
    if (!current || current.status !== 'open' || current.expiresAt > nowMs) {
      return null;
    }
    const changed = deps.redPacketRepo.markExpired(current.id);
    if (!changed) {
      return null;
    }
    const refundedAmount =
      !current.systemFunded && current.remainingAmount > 0 ? current.remainingAmount : 0;
    if (refundedAmount > 0) {
      deps.profileRepo.addCoins(current.guildId, current.senderId, refundedAmount);
    }
    const updated = deps.redPacketRepo.getById(current.id) ?? {
      ...current,
      status: 'expired' as const,
    };
    return { packet: updated, refundedAmount };
  })();
}

export function expireDueRedPacketsOp(
  deps: MultiplayerDeps,
  nowMs = Date.now(),
): ExpiredRedPacketResult[] {
  const due = deps.redPacketRepo.listDueOpen(nowMs);
  const results: ExpiredRedPacketResult[] = [];

  for (const item of due) {
    const result = expireRedPacketIfDueOp(deps, item.id, nowMs);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

export function getRedPacketWithClaimsOp(
  deps: MultiplayerDeps,
  packetId: number,
): RedPacketWithClaims | null {
  const packet = deps.redPacketRepo.getById(packetId);
  if (!packet) {
    return null;
  }
  const claims = deps.redPacketRepo.listClaims(packetId);
  return {
    packet,
    claims,
    bestLuckUserId: computeBestLuckUserId(packet, claims),
  };
}
