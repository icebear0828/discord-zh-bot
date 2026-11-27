import type {
  DuelChallengeRecord,
  DuelChallengeSqlRow,
  DuelChallengeStatus,
  DuelRouletteRecord,
  DuelRouletteSqlRow,
  DuelRouletteStatus,
  NicknameLockRecord,
  NicknameLockSqlRow,
  RpsDuelRecord,
  RpsDuelSqlRow,
  RpsDuelStatus,
  RpsMove,
  RpsRoundEntry,
} from './duelTypesAndSchema.js';

const VALID_DUEL_STATUSES = new Set<string>(['pending', 'completed', 'declined', 'expired']);
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

export function parseDuelStatus(value: string): DuelChallengeStatus {
  if (VALID_DUEL_STATUSES.has(value)) {
    return value as DuelChallengeStatus;
  }
  return 'pending';
}

export function mapDuelChallengeRow(row: DuelChallengeSqlRow): DuelChallengeRecord {
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

export function parseRpsMove(value: string | null): RpsMove | null {
  if (value && VALID_RPS_MOVES.has(value)) {
    return value as RpsMove;
  }
  return null;
}

export function parseRpsStatus(value: string): RpsDuelStatus {
  if (VALID_RPS_STATUSES.has(value)) {
    return value as RpsDuelStatus;
  }
  return 'pending';
}

export function parseRouletteDuelStatus(value: string): DuelRouletteStatus {
  if (VALID_ROULETTE_DUEL_STATUSES.has(value)) {
    return value as DuelRouletteStatus;
  }
  return 'pending';
}

export function parseRpsHistory(raw: string): RpsRoundEntry[] {
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

export function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function parseNumberArray(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  } catch {
    return [];
  }
}

export function mapRpsRow(row: RpsDuelSqlRow): RpsDuelRecord {
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

export function mapRouletteDuelRow(row: DuelRouletteSqlRow): DuelRouletteRecord {
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

export function mapNicknameLockRow(row: NicknameLockSqlRow): NicknameLockRecord {
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
