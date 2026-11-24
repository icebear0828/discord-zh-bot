import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
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
});
