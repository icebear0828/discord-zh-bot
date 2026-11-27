import type { RpgClassKey } from '../../../db/repositories/rpgRepo.js';
import type { AggregatedAffixBonuses, RpgLegendaryEffect } from '../../rpgAffixes.js';

export const MAX_BATTLE_ROUNDS = 12;
export const EQUALIZED_TEMPLATE_LEVEL = 45;

export interface CombatPetCompanion {
  nickname: string;
  emoji: string;
  assistChance: number;
  assistDamage: number;
}

export interface CombatantSnapshot {
  id: string;
  name: string;
  classKey: RpgClassKey;
  level: number;
  maxHp: number;
  atk: number;
  def: number;
  critBp: number;
  dodgeBp: number;
  affixes: AggregatedAffixBonuses;
  pet?: CombatPetCompanion | null;
  avgEnhanceLevel?: number;
  isBoss?: boolean;
}

export type RpgBattleMode = 'full' | 'equalized';
export type RpgBattleRating = 'SSS' | 'S' | 'A' | 'B';
export type RpgBattleWinner = 'left' | 'right' | 'draw';

export interface SimulateBattleOptions {
  maxRounds?: number;
  mode?: RpgBattleMode;
  templateLevel?: number;
  rng?: () => number;
}

export interface RpgBattleReport {
  winner: RpgBattleWinner;
  rating: RpgBattleRating;
  roundsPlayed: number;
  mode: RpgBattleMode;
  leftRemainingHp: number;
  rightRemainingHp: number;
  leftMaxHp: number;
  rightMaxHp: number;
  leftTotalDamage: number;
  rightTotalDamage: number;
  highlights: string[];
}

export type CoopPartyMemberInput = CombatantSnapshot & { isMercenary?: boolean };

export interface CoopMemberBattleStat {
  userId: string;
  name: string;
  classKey: RpgClassKey;
  isMercenary: boolean;
  role: 'frontline' | 'backline';
  remainingHp: number;
  maxHp: number;
  damageDealt: number;
  damageTaken: number;
  healedAndShielded: number;
}

export interface CoopRaidBattleReport {
  succeeded: boolean;
  tier: number;
  bossName: string;
  bossMaxHp: number;
  bossRemainingHp: number;
  roundsPlayed: number;
  partySynergyBonusPct: number;
  mvpUserId: string | null;
  members: CoopMemberBattleStat[];
  totalPartyDamage: number;
  highlights: string[];
}

export interface ClassGrowthModel {
  key: RpgClassKey;
  name: string;
  emoji: string;
  skillName: string;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseCritBp: number;
  baseDodgeBp: number;
  hpPerLevel: number;
  atkPerLevel: number;
  defPerLevel: number;
  critBpPerLevel: number;
  initiative: number;
}

export const CLASS_MODELS: Record<RpgClassKey, ClassGrowthModel> = {
  warrior: {
    key: 'warrior',
    name: '圣殿战士',
    emoji: '⚔️',
    skillName: '破军重斩',
    baseHp: 170,
    baseAtk: 24,
    baseDef: 14,
    baseCritBp: 1000,
    baseDodgeBp: 500,
    hpPerLevel: 26,
    atkPerLevel: 4.5,
    defPerLevel: 2.8,
    critBpPerLevel: 25,
    initiative: 2,
  },
  mage: {
    key: 'mage',
    name: '奥术法师',
    emoji: '🔮',
    skillName: '陨星火球',
    baseHp: 115,
    baseAtk: 34,
    baseDef: 7,
    baseCritBp: 1600,
    baseDodgeBp: 700,
    hpPerLevel: 16,
    atkPerLevel: 6.2,
    defPerLevel: 1.5,
    critBpPerLevel: 45,
    initiative: 3,
  },
  ranger: {
    key: 'ranger',
    name: '暗影游侠',
    emoji: '🏹',
    skillName: '穿云连射',
    baseHp: 130,
    baseAtk: 29,
    baseDef: 9,
    baseCritBp: 2000,
    baseDodgeBp: 1500,
    hpPerLevel: 19,
    atkPerLevel: 5.4,
    defPerLevel: 1.8,
    critBpPerLevel: 55,
    initiative: 4,
  },
  paladin: {
    key: 'paladin',
    name: '辉光圣骑士',
    emoji: '🛡️',
    skillName: '圣光裁决',
    baseHp: 155,
    baseAtk: 25,
    baseDef: 12,
    baseCritBp: 1200,
    baseDodgeBp: 600,
    hpPerLevel: 23,
    atkPerLevel: 4.8,
    defPerLevel: 2.4,
    critBpPerLevel: 30,
    initiative: 1,
  },
};

export interface BattleUnitState {
  id: string;
  name: string;
  classKey: RpgClassKey;
  level: number;
  maxHp: number;
  hp: number;
  shield: number;
  baseAtk: number;
  stolenAtk: number;
  lostAtk: number;
  def: number;
  critBp: number;
  dodgeBp: number;
  rage: number;
  armorBreakRounds: number;
  phoenixUsed: boolean;
  soulDrainStacks: number;
  affixes: AggregatedAffixBonuses;
  legendarySet: ReadonlySet<RpgLegendaryEffect>;
  pet: CombatPetCompanion | null;
  isBoss: boolean;
  isMercenary: boolean;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalHealedAndShielded: number;
}

export interface StrikeOptions {
  round: number;
  multiplier: number;
  canDodge: boolean;
  extraArmorPenBp: number;
  allowCombo: boolean;
  allowThorns: boolean;
  skillLabel?: string;
  logPriority?: number;
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999999, Math.max(0, value));
}

interface HighlightCandidate {
  seq: number;
  priority: number;
  text: string;
}

export class HighlightLogCollector {
  private readonly entries: HighlightCandidate[] = [];
  private seq = 0;

  push(priority: number, text: string): void {
    this.seq += 1;
    this.entries.push({ seq: this.seq, priority, text });
  }

  finalize(fallbackLines: readonly string[], minLines = 6, maxLines = 8): string[] {
    let selected: HighlightCandidate[];
    if (this.entries.length <= maxLines) {
      selected = [...this.entries];
    } else {
      const ranked = [...this.entries].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.seq - b.seq;
      });
      selected = ranked.slice(0, maxLines).sort((a, b) => a.seq - b.seq);
    }

    const lines = selected.map((item) => item.text);
    for (const extra of fallbackLines) {
      if (lines.length >= minLines) break;
      if (!lines.includes(extra)) {
        if (lines.length >= 2) {
          lines.splice(lines.length - 1, 0, extra);
        } else {
          lines.push(extra);
        }
      }
    }

    return lines.slice(0, maxLines);
  }
}
