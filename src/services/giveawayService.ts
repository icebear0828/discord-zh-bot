import type { GiveawayRecord, GiveawayRepo } from '../db/repositories/giveawayRepo.js';

const MIN_DURATION_MS = 10_000;
const MAX_DURATION_MS = 30 * 86_400_000;

const UNIT_MS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  秒: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  分: 60_000,
  分钟: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  小时: 3_600_000,
  时: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  天: 86_400_000,
};

export function parseDurationMs(rawInput: string): number | null {
  const input = rawInput.trim().toLowerCase();
  if (!input) {
    return null;
  }

  const pattern = /(\d+)\s*(分钟|小时|secs?|mins?|hrs?|days?|秒|分|时|天|s|m|h|d)/g;
  let totalMs = 0;
  let consumedLength = 0;

  for (const match of input.matchAll(pattern)) {
    const full = match[0];
    const numStr = match[1];
    const unit = match[2];
    if (!numStr || !unit) continue;
    const multiplier = UNIT_MS[unit];
    if (!multiplier) return null;

    const value = Number(numStr);
    if (!Number.isFinite(value) || value <= 0) return null;

    totalMs += value * multiplier;
    consumedLength += full.replace(/\s+/g, '').length;
  }

  const compactLength = input.replace(/\s+/g, '').length;
  if (totalMs <= 0 || consumedLength !== compactLength) {
    return null;
  }

  if (totalMs < MIN_DURATION_MS || totalMs > MAX_DURATION_MS) {
    return null;
  }
  return totalMs;
}

export function pickWinners(
  entries: readonly string[],
  winnerCount: number,
  rng: () => number = Math.random,
): string[] {
  if (entries.length === 0 || winnerCount <= 0) {
    return [];
  }
  const pool = [...new Set(entries)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, Math.min(winnerCount, pool.length));
}

export type ToggleEntryResult =
  | { ok: true; joined: boolean; entryCount: number }
  | {
      ok: false;
      reason: 'not_found' | 'ended' | 'level_too_low' | 'missing_role';
      joined?: false;
      entryCount?: number;
      minLevel?: number;
      requiredRoleId?: string;
    };

export class GiveawayService {
  constructor(private readonly giveawayRepo: GiveawayRepo) {}

  createGiveaway(input: {
    guildId: string;
    channelId: string;
    messageId: string;
    hostId: string;
    prize: string;
    winnerCount: number;
    minLevel: number;
    requiredRoleId: string | null;
    endsAt: number;
  }): GiveawayRecord {
    return this.giveawayRepo.create(input);
  }

  getById(id: number): GiveawayRecord | null {
    return this.giveawayRepo.getById(id);
  }

  getByMessageId(messageId: string): GiveawayRecord | null {
    return this.giveawayRepo.getByMessageId(messageId);
  }

  listActive(guildId: string): GiveawayRecord[] {
    return this.giveawayRepo.listActiveByGuild(guildId);
  }

  getDueGiveaways(nowMs = Date.now()): GiveawayRecord[] {
    return this.giveawayRepo.listDue(nowMs);
  }

  countEntries(giveawayId: number): number {
    return this.giveawayRepo.countEntries(giveawayId);
  }

  toggleEntry(
    giveawayId: number,
    userId: string,
    memberLevel: number,
    memberRoleIds: readonly string[],
    nowMs = Date.now(),
  ): ToggleEntryResult {
    const gw = this.giveawayRepo.getById(giveawayId);
    if (!gw) {
      return { ok: false, reason: 'not_found' };
    }
    if (gw.ended) {
      return { ok: false, reason: 'ended' };
    }

    const alreadyJoined = this.giveawayRepo.hasEntry(gw.id, userId);
    if (alreadyJoined) {
      this.giveawayRepo.removeEntry(gw.id, userId);
      return {
        ok: true,
        joined: false,
        entryCount: this.giveawayRepo.countEntries(gw.id),
      };
    }

    if (gw.minLevel > 0 && memberLevel < gw.minLevel) {
      return { ok: false, reason: 'level_too_low', minLevel: gw.minLevel };
    }

    if (gw.requiredRoleId && !memberRoleIds.includes(gw.requiredRoleId)) {
      return {
        ok: false,
        reason: 'missing_role',
        requiredRoleId: gw.requiredRoleId,
      };
    }

    this.giveawayRepo.addEntry(gw.id, userId, nowMs);
    return {
      ok: true,
      joined: true,
      entryCount: this.giveawayRepo.countEntries(gw.id),
    };
  }

  finalizeGiveaway(giveawayId: number, rng: () => number = Math.random): GiveawayRecord | null {
    const gw = this.giveawayRepo.getById(giveawayId);
    if (!gw || gw.ended) {
      return gw;
    }
    const entries = this.giveawayRepo.listEntries(gw.id);
    const winners = pickWinners(entries, gw.winnerCount, rng);
    return this.giveawayRepo.markEnded(gw.id, winners);
  }

  rerollGiveaway(giveawayId: number, rng: () => number = Math.random): GiveawayRecord | null {
    const gw = this.giveawayRepo.getById(giveawayId);
    if (!gw) {
      return null;
    }
    const entries = this.giveawayRepo.listEntries(gw.id);
    const winners = pickWinners(entries, gw.winnerCount, rng);
    return this.giveawayRepo.markEnded(gw.id, winners);
  }
}
