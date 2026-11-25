import type Database from 'better-sqlite3';

export interface MemberProfile {
  guildId: string;
  userId: string;
  xp: number;
  level: number;
  levelOffset: number;
  statValue: number;
  messageCount: number;
  voiceMinutes: number;
  coins: number;
  bankCoins: number;
  dailyStreak: number;
  lastDailyDate: string | null;
  lastBankInterestDate: string | null;
  lastWorkAt: number;
  lastRobAt: number;
  robShieldUntil: number;
  equippedTitle: string | null;
  cardNickname: string | null;
  cardTag: string | null;
  cardBio: string | null;
  cardColor: string | null;
  lastStatBoostDate: string | null;
  statBoostDailyCount: number;
  lastCreditBoostDate: string | null;
  creditBoostDailyCount: number;
  xpBoostMultiplier: number;
  xpBoostExpiresAt: number;
  heatStreak: number;
  lastXpAt: number;
  hourWindowStart: number;
  hourXpEarned: number;
  lastPetWorkAt: number;
  petPvpXpDate: string;
  petPvpXpDaily: number;
}

export interface LevelRoleReward {
  guildId: string;
  level: number;
  roleId: string;
}

interface MemberProfileRow {
  guild_id: string;
  user_id: string;
  xp: number;
  level: number;
  level_offset?: number;
  stat_value?: number;
  message_count: number;
  voice_minutes: number;
  coins: number;
  bank_coins: number;
  daily_streak: number;
  last_daily_date: string | null;
  last_bank_interest_date: string | null;
  last_work_at: number;
  last_rob_at: number;
  rob_shield_until: number;
  equipped_title: string | null;
  card_nickname: string | null;
  card_tag: string | null;
  card_bio: string | null;
  card_color: string | null;
  last_stat_boost_date?: string | null;
  stat_boost_daily_count?: number;
  last_credit_boost_date?: string | null;
  credit_boost_daily_count?: number;
  xp_boost_multiplier: number;
  xp_boost_expires_at: number;
  heat_streak: number;
  last_xp_at: number;
  hour_window_start: number;
  hour_xp_earned: number;
  last_pet_work_at?: number;
  pet_pvp_xp_date?: string;
  pet_pvp_xp_daily?: number;
}

interface LevelRoleRewardRow {
  guild_id: string;
  level: number;
  role_id: string;
}

function mapProfile(row: MemberProfileRow): MemberProfile {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    xp: row.xp,
    level: row.level,
    levelOffset: row.level_offset ?? 0,
    statValue: row.stat_value ?? 0,
    messageCount: row.message_count,
    voiceMinutes: row.voice_minutes,
    coins: row.coins,
    bankCoins: row.bank_coins,
    dailyStreak: row.daily_streak,
    lastDailyDate: row.last_daily_date,
    lastBankInterestDate: row.last_bank_interest_date,
    lastWorkAt: row.last_work_at,
    lastRobAt: row.last_rob_at,
    robShieldUntil: row.rob_shield_until,
    equippedTitle: row.equipped_title,
    cardNickname: row.card_nickname ?? null,
    cardTag: row.card_tag ?? null,
    cardBio: row.card_bio ?? null,
    cardColor: row.card_color ?? null,
    lastStatBoostDate: row.last_stat_boost_date ?? null,
    statBoostDailyCount: row.stat_boost_daily_count ?? 0,
    lastCreditBoostDate: row.last_credit_boost_date ?? null,
    creditBoostDailyCount: row.credit_boost_daily_count ?? 0,
    xpBoostMultiplier: row.xp_boost_multiplier,
    xpBoostExpiresAt: row.xp_boost_expires_at,
    heatStreak: row.heat_streak,
    lastXpAt: row.last_xp_at,
    hourWindowStart: row.hour_window_start,
    hourXpEarned: row.hour_xp_earned,
    lastPetWorkAt: row.last_pet_work_at ?? 0,
    petPvpXpDate: row.pet_pvp_xp_date ?? '',
    petPvpXpDaily: row.pet_pvp_xp_daily ?? 0,
  };
}

export class ProfileRepo {
  constructor(private readonly db: Database.Database) {}

  getOrCreate(guildId: string, userId: string): MemberProfile {
    const existing = this.db
      .prepare('SELECT * FROM member_profiles WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as MemberProfileRow | undefined;

    if (existing) {
      return mapProfile(existing);
    }

    this.db
      .prepare('INSERT OR IGNORE INTO member_profiles (guild_id, user_id) VALUES (?, ?)')
      .run(guildId, userId);

    const inserted = this.db
      .prepare('SELECT * FROM member_profiles WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as MemberProfileRow;

    return mapProfile(inserted);
  }

  save(profile: MemberProfile): void {
    this.db
      .prepare(
        `UPDATE member_profiles SET
          xp = ?, level = ?, level_offset = ?, stat_value = ?, message_count = ?, voice_minutes = ?,
          coins = ?, bank_coins = ?, daily_streak = ?, last_daily_date = ?,
          last_bank_interest_date = ?, last_work_at = ?, last_rob_at = ?, rob_shield_until = ?,
          equipped_title = ?, card_nickname = ?, card_tag = ?, card_bio = ?, card_color = ?,
          last_stat_boost_date = ?, stat_boost_daily_count = ?,
          last_credit_boost_date = ?, credit_boost_daily_count = ?,
          xp_boost_multiplier = ?, xp_boost_expires_at = ?,
          heat_streak = ?, last_xp_at = ?, hour_window_start = ?, hour_xp_earned = ?,
          last_pet_work_at = ?, pet_pvp_xp_date = ?, pet_pvp_xp_daily = ?
         WHERE guild_id = ? AND user_id = ?`,
      )
      .run(
        profile.xp,
        profile.level,
        profile.levelOffset,
        profile.statValue,
        profile.messageCount,
        profile.voiceMinutes,
        profile.coins,
        profile.bankCoins,
        profile.dailyStreak,
        profile.lastDailyDate,
        profile.lastBankInterestDate,
        profile.lastWorkAt,
        profile.lastRobAt,
        profile.robShieldUntil,
        profile.equippedTitle,
        profile.cardNickname,
        profile.cardTag,
        profile.cardBio,
        profile.cardColor,
        profile.lastStatBoostDate,
        profile.statBoostDailyCount,
        profile.lastCreditBoostDate,
        profile.creditBoostDailyCount,
        profile.xpBoostMultiplier,
        profile.xpBoostExpiresAt,
        profile.heatStreak,
        profile.lastXpAt,
        profile.hourWindowStart,
        profile.hourXpEarned,
        profile.lastPetWorkAt,
        profile.petPvpXpDate,
        profile.petPvpXpDaily,
        profile.guildId,
        profile.userId,
      );
  }

  updateCard(
    guildId: string,
    userId: string,
    card: {
      cardNickname: string | null;
      cardTag: string | null;
      cardBio: string | null;
      cardColor: string | null;
    },
  ): MemberProfile {
    const profile = this.getOrCreate(guildId, userId);
    this.db
      .prepare(
        `UPDATE member_profiles
         SET card_nickname = ?, card_tag = ?, card_bio = ?, card_color = ?
         WHERE guild_id = ? AND user_id = ?`,
      )
      .run(
        card.cardNickname,
        card.cardTag,
        card.cardBio,
        card.cardColor,
        guildId,
        userId,
      );
    return {
      ...profile,
      cardNickname: card.cardNickname,
      cardTag: card.cardTag,
      cardBio: card.cardBio,
      cardColor: card.cardColor,
    };
  }

  setStatValue(guildId: string, userId: string, value: number): MemberProfile {
    const profile = this.getOrCreate(guildId, userId);
    const nextStat = Math.max(0, Math.floor(value));
    this.db
      .prepare('UPDATE member_profiles SET stat_value = ? WHERE guild_id = ? AND user_id = ?')
      .run(nextStat, guildId, userId);
    return { ...profile, statValue: nextStat };
  }

  addCoins(guildId: string, userId: string, delta: number): MemberProfile {
    const profile = this.getOrCreate(guildId, userId);
    const nextCoins = Math.max(0, profile.coins + delta);
    this.db
      .prepare('UPDATE member_profiles SET coins = ? WHERE guild_id = ? AND user_id = ?')
      .run(nextCoins, guildId, userId);
    return { ...profile, coins: nextCoins };
  }

  getXpRank(guildId: string, userId: string): { rank: number; total: number } {
    const profile = this.getOrCreate(guildId, userId);
    const ahead = this.db
      .prepare(
        'SELECT COUNT(*) AS cnt FROM member_profiles WHERE guild_id = ? AND (level > ? OR (level = ? AND xp > ?))',
      )
      .get(guildId, profile.level, profile.level, profile.xp) as { cnt: number };
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM member_profiles WHERE guild_id = ?')
      .get(guildId) as { cnt: number };
    return { rank: ahead.cnt + 1, total: total.cnt };
  }

  listLeaderboardByXp(
    guildId: string,
    limit: number,
    offset: number,
  ): { items: MemberProfile[]; total: number } {
    const rows = this.db
      .prepare(
        'SELECT * FROM member_profiles WHERE guild_id = ? ORDER BY level DESC, xp DESC, message_count DESC LIMIT ? OFFSET ?',
      )
      .all(guildId, limit, offset) as MemberProfileRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM member_profiles WHERE guild_id = ?')
      .get(guildId) as { cnt: number };
    return { items: rows.map(mapProfile), total: total.cnt };
  }

  listLeaderboardByCoins(
    guildId: string,
    limit: number,
    offset: number,
  ): { items: MemberProfile[]; total: number } {
    const rows = this.db
      .prepare(
        'SELECT * FROM member_profiles WHERE guild_id = ? ORDER BY (coins + bank_coins) DESC, coins DESC, xp DESC LIMIT ? OFFSET ?',
      )
      .all(guildId, limit, offset) as MemberProfileRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM member_profiles WHERE guild_id = ?')
      .get(guildId) as { cnt: number };
    return { items: rows.map(mapProfile), total: total.cnt };
  }

  listLeaderboardByStat(
    guildId: string,
    limit: number,
    offset: number,
  ): { items: MemberProfile[]; total: number } {
    const rows = this.db
      .prepare(
        'SELECT * FROM member_profiles WHERE guild_id = ? ORDER BY stat_value DESC, level DESC, xp DESC LIMIT ? OFFSET ?',
      )
      .all(guildId, limit, offset) as MemberProfileRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM member_profiles WHERE guild_id = ?')
      .get(guildId) as { cnt: number };
    return { items: rows.map(mapProfile), total: total.cnt };
  }

  listRobTargets(guildId: string, excludeUserId: string, limit = 8): MemberProfile[] {
    const safeLimit = Math.max(0, Math.floor(limit));
    const rows = this.db
      .prepare(
        'SELECT * FROM member_profiles WHERE guild_id = ? AND user_id != ? AND coins >= 100 ORDER BY coins DESC LIMIT ?',
      )
      .all(guildId, excludeUserId, safeLimit) as MemberProfileRow[];
    return rows.map(mapProfile);
  }

  listBankRobTargets(guildId: string, excludeUserId: string, limit = 8): MemberProfile[] {
    const safeLimit = Math.max(0, Math.floor(limit));
    const rows = this.db
      .prepare(
        'SELECT * FROM member_profiles WHERE guild_id = ? AND user_id != ? AND bank_coins >= 100 ORDER BY bank_coins DESC, coins DESC LIMIT ?',
      )
      .all(guildId, excludeUserId, safeLimit) as MemberProfileRow[];
    return rows.map(mapProfile);
  }

  setLevelReward(guildId: string, level: number, roleId: string): void {
    this.db
      .prepare(
        `INSERT INTO level_role_rewards (guild_id, level, role_id)
         VALUES (?, ?, ?)
         ON CONFLICT(guild_id, level) DO UPDATE SET role_id = excluded.role_id`,
      )
      .run(guildId, level, roleId);
  }

  removeLevelReward(guildId: string, level: number): boolean {
    const res = this.db
      .prepare('DELETE FROM level_role_rewards WHERE guild_id = ? AND level = ?')
      .run(guildId, level);
    return res.changes > 0;
  }

  listLevelRewards(guildId: string): LevelRoleReward[] {
    const rows = this.db
      .prepare('SELECT * FROM level_role_rewards WHERE guild_id = ? ORDER BY level ASC')
      .all(guildId) as LevelRoleRewardRow[];
    return rows.map((row) => ({
      guildId: row.guild_id,
      level: row.level,
      roleId: row.role_id,
    }));
  }
}
