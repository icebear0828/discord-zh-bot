import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/database.js';
import { initSchema } from '../../src/db/schema.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { GiveawayRepo } from '../../src/db/repositories/giveawayRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
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
          'red_packets',
          'red_packet_claims',
          'user_props',
          'user_effects',
          'bounties',
          'roulette_games',
          'number_bomb_games',
          'predictions',
          'prediction_bets',
          'world_events',
          'world_event_participants',
          'relationships',
          'relationship_proposals',
          'user_pets',
          'pet_battles',
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

  it('migrates legacy v1 member_profiles table by adding bank_coins and last_bank_interest_date while preserving existing rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE member_profiles (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 0,
        message_count INTEGER NOT NULL DEFAULT 0,
        voice_minutes INTEGER NOT NULL DEFAULT 0,
        coins INTEGER NOT NULL DEFAULT 0,
        daily_streak INTEGER NOT NULL DEFAULT 0,
        last_daily_date TEXT,
        last_work_at INTEGER NOT NULL DEFAULT 0,
        last_rob_at INTEGER NOT NULL DEFAULT 0,
        rob_shield_until INTEGER NOT NULL DEFAULT 0,
        equipped_title TEXT,
        xp_boost_multiplier REAL NOT NULL DEFAULT 1.0,
        xp_boost_expires_at INTEGER NOT NULL DEFAULT 0,
        heat_streak INTEGER NOT NULL DEFAULT 0,
        last_xp_at INTEGER NOT NULL DEFAULT 0,
        hour_window_start INTEGER NOT NULL DEFAULT 0,
        hour_xp_earned INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
      INSERT INTO member_profiles (guild_id, user_id, coins) VALUES ('g1', 'u1', 500);
    `);

    initSchema(db);
    // Idempotent second call should also succeed
    initSchema(db);

    const cols = db.pragma('table_info(member_profiles)') as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('bank_coins');
    expect(colNames).toContain('last_bank_interest_date');
    expect(colNames).toContain('card_nickname');
    expect(colNames).toContain('card_tag');
    expect(colNames).toContain('card_bio');
    expect(colNames).toContain('card_color');
    expect(colNames).toContain('level_offset');

    const row = db
      .prepare('SELECT coins, bank_coins, last_bank_interest_date FROM member_profiles WHERE guild_id = ? AND user_id = ?')
      .get('g1', 'u1') as {
      coins: number;
      bank_coins: number;
      last_bank_interest_date: string | null;
    };
    expect(row.coins).toBe(500);
    expect(row.bank_coins).toBe(0);
    expect(row.last_bank_interest_date).toBeNull();

    const profileRepo = new ProfileRepo(db);
    const profile = profileRepo.getOrCreate('g1', 'u1');
    expect(profile.coins).toBe(500);
    expect(profile.bankCoins).toBe(0);
    expect(profile.lastBankInterestDate).toBeNull();
    expect(profile.cardNickname).toBeNull();

    const updatedCard = profileRepo.updateCard('g1', 'u1', {
      cardNickname: '测试大佬',
      cardTag: '深夜巡逻员',
      cardBio: '摸鱼第一名',
      cardColor: '#9B59B6',
    });
    expect(updatedCard.cardNickname).toBe('测试大佬');
    expect(updatedCard.cardTag).toBe('深夜巡逻员');
    expect(updatedCard.cardBio).toBe('摸鱼第一名');
    expect(updatedCard.cardColor).toBe('#9B59B6');

    const reloaded = profileRepo.getOrCreate('g1', 'u1');
    expect(reloaded.cardNickname).toBe('测试大佬');
    expect(reloaded.cardColor).toBe('#9B59B6');

    const cleared = profileRepo.updateCard('g1', 'u1', {
      cardNickname: null,
      cardTag: null,
      cardBio: null,
      cardColor: null,
    });
    expect(cleared.cardNickname).toBeNull();
    expect(profileRepo.getOrCreate('g1', 'u1').cardBio).toBeNull();

    db.close();
  });

  it('migrates legacy v1 guild_configs table by adding admin_user_ids_json and supports updateAdminUsers', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE guild_configs (
        guild_id TEXT PRIMARY KEY,
        modules_json TEXT NOT NULL,
        admin_role_ids_json TEXT NOT NULL,
        leveling_config_json TEXT NOT NULL,
        economy_config_json TEXT NOT NULL,
        welcome_config_json TEXT NOT NULL,
        ticket_config_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO guild_configs VALUES (
        'g1', '{}', '[]', '{}', '{}', '{}', '{}', 1000
      );
    `);

    initSchema(db);
    initSchema(db);

    const cols = db.pragma('table_info(guild_configs)') as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('admin_user_ids_json');
    expect(colNames).toContain('games_config_json');

    const repo = new GuildConfigRepo(db);
    expect(repo.getOrCreate('g1').adminUserIds).toEqual([]);
    expect(repo.getOrCreate('g1').games.petGachaPrice).toBe(500);
    expect(repo.getOrCreate('g1').modules.socialGames).toBe(true);
    repo.updateAdminUsers('g1', ['u100', 'u200']);
    expect(repo.getOrCreate('g1').adminUserIds).toEqual(['u100', 'u200']);

    db.close();
  });
});
