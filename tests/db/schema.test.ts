import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/database.js';
import { initSchema } from '../../src/db/schema.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { GiveawayRepo } from '../../src/db/repositories/giveawayRepo.js';
import { RolePanelRepo } from '../../src/db/repositories/rolePanelRepo.js';

describe('env & database schema', () => {
  it('parses valid environment variables and rejects missing required fields', () => {
    expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN/);
    expect(() => parseEnv({ DISCORD_TOKEN: 'tok' })).toThrow(/DISCORD_CLIENT_ID/);

    const env = parseEnv({
      DISCORD_TOKEN: 'tok-123',
      DISCORD_CLIENT_ID: 'app-456',
      DISCORD_GUILD_ID: 'guild-789',
      DB_PATH: './custom.db',
      TIMEZONE: 'Asia/Shanghai',
    });
    expect(env).toEqual({
      discordToken: 'tok-123',
      discordClientId: 'app-456',
      discordGuildId: 'guild-789',
      dbPath: './custom.db',
      timezone: 'Asia/Shanghai',
    });
  });

  it('initializes schema idempotently, enables foreign keys, and configures WAL for file DBs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zhbot-db-'));
    const dbFile = join(dir, 'nested', 'bot.db');
    try {
      const db = createDatabase(dbFile);
      initSchema(db);

      const journalMode = db.pragma('journal_mode', { simple: true });
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(String(journalMode).toLowerCase()).toBe('wal');
      expect(fk).toBe(1);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'guild_configs',
          'member_profiles',
          'level_role_rewards',
          'shop_items',
          'user_inventory',
          'fun_fortunes',
          'fun_interactions',
          'tickets',
          'giveaways',
          'giveaway_entries',
          'invite_records',
          'role_panels',
          'role_panel_options',
        ]),
      );

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates default guild config, updates it, and cascades deletes on giveaways and role panels', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const giveawayRepo = new GiveawayRepo(db);
    const panelRepo = new RolePanelRepo(db);

    const cfg = configRepo.getOrCreate('g1');
    expect(cfg.modules.leveling).toBe(true);
    expect(cfg.economy.currencyName).toBe('星币');
    expect(cfg.leveling.heatMaxMultiplier).toBe(2.0);

    configRepo.updateModules('g1', { ...cfg.modules, tickets: false });
    expect(configRepo.getOrCreate('g1').modules.tickets).toBe(false);

    const gw = giveawayRepo.create({
      guildId: 'g1',
      channelId: 'c1',
      messageId: 'm1',
      hostId: 'u1',
      prize: '月卡',
      winnerCount: 1,
      minLevel: 0,
      requiredRoleId: null,
      endsAt: Date.now() + 60_000,
    });
    giveawayRepo.addEntry(gw.id, 'u2', Date.now());
    expect(giveawayRepo.countEntries(gw.id)).toBe(1);

    db.prepare('DELETE FROM giveaways WHERE id = ?').run(gw.id);
    expect(giveawayRepo.countEntries(gw.id)).toBe(0);

    const panel = panelRepo.create({
      guildId: 'g1',
      title: '身份组',
      description: '自选',
      displayMode: 'button',
      selectionMode: 'multi',
    });
    panelRepo.addOption({
      panelId: panel.id,
      roleId: 'r1',
      label: '玩家',
      emoji: '🎮',
      description: null,
      sortOrder: 0,
    });
    expect(panelRepo.listOptions(panel.id)).toHaveLength(1);
    panelRepo.delete(panel.id, 'g1');
    expect(panelRepo.listOptions(panel.id)).toHaveLength(0);

    db.close();
  });
});
