import { describe, expect, it } from 'vitest';
import {
  PET_MAX_LEVEL,
  PET_PVP_COOLDOWN_MS,
  PET_PVP_DAILY_XP_CAP,
  PET_WORK_COOLDOWN_MS,
  PET_WORK_LEVEL_BONUS_CAP,
} from '../../src/config/economyConstants.js';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import {
  applyPetXp,
  calculatePetReleaseRefund,
  simulatePetBattle,
  SocialPetService,
} from '../../src/services/socialPetService.js';

function createFixture() {
  const db = createDatabase(':memory:');
  const configRepo = new GuildConfigRepo(db);
  const profileRepo = new ProfileRepo(db);
  const shopRepo = new ShopRepo(db);
  const socialPetRepo = new SocialPetRepo(db);
  const socialPet = new SocialPetService(
    db,
    configRepo,
    profileRepo,
    shopRepo,
    socialPetRepo,
    'Asia/Shanghai',
  );
  return { db, configRepo, profileRepo, shopRepo, socialPetRepo, socialPet };
}

describe('SocialPetService (CP relationships & blind-box pets)', () => {
  it('enforces 1v1 marriage, prevents duplicate pending proposals, refunds declined/expired proposals, and unlocks milestone titles', () => {
    const { db, profileRepo, shopRepo, socialPet } = createFixture();
    profileRepo.addCoins('g1', 'u1', 5000);
    profileRepo.addCoins('g1', 'u2', 5000);
    profileRepo.addCoins('g1', 'u3', 5000);

    // Propose -> duplicate pending proposal in either direction is blocked!
    const pDecline = socialPet.createProposal({
      guildId: 'g1',
      channelId: 'c1',
      proposerId: 'u1',
      targetId: 'u2',
      relType: 'marriage',
      nowMs: 1000,
    });
    expect(pDecline.ok).toBe(true);
    if (!pDecline.ok) return;
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(4500);

    expect(
      socialPet.createProposal({
        guildId: 'g1',
        channelId: 'c1',
        proposerId: 'u1',
        targetId: 'u2',
        relType: 'marriage',
        nowMs: 1500,
      }),
    ).toEqual({ ok: false, reason: 'pending_proposal_exists' });

    expect(
      socialPet.createProposal({
        guildId: 'g1',
        channelId: 'c1',
        proposerId: 'u2',
        targetId: 'u1',
        relType: 'sworn',
        nowMs: 1600,
      }),
    ).toEqual({ ok: false, reason: 'pending_proposal_exists' });

    // Decline refunds cost
    expect(socialPet.declineProposal(pDecline.proposal.id, 'u2', 2000)).toMatchObject({
      ok: true,
      refunded: 500,
    });
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(5000);

    // Propose & accept marriage
    const pMarry = socialPet.createProposal({
      guildId: 'g1',
      channelId: 'c1',
      proposerId: 'u1',
      targetId: 'u2',
      relType: 'marriage',
      nowMs: 3000,
    });
    expect(pMarry.ok).toBe(true);
    if (!pMarry.ok) return;

    const acc = socialPet.acceptProposal(pMarry.proposal.id, 'u2', 4000);
    expect(acc.ok).toBe(true);
    if (!acc.ok) return;
    const relId = acc.relationship.id;
    expect(acc.relationship.affinity).toBe(10);

    // Strict 1v1 marriage prevents second marriage
    expect(
      socialPet.createProposal({
        guildId: 'g1',
        channelId: 'c1',
        proposerId: 'u1',
        targetId: 'u3',
        relType: 'marriage',
        nowMs: 5000,
      }),
    ).toEqual({ ok: false, reason: 'proposer_married' });

    // Daily checkins unlock milestone 50 title '💞 甜蜜新婚' for BOTH u1 & u2
    const dayMs = 86_400_000;
    const baseTime = Date.UTC(2026, 0, 1, 4, 0, 0);
    const c1 = socialPet.checkinRelationship(relId, 'u1', baseTime, () => 0.99);
    expect(c1.ok).toBe(true);
    expect(socialPet.checkinRelationship(relId, 'u2', baseTime + 1000)).toEqual({
      ok: false,
      reason: 'already_checked_in',
    });
    const c2 = socialPet.checkinRelationship(relId, 'u2', baseTime + dayMs, () => 0.99);
    expect(c2.ok).toBe(true);
    if (c2.ok) {
      expect(c2.relationship.affinity).toBe(50);
      expect(c2.unlockedTitles).toContain('💞 甜蜜新婚');
    }
    expect(shopRepo.findInventoryByTypeAndName('g1', 'u1', 'title', '💞 甜蜜新婚')).not.toBeNull();
    expect(shopRepo.findInventoryByTypeAndName('g1', 'u2', 'title', '💞 甜蜜新婚')).not.toBeNull();

    // Dissolve leaves coins untouched
    const beforeU1 = profileRepo.getOrCreate('g1', 'u1').coins;
    expect(socialPet.dissolveRelationship(relId, 'u1').ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(beforeU1);
    expect(socialPet.listUserRelationships('g1', 'u1')).toHaveLength(0);

    // Expired proposal refunds
    const pExp = socialPet.createProposal({
      guildId: 'g1',
      channelId: 'c1',
      proposerId: 'u3',
      targetId: 'u2',
      relType: 'sworn',
      nowMs: 10_000,
    });
    if (pExp.ok) {
      const expired = socialPet.expireDueProposals(10_000 + 20 * 60 * 1000);
      expect(expired).toHaveLength(1);
      expect(profileRepo.getOrCreate('g1', 'u3').coins).toBe(5000);
    }

    db.close();
  });

  it('supports gacha (SSR-only highlight), user-level work cooldown, proportional release refund, battle bet freeze/refund, and pet_in_battle guard', () => {
    const { db, configRepo, profileRepo, socialPet } = createFixture();
    profileRepo.addCoins('g1', 'p1', 5000);
    profileRepo.addCoins('g1', 'p2', 5000);

    // Pull SSR pet for p1 (rng = 0.99 >= 0.97) -> isHighRarity = true
    const pullSsr = socialPet.pullPetGacha('g1', 'p1', 1000, () => 0.99);
    expect(pullSsr.ok).toBe(true);
    if (!pullSsr.ok) return;
    expect(pullSsr.pet.rarity).toBe('SSR');
    expect(pullSsr.pet.isActive).toBe(true);
    expect(pullSsr.isHighRarity).toBe(true);

    // Pull SR pet (rng = 0.90) -> isHighRarity MUST be false (SSR-only broadcast!)
    const pullSr = socialPet.pullPetGacha('g1', 'p1', 1500, () => 0.9);
    expect(pullSr.ok).toBe(true);
    if (!pullSr.ok) return;
    expect(pullSr.pet.rarity).toBe('SR');
    expect(pullSr.isHighRarity).toBe(false);

    // Pull N pet for p1 & p2
    const pullN = socialPet.pullPetGacha('g1', 'p1', 2000, () => 0.1);
    expect(pullN.ok).toBe(true);
    if (!pullN.ok) return;
    const p2Pet = socialPet.pullPetGacha('g1', 'p2', 3000, () => 0.1);
    expect(p2Pet.ok).toBe(true);

    // Feed & train levels up SSR pet
    expect(socialPet.feedPet('g1', 'p1', pullSsr.pet.id, 4000).ok).toBe(true);
    const trained = socialPet.trainPet('g1', 'p1', pullSsr.pet.id, 5000, () => 0.99);
    expect(trained.ok).toBe(true);
    if (trained.ok) {
      expect(trained.leveledUp).toBe(true);
      expect(trained.pet.level).toBe(2);
    }

    // Pet work enforces USER-LEVEL cooldown across switching pets!
    const worked = socialPet.workWithPet('g1', 'p1', pullSsr.pet.id, 6000, () => 0.5);
    expect(worked.ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'p1').lastPetWorkAt).toBe(6000);
    // Switching to another pet (pullN) CANNOT bypass user-level work cooldown!
    expect(socialPet.workWithPet('g1', 'p1', pullN.pet.id, 7000)).toMatchObject({
      ok: false,
      reason: 'cooldown',
    });
    // After 2h cooldown expires, another pet CAN work
    expect(
      socialPet.workWithPet('g1', 'p1', pullN.pet.id, 6000 + PET_WORK_COOLDOWN_MS, () => 0.5).ok,
    ).toBe(true);

    // Create pet battle -> freezes challenger bet immediately AND blocks releasing pet!
    const p1BeforeCreate = profileRepo.getOrCreate('g1', 'p1').coins;
    const p2BeforeBattle = profileRepo.getOrCreate('g1', 'p2').coins;
    const battleCreated = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'p1',
      opponentId: null,
      bet: 300,
      nowMs: 10_000,
    });
    expect(battleCreated.ok).toBe(true);
    if (!battleCreated.ok) return;
    expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(p1BeforeCreate - 300);

    // Cannot release pet while in pending battle
    expect(socialPet.releasePet('g1', 'p1', pullSsr.pet.id, 10_500)).toEqual({
      ok: false,
      reason: 'pet_in_battle',
    });

    // Self cannot accept open arena
    expect(socialPet.acceptPetBattle(battleCreated.battle.id, 'p1', 11_000)).toEqual({
      ok: false,
      reason: 'cannot_accept_self',
    });

    // Accept battle -> winner gets bet * 2 (net +300 over initial), opponent loses 300
    const fought = socialPet.acceptPetBattle(battleCreated.battle.id, 'p2', 12_000, () => 0.5);
    expect(fought.ok).toBe(true);
    if (fought.ok) {
      expect(fought.draw).toBe(false);
      expect(fought.winnerId).toBe('p1');
      expect(fought.challengerBalance).toBe(p1BeforeCreate + 300);
      expect(fought.opponentBalance).toBe(p2BeforeBattle - 300);
      expect(fought.challengerXpGained).toBe(30);
      expect(fought.opponentXpGained).toBe(12);
    }

    // Decline & expire pet battle refund frozen challenger bet
    const bDecline = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'p1',
      opponentId: 'p2',
      bet: 200,
      nowMs: 12_000 + PET_PVP_COOLDOWN_MS + 1000,
    });
    expect(bDecline.ok).toBe(true);
    if (bDecline.ok) {
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(p1BeforeCreate + 100);
      const dec = socialPet.declinePetBattle(
        bDecline.battle.id,
        'p2',
        12_000 + PET_PVP_COOLDOWN_MS + 2000,
      );
      expect(dec).toMatchObject({ ok: true, refunded: 200 });
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(p1BeforeCreate + 300);
    }

    const bExpire = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'p1',
      opponentId: null,
      bet: 250,
      nowMs: 100_000,
    });
    expect(bExpire.ok).toBe(true);
    if (bExpire.ok) {
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(p1BeforeCreate + 50);
      const expired = socialPet.expireDuePetBattles(100_000 + 15 * 60_000);
      expect(expired).toHaveLength(1);
      expect(profileRepo.getOrCreate('g1', 'p1').coins).toBe(p1BeforeCreate + 300);
    }

    // Release refund scales with cfg.games.petGachaPrice (default 500: SSR=500, N=125)
    // Lower price to 100 -> N=25, R=45, SR=75, SSR=100 (zero arbitrage!)
    const cfg = configRepo.getOrCreate('g1');
    expect(calculatePetReleaseRefund('N', 100)).toBe(25);
    expect(calculatePetReleaseRefund('R', 100)).toBe(45);
    expect(calculatePetReleaseRefund('SR', 100)).toBe(75);
    expect(calculatePetReleaseRefund('SSR', 100)).toBe(100);
    expect(calculatePetReleaseRefund('N', 0)).toBe(1);

    configRepo.updateGames('g1', { ...cfg.games, petGachaPrice: 500 });
    const rel = socialPet.releasePet('g1', 'p1', pullSsr.pet.id, 2_000_000);
    expect(rel.ok).toBe(true);
    if (rel.ok) {
      expect(rel.refund).toBe(500);
      expect(socialPet.getActivePet('g1', 'p1')?.id).not.toBe(pullSsr.pet.id);
    }

    db.close();
  });

  it('blocks friendly PVP XP farming, enforces daily PVP XP cap & cooldown, caps level/work bonus, and handles 12-round draws fairly', () => {
    const { db, profileRepo, socialPetRepo, socialPet } = createFixture();
    profileRepo.addCoins('g1', 'a', 10_000);
    profileRepo.addCoins('g1', 'b', 10_000);

    const petA = socialPetRepo.createPet({
      guildId: 'g1',
      ownerId: 'a',
      speciesKey: 'dino',
      nickname: '甲龙',
      rarity: 'SSR',
      hp: 300,
      atk: 50,
      spd: 30,
      critRate: 0.1,
      trait: '铁头',
      isActive: true,
      createdAt: 1000,
    });
    const petB = socialPetRepo.createPet({
      guildId: 'g1',
      ownerId: 'b',
      speciesKey: 'shiba',
      nickname: '乙犬',
      rarity: 'N',
      hp: 80,
      atk: 10,
      spd: 10,
      critRate: 0.05,
      trait: '佛系',
      isActive: true,
      createdAt: 1000,
    });

    // 1. Friendly battle (bet === 0) gives 0 XP!
    const friendly = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'a',
      opponentId: 'b',
      bet: 0,
      nowMs: 2000,
    });
    expect(friendly.ok).toBe(true);
    if (friendly.ok) {
      const res = socialPet.acceptPetBattle(friendly.battle.id, 'b', 2500, () => 0.5);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.challengerXpGained).toBe(0);
        expect(res.opponentXpGained).toBe(0);
        expect(res.challengerPet.xp).toBe(0);
        expect(res.opponentPet.xp).toBe(0);
      }
    }

    // 2. Paid PVP enforces cooldown & daily XP cap (120 XP/day -> 4 wins * 30 = 120, 5th win = 0 XP)
    const dayBase = Date.UTC(2026, 2, 1, 4, 0, 0);
    let t = dayBase;
    for (let i = 0; i < 4; i++) {
      const b = socialPet.createPetBattle({
        guildId: 'g1',
        channelId: 'c1',
        challengerId: 'a',
        opponentId: 'b',
        bet: 100,
        nowMs: t,
      });
      expect(b.ok).toBe(true);
      if (b.ok) {
        const res = socialPet.acceptPetBattle(b.battle.id, 'b', t + 500, () => 0.5);
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.challengerXpGained).toBe(30);
        }
      }
      t += PET_PVP_COOLDOWN_MS + 1000;
    }

    // Immediately creating another paid battle within cooldown fails with pvp_cooldown
    const tooSoon = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'a',
      opponentId: 'b',
      bet: 100,
      nowMs: t - PET_PVP_COOLDOWN_MS,
    });
    expect(tooSoon).toMatchObject({ ok: false, reason: 'pvp_cooldown' });

    // 5th paid battle same day gives 0 XP to 'a' (hit daily cap 120!)
    expect(profileRepo.getOrCreate('g1', 'a').petPvpXpDaily).toBe(PET_PVP_DAILY_XP_CAP);
    const b5 = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'a',
      opponentId: 'b',
      bet: 100,
      nowMs: t,
    });
    expect(b5.ok).toBe(true);
    if (b5.ok) {
      const res = socialPet.acceptPetBattle(b5.battle.id, 'b', t + 500, () => 0.5);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.challengerXpGained).toBe(0);
      }
    }

    // 3. Level cap PET_MAX_LEVEL (50) and workWithPet level bonus cap (300)
    const maxed = applyPetXp(petA, 999_999);
    expect(maxed.updatedPet.level).toBe(PET_MAX_LEVEL);
    expect(maxed.updatedPet.xp).toBe(0);
    const extraMax = applyPetXp(maxed.updatedPet, 5000);
    expect(extraMax.leveledUp).toBe(false);
    expect(extraMax.updatedPet.level).toBe(PET_MAX_LEVEL);

    socialPetRepo.savePet(maxed.updatedPet);
    const workMax = socialPet.workWithPet('g1', 'a', petA.id, t + 100_000, () => 0);
    expect(workMax.ok).toBe(true);
    if (workMax.ok) {
      // SSR min base = 180 + capped levelBonus 300 = 480 (NOT 180 + 49*15 = 915)
      expect(workMax.coinsEarned).toBe(180 + PET_WORK_LEVEL_BONUS_CAP);
    }

    // 4. 12-round draw with identical stats & identical rng -> draw + refund both bets!
    const tank1 = socialPetRepo.createPet({
      guildId: 'g1',
      ownerId: 'd1',
      speciesKey: 'shiba',
      nickname: '坦克一号',
      rarity: 'N',
      hp: 10_000,
      atk: 10,
      spd: 20,
      critRate: 0,
      trait: '铁头',
      isActive: true,
      createdAt: 1000,
    });
    const tank2 = socialPetRepo.createPet({
      guildId: 'g1',
      ownerId: 'd2',
      speciesKey: 'shiba',
      nickname: '坦克二号',
      rarity: 'N',
      hp: 10_000,
      atk: 10,
      spd: 20,
      critRate: 0,
      trait: '铁头',
      isActive: true,
      createdAt: 1000,
    });
    const drawSim = simulatePetBattle(tank1, tank2, () => 0.5);
    expect(drawSim.draw).toBe(true);
    expect(drawSim.winnerSide).toBe('draw');
    expect(drawSim.logs.some((l) => l.includes('回合耗尽'))).toBe(true);

    profileRepo.addCoins('g1', 'd1', 1000);
    profileRepo.addCoins('g1', 'd2', 1000);
    const drawBattle = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'd1',
      opponentId: 'd2',
      bet: 400,
      nowMs: 50_000,
    });
    expect(drawBattle.ok).toBe(true);
    if (drawBattle.ok) {
      expect(profileRepo.getOrCreate('g1', 'd1').coins).toBe(600);
      const res = socialPet.acceptPetBattle(drawBattle.battle.id, 'd2', 51_000, () => 0.5);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.draw).toBe(true);
        expect(res.winnerId).toBeNull();
        expect(res.challengerBalance).toBe(1000);
        expect(res.opponentBalance).toBe(1000);
      }
    }

    expect(petB.id).toBeGreaterThan(0);
    db.close();
  });
});
