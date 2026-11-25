import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { duelCommand } from '../../src/commands/economy/duel.js';
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
import {
  clearNicknameRevertCooldownForTest,
  handleGuildMemberUpdate,
} from '../../src/events/guildMemberUpdate.js';
import { runGamesTick } from '../../src/events/ready.js';
import { routeInteraction } from '../../src/interactions/router.js';
import { AiService } from '../../src/services/aiService.js';
import { BlackjackManager } from '../../src/services/blackjackService.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { CreditLoanService } from '../../src/services/creditLoanService.js';
import {
  DuelArenaService,
  ROULETTE_1V1_TURN_TTL_MS,
} from '../../src/services/duelArenaService.js';
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
import {
  buildDuelLobbyView,
  buildRouletteDuelCard,
  buildRpsDuelCard,
} from '../../src/ui/duelArenaBuilder.js';
import type { AppContext } from '../../src/ui/embeds.js';
import type { BuiltButtonMessage, BuiltMenuMessage } from '../../src/ui/menuShared.js';

function assertLimits(msg: BuiltMenuMessage | BuiltButtonMessage, label: string): void {
  expect(msg.embeds.length, `${label} embed count`).toBeGreaterThanOrEqual(1);
  expect(msg.embeds.length, `${label} embed count`).toBeLessThanOrEqual(10);
  for (const emb of msg.embeds) {
    const json = emb.toJSON();
    expect((json.description ?? '').length, `${label} description`).toBeLessThanOrEqual(4096);
    expect((json.title ?? '').length, `${label} title`).toBeLessThanOrEqual(256);
  }
  expect(msg.components.length, `${label} row count`).toBeLessThanOrEqual(5);
  for (const row of msg.components) {
    const rowJson = row.toJSON();
    expect(rowJson.components.length, `${label} row items`).toBeLessThanOrEqual(5);
  }
}

function createCtx(): AppContext {
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
  const blackjack = new BlackjackRepo(db);
  const duel = new DuelRepo(db);
  const monitor = new MonitorRepo(db);
  const creditLoanRepo = new CreditLoanRepo(db);
  const rpgRepo = new RpgRepo(db);

  const creditLoan = new CreditLoanService(db, guildConfig, profile, creditLoanRepo, 'Asia/Shanghai', chaos);
  const rpg = new RpgService(db, rpgRepo, profile, {
    timezone: 'Asia/Shanghai',
    guildConfigRepo: guildConfig,
    socialPetRepo: socialPet,
  });
  const duelArena = new DuelArenaService(db, profile, duel, chaos, creditLoan);

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
      blackjack,
      duel,
      monitor,
    },
    services: {
      leveling: new LevelingService(guildConfig, profile, invite, creditLoan, rpg),
      economy: new EconomyService(db, guildConfig, profile, 'Asia/Shanghai', chaos, creditLoan),
      blackjack: new BlackjackManager(db, profile, blackjack, creditLoan),
      shop: new ShopService(db, profile, shop, {
        guildConfigRepo: guildConfig,
        chaosRepo: chaos,
        socialPetRepo: socialPet,
        creditLoanService: creditLoan,
        rpgRepo,
        timezone: 'Asia/Shanghai',
      }),
      fun: new FunService(db, profile, shop, fun, 'Asia/Shanghai'),
      ticket: new TicketService(guildConfig, ticket),
      giveaway: new GiveawayService(giveaway),
      invite: new InviteService(invite),
      rolePanel: new RolePanelService(rolePanel),
      multiplayer: new MultiplayerService(db, profile, redPacket, chaos, duel, creditLoan),
      chaos: new ChaosService(db, guildConfig, profile, chaos, creditLoan),
      worldEvent: new WorldEventService(db, guildConfig, profile, worldEvent, socialPet, creditLoan),
      socialPet: new SocialPetService(db, guildConfig, profile, shop, socialPet, 'Asia/Shanghai', creditLoan),
      ai: new AiService(guildConfig, aiMemory, new LlmClient(undefined)),
      creditLoan,
      rpg,
      duelArena,
    },
  };
}

function makeMockMember(id: string, nickname: string | null, opts?: { failNick?: boolean; failTimeout?: boolean }) {
  const setNickname = opts?.failNick
    ? vi.fn(async () => {
        throw new Error('50013 Missing Permissions');
      })
    : vi.fn(async (next: string | null) => {
        member.nickname = next;
        return member;
      });
  const timeout = opts?.failTimeout
    ? vi.fn(async () => {
        throw new Error('50013 Missing Permissions');
      })
    : vi.fn(async () => member);

  const member = {
    id,
    displayName: nickname ?? `User-${id}`,
    nickname,
    roles: { cache: new Map() },
    permissions: { has: () => false },
    setNickname,
    timeout,
    guild: { id: 'g1' },
  };
  return member;
}

describe('duelArenaHandler, /决斗 command, guildMemberUpdate, and ready timers', () => {
  it('supports /决斗 command subcommands (rps, roulette, dice, rename)', async () => {
    const ctx = createCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 5000);
    ctx.repos.profile.addCoins('g1', 'u2', 5000);

    const makeCmdInteraction = (sub: string, opts: {
      opponent?: { id: string; bot: boolean; displayName: string };
      target?: { id: string; bot: boolean; displayName: string };
      integers?: Record<string, number | null>;
      strings?: Record<string, string | null>;
    }) => {
      const reply = vi.fn(async () => ({ resource: { message: { id: `msg_${sub}` } } }));
      const channelSend = vi.fn(async () => ({ id: 'pub_msg' }));
      const m2 = makeMockMember('u2', '小笨蛋');
      const interaction = {
        guildId: 'g1',
        channelId: 'ch1',
        inCachedGuild: () => true,
        user: {
          id: 'u1',
          displayName: '挑战者',
          displayAvatarURL: () => 'https://example.com/a.png',
        },
        member: {
          id: 'u1',
          roles: { cache: new Map() },
          permissions: { has: () => false },
        },
        guild: {
          id: 'g1',
          ownerId: 'owner1',
          members: { fetch: vi.fn(async () => m2) },
        },
        channel: { isSendable: () => true, send: channelSend },
        options: {
          getSubcommand: () => sub,
          getUser: (name: string) =>
            name === 'target' ? opts.target ?? null : opts.opponent ?? null,
          getInteger: (name: string) => opts.integers?.[name] ?? null,
          getString: (name: string) => opts.strings?.[name] ?? null,
        },
        reply,
      } as unknown as ChatInputCommandInteraction;
      return { interaction, reply, channelSend, m2 };
    };

    const rpsCall = makeCmdInteraction('rps', {
      opponent: { id: 'u2', bot: false, displayName: '对手' },
      integers: { rename_hours: 6, bet: 100 },
    });
    await duelCommand.execute(rpsCall.interaction, ctx);
    expect(rpsCall.reply).toHaveBeenCalledTimes(1);

    const rlCall = makeCmdInteraction('roulette', {
      opponent: { id: 'u2', bot: false, displayName: '对手' },
      integers: { bullets: 2, bet: 0, rename_hours: 0, timeout_minutes: 5 },
      strings: { custom_wager: '请客喝奶茶' },
    });
    await duelCommand.execute(rlCall.interaction, ctx);
    expect(rlCall.reply).toHaveBeenCalledTimes(1);

    const diceCall = makeCmdInteraction('dice', {
      opponent: { id: 'u2', bot: false, displayName: '对手' },
      integers: { bet: 200 },
    });
    await duelCommand.execute(diceCall.interaction, ctx);
    expect(diceCall.reply).toHaveBeenCalledTimes(1);

    // Grant u1 a nickname lock over u2 and invoke /决斗 改名
    ctx.repos.duel?.upsertNicknameLock({
      guildId: 'g1',
      targetId: 'u2',
      winnerId: 'u1',
      sourceType: 'rps',
      sourceId: 'rps_manual',
      originalNickname: null,
      originalNicknameCaptured: false,
      lockedNickname: null,
      fallbackMode: false,
      originalCardNickname: null,
      originalEquippedTitle: null,
      lastRenamedAt: 0,
      expiresAt: Date.now() + 3600_000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const renameCall = makeCmdInteraction('rename', {
      target: { id: 'u2', bot: false, displayName: '对手' },
      strings: { nickname: '手下败将' },
    });
    await duelCommand.execute(renameCall.interaction, ctx);
    expect(renameCall.m2.setNickname).toHaveBeenCalledWith('手下败将', expect.any(String));
    expect(renameCall.channelSend).toHaveBeenCalledTimes(1);
    expect(renameCall.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );

    ctx.db.close();
  });

  it('routes RPS Bo5 blind moves through routeInteraction and falls back to card/title lock on 50013', async () => {
    const ctx = createCtx();
    const channelSend = vi.fn(async () => ({ id: 'rps_card_msg' }));
    const m2 = makeMockMember('p2', '大佬', { failNick: true });
    const mockGuild = {
      id: 'g1',
      ownerId: 'owner_x',
      members: { fetch: vi.fn(async () => m2) },
    } as unknown as Guild;

    // 1. UserSelect menu:user:rps_duel -> showModal
    const showModal = vi.fn(async () => undefined);
    const selectInteraction = {
      guildId: 'g1',
      channelId: 'ch1',
      customId: 'menu:user:rps_duel',
      values: ['p2'],
      users: new Map([['p2', { id: 'p2', bot: false, displayName: 'p2' }]]),
      user: { id: 'p1', username: 'p1', displayName: 'p1', displayAvatarURL: () => 'https://x/1.png' },
      channel: { isSendable: () => true },
      inCachedGuild: () => false,
      memberPermissions: { has: () => false },
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isUserSelectMenu: () => true,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      showModal,
    } as unknown as UserSelectMenuInteraction;

    await routeInteraction(selectInteraction, ctx);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(showModal.mock.calls[0]![0].toJSON().custom_id).toBe('da:modal:rps:p2');

    // 2. Submit RPS modal -> sends public card
    const modalSubmit = {
      guildId: 'g1',
      channelId: 'ch1',
      customId: 'da:modal:rps:p2',
      user: { id: 'p1', username: 'p1', displayName: 'p1', displayAvatarURL: () => 'https://x/1.png' },
      channel: { id: 'ch1', isSendable: () => true, send: channelSend },
      inCachedGuild: () => false,
      memberPermissions: { has: () => false },
      isFromMessage: () => true,
      deferUpdate: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
      fields: {
        getTextInputValue: (id: string) => (id === 'renameHours' ? '24' : '0'),
      },
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isUserSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      isModalSubmit: () => true,
      isRepliable: () => true,
      replied: false,
      deferred: false,
    } as unknown as ModalSubmitInteraction;

    await routeInteraction(modalSubmit, ctx);
    expect(channelSend).toHaveBeenCalledTimes(1);

    const cardPayload = channelSend.mock.calls[0]![0] as BuiltButtonMessage;
    const acceptCustomId = (cardPayload.components[0]!.toJSON().components[0] as { custom_id: string }).custom_id;
    const duelId = acceptCustomId.split(':')[3]!;

    const makeBtn = (userId: string, customId: string) => {
      const update = vi.fn(async () => undefined);
      const reply = vi.fn(async () => undefined);
      const followUp = vi.fn(async () => undefined);
      const btn = {
        guildId: 'g1',
        channelId: 'ch1',
        guild: mockGuild,
        customId,
        user: { id: userId, username: userId, displayName: userId, displayAvatarURL: () => 'https://x/1.png' },
        channel: { isSendable: () => true, send: channelSend },
        message: { edit: vi.fn(async () => undefined) },
        inCachedGuild: () => false,
        isChatInputCommand: () => false,
        isButton: () => true,
        isStringSelectMenu: () => false,
        isUserSelectMenu: () => false,
        isRoleSelectMenu: () => false,
        isChannelSelectMenu: () => false,
        isModalSubmit: () => false,
        isRepliable: () => true,
        replied: false,
        deferred: false,
        update,
        reply,
        followUp,
      } as unknown as ButtonInteraction;
      return { btn, update, reply, followUp };
    };

    // 3. p2 accepts
    const acc = makeBtn('p2', `da:rps:accept:${duelId}`);
    await routeInteraction(acc.btn, ctx);
    expect(acc.update).toHaveBeenCalledTimes(1);

    // 4. p1 moves rock -> card MUST NOT reveal "石头" publicly!
    const m1 = makeBtn('p1', `da:rps:move:${duelId}:rock`);
    await routeInteraction(m1.btn, ctx);
    const blindCard = m1.update.mock.calls[0]![0] as BuiltButtonMessage;
    const blindDesc = blindCard.embeds[0]!.toJSON().description ?? '';
    expect(blindDesc).toContain('✅ 已锁定出拳');
    expect(blindDesc).not.toContain('✊ 石头');
    expect(m1.followUp).toHaveBeenCalledTimes(1);

    // 5. p2 moves scissors -> round resolves 1:0, then win 2 more rounds
    await routeInteraction(makeBtn('p2', `da:rps:move:${duelId}:scissors`).btn, ctx);
    for (let i = 0; i < 2; i++) {
      await routeInteraction(makeBtn('p1', `da:rps:move:${duelId}:rock`).btn, ctx);
      await routeInteraction(makeBtn('p2', `da:rps:move:${duelId}:scissors`).btn, ctx);
    }
    const settled = ctx.services.duelArena?.getRpsDuel(duelId);
    expect(settled?.status).toBe('completed');
    expect(settled?.winnerId).toBe('p1');

    // 6. Click rename button -> modal -> submit nickname -> 50013 triggers fallback!
    const nickBtnShowModal = vi.fn(async () => undefined);
    const nickBtn = {
      guildId: 'g1',
      channelId: 'ch1',
      customId: 'da:nick_btn:p2',
      user: { id: 'p1', username: 'p1', displayName: 'p1' },
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isUserSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      replied: false,
      deferred: false,
      showModal: nickBtnShowModal,
    } as unknown as ButtonInteraction;
    await routeInteraction(nickBtn, ctx);
    expect(nickBtnShowModal.mock.calls[0]![0].toJSON().custom_id).toBe('da:modal:rename:p2:card');

    const nickReply = vi.fn(async () => undefined);
    const nickModal = {
      guildId: 'g1',
      channelId: 'ch1',
      guild: mockGuild,
      customId: 'da:modal:rename:p2:card',
      user: { id: 'p1', username: 'p1', displayName: 'p1', displayAvatarURL: () => 'https://x/1.png' },
      channel: { isSendable: () => true, send: channelSend },
      inCachedGuild: () => false,
      memberPermissions: { has: () => false },
      isFromMessage: () => true,
      fields: { getTextInputValue: () => '公开处刑名' },
      reply: nickReply,
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isUserSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      isModalSubmit: () => true,
      isRepliable: () => true,
      replied: false,
      deferred: false,
    } as unknown as ModalSubmitInteraction;
    await routeInteraction(nickModal, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'p2').cardNickname).toBe('公开处刑名');
    expect(ctx.repos.profile.getOrCreate('g1', 'p2').equippedTitle).toBe('公开处刑名');
    expect(nickReply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));

    // Validate lobby & card UI limits
    const lobby = buildDuelLobbyView(
      ctx,
      'g1',
      { id: 'p1', displayName: 'p1', avatarUrl: 'https://x/1.png' },
      undefined,
    );
    assertLimits(lobby, 'duel_lobby_with_locks');
    if (settled) {
      assertLimits(buildRpsDuelCard(settled, ctx.repos.guildConfig.getOrCreate('g1').economy), 'rps_completed');
    }

    // StringSelect da:nick_pick opens rename modal with :menu suffix
    const pickShowModal = vi.fn(async () => undefined);
    const pickSelect = {
      guildId: 'g1',
      channelId: 'ch1',
      customId: 'da:nick_pick',
      values: ['p2'],
      user: { id: 'p1', username: 'p1', displayName: 'p1' },
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => true,
      isUserSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      replied: false,
      deferred: false,
      showModal: pickShowModal,
    } as unknown as StringSelectMenuInteraction;
    await routeInteraction(pickSelect, ctx);
    expect(pickShowModal.mock.calls[0]![0].toJSON().custom_id).toBe('da:modal:rename:p2:menu');

    ctx.db.close();
  });

  it('reverts loser self-rename in GuildMemberUpdate and restores original nickname in runGamesTick on expiry & roulette timeout', async () => {
    clearNicknameRevertCooldownForTest();
    const ctx = createCtx();
    const arena = ctx.services.duelArena!;
    const now = Date.now();

    // Active Discord nickname lock
    ctx.repos.duel?.upsertNicknameLock({
      guildId: 'g1',
      targetId: 'loser1',
      winnerId: 'winner1',
      sourceType: 'rps',
      sourceId: 'rps_1',
      originalNickname: '原来的名字',
      originalNicknameCaptured: true,
      lockedNickname: '败方新名字',
      fallbackMode: false,
      originalCardNickname: null,
      originalEquippedTitle: null,
      lastRenamedAt: now - 20_000,
      expiresAt: now + 60_000,
      createdAt: now - 30_000,
      updatedAt: now - 20_000,
    });

    const mLoser = makeMockMember('loser1', '偷偷改回');
    await handleGuildMemberUpdate(
      { nickname: '败方新名字' } as unknown as GuildMember,
      mLoser as unknown as GuildMember,
      ctx,
      now,
    );
    expect(mLoser.setNickname).toHaveBeenCalledWith('败方新名字', expect.any(String));

    // Now expire the lock and verify runGamesTick restores '原来的名字'
    ctx.db.prepare('UPDATE nickname_locks SET expires_at = ? WHERE target_id = ?').run(now - 1000, 'loser1');

    // Also create a 1v1 roulette about to timeout and hit a bullet (3 bullets, chamber 0 forced loaded)
    const rl = arena.createRouletteDuel({
      guildId: 'g1',
      channelId: 'ch1',
      challengerId: 'c1',
      opponentId: 'o1',
      bullets: 1,
      renameHours: 0,
      timeoutMinutes: 5,
      nowMs: now - 60_000,
    });
    expect(rl.ok).toBe(true);
    if (!rl.ok) return;
    arena.bindRouletteDuelMessage(rl.duel.id, 'rl_msg_1');
    const acc = arena.acceptRouletteDuel(rl.duel.id, 'o1', now - 50_000, () => 0.1);
    expect(acc.ok).toBe(true);
    if (!acc.ok) return;
    // Force bullet at chamber 0 & expired turn deadline
    ctx.repos.duel?.saveRouletteDuel({
      ...acc.duel,
      bulletPositions: [0],
      turnDeadline: now - 1000,
    });

    const mTimeoutLoser = makeMockMember('c1', '老C');
    const channelMsgEdit = vi.fn(async () => undefined);
    const channelSend = vi.fn(async () => ({ id: 'notice_1' }));
    const mockChannel = {
      isTextBased: () => true,
      isSendable: () => true,
      messages: { fetch: vi.fn(async () => ({ edit: channelMsgEdit })) },
      send: channelSend,
    };
    const mockGuild = {
      id: 'g1',
      ownerId: 'owner',
      channels: { cache: new Map([['ch1', mockChannel]]) },
      members: {
        fetch: vi.fn(async (id: string) => (id === 'loser1' ? mLoser : mTimeoutLoser)),
      },
    };
    const mockClient = {
      guilds: {
        cache: new Map([['g1', mockGuild]]),
        fetch: vi.fn(async () => mockGuild),
      },
      channels: {
        cache: new Map([['ch1', mockChannel]]),
        fetch: vi.fn(async () => mockChannel),
      },
    } as unknown as Parameters<typeof runGamesTick>[0];

    await runGamesTick(mockClient, ctx);

    expect(mLoser.setNickname).toHaveBeenCalledWith('原来的名字', expect.any(String));
    expect(mTimeoutLoser.timeout).toHaveBeenCalledWith(5 * 60 * 1000, expect.any(String));
    expect(channelMsgEdit).toHaveBeenCalled();
    expect(channelSend).toHaveBeenCalled();

    const completedRl = arena.getRouletteDuel(rl.duel.id);
    expect(completedRl?.status).toBe('completed');
    if (completedRl) {
      assertLimits(
        buildRouletteDuelCard(completedRl, ctx.repos.guildConfig.getOrCreate('g1').economy),
        'rl1v1_completed',
      );
    }

    expect(ROULETTE_1V1_TURN_TTL_MS).toBe(30_000);
    ctx.db.close();
  });
});
