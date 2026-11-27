import type Database from 'better-sqlite3';
import type { GamesConfig } from '../../config/defaults.js';
import type {
  Bounty,
  ChaosRepo,
  NumberBombGame,
  PropKey,
  RouletteGame,
} from '../../db/repositories/chaosRepo.js';
import type { GuildConfigRepo } from '../../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../../db/repositories/profileRepo.js';
import type { CreditLoanService } from '../creditLoanService.js';

export interface ChaosOpsDeps {
  db: Database.Database;
  configRepo: GuildConfigRepo;
  profileRepo: ProfileRepo;
  chaosRepo: ChaosRepo;
  creditLoanService?: CreditLoanService;
}

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
    description: '部署 24h 防盗陷阱，反抓下一位小偷并强制双倍赔款',
    usageMode: 'self',
  },
  lockpick: {
    key: 'lockpick',
    name: '万能撬锁',
    emoji: '🗝️',
    description: '下次口袋打劫 +25%（封顶 85%）/ 抢银行 +10%（封顶 50%）',
    usageMode: 'self',
  },
  shield: {
    key: 'shield',
    name: '防盗保险',
    emoji: '🛡️',
    description: '立即开启或延长 4 小时防盗护盾，免疫偷钱与抢银行',
    usageMode: 'self',
  },
  curse: {
    key: 'curse',
    name: '衰神符',
    emoji: '🧿',
    description: '对指定群友使用（48h 内有效）：使其下次打工收益减半',
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
  | { ok: false; reason: 'no_prop' | 'invalid_prop_mode' | 'already_active' };

export type UseCursePropResult =
  | { ok: true; remainingQuantity: number; targetId: string }
  | { ok: false; reason: 'self_target' | 'no_prop' | 'already_active' };

export type PlaceBountyResult =
  | { ok: true; bounty: Bounty; totalTargetBounty: number; placerBalance: number }
  | { ok: false; reason: 'self_target' | 'below_min' | 'insufficient_funds'; minAmount?: number };

export type ClearBountyResult =
  | { ok: true; clearedAmount: number; cost: number; balance: number }
  | { ok: false; reason: 'no_bounty' | 'insufficient_funds'; cost?: number };

export type CreateRouletteResult =
  | { ok: true; game: RouletteGame; hostBalance: number }
  | {
      ok: false;
      reason: 'invalid_fee' | 'invalid_max_players' | 'insufficient_funds' | 'deadbeat_blocked';
    };

export type JoinRouletteResult =
  | { ok: true; game: RouletteGame; balance: number }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_recruiting'
        | 'expired'
        | 'already_joined'
        | 'room_full'
        | 'insufficient_funds'
        | 'deadbeat_blocked';
    };

export type LeaveRouletteResult =
  | { ok: true; game: RouletteGame; refunded: number; cancelled: boolean }
  | { ok: false; reason: 'not_found' | 'not_recruiting' | 'expired' | 'not_joined' };

export type CancelRouletteResult =
  | { ok: true; game: RouletteGame; refundedPlayers: string[] }
  | { ok: false; reason: 'not_found' | 'not_recruiting' | 'expired' | 'no_permission' };

export type StartRouletteResult =
  | { ok: true; game: RouletteGame }
  | {
      ok: false;
      reason: 'not_found' | 'not_recruiting' | 'expired' | 'no_permission' | 'not_enough_players';
    };

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
  | { ok: false; reason: 'invalid_penalty' | 'insufficient_funds' | 'deadbeat_blocked' };

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
        | 'insufficient_funds'
        | 'deadbeat_blocked';
      minBound?: number;
      maxBound?: number;
      penalty?: number;
    };

export const TRAP_DURATION_MS = 24 * 3600 * 1000;
export const CURSE_DURATION_MS = 48 * 3600 * 1000;
export const SHIELD_DURATION_MS = 4 * 3600 * 1000;
export const ROULETTE_RECRUIT_TTL_MS = 10 * 60 * 1000;
export const ROULETTE_TURN_TTL_MS = 30 * 1000;
export const BOMB_TTL_MS = 15 * 60 * 1000;
