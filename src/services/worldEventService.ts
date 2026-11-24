import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type { SocialPetRepo } from '../db/repositories/socialPetRepo.js';
import type {
  Prediction,
  PredictionBet,
  WorldEvent,
  WorldEventParticipant,
  WorldEventRepo,
} from '../db/repositories/worldEventRepo.js';
import type { CreditLoanService } from './creditLoanService.js';

export interface PredictionOptionStat {
  index: number;
  label: string;
  totalAmount: number;
  bettorCount: number;
  oddsText: string;
}

export interface PredictionSummary {
  prediction: Prediction;
  totalPool: number;
  optionStats: PredictionOptionStat[];
  bets: PredictionBet[];
}

export type CreatePredictionResult =
  | { ok: true; summary: PredictionSummary }
  | { ok: false; reason: 'invalid_title' | 'invalid_options' | 'invalid_duration' };

export type PlaceBetResult =
  | { ok: true; summary: PredictionSummary; betAmount: number; balance: number }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_open'
        | 'closed'
        | 'invalid_option'
        | 'invalid_amount'
        | 'insufficient_funds'
        | 'deadbeat_blocked';
    };

export type LockPredictionResult =
  | { ok: true; summary: PredictionSummary }
  | { ok: false; reason: 'not_found' | 'no_permission' | 'invalid_status' };

export interface PredictionPayout {
  userId: string;
  amount: number;
}

export type SettlePredictionResult =
  | {
      ok: true;
      summary: PredictionSummary;
      winningOption: number;
      totalPool: number;
      refundedNoWinner: boolean;
      payouts: PredictionPayout[];
    }
  | { ok: false; reason: 'not_found' | 'no_permission' | 'invalid_status' | 'invalid_option' };

export type CancelPredictionResult =
  | { ok: true; summary: PredictionSummary; refunds: PredictionPayout[] }
  | { ok: false; reason: 'not_found' | 'no_permission' | 'invalid_status' };

export type ClaimChestResult =
  | {
      ok: true;
      event: WorldEvent;
      amount: number;
      balance: number;
      participants: WorldEventParticipant[];
    }
  | { ok: false; reason: 'not_found' | 'not_chest' | 'not_active' | 'expired' | 'already_claimed' };

export type BossAttackMode = 'normal' | 'heavy';

export interface BossRewardEntry {
  userId: string;
  damage: number;
  baseReward: number;
  mvpBonus: number;
  totalReward: number;
}

export type AttackBossResult =
  | {
      ok: true;
      event: WorldEvent;
      damage: number;
      crit: boolean;
      missed: boolean;
      petBonus: number;
      petName: string | null;
      killed: boolean;
      rewards: BossRewardEntry[];
      participants: WorldEventParticipant[];
    }
  | {
      ok: false;
      reason: 'not_found' | 'not_boss' | 'not_active' | 'expired' | 'cooldown';
      retryAfterSec?: number;
    };

export interface ExpiredWorldEventResult {
  event: WorldEvent;
  consolations: Array<{ userId: string; amount: number }>;
  participants: WorldEventParticipant[];
}

const CHEST_TEMPLATES: ReadonlyArray<{ name: string; flavor: string }> = [
  { name: '黄金神秘宝箱', flavor: '天空中突然掉下一只金光闪闪的大宝箱，手快有手慢无！' },
  { name: '海盗沉船财宝箱', flavor: '潮汐带来了一只刻满神秘符号的古代宝箱，快来开箱！' },
  { name: '星界幸运补给箱', flavor: '社区能量爆棚！系统空投了一批星币补给！' },
  { name: '策划遗落的私房钱盒', flavor: '快趁管理员没反应过来，赶紧过来抓一把！' },
];

const BOSS_TEMPLATES: ReadonlyArray<{ name: string; flavor: string }> = [
  { name: '摸鱼大魔王', flavor: '“今天谁也不许按时下班！” — 携带大量摸鱼经费出没中！' },
  { name: '万恶的加班哥布林', flavor: '嘴里念叨着“紧急需求马上改”，快用重击教它做人！' },
  { name: '暴走偷钱巨鼠', flavor: '听说它偷光了三条街的口袋现金，击败它分赃！' },
  { name: '深渊欧皇嫉妒兽', flavor: '专吸十连保底人的怨气而生，击败必爆巨额星币池！' },
  { name: '通宵开黑修罗王', flavor: '“再来最后一把！” — 全群齐心协力拿下首杀和尾刀大奖！' },
  { name: '冰镇肥宅水史莱姆', flavor: 'QQ 弹弹却皮糙肉厚，出战宠物还能额外助战增伤！' },
  { name: '代码 Bug 缝合怪', flavor: '明明本地能跑，一上线就报错！快召唤群友共同镇压！' },
  { name: '发癫土味机械龙', flavor: '带着 24K 纯金爪子降临频道，打出最后一击还能暴击拿尾刀！' },
];

const CHEST_TTL_MS = 5 * 60 * 1000;
const BOSS_TTL_MS = 10 * 60 * 1000;
const NORMAL_ATTACK_COOLDOWN_MS = 12_000;
const HEAVY_ATTACK_COOLDOWN_MS = 25_000;

export class WorldEventService {
  private readonly guildMsgCounts = new Map<string, number>();
  private readonly lastAutoEventAt = new Map<string, number>();

  constructor(
    private readonly db: Database.Database,
    private readonly configRepo: GuildConfigRepo,
    private readonly profileRepo: ProfileRepo,
    private readonly worldEventRepo: WorldEventRepo,
    private readonly socialPetRepo?: SocialPetRepo,
    private readonly creditLoanService?: CreditLoanService,
  ) {}

  // Predictions
  getPredictionSummary(predictionId: number): PredictionSummary | null {
    const prediction = this.worldEventRepo.getPredictionById(predictionId);
    if (!prediction) return null;
    const bets = this.worldEventRepo.listBets(predictionId);
    return this.buildSummary(prediction, bets);
  }

  listPredictions(
    guildId: string,
    statuses: readonly ('open' | 'locked' | 'settled' | 'cancelled')[] = ['open', 'locked'],
    limit = 15,
  ): Prediction[] {
    return this.worldEventRepo.listPredictionsByGuild(guildId, statuses, limit);
  }

  createPrediction(input: {
    guildId: string;
    channelId: string;
    creatorId: string;
    title: string;
    options: string[];
    closeMinutes: number;
    nowMs?: number;
  }): CreatePredictionResult {
    const title = input.title.trim();
    if (title.length === 0 || title.length > 100) {
      return { ok: false, reason: 'invalid_title' };
    }

    const seen = new Set<string>();
    const options: string[] = [];
    for (const rawOpt of input.options) {
      const clean = rawOpt.trim();
      if (clean.length === 0 || clean.length > 40 || seen.has(clean)) continue;
      seen.add(clean);
      options.push(clean);
    }
    if (options.length < 2 || options.length > 4) {
      return { ok: false, reason: 'invalid_options' };
    }

    const closeMinutes = Math.floor(input.closeMinutes);
    if (!Number.isFinite(closeMinutes) || closeMinutes < 1 || closeMinutes > 10_080) {
      return { ok: false, reason: 'invalid_duration' };
    }

    const nowMs = input.nowMs ?? Date.now();
    const prediction = this.worldEventRepo.createPrediction({
      guildId: input.guildId,
      channelId: input.channelId,
      creatorId: input.creatorId,
      title,
      options,
      closesAt: nowMs + closeMinutes * 60_000,
      createdAt: nowMs,
    });

    return { ok: true, summary: this.buildSummary(prediction, []) };
  }

  bindPredictionMessage(predictionId: number, messageId: string): void {
    this.worldEventRepo.bindPredictionMessageId(predictionId, messageId);
  }

  placeBet(input: {
    predictionId: number;
    userId: string;
    optionIndex: number;
    amount: number;
    nowMs?: number;
  }): PlaceBetResult {
    const nowMs = input.nowMs ?? Date.now();
    const cleanAmount = Math.floor(input.amount);
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0 || cleanAmount > 1_000_000) {
      return { ok: false, reason: 'invalid_amount' };
    }

    return this.db.transaction((): PlaceBetResult => {
      const pred = this.worldEventRepo.getPredictionById(input.predictionId);
      if (!pred) return { ok: false, reason: 'not_found' };
      if (pred.status !== 'open') return { ok: false, reason: 'not_open' };
      if (pred.closesAt <= nowMs) {
        this.worldEventRepo.updatePredictionStatus(pred.id, 'locked', null, null);
        return { ok: false, reason: 'closed' };
      }
      if (
        !Number.isInteger(input.optionIndex) ||
        input.optionIndex < 0 ||
        input.optionIndex >= pred.options.length
      ) {
        return { ok: false, reason: 'invalid_option' };
      }
      if (this.creditLoanService?.isDeadbeatBlocked(pred.guildId, input.userId, nowMs).blocked) {
        return { ok: false, reason: 'deadbeat_blocked' };
      }

      const profile = this.profileRepo.getOrCreate(pred.guildId, input.userId);
      if (profile.coins < cleanAmount) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      const balance = profile.coins - cleanAmount;
      this.profileRepo.save({ ...profile, coins: balance });

      this.worldEventRepo.addBet({
        predictionId: pred.id,
        userId: input.userId,
        optionIndex: input.optionIndex,
        amount: cleanAmount,
        createdAt: nowMs,
      });

      const bets = this.worldEventRepo.listBets(pred.id);
      return {
        ok: true,
        summary: this.buildSummary(pred, bets),
        betAmount: cleanAmount,
        balance,
      };
    })();
  }

  lockPrediction(
    predictionId: number,
    actorId: string,
    isAdmin = false,
  ): LockPredictionResult {
    return this.db.transaction((): LockPredictionResult => {
      const pred = this.worldEventRepo.getPredictionById(predictionId);
      if (!pred) return { ok: false, reason: 'not_found' };
      if (actorId !== pred.creatorId && !isAdmin) return { ok: false, reason: 'no_permission' };
      if (pred.status !== 'open') return { ok: false, reason: 'invalid_status' };

      this.worldEventRepo.updatePredictionStatus(pred.id, 'locked', null, null);
      const updated = this.worldEventRepo.getPredictionById(pred.id)!;
      const bets = this.worldEventRepo.listBets(pred.id);
      return { ok: true, summary: this.buildSummary(updated, bets) };
    })();
  }

  settlePrediction(
    predictionId: number,
    actorId: string,
    isAdmin: boolean,
    winningOption: number,
    nowMs = Date.now(),
  ): SettlePredictionResult {
    return this.db.transaction((): SettlePredictionResult => {
      const pred = this.worldEventRepo.getPredictionById(predictionId);
      if (!pred) return { ok: false, reason: 'not_found' };
      if (actorId !== pred.creatorId && !isAdmin) return { ok: false, reason: 'no_permission' };
      if (pred.status !== 'open' && pred.status !== 'locked') {
        return { ok: false, reason: 'invalid_status' };
      }
      if (
        !Number.isInteger(winningOption) ||
        winningOption < 0 ||
        winningOption >= pred.options.length
      ) {
        return { ok: false, reason: 'invalid_option' };
      }

      const bets = this.worldEventRepo.listBets(pred.id);
      let totalPool = 0;
      const stakesAll = new Map<string, number>();
      const winningStakes = new Map<string, number>();
      let winningTotal = 0;

      for (const bet of bets) {
        totalPool += bet.amount;
        stakesAll.set(bet.userId, (stakesAll.get(bet.userId) ?? 0) + bet.amount);
        if (bet.optionIndex === winningOption) {
          winningTotal += bet.amount;
          winningStakes.set(bet.userId, (winningStakes.get(bet.userId) ?? 0) + bet.amount);
        }
      }

      const payouts: PredictionPayout[] = [];
      let refundedNoWinner = false;

      if (totalPool > 0 && winningTotal === 0) {
        refundedNoWinner = true;
        for (const [userId, stake] of stakesAll) {
          this.profileRepo.addCoins(pred.guildId, userId, stake);
          payouts.push({ userId, amount: stake });
        }
      } else if (totalPool > 0 && winningTotal > 0) {
        const sortedWinners = [...winningStakes.entries()].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        );
        let distributed = 0;
        const mutableShares = sortedWinners.map(([userId, stake]) => {
          const share = Math.floor((stake * totalPool) / winningTotal);
          distributed += share;
          return { userId, amount: share };
        });

        let remainder = totalPool - distributed;
        let idx = 0;
        while (remainder > 0 && mutableShares.length > 0) {
          const entry = mutableShares[idx % mutableShares.length]!;
          entry.amount += 1;
          remainder -= 1;
          idx += 1;
        }

        for (const entry of mutableShares) {
          if (entry.amount > 0) {
            this.profileRepo.addCoins(pred.guildId, entry.userId, entry.amount);
            payouts.push(entry);
          }
        }

        if (this.creditLoanService) {
          const payoutMap = new Map<string, number>();
          for (const entry of payouts) {
            payoutMap.set(entry.userId, (payoutMap.get(entry.userId) ?? 0) + entry.amount);
          }
          for (const [userId, stake] of stakesAll) {
            const received = payoutMap.get(userId) ?? 0;
            this.creditLoanService.recordGamblingResult(
              pred.guildId,
              userId,
              stake,
              received - stake,
              nowMs,
            );
          }
        }
      }

      this.worldEventRepo.updatePredictionStatus(pred.id, 'settled', winningOption, nowMs);
      const updated = this.worldEventRepo.getPredictionById(pred.id)!;

      return {
        ok: true,
        summary: this.buildSummary(updated, bets),
        winningOption,
        totalPool,
        refundedNoWinner,
        payouts,
      };
    })();
  }

  cancelPrediction(
    predictionId: number,
    actorId: string,
    isAdmin = false,
    nowMs = Date.now(),
  ): CancelPredictionResult {
    return this.db.transaction((): CancelPredictionResult => {
      const pred = this.worldEventRepo.getPredictionById(predictionId);
      if (!pred) return { ok: false, reason: 'not_found' };
      if (actorId !== pred.creatorId && !isAdmin) return { ok: false, reason: 'no_permission' };
      if (pred.status !== 'open' && pred.status !== 'locked') {
        return { ok: false, reason: 'invalid_status' };
      }

      const bets = this.worldEventRepo.listBets(pred.id);
      const totals = new Map<string, number>();
      for (const bet of bets) {
        totals.set(bet.userId, (totals.get(bet.userId) ?? 0) + bet.amount);
      }
      const refunds: PredictionPayout[] = [];
      for (const [userId, amount] of totals) {
        this.profileRepo.addCoins(pred.guildId, userId, amount);
        refunds.push({ userId, amount });
      }

      this.worldEventRepo.updatePredictionStatus(pred.id, 'cancelled', null, nowMs);
      const updated = this.worldEventRepo.getPredictionById(pred.id)!;
      return { ok: true, summary: this.buildSummary(updated, bets), refunds };
    })();
  }

  autoLockDuePredictions(nowMs = Date.now()): PredictionSummary[] {
    const due = this.worldEventRepo.listDueOpenPredictions(nowMs);
    const locked: PredictionSummary[] = [];
    for (const pred of due) {
      this.worldEventRepo.updatePredictionStatus(pred.id, 'locked', null, null);
      const updated = this.worldEventRepo.getPredictionById(pred.id);
      if (updated) {
        const bets = this.worldEventRepo.listBets(updated.id);
        locked.push(this.buildSummary(updated, bets));
      }
    }
    return locked;
  }

  // World Events (Chest & Boss)
  getActiveWorldEvent(guildId: string): WorldEvent | null {
    return this.worldEventRepo.getActiveWorldEvent(guildId);
  }

  getWorldEventDetail(eventId: number): {
    event: WorldEvent;
    participants: WorldEventParticipant[];
  } | null {
    const event = this.worldEventRepo.getWorldEventById(eventId);
    if (!event) return null;
    const participants = this.worldEventRepo.listParticipants(eventId);
    return { event, participants };
  }

  listRecentWorldEvents(guildId: string, limit = 5): WorldEvent[] {
    return this.worldEventRepo.listRecentWorldEvents(guildId, limit);
  }

  tryAutoSpawnOnMessage(
    guildId: string,
    fallbackChannelId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): WorldEvent | null {
    const cfg = this.configRepo.getOrCreate(guildId);
    if (!cfg.modules.worldEvents || !cfg.games.eventAutoEnabled) {
      return null;
    }

    if (this.worldEventRepo.getActiveWorldEvent(guildId)) {
      return null;
    }

    const lastAt = this.lastAutoEventAt.get(guildId) ?? 0;
    if (lastAt > 0 && nowMs - lastAt < cfg.games.eventCooldownSec * 1000) {
      return null;
    }

    const nextCount = (this.guildMsgCounts.get(guildId) ?? 0) + 1;
    const threshold = Math.max(1, cfg.games.eventMsgThreshold);
    if (nextCount < threshold) {
      this.guildMsgCounts.set(guildId, nextCount);
      return null;
    }

    this.guildMsgCounts.set(guildId, 0);
    this.lastAutoEventAt.set(guildId, nowMs);

    const targetChannelId = cfg.games.eventChannelId ?? fallbackChannelId;
    if (rng() < 0.55) {
      return this.spawnChest(guildId, targetChannelId, nowMs, rng);
    }
    return this.spawnBoss(guildId, targetChannelId, nowMs, rng);
  }

  spawnChest(
    guildId: string,
    channelId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): WorldEvent {
    const cfg = this.configRepo.getOrCreate(guildId).games;
    const tpl =
      CHEST_TEMPLATES[Math.min(CHEST_TEMPLATES.length - 1, Math.floor(rng() * CHEST_TEMPLATES.length))]!;
    const shares = Math.max(1, Math.min(20, cfg.chestShares));
    const min = Math.max(shares, Math.min(cfg.chestRewardMin, cfg.chestRewardMax));
    const max = Math.max(min, Math.max(cfg.chestRewardMin, cfg.chestRewardMax));
    const totalPool = min + Math.floor(rng() * (max - min + 1));

    this.lastAutoEventAt.set(guildId, nowMs);

    return this.worldEventRepo.createWorldEvent({
      guildId,
      channelId,
      eventType: 'chest',
      name: tpl.name,
      flavor: tpl.flavor,
      maxHp: 0,
      currentHp: 0,
      rewardPool: totalPool,
      totalShares: shares,
      remainingShares: shares,
      remainingAmount: totalPool,
      createdAt: nowMs,
      expiresAt: nowMs + CHEST_TTL_MS,
    });
  }

  spawnBoss(
    guildId: string,
    channelId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): WorldEvent {
    const cfg = this.configRepo.getOrCreate(guildId).games;
    const tpl =
      BOSS_TEMPLATES[Math.min(BOSS_TEMPLATES.length - 1, Math.floor(rng() * BOSS_TEMPLATES.length))]!;
    const maxHp = Math.max(100, cfg.bossBaseHp);
    const rewardPool = Math.max(100, cfg.bossRewardPool);

    this.lastAutoEventAt.set(guildId, nowMs);

    return this.worldEventRepo.createWorldEvent({
      guildId,
      channelId,
      eventType: 'boss',
      name: tpl.name,
      flavor: tpl.flavor,
      maxHp,
      currentHp: maxHp,
      rewardPool,
      totalShares: 0,
      remainingShares: 0,
      remainingAmount: 0,
      createdAt: nowMs,
      expiresAt: nowMs + BOSS_TTL_MS,
    });
  }

  bindWorldEventMessage(eventId: number, messageId: string): void {
    this.worldEventRepo.bindWorldEventMessageId(eventId, messageId);
  }

  claimChest(
    eventId: number,
    userId: string,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): ClaimChestResult {
    return this.db.transaction((): ClaimChestResult => {
      const event = this.worldEventRepo.getWorldEventById(eventId);
      if (!event) return { ok: false, reason: 'not_found' };
      if (event.eventType !== 'chest') return { ok: false, reason: 'not_chest' };
      if (event.status !== 'active' || event.remainingShares <= 0) {
        return { ok: false, reason: 'not_active' };
      }
      if (event.expiresAt <= nowMs) {
        this.worldEventRepo.saveWorldEvent({ ...event, status: 'expired' });
        return { ok: false, reason: 'expired' };
      }
      if (this.worldEventRepo.getParticipant(eventId, userId)) {
        return { ok: false, reason: 'already_claimed' };
      }

      let share: number;
      if (event.remainingShares === 1) {
        share = event.remainingAmount;
      } else {
        const maxShare = Math.max(
          1,
          Math.min(
            event.remainingAmount - (event.remainingShares - 1),
            Math.floor((event.remainingAmount / event.remainingShares) * 2),
          ),
        );
        share = 1 + Math.min(maxShare - 1, Math.max(0, Math.floor(rng() * maxShare)));
      }

      const updatedProfile = this.profileRepo.addCoins(event.guildId, userId, share);
      this.worldEventRepo.upsertParticipant({
        eventId,
        userId,
        delta: share,
        hitsDelta: 1,
        actionAt: nowMs,
      });

      const remainingShares = event.remainingShares - 1;
      const remainingAmount = event.remainingAmount - share;
      const updatedEvent: WorldEvent = {
        ...event,
        remainingShares,
        remainingAmount,
        status: remainingShares === 0 ? 'completed' : 'active',
      };
      this.worldEventRepo.saveWorldEvent(updatedEvent);
      const participants = this.worldEventRepo.listParticipants(eventId);

      return {
        ok: true,
        event: updatedEvent,
        amount: share,
        balance: updatedProfile.coins,
        participants,
      };
    })();
  }

  attackBoss(
    eventId: number,
    userId: string,
    mode: BossAttackMode,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): AttackBossResult {
    return this.db.transaction((): AttackBossResult => {
      const event = this.worldEventRepo.getWorldEventById(eventId);
      if (!event) return { ok: false, reason: 'not_found' };
      if (event.eventType !== 'boss') return { ok: false, reason: 'not_boss' };
      if (event.status !== 'active' || event.currentHp <= 0) {
        return { ok: false, reason: 'not_active' };
      }
      if (event.expiresAt <= nowMs) {
        return { ok: false, reason: 'expired' };
      }

      const prev = this.worldEventRepo.getParticipant(eventId, userId);
      const cdMs = mode === 'heavy' ? HEAVY_ATTACK_COOLDOWN_MS : NORMAL_ATTACK_COOLDOWN_MS;
      if (prev && prev.lastActionAt > 0 && nowMs - prev.lastActionAt < cdMs) {
        return {
          ok: false,
          reason: 'cooldown',
          retryAfterSec: Math.ceil((cdMs - (nowMs - prev.lastActionAt)) / 1000),
        };
      }

      const activePet = this.socialPetRepo?.getActivePet(event.guildId, userId) ?? null;
      const petBonus = activePet ? Math.floor(activePet.atk * 0.5) : 0;
      const petName = activePet ? activePet.nickname : null;

      let missed = false;
      let crit = false;
      let rawDamage = 0;

      if (mode === 'heavy') {
        if (rng() < 0.25) {
          missed = true;
        } else {
          const base = 90 + Math.floor(rng() * 66);
          crit = rng() < 0.25;
          rawDamage = Math.floor(base * (crit ? 1.5 : 1)) + petBonus;
        }
      } else {
        const base = 35 + Math.floor(rng() * 31);
        crit = rng() < 0.15;
        rawDamage = Math.floor(base * (crit ? 1.5 : 1)) + petBonus;
      }

      const actualDamage = Math.min(event.currentHp, Math.max(0, rawDamage));
      this.worldEventRepo.upsertParticipant({
        eventId,
        userId,
        delta: actualDamage,
        hitsDelta: 1,
        actionAt: nowMs,
      });

      const nextHp = Math.max(0, event.currentHp - actualDamage);
      const killed = nextHp === 0;

      const updatedEvent: WorldEvent = {
        ...event,
        currentHp: nextHp,
        status: killed ? 'completed' : 'active',
        killerId: killed ? userId : null,
      };
      this.worldEventRepo.saveWorldEvent(updatedEvent);

      const participants = this.worldEventRepo.listParticipants(eventId);
      const rewards: BossRewardEntry[] = [];

      if (killed) {
        const hitters = participants.filter((p) => p.damageOrReward > 0);
        const totalDamage = hitters.reduce((sum, p) => sum + p.damageOrReward, 0);
        const mvpBonusTotal = Math.floor(event.rewardPool * 0.25);

        if (totalDamage > 0) {
          let distributed = 0;
          const entries: BossRewardEntry[] = hitters.map((p) => {
            const baseReward = Math.floor((p.damageOrReward * event.rewardPool) / totalDamage);
            distributed += baseReward;
            const mvpBonus = p.userId === userId ? mvpBonusTotal : 0;
            return {
              userId: p.userId,
              damage: p.damageOrReward,
              baseReward,
              mvpBonus,
              totalReward: baseReward + mvpBonus,
            };
          });

          let remainder = event.rewardPool - distributed;
          let idx = 0;
          while (remainder > 0 && entries.length > 0) {
            const e = entries[idx % entries.length]!;
            e.baseReward += 1;
            e.totalReward += 1;
            remainder -= 1;
            idx += 1;
          }

          for (const entry of entries) {
            if (entry.totalReward > 0) {
              this.profileRepo.addCoins(event.guildId, entry.userId, entry.totalReward);
            }
            rewards.push(entry);
          }
        } else {
          const entry: BossRewardEntry = {
            userId,
            damage: actualDamage,
            baseReward: event.rewardPool,
            mvpBonus: mvpBonusTotal,
            totalReward: event.rewardPool + mvpBonusTotal,
          };
          this.profileRepo.addCoins(event.guildId, userId, entry.totalReward);
          rewards.push(entry);
        }
      }

      return {
        ok: true,
        event: updatedEvent,
        damage: actualDamage,
        crit,
        missed,
        petBonus,
        petName,
        killed,
        rewards,
        participants,
      };
    })();
  }

  expireDueWorldEvents(nowMs = Date.now()): ExpiredWorldEventResult[] {
    const due = this.worldEventRepo.listDueWorldEvents(nowMs);
    const results: ExpiredWorldEventResult[] = [];

    for (const item of due) {
      const res = this.db.transaction((): ExpiredWorldEventResult | null => {
        const current = this.worldEventRepo.getWorldEventById(item.id);
        if (!current || current.status !== 'active') return null;

        const updated: WorldEvent = { ...current, status: 'expired' };
        this.worldEventRepo.saveWorldEvent(updated);
        const participants = this.worldEventRepo.listParticipants(updated.id);
        const consolations: Array<{ userId: string; amount: number }> = [];

        if (updated.eventType === 'boss') {
          for (const p of participants) {
            if (p.damageOrReward <= 0) continue;
            const amount = Math.min(150, Math.max(30, Math.floor(p.damageOrReward * 0.5)));
            this.profileRepo.addCoins(updated.guildId, p.userId, amount);
            consolations.push({ userId: p.userId, amount });
          }
        }

        return { event: updated, consolations, participants };
      })();
      if (res) results.push(res);
    }

    return results;
  }

  private buildSummary(prediction: Prediction, bets: PredictionBet[]): PredictionSummary {
    const amounts = prediction.options.map(() => 0);
    const bettorSets = prediction.options.map(() => new Set<string>());
    let totalPool = 0;

    for (const bet of bets) {
      if (bet.optionIndex >= 0 && bet.optionIndex < prediction.options.length) {
        amounts[bet.optionIndex] = (amounts[bet.optionIndex] ?? 0) + bet.amount;
        bettorSets[bet.optionIndex]!.add(bet.userId);
        totalPool += bet.amount;
      }
    }

    const optionStats: PredictionOptionStat[] = prediction.options.map((label, index) => {
      const totalAmount = amounts[index] ?? 0;
      const bettorCount = bettorSets[index]!.size;
      const oddsText =
        totalAmount > 0 && totalPool > 0
          ? `${(totalPool / totalAmount).toFixed(2)}x`
          : '待开赔率';
      return { index, label, totalAmount, bettorCount, oddsText };
    });

    return { prediction, totalPool, optionStats, bets };
  }
}
