import { describe, expect, it } from 'vitest';
import { SHOP_MYSTERY_BOX_MIN_PRICE } from '../../src/config/economyConstants.js';
import { createDatabase } from '../../src/db/database.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { CreditLoanRepo } from '../../src/db/repositories/creditLoanRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RpgRepo } from '../../src/db/repositories/rpgRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { CreditLoanService } from '../../src/services/creditLoanService.js';
import { RpgService } from '../../src/services/rpgService.js';
import { ShopService } from '../../src/services/shopService.js';
import { SocialPetService } from '../../src/services/socialPetService.js';

describe('shopService & inventory', () => {
  it('supports buying role/title/boost items, stock limits, refunds, and activating boost cards', () => {
    const db = createDatabase(':memory:');
    const profileRepo = new ProfileRepo(db);
    const shopRepo = new ShopRepo(db);
    const svc = new ShopService(db, profileRepo, shopRepo);

    profileRepo.addCoins('g1', 'u1', 1000);

    const roleItem = svc.createRoleItem({
      guildId: 'g1',
      name: 'VIP身份组',
      description: '专属VIP',
      price: 300,
      roleId: 'role-vip',
      stock: 1,
    });
    const titleItem = svc.createTitleItem({
      guildId: 'g1',
      name: '龙王称号',
      description: '活跃大佬',
      price: 200,
      titleText: '群聊龙王',
      stock: null,
    });
    const boostItem = svc.createBoostItem({
      guildId: 'g1',
      name: '双倍经验卡(1小时)',
      description: '60分钟内经验翻倍',
      price: 150,
      boostMultiplier: 2.0,
      boostDurationSec: 3600,
      stock: null,
    });

    // Buy role item (stock drops 1 -> 0)
    const buyRole = svc.buyItem('g1', 'u1', roleItem.id, 1_000_000);
    expect(buyRole.ok).toBe(true);
    if (buyRole.ok) {
      expect(buyRole.grantRoleId).toBe('role-vip');
      expect(buyRole.balance).toBe(700);
    }
    expect(svc.buyItem('g1', 'u1', roleItem.id, 1_000_000).ok).toBe(false); // out of stock

    // Refund if role assignment failed
    svc.refundRolePurchase('g1', 'u1', roleItem.id, 300);
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(1000);
    expect(shopRepo.getItemById('g1', roleItem.id)?.stock).toBe(1);

    // Buy title and prevent duplicate purchase
    const buyTitle = svc.buyItem('g1', 'u1', titleItem.id, 1_000_000);
    expect(buyTitle.ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'u1').equippedTitle).toBe('群聊龙王');
    expect(svc.buyItem('g1', 'u1', titleItem.id, 1_000_000).ok).toBe(false);

    // Buy & activate boost card
    const buyBoost = svc.buyItem('g1', 'u1', boostItem.id, 1_000_000);
    expect(buyBoost.ok).toBe(true);
    const inv = svc.listInventory('g1', 'u1').filter((i) => i.itemType === 'xp_boost');
    expect(inv).toHaveLength(1);
    const used = svc.useInventoryItem('g1', 'u1', inv[0]!.id, 2_000_000);
    expect(used.ok).toBe(true);
    const profileAfter = profileRepo.getOrCreate('g1', 'u1');
    expect(profileAfter.xpBoostMultiplier).toBe(2.0);
    expect(profileAfter.xpBoostExpiresAt).toBe(2_000_000 + 3600_000);

    db.close();
  });

  it('supports stat_boost daily limits & crit/backfire, pet_xp, custom_title, and mystery_box rewards', () => {
    const db = createDatabase(':memory:');
    const guildConfigRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const shopRepo = new ShopRepo(db);
    const chaosRepo = new ChaosRepo(db);
    const socialPetRepo = new SocialPetRepo(db);
    const petSvc = new SocialPetService(db, guildConfigRepo, profileRepo, shopRepo, socialPetRepo, 'Asia/Shanghai');
    const svc = new ShopService(db, profileRepo, shopRepo, {
      guildConfigRepo,
      chaosRepo,
      socialPetRepo,
      timezone: 'Asia/Shanghai',
    });

    profileRepo.addCoins('g1', 'u1', 50_000);

    const statPotion = svc.createStatBoostItem({
      guildId: 'g1',
      name: '成长药水',
      description: '随机成长',
      price: 500,
      minGain: 2,
      maxGain: 4,
      dailyLimit: 3,
      critChance: 0.1,
      backfireChance: 0.1,
      stock: null,
    });
    const petCan = svc.createPetXpItem({
      guildId: 'g1',
      name: '宠物罐头',
      description: '加宠物经验',
      price: 400,
      petXp: 150,
      stock: 5,
    });
    const customVoucher = svc.createCustomTitleItem({
      guildId: 'g1',
      name: '自定称号券',
      description: '任意称号',
      price: 1000,
      stock: null,
    });
    const box = svc.createMysteryBoxItem({
      guildId: 'g1',
      name: '神秘盲盒',
      description: '拼手气',
      price: 1000,
      stock: null,
    });

    const seqRng = (vals: number[]): (() => number) => {
      let idx = 0;
      return () => {
        const val = vals[idx] ?? 0.5;
        idx += 1;
        return val;
      };
    };

    // 1. stat_boost: crit, normal, backfire, then daily limit reached on 4th
    const day1 = Date.UTC(2026, 4, 1, 12, 0, 0);
    const critRes = svc.buyItem('g1', 'u1', statPotion.id, day1, seqRng([0.5, 0.05]));
    expect(critRes.ok).toBe(true);
    if (critRes.ok) {
      expect(critRes.statBoostResult?.outcome).toBe('crit');
      expect(critRes.statBoostResult?.delta).toBe(6); // base 3 * 2
      expect(critRes.statBoostResult?.newStatValue).toBe(6);
    }

    const normalRes = svc.buyItem('g1', 'u1', statPotion.id, day1 + 1000, seqRng([0.0, 0.5]));
    expect(normalRes.ok && normalRes.statBoostResult?.outcome === 'normal').toBe(true);
    expect(profileRepo.getOrCreate('g1', 'u1').statValue).toBe(8);

    const backfireRes = svc.buyItem('g1', 'u1', statPotion.id, day1 + 2000, seqRng([0.5, 0.15]));
    expect(backfireRes.ok && backfireRes.statBoostResult?.outcome === 'backfire').toBe(true);
    expect(profileRepo.getOrCreate('g1', 'u1').statValue).toBe(6); // 8 - 2

    const coinsBeforeLimit = profileRepo.getOrCreate('g1', 'u1').coins;
    const blockedRes = svc.buyItem('g1', 'u1', statPotion.id, day1 + 3000, seqRng([0.5, 0.5]));
    expect(blockedRes).toEqual({ ok: false, reason: 'daily_limit_reached', dailyLimit: 3 });
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(coinsBeforeLimit);

    // Next day resets daily count
    const day2 = day1 + 24 * 3600 * 1000;
    const nextDayRes = svc.buyItem('g1', 'u1', statPotion.id, day2, seqRng([0.0, 0.5]));
    expect(nextDayRes.ok).toBe(true);

    // 2. pet_xp: blocked when no active pet, succeeds & levels pet when pet exists
    const noPetRes = svc.buyItem('g1', 'u1', petCan.id, day2);
    expect(noPetRes).toEqual({ ok: false, reason: 'no_active_pet' });
    expect(shopRepo.getItemById('g1', petCan.id)?.stock).toBe(5);

    const pull = petSvc.pullPetGacha('g1', 'u1', day2);
    expect(pull.ok).toBe(true);
    const petBuyRes = svc.buyItem('g1', 'u1', petCan.id, day2 + 1000);
    expect(petBuyRes.ok).toBe(true);
    if (petBuyRes.ok) {
      expect(petBuyRes.petXpResult?.xpGained).toBe(150);
      expect(petBuyRes.petXpResult?.newLevel).toBeGreaterThanOrEqual(2);
    }

    // 3. custom_title: direct buy & voucher redeem
    expect(svc.buyCustomTitle('g1', 'u1', customVoucher.id, '   ')).toEqual({
      ok: false,
      reason: 'invalid_title',
    });
    const customBuy = svc.buyCustomTitle('g1', 'u1', customVoucher.id, ' 宇宙无敌大玩家 ', day2);
    expect(customBuy.ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'u1').equippedTitle).toBe('宇宙无敌大玩家');
    expect(svc.buyCustomTitle('g1', 'u1', customVoucher.id, '宇宙无敌大玩家', day2)).toEqual({
      ok: false,
      reason: 'already_owned',
    });

    const voucherBuy = svc.buyItem('g1', 'u1', customVoucher.id, day2);
    expect(voucherBuy.ok && voucherBuy.customTitleVoucher).toBe(true);
    const voucherInv = svc.listInventory('g1', 'u1').find((i) => i.itemType === 'custom_title');
    expect(voucherInv).toBeDefined();
    const redeemed = svc.redeemCustomTitleVoucher('g1', 'u1', voucherInv!.id, '摸鱼之神', day2);
    expect(redeemed.ok && redeemed.equippedTitle === '摸鱼之神').toBe(true);
    expect(profileRepo.getOrCreate('g1', 'u1').equippedTitle).toBe('摸鱼之神');

    // 4. mystery_box: cover major branches deterministically
    const boxCoinJackpot = svc.buyItem('g1', 'u1', box.id, day2, seqRng([0.01, 0.5]));
    expect(boxCoinJackpot.ok && boxCoinJackpot.mysteryBoxResult?.kind === 'coins_jackpot').toBe(true);

    const boxStatJackpot = svc.buyItem('g1', 'u1', box.id, day2, seqRng([0.04, 0.0]));
    expect(boxStatJackpot.ok && boxStatJackpot.mysteryBoxResult?.kind === 'stat_jackpot').toBe(true);

    const boxBoost = svc.buyItem('g1', 'u1', box.id, day2, seqRng([0.15]));
    expect(boxBoost.ok && boxBoost.mysteryBoxResult?.kind === 'xp_boost').toBe(true);

    const boxProp = svc.buyItem('g1', 'u1', box.id, day2, seqRng([0.35, 0.1]));
    expect(boxProp.ok && boxProp.mysteryBoxResult?.kind === 'chaos_prop').toBe(true);
    expect(chaosRepo.listUserProps('g1', 'u1').length).toBeGreaterThanOrEqual(1);

    const boxPet = svc.buyItem('g1', 'u1', box.id, day2, seqRng([0.55]));
    expect(boxPet.ok && boxPet.mysteryBoxResult?.kind === 'pet_xp').toBe(true);

    const boxStatSmall = svc.buyItem('g1', 'u1', box.id, day2, seqRng([0.68, 0.5]));
    expect(boxStatSmall.ok && boxStatSmall.mysteryBoxResult?.kind === 'stat_small').toBe(true);

    const boxRefund = svc.buyItem('g1', 'u1', box.id, day2, seqRng([0.85, 0.5]));
    expect(boxRefund.ok && boxRefund.mysteryBoxResult?.kind === 'coins_refund').toBe(true);

    db.close();
  });

  it('enforces mystery box min price & zero-price no-floor, rejects boost multiplier conflict, and blocks already-owned role purchase', () => {
    const db = createDatabase(':memory:');
    const profileRepo = new ProfileRepo(db);
    const shopRepo = new ShopRepo(db);
    const svc = new ShopService(db, profileRepo, shopRepo);

    profileRepo.addCoins('g1', 'u1', 5000);

    // 1. Mystery box min price enforced at creation
    const clampedBox = svc.createMysteryBoxItem({
      guildId: 'g1',
      name: '廉价盲盒',
      description: '尝试 0 价',
      price: 0,
      stock: null,
    });
    expect(clampedBox.price).toBe(SHOP_MYSTERY_BOX_MIN_PRICE);

    // Legacy 0-price mystery box in DB prints 0 coins (no unconditional floor > price)
    const legacyZeroBox = shopRepo.createItem({
      guildId: 'g1',
      name: '遗留零价盲盒',
      description: '',
      type: 'mystery_box',
      price: 0,
      roleId: null,
      titleText: null,
      boostMultiplier: null,
      boostDurationSec: null,
      stock: null,
      payloadJson: '{}',
    });
    const coinsBeforeZero = profileRepo.getOrCreate('g1', 'u1').coins;
    const zeroJackpot = svc.buyItem('g1', 'u1', legacyZeroBox.id, 1_000_000, () => 0.01);
    expect(zeroJackpot.ok).toBe(true);
    if (zeroJackpot.ok && zeroJackpot.mysteryBoxResult?.kind === 'coins_jackpot') {
      expect(zeroJackpot.mysteryBoxResult.coinsDelta).toBe(0);
    }
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(coinsBeforeZero);

    // 2. XP boost card multiplier conflict rejected without consuming card
    const boost3x = svc.createBoostItem({
      guildId: 'g1',
      name: '三倍经验卡',
      description: '',
      price: 300,
      boostMultiplier: 3.0,
      boostDurationSec: 600,
      stock: null,
    });
    const boost15x = svc.createBoostItem({
      guildId: 'g1',
      name: '一点五倍经验卡',
      description: '',
      price: 100,
      boostMultiplier: 1.5,
      boostDurationSec: 3600,
      stock: null,
    });
    const b1 = svc.buyItem('g1', 'u1', boost3x.id, 1_000_000);
    const b2 = svc.buyItem('g1', 'u1', boost3x.id, 1_000_000);
    const b3 = svc.buyItem('g1', 'u1', boost15x.id, 1_000_000);
    expect(b1.ok && b2.ok && b3.ok).toBe(true);
    if (!b1.ok || !b2.ok || !b3.ok) return;

    const now = 2_000_000;
    const u3x = svc.useInventoryItem('g1', 'u1', b1.addedInventory!.id, now);
    expect(u3x.ok).toBe(true);

    // Different multiplier conflicts and preserves card in inventory
    const conflict = svc.useInventoryItem('g1', 'u1', b3.addedInventory!.id, now + 1000);
    expect(conflict).toMatchObject({
      ok: false,
      reason: 'boost_multiplier_conflict',
      activeBoostMultiplier: 3.0,
    });
    expect(shopRepo.getInventoryItem('g1', 'u1', b3.addedInventory!.id)?.quantity).toBe(1);

    // Same multiplier stacks duration cleanly
    const stacked = svc.useInventoryItem('g1', 'u1', b2.addedInventory!.id, now + 2000);
    expect(stacked.ok).toBe(true);
    if (stacked.ok) {
      expect(stacked.boostMultiplier).toBe(3.0);
      expect(stacked.boostExpiresAt).toBe(now + 1_200_000);
    }

    // 3. Duplicate role ownership blocked without deducting coins or stock
    const roleItem = svc.createRoleItem({
      guildId: 'g1',
      name: '贵族身份组',
      description: '',
      price: 500,
      roleId: 'role-noble',
      stock: 3,
    });
    const coinsBeforeRole = profileRepo.getOrCreate('g1', 'u1').coins;
    const dupRoleRes = svc.buyItem(
      'g1',
      'u1',
      roleItem.id,
      now,
      Math.random,
      new Set(['role-noble']),
    );
    expect(dupRoleRes).toEqual({ ok: false, reason: 'already_owned' });
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(coinsBeforeRole);
    expect(shopRepo.getItemById('g1', roleItem.id)?.stock).toBe(3);

    db.close();
  });

  it('supports requiredRoleId gating, credit_boost, rpg_supply, cp_affinity, and scaled mystery_box', () => {
    const db = createDatabase(':memory:');
    const guildConfigRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const shopRepo = new ShopRepo(db);
    const chaosRepo = new ChaosRepo(db);
    const socialPetRepo = new SocialPetRepo(db);
    const creditLoanRepo = new CreditLoanRepo(db);
    const rpgRepo = new RpgRepo(db);

    const creditLoanService = new CreditLoanService(
      db,
      guildConfigRepo,
      profileRepo,
      creditLoanRepo,
      'Asia/Shanghai',
      chaosRepo,
    );
    const petSvc = new SocialPetService(
      db,
      guildConfigRepo,
      profileRepo,
      shopRepo,
      socialPetRepo,
      'Asia/Shanghai',
      creditLoanService,
    );
    const rpgSvc = new RpgService(db, rpgRepo, profileRepo, {
      timezone: 'Asia/Shanghai',
      guildConfigRepo,
      socialPetRepo,
    });
    const svc = new ShopService(db, profileRepo, shopRepo, {
      guildConfigRepo,
      chaosRepo,
      socialPetRepo,
      creditLoanService,
      rpgRepo,
      timezone: 'Asia/Shanghai',
    });

    const now = Date.UTC(2026, 5, 10, 4, 0, 0);
    profileRepo.addCoins('g1', 'u1', 500_000);
    profileRepo.addCoins('g1', 'u2', 100_000);

    // 1. Role with requiredRoleId prerequisite
    const upperRole = svc.createRoleItem({
      guildId: 'g1',
      name: '上等公民',
      description: '需先拥有中等公民',
      price: 1000,
      roleId: 'role-upper',
      stock: 5,
      requiredRoleId: 'role-mid',
    });
    const missingReq = svc.buyItem('g1', 'u1', upperRole.id, now, Math.random, new Set(['other']));
    expect(missingReq).toEqual({
      ok: false,
      reason: 'missing_required_role',
      requiredRoleId: 'role-mid',
    });
    expect(shopRepo.getItemById('g1', upperRole.id)?.stock).toBe(5);

    const okReq = svc.buyItem('g1', 'u1', upperRole.id, now, Math.random, new Set(['role-mid']));
    expect(okReq.ok && okReq.grantRoleId === 'role-upper').toBe(true);

    // 2. credit_boost: daily limit & 1000-score cap
    creditLoanService.adjustCredit('g1', 'u1', -50, '测试降分', now); // 550
    const creditItem = svc.createCreditBoostItem({
      guildId: 'g1',
      name: '征信修复函',
      description: '恢复信用分',
      price: 5000,
      creditGain: 20,
      dailyLimit: 2,
      stock: null,
    });
    const cb1 = svc.buyItem('g1', 'u1', creditItem.id, now);
    expect(cb1.ok).toBe(true);
    if (cb1.ok) {
      expect(cb1.creditBoostResult).toMatchObject({
        delta: 20,
        newScore: 570,
        usedToday: 1,
        dailyLimit: 2,
      });
    }
    const cb2 = svc.buyItem('g1', 'u1', creditItem.id, now + 1000);
    expect(cb2.ok && cb2.creditBoostResult?.newScore === 590).toBe(true);
    const cbLimit = svc.buyItem('g1', 'u1', creditItem.id, now + 2000);
    expect(cbLimit).toEqual({ ok: false, reason: 'daily_limit_reached', dailyLimit: 2 });

    creditLoanService.adjustCredit('g1', 'u1', 500, '升到满分', now + 3000);
    const cbMax = svc.buyItem('g1', 'u1', creditItem.id, now + 86_400_000);
    expect(cbMax).toEqual({ ok: false, reason: 'credit_already_max' });

    // 3. rpg_supply: requires character, checks bag capacity, restores stamina & drops item
    const rpgSupply = svc.createRpgSupplyItem({
      guildId: 'g1',
      name: '勇者秘宝盒',
      description: '补体力+史诗装',
      price: 10_000,
      staminaGain: 3,
      lootBox: true,
      minRarity: 'epic',
      stock: null,
    });
    expect(svc.buyItem('g1', 'u1', rpgSupply.id, now)).toEqual({
      ok: false,
      reason: 'no_rpg_character',
    });

    rpgSvc.chooseOrSwitchClass('g1', 'u1', 'warrior', now);
    const staminaBefore = rpgRepo.getCharacter('g1', 'u1')!.stamina;
    const supplyOk = svc.buyItem('g1', 'u1', rpgSupply.id, now, () => 0.1);
    expect(supplyOk.ok).toBe(true);
    if (supplyOk.ok) {
      expect(supplyOk.rpgSupplyResult?.staminaGained).toBe(3);
      expect(supplyOk.rpgSupplyResult?.newStamina).toBe(staminaBefore + 3);
      expect(['epic', 'legendary']).toContain(supplyOk.rpgSupplyResult?.droppedItem?.rarity);
    }

    // Fill RPG bag to capacity -> rpg_bag_full without deducting coins
    guildConfigRepo.updateRpg('g1', { ...guildConfigRepo.getOrCreate('g1').rpg, bagCapacity: 1 });
    const coinsBeforeFull = profileRepo.getOrCreate('g1', 'u1').coins;
    expect(svc.buyItem('g1', 'u1', rpgSupply.id, now)).toEqual({
      ok: false,
      reason: 'rpg_bag_full',
    });
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(coinsBeforeFull);

    // 4. cp_affinity: blocked without CP, works once married and unlocks milestone titles
    const cpGift = svc.createCpAffinityItem({
      guildId: 'g1',
      name: '誓约玫瑰',
      description: '+60亲密度',
      price: 5000,
      affinityGain: 60,
      stock: null,
    });
    expect(svc.buyItem('g1', 'u1', cpGift.id, now)).toEqual({
      ok: false,
      reason: 'no_relationship',
    });

    const prop = petSvc.createProposal({
      guildId: 'g1',
      channelId: 'c1',
      proposerId: 'u1',
      targetId: 'u2',
      relType: 'marriage',
      nowMs: now,
    });
    expect(prop.ok).toBe(true);
    if (prop.ok) {
      expect(petSvc.acceptProposal(prop.proposal.id, 'u2', now).ok).toBe(true);
    }

    const cpOk = svc.buyItem('g1', 'u1', cpGift.id, now);
    expect(cpOk.ok).toBe(true);
    if (cpOk.ok) {
      expect(cpOk.cpAffinityResult).toMatchObject({
        partnerId: 'u2',
        relType: 'marriage',
        affinityGained: 60,
        newAffinity: 70,
      });
      expect(cpOk.cpAffinityResult?.unlockedTitles).toContain('💞 甜蜜新婚');
    }

    // 5. High-price mystery box scales stat_jackpot reward
    const luxBox = svc.createMysteryBoxItem({
      guildId: 'g1',
      name: '至尊盲盒',
      description: '高档盲盒',
      price: 15_000,
      stock: null,
    });
    const luxRes = svc.buyItem('g1', 'u1', luxBox.id, now, () => 0.04);
    expect(luxRes.ok).toBe(true);
    if (luxRes.ok && luxRes.mysteryBoxResult?.kind === 'stat_jackpot') {
      expect(luxRes.mysteryBoxResult.statDelta).toBeGreaterThanOrEqual(40);
    }

    db.close();
  });
});
