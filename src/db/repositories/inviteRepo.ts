import type Database from 'better-sqlite3';

export interface InviteRecord {
  id: number;
  guildId: string;
  inviterId: string;
  inviteeId: string;
  inviteCode: string;
  joinedAt: number;
}

export interface InviterLeaderboardRow {
  inviterId: string;
  inviteCount: number;
}

interface InviteRecordRow {
  id: number;
  guild_id: string;
  inviter_id: string;
  invitee_id: string;
  invite_code: string;
  joined_at: number;
}

function mapInvite(row: InviteRecordRow): InviteRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id,
    inviteCode: row.invite_code,
    joinedAt: row.joined_at,
  };
}

export class InviteRepo {
  constructor(private readonly db: Database.Database) {}

  recordInvite(input: {
    guildId: string;
    inviterId: string;
    inviteeId: string;
    inviteCode: string;
    joinedAt?: number;
  }): InviteRecord {
    const now = input.joinedAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO invite_records (guild_id, inviter_id, invitee_id, invite_code, joined_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, invitee_id)
         DO UPDATE SET inviter_id = excluded.inviter_id, invite_code = excluded.invite_code, joined_at = excluded.joined_at`,
      )
      .run(input.guildId, input.inviterId, input.inviteeId, input.inviteCode, now);

    const row = this.db
      .prepare('SELECT * FROM invite_records WHERE guild_id = ? AND invitee_id = ?')
      .get(input.guildId, input.inviteeId) as InviteRecordRow;
    return mapInvite(row);
  }

  countByInviter(guildId: string, inviterId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM invite_records WHERE guild_id = ? AND inviter_id = ?')
      .get(guildId, inviterId) as { cnt: number };
    return row.cnt;
  }

  listByInviter(guildId: string, inviterId: string, limit = 10): InviteRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM invite_records WHERE guild_id = ? AND inviter_id = ? ORDER BY joined_at DESC LIMIT ?',
      )
      .all(guildId, inviterId, limit) as InviteRecordRow[];
    return rows.map(mapInvite);
  }

  listLeaderboard(
    guildId: string,
    limit: number,
    offset: number,
  ): { items: InviterLeaderboardRow[]; total: number } {
    const rows = this.db
      .prepare(
        `SELECT inviter_id, COUNT(*) AS cnt
         FROM invite_records
         WHERE guild_id = ?
         GROUP BY inviter_id
         ORDER BY cnt DESC, MIN(joined_at) ASC
         LIMIT ? OFFSET ?`,
      )
      .all(guildId, limit, offset) as Array<{ inviter_id: string; cnt: number }>;

    const total = this.db
      .prepare('SELECT COUNT(DISTINCT inviter_id) AS cnt FROM invite_records WHERE guild_id = ?')
      .get(guildId) as { cnt: number };

    return {
      items: rows.map((r) => ({ inviterId: r.inviter_id, inviteCount: r.cnt })),
      total: total.cnt,
    };
  }
}
