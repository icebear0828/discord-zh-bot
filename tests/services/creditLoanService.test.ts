import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import {
  CreditLoanRepo,
  initCreditLoanSchema,
} from '../../src/db/repositories/creditLoanRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import {
  CREDIT_SCORE_DEFAULT,
  CreditLoanService,
  DEFAULT_CREDIT_LOAN_CONFIG,
  getCreditTier,
} from '../../src/services/creditLoanService.js';

const DAY_MS = 86_400_000;
// 2026-06-01 12:00:00 Asia/Shanghai (UTC+8) = 2026-06-01 04:00:00 UTC
const BASE_TIME = Date.UTC(2026, 5, 1, 4, 0, 0);

function createFixture(configOverrides?: Partial<typeof DEFAULT_CREDIT_LOAN_CONFIG>) {
  const db = createDatabase(':memory:');
  initCreditLoanSchema(db);
  // Idempotency check: calling twice must succeed cleanly
  initCreditLoanSchema(db);

  const configRepo = new GuildConfigRepo(db);
  const profileRepo = new ProfileRepo(db);
  const chaosRepo = new ChaosRepo(db);
  const repo = new CreditLoanRepo(db);
  const service = new CreditLoanService(
    db,
    configRepo,
    profileRepo,
    repo,
    'Asia/Shanghai',
    chaosRepo,
    configOverrides,
  );
  return { db, configRepo, profileRepo, chaosRepo, repo, service };
}

function makeRngSequence(values: readonly number[]): () => number {
  let idx = 0;
  return () => {
    const val = values[idx];
    idx += 1;
    return val ?? 0.5;
  };
}

describe('CreditLoanService', () => {
  it('maps all 5 credit tiers accurately and clamps score adjustments with logs', () => {
    const { db, service } = createFixture();

    expect(getCreditTier(-50)).toMatchObject({
      key: 'deadbeat',
      label: '💀 极危老赖',
      shopMult: 1.25,
      workMult: 0.8,
      bankInterestCapMult: 0.5,
      bankLoanMax: 0,
      bankDailyRate: 0,
      bankMaxDays: 0,
    });
    expect(getCreditTier(299).key).toBe('deadbeat');
    expect(getCreditTier(300)).toMatchObject({
      key: 'graylist',
      label: '⚠️ 失信灰名单',
      shopMult: 1.1,
      workMult: 0.9,
      bankInterestCapMult: 0.8,
      bankLoanMax: 10_000,
      bankDailyRate: 0.03,
      bankMaxDays: 3,
    });
    expect(getCreditTier(499).key).toBe('graylist');
    expect(getCreditTier(500)).toMatchObject({
      key: 'normal',
      label: '🙂 普通良民',
      shopMult: 1.0,
      workMult: 1.0,
      bankInterestCapMult: 1.0,
      bankLoanMax: 50_000,
      bankDailyRate: 0.015,
      bankMaxDays: 5,
    });
    expect(getCreditTier(699).key).toBe('normal');
    expect(getCreditTier(700)).toMatchObject({
      key: 'platinum',
      label: '💎 优质白金',
      shopMult: 0.9,
      workMult: 1.2,
      bankInterestCapMult: 1.5,
      bankLoanMax: 200_000,
      bankDailyRate: 0.01,
      bankMaxDays: 7,
    });
    expect(getCreditTier(849).key).toBe('platinum');
    expect(getCreditTier(850)).toMatchObject({
      key: 'noble',
      label: '👑 金卡贵族',
      shopMult: 0.8,
      workMult: 1.4,
      bankInterestCapMult: 2.0,
      bankLoanMax: 500_000,
      bankDailyRate: 0.005,
      bankMaxDays: 10,
    });
    expect(getCreditTier(1500).key).toBe('noble');

    // Default score is 600
    const initial = service.getCreditProfile('g1', 'u1', BASE_TIME);
    expect(initial.account.score).toBe(CREDIT_SCORE_DEFAULT);
    expect(initial.tier.key).toBe('normal');

    // Upper clamp at 1000
    const up = service.adjustCredit('g1', 'u1', 500, '大额奖励', BASE_TIME + 1000);
    expect(up.account.score).toBe(1000);
    expect(up.actualDelta).toBe(400);
    expect(up.tier.key).toBe('noble');

    // Lower clamp at 0
    const down = service.adjustCredit('g1', 'u1', -1500, '严重违约', BASE_TIME + 2000);
    expect(down.account.score).toBe(0);
    expect(down.actualDelta).toBe(-1000);
    expect(down.tier.key).toBe('deadbeat');

    // Logs ordered newest-first with pagination
    const logs = service.listCreditLogs('g1', 'u1', 1, 0);
    expect(logs.total).toBe(2);
    expect(logs.items[0]?.reason).toBe('严重违约');
    expect(logs.items[0]?.scoreAfter).toBe(0);

    const logsPage2 = service.listCreditLogs('g1', 'u1', 1, 1);
    expect(logsPage2.items[0]?.reason).toBe('大额奖励');

    db.close();
  });

  it('enforces peer review anti-abuse (self, daily reviewer limit, 24h target cooldown, daily target cap, overdue extra penalty)', () => {
    const { db, service } = createFixture();

    // No self review
    expect(service.endorseUser('g1', 'r1', 'r1', BASE_TIME)).toEqual({
      ok: false,
      reason: 'self_target',
    });
    expect(service.reportUser('g1', 'r1', 'r1', BASE_TIME)).toEqual({
      ok: false,
      reason: 'self_target',
    });

    // Reviewer r1 endorses 3 different targets -> hits daily limit 3
    const e1 = service.endorseUser('g1', 'r1', 't1', BASE_TIME);
    expect(e1).toMatchObject({ ok: true, delta: 10, targetScore: 610, remainingReviewsToday: 2 });
    const e2 = service.endorseUser('g1', 'r1', 't2', BASE_TIME + 1000);
    expect(e2).toMatchObject({ ok: true, delta: 10, remainingReviewsToday: 1 });
    const e3 = service.endorseUser('g1', 'r1', 't3', BASE_TIME + 2000);
    expect(e3).toMatchObject({ ok: true, delta: 10, remainingReviewsToday: 0 });

    // 4th review same day rejected
    expect(service.endorseUser('g1', 'r1', 't4', BASE_TIME + 3000)).toEqual({
      ok: false,
      reason: 'daily_limit_reached',
      dailyLimit: 3,
    });

    // Same target within 24h rejected even on next dateKey if < 24h elapsed
    const r2First = service.endorseUser('g1', 'r2', 't1', BASE_TIME + 1000);
    expect(r2First).toMatchObject({ ok: true, delta: 10, targetScore: 620 });
    const r2TooSoon = service.reportUser('g1', 'r2', 't1', BASE_TIME + DAY_MS - 10_000);
    expect(r2TooSoon.ok).toBe(false);
    if (!r2TooSoon.ok) {
      expect(r2TooSoon.reason).toBe('target_cooldown');
      expect(r2TooSoon.retryAfterSec).toBeGreaterThan(0);
    }

    // Target daily cap +30: t1 already has +20 (r1 + r2); r3 adds +10 -> +30; r4 blocked
    const r3 = service.endorseUser('g1', 'r3', 't1', BASE_TIME + 2000);
    expect(r3).toMatchObject({ ok: true, delta: 10, targetScore: 630 });
    const r4 = service.endorseUser('g1', 'r4', 't1', BASE_TIME + 3000);
    expect(r4).toEqual({ ok: false, reason: 'target_daily_cap' });

    // After 24h, r2 can review t1 again
    const r2NextDay = service.reportUser('g1', 'r2', 't1', BASE_TIME + DAY_MS + 2000);
    expect(r2NextDay).toMatchObject({
      ok: true,
      delta: -8,
      targetScore: 622,
      targetIsOverdue: false,
    });

    // Report on overdue user deals -15 instead of -8, and respects -30 daily target cap
    const usury = service.takeUsuryLoan('g1', 'deadbeat_u', 10_000, BASE_TIME);
    expect(usury.ok).toBe(true);
    const overdueTime = BASE_TIME + 3 * DAY_MS;

    const rep1 = service.reportUser('g1', 'a1', 'deadbeat_u', overdueTime);
    expect(rep1).toMatchObject({
      ok: true,
      delta: -15,
      targetScore: 585,
      targetIsOverdue: true,
    });
    const rep2 = service.reportUser('g1', 'a2', 'deadbeat_u', overdueTime + 1000);
    expect(rep2).toMatchObject({
      ok: true,
      delta: -15,
      targetScore: 570,
      targetIsOverdue: true,
    });
    // Target hit -30 cap today -> 3rd report rejected
    const rep3 = service.reportUser('g1', 'a3', 'deadbeat_u', overdueTime + 2000);
    expect(rep3).toEqual({ ok: false, reason: 'target_daily_cap' });

    db.close();
  });

  it('handles bank loans and usury loans with tier limits, credit gating, and duplicate guards', () => {
    const { db, profileRepo, service } = createFixture();

    // Score < 300 cannot take bank loan, but CAN take usury loan
    service.adjustCredit('g1', 'low_u', -350, '测试降分', BASE_TIME); // 250
    expect(service.takeBankLoan('g1', 'low_u', 5_000, 2, BASE_TIME)).toEqual({
      ok: false,
      reason: 'credit_too_low',
      score: 250,
      minScore: 300,
    });

    // Usury validates amount [1000, 100000]
    expect(service.takeUsuryLoan('g1', 'low_u', 500, BASE_TIME)).toEqual({
      ok: false,
      reason: 'invalid_amount',
      minAmount: 1_000,
      maxAmount: 100_000,
    });
    expect(service.takeUsuryLoan('g1', 'low_u', 200_000, BASE_TIME)).toEqual({
      ok: false,
      reason: 'invalid_amount',
      minAmount: 1_000,
      maxAmount: 100_000,
    });

    const usuryOk = service.takeUsuryLoan('g1', 'low_u', 20_000, BASE_TIME);
    expect(usuryOk.ok).toBe(true);
    if (usuryOk.ok) {
      expect(usuryOk.loan.loanType).toBe('usury');
      expect(usuryOk.loan.dailyRate).toBe(0.12);
      expect(usuryOk.loan.termDays).toBe(2);
      expect(usuryOk.balance).toBe(20_000);
    }
    expect(profileRepo.getOrCreate('g1', 'low_u').coins).toBe(20_000);
    // Duplicate active usury loan rejected
    expect(service.takeUsuryLoan('g1', 'low_u', 5_000, BASE_TIME + 1000)).toEqual({
      ok: false,
      reason: 'active_usury_loan_exists',
    });

    // Normal user (score 600): max 50,000, max 5 days, dailyRate 0.015
    expect(service.takeBankLoan('g1', 'norm_u', 60_000, 5, BASE_TIME)).toEqual({
      ok: false,
      reason: 'invalid_amount',
      minAmount: 500,
      maxAmount: 50_000,
    });
    expect(service.takeBankLoan('g1', 'norm_u', 20_000, 6, BASE_TIME)).toEqual({
      ok: false,
      reason: 'invalid_term',
      minDays: 1,
      maxDays: 5,
    });

    const bankOk = service.takeBankLoan('g1', 'norm_u', 30_000, 4, BASE_TIME);
    expect(bankOk.ok).toBe(true);
    if (bankOk.ok) {
      expect(bankOk.loan.loanType).toBe('bank');
      expect(bankOk.loan.dailyRate).toBe(0.015);
      expect(bankOk.loan.termDays).toBe(4);
      expect(bankOk.balance).toBe(30_000);
    }
    // Duplicate bank loan rejected
    expect(service.takeBankLoan('g1', 'norm_u', 5_000, 2, BASE_TIME + 1000)).toEqual({
      ok: false,
      reason: 'active_bank_loan_exists',
    });

    // Noble user (score 900): max 500,000, max 10 days, rate 0.005
    service.adjustCredit('g1', 'noble_u', 300, '贵宾升级', BASE_TIME);
    const nobleLoan = service.takeBankLoan('g1', 'noble_u', 400_000, 10, BASE_TIME);
    expect(nobleLoan.ok).toBe(true);
    if (nobleLoan.ok) {
      expect(nobleLoan.loan.dailyRate).toBe(0.005);
      expect(nobleLoan.tier.key).toBe('noble');
    }

    // Overdue usury loan blocks taking a bank loan even if credit score >= 300
    service.takeUsuryLoan('g1', 'blocked_u', 5_000, BASE_TIME);
    expect(service.takeBankLoan('g1', 'blocked_u', 5_000, 2, BASE_TIME + 3 * DAY_MS)).toEqual({
      ok: false,
      reason: 'has_overdue_loan',
    });

    db.close();
  });

  it('supports partial and full repayment (interest first, credit bonus on-time, useBank option, deadbeat clearing)', () => {
    const { db, profileRepo, service } = createFixture();

    const bankLoanRes = service.takeBankLoan('g1', 'u1', 20_000, 5, BASE_TIME);
    expect(bankLoanRes.ok).toBe(true);
    if (!bankLoanRes.ok) return;

    // Advance 1 day -> accrue normal daily interest (20,000 * 0.015 = 300)
    const noticesDay2 = service.processOverdueLoans(BASE_TIME + DAY_MS);
    expect(noticesDay2).toHaveLength(0);

    // Partial repayment of 500: pays 300 interest first, then 200 principal
    const partial = service.repayLoan('g1', 'u1', bankLoanRes.loan.id, 500, BASE_TIME + DAY_MS + 1000);
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.interestPaid).toBe(300);
      expect(partial.principalPaid).toBe(200);
      expect(partial.remainingDebt).toBe(19_800);
      expect(partial.fullyRepaid).toBe(false);
      expect(partial.creditDelta).toBe(0);
    }

    // Put some funds in bank and repay rest using { useBank: true } with overpay clamped
    const p = profileRepo.getOrCreate('g1', 'u1');
    profileRepo.save({ ...p, coins: 10_000, bankCoins: 15_000 });

    // Without useBank, 19,800 fails
    expect(
      service.repayLoan('g1', 'u1', bankLoanRes.loan.id, 30_000, BASE_TIME + DAY_MS + 2000),
    ).toEqual({
      ok: false,
      reason: 'insufficient_funds',
      required: 19_800,
      available: 10_000,
    });

    // With useBank, draws 10,000 pocket + 9,800 bank, clamps to 19,800, awards on-time credit (+15..+35)
    const full = service.repayLoan(
      'g1',
      'u1',
      bankLoanRes.loan.id,
      50_000,
      BASE_TIME + DAY_MS + 2000,
      { useBank: true },
    );
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(full.paidAmount).toBe(19_800);
      expect(full.paidFromPocket).toBe(10_000);
      expect(full.paidFromBank).toBe(9_800);
      expect(full.fullyRepaid).toBe(true);
      expect(full.loan.status).toBe('repaid');
      expect(full.creditDelta).toBeGreaterThanOrEqual(15);
      expect(full.creditDelta).toBeLessThanOrEqual(35);
      expect(full.coins).toBe(0);
      expect(full.bankCoins).toBe(5_200);
    }

    // Already repaid cannot be repaid again
    expect(
      service.repayLoan('g1', 'u1', bankLoanRes.loan.id, 100, BASE_TIME + DAY_MS + 3000),
    ).toEqual({
      ok: false,
      reason: 'already_repaid',
    });

    // On-time usury full repayment awards +10 credit
    const usuryRes = service.takeUsuryLoan('g1', 'u2', 5_000, BASE_TIME);
    expect(usuryRes.ok).toBe(true);
    if (!usuryRes.ok) return;
    const repayUsury = service.repayLoan('g1', 'u2', usuryRes.loan.id, 5_000, BASE_TIME + 10_000);
    expect(repayUsury.ok).toBe(true);
    if (repayUsury.ok) {
      expect(repayUsury.creditDelta).toBe(10);
      expect(repayUsury.creditScore).toBe(610);
    }

    // Overdue repayment clears deadbeat status without on-time bonus
    const overdueBank = service.takeBankLoan('g1', 'u3', 2_000, 1, BASE_TIME);
    expect(overdueBank.ok).toBe(true);
    if (!overdueBank.ok) return;
    // Empty wallet before sweep so it doesn't auto-seize
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'u3'), coins: 0 });
    const sweepTime = BASE_TIME + 2 * DAY_MS;
    const sweepNotices = service.processOverdueLoans(sweepTime);
    expect(sweepNotices).toHaveLength(1);
    expect(service.isDeadbeatBlocked('g1', 'u3', sweepTime).blocked).toBe(true);

    // Give coins to repay overdue loan
    const owed = service.isDeadbeatBlocked('g1', 'u3', sweepTime).totalOverdueDebt;
    profileRepo.addCoins('g1', 'u3', owed + 500);
    const repayOverdue = service.repayLoan('g1', 'u3', overdueBank.loan.id, owed, sweepTime + 1000);
    expect(repayOverdue.ok).toBe(true);
    if (repayOverdue.ok) {
      expect(repayOverdue.fullyRepaid).toBe(true);
      expect(repayOverdue.creditDelta).toBe(0);
      expect(repayOverdue.deadbeatCleared).toBe(true);
    }
    expect(service.isDeadbeatBlocked('g1', 'u3', sweepTime + 2000).blocked).toBe(false);

    db.close();
  });

  it('processes overdue bank & usury loans: penalty caps, credit drops, auto-seize, single usury bounty, and daily notice throttling', () => {
    const { db, profileRepo, chaosRepo, repo, service } = createFixture();

    // 1. Bank loan: 10,000 for 1 day; empty wallet so we test penalty accrual + 2.5x cap (25,000)
    const bankLoan = service.takeBankLoan('g1', 'bank_debtor', 10_000, 1, BASE_TIME);
    expect(bankLoan.ok).toBe(true);
    if (!bankLoan.ok) return;
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'bank_debtor'), coins: 0 });

    // 2. Usury loan: 50,000 for 2 days; leave 2,000 pocket + 3,000 bank to test auto-seize + bounty
    const usuryLoan = service.takeUsuryLoan('g1', 'usury_debtor', 50_000, BASE_TIME);
    expect(usuryLoan.ok).toBe(true);
    if (!usuryLoan.ok) return;
    profileRepo.save({
      ...profileRepo.getOrCreate('g1', 'usury_debtor'),
      coins: 2_000,
      bankCoins: 3_000,
    });

    // Day +2 at 11:00 (after bank dueAt = Day+1 12:00, before usury dueAt = Day+2 12:00):
    // Bank becomes overdue (penalty +500, credit -15), usury still active (normal +12% = 6,000)
    const day2Morning = BASE_TIME + 2 * DAY_MS - 3_600_000;
    const notices2 = service.processOverdueLoans(day2Morning);
    expect(notices2).toHaveLength(1);
    expect(notices2[0]).toMatchObject({
      userId: 'bank_debtor',
      loanType: 'bank',
      penaltyAdded: 500,
      creditDelta: -15,
      creditScore: 585,
      totalSeized: 0,
      bountyPostedNow: false,
    });

    // Idempotent within same dateKey -> second run emits 0 notices and adds 0 extra penalty/interest
    expect(service.processOverdueLoans(day2Morning + 1_800_000)).toHaveLength(0);
    const bankAfterDay2 = repo.getLoanById(bankLoan.loan.id)!;
    expect(bankAfterDay2.accruedInterest).toBe(500);
    expect(repo.getLoanById(usuryLoan.loan.id)?.accruedInterest).toBe(6_000);

    // Day +3: usury crosses dueAt!
    // Before Day+3: usury principal 50,000 + accrued 6,000 = 56,000
    // Penalty +20% of 50,000 = 10,000 -> total debt 66,000
    // Credit drops -30 -> 570
    // Auto-seize: 2,000 pocket + 3,000 bank = 5,000 (pays interest down from 16,000 to 11,000)
    // Bounty: clamp(floor(50,000 * 0.2), 5,000, 100,000) = 10,000 posted via chaosRepo!
    const day3 = BASE_TIME + 3 * DAY_MS;
    const notices3 = service.processOverdueLoans(day3);
    expect(notices3).toHaveLength(2);
    // Repeated sweep same day is fully throttled
    expect(service.processOverdueLoans(day3 + 3_600_000)).toHaveLength(0);
    const usuryNotice = notices3.find((n) => n.userId === 'usury_debtor');
    expect(usuryNotice).toBeDefined();
    expect(usuryNotice).toMatchObject({
      loanType: 'usury',
      penaltyAdded: 10_000,
      seizedFromPocket: 2_000,
      seizedFromBank: 3_000,
      totalSeized: 5_000,
      remainingDebt: 61_000,
      clearedBySeize: false,
      creditDelta: -30,
      creditScore: 570,
      bountyPostedNow: true,
      bountyAmount: 10_000,
    });
    expect(profileRepo.getOrCreate('g1', 'usury_debtor').coins).toBe(0);
    expect(profileRepo.getOrCreate('g1', 'usury_debtor').bankCoins).toBe(0);
    expect(chaosRepo.getOpenBountyTotal('g1', 'usury_debtor')).toBe(10_000);

    // Run 40 more days to verify:
    // - Bank total owed caps at 2.5x principal = 25,000
    // - Usury total owed caps at 3.0x principal = 150,000
    // - Usury bounty is NEVER posted twice!
    for (let d = 4; d <= 45; d++) {
      service.processOverdueLoans(BASE_TIME + d * DAY_MS);
    }

    const bankCapped = repo.getLoanById(bankLoan.loan.id)!;
    expect(bankCapped.remainingPrincipal + bankCapped.accruedInterest).toBe(25_000);

    const usuryCapped = repo.getLoanById(usuryLoan.loan.id)!;
    expect(usuryCapped.remainingPrincipal + usuryCapped.accruedInterest).toBe(150_000);
    expect(usuryCapped.bountyPosted).toBe(true);
    expect(chaosRepo.getOpenBountyTotal('g1', 'usury_debtor')).toBe(10_000);

    // Auto-seize full clearance: if debtor has enough coins+bank, loan becomes repaid & no usury bounty posted
    const richUsury = service.takeUsuryLoan('g1', 'rich_forgetful', 10_000, BASE_TIME);
    expect(richUsury.ok).toBe(true);
    if (!richUsury.ok) return;
    profileRepo.save({
      ...profileRepo.getOrCreate('g1', 'rich_forgetful'),
      coins: 5_000,
      bankCoins: 20_000,
    });
    const richSweep = service.processOverdueLoans(BASE_TIME + 50 * DAY_MS);
    const richNotice = richSweep.find((n) => n.userId === 'rich_forgetful');
    expect(richNotice).toMatchObject({
      clearedBySeize: true,
      remainingDebt: 0,
      bountyPostedNow: false,
      bountyAmount: 0,
    });
    expect(repo.getLoanById(richUsury.loan.id)?.status).toBe('repaid');
    expect(chaosRepo.getOpenBountyTotal('g1', 'rich_forgetful')).toBe(0);

    db.close();
  });

  it('garnishes incoming coins oldest-first across overdue loans and clears paid loans', () => {
    const { db, profileRepo, repo, service } = createFixture();

    // No overdue loan -> 0 garnish
    expect(service.garnishIncomingCoins('g1', 'clean_u', 10_000, 'work', BASE_TIME)).toEqual({
      grossAmount: 10_000,
      garnished: 0,
      netAmount: 10_000,
      clearedLoanIds: [],
    });

    // Create two loans for debtor: bank 1,000 (1 day) + usury 2,000 (2 days)
    const l1 = service.takeBankLoan('g1', 'debtor', 1_000, 1, BASE_TIME);
    const l2 = service.takeUsuryLoan('g1', 'debtor', 2_000, BASE_TIME + 1000);
    expect(l1.ok && l2.ok).toBe(true);
    if (!l1.ok || !l2.ok) return;

    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'debtor'), coins: 0 });
    const tOverdue = BASE_TIME + 3 * DAY_MS;
    service.processOverdueLoans(tOverdue);
    // l1 debt = 1,050; l2 debt = 2,400 -> total 3,450

    // Income 4,000 -> 50% garnish = 2,000: clears l1 (1,050) and pays 950 toward l2
    const g1 = service.garnishIncomingCoins('g1', 'debtor', 4_000, 'rpg', tOverdue + 1000);
    expect(g1).toEqual({
      grossAmount: 4_000,
      garnished: 2_000,
      netAmount: 2_000,
      clearedLoanIds: [l1.loan.id],
    });
    expect(repo.getLoanById(l1.loan.id)?.status).toBe('repaid');
    const l2Mid = repo.getLoanById(l2.loan.id)!;
    expect(l2Mid.accruedInterest).toBe(0); // 400 interest paid first
    expect(l2Mid.remainingPrincipal).toBe(1_450); // 550 principal paid

    // Next income 10,000 -> 50% is 5,000, capped at remaining debt 1,450 -> clears l2
    const g2 = service.garnishIncomingCoins('g1', 'debtor', 10_000, 'rpg', tOverdue + 2000);
    expect(g2).toEqual({
      grossAmount: 10_000,
      garnished: 1_450,
      netAmount: 8_550,
      clearedLoanIds: [l2.loan.id],
    });
    expect(service.isDeadbeatBlocked('g1', 'debtor', tOverdue + 3000).blocked).toBe(false);

    db.close();
  });

  it('runs sellButt with guild economy tuning, 1h cooldown, 12x~14x payout, -5 credit drop, bust 0.85x, automatic debt garnish, and resetAllHustleCooldowns', () => {
    const { db, configRepo, profileRepo, service } = createFixture();

    // Verify new default config values
    expect(DEFAULT_CREDIT_LOAN_CONFIG.hustleCooldownSec).toBe(3_600);
    expect(DEFAULT_CREDIT_LOAN_CONFIG.hustleMinMultiplier).toBe(12);
    expect(DEFAULT_CREDIT_LOAN_CONFIG.hustleMaxMultiplier).toBe(14);
    expect(DEFAULT_CREDIT_LOAN_CONFIG.hustleCreditPenalty).toBe(5);

    // Tune guild economy workMin=2500, workMax=5000 -> baseReward in [30,000, 70,000]
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateEconomy('g1', { ...cfg.economy, workMin: 2_500, workMax: 5_000 });

    // Branch 1: VIP (eventRoll 0.05 < 0.15, multRoll 0.5 -> 2.0x)
    // baseRoll 0 -> minReward 30,000 -> gross = 60,000
    const vip = service.sellButt('g1', 'h1', BASE_TIME, makeRngSequence([0.0, 0.05, 0.5, 0.0]));
    expect(vip.ok).toBe(true);
    if (vip.ok) {
      expect(vip.eventKey).toBe('vip');
      expect(vip.baseReward).toBe(30_000);
      expect(vip.multiplier).toBe(2.0);
      expect(vip.grossReward).toBe(60_000);
      expect(vip.garnished).toBe(0);
      expect(vip.netReward).toBe(60_000);
      expect(vip.creditDelta).toBe(-5);
      expect(vip.creditScore).toBe(595);
      expect(vip.balance).toBe(60_000);
      expect(vip.stats.totalCount).toBe(1);
      expect(vip.stats.bestPayout).toBe(60_000);
      expect(vip.publicAnnouncement).toContain('<@h1>');
    }

    // Cooldown enforced within 1h
    const cd = service.sellButt('g1', 'h1', BASE_TIME + 1800_000);
    expect(cd.ok).toBe(false);
    if (!cd.ok) {
      expect(cd.reason).toBe('cooldown');
      expect(cd.retryAfterSec).toBe(1800);
    }

    // Branch 2: acquaintance (eventRoll 0.20 in [0.15, 0.30), multRoll 0.5 -> 1.4x) after 1h elapsed
    const acq = service.sellButt(
      'g1',
      'h1',
      BASE_TIME + 3_600_000,
      makeRngSequence([0.0, 0.2, 0.5, 0.2]),
    );
    expect(acq.ok).toBe(true);
    if (acq.ok) {
      expect(acq.eventKey).toBe('acquaintance');
      expect(acq.multiplier).toBe(1.4);
      expect(acq.grossReward).toBe(42_000);
      expect(acq.creditScore).toBe(590);
      expect(acq.stats.totalCount).toBe(2);
      expect(acq.stats.totalEarned).toBe(102_000);
    }

    // Admin resetAllHustleCooldowns clears cooldown immediately while keeping historical stats
    const cleared = service.resetAllHustleCooldowns('g1');
    expect(cleared).toBe(1);
    const afterReset = service.sellButt(
      'g1',
      'h1',
      BASE_TIME + 3_605_000,
      makeRngSequence([0.0, 0.5, 0.5, 0.5]),
    );
    expect(afterReset.ok).toBe(true);
    if (afterReset.ok) {
      expect(afterReset.stats.totalCount).toBe(3);
      expect(afterReset.stats.totalEarned).toBe(132_000);
    }

    // Branch 3: normal (eventRoll 0.50 in [0.30, 0.85), 1.0x)
    const norm = service.sellButt('g1', 'h2', BASE_TIME, makeRngSequence([0.0, 0.5, 0.5, 0.5]));
    expect(norm.ok).toBe(true);
    if (norm.ok) {
      expect(norm.eventKey).toBe('normal');
      expect(norm.multiplier).toBe(1.0);
      expect(norm.grossReward).toBe(30_000);
    }

    // Branch 4: bust (eventRoll 0.90 >= 0.85, 0.85x) + automatic overdue debt garnish!
    const loan = service.takeUsuryLoan('g1', 'h3', 10_000, BASE_TIME);
    expect(loan.ok).toBe(true);
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'h3'), coins: 0 });
    const overdueAt = BASE_TIME + 3 * DAY_MS;
    service.processOverdueLoans(overdueAt);

    // baseRoll 0 -> 30,000, bust 0.85x -> gross 25,500, 50% garnish = 12,000 (debt cap), net = 13,500
    const bust = service.sellButt('g1', 'h3', overdueAt + 1000, makeRngSequence([0.0, 0.9, 0.0, 0.0]));
    expect(bust.ok).toBe(true);
    if (bust.ok) {
      expect(bust.eventKey).toBe('bust');
      expect(bust.multiplier).toBe(0.85);
      expect(bust.grossReward).toBe(25_500);
      expect(bust.garnished).toBe(12_000);
      expect(bust.netReward).toBe(13_500);
      expect(bust.balance).toBe(13_500);
      expect(bust.creditDelta).toBe(-5);
      expect(bust.publicAnnouncement).toContain('逾期强扣还债');
    }

    db.close();
  });

  it('tracks gambling stats and serves credit, deadbeat, hustle, and gambling leaderboards with pagination', () => {
    const { db, profileRepo, service } = createFixture();

    // Credit & Deadbeat setup
    service.adjustCredit('g1', 'saint', 320, '守信典范', BASE_TIME); // 920
    service.adjustCredit('g1', 'avg', 0, '初始化', BASE_TIME); // 600
    service.adjustCredit('g1', 'low_no_loan', -400, '信用破产', BASE_TIME); // 200, no overdue loan

    // High-credit user who has an overdue usury loan -> appears in deadbeat leaderboard with debt!
    service.takeUsuryLoan('g1', 'high_overdue', 20_000, BASE_TIME);
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'high_overdue'), coins: 0 });
    service.processOverdueLoans(BASE_TIME + 3 * DAY_MS);

    const creditLb = service.getCreditLeaderboard('g1', 2, 0);
    expect(creditLb.total).toBe(4);
    expect(creditLb.items.map((x) => x.userId)).toEqual(['saint', 'avg']);

    const deadbeatLb = service.getDeadbeatLeaderboard('g1', 10, 0);
    expect(deadbeatLb.total).toBe(2);
    expect(deadbeatLb.items[0]).toMatchObject({
      userId: 'high_overdue',
      overdueLoanCount: 1,
      totalOverdueDebt: 24_000,
    });
    expect(deadbeatLb.items[1]).toMatchObject({
      userId: 'low_no_loan',
      score: 200,
      overdueLoanCount: 0,
      totalOverdueDebt: 0,
    });

    // Hustle leaderboard
    service.sellButt('g1', 'hustler_big', BASE_TIME, makeRngSequence([0.99, 0.05, 0.99, 0.0]));
    service.sellButt('g1', 'hustler_small', BASE_TIME, makeRngSequence([0.0, 0.9, 0.0, 0.0]));
    service.getHustleStats('g1', 'never_hustled'); // 0 count -> excluded
    const hustleLb = service.getHustleLeaderboard('g1', 10, 0);
    expect(hustleLb.total).toBe(2);
    expect(hustleLb.items[0]?.userId).toBe('hustler_big');
    expect(hustleLb.items[1]?.userId).toBe('hustler_small');

    // Gambling stats & profit/loss leaderboards
    service.recordGamblingResult('g1', 'god', 1_000, 5_000, BASE_TIME);
    const godStats = service.recordGamblingResult('g1', 'god', 2_000, -1_000, BASE_TIME + 1000);
    expect(godStats).toMatchObject({
      totalWagered: 3_000,
      totalWon: 5_000,
      totalLost: 1_000,
      netProfit: 4_000,
      gamesPlayed: 2,
      biggestWin: 5_000,
      biggestLoss: 1_000,
    });

    service.recordGamblingResult('g1', 'mid', 1_000, -500, BASE_TIME);
    service.recordGamblingResult('g1', 'whale_loser', 10_000, -9_500, BASE_TIME);
    service.getGamblingStats('g1', 'non_gambler'); // 0 games -> excluded

    const profitLb = service.getGamblingLeaderboard('g1', 'profit', 2, 0);
    expect(profitLb.total).toBe(3);
    expect(profitLb.items.map((x) => x.userId)).toEqual(['god', 'mid']);

    const lossLb = service.getGamblingLeaderboard('g1', 'loss', 2, 0);
    expect(lossLb.total).toBe(3);
    expect(lossLb.items.map((x) => x.userId)).toEqual(['whale_loser', 'mid']);

    db.close();
  });
});
