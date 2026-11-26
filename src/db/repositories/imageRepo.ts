import type Database from 'better-sqlite3';
import {
  VALID_IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
} from '../../config/defaults.js';

export type ImageGenStatus = 'ok' | 'error';

export const MAX_IMAGE_RECORDS_PER_GUILD = 2000;

export interface ImageGenerationRecord {
  id: number;
  guildId: string;
  channelId: string;
  userId: string;
  rawPrompt: string;
  finalPrompt: string;
  negativePrompt: string;
  aspectRatio: ImageAspectRatio;
  steps: number;
  scale: number;
  seed: number | null;
  spoiler: boolean;
  ephemeral: boolean;
  model: string;
  status: ImageGenStatus;
  errorCode: string | null;
  latencyMs: number;
  createdAt: number;
}

export interface CreateImageGenerationInput {
  guildId: string;
  channelId: string;
  userId: string;
  rawPrompt: string;
  finalPrompt: string;
  negativePrompt: string;
  aspectRatio: ImageAspectRatio;
  steps: number;
  scale: number;
  seed: number | null;
  spoiler: boolean;
  ephemeral: boolean;
  model: string;
  status: ImageGenStatus;
  errorCode: string | null;
  latencyMs: number;
  createdAt?: number;
}

export interface ImageUsageSummary {
  totalCalls: number;
  okCalls: number;
  errorCalls: number;
  avgLatencyMs: number;
}

export interface ImageUserPrefs {
  guildId: string;
  userId: string;
  aspectRatio: ImageAspectRatio | null;
  steps: number | null;
  scale: number | null;
  negativePrompt: string;
  spoiler: boolean;
  ephemeral: boolean;
  updatedAt: number;
}

export type ImageUserPrefsPatch = Partial<
  Omit<ImageUserPrefs, 'guildId' | 'userId' | 'updatedAt'>
>;

interface ImageUserPrefsRow {
  guild_id: string;
  user_id: string;
  aspect_ratio: string | null;
  steps: number | null;
  scale: number | null;
  negative_prompt: string;
  spoiler: number;
  ephemeral: number;
  updated_at: number;
}

interface ImageGenerationRow {
  id: number;
  guild_id: string;
  channel_id: string;
  user_id: string;
  raw_prompt: string;
  final_prompt: string;
  negative_prompt: string;
  aspect_ratio: string;
  steps: number;
  scale: number;
  seed: number | null;
  spoiler: number;
  ephemeral: number;
  model: string;
  status: ImageGenStatus;
  error_code: string | null;
  latency_ms: number;
  created_at: number;
}

const IMAGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS image_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  raw_prompt TEXT NOT NULL,
  final_prompt TEXT NOT NULL,
  negative_prompt TEXT NOT NULL DEFAULT '',
  aspect_ratio TEXT NOT NULL,
  steps INTEGER NOT NULL,
  scale REAL NOT NULL,
  seed INTEGER,
  spoiler INTEGER NOT NULL DEFAULT 0,
  ephemeral INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error_code TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_image_generations_guild_created
  ON image_generations (guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_generations_user_created
  ON image_generations (guild_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS image_user_prefs (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  aspect_ratio TEXT,
  steps INTEGER,
  scale REAL,
  negative_prompt TEXT NOT NULL DEFAULT '',
  spoiler INTEGER NOT NULL DEFAULT 0,
  ephemeral INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
`;

export function initImageSchema(db: Database.Database): void {
  db.exec(IMAGE_SCHEMA_SQL);
}

function normalizeAspectRatio(raw: string): ImageAspectRatio {
  if ((VALID_IMAGE_ASPECT_RATIOS as readonly string[]).includes(raw)) {
    return raw as ImageAspectRatio;
  }
  return '2:3';
}

function mapRow(row: ImageGenerationRow): ImageGenerationRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    rawPrompt: row.raw_prompt,
    finalPrompt: row.final_prompt,
    negativePrompt: row.negative_prompt,
    aspectRatio: normalizeAspectRatio(row.aspect_ratio),
    steps: row.steps,
    scale: row.scale,
    seed: row.seed,
    spoiler: row.spoiler === 1,
    ephemeral: row.ephemeral === 1,
    model: row.model,
    status: row.status,
    errorCode: row.error_code,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  };
}

function mapUserPrefsRow(row: ImageUserPrefsRow): ImageUserPrefs {
  const aspectRatio =
    row.aspect_ratio && (VALID_IMAGE_ASPECT_RATIOS as readonly string[]).includes(row.aspect_ratio)
      ? (row.aspect_ratio as ImageAspectRatio)
      : null;
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    aspectRatio,
    steps:
      row.steps !== null && Number.isFinite(row.steps)
        ? Math.max(1, Math.min(50, Math.round(row.steps)))
        : null,
    scale:
      row.scale !== null && Number.isFinite(row.scale)
        ? Math.max(1.0, Math.min(10.0, Number(row.scale.toFixed(1))))
        : null,
    negativePrompt: row.negative_prompt ?? '',
    spoiler: row.spoiler === 1,
    ephemeral: row.ephemeral === 1,
    updatedAt: row.updated_at,
  };
}

export class ImageRepo {
  constructor(private readonly db: Database.Database) {
    initImageSchema(db);
  }

  create(input: CreateImageGenerationInput): ImageGenerationRecord {
    const createdAt = input.createdAt ?? Date.now();
    return this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO image_generations (
            guild_id, channel_id, user_id, raw_prompt, final_prompt, negative_prompt,
            aspect_ratio, steps, scale, seed, spoiler, ephemeral, model, status, error_code,
            latency_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.guildId,
          input.channelId,
          input.userId,
          input.rawPrompt,
          input.finalPrompt,
          input.negativePrompt,
          input.aspectRatio,
          Math.round(input.steps),
          input.scale,
          input.seed,
          input.spoiler ? 1 : 0,
          input.ephemeral ? 1 : 0,
          input.model,
          input.status,
          input.errorCode,
          Math.max(0, Math.round(input.latencyMs)),
          createdAt,
        );

      this.db
        .prepare(
          `DELETE FROM image_generations
           WHERE guild_id = ?
             AND id NOT IN (
               SELECT id FROM image_generations
               WHERE guild_id = ?
               ORDER BY id DESC
               LIMIT ?
             )`,
        )
        .run(input.guildId, input.guildId, MAX_IMAGE_RECORDS_PER_GUILD);

      const row = this.db
        .prepare('SELECT * FROM image_generations WHERE id = ?')
        .get(Number(info.lastInsertRowid)) as ImageGenerationRow;
      return mapRow(row);
    })();
  }

  getById(id: number): ImageGenerationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM image_generations WHERE id = ?')
      .get(id) as ImageGenerationRow | undefined;
    return row ? mapRow(row) : null;
  }

  getUsageSummary(guildId: string, sinceMs: number): ImageUsageSummary {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total_calls,
          COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS ok_calls,
          COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS error_calls,
          COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
         FROM image_generations
         WHERE guild_id = ? AND created_at >= ?`,
      )
      .get(guildId, sinceMs) as {
      total_calls: number;
      ok_calls: number;
      error_calls: number;
      avg_latency_ms: number;
    };

    return {
      totalCalls: row.total_calls,
      okCalls: row.ok_calls,
      errorCalls: row.error_calls,
      avgLatencyMs: Math.round(row.avg_latency_ms),
    };
  }

  listRecent(guildId: string, limit = 10): ImageGenerationRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM image_generations
         WHERE guild_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(guildId, safeLimit) as ImageGenerationRow[];
    return rows.map(mapRow);
  }

  listByUser(guildId: string, userId: string, limit = 15): ImageGenerationRecord[] {
    const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM image_generations
         WHERE guild_id = ? AND user_id = ? AND status = 'ok'
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(guildId, userId, safeLimit) as ImageGenerationRow[];
    return rows.map(mapRow);
  }

  getUserPrefs(guildId: string, userId: string): ImageUserPrefs {
    const row = this.db
      .prepare('SELECT * FROM image_user_prefs WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as ImageUserPrefsRow | undefined;
    if (row) {
      return mapUserPrefsRow(row);
    }
    return {
      guildId,
      userId,
      aspectRatio: null,
      steps: null,
      scale: null,
      negativePrompt: '',
      spoiler: false,
      ephemeral: false,
      updatedAt: 0,
    };
  }

  upsertUserPrefs(guildId: string, userId: string, patch: ImageUserPrefsPatch): ImageUserPrefs {
    const existing = this.getUserPrefs(guildId, userId);
    const nextAspect =
      patch.aspectRatio !== undefined
        ? patch.aspectRatio &&
          (VALID_IMAGE_ASPECT_RATIOS as readonly string[]).includes(patch.aspectRatio)
          ? patch.aspectRatio
          : null
        : existing.aspectRatio;
    const nextSteps =
      patch.steps !== undefined
        ? patch.steps !== null && Number.isFinite(patch.steps)
          ? Math.max(1, Math.min(50, Math.round(patch.steps)))
          : null
        : existing.steps;
    const nextScale =
      patch.scale !== undefined
        ? patch.scale !== null && Number.isFinite(patch.scale)
          ? Math.max(1.0, Math.min(10.0, Number(patch.scale.toFixed(1))))
          : null
        : existing.scale;
    const nextNeg =
      patch.negativePrompt !== undefined
        ? patch.negativePrompt.trim().slice(0, 1000)
        : existing.negativePrompt;
    const nextSpoiler = patch.spoiler !== undefined ? patch.spoiler : existing.spoiler;
    const nextEphemeral = patch.ephemeral !== undefined ? patch.ephemeral : existing.ephemeral;
    const updatedAt = Date.now();

    this.db
      .prepare(
        `INSERT INTO image_user_prefs (
          guild_id, user_id, aspect_ratio, steps, scale, negative_prompt, spoiler, ephemeral, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          aspect_ratio = excluded.aspect_ratio,
          steps = excluded.steps,
          scale = excluded.scale,
          negative_prompt = excluded.negative_prompt,
          spoiler = excluded.spoiler,
          ephemeral = excluded.ephemeral,
          updated_at = excluded.updated_at`,
      )
      .run(
        guildId,
        userId,
        nextAspect,
        nextSteps,
        nextScale,
        nextNeg,
        nextSpoiler ? 1 : 0,
        nextEphemeral ? 1 : 0,
        updatedAt,
      );

    return {
      guildId,
      userId,
      aspectRatio: nextAspect,
      steps: nextSteps,
      scale: nextScale,
      negativePrompt: nextNeg,
      spoiler: nextSpoiler,
      ephemeral: nextEphemeral,
      updatedAt,
    };
  }

  resetUserPrefs(guildId: string, userId: string): void {
    this.db
      .prepare('DELETE FROM image_user_prefs WHERE guild_id = ? AND user_id = ?')
      .run(guildId, userId);
  }
}
