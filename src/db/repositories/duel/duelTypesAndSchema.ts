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

export interface DuelChallengeSqlRow {
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

export interface RpsDuelSqlRow {
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

export interface DuelRouletteSqlRow {
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

export interface NicknameLockSqlRow {
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
