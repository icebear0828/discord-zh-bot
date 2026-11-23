import type Database from 'better-sqlite3';

export interface FortuneRecord {
  guildId: string;
  userId: string;
  dateKey: string;
  luckTier: string;
  goodFor: string;
  avoid: string;
  luckyNumber: number;
  bonusCoins: number;
  createdAt: number;
}

interface FortuneRow {
  guild_id: string;
  user_id: string;
  date_key: string;
  luck_tier: string;
  good_for: string;
  avoid: string;
  lucky_number: number;
  bonus_coins: number;
  created_at: number;
}

function mapFortune(row: FortuneRow): FortuneRecord {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    dateKey: row.date_key,
    luckTier: row.luck_tier,
    goodFor: row.good_for,
    avoid: row.avoid,
    luckyNumber: row.lucky_number,
    bonusCoins: row.bonus_coins,
    createdAt: row.created_at,
  };
}

export class FunRepo {
  constructor(private readonly db: Database.Database) {}

  getFortune(guildId: string, userId: string, dateKey: string): FortuneRecord | null {
    const row = this.db
      .prepare('SELECT * FROM fun_fortunes WHERE guild_id = ? AND user_id = ? AND date_key = ?')
      .get(guildId, userId, dateKey) as FortuneRow | undefined;
    return row ? mapFortune(row) : null;
  }

  saveFortune(record: FortuneRecord): void {
    this.db
      .prepare(
        `INSERT INTO fun_fortunes (
          guild_id, user_id, date_key, luck_tier, good_for, avoid, lucky_number, bonus_coins, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.guildId,
        record.userId,
        record.dateKey,
        record.luckTier,
        record.goodFor,
        record.avoid,
        record.luckyNumber,
        record.bonusCoins,
        record.createdAt,
      );
  }

  incrementInteraction(
    guildId: string,
    actorId: string,
    targetId: string,
    action: string,
  ): number {
    this.db
      .prepare(
        `INSERT INTO fun_interactions (guild_id, actor_id, target_id, action, count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(guild_id, actor_id, target_id, action)
         DO UPDATE SET count = count + 1`,
      )
      .run(guildId, actorId, targetId, action);

    const row = this.db
      .prepare(
        'SELECT count FROM fun_interactions WHERE guild_id = ? AND actor_id = ? AND target_id = ? AND action = ?',
      )
      .get(guildId, actorId, targetId, action) as { count: number };

    return row.count;
  }
}
