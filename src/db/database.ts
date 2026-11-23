import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initSchema } from './schema.js';

export function createDatabase(dbPath: string): Database.Database {
  const isMemory = dbPath === ':memory:' || dbPath.startsWith('file::memory:');
  if (!isMemory) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  if (!isMemory) {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}
