import {
  BOSS_HEAVY_ATTACK_COOLDOWN_MS,
  BOSS_LIGHT_ATTACK_COOLDOWN_MS,
  PET_BOSS_BONUS_CAP,
} from '../../config/economyConstants.js';
import type { WorldEvent } from '../../db/repositories/worldEventRepo.js';
import {
  BOSS_TEMPLATES,
  BOSS_TTL_MS,
  CHEST_TEMPLATES,
  CHEST_TTL_MS,
  RPG_BOSS_HEAVY_BONUS_CAP,
  RPG_BOSS_NORMAL_BONUS_CAP,
  type AttackBossResult,
  type BossAttackMode,
  type BossRewardEntry,
  type ClaimChestResult,
  type ExpiredWorldEventResult,
  type WorldEventOpsDeps,
  type WorldEventRuntimeState,
} from './worldEventTypesAndCatalog.js';

export function spawnChestOp(
  deps: WorldEventOpsDeps,
  state: WorldEventRuntimeState,
  guildId: string,
  channelId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): WorldEvent {
  const cfg = deps.configRepo.getOrCreate(guildId).games;
  const tpl =
    CHEST_TEMPLATES[Math.min(CHEST_TEMPLATES.length - 1, Math.floor(rng() * CHEST_TEMPLATES.length))]!;
  const shares = Math.max(1, Math.min(20, cfg.chestShares));
  const min = Math.max(shares, Math.min(cfg.chestRewardMin, cfg.chestRewardMax));
  const max = Math.max(min, Math.max(cfg.chestRewardMin, cfg.chestRewardMax));
  const totalPool = min + Math.floor(rng() * (max - min + 1));

  state.lastAutoEventAt.set(guildId, nowMs);

  return deps.worldEventRepo.createWorldEvent({
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

export function spawnBossOp(
  deps: WorldEventOpsDeps,
  state: WorldEventRuntimeState,
  guildId: string,
  channelId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): WorldEvent {
  const cfg = deps.configRepo.getOrCreate(guildId).games;
  const tpl =
    BOSS_TEMPLATES[Math.min(BOSS_TEMPLATES.length - 1, Math.floor(rng() * BOSS_TEMPLATES.length))]!;
  const maxHp = Math.max(100, cfg.bossBaseHp);
  const rewardPool = Math.max(100, cfg.bossRewardPool);

  state.lastAutoEventAt.set(guildId, nowMs);

  return deps.worldEventRepo.createWorldEvent({
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

export function tryAutoSpawnOnMessageOp(
  deps: WorldEventOpsDeps,
  state: WorldEventRuntimeState,
  guildId: string,
  fallbackChannelId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): WorldEvent | null {
  const cfg = deps.configRepo.getOrCreate(guildId);
  if (!cfg.modules.worldEvents || !cfg.modules.economy || !cfg.games.eventAutoEnabled) {
    return null;
  }

  // Once bound, messages outside eventChannelId neither count toward threshold nor trigger spawns.
  if (cfg.games.eventChannelId && fallbackChannelId !== cfg.games.eventChannelId) {
    return null;
  }

  if (deps.worldEventRepo.getActiveWorldEvent(guildId)) {
    return null;
  }

  const lastAt = state.lastAutoEventAt.get(guildId) ?? 0;
  if (lastAt > 0 && nowMs - lastAt < cfg.games.eventCooldownSec * 1000) {
    return null;
  }

  const nextCount = (state.guildMsgCounts.get(guildId) ?? 0) + 1;
  const threshold = Math.max(1, cfg.games.eventMsgThreshold);
  if (nextCount < threshold) {
    state.guildMsgCounts.set(guildId, nextCount);
    return null;
  }

  state.guildMsgCounts.set(guildId, 0);
  state.lastAutoEventAt.set(guildId, nowMs);

  const targetChannelId = cfg.games.eventChannelId ?? fallbackChannelId;
  if (rng() < 0.55) {
    return spawnChestOp(deps, state, guildId, targetChannelId, nowMs, rng);
  }
  return spawnBossOp(deps, state, guildId, targetChannelId, nowMs, rng);
}

export function claimChestOp(
  deps: WorldEventOpsDeps,
  eventId: number,
  userId: string,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): ClaimChestResult {
  return deps.db.transaction((): ClaimChestResult => {
    const event = deps.worldEventRepo.getWorldEventById(eventId);
    if (!event) return { ok: false, reason: 'not_found' };
    if (event.eventType !== 'chest') return { ok: false, reason: 'not_chest' };
    if (event.status !== 'active' || event.remainingShares <= 0) {
      return { ok: false, reason: 'not_active' };
    }
    if (event.expiresAt <= nowMs) {
      deps.worldEventRepo.saveWorldEvent({ ...event, status: 'expired' });
      return { ok: false, reason: 'expired' };
    }
    if (deps.worldEventRepo.getParticipant(eventId, userId)) {
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

    const updatedProfile = deps.profileRepo.addCoins(event.guildId, userId, share);
    deps.worldEventRepo.upsertParticipant({
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
    deps.worldEventRepo.saveWorldEvent(updatedEvent);
    const participants = deps.worldEventRepo.listParticipants(eventId);

    return {
      ok: true,
      event: updatedEvent,
      amount: share,
      balance: updatedProfile.coins,
      participants,
    };
  })();
}

export function attackBossOp(
  deps: WorldEventOpsDeps,
  state: WorldEventRuntimeState,
  eventId: number,
  userId: string,
  mode: BossAttackMode,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): AttackBossResult {
  return deps.db.transaction((): AttackBossResult => {
    const event = deps.worldEventRepo.getWorldEventById(eventId);
    if (!event) return { ok: false, reason: 'not_found' };
    if (event.eventType !== 'boss') return { ok: false, reason: 'not_boss' };
    if (event.status !== 'active' || event.currentHp <= 0) {
      return { ok: false, reason: 'not_active' };
    }
    if (event.expiresAt <= nowMs) {
      return { ok: false, reason: 'expired' };
    }

    const prev = deps.worldEventRepo.getParticipant(eventId, userId);
    const cdMs = mode === 'heavy' ? BOSS_HEAVY_ATTACK_COOLDOWN_MS : BOSS_LIGHT_ATTACK_COOLDOWN_MS;
    const nextAllowedAt = prev
      ? prev.nextAttackAt > 0
        ? prev.nextAttackAt
        : prev.lastActionAt > 0
          ? prev.lastActionAt + cdMs
          : 0
      : 0;
    if (nextAllowedAt > 0 && nowMs < nextAllowedAt) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterSec: Math.ceil((nextAllowedAt - nowMs) / 1000),
      };
    }

    const activePet = deps.socialPetRepo?.getActivePet(event.guildId, userId) ?? null;
    const petBonus = activePet
      ? Math.min(PET_BOSS_BONUS_CAP, Math.floor(activePet.atk * 0.5))
      : 0;
    const petName = activePet ? activePet.nickname : null;

    let missed = false;
    let crit = false;
    let rawDamage = 0;
    let rpgBonus = 0;
    let rpgHeroLabel: string | null = null;

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

    if (!missed) {
      const rpgRaw =
        state.rpgBridge?.getBossAttackBonus(event.guildId, userId, mode, nowMs) ?? null;
      if (rpgRaw) {
        const bonusCap =
          mode === 'heavy' ? RPG_BOSS_HEAVY_BONUS_CAP : RPG_BOSS_NORMAL_BONUS_CAP;
        rpgBonus = Number.isFinite(rpgRaw.bonusDamage)
          ? Math.min(bonusCap, Math.max(0, Math.floor(rpgRaw.bonusDamage)))
          : 0;
        if (rpgBonus > 0) {
          const label = [rpgRaw.classEmoji.trim(), rpgRaw.realmLabel.trim()]
            .filter(Boolean)
            .join(' ');
          rpgHeroLabel = label.length > 0 ? label : null;
          rawDamage += rpgBonus;
        }
      }
    }

    const actualDamage = Math.min(event.currentHp, Math.max(0, rawDamage));
    deps.worldEventRepo.upsertParticipant({
      eventId,
      userId,
      delta: actualDamage,
      hitsDelta: 1,
      actionAt: nowMs,
      nextAttackAt: nowMs + cdMs,
    });

    const nextHp = Math.max(0, event.currentHp - actualDamage);
    const killed = nextHp === 0;

    const participants = deps.worldEventRepo.listParticipants(eventId);
    const rewards: BossRewardEntry[] = [];

    if (killed) {
      const hitters = participants.filter((p) => p.damageOrReward > 0);
      const participantIds = hitters.length > 0 ? hitters.map((h) => h.userId) : [userId];
      const dustMap = state.rpgBridge?.awardBossKillDust(
        event.guildId,
        participantIds,
        userId,
        nowMs,
      );
      const totalDamage = hitters.reduce((sum, p) => sum + p.damageOrReward, 0);
      const mvpBonusTotal = Math.floor(event.rewardPool * 0.25);

      if (totalDamage > 0) {
        let distributed = 0;
        const entries: BossRewardEntry[] = hitters.map((p) => {
          const baseReward = Math.floor((p.damageOrReward * event.rewardPool) / totalDamage);
          distributed += baseReward;
          const mvpBonus = p.userId === userId ? mvpBonusTotal : 0;
          const rawDust = dustMap?.get(p.userId) ?? 0;
          const dustAwarded = Number.isFinite(rawDust) ? Math.max(0, Math.floor(rawDust)) : 0;
          return {
            userId: p.userId,
            damage: p.damageOrReward,
            baseReward,
            mvpBonus,
            totalReward: baseReward + mvpBonus,
            dustAwarded,
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
            deps.profileRepo.addCoins(event.guildId, entry.userId, entry.totalReward);
          }
          rewards.push(entry);
        }
      } else {
        const rawDust = dustMap?.get(userId) ?? 0;
        const dustAwarded = Number.isFinite(rawDust) ? Math.max(0, Math.floor(rawDust)) : 0;
        const entry: BossRewardEntry = {
          userId,
          damage: actualDamage,
          baseReward: event.rewardPool,
          mvpBonus: mvpBonusTotal,
          totalReward: event.rewardPool + mvpBonusTotal,
          dustAwarded,
        };
        deps.profileRepo.addCoins(event.guildId, userId, entry.totalReward);
        rewards.push(entry);
      }
    }

    const updatedEvent: WorldEvent = {
      ...event,
      currentHp: nextHp,
      status: killed ? 'completed' : 'active',
      killerId: killed ? userId : null,
      rewardsJson: killed ? JSON.stringify(rewards) : event.rewardsJson,
    };
    deps.worldEventRepo.saveWorldEvent(updatedEvent);

    return {
      ok: true,
      event: updatedEvent,
      damage: actualDamage,
      crit,
      missed,
      petBonus,
      petName,
      rpgBonus,
      rpgHeroLabel,
      killed,
      rewards,
      participants,
    };
  })();
}

export function expireWorldEventIfDueOp(
  deps: WorldEventOpsDeps,
  eventId: number,
  nowMs = Date.now(),
): ExpiredWorldEventResult | null {
  return deps.db.transaction((): ExpiredWorldEventResult | null => {
    const current = deps.worldEventRepo.getWorldEventById(eventId);
    if (!current || current.status !== 'active' || current.expiresAt > nowMs) return null;

    const participants = deps.worldEventRepo.listParticipants(current.id);
    const consolations: Array<{ userId: string; amount: number }> = [];

    if (current.eventType === 'boss') {
      for (const p of participants) {
        if (p.damageOrReward <= 0) continue;
        const amount = Math.min(150, Math.max(30, Math.floor(p.damageOrReward * 0.5)));
        deps.profileRepo.addCoins(current.guildId, p.userId, amount);
        consolations.push({ userId: p.userId, amount });
      }
    }

    const updated: WorldEvent = {
      ...current,
      status: 'expired',
      rewardsJson:
        current.eventType === 'boss' ? JSON.stringify(consolations) : current.rewardsJson,
    };
    deps.worldEventRepo.saveWorldEvent(updated);

    return { event: updated, consolations, participants };
  })();
}

export function expireDueWorldEventsOp(
  deps: WorldEventOpsDeps,
  nowMs = Date.now(),
): ExpiredWorldEventResult[] {
  const due = deps.worldEventRepo.listDueWorldEvents(nowMs);
  const results: ExpiredWorldEventResult[] = [];

  for (const item of due) {
    const res = expireWorldEventIfDueOp(deps, item.id, nowMs);
    if (res) results.push(res);
  }

  return results;
}
