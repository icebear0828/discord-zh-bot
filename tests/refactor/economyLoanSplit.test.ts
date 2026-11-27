import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { initSchema } from '../../src/db/schema.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import {
  CREDIT_LOAN_SCHEMA_SQL as FacadeCreditLoanSchemaSql,
  CreditLoanRepo,
  initCreditLoanSchema as facadeInitCreditLoanSchema,
} from '../../src/db/repositories/creditLoanRepo.js';
import {
  CREDIT_LOAN_SCHEMA_SQL,
  initCreditLoanSchema,
} from '../../src/db/repositories/creditLoan/creditLoanTypesAndSchema.js';
import {
  clampPagination,
  mapCreditAccount,
  mapLoan,
} from '../../src/db/repositories/creditLoan/creditLoanMappers.js';
import {
  EconomyService,
  SLOT_SYMBOLS as FacadeSlotSymbols,
  getDateKey as facadeGetDateKey,
  getPreviousDateKey as facadeGetPreviousDateKey,
  isRobProtectedAdmin as facadeIsRobProtectedAdmin,
  matchesSlotsVipPlayer as facadeMatchesSlotsVipPlayer,
  resolveRobAdminPersona as facadeResolveRobAdminPersona,
} from '../../src/services/economyService.js';
import {
  getDateKey,
  getPreviousDateKey,
} from '../../src/services/economy/economyTypesAndDates.js';
import {
  isRobProtectedAdmin,
  matchesSlotsVipPlayer,
  renderRobEasterEggStory,
  resolveRobAdminPersona,
} from '../../src/services/economy/robAdminPersonas.js';
import { SLOT_SYMBOLS } from '../../src/services/economy/slotsAndDiceOps.js';
import {
  DEFAULT_CREDIT_BOOST_DAILY_LIMIT as FacadeCreditBoostLimit,
  DEFAULT_STAT_BOOST_DAILY_LIMIT as FacadeStatBoostLimit,
  ShopService,
  parseCpAffinityPayload as facadeParseCpAffinityPayload,
  parseCreditBoostPayload as facadeParseCreditBoostPayload,
  parsePetXpPayload as facadeParsePetXpPayload,
  parseRolePayload as facadeParseRolePayload,
  parseRpgSupplyPayload as facadeParseRpgSupplyPayload,
  parseStatBoostPayload as facadeParseStatBoostPayload,
} from '../../src/services/shopService.js';
import {
  DEFAULT_CREDIT_BOOST_DAILY_LIMIT,
  DEFAULT_STAT_BOOST_DAILY_LIMIT,
  parseCpAffinityPayload,
  parseCreditBoostPayload,
  parsePetXpPayload,
  parseRolePayload,
  parseRpgSupplyPayload,
  parseStatBoostPayload,
} from '../../src/services/shop/shopTypesAndPayloads.js';
import {
  CREDIT_SCORE_DEFAULT as FacadeCreditScoreDefault,
  CREDIT_SCORE_MAX as FacadeCreditScoreMax,
  CREDIT_SCORE_MIN as FacadeCreditScoreMin,
  CREDIT_TIERS as FacadeCreditTiers,
  CreditLoanService,
  DEFAULT_CREDIT_LOAN_CONFIG as FacadeDefaultCreditLoanConfig,
  getCreditTier as facadeGetCreditTier,
} from '../../src/services/creditLoanService.js';
import {
  CREDIT_SCORE_DEFAULT,
  CREDIT_SCORE_MAX,
  CREDIT_SCORE_MIN,
  CREDIT_TIERS,
  DEFAULT_CREDIT_LOAN_CONFIG,
  getCreditTier,
  getLoanDebt,
  isLoanOverdueAt,
} from '../../src/services/creditLoan/creditTiersAndFlavor.js';
import { shopCommand } from '../../src/commands/economy/shop.js';
import { buildShopSlashCommand } from '../../src/commands/economy/shop/shopSlashBuilder.js';

describe('economy, shop, and creditLoan split refactor', () => {
  describe('economy submodule pure functions & facade re-exports', () => {
    it('computes Shanghai date keys and previous date keys consistently across facade and submodule', () => {
      const ts = Date.UTC(2026, 4, 15, 16, 30, 0); // 2026-05-16 00:30 Asia/Shanghai
      expect(getDateKey(ts, 'Asia/Shanghai')).toBe('2026-05-16');
      expect(getPreviousDateKey(ts, 'Asia/Shanghai')).toBe('2026-05-15');
      expect(facadeGetDateKey).toBe(getDateKey);
      expect(facadeGetPreviousDateKey).toBe(getPreviousDateKey);
    });

    it('detects protected admins, personas, VIP slots keywords, and renders easter egg stories', () => {
      expect(facadeIsRobProtectedAdmin).toBe(isRobProtectedAdmin);
      expect(facadeMatchesSlotsVipPlayer).toBe(matchesSlotsVipPlayer);
      expect(facadeResolveRobAdminPersona).toBe(resolveRobAdminPersona);
      expect(FacadeSlotSymbols).toBe(SLOT_SYMBOLS);

      expect(isRobProtectedAdmin('a1', { adminUserIds: ['a1'] })).toBe(true);
      expect(isRobProtectedAdmin('u1', { adminUserIds: [] }, { isAdmin: true })).toBe(true);
      expect(isRobProtectedAdmin('u1', { adminUserIds: ['a1'] })).toBe(false);

      expect(
        resolveRobAdminPersona({ equippedTitle: '冰吊王本尊', cardNickname: null }),
      ).toBe('ice');
      expect(
        resolveRobAdminPersona({ equippedTitle: null, cardNickname: null }, { displayNames: ['草莓布丁酱'] }),
      ).toBe('boss');
      expect(
        resolveRobAdminPersona({ equippedTitle: null, cardNickname: '114514' }),
      ).toBe('senpai');
      expect(
        resolveRobAdminPersona({ equippedTitle: '普通群友', cardNickname: '路人' }),
      ).toBe('generic');

      expect(
        matchesSlotsVipPlayer({ equippedTitle: null, cardNickname: 'icebear' }),
      ).toBe(true);
      expect(
        matchesSlotsVipPlayer({ equippedTitle: null, cardNickname: '路人甲' }),
      ).toBe(false);

      const story = renderRobEasterEggStory('att', 'tgt', 120, '星币', () => 0, 'pocket', 'ice');
      expect(story).toContain('<@att>');
      expect(story).toContain('<@tgt>');
      expect(story).toContain('**120**');
      expect(story).toContain('星币');

      const totalWeight = SLOT_SYMBOLS.reduce((acc, s) => acc + s.weight, 0);
      expect(SLOT_SYMBOLS).toHaveLength(7);
      expect(totalWeight).toBe(100);
    });
  });

  describe('shop payload parsers & slash command builder compatibility', () => {
    it('parses all shop payload variants with safe defaults and preserves facade re-exports', () => {
      expect(FacadeStatBoostLimit).toBe(DEFAULT_STAT_BOOST_DAILY_LIMIT);
      expect(FacadeCreditBoostLimit).toBe(DEFAULT_CREDIT_BOOST_DAILY_LIMIT);
      expect(facadeParseStatBoostPayload).toBe(parseStatBoostPayload);
      expect(facadeParsePetXpPayload).toBe(parsePetXpPayload);
      expect(facadeParseRolePayload).toBe(parseRolePayload);
      expect(facadeParseCreditBoostPayload).toBe(parseCreditBoostPayload);
      expect(facadeParseRpgSupplyPayload).toBe(parseRpgSupplyPayload);
      expect(facadeParseCpAffinityPayload).toBe(parseCpAffinityPayload);

      expect(parseStatBoostPayload('invalid')).toEqual({
        minGain: 1,
        maxGain: 3,
        dailyLimit: 3,
        critChance: 0.1,
        backfireChance: 0.1,
      });
      expect(
        parseStatBoostPayload(
          JSON.stringify({ minGain: 5, maxGain: 2, dailyLimit: 0, critChance: 0.75, backfireChance: 0.5 }),
        ),
      ).toEqual({
        minGain: 5,
        maxGain: 5,
        dailyLimit: 1,
        critChance: 0.75,
        backfireChance: 0.25,
      });

      expect(parsePetXpPayload(JSON.stringify({ petXp: 250 }))).toEqual({ petXp: 250 });
      expect(parsePetXpPayload('{}')).toEqual({ petXp: 150 });
      expect(parseRolePayload(JSON.stringify({ requiredRoleId: '  r123  ' }))).toEqual({
        requiredRoleId: 'r123',
      });
      expect(parseRolePayload('{}')).toEqual({ requiredRoleId: null });
      expect(parseCreditBoostPayload(JSON.stringify({ creditGain: 25, dailyLimit: 4 }))).toEqual({
        creditGain: 25,
        dailyLimit: 4,
      });
      expect(
        parseRpgSupplyPayload(JSON.stringify({ staminaGain: 10, lootBox: true, minRarity: 'epic' })),
      ).toEqual({
        staminaGain: 10,
        lootBox: true,
        minRarity: 'epic',
      });
      expect(parseRpgSupplyPayload(JSON.stringify({ minRarity: 'bogus' }))).toEqual({
        staminaGain: 0,
        lootBox: false,
        minRarity: 'rare',
      });
      expect(parseCpAffinityPayload(JSON.stringify({ affinityGain: 45 }))).toEqual({
        affinityGain: 45,
      });
    });

    it('keeps /shop slash command schema identical via shopSlashBuilder', () => {
      const built = buildShopSlashCommand().toJSON();
      const exported = shopCommand.data.toJSON();
      expect(shopCommand.name).toBe('shop');
      expect(exported).toEqual(built);
    });
  });

  describe('creditLoan tiers, schema, mappers & facade compatibility', () => {
    it('classifies all 5 credit tiers and loan helper pure functions identically', () => {
      expect(FacadeCreditScoreMin).toBe(CREDIT_SCORE_MIN);
      expect(FacadeCreditScoreMax).toBe(CREDIT_SCORE_MAX);
      expect(FacadeCreditScoreDefault).toBe(CREDIT_SCORE_DEFAULT);
      expect(FacadeCreditTiers).toBe(CREDIT_TIERS);
      expect(FacadeDefaultCreditLoanConfig).toBe(DEFAULT_CREDIT_LOAN_CONFIG);
      expect(facadeGetCreditTier).toBe(getCreditTier);
      expect(FacadeCreditLoanSchemaSql).toBe(CREDIT_LOAN_SCHEMA_SQL);
      expect(facadeInitCreditLoanSchema).toBe(initCreditLoanSchema);

      expect(getCreditTier(-10).key).toBe('deadbeat');
      expect(getCreditTier(299).key).toBe('deadbeat');
      expect(getCreditTier(300).key).toBe('graylist');
      expect(getCreditTier(500).key).toBe('normal');
      expect(getCreditTier(700).key).toBe('platinum');
      expect(getCreditTier(850).key).toBe('noble');
      expect(getCreditTier(1200).key).toBe('noble');

      expect(clampPagination(0, -5)).toEqual({ limit: 1, offset: 0 });
      expect(
        mapCreditAccount({ guild_id: 'g1', user_id: 'u1', score: 620, updated_at: 100 }),
      ).toEqual({ guildId: 'g1', userId: 'u1', score: 620, updatedAt: 100 });

      const loan = mapLoan({
        id: 1,
        guild_id: 'g1',
        user_id: 'u1',
        loan_type: 'bank',
        principal: 1000,
        daily_rate: 0.015,
        remaining_principal: 800,
        accrued_interest: 45,
        total_repaid: 200,
        status: 'active',
        term_days: 5,
        created_at: 1000,
        due_at: 2000,
        last_accrual_date: '2026-05-15',
        last_notice_date: null,
        bounty_posted: 0,
        repaid_at: null,
      });
      expect(getLoanDebt(loan)).toBe(845);
      expect(isLoanOverdueAt(loan, 2000)).toBe(false);
      expect(isLoanOverdueAt(loan, 2001)).toBe(true);
    });

    it('integrates EconomyService, ShopService, CreditLoanRepo, and CreditLoanService facades end-to-end', () => {
      const db = new Database(':memory:');
      initSchema(db);
      const guildConfigRepo = new GuildConfigRepo(db);
      const profileRepo = new ProfileRepo(db);
      const shopRepo = new ShopRepo(db);
      const chaosRepo = new ChaosRepo(db);
      const creditLoanRepo = new CreditLoanRepo(db);
      const creditLoanService = new CreditLoanService(
        db,
        guildConfigRepo,
        profileRepo,
        creditLoanRepo,
        'Asia/Shanghai',
        chaosRepo,
      );
      const economyService = new EconomyService(
        db,
        guildConfigRepo,
        profileRepo,
        'Asia/Shanghai',
        chaosRepo,
        creditLoanService,
      );
      const shopService = new ShopService(db, profileRepo, shopRepo, {
        guildConfigRepo,
        chaosRepo,
        creditLoanService,
      });

      const now = Date.UTC(2026, 4, 16, 4, 0, 0);
      profileRepo.addCoins('g1', 'u1', 5000);
      const daily = economyService.claimDaily('g1', 'u1', now);
      expect(daily.ok).toBe(true);

      const slots = economyService.playSlots(
        'g1',
        'u1',
        100,
        () => 0.1,
        now,
        { displayNames: ['icebear'] },
      );
      expect(slots.ok).toBe(true);
      if (slots.ok) {
        expect(slots.reels).toEqual(['🧊', '🧊', '🧊']);
        expect(slots.multiplier).toBe(100);
      }

      const loanRes = creditLoanService.takeBankLoan('g1', 'u1', 1000, 3, now);
      expect(loanRes.ok).toBe(true);
      if (loanRes.ok) {
        const repayRes = creditLoanService.repayLoan('g1', 'u1', loanRes.loan.id, 1000, now + 1000);
        expect(repayRes.ok).toBe(true);
        if (repayRes.ok) {
          expect(repayRes.fullyRepaid).toBe(true);
          expect(repayRes.creditDelta).toBeGreaterThan(0);
        }
      }

      const creditItem = shopService.createCreditBoostItem({
        guildId: 'g1',
        name: '信用修复卡',
        description: '修复信用分',
        price: 200,
        creditGain: 15,
        dailyLimit: 2,
        stock: 5,
      });
      const buyRes = shopService.buyItem('g1', 'u1', creditItem.id, now + 2000);
      expect(buyRes.ok).toBe(true);
      if (buyRes.ok) {
        expect(buyRes.creditBoostResult?.delta).toBe(15);
      }

      db.close();
    });
  });
});
