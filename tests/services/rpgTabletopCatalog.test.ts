import { describe, expect, it } from 'vitest';
import { RPG_CHAPTERS, RPG_CLASSES } from '../../src/services/rpgService.js';
import {
  getScenesForChapter,
  TABLETOP_BOSS_ACTS,
  TABLETOP_BOSS_MAP,
  TABLETOP_SCENES,
  TABLETOP_STAT_META,
  type TabletopChoiceDef,
  type TabletopStatKey,
} from '../../src/services/rpgTabletopCatalog.js';

const VALID_STATS = new Set<TabletopStatKey>(['might', 'arcana', 'agility', 'charm']);
const VALID_CLASSES = new Set(RPG_CLASSES.map((c) => c.key));
const VALID_CREDIT_PERKS = new Set(['high_free', 'deadbeat_intimidate']);

function assertChoiceValid(choice: TabletopChoiceDef, seenIds: Set<string>): void {
  expect(choice.id.trim().length).toBeGreaterThan(0);
  expect(seenIds.has(choice.id)).toBe(false);
  seenIds.add(choice.id);

  expect(choice.label.trim().length).toBeGreaterThan(0);
  expect(choice.label.length).toBeLessThanOrEqual(30);
  expect(choice.detail.trim().length).toBeGreaterThan(0);

  if (choice.stat !== undefined) {
    expect(VALID_STATS.has(choice.stat)).toBe(true);
    expect(choice.dc).toBeDefined();
    expect(choice.dc!).toBeGreaterThanOrEqual(8);
    expect(choice.dc!).toBeLessThanOrEqual(19);
  } else {
    expect(choice.dc).toBeUndefined();
  }

  if (choice.coinCost !== undefined) {
    expect(choice.coinCost).toBeGreaterThan(0);
    expect(Number.isInteger(choice.coinCost)).toBe(true);
  }

  if (choice.requiredClass !== undefined) {
    expect(VALID_CLASSES.has(choice.requiredClass)).toBe(true);
  }

  if (choice.creditPerk !== undefined) {
    expect(VALID_CREDIT_PERKS.has(choice.creditPerk)).toBe(true);
  }

  expect(choice.rewardCoinsMult).toBeGreaterThanOrEqual(0.5);
  expect(choice.rewardCoinsMult).toBeLessThanOrEqual(2.5);
  expect(choice.rewardXpMult).toBeGreaterThanOrEqual(0.5);
  expect(choice.rewardXpMult).toBeLessThanOrEqual(2.5);
  expect(choice.dropChance).toBeGreaterThanOrEqual(0);
  expect(choice.dropChance).toBeLessThanOrEqual(1);

  expect(choice.failHpPct).toBeGreaterThanOrEqual(0.05);
  expect(choice.failHpPct).toBeLessThanOrEqual(0.35);
  expect(choice.critFailHpPct).toBeGreaterThan(choice.failHpPct);
  expect(choice.critFailHpPct).toBeLessThanOrEqual(0.45);

  if (choice.healPctOnSuccess !== undefined) {
    expect(choice.healPctOnSuccess).toBeGreaterThan(0);
    expect(choice.healPctOnSuccess).toBeLessThanOrEqual(0.5);
  }

  expect(choice.successText.trim().length).toBeGreaterThanOrEqual(20);
  expect(choice.critSuccessText.trim().length).toBeGreaterThanOrEqual(20);
  expect(choice.failText.trim().length).toBeGreaterThanOrEqual(10);
  expect(choice.critFailText.trim().length).toBeGreaterThanOrEqual(10);
}

describe('rpgTabletopCatalog', () => {
  it('defines metadata for all four DND tabletop stats', () => {
    const keys: TabletopStatKey[] = ['might', 'arcana', 'agility', 'charm'];
    for (const key of keys) {
      const meta = TABLETOP_STAT_META[key];
      expect(meta).toBeDefined();
      expect(meta.key).toBe(key);
      expect(meta.label.trim().length).toBeGreaterThan(0);
      expect(meta.emoji.trim().length).toBeGreaterThan(0);
      expect(meta.shortDesc.trim().length).toBeGreaterThan(0);
    }
  });

  it('has at least 3 unique scenes per chapter 1..6 and at least 12 shared scenes', () => {
    for (const chapterDef of RPG_CHAPTERS) {
      const chapterOnly = TABLETOP_SCENES.filter((s) => s.chapter === chapterDef.chapter);
      expect(chapterOnly.length).toBeGreaterThanOrEqual(3);

      const available = getScenesForChapter(chapterDef.chapter);
      expect(available.length).toBeGreaterThanOrEqual(15);
      for (const scene of available) {
        expect(scene.chapter === chapterDef.chapter || scene.chapter === 'shared').toBe(true);
      }
    }

    const sharedScenes = TABLETOP_SCENES.filter((s) => s.chapter === 'shared');
    expect(sharedScenes.length).toBeGreaterThanOrEqual(12);
    expect(TABLETOP_SCENES.length).toBeGreaterThanOrEqual(30);
  });

  it('has globally unique scene IDs and choice IDs with valid narrative and choice constraints', () => {
    const seenSceneIds = new Set<string>();
    const seenChoiceIds = new Set<string>();
    const coveredClasses = new Set<string>();
    const coveredPerks = new Set<string>();
    let bribeCount = 0;

    for (const scene of TABLETOP_SCENES) {
      expect(scene.id.trim().length).toBeGreaterThan(0);
      expect(seenSceneIds.has(scene.id)).toBe(false);
      seenSceneIds.add(scene.id);

      expect(scene.title.trim().length).toBeGreaterThan(0);
      expect(scene.emoji.trim().length).toBeGreaterThan(0);
      expect(scene.narrative.trim().length).toBeGreaterThanOrEqual(40);
      expect(scene.choices.length).toBeGreaterThanOrEqual(4);
      expect(scene.choices.length).toBeLessThanOrEqual(5);

      for (const cls of RPG_CLASSES) {
        const eligible = scene.choices.filter(
          (c) => !c.requiredClass || c.requiredClass === cls.key,
        );
        expect(eligible.length).toBeGreaterThanOrEqual(3);
      }

      for (const choice of scene.choices) {
        assertChoiceValid(choice, seenChoiceIds);
        if (choice.requiredClass) coveredClasses.add(choice.requiredClass);
        if (choice.creditPerk) coveredPerks.add(choice.creditPerk);
        if (choice.coinCost !== undefined) bribeCount += 1;
      }
    }

    // Ensure all 4 classes, both credit perks, and coin bribes appear in the catalog
    expect(coveredClasses.size).toBe(4);
    expect(coveredPerks.has('high_free')).toBe(true);
    expect(coveredPerks.has('deadbeat_intimidate')).toBe(true);
    expect(bribeCount).toBeGreaterThanOrEqual(5);

    // Validate all 6 boss acts and ensure choice IDs do not collide with scene choices
    expect(TABLETOP_BOSS_ACTS.length).toBe(RPG_CHAPTERS.length);
    expect(TABLETOP_BOSS_MAP.size).toBe(RPG_CHAPTERS.length);

    for (const chapterDef of RPG_CHAPTERS) {
      const bossAct = TABLETOP_BOSS_MAP.get(chapterDef.chapter);
      expect(bossAct).toBeDefined();
      expect(bossAct!.chapter).toBe(chapterDef.chapter);
      expect(bossAct!.bossName).toBe(chapterDef.boss.name);
      expect(bossAct!.bossEmoji).toBe(chapterDef.boss.emoji);

      expect(bossAct!.phase1Title.trim().length).toBeGreaterThan(0);
      expect(bossAct!.phase1Narrative.trim().length).toBeGreaterThanOrEqual(40);
      expect(bossAct!.phase1Choices.length).toBeGreaterThanOrEqual(3);
      expect(bossAct!.phase1Choices.some((c) => c.weakenBoss === true)).toBe(true);

      expect(bossAct!.phase2Title.trim().length).toBeGreaterThan(0);
      expect(bossAct!.phase2Narrative.trim().length).toBeGreaterThanOrEqual(40);
      expect(bossAct!.phase2Choices.length).toBeGreaterThanOrEqual(3);
      expect(bossAct!.victoryEpilogue.trim().length).toBeGreaterThanOrEqual(30);

      for (const cls of RPG_CLASSES) {
        expect(
          bossAct!.phase1Choices.filter((c) => !c.requiredClass || c.requiredClass === cls.key)
            .length,
        ).toBeGreaterThanOrEqual(3);
        expect(
          bossAct!.phase2Choices.filter((c) => !c.requiredClass || c.requiredClass === cls.key)
            .length,
        ).toBeGreaterThanOrEqual(3);
      }

      for (const choice of bossAct!.phase1Choices) {
        assertChoiceValid(choice, seenChoiceIds);
      }
      for (const choice of bossAct!.phase2Choices) {
        assertChoiceValid(choice, seenChoiceIds);
      }
    }
  });
});
