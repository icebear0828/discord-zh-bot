import fs from 'node:fs';
import path from 'node:path';
import {
  createBuiltinDefaultCard,
  createBuiltinDefaultPreset,
  isValidPackId,
  MAX_PACK_HISTORY_PER_ID,
  type CharacterCardPack,
  type PackHistoryEntry,
  type PresetPack,
} from './packTypesAndBuiltins.js';
import {
  normalizeCharacterCardPack,
  normalizePresetPack,
} from './packNormalizers.js';

interface CachedFile<T> {
  mtimeMs: number;
  pack: T;
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function sanitizeVersionForFile(version: string): string {
  return version.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 32) || '1.0.0';
}

export class AiPackStore {
  private readonly presetsDir: string;
  private readonly cardsDir: string;
  private readonly historyPresetsDir: string;
  private readonly historyCardsDir: string;
  private readonly presetCache = new Map<string, CachedFile<PresetPack>>();
  private readonly cardCache = new Map<string, CachedFile<CharacterCardPack>>();
  private initialized = false;

  constructor(private readonly baseDir: string) {
    this.presetsDir = path.join(baseDir, 'presets');
    this.cardsDir = path.join(baseDir, 'cards');
    this.historyPresetsDir = path.join(baseDir, '.history', 'presets');
    this.historyCardsDir = path.join(baseDir, '.history', 'cards');
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  ensureInitialized(): void {
    if (this.initialized) return;
    fs.mkdirSync(this.presetsDir, { recursive: true });
    fs.mkdirSync(this.cardsDir, { recursive: true });
    fs.mkdirSync(this.historyPresetsDir, { recursive: true });
    fs.mkdirSync(this.historyCardsDir, { recursive: true });

    const gitignorePath = path.join(this.baseDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '.history/\n*.tmp-*\n.DS_Store\n', 'utf8');
    }

    const presetFiles = fs.readdirSync(this.presetsDir).filter((f) => f.endsWith('.json'));
    if (presetFiles.length === 0) {
      const defPreset = createBuiltinDefaultPreset();
      writeJsonAtomic(path.join(this.presetsDir, `${defPreset.id}.json`), defPreset);
    }

    const cardFiles = fs.readdirSync(this.cardsDir).filter((f) => f.endsWith('.json'));
    if (cardFiles.length === 0) {
      const defCard = createBuiltinDefaultCard();
      writeJsonAtomic(path.join(this.cardsDir, `${defCard.id}.json`), defCard);
    }

    this.initialized = true;
  }

  reloadAll(): { presets: number; cards: number } {
    this.ensureInitialized();
    this.presetCache.clear();
    this.cardCache.clear();
    return {
      presets: this.listPresets().length,
      cards: this.listCards().length,
    };
  }

  getPreset(id: string): PresetPack | null {
    this.ensureInitialized();
    if (!isValidPackId(id)) return null;
    const filePath = path.join(this.presetsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      this.presetCache.delete(id);
      return null;
    }

    try {
      const stat = fs.statSync(filePath);
      const cached = this.presetCache.get(id);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.pack;
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const norm = normalizePresetPack(parsed);
      if (!norm.ok) return null;
      const pack: PresetPack = { ...norm.pack, id };
      this.presetCache.set(id, { mtimeMs: stat.mtimeMs, pack });
      return pack;
    } catch {
      return null;
    }
  }

  getCard(id: string): CharacterCardPack | null {
    this.ensureInitialized();
    if (!isValidPackId(id)) return null;
    const filePath = path.join(this.cardsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      this.cardCache.delete(id);
      return null;
    }

    try {
      const stat = fs.statSync(filePath);
      const cached = this.cardCache.get(id);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.pack;
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const norm = normalizeCharacterCardPack(parsed);
      if (!norm.ok) return null;
      const pack: CharacterCardPack = { ...norm.pack, id };
      this.cardCache.set(id, { mtimeMs: stat.mtimeMs, pack });
      return pack;
    } catch {
      return null;
    }
  }

  listPresets(): PresetPack[] {
    this.ensureInitialized();
    const files = fs
      .readdirSync(this.presetsDir)
      .filter((f) => f.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));
    const list: PresetPack[] = [];
    for (const file of files) {
      const id = file.slice(0, -5);
      const pack = this.getPreset(id);
      if (pack) list.push(pack);
    }
    return list;
  }

  listCards(): CharacterCardPack[] {
    this.ensureInitialized();
    const files = fs
      .readdirSync(this.cardsDir)
      .filter((f) => f.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));
    const list: CharacterCardPack[] = [];
    for (const file of files) {
      const id = file.slice(0, -5);
      const pack = this.getCard(id);
      if (pack) list.push(pack);
    }
    return list;
  }

  private archiveExistingFile(
    kind: 'preset' | 'card',
    id: string,
    existingVersion: string,
    filePath: string,
    nowMs: number,
  ): void {
    if (!fs.existsSync(filePath)) return;
    const histDir = kind === 'preset' ? this.historyPresetsDir : this.historyCardsDir;
    fs.mkdirSync(histDir, { recursive: true });
    const safeVer = sanitizeVersionForFile(existingVersion);
    const snapName = `${id}@${safeVer}-${nowMs}.json`;
    fs.copyFileSync(filePath, path.join(histDir, snapName));

    // Prune older snapshots beyond MAX_PACK_HISTORY_PER_ID
    const prefix = `${id}@`;
    const allSnaps = fs
      .readdirSync(histDir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));
    if (allSnaps.length > MAX_PACK_HISTORY_PER_ID) {
      const toRemove = allSnaps.slice(0, allSnaps.length - MAX_PACK_HISTORY_PER_ID);
      for (const oldFile of toRemove) {
        try {
          fs.unlinkSync(path.join(histDir, oldFile));
        } catch {
          // ignore
        }
      }
    }
  }

  savePreset(
    input: PresetPack,
    nowMs = Date.now(),
  ): { ok: true; pack: PresetPack; archivedPrevious: boolean } | { ok: false; error: string } {
    this.ensureInitialized();
    const norm = normalizePresetPack(input);
    if (!norm.ok) return norm;

    const id = norm.pack.id;
    const filePath = path.join(this.presetsDir, `${id}.json`);
    const existing = this.getPreset(id);
    let archivedPrevious = false;

    if (existing) {
      const prevJson = JSON.stringify(existing);
      const nextJson = JSON.stringify(norm.pack);
      if (prevJson !== nextJson) {
        this.archiveExistingFile('preset', id, existing.version, filePath, nowMs);
        archivedPrevious = true;
      }
    }

    writeJsonAtomic(filePath, norm.pack);
    const stat = fs.statSync(filePath);
    this.presetCache.set(id, { mtimeMs: stat.mtimeMs, pack: norm.pack });
    return { ok: true, pack: norm.pack, archivedPrevious };
  }

  saveCard(
    input: CharacterCardPack,
    nowMs = Date.now(),
  ): { ok: true; pack: CharacterCardPack; archivedPrevious: boolean } | { ok: false; error: string } {
    this.ensureInitialized();
    const norm = normalizeCharacterCardPack(input);
    if (!norm.ok) return norm;

    const id = norm.pack.id;
    const filePath = path.join(this.cardsDir, `${id}.json`);
    const existing = this.getCard(id);
    let archivedPrevious = false;

    if (existing) {
      const prevJson = JSON.stringify(existing);
      const nextJson = JSON.stringify(norm.pack);
      if (prevJson !== nextJson) {
        this.archiveExistingFile('card', id, existing.version, filePath, nowMs);
        archivedPrevious = true;
      }
    }

    writeJsonAtomic(filePath, norm.pack);
    const stat = fs.statSync(filePath);
    this.cardCache.set(id, { mtimeMs: stat.mtimeMs, pack: norm.pack });
    return { ok: true, pack: norm.pack, archivedPrevious };
  }

  listHistory(kind: 'preset' | 'card', id: string): PackHistoryEntry[] {
    this.ensureInitialized();
    if (!isValidPackId(id)) return [];
    const histDir = kind === 'preset' ? this.historyPresetsDir : this.historyCardsDir;
    if (!fs.existsSync(histDir)) return [];

    const prefix = `${id}@`;
    const entries: PackHistoryEntry[] = [];
    for (const fileName of fs.readdirSync(histDir)) {
      if (!fileName.startsWith(prefix) || !fileName.endsWith('.json')) continue;
      const body = fileName.slice(prefix.length, -5);
      const dashIdx = body.lastIndexOf('-');
      const version = dashIdx > 0 ? body.slice(0, dashIdx) : body;
      const tsRaw = dashIdx > 0 ? Number.parseInt(body.slice(dashIdx + 1), 10) : 0;
      const savedAt = Number.isFinite(tsRaw) ? tsRaw : 0;
      entries.push({ fileName, id, version, savedAt });
    }

    entries.sort((a, b) => b.savedAt - a.savedAt || b.fileName.localeCompare(a.fileName));
    return entries;
  }

  rollbackPreset(
    id: string,
    targetFileName?: string,
    nowMs = Date.now(),
  ): { ok: true; restored: PresetPack } | { ok: false; error: string } {
    const history = this.listHistory('preset', id);
    if (history.length === 0) {
      return { ok: false, error: `预设 \`${id}\` 暂无可回滚的历史快照。` };
    }
    const chosen = targetFileName
      ? history.find((h) => h.fileName === targetFileName)
      : history[0];
    if (!chosen) {
      return { ok: false, error: `找不到历史快照 \`${targetFileName}\`。` };
    }

    const snapPath = path.join(this.historyPresetsDir, chosen.fileName);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      const norm = normalizePresetPack(parsed);
      if (!norm.ok) return norm;
      const restored: PresetPack = { ...norm.pack, id };
      const saved = this.savePreset(restored, nowMs);
      if (!saved.ok) return saved;
      return { ok: true, restored: saved.pack };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `读取历史快照失败：${msg}` };
    }
  }

  rollbackCard(
    id: string,
    targetFileName?: string,
    nowMs = Date.now(),
  ): { ok: true; restored: CharacterCardPack } | { ok: false; error: string } {
    const history = this.listHistory('card', id);
    if (history.length === 0) {
      return { ok: false, error: `角色卡 \`${id}\` 暂无可回滚的历史快照。` };
    }
    const chosen = targetFileName
      ? history.find((h) => h.fileName === targetFileName)
      : history[0];
    if (!chosen) {
      return { ok: false, error: `找不到历史快照 \`${targetFileName}\`。` };
    }

    const snapPath = path.join(this.historyCardsDir, chosen.fileName);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      const norm = normalizeCharacterCardPack(parsed);
      if (!norm.ok) return norm;
      const restored: CharacterCardPack = { ...norm.pack, id };
      const saved = this.saveCard(restored, nowMs);
      if (!saved.ok) return saved;
      return { ok: true, restored: saved.pack };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `读取历史快照失败：${msg}` };
    }
  }
}
