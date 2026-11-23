import type { InviteRecord, InviteRepo } from '../db/repositories/inviteRepo.js';

export interface InviteSnapshotItem {
  code: string;
  uses: number;
  inviterId?: string | null;
}

export class InviteService {
  private readonly cache = new Map<string, Map<string, number>>();

  constructor(private readonly inviteRepo: InviteRepo) {}

  syncGuildInvites(guildId: string, invites: readonly InviteSnapshotItem[]): void {
    const guildMap = new Map<string, number>();
    for (const inv of invites) {
      guildMap.set(inv.code, inv.uses);
    }
    this.cache.set(guildId, guildMap);
  }

  upsertInvite(guildId: string, code: string, uses: number): void {
    let guildMap = this.cache.get(guildId);
    if (!guildMap) {
      guildMap = new Map<string, number>();
      this.cache.set(guildId, guildMap);
    }
    guildMap.set(code, uses);
  }

  deleteInvite(guildId: string, code: string): void {
    this.cache.get(guildId)?.delete(code);
  }

  detectAndRecordJoin(
    guildId: string,
    inviteeId: string,
    currentInvites: readonly InviteSnapshotItem[],
    nowMs = Date.now(),
  ): { inviterId: string; inviteCode: string } | null {
    const previous = this.cache.get(guildId) ?? new Map<string, number>();
    const matches: Array<{ code: string; inviterId: string }> = [];

    for (const inv of currentInvites) {
      const oldUses = previous.get(inv.code) ?? 0;
      if (inv.uses > oldUses && inv.inviterId) {
        matches.push({ code: inv.code, inviterId: inv.inviterId });
      }
    }

    this.syncGuildInvites(guildId, currentInvites);

    if (matches.length !== 1) {
      return null;
    }

    const used = matches[0]!;
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
