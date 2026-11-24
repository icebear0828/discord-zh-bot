import { describe, expect, it } from 'vitest';
import type { PetRarity } from '../../src/db/repositories/socialPetRepo.js';
import type { PetSynergyInfo } from '../../src/services/rpgService.js';
import {
  BOSS_WEAKEN_DC_REDUCTION,
  computeChoicePreview,
  createInitialTabletopRun,
  deriveTabletopAttributes,
  drinkTabletopPotion,
  getBossSceneId,
  getCreditCharmBonus,
  getCurrentTabletopView,
  getPetCheckBonus,
  isTabletopRunState,
  resolveTabletopChoice,
  scaleBribeCoinCost,
  selectSceneChoices,
  type TabletopBossActDef,
  type TabletopCatalog,
  type TabletopChoiceDef,
  type TabletopSceneDef,
} from '../../src/services/rpgTabletopCore.js';

function makePet(rarity: PetRarity, nickname = '欧皇锦鲤'): PetSynergyInfo {
  return {
    petId: 1,
    nickname,
    emoji: '🐾',
    rarity,
    level: 5,
    bonusHp: 30,
    bonusAtk: 10,
    bonusCritBp: 200,
    assistChance: 0.4,
    assistDamage: 15,
  };
}

function makeChoice(overrides: Partial<TabletopChoiceDef> & { id: string }): TabletopChoiceDef {
  return {
    label: `选项 ${overrides.id}`,
    detail: `策略描述 ${overrides.id}`,
    stat: 'might',
    dc: 12,
    rewardCoinsMult: 1.0,
    rewardXpMult: 1.0,
    dropChance: 0.5,
    failHpPct: 0.15,
    critFailHpPct: 0.3,
    successText: '你漂亮地化解了眼前的危机。',
    critSuccessText: '天选一击！敌人当场怀疑人生！',
    failText: '计划出了点岔子，你挨了一记闷棍。',
    critFailText: '你一脚踩空滚进了泥潭，连乌鸦都在嘲笑你。',
    ...overrides,
  };
}

function makeTestCatalog(): TabletopCatalog {
  const scenes: TabletopSceneDef[] = [
    {
      id: 'ch1_scene_1',
      chapter: 1,
      title: '哥布林收费站',
      emoji: '🌲',
      narrative: '三只戴着歪斜税官帽的哥布林拦住了密林小径，正敲着破铜锣索要过路费。',
      choices: [
        makeChoice({
          id: 'ch1_s1_warrior',
          label: '重剑拍桌震慑',
          stat: 'might',
          dc: 11,
          requiredClass: 'warrior',
          rewardCoinsMult: 1.4,
        }),
        makeChoice({
          id: 'ch1_s1_goldcard',
          label: '亮出黑吊国金卡',
          stat: 'charm',
          dc: 13,
          creditPerk: 'high_free',
          coinCost: 500,
          rewardCoinsMult: 1.2,
        }),
        makeChoice({
          id: 'ch1_s1_deadbeat',
          label: '掏出老赖通缉令恐吓',
          stat: 'charm',
          dc: 13,
          creditPerk: 'deadbeat_intimidate',
          rewardCoinsMult: 1.1,
        }),
        makeChoice({
          id: 'ch1_s1_sneak',
          label: '借树影潜行绕过',
          stat: 'agility',
          dc: 12,
        }),
        makeChoice({
          id: 'ch1_s1_bribe',
          label: '扔出一袋金币买路',
          stat: undefined,
          dc: undefined,
          coinCost: 400,
          rewardCoinsMult: 0.5,
          rewardXpMult: 0.8,
          dropChance: 0,
        }),
      ],
    },
    {
      id: 'ch1_scene_2',
      chapter: 1,
      title: '腐朽树精祭坛',
      emoji: '🪵',
      narrative: '古老的树根缠绕着一只发光的宝箱，树皮上浮现出诡异的符文。',
      choices: [
        makeChoice({
          id: 'ch1_s2_arcana',
          label: '解析符文结界',
          stat: 'arcana',
          dc: 12,
          healPctOnSuccess: 0.2,
        }),
        makeChoice({
          id: 'ch1_s2_might',
          label: '徒手掰开树根',
          stat: 'might',
          dc: 13,
        }),
        makeChoice({
          id: 'ch1_s2_agility',
          label: '飞刀挑断藤蔓',
          stat: 'agility',
          dc: 12,
        }),
        makeChoice({
          id: 'ch1_s2_charm',
          label: '向古树低语祈祷',
          stat: 'charm',
          dc: 11,
          healPctOnSuccess: 0.25,
        }),
      ],
    },
    {
      id: 'shared_tavern',
      chapter: 'shared',
      title: '迷雾酒馆豪赌',
      emoji: '🍺',
      narrative: '独眼雇佣兵把一枚刻着骷髅的骰子拍在桌上，挑衅地冲你抬了抬下巴。',
      choices: [
        makeChoice({
          id: 'sh_tav_agility',
          label: '手法出千换骰',
          stat: 'agility',
          dc: 13,
        }),
        makeChoice({
          id: 'sh_tav_charm',
          label: '心理博弈诈唬',
          stat: 'charm',
          dc: 12,
        }),
        makeChoice({
          id: 'sh_tav_arcana',
          label: '微弱念力控骰',
          stat: 'arcana',
          dc: 13,
        }),
        makeChoice({
          id: 'sh_tav_bribe',
          label: '请全场喝麦酒套话',
          stat: undefined,
          dc: undefined,
          coinCost: 300,
          rewardCoinsMult: 0.6,
          dropChance: 0,
        }),
      ],
    },
    {
      id: 'shared_bridge',
      chapter: 'shared',
      title: '断桥伏击',
      emoji: '🌉',
      narrative: '浓雾笼罩的石桥中央堆满拒马，弓弦绷紧的声音从岩壁后传来。',
      choices: [
        makeChoice({
          id: 'sh_br_might',
          label: '举盾硬闯破阵',
          stat: 'might',
          dc: 13,
        }),
        makeChoice({
          id: 'sh_br_agility',
          label: '踩着桥栏疾掠',
          stat: 'agility',
          dc: 12,
        }),
        makeChoice({
          id: 'sh_br_arcana',
          label: '释放强光闪盲',
          stat: 'arcana',
          dc: 12,
        }),
        makeChoice({
          id: 'sh_br_charm',
          label: '高喊税官巡查',
          stat: 'charm',
          dc: 13,
        }),
      ],
    },
  ];

  const bossActs: TabletopBossActDef[] = [
    {
      chapter: 1,
      bossName: '哥布林酋长·格鲁克',
      bossEmoji: '👑',
      phase1Title: '酋长营地外围·破局前哨',
      phase1Narrative: '格鲁克坐在由抢来的金杯堆成的宝座上，脚边堆着一桶随时会炸的劣质黑火药。',
      phase1Choices: [
        makeChoice({
          id: 'b1_p1_weaken',
          label: '引爆宝座旁的火药桶',
          stat: 'agility',
          dc: 12,
          weakenBoss: true,
          rewardCoinsMult: 1.2,
        }),
        makeChoice({
          id: 'b1_p1_might',
          label: '正面冲锋震碎木盾',
          stat: 'might',
          dc: 13,
          weakenBoss: true,
        }),
        makeChoice({
          id: 'b1_p1_arcana',
          label: '咒术熄灭萨满图腾',
          stat: 'arcana',
          dc: 13,
        }),
        makeChoice({
          id: 'b1_p1_charm',
          label: '当众揭发酋长私吞军饷',
          stat: 'charm',
          dc: 14,
        }),
      ],
      phase2Title: '酋长决战·终局裁决',
      phase2Narrative: '灰头土脸的格鲁克抡起狼牙棒狂怒冲来，整个营地的火把都在剧烈颤抖！',
      phase2Choices: [
        makeChoice({
          id: 'b1_p2_might',
          label: '迎面斩断狼牙棒',
          stat: 'might',
          dc: 14,
          failHpPct: 0.22,
          critFailHpPct: 0.35,
        }),
        makeChoice({
          id: 'b1_p2_agility',
          label: '侧身滑步直取要害',
          stat: 'agility',
          dc: 14,
          failHpPct: 0.2,
          critFailHpPct: 0.34,
        }),
        makeChoice({
          id: 'b1_p2_arcana',
          label: '奥术锁链封死退路',
          stat: 'arcana',
          dc: 14,
          failHpPct: 0.2,
          critFailHpPct: 0.35,
        }),
        makeChoice({
          id: 'b1_p2_charm',
          label: '威压喝令部众倒戈',
          stat: 'charm',
          dc: 15,
          failHpPct: 0.18,
          critFailHpPct: 0.32,
        }),
      ],
      victoryEpilogue: '格鲁克的王冠咕噜噜滚到你脚边，密林深处响起了劫后余生的欢呼。',
    },
  ];

  return { scenes, bossActs };
}

function sequenceRng(values: readonly number[]): () => number {
  let idx = 0;
  return () => {
    const val = values[Math.min(idx, values.length - 1)] ?? 0.5;
    idx += 1;
    return val;
  };
}

// D20 helper: returns an rng value that produces exact D20 face (1..20)
function rngForD20(face: number): number {
  return (face - 0.5) / 20;
}

describe('deriveTabletopAttributes', () => {
  it('assigns distinct natural primary/secondary stats across all 4 classes', () => {
    const warrior = deriveTabletopAttributes({
      classKey: 'warrior',
      level: 5,
      maxHp: 280,
      atk: 45,
      def: 26,
      critBp: 1100,
      dodgeBp: 500,
      creditScore: 600,
      petSynergy: null,
    });
    const mage = deriveTabletopAttributes({
      classKey: 'mage',
      level: 5,
      maxHp: 190,
      atk: 62,
      def: 15,
      critBp: 1800,
      dodgeBp: 700,
      creditScore: 600,
      petSynergy: null,
    });
    const ranger = deriveTabletopAttributes({
      classKey: 'ranger',
      level: 5,
      maxHp: 215,
      atk: 54,
      def: 18,
      critBp: 2200,
      dodgeBp: 1500,
      creditScore: 600,
      petSynergy: null,
    });
    const paladin = deriveTabletopAttributes({
      classKey: 'paladin',
      level: 5,
      maxHp: 260,
      atk: 46,
      def: 24,
      critBp: 1350,
      dodgeBp: 600,
      creditScore: 600,
      petSynergy: null,
    });

    expect(warrior.might).toBeGreaterThan(warrior.arcana);
    expect(warrior.might).toBeGreaterThan(warrior.agility);
    expect(warrior.charm).toBeGreaterThan(warrior.arcana);

    expect(mage.arcana).toBeGreaterThan(mage.might);
    expect(mage.arcana).toBeGreaterThan(mage.charm);
    expect(mage.agility).toBeGreaterThan(mage.might);

    expect(ranger.agility).toBeGreaterThan(ranger.arcana);
    expect(ranger.agility).toBeGreaterThan(ranger.charm);
    expect(ranger.might).toBeGreaterThan(ranger.charm);

    expect(paladin.charm).toBeGreaterThan(paladin.agility);
    expect(paladin.charm).toBeGreaterThan(paladin.arcana);
    expect(paladin.might).toBeGreaterThan(paladin.agility);
  });

  it('visibly increases tabletop stats and D20 modifiers with level and gear upgrades', () => {
    const lv1Ungeared = deriveTabletopAttributes({
      classKey: 'warrior',
      level: 1,
      maxHp: 170,
      atk: 24,
      def: 14,
      critBp: 1000,
      dodgeBp: 500,
      creditScore: 600,
      petSynergy: null,
    });
    const lv1Geared = deriveTabletopAttributes({
      classKey: 'warrior',
      level: 1,
      maxHp: 290,
      atk: 60,
      def: 35,
      critBp: 1600,
      dodgeBp: 500,
      creditScore: 600,
      petSynergy: null,
    });
    const lv20Endgame = deriveTabletopAttributes({
      classKey: 'warrior',
      level: 20,
      maxHp: 1264,
      atk: 260,
      def: 157,
      critBp: 3000,
      dodgeBp: 500,
      creditScore: 600,
      petSynergy: null,
    });

    expect(lv1Geared.might).toBeGreaterThan(lv1Ungeared.might);
    expect(lv1Geared.mightMod).toBeGreaterThan(lv1Ungeared.mightMod);
    expect(lv20Endgame.mightMod).toBeGreaterThan(lv1Geared.mightMod);
    expect(lv1Ungeared.mightMod).toBeGreaterThanOrEqual(1);
    expect(lv20Endgame.mightMod).toBeLessThanOrEqual(10);
  });

  it('applies exact credit score charm bonuses across all 5 tiers', () => {
    expect(getCreditCharmBonus(900)).toBe(3);
    expect(getCreditCharmBonus(850)).toBe(3);
    expect(getCreditCharmBonus(849)).toBe(2);
    expect(getCreditCharmBonus(700)).toBe(2);
    expect(getCreditCharmBonus(600)).toBe(0);
    expect(getCreditCharmBonus(499)).toBe(-1);
    expect(getCreditCharmBonus(300)).toBe(-1);
    expect(getCreditCharmBonus(200)).toBe(-2);

    const baseInput = {
      classKey: 'paladin' as const,
      level: 5,
      maxHp: 250,
      atk: 45,
      def: 22,
      critBp: 1300,
      dodgeBp: 600,
      petSynergy: null,
    };
    const goldCard = deriveTabletopAttributes({ ...baseInput, creditScore: 850 });
    const neutral = deriveTabletopAttributes({ ...baseInput, creditScore: 600 });
    const deadbeat = deriveTabletopAttributes({ ...baseInput, creditScore: 200 });

    expect(goldCard.creditCharmBonus).toBe(3);
    expect(deadbeat.creditCharmBonus).toBe(-2);
    expect(goldCard.charmMod - neutral.charmMod).toBe(3);
    expect(neutral.charmMod - deadbeat.charmMod).toBe(2);
  });

  it('maps pet rarity N/R/SR/SSR to exact check bonuses', () => {
    expect(getPetCheckBonus(null)).toBe(0);
    expect(getPetCheckBonus(makePet('N'))).toBe(1);
    expect(getPetCheckBonus(makePet('R'))).toBe(1);
    expect(getPetCheckBonus(makePet('SR'))).toBe(2);
    expect(getPetCheckBonus(makePet('SSR'))).toBe(3);

    const withSsr = deriveTabletopAttributes({
      classKey: 'mage',
      level: 5,
      maxHp: 180,
      atk: 60,
      def: 14,
      critBp: 1800,
      dodgeBp: 700,
      creditScore: 600,
      petSynergy: makePet('SSR'),
    });
    expect(withSsr.petCheckBonus).toBe(3);
  });
});

describe('selectSceneChoices & computeChoicePreview', () => {
  const catalog = makeTestCatalog();
  const scene1 = catalog.scenes[0]!;

  it('prioritizes class-exclusive choice first, then eligible credit perk, then diverse option', () => {
    // Warrior with Gold Card (850): gets warrior exclusive + high_free + diverse 3rd option
    const warriorGold = selectSceneChoices({
      choices: scene1.choices,
      classKey: 'warrior',
      creditScore: 850,
      pocketCoins: 5000,
      chapter: 1,
    });
    expect(warriorGold).toHaveLength(3);
    expect(warriorGold[0]!.id).toBe('ch1_s1_warrior');
    expect(warriorGold[1]!.id).toBe('ch1_s1_goldcard');
    expect(new Set(warriorGold.map((c) => c.id)).size).toBe(3);

    // Mage with Deadbeat (200): filters out warrior exclusive, prioritizes deadbeat_intimidate
    const mageDeadbeat = selectSceneChoices({
      choices: scene1.choices,
      classKey: 'mage',
      creditScore: 200,
      pocketCoins: 5000,
      chapter: 1,
    });
    expect(mageDeadbeat).toHaveLength(3);
    expect(mageDeadbeat.some((c) => c.requiredClass === 'warrior')).toBe(false);
    expect(mageDeadbeat[0]!.id).toBe('ch1_s1_deadbeat');
  });

  it('calculates exact D20 probability (5..95), Nat20/Nat1 caps, Boss weaken -3, and autoSuccess', () => {
    const attrs = deriveTabletopAttributes({
      classKey: 'warrior',
      level: 1,
      maxHp: 170,
      atk: 24,
      def: 14,
      critBp: 1000,
      dodgeBp: 500,
      creditScore: 600,
      petSynergy: makePet('SR'), // +2 petCheckBonus
    });

    // Standard rolled check: DC 12, totalMod = mightMod + 2
    const stdChoice = makeChoice({ id: 'std', stat: 'might', dc: 12 });
    const stdPreview = computeChoicePreview({
      choice: stdChoice,
      attrs,
      creditScore: 600,
      pocketCoins: 1000,
      chapter: 1,
    });
    const expectedMinRoll = Math.max(2, Math.min(20, 12 - (attrs.mightMod + 2)));
    expect(stdPreview.autoSuccess).toBe(false);
    expect(stdPreview.effectiveDc).toBe(12);
    expect(stdPreview.totalModifier).toBe(attrs.mightMod + 2);
    expect(stdPreview.successChancePct).toBe((21 - expectedMinRoll) * 5);

    // Extremely easy DC still caps at 95% (Nat 1 always fails)
    const easyPreview = computeChoicePreview({
      choice: makeChoice({ id: 'easy', stat: 'might', dc: 2 }),
      attrs,
      creditScore: 600,
      pocketCoins: 1000,
      chapter: 1,
    });
    expect(easyPreview.successChancePct).toBe(95);

    // Extremely hard DC still floors at 5% (Nat 20 always succeeds)
    const hardPreview = computeChoicePreview({
      choice: makeChoice({ id: 'hard', stat: 'arcana', dc: 40 }),
      attrs,
      creditScore: 600,
      pocketCoins: 1000,
      chapter: 1,
    });
    expect(hardPreview.successChancePct).toBe(5);

    // Boss Phase 2 weakened reduces effective DC by 3
    const normalBossPreview = computeChoicePreview({
      choice: makeChoice({ id: 'boss_hit', stat: 'might', dc: 15 }),
      attrs,
      creditScore: 600,
      pocketCoins: 1000,
      chapter: 1,
      bossStage: 2,
      bossWeakened: false,
    });
    const weakenedBossPreview = computeChoicePreview({
      choice: makeChoice({ id: 'boss_hit', stat: 'might', dc: 15 }),
      attrs,
      creditScore: 600,
      pocketCoins: 1000,
      chapter: 1,
      bossStage: 2,
      bossWeakened: true,
    });
    expect(normalBossPreview.effectiveDc! - weakenedBossPreview.effectiveDc!).toBe(
      BOSS_WEAKEN_DC_REDUCTION,
    );
    expect(weakenedBossPreview.successChancePct).toBeGreaterThan(
      normalBossPreview.successChancePct,
    );

    // Gold Card (>= 850) on high_free => autoSuccess 100% and coinCost 0
    const goldPreview = computeChoicePreview({
      choice: scene1.choices[1]!, // high_free + coinCost 500
      attrs,
      creditScore: 850,
      pocketCoins: 0,
      chapter: 3,
    });
    expect(goldPreview.autoSuccess).toBe(true);
    expect(goldPreview.successChancePct).toBe(100);
    expect(goldPreview.coinCost).toBe(0);
    expect(goldPreview.canAfford).toBe(true);

    // Platinum (750) on high_free => +5 creditPerkBonus (not auto-pass)
    const platPreview = computeChoicePreview({
      choice: scene1.choices[1]!,
      attrs,
      creditScore: 750,
      pocketCoins: 2000,
      chapter: 1,
    });
    expect(platPreview.autoSuccess).toBe(false);
    expect(platPreview.creditPerkBonus).toBe(5);

    // Deadbeat (< 500) on deadbeat_intimidate => +4 creditPerkBonus
    const deadbeatPreview = computeChoicePreview({
      choice: scene1.choices[2]!,
      attrs,
      creditScore: 250,
      pocketCoins: 2000,
      chapter: 1,
    });
    expect(deadbeatPreview.creditPerkBonus).toBe(4);

    // Coin bribe (no stat) => autoSuccess 100%, scaled coinCost
    const bribePreview = computeChoicePreview({
      choice: scene1.choices[4]!, // coinCost 400
      attrs,
      creditScore: 600,
      pocketCoins: 500,
      chapter: 3,
    });
    expect(bribePreview.autoSuccess).toBe(true);
    expect(bribePreview.successChancePct).toBe(100);
    expect(bribePreview.coinCost).toBe(scaleBribeCoinCost(400, 3));
    expect(bribePreview.canAfford).toBe(false);
  });
});

describe('resolveTabletopChoice outcomes', () => {
  const catalog = makeTestCatalog();

  function startCh1Run(overrides?: {
    creditScore?: number;
    pocketCoins?: number;
    petSynergy?: PetSynergyInfo | null;
    maxHp?: number;
  }) {
    return createInitialTabletopRun({
      chapter: 1,
      classKey: 'warrior',
      level: 1,
      maxHp: overrides?.maxHp ?? 170,
      atk: 24,
      def: 14,
      critBp: 1000,
      dodgeBp: 500,
      creditScore: overrides?.creditScore ?? 600,
      petSynergy: overrides?.petSynergy === undefined ? makePet('SR') : overrides.petSynergy,
      pocketCoins: overrides?.pocketCoins ?? 2000,
      catalog,
      rng: () => 0.0, // Picks ch1_scene_1
    });
  }

  it('handles Nat 20 with double loot, item drop, petLine, and publicHighlight', () => {
    const run = startCh1Run();
    expect(isTabletopRunState(run)).toBe(true);
    expect(run.currentSceneId).toBe('ch1_scene_1');

    // First run with normal success (roll 15) to compare loot vs Nat 20
    const normalRes = resolveTabletopChoice({
      state: run,
      choiceId: 'ch1_s1_warrior',
      pocketCoins: 2000,
      catalog,
      rng: sequenceRng([rngForD20(15), 0.99, 0.1]), // roll 15, no item drop, pick next scene
    });
    expect(normalRes.ok).toBe(true);
    if (!normalRes.ok) throw new Error('expected ok');
    expect(normalRes.outcome.outcome).toBe('success');
    expect(normalRes.outcome.publicHighlight).toBeUndefined();
    expect(normalRes.outcome.petLine).toContain('欧皇锦鲤');

    // Now roll Nat 20
    const nat20Res = resolveTabletopChoice({
      state: run,
      choiceId: 'ch1_s1_warrior',
      pocketCoins: 2000,
      catalog,
      rng: sequenceRng([rngForD20(20), 0.2, 0.2, 0.2, 0.2]),
    });
    expect(nat20Res.ok).toBe(true);
    if (!nat20Res.ok) throw new Error('expected ok');
    expect(nat20Res.outcome.outcome).toBe('crit_success');
    expect(nat20Res.outcome.rolled).toBe(20);
    expect(nat20Res.outcome.coinsDelta).toBe(normalRes.outcome.coinsDelta * 2);
    expect(nat20Res.outcome.xpDelta).toBe(normalRes.outcome.xpDelta * 2);
    expect(nat20Res.outcome.itemDroppedLabel).toBeDefined();
    expect(nat20Res.state.pendingItems).toHaveLength(1);
    expect(nat20Res.outcome.publicHighlight?.kind).toBe('nat20');
    expect(nat20Res.outcome.petLine).toContain('欧皇锦鲤');
  });

  it('handles Normal Fail (HP loss) and Nat 1 (extra HP loss + publicHighlight)', () => {
    const run = startCh1Run({ petSynergy: null });

    const failRes = resolveTabletopChoice({
      state: run,
      choiceId: 'ch1_s1_warrior',
      pocketCoins: 2000,
      catalog,
      rng: sequenceRng([rngForD20(2), 0.1]), // 2 + mightMod(3) = 5 < DC 11 => fail
    });
    expect(failRes.ok).toBe(true);
    if (!failRes.ok) throw new Error('expected ok');
    expect(failRes.outcome.outcome).toBe('fail');
    expect(failRes.outcome.hpDelta).toBeLessThan(0);
    expect(failRes.outcome.coinsDelta).toBe(0);
    expect(failRes.outcome.publicHighlight).toBeUndefined();

    const nat1Res = resolveTabletopChoice({
      state: run,
      choiceId: 'ch1_s1_warrior',
      pocketCoins: 2000,
      catalog,
      rng: sequenceRng([rngForD20(1), 0.1]), // Nat 1 => crit_fail
    });
    expect(nat1Res.ok).toBe(true);
    if (!nat1Res.ok) throw new Error('expected ok');
    expect(nat1Res.outcome.outcome).toBe('crit_fail');
    expect(nat1Res.outcome.rolled).toBe(1);
    expect(Math.abs(nat1Res.outcome.hpDelta)).toBeGreaterThan(Math.abs(failRes.outcome.hpDelta));
    expect(nat1Res.outcome.publicHighlight?.kind).toBe('nat1');
  });

  it('handles Gold Card auto-success, coin bribe auto-success, and insufficient_coins rejection', () => {
    // Gold Card (850) face-pass even with 0 pocket coins
    const goldRun = startCh1Run({ creditScore: 850, pocketCoins: 0 });
    expect(goldRun.currentChoiceIds).toContain('ch1_s1_goldcard');
    const goldRes = resolveTabletopChoice({
      state: goldRun,
      choiceId: 'ch1_s1_goldcard',
      pocketCoins: 0,
      catalog,
      rng: sequenceRng([0.9, 0.1]),
    });
    expect(goldRes.ok).toBe(true);
    if (!goldRes.ok) throw new Error('expected ok');
    expect(goldRes.outcome.outcome).toBe('auto');
    expect(goldRes.outcome.rolled).toBeNull();
    expect(goldRes.coinsSpent).toBe(0);

    // Coin bribe rejection when broke, and auto-success when funded
    const bribeRun = startCh1Run({ creditScore: 600, pocketCoins: 2000 });
    expect(bribeRun.currentChoiceIds).toContain('ch1_s1_bribe');

    const brokeRes = resolveTabletopChoice({
      state: bribeRun,
      choiceId: 'ch1_s1_bribe',
      pocketCoins: 100, // need 400
      catalog,
    });
    expect(brokeRes).toEqual({
      ok: false,
      reason: 'insufficient_coins',
      requiredCoins: 400,
    });

    const paidRes = resolveTabletopChoice({
      state: bribeRun,
      choiceId: 'ch1_s1_bribe',
      pocketCoins: 1000,
      catalog,
      rng: () => 0.1,
    });
    expect(paidRes.ok).toBe(true);
    if (!paidRes.ok) throw new Error('expected ok');
    expect(paidRes.outcome.outcome).toBe('auto');
    expect(paidRes.coinsSpent).toBe(400);
    expect(paidRes.state.pendingCoins).toBeGreaterThan(0);
    expect(paidRes.outcome.coinsDelta).toBe(paidRes.state.pendingCoins - 400);
  });

  it('attaches clutch pet rescue line when pet bonus turns a fail into a success', () => {
    const run = startCh1Run({ petSynergy: makePet('SR') }); // mightMod = 3, petBonus = 2, DC = 11
    // Roll 7 => without pet: 7 + 3 = 10 (< 11 fail); with pet: 7 + 5 = 12 (>= 11 success!)
    const res = resolveTabletopChoice({
      state: run,
      choiceId: 'ch1_s1_warrior',
      pocketCoins: 2000,
      catalog,
      rng: sequenceRng([rngForD20(7), 0.9, 0.1]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.outcome.outcome).toBe('success');
    expect(res.outcome.petLine).toContain('惊险翻盘');
  });

  it('rejects invalid choice IDs cleanly', () => {
    const run = startCh1Run();
    const res = resolveTabletopChoice({
      state: run,
      choiceId: 'nonexistent_choice',
      pocketCoins: 2000,
      catalog,
    });
    expect(res).toEqual({ ok: false, reason: 'invalid_choice' });
  });

  it('enforces Nat 20 always succeeds (even vs DC 50) and Nat 1 always fails (even vs DC 2)', () => {
    const extremeCatalog: TabletopCatalog = {
      scenes: [
        {
          id: 'extreme_scene',
          chapter: 1,
          title: '命运天平',
          emoji: '⚖️',
          narrative: '命运的硬币悬在半空。',
          choices: [
            makeChoice({ id: 'impossible', stat: 'might', dc: 50, healPctOnSuccess: 0.2 }),
            makeChoice({ id: 'trivial', stat: 'might', dc: 2 }),
            makeChoice({ id: 'backup', stat: 'charm', dc: 10 }),
          ],
        },
        catalog.scenes[2]!,
      ],
      bossActs: catalog.bossActs,
    };

    const run = createInitialTabletopRun({
      chapter: 1,
      classKey: 'warrior',
      level: 10,
      maxHp: 400,
      atk: 120,
      def: 70,
      critBp: 1500,
      dodgeBp: 500,
      creditScore: 600,
      petSynergy: null,
      pocketCoins: 1000,
      catalog: extremeCatalog,
      rng: () => 0.0,
    });

    const damaged = { ...run, playerHp: 200 };

    // Nat 20 beats DC 50 and triggers 1.5x healPctOnSuccess
    const nat20 = resolveTabletopChoice({
      state: damaged,
      choiceId: 'impossible',
      pocketCoins: 1000,
      catalog: extremeCatalog,
      rng: sequenceRng([rngForD20(20), 0.1, 0.1, 0.1, 0.1]),
    });
    expect(nat20.ok).toBe(true);
    if (!nat20.ok) throw new Error('expected ok');
    expect(nat20.outcome.outcome).toBe('crit_success');
    expect(nat20.outcome.hpDelta).toBe(Math.round(400 * 0.3));
    expect(nat20.state.playerHp).toBe(200 + Math.round(400 * 0.3));

    // Nat 1 loses vs DC 2 despite massive modifier
    const nat1 = resolveTabletopChoice({
      state: damaged,
      choiceId: 'trivial',
      pocketCoins: 1000,
      catalog: extremeCatalog,
      rng: sequenceRng([rngForD20(1), 0.1]),
    });
    expect(nat1.ok).toBe(true);
    if (!nat1.ok) throw new Error('expected ok');
    expect(nat1.outcome.outcome).toBe('crit_fail');
    expect(nat1.outcome.hpDelta).toBeLessThan(0);
  });

  it('keeps bossWeakened false in Phase 2 when Phase 1 weaken check fails', () => {
    const run = startCh1Run({ petSynergy: null });
    const phase1State = {
      ...run,
      act: 5,
      bossStage: 1 as const,
      bossWeakened: false,
      currentSceneId: getBossSceneId(1, 1),
      currentChoiceIds: ['b1_p1_weaken', 'b1_p1_might', 'b1_p1_arcana'],
    };

    const failP1 = resolveTabletopChoice({
      state: phase1State,
      choiceId: 'b1_p1_weaken',
      pocketCoins: 2000,
      catalog,
      rng: () => rngForD20(2),
    });
    expect(failP1.ok).toBe(true);
    if (!failP1.ok || failP1.status !== 'ongoing') throw new Error('expected phase 2 ongoing');
    expect(failP1.outcome.outcome).toBe('fail');
    expect(failP1.state.bossStage).toBe(2);
    expect(failP1.state.bossWeakened).toBe(false);
  });
});

describe('Full 5-Act seamless run, Boss Phase 2 retry, Potion, and Defeat', () => {
  const catalog = makeTestCatalog();

  it('completes a full 5-act run: Acts 1..4 -> Boss Phase 1 weaken -> Boss Phase 2 fail retry -> Potion -> Victory', () => {
    let state = createInitialTabletopRun({
      chapter: 1,
      classKey: 'warrior',
      level: 3,
      maxHp: 220,
      atk: 34,
      def: 20,
      critBp: 1100,
      dodgeBp: 500,
      creditScore: 600,
      petSynergy: makePet('R'),
      pocketCoins: 3000,
      catalog,
      rng: () => 0.0,
    });

    expect(state.act).toBe(1);
    expect(state.bossStage).toBe(0);

    // Acts 1 -> 2 -> 3 -> 4 -> Act 5 Boss Phase 1 (4 scene transitions, all unseen scenes!)
    for (let expectedAct = 1; expectedAct <= 4; expectedAct += 1) {
      expect(state.act).toBe(expectedAct);
      expect(state.bossStage).toBe(0);
      const choiceId = state.currentChoiceIds[0]!;
      const res = resolveTabletopChoice({
        state,
        choiceId,
        pocketCoins: 3000,
        catalog,
        rng: sequenceRng([rngForD20(16), 0.9, 0.0]),
      });
      expect(res.ok).toBe(true);
      if (!res.ok || res.status !== 'ongoing') throw new Error('expected ongoing');
      expect(res.state.lastOutcome?.choiceId).toBe(choiceId);
      state = res.state;
    }

    // All 4 pre-boss scenes were distinct
    expect(new Set(state.usedSceneIds).size).toBe(4);
    expect(state.act).toBe(5);
    expect(state.bossStage).toBe(1);
    expect(state.currentSceneId).toBe(getBossSceneId(1, 1));
    expect(state.bossWeakened).toBe(false);

    // Boss Phase 1: pick a weakenBoss choice and succeed => Boss Phase 2 with bossWeakened = true
    const bossView1 = getCurrentTabletopView(state, catalog);
    expect(bossView1?.isBoss).toBe(true);
    const weakenChoice = bossView1!.choices.find((c) => c.weakenBoss);
    expect(weakenChoice).toBeDefined();

    const p1Res = resolveTabletopChoice({
      state,
      choiceId: weakenChoice!.id,
      pocketCoins: 3000,
      catalog,
      rng: sequenceRng([rngForD20(16), 0.9]),
    });
    expect(p1Res.ok).toBe(true);
    if (!p1Res.ok || p1Res.status !== 'ongoing') throw new Error('expected phase 2');
    state = p1Res.state;
    expect(state.act).toBe(5);
    expect(state.bossStage).toBe(2);
    expect(state.bossWeakened).toBe(true);
    expect(state.currentSceneId).toBe(getBossSceneId(1, 2));

    // Boss Phase 2: fail once with HP > 0 => takes damage and STAYS in Boss Phase 2!
    const hpBeforeFail = state.playerHp;
    const p2Fail = resolveTabletopChoice({
      state,
      choiceId: state.currentChoiceIds[0]!,
      pocketCoins: 3000,
      catalog,
      rng: sequenceRng([rngForD20(2)]),
    });
    expect(p2Fail.ok).toBe(true);
    if (!p2Fail.ok || p2Fail.status !== 'ongoing') throw new Error('expected phase 2 retry');
    state = p2Fail.state;
    expect(state.act).toBe(5);
    expect(state.bossStage).toBe(2);
    expect(state.bossWeakened).toBe(true);
    expect(state.playerHp).toBeLessThan(hpBeforeFail);
    expect(state.playerHp).toBeGreaterThan(0);

    // Drink potion without advancing act/bossStage
    const potionsBefore = state.potionsLeft;
    const potionRes = drinkTabletopPotion(state);
    expect(potionRes.ok).toBe(true);
    if (!potionRes.ok) throw new Error('expected potion ok');
    expect(potionRes.healed).toBeGreaterThan(0);
    expect(potionRes.state.potionsLeft).toBe(potionsBefore - 1);
    expect(potionRes.state.act).toBe(5);
    expect(potionRes.state.bossStage).toBe(2);
    expect(potionRes.state.playerHp).toBe(state.playerHp + potionRes.healed);
    state = potionRes.state;

    // Boss Phase 2 retry: succeed => chapter victory with epilogue!
    const p2Win = resolveTabletopChoice({
      state,
      choiceId: state.currentChoiceIds[0]!,
      pocketCoins: 3000,
      catalog,
      rng: sequenceRng([rngForD20(18), 0.1, 0.2, 0.2, 0.2]),
    });
    expect(p2Win.ok).toBe(true);
    if (!p2Win.ok || p2Win.status !== 'victory') throw new Error('expected victory');
    expect(p2Win.victoryEpilogue).toContain('格鲁克');
    expect(p2Win.state.pendingCoins).toBeGreaterThan(0);
    expect(p2Win.state.pendingXp).toBeGreaterThan(0);
  });

  it('rejects potion drinking when full HP or out of potions', () => {
    const state = createInitialTabletopRun({
      chapter: 1,
      classKey: 'mage',
      level: 1,
      maxHp: 115,
      atk: 34,
      def: 7,
      critBp: 1600,
      dodgeBp: 700,
      creditScore: 600,
      petSynergy: null,
      pocketCoins: 1000,
      potionsLeft: 1,
      catalog,
      rng: () => 0.0,
    });

    expect(drinkTabletopPotion(state)).toEqual({ ok: false, reason: 'already_full_hp' });

    const injured = { ...state, playerHp: 50 };
    const drink1 = drinkTabletopPotion(injured);
    expect(drink1.ok).toBe(true);
    if (!drink1.ok) throw new Error('expected drink1 ok');
    expect(drink1.healed).toBe(Math.round(115 * 0.45));
    expect(drink1.state.potionsLeft).toBe(0);

    expect(drinkTabletopPotion(drink1.state)).toEqual({ ok: false, reason: 'no_potions_left' });
  });

  it('returns defeat with lostLoot when HP drops to 0', () => {
    const run = createInitialTabletopRun({
      chapter: 1,
      classKey: 'ranger',
      level: 1,
      maxHp: 130,
      atk: 29,
      def: 9,
      critBp: 2000,
      dodgeBp: 1500,
      creditScore: 600,
      petSynergy: null,
      pocketCoins: 1000,
      catalog,
      rng: () => 0.0,
    });

    const nearDeath = {
      ...run,
      playerHp: 10,
      pendingCoins: 2500,
      pendingXp: 90,
    };

    const res = resolveTabletopChoice({
      state: nearDeath,
      choiceId: nearDeath.currentChoiceIds.find((id) => id !== 'ch1_s1_bribe')!,
      pocketCoins: 1000,
      catalog,
      rng: () => rngForD20(1),
    });
    expect(res.ok).toBe(true);
    if (!res.ok || res.status !== 'defeat') throw new Error('expected defeat');
    expect(res.state.playerHp).toBe(0);
    expect(res.lostLoot).toEqual({ coins: 2500, xp: 90, itemCount: 0 });
    expect(res.outcome.publicHighlight?.kind).toBe('nat1');
  });
});
