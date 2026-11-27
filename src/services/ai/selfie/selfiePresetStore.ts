import fs from 'node:fs';
import { BUILTIN_OC_POSES, type OcPosePreset } from '../../ocPoseCatalog.js';
import { isRecord, type AiOcProfile } from './selfieTypesAndDefaults.js';
import {
  sanitizeExternalOcProfile,
  sanitizeExternalPosePreset,
} from './selfieExternalSanitizer.js';

export function listBuiltinOcPoses(): readonly OcPosePreset[] {
  return BUILTIN_OC_POSES;
}

/**
 * Loads private OC preset profiles (and optional custom pose extensions) from a gitignored JSON file
 * (e.g. `data/ai-packs/oc-presets.json`) with mtime-based hot reload.
 */
export class AiOcPresetStore {
  private cache: {
    mtimeMs: number;
    profiles: AiOcProfile[];
    customPoses: OcPosePreset[];
  } | null = null;

  constructor(private readonly filePath: string) {}

  getFilePath(): string {
    return this.filePath;
  }

  private reloadIfNeeded(): { profiles: AiOcProfile[]; customPoses: OcPosePreset[] } {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.filePath);
    } catch {
      this.cache = null;
      return { profiles: [], customPoses: [] };
    }

    if (this.cache && this.cache.mtimeMs === stat.mtimeMs) {
      return this.cache;
    }

    try {
      const rawText = fs.readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(rawText);
      const listRaw: unknown[] = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed['profiles'])
          ? (parsed['profiles'] as unknown[])
          : [];
      const posesRaw: unknown[] =
        isRecord(parsed) && Array.isArray(parsed['poses']) ? (parsed['poses'] as unknown[]) : [];

      const seenIds = new Set<string>();
      const profiles: AiOcProfile[] = [];
      for (const item of listRaw) {
        const sanitized = sanitizeExternalOcProfile(item);
        if (!sanitized || seenIds.has(sanitized.id)) continue;
        seenIds.add(sanitized.id);
        profiles.push(sanitized);
      }

      const seenPoseIds = new Set<string>();
      const customPoses: OcPosePreset[] = [];
      for (const item of posesRaw) {
        const pose = sanitizeExternalPosePreset(item);
        if (!pose || seenPoseIds.has(pose.id)) continue;
        seenPoseIds.add(pose.id);
        customPoses.push(pose);
      }

      this.cache = { mtimeMs: stat.mtimeMs, profiles, customPoses };
      return this.cache;
    } catch {
      this.cache = null;
      return { profiles: [], customPoses: [] };
    }
  }

  listProfiles(): AiOcProfile[] {
    return [...this.reloadIfNeeded().profiles];
  }

  listPoses(): OcPosePreset[] {
    const { customPoses } = this.reloadIfNeeded();
    if (customPoses.length === 0) {
      return [...BUILTIN_OC_POSES];
    }
    const customMap = new Map(customPoses.map((p) => [p.id, p]));
    const merged = BUILTIN_OC_POSES.map((p) => customMap.get(p.id) ?? p);
    for (const cp of customPoses) {
      if (!BUILTIN_OC_POSES.some((bp) => bp.id === cp.id)) {
        merged.push(cp);
      }
    }
    return merged;
  }

  getProfile(id: string): AiOcProfile | undefined {
    const trimmed = id.trim();
    if (!trimmed) return undefined;
    return this.listProfiles().find((p) => p.id === trimmed);
  }
}
