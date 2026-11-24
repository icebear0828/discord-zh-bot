import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { GiveawayRepo } from '../../src/db/repositories/giveawayRepo.js';
import {
  GiveawayService,
  parseDurationMs,
  pickWinners,
} from '../../src/services/giveawayService.js';

describe('giveawayService', () => {
  it('parses English and Chinese durations with min/max bounds', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('10m')).toBe(600_000);
    expect(parseDurationMs('1d12h')).toBe(36 * 3600_000);
    expect(parseDurationMs('15分钟')).toBe(900_000);
    expect(parseDurationMs('2天')).toBe(2 * 86_400_000);
    expect(parseDurationMs('5s')).toBeNull(); // below 10s
    expect(parseDurationMs('40d')).toBeNull(); // above 30d
    expect(parseDurationMs('abc')).toBeNull();
  });

  it('validates entry thresholds, picks unique winners, and supports reroll', () => {
    const db = createDatabase(':memory:');
    const repo = new GiveawayRepo(db);
    const svc = new GiveawayService(repo);

    expect(pickWinners(['u1', 'u2', 'u3'], 2, () => 0.25)).toHaveLength(2);
    expect(new Set(pickWinners(['u1', 'u2', 'u3'], 5)).size).toBe(3);

    const gw = svc.createGiveaway({
      guildId: 'g1',
      channelId: 'c1',
      messageId: 'm1',
      hostId: 'host1',
      prize: 'Nitro',
      winnerCount: 1,
      minLevel: 3,
      requiredRoleId: 'role-vip',
      endsAt: 2_000_000,
    });

    expect(svc.toggleEntry(gw.id, 'u1', 1, ['role-vip'], 1_000_000).reason).toBe('level_too_low');
    expect(svc.toggleEntry(gw.id, 'u1', 5, [], 1_000_000).reason).toBe('missing_role');

    const join = svc.toggleEntry(gw.id, 'u1', 5, ['role-vip'], 1_000_000);
    expect(join.ok).toBe(true);
    expect(join.joined).toBe(true);
    expect(join.entryCount).toBe(1);

    const leave = svc.toggleEntry(gw.id, 'u1', 5, ['role-vip'], 1_000_000);
    expect(leave.joined).toBe(false);

    svc.toggleEntry(gw.id, 'u2', 5, ['role-vip'], 1_000_000);
    svc.toggleEntry(gw.id, 'u3', 5, ['role-vip'], 1_000_000);
    const due = svc.getDueGiveaways(2_000_001);
    expect(due).toHaveLength(1);

    // Must block join/leave/toggle once nowMs >= endsAt even before finalizeGiveaway runs
    expect(svc.toggleEntry(gw.id, 'u4', 5, ['role-vip'], 2_000_000)).toEqual({
      ok: false,
      reason: 'ended',
    });
    expect(svc.joinEntry(gw.id, 'u4', 5, ['role-vip'], 2_000_000)).toEqual({
      ok: false,
      reason: 'ended',
    });
    expect(svc.leaveEntry(gw.id, 'u2', 2_000_000)).toEqual({
      ok: false,
      reason: 'ended',
    });

    const ended = svc.finalizeGiveaway(gw.id, () => 0.1);
    expect(ended?.ended).toBe(true);
    expect(ended?.winners).toHaveLength(1);
    expect(['u2', 'u3']).toContain(ended?.winners[0]);

    const rerolled = svc.rerollGiveaway(gw.id, () => 0.8);
    expect(rerolled?.winners).toHaveLength(1);

    db.close();
  });

  it('supports joinEntry (non-destructive re-click) and explicit leaveEntry', () => {
    const db = createDatabase(':memory:');
    const repo = new GiveawayRepo(db);
    const svc = new GiveawayService(repo);

    const gw = svc.createGiveaway({
      guildId: 'g1',
      channelId: 'c1',
      messageId: 'm2',
      hostId: 'host1',
      prize: '星币大礼包',
      winnerCount: 1,
      minLevel: 0,
      requiredRoleId: null,
      endsAt: 5_000_000,
    });

    const first = svc.joinEntry(gw.id, 'u1', 1, [], 1_000_000);
    expect(first).toEqual({ ok: true, joined: true, alreadyJoined: false, entryCount: 1 });

    // Clicking join again does NOT remove entry
    const second = svc.joinEntry(gw.id, 'u1', 1, [], 1_000_000);
    expect(second).toEqual({ ok: true, joined: true, alreadyJoined: true, entryCount: 1 });
    expect(svc.countEntries(gw.id)).toBe(1);

    // Explicit leave removes entry
    const left = svc.leaveEntry(gw.id, 'u1', 1_000_000);
    expect(left).toEqual({ ok: true, left: true, entryCount: 0 });

    // Leaving again is idempotent
    const leftAgain = svc.leaveEntry(gw.id, 'u1', 1_000_000);
    expect(leftAgain).toEqual({ ok: true, left: false, entryCount: 0 });

    db.close();
  });
});
