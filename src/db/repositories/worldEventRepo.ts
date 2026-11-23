import type Database from 'better-sqlite3';

export const WORLD_EVENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  creator_id TEXT NOT NULL,
  title TEXT NOT NULL,
  options_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'locked', 'settled', 'cancelled')),
  winning_option INTEGER,
  closes_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_predictions_guild_status
  ON predictions (guild_id, status, closes_at);

CREATE TABLE IF NOT EXISTS prediction_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  option_index INTEGER NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 1),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prediction_bets_pred_user
  ON prediction_bets (prediction_id, user_id);

CREATE TABLE IF NOT EXISTS world_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('chest', 'boss')),
  name TEXT NOT NULL,
  flavor TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'expired')),
  max_hp INTEGER NOT NULL DEFAULT 0,
  current_hp INTEGER NOT NULL DEFAULT 0,
  reward_pool INTEGER NOT NULL CHECK (reward_pool >= 0),
  total_shares INTEGER NOT NULL DEFAULT 0,
  remaining_shares INTEGER NOT NULL DEFAULT 0,
  remaining_amount INTEGER NOT NULL DEFAULT 0,
  killer_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_world_events_active
  ON world_events (guild_id, status, expires_at);

CREATE TABLE IF NOT EXISTS world_event_participants (
  event_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  damage_or_reward INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  last_action_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES world_events(id) ON DELETE CASCADE
);
`;

export function initWorldEventSchema(db: Database.Database): void {
  db.exec(WORLD_EVENT_SCHEMA_SQL);
}

export type PredictionStatus = 'open' | 'locked' | 'settled' | 'cancelled';
export type WorldEventType = 'chest' | 'boss';
export type WorldEventStatus = 'active' | 'completed' | 'expired';

export interface Prediction {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  creatorId: string;
  title: string;
  options: string[];
  status: PredictionStatus;
  winningOption: number | null;
  closesAt: number;
  createdAt: number;
  resolvedAt: number | null;
}

export interface PredictionBet {
  id: number;
  predictionId: number;
  userId: string;
  optionIndex: number;
  amount: number;
  createdAt: number;
}

export interface WorldEvent {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  eventType: WorldEventType;
  name: string;
  flavor: string;
  status: WorldEventStatus;
  maxHp: number;
  currentHp: number;
  rewardPool: number;
  totalShares: number;
  remainingShares: number;
  remainingAmount: number;
  killerId: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface WorldEventParticipant {
  eventId: number;
  userId: string;
  damageOrReward: number;
  hits: number;
  lastActionAt: number;
}

interface PredictionSqlRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  creator_id: string;
  title: string;
  options_json: string;
  status: PredictionStatus;
  winning_option: number | null;
  closes_at: number;
  created_at: number;
  resolved_at: number | null;
}

interface PredictionBetSqlRow {
  id: number;
  prediction_id: number;
  user_id: string;
  option_index: number;
  amount: number;
  created_at: number;
}

interface WorldEventSqlRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  event_type: WorldEventType;
  name: string;
  flavor: string;
  status: WorldEventStatus;
  max_hp: number;
  current_hp: number;
  reward_pool: number;
  total_shares: number;
  remaining_shares: number;
  remaining_amount: number;
  killer_id: string | null;
  created_at: number;
  expires_at: number;
}

interface WorldEventParticipantSqlRow {
  event_id: number;
  user_id: string;
  damage_or_reward: number;
  hits: number;
  last_action_at: number;
}

function parseStringArray(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === 'string');
}

function mapPrediction(row: PredictionSqlRow): Prediction {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    creatorId: row.creator_id,
    title: row.title,
    options: parseStringArray(row.options_json),
    status: row.status,
    winningOption: row.winning_option,
    closesAt: row.closes_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function mapPredictionBet(row: PredictionBetSqlRow): PredictionBet {
  return {
    id: row.id,
    predictionId: row.prediction_id,
    userId: row.user_id,
    optionIndex: row.option_index,
    amount: row.amount,
    createdAt: row.created_at,
  };
}

function mapWorldEvent(row: WorldEventSqlRow): WorldEvent {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    eventType: row.event_type,
    name: row.name,
    flavor: row.flavor,
    status: row.status,
    maxHp: row.max_hp,
    currentHp: row.current_hp,
    rewardPool: row.reward_pool,
    totalShares: row.total_shares,
    remainingShares: row.remaining_shares,
    remainingAmount: row.remaining_amount,
    killerId: row.killer_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function mapParticipant(row: WorldEventParticipantSqlRow): WorldEventParticipant {
  return {
    eventId: row.event_id,
    userId: row.user_id,
    damageOrReward: row.damage_or_reward,
    hits: row.hits,
    lastActionAt: row.last_action_at,
  };
}

export class WorldEventRepo {
  constructor(private readonly db: Database.Database) {}

  // Predictions
  createPrediction(input: {
    guildId: string;
    channelId: string;
    creatorId: string;
    title: string;
    options: string[];
    closesAt: number;
    createdAt: number;
  }): Prediction {
    const res = this.db
      .prepare(
        `INSERT INTO predictions (
          guild_id, channel_id, message_id, creator_id, title,
          options_json, status, winning_option, closes_at, created_at, resolved_at
        ) VALUES (?, ?, NULL, ?, ?, ?, 'open', NULL, ?, ?, NULL)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.creatorId,
        input.title,
        JSON.stringify(input.options),
        input.closesAt,
        input.createdAt,
      );
    const created = this.getPredictionById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created prediction');
    return created;
  }

  bindPredictionMessageId(predictionId: number, messageId: string): void {
    this.db
      .prepare('UPDATE predictions SET message_id = ? WHERE id = ?')
      .run(messageId, predictionId);
  }

  getPredictionById(predictionId: number): Prediction | null {
    const row = this.db
      .prepare('SELECT * FROM predictions WHERE id = ?')
      .get(predictionId) as PredictionSqlRow | undefined;
    return row ? mapPrediction(row) : null;
  }

  listPredictionsByGuild(
    guildId: string,
    statuses: readonly PredictionStatus[] = ['open', 'locked'],
    limit = 15,
  ): Prediction[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT * FROM predictions WHERE guild_id = ? AND status IN (${placeholders}) ORDER BY id DESC LIMIT ?`,
      )
      .all(guildId, ...statuses, limit) as PredictionSqlRow[];
    return rows.map(mapPrediction);
  }

  listDueOpenPredictions(nowMs: number): Prediction[] {
    const rows = this.db
      .prepare("SELECT * FROM predictions WHERE status = 'open' AND closes_at <= ? ORDER BY closes_at ASC")
      .all(nowMs) as PredictionSqlRow[];
    return rows.map(mapPrediction);
  }

  updatePredictionStatus(
    predictionId: number,
    status: PredictionStatus,
    winningOption: number | null,
    resolvedAt: number | null,
  ): void {
    this.db
      .prepare(
        'UPDATE predictions SET status = ?, winning_option = ?, resolved_at = ? WHERE id = ?',
      )
      .run(status, winningOption, resolvedAt, predictionId);
  }

  addBet(input: {
    predictionId: number;
    userId: string;
    optionIndex: number;
    amount: number;
    createdAt: number;
  }): PredictionBet {
    const res = this.db
      .prepare(
        'INSERT INTO prediction_bets (prediction_id, user_id, option_index, amount, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        input.predictionId,
        input.userId,
        input.optionIndex,
        input.amount,
        input.createdAt,
      );
    const created = this.db
      .prepare('SELECT * FROM prediction_bets WHERE id = ?')
      .get(Number(res.lastInsertRowid)) as PredictionBetSqlRow | undefined;
    if (!created) throw new Error('Failed to load created bet');
    return mapPredictionBet(created);
  }

  listBets(predictionId: number): PredictionBet[] {
    const rows = this.db
      .prepare('SELECT * FROM prediction_bets WHERE prediction_id = ? ORDER BY id ASC')
      .all(predictionId) as PredictionBetSqlRow[];
    return rows.map(mapPredictionBet);
  }

  // World Events
  createWorldEvent(input: {
    guildId: string;
    channelId: string;
    eventType: WorldEventType;
    name: string;
    flavor: string;
    maxHp: number;
    currentHp: number;
    rewardPool: number;
    totalShares: number;
    remainingShares: number;
    remainingAmount: number;
    createdAt: number;
    expiresAt: number;
  }): WorldEvent {
    const res = this.db
      .prepare(
        `INSERT INTO world_events (
          guild_id, channel_id, message_id, event_type, name, flavor, status,
          max_hp, current_hp, reward_pool, total_shares, remaining_shares,
          remaining_amount, killer_id, created_at, expires_at
        ) VALUES (?, ?, NULL, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.eventType,
        input.name,
        input.flavor,
        input.maxHp,
        input.currentHp,
        input.rewardPool,
        input.totalShares,
        input.remainingShares,
        input.remainingAmount,
        input.createdAt,
        input.expiresAt,
      );
    const created = this.getWorldEventById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created world event');
    return created;
  }

  bindWorldEventMessageId(eventId: number, messageId: string): void {
    this.db
      .prepare('UPDATE world_events SET message_id = ? WHERE id = ?')
      .run(messageId, eventId);
  }

  getWorldEventById(eventId: number): WorldEvent | null {
    const row = this.db
      .prepare('SELECT * FROM world_events WHERE id = ?')
      .get(eventId) as WorldEventSqlRow | undefined;
    return row ? mapWorldEvent(row) : null;
  }

  getActiveWorldEvent(guildId: string): WorldEvent | null {
    const row = this.db
      .prepare("SELECT * FROM world_events WHERE guild_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
      .get(guildId) as WorldEventSqlRow | undefined;
    return row ? mapWorldEvent(row) : null;
  }

  listActiveWorldEvents(guildId: string): WorldEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM world_events WHERE guild_id = ? AND status = 'active' ORDER BY id DESC")
      .all(guildId) as WorldEventSqlRow[];
    return rows.map(mapWorldEvent);
  }

  listRecentWorldEvents(guildId: string, limit = 5): WorldEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM world_events WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
      .all(guildId, limit) as WorldEventSqlRow[];
    return rows.map(mapWorldEvent);
  }

  listDueWorldEvents(nowMs: number): WorldEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM world_events WHERE status = 'active' AND expires_at <= ? ORDER BY expires_at ASC")
      .all(nowMs) as WorldEventSqlRow[];
    return rows.map(mapWorldEvent);
  }

  saveWorldEvent(event: WorldEvent): void {
    this.db
      .prepare(
        `UPDATE world_events SET
          status = ?, current_hp = ?, remaining_shares = ?, remaining_amount = ?, killer_id = ?
         WHERE id = ?`,
      )
      .run(
        event.status,
        event.currentHp,
        event.remainingShares,
        event.remainingAmount,
        event.killerId,
        event.id,
      );
  }

  getParticipant(eventId: number, userId: string): WorldEventParticipant | null {
    const row = this.db
      .prepare('SELECT * FROM world_event_participants WHERE event_id = ? AND user_id = ?')
      .get(eventId, userId) as WorldEventParticipantSqlRow | undefined;
    return row ? mapParticipant(row) : null;
  }

  listParticipants(eventId: number): WorldEventParticipant[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM world_event_participants WHERE event_id = ? ORDER BY damage_or_reward DESC, last_action_at ASC',
      )
      .all(eventId) as WorldEventParticipantSqlRow[];
    return rows.map(mapParticipant);
  }

  upsertParticipant(input: {
    eventId: number;
    userId: string;
    delta: number;
    hitsDelta: number;
    actionAt: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO world_event_participants (event_id, user_id, damage_or_reward, hits, last_action_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(event_id, user_id) DO UPDATE SET
           damage_or_reward = damage_or_reward + excluded.damage_or_reward,
           hits = hits + excluded.hits,
           last_action_at = excluded.last_action_at`,
      )
      .run(input.eventId, input.userId, input.delta, input.hitsDelta, input.actionAt);
  }
}
