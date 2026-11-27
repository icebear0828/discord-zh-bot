import { buildEqualizedCombatant, createUnitState } from './combatSnapshots.js';
import { applyPreBattlePassives, refreshPeriodicTitanShield } from './combatStrikeAndPassives.js';
import {
  CLASS_MODELS,
  EQUALIZED_TEMPLATE_LEVEL,
  HighlightLogCollector,
  MAX_BATTLE_ROUNDS,
  type CombatantSnapshot,
  type RpgBattleMode,
  type RpgBattleRating,
  type RpgBattleReport,
  type RpgBattleWinner,
  type SimulateBattleOptions,
} from './combatTypes.js';
import { executeFighterTurn } from './combatUltimates.js';

function computeBattleRating(
  winner: RpgBattleWinner,
  rightIsBoss: boolean,
  roundsPlayed: number,
  winnerRemainingHp: number,
  winnerMaxHp: number,
): RpgBattleRating {
  if (winner === 'draw') return 'B';
  if (rightIsBoss && winner !== 'left') return 'B';

  const hpRatio = winnerRemainingHp / Math.max(1, winnerMaxHp);
  if (roundsPlayed <= 4 && hpRatio >= 0.55) return 'SSS';
  if (roundsPlayed <= 7 && hpRatio >= 0.35) return 'S';
  if (roundsPlayed <= 10) return 'A';
  return 'B';
}

export function simulateRpgBattle(
  leftInput: CombatantSnapshot,
  rightInput: CombatantSnapshot,
  options: SimulateBattleOptions = {},
): RpgBattleReport {
  const mode: RpgBattleMode = options.mode ?? 'full';
  const maxRounds = Math.max(1, Math.min(30, Math.floor(options.maxRounds ?? MAX_BATTLE_ROUNDS)));
  const rng = options.rng ?? Math.random;
  const tplLevel = options.templateLevel ?? EQUALIZED_TEMPLATE_LEVEL;

  const preparedLeft =
    mode === 'equalized' ? buildEqualizedCombatant(leftInput, tplLevel) : leftInput;
  const preparedRight =
    mode === 'equalized' ? buildEqualizedCombatant(rightInput, tplLevel) : rightInput;

  const left = createUnitState(preparedLeft);
  const right = createUnitState(preparedRight);
  const log = new HighlightLogCollector();

  const modeBadge = mode === 'equalized' ? `⚖️同阶拉平(Lv.${tplLevel})` : '🔥实战交锋';
  log.push(3, `⚔️ **${modeBadge}**：**${left.name}** 迎战 **${right.name}**！`);

  applyPreBattlePassives(left, log);
  applyPreBattlePassives(right, log);

  const leftFirst =
    CLASS_MODELS[left.classKey].initiative >= CLASS_MODELS[right.classKey].initiative;

  let roundsPlayed = 0;
  for (let round = 1; round <= maxRounds; round++) {
    if (left.hp <= 0 || right.hp <= 0) break;
    roundsPlayed = round;

    refreshPeriodicTitanShield(left, round, log);
    refreshPeriodicTitanShield(right, round, log);

    if (leftFirst) {
      executeFighterTurn(left, right, round, rng, log);
      if (right.hp > 0 && left.hp > 0) {
        executeFighterTurn(right, left, round, rng, log);
      }
    } else {
      executeFighterTurn(right, left, round, rng, log);
      if (left.hp > 0 && right.hp > 0) {
        executeFighterTurn(left, right, round, rng, log);
      }
    }

    if (left.armorBreakRounds > 0) left.armorBreakRounds -= 1;
    if (right.armorBreakRounds > 0) right.armorBreakRounds -= 1;
  }

  let winner: RpgBattleWinner = 'draw';
  if (left.hp > 0 && right.hp <= 0) {
    winner = 'left';
  } else if (right.hp > 0 && left.hp <= 0) {
    winner = 'right';
  }

  const winnerUnit = winner === 'left' ? left : winner === 'right' ? right : null;
  const rating = computeBattleRating(
    winner,
    right.isBoss,
    roundsPlayed,
    winnerUnit ? winnerUnit.hp : 0,
    winnerUnit ? winnerUnit.maxHp : 1,
  );

  if (winner === 'left') {
    log.push(
      5,
      `🏆 **胜负已分**：第 ${roundsPlayed} 回合，**${left.name}** 斩获胜利（剩余生命 ${left.hp}/${left.maxHp} · 评级 **${rating}**）！`,
    );
  } else if (winner === 'right') {
    log.push(
      5,
      `💀 **战局终结**：第 ${roundsPlayed} 回合，**${right.name}** 击败了 ${left.name}（剩余生命 ${right.hp}/${right.maxHp}）！`,
    );
  } else {
    log.push(
      5,
      `🤝 **鏖战平局**：激战满 ${roundsPlayed} 回合未分生死（${left.name} ${left.hp} HP vs ${right.name} ${right.hp} HP）！`,
    );
  }

  const fallbackTacticalLines: string[] = [
    `📊 **气势对决**：${left.name}（${CLASS_MODELS[left.classKey].name}）正面对抗 ${right.name}（${CLASS_MODELS[right.classKey].name}）。`,
    `🗡️ **输出统计**：${left.name} 累计造成 **${left.totalDamageDealt}** 伤害；${right.name} 累计造成 **${right.totalDamageDealt}** 伤害。`,
    `🛡️ **生存态势**：战罢时 ${left.name} 剩余 **${left.hp}/${left.maxHp}** HP，${right.name} 剩余 **${right.hp}/${right.maxHp}** HP。`,
    `⚡ **战术节奏**：双方共交锋 **${roundsPlayed}** 回合，完成整场战斗结算。`,
  ];

  return {
    winner,
    rating,
    roundsPlayed,
    mode,
    leftRemainingHp: left.hp,
    rightRemainingHp: right.hp,
    leftMaxHp: left.maxHp,
    rightMaxHp: right.maxHp,
    leftTotalDamage: left.totalDamageDealt,
    rightTotalDamage: right.totalDamageDealt,
    highlights: log.finalize(fallbackTacticalLines, 6, 8),
  };
}
