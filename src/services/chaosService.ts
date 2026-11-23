import type Database from 'better-sqlite3';
import type { GamesConfig } from '../config/defaults.js';
import type {
  Bounty,
  BountySummary,
  ChaosRepo,
  NumberBombGame,
  PropKey,
  RouletteGame,
  UserEffect,
  UserPropRowData,
} from '../db/repositories/chaosRepo.js';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';

export interface PropDefinition {
  key: PropKey;
  name: string;
  emoji: string;
  description: string;
  usageMode: 'self' | 'target' | 'target_modal';
}

export const PROP_CATALOG: Readonly<Record<PropKey, PropDefinition>> = {
  trap: {
    key: 'trap',
    name: '捕兽夹',
    emoji: '🪤',
    description: '部署24h防盗陷阱，反抓下一位小偷并强制双倍赔款',
    usageMode: 'self',
  },
  lockpick: {
    key: 'lockpick',
    name: '万能撬锁',
    emoji: '🗝️',
    description: '下次偷钱/打劫成功率 +25%（封顶 85%）',
    usageMode: 'self',
  },
  shield: {
    key: 'shield',
    name: '防盗保险',
    emoji: '🛡️',
    description: '立即开启或延长 4 小时防盗护盾，免疫普通偷钱',
    usageMode: 'self',
  },
  curse: {
    key: 'curse',
    name: '衰神符',
    emoji: '🧿',
    description: '对指定群友使用：使其下次打工收益减半',
    usageMode: 'target',
  },
  nickname: {
    key: 'nickname',
    name: '改昵称卡',
    emoji: '🎭',
    description: '强制修改一名群友服务器昵称（仅对权限允许成员有效）',
    usageMode: 'target_modal',
  },
};

export const PROP_KEYS: readonly PropKey[] = ['trap', 'lockpick', 'shield', 'curse', 'nickname'];

export function getPropPrice(gamesCfg: GamesConfig, propKey: PropKey): number {
  switch (propKey) {
    case 'trap':
      return gamesCfg.propTrapPrice;
    case 'lockpick':
      return gamesCfg.propLockpickPrice;
    case 'shield':
      return gamesCfg.propShieldPrice;
    case 'curse':
      return gamesCfg.propCursePrice;
    case 'nickname':
      return gamesCfg.propNicknamePrice;
  }
}

export type BuyPropResult =
  | { ok: true; prop: PropDefinition; price: number; quantity: number; balance: number }
  | { ok: false; reason: 'insufficient_funds'; price: number };

export type UseSelfPropResult =
  | { ok: true; prop: PropDefinition; remainingQuantity: number; shieldUntil?: number }
  | { ok: false; reason: 'no_prop' | 'invalid_prop_mode' };

export type UseCursePropResult =
  | { ok: true; remainingQuantity: number; targetId: string }
  | { ok: false; reason: 'self_target' | 'no_prop' };

export type PlaceBountyResult =
  | { ok: true; bounty: Bounty; totalTargetBounty: number; placerBalance: number }
  | { ok: false; reason: 'self_target' | 'below_min' | 'insufficient_funds'; minAmount?: number };

export type ClearBountyResult =
  | { ok: true; clearedAmount: number; cost: number; balance: number }
  | { ok: false; reason: 'no_bounty' | 'insufficient_funds'; cost?: number };

export type CreateRouletteResult =
  | { ok: true; game: RouletteGame; hostBalance: number }
  | { ok: false; reason: 'invalid_fee' | 'invalid_max_players' | 'insufficient_funds' };

export type JoinRouletteResult =
  | { ok: true; game: RouletteGame; balance: number }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_recruiting'
        | 'already_joined'
        | 'room_full'
        | 'insufficient_funds';
    };

export type LeaveRouletteResult =
  | { ok: true; game: RouletteGame; refunded: number; cancelled: boolean }
  | { ok: false; reason: 'not_found' | 'not_recruiting' | 'not_joined' };

export type CancelRouletteResult =
  | { ok: true; game: RouletteGame; refundedPlayers: string[] }
  | { ok: false; reason: 'not_found' | 'not_recruiting' | 'no_permission' };

export type StartRouletteResult =
  | { ok: true; game: RouletteGame }
  | { ok: false; reason: 'not_found' | 'not_recruiting' | 'no_permission' | 'not_enough_players' };

export type PullTriggerResult =
  | {
      ok: true;
      game: RouletteGame;
      actorId: string;
      autoTimeout: boolean;
      fired: boolean;
      eliminatedUserId: string | null;
      winnerId: string | null;
      prizePool: number;
    }
  | { ok: false; reason: 'not_found' | 'not_playing' | 'not_your_turn' };

export interface TimedOutRouletteUpdate {
  game: RouletteGame;
  kind: 'recruit_expired' | 'turn_timeout';
  fired?: boolean;
  eliminatedUserId?: string | null;
  winnerId?: string | null;
  prizePool?: number;
}

export type CreateBombResult =
  | { ok: true; game: NumberBombGame }
  | { ok: false; reason: 'invalid_penalty' | 'insufficient_funds' };

export interface BombPayout {
  userId: string;
  amount: number;
}

export type GuessBombResult =
  | {
      ok: true;
      game: NumberBombGame;
      guess: number;
      exploded: boolean;
      penaltyPaid: number;
      payouts: BombPayout[];
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_open'
        | 'expired'
        | 'invalid_guess'
        | 'consecutive_guess'
        | 'insufficient_funds';
      minBound?: number;
      maxBound?: number;
      penalty?: number;
    };

const TRAP_DURATION_MS = 24 * 3600 * 1000;
const CURSE_DURATION_MS = 48 * 3600 * 1000;
const SHIELD_DURATION_MS = 4 * 3600 * 1000;
const ROULETTE_RECRUIT_TTL_MS = 10 * 60 * 1000;
const ROULETTE_TURN_TTL_MS = 30 * 1000;
const BOMB_TTL_MS = 15 * 60 * 1000;

function shufflePlayers(players: readonly string[], rng: () => number): string[] {
  const arr = [...players];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export class ChaosService {
  constructor(
    private readonly db: Database.Database,
    private readonly configRepo: GuildConfigRepo,
    private readonly profileRepo: ProfileRepo,
    private readonly chaosRepo: ChaosRepo,
  ) {}

  listUserProps(guildId: string, userId: string): UserPropRowData[] {
    return this.chaosRepo.listUserProps(guildId, userId);
  }

  getPropQuantity(guildId: string, userId: string, propKey: PropKey): number {
    return this.chaosRepo.getPropQuantity(guildId, userId, propKey);
  }

  hasProp(guildId: string, userId: string, propKey: PropKey): boolean {
    return this.chaosRepo.getPropQuantity(guildId, userId, propKey) > 0;
  }

  consumeProp(guildId: string, userId: string, propKey: PropKey): boolean {
    return this.chaosRepo.consumeProp(guildId, userId, propKey);
  }

  listActiveEffects(guildId: string, userId: string, nowMs = Date.now()): UserEffect[] {
    return this.chaosRepo.listActiveEffects(guildId, userId, nowMs);
  }

  buyProp(guildId: string, userId: string, propKey: PropKey): BuyPropResult {
    const cfg = this.configRepo.getOrCreate(guildId).games;
    const price = Math.max(0, Math.floor(getPropPrice(cfg, propKey)));
    const prop = PROP_CATALOG[propKey];

    return this.db.transaction((): BuyPropResult => {
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < price) {
        return { ok: false, reason: 'insufficient_funds', price };
      }

      const balance = profile.coins - price;
      this.profileRepo.save({ ...profile, coins: balance });
      const quantity = this.chaosRepo.addProp(guildId, userId, propKey, 1);

      return { ok: true, prop, price, quantity, balance };
    })();
  }

  useSelfProp(
    guildId: string,
    userId: string,
    propKey: PropKey,
    nowMs = Date.now(),
  ): UseSelfPropResult {
    const prop = PROP_CATALOG[propKey];
    if (prop.usageMode !== 'self') {
      return { ok: false, reason: 'invalid_prop_mode' };
    }

    return this.db.transaction((): UseSelfPropResult => {
      if (!this.chaosRepo.consumeProp(guildId, userId, propKey)) {
        return { ok: false, reason: 'no_prop' };
      }
      const remainingQuantity = this.chaosRepo.getPropQuantity(guildId, userId, propKey);

      if (propKey === 'trap') {
        this.chaosRepo.setEffect({
          guildId,
          userId,
          effectKey: 'trap_armed',
          charges: 1,
          expiresAt: nowMs + TRAP_DURATION_MS,
          sourceUserId: userId,
          updatedAt: nowMs,
        });
        return { ok: true, prop, remainingQuantity };
      }

      if (propKey === 'lockpick') {
        this.chaosRepo.setEffect({
          guildId,
          userId,
          effectKey: 'lockpick_ready',
          charges: 1,
          expiresAt: 0,
          sourceUserId: userId,
          updatedAt: nowMs,
        });
        return { ok: true, prop, remainingQuantity };
      }

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      const base = Math.max(nowMs, profile.robShieldUntil);
      const shieldUntil = base + SHIELD_DURATION_MS;
      this.profileRepo.save({ ...profile, robShieldUntil: shieldUntil });
      return { ok: true, prop, remainingQuantity, shieldUntil };
    })();
  }

  useCurseProp(
    guildId: string,
    actorId: string,
    targetId: string,
    nowMs = Date.now(),
  ): UseCursePropResult {
    if (actorId === targetId) {
      return { ok: false, reason: 'self_target' };
    }

    return this.db.transaction((): UseCursePropResult => {
      if (!this.chaosRepo.consumeProp(guildId, actorId, 'curse')) {
        return { ok: false, reason: 'no_prop' };
      }
      this.chaosRepo.setEffect({
        guildId,
        userId: targetId,
        effectKey: 'work_cursed',
        charges: 1,
        expiresAt: nowMs + CURSE_DURATION_MS,
        sourceUserId: actorId,
        updatedAt: nowMs,
      });
      const remainingQuantity = this.chaosRepo.getPropQuantity(guildId, actorId, 'curse');
      return { ok: true, remainingQuantity, targetId };
    })();
  }

  // Bounties
  placeBounty(
    guildId: string,
    placerId: string,
    targetId: string,
    amount: number,
    nowMs = Date.now(),
  ): PlaceBountyResult {
    if (placerId === targetId) {
      return { ok: false, reason: 'self_target' };
    }
    const cfg = this.configRepo.getOrCreate(guildId).games;
    const minAmount = Math.max(1, cfg.bountyMinAmount);
    const cleanAmount = Math.floor(amount);
    if (!Number.isFinite(cleanAmount) || cleanAmount < minAmount) {
      return { ok: false, reason: 'below_min', minAmount };
    }

    return this.db.transaction((): PlaceBountyResult => {
      const placer = this.profileRepo.getOrCreate(guildId, placerId);
      if (placer.coins < cleanAmount) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      const placerBalance = placer.coins - cleanAmount;
      this.profileRepo.save({ ...placer, coins: placerBalance });

      const bounty = this.chaosRepo.createBounty({
        guildId,
        targetId,
        placerId,
        amount: cleanAmount,
        createdAt: nowMs,
      });
      const totalTargetBounty = this.chaosRepo.getOpenBountyTotal(guildId, targetId);
      return { ok: true, bounty, totalTargetBounty, placerBalance };
    })();
  }

  clearOwnBounty(guildId: string, userId: string, nowMs = Date.now()): ClearBountyResult {
    const cfg = this.configRepo.getOrCreate(guildId).games;

    return this.db.transaction((): ClearBountyResult => {
      const openTotal = this.chaosRepo.getOpenBountyTotal(guildId, userId);
      if (openTotal <= 0) {
        return { ok: false, reason: 'no_bounty' };
      }
      const cost = Math.max(1, Math.ceil(openTotal * cfg.bountyClearMultiplier));
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cost) {
        return { ok: false, reason: 'insufficient_funds', cost };
      }
      const balance = profile.coins - cost;
      this.profileRepo.save({ ...profile, coins: balance });
      const clearedAmount = this.chaosRepo.clearOpenBounties(guildId, userId, nowMs);
      return { ok: true, clearedAmount, cost, balance };
    })();
  }

  getOpenBountyTotal(guildId: string, targetId: string): number {
    return this.chaosRepo.getOpenBountyTotal(guildId, targetId);
  }

  listActiveBounties(guildId: string, limit = 10): BountySummary[] {
    return this.chaosRepo.listActiveBounties(guildId, limit);
  }

  // Roulette
  createRoulette(input: {
    guildId: string;
    channelId: string;
    hostId: string;
    entryFee: number;
    maxPlayers?: number;
    nowMs?: number;
  }): CreateRouletteResult {
    const entryFee = Math.floor(input.entryFee);
    const maxPlayers = Math.floor(input.maxPlayers ?? 6);
    const nowMs = input.nowMs ?? Date.now();

    if (!Number.isFinite(entryFee) || entryFee < 50 || entryFee > 1_000_000) {
      return { ok: false, reason: 'invalid_fee' };
    }
    if (!Number.isFinite(maxPlayers) || maxPlayers < 2 || maxPlayers > 6) {
      return { ok: false, reason: 'invalid_max_players' };
    }

    return this.db.transaction((): CreateRouletteResult => {
      const host = this.profileRepo.getOrCreate(input.guildId, input.hostId);
      if (host.coins < entryFee) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      const hostBalance = host.coins - entryFee;
      this.profileRepo.save({ ...host, coins: hostBalance });

      const game = this.chaosRepo.createRoulette({
        guildId: input.guildId,
        channelId: input.channelId,
        hostId: input.hostId,
        entryFee,
        maxPlayers,
        createdAt: nowMs,
        turnDeadline: nowMs + ROULETTE_RECRUIT_TTL_MS,
      });

      return { ok: true, game, hostBalance };
    })();
  }

  bindRouletteMessage(gameId: number, messageId: string): void {
    this.chaosRepo.bindRouletteMessageId(gameId, messageId);
  }

  getRoulette(gameId: number): RouletteGame | null {
    return this.chaosRepo.getRouletteById(gameId);
  }

  listActiveRoulettes(guildId: string, limit = 10): RouletteGame[] {
    return this.chaosRepo.listActiveRoulettes(guildId, limit);
  }

  joinRoulette(gameId: number, userId: string, nowMs = Date.now()): JoinRouletteResult {
    return this.db.transaction((): JoinRouletteResult => {
      const game = this.chaosRepo.getRouletteById(gameId);
      if (!game) return { ok: false, reason: 'not_found' };
      if (game.status !== 'recruiting') return { ok: false, reason: 'not_recruiting' };
      if (game.players.includes(userId)) return { ok: false, reason: 'already_joined' };
      if (game.players.length >= game.maxPlayers) return { ok: false, reason: 'room_full' };

      const profile = this.profileRepo.getOrCreate(game.guildId, userId);
      if (profile.coins < game.entryFee) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      const balance = profile.coins - game.entryFee;
      this.profileRepo.save({ ...profile, coins: balance });

      const players = [...game.players, userId];
      const updated: RouletteGame = {
        ...game,
        players,
        alivePlayers: [...players],
        updatedAt: nowMs,
      };
      this.chaosRepo.saveRoulette(updated);

      return { ok: true, game: updated, balance };
    })();
  }

  leaveRoulette(gameId: number, userId: string, nowMs = Date.now()): LeaveRouletteResult {
    return this.db.transaction((): LeaveRouletteResult => {
      const game = this.chaosRepo.getRouletteById(gameId);
      if (!game) return { ok: false, reason: 'not_found' };
      if (game.status !== 'recruiting') return { ok: false, reason: 'not_recruiting' };
      if (!game.players.includes(userId)) return { ok: false, reason: 'not_joined' };

      const remaining = game.players.filter((id) => id !== userId);
      const isHostLeaving = userId === game.hostId || remaining.length === 0;

      if (isHostLeaving) {
        for (const p of game.players) {
          this.profileRepo.addCoins(game.guildId, p, game.entryFee);
        }
        const updated: RouletteGame = {
          ...game,
          status: 'cancelled',
          turnDeadline: 0,
          logs: [...game.logs, `房主 <@${game.hostId}> 解散了本局，已退还全部入场费。`],
          updatedAt: nowMs,
        };
        this.chaosRepo.saveRoulette(updated);
        return { ok: true, game: updated, refunded: game.entryFee, cancelled: true };
      }

      this.profileRepo.addCoins(game.guildId, userId, game.entryFee);
      const updated: RouletteGame = {
        ...game,
        players: remaining,
        alivePlayers: [...remaining],
        updatedAt: nowMs,
      };
      this.chaosRepo.saveRoulette(updated);
      return { ok: true, game: updated, refunded: game.entryFee, cancelled: false };
    })();
  }

  cancelRoulette(
    gameId: number,
    actorId: string,
    isAdmin = false,
    nowMs = Date.now(),
  ): CancelRouletteResult {
    return this.db.transaction((): CancelRouletteResult => {
      const game = this.chaosRepo.getRouletteById(gameId);
      if (!game) return { ok: false, reason: 'not_found' };
      if (game.status !== 'recruiting') return { ok: false, reason: 'not_recruiting' };
      if (actorId !== game.hostId && !isAdmin) return { ok: false, reason: 'no_permission' };

      for (const p of game.players) {
        this.profileRepo.addCoins(game.guildId, p, game.entryFee);
      }
      const updated: RouletteGame = {
        ...game,
        status: 'cancelled',
        turnDeadline: 0,
        logs: [...game.logs, `<@${actorId}> 取消了轮盘招募，全部入场费已原路退回。`],
        updatedAt: nowMs,
      };
      this.chaosRepo.saveRoulette(updated);
      return { ok: true, game: updated, refundedPlayers: game.players };
    })();
  }

  startRoulette(
    gameId: number,
    actorId: string,
    isAdmin = false,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): StartRouletteResult {
    return this.db.transaction((): StartRouletteResult => {
      const game = this.chaosRepo.getRouletteById(gameId);
      if (!game) return { ok: false, reason: 'not_found' };
      if (game.status !== 'recruiting') return { ok: false, reason: 'not_recruiting' };
      if (actorId !== game.hostId && !isAdmin) return { ok: false, reason: 'no_permission' };
      if (game.players.length < 2) return { ok: false, reason: 'not_enough_players' };

      const alivePlayers = shufflePlayers(game.players, rng);
      const bulletPos = Math.min(5, Math.max(0, Math.floor(rng() * 6)));
      const updated: RouletteGame = {
        ...game,
        status: 'playing',
        alivePlayers,
        turnIndex: 0,
        chamberPos: 0,
        bulletPos,
        turnDeadline: nowMs + ROULETTE_TURN_TTL_MS,
        logs: [`🔫 左轮装填完成！顺位首位：<@${alivePlayers[0]}>`],
        updatedAt: nowMs,
      };
      this.chaosRepo.saveRoulette(updated);
      return { ok: true, game: updated };
    })();
  }

  pullTrigger(
    gameId: number,
    actorId: string,
    opts?: { autoTimeout?: boolean; nowMs?: number; rng?: () => number },
  ): PullTriggerResult {
    const nowMs = opts?.nowMs ?? Date.now();
    const rng = opts?.rng ?? Math.random;
    const autoTimeout = opts?.autoTimeout ?? false;

    return this.db.transaction((): PullTriggerResult => {
      const game = this.chaosRepo.getRouletteById(gameId);
      if (!game) return { ok: false, reason: 'not_found' };
      if (game.status !== 'playing' || game.alivePlayers.length === 0) {
        return { ok: false, reason: 'not_playing' };
      }

      const safeIdx = game.turnIndex % game.alivePlayers.length;
      const currentId = game.alivePlayers[safeIdx]!;
      if (!autoTimeout && actorId !== currentId) {
        return { ok: false, reason: 'not_your_turn' };
      }

      const fired = game.chamberPos === game.bulletPos;
      const timeoutTag = autoTimeout ? '⌛ 超时自动代扣！' : '';

      if (fired) {
        const nextAlive = game.alivePlayers.filter((id) => id !== currentId);
        const logEntry = `${timeoutTag}<@${currentId}> 在第 ${game.chamberPos + 1} 枪 💥 **中弹淘汰**！`;
        const nextLogs = [...game.logs, logEntry].slice(-8);

        if (nextAlive.length === 1) {
          const winnerId = nextAlive[0]!;
          const prizePool = game.entryFee * game.players.length;
          this.profileRepo.addCoins(game.guildId, winnerId, prizePool);

          const updated: RouletteGame = {
            ...game,
            status: 'finished',
            alivePlayers: nextAlive,
            turnIndex: 0,
            turnDeadline: 0,
            winnerId,
            logs: [...nextLogs, `🏆 <@${winnerId}> 独活到最后，独吞奖池 **${prizePool}**！`].slice(-8),
            updatedAt: nowMs,
          };
          this.chaosRepo.saveRoulette(updated);

          return {
            ok: true,
            game: updated,
            actorId: currentId,
            autoTimeout,
            fired: true,
            eliminatedUserId: currentId,
            winnerId,
            prizePool,
          };
        }

        const nextTurnIdx = safeIdx % nextAlive.length;
        const nextBullet = Math.min(5, Math.max(0, Math.floor(rng() * 6)));
        const updated: RouletteGame = {
          ...game,
          alivePlayers: nextAlive,
          turnIndex: nextTurnIdx,
          chamberPos: 0,
          bulletPos: nextBullet,
          turnDeadline: nowMs + ROULETTE_TURN_TTL_MS,
          logs: [...nextLogs, `🔄 重新装弹，下一位：<@${nextAlive[nextTurnIdx]}>`].slice(-8),
          updatedAt: nowMs,
        };
        this.chaosRepo.saveRoulette(updated);

        return {
          ok: true,
          game: updated,
          actorId: currentId,
          autoTimeout,
          fired: true,
          eliminatedUserId: currentId,
          winnerId: null,
          prizePool: 0,
        };
      }

      const nextTurnIdx = (safeIdx + 1) % game.alivePlayers.length;
      const logEntry = `${timeoutTag}<@${currentId}> 咔哒…空枪过关 (${game.chamberPos + 1}/6)`;
      const updated: RouletteGame = {
        ...game,
        turnIndex: nextTurnIdx,
        chamberPos: game.chamberPos + 1,
        turnDeadline: nowMs + ROULETTE_TURN_TTL_MS,
        logs: [...game.logs, logEntry].slice(-8),
        updatedAt: nowMs,
      };
      this.chaosRepo.saveRoulette(updated);

      return {
        ok: true,
        game: updated,
        actorId: currentId,
        autoTimeout,
        fired: false,
        eliminatedUserId: null,
        winnerId: null,
        prizePool: 0,
      };
    })();
  }

  processTimedOutRoulettes(
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): TimedOutRouletteUpdate[] {
    const due = this.chaosRepo.listDueRoulettes(nowMs);
    const updates: TimedOutRouletteUpdate[] = [];

    for (const item of due) {
      if (item.status === 'recruiting') {
        const res = this.db.transaction((): TimedOutRouletteUpdate | null => {
          const current = this.chaosRepo.getRouletteById(item.id);
          if (!current || current.status !== 'recruiting' || current.turnDeadline > nowMs) {
            return null;
          }
          for (const p of current.players) {
            this.profileRepo.addCoins(current.guildId, p, current.entryFee);
          }
          const updated: RouletteGame = {
            ...current,
            status: 'cancelled',
            turnDeadline: 0,
            logs: [...current.logs, '⌛ 招募超过 10 分钟未开局，已自动解散并退还入场费。'].slice(-8),
            updatedAt: nowMs,
          };
          this.chaosRepo.saveRoulette(updated);
          return { game: updated, kind: 'recruit_expired' };
        })();
        if (res) updates.push(res);
      } else if (item.status === 'playing' && item.alivePlayers.length > 0) {
        const currentIdx = item.turnIndex % item.alivePlayers.length;
        const targetActor = item.alivePlayers[currentIdx]!;
        const pull = this.pullTrigger(item.id, targetActor, {
          autoTimeout: true,
          nowMs,
          rng,
        });
        if (pull.ok) {
          updates.push({
            game: pull.game,
            kind: 'turn_timeout',
            fired: pull.fired,
            eliminatedUserId: pull.eliminatedUserId,
            winnerId: pull.winnerId,
            prizePool: pull.prizePool,
          });
        }
      }
    }

    return updates;
  }

  // Number Bomb
  createNumberBomb(input: {
    guildId: string;
    channelId: string;
    hostId: string;
    penalty: number;
    nowMs?: number;
    rng?: () => number;
  }): CreateBombResult {
    const penalty = Math.floor(input.penalty);
    const nowMs = input.nowMs ?? Date.now();
    const rng = input.rng ?? Math.random;

    if (!Number.isFinite(penalty) || penalty < 100 || penalty > 500_000) {
      return { ok: false, reason: 'invalid_penalty' };
    }

    const host = this.profileRepo.getOrCreate(input.guildId, input.hostId);
    if (host.coins < penalty) {
      return { ok: false, reason: 'insufficient_funds' };
    }

    const secretNumber = 2 + Math.min(97, Math.max(0, Math.floor(rng() * 98)));
    const game = this.chaosRepo.createNumberBomb({
      guildId: input.guildId,
      channelId: input.channelId,
      hostId: input.hostId,
      penalty,
      minBound: 1,
      maxBound: 100,
      secretNumber,
      createdAt: nowMs,
      expiresAt: nowMs + BOMB_TTL_MS,
    });

    return { ok: true, game };
  }

  bindNumberBombMessage(gameId: number, messageId: string): void {
    this.chaosRepo.bindNumberBombMessageId(gameId, messageId);
  }

  getNumberBomb(gameId: number): NumberBombGame | null {
    return this.chaosRepo.getNumberBombById(gameId);
  }

  listOpenNumberBombs(guildId: string, limit = 10): NumberBombGame[] {
    return this.chaosRepo.listOpenNumberBombs(guildId, limit);
  }

  guessNumberBomb(
    gameId: number,
    userId: string,
    rawGuess: number,
    nowMs = Date.now(),
  ): GuessBombResult {
    const guess = Math.floor(rawGuess);

    return this.db.transaction((): GuessBombResult => {
      const game = this.chaosRepo.getNumberBombById(gameId);
      if (!game) return { ok: false, reason: 'not_found' };
      if (game.status !== 'open') return { ok: false, reason: 'not_open' };
      if (game.expiresAt <= nowMs) {
        this.chaosRepo.saveNumberBomb({ ...game, status: 'cancelled' });
        return { ok: false, reason: 'expired' };
      }

      if (!Number.isFinite(guess) || guess < game.minBound || guess > game.maxBound) {
        return {
          ok: false,
          reason: 'invalid_guess',
          minBound: game.minBound,
          maxBound: game.maxBound,
        };
      }

      if (game.guesses.length > 0 && game.lastGuesserId === userId) {
        return { ok: false, reason: 'consecutive_guess' };
      }

      const player = this.profileRepo.getOrCreate(game.guildId, userId);
      if (player.coins < game.penalty) {
        return { ok: false, reason: 'insufficient_funds', penalty: game.penalty };
      }

      const nextGuesses = [
        ...game.guesses,
        { userId, guess, exploded: guess === game.secretNumber, at: nowMs },
      ].slice(-12);

      if (guess === game.secretNumber) {
        const actualPenalty = Math.min(player.coins, game.penalty);
        this.profileRepo.save({ ...player, coins: player.coins - actualPenalty });

        const recipients = game.participants.filter((id) => id !== userId);
        const payouts: BombPayout[] = [];

        if (recipients.length > 0 && actualPenalty > 0) {
          const base = Math.floor(actualPenalty / recipients.length);
          const rem = actualPenalty % recipients.length;
          recipients.forEach((recipientId, idx) => {
            const share = base + (idx === 0 ? rem : 0);
            if (share > 0) {
              this.profileRepo.addCoins(game.guildId, recipientId, share);
              payouts.push({ userId: recipientId, amount: share });
            }
          });
        } else if (userId !== game.hostId && actualPenalty > 0) {
          this.profileRepo.addCoins(game.guildId, game.hostId, actualPenalty);
          payouts.push({ userId: game.hostId, amount: actualPenalty });
        }

        const updated: NumberBombGame = {
          ...game,
          lastGuesserId: userId,
          guesses: nextGuesses,
          status: 'exploded',
          loserId: userId,
        };
        this.chaosRepo.saveNumberBomb(updated);

        return {
          ok: true,
          game: updated,
          guess,
          exploded: true,
          penaltyPaid: actualPenalty,
          payouts,
        };
      }

      const nextParticipants = game.participants.includes(userId)
        ? game.participants
        : [...game.participants, userId];

      const nextMin = guess < game.secretNumber ? guess + 1 : game.minBound;
      const nextMax = guess > game.secretNumber ? guess - 1 : game.maxBound;

      const updated: NumberBombGame = {
        ...game,
        minBound: nextMin,
        maxBound: nextMax,
        lastGuesserId: userId,
        participants: nextParticipants,
        guesses: nextGuesses,
      };
      this.chaosRepo.saveNumberBomb(updated);

      return {
        ok: true,
        game: updated,
        guess,
        exploded: false,
        penaltyPaid: 0,
        payouts: [],
      };
    })();
  }

  expireDueNumberBombs(nowMs = Date.now()): NumberBombGame[] {
    const due = this.chaosRepo.listDueNumberBombs(nowMs);
    const expired: NumberBombGame[] = [];
    for (const game of due) {
      const updated: NumberBombGame = { ...game, status: 'cancelled' };
      this.chaosRepo.saveNumberBomb(updated);
      expired.push(updated);
    }
    return expired;
  }
}
