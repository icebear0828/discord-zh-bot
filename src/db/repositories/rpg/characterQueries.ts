import type Database from 'better-sqlite3';
import { mapCharacter } from './mappers.js';
import type { CreateRpgCharacterInput, RpgCharacter, RpgCharacterSqlRow } from './types.js';

export class RpgCharacterQueries {
  constructor(private readonly db: Database.Database) {}

  getCharacter(guildId: string, userId: string): RpgCharacter | null {
    const row = this.db
      .prepare('SELECT * FROM rpg_characters WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as RpgCharacterSqlRow | undefined;
    return row ? mapCharacter(row) : null;
  }

  createCharacter(input: CreateRpgCharacterInput): RpgCharacter {
    const lastIdleClaimAt = input.lastIdleClaimAt ?? input.updatedAt;
    this.db
      .prepare(
        `INSERT INTO rpg_characters (
          guild_id, user_id, class_key, class_selected, level, xp, stamina,
          last_stamina_date, stamina_buys_today, max_chapter_cleared,
          total_clears, total_boss_kills, last_idle_claim_at,
          injured_until, breakthrough_pity, total_breakthroughs,
          promo_pills, guard_elixirs, pill_buys_today, elixir_buys_today,
          trial_pills_staged, trial_use_guard,
          arcane_dust, dust_backfilled, abyss_cleared_tier,
          arena_rating, arena_fights_today, arena_reward_date, coop_tickets_today,
          updated_at
        ) VALUES (?, ?, ?, ?, 1, 0, ?, ?, 0, 0, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.guildId,
        input.userId,
        input.classKey,
        input.classSelected ? 1 : 0,
        input.stamina,
        input.lastStaminaDate,
        lastIdleClaimAt,
        input.arcaneDust ?? 0,
        input.dustBackfilled ? 1 : 0,
        input.abyssClearedTier ?? 0,
        input.arenaRating ?? 1000,
        input.arenaFightsToday ?? 0,
        input.arenaRewardDate ?? null,
        input.coopTicketsToday ?? 0,
        input.updatedAt,
      );

    const created = this.getCharacter(input.guildId, input.userId);
    if (!created) throw new Error('Failed to load created RPG character');
    return created;
  }

  saveCharacter(character: RpgCharacter): void {
    this.db
      .prepare(
        `UPDATE rpg_characters SET
          class_key = ?, class_selected = ?, level = ?, xp = ?, stamina = ?,
          last_stamina_date = ?, stamina_buys_today = ?, max_chapter_cleared = ?,
          total_clears = ?, total_boss_kills = ?, last_idle_claim_at = ?,
          injured_until = ?, breakthrough_pity = ?, total_breakthroughs = ?,
          promo_pills = ?, guard_elixirs = ?, pill_buys_today = ?, elixir_buys_today = ?,
          trial_pills_staged = ?, trial_use_guard = ?,
          arcane_dust = ?, dust_backfilled = ?, abyss_cleared_tier = ?,
          arena_rating = ?, arena_fights_today = ?, arena_reward_date = ?, coop_tickets_today = ?,
          updated_at = ?
         WHERE guild_id = ? AND user_id = ?`,
      )
      .run(
        character.classKey,
        character.classSelected ? 1 : 0,
        character.level,
        character.xp,
        character.stamina,
        character.lastStaminaDate,
        character.staminaBuysToday,
        character.maxChapterCleared,
        character.totalClears,
        character.totalBossKills,
        character.lastIdleClaimAt,
        character.injuredUntil,
        character.breakthroughPity,
        character.totalBreakthroughs,
        character.promoPills,
        character.guardElixirs,
        character.pillBuysToday,
        character.elixirBuysToday,
        character.trialPillsStaged,
        character.trialUseGuard ? 1 : 0,
        character.arcaneDust,
        character.dustBackfilled ? 1 : 0,
        character.abyssClearedTier,
        character.arenaRating,
        character.arenaFightsToday,
        character.arenaRewardDate,
        character.coopTicketsToday,
        character.updatedAt,
        character.guildId,
        character.userId,
      );
  }

  listUnbackfilledCharacters(): RpgCharacter[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM rpg_characters WHERE class_selected = 1 AND dust_backfilled = 0 ORDER BY guild_id ASC, user_id ASC',
      )
      .all() as RpgCharacterSqlRow[];
    return rows.map(mapCharacter);
  }

  backfillCharacterDust(guildId: string, userId: string, dustToAdd: number): boolean {
    const res = this.db
      .prepare(
        'UPDATE rpg_characters SET arcane_dust = arcane_dust + ?, dust_backfilled = 1 WHERE guild_id = ? AND user_id = ? AND dust_backfilled = 0',
      )
      .run(Math.max(0, Math.floor(dustToAdd)), guildId, userId);
    return res.changes > 0;
  }

  addArcaneDust(guildId: string, userId: string, delta: number): number {
    const clean = Math.max(0, Math.floor(delta));
    if (clean > 0) {
      this.db
        .prepare(
          'UPDATE rpg_characters SET arcane_dust = arcane_dust + ? WHERE guild_id = ? AND user_id = ?',
        )
        .run(clean, guildId, userId);
    }
    const row = this.db
      .prepare('SELECT arcane_dust FROM rpg_characters WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as { arcane_dust: number } | undefined;
    return row?.arcane_dust ?? 0;
  }

  getLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): { items: RpgCharacter[]; total: number } {
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = this.db
      .prepare(
        `SELECT * FROM rpg_characters
         WHERE guild_id = ?
         ORDER BY level DESC, xp DESC, total_breakthroughs DESC, total_boss_kills DESC, updated_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(guildId, safeLimit, safeOffset) as RpgCharacterSqlRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM rpg_characters WHERE guild_id = ?')
      .get(guildId) as { cnt: number };
    return { items: rows.map(mapCharacter), total: total.cnt };
  }

  getArenaLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): { items: RpgCharacter[]; total: number } {
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeOffset = Math.max(0, Math.floor(offset));
    const rows = this.db
      .prepare(
        `SELECT * FROM rpg_characters
         WHERE guild_id = ? AND class_selected = 1
         ORDER BY arena_rating DESC, level DESC, total_boss_kills DESC, updated_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(guildId, safeLimit, safeOffset) as RpgCharacterSqlRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM rpg_characters WHERE guild_id = ? AND class_selected = 1')
      .get(guildId) as { cnt: number };
    return { items: rows.map(mapCharacter), total: total.cnt };
  }

  getArenaRank(guildId: string, userId: string): { rank: number; total: number } | null {
    const actor = this.getCharacter(guildId, userId);
    if (!actor || !actor.classSelected) {
      return null;
    }
    const totalRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM rpg_characters WHERE guild_id = ? AND class_selected = 1')
      .get(guildId) as { cnt: number };
    const higherRow = this.db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM rpg_characters
         WHERE guild_id = ? AND class_selected = 1 AND (
           arena_rating > ?
           OR (arena_rating = ? AND level > ?)
           OR (arena_rating = ? AND level = ? AND total_boss_kills > ?)
           OR (arena_rating = ? AND level = ? AND total_boss_kills = ? AND updated_at < ?)
           OR (arena_rating = ? AND level = ? AND total_boss_kills = ? AND updated_at = ? AND user_id < ?)
         )`,
      )
      .get(
        guildId,
        actor.arenaRating,
        actor.arenaRating,
        actor.level,
        actor.arenaRating,
        actor.level,
        actor.totalBossKills,
        actor.arenaRating,
        actor.level,
        actor.totalBossKills,
        actor.updatedAt,
        actor.arenaRating,
        actor.level,
        actor.totalBossKills,
        actor.updatedAt,
        actor.userId,
      ) as { cnt: number };
    return { rank: higherRow.cnt + 1, total: totalRow.cnt };
  }

  listArenaCandidates(guildId: string, excludeUserId: string, limit = 15): RpgCharacter[] {
    const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));
    const actor = this.getCharacter(guildId, excludeUserId);
    const targetRating = actor?.arenaRating ?? 1000;
    const rows = this.db
      .prepare(
        `SELECT * FROM rpg_characters
         WHERE guild_id = ? AND class_selected = 1 AND user_id != ?
         ORDER BY ABS(arena_rating - ?) ASC, arena_rating DESC, level DESC, updated_at ASC
         LIMIT ?`,
      )
      .all(guildId, excludeUserId, targetRating, safeLimit) as RpgCharacterSqlRow[];
    return rows.map(mapCharacter);
  }
}
