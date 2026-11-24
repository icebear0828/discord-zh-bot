import { ComponentType, type APIEmbed, type APIActionRowComponent, type APIMessageActionRowComponent } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { FunRepo } from '../../src/db/repositories/funRepo.js';
import { GiveawayRepo } from '../../src/db/repositories/giveawayRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo } from '../../src/db/repositories/redPacketRepo.js';
import { RolePanelRepo } from '../../src/db/repositories/rolePanelRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { TicketRepo } from '../../src/db/repositories/ticketRepo.js';
import { WorldEventRepo } from '../../src/db/repositories/worldEventRepo.js';
import { BlackjackManager, type Card } from '../../src/services/blackjackService.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { EconomyService } from '../../src/services/economyService.js';
import { FunService } from '../../src/services/funService.js';
import { GiveawayService } from '../../src/services/giveawayService.js';
import { InviteService } from '../../src/services/inviteService.js';
import { LevelingService } from '../../src/services/levelingService.js';
import { MultiplayerService } from '../../src/services/multiplayerService.js';
import { RolePanelService } from '../../src/services/rolePanelService.js';
import { ShopService } from '../../src/services/shopService.js';
import { SocialPetService } from '../../src/services/socialPetService.js';
import { TicketService } from '../../src/services/ticketService.js';
import { WorldEventService } from '../../src/services/worldEventService.js';
import { buildNumberBombCard, buildRouletteCard } from '../../src/ui/chaosMenuBuilder.js';
import type { AppContext } from '../../src/ui/embeds.js';
import {
  buildDuelMessage,
  buildLobbyMessage,
  buildMenuMessage,
  buildPublicRankEmbed,
  buildRedPacketMessage,
  type MenuActor,
  type MenuView,
} from '../../src/ui/menuBuilder.js';
import { buildPetBattleCard, buildProposalCard } from '../../src/ui/socialPetMenuBuilder.js';
import {
  buildPredictionCard,
  buildWorldBossCard,
  buildWorldChestCard,
} from '../../src/ui/worldEventMenuBuilder.js';

function createTestCtx(): AppContext {
  const db = createDatabase(':memory:');
  const guildConfig = new GuildConfigRepo(db);
  const profile = new ProfileRepo(db);
  const shop = new ShopRepo(db);
  const fun = new FunRepo(db);
  const ticket = new TicketRepo(db);
  const giveaway = new GiveawayRepo(db);
  const invite = new InviteRepo(db);
  const rolePanel = new RolePanelRepo(db);
  const redPacket = new RedPacketRepo(db);
  const chaos = new ChaosRepo(db);
  const worldEvent = new WorldEventRepo(db);
  const socialPet = new SocialPetRepo(db);

  return {
    db,
    timezone: 'Asia/Shanghai',
    repos: {
      guildConfig,
      profile,
      shop,
      fun,
      ticket,
      giveaway,
      invite,
      rolePanel,
      redPacket,
      chaos,
      worldEvent,
      socialPet,
    },
    services: {
      leveling: new LevelingService(guildConfig, profile, invite),
      economy: new EconomyService(db, guildConfig, profile, 'Asia/Shanghai', chaos),
      blackjack: new BlackjackManager(db, profile),
      shop: new ShopService(db, profile, shop),
      fun: new FunService(db, profile, shop, fun, 'Asia/Shanghai'),
      ticket: new TicketService(guildConfig, ticket),
      giveaway: new GiveawayService(giveaway),
      invite: new InviteService(invite),
      rolePanel: new RolePanelService(rolePanel),
      multiplayer: new MultiplayerService(db, profile, redPacket, chaos),
      chaos: new ChaosService(db, guildConfig, profile, chaos),
      worldEvent: new WorldEventService(db, guildConfig, profile, worldEvent, socialPet),
      socialPet: new SocialPetService(db, guildConfig, profile, shop, socialPet, 'Asia/Shanghai'),
    },
  };
}

function assertDiscordMessageLimits(
  msg: {
    embeds: ReadonlyArray<{ toJSON(): APIEmbed }>;
    components: ReadonlyArray<{ toJSON(): APIActionRowComponent<APIMessageActionRowComponent> }>;
  },
  label: string,
): void {
  expect(msg.embeds.length, `${label}: embeds count`).toBeGreaterThanOrEqual(1);
  expect(msg.embeds.length, `${label}: embeds max`).toBeLessThanOrEqual(10);
  for (const embedBuilder of msg.embeds) {
    const embed = embedBuilder.toJSON();
    if (embed.title) {
      expect(embed.title.length, `${label}: embed title`).toBeLessThanOrEqual(256);
    }
    if (embed.description) {
      expect(embed.description.length, `${label}: embed description`).toBeLessThanOrEqual(4096);
    }
  }

  expect(msg.components.length, `${label}: action rows`).toBeLessThanOrEqual(5);

  const seenCustomIds = new Set<string>();
  for (const rowBuilder of msg.components) {
    const row = rowBuilder.toJSON();
    expect(row.components.length, `${label}: row child count`).toBeGreaterThanOrEqual(1);
    expect(row.components.length, `${label}: row child max`).toBeLessThanOrEqual(5);

    for (const comp of row.components) {
      if ('custom_id' in comp && comp.custom_id !== undefined) {
        expect(comp.custom_id.length, `${label}: custom_id length`).toBeGreaterThanOrEqual(1);
        expect(comp.custom_id.length, `${label}: custom_id max length (${comp.custom_id})`).toBeLessThanOrEqual(100);
        expect(
          seenCustomIds.has(comp.custom_id),
          `${label}: duplicate custom_id ${comp.custom_id}`,
        ).toBe(false);
        seenCustomIds.add(comp.custom_id);
      }

      if (comp.type === ComponentType.Button) {
        if (comp.label !== undefined) {
          expect(comp.label.length, `${label}: button label`).toBeGreaterThanOrEqual(1);
          expect(comp.label.length, `${label}: button label max`).toBeLessThanOrEqual(80);
        }
      } else if (comp.type === ComponentType.StringSelect) {
        expect(row.components.length, `${label}: select must be alone in row`).toBe(1);
        expect(comp.options.length, `${label}: select options min`).toBeGreaterThanOrEqual(1);
        expect(comp.options.length, `${label}: select options max`).toBeLessThanOrEqual(25);
        for (const opt of comp.options) {
          expect(opt.label.length, `${label}: option label min`).toBeGreaterThanOrEqual(1);
          expect(opt.label.length, `${label}: option label max`).toBeLessThanOrEqual(100);
          expect(opt.value.length, `${label}: option value min`).toBeGreaterThanOrEqual(1);
          expect(opt.value.length, `${label}: option value max`).toBeLessThanOrEqual(100);
          if (opt.description !== undefined) {
            expect(opt.description.length, `${label}: option desc min`).toBeGreaterThanOrEqual(1);
            expect(opt.description.length, `${label}: option desc max`).toBeLessThanOrEqual(100);
          }
        }
      } else if (comp.type === ComponentType.UserSelect || comp.type === ComponentType.RoleSelect) {
        expect(row.components.length, `${label}: entity select must be alone in row`).toBe(1);
      }
    }
  }
}

const ACTOR: MenuActor = {
  id: 'u1',
  displayName: '测试玩家',
  avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
};

describe('menuBuilder Discord component constraints & schema integration', () => {
  it('initializes red_packets tables inside createDatabase()', () => {
    const ctx = createTestCtx();
    const tables = ctx.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('red_packets');
    expect(names).toContain('red_packet_claims');
    ctx.db.close();
  });

  it('validates all menu views with and without feedback under Discord limits', () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 2000);
    ctx.repos.profile.addCoins('g1', 'u2', 1500);
    ctx.services.economy.deposit('g1', 'u1', 500);
    ctx.services.fun.grantTitle('g1', 'u1', '黄金矿工');
    ctx.services.fun.equipTitle('g1', 'u1', '黄金矿工');

    // Add > 25 shop items and inventory items with extra-long text to test truncation & capping
    const longText = '超长商品描述'.repeat(30);
    for (let i = 1; i <= 30; i++) {
      ctx.services.shop.createBoostItem({
        guildId: 'g1',
        name: `双倍经验卡_${i}_${longText}`,
        description: `说明_${longText}`,
        price: 100 + i,
        boostMultiplier: 2.0,
        boostDurationSec: 3600,
        stock: 10,
      });
    }
    for (let i = 1; i <= 30; i++) {
      ctx.services.shop.createTitleItem({
        guildId: 'g1',
        name: `称号商品_${i}`,
        description: longText,
        price: 10,
        titleText: `超长测试称号_${i}_${'星'.repeat(40)}`,
        stock: null,
      });
    }

    // Put some items into inventory & seed new feature entities to test non-empty selects!
    ctx.repos.profile.addCoins('g1', 'u1', 50_000);
    ctx.repos.profile.addCoins('g1', 'u2', 50_000);
    for (let itemId = 1; itemId <= 28; itemId++) {
      ctx.services.shop.buyItem('g1', 'u1', itemId);
    }

    const predRes = ctx.services.worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'u1',
      title: '测试吃瓜盘口：今天会不会下雨？',
      options: ['会下暴雨', '绝对晴天', '看心情'],
      closeMinutes: 60,
    });
    const predId = predRes.ok ? predRes.summary.prediction.id : 1;

    const rouletteRes = ctx.services.chaos.createRoulette({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u1',
      entryFee: 100,
    });
    expect(rouletteRes.ok).toBe(true);
    const bombRes = ctx.services.chaos.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u1',
      penalty: 100,
    });
    expect(bombRes.ok).toBe(true);
    const chestEvent = ctx.services.worldEvent.spawnChest('g1', 'c1');
    expect(chestEvent.id).toBeGreaterThan(0);
    const propRes = ctx.services.socialPet.createProposal({
      guildId: 'g1',
      channelId: 'c1',
      proposerId: 'u1',
      targetId: 'u2',
      relType: 'marriage',
    });
    if (propRes.ok) {
      ctx.services.socialPet.acceptProposal(propRes.proposal.id, 'u2');
    }
    ctx.services.socialPet.pullPetGacha('g1', 'u1');

    ctx.repos.profile.setLevelReward('g1', 5, 'role-lv5');
    ctx.repos.profile.setLevelReward('g1', 10, 'role-lv10');

    const rp1 = ctx.services.rolePanel.createPanel({
      guildId: 'g1',
      title: '身份标签面板1',
      description: '选你喜欢的身份标签',
      displayMode: 'button',
      selectionMode: 'multi',
    });
    ctx.services.rolePanel.addOption('g1', rp1.id, {
      roleId: 'role-a',
      label: '夜猫子',
      emoji: '🌙',
      description: '凌晨在线',
    });
    const rp2 = ctx.services.rolePanel.createPanel({
      guildId: 'g1',
      title: '游戏分组面板2',
      description: '单选互斥测试',
      displayMode: 'select',
      selectionMode: 'single',
    });
    ctx.services.rolePanel.addOption('g1', rp2.id, {
      roleId: 'role-b',
      label: '瓦罗兰特',
      emoji: '🎯',
      description: null,
    });

    const views: MenuView[] = [
      { page: 'home' },
      { page: 'solo' },
      { page: 'slots' },
      { page: 'dice', choice: 'big' },
      { page: 'dice', choice: 'small' },
      { page: 'dice', choice: 'triple' },
      { page: 'bj' },
      { page: 'bank' },
      { page: 'multi' },
      { page: 'rob' },
      { page: 'pay' },
      { page: 'duel' },
      { page: 'social', action: 'pat' },
      { page: 'social', action: 'snowball' },
      { page: 'props' },
      { page: 'bounty' },
      { page: 'roulette' },
      { page: 'bomb' },
      { page: 'events' },
      { page: 'predictions' },
      { page: 'pred_detail', predictionId: predId },
      { page: 'world_status' },
      { page: 'social_hub' },
      { page: 'cp' },
      { page: 'cp_lb', lbPage: 1 },
      { page: 'pets' },
      { page: 'pet_arena' },
      { page: 'shop' },
      { page: 'bag' },
      { page: 'rank' },
      { page: 'self_roles' },
      { page: 'self_roles', panelId: rp2.id },
      { page: 'leaderboard', lbType: 'xp', lbPage: 1 },
      { page: 'leaderboard', lbType: 'coins', lbPage: 1 },
      { page: 'leaderboard', lbType: 'invites', lbPage: 1 },
      { page: 'admin' },
      { page: 'admin_econ' },
      { page: 'admin_lvl' },
      { page: 'admin_lvl_rewards' },
      { page: 'admin_roles' },
      { page: 'admin_roles', panelId: rp2.id },
      { page: 'admin_games' },
      { page: 'admin_mod' },
      { page: 'admin_ops' },
    ];

    for (const view of views) {
      const msg = buildMenuMessage(ctx, 'g1', ACTOR, view);
      assertDiscordMessageLimits(msg, `view:${view.page}`);

      const msgWithFeedback = buildMenuMessage(ctx, 'g1', ACTOR, view, {
        type: 'success',
        text: '测试状态提示框渲染',
      });
      assertDiscordMessageLimits(msgWithFeedback, `view:${view.page}:feedback`);
      expect(msgWithFeedback.embeds[0]!.toJSON().description).toContain('测试状态提示框渲染');
    }

    // Home admin button visibility check
    const regularHome = buildMenuMessage(ctx, 'g1', { ...ACTOR, isAdmin: false }, { page: 'home' });
    const regularRow2Ids = regularHome.components[1]!.toJSON().components.map((c) =>
      'custom_id' in c ? c.custom_id : '',
    );
    expect(regularRow2Ids).not.toContain('menu:nav:admin');

    const adminHome = buildMenuMessage(ctx, 'g1', { ...ACTOR, isAdmin: true }, { page: 'home' });
    assertDiscordMessageLimits(adminHome, 'view:home:admin');
    const adminRow2Ids = adminHome.components[1]!.toJSON().components.map((c) =>
      'custom_id' in c ? c.custom_id : '',
    );
    expect(adminRow2Ids).toContain('menu:nav:admin');

    // Visibility cues & share buttons
    const homeJson = buildMenuMessage(ctx, 'g1', ACTOR, { page: 'home' }).embeds[0]!.toJSON();
    expect(homeJson.description).toContain('仅自己可见');
    expect(homeJson.description).toContain('全群公开');

    const bankJson = buildMenuMessage(ctx, 'g1', ACTOR, { page: 'bank' }).embeds[0]!.toJSON();
    expect(bankJson.footer?.text).toContain('私密');

    const multiJson = buildMenuMessage(ctx, 'g1', ACTOR, { page: 'multi' }).embeds[0]!.toJSON();
    expect(multiJson.description).toContain('公开');

    const rankMsg = buildMenuMessage(ctx, 'g1', ACTOR, { page: 'rank' });
    const rankShareIds = rankMsg.components[1]!.toJSON().components.map((c) =>
      'custom_id' in c ? c.custom_id : '',
    );
    expect(rankShareIds).toContain('menu:share:rank');
    expect(rankShareIds).toContain('menu:modal:edit_card');

    // Empty role panels edge case + custom ID card fields rendering
    ctx.services.rolePanel.deletePanel('g1', rp1.id);
    ctx.services.rolePanel.deletePanel('g1', rp2.id);
    assertDiscordMessageLimits(
      buildMenuMessage(ctx, 'g1', { ...ACTOR, isAdmin: true }, { page: 'admin_roles' }),
      'view:admin_roles:empty',
    );
    assertDiscordMessageLimits(
      buildMenuMessage(ctx, 'g1', { ...ACTOR, isAdmin: true }, { page: 'self_roles' }),
      'view:self_roles:empty',
    );

    ctx.repos.profile.updateCard('g1', 'u1', {
      cardNickname: '黑吊国王',
      cardTag: '深夜代码仙人',
      cardBio: '写代码不如睡觉',
      cardColor: '#9B59B6',
    });
    const publicCardJson = buildPublicRankEmbed(ctx, 'g1', ACTOR).toJSON();
    expect(publicCardJson.author?.name).toContain('黑吊国王');
    expect(publicCardJson.description).toContain('深夜代码仙人');
    expect(publicCardJson.description).toContain('写代码不如睡觉');
    expect(publicCardJson.color).toBe(0x9b59b6);

    const lbMsg = buildMenuMessage(ctx, 'g1', ACTOR, {
      page: 'leaderboard',
      lbType: 'coins',
      lbPage: 1,
    });
    const lbPagerIds = lbMsg.components[1]!.toJSON().components.map((c) =>
      'custom_id' in c ? c.custom_id : '',
    );
    expect(lbPagerIds).toContain('menu:share:lb:coins:1');

    // Active Blackjack (playing)
    const riggedDeck = (): Card[] => [
      { rank: '2', suit: '♠' },
      { rank: '3', suit: '♥' },
      { rank: '9', suit: '♦' }, // d2
      { rank: '6', suit: '♣' }, // p2
      { rank: '7', suit: '♠' }, // d1
      { rank: '5', suit: '♥' }, // p1
    ];
    ctx.services.blackjack.startGame('g1', 'u1', 100, riggedDeck);
    const activeBjMsg = buildMenuMessage(ctx, 'g1', ACTOR, { page: 'bj' });
    assertDiscordMessageLimits(activeBjMsg, 'view:bj:active');
    const row1Ids = activeBjMsg.components[0]!.toJSON().components.map((c) =>
      'custom_id' in c ? c.custom_id : '',
    );
    expect(row1Ids).toEqual(['menu:bj:hit', 'menu:bj:stand', 'menu:bj:double']);

    ctx.db.close();
  });

  it('validates lobby, duel, and red packet public cards under Discord limits', () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 5000);
    ctx.repos.profile.addCoins('g1', 'u2', 5000);
    const cfg = ctx.repos.guildConfig.getOrCreate('g1').economy;

    const lobby = buildLobbyMessage('星光社区');
    assertDiscordMessageLimits(lobby, 'lobby');
    expect(lobby.components[0]!.toJSON().components[0]).toMatchObject({
      custom_id: 'menu:open',
    });

    const duelRes = ctx.services.multiplayer.createDuel('g1', 'c1', 'u1', 'u2', 200);
    expect(duelRes.ok).toBe(true);
    if (duelRes.ok) {
      assertDiscordMessageLimits(buildDuelMessage(duelRes.duel, cfg), 'duel:pending');
      const acceptRes = ctx.services.multiplayer.acceptDuel(duelRes.duel.id, 'u2');
      expect(acceptRes.ok).toBe(true);
      if (acceptRes.ok) {
        const settled = buildDuelMessage(acceptRes.duel, cfg, acceptRes);
        assertDiscordMessageLimits(settled, 'duel:completed');
        expect(settled.components).toHaveLength(0);
      }
    }

    const rpRes = ctx.services.multiplayer.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'u1',
      totalAmount: 300,
      totalCount: 2,
      greeting: '新年快乐！',
    });
    expect(rpRes.ok).toBe(true);
    if (rpRes.ok) {
      const openCard = buildRedPacketMessage(rpRes.packet, [], null, cfg);
      assertDiscordMessageLimits(openCard, 'redpacket:open');
      expect(openCard.components[0]!.toJSON().components[0]).toMatchObject({
        custom_id: `mp:rp:claim:${rpRes.packet.id}`,
      });

      const c1 = ctx.services.multiplayer.claimRedPacket(rpRes.packet.id, 'u2');
      expect(c1.ok).toBe(true);
      const c2 = ctx.services.multiplayer.claimRedPacket(rpRes.packet.id, 'u3');
      expect(c2.ok).toBe(true);
      if (c2.ok) {
        const finishedCard = buildRedPacketMessage(c2.packet, c2.claims, c2.bestLuckUserId, cfg);
        assertDiscordMessageLimits(finishedCard, 'redpacket:finished');
        expect(finishedCard.components).toHaveLength(0);
      }
    }

    // Validate all 7 new public card builders under Discord API limits
    const rlRes = ctx.services.chaos.createRoulette({ guildId: 'g1', channelId: 'c1', hostId: 'u1', entryFee: 100 });
    if (rlRes.ok) {
      assertDiscordMessageLimits(buildRouletteCard(rlRes.game, cfg), 'roulette:recruiting');
    }

    const nbRes = ctx.services.chaos.createNumberBomb({ guildId: 'g1', channelId: 'c1', hostId: 'u1', penalty: 100 });
    if (nbRes.ok) {
      assertDiscordMessageLimits(buildNumberBombCard(nbRes.game, cfg), 'bomb:open');
    }

    const predRes = ctx.services.worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'u1',
      title: '测试公开盘口卡片限制',
      options: ['选A', '选B', '选C', '选D'],
      closeMinutes: 30,
    });
    if (predRes.ok) {
      assertDiscordMessageLimits(buildPredictionCard(predRes.summary, cfg), 'prediction:open');
    }

    const chest = ctx.services.worldEvent.spawnChest('g1', 'c1');
    assertDiscordMessageLimits(buildWorldChestCard(chest, [], cfg), 'world:chest');

    const boss = ctx.services.worldEvent.spawnBoss('g1', 'c1');
    assertDiscordMessageLimits(buildWorldBossCard(boss, [], cfg), 'world:boss');

    const propRes = ctx.services.socialPet.createProposal({
      guildId: 'g1',
      channelId: 'c1',
      proposerId: 'u1',
      targetId: 'u2',
      relType: 'marriage',
    });
    if (propRes.ok) {
      assertDiscordMessageLimits(buildProposalCard(propRes.proposal, cfg), 'cp:proposal');
    }

    const petRes = ctx.services.socialPet.pullPetGacha('g1', 'u1');
    if (petRes.ok) {
      const battleRes = ctx.services.socialPet.createPetBattle({
        guildId: 'g1',
        channelId: 'c1',
        challengerId: 'u1',
        opponentId: null,
        bet: 100,
      });
      if (battleRes.ok) {
        assertDiscordMessageLimits(
          buildPetBattleCard(battleRes.battle, battleRes.challengerPet, null, cfg),
          'pet:battle',
        );
      }
    }

    ctx.db.close();
  });
});
