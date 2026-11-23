import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { SocialPetService } from '../../src/services/socialPetService.js';

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
  it('enforces 1v1 marriage & max sworn limits, refunds declined/expired proposals, and unlocks milestone titles', () => {
    const { db, profileRepo, shopRepo, socialPet } = createFixture();
    profileRepo.addCoins('g1', 'u1', 5000);
    profileRepo.addCoins('g1', 'u2', 5000);
    profileRepo.addCoins('g1', 'u3', 5000);

    // Propose & decline refunds cost
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
    const baseTime = Date.UTC(2026, 0, 1, 4, 0, 0); // noon Asia/Shanghai
    const c1 = socialPet.checkinRelationship(relId, 'u1', baseTime, () => 0.99); // +20 -> 30
    expect(c1.ok).toBe(true);
    // Same day blocked
    expect(socialPet.checkinRelationship(relId, 'u2', baseTime + 1000)).toEqual({
      ok: false,
      reason: 'already_checked_in',
    });
    const c2 = socialPet.checkinRelationship(relId, 'u2', baseTime + dayMs, () => 0.99); // +20 -> 50!
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

  it('supports blind-box pet gacha, nurturing/leveling, release fallback, and turn-based PVP battles', () => {
    const { db, profileRepo, socialPet } = createFixture();
    profileRepo.addCoins('g1', 'p1', 5000);
    profileRepo.addCoins('g1', 'p2', 5000);

    // Pull SSR pet for p1 (rng = 0.99 >= 0.97)
    const pullSsr = socialPet.pullPetGacha('g1', 'p1', 1000, () => 0.99);
    expect(pullSsr.ok).toBe(true);
    if (!pullSsr.ok) return;
    expect(pullSsr.pet.rarity).toBe('SSR');
    expect(pullSsr.pet.isActive).toBe(true);
    expect(pullSsr.isHighRarity).toBe(true);

    // Pull N pet for p1 & p2 (rng = 0.1)
    const pullN = socialPet.pullPetGacha('g1', 'p1', 2000, () => 0.1);
    expect(pullN.ok).toBe(true);
    if (!pullN.ok) return;
    expect(pullN.pet.rarity).toBe('N');
    expect(pullN.pet.isActive).toBe(false);

    const p2Pet = socialPet.pullPetGacha('g1', 'p2', 3000, () => 0.1);
    expect(p2Pet.ok).toBe(true);

    // Feed (+40 XP) & train (+20..35 XP) -> levels up SSR pet (>=60 XP needed for Lv.1)!
    const fed = socialPet.feedPet('g1', 'p1', pullSsr.pet.id, 4000);
    expect(fed.ok).toBe(true);
    const trained = socialPet.trainPet('g1', 'p1', pullSsr.pet.id, 5000, () => 0.99);
    expect(trained.ok).toBe(true);
    if (trained.ok) {
      expect(trained.leveledUp).toBe(true);
      expect(trained.pet.level).toBe(2);
    }

    // Pet work earns coins & cooldown enforced
    const worked = socialPet.workWithPet('g1', 'p1', pullSsr.pet.id, 6000, () => 0.5);
    expect(worked.ok).toBe(true);
    if (worked.ok) {
      expect(worked.coinsEarned).toBeGreaterThanOrEqual(180);
    }
    expect(socialPet.workWithPet('g1', 'p1', pullSsr.pet.id, 7000)).toMatchObject({
      ok: false,
      reason: 'cooldown',
    });

    // Rename pet
    const renamed = socialPet.renamePet('g1', 'p1', pullSsr.pet.id, '无敌暴龙');
    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.pet.nickname).toBe('无敌暴龙');
    }

    // Open pet battle between p1 (Lv.2 SSR) and p2 (Lv.1 N) with 300 coin wager
    const battleCreated = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'p1',
      opponentId: null, // open arena!
      bet: 300,
      nowMs: 10_000,
    });
    expect(battleCreated.ok).toBe(true);
    if (!battleCreated.ok) return;

    // Self cannot accept open arena
    expect(socialPet.acceptPetBattle(battleCreated.battle.id, 'p1', 11_000)).toEqual({
      ok: false,
      reason: 'cannot_accept_self',
    });

    const p1Before = profileRepo.getOrCreate('g1', 'p1').coins;
    const p2Before = profileRepo.getOrCreate('g1', 'p2').coins;
    const fought = socialPet.acceptPetBattle(battleCreated.battle.id, 'p2', 12_000, () => 0.5);
    expect(fought.ok).toBe(true);
    if (fought.ok) {
      expect(fought.winnerId).toBe('p1'); // Lv.2 SSR dominates Lv.1 N at rng=0.5!
      expect(fought.challengerBalance).toBe(p1Before + 300);
      expect(fought.opponentBalance).toBe(p2Before - 300);
      expect(fought.battle.logs.length).toBeGreaterThan(0);
    }

    // Releasing active SSR pet refunds 1000 & auto-activates remaining N pet!
    const rel = socialPet.releasePet('g1', 'p1', pullSsr.pet.id);
    expect(rel.ok).toBe(true);
    if (rel.ok) {
      expect(rel.refund).toBe(1000);
      expect(socialPet.getActivePet('g1', 'p1')?.id).toBe(pullN.pet.id);
    }

    db.close();
  });
});
