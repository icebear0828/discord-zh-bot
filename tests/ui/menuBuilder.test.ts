import { ComponentType, type APIEmbed, type APIActionRowComponent, type APIMessageActionRowComponent } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { FunRepo } from '../../src/db/repositories/funRepo.js';
import { GiveawayRepo } from '../../src/db/repositories/giveawayRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo } from '../../src/db/repositories/redPacketRepo.js';
import { RolePanelRepo } from '../../src/db/repositories/rolePanelRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { TicketRepo } from '../../src/db/repositories/ticketRepo.js';
import { BlackjackManager, type Card } from '../../src/services/blackjackService.js';
import { EconomyService } from '../../src/services/economyService.js';
import { FunService } from '../../src/services/funService.js';
import { GiveawayService } from '../../src/services/giveawayService.js';
import { InviteService } from '../../src/services/inviteService.js';
import { LevelingService } from '../../src/services/levelingService.js';
import { MultiplayerService } from '../../src/services/multiplayerService.js';
import { RolePanelService } from '../../src/services/rolePanelService.js';
import { ShopService } from '../../src/services/shopService.js';
import { TicketService } from '../../src/services/ticketService.js';
import type { AppContext } from '../../src/ui/embeds.js';
import {
  buildDuelMessage,
  buildLobbyMessage,
  buildMenuMessage,
  buildRedPacketMessage,
  type MenuActor,
  type MenuView,
} from '../../src/ui/menuBuilder.js';

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
    },
    services: {
      leveling: new LevelingService(guildConfig, profile, invite),
      economy: new EconomyService(db, guildConfig, profile, 'Asia/Shanghai'),
      blackjack: new BlackjackManager(db, profile),
      shop: new ShopService(db, profile, shop),
      fun: new FunService(db, profile, shop, fun, 'Asia/Shanghai'),
      ticket: new TicketService(guildConfig, ticket),
      giveaway: new GiveawayService(giveaway),
      invite: new InviteService(invite),
      rolePanel: new RolePanelService(rolePanel),
      multiplayer: new MultiplayerService(db, profile, redPacket),
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
      } else if (comp.type === ComponentType.UserSelect) {
        expect(row.components.length, `${label}: user select must be alone in row`).toBe(1);
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

    // Put some items into inventory
    ctx.repos.profile.addCoins('g1', 'u1', 50_000);
    for (let itemId = 1; itemId <= 28; itemId++) {
      ctx.services.shop.buyItem('g1', 'u1', itemId);
    }

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
      { page: 'shop' },
      { page: 'bag' },
      { page: 'rank' },
      { page: 'leaderboard', lbType: 'xp', lbPage: 1 },
      { page: 'leaderboard', lbType: 'coins', lbPage: 1 },
      { page: 'leaderboard', lbType: 'invites', lbPage: 1 },
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

    ctx.db.close();
  });
});
