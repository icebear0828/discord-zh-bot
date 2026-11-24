import type { InviteRecord, InviteRepo } from '../db/repositories/inviteRepo.js';

export interface InviteSnapshotItem {
  code: string;
  uses: number;
  inviterId?: string | null;
  maxUses?: number | null;
}

interface CachedInviteEntry {
  uses: number;
  maxUses: number | null;
  inviterId: string | null;
}

interface DeletedOneShotEntry {
  code: string;
  inviterId: string;
  deletedAt: number;
}

const ONE_SHOT_DELETE_TTL_MS = 15_000;

export class InviteService {
  private readonly cache = new Map<string, Map<string, CachedInviteEntry>>();
  private readonly recentlyDeletedOneShots = new Map<string, Map<string, DeletedOneShotEntry>>();

  constructor(private readonly inviteRepo: InviteRepo) {}

  hasGuildCache(guildId: string): boolean {
    return this.cache.has(guildId);
  }

  syncGuildInvites(guildId: string, invites: readonly InviteSnapshotItem[]): void {
    const guildMap = new Map<string, CachedInviteEntry>();
    for (const inv of invites) {
      guildMap.set(inv.code, {
        uses: inv.uses,
        maxUses: inv.maxUses ?? null,
        inviterId: inv.inviterId ?? null,
      });
    }
    this.cache.set(guildId, guildMap);
  }

  upsertInvite(
    guildId: string,
    code: string,
    uses: number,
    options?: { inviterId?: string | null; maxUses?: number | null },
  ): void {
    // Do not create a partial cache for an uninitialized guild — otherwise the first join
    // would mistake the incomplete map for a valid snapshot and false-attribute invites.
    const guildMap = this.cache.get(guildId);
    if (!guildMap) {
      return;
    }
    const existing = guildMap.get(code);
    guildMap.set(code, {
      uses,
      maxUses: options?.maxUses ?? existing?.maxUses ?? null,
      inviterId: options?.inviterId ?? existing?.inviterId ?? null,
    });
  }

  deleteInvite(guildId: string, code: string, nowMs = Date.now()): void {
    const guildMap = this.cache.get(guildId);
    const removed = guildMap?.get(code);
    guildMap?.delete(code);

    if (
      removed &&
      removed.inviterId &&
      removed.maxUses !== null &&
      removed.maxUses > 0 &&
      removed.uses + 1 === removed.maxUses
    ) {
      let deletedMap = this.recentlyDeletedOneShots.get(guildId);
      if (!deletedMap) {
        deletedMap = new Map<string, DeletedOneShotEntry>();
        this.recentlyDeletedOneShots.set(guildId, deletedMap);
      }
      deletedMap.set(code, {
        code,
        inviterId: removed.inviterId,
        deletedAt: nowMs,
      });
    }
  }

  detectAndRecordJoin(
    guildId: string,
    inviteeId: string,
    currentInvites: readonly InviteSnapshotItem[],
    nowMs = Date.now(),
  ): { inviterId: string; inviteCode: string } | null {
    const previous = this.cache.get(guildId);
    if (!previous) {
      // Uninitialized guild cache: only sync snapshot, never false-attribute.
      this.syncGuildInvites(guildId, currentInvites);
      return null;
    }

    const matches: Array<{ code: string; inviterId: string }> = [];
    const currentCodes = new Set<string>();

    for (const inv of currentInvites) {
      currentCodes.add(inv.code);
      const oldUses = previous.get(inv.code)?.uses ?? 0;
      if (inv.uses > oldUses && inv.inviterId) {
        matches.push({ code: inv.code, inviterId: inv.inviterId });
      }
    }

    // Detect vanished one-shot / last-use invites (old.uses + 1 === old.maxUses)
    for (const [code, oldEntry] of previous.entries()) {
      if (
        !currentCodes.has(code) &&
        oldEntry.inviterId &&
        oldEntry.maxUses !== null &&
        oldEntry.maxUses > 0 &&
        oldEntry.uses + 1 === oldEntry.maxUses
      ) {
        matches.push({ code, inviterId: oldEntry.inviterId });
      }
    }

    // Also inspect one-shot invites recently removed by Events.InviteDelete just before GuildMemberAdd
    const deletedMap = this.recentlyDeletedOneShots.get(guildId);
    if (deletedMap) {
      for (const [code, entry] of deletedMap.entries()) {
        if (nowMs - entry.deletedAt > ONE_SHOT_DELETE_TTL_MS || currentCodes.has(code)) {
          deletedMap.delete(code);
          continue;
        }
        if (!matches.some((m) => m.code === code)) {
          matches.push({ code: entry.code, inviterId: entry.inviterId });
        }
      }
    }

    this.syncGuildInvites(guildId, currentInvites);

    if (matches.length !== 1) {
      return null;
    }

    const used = matches[0]!;
    deletedMap?.delete(used.code);

    this.inviteRepo.recordInvite({
      guildId,
      inviterId: used.inviterId,
      inviteeId,
      inviteCode: used.code,
      joinedAt: nowMs,
    });
    return { inviterId: used.inviterId, inviteCode: used.code };
  }

  getUserStats(
    guildId: string,
    userId: string,
  ): { count: number; recent: InviteRecord[] } {
    return {
      count: this.inviteRepo.countByInviter(guildId, userId),
      recent: this.inviteRepo.listByInviter(guildId, userId, 10),
    };
  }
}
