import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ECONOMY_CONFIG } from '../../src/config/defaults.js';
import { PET_BOSS_BONUS_CAP } from '../../src/config/economyConstants.js';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { WorldEventRepo } from '../../src/db/repositories/worldEventRepo.js';
import { handleWorldEventButton } from '../../src/interactions/worldEventHandler.js';
import {
  RPG_BOSS_HEAVY_BONUS_CAP,
  RPG_BOSS_NORMAL_BONUS_CAP,
  WorldEventService,
  type BossAttackMode,
  type RpgWorldBossBonus,
  type RpgWorldBossBridge,
} from '../../src/services/worldEventService.js';
import type { AppContext } from '../../src/ui/embeds.js';
import {
  buildWorldBossCard,
  formatBossAttackLog,
  parseBossRewardsJson,
} from '../../src/ui/worldEventMenuBuilder.js';

function createFixture(rpgBridge?: RpgWorldBossBridge) {
  const db = createDatabase(':memory:');
  const configRepo = new GuildConfigRepo(db);
  const profileRepo = new ProfileRepo(db);
  const worldEventRepo = new WorldEventRepo(db);
  const socialPetRepo = new SocialPetRepo(db);
  const worldEvent = new WorldEventService(
    db,
    configRepo,
    profileRepo,
    worldEventRepo,
    socialPetRepo,
    undefined,
    rpgBridge,
  );
  return { db, configRepo, profileRepo, worldEventRepo, socialPetRepo, worldEvent };
}

function makeButtonInteractionMock(options: {
  customId: string;
  userId: string;
  guildId?: string;
}) {
  const callOrder: string[] = [];
  const reply = vi.fn(async () => {
    callOrder.push('reply');
  });
  const update = vi.fn(async () => {
    callOrder.push('update');
  });
  const followUp = vi.fn(async () => {
    callOrder.push('followUp');
  });
  const messageEdit = vi.fn(async () => {
    callOrder.push('message.edit');
  });

  const interaction = {
    guildId: options.guildId ?? 'g1',
    customId: options.customId,
    user: { id: options.userId },
    reply,
    update,
    followUp,
    message: { edit: messageEdit },
  } as unknown as ButtonInteraction;

  return { interaction, reply, update, followUp, messageEdit, callOrder };
}

describe('World Boss <-> RPG Bridge linkage (TDD)', () => {
  it('clamps normal (<=120) and heavy (<=180) RPG hero bonus, gives 0 bonus on heavy miss, and handles non-RPG users', () => {
    const getBonusSpy = vi.fn(
      (
        _guildId: string,
        userId: string,
        mode: BossAttackMode,
        _nowMs: number,
      ): RpgWorldBossBonus | null => {
        if (userId === 'hero-max') {
          return {
            bonusDamage: mode === 'heavy' ? 999 : 500,
            classEmoji: '🔮',
            realmLabel: '神话阶·九重',
          };
        }
        if (userId === 'hero-low') {
          return {
            bonusDamage: 48,
            classEmoji: '⚔️',
            realmLabel: '黑铁阶·六重',
          };
        }
        return null;
      },
    );
    const awardDustSpy = vi.fn(() => new Map<string, number>());

    const bridge: RpgWorldBossBridge = {
      getBossAttackBonus: getBonusSpy,
      awardBossKillDust: awardDustSpy,
    };

    const { db, configRepo, socialPetRepo, worldEvent } = createFixture(bridge);
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateGames('g1', {
      ...cfg.games,
      bossBaseHp: 5000,
      bossRewardPool: 2000,
    });

    socialPetRepo.createPet({
      guildId: 'g1',
      ownerId: 'hero-max',
      speciesKey: 'dragon',
      nickname: '小火龙',
      rarity: 'SSR',
      hp: 1000,
      atk: 500,
      spd: 100,
      critRate: 0.2,
      trait: '勇猛',
      isActive: true,
      createdAt: 1000,
    });

    const boss = worldEvent.spawnBoss('g1', 'c1', 10_000, () => 0.5);

    // 1) Normal attack for max-stat hero -> capped at RPG_BOSS_NORMAL_BONUS_CAP (120)
    // rng = 0.5 -> base = 35 + floor(0.5 * 31) = 50, crit = false (0.5 >= 0.15)
    // damage = 50 + PET_BOSS_BONUS_CAP (80) + 120 = 250
    const normalMax = worldEvent.attackBoss(boss.id, 'hero-max', 'normal', 11_000, () => 0.5);
    expect(normalMax.ok).toBe(true);
    if (normalMax.ok) {
      expect(normalMax.missed).toBe(false);
      expect(normalMax.petBonus).toBe(PET_BOSS_BONUS_CAP);
      expect(normalMax.rpgBonus).toBe(RPG_BOSS_NORMAL_BONUS_CAP);
      expect(normalMax.rpgBonus).toBe(120);
      expect(normalMax.rpgHeroLabel).toBe('🔮 神话阶·九重');
      expect(normalMax.damage).toBe(50 + PET_BOSS_BONUS_CAP + 120);
    }

    // 2) Heavy attack for max-stat hero after 12s normal cooldown -> capped at RPG_BOSS_HEAVY_BONUS_CAP (180)
    // rng = 0.5 -> not missed (0.5 >= 0.25), base = 90 + floor(0.5 * 66) = 123, crit = false (0.5 >= 0.25)
    // damage = 123 + 80 + 180 = 383
    const heavyMax = worldEvent.attackBoss(boss.id, 'hero-max', 'heavy', 24_000, () => 0.5);
    expect(heavyMax.ok).toBe(true);
    if (heavyMax.ok) {
      expect(heavyMax.missed).toBe(false);
      expect(heavyMax.rpgBonus).toBe(RPG_BOSS_HEAVY_BONUS_CAP);
      expect(heavyMax.rpgBonus).toBe(180);
      expect(heavyMax.rpgHeroLabel).toBe('🔮 神话阶·九重');
      expect(heavyMax.damage).toBe(123 + PET_BOSS_BONUS_CAP + 180);
    }

    // 3) Uncapped lower RPG hero bonus passes exact integer value
    const normalLow = worldEvent.attackBoss(boss.id, 'hero-low', 'normal', 25_000, () => 0.5);
    expect(normalLow.ok).toBe(true);
    if (normalLow.ok) {
      expect(normalLow.rpgBonus).toBe(48);
      expect(normalLow.rpgHeroLabel).toBe('⚔️ 黑铁阶·六重');
      expect(normalLow.damage).toBe(50 + 48);
    }

    // 4) Missed heavy attack -> 0 damage, 0 rpgBonus, null rpgHeroLabel
    const heavyMiss = worldEvent.attackBoss(boss.id, 'hero-max', 'heavy', 55_000, () => 0.1);
    expect(heavyMiss.ok).toBe(true);
    if (heavyMiss.ok) {
      expect(heavyMiss.missed).toBe(true);
      expect(heavyMiss.damage).toBe(0);
      expect(heavyMiss.rpgBonus).toBe(0);
      expect(heavyMiss.rpgHeroLabel).toBeNull();
    }

    // 5) Non-RPG chatter -> null from bridge -> 0 rpgBonus, null rpgHeroLabel
    const chatterHit = worldEvent.attackBoss(boss.id, 'chatter-1', 'normal', 56_000, () => 0.5);
    expect(chatterHit.ok).toBe(true);
    if (chatterHit.ok) {
      expect(chatterHit.rpgBonus).toBe(0);
      expect(chatterHit.rpgHeroLabel).toBeNull();
      expect(chatterHit.damage).toBe(50);
    }
    expect(awardDustSpy).not.toHaveBeenCalled();

    db.close();
  });

  it('awards Arcane Dust on Boss kill via setRpgBridge, attaches dustAwarded on BossRewardEntry, and persists in rewardsJson', () => {
    const { db, configRepo, worldEvent } = createFixture();
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateGames('g1', {
      ...cfg.games,
      bossBaseHp: 220,
      bossRewardPool: 1000,
    });

    const awardDustSpy = vi.fn(
      (
        guildId: string,
        participantUserIds: readonly string[],
        mvpUserId: string,
        nowMs: number,
      ): ReadonlyMap<string, number> => {
        expect(guildId).toBe('g1');
        expect(mvpUserId).toBe('hero-killer');
        expect(nowMs).toBe(15_000);
        expect([...participantUserIds].sort()).toEqual(['chatter-only', 'hero-assist', 'hero-killer']);
        return new Map<string, number>([
          ['hero-assist', 12],
          ['hero-killer', 24],
        ]);
      },
    );

    worldEvent.setRpgBridge({
      getBossAttackBonus: (_g, userId) =>
        userId.startsWith('hero-')
          ? { bonusDamage: 40, classEmoji: '🏹', realmLabel: '白银阶·三重' }
          : null,
      awardBossKillDust: awardDustSpy,
    });

    const boss = worldEvent.spawnBoss('g1', 'c1', 10_000, () => 0.5);

    // Non-RPG chatter deals 50 (HP: 220 -> 170)
    expect(worldEvent.attackBoss(boss.id, 'chatter-only', 'normal', 11_000, () => 0.5).ok).toBe(
      true,
    );
    // RPG assist hero deals 50 + 40 = 90 (HP: 170 -> 80)
    expect(worldEvent.attackBoss(boss.id, 'hero-assist', 'normal', 12_000, () => 0.5).ok).toBe(
      true,
    );
    // Miss participant with 0 total damage should NOT be in hitters passed to awardBossKillDust
    expect(worldEvent.attackBoss(boss.id, 'whiffer', 'heavy', 13_000, () => 0.05).ok).toBe(true);

    // RPG killer finishes remaining 80 HP
    const killRes = worldEvent.attackBoss(boss.id, 'hero-killer', 'heavy', 15_000, () => 0.8);
    expect(killRes.ok).toBe(true);
    expect(awardDustSpy).toHaveBeenCalledTimes(1);

    if (killRes.ok) {
      expect(killRes.killed).toBe(true);
      const byUser = new Map(killRes.rewards.map((r) => [r.userId, r]));
      expect(byUser.get('chatter-only')?.dustAwarded).toBe(0);
      expect(byUser.get('hero-assist')?.dustAwarded).toBe(12);
      expect(byUser.get('hero-killer')?.dustAwarded).toBe(24);
      expect(byUser.has('whiffer')).toBe(false);

      // Persisted rewardsJson round-trips dustAwarded cleanly
      const detail = worldEvent.getWorldEventDetail(boss.id);
      expect(detail?.event.status).toBe('completed');
      const parsed = parseBossRewardsJson(detail!.event.rewardsJson);
      const parsedByUser = new Map(parsed.map((r) => [r.userId, r]));
      expect(parsedByUser.get('chatter-only')?.dustAwarded).toBe(0);
      expect(parsedByUser.get('hero-assist')?.dustAwarded).toBe(12);
      expect(parsedByUser.get('hero-killer')?.dustAwarded).toBe(24);
    }

    db.close();
  });

  it('renders RPG hero bonus & Arcane Dust in formatBossAttackLog, buildWorldBossCard, and worldEventHandler followUp while preserving cooldown/expired gotchas', async () => {
    const bridge: RpgWorldBossBridge = {
      getBossAttackBonus: (_g, userId, mode) =>
        userId === 'u-hero'
          ? {
              bonusDamage: mode === 'heavy' ? 180 : 95,
              classEmoji: '🔮',
              realmLabel: '黑铁阶·六重',
            }
          : null,
      awardBossKillDust: () => new Map([['u-hero', 18]]),
    };

    const { db, configRepo, profileRepo, worldEventRepo, socialPetRepo, worldEvent } =
      createFixture(bridge);
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateGames('g1', {
      ...cfg.games,
      bossBaseHp: 320,
      bossRewardPool: 1000,
    });

    const ctx = {
      repos: {
        guildConfig: configRepo,
        profile: profileRepo,
        worldEvent: worldEventRepo,
        socialPet: socialPetRepo,
      },
      services: {
        worldEvent,
      },
    } as unknown as AppContext;

    const boss = worldEvent.spawnBoss('g1', 'c1', Date.now(), () => 0.5);

    // 1) Normal hit via WorldEventService + formatBossAttackLog + active buildWorldBossCard
    const hitRes = worldEvent.attackBoss(boss.id, 'u-hero', 'normal', Date.now(), () => 0.5);
    expect(hitRes.ok).toBe(true);
    if (hitRes.ok) {
      const log = formatBossAttackLog('u-hero', 'normal', hitRes, DEFAULT_ECONOMY_CONFIG);
      expect(log).toContain('🔮 黑铁阶·六重');
      expect(log).toContain('+95');

      const activeCard = buildWorldBossCard(
        hitRes.event,
        hitRes.participants,
        DEFAULT_ECONOMY_CONFIG,
        log,
      );
      const activeDesc = activeCard.embeds[0]!.toJSON().description ?? '';
      expect(activeDesc).toContain('🔮 黑铁阶·六重');
      expect(activeDesc).toContain('+95');
    }

    // 2) Cooldown hit via handleWorldEventButton MUST reply ephemeral and NEVER edit message!
    const cdBtn = makeButtonInteractionMock({
      customId: `ev:boss:hit:${boss.id}:normal`,
      userId: 'u-hero',
    });
    await handleWorldEventButton(cdBtn.interaction, ctx);
    expect(cdBtn.reply).toHaveBeenCalledTimes(1);
    expect(cdBtn.reply.mock.calls[0]![0]).toMatchObject({ flags: MessageFlags.Ephemeral });
    expect(cdBtn.messageEdit).not.toHaveBeenCalled();
    expect(cdBtn.update).not.toHaveBeenCalled();

    // 3) Kill boss via handleWorldEventButton from another user / after advancing participant cooldown
    // Spawn a low-HP boss so u-hero one-shots it via button interaction (normal attack never misses!)
    configRepo.updateGames('g1', {
      ...configRepo.getOrCreate('g1').games,
      bossBaseHp: 100,
      bossRewardPool: 1000,
    });
    const boss2 = worldEvent.spawnBoss('g1', 'c1', Date.now(), () => 0.5);
    // Chatter hits first for ~35..99? Let's spawn with 120 HP and have u-hero one-shot (base >=35 + 95 >= 130 >= 120!)
    const killBtn = makeButtonInteractionMock({
      customId: `ev:boss:hit:${boss2.id}:normal`,
      userId: 'u-hero',
    });
    await handleWorldEventButton(killBtn.interaction, ctx);
    expect(killBtn.update).toHaveBeenCalledTimes(1);
    expect(killBtn.followUp).toHaveBeenCalledTimes(1);

    const updatedCardPayload = killBtn.update.mock.calls[0]![0] as ReturnType<
      typeof buildWorldBossCard
    >;
    const completedDesc = updatedCardPayload.embeds[0]!.toJSON().description ?? '';
    expect(completedDesc).toContain('✨ 魔尘 +18');

    const followUpPayload = killBtn.followUp.mock.calls[0]![0] as {
      embeds: Array<{ toJSON(): { description?: string } }>;
      flags: number;
    };
    expect(followUpPayload.flags).toBe(MessageFlags.Ephemeral);
    const followDesc = followUpPayload.embeds[0]!.toJSON().description ?? '';
    expect(followDesc).toContain('🔮 黑铁阶·六重');
    expect(followDesc).toContain('+95');
    expect(followDesc).toContain('✨ 魔尘 +18');

    // Redrawing completed Boss card solely from DB (without passing live rewards) still shows Arcane Dust
    const detail2 = worldEvent.getWorldEventDetail(boss2.id)!;
    const redrawnCard = buildWorldBossCard(
      detail2.event,
      detail2.participants,
      DEFAULT_ECONOMY_CONFIG,
    );
    expect(redrawnCard.embeds[0]!.toJSON().description).toContain('✨ 魔尘 +18');

    // 4) Hitting already-completed Boss replies ephemeral FIRST before message.edit
    const staleBtn = makeButtonInteractionMock({
      customId: `ev:boss:hit:${boss2.id}:normal`,
      userId: 'u-other',
    });
    await handleWorldEventButton(staleBtn.interaction, ctx);
    expect(staleBtn.callOrder).toEqual(['reply', 'message.edit']);

    db.close();
  });
});
