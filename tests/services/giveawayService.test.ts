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

    expect(svc.toggleEntry(gw.id, 'u1', 1, ['role-vip']).reason).toBe('level_too_low');
    expect(svc.toggleEntry(gw.id, 'u1', 5, []).reason).toBe('missing_role');

    const join = svc.toggleEntry(gw.id, 'u1', 5, ['role-vip']);
    expect(join.ok).toBe(true);
    expect(join.joined).toBe(true);
    expect(join.entryCount).toBe(1);

    const leave = svc.toggleEntry(gw.id, 'u1', 5, ['role-vip']);
    expect(leave.joined).toBe(false);

    svc.toggleEntry(gw.id, 'u2', 5, ['role-vip']);
    svc.toggleEntry(gw.id, 'u3', 5, ['role-vip']);
    const due = svc.getDueGiveaways(2_000_001);
    expect(due).toHaveLength(1);

    const ended = svc.finalizeGiveaway(gw.id, () => 0.1);
    expect(ended?.ended).toBe(true);
    expect(ended?.winners).toHaveLength(1);
    expect(['u2', 'u3']).toContain(ended?.winners[0]);

    const rerolled = svc.rerollGiveaway(gw.id, () => 0.8);
    expect(rerolled?.winners).toHaveLength(1);

    db.close();
  });
});
