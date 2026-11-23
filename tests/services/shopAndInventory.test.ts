import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { ShopService } from '../../src/services/shopService.js';

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
});
