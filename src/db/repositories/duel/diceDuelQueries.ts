import type Database from 'better-sqlite3';
import { mapDuelChallengeRow } from './duelMappers.js';
import type {
  DuelChallengeRecord,
  DuelChallengeSqlRow,
  DuelChallengeStatus,
} from './duelTypesAndSchema.js';

export function createDuelChallenge(
  db: Database.Database,
  input: {
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
  },
): DuelChallengeRecord {
  const status = input.status ?? 'pending';
  const messageId = input.messageId ?? null;
  db.prepare(
    `INSERT INTO duel_challenges (
      id, guild_id, channel_id, message_id, challenger_id, opponent_id,
      bet, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
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

  const created = getDuelChallengeById(db, input.id);
  if (!created) {
    throw new Error(`Failed to load created duel challenge ${input.id}`);
  }
  return created;
}

export function getDuelChallengeById(
  db: Database.Database,
  id: string,
): DuelChallengeRecord | null {
  const row = db
    .prepare('SELECT * FROM duel_challenges WHERE id = ?')
    .get(id) as DuelChallengeSqlRow | undefined;
  return row ? mapDuelChallengeRow(row) : null;
}

export function bindDuelChallengeMessageId(
  db: Database.Database,
  id: string,
  messageId: string,
): boolean {
  const res = db
    .prepare('UPDATE duel_challenges SET message_id = ? WHERE id = ?')
    .run(messageId, id);
  return res.changes > 0;
}

export function updateDuelChallengeStatus(
  db: Database.Database,
  id: string,
  status: DuelChallengeStatus,
  expectedCurrentStatus?: DuelChallengeStatus,
): boolean {
  if (expectedCurrentStatus !== undefined) {
    const res = db
      .prepare('UPDATE duel_challenges SET status = ? WHERE id = ? AND status = ?')
      .run(status, id, expectedCurrentStatus);
    return res.changes > 0;
  }
  const res = db
    .prepare('UPDATE duel_challenges SET status = ? WHERE id = ?')
    .run(status, id);
  return res.changes > 0;
}

export function listDuePendingDuelChallenges(
  db: Database.Database,
  nowMs: number,
): DuelChallengeRecord[] {
  const rows = db
    .prepare(
      "SELECT * FROM duel_challenges WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC, created_at ASC",
    )
    .all(nowMs) as DuelChallengeSqlRow[];
  return rows.map(mapDuelChallengeRow);
}

export function cleanupOldFinishedDuelChallenges(
  db: Database.Database,
  beforeMs: number,
): number {
  const res = db
    .prepare("DELETE FROM duel_challenges WHERE status != 'pending' AND expires_at <= ?")
    .run(beforeMs);
  return res.changes;
}
