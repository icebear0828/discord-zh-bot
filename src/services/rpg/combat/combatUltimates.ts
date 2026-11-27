import { dealDamageToUnit, executeSingleStrike } from './combatStrikeAndPassives.js';
import {
  CLASS_MODELS,
  clampUnit,
  type BattleUnitState,
  type HighlightLogCollector,
} from './combatTypes.js';

export function executeClassUltimate(
  attacker: BattleUnitState,
  target: BattleUnitState,
  round: number,
  rng: () => number,
  log: HighlightLogCollector,
  allies?: readonly BattleUnitState[],
): void {
  const model = CLASS_MODELS[attacker.classKey];

  const runUltimateCast = (powerScale: number, isAftershock: boolean): void => {
    if (attacker.hp <= 0 || target.hp <= 0) return;
    const tagPrefix = isAftershock
      ? `☄️ **双生星陨·${model.skillName}**`
      : `${model.emoji} **招牌大招·${model.skillName}**`;

    if (attacker.classKey === 'warrior') {
      const res = executeSingleStrike(
        attacker,
        target,
        {
          round,
          multiplier: 1.85 * powerScale,
          canDodge: false,
          extraArmorPenBp: 0,
          allowCombo: false,
          allowThorns: !isAftershock,
          skillLabel: tagPrefix,
          logPriority: 4,
        },
        rng,
        log,
      );
      if (res.hit && target.hp > 0 && !(target.classKey === 'paladin' && target.shield > 0)) {
        target.armorBreakRounds = Math.max(target.armorBreakRounds, 2);
      }
      return;
    }

    if (attacker.classKey === 'mage') {
      executeSingleStrike(
        attacker,
        target,
        {
          round,
          multiplier: 2.05 * powerScale,
          canDodge: false,
          extraArmorPenBp: 4000,
          allowCombo: false,
          allowThorns: !isAftershock,
          skillLabel: tagPrefix,
          logPriority: 4,
        },
        rng,
        log,
      );
      return;
    }

    if (attacker.classKey === 'ranger') {
      let totalArrowDmg = 0;
      for (let shot = 0; shot < 2; shot++) {
        if (target.hp <= 0 || attacker.hp <= 0) break;
        const res = executeSingleStrike(
          attacker,
          target,
          {
            round,
            multiplier: 1.08 * powerScale,
            canDodge: false,
            extraArmorPenBp: 0,
            allowCombo: true,
            allowThorns: shot === 0 && !isAftershock,
          },
          rng,
          log,
        );
        totalArrowDmg += res.damage;
      }
      log.push(
        4,
        `${tagPrefix} [R${round}] ${attacker.name} 双箭齐发贯穿 ${target.name}，合计造成 **${totalArrowDmg}** 伤害！`,
      );
      return;
    }

    // Paladin: 圣光裁决
    executeSingleStrike(
      attacker,
      target,
      {
        round,
        multiplier: 1.65 * powerScale,
        canDodge: false,
        extraArmorPenBp: 0,
        allowCombo: false,
        allowThorns: !isAftershock,
        skillLabel: tagPrefix,
        logPriority: 4,
      },
      rng,
      log,
    );

    if (attacker.hp > 0) {
      const shieldAmt = Math.max(1, Math.round(attacker.maxHp * 0.22 * powerScale));
      const healAmt = Math.max(1, Math.round(attacker.maxHp * 0.12 * powerScale));
      attacker.shield += shieldAmt;
      const actualHeal = Math.min(attacker.maxHp - attacker.hp, healAmt);
      attacker.hp += actualHeal;
      attacker.totalHealedAndShielded += shieldAmt + actualHeal;

      if (allies && !isAftershock) {
        for (const ally of allies) {
          if (ally.id !== attacker.id && ally.hp > 0) {
            const allyShield = Math.max(1, Math.round(ally.maxHp * 0.08));
            ally.shield += allyShield;
            attacker.totalHealedAndShielded += allyShield;
          }
        }
      }
    }
  };

  runUltimateCast(1, false);

  if (
    attacker.hp > 0 &&
    target.hp > 0 &&
    attacker.legendarySet.has('twin_meteor') &&
    clampUnit(rng()) < 0.35
  ) {
    runUltimateCast(0.55, true);
  }
}

export function executePetAssist(
  attacker: BattleUnitState,
  target: BattleUnitState,
  round: number,
  rng: () => number,
  log: HighlightLogCollector,
): void {
  if (!attacker.pet || attacker.hp <= 0 || target.hp <= 0) return;
  if (attacker.pet.assistDamage <= 0) return;
  if (clampUnit(rng()) >= attacker.pet.assistChance) return;

  const petDmg = Math.max(
    1,
    Math.round(attacker.pet.assistDamage * (120 / (120 + target.def * 0.35))),
  );
  dealDamageToUnit(attacker, target, petDmg, round, log);
  log.push(
    2,
    `${attacker.pet.emoji} [R${round}] 灵宠 **${attacker.pet.nickname}** 默契协战，扑击 ${target.name} **${petDmg}** 伤害！`,
  );
}

export function executeFighterTurn(
  attacker: BattleUnitState,
  target: BattleUnitState,
  round: number,
  rng: () => number,
  log: HighlightLogCollector,
  allies?: readonly BattleUnitState[],
): void {
  if (attacker.hp <= 0 || target.hp <= 0) return;

  // Turn-start rage focus (Mage passive: 奥术增幅 gains +18 mana rage)
  const passiveRage = attacker.classKey === 'mage' ? 18 : 6;
  attacker.rage = Math.min(140, attacker.rage + passiveRage);

  if (attacker.rage >= 100) {
    attacker.rage = Math.max(0, attacker.rage - 100);
    executeClassUltimate(attacker, target, round, rng, log, allies);
  } else {
    attacker.rage = Math.min(140, attacker.rage + 26);
    executeSingleStrike(
      attacker,
      target,
      {
        round,
        multiplier: 1.0,
        canDodge: true,
        extraArmorPenBp: 0,
        allowCombo: true,
        allowThorns: true,
      },
      rng,
      log,
    );
  }

  executePetAssist(attacker, target, round, rng, log);
}
