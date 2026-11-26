import type Database from 'better-sqlite3';
import {
  MAX_IMAGE_BATCH_COUNT,
  MAX_IMAGE_STEPS,
  VALID_IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
} from '../../config/defaults.js';
import type { NaiCharCaption, NaiCharCaptionCenter } from '../../services/imageClient.js';

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
  charCaptions: NaiCharCaption[];
  useCoords: boolean;
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
  charCaptions?: readonly NaiCharCaption[];
  useCoords?: boolean;
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
  batchCount: number | null;
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
  batch_count: number | null;
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
  char_captions_json?: string;
  use_coords?: number;
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
  char_captions_json TEXT NOT NULL DEFAULT '[]',
  use_coords INTEGER NOT NULL DEFAULT 0,
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
  batch_count INTEGER,
  negative_prompt TEXT NOT NULL DEFAULT '',
  spoiler INTEGER NOT NULL DEFAULT 0,
  ephemeral INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
`;

export function initImageSchema(db: Database.Database): void {
  db.exec(IMAGE_SCHEMA_SQL);
  const genCols = db.pragma('table_info(image_generations)') as Array<{ name: string }>;
  if (!genCols.some((col) => col.name === 'char_captions_json')) {
    db.exec("ALTER TABLE image_generations ADD COLUMN char_captions_json TEXT NOT NULL DEFAULT '[]';");
  }
  if (!genCols.some((col) => col.name === 'use_coords')) {
    db.exec('ALTER TABLE image_generations ADD COLUMN use_coords INTEGER NOT NULL DEFAULT 0;');
  }

  const cols = db.pragma('table_info(image_user_prefs)') as Array<{ name: string }>;
  if (!cols.some((col) => col.name === 'batch_count')) {
    db.exec('ALTER TABLE image_user_prefs ADD COLUMN batch_count INTEGER;');
  }
}

function isObjectRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function parseCharCaptionsJson(raw: string | undefined): NaiCharCaption[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: NaiCharCaption[] = [];
    for (const item of parsed) {
      if (!isObjectRecord(item)) continue;
      const caption = typeof item['char_caption'] === 'string' ? item['char_caption'].trim() : '';
      if (!caption) continue;
      const uc = typeof item['uc'] === 'string' && item['uc'].trim() ? item['uc'].trim() : undefined;
      let centers: NaiCharCaptionCenter[] | undefined;
      if (Array.isArray(item['centers'])) {
        const validCenters: NaiCharCaptionCenter[] = [];
        for (const c of item['centers']) {
          if (
            isObjectRecord(c) &&
            typeof c['x'] === 'number' &&
            Number.isFinite(c['x']) &&
            typeof c['y'] === 'number' &&
            Number.isFinite(c['y'])
          ) {
            validCenters.push({ x: c['x'], y: c['y'] });
          }
        }
        if (validCenters.length > 0) {
          centers = validCenters;
        }
      }
      out.push({
        char_caption: caption,
        ...(uc ? { uc } : {}),
        ...(centers ? { centers } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
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
    charCaptions: parseCharCaptionsJson(row.char_captions_json),
    useCoords: row.use_coords === 1,
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
        ? Math.max(1, Math.min(MAX_IMAGE_STEPS, Math.round(row.steps)))
        : null,
    scale:
      row.scale !== null && Number.isFinite(row.scale)
        ? Math.max(1.0, Math.min(10.0, Number(row.scale.toFixed(1))))
        : null,
    batchCount:
      row.batch_count !== null && Number.isFinite(row.batch_count)
        ? Math.max(1, Math.min(MAX_IMAGE_BATCH_COUNT, Math.round(row.batch_count)))
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
    const charCaptionsJson = JSON.stringify(input.charCaptions ?? []);
    const useCoordsInt = input.useCoords ? 1 : 0;
    return this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO image_generations (
            guild_id, channel_id, user_id, raw_prompt, final_prompt, negative_prompt,
            char_captions_json, use_coords,
            aspect_ratio, steps, scale, seed, spoiler, ephemeral, model, status, error_code,
            latency_ms, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.guildId,
          input.channelId,
          input.userId,
          input.rawPrompt,
          input.finalPrompt,
          input.negativePrompt,
          charCaptionsJson,
          useCoordsInt,
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
      batchCount: null,
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
          ? Math.max(1, Math.min(MAX_IMAGE_STEPS, Math.round(patch.steps)))
          : null
        : existing.steps;
    const nextScale =
      patch.scale !== undefined
        ? patch.scale !== null && Number.isFinite(patch.scale)
          ? Math.max(1.0, Math.min(10.0, Number(patch.scale.toFixed(1))))
          : null
        : existing.scale;
    const nextBatchCount =
      patch.batchCount !== undefined
        ? patch.batchCount !== null && Number.isFinite(patch.batchCount)
          ? Math.max(1, Math.min(MAX_IMAGE_BATCH_COUNT, Math.round(patch.batchCount)))
          : null
        : existing.batchCount;
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
          guild_id, user_id, aspect_ratio, steps, scale, batch_count, negative_prompt, spoiler, ephemeral, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET
          aspect_ratio = excluded.aspect_ratio,
          steps = excluded.steps,
          scale = excluded.scale,
          batch_count = excluded.batch_count,
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
        nextBatchCount,
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
      batchCount: nextBatchCount,
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
