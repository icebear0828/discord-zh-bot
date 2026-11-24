import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Events,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  BLACKJACK_TTL_MS,
  DUEL_TTL_MS,
  MAX_SOLO_GAMBLE_BET,
  PREDICTION_LOCKED_EXPIRE_MS,
  ROB_ATTACKER_MIN_ASSETS,
} from '../../src/config/economyConstants.js';
import { createDatabase } from '../../src/db/database.js';
import { AiMemoryRepo } from '../../src/db/repositories/aiMemoryRepo.js';
import { BlackjackRepo } from '../../src/db/repositories/blackjackRepo.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { CreditLoanRepo } from '../../src/db/repositories/creditLoanRepo.js';
import { DuelRepo } from '../../src/db/repositories/duelRepo.js';
import { FunRepo } from '../../src/db/repositories/funRepo.js';
import { GiveawayRepo } from '../../src/db/repositories/giveawayRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { MonitorRepo } from '../../src/db/repositories/monitorRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo } from '../../src/db/repositories/redPacketRepo.js';
import { RolePanelRepo } from '../../src/db/repositories/rolePanelRepo.js';
import { RpgRepo } from '../../src/db/repositories/rpgRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { TicketRepo } from '../../src/db/repositories/ticketRepo.js';
import { WorldEventRepo } from '../../src/db/repositories/worldEventRepo.js';
import { robCommand } from '../../src/commands/economy/rob.js';
import { registerReadyEvent, runGamesTick } from '../../src/events/ready.js';
import { routeInteraction } from '../../src/interactions/router.js';
import { AiService } from '../../src/services/aiService.js';
import { BlackjackManager, type Card } from '../../src/services/blackjackService.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { CreditLoanService } from '../../src/services/creditLoanService.js';
import { EconomyService } from '../../src/services/economyService.js';
import { FunService } from '../../src/services/funService.js';
import { GiveawayService } from '../../src/services/giveawayService.js';
import { InviteService } from '../../src/services/inviteService.js';
import { LevelingService } from '../../src/services/levelingService.js';
import { LlmClient } from '../../src/services/llmClient.js';
import { MultiplayerService } from '../../src/services/multiplayerService.js';
import { RolePanelService } from '../../src/services/rolePanelService.js';
import { RpgService } from '../../src/services/rpgService.js';
import { ShopService } from '../../src/services/shopService.js';
import { SocialPetService } from '../../src/services/socialPetService.js';
import { TicketService } from '../../src/services/ticketService.js';
import { WorldEventService } from '../../src/services/worldEventService.js';
import type { AppContext } from '../../src/ui/embeds.js';

interface MockPayload {
  content?: string;
  allowedMentions?: { parse?: string[]; users?: string[] };
  embeds?: Array<{ toJSON(): { title?: string; description?: string; fields?: Array<{ name: string; value: string }> } }>;
  components?: Array<{ toJSON(): { components: Array<{ custom_id?: string }> } }>;
}

function createPersistentCtx(): AppContext {
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
  const duelRepo = new DuelRepo(db);
  const monitor = new MonitorRepo(db);
  const creditLoanRepo = new CreditLoanRepo(db);
  const rpgRepo = new RpgRepo(db);
  const llmClient = new LlmClient(undefined);
  const creditLoan = new CreditLoanService(db, guildConfig, profile, creditLoanRepo, 'Asia/Shanghai', chaos);
  const rpg = new RpgService(db, rpgRepo, profile, {
    timezone: 'Asia/Shanghai',
    guildConfigRepo: guildConfig,
    socialPetRepo: socialPet,
  });

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
      aiMemory,
      creditLoan: creditLoanRepo,
      rpg: rpgRepo,
      blackjack: blackjackRepo,
      duel: duelRepo,
      monitor,
    },
    services: {
      leveling: new LevelingService(guildConfig, profile, invite, creditLoan, rpg),
      economy: new EconomyService(db, guildConfig, profile, 'Asia/Shanghai', chaos),
      blackjack: new BlackjackManager(db, profile, blackjackRepo),
      shop: new ShopService(db, profile, shop, {
        guildConfigRepo: guildConfig,
        chaosRepo: chaos,
        socialPetRepo: socialPet,
        timezone: 'Asia/Shanghai',
      }),
      fun: new FunService(db, profile, shop, fun, 'Asia/Shanghai'),
      ticket: new TicketService(guildConfig, ticket),
      giveaway: new GiveawayService(giveaway),
      invite: new InviteService(invite),
      rolePanel: new RolePanelService(rolePanel),
      multiplayer: new MultiplayerService(db, profile, redPacket, chaos, duelRepo),
      chaos: new ChaosService(db, guildConfig, profile, chaos),
      worldEvent: new WorldEventService(db, guildConfig, profile, worldEvent, socialPet),
      socialPet: new SocialPetService(db, guildConfig, profile, shop, socialPet, 'Asia/Shanghai'),
      ai: new AiService(guildConfig, aiMemory, llmClient),
      creditLoan,
      rpg,
    },
  };
}

function makeUser(id: string) {
  return {
    id,
    username: `user-${id}`,
    displayName: `User-${id}`,
    bot: false,
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
  };
}

function makePerms() {
  return { has: () => false };
}

describe('Wave 2 final wiring: persistent repos, expiry timers, and unified menu handlers', () => {
  it('wires BlackjackRepo and DuelRepo into BlackjackManager and MultiplayerService (including src/index.ts)', () => {
    const indexSrc = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8');
    expect(indexSrc).toMatch(
      /new BlackjackManager\(\s*db,\s*profileRepo,\s*blackjackRepo(?:,\s*creditLoanService)?\s*,?\s*\)/,
    );
    expect(indexSrc).toMatch(
      /new MultiplayerService\(\s*db,\s*profileRepo,\s*redPacketRepo,\s*chaosRepo,\s*duelRepo(?:,\s*creditLoanService)?\s*,?\s*\)/,
    );

    const ctx = createPersistentCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 1000);
    ctx.repos.profile.addCoins('g1', 'u2', 1000);

    // Deterministic non-blackjack starting hand (popped from end: p1=5, d1=6, p2=7, d2=8)
    const deck: Card[] = [
      { rank: '10', suit: '♠' },
      { rank: '9', suit: '♥' },
      { rank: '8', suit: '♦' },
      { rank: '7', suit: '♣' },
      { rank: '6', suit: '♠' },
      { rank: '5', suit: '♥' },
    ];
    const startRes = ctx.services.blackjack.startGame('g1', 'u1', 100, () => [...deck], 1_000_000);
    expect(startRes.ok).toBe(true);

    const duelRes = ctx.services.multiplayer.createDuel('g1', 'c1', 'u1', 'u2', 200, 1_000_000);
    expect(duelRes.ok).toBe(true);
    if (!duelRes.ok) return;
    ctx.services.multiplayer.bindDuelMessage(duelRes.duel.id, 'duel-msg-1');

    // Simulate process restart by instantiating fresh services on the same SQLite DB
    const restartedBlackjack = new BlackjackManager(
      ctx.db,
      ctx.repos.profile,
      ctx.repos.blackjack,
    );
    const restartedMultiplayer = new MultiplayerService(
      ctx.db,
      ctx.repos.profile,
      ctx.repos.redPacket,
      ctx.repos.chaos,
      ctx.repos.duel,
    );

    const restoredGame = restartedBlackjack.getActiveGame('g1', 'u1', 1_000_500);
    expect(restoredGame).not.toBeNull();
    expect(restoredGame?.bet).toBe(100);

    const restoredDuel = restartedMultiplayer.getDuel(duelRes.duel.id, 1_000_500);
    expect(restoredDuel).not.toBeNull();
    expect(restoredDuel?.messageId).toBe('duel-msg-1');

    ctx.db.close();
  });

  it('expires due blackjack games, due duels (refreshing card & removing buttons), and 72h locked predictions in runGamesTick', async () => {
    const ctx = createPersistentCtx();
    const now = Date.now();
    ctx.repos.profile.addCoins('g1', 'bj-user', 1000);
    ctx.repos.profile.addCoins('g1', 'duel-c', 1000);
    ctx.repos.profile.addCoins('g1', 'pred-bettor', 1000);

    // 1. Overdue blackjack game (> 15m old)
    const deck: Card[] = [
      { rank: '10', suit: '♠' },
      { rank: '9', suit: '♥' },
      { rank: '8', suit: '♦' },
      { rank: '7', suit: '♣' },
      { rank: '6', suit: '♠' },
      { rank: '5', suit: '♥' },
    ];
    const bjStart = ctx.services.blackjack.startGame(
      'g1',
      'bj-user',
      250,
      () => [...deck],
      now - BLACKJACK_TTL_MS - 5_000,
    );
    expect(bjStart.ok).toBe(true);
    expect(ctx.repos.profile.getOrCreate('g1', 'bj-user').coins).toBe(750);

    // 2. Overdue duel with bound messageId
    const duelCreated = ctx.services.multiplayer.createDuel(
      'g1',
      'c-duel',
      'duel-c',
      'duel-o',
      300,
      now - DUEL_TTL_MS - 5_000,
    );
    expect(duelCreated.ok).toBe(true);
    if (!duelCreated.ok) return;
    ctx.services.multiplayer.bindDuelMessage(duelCreated.duel.id, 'msg-duel-exp');
    expect(ctx.repos.profile.getOrCreate('g1', 'duel-c').coins).toBe(700);

    // 3. Prediction locked > 72h ago
    const predCreated = ctx.services.worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c-pred',
      creatorId: 'pred-creator',
      title: '超期未结算盘口',
      options: ['选项A', '选项B'],
      closeMinutes: 10,
      nowMs: now - PREDICTION_LOCKED_EXPIRE_MS - 120_000,
    });
    expect(predCreated.ok).toBe(true);
    if (!predCreated.ok) return;
    const predId = predCreated.summary.prediction.id;
    ctx.services.worldEvent.bindPredictionMessage(predId, 'msg-pred-exp', 'c-pred');
    const betRes = ctx.services.worldEvent.placeBet({
      predictionId: predId,
      userId: 'pred-bettor',
      optionIndex: 0,
      amount: 400,
      nowMs: now - PREDICTION_LOCKED_EXPIRE_MS - 60_000,
    });
    expect(betRes.ok).toBe(true);
    expect(ctx.repos.profile.getOrCreate('g1', 'pred-bettor').coins).toBe(600);
    const lockRes = ctx.services.worldEvent.lockPrediction(
      predId,
      'pred-creator',
      false,
      now - PREDICTION_LOCKED_EXPIRE_MS - 10_000,
    );
    expect(lockRes.ok).toBe(true);

    const duelEdit = vi.fn(async (_p: MockPayload) => undefined);
    const predEdit = vi.fn(async (_p: MockPayload) => undefined);
    const duelChannel = {
      id: 'c-duel',
      isTextBased: () => true,
      messages: { fetch: vi.fn(async (id: string) => (id === 'msg-duel-exp' ? { edit: duelEdit } : null)) },
    };
    const predChannel = {
      id: 'c-pred',
      isTextBased: () => true,
      messages: { fetch: vi.fn(async (id: string) => (id === 'msg-pred-exp' ? { edit: predEdit } : null)) },
    };
    const channelMap = new Map<string, unknown>([
      ['c-duel', duelChannel],
      ['c-pred', predChannel],
    ]);
    const fakeClient = {
      guilds: {
        cache: new Map([
          [
            'g1',
            {
              id: 'g1',
              channels: { cache: channelMap },
            },
          ],
        ]),
      },
      channels: {
        cache: channelMap,
        fetch: vi.fn(async (id: string) => channelMap.get(id) ?? null),
      },
    } as unknown as Client;

    await runGamesTick(fakeClient, ctx);

    // Blackjack refunded and cleaned up
    expect(ctx.repos.profile.getOrCreate('g1', 'bj-user').coins).toBe(1000);
    expect(ctx.repos.blackjack!.get('g1', 'bj-user')).toBeNull();

    // Duel refunded, status expired, and public card edited with buttons removed
    expect(ctx.repos.profile.getOrCreate('g1', 'duel-c').coins).toBe(1000);
    expect(ctx.services.multiplayer.getDuel(duelCreated.duel.id)?.status).toBe('expired');
    expect(duelEdit).toHaveBeenCalledTimes(1);
    const duelEditPayload = duelEdit.mock.calls[0]![0];
    expect(duelEditPayload.components).toEqual([]);
    expect(duelEditPayload.embeds?.[0]?.toJSON().title).toContain('已过期');

    // Locked 72h prediction auto-cancelled, refunded, and public card edited with buttons removed
    expect(ctx.repos.profile.getOrCreate('g1', 'pred-bettor').coins).toBe(1000);
    expect(ctx.repos.worldEvent.getPredictionById(predId)?.status).toBe('cancelled');
    expect(predEdit).toHaveBeenCalledTimes(1);
    const predEditPayload = predEdit.mock.calls[0]![0];
    expect(predEditPayload.components).toEqual([]);
    expect(predEditPayload.embeds?.[0]?.toJSON().description).toContain('72 小时');

    // Error isolation: throwing in blackjack expireDueGames does not block duel/prediction expiry
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(ctx.services.blackjack, 'expireDueGames').mockImplementation(() => {
      throw new Error('bj boom');
    });
    const duelSpy = vi.spyOn(ctx.services.multiplayer, 'expireDueDuels').mockReturnValue([]);
    const predExpireSpy = vi
      .spyOn(ctx.services.worldEvent, 'expireDueLockedPredictions')
      .mockReturnValue([]);
    await expect(runGamesTick(fakeClient, ctx)).resolves.toBeUndefined();
    expect(duelSpy).toHaveBeenCalledTimes(1);
    expect(predExpireSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();

    ctx.db.close();
  });

  it('binds duel messageId on broadcast success and auto-refunds frozen bet via declineDuel on broadcast failure', async () => {
    const ctx = createPersistentCtx();
    ctx.repos.profile.addCoins('g1', 'challenger', 1000);
    ctx.repos.profile.addCoins('g1', 'opponent', 1000);

    const makeDuelModal = (channelSend: ReturnType<typeof vi.fn>) => {
      const editReply = vi.fn(async (_p: MockPayload) => undefined);
      const deferUpdate = vi.fn(async () => undefined);
      const channel = {
        id: 'c1',
        isSendable: () => true,
        send: channelSend,
      };
      const interaction = {
        customId: 'menu:modal_sub:duel:opponent',
        guildId: 'g1',
        guild: { id: 'g1', name: 'Test', channels: { cache: new Map([['c1', channel]]) } },
        channelId: 'c1',
        channel,
        client: { channels: { cache: new Map([['c1', channel]]), fetch: vi.fn(async () => channel) } },
        user: makeUser('challenger'),
        member: { id: 'challenger', permissions: makePerms(), roles: { cache: new Map() } },
        fields: { getTextInputValue: () => '300' },
        replied: false,
        deferred: false,
        inCachedGuild: () => true,
        isFromMessage: () => true,
        isChatInputCommand: () => false,
        isButton: () => false,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => false,
        isRoleSelectMenu: () => false,
        isChannelSelectMenu: () => false,
        isModalSubmit: () => true,
        isRepliable: () => true,
        deferUpdate,
        editReply,
        update: vi.fn(async () => undefined),
        reply: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      } as unknown as ModalSubmitInteraction & Interaction;
      return { interaction, editReply, deferUpdate };
    };

    // Case 1: send fails -> declineDuel refunds frozen bet
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failSend = vi.fn(async () => {
      throw new Error('Missing Permissions');
    });
    const failedModal = makeDuelModal(failSend);
    await routeInteraction(failedModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'challenger').coins).toBe(1000);
    expect(failedModal.editReply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
      '退回冻结',
    );
    errSpy.mockRestore();

    // Case 2: send succeeds -> bindDuelMessage stores messageId in DuelRepo
    const okSend = vi.fn(async (_p: MockPayload) => ({ id: 'public-duel-msg-777' }));
    const okModal = makeDuelModal(okSend);
    await routeInteraction(okModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'challenger').coins).toBe(700);
    const sentPayload = okSend.mock.calls[0]![0];
    const acceptCustomId = sentPayload.components?.[0]?.toJSON().components[0]?.custom_id ?? '';
    const duelId = acceptCustomId.split(':')[3] ?? '';
    expect(duelId.length).toBeGreaterThan(0);
    const persisted = ctx.repos.duel!.getById(duelId);
    expect(persisted?.messageId).toBe('public-duel-msg-777');

    ctx.db.close();
  });

  it('keeps menu blackjack draws private, broadcasts unified public report on every finish, and tolerates broadcast errors', async () => {
    const ctx = createPersistentCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 1000);

    // Deterministic deck: p1=10, d1=10, p2=5 (15), d2=9 (19) -> start stays playing, stand loses (small bet)
    const deck: Card[] = [
      { rank: '9', suit: '♦' },
      { rank: '5', suit: '♣' },
      { rank: '10', suit: '♠' },
      { rank: '10', suit: '♥' },
    ];
    const origStart = ctx.services.blackjack.startGame.bind(ctx.services.blackjack);
    vi.spyOn(ctx.services.blackjack, 'startGame').mockImplementationOnce((g, u, b) =>
      origStart(g, u, b, () => [...deck]),
    );

    const makeBjBtn = (customId: string, sendImpl?: () => Promise<unknown>) => {
      const update = vi.fn(async (_p: MockPayload) => undefined);
      const send = vi.fn(sendImpl ?? (async () => ({ id: 'bj-report-1' })));
      const channel = { id: 'c1', isSendable: () => true, send };
      const interaction = {
        customId,
        guildId: 'g1',
        guild: { id: 'g1', name: 'Test', channels: { cache: new Map([['c1', channel]]) } },
        channelId: 'c1',
        channel,
        client: { channels: { cache: new Map([['c1', channel]]), fetch: vi.fn(async () => channel) } },
        user: makeUser('u1'),
        member: { id: 'u1', permissions: makePerms(), roles: { cache: new Map() } },
        replied: false,
        deferred: false,
        inCachedGuild: () => true,
        isChatInputCommand: () => false,
        isButton: () => true,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => false,
        isRoleSelectMenu: () => false,
        isChannelSelectMenu: () => false,
        isModalSubmit: () => false,
        isRepliable: () => true,
        update,
        reply: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      } as unknown as ButtonInteraction & Interaction;
      return { interaction, update, send };
    };

    // Start (status = playing) -> private only, NO public channel message
    const startBtn = makeBjBtn('menu:bj_start:50');
    await routeInteraction(startBtn.interaction, ctx);
    expect(startBtn.update).toHaveBeenCalledTimes(1);
    expect(startBtn.send).not.toHaveBeenCalled();

    // Stand (status = dealer_win, small loss) -> still broadcasts unified public report embed!
    const standBtn = makeBjBtn('menu:bj:stand');
    await routeInteraction(standBtn.interaction, ctx);
    expect(standBtn.update).toHaveBeenCalledTimes(1);
    expect(standBtn.send).toHaveBeenCalledTimes(1);
    const reportCall = (standBtn.send.mock.calls[0] as unknown as [MockPayload])[0];
    expect(reportCall.allowedMentions).toEqual({ parse: [] });
    const reportJson = reportCall.embeds?.[0]?.toJSON();
    expect(reportJson?.title).toContain('二十一点战报');
    expect(reportJson?.description).toContain('<@u1>');
    expect(reportJson?.fields?.some((f) => f.value.includes('下注 **50**'))).toBe(true);

    // Broadcast failure does not break personal settlement
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bjDeck: Card[] = [
      { rank: '9', suit: '♦' },
      { rank: 'K', suit: '♣' },
      { rank: '8', suit: '♠' },
      { rank: 'A', suit: '♥' },
    ];
    vi.spyOn(ctx.services.blackjack, 'startGame').mockImplementationOnce((g, u, b) =>
      origStart(g, u, b, () => [...bjDeck]),
    );
    const failReportBtn = makeBjBtn('menu:bj_start:100', async () => {
      throw new Error('50013');
    });
    await expect(routeInteraction(failReportBtn.interaction, ctx)).resolves.toBeUndefined();
    expect(failReportBtn.update).toHaveBeenCalledTimes(1);
    // Balance: 1000 - 50 (lost first game) - 100 + 250 (blackjack 2.5x) = 1100
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBe(1100);
    errSpy.mockRestore();

    ctx.db.close();
  });

  it('passes ownedRoleIds to shop.buyItem in menu shop_buy and blocks duplicate role purchases without deducting coins/stock', async () => {
    const ctx = createPersistentCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 1000);
    const roleItem = ctx.services.shop.createRoleItem({
      guildId: 'g1',
      name: '贵族身份组',
      description: '专属颜色',
      price: 400,
      roleId: 'role-vip',
      stock: 5,
    });

    const buySpy = vi.spyOn(ctx.services.shop, 'buyItem');
    const update = vi.fn(async (_p: MockPayload) => undefined);
    const addRole = vi.fn(async () => undefined);
    const interaction = {
      customId: 'menu:shop_buy:1',
      values: [String(roleItem.id)],
      guildId: 'g1',
      channelId: 'c1',
      user: makeUser('u1'),
      member: {
        id: 'u1',
        permissions: makePerms(),
        roles: {
          cache: new Map([['role-vip', { id: 'role-vip' }]]),
          add: addRole,
        },
      },
      replied: false,
      deferred: false,
      inCachedGuild: () => true,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => true,
      isUserSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      update,
      deferUpdate: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    } as unknown as StringSelectMenuInteraction & Interaction;

    await routeInteraction(interaction, ctx);

    expect(buySpy).toHaveBeenCalledTimes(1);
    const passedOwnedRoles = buySpy.mock.calls[0]?.[5];
    expect(passedOwnedRoles).toBeInstanceOf(Set);
    expect(passedOwnedRoles?.has('role-vip')).toBe(true);
    expect(addRole).not.toHaveBeenCalled();
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBe(1000);
    expect(ctx.repos.shop.getItemById('g1', roleItem.id)?.stock).toBe(5);
    expect(update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('已经拥有');

    ctx.db.close();
  });

  it('shows bank deduction details on pocket rob failure and accurate messages for attacker_too_poor / bet_too_large / boost_multiplier_conflict', async () => {
    const ctx = createPersistentCtx();
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateEconomy('g1', {
      ...cfg.economy,
      robSuccessRate: 0, // guaranteed failure
      robCooldownSec: 0,
      robTargetShieldSec: 0,
    });

    // Attacker has 10 pocket + 500 bank -> failure fine deducts from bank too
    ctx.repos.profile.addCoins('g1', 'robber', 510);
    ctx.services.economy.deposit('g1', 'robber', 500);
    ctx.repos.profile.addCoins('g1', 'victim', 1000);

    const makeRobSelect = (userId: string) => {
      const update = vi.fn(async (_p: MockPayload) => undefined);
      const editReply = vi.fn(async (_p: MockPayload) => undefined);
      const deferUpdate = vi.fn(async () => undefined);
      const send = vi.fn(async (_p: MockPayload) => ({ id: 'rob-msg-1' }));
      const channel = { id: 'c1', isSendable: () => true, send };
      const targetUser = makeUser('victim');
      const interaction = {
        customId: 'menu:user:rob',
        values: ['victim'],
        users: new Map([['victim', targetUser]]),
        guildId: 'g1',
        guild: { id: 'g1', name: 'Test', channels: { cache: new Map([['c1', channel]]) } },
        channelId: 'c1',
        channel,
        client: { channels: { cache: new Map([['c1', channel]]), fetch: vi.fn(async () => channel) } },
        user: makeUser(userId),
        member: { id: userId, permissions: makePerms(), roles: { cache: new Map() } },
        replied: false,
        deferred: false,
        inCachedGuild: () => true,
        isChatInputCommand: () => false,
        isButton: () => false,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => true,
        isRoleSelectMenu: () => false,
        isChannelSelectMenu: () => false,
        isModalSubmit: () => false,
        isRepliable: () => true,
        update,
        deferUpdate,
        editReply,
        reply: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      } as unknown as UserSelectMenuInteraction & Interaction;
      return { interaction, update, editReply, send };
    };

    const bankFineRob = makeRobSelect('robber');
    await routeInteraction(bankFineRob.interaction, ctx);
    expect(bankFineRob.send).toHaveBeenCalledTimes(1);
    const pubDesc = bankFineRob.send.mock.calls[0]![0].embeds?.[0]?.toJSON().description ?? '';
    const privDesc = bankFineRob.editReply.mock.calls[0]![0].embeds?.[0]?.toJSON().description ?? '';
    expect(pubDesc).toContain('联动划扣银行存款');
    expect(privDesc).toContain('联动划扣银行存款');
    expect(privDesc).toContain('银行 **');

    // Poor attacker gets clear attacker_too_poor message
    const poorRob = makeRobSelect('broke-user');
    await routeInteraction(poorRob.interaction, ctx);
    expect(poorRob.editReply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
      String(ROB_ATTACKER_MIN_ASSETS),
    );

    // bet_too_large on slots modal
    ctx.repos.profile.addCoins('g1', 'whale', MAX_SOLO_GAMBLE_BET + 10_000);
    const slotsModalUpdate = vi.fn(async (_p: MockPayload) => undefined);
    const bigSlotsModal = {
      customId: 'menu:modal_sub:slots',
      guildId: 'g1',
      channelId: 'c1',
      user: makeUser('whale'),
      member: { id: 'whale', permissions: makePerms(), roles: { cache: new Map() } },
      fields: { getTextInputValue: () => String(MAX_SOLO_GAMBLE_BET + 1) },
      replied: false,
      deferred: false,
      inCachedGuild: () => true,
      isFromMessage: () => true,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isUserSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      isModalSubmit: () => true,
      isRepliable: () => true,
      update: slotsModalUpdate,
      reply: vi.fn(async () => undefined),
    } as unknown as ModalSubmitInteraction & Interaction;
    await routeInteraction(bigSlotsModal, ctx);
    expect(slotsModalUpdate.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
      MAX_SOLO_GAMBLE_BET.toLocaleString('en-US'),
    );

    // boost_multiplier_conflict in bag_use
    const boost2x = ctx.services.shop.createBoostItem({
      guildId: 'g1',
      name: '2x经验卡',
      description: '2x',
      price: 100,
      boostMultiplier: 2,
      boostDurationSec: 3600,
      stock: null,
    });
    const boost3x = ctx.services.shop.createBoostItem({
      guildId: 'g1',
      name: '3x经验卡',
      description: '3x',
      price: 100,
      boostMultiplier: 3,
      boostDurationSec: 3600,
      stock: null,
    });
    ctx.services.shop.buyItem('g1', 'whale', boost2x.id);
    ctx.services.shop.buyItem('g1', 'whale', boost3x.id);
    const inv = ctx.services.shop.listInventory('g1', 'whale');
    const inv2x = inv.find((i) => i.itemName === '2x经验卡')!;
    const inv3x = inv.find((i) => i.itemName === '3x经验卡')!;
    expect(ctx.services.shop.useInventoryItem('g1', 'whale', inv2x.id).ok).toBe(true);

    const bagUpdate = vi.fn(async (_p: MockPayload) => undefined);
    const conflictBagSelect = {
      customId: 'menu:bag_use:1',
      values: [String(inv3x.id)],
      guildId: 'g1',
      channelId: 'c1',
      user: makeUser('whale'),
      member: { id: 'whale', permissions: makePerms(), roles: { cache: new Map() } },
      replied: false,
      deferred: false,
      inCachedGuild: () => true,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => true,
      isUserSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      update: bagUpdate,
      reply: vi.fn(async () => undefined),
    } as unknown as StringSelectMenuInteraction & Interaction;
    await routeInteraction(conflictBagSelect, ctx);
    expect(bagUpdate.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('不同倍率');

    ctx.db.close();
  });

  it('preserves maxUses during ClientReady invite sync so pre-existing one-time invites attribute joins after restart', async () => {
    const ctx = createPersistentCtx();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    let readyHandler: ((readyClient: Client) => Promise<void>) | null = null;
    const fakeClient = {
      once: vi.fn((event: string, cb: (readyClient: Client) => Promise<void>) => {
        if (event === Events.ClientReady) {
          readyHandler = cb;
        }
      }),
    } as unknown as Client;

    const schedulers = registerReadyEvent(fakeClient, ctx);
    expect(readyHandler).not.toBeNull();

    const fetchedInvites = new Map([
      [
        'once-code',
        {
          code: 'once-code',
          uses: 0,
          inviterId: 'inviter-42',
          maxUses: 1,
        },
      ],
    ]);
    const readyClient = {
      user: {
        tag: 'TestBot#0001',
        setActivity: vi.fn(),
      },
      guilds: {
        cache: new Map([
          [
            'g1',
            {
              id: 'g1',
              invites: {
                fetch: vi.fn(async () => fetchedInvites),
              },
            },
          ],
        ]),
      },
    } as unknown as Client;

    await readyHandler!(readyClient);
    schedulers.stop();
    logSpy.mockRestore();

    // After the single-use invite is consumed, Discord omits it from the post-join list
    const match = ctx.services.invite.detectAndRecordJoin('g1', 'newcomer-1', []);
    expect(match).not.toBeNull();
    expect(match?.inviterId).toBe('inviter-42');
    expect(match?.inviteCode).toBe('once-code');

    ctx.db.close();
  });

  it('broadcasts royal easter egg publicly in both /rob slash command and /menu rob & rob_bank handlers', async () => {
    const ctx = createPersistentCtx();
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateEconomy('g1', {
      ...cfg.economy,
      robSuccessRate: 1.0,
      robBankSuccessRate: 1.0,
      robCooldownSec: 0,
    });

    // Attacker A: 50 pocket + 950 bank (total 1000 -> 10% = 100: 50 pocket + 50 bank)
    ctx.repos.profile.save({
      ...ctx.repos.profile.getOrCreate('g1', 'atk-slash'),
      coins: 50,
      bankCoins: 950,
    });
    const kingUser = {
      id: 'royal-target',
      username: 'strawberry',
      displayName: '草莓布丁酱',
      bot: false,
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    };
    const kingMember = {
      id: 'royal-target',
      displayName: '草莓布丁酱',
      nickname: '黑吊王',
      roles: {
        cache: new Map([['r-king', { id: 'r-king', name: '黑吊王' }]]),
      },
    };

    // 1. /rob slash command (pocket mode) -> public non-ephemeral reply with easter egg embed
    const slashReply = vi.fn(async (_p: MockPayload & { flags?: number }) => undefined);
    const slashInteraction = {
      guildId: 'g1',
      guild: {
        id: 'g1',
        members: { cache: new Map([['royal-target', kingMember]]) },
      },
      user: makeUser('atk-slash'),
      member: { id: 'atk-slash', permissions: makePerms(), roles: { cache: new Map() } },
      inCachedGuild: () => true,
      options: {
        getUser: () => kingUser,
        getString: () => 'pocket',
      },
      reply: slashReply,
    } as unknown as ChatInputCommandInteraction;

    await robCommand.execute(slashInteraction, ctx);
    expect(slashReply).toHaveBeenCalledTimes(1);
    const slashPayload = slashReply.mock.calls[0]![0];
    expect(slashPayload.flags).toBeUndefined();
    expect(slashPayload.allowedMentions).toEqual({ parse: [] });
    expect(slashPayload.embeds?.[0]?.toJSON().title).toContain('王者反噬');
    expect(slashPayload.embeds?.[0]?.toJSON().description).toContain('联动划扣银行存款');
    expect(ctx.repos.profile.getOrCreate('g1', 'atk-slash').coins).toBe(0);
    expect(ctx.repos.profile.getOrCreate('g1', 'atk-slash').bankCoins).toBe(900);
    expect(ctx.repos.profile.getOrCreate('g1', 'royal-target').coins).toBe(100);

    // 2. /menu rob & rob_bank handlers -> public channel broadcast + private feedback
    ctx.repos.profile.save({
      ...ctx.repos.profile.getOrCreate('g1', 'atk-menu'),
      coins: 100,
      bankCoins: 1900, // total 2000 -> 10% = 200 (100 pocket + 100 bank)
    });

    const send = vi.fn(async (_p: MockPayload) => ({ id: 'egg-pub-1' }));
    const editReply = vi.fn(async (_p: MockPayload) => undefined);
    const channel = { id: 'c1', isSendable: () => true, send };
    const makeMenuRobSelect = (customId: 'menu:user:rob' | 'menu:user:rob_bank') =>
      ({
        customId,
        values: ['royal-target'],
        users: new Map([['royal-target', kingUser]]),
        guildId: 'g1',
        guild: {
          id: 'g1',
          name: 'Test',
          channels: { cache: new Map([['c1', channel]]) },
          members: { cache: new Map([['royal-target', kingMember]]) },
        },
        channelId: 'c1',
        channel,
        client: {
          channels: { cache: new Map([['c1', channel]]), fetch: vi.fn(async () => channel) },
        },
        user: makeUser('atk-menu'),
        member: { id: 'atk-menu', permissions: makePerms(), roles: { cache: new Map() } },
        replied: false,
        deferred: false,
        inCachedGuild: () => true,
        isChatInputCommand: () => false,
        isButton: () => false,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => true,
        isRoleSelectMenu: () => false,
        isChannelSelectMenu: () => false,
        isModalSubmit: () => false,
        isRepliable: () => true,
        deferUpdate: vi.fn(async () => undefined),
        editReply,
        update: vi.fn(async () => undefined),
        reply: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      }) as unknown as UserSelectMenuInteraction & Interaction;

    await routeInteraction(makeMenuRobSelect('menu:user:rob'), ctx);
    expect(send).toHaveBeenCalledTimes(1);
    const menuPocketBroadcast = send.mock.calls[0]![0];
    expect(menuPocketBroadcast.content).toContain('王者反噬');
    expect(menuPocketBroadcast.embeds?.[0]?.toJSON().title).toContain('王者反噬');
    expect(editReply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('罚没总资产 10%');

    // Now atk-menu has 0 pocket + 1800 bank -> rob_bank takes 180 from bank -> target bank gains 180
    await routeInteraction(makeMenuRobSelect('menu:user:rob_bank'), ctx);
    expect(send).toHaveBeenCalledTimes(2);
    const menuBankBroadcast = send.mock.calls[1]![0];
    expect(menuBankBroadcast.content).toContain('皇家金库');
    expect(menuBankBroadcast.embeds?.[0]?.toJSON().title).toContain('皇家金库禁令');
    expect(ctx.repos.profile.getOrCreate('g1', 'atk-menu').bankCoins).toBe(1620);
    expect(ctx.repos.profile.getOrCreate('g1', 'royal-target').bankCoins).toBe(180);

    ctx.db.close();
  });
});
