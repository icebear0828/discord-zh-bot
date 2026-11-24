import type Database from 'better-sqlite3';

export const RED_PACKET_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS red_packets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  sender_id TEXT NOT NULL,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 1),
  remaining_amount INTEGER NOT NULL CHECK (remaining_amount >= 0),
  total_count INTEGER NOT NULL CHECK (total_count >= 1),
  remaining_count INTEGER NOT NULL CHECK (remaining_count >= 0),
  greeting TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'finished', 'expired')),
  system_funded INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_red_packets_due
  ON red_packets (status, expires_at);

CREATE TABLE IF NOT EXISTS red_packet_claims (
  packet_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 1),
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (packet_id, user_id),
  FOREIGN KEY (packet_id) REFERENCES red_packets(id) ON DELETE CASCADE
);
`;

export function initRedPacketSchema(db: Database.Database): void {
  db.exec(RED_PACKET_SCHEMA_SQL);
}

export type RedPacketStatus = 'open' | 'finished' | 'expired';

export interface RedPacket {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  senderId: string;
  totalAmount: number;
  remainingAmount: number;
  totalCount: number;
  remainingCount: number;
  greeting: string;
  status: RedPacketStatus;
  systemFunded: boolean;
  expiresAt: number;
  createdAt: number;
}

export interface RedPacketClaim {
  packetId: number;
  userId: string;
  amount: number;
  claimedAt: number;
}

interface RedPacketRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  sender_id: string;
  total_amount: number;
  remaining_amount: number;
  total_count: number;
  remaining_count: number;
  greeting: string;
  status: RedPacketStatus;
  system_funded?: number;
  expires_at: number;
  created_at: number;
}

interface RedPacketClaimRow {
  packet_id: number;
  user_id: string;
  amount: number;
  claimed_at: number;
}

function mapRedPacket(row: RedPacketRow): RedPacket {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    senderId: row.sender_id,
    totalAmount: row.total_amount,
    remainingAmount: row.remaining_amount,
    totalCount: row.total_count,
    remainingCount: row.remaining_count,
    greeting: row.greeting,
    status: row.status,
    systemFunded: Boolean(row.system_funded),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapClaim(row: RedPacketClaimRow): RedPacketClaim {
  return {
    packetId: row.packet_id,
    userId: row.user_id,
    amount: row.amount,
    claimedAt: row.claimed_at,
  };
}

export class RedPacketRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    guildId: string;
    channelId: string;
    senderId: string;
    totalAmount: number;
    totalCount: number;
    greeting: string;
    expiresAt: number;
    createdAt: number;
    systemFunded?: boolean;
  }): RedPacket {
    const res = this.db
      .prepare(
        `INSERT INTO red_packets (
          guild_id, channel_id, message_id, sender_id,
          total_amount, remaining_amount, total_count, remaining_count,
          greeting, status, system_funded, expires_at, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.senderId,
        input.totalAmount,
        input.totalAmount,
        input.totalCount,
        input.totalCount,
        input.greeting,
        input.systemFunded ? 1 : 0,
        input.expiresAt,
        input.createdAt,
      );

    const created = this.getById(Number(res.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to load created red packet');
    }
    return created;
  }

  bindMessageId(packetId: number, messageId: string): void {
    this.db
      .prepare('UPDATE red_packets SET message_id = ? WHERE id = ?')
      .run(messageId, packetId);
  }

  getById(packetId: number): RedPacket | null {
    const row = this.db
      .prepare('SELECT * FROM red_packets WHERE id = ?')
      .get(packetId) as RedPacketRow | undefined;
    return row ? mapRedPacket(row) : null;
  }

  listClaims(packetId: number): RedPacketClaim[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM red_packet_claims WHERE packet_id = ? ORDER BY claimed_at ASC, rowid ASC',
      )
      .all(packetId) as RedPacketClaimRow[];
    return rows.map(mapClaim);
  }

  hasClaimed(packetId: number, userId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM red_packet_claims WHERE packet_id = ? AND user_id = ?')
      .get(packetId, userId);
    return row !== undefined;
  }

  recordClaimAndDecrement(
    packetId: number,
    userId: string,
    amount: number,
    claimedAt: number,
  ): RedPacket {
    return this.db.transaction((): RedPacket => {
      this.db
        .prepare(
          'INSERT INTO red_packet_claims (packet_id, user_id, amount, claimed_at) VALUES (?, ?, ?, ?)',
        )
        .run(packetId, userId, amount, claimedAt);

      const res = this.db
        .prepare(
          `UPDATE red_packets
           SET remaining_amount = remaining_amount - ?,
               remaining_count = remaining_count - 1,
               status = CASE WHEN remaining_count - 1 = 0 THEN 'finished' ELSE status END
           WHERE id = ? AND status = 'open' AND remaining_count >= 1 AND remaining_amount >= ?`,
        )
        .run(amount, packetId, amount);

      if (res.changes === 0) {
        throw new Error(`Red packet ${packetId} could not be updated for claim`);
      }

      const updated = this.getById(packetId);
      if (!updated) {
        throw new Error(`Red packet ${packetId} not found after claim`);
      }
      return updated;
    })();
  }

  listDueOpen(nowMs: number): RedPacket[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM red_packets WHERE status = 'open' AND expires_at <= ? ORDER BY expires_at ASC, id ASC",
      )
      .all(nowMs) as RedPacketRow[];
    return rows.map(mapRedPacket);
  }

  markExpired(packetId: number): boolean {
    const res = this.db
      .prepare("UPDATE red_packets SET status = 'expired' WHERE id = ? AND status = 'open'")
      .run(packetId);
    return res.changes > 0;
  }
}
