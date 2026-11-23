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
});
