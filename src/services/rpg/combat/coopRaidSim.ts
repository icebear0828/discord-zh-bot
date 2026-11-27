import type { RpgClassKey } from '../../../db/repositories/rpgRepo.js';
import { buildCoopRaidBossCombatant, createUnitState } from './combatSnapshots.js';
import {
  applyPreBattlePassives,
  executeSingleStrike,
  refreshPeriodicTitanShield,
} from './combatStrikeAndPassives.js';
import {
  CLASS_MODELS,
  clampUnit,
  HighlightLogCollector,
  MAX_BATTLE_ROUNDS,
  type BattleUnitState,
  type CoopMemberBattleStat,
  type CoopPartyMemberInput,
  type CoopRaidBattleReport,
} from './combatTypes.js';
import { executeFighterTurn } from './combatUltimates.js';

function getPartyRole(classKey: RpgClassKey): 'frontline' | 'backline' {
  return classKey === 'warrior' || classKey === 'paladin' ? 'frontline' : 'backline';
}

function getAggroWeight(classKey: RpgClassKey): number {
  switch (classKey) {
    case 'paladin':
      return 3.6;
    case 'warrior':
      return 3.2;
    case 'ranger':
      return 1.0;
    case 'mage':
      return 1.0;
  }
}

function getPartySynergyBonusPct(partyCount: number): number {
  if (partyCount >= 4) return 25;
  if (partyCount === 3) return 16;
  if (partyCount === 2) return 8;
  return 0;
}

function pickWeightedTarget(
  livingMembers: readonly BattleUnitState[],
  rng: () => number,
): BattleUnitState {
  let totalWeight = 0;
  for (const m of livingMembers) {
    totalWeight += getAggroWeight(m.classKey);
  }
  let roll = clampUnit(rng()) * totalWeight;
  for (const m of livingMembers) {
    roll -= getAggroWeight(m.classKey);
    if (roll <= 0) {
      return m;
    }
  }
  return livingMembers[livingMembers.length - 1]!;
}

export function simulateCoopRaidBattle(
  party: readonly CoopPartyMemberInput[],
  tier: number,
  rng: () => number = Math.random,
): CoopRaidBattleReport {
  const safeTier = Math.max(1, Math.min(10, Math.floor(tier)));
  const activePartyInputs = party.slice(0, 4);
  const partyCount = activePartyInputs.length;
  const synergyPct = getPartySynergyBonusPct(partyCount);
  const synergyMult = 1 + synergyPct / 100;

  const bossSnapshot = buildCoopRaidBossCombatant(safeTier, Math.max(2, partyCount));
  const boss = createUnitState(bossSnapshot);

  if (partyCount === 0) {
    return {
      succeeded: false,
      tier: safeTier,
      bossName: boss.name,
      bossMaxHp: boss.maxHp,
      bossRemainingHp: boss.maxHp,
      roundsPlayed: 0,
      partySynergyBonusPct: 0,
      mvpUserId: null,
      members: [],
      totalPartyDamage: 0,
      highlights: [
        `🐉 **团本集结**：${boss.name} 盘踞深渊王座。`,
        '⚠️ 队伍无人出战，讨伐未能展开。',
        '🛡️ 请至少集结 2 名勇者后再发起冲锋。',
        `📊 首领生命：${boss.maxHp}/${boss.maxHp}。`,
        '💡 提示：3 分钟招募期满将自动征召公会雇佣兵助战。',
        '🏳️ 本次团本行动已中止。',
      ],
    };
  }

  const members = activePartyInputs.map((member) =>
    createUnitState(member, Boolean(member.isMercenary), synergyMult),
  );

  const log = new HighlightLogCollector();
  log.push(
    4,
    `🐉 **集结开荒**：${partyCount} 人小队迎战 **${boss.name}**（羁绊增幅 **+${synergyPct}%**）！`,
  );

  for (const member of members) {
    applyPreBattlePassives(member, log);
  }
  applyPreBattlePassives(boss, log);

  const orderedBySpeed = [...members].sort(
    (a, b) => CLASS_MODELS[b.classKey].initiative - CLASS_MODELS[a.classKey].initiative,
  );

  let roundsPlayed = 0;
  for (let round = 1; round <= MAX_BATTLE_ROUNDS; round++) {
    const anyAlive = members.some((m) => m.hp > 0);
    if (!anyAlive || boss.hp <= 0) break;
    roundsPlayed = round;

    for (const member of members) {
      refreshPeriodicTitanShield(member, round, log);
    }
    refreshPeriodicTitanShield(boss, round, log);

    // Party members act in initiative order
    for (const member of orderedBySpeed) {
      if (boss.hp <= 0) break;
      if (member.hp <= 0) continue;
      executeFighterTurn(member, boss, round, rng, log, members);
    }

    // Boss acts if still alive: AoE roar on ultimate, or frontline-weighted strike
    if (boss.hp > 0) {
      const living = members.filter((m) => m.hp > 0);
      if (living.length > 0) {
        boss.rage = Math.min(140, boss.rage + 16);
        if (boss.rage >= 100) {
          boss.rage = Math.max(0, boss.rage - 100);
          const hasLivingFrontline = living.some((m) => getPartyRole(m.classKey) === 'frontline');
          let totalAoe = 0;
          for (const target of living) {
            const isFront = getPartyRole(target.classKey) === 'frontline';
            const roleMult = isFront ? 1.3 : hasLivingFrontline ? 0.38 : 0.85;
            const res = executeSingleStrike(
              boss,
              target,
              {
                round,
                multiplier: 1.25 * roleMult,
                canDodge: false,
                extraArmorPenBp: 1500,
                allowCombo: false,
                allowThorns: true,
              },
              rng,
              log,
            );
            totalAoe += res.damage;
          }
          log.push(
            4,
            `🌋 [R${round}] **首领狂暴震击**：${boss.name} 席卷全队，合计造成 **${totalAoe}** 毁灭伤害！`,
          );
        } else {
          boss.rage = Math.min(140, boss.rage + 24);
          const mainTarget = pickWeightedTarget(living, rng);
          executeSingleStrike(
            boss,
            mainTarget,
            {
              round,
              multiplier: 1.15,
              canDodge: true,
              extraArmorPenBp: 0,
              allowCombo: true,
              allowThorns: true,
            },
            rng,
            log,
          );
        }
      }
    }

    for (const member of members) {
      if (member.armorBreakRounds > 0) member.armorBreakRounds -= 1;
    }
    if (boss.armorBreakRounds > 0) boss.armorBreakRounds -= 1;
  }

  const succeeded = boss.hp <= 0;
  let totalPartyDamage = 0;
  let mvpUserId: string | null = null;
  let bestContribution = -1;

  const memberStats: CoopMemberBattleStat[] = members.map((m) => {
    totalPartyDamage += m.totalDamageDealt;
    const contribution =
      m.totalDamageDealt + m.totalDamageTaken * 0.25 + m.totalHealedAndShielded * 0.2;
    if (contribution > bestContribution) {
      bestContribution = contribution;
      mvpUserId = m.id;
    }
    return {
      userId: m.id,
      name: m.name,
      classKey: m.classKey,
      isMercenary: m.isMercenary,
      role: getPartyRole(m.classKey),
      remainingHp: m.hp,
      maxHp: m.maxHp,
      damageDealt: m.totalDamageDealt,
      damageTaken: m.totalDamageTaken,
      healedAndShielded: m.totalHealedAndShielded,
    };
  });

  const mvpMember = memberStats.find((m) => m.userId === mvpUserId) ?? memberStats[0]!;

  if (succeeded) {
    log.push(
      5,
      `🏆 **团本告捷**：第 ${roundsPlayed} 回合成功讨伐 **${boss.name}**！全场 MVP：**${mvpMember.name}**（输出 ${mvpMember.damageDealt}）！`,
    );
  } else {
    log.push(
      5,
      `💀 **讨伐受挫**：鏖战 ${roundsPlayed} 回合未能击倒 **${boss.name}**（首领余血 ${boss.hp}/${boss.maxHp}）！`,
    );
  }

  const frontline = memberStats.find((m) => m.role === 'frontline') ?? memberStats[0]!;
  const fallbackRaidLines: string[] = [
    `🛡️ **前排承伤**：${frontline.name} 顶在战线最前方，累计扛下 **${frontline.damageTaken}** 伤害。`,
    `⚔️ **团队火力**：小队合计倾泻 **${totalPartyDamage}** 总伤害，MVP **${mvpMember.name}** 贡献突出。`,
    `✨ **阵容羁绊**：${partyCount} 人编队激活 **+${synergyPct}%** 全属性协同光环。`,
    `📊 **首领态势**：${boss.name} 最终剩余生命 **${boss.hp}/${boss.maxHp}**（共 ${roundsPlayed} 回合）。`,
  ];

  return {
    succeeded,
    tier: safeTier,
    bossName: boss.name,
    bossMaxHp: boss.maxHp,
    bossRemainingHp: boss.hp,
    roundsPlayed,
    partySynergyBonusPct: synergyPct,
    mvpUserId,
    members: memberStats,
    totalPartyDamage,
    highlights: log.finalize(fallbackRaidLines, 6, 8),
  };
}
