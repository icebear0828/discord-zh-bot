import type Database from 'better-sqlite3';

export const CHAOS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_props (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  prop_key TEXT NOT NULL CHECK (prop_key IN ('trap', 'lockpick', 'shield', 'curse', 'nickname')),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (guild_id, user_id, prop_key)
);

CREATE TABLE IF NOT EXISTS user_effects (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  effect_key TEXT NOT NULL CHECK (effect_key IN ('trap_armed', 'lockpick_ready', 'work_cursed')),
  charges INTEGER NOT NULL DEFAULT 1 CHECK (charges >= 0),
  expires_at INTEGER NOT NULL DEFAULT 0,
  source_user_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, effect_key)
);

CREATE TABLE IF NOT EXISTS bounties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  placer_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 1),
  status TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'cleared')),
  claimed_by TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bounties_guild_target_status
  ON bounties (guild_id, target_id, status);

CREATE TABLE IF NOT EXISTS roulette_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  host_id TEXT NOT NULL,
  entry_fee INTEGER NOT NULL CHECK (entry_fee >= 1),
  max_players INTEGER NOT NULL CHECK (max_players BETWEEN 2 AND 6),
  status TEXT NOT NULL CHECK (status IN ('recruiting', 'playing', 'finished', 'cancelled')),
  players_json TEXT NOT NULL,
  alive_json TEXT NOT NULL,
  turn_index INTEGER NOT NULL DEFAULT 0,
  chamber_pos INTEGER NOT NULL DEFAULT 0,
  bullet_pos INTEGER NOT NULL DEFAULT 0,
  turn_deadline INTEGER NOT NULL DEFAULT 0,
  winner_id TEXT,
  log_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_roulette_due
  ON roulette_games (status, turn_deadline);

CREATE TABLE IF NOT EXISTS number_bomb_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  host_id TEXT NOT NULL,
  penalty INTEGER NOT NULL CHECK (penalty >= 1),
  min_bound INTEGER NOT NULL,
  max_bound INTEGER NOT NULL,
  secret_number INTEGER NOT NULL,
  last_guesser_id TEXT,
  participants_json TEXT NOT NULL DEFAULT '[]',
  guesses_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('open', 'exploded', 'cancelled')),
  loser_id TEXT,
  payouts_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_number_bomb_due
  ON number_bomb_games (status, expires_at);
`;

export function initChaosSchema(db: Database.Database): void {
  db.exec(CHAOS_SCHEMA_SQL);
}

export type PropKey = 'trap' | 'lockpick' | 'shield' | 'curse' | 'nickname';
export type EffectKey = 'trap_armed' | 'lockpick_ready' | 'work_cursed';
export type BountyStatus = 'open' | 'claimed' | 'cleared';
export type RouletteStatus = 'recruiting' | 'playing' | 'finished' | 'cancelled';
export type NumberBombStatus = 'open' | 'exploded' | 'cancelled';

export interface UserPropRowData {
  guildId: string;
  userId: string;
  propKey: PropKey;
  quantity: number;
}

export interface UserEffect {
  guildId: string;
  userId: string;
  effectKey: EffectKey;
  charges: number;
  expiresAt: number;
  sourceUserId: string | null;
  updatedAt: number;
}

export interface Bounty {
  id: number;
  guildId: string;
  targetId: string;
  placerId: string;
  amount: number;
  status: BountyStatus;
  claimedBy: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface BountySummary {
  targetId: string;
  totalAmount: number;
  bountyCount: number;
  latestAt: number;
}

export interface RouletteGame {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  hostId: string;
  entryFee: number;
  maxPlayers: number;
  status: RouletteStatus;
  players: string[];
  alivePlayers: string[];
  turnIndex: number;
  chamberPos: number;
  bulletPos: number;
  turnDeadline: number;
  winnerId: string | null;
  logs: string[];
  createdAt: number;
  updatedAt: number;
}

export interface NumberBombGuess {
  userId: string;
  guess: number;
  exploded: boolean;
  at: number;
}

export interface NumberBombGame {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  hostId: string;
  penalty: number;
  minBound: number;
  maxBound: number;
  secretNumber: number;
  lastGuesserId: string | null;
  participants: string[];
  guesses: NumberBombGuess[];
  status: NumberBombStatus;
  loserId: string | null;
  payoutsJson: string;
  createdAt: number;
  expiresAt: number;
}

interface UserPropSqlRow {
  guild_id: string;
  user_id: string;
  prop_key: PropKey;
  quantity: number;
}

interface UserEffectSqlRow {
  guild_id: string;
  user_id: string;
  effect_key: EffectKey;
  charges: number;
  expires_at: number;
  source_user_id: string | null;
  updated_at: number;
}

interface BountySqlRow {
  id: number;
  guild_id: string;
  target_id: string;
  placer_id: string;
  amount: number;
  status: BountyStatus;
  claimed_by: string | null;
  created_at: number;
  resolved_at: number | null;
}

interface RouletteSqlRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  host_id: string;
  entry_fee: number;
  max_players: number;
  status: RouletteStatus;
  players_json: string;
  alive_json: string;
  turn_index: number;
  chamber_pos: number;
  bullet_pos: number;
  turn_deadline: number;
  winner_id: string | null;
  log_json: string;
  created_at: number;
  updated_at: number;
}

interface NumberBombSqlRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  host_id: string;
  penalty: number;
  min_bound: number;
  max_bound: number;
  secret_number: number;
  last_guesser_id: string | null;
  participants_json: string;
  guesses_json: string;
  status: NumberBombStatus;
  loser_id: string | null;
  payouts_json?: string;
  created_at: number;
  expires_at: number;
}

function parseStringArray(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === 'string');
}

function parseGuessArray(raw: string): NumberBombGuess[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  const list: NumberBombGuess[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    if (
      typeof obj.userId === 'string' &&
      typeof obj.guess === 'number' &&
      typeof obj.exploded === 'boolean' &&
      typeof obj.at === 'number'
    ) {
      list.push({
        userId: obj.userId,
        guess: obj.guess,
        exploded: obj.exploded,
        at: obj.at,
      });
    }
  }
  return list;
}

function mapUserProp(row: UserPropSqlRow): UserPropRowData {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    propKey: row.prop_key,
    quantity: row.quantity,
  };
}

function mapUserEffect(row: UserEffectSqlRow): UserEffect {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    effectKey: row.effect_key,
    charges: row.charges,
    expiresAt: row.expires_at,
    sourceUserId: row.source_user_id,
    updatedAt: row.updated_at,
  };
}

function mapBounty(row: BountySqlRow): Bounty {
  return {
    id: row.id,
    guildId: row.guild_id,
    targetId: row.target_id,
    placerId: row.placer_id,
    amount: row.amount,
    status: row.status,
    claimedBy: row.claimed_by,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function mapRoulette(row: RouletteSqlRow): RouletteGame {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    hostId: row.host_id,
    entryFee: row.entry_fee,
    maxPlayers: row.max_players,
    status: row.status,
    players: parseStringArray(row.players_json),
    alivePlayers: parseStringArray(row.alive_json),
    turnIndex: row.turn_index,
    chamberPos: row.chamber_pos,
    bulletPos: row.bullet_pos,
    turnDeadline: row.turn_deadline,
    winnerId: row.winner_id,
    logs: parseStringArray(row.log_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNumberBomb(row: NumberBombSqlRow): NumberBombGame {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    hostId: row.host_id,
    penalty: row.penalty,
    minBound: row.min_bound,
    maxBound: row.max_bound,
    secretNumber: row.secret_number,
    lastGuesserId: row.last_guesser_id,
    participants: parseStringArray(row.participants_json),
    guesses: parseGuessArray(row.guesses_json),
    status: row.status,
    loserId: row.loser_id,
    payoutsJson: row.payouts_json ?? '[]',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class ChaosRepo {
  constructor(private readonly db: Database.Database) {}

  // Props
  getPropQuantity(guildId: string, userId: string, propKey: PropKey): number {
    const row = this.db
      .prepare('SELECT quantity FROM user_props WHERE guild_id = ? AND user_id = ? AND prop_key = ?')
      .get(guildId, userId, propKey) as { quantity: number } | undefined;
    return row ? row.quantity : 0;
  }

  listUserProps(guildId: string, userId: string): UserPropRowData[] {
    const rows = this.db
      .prepare('SELECT * FROM user_props WHERE guild_id = ? AND user_id = ? AND quantity > 0')
      .all(guildId, userId) as UserPropSqlRow[];
    return rows.map(mapUserProp);
  }

  addProp(guildId: string, userId: string, propKey: PropKey, delta: number): number {
    const cleanDelta = Math.max(0, Math.floor(delta));
    if (cleanDelta === 0) {
      return this.getPropQuantity(guildId, userId, propKey);
    }
    this.db
      .prepare(
        `INSERT INTO user_props (guild_id, user_id, prop_key, quantity)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id, prop_key) DO UPDATE SET quantity = quantity + excluded.quantity`,
      )
      .run(guildId, userId, propKey, cleanDelta);
    return this.getPropQuantity(guildId, userId, propKey);
  }

  consumeProp(guildId: string, userId: string, propKey: PropKey): boolean {
    const res = this.db
      .prepare(
        'UPDATE user_props SET quantity = quantity - 1 WHERE guild_id = ? AND user_id = ? AND prop_key = ? AND quantity >= 1',
      )
      .run(guildId, userId, propKey);
    return res.changes > 0;
  }

  // Effects
  getActiveEffect(
    guildId: string,
    userId: string,
    effectKey: EffectKey,
    nowMs = Date.now(),
  ): UserEffect | null {
    const row = this.db
      .prepare('SELECT * FROM user_effects WHERE guild_id = ? AND user_id = ? AND effect_key = ?')
      .get(guildId, userId, effectKey) as UserEffectSqlRow | undefined;
    if (!row || row.charges <= 0) return null;
    if (row.expires_at > 0 && row.expires_at <= nowMs) return null;
    return mapUserEffect(row);
  }

  listActiveEffects(guildId: string, userId: string, nowMs = Date.now()): UserEffect[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM user_effects WHERE guild_id = ? AND user_id = ? AND charges > 0 AND (expires_at = 0 OR expires_at > ?)',
      )
      .all(guildId, userId, nowMs) as UserEffectSqlRow[];
    return rows.map(mapUserEffect);
  }

  setEffect(input: {
    guildId: string;
    userId: string;
    effectKey: EffectKey;
    charges: number;
    expiresAt: number;
    sourceUserId: string | null;
    updatedAt: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO user_effects (
          guild_id, user_id, effect_key, charges, expires_at, source_user_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id, effect_key) DO UPDATE SET
          charges = excluded.charges,
          expires_at = excluded.expires_at,
          source_user_id = excluded.source_user_id,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.guildId,
        input.userId,
        input.effectKey,
        input.charges,
        input.expiresAt,
        input.sourceUserId,
        input.updatedAt,
      );
  }

  consumeEffect(
    guildId: string,
    userId: string,
    effectKey: EffectKey,
    nowMs = Date.now(),
  ): UserEffect | null {
    const existing = this.getActiveEffect(guildId, userId, effectKey, nowMs);
    if (!existing) return null;
    if (existing.charges <= 1) {
      this.db
        .prepare('DELETE FROM user_effects WHERE guild_id = ? AND user_id = ? AND effect_key = ?')
        .run(guildId, userId, effectKey);
    } else {
      this.db
        .prepare(
          'UPDATE user_effects SET charges = charges - 1, updated_at = ? WHERE guild_id = ? AND user_id = ? AND effect_key = ?',
        )
        .run(nowMs, guildId, userId, effectKey);
    }
    return existing;
  }

  // Bounties
  createBounty(input: {
    guildId: string;
    targetId: string;
    placerId: string;
    amount: number;
    createdAt: number;
  }): Bounty {
    const res = this.db
      .prepare(
        `INSERT INTO bounties (guild_id, target_id, placer_id, amount, status, claimed_by, created_at, resolved_at)
         VALUES (?, ?, ?, ?, 'open', NULL, ?, NULL)`,
      )
      .run(input.guildId, input.targetId, input.placerId, input.amount, input.createdAt);
    const created = this.db
      .prepare('SELECT * FROM bounties WHERE id = ?')
      .get(Number(res.lastInsertRowid)) as BountySqlRow | undefined;
    if (!created) throw new Error('Failed to load created bounty');
    return mapBounty(created);
  }

  getOpenBountyTotal(guildId: string, targetId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM bounties WHERE guild_id = ? AND target_id = ? AND status = 'open'",
      )
      .get(guildId, targetId) as { total: number };
    return row.total;
  }

  claimOpenBounties(
    guildId: string,
    targetId: string,
    claimerId: string,
    nowMs = Date.now(),
  ): number {
    const total = this.getOpenBountyTotal(guildId, targetId);
    if (total <= 0) return 0;
    this.db
      .prepare(
        "UPDATE bounties SET status = 'claimed', claimed_by = ?, resolved_at = ? WHERE guild_id = ? AND target_id = ? AND status = 'open'",
      )
      .run(claimerId, nowMs, guildId, targetId);
    return total;
  }

  clearOpenBounties(guildId: string, targetId: string, nowMs = Date.now()): number {
    const total = this.getOpenBountyTotal(guildId, targetId);
    if (total <= 0) return 0;
    this.db
      .prepare(
        "UPDATE bounties SET status = 'cleared', resolved_at = ? WHERE guild_id = ? AND target_id = ? AND status = 'open'",
      )
      .run(nowMs, guildId, targetId);
    return total;
  }

  listActiveBounties(guildId: string, limit = 10): BountySummary[] {
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = this.db
      .prepare(
        `SELECT target_id, SUM(amount) AS total_amount, COUNT(*) AS bounty_count, MAX(created_at) AS latest_at
         FROM bounties
         WHERE guild_id = ? AND status = 'open'
         GROUP BY target_id
         ORDER BY total_amount DESC, latest_at DESC
         LIMIT ?`,
      )
      .all(guildId, safeLimit) as Array<{
      target_id: string;
      total_amount: number;
      bounty_count: number;
      latest_at: number;
    }>;
    return rows.map((r) => ({
      targetId: r.target_id,
      totalAmount: r.total_amount,
      bountyCount: r.bounty_count,
      latestAt: r.latest_at,
    }));
  }

  // Roulette
  createRoulette(input: {
    guildId: string;
    channelId: string;
    hostId: string;
    entryFee: number;
    maxPlayers: number;
    createdAt: number;
    turnDeadline: number;
  }): RouletteGame {
    const playersJson = JSON.stringify([input.hostId]);
    const res = this.db
      .prepare(
        `INSERT INTO roulette_games (
          guild_id, channel_id, message_id, host_id, entry_fee, max_players,
          status, players_json, alive_json, turn_index, chamber_pos, bullet_pos,
          turn_deadline, winner_id, log_json, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, 'recruiting', ?, ?, 0, 0, 0, ?, NULL, '[]', ?, ?)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.hostId,
        input.entryFee,
        input.maxPlayers,
        playersJson,
        playersJson,
        input.turnDeadline,
        input.createdAt,
        input.createdAt,
      );
    const created = this.getRouletteById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created roulette game');
    return created;
  }

  bindRouletteMessageId(gameId: number, messageId: string): void {
    this.db
      .prepare('UPDATE roulette_games SET message_id = ? WHERE id = ?')
      .run(messageId, gameId);
  }

  getRouletteById(gameId: number): RouletteGame | null {
    const row = this.db
      .prepare('SELECT * FROM roulette_games WHERE id = ?')
      .get(gameId) as RouletteSqlRow | undefined;
    return row ? mapRoulette(row) : null;
  }

  saveRoulette(game: RouletteGame): void {
    this.db
      .prepare(
        `UPDATE roulette_games SET
          status = ?, players_json = ?, alive_json = ?, turn_index = ?,
          chamber_pos = ?, bullet_pos = ?, turn_deadline = ?, winner_id = ?,
          log_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        game.status,
        JSON.stringify(game.players),
        JSON.stringify(game.alivePlayers),
        game.turnIndex,
        game.chamberPos,
        game.bulletPos,
        game.turnDeadline,
        game.winnerId,
        JSON.stringify(game.logs),
        game.updatedAt,
        game.id,
      );
  }

  listActiveRoulettes(guildId: string, limit = 10): RouletteGame[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM roulette_games WHERE guild_id = ? AND status IN ('recruiting', 'playing') ORDER BY id DESC LIMIT ?",
      )
      .all(guildId, limit) as RouletteSqlRow[];
    return rows.map(mapRoulette);
  }

  listDueRoulettes(nowMs: number): RouletteGame[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM roulette_games WHERE status IN ('recruiting', 'playing') AND turn_deadline > 0 AND turn_deadline <= ? ORDER BY turn_deadline ASC",
      )
      .all(nowMs) as RouletteSqlRow[];
    return rows.map(mapRoulette);
  }

  expireRouletteById(id: number, nowMs = Date.now()): boolean {
    const res = this.db
      .prepare(
        "UPDATE roulette_games SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('recruiting', 'playing')",
      )
      .run(nowMs, id);
    return res.changes > 0;
  }

  // Number Bomb
  createNumberBomb(input: {
    guildId: string;
    channelId: string;
    hostId: string;
    penalty: number;
    minBound: number;
    maxBound: number;
    secretNumber: number;
    createdAt: number;
    expiresAt: number;
  }): NumberBombGame {
    const res = this.db
      .prepare(
        `INSERT INTO number_bomb_games (
          guild_id, channel_id, message_id, host_id, penalty,
          min_bound, max_bound, secret_number, last_guesser_id,
          participants_json, guesses_json, status, loser_id, created_at, expires_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, '[]', '[]', 'open', NULL, ?, ?)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.hostId,
        input.penalty,
        input.minBound,
        input.maxBound,
        input.secretNumber,
        input.createdAt,
        input.expiresAt,
      );
    const created = this.getNumberBombById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created number bomb game');
    return created;
  }

  bindNumberBombMessageId(gameId: number, messageId: string): void {
    this.db
      .prepare('UPDATE number_bomb_games SET message_id = ? WHERE id = ?')
      .run(messageId, gameId);
  }

  getNumberBombById(gameId: number): NumberBombGame | null {
    const row = this.db
      .prepare('SELECT * FROM number_bomb_games WHERE id = ?')
      .get(gameId) as NumberBombSqlRow | undefined;
    return row ? mapNumberBomb(row) : null;
  }

  saveNumberBomb(game: NumberBombGame): void {
    this.db
      .prepare(
        `UPDATE number_bomb_games SET
          min_bound = ?, max_bound = ?, last_guesser_id = ?,
          participants_json = ?, guesses_json = ?, status = ?, loser_id = ?, payouts_json = ?
         WHERE id = ?`,
      )
      .run(
        game.minBound,
        game.maxBound,
        game.lastGuesserId,
        JSON.stringify(game.participants),
        JSON.stringify(game.guesses),
        game.status,
        game.loserId,
        game.payoutsJson,
        game.id,
      );
  }

  listOpenNumberBombs(guildId: string, limit = 10): NumberBombGame[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM number_bomb_games WHERE guild_id = ? AND status = 'open' ORDER BY id DESC LIMIT ?",
      )
      .all(guildId, limit) as NumberBombSqlRow[];
    return rows.map(mapNumberBomb);
  }

  listDueNumberBombs(nowMs: number): NumberBombGame[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM number_bomb_games WHERE status = 'open' AND expires_at <= ? ORDER BY expires_at ASC",
      )
      .all(nowMs) as NumberBombSqlRow[];
    return rows.map(mapNumberBomb);
  }

  cancelNumberBombById(id: number): boolean {
    const res = this.db
      .prepare("UPDATE number_bomb_games SET status = 'cancelled' WHERE id = ? AND status = 'open'")
      .run(id);
    return res.changes > 0;
  }

  expireNumberBombById(id: number): boolean {
    const res = this.db
      .prepare("UPDATE number_bomb_games SET status = 'cancelled' WHERE id = ? AND status = 'open'")
      .run(id);
    return res.changes > 0;
  }
}
