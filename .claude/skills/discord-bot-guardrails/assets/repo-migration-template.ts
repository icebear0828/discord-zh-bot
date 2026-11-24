import type Database from 'better-sqlite3';

export type ExampleRecordStatus = 'active' | 'settled' | 'expired' | 'cancelled';

export const EXAMPLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS example_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'settled', 'expired', 'cancelled')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_example_records_due
  ON example_records (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_example_records_guild_owner
  ON example_records (guild_id, owner_id, status);
`;

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

export function initExampleSchema(db: Database.Database): void {
  db.exec(EXAMPLE_SCHEMA_SQL);
  ensureColumn(db, 'example_records', 'metadata_json', "TEXT NOT NULL DEFAULT '{}'");
}

export interface ExampleMetadata {
  note?: string;
}

export interface ExampleRecord {
  id: number;
  guildId: string;
  ownerId: string;
  channelId: string;
  messageId: string | null;
  amount: number;
  status: ExampleRecordStatus;
  metadata: ExampleMetadata;
  createdAt: number;
  expiresAt: number;
}

interface ExampleSqlRow {
  id: number;
  guild_id: string;
  owner_id: string;
  channel_id: string;
  message_id: string | null;
  amount: number;
  status: string;
  metadata_json: string;
  created_at: number;
  expires_at: number;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'settled',
  'expired',
  'cancelled',
]);

function parseStatus(raw: string): ExampleRecordStatus {
  if (VALID_STATUSES.has(raw)) {
    return raw as ExampleRecordStatus;
  }
  return 'expired';
}

function parseMetadata(raw: string): ExampleMetadata {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    return typeof obj.note === 'string' ? { note: obj.note } : {};
  } catch {
    return {};
  }
}

function mapRow(row: ExampleSqlRow): ExampleRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    ownerId: row.owner_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    amount: row.amount,
    status: parseStatus(row.status),
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class ExampleRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    guildId: string;
    ownerId: string;
    channelId: string;
    amount: number;
    metadata?: ExampleMetadata;
    createdAt: number;
    expiresAt: number;
  }): ExampleRecord {
    const stmt = this.db.prepare(`
      INSERT INTO example_records (
        guild_id, owner_id, channel_id, amount, status, metadata_json, created_at, expires_at
      )
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `);
    const info = stmt.run(
      input.guildId,
      input.ownerId,
      input.channelId,
      input.amount,
      JSON.stringify(input.metadata ?? {}),
      input.createdAt,
      input.expiresAt,
    );
    const created = this.getById(Number(info.lastInsertRowid));
    if (!created) {
      throw new Error('Failed to load newly created example_records row');
    }
    return created;
  }

  getById(id: number): ExampleRecord | null {
    const row = this.db
      .prepare('SELECT * FROM example_records WHERE id = ?')
      .get(id) as ExampleSqlRow | undefined;
    return row ? mapRow(row) : null;
  }

  /**
   * Single-ID atomic expiry for interaction handlers.
   * Never run global batch expireDue* inside src/interactions/.
   */
  expireByIdIfDue(id: number, nowMs = Date.now()): ExampleRecord | null {
    return this.db.transaction((): ExampleRecord | null => {
      const info = this.db
        .prepare(
          `UPDATE example_records
           SET status = 'expired'
           WHERE id = ? AND status = 'active' AND expires_at <= ?`,
        )
        .run(id, nowMs);
      if (info.changes !== 1) {
        return null;
      }
      return this.getById(id);
    })();
  }

  /**
   * Atomic transition guarded by expected current status.
   */
  markSettledById(id: number): boolean {
    const info = this.db
      .prepare(
        `UPDATE example_records
         SET status = 'settled'
         WHERE id = ? AND status = 'active'`,
      )
      .run(id);
    return info.changes === 1;
  }

  /**
   * Batch query reserved for background timers in src/events/ready.ts.
   */
  listDueActive(nowMs = Date.now(), limit = 50): ExampleRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM example_records
         WHERE status = 'active' AND expires_at <= ?
         ORDER BY expires_at ASC
         LIMIT ?`,
      )
      .all(nowMs, limit) as ExampleSqlRow[];
    return rows.map(mapRow);
  }
}
