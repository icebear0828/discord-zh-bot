import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { TicketRepo } from '../../src/db/repositories/ticketRepo.js';
import { TicketService } from '../../src/services/ticketService.js';

describe('ticketService', () => {
  it('enforces maxOpenPerUser, increments counter, and closes tickets', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const ticketRepo = new TicketRepo(db);
    const svc = new TicketService(configRepo, ticketRepo);

    const t1 = svc.createTicket('g1', 'ch-1', 'u1', '充值问题');
    expect(t1.ticketNumber).toBe(1);
    const t2 = svc.createTicket('g1', 'ch-2', 'u1', '举报玩家');
    expect(t2.ticketNumber).toBe(2);

    expect(svc.canOpenTicket('g1', 'u1')).toEqual({
      allowed: false,
      openCount: 2,
      maxOpen: 2,
    });

    const closed = svc.closeTicket('ch-1', 'admin-1');
    expect(closed?.status).toBe('closed');
    expect(svc.canOpenTicket('g1', 'u1').allowed).toBe(true);

    db.close();
  });

  it('atomically reserves ticket slots/numbers, enforces concurrent quota, and supports rollback', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const ticketRepo = new TicketRepo(db);
    const svc = new TicketService(configRepo, ticketRepo, db);

    // Reserve two slots concurrently before any channel is finalized (maxOpenPerUser = 2)
    const r1 = svc.reserveTicketSlot('g1', 'u1');
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error('expected r1 ok');
    expect(r1.ticketNumber).toBe(1);

    const r2 = svc.reserveTicketSlot('g1', 'u1');
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error('expected r2 ok');
    expect(r2.ticketNumber).toBe(2);

    // Third concurrent attempt must be rejected because 2 reservations are in-flight
    const r3 = svc.reserveTicketSlot('g1', 'u1');
    expect(r3).toEqual({ ok: false, openCount: 2, maxOpen: 2 });
    expect(svc.canOpenTicket('g1', 'u1')).toEqual({
      allowed: false,
      openCount: 2,
      maxOpen: 2,
    });

    // Release r1 (simulating channel creation failure) restores quota immediately
    svc.releaseReservation('g1', 'u1', r1.reservationId);
    expect(svc.canOpenTicket('g1', 'u1')).toEqual({
      allowed: true,
      openCount: 1,
      maxOpen: 2,
    });

    // Finalize r2 with its reserved ticketNumber = 2
    const finalized = svc.finalizeReservedTicket({
      guildId: 'g1',
      channelId: 'ch-2',
      creatorId: 'u1',
      subject: '账单问题',
      ticketNumber: r2.ticketNumber,
      reservationId: r2.reservationId,
    });
    expect(finalized.ticketNumber).toBe(2);
    expect(svc.getByChannel('ch-2')?.status).toBe('open');
    expect(svc.canOpenTicket('g1', 'u1').openCount).toBe(1);

    // Rollback finalized ticket (simulating welcome send failure) clears open ticket & restores quota
    svc.rollbackTicket('g1', 'u1', 'ch-2', r2.reservationId);
    expect(svc.canOpenTicket('g1', 'u1').openCount).toBe(0);
    expect(svc.getByChannel('ch-2')).toBeNull();

    db.close();
  });
});
