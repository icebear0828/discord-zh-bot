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

    const withLlm = parseEnv({
      DISCORD_TOKEN: 'tok-123',
      DISCORD_CLIENT_ID: 'app-456',
      LLM_BASE_URL: 'https://example.com/v1///',
      LLM_API_KEY: 'sk-test',
      LLM_MODEL: 'gemini-test',
      LLM_TIMEOUT_MS: '45000',
    });
    expect(withLlm.llm).toEqual({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      model: 'gemini-test',
      timeoutMs: 45_000,
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
          'ai_memories',
          'ai_channel_resets',
          'interaction_logs',
          'blackjack_games',
          'duel_challenges',
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
    expect(colNames).toContain('stat_value');

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

    const withStat = profileRepo.setStatValue('g1', 'u1', 114514);
    expect(withStat.statValue).toBe(114514);
    expect(profileRepo.getOrCreate('g1', 'u1').statValue).toBe(114514);

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
    expect(colNames).toContain('ai_config_json');

    const repo = new GuildConfigRepo(db);
    expect(repo.getOrCreate('g1').adminUserIds).toEqual([]);
    expect(repo.getOrCreate('g1').games.petGachaPrice).toBe(500);
    expect(repo.getOrCreate('g1').modules.socialGames).toBe(true);
    expect(repo.getOrCreate('g1').modules.ai).toBe(true);
    expect(repo.getOrCreate('g1').ai.preset).toBe('community');
    repo.updateAdminUsers('g1', ['u100', 'u200']);
    expect(repo.getOrCreate('g1').adminUserIds).toEqual(['u100', 'u200']);

    db.close();
  });

  it('migrates legacy shop_items table cleanly while preserving rows and enabling new item types', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE shop_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('role', 'title', 'xp_boost')),
        price INTEGER NOT NULL CHECK (price >= 0),
        role_id TEXT,
        title_text TEXT,
        boost_multiplier REAL,
        boost_duration_sec INTEGER,
        stock INTEGER,
        created_at INTEGER NOT NULL
      );
      INSERT INTO shop_items (guild_id, name, description, type, price, role_id, created_at)
      VALUES ('g1', '旧VIP', '老数据', 'role', 500, 'r1', 1000);
    `);

    initSchema(db);
    initSchema(db);

    const shopCols = (db.pragma('table_info(shop_items)') as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(shopCols).toContain('payload_json');

    const legacy = db
      .prepare('SELECT id, name, type, price, payload_json FROM shop_items WHERE guild_id = ?')
      .get('g1') as { id: number; name: string; type: string; price: number; payload_json: string };
    expect(legacy).toEqual({
      id: 1,
      name: '旧VIP',
      type: 'role',
      price: 500,
      payload_json: '{}',
    });

    for (const newType of ['stat_boost', 'custom_title', 'pet_xp', 'mystery_box'] as const) {
      expect(() =>
        db
          .prepare(
            "INSERT INTO shop_items (guild_id, name, description, type, price, payload_json, created_at) VALUES ('g1', ?, '新类型', ?, 100, '{}', 2000)",
          )
          .run(`商品_${newType}`, newType),
      ).not.toThrow();
    }

    const profCols = (db.pragma('table_info(member_profiles)') as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(profCols).toContain('last_stat_boost_date');
    expect(profCols).toContain('stat_boost_daily_count');

    db.close();
  });

  it('idempotently migrates legacy tables with all Wave 1 columns while preserving existing data', () => {
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
      INSERT INTO member_profiles (guild_id, user_id, coins) VALUES ('g1', 'u1', 777);

      CREATE TABLE red_packets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        sender_id TEXT NOT NULL,
        total_amount INTEGER NOT NULL CHECK (total_amount >= 1),
        remaining_amount INTEGER NOT NULL CHECK (remaining_amount >= 0),
        total_count INTEGER NOT NULL CHECK (total_count >= 1),
        remaining_count INTEGER NOT NULL CHECK (remaining_count >= 0),
        greeting TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'finished', 'expired')),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO red_packets (
        guild_id, channel_id, sender_id, total_amount, remaining_amount,
        total_count, remaining_count, greeting, status, expires_at, created_at
      ) VALUES ('g1', 'c1', 'u1', 500, 500, 5, 5, 'legacy', 'open', 99999, 1000);

      CREATE TABLE predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        creator_id TEXT NOT NULL,
        title TEXT NOT NULL,
        options_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'locked', 'settled', 'cancelled')),
        winning_option INTEGER,
        closes_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      INSERT INTO predictions (
        guild_id, channel_id, creator_id, title, options_json, status, closes_at, created_at
      ) VALUES ('g1', 'c1', 'u1', '旧盘口', '["A","B"]', 'locked', 5000, 1000);

      CREATE TABLE world_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        event_type TEXT NOT NULL CHECK (event_type IN ('chest', 'boss')),
        name TEXT NOT NULL,
        flavor TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'expired')),
        max_hp INTEGER NOT NULL DEFAULT 0,
        current_hp INTEGER NOT NULL DEFAULT 0,
        reward_pool INTEGER NOT NULL CHECK (reward_pool >= 0),
        total_shares INTEGER NOT NULL DEFAULT 0,
        remaining_shares INTEGER NOT NULL DEFAULT 0,
        remaining_amount INTEGER NOT NULL DEFAULT 0,
        killer_id TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      INSERT INTO world_events (
        guild_id, channel_id, event_type, name, flavor, status,
        max_hp, current_hp, reward_pool, created_at, expires_at
      ) VALUES ('g1', 'c1', 'boss', '旧Boss', '说明', 'active', 1000, 800, 3000, 1000, 99999);

      CREATE TABLE world_event_participants (
        event_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        damage_or_reward INTEGER NOT NULL DEFAULT 0,
        hits INTEGER NOT NULL DEFAULT 0,
        last_action_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (event_id, user_id)
      );
      INSERT INTO world_event_participants (event_id, user_id, damage_or_reward, hits, last_action_at)
      VALUES (1, 'u1', 200, 2, 2000);

      CREATE TABLE number_bomb_games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        host_id TEXT NOT NULL,
        penalty INTEGER NOT NULL CHECK (penalty >= 1),
        min_bound INTEGER NOT NULL,
        max_bound INTEGER NOT NULL,
        secret_number INTEGER NOT NULL,
        last_guesser_id TEXT,
        participants_json TEXT NOT NULL DEFAULT '[]',
        guesses_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK (status IN ('open', 'exploded', 'cancelled')),
        loser_id TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      INSERT INTO number_bomb_games (
        guild_id, channel_id, host_id, penalty, min_bound, max_bound,
        secret_number, status, created_at, expires_at
      ) VALUES ('g1', 'c1', 'u1', 300, 1, 100, 42, 'open', 1000, 99999);
    `);

    // Must succeed twice idempotently without losing legacy rows
    initSchema(db);
    initSchema(db);

    const getColNames = (table: string): string[] =>
      (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name);

    expect(getColNames('member_profiles')).toEqual(
      expect.arrayContaining(['last_pet_work_at', 'pet_pvp_xp_date', 'pet_pvp_xp_daily']),
    );
    expect(getColNames('red_packets')).toContain('system_funded');
    expect(getColNames('world_event_participants')).toContain('next_attack_at');
    expect(getColNames('world_events')).toContain('rewards_json');
    expect(getColNames('number_bomb_games')).toContain('payouts_json');
    expect(getColNames('predictions')).toContain('locked_at');

    const profileRow = db
      .prepare(
        'SELECT coins, last_pet_work_at, pet_pvp_xp_date, pet_pvp_xp_daily FROM member_profiles WHERE guild_id = ? AND user_id = ?',
      )
      .get('g1', 'u1') as {
      coins: number;
      last_pet_work_at: number;
      pet_pvp_xp_date: string;
      pet_pvp_xp_daily: number;
    };
    expect(profileRow).toEqual({
      coins: 777,
      last_pet_work_at: 0,
      pet_pvp_xp_date: '',
      pet_pvp_xp_daily: 0,
    });

    const packetRow = db
      .prepare('SELECT greeting, system_funded FROM red_packets WHERE id = 1')
      .get() as { greeting: string; system_funded: number };
    expect(packetRow).toEqual({ greeting: 'legacy', system_funded: 0 });

    const predRow = db
      .prepare('SELECT title, locked_at FROM predictions WHERE id = 1')
      .get() as { title: string; locked_at: number };
    expect(predRow).toEqual({ title: '旧盘口', locked_at: 0 });

    const eventRow = db
      .prepare('SELECT name, rewards_json FROM world_events WHERE id = 1')
      .get() as { name: string; rewards_json: string };
    expect(eventRow).toEqual({ name: '旧Boss', rewards_json: '[]' });

    const partRow = db
      .prepare('SELECT damage_or_reward, next_attack_at FROM world_event_participants WHERE event_id = 1 AND user_id = ?')
      .get('u1') as { damage_or_reward: number; next_attack_at: number };
    expect(partRow).toEqual({ damage_or_reward: 200, next_attack_at: 0 });

    const bombRow = db
      .prepare('SELECT penalty, payouts_json FROM number_bomb_games WHERE id = 1')
      .get() as { penalty: number; payouts_json: string };
    expect(bombRow).toEqual({ penalty: 300, payouts_json: '[]' });

    // Verify new tables & indexes exist
    const indexes = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_blackjack_games_expires',
        'idx_duel_challenges_status_exp',
        'idx_interaction_logs_created_at',
      ]),
    );

    db.close();
  });
});
