import type { RpgClassKey, RpgItemRarity, RpgItemSlot } from '../db/repositories/rpgRepo.js';
import {
  RARITY_META,
  RARITY_ORDER,
  RPG_CHAPTER_MAP,
  RUN_INITIAL_POTIONS,
  type PendingRpgItem,
  type PetSynergyInfo,
} from './rpgService.js';
import type { PetRarity } from '../db/repositories/socialPetRepo.js';

export type RpgPendingItem = PendingRpgItem;

// ---------------------------------------------------------------------------
// Shared structural catalog contract (matches src/services/rpgTabletopCatalog.ts)
// ---------------------------------------------------------------------------

export type TabletopStatKey = 'might' | 'arcana' | 'agility' | 'charm';

export interface TabletopStatMeta {
  key: TabletopStatKey;
  label: string;
  emoji: string;
  shortDesc: string;
}

export type TabletopCreditPerk = 'high_free' | 'deadbeat_intimidate';

export interface TabletopChoiceDef {
  id: string;
  label: string;
  detail: string;
  stat?: TabletopStatKey;
  dc?: number;
  coinCost?: number;
  requiredClass?: RpgClassKey;
  creditPerk?: TabletopCreditPerk;
  rewardCoinsMult: number;
  rewardXpMult: number;
  dropChance: number;
  failHpPct: number;
  critFailHpPct: number;
  healPctOnSuccess?: number;
  weakenBoss?: boolean;
  successText: string;
  critSuccessText: string;
  failText: string;
  critFailText: string;
}

export interface TabletopSceneDef {
  id: string;
  chapter: number | 'shared';
  title: string;
  emoji: string;
  narrative: string;
  choices: readonly TabletopChoiceDef[];
}

export interface TabletopBossActDef {
  chapter: number;
  bossName: string;
  bossEmoji: string;
  phase1Title: string;
  phase1Narrative: string;
  phase1Choices: readonly TabletopChoiceDef[];
  phase2Title: string;
  phase2Narrative: string;
  phase2Choices: readonly TabletopChoiceDef[];
  victoryEpilogue: string;
}

export interface TabletopCatalog {
  scenes: readonly TabletopSceneDef[];
  bossActs: readonly TabletopBossActDef[];
}

// ---------------------------------------------------------------------------
// DND 4-Stat Derivation
// ---------------------------------------------------------------------------

export interface DeriveTabletopAttributesInput {
  classKey: RpgClassKey;
  level: number;
  maxHp: number;
  atk: number;
  def: number;
  critBp: number;
  dodgeBp: number;
  creditScore: number;
  petSynergy: PetSynergyInfo | null;
}

export interface TabletopAttributes {
  might: number;
  arcana: number;
  agility: number;
  charm: number;
  mightMod: number;
  arcanaMod: number;
  agilityMod: number;
  charmMod: number;
  creditCharmBonus: number;
  petCheckBonus: number;
}

interface ClassStatProfile {
  base: Record<TabletopStatKey, number>;
  weight: Record<TabletopStatKey, number>;
  levelRate: Record<TabletopStatKey, number>;
}

const CLASS_STAT_PROFILES: Record<RpgClassKey, ClassStatProfile> = {
  warrior: {
    base: { might: 10, charm: 9, agility: 8, arcana: 8 },
    weight: { might: 0.95, charm: 0.8, agility: 0.65, arcana: 0.58 },
    levelRate: { might: 0.18, charm: 0.15, agility: 0.12, arcana: 0.1 },
  },
  mage: {
    base: { arcana: 10, agility: 9, charm: 8, might: 8 },
    weight: { arcana: 0.95, agility: 0.8, charm: 0.65, might: 0.58 },
    levelRate: { arcana: 0.22, agility: 0.16, charm: 0.12, might: 0.1 },
  },
  ranger: {
    base: { agility: 10, might: 9, arcana: 8, charm: 8 },
    weight: { agility: 0.95, might: 0.8, arcana: 0.65, charm: 0.58 },
    levelRate: { agility: 0.28, might: 0.16, arcana: 0.12, charm: 0.1 },
  },
  paladin: {
    base: { charm: 10, might: 9, arcana: 8, agility: 8 },
    weight: { charm: 0.95, might: 0.8, arcana: 0.65, agility: 0.58 },
    levelRate: { charm: 0.18, might: 0.16, arcana: 0.12, agility: 0.1 },
  },
};

const PET_RARITY_CHECK_BONUS: Record<PetRarity, number> = {
  N: 1,
  R: 1,
  SR: 2,
  SSR: 3,
};

export function statToModifier(statValue: number): number {
  return Math.floor((statValue - 10) / 2);
}

export function getCreditCharmBonus(creditScore: number): number {
  if (creditScore >= 850) return 3;
  if (creditScore >= 700) return 2;
  if (creditScore >= 500) return 0;
  if (creditScore >= 300) return -1;
  return -2;
}

export function getCreditTierLabel(creditScore: number): string {
  if (creditScore >= 850) return '金卡气场';
  if (creditScore >= 700) return '白金信誉';
  if (creditScore >= 500) return '普通信用';
  if (creditScore >= 300) return '灰名单';
  return '老赖污点';
}

export function getPetCheckBonus(petSynergy: PetSynergyInfo | null): number {
  if (!petSynergy) return 0;
  return PET_RARITY_CHECK_BONUS[petSynergy.rarity];
}

export function getStatModifier(attrs: TabletopAttributes, stat: TabletopStatKey): number {
  switch (stat) {
    case 'might':
      return attrs.mightMod;
    case 'arcana':
      return attrs.arcanaMod;
    case 'agility':
      return attrs.agilityMod;
    case 'charm':
      return attrs.charmMod;
  }
}

function clampStat(value: number): number {
  return Math.max(6, Math.min(30, Math.round(value)));
}

export function deriveTabletopAttributes(input: DeriveTabletopAttributesInput): TabletopAttributes {
  const profile = CLASS_STAT_PROFILES[input.classKey];
  const safeLevel = Math.max(1, Math.floor(input.level));
  const extraLevels = safeLevel - 1;
  const maxHp = Math.max(0, input.maxHp);
  const atk = Math.max(0, input.atk);
  const def = Math.max(0, input.def);
  const critBp = Math.max(0, input.critBp);
  const dodgeBp = Math.max(0, input.dodgeBp);

  const mightSignal = Math.max(0, atk * 0.55 + maxHp * 0.09 + def * 0.45);
  const arcanaSignal = Math.max(0, atk * 0.72 + critBp * 0.012);
  const agilitySignal = Math.max(0, critBp * 0.011 + dodgeBp * 0.012 + atk * 0.35);
  const charmSignal = Math.max(0, def * 0.85 + maxHp * 0.11 + safeLevel * 2.5);

  const might = clampStat(
    profile.base.might +
      profile.weight.might * Math.sqrt(mightSignal) +
      extraLevels * profile.levelRate.might,
  );
  const arcana = clampStat(
    profile.base.arcana +
      profile.weight.arcana * Math.sqrt(arcanaSignal) +
      extraLevels * profile.levelRate.arcana,
  );
  const agility = clampStat(
    profile.base.agility +
      profile.weight.agility * Math.sqrt(agilitySignal) +
      extraLevels * profile.levelRate.agility,
  );
  const charm = clampStat(
    profile.base.charm +
      profile.weight.charm * Math.sqrt(charmSignal) +
      extraLevels * profile.levelRate.charm,
  );

  const creditCharmBonus = getCreditCharmBonus(input.creditScore);
  const petCheckBonus = getPetCheckBonus(input.petSynergy);

  return {
    might,
    arcana,
    agility,
    charm,
    mightMod: statToModifier(might),
    arcanaMod: statToModifier(arcana),
    agilityMod: statToModifier(agility),
    charmMod: statToModifier(charm) + creditCharmBonus,
    creditCharmBonus,
    petCheckBonus,
  };
}

// ---------------------------------------------------------------------------
// Dynamic Choice Selection & Live Odds Preview
// ---------------------------------------------------------------------------

export interface SelectSceneChoicesInput {
  choices: readonly TabletopChoiceDef[];
  classKey: RpgClassKey;
  creditScore: number;
  pocketCoins: number;
  chapter: number;
  bossWeakened?: boolean;
}

export interface ComputeChoicePreviewInput {
  choice: TabletopChoiceDef;
  attrs: TabletopAttributes;
  creditScore: number;
  pocketCoins: number;
  chapter: number;
  bossStage?: 0 | 1 | 2;
  bossWeakened?: boolean;
}

export interface TabletopChoicePreview {
  choiceId: string;
  stat?: TabletopStatKey;
  effectiveDc: number | null;
  statModifier: number;
  petBonus: number;
  creditPerkBonus: number;
  totalModifier: number;
  coinCost: number;
  canAfford: boolean;
  autoSuccess: boolean;
  successChancePct: number;
  creditPerkActive: boolean;
  creditPerkTag?: string;
}

export const TABLETOP_MAX_CHOICES = 3;
export const BOSS_WEAKEN_DC_REDUCTION = 3;
export const POTION_HEAL_RATIO = 0.45;

export function scaleBribeCoinCost(baseCoinCost: number | undefined, chapter: number): number {
  if (!baseCoinCost || baseCoinCost <= 0) return 0;
  const mult = 1 + Math.max(0, chapter - 1) * 0.5;
  return Math.max(1, Math.round(baseCoinCost * mult));
}

export function scaleChapterDc(baseDc: number, chapter: number): number {
  const chapterOffset = Math.floor(Math.max(0, chapter - 1) * 1.2);
  return baseDc + chapterOffset;
}

function isCreditPerkEligible(
  perk: TabletopCreditPerk | undefined,
  creditScore: number,
): boolean {
  if (perk === 'high_free') return creditScore >= 700;
  if (perk === 'deadbeat_intimidate') return creditScore < 500;
  return false;
}

export function selectSceneChoices(input: SelectSceneChoicesInput): TabletopChoiceDef[] {
  const { choices, classKey, creditScore, pocketCoins, chapter } = input;
  const eligible = choices.filter(
    (choice) => !choice.requiredClass || choice.requiredClass === classKey,
  );
  if (eligible.length <= TABLETOP_MAX_CHOICES) {
    return [...eligible];
  }

  const picked: TabletopChoiceDef[] = [];
  const pickedIds = new Set<string>();
  const usedStats = new Set<TabletopStatKey>();
  let hasNonStat = false;

  const addChoice = (choice: TabletopChoiceDef): void => {
    if (pickedIds.has(choice.id) || picked.length >= TABLETOP_MAX_CHOICES) return;
    picked.push(choice);
    pickedIds.add(choice.id);
    if (choice.stat) {
      usedStats.add(choice.stat);
    } else {
      hasNonStat = true;
    }
  };

  // Priority 1: matching class-exclusive tactic
  for (const choice of eligible) {
    if (choice.requiredClass === classKey) {
      addChoice(choice);
    }
  }

  // Priority 2: eligible credit-perk tactic (Gold Card / Platinum / Deadbeat)
  const perkMatches = eligible.filter(
    (choice) => !pickedIds.has(choice.id) && isCreditPerkEligible(choice.creditPerk, creditScore),
  );
  for (const choice of perkMatches) {
    addChoice(choice);
  }

  // Priority 3: guarantee at least one boss-weakening tactic if present in Boss Phase 1 pool
  if (!picked.some((c) => c.weakenBoss)) {
    const weakenCandidate = eligible.find((c) => !pickedIds.has(c.id) && c.weakenBoss);
    if (weakenCandidate) {
      addChoice(weakenCandidate);
    }
  }

  // Priority 4: fill remaining slots maximizing stat/bribe variety & affordability
  while (picked.length < TABLETOP_MAX_CHOICES) {
    const remaining = eligible.filter((c) => !pickedIds.has(c.id));
    if (remaining.length === 0) break;

    let best = remaining[0]!;
    let bestScore = -Infinity;

    for (const candidate of remaining) {
      let score = 0;
      const effectiveCost =
        candidate.creditPerk === 'high_free' && creditScore >= 850
          ? 0
          : scaleBribeCoinCost(candidate.coinCost, chapter);
      const affordable = pocketCoins >= effectiveCost;

      if (candidate.stat) {
        score += usedStats.has(candidate.stat) ? 10 : 40;
      } else {
        score += hasNonStat ? 5 : affordable ? 35 : 15;
      }

      if (effectiveCost > 0) {
        score += affordable ? 8 : -12;
      }

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    addChoice(best);
  }

  return picked;
}

export function computeChoicePreview(input: ComputeChoicePreviewInput): TabletopChoicePreview {
  const { choice, attrs, creditScore, pocketCoins, chapter, bossStage, bossWeakened } = input;
  const isGoldFreePass = choice.creditPerk === 'high_free' && creditScore >= 850;
  const coinCost = isGoldFreePass ? 0 : scaleBribeCoinCost(choice.coinCost, chapter);
  const canAfford = pocketCoins >= coinCost;

  if (isGoldFreePass) {
    return {
      choiceId: choice.id,
      stat: choice.stat,
      effectiveDc: null,
      statModifier: choice.stat ? getStatModifier(attrs, choice.stat) : 0,
      petBonus: 0,
      creditPerkBonus: 0,
      totalModifier: 0,
      coinCost: 0,
      canAfford: true,
      autoSuccess: true,
      successChancePct: 100,
      creditPerkActive: true,
      creditPerkTag: '金卡免检',
    };
  }

  if (!choice.stat) {
    return {
      choiceId: choice.id,
      effectiveDc: null,
      statModifier: 0,
      petBonus: 0,
      creditPerkBonus: 0,
      totalModifier: 0,
      coinCost,
      canAfford,
      autoSuccess: true,
      successChancePct: 100,
      creditPerkActive: false,
    };
  }

  const applyBossWeaken = Boolean(bossWeakened && (bossStage === undefined || bossStage === 2));
  const rawDc = scaleChapterDc(choice.dc ?? 12, chapter);
  const effectiveDc = Math.max(2, rawDc - (applyBossWeaken ? BOSS_WEAKEN_DC_REDUCTION : 0));

  const statModifier = getStatModifier(attrs, choice.stat);
  const petBonus = attrs.petCheckBonus;

  let creditPerkBonus = 0;
  let creditPerkActive = false;
  let creditPerkTag: string | undefined;

  if (choice.creditPerk === 'high_free' && creditScore >= 700) {
    creditPerkBonus = 5;
    creditPerkActive = true;
    creditPerkTag = '白金信誉+5';
  } else if (choice.creditPerk === 'deadbeat_intimidate' && creditScore < 500) {
    creditPerkBonus = 4;
    creditPerkActive = true;
    creditPerkTag = '老赖威慑+4';
  }

  const totalModifier = statModifier + petBonus + creditPerkBonus;

  // Exact D20 win probability:
  // Nat 20 always succeeds, Nat 1 always fails; faces 2..19 succeed iff roll + mod >= effectiveDc.
  const minRollNeeded = Math.max(2, Math.min(20, effectiveDc - totalModifier));
  const winningFaces = 21 - minRollNeeded; // 1..19
  const successChancePct = winningFaces * 5; // 5..95

  return {
    choiceId: choice.id,
    stat: choice.stat,
    effectiveDc,
    statModifier,
    petBonus,
    creditPerkBonus,
    totalModifier,
    coinCost,
    canAfford,
    autoSuccess: false,
    successChancePct,
    creditPerkActive,
    ...(creditPerkTag ? { creditPerkTag } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tabletop Run State & Seamless Act Resolution
// ---------------------------------------------------------------------------

export interface TabletopPublicHighlight {
  kind: 'nat20' | 'nat1';
  headline: string;
  body: string;
}

export interface TabletopRollOutcome {
  choiceId: string;
  choiceLabel: string;
  stat?: TabletopStatKey;
  rolled: number | null;
  modifier: number;
  total: number | null;
  dc: number | null;
  outcome: 'auto' | 'crit_success' | 'success' | 'fail' | 'crit_fail';
  narrative: string;
  petLine?: string;
  coinsDelta: number;
  xpDelta: number;
  hpDelta: number;
  itemDroppedLabel?: string;
  publicHighlight?: TabletopPublicHighlight;
}

export interface TabletopRunState {
  mode: 'tabletop';
  chapter: number;
  act: number;
  bossStage: 0 | 1 | 2;
  bossWeakened: boolean;
  classKey: RpgClassKey;
  playerHp: number;
  playerMaxHp: number;
  potionsLeft: number;
  attrs: TabletopAttributes;
  creditScore: number;
  petSynergy: PetSynergyInfo | null;
  pendingCoins: number;
  pendingXp: number;
  pendingItems: RpgPendingItem[];
  usedSceneIds: string[];
  currentSceneId: string;
  currentChoiceIds: string[];
  lastOutcome: TabletopRollOutcome | null;
}

export interface CreateTabletopRunInput {
  chapter: number;
  classKey: RpgClassKey;
  level: number;
  maxHp: number;
  atk: number;
  def: number;
  critBp: number;
  dodgeBp: number;
  creditScore: number;
  petSynergy: PetSynergyInfo | null;
  pocketCoins: number;
  potionsLeft?: number;
  catalog: TabletopCatalog;
  rng?: () => number;
}

export type TabletopItemGenerator = (
  chapter: number,
  source: 'monster' | 'elite' | 'chest' | 'event' | 'boss',
  rng: () => number,
  minRarity?: RpgItemRarity,
) => RpgPendingItem;

export interface ResolveTabletopChoiceInput {
  state: TabletopRunState;
  choiceId: string;
  pocketCoins: number;
  catalog: TabletopCatalog;
  rng?: () => number;
  generateItem?: TabletopItemGenerator;
}

export type ResolveTabletopChoiceResult =
  | {
      ok: false;
      reason: 'invalid_choice';
    }
  | {
      ok: false;
      reason: 'insufficient_coins';
      requiredCoins: number;
    }
  | {
      ok: true;
      status: 'ongoing';
      state: TabletopRunState;
      outcome: TabletopRollOutcome;
      coinsSpent: number;
    }
  | {
      ok: true;
      status: 'victory';
      state: TabletopRunState;
      outcome: TabletopRollOutcome;
      coinsSpent: number;
      victoryEpilogue: string;
    }
  | {
      ok: true;
      status: 'defeat';
      state: TabletopRunState;
      outcome: TabletopRollOutcome;
      coinsSpent: number;
      lostLoot: { coins: number; xp: number; itemCount: number };
    };

export type DrinkTabletopPotionResult =
  | {
      ok: true;
      state: TabletopRunState;
      healed: number;
    }
  | {
      ok: false;
      reason: 'no_potions_left' | 'already_full_hp';
    };

export interface CurrentTabletopView {
  sceneId: string;
  title: string;
  emoji: string;
  narrative: string;
  choices: readonly TabletopChoiceDef[];
  isBoss: boolean;
  bossStage: 0 | 1 | 2;
  bossName?: string;
  bossEmoji?: string;
}

const RARITY_STAT_MULT: Record<RpgItemRarity, number> = {
  common: 1.0,
  uncommon: 1.35,
  rare: 1.8,
  epic: 2.4,
  legendary: 3.3,
};

const TABLETOP_ITEM_NAMES: Record<RpgItemSlot, Record<RpgItemRarity, readonly string[]>> = {
  weapon: {
    common: ['铁制短剑', '橡木法杖', '猎人木弓'],
    uncommon: ['精钢长剑', '秘银魔杖', '复合长弓'],
    rare: ['圣殿巨剑', '星辉权杖', '疾风猎弓'],
    epic: ['龙炎魔刃', '虚空星杖', '暗影追魂弓'],
    legendary: ['晨曦裁决者', '阿卡纳永恒法典', '弑神星陨弓'],
  },
  armor: {
    common: ['皮质轻甲', '粗布法袍', '锁链护胸'],
    uncommon: ['精钢锁甲', '符文法袍', '猎风皮铠'],
    rare: ['银月板甲', '秘法圣袍', '影步轻铠'],
    epic: ['龙鳞圣铠', '星穹大魔导袍', '夜枭幽影甲'],
    legendary: ['永恒神佑战甲', '深渊星织圣袍', '不灭圣殿龙铠'],
  },
  accessory: {
    common: ['铜制指环', '幸运四叶草', '冒险者徽章'],
    uncommon: ['翠玉护符', '银质战戒', '旅人怀表'],
    rare: ['星辉吊坠', '狮心勋章', '圣银念珠'],
    epic: ['猩红血戒', '古龙之眼', '秘银龙牙坠'],
    legendary: ['深渊星辰之心', '神王传承之戒', '创世圣辉护符'],
  },
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999999, Math.max(0, value));
}

function pickFrom<T>(list: readonly T[], rng: () => number): T {
  const idx = Math.min(list.length - 1, Math.floor(clampUnit(rng()) * list.length));
  return list[idx]!;
}

export function rollD20(rng: () => number = Math.random): number {
  return Math.floor(clampUnit(rng()) * 20) + 1;
}

export function getBossSceneId(chapter: number, stage: 1 | 2): string {
  return `boss:ch${chapter}:p${stage}`;
}

export function isTabletopRunState(value: unknown): value is TabletopRunState {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Partial<TabletopRunState>;
  return (
    obj.mode === 'tabletop' &&
    typeof obj.chapter === 'number' &&
    typeof obj.act === 'number' &&
    (obj.bossStage === 0 || obj.bossStage === 1 || obj.bossStage === 2) &&
    typeof obj.playerHp === 'number' &&
    typeof obj.playerMaxHp === 'number' &&
    typeof obj.currentSceneId === 'string' &&
    Array.isArray(obj.currentChoiceIds)
  );
}

function rollTabletopItemRarity(
  chapter: number,
  source: 'monster' | 'elite' | 'chest' | 'event' | 'boss',
  rng: () => number,
): RpgItemRarity {
  const r = clampUnit(rng());
  const chOffset = Math.max(0, chapter - 1);

  if (source === 'boss') {
    if (r >= Math.max(0.75, 0.96 - chOffset * 0.04)) return 'legendary';
    if (r >= Math.max(0.45, 0.78 - chOffset * 0.06)) return 'epic';
    if (r >= Math.max(0.18, 0.45 - chOffset * 0.05)) return 'rare';
    return 'uncommon';
  }

  if (r >= Math.max(0.88, 0.985 - chOffset * 0.02)) return 'legendary';
  if (r >= Math.max(0.62, 0.86 - chOffset * 0.045)) return 'epic';
  if (r >= Math.max(0.32, 0.58 - chOffset * 0.05)) return 'rare';
  if (r >= 0.12) return 'uncommon';
  return 'common';
}

export function generateTabletopPendingItem(
  chapter: number,
  source: 'monster' | 'elite' | 'chest' | 'event' | 'boss',
  rng: () => number,
  minRarity?: RpgItemRarity,
): RpgPendingItem {
  const slots: readonly RpgItemSlot[] = ['weapon', 'armor', 'accessory'];
  const slot = pickFrom(slots, rng);
  let rarity = rollTabletopItemRarity(chapter, source, rng);
  if (minRarity && RARITY_ORDER[rarity] < RARITY_ORDER[minRarity]) {
    rarity = minRarity;
  }

  const name = pickFrom(TABLETOP_ITEM_NAMES[slot][rarity], rng);
  const chapterScale = 1 + Math.max(0, chapter - 1) * 0.65;
  const rarityScale = RARITY_STAT_MULT[rarity];
  const variance = 0.9 + clampUnit(rng()) * 0.2;
  const power = chapterScale * rarityScale * variance;

  if (slot === 'weapon') {
    return {
      name,
      slot,
      rarity,
      baseHp: Math.round(8 * power),
      baseAtk: Math.max(4, Math.round(10 * power)),
      baseDef: Math.round(1 * power),
      baseCritBp: Math.min(2500, Math.round(180 * rarityScale + chapter * 35)),
    };
  }
  if (slot === 'armor') {
    return {
      name,
      slot,
      rarity,
      baseHp: Math.max(18, Math.round(40 * power)),
      baseAtk: 0,
      baseDef: Math.max(3, Math.round(7 * power)),
      baseCritBp: 0,
    };
  }
  return {
    name,
    slot,
    rarity,
    baseHp: Math.max(12, Math.round(22 * power)),
    baseAtk: Math.max(2, Math.round(5 * power)),
    baseDef: Math.max(1, Math.round(3 * power)),
    baseCritBp: Math.min(3000, Math.round(260 * rarityScale + chapter * 45)),
  };
}

function findBossAct(catalog: TabletopCatalog, chapter: number): TabletopBossActDef | null {
  return catalog.bossActs.find((b) => b.chapter === chapter) ?? null;
}

function pickNextActScene(
  catalog: TabletopCatalog,
  chapter: number,
  act: number,
  usedSceneIds: readonly string[],
  rng: () => number,
): TabletopSceneDef {
  const used = new Set(usedSceneIds);
  const unseenChapter = catalog.scenes.filter((s) => s.chapter === chapter && !used.has(s.id));
  const unseenShared = catalog.scenes.filter((s) => s.chapter === 'shared' && !used.has(s.id));

  // Act 1 & Act 3 favor chapter-specific scenes to anchor the chapter's identity;
  // Act 2 favors shared dark-humor encounters; Act 4 mixes both pools.
  if (act === 1) {
    if (unseenChapter.length > 0) return pickFrom(unseenChapter, rng);
    if (unseenShared.length > 0) return pickFrom(unseenShared, rng);
  } else if (act === 2) {
    if (unseenShared.length > 0) return pickFrom(unseenShared, rng);
    if (unseenChapter.length > 0) return pickFrom(unseenChapter, rng);
  } else if (act === 3) {
    if (unseenChapter.length > 0) return pickFrom(unseenChapter, rng);
    if (unseenShared.length > 0) return pickFrom(unseenShared, rng);
  } else {
    const combined = [...unseenChapter, ...unseenShared];
    if (combined.length > 0) return pickFrom(combined, rng);
  }

  // Fallback if catalog pool was smaller than 4 unique scenes
  const allEligible = catalog.scenes.filter(
    (s) => s.chapter === chapter || s.chapter === 'shared',
  );
  if (allEligible.length > 0) return pickFrom(allEligible, rng);
  if (catalog.scenes.length > 0) return pickFrom(catalog.scenes, rng);

  throw new Error(`No tabletop scenes available for chapter ${chapter}`);
}

export function getCurrentTabletopView(
  state: TabletopRunState,
  catalog: TabletopCatalog,
): CurrentTabletopView | null {
  if (state.bossStage === 1 || state.bossStage === 2) {
    const bossAct = findBossAct(catalog, state.chapter);
    if (!bossAct) return null;
    const pool = state.bossStage === 1 ? bossAct.phase1Choices : bossAct.phase2Choices;
    const choiceMap = new Map(pool.map((c) => [c.id, c]));
    const selectedChoices = state.currentChoiceIds
      .map((id) => choiceMap.get(id))
      .filter((c): c is TabletopChoiceDef => c !== undefined);

    return {
      sceneId: state.currentSceneId,
      title: state.bossStage === 1 ? bossAct.phase1Title : bossAct.phase2Title,
      emoji: bossAct.bossEmoji,
      narrative: state.bossStage === 1 ? bossAct.phase1Narrative : bossAct.phase2Narrative,
      choices: selectedChoices,
      isBoss: true,
      bossStage: state.bossStage,
      bossName: bossAct.bossName,
      bossEmoji: bossAct.bossEmoji,
    };
  }

  const scene = catalog.scenes.find((s) => s.id === state.currentSceneId);
  if (!scene) return null;
  const choiceMap = new Map(scene.choices.map((c) => [c.id, c]));
  const selectedChoices = state.currentChoiceIds
    .map((id) => choiceMap.get(id))
    .filter((c): c is TabletopChoiceDef => c !== undefined);

  return {
    sceneId: scene.id,
    title: scene.title,
    emoji: scene.emoji,
    narrative: scene.narrative,
    choices: selectedChoices,
    isBoss: false,
    bossStage: 0,
  };
}

export function createInitialTabletopRun(input: CreateTabletopRunInput): TabletopRunState {
  const rng = input.rng ?? Math.random;
  const attrs = deriveTabletopAttributes({
    classKey: input.classKey,
    level: input.level,
    maxHp: input.maxHp,
    atk: input.atk,
    def: input.def,
    critBp: input.critBp,
    dodgeBp: input.dodgeBp,
    creditScore: input.creditScore,
    petSynergy: input.petSynergy,
  });

  const firstScene = pickNextActScene(input.catalog, input.chapter, 1, [], rng);
  const selectedChoices = selectSceneChoices({
    choices: firstScene.choices,
    classKey: input.classKey,
    creditScore: input.creditScore,
    pocketCoins: input.pocketCoins,
    chapter: input.chapter,
    bossWeakened: false,
  });

  const maxHp = Math.max(1, Math.round(input.maxHp));
  return {
    mode: 'tabletop',
    chapter: input.chapter,
    act: 1,
    bossStage: 0,
    bossWeakened: false,
    classKey: input.classKey,
    playerHp: maxHp,
    playerMaxHp: maxHp,
    potionsLeft: input.potionsLeft ?? RUN_INITIAL_POTIONS,
    attrs,
    creditScore: input.creditScore,
    petSynergy: input.petSynergy,
    pendingCoins: 0,
    pendingXp: 0,
    pendingItems: [],
    usedSceneIds: [firstScene.id],
    currentSceneId: firstScene.id,
    currentChoiceIds: selectedChoices.map((c) => c.id),
    lastOutcome: null,
  };
}

function buildPetLine(input: {
  pet: PetSynergyInfo | null;
  petBonus: number;
  rolled: number | null;
  total: number | null;
  dc: number | null;
  totalModifier: number;
  outcome: TabletopRollOutcome['outcome'];
}): string | undefined {
  const { pet, petBonus, rolled, total, dc, totalModifier, outcome } = input;
  if (!pet || petBonus <= 0 || rolled === null || total === null || dc === null) {
    return undefined;
  }

  const withoutPetTotal = rolled + (totalModifier - petBonus);
  if (outcome === 'crit_success') {
    return `${pet.emoji} ${pet.nickname}默契配合打出天选连携，检定 +${petBonus}！`;
  }
  if (outcome === 'success' && withoutPetTotal < dc && total >= dc) {
    return `${pet.emoji} ${pet.nickname}在关键时刻挺身助攻，检定 +${petBonus} 惊险翻盘！`;
  }
  if (outcome === 'success') {
    return `${pet.emoji} ${pet.nickname}在一旁机灵助阵，检定 +${petBonus}！`;
  }
  if (outcome === 'crit_fail') {
    return `${pet.emoji} ${pet.nickname}试图冲上去救场，结果和你一起摔进了泥坑……`;
  }
  return undefined;
}

export function resolveTabletopChoice(
  input: ResolveTabletopChoiceInput,
): ResolveTabletopChoiceResult {
  const { state, choiceId, pocketCoins, catalog } = input;
  const rng = input.rng ?? Math.random;
  const generateItem = input.generateItem ?? generateTabletopPendingItem;

  if (!state.currentChoiceIds.includes(choiceId)) {
    return { ok: false, reason: 'invalid_choice' };
  }

  const currentView = getCurrentTabletopView(state, catalog);
  if (!currentView) {
    return { ok: false, reason: 'invalid_choice' };
  }

  const choice = currentView.choices.find((c) => c.id === choiceId);
  if (!choice) {
    return { ok: false, reason: 'invalid_choice' };
  }

  const preview = computeChoicePreview({
    choice,
    attrs: state.attrs,
    creditScore: state.creditScore,
    pocketCoins,
    chapter: state.chapter,
    bossStage: state.bossStage,
    bossWeakened: state.bossWeakened,
  });

  if (preview.coinCost > 0 && pocketCoins < preview.coinCost) {
    return {
      ok: false,
      reason: 'insufficient_coins',
      requiredCoins: preview.coinCost,
    };
  }

  const coinsSpent = preview.coinCost;
  const remainingPocketCoins = Math.max(0, pocketCoins - coinsSpent);

  // Determine D20 roll & outcome
  let rolled: number | null = null;
  let total: number | null = null;
  const dc: number | null = preview.effectiveDc;
  let outcomeKind: TabletopRollOutcome['outcome'];
  let narrative: string;

  if (preview.autoSuccess) {
    outcomeKind = 'auto';
    narrative = choice.successText;
  } else {
    rolled = rollD20(rng);
    total = rolled + preview.totalModifier;
    const targetDc = dc ?? 12;

    if (rolled === 20) {
      outcomeKind = 'crit_success';
      narrative = choice.critSuccessText;
    } else if (rolled === 1) {
      outcomeKind = 'crit_fail';
      narrative = choice.critFailText;
    } else if (total >= targetDc) {
      outcomeKind = 'success';
      narrative = choice.successText;
    } else {
      outcomeKind = 'fail';
      narrative = choice.failText;
    }
  }

  const succeeded =
    outcomeKind === 'auto' || outcomeKind === 'success' || outcomeKind === 'crit_success';

  const chapterDef = RPG_CHAPTER_MAP.get(state.chapter);
  const clearBaseCoins = chapterDef?.clearBaseCoins ?? 8000;
  const clearBaseXp = chapterDef?.clearBaseXp ?? 120;
  const actBaseCoins = Math.round(clearBaseCoins * 0.22);
  const actBaseXp = Math.round(clearBaseXp * 0.25);

  let rewardCoins = 0;
  let rewardXp = 0;
  let newHp = state.playerHp;
  let itemDroppedLabel: string | undefined;
  const nextPendingItems = [...state.pendingItems];

  if (succeeded) {
    const critMult = outcomeKind === 'crit_success' ? 2 : 1;
    rewardCoins = Math.max(0, Math.round(actBaseCoins * choice.rewardCoinsMult * critMult));
    rewardXp = Math.max(0, Math.round(actBaseXp * choice.rewardXpMult * critMult));

    if (choice.healPctOnSuccess && choice.healPctOnSuccess > 0) {
      const healRatio =
        outcomeKind === 'crit_success'
          ? Math.min(1, choice.healPctOnSuccess * 1.5)
          : choice.healPctOnSuccess;
      const healAmt = Math.max(1, Math.round(state.playerMaxHp * healRatio));
      newHp = Math.min(state.playerMaxHp, state.playerHp + healAmt);
    }

    if (choice.dropChance > 0) {
      const shouldDrop =
        outcomeKind === 'crit_success' ? true : clampUnit(rng()) < choice.dropChance;
      if (shouldDrop) {
        const dropSource = state.bossStage > 0 ? 'boss' : 'event';
        const minRarity: RpgItemRarity | undefined =
          outcomeKind === 'crit_success' ? 'uncommon' : undefined;
        const item = generateItem(state.chapter, dropSource, rng, minRarity);
        nextPendingItems.push(item);
        const meta = RARITY_META[item.rarity];
        itemDroppedLabel = `${meta.emoji} ${item.name}`;
      }
    }
  } else {
    const rawPct =
      outcomeKind === 'crit_fail'
        ? Math.max(choice.critFailHpPct, choice.failHpPct)
        : choice.failHpPct;
    const minDamage = outcomeKind === 'crit_fail' ? 2 : 1;
    const hpLoss = Math.max(minDamage, Math.round(state.playerMaxHp * Math.max(0, rawPct)));
    newHp = Math.max(0, state.playerHp - hpLoss);
  }

  const hpDelta = newHp - state.playerHp;
  const coinsDelta = rewardCoins - coinsSpent;

  const petLine = buildPetLine({
    pet: state.petSynergy,
    petBonus: preview.petBonus,
    rolled,
    total,
    dc,
    totalModifier: preview.totalModifier,
    outcome: outcomeKind,
  });

  let publicHighlight: TabletopPublicHighlight | undefined;
  if (outcomeKind === 'crit_success') {
    publicHighlight = {
      kind: 'nat20',
      headline: '🎲 大成功 NAT 20！命运女神亲自掀桌！',
      body: `在「${currentView.title}」选择「${choice.label}」掷出天选 20（+${preview.totalModifier}），战利品翻倍！`,
    };
  } else if (outcomeKind === 'crit_fail') {
    publicHighlight = {
      kind: 'nat1',
      headline: '💀 大失败 NAT 1！全场陷入死寂！',
      body: `在「${currentView.title}」选择「${choice.label}」掷出史诗级 1 点，惨遭反噬损失 ${Math.abs(hpDelta)} HP！`,
    };
  }

  const outcome: TabletopRollOutcome = {
    choiceId: choice.id,
    choiceLabel: choice.label,
    ...(choice.stat ? { stat: choice.stat } : {}),
    rolled,
    modifier: preview.totalModifier,
    total,
    dc,
    outcome: outcomeKind,
    narrative,
    ...(petLine ? { petLine } : {}),
    coinsDelta,
    xpDelta: rewardXp,
    hpDelta,
    ...(itemDroppedLabel ? { itemDroppedLabel } : {}),
    ...(publicHighlight ? { publicHighlight } : {}),
  };

  const nextPendingCoins = state.pendingCoins + rewardCoins;
  const nextPendingXp = state.pendingXp + rewardXp;

  // Check defeat first
  if (newHp <= 0) {
    const defeatedState: TabletopRunState = {
      ...state,
      playerHp: 0,
      pendingCoins: nextPendingCoins,
      pendingXp: nextPendingXp,
      pendingItems: nextPendingItems,
      lastOutcome: outcome,
    };
    return {
      ok: true,
      status: 'defeat',
      state: defeatedState,
      outcome,
      coinsSpent,
      lostLoot: {
        coins: defeatedState.pendingCoins,
        xp: defeatedState.pendingXp,
        itemCount: defeatedState.pendingItems.length,
      },
    };
  }

  // Seamless Act Progression
  // 1) Acts 1..3 -> advance immediately to Act + 1 with an unseen scene
  if (state.bossStage === 0 && state.act < 4) {
    const nextAct = state.act + 1;
    const nextScene = pickNextActScene(catalog, state.chapter, nextAct, state.usedSceneIds, rng);
    const nextChoices = selectSceneChoices({
      choices: nextScene.choices,
      classKey: state.classKey,
      creditScore: state.creditScore,
      pocketCoins: remainingPocketCoins,
      chapter: state.chapter,
      bossWeakened: false,
    });

    const nextState: TabletopRunState = {
      ...state,
      act: nextAct,
      bossStage: 0,
      bossWeakened: false,
      playerHp: newHp,
      pendingCoins: nextPendingCoins,
      pendingXp: nextPendingXp,
      pendingItems: nextPendingItems,
      usedSceneIds: [...state.usedSceneIds, nextScene.id],
      currentSceneId: nextScene.id,
      currentChoiceIds: nextChoices.map((c) => c.id),
      lastOutcome: outcome,
    };

    return {
      ok: true,
      status: 'ongoing',
      state: nextState,
      outcome,
      coinsSpent,
    };
  }

  const bossAct = findBossAct(catalog, state.chapter);
  if (!bossAct) {
    throw new Error(`Missing TabletopBossActDef for chapter ${state.chapter}`);
  }

  // 2) Act 4 -> transition immediately to Act 5 Boss Phase 1
  if (state.bossStage === 0 && state.act >= 4) {
    const phase1Choices = selectSceneChoices({
      choices: bossAct.phase1Choices,
      classKey: state.classKey,
      creditScore: state.creditScore,
      pocketCoins: remainingPocketCoins,
      chapter: state.chapter,
      bossWeakened: false,
    });

    const nextState: TabletopRunState = {
      ...state,
      act: 5,
      bossStage: 1,
      bossWeakened: false,
      playerHp: newHp,
      pendingCoins: nextPendingCoins,
      pendingXp: nextPendingXp,
      pendingItems: nextPendingItems,
      currentSceneId: getBossSceneId(state.chapter, 1),
      currentChoiceIds: phase1Choices.map((c) => c.id),
      lastOutcome: outcome,
    };

    return {
      ok: true,
      status: 'ongoing',
      state: nextState,
      outcome,
      coinsSpent,
    };
  }

  // 3) Act 5 Boss Phase 1 -> transition immediately to Boss Phase 2
  if (state.bossStage === 1) {
    const nextBossWeakened = Boolean(choice.weakenBoss && succeeded);
    const phase2Choices = selectSceneChoices({
      choices: bossAct.phase2Choices,
      classKey: state.classKey,
      creditScore: state.creditScore,
      pocketCoins: remainingPocketCoins,
      chapter: state.chapter,
      bossWeakened: nextBossWeakened,
    });

    const nextState: TabletopRunState = {
      ...state,
      act: 5,
      bossStage: 2,
      bossWeakened: nextBossWeakened,
      playerHp: newHp,
      pendingCoins: nextPendingCoins,
      pendingXp: nextPendingXp,
      pendingItems: nextPendingItems,
      currentSceneId: getBossSceneId(state.chapter, 2),
      currentChoiceIds: phase2Choices.map((c) => c.id),
      lastOutcome: outcome,
    };

    return {
      ok: true,
      status: 'ongoing',
      state: nextState,
      outcome,
      coinsSpent,
    };
  }

  // 4) Act 5 Boss Phase 2 -> Victory on success; stay in Phase 2 on non-fatal fail for dramatic retry!
  if (succeeded) {
    const victoryState: TabletopRunState = {
      ...state,
      act: 5,
      bossStage: 2,
      playerHp: newHp,
      pendingCoins: nextPendingCoins,
      pendingXp: nextPendingXp,
      pendingItems: nextPendingItems,
      lastOutcome: outcome,
    };

    return {
      ok: true,
      status: 'victory',
      state: victoryState,
      outcome,
      coinsSpent,
      victoryEpilogue: bossAct.victoryEpilogue,
    };
  }

  // Non-fatal fail in Boss Phase 2: stay in Phase 2 while HP > 0
  const retryChoices = selectSceneChoices({
    choices: bossAct.phase2Choices,
    classKey: state.classKey,
    creditScore: state.creditScore,
    pocketCoins: remainingPocketCoins,
    chapter: state.chapter,
    bossWeakened: state.bossWeakened,
  });

  const retryState: TabletopRunState = {
    ...state,
    act: 5,
    bossStage: 2,
    playerHp: newHp,
    pendingCoins: nextPendingCoins,
    pendingXp: nextPendingXp,
    pendingItems: nextPendingItems,
    currentSceneId: getBossSceneId(state.chapter, 2),
    currentChoiceIds: retryChoices.map((c) => c.id),
    lastOutcome: outcome,
  };

  return {
    ok: true,
    status: 'ongoing',
    state: retryState,
    outcome,
    coinsSpent,
  };
}

export function drinkTabletopPotion(state: TabletopRunState): DrinkTabletopPotionResult {
  if (state.potionsLeft <= 0) {
    return { ok: false, reason: 'no_potions_left' };
  }
  if (state.playerHp >= state.playerMaxHp) {
    return { ok: false, reason: 'already_full_hp' };
  }

  const healAmount = Math.max(1, Math.round(state.playerMaxHp * POTION_HEAL_RATIO));
  const nextHp = Math.min(state.playerMaxHp, state.playerHp + healAmount);
  const healed = nextHp - state.playerHp;

  const nextState: TabletopRunState = {
    ...state,
    playerHp: nextHp,
    potionsLeft: state.potionsLeft - 1,
  };

  return {
    ok: true,
    state: nextState,
    healed,
  };
}
