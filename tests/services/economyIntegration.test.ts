import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { CreditLoanRepo } from '../../src/db/repositories/creditLoanRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo } from '../../src/db/repositories/redPacketRepo.js';
import { RpgRepo } from '../../src/db/repositories/rpgRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { WorldEventRepo } from '../../src/db/repositories/worldEventRepo.js';
import { BlackjackManager, type Card } from '../../src/services/blackjackService.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { CreditLoanService } from '../../src/services/creditLoanService.js';
import { EconomyService } from '../../src/services/economyService.js';
import { LevelingService } from '../../src/services/levelingService.js';
import { MultiplayerService } from '../../src/services/multiplayerService.js';
import { RpgService } from '../../src/services/rpgService.js';
import { ShopService } from '../../src/services/shopService.js';
import { SocialPetService } from '../../src/services/socialPetService.js';
import { WorldEventService } from '../../src/services/worldEventService.js';

const BASE_TIME = Date.UTC(2026, 4, 10, 4, 0, 0); // 2026-05-10 12:00 Asia/Shanghai
const DAY_MS = 86_400_000;

function createIntegratedFixture() {
  const db = createDatabase(':memory:');
  const guildConfigRepo = new GuildConfigRepo(db);
  const profileRepo = new ProfileRepo(db);
  const shopRepo = new ShopRepo(db);
  const inviteRepo = new InviteRepo(db);
  const redPacketRepo = new RedPacketRepo(db);
  const chaosRepo = new ChaosRepo(db);
  const worldEventRepo = new WorldEventRepo(db);
  const socialPetRepo = new SocialPetRepo(db);
  const creditLoanRepo = new CreditLoanRepo(db);
  const rpgRepo = new RpgRepo(db);

  const creditLoan = new CreditLoanService(
    db,
    guildConfigRepo,
    profileRepo,
    creditLoanRepo,
    'Asia/Shanghai',
    chaosRepo,
  );
  const rpg = new RpgService(db, rpgRepo, profileRepo, {
    timezone: 'Asia/Shanghai',
    guildConfigRepo,
    socialPetRepo,
    onCoinsEarned: (guildId, userId, grossCoins, source, nowMs) => {
      const res = creditLoan.garnishIncomingCoins(guildId, userId, grossCoins, source, nowMs);
      return { garnished: res.garnished, net: res.netAmount };
    },
    onCreditChange: (guildId, userId, delta, reason, nowMs) => {
      creditLoan.adjustCredit(guildId, userId, delta, reason, nowMs);
    },
  });
  const economy = new EconomyService(
    db,
    guildConfigRepo,
    profileRepo,
    'Asia/Shanghai',
    chaosRepo,
    creditLoan,
  );
  const shop = new ShopService(db, profileRepo, shopRepo, {
    guildConfigRepo,
    chaosRepo,
    socialPetRepo,
    creditLoanService: creditLoan,
    timezone: 'Asia/Shanghai',
  });
  const blackjack = new BlackjackManager(db, profileRepo, creditLoan);
  const multiplayer = new MultiplayerService(
    db,
    profileRepo,
    redPacketRepo,
    chaosRepo,
    creditLoan,
  );
  const chaos = new ChaosService(db, guildConfigRepo, profileRepo, chaosRepo, creditLoan);
  const worldEvent = new WorldEventService(
    db,
    guildConfigRepo,
    profileRepo,
    worldEventRepo,
    socialPetRepo,
    creditLoan,
  );
  const socialPet = new SocialPetService(
    db,
    guildConfigRepo,
    profileRepo,
    shopRepo,
    socialPetRepo,
    'Asia/Shanghai',
    creditLoan,
  );
  const leveling = new LevelingService(
    guildConfigRepo,
    profileRepo,
    inviteRepo,
    creditLoan,
    rpg,
  );

  return {
    db,
    guildConfigRepo,
    profileRepo,
    shopRepo,
    chaosRepo,
    creditLoanRepo,
    rpgRepo,
    creditLoan,
    rpg,
    economy,
    shop,
    blackjack,
    multiplayer,
    chaos,
    worldEvent,
    socialPet,
    leveling,
  };
}

describe('economy, credit, deadbeat, garnish, gambling & RPG integration', () => {
  it('auto-upgrades legacy small economy defaults idempotently and reads live guild configs', () => {
    const { db, guildConfigRepo, creditLoan, rpg } = createIntegratedFixture();

    // Insert a legacy small-tier economy guild config directly
    db.prepare(
      `INSERT INTO guild_configs (
        guild_id, modules_json, admin_role_ids_json, admin_user_ids_json,
        leveling_config_json, economy_config_json, welcome_config_json,
        ticket_config_json, games_config_json, ai_config_json,
        credit_loan_config_json, rpg_config_json, updated_at
      ) VALUES (?, '{}', '[]', '[]', '{}', ?, '{}', '{}', '{}', '{}', '{}', '{}', 1000)`,
    ).run(
      'g_legacy',
      JSON.stringify({
        currencyName: '旧币',
        currencyEmoji: '🪙',
        dailyBase: 200,
        dailyStreakBonus: 30,
        dailyMaxStreakBonus: 300,
        workMin: 80,
        workMax: 220,
        workCooldownSec: 1800,
        robCooldownSec: 3600,
        robTargetShieldSec: 3600,
        robSuccessRate: 0.45,
        robBankSuccessRate: 0.2,
        bankInterestRate: 0.02,
        bankInterestMax: 500,
        bankInterestMinDeposit: 100,
      }),
    );

    const upgraded = guildConfigRepo.getOrCreate('g_legacy');
    expect(upgraded.economy.currencyName).toBe('旧币');
    expect(upgraded.economy.dailyBase).toBe(5000);
    expect(upgraded.economy.dailyStreakBonus).toBe(1000);
    expect(upgraded.economy.dailyMaxStreakBonus).toBe(10000);
    expect(upgraded.economy.workMin).toBe(2000);
    expect(upgraded.economy.workMax).toBe(5000);
    expect(upgraded.economy.bankInterestMax).toBe(10000);

    // Persisted back to DB and idempotent on subsequent loads
    const rawSaved = db
      .prepare('SELECT economy_config_json FROM guild_configs WHERE guild_id = ?')
      .get('g_legacy') as { economy_config_json: string };
    expect(JSON.parse(rawSaved.economy_config_json)).toMatchObject({
      dailyBase: 5000,
      workMax: 5000,
      bankInterestMax: 10000,
    });

    // Custom mid/high economy is NOT overwritten
    guildConfigRepo.updateEconomy('g_legacy', { ...upgraded.economy, dailyBase: 7777, workMax: 8888 });
    expect(guildConfigRepo.getOrCreate('g_legacy').economy.dailyBase).toBe(7777);

    // Live per-guild creditLoan & rpg config updates
    const cfg = guildConfigRepo.getOrCreate('g_live');
    guildConfigRepo.updateCreditLoan('g_live', { ...cfg.creditLoan, garnishRate: 0.75 });
    guildConfigRepo.updateRpg('g_live', { ...cfg.rpg, dailyStamina: 9, bagCapacity: 40 });
    expect(creditLoan.getConfig('g_live').garnishRate).toBe(0.75);
    expect(rpg.getConfig('g_live').dailyStamina).toBe(9);
    expect(rpg.getConfig('g_live').bagCapacity).toBe(40);

    db.close();
  });

  it('applies credit score multipliers to work, bank interest cap, shop, and black-market props, and adjusts credit on daily/rob', () => {
    const { db, profileRepo, chaosRepo, creditLoan, economy, shop, chaos } =
      createIntegratedFixture();

    // Raise u_noble to 900 (noble tier: work 1.4x, bankCap 2.0x, shop 0.8x)
    creditLoan.adjustCredit('g1', 'u_noble', 300, 'test_noble', BASE_TIME);
    // Drop u_deadbeat to 200 (deadbeat tier: work 0.8x, bankCap 0.5x, shop 1.25x)
    creditLoan.adjustCredit('g1', 'u_deadbeat', -400, 'test_deadbeat', BASE_TIME);

    // 1. Work multiplier (rng = 0 -> base workMin = 2000)
    const wNoble = economy.work('g1', 'u_noble', BASE_TIME, () => 0);
    expect(wNoble.ok).toBe(true);
    if (wNoble.ok) {
      expect(wNoble.creditMultiplier).toBe(1.4);
      expect(wNoble.reward).toBe(2800);
      expect(wNoble.garnished).toBe(0);
    }

    const wLow = economy.work('g1', 'u_deadbeat', BASE_TIME, () => 0);
    expect(wLow.ok).toBe(true);
    if (wLow.ok) {
      expect(wLow.creditMultiplier).toBe(0.8);
      expect(wLow.reward).toBe(1600);
    }

    // 2. Bank interest cap multiplier (default cap 10,000; 2% of 2,000,000 = 40,000)
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'u_noble'), bankCoins: 2_000_000 });
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'u_deadbeat'), bankCoins: 2_000_000 });

    const intNoble = economy.claimBankInterest('g1', 'u_noble', BASE_TIME);
    expect(intNoble).toEqual({ ok: true, interest: 20_000, bankCoins: 2_020_000 });

    const intLow = economy.claimBankInterest('g1', 'u_deadbeat', BASE_TIME);
    expect(intLow).toEqual({ ok: true, interest: 5_000, bankCoins: 2_005_000 });

    // 3. Shop price multiplier (item price 1000 -> noble 800, deadbeat 1250)
    const item = shop.createBoostItem({
      guildId: 'g1',
      name: '双倍卡',
      description: '测试',
      price: 1000,
      boostMultiplier: 2,
      boostDurationSec: 3600,
      stock: null,
    });
    profileRepo.addCoins('g1', 'u_noble', 5000);
    profileRepo.addCoins('g1', 'u_deadbeat', 5000);

    const buyNoble = shop.buyItem('g1', 'u_noble', item.id, BASE_TIME);
    expect(buyNoble.ok).toBe(true);
    if (buyNoble.ok) {
      expect(buyNoble.finalPrice).toBe(800);
    }

    const buyLow = shop.buyItem('g1', 'u_deadbeat', item.id, BASE_TIME);
    expect(buyLow.ok).toBe(true);
    if (buyLow.ok) {
      expect(buyLow.finalPrice).toBe(1250);
    }

    // 4. Black-market prop price multiplier (trap default 500 -> noble 400, deadbeat 625)
    const propNoble = chaos.buyProp('g1', 'u_noble', 'trap', BASE_TIME);
    expect(propNoble.ok).toBe(true);
    if (propNoble.ok) {
      expect(propNoble.price).toBe(400);
    }
    const propLow = chaos.buyProp('g1', 'u_deadbeat', 'trap', BASE_TIME);
    expect(propLow.ok).toBe(true);
    if (propLow.ok) {
      expect(propLow.price).toBe(625);
    }

    // 5. Daily +3 credit, rob fail -10 credit, robBank fail/trap -20 credit
    const dailyRes = economy.claimDaily('g1', 'u_normal', BASE_TIME);
    expect(dailyRes.ok).toBe(true);
    expect(creditLoan.getCreditProfile('g1', 'u_normal', BASE_TIME).account.score).toBe(603);

    profileRepo.addCoins('g1', 'u_normal', 5000);
    profileRepo.addCoins('g1', 'u_victim', 5000);
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'u_victim'), bankCoins: 5000 });

    const robFail = economy.rob('g1', 'u_normal', 'u_victim', BASE_TIME, () => 0.99);
    expect(robFail.ok && !robFail.success).toBe(true);
    expect(creditLoan.getCreditProfile('g1', 'u_normal', BASE_TIME).account.score).toBe(593);

    chaosRepo.setEffect({
      guildId: 'g1',
      userId: 'u_victim',
      effectKey: 'trap_armed',
      charges: 1,
      expiresAt: BASE_TIME + 10_000_000,
      sourceUserId: null,
      updatedAt: BASE_TIME,
    });
    const robBankTrap = economy.robBank(
      'g1',
      'u_normal',
      'u_victim',
      BASE_TIME + 4_000_000,
      () => 0.99,
    );
    expect(robBankTrap.ok && !robBankTrap.success && robBankTrap.trapped).toBe(true);
    expect(creditLoan.getCreditProfile('g1', 'u_normal', BASE_TIME + 4_000_000).account.score).toBe(
      573,
    );

    db.close();
  });

  it('blocks deadbeats across transfers, dice, slots, blackjack, duels, roulette, bombs, predictions, and pet gacha/wagers', () => {
    const {
      db,
      profileRepo,
      creditLoan,
      economy,
      blackjack,
      multiplayer,
      chaos,
      worldEvent,
      socialPet,
    } = createIntegratedFixture();

    // Give debtor and peer coins & pets before delinquency
    profileRepo.addCoins('g1', 'debtor', 50_000);
    profileRepo.addCoins('g1', 'peer', 50_000);
    expect(socialPet.pullPetGacha('g1', 'debtor', BASE_TIME).ok).toBe(true);
    expect(socialPet.pullPetGacha('g1', 'peer', BASE_TIME).ok).toBe(true);

    // Take a 1-day bank loan and advance past due date so debtor is overdue
    const loanRes = creditLoan.takeBankLoan('g1', 'debtor', 10_000, 1, BASE_TIME);
    expect(loanRes.ok).toBe(true);
    const overdueNow = BASE_TIME + 2 * DAY_MS;
    expect(creditLoan.isDeadbeatBlocked('g1', 'debtor', overdueNow).blocked).toBe(true);

    // 1. Transfer blocked
    expect(economy.transferCoins('g1', 'debtor', 'peer', 100, overdueNow)).toEqual({
      ok: false,
      reason: 'deadbeat_blocked',
    });

    // 2. Dice & Slots blocked
    expect(economy.playDice('g1', 'debtor', 100, 'big', () => 0.5, overdueNow)).toEqual({
      ok: false,
      reason: 'deadbeat_blocked',
    });
    expect(economy.playSlots('g1', 'debtor', 100, () => 0.5, overdueNow)).toEqual({
      ok: false,
      reason: 'deadbeat_blocked',
    });

    // 3. Blackjack blocked
    expect(blackjack.startGame('g1', 'debtor', 100, undefined, overdueNow)).toEqual({
      ok: false,
      reason: 'deadbeat_blocked',
    });

    // 4. Duel create & accept blocked
    expect(multiplayer.createDuel('g1', 'c1', 'debtor', 'peer', 100, overdueNow)).toEqual({
      ok: false,
      reason: 'deadbeat_blocked',
    });
    const peerDuel = multiplayer.createDuel('g1', 'c1', 'peer', 'debtor', 100, overdueNow);
    expect(peerDuel.ok).toBe(true);
    if (peerDuel.ok) {
      expect(multiplayer.acceptDuel(peerDuel.duel.id, 'debtor', overdueNow)).toEqual({
        ok: false,
        reason: 'deadbeat_blocked',
      });
    }

    // 5. Roulette create & join blocked
    expect(
      chaos.createRoulette({
        guildId: 'g1',
        channelId: 'c1',
        hostId: 'debtor',
        entryFee: 100,
        nowMs: overdueNow,
      }),
    ).toEqual({ ok: false, reason: 'deadbeat_blocked' });
    const peerRl = chaos.createRoulette({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'peer',
      entryFee: 100,
      nowMs: overdueNow,
    });
    expect(peerRl.ok).toBe(true);
    if (peerRl.ok) {
      expect(chaos.joinRoulette(peerRl.game.id, 'debtor', overdueNow)).toEqual({
        ok: false,
        reason: 'deadbeat_blocked',
      });
    }

    // 6. Number bomb create & guess blocked
    expect(
      chaos.createNumberBomb({
        guildId: 'g1',
        channelId: 'c1',
        hostId: 'debtor',
        penalty: 100,
        nowMs: overdueNow,
      }),
    ).toEqual({ ok: false, reason: 'deadbeat_blocked' });
    const peerBomb = chaos.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'peer',
      penalty: 100,
      nowMs: overdueNow,
    });
    expect(peerBomb.ok).toBe(true);
    if (peerBomb.ok) {
      expect(chaos.guessNumberBomb(peerBomb.game.id, 'debtor', 50, overdueNow)).toEqual({
        ok: false,
        reason: 'deadbeat_blocked',
      });
    }

    // 7. WorldEvent prediction bet blocked
    const pred = worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'peer',
      title: '测试封禁',
      options: ['A', 'B'],
      closeMinutes: 60,
      nowMs: overdueNow,
    });
    expect(pred.ok).toBe(true);
    if (pred.ok) {
      expect(
        worldEvent.placeBet({
          predictionId: pred.summary.prediction.id,
          userId: 'debtor',
          optionIndex: 0,
          amount: 100,
          nowMs: overdueNow,
        }),
      ).toEqual({ ok: false, reason: 'deadbeat_blocked' });
    }

    // 8. Pet gacha & wagered pet arena blocked, but 0-bet friendly battle allowed
    expect(socialPet.pullPetGacha('g1', 'debtor', overdueNow)).toEqual({
      ok: false,
      reason: 'deadbeat_blocked',
    });
    expect(
      socialPet.createPetBattle({
        guildId: 'g1',
        channelId: 'c1',
        challengerId: 'debtor',
        opponentId: 'peer',
        bet: 100,
        nowMs: overdueNow,
      }),
    ).toEqual({ ok: false, reason: 'deadbeat_blocked' });
    const peerBattle = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'peer',
      opponentId: 'debtor',
      bet: 100,
      nowMs: overdueNow,
    });
    expect(peerBattle.ok).toBe(true);
    if (peerBattle.ok) {
      expect(socialPet.acceptPetBattle(peerBattle.battle.id, 'debtor', overdueNow)).toEqual({
        ok: false,
        reason: 'deadbeat_blocked',
      });
    }
    const friendlyBattle = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'debtor',
      opponentId: 'peer',
      bet: 0,
      nowMs: overdueNow,
    });
    expect(friendlyBattle.ok).toBe(true);

    db.close();
  });

  it('auto-garnishes overdue debt across daily, work, red-packet claims, and RPG loot', () => {
    const { db, profileRepo, creditLoan, economy, multiplayer, rpg } = createIntegratedFixture();

    const loan = creditLoan.takeBankLoan('g1', 'debtor', 20_000, 1, BASE_TIME);
    expect(loan.ok).toBe(true);
    // Drain debtor pocket so overdue stays unpaid
    profileRepo.save({ ...profileRepo.getOrCreate('g1', 'debtor'), coins: 0 });
    const overdueNow = BASE_TIME + 2 * DAY_MS;

    // 1. Daily claim (5000 -> 50% = 2500 garnished, 2500 net)
    const daily = economy.claimDaily('g1', 'debtor', overdueNow);
    expect(daily.ok).toBe(true);
    if (daily.ok) {
      expect(daily.reward).toBe(5000);
      expect(daily.garnished).toBe(2500);
      expect(daily.balance).toBe(2500);
    }

    // 2. Work (base 2000 * 1.0x = 2000 -> 1000 garnished, 1000 net -> balance 3500)
    const work = economy.work('g1', 'debtor', overdueNow, () => 0);
    expect(work.ok).toBe(true);
    if (work.ok) {
      expect(work.reward).toBe(2000);
      expect(work.garnished).toBe(1000);
      expect(work.balance).toBe(3500);
    }

    // 3. Red packet claim (total 2000, 2 shares -> first share 1000 -> 500 garnished, 500 net)
    profileRepo.addCoins('g1', 'sender', 10_000);
    const rp = multiplayer.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'sender',
      totalAmount: 2000,
      totalCount: 2,
      nowMs: overdueNow,
    });
    expect(rp.ok).toBe(true);
    if (rp.ok) {
      const claim = multiplayer.claimRedPacket(rp.packet.id, 'debtor', overdueNow, () => 0.5);
      expect(claim.ok).toBe(true);
      if (claim.ok) {
        expect(claim.garnished).toBe(Math.floor(claim.amount * 0.5));
        expect(claim.claimerBalance).toBe(3500 + (claim.amount - (claim.garnished ?? 0)));
      }
    }

    // 4. RPG retreat loot auto-garnish via wired onCoinsEarned
    rpg.chooseOrSwitchClass('g1', 'debtor', 'warrior', overdueNow);
    const start = rpg.startRun('g1', 'debtor', 1, overdueNow, () => 0.1);
    expect(start.ok).toBe(true);
    // Clear floor 1 combat to earn pendingCoins, then retreat to trigger banking + garnish
    let steps = 0;
    let floorCleared = false;
    while (steps < 20 && !floorCleared) {
      const act = rpg.actInRun('g1', 'debtor', 'attack', overdueNow + steps * 1000, () => 0.1);
      expect(act.ok).toBe(true);
      if (act.ok && act.outcome === 'floor_cleared') {
        floorCleared = true;
      }
      steps += 1;
    }
    expect(floorCleared).toBe(true);

    const retreat = rpg.actInRun('g1', 'debtor', 'retreat', overdueNow + 60_000, () => 0.1);
    expect(retreat.ok).toBe(true);
    if (retreat.ok && retreat.outcome === 'retreated') {
      expect(retreat.reward.grossCoins).toBeGreaterThan(0);
      expect(retreat.reward.garnishedCoins).toBeGreaterThan(0);
      expect(retreat.reward.netCoins).toBe(
        retreat.reward.grossCoins - retreat.reward.garnishedCoins,
      );
    }

    db.close();
  });

  it('records gambling stats across all games and populates all 6 new leaderboards in LevelingService', () => {
    const {
      db,
      profileRepo,
      creditLoan,
      economy,
      blackjack,
      multiplayer,
      chaos,
      worldEvent,
      socialPet,
      rpg,
      leveling,
    } = createIntegratedFixture();

    profileRepo.addCoins('g1', 'p1', 100_000);
    profileRepo.addCoins('g1', 'p2', 100_000);

    // 1. Dice win (+1000) & Slots jackpot (+1400) for p1
    expect(economy.playDice('g1', 'p1', 100, 'triple', () => 0, BASE_TIME).ok).toBe(true);
    expect(economy.playSlots('g1', 'p1', 100, () => 0.999, BASE_TIME).ok).toBe(true);

    // 2. Blackjack natural blackjack (+300 on bet 200) for p1
    const bjDeck = (): Card[] => [
      { rank: '9', suit: '♦' }, // d2
      { rank: 'K', suit: '♣' }, // p2
      { rank: '7', suit: '♠' }, // d1
      { rank: 'A', suit: '♥' }, // p1
    ];
    const bjStart = blackjack.startGame('g1', 'p1', 200, bjDeck, BASE_TIME);
    expect(bjStart.ok && bjStart.game.status === 'player_blackjack').toBe(true);

    // 3. Duel settlement (+500 p1, -500 p2)
    const duel = multiplayer.createDuel('g1', 'c1', 'p1', 'p2', 500, BASE_TIME);
    expect(duel.ok).toBe(true);
    if (duel.ok) {
      let idx = 0;
      const rolls = [0.9, 0.9, 0.9, 0.0, 0.0, 0.0]; // p1 rolls 6,6,6; p2 rolls 1,1,1
      const acc = multiplayer.acceptDuel(duel.duel.id, 'p2', BASE_TIME, () => rolls[idx++] ?? 0);
      expect(acc.ok && acc.winnerId === 'p1').toBe(true);
    }

    // 4. Roulette settlement (p1 host & p2 join, fee 300 -> prize 600 -> +300 / -300)
    const rl = chaos.createRoulette({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'p1',
      entryFee: 300,
      nowMs: BASE_TIME,
    });
    expect(rl.ok).toBe(true);
    if (rl.ok) {
      expect(chaos.joinRoulette(rl.game.id, 'p2', BASE_TIME).ok).toBe(true);
      const started = chaos.startRoulette(rl.game.id, 'p1', false, BASE_TIME, () => 0);
      expect(started.ok).toBe(true);
      if (started.ok) {
        const firstActor = started.game.alivePlayers[0]!;
        const pull = chaos.pullTrigger(rl.game.id, firstActor, { nowMs: BASE_TIME });
        expect(pull.ok && pull.winnerId !== null).toBe(true);
      }
    }

    // 5. Number bomb explosion (secret = 1 when rng = 0 across [1, 100]; p1 guesses 50 safe, p2 guesses 1 boom -> p2 -400, p1 +400)
    const bomb = chaos.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'p1',
      penalty: 400,
      nowMs: BASE_TIME,
      rng: () => 0,
    });
    expect(bomb.ok).toBe(true);
    if (bomb.ok) {
      expect(chaos.guessNumberBomb(bomb.game.id, 'p1', 50, BASE_TIME).ok).toBe(true);
      const boom = chaos.guessNumberBomb(bomb.game.id, 'p2', bomb.game.secretNumber, BASE_TIME);
      expect(boom.ok && boom.exploded).toBe(true);
    }

    // 6. Prediction settle (neutral creator host_referee; p1 bets 600 on 0, p2 bets 400 on 1 -> option 0 wins -> p1 +400, p2 -400)
    const pred = worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'host_referee',
      title: '测试胜负',
      options: ['赢', '输'],
      closeMinutes: 30,
      nowMs: BASE_TIME,
    });
    expect(pred.ok).toBe(true);
    if (pred.ok) {
      expect(
        worldEvent.placeBet({
          predictionId: pred.summary.prediction.id,
          userId: 'p1',
          optionIndex: 0,
          amount: 600,
          nowMs: BASE_TIME,
        }).ok,
      ).toBe(true);
      expect(
        worldEvent.placeBet({
          predictionId: pred.summary.prediction.id,
          userId: 'p2',
          optionIndex: 1,
          amount: 400,
          nowMs: BASE_TIME,
        }).ok,
      ).toBe(true);
      expect(
        worldEvent.lockPrediction(pred.summary.prediction.id, 'host_referee', true, BASE_TIME).ok,
      ).toBe(true);
      const settled = worldEvent.settlePrediction(
        pred.summary.prediction.id,
        'host_referee',
        true,
        0,
        BASE_TIME,
      );
      expect(settled.ok).toBe(true);
    }

    // 7. Wagered pet arena (bet 250)
    expect(socialPet.pullPetGacha('g1', 'p1', BASE_TIME).ok).toBe(true);
    expect(socialPet.pullPetGacha('g1', 'p2', BASE_TIME).ok).toBe(true);
    const pb = socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'p1',
      opponentId: 'p2',
      bet: 250,
      nowMs: BASE_TIME,
    });
    expect(pb.ok).toBe(true);
    if (pb.ok) {
      expect(socialPet.acceptPetBattle(pb.battle.id, 'p2', BASE_TIME).ok).toBe(true);
    }

    const p1Stats = creditLoan.getGamblingStats('g1', 'p1');
    const p2Stats = creditLoan.getGamblingStats('g1', 'p2');
    expect(p1Stats.gamesPlayed).toBe(8);
    expect(p2Stats.gamesPlayed).toBe(5);
    expect(p1Stats.totalWagered).toBe(100 + 100 + 200 + 500 + 300 + 400 + 600 + 250);
    expect(p2Stats.totalWagered).toBe(500 + 300 + 400 + 400 + 250);

    // Seed hustle, deadbeat, and RPG records to verify all 6 new leaderboards in LevelingService
    creditLoan.sellButt('g1', 'p1', BASE_TIME, () => 0.5);
    creditLoan.adjustCredit('g1', 'p3_deadbeat', -400, 'drop', BASE_TIME);
    rpg.chooseOrSwitchClass('g1', 'p1', 'paladin', BASE_TIME);

    expect(leveling.getLeaderboard('g1', 'credit').items.length).toBeGreaterThan(0);
    expect(leveling.getLeaderboard('g1', 'deadbeat').items.map((i) => i.userId)).toContain(
      'p3_deadbeat',
    );
    expect(leveling.getLeaderboard('g1', 'hustle').items[0]?.userId).toBe('p1');
    expect(leveling.getLeaderboard('g1', 'gambling_profit').items[0]?.userId).toBe('p1');
    expect(leveling.getLeaderboard('g1', 'gambling_loss').items[0]?.userId).toBe('p2');
    expect(leveling.getLeaderboard('g1', 'rpg').items[0]?.userId).toBe('p1');

    db.close();
  });
});
