import type {
  RpgCharacter,
  RpgItem,
  RpgRaid,
  RpgRaidPayout,
} from '../../db/repositories/rpgRepo.js';
import {
  buildCoopRaidBossCombatant,
  simulateCoopRaidBattle,
  type CoopPartyMemberInput,
  type CoopRaidBattleReport,
} from '../rpgCombatEngine.js';
import {
  buildFallbackGuardianMercenary,
  generateTierItem,
} from './rpgCatalogBossesAndItems.js';
import { RPG_TIERS, RPG_TIER_MAP } from './rpgCatalogClassesAndTiers.js';
import { getRpgRealmInfo } from './rpgPureMath.js';
import {
  clampUnit,
  COOP_RECRUIT_TTL_MS,
  DAILY_COOP_TICKETS,
  MAX_COOP_PARTY_SIZE,
  MIN_COOP_PARTY_SIZE,
  STAGES_PER_TIER,
  type PendingRpgItem,
  type RpgOpsContext,
} from './rpgTypesAndConfig.js';

export type StartCoopRaidResult =
  | { ok: true; raid: RpgRaid; character: RpgCharacter; ticketsRemaining: number }
  | {
      ok: false;
      reason: 'no_class_selected' | 'active_raid_exists' | 'no_coop_tickets';
      dailyLimit?: number;
      raid?: RpgRaid;
    };

export type JoinCoopRaidResult =
  | { ok: true; raid: RpgRaid; character: RpgCharacter }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'already_started_or_closed'
        | 'already_joined'
        | 'party_full'
        | 'no_class_selected';
    };

export type LaunchCoopRaidResult =
  | {
      ok: true;
      raid: RpgRaid;
      report: CoopRaidBattleReport;
      succeeded: boolean;
      payouts: RpgRaidPayout[];
      legendaryDrops: RpgItem[];
      highlights: string[];
    }
  | {
      ok: false;
      reason: 'not_found' | 'already_resolved' | 'not_leader' | 'not_enough_members';
      minMembers?: number;
    };

export function startCoopRaidLobby(
  ctx: RpgOpsContext,
  guildId: string,
  channelId: string,
  leaderId: string,
  nowMs = Date.now(),
): StartCoopRaidResult {
  return ctx.db.transaction((): StartCoopRaidResult => {
    const character = ctx.getOrCreateCharacterInTx(guildId, leaderId, nowMs);
    if (!character.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }

    const existing = ctx.rpgRepo.getRecruitingRaidForLeader(guildId, leaderId);
    if (existing) {
      return { ok: false, reason: 'active_raid_exists', raid: existing };
    }

    if (character.coopTicketsToday >= DAILY_COOP_TICKETS) {
      return {
        ok: false,
        reason: 'no_coop_tickets',
        dailyLimit: DAILY_COOP_TICKETS,
      };
    }

    const updatedChar: RpgCharacter = {
      ...character,
      coopTicketsToday: character.coopTicketsToday + 1,
      updatedAt: nowMs,
    };
    ctx.rpgRepo.saveCharacter(updatedChar);

    const realm = getRpgRealmInfo(updatedChar.level);
    const boss = buildCoopRaidBossCombatant(realm.tier, MIN_COOP_PARTY_SIZE);
    const raid = ctx.rpgRepo.createRaid({
      guildId,
      channelId,
      leaderId,
      tier: realm.tier,
      bossName: realm.tierDef.bossName,
      bossMaxHp: boss.maxHp,
      bossRemainingHp: boss.maxHp,
      members: [leaderId],
      createdAt: nowMs,
      expiresAt: nowMs + COOP_RECRUIT_TTL_MS,
    });

    return {
      ok: true,
      raid,
      character: updatedChar,
      ticketsRemaining: Math.max(0, DAILY_COOP_TICKETS - updatedChar.coopTicketsToday),
    };
  })();
}

export function cancelCoopRaidAndRefund(
  ctx: RpgOpsContext,
  raidId: number,
  nowMs = Date.now(),
): boolean {
  return ctx.db.transaction((): boolean => {
    const raid = ctx.rpgRepo.getRaidById(raidId);
    if (!raid || raid.status !== 'recruiting') {
      return false;
    }
    const leader = ctx.rpgRepo.getCharacter(raid.guildId, raid.leaderId);
    if (leader) {
      ctx.rpgRepo.saveCharacter({
        ...leader,
        coopTicketsToday: Math.max(0, leader.coopTicketsToday - 1),
        updatedAt: nowMs,
      });
    }
    ctx.rpgRepo.saveRaid({
      ...raid,
      status: 'cancelled',
      resultSummary: '公屏集结招募发送失败，已退还今日团本发车券。',
      resolvedAt: nowMs,
    });
    return true;
  })();
}

export function joinCoopRaidLobby(
  ctx: RpgOpsContext,
  raidId: number,
  userId: string,
  nowMs = Date.now(),
): JoinCoopRaidResult {
  return ctx.db.transaction((): JoinCoopRaidResult => {
    const raid = ctx.rpgRepo.getRaidById(raidId);
    if (!raid) {
      return { ok: false, reason: 'not_found' };
    }
    if (raid.status !== 'recruiting' || raid.expiresAt <= nowMs) {
      return { ok: false, reason: 'already_started_or_closed' };
    }
    if (raid.members.includes(userId)) {
      return { ok: false, reason: 'already_joined' };
    }
    if (raid.members.length >= MAX_COOP_PARTY_SIZE) {
      return { ok: false, reason: 'party_full' };
    }

    const character = ctx.getOrCreateCharacterInTx(raid.guildId, userId, nowMs);
    if (!character.classSelected) {
      return { ok: false, reason: 'no_class_selected' };
    }

    const nextMembers = [...raid.members, userId];
    const scaledBoss = buildCoopRaidBossCombatant(raid.tier, nextMembers.length);
    const updatedRaid: RpgRaid = {
      ...raid,
      members: nextMembers,
      bossMaxHp: scaledBoss.maxHp,
      bossRemainingHp: scaledBoss.maxHp,
    };
    ctx.rpgRepo.saveRaid(updatedRaid);

    return { ok: true, raid: updatedRaid, character };
  })();
}

export function launchCoopRaid(
  ctx: RpgOpsContext,
  raidId: number,
  actorIdOrSystem: string | null,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): LaunchCoopRaidResult {
  return ctx.db.transaction((): LaunchCoopRaidResult => {
    const raid = ctx.rpgRepo.getRaidById(raidId);
    if (!raid) {
      return { ok: false, reason: 'not_found' };
    }
    if (raid.status !== 'recruiting') {
      return { ok: false, reason: 'already_resolved' };
    }
    if (actorIdOrSystem !== null) {
      if (actorIdOrSystem !== raid.leaderId) {
        return { ok: false, reason: 'not_leader' };
      }
      if (raid.members.length < MIN_COOP_PARTY_SIZE) {
        return {
          ok: false,
          reason: 'not_enough_members',
          minMembers: MIN_COOP_PARTY_SIZE,
        };
      }
    }

    const party: CoopPartyMemberInput[] = [];
    const humanChars = new Map<string, RpgCharacter>();

    for (const memberId of raid.members) {
      const ch = ctx.getOrCreateCharacterInTx(raid.guildId, memberId, nowMs);
      humanChars.set(memberId, ch);
      const snap = ctx.buildCombatantForCharacter(ch);
      party.push({ ...snap, isMercenary: false });
    }

    const mercIds: string[] = [];
    if (actorIdOrSystem === null && party.length < MIN_COOP_PARTY_SIZE) {
      const lb = ctx.rpgRepo.getLeaderboard(raid.guildId, 12, 0);
      for (const candidate of lb.items) {
        if (party.length >= MIN_COOP_PARTY_SIZE) break;
        if (!candidate.classSelected) continue;
        if (raid.members.includes(candidate.userId) || mercIds.includes(candidate.userId)) {
          continue;
        }
        const mercName = `佣兵·${ctx.resolveHeroDisplayName(raid.guildId, candidate.userId)}`;
        const snap = ctx.buildCombatantForCharacter(candidate, mercName);
        party.push({ ...snap, isMercenary: true });
        mercIds.push(candidate.userId);
      }

      let fallbackIdx = 1;
      while (party.length < MIN_COOP_PARTY_SIZE) {
        const guardian = buildFallbackGuardianMercenary(raid.tier, fallbackIdx);
        party.push(guardian);
        mercIds.push(guardian.id);
        fallbackIdx += 1;
      }
    }

    const report = simulateCoopRaidBattle(party, raid.tier, rng);
    const tierDef = RPG_TIER_MAP.get(raid.tier) ?? RPG_TIERS[0]!;
    const synergyMult = 1 + report.partySynergyBonusPct / 100;
    const payouts: RpgRaidPayout[] = [];
    const allLegendaryDrops: RpgItem[] = [];

    for (const memberStat of report.members) {
      const isLeader = !memberStat.isMercenary && memberStat.userId === raid.leaderId;
      const isMvp = report.mvpUserId === memberStat.userId;

      if (memberStat.isMercenary) {
        const mercSnap = party.find((p) => p.id === memberStat.userId);
        payouts.push({
          userId: memberStat.userId,
          name: memberStat.name,
          classKey: memberStat.classKey,
          level: mercSnap?.level ?? raid.tier * STAGES_PER_TIER,
          isLeader: false,
          isMercenary: true,
          isMvp,
          damageDealt: memberStat.damageDealt,
          damageTaken: memberStat.damageTaken,
          grossCoins: 0,
          garnishedCoins: 0,
          netCoins: 0,
          dustEarned: 0,
          xpEarned: 0,
          itemsDropped: [],
        });
        continue;
      }

      const char =
        humanChars.get(memberStat.userId) ??
        ctx.getOrCreateCharacterInTx(raid.guildId, memberStat.userId, nowMs);
      const snap = party.find((p) => p.id === memberStat.userId);
      const greedMult = 1 + (snap?.affixes.greedBp ?? 0) / 10_000;

      if (isLeader) {
        const xpGain = report.succeeded
          ? Math.max(40, Math.round(tierDef.idleXpPerHour * 1.2 * synergyMult))
          : Math.max(15, Math.round(tierDef.idleXpPerHour * 0.35));
        const coinGain = report.succeeded
          ? Math.round((2500 + tierDef.idleCoinsPerHour * 1.3) * synergyMult * greedMult)
          : Math.round(tierDef.idleCoinsPerHour * 0.4);
        const baseDust = report.succeeded
          ? Math.round((15 + raid.tier * 8) * greedMult) + (isMvp ? 10 : 0)
          : 5 + raid.tier * 2 + (isMvp ? 5 : 0);

        const pendingItems: PendingRpgItem[] = [];
        if (report.succeeded) {
          pendingItems.push(generateTierItem(raid.tier, 'coop', rng, 'rare'));
          if (clampUnit(rng()) < 0.35) {
            pendingItems.push(generateTierItem(raid.tier, 'coop', rng));
          }
        }

        const banked = ctx.bankLootInTx({
          guildId: raid.guildId,
          userId: memberStat.userId,
          character: char,
          xpGain,
          coinGain,
          dustGain: baseDust,
          pendingItems,
          source: `rpg_coop_leader_tier${raid.tier}`,
          nowMs,
        });

        const finalLeader: RpgCharacter = {
          ...banked.updatedCharacter,
          totalClears: banked.updatedCharacter.totalClears + (report.succeeded ? 1 : 0),
          totalBossKills: banked.updatedCharacter.totalBossKills + (report.succeeded ? 1 : 0),
          updatedAt: nowMs,
        };
        ctx.rpgRepo.saveCharacter(finalLeader);
        allLegendaryDrops.push(...banked.legendaryDrops);

        payouts.push({
          userId: memberStat.userId,
          name: memberStat.name,
          classKey: memberStat.classKey,
          level: finalLeader.level,
          isLeader: true,
          isMercenary: false,
          isMvp,
          damageDealt: memberStat.damageDealt,
          damageTaken: memberStat.damageTaken,
          grossCoins: banked.grossCoins,
          garnishedCoins: banked.garnishedCoins,
          netCoins: banked.netCoins,
          dustEarned: banked.dustEarned,
          xpEarned: xpGain,
          itemsDropped: banked.bankedItems.map((it) => ({
            id: it.id,
            name: it.name,
            rarity: it.rarity,
            slot: it.slot,
          })),
        });
      } else {
        // Human joiner assist rewards (unlimited daily assists!)
        const xpGain = report.succeeded
          ? Math.max(20, Math.round(tierDef.idleXpPerHour * 0.4))
          : Math.max(10, Math.round(tierDef.idleXpPerHour * 0.15));
        const coinGain = report.succeeded
          ? Math.round((1200 + tierDef.idleCoinsPerHour * 0.45) * synergyMult * greedMult)
          : Math.round(tierDef.idleCoinsPerHour * 0.2);
        const dustGain = report.succeeded
          ? Math.round((8 + raid.tier * 3) * greedMult) + (isMvp ? 10 : 0)
          : 4 + raid.tier + (isMvp ? 5 : 0);

        const banked = ctx.bankLootInTx({
          guildId: raid.guildId,
          userId: memberStat.userId,
          character: char,
          xpGain,
          coinGain,
          dustGain,
          pendingItems: [],
          source: `rpg_coop_assist_tier${raid.tier}`,
          nowMs,
        });
        ctx.rpgRepo.saveCharacter(banked.updatedCharacter);

        payouts.push({
          userId: memberStat.userId,
          name: memberStat.name,
          classKey: memberStat.classKey,
          level: banked.updatedCharacter.level,
          isLeader: false,
          isMercenary: false,
          isMvp,
          damageDealt: memberStat.damageDealt,
          damageTaken: memberStat.damageTaken,
          grossCoins: banked.grossCoins,
          garnishedCoins: banked.garnishedCoins,
          netCoins: banked.netCoins,
          dustEarned: banked.dustEarned,
          xpEarned: xpGain,
          itemsDropped: [],
        });
      }
    }

    const resultSummary = report.succeeded
      ? `🎉 ${party.length} 人集结小队（羁绊 +${report.partySynergyBonusPct}%）第 ${report.roundsPlayed} 回合讨伐「${raid.bossName}」大获全胜！`
      : `💥 鏖战 ${report.roundsPlayed} 回合未能击破「${raid.bossName}」（剩余生命 ${report.bossRemainingHp}/${report.bossMaxHp}），已发放参战抚恤奖励。`;

    const settledRaid: RpgRaid = {
      ...raid,
      bossMaxHp: report.bossMaxHp,
      bossRemainingHp: report.bossRemainingHp,
      mercIds,
      status: report.succeeded ? 'completed' : 'failed',
      mvpUserId: report.mvpUserId,
      resultSummary,
      highlights: report.highlights,
      payouts,
      resolvedAt: nowMs,
    };
    ctx.rpgRepo.saveRaid(settledRaid);

    return {
      ok: true,
      raid: settledRaid,
      report,
      succeeded: report.succeeded,
      payouts,
      legendaryDrops: allLegendaryDrops,
      highlights: report.highlights,
    };
  })();
}

export function settleDueCoopRaids(
  ctx: RpgOpsContext,
  nowMs = Date.now(),
  rng: () => number = Math.random,
): Array<Extract<LaunchCoopRaidResult, { ok: true }>> {
  const due = ctx.rpgRepo.listDueRecruitingRaids(nowMs);
  const settled: Array<Extract<LaunchCoopRaidResult, { ok: true }>> = [];
  for (const raid of due) {
    const res = launchCoopRaid(ctx, raid.id, null, nowMs, rng);
    if (res.ok) {
      settled.push(res);
    }
  }
  return settled;
}
