import type { RpgClassKey } from '../../db/repositories/rpgRepo.js';

export const STAGE_ZH_LABELS: readonly string[] = [
  '一重',
  '二重',
  '三重',
  '四重',
  '五重',
  '六重',
  '七重',
  '八重',
  '九重',
];

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
}

export const RPG_CLASSES: readonly RpgClassDef[] = [
  {
    key: 'warrior',
    name: '圣殿战士',
    emoji: '⚔️',
    description: '高血量高防御，重甲破军稳健压制',
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
    skillDescription: '重甲冲锋破防，讨伐首领稳健增伤',
  },
  {
    key: 'mage',
    name: '奥术法师',
    emoji: '🔮',
    description: '极致法伤高暴击，陨星奥术焚灭强敌',
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
    skillDescription: '高额奥术暴击爆发，快速收割高阶猎场',
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
    skillDescription: '双段狙击暴击率拉满，讨伐评分稳定拔高',
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
    skillDescription: '圣光加护攻防均衡，全阶位适应力极强',
  },
];

export const RPG_CLASS_MAP: ReadonlyMap<RpgClassKey, RpgClassDef> = new Map(
  RPG_CLASSES.map((c) => [c.key, c]),
);

export interface RpgTierDef {
  tier: number;
  name: string;
  emoji: string;
  zoneName: string;
  zoneEmoji: string;
  bossName: string;
  bossEmoji: string;
  idleXpPerHour: number;
  idleCoinsPerHour: number;
  breakthroughBasePct: number;
}

export const RPG_TIERS: readonly RpgTierDef[] = [
  {
    tier: 1,
    name: '见习阶',
    emoji: '🌱',
    zoneName: '迷雾哨林',
    zoneEmoji: '🌲',
    bossName: '哥布林督军·格鲁克',
    bossEmoji: '👺',
    idleXpPerHour: 120,
    idleCoinsPerHour: 600,
    breakthroughBasePct: 85,
  },
  {
    tier: 2,
    name: '黑铁阶',
    emoji: '🪨',
    zoneName: '腐朽亡灵墓穴',
    zoneEmoji: '🦴',
    bossName: '骸骨领主·莫德雷德',
    bossEmoji: '💀',
    idleXpPerHour: 260,
    idleCoinsPerHour: 1200,
    breakthroughBasePct: 75,
  },
  {
    tier: 3,
    name: '青铜阶',
    emoji: '🥉',
    zoneName: '猩红血族古堡',
    zoneEmoji: '🏰',
    bossName: '血族伯爵·弗拉德',
    bossEmoji: '🧛',
    idleXpPerHour: 520,
    idleCoinsPerHour: 2200,
    breakthroughBasePct: 65,
  },
  {
    tier: 4,
    name: '白银阶',
    emoji: '🥈',
    zoneName: '矮人地心熔炉',
    zoneEmoji: '🌋',
    bossName: '熔岩魔像·卡兹丹',
    bossEmoji: '🔥',
    idleXpPerHour: 980,
    idleCoinsPerHour: 3800,
    breakthroughBasePct: 55,
  },
  {
    tier: 5,
    name: '黄金阶',
    emoji: '🥇',
    zoneName: '极北霜火龙巢',
    zoneEmoji: '🐉',
    bossName: '双头古龙·提亚马特',
    bossEmoji: '🐲',
    idleXpPerHour: 1750,
    idleCoinsPerHour: 6200,
    breakthroughBasePct: 45,
  },
  {
    tier: 6,
    name: '秘银阶',
    emoji: '💠',
    zoneName: '星界奥术高塔',
    zoneEmoji: '🔮',
    bossName: '虚空大魔导·梅林',
    bossEmoji: '👁️',
    idleXpPerHour: 3000,
    idleCoinsPerHour: 9800,
    breakthroughBasePct: 38,
  },
  {
    tier: 7,
    name: '史诗阶',
    emoji: '🔮',
    zoneName: '沉没泰坦神殿',
    zoneEmoji: '🏛️',
    bossName: '雷霆泰坦·克洛诺斯',
    bossEmoji: '⚡',
    idleXpPerHour: 5000,
    idleCoinsPerHour: 15000,
    breakthroughBasePct: 30,
  },
  {
    tier: 8,
    name: '传说阶',
    emoji: '👑',
    zoneName: '无尽深渊王座',
    zoneEmoji: '🌌',
    bossName: '堕落魔神·阿撒托斯',
    bossEmoji: '🔱',
    idleXpPerHour: 8200,
    idleCoinsPerHour: 23000,
    breakthroughBasePct: 24,
  },
  {
    tier: 9,
    name: '半神阶',
    emoji: '🔥',
    zoneName: '诸神黄昏裂隙',
    zoneEmoji: '☄️',
    bossName: '噬界魔狼·芬里尔',
    bossEmoji: '🐍',
    idleXpPerHour: 13000,
    idleCoinsPerHour: 35000,
    breakthroughBasePct: 18,
  },
  {
    tier: 10,
    name: '神座阶',
    emoji: '☀️',
    zoneName: '永恒创世星域',
    zoneEmoji: '✨',
    bossName: '混沌原初之影',
    bossEmoji: '👑',
    idleXpPerHour: 20000,
    idleCoinsPerHour: 52000,
    breakthroughBasePct: 0,
  },
];

export const RPG_TIER_MAP: ReadonlyMap<number, RpgTierDef> = new Map(
  RPG_TIERS.map((t) => [t.tier, t]),
);

export interface RpgRealmInfo {
  level: number;
  tier: number;
  stage: number;
  stageZh: string;
  tierDef: RpgTierDef;
  nextTierDef: RpgTierDef | null;
  fullLabel: string;
}
