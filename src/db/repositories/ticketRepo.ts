import type Database from 'better-sqlite3';

export type TicketStatus = 'open' | 'closed';

export interface TicketRecord {
  id: number;
  guildId: string;
  channelId: string;
  ticketNumber: number;
  creatorId: string;
  subject: string;
  status: TicketStatus;
  createdAt: number;
  closedAt: number | null;
  closedBy: string | null;
}

interface TicketRow {
  id: number;
  guild_id: string;
  channel_id: string;
  ticket_number: number;
  creator_id: string;
  subject: string;
  status: TicketStatus;
  created_at: number;
  closed_at: number | null;
  closed_by: string | null;
}

function mapTicket(row: TicketRow): TicketRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    ticketNumber: row.ticket_number,
    creatorId: row.creator_id,
    subject: row.subject,
    status: row.status,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  };
}

export class TicketRepo {
  constructor(private readonly db: Database.Database) {}

  countOpenByCreator(guildId: string, creatorId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM tickets WHERE guild_id = ? AND creator_id = ? AND status = 'open'",
      )
      .get(guildId, creatorId) as { cnt: number };
    return row.cnt;
  }

  create(input: {
    guildId: string;
    channelId: string;
    ticketNumber: number;
    creatorId: string;
    subject: string;
    createdAt?: number;
  }): TicketRecord {
    const now = input.createdAt ?? Date.now();
    const res = this.db
      .prepare(
        `INSERT INTO tickets (
          guild_id, channel_id, ticket_number, creator_id, subject, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.ticketNumber,
        input.creatorId,
        input.subject,
        now,
      );

    const row = this.db
      .prepare('SELECT * FROM tickets WHERE id = ?')
      .get(Number(res.lastInsertRowid)) as TicketRow;
    return mapTicket(row);
  }

  getByChannel(channelId: string): TicketRecord | null {
    const row = this.db
      .prepare('SELECT * FROM tickets WHERE channel_id = ?')
      .get(channelId) as TicketRow | undefined;
    return row ? mapTicket(row) : null;
  }

  close(channelId: string, closedBy: string, closedAt = Date.now()): TicketRecord | null {
    this.db
      .prepare(
        "UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE channel_id = ? AND status = 'open'",
      )
      .run(closedAt, closedBy, channelId);
    return this.getByChannel(channelId);
  }
}
