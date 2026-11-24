import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { FunRepo } from '../../src/db/repositories/funRepo.js';
import { FunService } from '../../src/services/funService.js';

describe('funService', () => {
  it('draws daily fortune once per day, grants bonus once, and tracks interactions & titles', () => {
    const db = createDatabase(':memory:');
    const profileRepo = new ProfileRepo(db);
    const shopRepo = new ShopRepo(db);
    const funRepo = new FunRepo(db);
    const svc = new FunService(db, profileRepo, shopRepo, funRepo, 'Asia/Shanghai');

    const now = Date.UTC(2026, 4, 1, 4, 0, 0);
    const f1 = svc.drawDailyFortune('g1', 'u1', now, () => 0.0);
    expect(f1.alreadyDrawn).toBe(false);
    expect(f1.record.luckTier).toBe('大吉');
    expect(f1.record.bonusCoins).toBeGreaterThanOrEqual(60);
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(f1.record.bonusCoins);

    // Second draw on same day returns cached fortune without extra coins
    const f2 = svc.drawDailyFortune('g1', 'u1', now + 3600_000, () => 0.9);
    expect(f2.alreadyDrawn).toBe(true);
    expect(f2.record.luckTier).toBe(f1.record.luckTier);
    expect(profileRepo.getOrCreate('g1', 'u1').coins).toBe(f1.record.bonusCoins);

    // Interactions accumulate
    const i1 = svc.performInteraction('g1', 'u1', 'u2', 'pat');
    const i2 = svc.performInteraction('g1', 'u1', 'u2', 'pat');
    expect(i1.count).toBe(1);
    expect(i2.count).toBe(2);

    // Titles grant, list, equip, clear
    svc.grantTitle('g1', 'u1', '内测元老');
    expect(svc.listTitles('g1', 'u1')).toContain('内测元老');
    expect(svc.equipTitle('g1', 'u1', '内测元老').ok).toBe(true);
    expect(profileRepo.getOrCreate('g1', 'u1').equippedTitle).toBe('内测元老');
    svc.clearTitle('g1', 'u1');
    expect(profileRepo.getOrCreate('g1', 'u1').equippedTitle).toBeNull();

    db.close();
  });
});
