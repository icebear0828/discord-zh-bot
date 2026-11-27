import {
  MAX_SOLO_GAMBLE_BET,
  SLOTS_VIP_ICE_JACKPOT_CHANCE,
} from '../../config/economyConstants.js';
import type {
  DiceChoice,
  DiceResult,
  EconomyOpsContext,
  RobTargetHints,
  SlotsResult,
} from './economyTypesAndDates.js';
import { matchesSlotsVipPlayer } from './robAdminPersonas.js';

export const SLOT_SYMBOLS: ReadonlyArray<{ symbol: string; weight: number }> = [
  { symbol: '🍒', weight: 35 },
  { symbol: '🍋', weight: 23 },
  { symbol: '🍇', weight: 15 },
  { symbol: '🔔', weight: 9 },
  { symbol: '💎', weight: 8 },
  { symbol: '7️⃣', weight: 5 },
  { symbol: '🧊', weight: 5 },
];

const TOTAL_SLOT_WEIGHT = SLOT_SYMBOLS.reduce((sum, item) => sum + item.weight, 0);

function pickWeightedSlotSymbol(r: number): string {
  let target = Math.min(0.999999, Math.max(0, r)) * TOTAL_SLOT_WEIGHT;
  for (const item of SLOT_SYMBOLS) {
    if (target < item.weight) {
      return item.symbol;
    }
    target -= item.weight;
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1]!.symbol;
}

export function playDiceOp(
  ctx: EconomyOpsContext,
  guildId: string,
  userId: string,
  bet: number,
  choice: DiceChoice,
  rng: () => number = Math.random,
  nowMs = Date.now(),
): DiceResult {
  const cleanBet = Math.floor(bet);
  if (!Number.isFinite(cleanBet) || cleanBet <= 0) {
    return { ok: false, reason: 'invalid_bet' };
  }
  if (cleanBet > MAX_SOLO_GAMBLE_BET) {
    return { ok: false, reason: 'bet_too_large' };
  }

  return ctx.db.transaction((): DiceResult => {
    if (ctx.creditLoanService?.isDeadbeatBlocked(guildId, userId, nowMs).blocked) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    if (profile.coins < cleanBet) {
      return { ok: false, reason: 'insufficient_funds' };
    }

    const roll = (): number => 1 + Math.min(5, Math.floor(rng() * 6));
    const d1 = roll();
    const d2 = roll();
    const d3 = roll();
    const dice: [number, number, number] = [d1, d2, d3];
    const sum = d1 + d2 + d3;
    const isTriple = d1 === d2 && d2 === d3;

    let won = false;
    let netChange = -cleanBet;

    if (choice === 'triple' && isTriple) {
      won = true;
      netChange = cleanBet * 10;
    } else if (!isTriple && choice === 'big' && sum >= 11) {
      won = true;
      netChange = cleanBet;
    } else if (!isTriple && choice === 'small' && sum <= 10) {
      won = true;
      netChange = cleanBet;
    }

    const balance = profile.coins + netChange;
    ctx.profileRepo.save({ ...profile, coins: balance });
    ctx.creditLoanService?.recordGamblingResult(guildId, userId, cleanBet, netChange, nowMs);

    return { ok: true, dice, sum, isTriple, won, netChange, balance };
  })();
}

export function playSlotsOp(
  ctx: EconomyOpsContext,
  guildId: string,
  userId: string,
  bet: number,
  rng: () => number = Math.random,
  nowMs = Date.now(),
  playerHints?: RobTargetHints,
): SlotsResult {
  const cleanBet = Math.floor(bet);
  if (!Number.isFinite(cleanBet) || cleanBet <= 0) {
    return { ok: false, reason: 'invalid_bet' };
  }
  if (cleanBet > MAX_SOLO_GAMBLE_BET) {
    return { ok: false, reason: 'bet_too_large' };
  }

  return ctx.db.transaction((): SlotsResult => {
    if (ctx.creditLoanService?.isDeadbeatBlocked(guildId, userId, nowMs).blocked) {
      return { ok: false, reason: 'deadbeat_blocked' };
    }
    const profile = ctx.profileRepo.getOrCreate(guildId, userId);
    if (profile.coins < cleanBet) {
      return { ok: false, reason: 'insufficient_funds' };
    }

    const isVip = matchesSlotsVipPlayer(profile, playerHints);
    let reels: [string, string, string];
    let multiplier = 0;

    if (isVip && rng() < SLOTS_VIP_ICE_JACKPOT_CHANCE) {
      reels = ['🧊', '🧊', '🧊'];
      multiplier = 100;
    } else {
      const r1 = pickWeightedSlotSymbol(rng());
      const r2 = pickWeightedSlotSymbol(rng());
      const r3 = pickWeightedSlotSymbol(rng());
      reels = [r1, r2, r3];

      if (r1 === r2 && r2 === r3) {
        if (r1 === '🧊') {
          multiplier = 100;
        } else if (r1 === '7️⃣') {
          multiplier = 15;
        } else if (r1 === '💎') {
          multiplier = 8;
        } else {
          multiplier = 4;
        }
      } else if (r1 === r2 || r2 === r3 || r1 === r3) {
        multiplier = 1.5;
      }
    }

    const payout = Math.floor(cleanBet * multiplier);
    const netChange = payout - cleanBet;
    const balance = profile.coins + netChange;
    ctx.profileRepo.save({ ...profile, coins: balance });
    ctx.creditLoanService?.recordGamblingResult(guildId, userId, cleanBet, netChange, nowMs);

    return { ok: true, reels, multiplier, payout, netChange, balance };
  })();
}
