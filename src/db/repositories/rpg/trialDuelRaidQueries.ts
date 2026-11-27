import type Database from 'better-sqlite3';
import { mapDuel, mapRaid, mapTrial } from './mappers.js';
import type {
  CreateRpgDuelInput,
  CreateRpgRaidInput,
  CreateRpgTrialInput,
  RpgDuel,
  RpgDuelSqlRow,
  RpgRaid,
  RpgRaidSqlRow,
  RpgTrial,
  RpgTrialSqlRow,
} from './types.js';

export class RpgTrialDuelRaidQueries {
  constructor(private readonly db: Database.Database) {}

  // Public Breakthrough Trials
  createTrial(input: CreateRpgTrialInput): RpgTrial {
    const res = this.db
      .prepare(
        `INSERT INTO rpg_trials (
          guild_id, channel_id, message_id, user_id, from_level, target_tier,
          pills_used, used_guard, base_chance_bp, supporters_json, saboteurs_json,
          status, result_summary, created_at, expires_at, resolved_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, '[]', '[]', 'pending', '', ?, ?, 0)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.userId,
        input.fromLevel,
        input.targetTier,
        input.pillsUsed,
        input.usedGuard ? 1 : 0,
        input.baseChanceBp,
        input.createdAt,
        input.expiresAt,
      );
    const created = this.getTrialById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created RPG trial');
    return created;
  }

  getTrialById(trialId: number): RpgTrial | null {
    const row = this.db
      .prepare('SELECT * FROM rpg_trials WHERE id = ?')
      .get(trialId) as RpgTrialSqlRow | undefined;
    return row ? mapTrial(row) : null;
  }

  getPendingTrialForUser(guildId: string, userId: string): RpgTrial | null {
    const row = this.db
      .prepare(
        "SELECT * FROM rpg_trials WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get(guildId, userId) as RpgTrialSqlRow | undefined;
    return row ? mapTrial(row) : null;
  }

  bindTrialMessage(trialId: number, messageId: string, channelId?: string): void {
    if (channelId) {
      this.db
        .prepare('UPDATE rpg_trials SET message_id = ?, channel_id = ? WHERE id = ?')
        .run(messageId, channelId, trialId);
      return;
    }
    this.db
      .prepare('UPDATE rpg_trials SET message_id = ? WHERE id = ?')
      .run(messageId, trialId);
  }

  saveTrial(trial: RpgTrial): void {
    this.db
      .prepare(
        `UPDATE rpg_trials SET
          channel_id = ?, message_id = ?, supporters_json = ?, saboteurs_json = ?,
          status = ?, result_summary = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .run(
        trial.channelId,
        trial.messageId,
        JSON.stringify(trial.supporters),
        JSON.stringify(trial.saboteurs),
        trial.status,
        trial.resultSummary,
        trial.resolvedAt,
        trial.id,
      );
  }

  listDuePendingTrials(nowMs: number): RpgTrial[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM rpg_trials WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC, id ASC",
      )
      .all(nowMs) as RpgTrialSqlRow[];
    return rows.map(mapTrial);
  }

  // Public Duels (#游戏聊天)
  createDuel(input: CreateRpgDuelInput): RpgDuel {
    const res = this.db
      .prepare(
        `INSERT INTO rpg_duels (
          guild_id, channel_id, message_id, challenger_id, opponent_id,
          rules_mode, bet_amount, status, winner_id, result_summary,
          highlights_json, created_at, expires_at, resolved_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'pending', NULL, '', '[]', ?, ?, 0)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.challengerId,
        input.opponentId,
        input.rulesMode,
        Math.max(0, Math.floor(input.betAmount)),
        input.createdAt,
        input.expiresAt,
      );
    const created = this.getDuelById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created RPG duel');
    return created;
  }

  getDuelById(duelId: number): RpgDuel | null {
    const row = this.db
      .prepare('SELECT * FROM rpg_duels WHERE id = ?')
      .get(duelId) as RpgDuelSqlRow | undefined;
    return row ? mapDuel(row) : null;
  }

  getPendingDuelForUser(guildId: string, userId: string): RpgDuel | null {
    const row = this.db
      .prepare(
        "SELECT * FROM rpg_duels WHERE guild_id = ? AND challenger_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get(guildId, userId) as RpgDuelSqlRow | undefined;
    return row ? mapDuel(row) : null;
  }

  bindDuelMessage(duelId: number, messageId: string, channelId?: string): void {
    if (channelId) {
      this.db
        .prepare('UPDATE rpg_duels SET message_id = ?, channel_id = ? WHERE id = ?')
        .run(messageId, channelId, duelId);
      return;
    }
    this.db
      .prepare('UPDATE rpg_duels SET message_id = ? WHERE id = ?')
      .run(messageId, duelId);
  }

  saveDuel(duel: RpgDuel): void {
    this.db
      .prepare(
        `UPDATE rpg_duels SET
          channel_id = ?, message_id = ?, opponent_id = ?,
          status = ?, winner_id = ?, result_summary = ?,
          highlights_json = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .run(
        duel.channelId,
        duel.messageId,
        duel.opponentId,
        duel.status,
        duel.winnerId,
        duel.resultSummary,
        JSON.stringify(duel.highlights),
        duel.resolvedAt,
        duel.id,
      );
  }

  listDuePendingDuels(nowMs: number): RpgDuel[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM rpg_duels WHERE status = 'pending' AND expires_at <= ? ORDER BY expires_at ASC, id ASC",
      )
      .all(nowMs) as RpgDuelSqlRow[];
    return rows.map(mapDuel);
  }

  // Co-op Raids (#游戏聊天)
  createRaid(input: CreateRpgRaidInput): RpgRaid {
    const members = input.members ?? [input.leaderId];
    const bossMaxHp = Math.max(0, Math.floor(input.bossMaxHp ?? 0));
    const bossRemainingHp = Math.max(0, Math.floor(input.bossRemainingHp ?? bossMaxHp));
    const res = this.db
      .prepare(
        `INSERT INTO rpg_raids (
          guild_id, channel_id, message_id, leader_id, tier, boss_name,
          boss_max_hp, boss_remaining_hp, members_json, merc_ids_json,
          status, mvp_user_id, result_summary, highlights_json, payouts_json,
          created_at, expires_at, resolved_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, '[]', 'recruiting', NULL, '', '[]', '[]', ?, ?, 0)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.leaderId,
        input.tier,
        input.bossName,
        bossMaxHp,
        bossRemainingHp,
        JSON.stringify(members),
        input.createdAt,
        input.expiresAt,
      );
    const created = this.getRaidById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created RPG raid');
    return created;
  }

  getRaidById(raidId: number): RpgRaid | null {
    const row = this.db
      .prepare('SELECT * FROM rpg_raids WHERE id = ?')
      .get(raidId) as RpgRaidSqlRow | undefined;
    return row ? mapRaid(row) : null;
  }

  getRecruitingRaidForLeader(guildId: string, leaderId: string): RpgRaid | null {
    const row = this.db
      .prepare(
        "SELECT * FROM rpg_raids WHERE guild_id = ? AND leader_id = ? AND status = 'recruiting' ORDER BY id DESC LIMIT 1",
      )
      .get(guildId, leaderId) as RpgRaidSqlRow | undefined;
    return row ? mapRaid(row) : null;
  }

  bindRaidMessage(raidId: number, messageId: string, channelId?: string): void {
    if (channelId) {
      this.db
        .prepare('UPDATE rpg_raids SET message_id = ?, channel_id = ? WHERE id = ?')
        .run(messageId, channelId, raidId);
      return;
    }
    this.db
      .prepare('UPDATE rpg_raids SET message_id = ? WHERE id = ?')
      .run(messageId, raidId);
  }

  saveRaid(raid: RpgRaid): void {
    this.db
      .prepare(
        `UPDATE rpg_raids SET
          channel_id = ?, message_id = ?, boss_max_hp = ?, boss_remaining_hp = ?,
          members_json = ?, merc_ids_json = ?, status = ?, mvp_user_id = ?,
          result_summary = ?, highlights_json = ?, payouts_json = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .run(
        raid.channelId,
        raid.messageId,
        raid.bossMaxHp,
        raid.bossRemainingHp,
        JSON.stringify(raid.members),
        JSON.stringify(raid.mercIds),
        raid.status,
        raid.mvpUserId,
        raid.resultSummary,
        JSON.stringify(raid.highlights),
        JSON.stringify(raid.payouts),
        raid.resolvedAt,
        raid.id,
      );
  }

  listDueRecruitingRaids(nowMs: number): RpgRaid[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM rpg_raids WHERE status = 'recruiting' AND expires_at <= ? ORDER BY expires_at ASC, id ASC",
      )
      .all(nowMs) as RpgRaidSqlRow[];
    return rows.map(mapRaid);
  }
}
