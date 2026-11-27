import {
  clampUnit,
  type BattleUnitState,
  type HighlightLogCollector,
  type StrikeOptions,
} from './combatTypes.js';

export function getEffectiveAtk(unit: BattleUnitState): number {
  return Math.max(1, unit.baseAtk + unit.stolenAtk - unit.lostAtk);
}

export function applyPreBattlePassives(unit: BattleUnitState, log: HighlightLogCollector): void {
  if (unit.legendarySet.has('ancestral_war_cry')) {
    unit.rage = 100;
    log.push(4, `📯 **先祖战吼**：${unit.name} 战意沸腾，开场直接凝聚 100 满怒气！`);
  }
  if (unit.legendarySet.has('titan_aegis')) {
    const shieldGain = Math.max(1, Math.round(unit.maxHp * 0.28));
    unit.shield += shieldGain;
    unit.totalHealedAndShielded += shieldGain;
    log.push(3, `🛡️ **泰坦圣壁**：${unit.name} 披挂神圣壁垒，入场获得 **${shieldGain}** 点护盾！`);
  }
}

export function refreshPeriodicTitanShield(
  unit: BattleUnitState,
  round: number,
  log: HighlightLogCollector,
): void {
  if (unit.hp <= 0 || round <= 1 || round % 3 !== 0) return;
  if (!unit.legendarySet.has('titan_aegis')) return;

  const refreshShield = Math.max(1, Math.round(unit.maxHp * 0.14));
  const nextShield = Math.max(
    unit.shield,
    Math.min(Math.round(unit.maxHp * 0.35), unit.shield + refreshShield),
  );
  const gained = Math.max(0, nextShield - unit.shield);
  if (gained > 0) {
    unit.shield = nextShield;
    unit.totalHealedAndShielded += gained;
    log.push(2, `🛡️ [R${round}] **泰坦圣壁**：${unit.name} 刷新 **${gained}** 点圣盾加护！`);
  }
}

export function dealDamageToUnit(
  attacker: BattleUnitState | null,
  target: BattleUnitState,
  amount: number,
  round: number,
  log: HighlightLogCollector,
): { actualDealt: number; triggeredPhoenix: boolean } {
  const safeDmg = Math.max(1, Math.round(amount));
  if (attacker) {
    attacker.totalDamageDealt += safeDmg;
  }
  target.totalDamageTaken += safeDmg;

  let remaining = safeDmg;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, remaining);
    target.shield -= absorbed;
    remaining -= absorbed;
  }

  let triggeredPhoenix = false;
  if (remaining > 0) {
    target.hp -= remaining;
    if (target.hp <= 0) {
      if (target.legendarySet.has('phoenix_rebirth') && !target.phoenixUsed) {
        target.phoenixUsed = true;
        triggeredPhoenix = true;
        const healAmt = Math.max(1, Math.round(target.maxHp * 0.25));
        target.hp = Math.min(target.maxHp, 1 + healAmt);
        target.totalHealedAndShielded += healAmt;
        log.push(
          5,
          `🔥 [R${round}] **不灭凤羽**：${target.name} 遭遇致命重创锁 1 血涅槃，瞬间恢复 **${healAmt}** 生命！`,
        );
      } else {
        target.hp = 0;
      }
    }
  }

  if (target.hp > 0) {
    const rageGain = target.isBoss ? 8 : target.classKey === 'warrior' ? 28 : 16;
    target.rage = Math.min(140, target.rage + rageGain);
  }

  return { actualDealt: safeDmg, triggeredPhoenix };
}

export function executeSingleStrike(
  attacker: BattleUnitState,
  target: BattleUnitState,
  opts: StrikeOptions,
  rng: () => number,
  log: HighlightLogCollector,
): { hit: boolean; isCrit: boolean; damage: number } {
  if (attacker.hp <= 0 || target.hp <= 0) {
    return { hit: false, isCrit: false, damage: 0 };
  }

  // 1. Dodge check
  if (opts.canDodge) {
    const rangerBonusBp = target.classKey === 'ranger' ? 800 : 0;
    const dodgeChance = Math.min(
      0.6,
      Math.max(0, (target.dodgeBp + target.affixes.dodgeBp + rangerBonusBp) / 10000),
    );
    if (clampUnit(rng()) < dodgeChance) {
      if (target.classKey === 'ranger' && target.hp > 0) {
        // Ranger passive: 幻影追猎 — dodge triggers 75% counter-arrow
        const counterRes = executeSingleStrike(
          target,
          attacker,
          {
            round: opts.round,
            multiplier: 0.75,
            canDodge: false,
            extraArmorPenBp: 0,
            allowCombo: false,
            allowThorns: false,
          },
          rng,
          log,
        );
        log.push(
          3,
          `💨 [R${opts.round}] **幻影追猎**：${target.name} 残影闪避攻击，反手追射 ${attacker.name} **${counterRes.damage}** 伤害！`,
        );
      } else {
        log.push(2, `💨 [R${opts.round}] ${target.name} 灵巧闪避了 ${attacker.name} 的攻势！`);
      }
      return { hit: false, isCrit: false, damage: 0 };
    }
  }

  // 2. Effective ATK & DEF
  const effAtk = getEffectiveAtk(attacker);
  let targetDef = target.def;
  const paladinShieldImmune = target.classKey === 'paladin' && target.shield > 0;
  if (target.armorBreakRounds > 0 && !paladinShieldImmune) {
    targetDef *= 0.7;
  }
  const totalPenBp = Math.min(8500, attacker.affixes.armorPenBp + opts.extraArmorPenBp);
  const effDef = Math.max(0, targetDef * (1 - totalPenBp / 10000));

  // 3. Pre-mitigation damage & Warrior low-HP passive
  const variance = 0.95 + clampUnit(rng()) * 0.1;
  let rawPreMit = effAtk * opts.multiplier * variance;

  if (attacker.classKey === 'warrior' && attacker.hp < attacker.maxHp * 0.4) {
    const targetMissingRatio = 1 - target.hp / Math.max(1, target.maxHp);
    rawPreMit *= 1.12 + targetMissingRatio * 0.25;
  }

  // 4. Crit & Abyss Soul Drain
  const critChance = Math.min(0.85, Math.max(0, attacker.critBp / 10000));
  const isCrit = clampUnit(rng()) < critChance;
  if (isCrit) {
    const magePassiveCritBonus = attacker.classKey === 'mage' ? 0.35 : 0;
    const critMult = 1.5 + magePassiveCritBonus + attacker.affixes.critDmgBp / 10000;
    rawPreMit *= critMult;

    if (attacker.legendarySet.has('abyss_soul_drain') && attacker.soulDrainStacks < 5) {
      const drainAtk = Math.max(1, Math.round(target.baseAtk * 0.04));
      attacker.soulDrainStacks += 1;
      attacker.stolenAtk += drainAtk;
      target.lostAtk = Math.min(Math.floor(target.baseAtk * 0.4), target.lostAtk + drainAtk);
      log.push(
        3,
        `👁️ [R${opts.round}] **深渊噬魂**：${attacker.name} 暴击汲取 ${target.name} **${drainAtk}** 点攻击力（${attacker.soulDrainStacks}/5层）！`,
      );
    }
  }

  // 5. Defense mitigation (level-scaled K so high-tier armor stays balanced) & Damage Reduction
  const armorK = 100 + Math.max(1, attacker.level) * 5;
  const mitigated = rawPreMit * (armorK / (armorK + effDef));
  const classDmgReduceBp =
    target.classKey === 'warrior' ? 1000 : target.classKey === 'paladin' ? 800 : 0;
  const totalDmgReduceBp = Math.min(6500, target.affixes.dmgReduceBp + classDmgReduceBp);
  let finalDmg = mitigated * (1 - totalDmgReduceBp / 10000);

  // 6. Godslayer Execute (<35% HP -> +30% final damage)
  let triggeredExecute = false;
  if (
    attacker.legendarySet.has('godslayer_execute') &&
    target.hp / Math.max(1, target.maxHp) < 0.35
  ) {
    finalDmg *= 1.3;
    triggeredExecute = true;
  }

  const roundedDmg = Math.max(1, Math.round(finalDmg));
  dealDamageToUnit(attacker, target, roundedDmg, opts.round, log);

  if (opts.skillLabel) {
    const critBadge = isCrit ? '💥暴击 ' : '';
    const execBadge = triggeredExecute ? '【弑神处决】' : '';
    log.push(
      opts.logPriority ?? 4,
      `${opts.skillLabel} [R${opts.round}] ${attacker.name} 重创 ${target.name}，${critBadge}${execBadge}造成 **${roundedDmg}** 伤害！`,
    );
  } else if (isCrit || triggeredExecute) {
    const execBadge = triggeredExecute ? '触发【弑神处决】' : '';
    log.push(
      3,
      `💥 [R${opts.round}] ${attacker.name} 致命暴击${execBadge}，对 ${target.name} 造成 **${roundedDmg}** 伤害！`,
    );
  } else {
    log.push(
      1,
      `⚔️ [R${opts.round}] ${attacker.name} 命中 ${target.name}，造成 **${roundedDmg}** 伤害。`,
    );
  }

  // 7. Lifesteal
  if (attacker.affixes.lifestealBp > 0 && attacker.hp > 0) {
    const heal = Math.max(1, Math.round(roundedDmg * (attacker.affixes.lifestealBp / 10000)));
    const actualHeal = Math.min(attacker.maxHp - attacker.hp, heal);
    attacker.hp += actualHeal;
    attacker.totalHealedAndShielded += actualHeal;
  }

  // 8. Thorns (荆棘 + Paladin 圣盾荆棘 18%)
  if (opts.allowThorns && attacker.hp > 0) {
    const paladinThornsBp = target.classKey === 'paladin' ? 1800 : 0;
    const totalThornsBp = target.affixes.thornsBp + paladinThornsBp;
    if (totalThornsBp > 0) {
      let thornsDmg = Math.max(1, Math.round(rawPreMit * (totalThornsBp / 10000)));
      if (attacker.isBoss) {
        thornsDmg = Math.min(thornsDmg, Math.max(10, Math.round(attacker.maxHp * 0.08)));
      }
      dealDamageToUnit(target, attacker, thornsDmg, opts.round, log);
      if (thornsDmg >= Math.max(15, Math.round(attacker.maxHp * 0.05))) {
        log.push(
          2,
          `🌵 [R${opts.round}] ${target.name} 圣盾荆棘反震 ${attacker.name} **${thornsDmg}** 伤害！`,
        );
      }
    }
  }

  // 9. Combo affix (疾风)
  if (opts.allowCombo && attacker.affixes.comboBp > 0 && attacker.hp > 0 && target.hp > 0) {
    if (clampUnit(rng()) < attacker.affixes.comboBp / 10000) {
      const comboRes = executeSingleStrike(
        attacker,
        target,
        {
          round: opts.round,
          multiplier: 0.65,
          canDodge: true,
          extraArmorPenBp: 0,
          allowCombo: false,
          allowThorns: false,
        },
        rng,
        log,
      );
      if (comboRes.hit) {
        log.push(
          2,
          `🌪️ [R${opts.round}] **疾风连击**：${attacker.name} 乘胜追击再添 **${comboRes.damage}** 伤害！`,
        );
      }
    }
  }

  return { hit: true, isCrit, damage: roundedDmg };
}
