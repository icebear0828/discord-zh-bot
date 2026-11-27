import type Database from 'better-sqlite3';
import {
  mapNicknameLockRow,
  mapRouletteDuelRow,
  mapRpsRow,
} from './duelMappers.js';
import type {
  DuelRouletteRecord,
  DuelRouletteSqlRow,
  NicknameLockRecord,
  NicknameLockSqlRow,
  RpsDuelRecord,
  RpsDuelSqlRow,
} from './duelTypesAndSchema.js';

// ========== RPS Duels ==========

export function createRpsDuel(
  db: Database.Database,
  input: {
    id: string;
    guildId: string;
    channelId: string;
    messageId?: string | null;
    challengerId: string;
    opponentId: string;
    bet: number;
    renameDurationMs: number;
    createdAt: number;
    expiresAt: number;
  },
): RpsDuelRecord {
  db.prepare(
    `INSERT INTO rps_duels (
      id, guild_id, channel_id, message_id, challenger_id, opponent_id,
      bet, rename_duration_ms, status, round_number, challenger_wins, opponent_wins,
      challenger_move, opponent_move, history_json, winner_id, loser_id,
      bounty_claimed, round_deadline, created_at, expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, 0, 0, NULL, NULL, '[]', NULL, NULL, 0, 0, ?, ?, ?)`,
  ).run(
    input.id,
    input.guildId,
    input.channelId,
    input.messageId ?? null,
    input.challengerId,
    input.opponentId,
    input.bet,
    input.renameDurationMs,
    input.createdAt,
    input.expiresAt,
    input.createdAt,
  );

  const created = getRpsDuelById(db, input.id);
  if (!created) {
    throw new Error(`Failed to load created rps duel ${input.id}`);
  }
  return created;
}

export function getRpsDuelById(db: Database.Database, id: string): RpsDuelRecord | null {
  const row = db
    .prepare('SELECT * FROM rps_duels WHERE id = ?')
    .get(id) as RpsDuelSqlRow | undefined;
  return row ? mapRpsRow(row) : null;
}

export function bindRpsDuelMessageId(
  db: Database.Database,
  id: string,
  messageId: string,
): boolean {
  const res = db
    .prepare('UPDATE rps_duels SET message_id = ? WHERE id = ?')
    .run(messageId, id);
  return res.changes > 0;
}

export function saveRpsDuel(db: Database.Database, duel: RpsDuelRecord): void {
  db.prepare(
    `UPDATE rps_duels SET
      message_id = ?, status = ?, round_number = ?,
      challenger_wins = ?, opponent_wins = ?,
      challenger_move = ?, opponent_move = ?,
      history_json = ?, winner_id = ?, loser_id = ?,
      bounty_claimed = ?, round_deadline = ?, updated_at = ?
    WHERE id = ?`,
  ).run(
    duel.messageId,
    duel.status,
    duel.roundNumber,
    duel.challengerWins,
    duel.opponentWins,
    duel.challengerMove,
    duel.opponentMove,
    JSON.stringify(duel.history),
    duel.winnerId,
    duel.loserId,
    duel.bountyClaimed,
    duel.roundDeadline,
    duel.updatedAt,
    duel.id,
  );
}

export function listDuePendingRpsDuels(db: Database.Database, nowMs: number): RpsDuelRecord[] {
  const rows = db
    .prepare(
      "SELECT * FROM rps_duels WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC, created_at ASC",
    )
    .all(nowMs) as RpsDuelSqlRow[];
  return rows.map(mapRpsRow);
}

export function listDuePlayingRpsDuels(db: Database.Database, nowMs: number): RpsDuelRecord[] {
  const rows = db
    .prepare(
      "SELECT * FROM rps_duels WHERE status = 'playing' AND round_deadline > 0 AND round_deadline <= ? ORDER BY round_deadline ASC",
    )
    .all(nowMs) as RpsDuelSqlRow[];
  return rows.map(mapRpsRow);
}

// ========== 1v1 Roulette Duels ==========

export function createRouletteDuelRecord(
  db: Database.Database,
  input: {
    id: string;
    guildId: string;
    channelId: string;
    messageId?: string | null;
    challengerId: string;
    opponentId: string;
    bullets: number;
    bet: number;
    renameDurationMs: number;
    timeoutDurationMs: number;
    customWager: string;
    createdAt: number;
    expiresAt: number;
  },
): DuelRouletteRecord {
  db.prepare(
    `INSERT INTO duel_roulettes (
      id, guild_id, channel_id, message_id, challenger_id, opponent_id,
      bullets, bet, rename_duration_ms, timeout_duration_ms, custom_wager,
      status, turn_order_json, turn_index, chamber_pos, bullet_positions_json,
      logs_json, winner_id, loser_id, bounty_claimed, turn_deadline,
      created_at, expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '[]', 0, 0, '[]', '[]', NULL, NULL, 0, 0, ?, ?, ?)`,
  ).run(
    input.id,
    input.guildId,
    input.channelId,
    input.messageId ?? null,
    input.challengerId,
    input.opponentId,
    input.bullets,
    input.bet,
    input.renameDurationMs,
    input.timeoutDurationMs,
    input.customWager,
    input.createdAt,
    input.expiresAt,
    input.createdAt,
  );

  const created = getRouletteDuelById(db, input.id);
  if (!created) {
    throw new Error(`Failed to load created roulette duel ${input.id}`);
  }
  return created;
}

export function getRouletteDuelById(
  db: Database.Database,
  id: string,
): DuelRouletteRecord | null {
  const row = db
    .prepare('SELECT * FROM duel_roulettes WHERE id = ?')
    .get(id) as DuelRouletteSqlRow | undefined;
  return row ? mapRouletteDuelRow(row) : null;
}

export function bindRouletteDuelMessageId(
  db: Database.Database,
  id: string,
  messageId: string,
): boolean {
  const res = db
    .prepare('UPDATE duel_roulettes SET message_id = ? WHERE id = ?')
    .run(messageId, id);
  return res.changes > 0;
}

export function saveRouletteDuel(db: Database.Database, duel: DuelRouletteRecord): void {
  db.prepare(
    `UPDATE duel_roulettes SET
      message_id = ?, status = ?, turn_order_json = ?,
      turn_index = ?, chamber_pos = ?, bullet_positions_json = ?,
      logs_json = ?, winner_id = ?, loser_id = ?,
      bounty_claimed = ?, turn_deadline = ?, updated_at = ?
    WHERE id = ?`,
  ).run(
    duel.messageId,
    duel.status,
    JSON.stringify(duel.turnOrder),
    duel.turnIndex,
    duel.chamberPos,
    JSON.stringify(duel.bulletPositions),
    JSON.stringify(duel.logs),
    duel.winnerId,
    duel.loserId,
    duel.bountyClaimed,
    duel.turnDeadline,
    duel.updatedAt,
    duel.id,
  );
}

export function listDuePendingRouletteDuels(
  db: Database.Database,
  nowMs: number,
): DuelRouletteRecord[] {
  const rows = db
    .prepare(
      "SELECT * FROM duel_roulettes WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC, created_at ASC",
    )
    .all(nowMs) as DuelRouletteSqlRow[];
  return rows.map(mapRouletteDuelRow);
}

export function listDuePlayingRouletteDuels(
  db: Database.Database,
  nowMs: number,
): DuelRouletteRecord[] {
  const rows = db
    .prepare(
      "SELECT * FROM duel_roulettes WHERE status = 'playing' AND turn_deadline > 0 AND turn_deadline <= ? ORDER BY turn_deadline ASC",
    )
    .all(nowMs) as DuelRouletteSqlRow[];
  return rows.map(mapRouletteDuelRow);
}

// ========== Nickname Locks ==========

export function getNicknameLock(
  db: Database.Database,
  guildId: string,
  targetId: string,
): NicknameLockRecord | null {
  const row = db
    .prepare('SELECT * FROM nickname_locks WHERE guild_id = ? AND target_id = ?')
    .get(guildId, targetId) as NicknameLockSqlRow | undefined;
  return row ? mapNicknameLockRow(row) : null;
}

export function upsertNicknameLock(db: Database.Database, lock: NicknameLockRecord): void {
  db.prepare(
    `INSERT INTO nickname_locks (
      guild_id, target_id, winner_id, source_type, source_id,
      original_nickname, original_nickname_captured, locked_nickname,
      fallback_mode, original_card_nickname, original_equipped_title,
      last_renamed_at, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, target_id) DO UPDATE SET
      winner_id = excluded.winner_id,
      source_type = excluded.source_type,
      source_id = excluded.source_id,
      original_nickname = excluded.original_nickname,
      original_nickname_captured = excluded.original_nickname_captured,
      locked_nickname = excluded.locked_nickname,
      fallback_mode = excluded.fallback_mode,
      original_card_nickname = excluded.original_card_nickname,
      original_equipped_title = excluded.original_equipped_title,
      last_renamed_at = excluded.last_renamed_at,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at`,
  ).run(
    lock.guildId,
    lock.targetId,
    lock.winnerId,
    lock.sourceType,
    lock.sourceId,
    lock.originalNickname,
    lock.originalNicknameCaptured ? 1 : 0,
    lock.lockedNickname,
    lock.fallbackMode ? 1 : 0,
    lock.originalCardNickname,
    lock.originalEquippedTitle,
    lock.lastRenamedAt,
    lock.expiresAt,
    lock.createdAt,
    lock.updatedAt,
  );
}

export function listActiveNicknameLocksByWinner(
  db: Database.Database,
  guildId: string,
  winnerId: string,
  nowMs: number,
): NicknameLockRecord[] {
  const rows = db
    .prepare(
      'SELECT * FROM nickname_locks WHERE guild_id = ? AND winner_id = ? AND expires_at > ? ORDER BY expires_at ASC',
    )
    .all(guildId, winnerId, nowMs) as NicknameLockSqlRow[];
  return rows.map(mapNicknameLockRow);
}

export function listDueNicknameLocks(
  db: Database.Database,
  nowMs: number,
): NicknameLockRecord[] {
  const rows = db
    .prepare('SELECT * FROM nickname_locks WHERE expires_at <= ? ORDER BY expires_at ASC')
    .all(nowMs) as NicknameLockSqlRow[];
  return rows.map(mapNicknameLockRow);
}

export function deleteNicknameLock(
  db: Database.Database,
  guildId: string,
  targetId: string,
): boolean {
  const res = db
    .prepare('DELETE FROM nickname_locks WHERE guild_id = ? AND target_id = ?')
    .run(guildId, targetId);
  return res.changes > 0;
}
