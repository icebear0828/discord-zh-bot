import {
  MessageFlags,
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIEmbed,
  type APIMessageActionRowComponent,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { balanceCommand } from '../../src/commands/economy/balance.js';
import { blackjackCommand } from '../../src/commands/economy/blackjack.js';
import { dailyCommand } from '../../src/commands/economy/daily.js';
import { diceCommand } from '../../src/commands/economy/dice.js';
import { inventoryCommand } from '../../src/commands/economy/inventory.js';
import { payCommand } from '../../src/commands/economy/pay.js';
import { robCommand } from '../../src/commands/economy/rob.js';
import { shopCommand } from '../../src/commands/economy/shop.js';
import { slotsCommand } from '../../src/commands/economy/slots.js';
import { workCommand } from '../../src/commands/economy/work.js';
import { fortuneCommand } from '../../src/commands/fun/fortune.js';
import { interactCommand } from '../../src/commands/fun/interact.js';
import { titleCommand } from '../../src/commands/fun/title.js';
import { helpCommand } from '../../src/commands/general/help.js';
import { invitesCommand } from '../../src/commands/invites/invites.js';
import { leaderboardCommand } from '../../src/commands/leveling/leaderboard.js';
import { levelAdminCommand } from '../../src/commands/leveling/levelAdmin.js';
import { rankCommand } from '../../src/commands/leveling/rank.js';
import { BLACKJACK_TTL_MS, SHOP_MYSTERY_BOX_MIN_PRICE } from '../../src/config/economyConstants.js';
import { createDatabase } from '../../src/db/database.js';
import { AiMemoryRepo } from '../../src/db/repositories/aiMemoryRepo.js';
import { BlackjackRepo } from '../../src/db/repositories/blackjackRepo.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { CreditLoanRepo } from '../../src/db/repositories/creditLoanRepo.js';
import { FunRepo } from '../../src/db/repositories/funRepo.js';
import { GiveawayRepo } from '../../src/db/repositories/giveawayRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo } from '../../src/db/repositories/redPacketRepo.js';
import { RolePanelRepo } from '../../src/db/repositories/rolePanelRepo.js';
import { RpgRepo } from '../../src/db/repositories/rpgRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { TicketRepo } from '../../src/db/repositories/ticketRepo.js';
import { WorldEventRepo } from '../../src/db/repositories/worldEventRepo.js';
import { handleBlackjackButton } from '../../src/interactions/blackjackHandler.js';
import { handleHelpSelect } from '../../src/interactions/helpHandler.js';
import { handleLeaderboardButton } from '../../src/interactions/leaderboardHandler.js';
import { AiService } from '../../src/services/aiService.js';
import { BlackjackManager, type Card } from '../../src/services/blackjackService.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { CreditLoanService } from '../../src/services/creditLoanService.js';
import { EconomyService } from '../../src/services/economyService.js';
import { FunService } from '../../src/services/funService.js';
import { GiveawayService } from '../../src/services/giveawayService.js';
import { InviteService } from '../../src/services/inviteService.js';
import { LevelingService, totalXpForLevel } from '../../src/services/levelingService.js';
import { LlmClient } from '../../src/services/llmClient.js';
import { MultiplayerService } from '../../src/services/multiplayerService.js';
import { RolePanelService } from '../../src/services/rolePanelService.js';
import { RpgService } from '../../src/services/rpgService.js';
import { ShopService } from '../../src/services/shopService.js';
import { SocialPetService } from '../../src/services/socialPetService.js';
import { TicketService } from '../../src/services/ticketService.js';
import { WorldEventService } from '../../src/services/worldEventService.js';
import { COLORS, type AppContext } from '../../src/ui/embeds.js';

interface MockPayload {
  content?: string;
  embeds?: ReadonlyArray<{ toJSON(): APIEmbed }>;
  components?: ReadonlyArray<{
    toJSON(): APIActionRowComponent<APIMessageActionRowComponent>;
  }>;
  flags?: number;
  allowedMentions?: { parse?: string[]; users?: string[] };
}

interface MockUser {
  id: string;
  displayName: string;
  bot: boolean;
  displayAvatarURL(): string;
}

function makeUser(id: string, displayName = `User_${id}`, bot = false): MockUser {
  return {
    id,
    displayName,
    bot,
    displayAvatarURL: () => `https://cdn.example.com/${id}.png`,
  };
}

function createCtx(timezone = 'Asia/Shanghai'): AppContext {
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
  const aiMemory = new AiMemoryRepo(db);
  const blackjackRepo = new BlackjackRepo(db);
  const creditLoanRepo = new CreditLoanRepo(db);
  const rpgRepo = new RpgRepo(db);
  const llmClient = new LlmClient(undefined);
  const creditLoan = new CreditLoanService(db, guildConfig, profile, creditLoanRepo, timezone, chaos);
  const rpg = new RpgService(db, rpgRepo, profile, {
    timezone,
    guildConfigRepo: guildConfig,
    socialPetRepo: socialPet,
  });

  return {
    db,
    timezone,
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
      aiMemory,
      creditLoan: creditLoanRepo,
      rpg: rpgRepo,
      blackjack: blackjackRepo,
    },
    services: {
      leveling: new LevelingService(guildConfig, profile, invite, creditLoan, rpg),
      economy: new EconomyService(db, guildConfig, profile, timezone, chaos),
      blackjack: new BlackjackManager(db, profile, blackjackRepo),
      shop: new ShopService(db, profile, shop, {
        guildConfigRepo: guildConfig,
        chaosRepo: chaos,
        socialPetRepo: socialPet,
        timezone,
      }),
      fun: new FunService(db, profile, shop, fun, timezone),
      ticket: new TicketService(guildConfig, ticket, db),
      giveaway: new GiveawayService(giveaway),
      invite: new InviteService(invite),
      rolePanel: new RolePanelService(rolePanel),
      multiplayer: new MultiplayerService(db, profile, redPacket, chaos),
      chaos: new ChaosService(db, guildConfig, profile, chaos),
      worldEvent: new WorldEventService(db, guildConfig, profile, worldEvent, socialPet),
      socialPet: new SocialPetService(db, guildConfig, profile, shop, socialPet, timezone),
      ai: new AiService(guildConfig, aiMemory, llmClient),
      creditLoan,
      rpg,
    },
  };
}

interface CommandMockOpts {
  guildId?: string;
  user?: MockUser;
  isAdmin?: boolean;
  memberRoles?: string[];
  subcommand?: string;
  integers?: Record<string, number | null>;
  strings?: Record<string, string | null>;
  booleans?: Record<string, boolean | null>;
  numbers?: Record<string, number | null>;
  users?: Record<string, MockUser | null>;
  channels?: Record<string, { id: string } | null>;
  roles?: Record<string, { id: string } | null>;
  channelSendShouldThrow?: boolean;
  fetchedMembers?: Record<
    string,
    {
      id: string;
      roles: {
        add: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
        cache: Map<string, { id: string }>;
      };
    }
  >;
}

function createCommandMock(opts: CommandMockOpts = {}) {
  const user = opts.user ?? makeUser('u1', '小明');
  const replies: MockPayload[] = [];
  const channelSends: MockPayload[] = [];
  const memberRoleCache = new Map<string, { id: string }>(
    (opts.memberRoles ?? []).map((id) => [id, { id }]),
  );
  const memberRoleAdd = vi.fn(async (id: string) => {
    memberRoleCache.set(id, { id });
  });
  const memberRoleRemove = vi.fn(async (id: string) => {
    memberRoleCache.delete(id);
  });

  const channel = {
    isSendable: () => true,
    send: vi.fn(async (payload: MockPayload) => {
      if (opts.channelSendShouldThrow) {
        throw new Error('Missing Permissions');
      }
      channelSends.push(payload);
      return { id: `pub-${channelSends.length}` };
    }),
  };

  const interaction = {
    guildId: opts.guildId ?? 'g1',
    channelId: 'c1',
    user,
    inCachedGuild: () => true,
    member: {
      id: user.id,
      permissions: {
        has: (bit: bigint) =>
          Boolean(opts.isAdmin) &&
          (bit === PermissionFlagsBits.Administrator || bit === PermissionFlagsBits.ManageGuild),
      },
      roles: {
        cache: memberRoleCache,
        add: memberRoleAdd,
        remove: memberRoleRemove,
      },
    },
    guild: {
      members: {
        fetch: vi.fn(async (id: string) => opts.fetchedMembers?.[id] ?? null),
      },
    },
    channel,
    options: {
      getSubcommand: () => opts.subcommand ?? '',
      getInteger: (name: string) => opts.integers?.[name] ?? null,
      getString: (name: string) => opts.strings?.[name] ?? null,
      getBoolean: (name: string) => opts.booleans?.[name] ?? null,
      getNumber: (name: string) => opts.numbers?.[name] ?? null,
      getUser: (name: string) => opts.users?.[name] ?? null,
      getChannel: (name: string) => opts.channels?.[name] ?? null,
      getRole: (name: string) => opts.roles?.[name] ?? null,
    },
    reply: vi.fn(async (payload: MockPayload) => {
      replies.push(payload);
    }),
  } as unknown as ChatInputCommandInteraction;

  return { interaction, replies, channelSends, memberRoleAdd, memberRoleRemove };
}

function createButtonMock(opts: {
  customId: string;
  guildId?: string;
  user?: MockUser;
  channelSendShouldThrow?: boolean;
}) {
  const user = opts.user ?? makeUser('u1', '小明');
  const replies: MockPayload[] = [];
  const updates: MockPayload[] = [];
  const channelSends: MockPayload[] = [];

  const interaction = {
    guildId: opts.guildId ?? 'g1',
    channelId: 'c1',
    customId: opts.customId,
    user,
    channel: {
      isSendable: () => true,
      send: vi.fn(async (payload: MockPayload) => {
        if (opts.channelSendShouldThrow) {
          throw new Error('Missing Permissions');
        }
        channelSends.push(payload);
        return { id: `pub-${channelSends.length}` };
      }),
    },
    reply: vi.fn(async (payload: MockPayload) => {
      replies.push(payload);
    }),
    update: vi.fn(async (payload: MockPayload) => {
      updates.push(payload);
    }),
  } as unknown as ButtonInteraction;

  return { interaction, replies, updates, channelSends };
}

function createSelectMock(opts: { customId: string; values: string[]; user?: MockUser }) {
  const user = opts.user ?? makeUser('u1', '小明');
  const replies: MockPayload[] = [];
  const updates: MockPayload[] = [];

  const interaction = {
    guildId: 'g1',
    channelId: 'c1',
    customId: opts.customId,
    values: opts.values,
    user,
    reply: vi.fn(async (payload: MockPayload) => {
      replies.push(payload);
    }),
    update: vi.fn(async (payload: MockPayload) => {
      updates.push(payload);
    }),
  } as unknown as StringSelectMenuInteraction;

  return { interaction, replies, updates };
}

describe('solo commands & handlers visibility, persistence, and governance', () => {
  it('runs /二十一点 privately, resumes active game, blocks non-owner, and posts public battle report on completion', async () => {
    const ctx = createCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 1000);

    // Pre-start an active deterministic game via service so we can test resume + finish cleanly
    const deck = (): Card[] => [
      { rank: '2', suit: '♠' },
      { rank: '10', suit: '♥' }, // stand/hit reserve
      { rank: '7', suit: '♦' }, // d2 => 17
      { rank: '9', suit: '♣' }, // p2 => 19
      { rank: '10', suit: '♠' }, // d1
      { rank: '10', suit: '♥' }, // p1
    ];
    const started = ctx.services.blackjack.startGame('g1', 'u1', 200, deck, Date.now());
    expect(started.ok).toBe(true);

    // Re-running /二十一点 resumes active game Ephemerally instead of returning an error
    const resumeMock = createCommandMock({ integers: { bet: 100 } });
    await blackjackCommand.execute(resumeMock.interaction, ctx);
    expect(resumeMock.replies).toHaveLength(1);
    expect(resumeMock.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(resumeMock.replies[0]?.embeds?.[0]?.toJSON().description).toContain('恢复当前牌局');
    expect(resumeMock.replies[0]?.components?.length).toBe(1);
    expect(resumeMock.channelSends).toHaveLength(0);

    // Non-owner clicking button is rejected Ephemerally
    const hijacker = createButtonMock({
      customId: 'bj:stand:u1',
      user: makeUser('u2', '路人'),
    });
    await handleBlackjackButton(hijacker.interaction, ctx);
    expect(hijacker.replies).toHaveLength(1);
    expect(hijacker.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(hijacker.updates).toHaveLength(0);

    // Owner clicks Stand -> Ephemeral update removes buttons & distinguishes 返还 vs 净盈亏, AND sends public report
    const standBtn = createButtonMock({ customId: 'bj:stand:u1' });
    await handleBlackjackButton(standBtn.interaction, ctx);
    expect(standBtn.updates).toHaveLength(1);
    expect(standBtn.updates[0]?.components).toEqual([]);
    const finalDesc = standBtn.updates[0]?.embeds?.[0]?.toJSON().description ?? '';
    expect(finalDesc).toContain('返还 **400**');
    expect(finalDesc).toContain('净赚 **+200**');

    expect(standBtn.channelSends).toHaveLength(1);
    expect(standBtn.channelSends[0]?.allowedMentions).toEqual({ parse: [] });
    const reportJson = standBtn.channelSends[0]?.embeds?.[0]?.toJSON();
    expect(reportJson?.title).toContain('二十一点战报');
    expect(reportJson?.fields?.some((f) => f.value.includes('净盈亏 **+200**'))).toBe(true);

    // Channel send failure does not break personal settlement
    const failSendDeck = (): Card[] => [
      { rank: '8', suit: '♥' }, // d2
      { rank: 'K', suit: '♠' }, // p2
      { rank: '9', suit: '♦' }, // d1
      { rank: 'A', suit: '♣' }, // p1 => natural blackjack
    ];
    vi.spyOn(ctx.services.blackjack, 'startGame').mockImplementationOnce((g, u, b) =>
      BlackjackManager.prototype.startGame.call(ctx.services.blackjack, g, u, b, failSendDeck),
    );
    const natMock = createCommandMock({ integers: { bet: 100 }, channelSendShouldThrow: true });
    await expect(blackjackCommand.execute(natMock.interaction, ctx)).resolves.toBeUndefined();
    expect(natMock.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    // Expired game on button click clears stale buttons gracefully
    const oldStart = Date.now() - BLACKJACK_TTL_MS - 5000;
    ctx.services.blackjack.startGame('g1', 'u1', 50, deck, oldStart);
    const expiredBtn = createButtonMock({ customId: 'bj:hit:u1' });
    await handleBlackjackButton(expiredBtn.interaction, ctx);
    expect(expiredBtn.updates).toHaveLength(1);
    expect(expiredBtn.updates[0]?.components).toEqual([]);

    ctx.db.close();
  });

  it('enforces Ephemeral visibility, bot-target blocks, dynamic timezone, curse/trap formatters, and highlight broadcasts across solo commands', async () => {
    const ctx = createCtx('America/New_York');
    ctx.repos.profile.addCoins('g1', 'u1', 1000);
    ctx.repos.profile.addCoins('g1', 'u2', 1000);

    // /签到: Ephemeral + dynamic timezone (no hardcoded 北京时间)
    const d1 = createCommandMock();
    await dailyCommand.execute(d1.interaction, ctx);
    expect(d1.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    const d2 = createCommandMock();
    await dailyCommand.execute(d2.interaction, ctx);
    expect(d2.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    const d2Desc = d2.replies[0]?.embeds?.[0]?.toJSON().description ?? '';
    expect(d2Desc).toContain('America/New_York');
    expect(d2Desc).not.toContain('北京时间');

    // /打工: Ephemeral + shows 衰神符 warning when cursed
    ctx.repos.chaos.setEffect({
      guildId: 'g1',
      userId: 'u1',
      effectKey: 'work_cursed',
      charges: 1,
      expiresAt: Date.now() + 3600_000,
      sourceUserId: 'u2',
      updatedAt: Date.now(),
    });
    const w1 = createCommandMock();
    await workCommand.execute(w1.interaction, ctx);
    expect(w1.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(w1.replies[0]?.embeds?.[0]?.toJSON().description).toContain('衰神符生效');

    const wCooldown = createCommandMock();
    await workCommand.execute(wCooldown.interaction, ctx);
    expect(wCooldown.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    // /钱包: Ephemeral, blocks bot, bank label updated
    const balBot = createCommandMock({ users: { user: makeUser('b1', 'Bot', true) } });
    await balanceCommand.execute(balBot.interaction, ctx);
    expect(balBot.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    const balOk = createCommandMock();
    await balanceCommand.execute(balOk.interaction, ctx);
    expect(balOk.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    const balFields = balOk.replies[0]?.embeds?.[0]?.toJSON().fields ?? [];
    expect(balFields.some((f) => f.name.includes('防偷安全'))).toBe(false);

    // /等级 & /邀请: Ephemeral + block bot
    const rankBot = createCommandMock({ users: { user: makeUser('b1', 'Bot', true) } });
    await rankCommand.execute(rankBot.interaction, ctx);
    expect(rankBot.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    const rankOk = createCommandMock();
    await rankCommand.execute(rankOk.interaction, ctx);
    expect(rankOk.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(
      rankOk.replies[0]?.embeds?.[0]?.toJSON().fields?.some((f) => f.name.includes('关系 / 出战宠物')),
    ).toBe(true);

    const invBot = createCommandMock({ users: { user: makeUser('b1', 'Bot', true) } });
    await invitesCommand.execute(invBot.interaction, ctx);
    expect(invBot.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    const invOk = createCommandMock();
    await invitesCommand.execute(invOk.interaction, ctx);
    expect(invOk.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    // /老虎机: Ephemeral; netChange === 0 uses COLORS.PRIMARY (InfoEmbed); >= 4x sends public highlight
    vi.spyOn(ctx.services.economy, 'playSlots').mockReturnValueOnce({
      ok: true,
      reels: ['🍒', '🍒', '🍋'],
      multiplier: 1.5,
      payout: 1,
      netChange: 0,
      balance: 1000,
    });
    const slotEven = createCommandMock({ integers: { bet: 1 } });
    await slotsCommand.execute(slotEven.interaction, ctx);
    expect(slotEven.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(slotEven.replies[0]?.embeds?.[0]?.toJSON().color).toBe(COLORS.PRIMARY);
    expect(slotEven.channelSends).toHaveLength(0);

    vi.spyOn(ctx.services.economy, 'playSlots').mockReturnValueOnce({
      ok: true,
      reels: ['7️⃣', '7️⃣', '7️⃣'],
      multiplier: 15,
      payout: 1500,
      netChange: 1400,
      balance: 2400,
    });
    const slotJackpot = createCommandMock({ integers: { bet: 100 } });
    await slotsCommand.execute(slotJackpot.interaction, ctx);
    expect(slotJackpot.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(slotJackpot.channelSends).toHaveLength(1);

    // /猜大小: Ephemeral; triple win sends public highlight
    vi.spyOn(ctx.services.economy, 'playDice').mockReturnValueOnce({
      ok: true,
      dice: [6, 6, 6],
      sum: 18,
      isTriple: true,
      won: true,
      netChange: 1000,
      balance: 3400,
    });
    const diceTriple = createCommandMock({ integers: { bet: 100 }, strings: { choice: 'triple' } });
    await diceCommand.execute(diceTriple.interaction, ctx);
    expect(diceTriple.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(diceTriple.channelSends).toHaveLength(1);

    // /运势: Ephemeral; first draw 大吉 sends public highlight, second draw does not
    vi.spyOn(ctx.services.fun, 'drawDailyFortune')
      .mockReturnValueOnce({
        alreadyDrawn: false,
        balance: 1080,
        record: {
          guildId: 'g1',
          userId: 'u1',
          dateKey: '2026-05-01',
          luckTier: '大吉',
          goodFor: '语音吹水',
          avoid: '梭哈老虎机',
          luckyNumber: 88,
          bonusCoins: 80,
          createdAt: Date.now(),
        },
      })
      .mockReturnValueOnce({
        alreadyDrawn: true,
        balance: 1080,
        record: {
          guildId: 'g1',
          userId: 'u1',
          dateKey: '2026-05-01',
          luckTier: '大吉',
          goodFor: '语音吹水',
          avoid: '梭哈老虎机',
          luckyNumber: 88,
          bonusCoins: 80,
          createdAt: Date.now(),
        },
      });
    const fFirst = createCommandMock();
    await fortuneCommand.execute(fFirst.interaction, ctx);
    expect(fFirst.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(fFirst.channelSends).toHaveLength(1);

    const fSecond = createCommandMock();
    await fortuneCommand.execute(fSecond.interaction, ctx);
    expect(fSecond.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(fSecond.channelSends).toHaveLength(0);

    // /打劫: Ephemeral errors (attacker_too_poor), public result shows trap + bank deduction
    const poorRob = createCommandMock({
      user: makeUser('u_poor', '穷光蛋'),
      users: { target: makeUser('u2', '富豪') },
    });
    await robCommand.execute(poorRob.interaction, ctx);
    expect(poorRob.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(poorRob.replies[0]?.embeds?.[0]?.toJSON().description).toContain('总资产');

    ctx.repos.profile.save({ ...ctx.repos.profile.getOrCreate('g1', 'u3'), coins: 0, bankCoins: 1000 });
    ctx.repos.chaos.setEffect({
      guildId: 'g1',
      userId: 'u2',
      effectKey: 'trap_armed',
      charges: 1,
      expiresAt: Date.now() + 3600_000,
      sourceUserId: null,
      updatedAt: Date.now(),
    });
    const trapRob = createCommandMock({
      user: makeUser('u3', '盗贼'),
      users: { target: makeUser('u2', '富豪') },
    });
    await robCommand.execute(trapRob.interaction, ctx);
    expect(trapRob.replies[0]?.flags).toBeUndefined();
    const trapDesc = trapRob.replies[0]?.embeds?.[0]?.toJSON().description ?? '';
    expect(trapDesc).toContain('捕兽夹');
    expect(trapDesc).toContain('联动划扣银行存款');

    // /转账 & /互动 personal errors are Ephemeral
    const paySelf = createCommandMock({
      users: { user: makeUser('u1', '小明') },
      integers: { amount: 10 },
    });
    await payCommand.execute(paySelf.interaction, ctx);
    expect(paySelf.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    const interactSelf = createCommandMock({
      strings: { action: 'pat' },
      users: { target: makeUser('u1', '小明') },
    });
    await interactCommand.execute(interactSelf.interaction, ctx);
    expect(interactSelf.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    ctx.db.close();
  });

  it('protects /排行榜 and /帮助 against hijacking, supports lb:share, and checks module switches', async () => {
    const ctx = createCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 500);

    // /排行榜 default Ephemeral with ownerId embedded in customIds
    const lbCmd = createCommandMock({ strings: { type: 'xp' } });
    await leaderboardCommand.execute(lbCmd.interaction, ctx);
    expect(lbCmd.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    const row2Btns = lbCmd.replies[0]?.components?.[1]?.toJSON().components ?? [];
    const shareBtn = row2Btns.find((c) => 'custom_id' in c && c.custom_id?.startsWith('lb:share:'));
    expect(shareBtn && 'custom_id' in shareBtn ? shareBtn.custom_id : '').toBe('lb:share:xp:1:u1');

    // Non-owner clicking lb button is rejected Ephemeral
    const lbHijack = createButtonMock({
      customId: 'lb:coins:1:tab:u1',
      user: makeUser('u2', '路人'),
    });
    await handleLeaderboardButton(lbHijack.interaction, ctx);
    expect(lbHijack.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(lbHijack.updates).toHaveLength(0);

    // Module switch check blocks coins leaderboard when economy disabled
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, economy: false });
    const lbDisabled = createButtonMock({ customId: 'lb:coins:1:tab:u1' });
    await handleLeaderboardButton(lbDisabled.interaction, ctx);
    expect(lbDisabled.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(lbDisabled.replies[0]?.embeds?.[0]?.toJSON().title).toContain('模块未开启');

    // Share button sends public leaderboard with no interactive buttons
    const lbShare = createButtonMock({ customId: 'lb:share:xp:1:u1' });
    await handleLeaderboardButton(lbShare.interaction, ctx);
    expect(lbShare.channelSends).toHaveLength(1);
    expect(lbShare.channelSends[0]?.allowedMentions).toEqual({ parse: [] });
    expect(lbShare.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    // Legacy customId without ownerId remains compatible
    const lbLegacy = createButtonMock({ customId: 'lb:xp:1', user: makeUser('u2') });
    await handleLeaderboardButton(lbLegacy.interaction, ctx);
    expect(lbLegacy.updates).toHaveLength(1);

    // /帮助 Ephemeral + ownerId anti-hijack + legacy compat
    const helpCmd = createCommandMock();
    await helpCommand.execute(helpCmd.interaction, ctx);
    expect(helpCmd.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    const selectComp = helpCmd.replies[0]?.components?.[0]?.toJSON().components[0];
    expect(selectComp && 'custom_id' in selectComp ? selectComp.custom_id : '').toBe(
      'help:category:u1',
    );

    const helpHijack = createSelectMock({
      customId: 'help:category:u1',
      values: ['economy'],
      user: makeUser('u2'),
    });
    await handleHelpSelect(helpHijack.interaction);
    expect(helpHijack.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(helpHijack.updates).toHaveLength(0);

    const helpOwner = createSelectMock({
      customId: 'help:category:u1',
      values: ['economy'],
      user: makeUser('u1'),
    });
    await handleHelpSelect(helpOwner.interaction);
    expect(helpOwner.updates).toHaveLength(1);

    const helpLegacy = createSelectMock({
      customId: 'help:category',
      values: ['fun'],
      user: makeUser('u2'),
    });
    await handleHelpSelect(helpLegacy.interaction);
    expect(helpLegacy.updates).toHaveLength(1);

    ctx.db.close();
  });

  it('handles shop/inventory/title/levelAdmin edge cases: admin module separation, 4096 truncation, voucher redeem, role dup guard, announce keep, and XP role sync', async () => {
    const ctx = createCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 5000);

    // Admin shop subcommands work even when economy module is disabled
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, economy: false, fun: false });

    const lowBox = createCommandMock({
      isAdmin: true,
      subcommand: 'add-box',
      strings: { name: '零价盲盒', description: '' },
      integers: { price: SHOP_MYSTERY_BOX_MIN_PRICE - 1 },
    });
    await shopCommand.execute(lowBox.interaction, ctx);
    expect(lowBox.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(lowBox.replies[0]?.embeds?.[0]?.toJSON().title).toContain('价格过低');

    const okBox = createCommandMock({
      isAdmin: true,
      subcommand: 'add-box',
      strings: { name: '正价盲盒', description: '好东西' },
      integers: { price: 200 },
    });
    await shopCommand.execute(okBox.interaction, ctx);
    expect(okBox.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.services.shop.listItems('g1')).toHaveLength(1);

    // /称号 授予 works when fun module is disabled & blocks bots
    const grantBot = createCommandMock({
      isAdmin: true,
      subcommand: 'grant',
      users: { user: makeUser('b1', 'Bot', true) },
      strings: { name: '机械师' },
    });
    await titleCommand.execute(grantBot.interaction, ctx);
    expect(grantBot.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(grantBot.replies[0]?.embeds?.[0]?.toJSON().title).toContain('无法授予');

    const grantHuman = createCommandMock({
      isAdmin: true,
      subcommand: 'grant',
      users: { user: makeUser('u1', '小明') },
      strings: { name: '开荒大佬' },
    });
    await titleCommand.execute(grantHuman.interaction, ctx);
    expect(ctx.services.fun.listTitles('g1', 'u1')).toContain('开荒大佬');

    // Re-enable economy & fun for user actions
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, economy: true, fun: true });

    // /称号 佩戴 is Ephemeral
    const equipCmd = createCommandMock({ subcommand: 'equip', strings: { name: '开荒大佬' } });
    await titleCommand.execute(equipCmd.interaction, ctx);
    expect(equipCmd.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    // /商店 购买 blocks already-owned role before deducting coins/stock
    const roleItem = ctx.services.shop.createRoleItem({
      guildId: 'g1',
      name: 'MVP',
      description: 'VIP',
      price: 500,
      roleId: 'role-mvp',
      stock: 2,
    });
    const buyDupRole = createCommandMock({
      subcommand: 'buy',
      integers: { id: roleItem.id },
      memberRoles: ['role-mvp'],
    });
    await shopCommand.execute(buyDupRole.interaction, ctx);
    expect(buyDupRole.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBe(5000);
    expect(ctx.repos.shop.getItemById('g1', roleItem.id)?.stock).toBe(2);

    // /商店 列表 truncates cleanly under 4096 chars and is Ephemeral
    for (let i = 0; i < 60; i++) {
      ctx.services.shop.createTitleItem({
        guildId: 'g1',
        name: `超长测试商品名称_${i}_${'测'.repeat(30)}`,
        description: '描'.repeat(40),
        price: 100 + i,
        titleText: `称号${i}`,
        stock: null,
      });
    }
    const shopList = createCommandMock({ subcommand: 'list' });
    await shopCommand.execute(shopList.interaction, ctx);
    expect(shopList.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    const listDesc = shopList.replies[0]?.embeds?.[0]?.toJSON().description ?? '';
    expect(listDesc.length).toBeLessThanOrEqual(4096);
    expect(listDesc).toContain('已省略');

    // /背包 使用 directly redeems custom_title voucher with `title` option & stays Ephemeral
    const voucher = ctx.services.shop.createCustomTitleItem({
      guildId: 'g1',
      name: '自定称号券',
      description: '',
      price: 200,
      stock: null,
    });
    const buyVoucher = ctx.services.shop.buyItem('g1', 'u1', voucher.id);
    expect(buyVoucher.ok).toBe(true);
    const invId = buyVoucher.ok ? buyVoucher.addedInventory!.id : 0;

    const useWithoutTitle = createCommandMock({ subcommand: 'use', integers: { id: invId } });
    await inventoryCommand.execute(useWithoutTitle.interaction, ctx);
    expect(useWithoutTitle.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(useWithoutTitle.replies[0]?.embeds?.[0]?.toJSON().title).toContain('请提供称号文本');

    const useWithTitle = createCommandMock({
      subcommand: 'use',
      integers: { id: invId },
      strings: { title: '星际摸鱼王' },
    });
    await inventoryCommand.execute(useWithTitle.interaction, ctx);
    expect(useWithTitle.replies[0]?.flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').equippedTitle).toBe('星际摸鱼王');

    // /等级管理 set-announce without channel preserves existing announceChannelId
    ctx.repos.guildConfig.updateLeveling('g1', {
      ...ctx.repos.guildConfig.getOrCreate('g1').leveling,
      announceChannelId: 'ch-original',
    });
    const setAnnounce = createCommandMock({
      isAdmin: true,
      subcommand: 'set-announce',
      booleans: { enabled: true },
      channels: { channel: null },
    });
    await levelAdminCommand.execute(setAnnounce.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling.announceChannelId).toBe('ch-original');

    // /等级管理 set-xp blocks bots & syncs reward roles on upgrade/downgrade
    const setXpBot = createCommandMock({
      isAdmin: true,
      subcommand: 'set-xp',
      users: { user: makeUser('b1', 'Bot', true) },
      integers: { xp: 500 },
    });
    await levelAdminCommand.execute(setXpBot.interaction, ctx);
    expect(setXpBot.replies[0]?.flags).toBe(MessageFlags.Ephemeral);

    ctx.repos.profile.setLevelReward('g1', 1, 'role-lv1');
    ctx.repos.profile.setLevelReward('g1', 5, 'role-lv5');
    ctx.services.leveling.setUserXp('g1', 'u1', totalXpForLevel(5));

    const mockRoleAdd = vi.fn(async () => undefined);
    const mockRoleRemove = vi.fn(async () => undefined);
    const setXpDown = createCommandMock({
      isAdmin: true,
      subcommand: 'set-xp',
      users: { user: makeUser('u1', '小明') },
      integers: { xp: totalXpForLevel(1) },
      fetchedMembers: {
        u1: {
          id: 'u1',
          roles: {
            add: mockRoleAdd,
            remove: mockRoleRemove,
            cache: new Map([
              ['role-lv1', { id: 'role-lv1' }],
              ['role-lv5', { id: 'role-lv5' }],
            ]),
          },
        },
      },
    });
    await levelAdminCommand.execute(setXpDown.interaction, ctx);
    expect(mockRoleRemove).toHaveBeenCalledWith(['role-lv5'], '等级身份组更新');

    ctx.db.close();
  });
});
