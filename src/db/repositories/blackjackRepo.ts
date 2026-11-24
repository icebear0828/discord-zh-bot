import type Database from 'better-sqlite3';
import type { BlackjackStatus, Card, Rank, Suit } from '../../services/blackjackService.js';

export const BLACKJACK_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS blackjack_games (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  bet INTEGER NOT NULL,
  deck_json TEXT NOT NULL,
  player_hand_json TEXT NOT NULL,
  dealer_hand_json TEXT NOT NULL,
  status TEXT NOT NULL,
  payout INTEGER NOT NULL DEFAULT 0,
  can_double INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_blackjack_games_expires
  ON blackjack_games (expires_at);
`;

export function initBlackjackSchema(db: Database.Database): void {
  db.exec(BLACKJACK_SCHEMA_SQL);
}

export interface BlackjackGameRecord {
  guildId: string;
  userId: string;
  bet: number;
  deck: Card[];
  playerHand: Card[];
  dealerHand: Card[];
  status: BlackjackStatus;
  payout: number;
  canDouble: boolean;
  createdAt: number;
  expiresAt: number;
}

interface BlackjackGameSqlRow {
  guild_id: string;
  user_id: string;
  bet: number;
  deck_json: string;
  player_hand_json: string;
  dealer_hand_json: string;
  status: string;
  payout: number;
  can_double: number;
  created_at: number;
  expires_at: number;
}

const VALID_SUITS = new Set<string>(['♠', '♥', '♦', '♣']);
const VALID_RANKS = new Set<string>([
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
]);
const VALID_STATUSES = new Set<string>([
  'playing',
  'player_blackjack',
  'player_bust',
  'dealer_bust',
  'player_win',
  'dealer_win',
  'push',
]);

function isSuit(value: unknown): value is Suit {
  return typeof value === 'string' && VALID_SUITS.has(value);
}

function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && VALID_RANKS.has(value);
}

function parseStatus(value: string): BlackjackStatus {
  if (VALID_STATUSES.has(value)) {
    return value as BlackjackStatus;
  }
  return 'playing';
}

function parseCardArray(raw: string): Card[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cards: Card[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      if (isRank(obj.rank) && isSuit(obj.suit)) {
        cards.push({ rank: obj.rank, suit: obj.suit });
      }
    }
    return cards;
  } catch {
    return [];
  }
}

function mapRow(row: BlackjackGameSqlRow): BlackjackGameRecord {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    bet: row.bet,
    deck: parseCardArray(row.deck_json),
    playerHand: parseCardArray(row.player_hand_json),
    dealerHand: parseCardArray(row.dealer_hand_json),
    status: parseStatus(row.status),
    payout: row.payout,
    canDouble: Boolean(row.can_double),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class BlackjackRepo {
  constructor(private readonly db: Database.Database) {}

  get(guildId: string, userId: string): BlackjackGameRecord | null {
    const row = this.db
      .prepare('SELECT * FROM blackjack_games WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as BlackjackGameSqlRow | undefined;
    return row ? mapRow(row) : null;
  }

  upsert(game: BlackjackGameRecord): void {
    this.db
      .prepare(
        `INSERT INTO blackjack_games (
          guild_id, user_id, bet, deck_json, player_hand_json, dealer_hand_json,
          status, payout, can_double, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          bet = excluded.bet,
          deck_json = excluded.deck_json,
          player_hand_json = excluded.player_hand_json,
          dealer_hand_json = excluded.dealer_hand_json,
          status = excluded.status,
          payout = excluded.payout,
          can_double = excluded.can_double,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at`,
      )
      .run(
        game.guildId,
        game.userId,
        game.bet,
        JSON.stringify(game.deck),
        JSON.stringify(game.playerHand),
        JSON.stringify(game.dealerHand),
        game.status,
        game.payout,
        game.canDouble ? 1 : 0,
        game.createdAt,
        game.expiresAt,
      );
  }

  delete(guildId: string, userId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM blackjack_games WHERE guild_id = ? AND user_id = ?')
      .run(guildId, userId);
    return res.changes > 0;
  }

  listExpired(nowMs: number): BlackjackGameRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM blackjack_games WHERE expires_at <= ? ORDER BY expires_at ASC, created_at ASC',
      )
      .all(nowMs) as BlackjackGameSqlRow[];
    return rows.map(mapRow);
  }

  listAllActive(): BlackjackGameRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM blackjack_games WHERE status = 'playing' ORDER BY created_at ASC, guild_id ASC, user_id ASC",
      )
      .all() as BlackjackGameSqlRow[];
    return rows.map(mapRow);
  }
}
