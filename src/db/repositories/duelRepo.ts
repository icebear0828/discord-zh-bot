import type Database from 'better-sqlite3';

export const DUEL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS duel_challenges (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  challenger_id TEXT NOT NULL,
  opponent_id TEXT NOT NULL,
  bet INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_duel_challenges_status_exp
  ON duel_challenges (status, expires_at);
`;

export function initDuelSchema(db: Database.Database): void {
  db.exec(DUEL_SCHEMA_SQL);
}

export type DuelChallengeStatus = 'pending' | 'completed' | 'declined' | 'expired';

export interface DuelChallengeRecord {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  challengerId: string;
  opponentId: string;
  bet: number;
  status: DuelChallengeStatus;
  createdAt: number;
  expiresAt: number;
}

interface DuelChallengeSqlRow {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  challenger_id: string;
  opponent_id: string;
  bet: number;
  status: string;
  created_at: number;
  expires_at: number;
}

const VALID_DUEL_STATUSES = new Set<string>(['pending', 'completed', 'declined', 'expired']);

function parseDuelStatus(value: string): DuelChallengeStatus {
  if (VALID_DUEL_STATUSES.has(value)) {
    return value as DuelChallengeStatus;
  }
  return 'pending';
}

function mapRow(row: DuelChallengeSqlRow): DuelChallengeRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    challengerId: row.challenger_id,
    opponentId: row.opponent_id,
    bet: row.bet,
    status: parseDuelStatus(row.status),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class DuelRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    id: string;
    guildId: string;
    channelId: string;
    messageId?: string | null;
    challengerId: string;
    opponentId: string;
    bet: number;
    status?: DuelChallengeStatus;
    createdAt: number;
    expiresAt: number;
  }): DuelChallengeRecord {
    const status = input.status ?? 'pending';
    const messageId = input.messageId ?? null;
    this.db
      .prepare(
        `INSERT INTO duel_challenges (
          id, guild_id, channel_id, message_id, challenger_id, opponent_id,
          bet, status, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.guildId,
        input.channelId,
        messageId,
        input.challengerId,
        input.opponentId,
        input.bet,
        status,
        input.createdAt,
        input.expiresAt,
      );

    const created = this.getById(input.id);
    if (!created) {
      throw new Error(`Failed to load created duel challenge ${input.id}`);
    }
    return created;
  }

  getById(id: string): DuelChallengeRecord | null {
    const row = this.db
      .prepare('SELECT * FROM duel_challenges WHERE id = ?')
      .get(id) as DuelChallengeSqlRow | undefined;
    return row ? mapRow(row) : null;
  }

  bindMessageId(id: string, messageId: string): boolean {
    const res = this.db
      .prepare('UPDATE duel_challenges SET message_id = ? WHERE id = ?')
      .run(messageId, id);
    return res.changes > 0;
  }

  updateStatus(
    id: string,
    status: DuelChallengeStatus,
    expectedCurrentStatus?: DuelChallengeStatus,
  ): boolean {
    if (expectedCurrentStatus !== undefined) {
      const res = this.db
        .prepare('UPDATE duel_challenges SET status = ? WHERE id = ? AND status = ?')
        .run(status, id, expectedCurrentStatus);
      return res.changes > 0;
    }
    const res = this.db
      .prepare('UPDATE duel_challenges SET status = ? WHERE id = ?')
      .run(status, id);
    return res.changes > 0;
  }

  listDuePending(nowMs: number): DuelChallengeRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM duel_challenges WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC, created_at ASC",
      )
      .all(nowMs) as DuelChallengeSqlRow[];
    return rows.map(mapRow);
  }

  cleanupOldFinished(beforeMs: number): number {
    const res = this.db
      .prepare("DELETE FROM duel_challenges WHERE status != 'pending' AND expires_at <= ?")
      .run(beforeMs);
    return res.changes;
  }
}
