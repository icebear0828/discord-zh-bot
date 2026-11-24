import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import {
  calculateLevelProgress,
  getHeatMultiplier,
  LevelingService,
  parseCardColor,
  renderLevelUpTemplate,
  totalXpForLevel,
  xpRequiredForLevel,
} from '../../src/services/levelingService.js';
import { buildLevelUpEmbed } from '../../src/events/ready.js';

describe('levelingService', () => {
  it('computes XP curve and heat multiplier brackets accurately', () => {
    expect(xpRequiredForLevel(0)).toBe(40);
    expect(xpRequiredForLevel(1)).toBe(72);
    expect(xpRequiredForLevel(2)).toBe(136);
    expect(xpRequiredForLevel(10)).toBe(3240);
    expect(xpRequiredForLevel(20)).toBe(20440);
    expect(xpRequiredForLevel(20)).toBeGreaterThan(xpRequiredForLevel(5) * 20);
    expect(getHeatMultiplier(0, 2.0)).toBe(1.0);
    expect(getHeatMultiplier(2, 2.0)).toBe(1.25);
    expect(getHeatMultiplier(4, 2.0)).toBe(1.5);
    expect(getHeatMultiplier(6, 2.0)).toBe(1.75);
    expect(getHeatMultiplier(8, 2.0)).toBe(2.0);
    expect(getHeatMultiplier(10, 1.5)).toBe(1.5);

    const progress = calculateLevelProgress(150);
    expect(progress.level).toBe(2);
    expect(progress.currentLevelXp).toBe(38);
    expect(progress.nextLevelXp).toBe(136);
  });

  it('enforces cooldown, escalates chat heat within window, resets after window, and applies hourly cap', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const inviteRepo = new InviteRepo(db);
    const svc = new LevelingService(configRepo, profileRepo, inviteRepo);

    const t0 = 1_700_000_000_000;
    const r1 = svc.awardMessageXp('g1', 'u1', 'c1', t0, () => 0.5);
    expect(r1.awarded).toBe(true);
    expect(r1.heatStreak).toBe(1);
    expect(r1.heatMultiplier).toBe(1.0);
    expect(r1.xpGained).toBe(20);

    // Within 15s cooldown -> ignored
    const rCooldown = svc.awardMessageXp('g1', 'u1', 'c1', t0 + 10_000, () => 0.5);
    expect(rCooldown.awarded).toBe(false);
    expect(rCooldown.reason).toBe('cooldown');

    // 20s later -> heatStreak 2 => 1.25x => 25 XP
    const r2 = svc.awardMessageXp('g1', 'u1', 'c1', t0 + 20_000, () => 0.5);
    expect(r2.awarded).toBe(true);
    expect(r2.heatStreak).toBe(2);
    expect(r2.heatMultiplier).toBe(1.25);
    expect(r2.xpGained).toBe(25);

    // After heat window (200s > 180s) -> resets back to streak 1 (1.0x)
    const r3 = svc.awardMessageXp('g1', 'u1', 'c1', t0 + 220_000, () => 0.5);
    expect(r3.awarded).toBe(true);
    expect(r3.heatStreak).toBe(1);
    expect(r3.heatMultiplier).toBe(1.0);

    // Hourly cap enforcement
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateLeveling('g1', { ...cfg.leveling, hourlyXpCap: 70 });
    const r4 = svc.awardMessageXp('g1', 'u1', 'c1', t0 + 240_000, () => 0.5);
    expect(r4.awarded).toBe(true);
    expect(r4.xpGained).toBe(5); // 20 + 25 + 20 = 65 earned so far; cap 70 leaves 5
    const r5 = svc.awardMessageXp('g1', 'u1', 'c1', t0 + 260_000, () => 0.5);
    expect(r5.awarded).toBe(false);
    expect(r5.reason).toBe('hourly_cap');

    db.close();
  });

  it('handles ignored channels, channel multipliers, XP boost cards, level-up coins, and role stacking', () => {
    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const inviteRepo = new InviteRepo(db);
    const svc = new LevelingService(configRepo, profileRepo, inviteRepo);

    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateLeveling('g1', {
      ...cfg.leveling,
      ignoredChannelIds: ['c-ignored'],
      channelMultipliers: { 'c-bonus': 1.5 },
      stackRoles: false,
      levelUpCoinReward: 150,
    });
    profileRepo.setLevelReward('g1', 1, 'role-lv1');
    profileRepo.setLevelReward('g1', 2, 'role-lv2');

    expect(svc.awardMessageXp('g1', 'u1', 'c-ignored', 1_000_000).reason).toBe('ignored_channel');

    // Give active 2x XP boost card and start near level 2 threshold (40 + 72 = 112)
    const p = profileRepo.getOrCreate('g1', 'u1');
    profileRepo.save({
      ...p,
      xp: 90,
      level: 1,
      xpBoostMultiplier: 2.0,
      xpBoostExpiresAt: 5_000_000,
    });

    // Base 20 * channel 1.5 * boost 2.0 = 60 -> total 150 >= 112 (level 2!)
    const res = svc.awardMessageXp('g1', 'u1', 'c-bonus', 1_000_000, () => 0.5);
    expect(res.awarded).toBe(true);
    expect(res.xpGained).toBe(60);
    expect(res.leveledUp).toBe(true);
    expect(res.oldLevel).toBe(1);
    expect(res.newLevel).toBe(2);
    expect(res.coinsAwarded).toBe(150);
    expect(res.rolesToAdd).toEqual(['role-lv2']);
    expect(res.rolesToRemove).toEqual(['role-lv1']);

    // Voice XP when enabled
    const voiceRes = svc.awardVoiceXp('g1', 'u1', 1_060_000);
    expect(voiceRes.awarded).toBe(true);
    expect(voiceRes.xpGained).toBe(20); // 10 * 2.0 boost

    db.close();
  });

  it('renders custom level-up templates, avoids duplicate reward lines, and parses card colors', () => {
    const rendered = renderLevelUpTemplate(
      '{user} ({username}) 从 {oldLevel} 升到 Lv.{level}，奖 {coins} {currency}，身份组 {roles}，{stat} {statUnit} (+{statGained})',
      {
        user: '<@u1>',
        username: '小熊',
        level: 5,
        oldLevel: 4,
        coins: 200,
        currency: '星币',
        roles: '<@&r1>',
        stat: 30,
        statGained: 2,
        statUnit: '厘米',
      },
    );
    expect(rendered).toBe('<@u1> (小熊) 从 4 升到 Lv.5，奖 200 星币，身份组 <@&r1>，30 厘米 (+2)');

    // Guard against double-substitution if username contains a placeholder token
    const safeRendered = renderLevelUpTemplate('{username} -> Lv.{level}', {
      user: '<@u1>',
      username: '{level}',
      level: 9,
      oldLevel: 8,
      coins: 0,
      currency: '星币',
      roles: '无',
      stat: 10,
      statGained: 1,
      statUnit: '点',
    });
    expect(safeRendered).toBe('{level} -> Lv.9');

    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const cfg = configRepo.getOrCreate('g1');
    const fakeMember = {
      id: 'u1',
      displayName: '小熊',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    };
    const fakeRes = {
      awarded: true,
      xpGained: 50,
      totalXp: 300,
      heatStreak: 1,
      heatMultiplier: 1,
      boostMultiplier: 1,
      leveledUp: true,
      oldLevel: 1,
      newLevel: 2,
      coinsAwarded: 100,
      statGained: 2,
      statValue: 5,
      rolesToAdd: ['r2'],
      rolesToRemove: [],
    };

    // Default template auto-appends coins, stat, & roles
    const defaultEmbed = buildLevelUpEmbed(cfg, fakeMember, fakeRes).toJSON();
    expect(defaultEmbed.title).toBe('🎉 等级提升！');
    expect(defaultEmbed.description).toContain('恭喜 <@u1> 升到 **Lv.2**！');
    expect(defaultEmbed.description).toContain('获得升级奖励');
    expect(defaultEmbed.description).toContain('+2 点');
    expect(defaultEmbed.description).toContain('<@&r2>');

    // Custom template already mentioning {coins}, {stat}, and {roles} does not duplicate lines
    const customCfg = {
      ...cfg,
      leveling: {
        ...cfg.leveling,
        levelUpTitle: '🚀 晋升 Lv.{level}',
        levelUpTemplate: '牛逼 {user} 的吊变大了，当前为 **{stat}** 厘米（+{coins} {currency}，{roles}）',
      },
    };
    const customEmbed = buildLevelUpEmbed(customCfg, fakeMember, fakeRes).toJSON();
    expect(customEmbed.title).toBe('🚀 晋升 Lv.2');
    expect(customEmbed.description).toBe('牛逼 <@u1> 的吊变大了，当前为 **5** 厘米（+100 星币，<@&r2>）');

    // Card color parsing
    expect(parseCardColor('')).toEqual({ ok: true, normalized: null, colorInt: null });
    expect(parseCardColor('紫')).toEqual({ ok: true, normalized: '#9B59B6', colorInt: 0x9b59b6 });
    expect(parseCardColor('ff6b8b')).toEqual({ ok: true, normalized: '#FF6B8B', colorInt: 0xff6b8b });
    expect(parseCardColor('#12AB34')).toEqual({ ok: true, normalized: '#12AB34', colorInt: 0x12ab34 });
    expect(parseCardColor('invalid-color')).toEqual({ ok: false });

    db.close();
  });

  it('supports levelOffset for arbitrary high levels across rank cards, XP awards, and leaderboards', () => {
    expect(totalXpForLevel(30)).toBe(473900);
    expect(totalXpForLevel(50)).toBe(3432000);

    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const inviteRepo = new InviteRepo(db);
    const svc = new LevelingService(configRepo, profileRepo, inviteRepo);

    const pIce = profileRepo.getOrCreate('g1', 'u-ice');
    profileRepo.save({
      ...pIce,
      xp: totalXpForLevel(30),
      level: 30,
      levelOffset: 0,
    });

    const pStraw = profileRepo.getOrCreate('g1', 'u-straw');
    profileRepo.save({
      ...pStraw,
      xp: totalXpForLevel(50),
      level: 114514,
      levelOffset: 114464,
    });

    const strawCard = svc.getRankCardData('g1', 'u-straw');
    expect(strawCard.progress.level).toBe(114514);
    expect(strawCard.rank).toBe(1);

    const iceCard = svc.getRankCardData('g1', 'u-ice');
    expect(iceCard.progress.level).toBe(30);
    expect(iceCard.rank).toBe(2);

    const msgRes = svc.awardMessageXp('g1', 'u-straw', 'c1', 2_000_000, () => 0.5);
    expect(msgRes.awarded).toBe(true);
    expect(msgRes.newLevel).toBe(114514);
    expect(msgRes.leveledUp).toBe(false);
    expect(profileRepo.getOrCreate('g1', 'u-straw').level).toBe(114514);

    const lb = svc.getLeaderboard('g1', 'xp', 1, 10);
    expect(lb.items[0]?.userId).toBe('u-straw');
    expect(lb.items[0]?.secondaryValue).toBe(114514);
    expect(lb.items[1]?.userId).toBe('u-ice');
    expect(lb.items[1]?.secondaryValue).toBe(30);

    // Independent growth stat increments on level-up and ranks independently of level
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateLeveling('g1', {
      ...cfg.leveling,
      statEnabled: true,
      statName: '长度',
      statUnit: '厘米',
      statMinGain: 1,
      statMaxGain: 3,
    });
    profileRepo.setStatValue('g1', 'u-straw', 114514);
    profileRepo.setStatValue('g1', 'u-ice', 30);

    const pNew = profileRepo.getOrCreate('g1', 'u-new');
    profileRepo.save({ ...pNew, xp: 30, level: 0 });
    // rng = 0.5 -> xp = 20 -> total 50 >= 40 (level 0 -> 1); stat gain = 1 + floor(0.5 * 3) = 2
    const upRes = svc.awardMessageXp('g1', 'u-new', 'c1', 3_000_000, () => 0.5);
    expect(upRes.leveledUp).toBe(true);
    expect(upRes.statGained).toBe(2);
    expect(upRes.statValue).toBe(2);

    const statLb = svc.getLeaderboard('g1', 'stat', 1, 10);
    expect(statLb.items[0]?.userId).toBe('u-straw');
    expect(statLb.items[0]?.primaryValue).toBe(114514);
    expect(statLb.items[1]?.userId).toBe('u-ice');
    expect(statLb.items[1]?.primaryValue).toBe(30);
    expect(statLb.items[2]?.userId).toBe('u-new');
    expect(statLb.items[2]?.primaryValue).toBe(2);

    // allowedChannelIds whitelist restricts message XP to specified channels only
    configRepo.updateLeveling('g1', {
      ...configRepo.getOrCreate('g1').leveling,
      allowedChannelIds: ['c-game'],
    });
    const blockedRes = svc.awardMessageXp('g1', 'u-whitelist', 'c-other', 4_000_000, () => 0.5);
    expect(blockedRes.awarded).toBe(false);
    expect(blockedRes.reason).toBe('ignored_channel');
    const allowedRes = svc.awardMessageXp('g1', 'u-whitelist', 'c-game', 4_000_000, () => 0.5);
    expect(allowedRes.awarded).toBe(true);

    db.close();
  });

  it('scales heat multiplier up to configured max > 2.0 and removes higher-tier reward roles on XP downgrade', () => {
    expect(getHeatMultiplier(10, 3.0)).toBe(2.25);
    expect(getHeatMultiplier(12, 3.0)).toBe(2.5);
    expect(getHeatMultiplier(16, 3.0)).toBe(3.0);
    expect(getHeatMultiplier(32, 5.0)).toBe(5.0);
    expect(getHeatMultiplier(40, 5.0)).toBe(5.0);

    const db = createDatabase(':memory:');
    const configRepo = new GuildConfigRepo(db);
    const profileRepo = new ProfileRepo(db);
    const inviteRepo = new InviteRepo(db);
    const svc = new LevelingService(configRepo, profileRepo, inviteRepo);

    profileRepo.setLevelReward('g1', 1, 'role-lv1');
    profileRepo.setLevelReward('g1', 5, 'role-lv5');
    profileRepo.setLevelReward('g1', 10, 'role-lv10');

    // stackRoles = true: downgrade Lv.10 -> Lv.2 removes Lv.5 and Lv.10 roles
    const cfg = configRepo.getOrCreate('g1');
    configRepo.updateLeveling('g1', { ...cfg.leveling, stackRoles: true });
    svc.setUserXp('g1', 'u1', totalXpForLevel(10));
    const downStack = svc.setUserXp('g1', 'u1', totalXpForLevel(2));
    expect(downStack.oldLevel).toBe(10);
    expect(downStack.newLevel).toBe(2);
    expect(downStack.rolesToAdd).toEqual([]);
    expect(downStack.rolesToRemove).toEqual(['role-lv5', 'role-lv10']);

    // Downgrade to Lv.0 removes remaining Lv.1 role
    const downZero = svc.setUserXp('g1', 'u1', 0);
    expect(downZero.rolesToAdd).toEqual([]);
    expect(downZero.rolesToRemove).toEqual(['role-lv1']);

    // stackRoles = false: downgrade Lv.10 -> Lv.5 re-grants Lv.5 and removes Lv.1 & Lv.10
    configRepo.updateLeveling('g1', { ...cfg.leveling, stackRoles: false });
    svc.setUserXp('g1', 'u2', totalXpForLevel(10));
    const downReplace = svc.setUserXp('g1', 'u2', totalXpForLevel(5));
    expect(downReplace.rolesToAdd).toEqual(['role-lv5']);
    expect(downReplace.rolesToRemove).toEqual(['role-lv1', 'role-lv10']);

    db.close();
  });
});
