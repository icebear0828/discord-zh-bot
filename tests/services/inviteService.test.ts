import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { InviteService } from '../../src/services/inviteService.js';

describe('inviteService', () => {
  it('detects the incremented invite code and records inviter statistics', () => {
    const db = createDatabase(':memory:');
    const repo = new InviteRepo(db);
    const svc = new InviteService(repo);

    svc.syncGuildInvites('g1', [
      { code: 'AAA', uses: 2 },
      { code: 'BBB', uses: 5 },
    ]);

    const matched = svc.detectAndRecordJoin('g1', 'new-user', [
      { code: 'AAA', uses: 2, inviterId: 'u1' },
      { code: 'BBB', uses: 6, inviterId: 'u2' },
    ]);

    expect(matched).toEqual({
      inviterId: 'u2',
      inviteCode: 'BBB',
    });

    const stats = svc.getUserStats('g1', 'u2');
    expect(stats.count).toBe(1);
    expect(stats.recent[0]?.inviteeId).toBe('new-user');

    db.close();
  });

  it('never false-attributes on first join when guild cache is uninitialized', () => {
    const db = createDatabase(':memory:');
    const repo = new InviteRepo(db);
    const svc = new InviteService(repo);

    // Even if upsertInvite was called before full sync, guild is not initialized yet
    svc.upsertInvite('g-uninit', 'NEW', 0, { inviterId: 'u9', maxUses: 1 });

    // First join sees an existing invite with uses > 0: must sync snapshot and return null
    const first = svc.detectAndRecordJoin('g-uninit', 'joiner-1', [
      { code: 'OLD', uses: 10, inviterId: 'u1', maxUses: 0 },
    ]);
    expect(first).toBeNull();
    expect(svc.getUserStats('g-uninit', 'u1').count).toBe(0);

    // Second join after snapshot is synced detects increment properly
    const second = svc.detectAndRecordJoin('g-uninit', 'joiner-2', [
      { code: 'OLD', uses: 11, inviterId: 'u1', maxUses: 0 },
    ]);
    expect(second).toEqual({ inviterId: 'u1', inviteCode: 'OLD' });

    db.close();
  });

  it('detects vanished one-shot invites where old.uses + 1 === old.maxUses (direct and after deleteInvite)', () => {
    const db = createDatabase(':memory:');
    const repo = new InviteRepo(db);
    const svc = new InviteService(repo);

    // Case 1: invite disappears directly between snapshots
    svc.syncGuildInvites('g1', [
      { code: 'PERM', uses: 5, inviterId: 'u1', maxUses: 0 },
      { code: 'ONCE1', uses: 0, inviterId: 'u2', maxUses: 1 },
    ]);

    const match1 = svc.detectAndRecordJoin(
      'g1',
      'joiner-a',
      [{ code: 'PERM', uses: 5, inviterId: 'u1', maxUses: 0 }],
      10_000,
    );
    expect(match1).toEqual({ inviterId: 'u2', inviteCode: 'ONCE1' });

    // Case 2: Events.InviteDelete fires right before GuildMemberAdd
    svc.upsertInvite('g1', 'ONCE2', 0, { inviterId: 'u3', maxUses: 1 });
    svc.deleteInvite('g1', 'ONCE2', 20_000);

    const match2 = svc.detectAndRecordJoin(
      'g1',
      'joiner-b',
      [{ code: 'PERM', uses: 5, inviterId: 'u1', maxUses: 0 }],
      21_000,
    );
    expect(match2).toEqual({ inviterId: 'u3', inviteCode: 'ONCE2' });

    // Case 3: vanished invite with uses + 1 !== maxUses (e.g. manually revoked) must NOT match
    svc.syncGuildInvites('g2', [
      { code: 'REVOKED', uses: 0, inviterId: 'u4', maxUses: 5 },
    ]);
    const match3 = svc.detectAndRecordJoin('g2', 'joiner-c', [], 30_000);
    expect(match3).toBeNull();

    db.close();
  });
});
