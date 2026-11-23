import type Database from 'better-sqlite3';

export interface GiveawayRecord {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string;
  hostId: string;
  prize: string;
  winnerCount: number;
  minLevel: number;
  requiredRoleId: string | null;
  endsAt: number;
  ended: boolean;
  winners: string[];
  createdAt: number;
}

interface GiveawayRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string;
  host_id: string;
  prize: string;
  winner_count: number;
  min_level: number;
  required_role_id: string | null;
  ends_at: number;
  ended: number;
  winners_json: string;
  created_at: number;
}

function parseWinners(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((x): x is string => typeof x === 'string');
}

function mapGiveaway(row: GiveawayRow): GiveawayRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    hostId: row.host_id,
    prize: row.prize,
    winnerCount: row.winner_count,
    minLevel: row.min_level,
    requiredRoleId: row.required_role_id,
    endsAt: row.ends_at,
    ended: row.ended === 1,
    winners: parseWinners(row.winners_json),
    createdAt: row.created_at,
  };
}

export class GiveawayRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    guildId: string;
    channelId: string;
    messageId: string;
    hostId: string;
    prize: string;
    winnerCount: number;
    minLevel: number;
    requiredRoleId: string | null;
    endsAt: number;
    createdAt?: number;
  }): GiveawayRecord {
    const now = input.createdAt ?? Date.now();
    const res = this.db
      .prepare(
        `INSERT INTO giveaways (
          guild_id, channel_id, message_id, host_id, prize,
          winner_count, min_level, required_role_id, ends_at, ended, winners_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', ?)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.messageId,
        input.hostId,
        input.prize,
        input.winnerCount,
        input.minLevel,
        input.requiredRoleId,
        input.endsAt,
        now,
      );

    return this.getById(Number(res.lastInsertRowid))!;
  }

  getById(id: number): GiveawayRecord | null {
    const row = this.db
      .prepare('SELECT * FROM giveaways WHERE id = ?')
      .get(id) as GiveawayRow | undefined;
    return row ? mapGiveaway(row) : null;
  }

  getByMessageId(messageId: string): GiveawayRecord | null {
    const row = this.db
      .prepare('SELECT * FROM giveaways WHERE message_id = ?')
      .get(messageId) as GiveawayRow | undefined;
    return row ? mapGiveaway(row) : null;
  }

  listActiveByGuild(guildId: string): GiveawayRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 ORDER BY ends_at ASC')
      .all(guildId) as GiveawayRow[];
    return rows.map(mapGiveaway);
  }

  listDue(nowMs: number): GiveawayRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ? ORDER BY ends_at ASC')
      .all(nowMs) as GiveawayRow[];
    return rows.map(mapGiveaway);
  }

  hasEntry(giveawayId: number, userId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?')
      .get(giveawayId, userId);
    return row !== undefined;
  }

  addEntry(giveawayId: number, userId: string, joinedAt = Date.now()): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id, joined_at) VALUES (?, ?, ?)',
      )
      .run(giveawayId, userId, joinedAt);
  }

  removeEntry(giveawayId: number, userId: string): void {
    this.db
      .prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?')
      .run(giveawayId, userId);
  }

  listEntries(giveawayId: number): string[] {
    const rows = this.db
      .prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ? ORDER BY joined_at ASC')
      .all(giveawayId) as Array<{ user_id: string }>;
    return rows.map((r) => r.user_id);
  }

  countEntries(giveawayId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM giveaway_entries WHERE giveaway_id = ?')
      .get(giveawayId) as { cnt: number };
    return row.cnt;
  }

  markEnded(giveawayId: number, winners: string[]): GiveawayRecord | null {
    this.db
      .prepare('UPDATE giveaways SET ended = 1, winners_json = ? WHERE id = ?')
      .run(JSON.stringify(winners), giveawayId);
    return this.getById(giveawayId);
  }
}
