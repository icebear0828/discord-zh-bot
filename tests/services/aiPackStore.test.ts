import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AiPackStore,
  createBuiltinDefaultCard,
  createBuiltinDefaultPreset,
  type CharacterCardPack,
  type PresetPack,
} from '../../src/services/aiPackStore.js';

describe('AiPackStore (disk-backed Git-friendly preset & card store)', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-ai-packs-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('initializes directory layout with formatted default preset/card and .history gitignore', () => {
    const store = new AiPackStore(tmpDir);
    store.ensureInitialized();

    expect(fs.existsSync(path.join(tmpDir, 'presets'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'cards'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.history', 'presets'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.history', 'cards'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(true);

    const presets = store.listPresets();
    const cards = store.listCards();
    expect(presets.length).toBeGreaterThanOrEqual(1);
    expect(cards.length).toBeGreaterThanOrEqual(1);

    const rawFile = fs.readFileSync(
      path.join(tmpDir, 'presets', `${presets[0]!.id}.json`),
      'utf8',
    );
    // Must be 2-space pretty-printed with trailing newline for clean git diff
    expect(rawFile.endsWith('\n')).toBe(true);
    expect(rawFile).toContain('  "schemaVersion": 1,');
  });

  it('rejects path-traversal or malformed pack IDs', () => {
    const store = new AiPackStore(tmpDir);
    store.ensureInitialized();

    const badPreset: PresetPack = {
      ...createBuiltinDefaultPreset(),
      id: '../evil',
    };
    const res = store.savePreset(badPreset);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('ID');
    }
  });

  it('auto-reloads preset & card from disk when mtime changes (simulating git pull)', () => {
    const store = new AiPackStore(tmpDir);
    store.ensureInitialized();

    const initial = createBuiltinDefaultPreset();
    const saveRes = store.savePreset({
      ...initial,
      id: 'jb-test',
      name: '初始破限 v1',
      version: '1.0.0',
    });
    expect(saveRes.ok).toBe(true);
    expect(store.getPreset('jb-test')?.name).toBe('初始破限 v1');

    // Simulate external `git pull` editing the JSON file directly on disk with newer mtime
    const filePath = path.join(tmpDir, 'presets', 'jb-test.json');
    const diskObj = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PresetPack;
    diskObj.name = 'Git Pull 更新版 v2';
    diskObj.version = '2.0.0';
    fs.writeFileSync(filePath, `${JSON.stringify(diskObj, null, 2)}\n`, 'utf8');
    const futureTime = new Date(Date.now() + 5000);
    fs.utimesSync(filePath, futureTime, futureTime);

    const reloaded = store.getPreset('jb-test');
    expect(reloaded?.name).toBe('Git Pull 更新版 v2');
    expect(reloaded?.version).toBe('2.0.0');
  });

  it('archives previous versions into .history on overwrite and supports one-click rollback', () => {
    const store = new AiPackStore(tmpDir);
    store.ensureInitialized();

    const baseCard: CharacterCardPack = {
      ...createBuiltinDefaultCard(),
      id: 'heroine',
      name: '测试女主',
      version: '1.0.0',
      personaName: '星奈',
      identityPrompt: '第一版人设描述',
      soulPrompt: '第一版说话风格',
    };

    expect(store.saveCard(baseCard, 1000).ok).toBe(true);
    expect(store.listHistory('card', 'heroine')).toHaveLength(0);

    // Update to v1.1.0 -> v1.0.0 should be archived
    expect(
      store.saveCard(
        {
          ...baseCard,
          version: '1.1.0',
          identityPrompt: '第二版翻车人设描述',
        },
        2000,
      ).ok,
    ).toBe(true);

    const historyAfterUpdate = store.listHistory('card', 'heroine');
    expect(historyAfterUpdate).toHaveLength(1);
    expect(historyAfterUpdate[0]?.version).toBe('1.0.0');
    expect(store.getCard('heroine')?.identityPrompt).toBe('第二版翻车人设描述');

    // Rollback restores v1.0.0 and archives v1.1.0
    const rbRes = store.rollbackCard('heroine', undefined, 3000);
    expect(rbRes.ok).toBe(true);
    if (rbRes.ok) {
      expect(rbRes.restored.version).toBe('1.0.0');
      expect(rbRes.restored.identityPrompt).toBe('第一版人设描述');
    }
    expect(store.getCard('heroine')?.identityPrompt).toBe('第一版人设描述');
  });
});
