import type Database from 'better-sqlite3';

export const SOCIAL_PET_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  rel_type TEXT NOT NULL CHECK (rel_type IN ('marriage', 'sworn')),
  affinity INTEGER NOT NULL DEFAULT 0,
  last_checkin_date TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (guild_id, user_a, user_b)
);

CREATE INDEX IF NOT EXISTS idx_relationships_guild_users
  ON relationships (guild_id, user_a, user_b);

CREATE TABLE IF NOT EXISTS relationship_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  proposer_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  rel_type TEXT NOT NULL CHECK (rel_type IN ('marriage', 'sworn')),
  cost INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rel_proposals_due
  ON relationship_proposals (status, expires_at);

CREATE TABLE IF NOT EXISTS user_pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  species_key TEXT NOT NULL,
  nickname TEXT NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('N', 'R', 'SR', 'SSR')),
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL,
  atk INTEGER NOT NULL,
  spd INTEGER NOT NULL,
  crit_rate REAL NOT NULL,
  trait TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  last_feed_date TEXT,
  last_train_at INTEGER NOT NULL DEFAULT 0,
  last_work_at INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_pets_owner
  ON user_pets (guild_id, owner_id, is_active);

CREATE TABLE IF NOT EXISTS pet_battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  challenger_id TEXT NOT NULL,
  challenger_pet_id INTEGER NOT NULL,
  opponent_id TEXT,
  opponent_pet_id INTEGER,
  bet INTEGER NOT NULL CHECK (bet >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'declined', 'expired')),
  winner_id TEXT,
  log_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pet_battles_due
  ON pet_battles (status, expires_at);
`;

export function initSocialPetSchema(db: Database.Database): void {
  db.exec(SOCIAL_PET_SCHEMA_SQL);
}

export type RelationshipType = 'marriage' | 'sworn';
export type ProposalStatus = 'pending' | 'accepted' | 'declined' | 'expired';
export type PetRarity = 'N' | 'R' | 'SR' | 'SSR';
export type PetBattleStatus = 'pending' | 'completed' | 'declined' | 'expired';

export interface Relationship {
  id: number;
  guildId: string;
  userA: string;
  userB: string;
  relType: RelationshipType;
  affinity: number;
  lastCheckinDate: string | null;
  createdAt: number;
}

export interface RelationshipProposal {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  proposerId: string;
  targetId: string;
  relType: RelationshipType;
  cost: number;
  status: ProposalStatus;
  createdAt: number;
  expiresAt: number;
}

export interface UserPet {
  id: number;
  guildId: string;
  ownerId: string;
  speciesKey: string;
  nickname: string;
  rarity: PetRarity;
  level: number;
  xp: number;
  hp: number;
  atk: number;
  spd: number;
  critRate: number;
  trait: string;
  isActive: boolean;
  lastFeedDate: string | null;
  lastTrainAt: number;
  lastWorkAt: number;
  wins: number;
  losses: number;
  createdAt: number;
}

export interface PetBattle {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  challengerId: string;
  challengerPetId: number;
  opponentId: string | null;
  opponentPetId: number | null;
  bet: number;
  status: PetBattleStatus;
  winnerId: string | null;
  logs: string[];
  createdAt: number;
  expiresAt: number;
}

interface RelationshipSqlRow {
  id: number;
  guild_id: string;
  user_a: string;
  user_b: string;
  rel_type: RelationshipType;
  affinity: number;
  last_checkin_date: string | null;
  created_at: number;
}

interface ProposalSqlRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  proposer_id: string;
  target_id: string;
  rel_type: RelationshipType;
  cost: number;
  status: ProposalStatus;
  created_at: number;
  expires_at: number;
}

interface UserPetSqlRow {
  id: number;
  guild_id: string;
  owner_id: string;
  species_key: string;
  nickname: string;
  rarity: PetRarity;
  level: number;
  xp: number;
  hp: number;
  atk: number;
  spd: number;
  crit_rate: number;
  trait: string;
  is_active: number;
  last_feed_date: string | null;
  last_train_at: number;
  last_work_at: number;
  wins: number;
  losses: number;
  created_at: number;
}

interface PetBattleSqlRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  challenger_id: string;
  challenger_pet_id: number;
  opponent_id: string | null;
  opponent_pet_id: number | null;
  bet: number;
  status: PetBattleStatus;
  winner_id: string | null;
  log_json: string;
  created_at: number;
  expires_at: number;
}

function parseStringArray(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === 'string');
}

export function normalizeUserPair(u1: string, u2: string): [string, string] {
  return u1 < u2 ? [u1, u2] : [u2, u1];
}

function mapRelationship(row: RelationshipSqlRow): Relationship {
  return {
    id: row.id,
    guildId: row.guild_id,
    userA: row.user_a,
    userB: row.user_b,
    relType: row.rel_type,
    affinity: row.affinity,
    lastCheckinDate: row.last_checkin_date,
    createdAt: row.created_at,
  };
}

function mapProposal(row: ProposalSqlRow): RelationshipProposal {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    proposerId: row.proposer_id,
    targetId: row.target_id,
    relType: row.rel_type,
    cost: row.cost,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function mapUserPet(row: UserPetSqlRow): UserPet {
  return {
    id: row.id,
    guildId: row.guild_id,
    ownerId: row.owner_id,
    speciesKey: row.species_key,
    nickname: row.nickname,
    rarity: row.rarity,
    level: row.level,
    xp: row.xp,
    hp: row.hp,
    atk: row.atk,
    spd: row.spd,
    critRate: row.crit_rate,
    trait: row.trait,
    isActive: row.is_active === 1,
    lastFeedDate: row.last_feed_date,
    lastTrainAt: row.last_train_at,
    lastWorkAt: row.last_work_at,
    wins: row.wins,
    losses: row.losses,
    createdAt: row.created_at,
  };
}

function mapPetBattle(row: PetBattleSqlRow): PetBattle {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    challengerId: row.challenger_id,
    challengerPetId: row.challenger_pet_id,
    opponentId: row.opponent_id,
    opponentPetId: row.opponent_pet_id,
    bet: row.bet,
    status: row.status,
    winnerId: row.winner_id,
    logs: parseStringArray(row.log_json),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class SocialPetRepo {
  constructor(private readonly db: Database.Database) {}

  // Relationships
  createRelationship(input: {
    guildId: string;
    user1: string;
    user2: string;
    relType: RelationshipType;
    createdAt: number;
  }): Relationship {
    const [userA, userB] = normalizeUserPair(input.user1, input.user2);
    const res = this.db
      .prepare(
        `INSERT INTO relationships (guild_id, user_a, user_b, rel_type, affinity, last_checkin_date, created_at)
         VALUES (?, ?, ?, ?, 10, NULL, ?)`,
      )
      .run(input.guildId, userA, userB, input.relType, input.createdAt);
    const created = this.getRelationshipById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created relationship');
    return created;
  }

  getRelationshipById(id: number): Relationship | null {
    const row = this.db
      .prepare('SELECT * FROM relationships WHERE id = ?')
      .get(id) as RelationshipSqlRow | undefined;
    return row ? mapRelationship(row) : null;
  }

  findRelationshipBetween(guildId: string, user1: string, user2: string): Relationship | null {
    const [userA, userB] = normalizeUserPair(user1, user2);
    const row = this.db
      .prepare('SELECT * FROM relationships WHERE guild_id = ? AND user_a = ? AND user_b = ?')
      .get(guildId, userA, userB) as RelationshipSqlRow | undefined;
    return row ? mapRelationship(row) : null;
  }

  listUserRelationships(guildId: string, userId: string): Relationship[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM relationships WHERE guild_id = ? AND (user_a = ? OR user_b = ?) ORDER BY rel_type ASC, affinity DESC, id ASC',
      )
      .all(guildId, userId, userId) as RelationshipSqlRow[];
    return rows.map(mapRelationship);
  }

  updateRelationshipAffinity(id: number, affinity: number, lastCheckinDate: string): void {
    this.db
      .prepare('UPDATE relationships SET affinity = ?, last_checkin_date = ? WHERE id = ?')
      .run(affinity, lastCheckinDate, id);
  }

  deleteRelationship(id: number): boolean {
    const res = this.db.prepare('DELETE FROM relationships WHERE id = ?').run(id);
    return res.changes > 0;
  }

  listAffinityLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): { items: Relationship[]; total: number } {
    const rows = this.db
      .prepare(
        'SELECT * FROM relationships WHERE guild_id = ? ORDER BY affinity DESC, created_at ASC LIMIT ? OFFSET ?',
      )
      .all(guildId, limit, offset) as RelationshipSqlRow[];
    const total = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM relationships WHERE guild_id = ?')
      .get(guildId) as { cnt: number };
    return { items: rows.map(mapRelationship), total: total.cnt };
  }

  // Proposals
  createProposal(input: {
    guildId: string;
    channelId: string;
    proposerId: string;
    targetId: string;
    relType: RelationshipType;
    cost: number;
    createdAt: number;
    expiresAt: number;
  }): RelationshipProposal {
    const res = this.db
      .prepare(
        `INSERT INTO relationship_proposals (
          guild_id, channel_id, message_id, proposer_id, target_id,
          rel_type, cost, status, created_at, expires_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.proposerId,
        input.targetId,
        input.relType,
        input.cost,
        input.createdAt,
        input.expiresAt,
      );
    const created = this.getProposalById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created proposal');
    return created;
  }

  bindProposalMessageId(proposalId: number, messageId: string): void {
    this.db
      .prepare('UPDATE relationship_proposals SET message_id = ? WHERE id = ?')
      .run(messageId, proposalId);
  }

  getProposalById(proposalId: number): RelationshipProposal | null {
    const row = this.db
      .prepare('SELECT * FROM relationship_proposals WHERE id = ?')
      .get(proposalId) as ProposalSqlRow | undefined;
    return row ? mapProposal(row) : null;
  }

  updateProposalStatus(proposalId: number, status: ProposalStatus): void {
    this.db
      .prepare('UPDATE relationship_proposals SET status = ? WHERE id = ?')
      .run(status, proposalId);
  }

  listDueProposals(nowMs: number): RelationshipProposal[] {
    const rows = this.db
      .prepare("SELECT * FROM relationship_proposals WHERE status = 'pending' AND expires_at <= ?")
      .all(nowMs) as ProposalSqlRow[];
    return rows.map(mapProposal);
  }

  // Pets
  createPet(input: {
    guildId: string;
    ownerId: string;
    speciesKey: string;
    nickname: string;
    rarity: PetRarity;
    hp: number;
    atk: number;
    spd: number;
    critRate: number;
    trait: string;
    isActive: boolean;
    createdAt: number;
  }): UserPet {
    const res = this.db
      .prepare(
        `INSERT INTO user_pets (
          guild_id, owner_id, species_key, nickname, rarity,
          level, xp, hp, atk, spd, crit_rate, trait, is_active,
          last_feed_date, last_train_at, last_work_at, wins, losses, created_at
        ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0, 0, ?)`,
      )
      .run(
        input.guildId,
        input.ownerId,
        input.speciesKey,
        input.nickname,
        input.rarity,
        input.hp,
        input.atk,
        input.spd,
        input.critRate,
        input.trait,
        input.isActive ? 1 : 0,
        input.createdAt,
      );
    const created = this.getPetById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created pet');
    return created;
  }

  getPetById(petId: number): UserPet | null {
    const row = this.db
      .prepare('SELECT * FROM user_pets WHERE id = ?')
      .get(petId) as UserPetSqlRow | undefined;
    return row ? mapUserPet(row) : null;
  }

  listUserPets(guildId: string, ownerId: string): UserPet[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM user_pets WHERE guild_id = ? AND owner_id = ? ORDER BY is_active DESC, level DESC, id ASC',
      )
      .all(guildId, ownerId) as UserPetSqlRow[];
    return rows.map(mapUserPet);
  }

  getActivePet(guildId: string, ownerId: string): UserPet | null {
    const row = this.db
      .prepare(
        'SELECT * FROM user_pets WHERE guild_id = ? AND owner_id = ? AND is_active = 1 LIMIT 1',
      )
      .get(guildId, ownerId) as UserPetSqlRow | undefined;
    if (row) return mapUserPet(row);
    const first = this.db
      .prepare('SELECT * FROM user_pets WHERE guild_id = ? AND owner_id = ? ORDER BY id ASC LIMIT 1')
      .get(guildId, ownerId) as UserPetSqlRow | undefined;
    return first ? mapUserPet(first) : null;
  }

  setActivePet(guildId: string, ownerId: string, petId: number): void {
    this.db
      .prepare('UPDATE user_pets SET is_active = 0 WHERE guild_id = ? AND owner_id = ?')
      .run(guildId, ownerId);
    this.db
      .prepare('UPDATE user_pets SET is_active = 1 WHERE id = ? AND guild_id = ? AND owner_id = ?')
      .run(petId, guildId, ownerId);
  }

  savePet(pet: UserPet): void {
    this.db
      .prepare(
        `UPDATE user_pets SET
          nickname = ?, level = ?, xp = ?, hp = ?, atk = ?, spd = ?,
          crit_rate = ?, is_active = ?, last_feed_date = ?,
          last_train_at = ?, last_work_at = ?, wins = ?, losses = ?
         WHERE id = ?`,
      )
      .run(
        pet.nickname,
        pet.level,
        pet.xp,
        pet.hp,
        pet.atk,
        pet.spd,
        pet.critRate,
        pet.isActive ? 1 : 0,
        pet.lastFeedDate,
        pet.lastTrainAt,
        pet.lastWorkAt,
        pet.wins,
        pet.losses,
        pet.id,
      );
  }

  deletePet(petId: number, guildId: string, ownerId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM user_pets WHERE id = ? AND guild_id = ? AND owner_id = ?')
      .run(petId, guildId, ownerId);
    return res.changes > 0;
  }

  // Pet Battles
  createPetBattle(input: {
    guildId: string;
    channelId: string;
    challengerId: string;
    challengerPetId: number;
    opponentId: string | null;
    bet: number;
    createdAt: number;
    expiresAt: number;
  }): PetBattle {
    const res = this.db
      .prepare(
        `INSERT INTO pet_battles (
          guild_id, channel_id, message_id, challenger_id, challenger_pet_id,
          opponent_id, opponent_pet_id, bet, status, winner_id, log_json, created_at, expires_at
        ) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, 'pending', NULL, '[]', ?, ?)`,
      )
      .run(
        input.guildId,
        input.channelId,
        input.challengerId,
        input.challengerPetId,
        input.opponentId,
        input.bet,
        input.createdAt,
        input.expiresAt,
      );
    const created = this.getPetBattleById(Number(res.lastInsertRowid));
    if (!created) throw new Error('Failed to load created pet battle');
    return created;
  }

  bindPetBattleMessageId(battleId: number, messageId: string): void {
    this.db
      .prepare('UPDATE pet_battles SET message_id = ? WHERE id = ?')
      .run(messageId, battleId);
  }

  getPetBattleById(battleId: number): PetBattle | null {
    const row = this.db
      .prepare('SELECT * FROM pet_battles WHERE id = ?')
      .get(battleId) as PetBattleSqlRow | undefined;
    return row ? mapPetBattle(row) : null;
  }

  savePetBattle(battle: PetBattle): void {
    this.db
      .prepare(
        `UPDATE pet_battles SET
          opponent_id = ?, opponent_pet_id = ?, status = ?, winner_id = ?, log_json = ?
         WHERE id = ?`,
      )
      .run(
        battle.opponentId,
        battle.opponentPetId,
        battle.status,
        battle.winnerId,
        JSON.stringify(battle.logs),
        battle.id,
      );
  }

  listDuePetBattles(nowMs: number): PetBattle[] {
    const rows = this.db
      .prepare("SELECT * FROM pet_battles WHERE status = 'pending' AND expires_at <= ?")
      .all(nowMs) as PetBattleSqlRow[];
    return rows.map(mapPetBattle);
  }
}
