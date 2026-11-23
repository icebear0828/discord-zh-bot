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
});
