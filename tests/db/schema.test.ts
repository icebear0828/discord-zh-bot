import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_NAI_NEGATIVE_PROMPT,
  DEFAULT_NAI_POSITIVE_PROMPT,
} from '../../src/config/defaults.js';
import { parseEnv } from '../../src/config/env.js';
import { createDatabase } from '../../src/db/database.js';
import { initSchema } from '../../src/db/schema.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { GiveawayRepo } from '../../src/db/repositories/giveawayRepo.js';
import { ImageRepo } from '../../src/db/repositories/imageRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RolePanelRepo } from '../../src/db/repositories/rolePanelRepo.js';
import { initRpgSchema, RpgRepo } from '../../src/db/repositories/rpgRepo.js';

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
      fallbackModel: 'pg/gemini-4-carbon',
      maxRetries: 8,
      rateLimitMaxRetries: 2,
    });

    const withCustomLlm = parseEnv({
      DISCORD_TOKEN: 'tok-123',
      DISCORD_CLIENT_ID: 'app-456',
      LLM_BASE_URL: 'https://example.com/v1',
      LLM_API_KEY: 'sk-test',
      LLM_MODEL: 'gemini-test',
      LLM_FALLBACK_MODEL: 'none',
      LLM_MAX_RETRIES: '10',
      LLM_RATE_LIMIT_MAX_RETRIES: '3',
    });
    expect(withCustomLlm.llm).toEqual({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      model: 'gemini-test',
      timeoutMs: 60_000,
      fallbackModel: '',
      maxRetries: 10,
      rateLimitMaxRetries: 3,
    });

    expect(env.image).toBeUndefined();
    const withImage = parseEnv({
      DISCORD_TOKEN: 'tok-123',
      DISCORD_CLIENT_ID: 'app-456',
      IMAGE_BASE_URL: 'https://img.example.com/v1///',
      IMAGE_API_KEY: 'sk-img',
    });
    expect(withImage.image).toEqual({
      baseUrl: 'https://img.example.com/v1',
      apiKey: 'sk-img',
      model: 'nai/nai-diffusion-5-full',
      timeoutMs: 90_000,
      maxRetries: 2,
    });

    const withCustomImage = parseEnv({
      DISCORD_TOKEN: 'tok-123',
      DISCORD_CLIENT_ID: 'app-456',
      IMAGE_BASE_URL: 'https://img.example.com/v1',
      IMAGE_API_KEY: 'sk-img',
      IMAGE_MODEL: 'custom/model',
      IMAGE_TIMEOUT_MS: '999999',
      IMAGE_MAX_RETRIES: '99',
    });
    expect(withCustomImage.image).toEqual({
      baseUrl: 'https://img.example.com/v1',
      apiKey: 'sk-img',
      model: 'custom/model',
      timeoutMs: 300_000,
      maxRetries: 8,
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
          'image_generations',
          'image_user_prefs',
          'interaction_logs',
          'blackjack_games',
          'duel_challenges',
          'rps_duels',
          'duel_roulettes',
          'nickname_locks',
          'credit_accounts',
          'credit_logs',
          'credit_reviews',
          'loans',
          'hustle_stats',
          'gambling_stats',
          'rpg_characters',
          'rpg_items',
          'rpg_runs',
          'rpg_trials',
          'rpg_duels',
          'rpg_raids',
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
    expect(colNames).toContain('image_config_json');
    expect(colNames).toContain('credit_loan_config_json');
    expect(colNames).toContain('rpg_config_json');

    const repo = new GuildConfigRepo(db);
    expect(repo.getOrCreate('g1').adminUserIds).toEqual([]);
    expect(repo.getOrCreate('g1').games.petGachaPrice).toBe(500);
    expect(repo.getOrCreate('g1').modules.socialGames).toBe(true);
    expect(repo.getOrCreate('g1').modules.ai).toBe(true);
    expect(repo.getOrCreate('g1').modules.imageGen).toBe(true);
    expect(repo.getOrCreate('g1').modules.creditLoan).toBe(true);
    expect(repo.getOrCreate('g1').modules.rpg).toBe(true);
    expect(repo.getOrCreate('g1').ai.preset).toBe('community');
    expect(repo.getOrCreate('g1').imageGen).toEqual({
      modelOverride: null,
      defaultAspectRatio: '2:3',
      defaultSteps: 28,
      defaultScale: 5.0,
      defaultCfgRescale: 0.3,
      defaultPositivePrompt: DEFAULT_NAI_POSITIVE_PROMPT,
      defaultNegativePrompt: DEFAULT_NAI_NEGATIVE_PROMPT,
      cooldownSec: 15,
      maxConcurrency: 1,
      maxPendingQueue: 6,
      forceSpoiler: false,
      allowedChannelIds: [],
      ignoredChannelIds: [],
    });
    expect(repo.getOrCreate('g1').creditLoan.garnishRate).toBe(0.5);
    expect(repo.getOrCreate('g1').rpg.dailyStamina).toBe(5);
    repo.updateAdminUsers('g1', ['u100', 'u200']);
    expect(repo.getOrCreate('g1').adminUserIds).toEqual(['u100', 'u200']);
    repo.updateImageGen('g1', {
      ...repo.getOrCreate('g1').imageGen,
      defaultSteps: 24,
      forceSpoiler: true,
      allowedChannelIds: ['ch1'],
    });
    expect(repo.getOrCreate('g1').imageGen.defaultSteps).toBe(24);
    expect(repo.getOrCreate('g1').imageGen.forceSpoiler).toBe(true);
    expect(repo.getOrCreate('g1').imageGen.allowedChannelIds).toEqual(['ch1']);

    db.close();
  });

  it('persists image generation records, summarizes usage, and enforces rolling guild retention', () => {
    const db = createDatabase(':memory:');
    const imageRepo = new ImageRepo(db);

    const rec1 = imageRepo.create({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      rawPrompt: '银发少女',
      finalPrompt: 'silver hair girl',
      negativePrompt: 'lowres',
      aspectRatio: '2:3',
      steps: 28,
      scale: 5.0,
      seed: 12345,
      spoiler: false,
      ephemeral: false,
      model: 'nai/nai-diffusion-5-full',
      status: 'ok',
      errorCode: null,
      latencyMs: 18500,
      createdAt: 1_000,
    });
    expect(imageRepo.getById(rec1.id)).toEqual(rec1);

    imageRepo.create({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u2',
      rawPrompt: 'cat',
      finalPrompt: 'cat',
      negativePrompt: '',
      aspectRatio: '1:1',
      steps: 20,
      scale: 5.0,
      seed: null,
      spoiler: true,
      ephemeral: true,
      model: 'nai/nai-diffusion-5-full',
      status: 'error',
      errorCode: 'timeout',
      latencyMs: 90000,
      createdAt: 2_000,
    });

    const summary = imageRepo.getUsageSummary('g1', 500);
    expect(summary).toEqual({
      totalCalls: 2,
      okCalls: 1,
      errorCalls: 1,
      avgLatencyMs: 54250,
    });
    const recent = imageRepo.listRecent('g1', 10);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.id).toBeGreaterThan(recent[1]!.id);

    const userHistory = imageRepo.listByUser('g1', 'u1', 15);
    expect(userHistory).toHaveLength(1);
    expect(userHistory[0]?.id).toBe(rec1.id);
    expect(imageRepo.listByUser('g1', 'u2', 15)).toHaveLength(0);

    expect(imageRepo.getUserPrefs('g1', 'u1')).toMatchObject({
      guildId: 'g1',
      userId: 'u1',
      aspectRatio: null,
      steps: null,
      scale: null,
      batchCount: null,
      negativePrompt: '',
      spoiler: false,
      ephemeral: false,
    });

    const savedPref = imageRepo.upsertUserPrefs('g1', 'u1', {
      aspectRatio: '16:9',
      steps: 40,
      scale: 6.5,
      batchCount: 9,
      negativePrompt: 'lowres, bad hands',
      spoiler: true,
      ephemeral: true,
    });
    expect(savedPref).toMatchObject({
      aspectRatio: '16:9',
      steps: 28,
      scale: 6.5,
      batchCount: 5,
      negativePrompt: 'lowres, bad hands',
      spoiler: true,
      ephemeral: true,
    });
    expect(imageRepo.getUserPrefs('g1', 'u1')).toMatchObject({
      aspectRatio: '16:9',
      steps: 28,
      scale: 6.5,
      batchCount: 5,
      negativePrompt: 'lowres, bad hands',
      spoiler: true,
      ephemeral: true,
    });

    const validBatchPref = imageRepo.upsertUserPrefs('g1', 'u1', { batchCount: 3 });
    expect(validBatchPref.batchCount).toBe(3);

    imageRepo.resetUserPrefs('g1', 'u1');
    expect(imageRepo.getUserPrefs('g1', 'u1')).toMatchObject({
      aspectRatio: null,
      steps: null,
      scale: null,
      batchCount: null,
      negativePrompt: '',
      spoiler: false,
      ephemeral: false,
    });

    // Idempotent migration adds batch_count to legacy image_user_prefs tables
    const legacyImgDb = new Database(':memory:');
    legacyImgDb.exec(`
      CREATE TABLE image_generations (
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
      CREATE TABLE image_user_prefs (
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
    `);
    const migratedRepo = new ImageRepo(legacyImgDb);
    const migratedCols = (
      legacyImgDb.pragma('table_info(image_user_prefs)') as Array<{ name: string }>
    ).map((c) => c.name);
    expect(migratedCols).toContain('batch_count');
    const migratedGenCols = (
      legacyImgDb.pragma('table_info(image_generations)') as Array<{ name: string }>
    ).map((c) => c.name);
    expect(migratedGenCols).toEqual(expect.arrayContaining(['char_captions_json', 'use_coords']));
    const charRec = migratedRepo.create({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      rawPrompt: '2girls, sunset',
      finalPrompt: 'nsfw, 2girls, sunset',
      negativePrompt: 'lowres',
      charCaptions: [
        { char_caption: 'girl, silver hair', uc: 'glasses', centers: [{ x: 0.3, y: 0.5 }] },
        { char_caption: 'girl, black hair', centers: [{ x: 0.7, y: 0.5 }] },
      ],
      useCoords: true,
      aspectRatio: '3:2',
      steps: 28,
      scale: 5.0,
      seed: 888,
      spoiler: false,
      ephemeral: false,
      model: 'nai/nai-diffusion-5-full',
      status: 'ok',
      errorCode: null,
      latencyMs: 5000,
    });
    expect(migratedRepo.getById(charRec.id)).toMatchObject({
      useCoords: true,
      charCaptions: [
        { char_caption: 'girl, silver hair', uc: 'glasses', centers: [{ x: 0.3, y: 0.5 }] },
        { char_caption: 'girl, black hair', centers: [{ x: 0.7, y: 0.5 }] },
      ],
    });
    expect(migratedRepo.upsertUserPrefs('g1', 'u1', { batchCount: 4 }).batchCount).toBe(4);
    legacyImgDb.close();

    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_image_generations_guild_created',
        'idx_image_generations_user_created',
      ]),
    );

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

    for (const newType of [
      'stat_boost',
      'custom_title',
      'pet_xp',
      'mystery_box',
      'credit_boost',
      'rpg_supply',
      'cp_affinity',
    ] as const) {
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
    expect(profCols).toContain('last_credit_boost_date');
    expect(profCols).toContain('credit_boost_daily_count');

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
        'idx_rps_duels_status_exp',
        'idx_rps_duels_status_round',
        'idx_duel_roulettes_status_exp',
        'idx_duel_roulettes_status_turn',
        'idx_nickname_locks_expires',
        'idx_nickname_locks_winner',
        'idx_interaction_logs_created_at',
        'idx_rpg_characters_realm_lb',
        'idx_rpg_trials_status_expires',
        'idx_rpg_trials_guild_user_status',
      ]),
    );

    db.close();
  });

  it('idempotently migrates legacy rpg_characters without losing characters or items and supports rpg_trials CRUD', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE rpg_characters (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        class_key TEXT NOT NULL CHECK (class_key IN ('warrior', 'mage', 'ranger', 'paladin')),
        class_selected INTEGER NOT NULL DEFAULT 0,
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        stamina INTEGER NOT NULL DEFAULT 5,
        last_stamina_date TEXT,
        stamina_buys_today INTEGER NOT NULL DEFAULT 0,
        max_chapter_cleared INTEGER NOT NULL DEFAULT 0,
        total_clears INTEGER NOT NULL DEFAULT 0,
        total_boss_kills INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
      INSERT INTO rpg_characters (
        guild_id, user_id, class_key, class_selected, level, xp, stamina,
        last_stamina_date, stamina_buys_today, max_chapter_cleared, total_clears, total_boss_kills, updated_at
      ) VALUES ('g1', 'legacy-hero', 'mage', 1, 15, 420, 8, '2026-11-25', 1, 6, 12, 12, 50000);
    `);

    initRpgSchema(db);
    initRpgSchema(db);

    const rpgRepo = new RpgRepo(db);
    const char = rpgRepo.getCharacter('g1', 'legacy-hero');
    expect(char).toMatchObject({
      guildId: 'g1',
      userId: 'legacy-hero',
      classKey: 'mage',
      classSelected: true,
      level: 15,
      xp: 420,
      stamina: 8,
      maxChapterCleared: 6,
      lastIdleClaimAt: 0,
      injuredUntil: 0,
      breakthroughPity: 0,
      totalBreakthroughs: 0,
      promoPills: 0,
      guardElixirs: 0,
      pillBuysToday: 0,
      elixirBuysToday: 0,
      trialPillsStaged: 0,
      trialUseGuard: false,
      arcaneDust: 0,
      dustBackfilled: false,
      abyssClearedTier: 0,
      arenaRating: 1000,
      arenaFightsToday: 0,
      arenaRewardDate: null,
      coopTicketsToday: 0,
      updatedAt: 50000,
    });

    const duel = rpgRepo.createDuel({
      guildId: 'g1',
      channelId: 'ch-game',
      challengerId: 'legacy-hero',
      opponentId: null,
      rulesMode: 'equalized',
      betAmount: 5000,
      createdAt: 100_000,
      expiresAt: 700_000,
    });
    expect(duel.status).toBe('pending');
    rpgRepo.bindDuelMessage(duel.id, 'msg-d-1');
    expect(rpgRepo.getPendingDuelForUser('g1', 'legacy-hero')?.messageId).toBe('msg-d-1');
    expect(rpgRepo.listDuePendingDuels(700_000)).toHaveLength(1);

    const raid = rpgRepo.createRaid({
      guildId: 'g1',
      channelId: 'ch-game',
      leaderId: 'legacy-hero',
      tier: 2,
      bossName: '骸骨领主',
      bossMaxHp: 5000,
      createdAt: 100_000,
      expiresAt: 280_000,
    });
    expect(raid.status).toBe('recruiting');
    rpgRepo.bindRaidMessage(raid.id, 'msg-r-1');
    expect(rpgRepo.getRecruitingRaidForLeader('g1', 'legacy-hero')?.messageId).toBe('msg-r-1');
    expect(rpgRepo.listDueRecruitingRaids(280_000)).toHaveLength(1);

    const trial = rpgRepo.createTrial({
      guildId: 'g1',
      channelId: 'ch-game',
      userId: 'legacy-hero',
      fromLevel: 18,
      targetTier: 3,
      pillsUsed: 2,
      usedGuard: true,
      baseChanceBp: 7500,
      createdAt: 100_000,
      expiresAt: 160_000,
    });
    expect(trial.status).toBe('pending');
    expect(trial.usedGuard).toBe(true);
    rpgRepo.bindTrialMessage(trial.id, 'msg-t-1');
    expect(rpgRepo.getPendingTrialForUser('g1', 'legacy-hero')?.messageId).toBe('msg-t-1');
    expect(rpgRepo.listDuePendingTrials(160_000)).toHaveLength(1);

    db.close();
  });
});
