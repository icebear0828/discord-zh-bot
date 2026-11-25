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

CREATE TABLE IF NOT EXISTS rps_duels (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  challenger_id TEXT NOT NULL,
  opponent_id TEXT NOT NULL,
  bet INTEGER NOT NULL DEFAULT 0,
  rename_duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  round_number INTEGER NOT NULL DEFAULT 1,
  challenger_wins INTEGER NOT NULL DEFAULT 0,
  opponent_wins INTEGER NOT NULL DEFAULT 0,
  challenger_move TEXT,
  opponent_move TEXT,
  history_json TEXT NOT NULL DEFAULT '[]',
  winner_id TEXT,
  loser_id TEXT,
  bounty_claimed INTEGER NOT NULL DEFAULT 0,
  round_deadline INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rps_duels_status_exp
  ON rps_duels (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_rps_duels_status_round
  ON rps_duels (status, round_deadline);

CREATE TABLE IF NOT EXISTS duel_roulettes (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  challenger_id TEXT NOT NULL,
  opponent_id TEXT NOT NULL,
  bullets INTEGER NOT NULL DEFAULT 1,
  bet INTEGER NOT NULL DEFAULT 0,
  rename_duration_ms INTEGER NOT NULL DEFAULT 0,
  timeout_duration_ms INTEGER NOT NULL DEFAULT 0,
  custom_wager TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  turn_order_json TEXT NOT NULL DEFAULT '[]',
  turn_index INTEGER NOT NULL DEFAULT 0,
  chamber_pos INTEGER NOT NULL DEFAULT 0,
  bullet_positions_json TEXT NOT NULL DEFAULT '[]',
  logs_json TEXT NOT NULL DEFAULT '[]',
  winner_id TEXT,
  loser_id TEXT,
  bounty_claimed INTEGER NOT NULL DEFAULT 0,
  turn_deadline INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_duel_roulettes_status_exp
  ON duel_roulettes (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_duel_roulettes_status_turn
  ON duel_roulettes (status, turn_deadline);

CREATE TABLE IF NOT EXISTS nickname_locks (
  guild_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  winner_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  original_nickname TEXT,
  original_nickname_captured INTEGER NOT NULL DEFAULT 0,
  locked_nickname TEXT,
  fallback_mode INTEGER NOT NULL DEFAULT 0,
  original_card_nickname TEXT,
  original_equipped_title TEXT,
  last_renamed_at INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_nickname_locks_expires
  ON nickname_locks (expires_at);

CREATE INDEX IF NOT EXISTS idx_nickname_locks_winner
  ON nickname_locks (guild_id, winner_id, expires_at);
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

export type RpsMove = 'rock' | 'paper' | 'scissors';

export type RpsDuelStatus =
  | 'pending'
  | 'playing'
  | 'completed'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface RpsRoundEntry {
  round: number;
  challengerMove: RpsMove | null;
  opponentMove: RpsMove | null;
  winnerId: string | null;
  tie: boolean;
  timeoutBy?: string;
}

export interface RpsDuelRecord {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  challengerId: string;
  opponentId: string;
  bet: number;
  renameDurationMs: number;
  status: RpsDuelStatus;
  roundNumber: number;
  challengerWins: number;
  opponentWins: number;
  challengerMove: RpsMove | null;
  opponentMove: RpsMove | null;
  history: RpsRoundEntry[];
  winnerId: string | null;
  loserId: string | null;
  bountyClaimed: number;
  roundDeadline: number;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
}

interface RpsDuelSqlRow {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  challenger_id: string;
  opponent_id: string;
  bet: number;
  rename_duration_ms: number;
  status: string;
  round_number: number;
  challenger_wins: number;
  opponent_wins: number;
  challenger_move: string | null;
  opponent_move: string | null;
  history_json: string;
  winner_id: string | null;
  loser_id: string | null;
  bounty_claimed: number;
  round_deadline: number;
  created_at: number;
  expires_at: number;
  updated_at: number;
}

export type DuelRouletteStatus = 'pending' | 'playing' | 'completed' | 'declined' | 'expired';

export interface DuelRouletteRecord {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  challengerId: string;
  opponentId: string;
  bullets: number;
  bet: number;
  renameDurationMs: number;
  timeoutDurationMs: number;
  customWager: string;
  status: DuelRouletteStatus;
  turnOrder: string[];
  turnIndex: number;
  chamberPos: number;
  bulletPositions: number[];
  logs: string[];
  winnerId: string | null;
  loserId: string | null;
  bountyClaimed: number;
  turnDeadline: number;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
}

interface DuelRouletteSqlRow {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  challenger_id: string;
  opponent_id: string;
  bullets: number;
  bet: number;
  rename_duration_ms: number;
  timeout_duration_ms: number;
  custom_wager: string;
  status: string;
  turn_order_json: string;
  turn_index: number;
  chamber_pos: number;
  bullet_positions_json: string;
  logs_json: string;
  winner_id: string | null;
  loser_id: string | null;
  bounty_claimed: number;
  turn_deadline: number;
  created_at: number;
  expires_at: number;
  updated_at: number;
}

export type NicknameLockSourceType = 'rps' | 'roulette_1v1';

export interface NicknameLockRecord {
  guildId: string;
  targetId: string;
  winnerId: string;
  sourceType: NicknameLockSourceType;
  sourceId: string;
  originalNickname: string | null;
  originalNicknameCaptured: boolean;
  lockedNickname: string | null;
  fallbackMode: boolean;
  originalCardNickname: string | null;
  originalEquippedTitle: string | null;
  lastRenamedAt: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}

interface NicknameLockSqlRow {
  guild_id: string;
  target_id: string;
  winner_id: string;
  source_type: string;
  source_id: string;
  original_nickname: string | null;
  original_nickname_captured: number;
  locked_nickname: string | null;
  fallback_mode: number;
  original_card_nickname: string | null;
  original_equipped_title: string | null;
  last_renamed_at: number;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

const VALID_RPS_MOVES = new Set<string>(['rock', 'paper', 'scissors']);
const VALID_RPS_STATUSES = new Set<string>([
  'pending',
  'playing',
  'completed',
  'declined',
  'expired',
  'cancelled',
]);
const VALID_ROULETTE_DUEL_STATUSES = new Set<string>([
  'pending',
  'playing',
  'completed',
  'declined',
  'expired',
]);

function parseRpsMove(value: string | null): RpsMove | null {
  if (value && VALID_RPS_MOVES.has(value)) {
    return value as RpsMove;
  }
  return null;
}

function parseRpsStatus(value: string): RpsDuelStatus {
  if (VALID_RPS_STATUSES.has(value)) {
    return value as RpsDuelStatus;
  }
  return 'pending';
}

function parseRouletteDuelStatus(value: string): DuelRouletteStatus {
  if (VALID_ROULETTE_DUEL_STATUSES.has(value)) {
    return value as DuelRouletteStatus;
  }
  return 'pending';
}

function parseRpsHistory(raw: string): RpsRoundEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list: RpsRoundEntry[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.round !== 'number' || typeof obj.tie !== 'boolean') continue;
      list.push({
        round: obj.round,
        challengerMove: parseRpsMove(typeof obj.challengerMove === 'string' ? obj.challengerMove : null),
        opponentMove: parseRpsMove(typeof obj.opponentMove === 'string' ? obj.opponentMove : null),
        winnerId: typeof obj.winnerId === 'string' ? obj.winnerId : null,
        tie: obj.tie,
        ...(typeof obj.timeoutBy === 'string' ? { timeoutBy: obj.timeoutBy } : {}),
      });
    }
    return list;
  } catch {
    return [];
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function parseNumberArray(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  } catch {
    return [];
  }
}

function mapRpsRow(row: RpsDuelSqlRow): RpsDuelRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    challengerId: row.challenger_id,
    opponentId: row.opponent_id,
    bet: row.bet,
    renameDurationMs: row.rename_duration_ms,
    status: parseRpsStatus(row.status),
    roundNumber: row.round_number,
    challengerWins: row.challenger_wins,
    opponentWins: row.opponent_wins,
    challengerMove: parseRpsMove(row.challenger_move),
    opponentMove: parseRpsMove(row.opponent_move),
    history: parseRpsHistory(row.history_json),
    winnerId: row.winner_id,
    loserId: row.loser_id,
    bountyClaimed: row.bounty_claimed,
    roundDeadline: row.round_deadline,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

function mapRouletteDuelRow(row: DuelRouletteSqlRow): DuelRouletteRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    challengerId: row.challenger_id,
    opponentId: row.opponent_id,
    bullets: row.bullets,
    bet: row.bet,
    renameDurationMs: row.rename_duration_ms,
    timeoutDurationMs: row.timeout_duration_ms,
    customWager: row.custom_wager,
    status: parseRouletteDuelStatus(row.status),
    turnOrder: parseStringArray(row.turn_order_json),
    turnIndex: row.turn_index,
    chamberPos: row.chamber_pos,
    bulletPositions: parseNumberArray(row.bullet_positions_json),
    logs: parseStringArray(row.logs_json),
    winnerId: row.winner_id,
    loserId: row.loser_id,
    bountyClaimed: row.bounty_claimed,
    turnDeadline: row.turn_deadline,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

function mapNicknameLockRow(row: NicknameLockSqlRow): NicknameLockRecord {
  return {
    guildId: row.guild_id,
    targetId: row.target_id,
    winnerId: row.winner_id,
    sourceType: row.source_type === 'roulette_1v1' ? 'roulette_1v1' : 'rps',
    sourceId: row.source_id,
    originalNickname: row.original_nickname,
    originalNicknameCaptured: Boolean(row.original_nickname_captured),
    lockedNickname: row.locked_nickname,
    fallbackMode: Boolean(row.fallback_mode),
    originalCardNickname: row.original_card_nickname,
    originalEquippedTitle: row.original_equipped_title,
    lastRenamedAt: row.last_renamed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

  // ========== RPS Duels ==========

  createRps(input: {
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
  }): RpsDuelRecord {
    this.db
      .prepare(
        `INSERT INTO rps_duels (
          id, guild_id, channel_id, message_id, challenger_id, opponent_id,
          bet, rename_duration_ms, status, round_number, challenger_wins, opponent_wins,
          challenger_move, opponent_move, history_json, winner_id, loser_id,
          bounty_claimed, round_deadline, created_at, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, 0, 0, NULL, NULL, '[]', NULL, NULL, 0, 0, ?, ?, ?)`,
      )
      .run(
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

    const created = this.getRpsById(input.id);
    if (!created) {
      throw new Error(`Failed to load created rps duel ${input.id}`);
    }
    return created;
  }

  getRpsById(id: string): RpsDuelRecord | null {
    const row = this.db
      .prepare('SELECT * FROM rps_duels WHERE id = ?')
      .get(id) as RpsDuelSqlRow | undefined;
    return row ? mapRpsRow(row) : null;
  }

  bindRpsMessageId(id: string, messageId: string): boolean {
    const res = this.db
      .prepare('UPDATE rps_duels SET message_id = ? WHERE id = ?')
      .run(messageId, id);
    return res.changes > 0;
  }

  saveRps(duel: RpsDuelRecord): void {
    this.db
      .prepare(
        `UPDATE rps_duels SET
          message_id = ?, status = ?, round_number = ?,
          challenger_wins = ?, opponent_wins = ?,
          challenger_move = ?, opponent_move = ?,
          history_json = ?, winner_id = ?, loser_id = ?,
          bounty_claimed = ?, round_deadline = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
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

  listDuePendingRps(nowMs: number): RpsDuelRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM rps_duels WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC, created_at ASC",
      )
      .all(nowMs) as RpsDuelSqlRow[];
    return rows.map(mapRpsRow);
  }

  listDuePlayingRps(nowMs: number): RpsDuelRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM rps_duels WHERE status = 'playing' AND round_deadline > 0 AND round_deadline <= ? ORDER BY round_deadline ASC",
      )
      .all(nowMs) as RpsDuelSqlRow[];
    return rows.map(mapRpsRow);
  }

  // ========== 1v1 Roulette Duels ==========

  createRouletteDuel(input: {
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
  }): DuelRouletteRecord {
    this.db
      .prepare(
        `INSERT INTO duel_roulettes (
          id, guild_id, channel_id, message_id, challenger_id, opponent_id,
          bullets, bet, rename_duration_ms, timeout_duration_ms, custom_wager,
          status, turn_order_json, turn_index, chamber_pos, bullet_positions_json,
          logs_json, winner_id, loser_id, bounty_claimed, turn_deadline,
          created_at, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '[]', 0, 0, '[]', '[]', NULL, NULL, 0, 0, ?, ?, ?)`,
      )
      .run(
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

    const created = this.getRouletteDuelById(input.id);
    if (!created) {
      throw new Error(`Failed to load created roulette duel ${input.id}`);
    }
    return created;
  }

  getRouletteDuelById(id: string): DuelRouletteRecord | null {
    const row = this.db
      .prepare('SELECT * FROM duel_roulettes WHERE id = ?')
      .get(id) as DuelRouletteSqlRow | undefined;
    return row ? mapRouletteDuelRow(row) : null;
  }

  bindRouletteDuelMessageId(id: string, messageId: string): boolean {
    const res = this.db
      .prepare('UPDATE duel_roulettes SET message_id = ? WHERE id = ?')
      .run(messageId, id);
    return res.changes > 0;
  }

  saveRouletteDuel(duel: DuelRouletteRecord): void {
    this.db
      .prepare(
        `UPDATE duel_roulettes SET
          message_id = ?, status = ?, turn_order_json = ?,
          turn_index = ?, chamber_pos = ?, bullet_positions_json = ?,
          logs_json = ?, winner_id = ?, loser_id = ?,
          bounty_claimed = ?, turn_deadline = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
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

  listDuePendingRouletteDuels(nowMs: number): DuelRouletteRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM duel_roulettes WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC, created_at ASC",
      )
      .all(nowMs) as DuelRouletteSqlRow[];
    return rows.map(mapRouletteDuelRow);
  }

  listDuePlayingRouletteDuels(nowMs: number): DuelRouletteRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM duel_roulettes WHERE status = 'playing' AND turn_deadline > 0 AND turn_deadline <= ? ORDER BY turn_deadline ASC",
      )
      .all(nowMs) as DuelRouletteSqlRow[];
    return rows.map(mapRouletteDuelRow);
  }

  // ========== Nickname Locks ==========

  getNicknameLock(guildId: string, targetId: string): NicknameLockRecord | null {
    const row = this.db
      .prepare('SELECT * FROM nickname_locks WHERE guild_id = ? AND target_id = ?')
      .get(guildId, targetId) as NicknameLockSqlRow | undefined;
    return row ? mapNicknameLockRow(row) : null;
  }

  upsertNicknameLock(lock: NicknameLockRecord): void {
    this.db
      .prepare(
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
      )
      .run(
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

  listActiveNicknameLocksByWinner(
    guildId: string,
    winnerId: string,
    nowMs: number,
  ): NicknameLockRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM nickname_locks WHERE guild_id = ? AND winner_id = ? AND expires_at > ? ORDER BY expires_at ASC',
      )
      .all(guildId, winnerId, nowMs) as NicknameLockSqlRow[];
    return rows.map(mapNicknameLockRow);
  }

  listDueNicknameLocks(nowMs: number): NicknameLockRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM nickname_locks WHERE expires_at <= ? ORDER BY expires_at ASC')
      .all(nowMs) as NicknameLockSqlRow[];
    return rows.map(mapNicknameLockRow);
  }

  deleteNicknameLock(guildId: string, targetId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM nickname_locks WHERE guild_id = ? AND target_id = ?')
      .run(guildId, targetId);
    return res.changes > 0;
  }
}
