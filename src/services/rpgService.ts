import type Database from 'better-sqlite3';
import type { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import type { ProfileRepo } from '../db/repositories/profileRepo.js';
import type {
  RpgCharacter,
  RpgClassKey,
  RpgItem,
  RpgItemRarity,
  RpgItemSlot,
  RpgRepo,
} from '../db/repositories/rpgRepo.js';
import type { PetRarity, SocialPetRepo, UserPet } from '../db/repositories/socialPetRepo.js';
import { getDateKey } from './economyService.js';
import { PET_SPECIES_MAP } from './socialPetService.js';

export interface RpgConfig {
  dailyStamina: number;
  staminaPotionPrice: number;
  staminaPotionDailyLimit: number;
  classSwitchCost: number;
  bagCapacity: number;
}

export const DEFAULT_RPG_CONFIG: RpgConfig = {
  dailyStamina: 5,
  staminaPotionPrice: 3000,
  staminaPotionDailyLimit: 3,
  classSwitchCost: 10000,
  bagCapacity: 30,
};

export interface RpgClassDef {
  key: RpgClassKey;
  name: string;
  emoji: string;
  description: string;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseCritBp: number;
  baseDodgeBp: number;
  hpPerLevel: number;
  atkPerLevel: number;
  defPerLevel: number;
  critBpPerLevel: number;
  skillName: string;
  skillDescription: string;
  skillCooldown: number;
}

export const RPG_CLASSES: readonly RpgClassDef[] = [
  {
    key: 'warrior',
    name: '圣殿战士',
    emoji: '⚔️',
    description: '高血量高防御，重甲冲锋破甲压制',
    baseHp: 170,
    baseAtk: 24,
    baseDef: 14,
    baseCritBp: 1000,
    baseDodgeBp: 500,
    hpPerLevel: 26,
    atkPerLevel: 4.5,
    defPerLevel: 2.8,
    critBpPerLevel: 25,
    skillName: '破军重斩',
    skillDescription: '1.85倍攻击并破甲2回合（敌防-30%）',
    skillCooldown: 2,
  },
  {
    key: 'mage',
    name: '奥术法师',
    emoji: '🔮',
    description: '极致法伤高暴击，陨星火球必中灼烧',
    baseHp: 115,
    baseAtk: 34,
    baseDef: 7,
    baseCritBp: 1600,
    baseDodgeBp: 700,
    hpPerLevel: 16,
    atkPerLevel: 6.2,
    defPerLevel: 1.5,
    critBpPerLevel: 45,
    skillName: '陨星火球',
    skillDescription: '2.2倍必中攻击并附加2回合灼烧',
    skillCooldown: 3,
  },
  {
    key: 'ranger',
    name: '暗影游侠',
    emoji: '🏹',
    description: '高暴击高闪避，穿云连射双段收割',
    baseHp: 130,
    baseAtk: 29,
    baseDef: 9,
    baseCritBp: 2000,
    baseDodgeBp: 1500,
    hpPerLevel: 19,
    atkPerLevel: 5.4,
    defPerLevel: 1.8,
    critBpPerLevel: 55,
    skillName: '穿云连射',
    skillDescription: '两段1.05倍攻击，每段额外+25%暴击率',
    skillCooldown: 2,
  },
  {
    key: 'paladin',
    name: '辉光圣骑士',
    emoji: '🛡️',
    description: '攻守均衡强续航，圣光裁决攻防一体',
    baseHp: 155,
    baseAtk: 25,
    baseDef: 12,
    baseCritBp: 1200,
    baseDodgeBp: 600,
    hpPerLevel: 23,
    atkPerLevel: 4.8,
    defPerLevel: 2.4,
    critBpPerLevel: 30,
    skillName: '圣光裁决',
    skillDescription: '1.55倍攻击并回复22%最大生命',
    skillCooldown: 3,
  },
];

export const RPG_CLASS_MAP: ReadonlyMap<RpgClassKey, RpgClassDef> = new Map(
  RPG_CLASSES.map((c) => [c.key, c]),
);

export interface RpgEnemyTemplate {
  name: string;
  emoji: string;
  hp: number;
  atk: number;
  def: number;
  skillName?: string;
}

export interface RpgChapterDef {
  chapter: number;
  name: string;
  emoji: string;
  recommendedLevel: number;
  floors: number;
  clearBaseCoins: number;
  clearBaseXp: number;
  firstClearMultiplier: number;
  boss: RpgEnemyTemplate;
  monsters: readonly RpgEnemyTemplate[];
  elites: readonly RpgEnemyTemplate[];
}

export const FLOORS_PER_CHAPTER = 5;
export const MAX_ENHANCE_LEVEL = 10;
export const RUN_INITIAL_POTIONS = 3;

export const RPG_CHAPTERS: readonly RpgChapterDef[] = [
  {
    chapter: 1,
    name: '哥布林密林',
    emoji: '🌲',
    recommendedLevel: 1,
    floors: FLOORS_PER_CHAPTER,
    clearBaseCoins: 8000,
    clearBaseXp: 120,
    firstClearMultiplier: 2,
    boss: {
      name: '哥布林酋长·格鲁克',
      emoji: '👑',
      hp: 195,
      atk: 26,
      def: 8,
      skillName: '部落咆哮重击',
    },
    monsters: [
      { name: '哥布林斥候', emoji: '👺', hp: 78, atk: 17, def: 4 },
      { name: '毒牙森林狼', emoji: '🐺', hp: 85, atk: 19, def: 4 },
      { name: '哥布林投矛手', emoji: '🏹', hp: 72, atk: 20, def: 3 },
    ],
    elites: [
      { name: '狂暴哥布林萨满', emoji: '🪄', hp: 122, atk: 23, def: 6 },
      { name: '巨型苔原熊', emoji: '🐻', hp: 138, atk: 21, def: 8 },
    ],
  },
  {
    chapter: 2,
    name: '亡灵墓穴',
    emoji: '💀',
    recommendedLevel: 3,
    floors: FLOORS_PER_CHAPTER,
    clearBaseCoins: 15000,
    clearBaseXp: 240,
    firstClearMultiplier: 2,
    boss: {
      name: '骸骨领主·莫德雷德',
      emoji: '💀',
      hp: 360,
      atk: 45,
      def: 16,
      skillName: '冥界斩魂',
    },
    monsters: [
      { name: '游荡骷髅兵', emoji: '🦴', hp: 150, atk: 30, def: 10 },
      { name: '腐朽食尸鬼', emoji: '🧟', hp: 165, atk: 32, def: 9 },
      { name: '幽冥怨灵', emoji: '👻', hp: 140, atk: 34, def: 8 },
    ],
    elites: [
      { name: '死亡骑士侍从', emoji: '⚔️', hp: 225, atk: 39, def: 14 },
      { name: '白骨死灵法师', emoji: '🔮', hp: 205, atk: 42, def: 11 },
    ],
  },
  {
    chapter: 3,
    name: '猩红血堡',
    emoji: '🏰',
    recommendedLevel: 6,
    floors: FLOORS_PER_CHAPTER,
    clearBaseCoins: 26000,
    clearBaseXp: 420,
    firstClearMultiplier: 2,
    boss: {
      name: '血族伯爵·弗拉德',
      emoji: '🧛',
      hp: 600,
      atk: 72,
      def: 26,
      skillName: '猩红盛宴',
    },
    monsters: [
      { name: '嗜血蝙蝠群', emoji: '🦇', hp: 255, atk: 50, def: 16 },
      { name: '血裔侍卫', emoji: '🗡️', hp: 280, atk: 52, def: 20 },
      { name: '猩红魔偶', emoji: '🗿', hp: 300, atk: 48, def: 22 },
    ],
    elites: [
      { name: '血月刺客', emoji: '🩸', hp: 370, atk: 64, def: 22 },
      { name: '猩红大祭司', emoji: '🕯️', hp: 395, atk: 60, def: 25 },
    ],
  },
  {
    chapter: 4,
    name: '矮人熔炉',
    emoji: '🌋',
    recommendedLevel: 10,
    floors: FLOORS_PER_CHAPTER,
    clearBaseCoins: 42000,
    clearBaseXp: 700,
    firstClearMultiplier: 2,
    boss: {
      name: '熔岩魔像·卡兹丹',
      emoji: '🔥',
      hp: 950,
      atk: 108,
      def: 42,
      skillName: '地裂熔岩冲击',
    },
    monsters: [
      { name: '黑铁机械傀儡', emoji: '🤖', hp: 440, atk: 75, def: 30 },
      { name: '熔火火元素', emoji: '🔥', hp: 410, atk: 82, def: 24 },
      { name: '狂化锻造者', emoji: '⚒️', hp: 465, atk: 78, def: 28 },
    ],
    elites: [
      { name: '符文铁卫', emoji: '🛡️', hp: 620, atk: 90, def: 38 },
      { name: '地心炎魔', emoji: '👹', hp: 590, atk: 98, def: 34 },
    ],
  },
  {
    chapter: 5,
    name: '霜火龙巢',
    emoji: '🐉',
    recommendedLevel: 15,
    floors: FLOORS_PER_CHAPTER,
    clearBaseCoins: 65000,
    clearBaseXp: 1150,
    firstClearMultiplier: 2,
    boss: {
      name: '双头古龙·提亚马特',
      emoji: '🐉',
      hp: 1500,
      atk: 158,
      def: 62,
      skillName: '冰火双息吐息',
    },
    monsters: [
      { name: '寒冰龙裔战士', emoji: '❄️', hp: 700, atk: 112, def: 46 },
      { name: '炽炎飞龙', emoji: '🐲', hp: 675, atk: 120, def: 42 },
      { name: '龙血守卫', emoji: '⚔️', hp: 730, atk: 115, def: 48 },
    ],
    elites: [
      { name: '霜火亚龙', emoji: '🦖', hp: 960, atk: 138, def: 56 },
      { name: '古龙祭司', emoji: '🔮', hp: 920, atk: 142, def: 52 },
    ],
  },
  {
    chapter: 6,
    name: '深渊王座',
    emoji: '🌌',
    recommendedLevel: 20,
    floors: FLOORS_PER_CHAPTER,
    clearBaseCoins: 100000,
    clearBaseXp: 1800,
    firstClearMultiplier: 2,
    boss: {
      name: '堕落魔神·阿撒托斯',
      emoji: '👁️',
      hp: 2250,
      atk: 220,
      def: 88,
      skillName: '终焉深渊裁决',
    },
    monsters: [
      { name: '虚空掠夺者', emoji: '👾', hp: 1040, atk: 162, def: 64 },
      { name: '深渊恐惧魔', emoji: '👿', hp: 1080, atk: 168, def: 66 },
      { name: '堕落圣堂武士', emoji: '🖤', hp: 1120, atk: 158, def: 72 },
    ],
    elites: [
      { name: '混沌魔将', emoji: '🔱', hp: 1440, atk: 192, def: 80 },
      { name: '虚空观测者', emoji: '🌀', hp: 1380, atk: 200, def: 74 },
    ],
  },
];

export const RPG_CHAPTER_MAP: ReadonlyMap<number, RpgChapterDef> = new Map(
  RPG_CHAPTERS.map((c) => [c.chapter, c]),
);

export const RARITY_ORDER: Record<RpgItemRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

export const RARITY_META: Record<RpgItemRarity, { label: string; emoji: string }> = {
  common: { label: '普通', emoji: '⚪' },
  uncommon: { label: '精良', emoji: '🟢' },
  rare: { label: '稀有', emoji: '🔵' },
  epic: { label: '史诗', emoji: '🟣' },
  legendary: { label: '传说', emoji: '🟠' },
};

const RARITY_STAT_MULT: Record<RpgItemRarity, number> = {
  common: 1.0,
  uncommon: 1.35,
  rare: 1.8,
  epic: 2.4,
  legendary: 3.3,
};

const RARITY_ENHANCE_COST_MULT: Record<RpgItemRarity, number> = {
  common: 1.0,
  uncommon: 1.4,
  rare: 2.0,
  epic: 3.0,
  legendary: 4.5,
};

const RARITY_SALVAGE_BASE: Record<RpgItemRarity, number> = {
  common: 300,
  uncommon: 800,
  rare: 2000,
  epic: 5500,
  legendary: 15000,
};

const ENHANCE_SUCCESS_RATES: readonly number[] = [
  1.0, // +0 -> +1
  1.0, // +1 -> +2
  1.0, // +2 -> +3
  0.9, // +3 -> +4
  0.8, // +4 -> +5
  0.7, // +5 -> +6
  0.6, // +6 -> +7
  0.5, // +7 -> +8
  0.4, // +8 -> +9
  0.3, // +9 -> +10
];

const PET_RARITY_SYNERGY_MULT: Record<PetRarity, number> = {
  N: 1.0,
  R: 1.15,
  SR: 1.35,
  SSR: 1.6,
};

const ITEM_NAMES: Record<RpgItemSlot, Record<RpgItemRarity, readonly string[]>> = {
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

export interface EffectiveItemStats {
  hp: number;
  atk: number;
  def: number;
  critBp: number;
}

export function computeItemEffectiveStats(
  item: Pick<RpgItem, 'baseHp' | 'baseAtk' | 'baseDef' | 'baseCritBp' | 'enhanceLevel'>,
): EffectiveItemStats {
  const mult = 1 + Math.max(0, item.enhanceLevel) * 0.15;
  return {
    hp: Math.round(item.baseHp * mult),
    atk: Math.round(item.baseAtk * mult),
    def: Math.round(item.baseDef * mult),
    critBp: Math.round(item.baseCritBp * mult),
  };
}

export function getEnhanceInfo(
  item: Pick<RpgItem, 'rarity' | 'enhanceLevel'>,
): { nextLevel: number; cost: number; successRate: number } | null {
  if (item.enhanceLevel >= MAX_ENHANCE_LEVEL) {
    return null;
  }
  const lvl = Math.max(0, item.enhanceLevel);
  const baseCost = 800 + lvl * 700 + lvl * lvl * 250;
  const cost = Math.round(baseCost * RARITY_ENHANCE_COST_MULT[item.rarity]);
  const successRate = ENHANCE_SUCCESS_RATES[lvl] ?? 0.3;
  return { nextLevel: lvl + 1, cost, successRate };
}

export function getSalvageValue(item: Pick<RpgItem, 'rarity' | 'enhanceLevel'>): number {
  const base = RARITY_SALVAGE_BASE[item.rarity];
  return base + Math.max(0, item.enhanceLevel) * Math.round(base * 0.25);
}

export function xpNeededForRpgLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  return Math.floor(100 * safeLevel + 35 * safeLevel * (safeLevel - 1));
}

export function applyCharacterXp(
  character: RpgCharacter,
  gainXp: number,
): { updated: RpgCharacter; levelsGained: number } {
  let level = character.level;
  let xp = character.xp + Math.max(0, Math.floor(gainXp));
  let levelsGained = 0;

  while (level < 99 && xp >= xpNeededForRpgLevel(level)) {
    xp -= xpNeededForRpgLevel(level);
    level += 1;
    levelsGained += 1;
  }

  return {
    updated: { ...character, level, xp },
    levelsGained,
  };
}

export interface PetSynergyInfo {
  petId: number;
  nickname: string;
  emoji: string;
  rarity: PetRarity;
  level: number;
  bonusHp: number;
  bonusAtk: number;
  bonusCritBp: number;
  assistChance: number;
  assistDamage: number;
}

export interface CombatStats {
  maxHp: number;
  atk: number;
  def: number;
  critBp: number;
  dodgeBp: number;
  classKey: RpgClassKey;
  level: number;
  equippedItems: RpgItem[];
  petSynergy: PetSynergyInfo | null;
}

export type RpgRunAction =
  | 'attack'
  | 'skill'
  | 'defend'
  | 'potion'
  | 'retreat'
  | 'event_a'
  | 'event_b'
  | 'next_floor';

export type RpgRunPhase = 'combat' | 'event' | 'floor_clear';

export interface PendingRpgItem {
  name: string;
  slot: RpgItemSlot;
  rarity: RpgItemRarity;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseCritBp: number;
}

export interface RunEnemyState {
  name: string;
  emoji: string;
  kind: 'monster' | 'elite' | 'boss';
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  armorBreakTurns: number;
  burnTurns: number;
  burnDamage: number;
  bossSkillName?: string;
}

export interface RunEventState {
  key: 'shrine' | 'tavern' | 'merchant' | 'altar';
  title: string;
  description: string;
  optionALabel: string;
  optionBLabel: string;
}

export interface RpgRunState {
  chapter: number;
  floor: number;
  phase: RpgRunPhase;
  turn: number;
  classKey: RpgClassKey;
  playerHp: number;
  playerMaxHp: number;
  playerAtk: number;
  playerDef: number;
  playerCritBp: number;
  playerDodgeBp: number;
  skillCooldown: number;
  potionsLeft: number;
  atkBuffPct: number;
  petSynergy: PetSynergyInfo | null;
  enemy: RunEnemyState | null;
  event: RunEventState | null;
  pendingCoins: number;
  pendingXp: number;
  pendingItems: PendingRpgItem[];
  logs: string[];
}

export type ChooseClassResult =
  | {
      ok: true;
      character: RpgCharacter;
      cost: number;
      balance: number;
      isFirstSelection: boolean;
    }
  | { ok: false; reason: 'same_class' | 'insufficient_funds' | 'active_run'; cost?: number };

export type BuyStaminaPotionResult =
  | {
      ok: true;
      character: RpgCharacter;
      cost: number;
      balance: number;
      buysRemaining: number;
    }
  | {
      ok: false;
      reason: 'daily_limit_reached' | 'insufficient_funds';
      cost?: number;
      dailyLimit?: number;
    };

export type EquipItemResult =
  | { ok: true; item: RpgItem; unequippedItem: RpgItem | null; stats: CombatStats }
  | { ok: false; reason: 'not_found' | 'already_equipped' };

export type UnequipItemResult =
  | { ok: true; item: RpgItem; stats: CombatStats }
  | { ok: false; reason: 'not_found' | 'not_equipped' };

export type EnhanceItemResult =
  | {
      ok: true;
      success: boolean;
      item: RpgItem;
      cost: number;
      balance: number;
      successRate: number;
    }
  | {
      ok: false;
      reason: 'not_found' | 'max_enhance_level' | 'insufficient_funds';
      cost?: number;
    };

export type SalvageItemResult =
  | { ok: true; salvagedItem: RpgItem; coinsEarned: number; balance: number }
  | { ok: false; reason: 'not_found' | 'item_equipped' };

export type StartRunResult =
  | { ok: true; run: RpgRunState; character: RpgCharacter }
  | {
      ok: false;
      reason: 'invalid_chapter' | 'chapter_locked' | 'insufficient_stamina' | 'active_run_exists';
      maxUnlockedChapter?: number;
    };

export interface RunBankedReward {
  grossCoins: number;
  garnishedCoins: number;
  netCoins: number;
  xpEarned: number;
  levelsGained: number;
  bankedItems: RpgItem[];
  autoSalvagedCount: number;
  autoSalvagedCoins: number;
  bossBonusCoins: number;
  creditDelta: number;
}

export type ActInRunResult =
  | {
      ok: true;
      outcome: 'ongoing' | 'floor_cleared';
      run: RpgRunState;
      logs: string[];
      floorLoot?: { coins: number; xp: number; item: PendingRpgItem | null };
    }
  | {
      ok: true;
      outcome: 'retreated';
      run: null;
      chapter: number;
      floor: number;
      logs: string[];
      reward: RunBankedReward;
      legendaryDrops: RpgItem[];
      character: RpgCharacter;
      balance: number;
    }
  | {
      ok: true;
      outcome: 'victory';
      run: null;
      chapter: number;
      floor: number;
      logs: string[];
      reward: RunBankedReward;
      firstClear: boolean;
      legendaryDrops: RpgItem[];
      character: RpgCharacter;
      balance: number;
    }
  | {
      ok: true;
      outcome: 'defeat';
      run: null;
      chapter: number;
      floor: number;
      logs: string[];
      lostLoot: { coins: number; xp: number; itemCount: number };
    }
  | {
      ok: false;
      reason:
        | 'no_active_run'
        | 'invalid_action_for_phase'
        | 'skill_on_cooldown'
        | 'no_potions_left';
      cooldownLeft?: number;
    };

export interface RpgServiceOptions {
  timezone?: string;
  config?: Partial<RpgConfig>;
  guildConfigRepo?: GuildConfigRepo;
  socialPetRepo?: SocialPetRepo;
  onCoinsEarned?: (
    guildId: string,
    userId: string,
    grossCoins: number,
    source: string,
    nowMs: number,
  ) => { garnished: number; net: number };
  onCreditChange?: (
    guildId: string,
    userId: string,
    delta: number,
    reason: string,
    nowMs: number,
  ) => void;
}

const RANDOM_EVENTS: readonly RunEventState[] = [
  {
    key: 'shrine',
    title: '⛪ 古老圣坛',
    description: '一座散发着微光的战神雕像矗立在雾中，石碑刻着试炼与祈祷的铭文。',
    optionALabel: '祈求战神赐福（高风险：60% +18%攻击与宝藏 / 40% 受反噬失血20%）',
    optionBLabel: '虔诚休憩（稳健：回复 35% 最大生命）',
  },
  {
    key: 'tavern',
    title: '🍺 迷雾旅店',
    description: '地下城深处竟然有一间灯光摇曳的酒馆，几名独眼雇佣兵正朝你招手。',
    optionALabel: '参与豪赌（高风险：55% 赢取丰厚金币与装备 / 45% 遭伏击失血18%）',
    optionBLabel: '痛饮麦酒（稳健：回复 30% 最大生命并补充 1 瓶药水）',
  },
  {
    key: 'merchant',
    title: '🧳 流浪地精商人',
    description: '背着巨大麻袋的地精商人嘿嘿一笑：“勇士，要赌一把神秘暗箱，还是买点稳妥的补给？”',
    optionALabel: '开启神秘暗箱（高风险：65% 获得稀有以上装备 / 35% 中毒失血15%）',
    optionBLabel: '交换补给（稳健：获得金币并提升本局 12% 攻击力）',
  },
  {
    key: 'altar',
    title: '🕯️ 血月祭坛',
    description: '暗红色的符文在石台上旋转，低语诱惑着过往的冒险者献祭生命换取力量。',
    optionALabel: '以血换力（高风险：牺牲 20% 最大生命，换取本局 +22% 攻击与高额金币）',
    optionBLabel: '净化祭坛（稳健：回复 25% 最大生命并获得少量经验与金币）',
  },
];

function computePetSynergy(pet: UserPet): PetSynergyInfo {
  const mult = PET_RARITY_SYNERGY_MULT[pet.rarity];
  const species = PET_SPECIES_MAP.get(pet.speciesKey);
  return {
    petId: pet.id,
    nickname: pet.nickname,
    emoji: species?.emoji ?? '🐾',
    rarity: pet.rarity,
    level: pet.level,
    bonusHp: Math.max(10, Math.round(pet.hp * 0.35 * mult)),
    bonusAtk: Math.max(3, Math.round(pet.atk * 0.45 * mult)),
    bonusCritBp: Math.min(1200, Math.round(pet.critRate * 10000 * 0.25 * mult)),
    assistChance: Math.min(0.65, Number((0.28 + (mult - 1) * 0.25 + pet.level * 0.015).toFixed(3))),
    assistDamage: Math.max(5, Math.round(pet.atk * 0.65 * mult)),
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999999, Math.max(0, value));
}

function pickFrom<T>(list: readonly T[], rng: () => number): T {
  const idx = Math.min(list.length - 1, Math.floor(clampUnit(rng()) * list.length));
  return list[idx]!;
}

function rollItemRarity(
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

  if (source === 'elite' || source === 'chest' || source === 'event') {
    if (r >= Math.max(0.88, 0.985 - chOffset * 0.02)) return 'legendary';
    if (r >= Math.max(0.62, 0.86 - chOffset * 0.045)) return 'epic';
    if (r >= Math.max(0.32, 0.58 - chOffset * 0.05)) return 'rare';
    if (r >= 0.12) return 'uncommon';
    return 'common';
  }

  // Normal monster
  if (chapter >= 3 && r >= Math.max(0.95, 0.995 - (chapter - 3) * 0.01)) return 'legendary';
  if (r >= Math.max(0.82, 0.95 - chOffset * 0.025)) return 'epic';
  if (r >= Math.max(0.55, 0.78 - chOffset * 0.04)) return 'rare';
  if (r >= 0.35) return 'uncommon';
  return 'common';
}

function generatePendingItem(
  chapter: number,
  source: 'monster' | 'elite' | 'chest' | 'event' | 'boss',
  rng: () => number,
  minRarity?: RpgItemRarity,
): PendingRpgItem {
  const slots: readonly RpgItemSlot[] = ['weapon', 'armor', 'accessory'];
  const slot = pickFrom(slots, rng);
  let rarity = rollItemRarity(chapter, source, rng);
  if (minRarity && RARITY_ORDER[rarity] < RARITY_ORDER[minRarity]) {
    rarity = minRarity;
  }

  const namePool = ITEM_NAMES[slot][rarity];
  const name = pickFrom(namePool, rng);

  const chapterScale = 1 + (chapter - 1) * 0.65;
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

function parseRunState(raw: string): RpgRunState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Partial<RpgRunState>;
    if (
      typeof obj.chapter !== 'number' ||
      typeof obj.floor !== 'number' ||
      typeof obj.phase !== 'string' ||
      typeof obj.playerHp !== 'number' ||
      typeof obj.playerMaxHp !== 'number'
    ) {
      return null;
    }
    return parsed as RpgRunState;
  } catch {
    return null;
  }
}

export class RpgService {
  private readonly config: RpgConfig;
  private readonly configOverrides?: Partial<RpgConfig>;
  private readonly timezone: string;
  private readonly guildConfigRepo?: GuildConfigRepo;
  private readonly socialPetRepo?: SocialPetRepo;
  private readonly onCoinsEarned?: RpgServiceOptions['onCoinsEarned'];
  private readonly onCreditChange?: RpgServiceOptions['onCreditChange'];

  constructor(
    private readonly db: Database.Database,
    private readonly rpgRepo: RpgRepo,
    private readonly profileRepo: ProfileRepo,
    options: RpgServiceOptions = {},
  ) {
    this.configOverrides = options.config;
    this.config = { ...DEFAULT_RPG_CONFIG, ...options.config };
    this.timezone = options.timezone ?? 'Asia/Shanghai';
    this.guildConfigRepo = options.guildConfigRepo;
    this.socialPetRepo = options.socialPetRepo;
    this.onCoinsEarned = options.onCoinsEarned;
    this.onCreditChange = options.onCreditChange;
  }

  getConfig(guildId?: string): RpgConfig {
    if (guildId && this.guildConfigRepo) {
      const guildCfg = this.guildConfigRepo.getOrCreate(guildId).rpg;
      return {
        ...DEFAULT_RPG_CONFIG,
        ...guildCfg,
        ...this.configOverrides,
      };
    }
    return { ...this.config };
  }

  getOrCreateCharacter(guildId: string, userId: string, nowMs = Date.now()): RpgCharacter {
    return this.db.transaction((): RpgCharacter => {
      return this.getOrCreateCharacterInTx(guildId, userId, nowMs);
    })();
  }

  chooseOrSwitchClass(
    guildId: string,
    userId: string,
    classKey: RpgClassKey,
    nowMs = Date.now(),
  ): ChooseClassResult {
    return this.db.transaction((): ChooseClassResult => {
      const existingRun = this.rpgRepo.getRun(guildId, userId);
      if (existingRun && parseRunState(existingRun.stateJson)) {
        return { ok: false, reason: 'active_run' };
      }
      if (existingRun) {
        this.rpgRepo.deleteRun(guildId, userId);
      }

      const cfg = this.getConfig(guildId);
      const today = getDateKey(nowMs, this.timezone);
      const existing = this.rpgRepo.getCharacter(guildId, userId);

      if (!existing) {
        const created = this.rpgRepo.createCharacter({
          guildId,
          userId,
          classKey,
          classSelected: true,
          stamina: cfg.dailyStamina,
          lastStaminaDate: today,
          updatedAt: nowMs,
        });
        const profile = this.profileRepo.getOrCreate(guildId, userId);
        return {
          ok: true,
          character: created,
          cost: 0,
          balance: profile.coins,
          isFirstSelection: true,
        };
      }

      const refreshed = this.refreshDailyStaminaInTx(existing, today, nowMs);

      if (!refreshed.classSelected) {
        const updated: RpgCharacter = {
          ...refreshed,
          classKey,
          classSelected: true,
          updatedAt: nowMs,
        };
        this.rpgRepo.saveCharacter(updated);
        const profile = this.profileRepo.getOrCreate(guildId, userId);
        return {
          ok: true,
          character: updated,
          cost: 0,
          balance: profile.coins,
          isFirstSelection: true,
        };
      }

      if (refreshed.classKey === classKey) {
        return { ok: false, reason: 'same_class' };
      }

      const cost = Math.max(0, Math.floor(cfg.classSwitchCost));
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cost) {
        return { ok: false, reason: 'insufficient_funds', cost };
      }

      const balance = profile.coins - cost;
      if (cost > 0) {
        this.profileRepo.save({ ...profile, coins: balance });
      }

      const updated: RpgCharacter = {
        ...refreshed,
        classKey,
        classSelected: true,
        updatedAt: nowMs,
      };
      this.rpgRepo.saveCharacter(updated);

      return {
        ok: true,
        character: updated,
        cost,
        balance,
        isFirstSelection: false,
      };
    })();
  }

  buyStaminaPotion(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
  ): BuyStaminaPotionResult {
    return this.db.transaction((): BuyStaminaPotionResult => {
      const cfg = this.getConfig(guildId);
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      const dailyLimit = Math.max(0, Math.floor(cfg.staminaPotionDailyLimit));
      if (character.staminaBuysToday >= dailyLimit) {
        return { ok: false, reason: 'daily_limit_reached', dailyLimit };
      }

      const cost = Math.max(0, Math.floor(cfg.staminaPotionPrice));
      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < cost) {
        return { ok: false, reason: 'insufficient_funds', cost };
      }

      const balance = profile.coins - cost;
      if (cost > 0) {
        this.profileRepo.save({ ...profile, coins: balance });
      }

      const updated: RpgCharacter = {
        ...character,
        stamina: character.stamina + 1,
        staminaBuysToday: character.staminaBuysToday + 1,
        updatedAt: nowMs,
      };
      this.rpgRepo.saveCharacter(updated);

      return {
        ok: true,
        character: updated,
        cost,
        balance,
        buysRemaining: Math.max(0, dailyLimit - updated.staminaBuysToday),
      };
    })();
  }

  listItems(guildId: string, userId: string): RpgItem[] {
    return this.rpgRepo.listItems(guildId, userId);
  }

  computeCombatStats(guildId: string, userId: string, nowMs = Date.now()): CombatStats {
    const character = this.getOrCreateCharacter(guildId, userId, nowMs);
    return this.computeCombatStatsForCharacter(character);
  }

  equipItem(guildId: string, userId: string, itemId: number, nowMs = Date.now()): EquipItemResult {
    return this.db.transaction((): EquipItemResult => {
      const item = this.rpgRepo.getItemById(itemId);
      if (!item || item.guildId !== guildId || item.userId !== userId) {
        return { ok: false, reason: 'not_found' };
      }
      if (item.equipped) {
        return { ok: false, reason: 'already_equipped' };
      }

      const equipped = this.rpgRepo.listEquippedItems(guildId, userId);
      const prevInSlot = equipped.find((eq) => eq.slot === item.slot) ?? null;

      this.rpgRepo.setSlotEquipped(guildId, userId, item.slot, item.id);
      const updatedItem = this.rpgRepo.getItemById(item.id)!;
      const unequippedItem = prevInSlot ? { ...prevInSlot, equipped: false } : null;
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      const stats = this.computeCombatStatsForCharacter(character);

      return { ok: true, item: updatedItem, unequippedItem, stats };
    })();
  }

  unequipItem(
    guildId: string,
    userId: string,
    itemId: number,
    nowMs = Date.now(),
  ): UnequipItemResult {
    return this.db.transaction((): UnequipItemResult => {
      const item = this.rpgRepo.getItemById(itemId);
      if (!item || item.guildId !== guildId || item.userId !== userId) {
        return { ok: false, reason: 'not_found' };
      }
      if (!item.equipped) {
        return { ok: false, reason: 'not_equipped' };
      }

      this.rpgRepo.setSlotEquipped(guildId, userId, item.slot, null);
      const updatedItem = this.rpgRepo.getItemById(item.id)!;
      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      const stats = this.computeCombatStatsForCharacter(character);

      return { ok: true, item: updatedItem, stats };
    })();
  }

  enhanceItem(
    guildId: string,
    userId: string,
    itemId: number,
    _nowMs = Date.now(),
    rng: () => number = Math.random,
  ): EnhanceItemResult {
    return this.db.transaction((): EnhanceItemResult => {
      const item = this.rpgRepo.getItemById(itemId);
      if (!item || item.guildId !== guildId || item.userId !== userId) {
        return { ok: false, reason: 'not_found' };
      }

      const info = getEnhanceInfo(item);
      if (!info) {
        return { ok: false, reason: 'max_enhance_level' };
      }

      const profile = this.profileRepo.getOrCreate(guildId, userId);
      if (profile.coins < info.cost) {
        return { ok: false, reason: 'insufficient_funds', cost: info.cost };
      }

      const balance = profile.coins - info.cost;
      this.profileRepo.save({ ...profile, coins: balance });

      const succeeded = clampUnit(rng()) < info.successRate;
      if (succeeded) {
        this.rpgRepo.updateItemEnhanceLevel(item.id, info.nextLevel);
      }

      const finalItem = this.rpgRepo.getItemById(item.id)!;
      return {
        ok: true,
        success: succeeded,
        item: finalItem,
        cost: info.cost,
        balance,
        successRate: info.successRate,
      };
    })();
  }

  salvageItem(guildId: string, userId: string, itemId: number): SalvageItemResult {
    return this.db.transaction((): SalvageItemResult => {
      const item = this.rpgRepo.getItemById(itemId);
      if (!item || item.guildId !== guildId || item.userId !== userId) {
        return { ok: false, reason: 'not_found' };
      }
      if (item.equipped) {
        return { ok: false, reason: 'item_equipped' };
      }

      const coinsEarned = getSalvageValue(item);
      this.rpgRepo.deleteItem(item.id, guildId, userId);
      const updatedProfile = this.profileRepo.addCoins(guildId, userId, coinsEarned);

      return {
        ok: true,
        salvagedItem: item,
        coinsEarned,
        balance: updatedProfile.coins,
      };
    })();
  }

  getActiveRun(guildId: string, userId: string): RpgRunState | null {
    const rec = this.rpgRepo.getRun(guildId, userId);
    if (!rec) return null;
    return parseRunState(rec.stateJson);
  }

  getLeaderboard(
    guildId: string,
    limit = 10,
    offset = 0,
  ): { items: RpgCharacter[]; total: number } {
    return this.rpgRepo.getLeaderboard(guildId, limit, offset);
  }

  startRun(
    guildId: string,
    userId: string,
    chapter: number,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): StartRunResult {
    const chapterDef = RPG_CHAPTER_MAP.get(chapter);
    if (!chapterDef) {
      return { ok: false, reason: 'invalid_chapter' };
    }

    return this.db.transaction((): StartRunResult => {
      const existingRun = this.rpgRepo.getRun(guildId, userId);
      if (existingRun && parseRunState(existingRun.stateJson)) {
        return { ok: false, reason: 'active_run_exists' };
      }
      if (existingRun) {
        this.rpgRepo.deleteRun(guildId, userId);
      }

      const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
      const maxUnlockedChapter = Math.min(RPG_CHAPTERS.length, character.maxChapterCleared + 1);
      if (chapter > maxUnlockedChapter) {
        return { ok: false, reason: 'chapter_locked', maxUnlockedChapter };
      }

      if (character.stamina < 1) {
        return { ok: false, reason: 'insufficient_stamina' };
      }

      const updatedChar: RpgCharacter = {
        ...character,
        stamina: character.stamina - 1,
        updatedAt: nowMs,
      };
      this.rpgRepo.saveCharacter(updatedChar);

      const stats = this.computeCombatStatsForCharacter(updatedChar);
      const run: RpgRunState = {
        chapter,
        floor: 1,
        phase: 'combat',
        turn: 1,
        classKey: updatedChar.classKey,
        playerHp: stats.maxHp,
        playerMaxHp: stats.maxHp,
        playerAtk: stats.atk,
        playerDef: stats.def,
        playerCritBp: stats.critBp,
        playerDodgeBp: stats.dodgeBp,
        skillCooldown: 0,
        potionsLeft: RUN_INITIAL_POTIONS,
        atkBuffPct: 0,
        petSynergy: stats.petSynergy,
        enemy: null,
        event: null,
        pendingCoins: 0,
        pendingXp: 0,
        pendingItems: [],
        logs: [`${chapterDef.emoji} 踏入第 ${chapter} 章「**${chapterDef.name}**」！`],
      };

      if (stats.petSynergy) {
        run.logs.push(
          `${stats.petSynergy.emoji} 战宠「**${stats.petSynergy.nickname}**」随行出战（+${stats.petSynergy.bonusHp} HP / +${stats.petSynergy.bonusAtk} ATK）。`,
        );
      }

      this.populateFloorEncounter(run, chapterDef, rng);
      this.saveRunInTx(guildId, userId, run, nowMs);

      return { ok: true, run, character: updatedChar };
    })();
  }

  actInRun(
    guildId: string,
    userId: string,
    action: RpgRunAction,
    nowMs = Date.now(),
    rng: () => number = Math.random,
  ): ActInRunResult {
    return this.db.transaction((): ActInRunResult => {
      const record = this.rpgRepo.getRun(guildId, userId);
      if (!record) {
        return { ok: false, reason: 'no_active_run' };
      }
      const run = parseRunState(record.stateJson);
      if (!run) {
        this.rpgRepo.deleteRun(guildId, userId);
        return { ok: false, reason: 'no_active_run' };
      }

      const chapterDef = RPG_CHAPTER_MAP.get(run.chapter);
      if (!chapterDef) {
        this.rpgRepo.deleteRun(guildId, userId);
        return { ok: false, reason: 'no_active_run' };
      }

      // Retreat safely banks accumulated pending loot at any point
      if (action === 'retreat') {
        return this.handleRetreatInTx(guildId, userId, run, chapterDef, nowMs);
      }

      if (run.phase === 'event') {
        if (action !== 'event_a' && action !== 'event_b') {
          return { ok: false, reason: 'invalid_action_for_phase' };
        }
        return this.handleEventActionInTx(guildId, userId, run, chapterDef, action, nowMs, rng);
      }

      if (run.phase === 'floor_clear') {
        if (action === 'potion') {
          return this.handleOutOfCombatPotionInTx(guildId, userId, run, nowMs);
        }
        if (action !== 'next_floor') {
          return { ok: false, reason: 'invalid_action_for_phase' };
        }
        run.floor += 1;
        run.turn = 1;
        run.logs = [];
        this.populateFloorEncounter(run, chapterDef, rng);
        this.saveRunInTx(guildId, userId, run, nowMs);
        return {
          ok: true,
          outcome: run.phase === 'floor_clear' ? 'floor_cleared' : 'ongoing',
          run,
          logs: [...run.logs],
        };
      }

      // Combat phase
      if (
        action !== 'attack' &&
        action !== 'skill' &&
        action !== 'defend' &&
        action !== 'potion'
      ) {
        return { ok: false, reason: 'invalid_action_for_phase' };
      }

      return this.handleCombatActionInTx(guildId, userId, run, chapterDef, action, nowMs, rng);
    })();
  }

  private getOrCreateCharacterInTx(
    guildId: string,
    userId: string,
    nowMs: number,
  ): RpgCharacter {
    const cfg = this.getConfig(guildId);
    const today = getDateKey(nowMs, this.timezone);
    const existing = this.rpgRepo.getCharacter(guildId, userId);
    if (!existing) {
      return this.rpgRepo.createCharacter({
        guildId,
        userId,
        classKey: 'warrior',
        classSelected: false,
        stamina: cfg.dailyStamina,
        lastStaminaDate: today,
        updatedAt: nowMs,
      });
    }
    return this.refreshDailyStaminaInTx(existing, today, nowMs);
  }

  private refreshDailyStaminaInTx(
    character: RpgCharacter,
    today: string,
    nowMs: number,
  ): RpgCharacter {
    if (character.lastStaminaDate === today) {
      return character;
    }
    const cfg = this.getConfig(character.guildId);
    const updated: RpgCharacter = {
      ...character,
      stamina: Math.max(character.stamina, cfg.dailyStamina),
      lastStaminaDate: today,
      staminaBuysToday: 0,
      updatedAt: nowMs,
    };
    this.rpgRepo.saveCharacter(updated);
    return updated;
  }

  private computeCombatStatsForCharacter(character: RpgCharacter): CombatStats {
    const classDef = RPG_CLASS_MAP.get(character.classKey) ?? RPG_CLASSES[0]!;
    const extraLevels = Math.max(0, character.level - 1);

    let maxHp = Math.round(classDef.baseHp + extraLevels * classDef.hpPerLevel);
    let atk = Math.round(classDef.baseAtk + extraLevels * classDef.atkPerLevel);
    let def = Math.round(classDef.baseDef + extraLevels * classDef.defPerLevel);
    let critBp = Math.round(classDef.baseCritBp + extraLevels * classDef.critBpPerLevel);
    const dodgeBp = Math.min(5000, classDef.baseDodgeBp);

    const equippedItems = this.rpgRepo.listEquippedItems(character.guildId, character.userId);
    for (const item of equippedItems) {
      const eff = computeItemEffectiveStats(item);
      maxHp += eff.hp;
      atk += eff.atk;
      def += eff.def;
      critBp += eff.critBp;
    }

    let petSynergy: PetSynergyInfo | null = null;
    if (this.socialPetRepo) {
      const activePet = this.socialPetRepo.getActivePet(character.guildId, character.userId);
      if (activePet) {
        petSynergy = computePetSynergy(activePet);
        maxHp += petSynergy.bonusHp;
        atk += petSynergy.bonusAtk;
        critBp += petSynergy.bonusCritBp;
      }
    }

    return {
      maxHp: Math.max(50, maxHp),
      atk: Math.max(5, atk),
      def: Math.max(1, def),
      critBp: Math.min(8500, Math.max(0, critBp)),
      dodgeBp,
      classKey: character.classKey,
      level: character.level,
      equippedItems,
      petSynergy,
    };
  }

  private saveRunInTx(
    guildId: string,
    userId: string,
    run: RpgRunState,
    nowMs: number,
  ): void {
    run.logs = run.logs.slice(-12);
    this.rpgRepo.upsertRun({
      guildId,
      userId,
      chapter: run.chapter,
      floor: run.floor,
      stateJson: JSON.stringify(run),
      updatedAt: nowMs,
    });
  }

  private populateFloorEncounter(
    run: RpgRunState,
    chapterDef: RpgChapterDef,
    rng: () => number,
  ): void {
    if (run.floor >= chapterDef.floors) {
      const boss = chapterDef.boss;
      run.phase = 'combat';
      run.event = null;
      run.enemy = {
        name: boss.name,
        emoji: boss.emoji,
        kind: 'boss',
        hp: boss.hp,
        maxHp: boss.hp,
        atk: boss.atk,
        def: boss.def,
        armorBreakTurns: 0,
        burnTurns: 0,
        burnDamage: 0,
        ...(boss.skillName ? { bossSkillName: boss.skillName } : {}),
      };
      run.logs.push(`🔥 第 ${run.floor} 层 · 章节首领 ${boss.emoji} **${boss.name}** 降临！`);
      return;
    }

    const roll = clampUnit(rng());
    const monsterThreshold = run.floor === 1 ? 0.65 : 0.48;
    const eliteThreshold = run.floor === 1 ? 0.8 : 0.7;
    const eventThreshold = run.floor === 1 ? 0.92 : 0.88;

    if (roll < monsterThreshold) {
      const tpl = pickFrom(chapterDef.monsters, rng);
      const floorScale = 1 + (run.floor - 1) * 0.08;
      const hp = Math.round(tpl.hp * floorScale);
      run.phase = 'combat';
      run.event = null;
      run.enemy = {
        name: tpl.name,
        emoji: tpl.emoji,
        kind: 'monster',
        hp,
        maxHp: hp,
        atk: Math.round(tpl.atk * floorScale),
        def: Math.round(tpl.def * floorScale),
        armorBreakTurns: 0,
        burnTurns: 0,
        burnDamage: 0,
      };
      run.logs.push(`⚔️ 第 ${run.floor} 层遭遇 ${tpl.emoji} **${tpl.name}**！`);
      return;
    }

    if (roll < eliteThreshold) {
      const tpl = pickFrom(chapterDef.elites, rng);
      const floorScale = 1 + (run.floor - 1) * 0.08;
      const hp = Math.round(tpl.hp * floorScale);
      run.phase = 'combat';
      run.event = null;
      run.enemy = {
        name: tpl.name,
        emoji: tpl.emoji,
        kind: 'elite',
        hp,
        maxHp: hp,
        atk: Math.round(tpl.atk * floorScale),
        def: Math.round(tpl.def * floorScale),
        armorBreakTurns: 0,
        burnTurns: 0,
        burnDamage: 0,
      };
      run.logs.push(`💀 第 ${run.floor} 层遭遇精英怪 ${tpl.emoji} **${tpl.name}**！`);
      return;
    }

    if (roll < eventThreshold) {
      const ev = pickFrom(RANDOM_EVENTS, rng);
      run.phase = 'event';
      run.enemy = null;
      run.event = { ...ev };
      run.logs.push(`✨ 第 ${run.floor} 层奇遇：**${ev.title}**`);
      return;
    }

    // Treasure chest room!
    const chestCoins = Math.round(chapterDef.clearBaseCoins * (0.14 + clampUnit(rng()) * 0.08));
    const chestXp = Math.round(chapterDef.clearBaseXp * 0.15);
    const chestItem = generatePendingItem(chapterDef.chapter, 'chest', rng);
    run.phase = 'floor_clear';
    run.enemy = null;
    run.event = null;
    run.pendingCoins += chestCoins;
    run.pendingXp += chestXp;
    run.pendingItems.push(chestItem);
    const meta = RARITY_META[chestItem.rarity];
    run.logs.push(
      `🎁 第 ${run.floor} 层发现古老宝箱！暂存 **${chestCoins}** 金币、**${chestXp}** 经验与 ${meta.emoji} **${chestItem.name}**！`,
    );
  }

  private handleOutOfCombatPotionInTx(
    guildId: string,
    userId: string,
    run: RpgRunState,
    nowMs: number,
  ): ActInRunResult {
    if (run.potionsLeft <= 0) {
      return { ok: false, reason: 'no_potions_left' };
    }
    const heal = Math.max(1, Math.round(run.playerMaxHp * 0.45));
    const prevHp = run.playerHp;
    run.playerHp = Math.min(run.playerMaxHp, run.playerHp + heal);
    run.potionsLeft -= 1;
    const actualHeal = run.playerHp - prevHp;
    const line = `🧪 饮用生命药水，回复 **${actualHeal}** HP（当前 ${run.playerHp}/${run.playerMaxHp}，剩余药水 ${run.potionsLeft}）。`;
    run.logs.push(line);
    this.saveRunInTx(guildId, userId, run, nowMs);
    return { ok: true, outcome: 'floor_cleared', run, logs: [line] };
  }

  private handleEventActionInTx(
    guildId: string,
    userId: string,
    run: RpgRunState,
    chapterDef: RpgChapterDef,
    action: 'event_a' | 'event_b',
    nowMs: number,
    rng: () => number,
  ): ActInRunResult {
    const ev = run.event;
    if (!ev) {
      return { ok: false, reason: 'invalid_action_for_phase' };
    }

    const turnLogs: string[] = [];
    let lootCoins = 0;
    let lootXp = 0;
    let lootItem: PendingRpgItem | null = null;

    if (action === 'event_a') {
      const roll = clampUnit(rng());
      if (ev.key === 'shrine') {
        if (roll < 0.6) {
          run.atkBuffPct += 0.18;
          lootCoins = Math.round(chapterDef.clearBaseCoins * 0.14);
          lootXp = Math.round(chapterDef.clearBaseXp * 0.18);
          turnLogs.push(
            `⚡ 战神回应了你的祈祷！本局攻击 +18%，并暂存 **${lootCoins}** 金币与 **${lootXp}** 经验！`,
          );
        } else {
          const loss = Math.max(5, Math.round(run.playerHp * 0.2));
          run.playerHp = Math.max(1, run.playerHp - loss);
          turnLogs.push(`💢 圣坛降下雷罚！损失 **${loss}** HP（剩余 ${run.playerHp}/${run.playerMaxHp}）。`);
        }
      } else if (ev.key === 'tavern') {
        if (roll < 0.55) {
          lootCoins = Math.round(chapterDef.clearBaseCoins * 0.2);
          lootItem = generatePendingItem(chapterDef.chapter, 'event', rng);
          const meta = RARITY_META[lootItem.rarity];
          turnLogs.push(
            `🎲 豪赌大胜！暂存 **${lootCoins}** 金币与 ${meta.emoji} **${lootItem.name}**！`,
          );
        } else {
          const loss = Math.max(5, Math.round(run.playerHp * 0.18));
          run.playerHp = Math.max(1, run.playerHp - loss);
          turnLogs.push(`🗡️ 雇佣兵翻脸偷袭！损失 **${loss}** HP（剩余 ${run.playerHp}/${run.playerMaxHp}）。`);
        }
      } else if (ev.key === 'merchant') {
        if (roll < 0.65) {
          lootItem = generatePendingItem(chapterDef.chapter, 'event', rng, 'rare');
          const meta = RARITY_META[lootItem.rarity];
          turnLogs.push(`📦 暗箱开启成功！暂存 ${meta.emoji} **${lootItem.name}**！`);
        } else {
          const loss = Math.max(5, Math.round(run.playerHp * 0.15));
          run.playerHp = Math.max(1, run.playerHp - loss);
          turnLogs.push(`☠️ 暗箱喷出毒雾！损失 **${loss}** HP（剩余 ${run.playerHp}/${run.playerMaxHp}）。`);
        }
      } else {
        // altar
        const loss = Math.max(5, Math.round(run.playerMaxHp * 0.2));
        run.playerHp = Math.max(1, run.playerHp - loss);
        run.atkBuffPct += 0.22;
        lootCoins = Math.round(chapterDef.clearBaseCoins * 0.22);
        turnLogs.push(
          `🩸 血祭完成！牺牲 **${loss}** HP，换取本局攻击 +22% 与 **${lootCoins}** 金币！`,
        );
      }
    } else {
      // event_b: safe/heal/buff
      if (ev.key === 'shrine') {
        const heal = Math.round(run.playerMaxHp * 0.35);
        run.playerHp = Math.min(run.playerMaxHp, run.playerHp + heal);
        turnLogs.push(`✨ 圣坛柔和的光芒治愈了你，回复 **${heal}** HP（当前 ${run.playerHp}/${run.playerMaxHp}）。`);
      } else if (ev.key === 'tavern') {
        const heal = Math.round(run.playerMaxHp * 0.3);
        run.playerHp = Math.min(run.playerMaxHp, run.playerHp + heal);
        run.potionsLeft += 1;
        turnLogs.push(
          `🍺 麦酒舒缓了疲惫！回复 **${heal}** HP 并获得 **1** 瓶生命药水（当前 ${run.potionsLeft} 瓶）。`,
        );
      } else if (ev.key === 'merchant') {
        lootCoins = Math.round(chapterDef.clearBaseCoins * 0.1);
        run.atkBuffPct += 0.12;
        turnLogs.push(`🤝 公平交易！获得 **${lootCoins}** 金币与本局攻击 +12% 磨刀石增益。`);
      } else {
        const heal = Math.round(run.playerMaxHp * 0.25);
        run.playerHp = Math.min(run.playerMaxHp, run.playerHp + heal);
        lootCoins = Math.round(chapterDef.clearBaseCoins * 0.08);
        lootXp = Math.round(chapterDef.clearBaseXp * 0.15);
        turnLogs.push(
          `🌟 净化了血月祭坛！回复 **${heal}** HP，获得 **${lootCoins}** 金币与 **${lootXp}** 经验。`,
        );
      }
    }

    run.pendingCoins += lootCoins;
    run.pendingXp += lootXp;
    if (lootItem) {
      run.pendingItems.push(lootItem);
    }
    run.event = null;
    run.phase = 'floor_clear';
    run.logs.push(...turnLogs);
    this.saveRunInTx(guildId, userId, run, nowMs);

    return {
      ok: true,
      outcome: 'floor_cleared',
      run,
      logs: turnLogs,
      floorLoot: { coins: lootCoins, xp: lootXp, item: lootItem },
    };
  }

  private handleCombatActionInTx(
    guildId: string,
    userId: string,
    run: RpgRunState,
    chapterDef: RpgChapterDef,
    action: 'attack' | 'skill' | 'defend' | 'potion',
    nowMs: number,
    rng: () => number,
  ): ActInRunResult {
    const enemy = run.enemy;
    if (!enemy) {
      return { ok: false, reason: 'invalid_action_for_phase' };
    }

    const classDef = RPG_CLASS_MAP.get(run.classKey) ?? RPG_CLASSES[0]!;
    if (action === 'skill' && run.skillCooldown > 0) {
      return { ok: false, reason: 'skill_on_cooldown', cooldownLeft: run.skillCooldown };
    }
    if (action === 'potion' && run.potionsLeft <= 0) {
      return { ok: false, reason: 'no_potions_left' };
    }

    const turnLogs: string[] = [];
    const effectiveAtk = Math.round(run.playerAtk * (1 + run.atkBuffPct));
    const effectiveEnemyDef =
      enemy.armorBreakTurns > 0 ? Math.floor(enemy.def * 0.7) : enemy.def;

    const dealPlayerHit = (
      atkMult: number,
      bonusCritBp = 0,
    ): { damage: number; isCrit: boolean } => {
      const critChance = Math.min(0.95, (run.playerCritBp + bonusCritBp) / 10000);
      const isCrit = clampUnit(rng()) < critChance;
      const variance = 0.9 + clampUnit(rng()) * 0.2;
      const raw = effectiveAtk * atkMult * variance - effectiveEnemyDef * 0.55;
      const dmg = Math.max(5, Math.round(raw * (isCrit ? 1.6 : 1)));
      enemy.hp = Math.max(0, enemy.hp - dmg);
      return { damage: dmg, isCrit };
    };

    let defending = false;
    let offensiveAction = false;

    if (action === 'attack') {
      offensiveAction = true;
      const hit = dealPlayerHit(1.0);
      const critTag = hit.isCrit ? '💥暴击！' : '';
      turnLogs.push(
        `${classDef.emoji} 普通攻击 ${critTag}对 **${enemy.name}** 造成 **${hit.damage}** 伤害（敌方 HP ${enemy.hp}/${enemy.maxHp}）。`,
      );
      if (run.skillCooldown > 0) run.skillCooldown -= 1;
    } else if (action === 'skill') {
      offensiveAction = true;
      run.skillCooldown = classDef.skillCooldown;
      if (run.classKey === 'warrior') {
        const hit = dealPlayerHit(1.85);
        enemy.armorBreakTurns = 2;
        const critTag = hit.isCrit ? '💥暴击！' : '';
        turnLogs.push(
          `⚔️ 施放「**${classDef.skillName}**」${critTag}造成 **${hit.damage}** 伤害并附加 2 回合破甲（敌方 HP ${enemy.hp}/${enemy.maxHp}）。`,
        );
      } else if (run.classKey === 'mage') {
        const hit = dealPlayerHit(2.2);
        enemy.burnTurns = 2;
        enemy.burnDamage = Math.max(8, Math.round(effectiveAtk * 0.35));
        const critTag = hit.isCrit ? '💥暴击！' : '';
        turnLogs.push(
          `🔮 施放「**${classDef.skillName}**」必中！${critTag}造成 **${hit.damage}** 伤害并点燃目标（敌方 HP ${enemy.hp}/${enemy.maxHp}）。`,
        );
      } else if (run.classKey === 'ranger') {
        const hit1 = dealPlayerHit(1.05, 2500);
        const hit2 = enemy.hp > 0 ? dealPlayerHit(1.05, 2500) : null;
        const totalDmg = hit1.damage + (hit2?.damage ?? 0);
        const crits = (hit1.isCrit ? 1 : 0) + (hit2?.isCrit ? 1 : 0);
        const critTag = crits > 0 ? `💥${crits}段暴击！` : '';
        turnLogs.push(
          `🏹 施放「**${classDef.skillName}**」${critTag}两段连射共造成 **${totalDmg}** 伤害（敌方 HP ${enemy.hp}/${enemy.maxHp}）。`,
        );
      } else {
        // paladin
        const hit = dealPlayerHit(1.55);
        const heal = Math.max(1, Math.round(run.playerMaxHp * 0.22));
        run.playerHp = Math.min(run.playerMaxHp, run.playerHp + heal);
        const critTag = hit.isCrit ? '💥暴击！' : '';
        turnLogs.push(
          `🛡️ 施放「**${classDef.skillName}**」${critTag}造成 **${hit.damage}** 伤害并回复 **${heal}** HP（敌方 HP ${enemy.hp}/${enemy.maxHp}）。`,
        );
      }
    } else if (action === 'defend') {
      defending = true;
      const heal = Math.max(1, Math.round(run.playerMaxHp * 0.08));
      run.playerHp = Math.min(run.playerMaxHp, run.playerHp + heal);
      if (run.skillCooldown > 0) run.skillCooldown -= 1;
      turnLogs.push(
        `🛡️ 架起防御姿态（减伤55%），调息回复 **${heal}** HP（当前 ${run.playerHp}/${run.playerMaxHp}）。`,
      );
    } else {
      // potion
      const heal = Math.max(1, Math.round(run.playerMaxHp * 0.45));
      run.playerHp = Math.min(run.playerMaxHp, run.playerHp + heal);
      run.potionsLeft -= 1;
      if (run.skillCooldown > 0) run.skillCooldown -= 1;
      turnLogs.push(
        `🧪 战斗中饮下生命药水，回复 **${heal}** HP（当前 ${run.playerHp}/${run.playerMaxHp}，余 ${run.potionsLeft} 瓶）。`,
      );
    }

    // Pet assist trigger on offensive turns
    if (offensiveAction && enemy.hp > 0 && run.petSynergy) {
      if (clampUnit(rng()) < run.petSynergy.assistChance) {
        const petDmg = Math.max(
          5,
          Math.round(run.petSynergy.assistDamage * (0.9 + clampUnit(rng()) * 0.2)),
        );
        enemy.hp = Math.max(0, enemy.hp - petDmg);
        turnLogs.push(
          `${run.petSynergy.emoji} 战宠「**${run.petSynergy.nickname}**」助战追击，造成 **${petDmg}** 伤害（敌方 HP ${enemy.hp}/${enemy.maxHp}）！`,
        );
      }
    }

    // Burn DoT tick
    if (enemy.hp > 0 && enemy.burnTurns > 0) {
      const burnDmg = Math.max(1, enemy.burnDamage);
      enemy.hp = Math.max(0, enemy.hp - burnDmg);
      enemy.burnTurns -= 1;
      turnLogs.push(
        `🔥 灼烧对 **${enemy.name}** 造成 **${burnDmg}** 伤害（敌方 HP ${enemy.hp}/${enemy.maxHp}）。`,
      );
    }

    // Check enemy defeated
    if (enemy.hp <= 0) {
      turnLogs.push(`🏆 击败了 ${enemy.emoji} **${enemy.name}**！`);

      if (enemy.kind === 'boss' || run.floor >= chapterDef.floors) {
        return this.handleVictoryInTx(guildId, userId, run, chapterDef, turnLogs, nowMs, rng);
      }

      const isElite = enemy.kind === 'elite';
      const floorCoins = Math.round(
        chapterDef.clearBaseCoins * (isElite ? 0.18 : 0.1) * (0.9 + clampUnit(rng()) * 0.2),
      );
      const floorXp = Math.round(chapterDef.clearBaseXp * (isElite ? 0.28 : 0.16));
      const dropChance = isElite ? 0.9 : 0.55;
      const droppedItem =
        clampUnit(rng()) < dropChance
          ? generatePendingItem(chapterDef.chapter, isElite ? 'elite' : 'monster', rng)
          : null;

      run.pendingCoins += floorCoins;
      run.pendingXp += floorXp;
      if (droppedItem) {
        run.pendingItems.push(droppedItem);
        const meta = RARITY_META[droppedItem.rarity];
        turnLogs.push(
          `💰 战利品暂存：**+${floorCoins}** 金币、**+${floorXp}** 经验、${meta.emoji} **${droppedItem.name}**`,
        );
      } else {
        turnLogs.push(`💰 战利品暂存：**+${floorCoins}** 金币、**+${floorXp}** 经验`);
      }

      run.enemy = null;
      run.phase = 'floor_clear';
      run.logs.push(...turnLogs);
      this.saveRunInTx(guildId, userId, run, nowMs);

      return {
        ok: true,
        outcome: 'floor_cleared',
        run,
        logs: turnLogs,
        floorLoot: { coins: floorCoins, xp: floorXp, item: droppedItem },
      };
    }

    // Enemy counter-attack
    const dodged = clampUnit(rng()) < run.playerDodgeBp / 10000;
    if (dodged) {
      turnLogs.push(`💨 你灵巧闪避了 **${enemy.name}** 的反击！`);
    } else {
      const isBossSpecial = enemy.kind === 'boss' && run.turn % 3 === 0;
      const enemyMult = isBossSpecial ? 1.35 : 1.0;
      const variance = 0.9 + clampUnit(rng()) * 0.2;
      const rawEnemyDmg = enemy.atk * enemyMult * variance - run.playerDef * 0.6;
      const guardedDmg = defending ? rawEnemyDmg * 0.45 : rawEnemyDmg;
      const finalEnemyDmg = Math.max(3, Math.round(guardedDmg));
      run.playerHp = Math.max(0, run.playerHp - finalEnemyDmg);

      if (isBossSpecial && enemy.bossSkillName) {
        turnLogs.push(
          `💢 **${enemy.name}** 释放「**${enemy.bossSkillName}**」造成 **${finalEnemyDmg}** 伤害（你的 HP ${run.playerHp}/${run.playerMaxHp}）！`,
        );
      } else {
        turnLogs.push(
          `🩸 **${enemy.name}** 反击造成 **${finalEnemyDmg}** 伤害（你的 HP ${run.playerHp}/${run.playerMaxHp}）。`,
        );
      }
    }

    if (enemy.armorBreakTurns > 0) {
      enemy.armorBreakTurns -= 1;
    }
    run.turn += 1;

    // Check player defeat
    if (run.playerHp <= 0) {
      turnLogs.push(`💀 你在第 ${run.floor} 层力竭倒下，本次探险未入库的战利品全部遗失！`);
      this.rpgRepo.deleteRun(guildId, userId);
      return {
        ok: true,
        outcome: 'defeat',
        run: null,
        chapter: run.chapter,
        floor: run.floor,
        logs: turnLogs,
        lostLoot: {
          coins: run.pendingCoins,
          xp: run.pendingXp,
          itemCount: run.pendingItems.length,
        },
      };
    }

    run.logs.push(...turnLogs);
    this.saveRunInTx(guildId, userId, run, nowMs);

    return {
      ok: true,
      outcome: 'ongoing',
      run,
      logs: turnLogs,
    };
  }

  private handleRetreatInTx(
    guildId: string,
    userId: string,
    run: RpgRunState,
    chapterDef: RpgChapterDef,
    nowMs: number,
  ): ActInRunResult {
    const logs = [`🏃 见好就收！你带着已获得的战利品从「**${chapterDef.name}**」第 ${run.floor} 层安全撤退。`];
    const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
    const {
      reward,
      legendaryDrops,
      updatedCharacter,
      balance,
    } = this.bankLootInTx({
      guildId,
      userId,
      character,
      pendingCoins: run.pendingCoins,
      pendingXp: run.pendingXp,
      pendingItems: run.pendingItems,
      bossBonusCoins: 0,
      creditDelta: 0,
      source: `rpg_retreat_ch${run.chapter}`,
      nowMs,
    });

    this.rpgRepo.saveCharacter(updatedCharacter);
    this.rpgRepo.deleteRun(guildId, userId);

    return {
      ok: true,
      outcome: 'retreated',
      run: null,
      chapter: run.chapter,
      floor: run.floor,
      logs,
      reward,
      legendaryDrops,
      character: updatedCharacter,
      balance,
    };
  }

  private handleVictoryInTx(
    guildId: string,
    userId: string,
    run: RpgRunState,
    chapterDef: RpgChapterDef,
    turnLogs: string[],
    nowMs: number,
    rng: () => number,
  ): ActInRunResult {
    const character = this.getOrCreateCharacterInTx(guildId, userId, nowMs);
    const firstClear = character.maxChapterCleared < chapterDef.chapter;

    const bossItem = generatePendingItem(chapterDef.chapter, 'boss', rng);
    const pendingItems = [...run.pendingItems, bossItem];

    const bossBonusCoins = firstClear
      ? Math.round(chapterDef.clearBaseCoins * chapterDef.firstClearMultiplier)
      : chapterDef.clearBaseCoins;
    const bossBonusXp = firstClear
      ? Math.round(chapterDef.clearBaseXp * 1.5)
      : chapterDef.clearBaseXp;

    const creditDelta = firstClear ? 25 : 5;
    const creditReason = firstClear
      ? `RPG首通第${chapterDef.chapter}章「${chapterDef.name}」`
      : `RPG通关第${chapterDef.chapter}章「${chapterDef.name}」`;

    const {
      reward,
      legendaryDrops,
      updatedCharacter: leveledChar,
      balance,
    } = this.bankLootInTx({
      guildId,
      userId,
      character,
      pendingCoins: run.pendingCoins,
      pendingXp: run.pendingXp + bossBonusXp,
      pendingItems,
      bossBonusCoins,
      creditDelta,
      source: `rpg_clear_ch${chapterDef.chapter}`,
      nowMs,
    });

    const finalCharacter: RpgCharacter = {
      ...leveledChar,
      maxChapterCleared: Math.max(leveledChar.maxChapterCleared, chapterDef.chapter),
      totalClears: leveledChar.totalClears + 1,
      totalBossKills: leveledChar.totalBossKills + 1,
      updatedAt: nowMs,
    };
    this.rpgRepo.saveCharacter(finalCharacter);
    this.rpgRepo.deleteRun(guildId, userId);

    if (this.onCreditChange) {
      this.onCreditChange(guildId, userId, creditDelta, creditReason, nowMs);
    }

    const meta = RARITY_META[bossItem.rarity];
    turnLogs.push(
      `🎉 通关第 ${chapterDef.chapter} 章「**${chapterDef.name}**」${firstClear ? '（首通双倍奖励！）' : ''}！掉落 ${meta.emoji} **${bossItem.name}**！`,
    );

    return {
      ok: true,
      outcome: 'victory',
      run: null,
      chapter: run.chapter,
      floor: run.floor,
      logs: turnLogs,
      reward,
      firstClear,
      legendaryDrops,
      character: finalCharacter,
      balance,
    };
  }

  private bankLootInTx(input: {
    guildId: string;
    userId: string;
    character: RpgCharacter;
    pendingCoins: number;
    pendingXp: number;
    pendingItems: PendingRpgItem[];
    bossBonusCoins: number;
    creditDelta: number;
    source: string;
    nowMs: number;
  }): {
    reward: RunBankedReward;
    legendaryDrops: RpgItem[];
    updatedCharacter: RpgCharacter;
    balance: number;
  } {
    const cfg = this.getConfig(input.guildId);
    const currentItemCount = this.rpgRepo.countItems(input.guildId, input.userId);
    const availableSlots = Math.max(0, cfg.bagCapacity - currentItemCount);

    // Prioritize higher rarity items for bag slots; auto-salvage overflow
    const sortedPending = [...input.pendingItems].sort(
      (a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity],
    );

    const bankedItems: RpgItem[] = [];
    let autoSalvagedCount = 0;
    let autoSalvagedCoins = 0;

    for (const item of sortedPending) {
      if (bankedItems.length < availableSlots) {
        const created = this.rpgRepo.createItem({
          guildId: input.guildId,
          userId: input.userId,
          name: item.name,
          slot: item.slot,
          rarity: item.rarity,
          baseHp: item.baseHp,
          baseAtk: item.baseAtk,
          baseDef: item.baseDef,
          baseCritBp: item.baseCritBp,
          enhanceLevel: 0,
          equipped: false,
          createdAt: input.nowMs,
        });
        bankedItems.push(created);
      } else {
        autoSalvagedCount += 1;
        autoSalvagedCoins += getSalvageValue({ rarity: item.rarity, enhanceLevel: 0 });
      }
    }

    const grossCoins =
      Math.max(0, Math.floor(input.pendingCoins)) +
      Math.max(0, Math.floor(input.bossBonusCoins)) +
      autoSalvagedCoins;

    let garnishedCoins = 0;
    let netCoins = grossCoins;
    if (grossCoins > 0 && this.onCoinsEarned) {
      const hookRes = this.onCoinsEarned(
        input.guildId,
        input.userId,
        grossCoins,
        input.source,
        input.nowMs,
      );
      garnishedCoins = Math.max(0, Math.floor(hookRes.garnished));
      netCoins = Math.max(0, Math.floor(hookRes.net));
    }

    const updatedProfile =
      netCoins > 0
        ? this.profileRepo.addCoins(input.guildId, input.userId, netCoins)
        : this.profileRepo.getOrCreate(input.guildId, input.userId);

    const { updated: leveledChar, levelsGained } = applyCharacterXp(
      input.character,
      input.pendingXp,
    );

    const legendaryDrops = bankedItems.filter((item) => item.rarity === 'legendary');

    return {
      reward: {
        grossCoins,
        garnishedCoins,
        netCoins,
        xpEarned: Math.max(0, Math.floor(input.pendingXp)),
        levelsGained,
        bankedItems,
        autoSalvagedCount,
        autoSalvagedCoins,
        bossBonusCoins: input.bossBonusCoins,
        creditDelta: input.creditDelta,
      },
      legendaryDrops,
      updatedCharacter: { ...leveledChar, updatedAt: input.nowMs },
      balance: updatedProfile.coins,
    };
  }
}
