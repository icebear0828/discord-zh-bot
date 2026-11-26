import {
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIEmbed,
  type APIMessageActionRowComponent,
  type APIStringSelectComponent,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { adventureCommand } from '../../src/commands/fun/adventure.js';
import { createDatabase } from '../../src/db/database.js';
import { AiMemoryRepo } from '../../src/db/repositories/aiMemoryRepo.js';
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
import { handleRpgButton, handleRpgStringSelect } from '../../src/interactions/rpgHandler.js';
import { AiService } from '../../src/services/aiService.js';
import { BlackjackManager } from '../../src/services/blackjackService.js';
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
import { RpgService, getRpgRealmInfo } from '../../src/services/rpgService.js';
import { ShopService } from '../../src/services/shopService.js';
import { SocialPetService } from '../../src/services/socialPetService.js';
import { TicketService } from '../../src/services/ticketService.js';
import { WorldEventService } from '../../src/services/worldEventService.js';
import type { AppContext } from '../../src/ui/embeds.js';
import type { BuiltMenuMessage, MenuActor } from '../../src/ui/menuShared.js';
import {
  buildPublicTrialCard,
  buildRpgClassSwitchView,
  buildRpgGearView,
  buildRpgHomeView,
  buildRpgTrialView,
} from '../../src/ui/rpgMenuBuilder.js';

const GUILD_ID = 'g-rpg-ui';
const USER_ID = 'u-hero-1';
const GAME_CHAT_ID = 'ch-game-chat';
const OTHER_CHANNEL_ID = 'ch-random-2';
const NOW = Date.UTC(2026, 4, 15, 10, 0, 0);

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
  const aiMemory = new AiMemoryRepo(db);
  const creditLoanRepo = new CreditLoanRepo(db);
  const rpgRepo = new RpgRepo(db);
  const llmClient = new LlmClient(undefined);

  const creditLoan = new CreditLoanService(
    db,
    guildConfig,
    profile,
    creditLoanRepo,
    'Asia/Shanghai',
    chaos,
  );
  const rpg = new RpgService(db, rpgRepo, profile, {
    timezone: 'Asia/Shanghai',
    guildConfigRepo: guildConfig,
    socialPetRepo: socialPet,
    onCoinsEarned: (gId, uId, gross, src, now) => {
      const r = creditLoan.garnishIncomingCoins(gId, uId, gross, src, now);
      return { garnished: r.garnished, net: r.netAmount };
    },
    onCreditChange: (gId, uId, delta, reason, now) => {
      creditLoan.adjustCredit(gId, uId, delta, reason, now);
    },
    getCreditScore: (gId, uId) => creditLoan.getCreditProfile(gId, uId).account.score,
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
    },
    services: {
      leveling: new LevelingService(guildConfig, profile, invite, creditLoan, rpg),
      economy: new EconomyService(db, guildConfig, profile, 'Asia/Shanghai', chaos, creditLoan),
      blackjack: new BlackjackManager(db, profile, creditLoan),
      shop: new ShopService(db, profile, shop, {
        guildConfigRepo: guildConfig,
        chaosRepo: chaos,
        socialPetRepo: socialPet,
        creditLoanService: creditLoan,
        timezone: 'Asia/Shanghai',
      }),
      fun: new FunService(db, profile, shop, fun, 'Asia/Shanghai'),
      ticket: new TicketService(guildConfig, ticket),
      giveaway: new GiveawayService(giveaway),
      invite: new InviteService(invite),
      rolePanel: new RolePanelService(rolePanel),
      multiplayer: new MultiplayerService(db, profile, redPacket, chaos, creditLoan),
      chaos: new ChaosService(db, guildConfig, profile, chaos, creditLoan),
      worldEvent: new WorldEventService(db, guildConfig, profile, worldEvent, socialPet, creditLoan),
      socialPet: new SocialPetService(
        db,
        guildConfig,
        profile,
        shop,
        socialPet,
        'Asia/Shanghai',
        creditLoan,
      ),
      ai: new AiService(guildConfig, aiMemory, llmClient),
      creditLoan,
      rpg,
    },
  };
}

function makeActor(id = USER_ID): MenuActor {
  return {
    id,
    displayName: '亚瑟勇者',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    isAdmin: false,
  };
}

interface MockPayload {
  content?: string;
  embeds?: ReadonlyArray<{ toJSON(): APIEmbed }>;
  components?: ReadonlyArray<{
    toJSON(): APIActionRowComponent<APIMessageActionRowComponent>;
  }>;
  flags?: number;
}

interface MockChannel {
  id: string;
  name: string;
  isTextBased: () => boolean;
  isThread: () => boolean;
  isSendable: () => boolean;
  send: ReturnType<typeof vi.fn<(payload: MockPayload) => Promise<{ id: string }>>>;
}

function makeMockChannel(opts?: {
  id?: string;
  name?: string;
  sendable?: boolean;
  failSend?: boolean;
}): MockChannel {
  const sendable = opts?.sendable ?? true;
  const failSend = opts?.failSend ?? false;
  return {
    id: opts?.id ?? GAME_CHAT_ID,
    name: opts?.name ?? '游戏聊天',
    isTextBased: () => true,
    isThread: () => false,
    isSendable: () => sendable,
    send: failSend
      ? vi.fn(async () => {
          throw new Error('50013 Missing Permissions');
        })
      : vi.fn(async () => ({ id: 'pub-msg-1' })),
  };
}

function makeMockMember(userId = USER_ID, isAdmin = false) {
  return {
    id: userId,
    permissions: {
      has: (perm: bigint) => isAdmin && perm === PermissionFlagsBits.Administrator,
    },
    roles: {
      cache: new Map<string, { id: string }>(),
    },
  };
}

function createButtonMock(opts: {
  customId: string;
  userId?: string;
  guildId?: string;
  channel?: MockChannel;
  guildChannels?: MockChannel[];
  messageEdit?: ReturnType<typeof vi.fn<(payload: MockPayload) => Promise<void>>>;
}) {
  const userId = opts.userId ?? USER_ID;
  const channel = opts.channel ?? makeMockChannel();
  const channelCache = new Map<string, MockChannel>();
  for (const ch of opts.guildChannels ?? [channel]) {
    channelCache.set(ch.id, ch);
  }
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const messageEdit = opts.messageEdit ?? vi.fn(async (_payload: MockPayload) => undefined);
  const interaction = {
    customId: opts.customId,
    guildId: opts.guildId ?? GUILD_ID,
    channelId: channel.id,
    channel,
    guild: {
      id: opts.guildId ?? GUILD_ID,
      channels: { cache: channelCache },
    },
    client: {
      channels: {
        cache: channelCache,
        fetch: vi.fn(async (id: string) => channelCache.get(id) ?? null),
      },
    },
    message: {
      id: 'orig-msg-1',
      edit: messageEdit,
    },
    user: {
      id: userId,
      displayName: '亚瑟勇者',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    member: makeMockMember(userId),
    inCachedGuild: () => true,
    update,
    reply,
  };
  return {
    interaction: interaction as unknown as ButtonInteraction,
    update,
    reply,
    channel,
    messageEdit,
  };
}

function createStringSelectMock(opts: {
  customId: string;
  values: string[];
  userId?: string;
  guildId?: string;
  channel?: MockChannel;
}) {
  const userId = opts.userId ?? USER_ID;
  const channel = opts.channel ?? makeMockChannel();
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const interaction = {
    customId: opts.customId,
    values: opts.values,
    guildId: opts.guildId ?? GUILD_ID,
    channelId: channel.id,
    channel,
    user: {
      id: userId,
      displayName: '亚瑟勇者',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    member: makeMockMember(userId),
    inCachedGuild: () => true,
    update,
    reply,
  };
  return {
    interaction: interaction as unknown as StringSelectMenuInteraction,
    update,
    reply,
    channel,
  };
}

function createSlashMock(opts?: { userId?: string; guildId?: string | null }) {
  const userId = opts?.userId ?? USER_ID;
  const guildId = opts && 'guildId' in opts ? opts.guildId : GUILD_ID;
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const interaction = {
    commandName: '冒险',
    guildId,
    user: {
      id: userId,
      displayName: '亚瑟勇者',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    member: makeMockMember(userId),
    inCachedGuild: () => Boolean(guildId),
    reply,
  };
  return {
    interaction: interaction as unknown as ChatInputCommandInteraction,
    reply,
  };
}

function assertDiscordComponentLimits(msg: BuiltMenuMessage | MockPayload): void {
  const rows = (msg.components ?? []).map((row) => row.toJSON());
  expect(rows.length).toBeLessThanOrEqual(5);
  for (const row of rows) {
    expect(row.components.length).toBeGreaterThan(0);
    expect(row.components.length).toBeLessThanOrEqual(5);
    for (const comp of row.components) {
      if (comp.type === ComponentType.Button && 'label' in comp && comp.label) {
        expect(comp.label.length).toBeLessThanOrEqual(80);
      }
      if (comp.type === ComponentType.StringSelect) {
        expect(comp.options.length).toBeGreaterThan(0);
        expect(comp.options.length).toBeLessThanOrEqual(25);
        for (const opt of comp.options) {
          expect(opt.label.length).toBeLessThanOrEqual(80);
        }
      }
    }
  }
}

function extractButtons(msg: BuiltMenuMessage | MockPayload): APIButtonComponentWithCustomId[] {
  const out: APIButtonComponentWithCustomId[] = [];
  for (const row of msg.components ?? []) {
    const json = row.toJSON();
    for (const comp of json.components) {
      if (comp.type === ComponentType.Button && 'custom_id' in comp) {
        out.push(comp);
      }
    }
  }
  return out;
}

function extractSelects(msg: BuiltMenuMessage | MockPayload): APIStringSelectComponent[] {
  const out: APIStringSelectComponent[] = [];
  for (const row of msg.components ?? []) {
    const json = row.toJSON();
    for (const comp of json.components) {
      if (comp.type === ComponentType.StringSelect) {
        out.push(comp);
      }
    }
  }
  return out;
}

describe('RPG UI Builders, Slash Command, & Interactions', () => {
  it('handles /冒险 command guards and opens onboarding vs home view', async () => {
    const ctx = createTestCtx();

    // Rejects DM usage
    const dmSlash = createSlashMock({ guildId: null });
    await adventureCommand.execute(dmSlash.interaction, ctx);
    expect(dmSlash.reply).toHaveBeenCalledTimes(1);
    expect(dmSlash.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    // Rejects when rpg module disabled
    const cfg = ctx.repos.guildConfig.getOrCreate(GUILD_ID);
    ctx.repos.guildConfig.updateModules(GUILD_ID, { ...cfg.modules, rpg: false });
    const disabledSlash = createSlashMock();
    await adventureCommand.execute(disabledSlash.interaction, ctx);
    expect(disabledSlash.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('未开启');
    ctx.repos.guildConfig.updateModules(GUILD_ID, { ...cfg.modules, rpg: true });

    // First-time user gets 4-class onboarding
    const firstSlash = createSlashMock();
    await adventureCommand.execute(firstSlash.interaction, ctx);
    const onboardingPayload = firstSlash.reply.mock.calls[0]![0];
    assertDiscordComponentLimits(onboardingPayload);
    expect(onboardingPayload.embeds?.[0]?.toJSON().title).toContain('选择你的初始职业');
    const btns = extractButtons(onboardingPayload);
    expect(btns.filter((b) => b.custom_id.startsWith('rpg:pick_class:'))).toHaveLength(4);

    // After selecting class -> opens new tier-based idle/boss home view
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'mage', NOW);
    const homeSlash = createSlashMock();
    await adventureCommand.execute(homeSlash.interaction, ctx);
    const homePayload = homeSlash.reply.mock.calls[0]![0];
    assertDiscordComponentLimits(homePayload);
    expect(homePayload.embeds?.[0]?.toJSON().title).toContain('十阶秘境与破境大厅');

    ctx.db.close();
  });

  it('builds RPG Home, Trial, PublicTrialCard, Gear, and ClassSwitch views within Discord limits', () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'warrior', NOW - 26 * 3_600_000);
    // Mark injured & at tier-1 gate
    ctx.repos.rpg.saveCharacter({
      ...ctx.services.rpg.getOrCreateCharacter(GUILD_ID, USER_ID, NOW),
      level: 9,
      xp: 3500,
      injuredUntil: NOW + 1_800_000,
      promoPills: 2,
      guardElixirs: 1,
      lastIdleClaimAt: NOW - 25 * 3_600_000,
    });

    const homeMsg = buildRpgHomeView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(homeMsg);
    const homeDesc = homeMsg.embeds[0]!.toJSON().description ?? '';
    expect(homeDesc).toContain('已满 24h 上限');
    expect(homeDesc).toContain('破境反噬重伤');
    expect(homeDesc).toContain('已达当前阶位九重巅峰');
    const homeBtns = extractButtons(homeMsg);
    expect(homeBtns.find((b) => b.custom_id === 'rpg:act:claim_idle')?.disabled).not.toBe(true);
    expect(homeBtns.find((b) => b.custom_id === 'rpg:act:heal_injury')).toBeDefined();

    const trialMsg = buildRpgTrialView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(trialMsg);
    const trialDesc = trialMsg.embeds[0]!.toJSON().description ?? '';
    expect(trialDesc).toContain('黑铁阶·一重');
    expect(trialDesc).toContain('晋升秘药');
    const trialBtns = extractButtons(trialMsg);
    expect(trialBtns.find((b) => b.custom_id === 'rpg:trial:solo')?.disabled).not.toBe(true);
    expect(trialBtns.find((b) => b.custom_id === 'rpg:trial:public')?.disabled).not.toBe(true);

    // Build pending & settled public trial cards
    const started = ctx.services.rpg.startPublicBreakthroughTrial(GUILD_ID, GAME_CHAT_ID, USER_ID, NOW);
    expect(started.ok).toBe(true);
    if (started.ok) {
      const econ = ctx.repos.guildConfig.getOrCreate(GUILD_ID).economy;
      const pendingCard = buildPublicTrialCard(started.trial, econ, undefined, NOW);
      assertDiscordComponentLimits(pendingCard);
      expect(extractButtons(pendingCard).map((b) => b.custom_id)).toEqual([
        `rpg:trial_help:${started.trial.id}`,
        `rpg:trial_jeer:${started.trial.id}`,
        `rpg:trial_settle:${started.trial.id}`,
      ]);

      ctx.services.rpg.interactPublicTrial(started.trial.id, 'u-sup-1', 'help', NOW + 1000);
      const settled = ctx.services.rpg.settlePublicTrial(
        started.trial.id,
        USER_ID,
        NOW + 2000,
        () => 0.0,
      );
      expect(settled.ok).toBe(true);
      if (settled.ok) {
        const doneCard = buildPublicTrialCard(settled.trial, econ, settled.supporterPayouts, NOW + 2000);
        assertDiscordComponentLimits(doneCard);
        expect(doneCard.components).toHaveLength(0);
        expect(doneCard.embeds[0]!.toJSON().description).toContain('<@u-sup-1>');
      }
    }

    // Add items and verify Gear view & ClassSwitch view
    ctx.repos.rpg.createItem({
      guildId: GUILD_ID,
      userId: USER_ID,
      name: '秘银圣剑',
      slot: 'weapon',
      rarity: 'epic',
      baseHp: 20,
      baseAtk: 40,
      baseDef: 8,
      baseCritBp: 500,
      equipped: true,
      enhanceLevel: 2,
      createdAt: NOW,
    });
    const gearView = buildRpgGearView(ctx, GUILD_ID, makeActor(), null, undefined, NOW);
    assertDiscordComponentLimits(gearView);
    expect(extractSelects(gearView)).toHaveLength(1);

    const switchView = buildRpgClassSwitchView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(switchView);
    expect(switchView.embeds[0]!.toJSON().description).toContain(getRpgRealmInfo(10).fullLabel);

    ctx.db.close();
  });

  it('handles onboarding, idle claim, boss raids, alchemy, heal injury, and solo breakthrough', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins(GUILD_ID, USER_ID, 50_000);
    const gameChat = makeMockChannel({ id: GAME_CHAT_ID, name: '游戏聊天' });

    // Pick class via button
    const pick = createButtonMock({ customId: 'rpg:pick_class:ranger', channel: gameChat });
    await handleRpgButton(pick.interaction, ctx);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.classKey).toBe('ranger');

    // Too soon idle claim gives info feedback
    const claimSoon = createButtonMock({ customId: 'rpg:act:claim_idle', channel: gameChat });
    await handleRpgButton(claimSoon.interaction, ctx);
    expect(claimSoon.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('未满 1 分钟');

    // Backdate idle timer by 3 hours -> claim succeeds
    const curChar = ctx.services.rpg.getOrCreateCharacter(GUILD_ID, USER_ID);
    ctx.repos.rpg.saveCharacter({
      ...curChar,
      lastIdleClaimAt: Date.now() - 3 * 3_600_000,
    });
    const claimOk = createButtonMock({ customId: 'rpg:act:claim_idle', channel: gameChat });
    await handleRpgButton(claimOk.interaction, ctx);
    expect(claimOk.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('挂机收菜成功');

    // Raid 1 & Raid all
    const raidOne = createButtonMock({ customId: 'rpg:act:raid_one', channel: gameChat });
    await handleRpgButton(raidOne.interaction, ctx);
    expect(raidOne.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('胜利');
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.totalBossKills).toBe(1);

    const raidAll = createButtonMock({ customId: 'rpg:act:raid_all', channel: gameChat });
    await handleRpgButton(raidAll.interaction, ctx);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.stamina).toBe(0);

    // Buy stamina & buy alchemy pills/elixirs & loadout
    const buyStam = createButtonMock({ customId: 'rpg:act:buy_stamina', channel: gameChat });
    await handleRpgButton(buyStam.interaction, ctx);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.stamina).toBe(1);

    const pillsBefore = ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.promoPills ?? 0;
    const elixirsBefore = ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.guardElixirs ?? 0;
    const buyPill = createButtonMock({ customId: 'rpg:alchemy:buy_pill', channel: gameChat });
    await handleRpgButton(buyPill.interaction, ctx);
    const buyElixir = createButtonMock({ customId: 'rpg:alchemy:buy_elixir', channel: gameChat });
    await handleRpgButton(buyElixir.interaction, ctx);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.promoPills).toBe(pillsBefore + 1);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.guardElixirs).toBe(elixirsBefore + 1);

    const cyclePill = createButtonMock({ customId: 'rpg:trial:cycle_pills', channel: gameChat });
    await handleRpgButton(cyclePill.interaction, ctx);
    const toggleGuard = createButtonMock({ customId: 'rpg:trial:toggle_guard', channel: gameChat });
    await handleRpgButton(toggleGuard.interaction, ctx);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.trialPillsStaged).toBe(1);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.trialUseGuard).toBe(true);

    // Set gate & injure -> test heal injury and solo breakthrough
    ctx.repos.rpg.saveCharacter({
      ...ctx.services.rpg.getOrCreateCharacter(GUILD_ID, USER_ID),
      level: 9,
      xp: 3500,
      injuredUntil: Date.now() + 3_000_000,
    });
    const healBtn = createButtonMock({ customId: 'rpg:act:heal_injury', channel: gameChat });
    await handleRpgButton(healBtn.interaction, ctx);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.injuredUntil).toBe(0);

    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const soloBtn = createButtonMock({ customId: 'rpg:trial:solo', channel: gameChat });
    await handleRpgButton(soloBtn.interaction, ctx);
    randSpy.mockRestore();
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.level).toBe(10);
    expect(
      gameChat.send.mock.calls.some(([p]) => (p.content ?? '').includes('单人冲关成功')),
    ).toBe(true);

    ctx.db.close();
  });

  it('strictly locks public breakthrough trial & broadcasts to #游戏聊天 and auto-refunds on send failure', async () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'paladin');
    ctx.repos.rpg.saveCharacter({
      ...ctx.services.rpg.getOrCreateCharacter(GUILD_ID, USER_ID),
      level: 9,
      xp: 3500,
      promoPills: 2,
      guardElixirs: 1,
      trialPillsStaged: 2,
      trialUseGuard: true,
    });

    // 1. Guild without #游戏聊天 refuses public trial without consuming pills
    const randomChannel = makeMockChannel({ id: OTHER_CHANNEL_ID, name: '生图区' });
    const noGameChatBtn = createButtonMock({
      customId: 'rpg:trial:public',
      channel: randomChannel,
      guildChannels: [randomChannel],
    });
    await handleRpgButton(noGameChatBtn.interaction, ctx);
    expect(noGameChatBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
      '未找到「#游戏聊天」',
    );
    expect(ctx.services.rpg.getPendingTrialForUser(GUILD_ID, USER_ID)).toBeNull();
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.promoPills).toBe(2);

    // 2. When #游戏聊天 send throws -> cancels trial and refunds pills & guard elixir
    const brokenGameChat = makeMockChannel({
      id: GAME_CHAT_ID,
      name: '游戏聊天',
      failSend: true,
    });
    const failedSendBtn = createButtonMock({
      customId: 'rpg:trial:public',
      channel: randomChannel,
      guildChannels: [randomChannel, brokenGameChat],
    });
    await handleRpgButton(failedSendBtn.interaction, ctx);
    expect(failedSendBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
      '全额退还',
    );
    expect(ctx.services.rpg.getPendingTrialForUser(GUILD_ID, USER_ID)).toBeNull();
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.promoPills).toBe(2);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.guardElixirs).toBe(1);

    // 3. When user clicks from #生图区 while #游戏聊天 exists -> card is strictly sent into #游戏聊天
    const gameChat = makeMockChannel({ id: GAME_CHAT_ID, name: '游戏聊天' });
    const launchBtn = createButtonMock({
      customId: 'rpg:trial:public',
      channel: randomChannel,
      guildChannels: [randomChannel, gameChat],
    });
    await handleRpgButton(launchBtn.interaction, ctx);
    expect(randomChannel.send).not.toHaveBeenCalled();
    expect(gameChat.send).toHaveBeenCalledTimes(1);
    const trial = ctx.services.rpg.getPendingTrialForUser(GUILD_ID, USER_ID)!;
    expect(trial).not.toBeNull();
    expect(trial.channelId).toBe(GAME_CHAT_ID);
    expect(trial.messageId).toBe('pub-msg-1');

    // 4. Owner cannot help/jeer own trial (ephemeral reply, no message edit)
    const selfHelp = createButtonMock({
      customId: `rpg:trial_help:${trial.id}`,
      userId: USER_ID,
      channel: gameChat,
    });
    await handleRpgButton(selfHelp.interaction, ctx);
    expect(selfHelp.reply).toHaveBeenCalledTimes(1);
    expect(selfHelp.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
    expect(selfHelp.update).not.toHaveBeenCalled();

    // 5. Another player helps & third player jeers -> updates public card
    const supHelp = createButtonMock({
      customId: `rpg:trial_help:${trial.id}`,
      userId: 'u-sup-1',
      channel: gameChat,
    });
    await handleRpgButton(supHelp.interaction, ctx);
    expect(supHelp.update).toHaveBeenCalledTimes(1);

    const sabJeer = createButtonMock({
      customId: `rpg:trial_jeer:${trial.id}`,
      userId: 'u-sab-1',
      channel: gameChat,
    });
    await handleRpgButton(sabJeer.interaction, ctx);
    expect(sabJeer.update).toHaveBeenCalledTimes(1);

    // Non-owner cannot early-settle
    const nonOwnerSettle = createButtonMock({
      customId: `rpg:trial_settle:${trial.id}`,
      userId: 'u-sup-1',
      channel: gameChat,
    });
    await handleRpgButton(nonOwnerSettle.interaction, ctx);
    expect(nonOwnerSettle.reply).toHaveBeenCalledTimes(1);
    expect(nonOwnerSettle.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    // Owner settles trial -> succeeds & updates card to remove buttons
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const ownerSettle = createButtonMock({
      customId: `rpg:trial_settle:${trial.id}`,
      userId: USER_ID,
      channel: gameChat,
    });
    await handleRpgButton(ownerSettle.interaction, ctx);
    randSpy.mockRestore();
    expect(ownerSettle.update).toHaveBeenCalledTimes(1);
    expect(ownerSettle.update.mock.calls[0]![0].components).toHaveLength(0);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.level).toBe(10);

    // Clicking stale help button after settlement gives ephemeral error AND refreshes stale card
    const staleHelp = createButtonMock({
      customId: `rpg:trial_help:${trial.id}`,
      userId: 'u-late-1',
      channel: gameChat,
    });
    await handleRpgButton(staleHelp.interaction, ctx);
    expect(staleHelp.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
    expect(staleHelp.messageEdit).toHaveBeenCalledTimes(1);

    ctx.db.close();
  });

  it('handles gear select, equip, best equip, enhance, unequip, salvage, and bulk salvage', async () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'warrior');
    ctx.repos.profile.addCoins(GUILD_ID, USER_ID, 20_000);

    const commonItem = ctx.repos.rpg.createItem({
      guildId: GUILD_ID,
      userId: USER_ID,
      name: '锈铁长剑',
      slot: 'weapon',
      rarity: 'common',
      baseHp: 5,
      baseAtk: 10,
      baseDef: 2,
      baseCritBp: 100,
      equipped: false,
      enhanceLevel: 0,
      createdAt: NOW,
    });
    const rareItem = ctx.repos.rpg.createItem({
      guildId: GUILD_ID,
      userId: USER_ID,
      name: '秘银重剑',
      slot: 'weapon',
      rarity: 'rare',
      baseHp: 25,
      baseAtk: 45,
      baseDef: 10,
      baseCritBp: 400,
      equipped: false,
      enhanceLevel: 0,
      createdAt: NOW + 1,
    });

    const selectMock = createStringSelectMock({
      customId: 'rpg:gear_select',
      values: [String(rareItem.id)],
    });
    await handleRpgStringSelect(selectMock.interaction, ctx);
    expect(selectMock.update).toHaveBeenCalledTimes(1);

    const bestBtn = createButtonMock({ customId: 'rpg:gear_equip_best' });
    await handleRpgButton(bestBtn.interaction, ctx);
    expect(ctx.repos.rpg.listItems(GUILD_ID, USER_ID).find((i) => i.id === rareItem.id)?.equipped).toBe(
      true,
    );

    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const enhBtn = createButtonMock({ customId: `rpg:gear_enhance:${rareItem.id}` });
    await handleRpgButton(enhBtn.interaction, ctx);
    randSpy.mockRestore();
    expect(
      ctx.repos.rpg.listItems(GUILD_ID, USER_ID).find((i) => i.id === rareItem.id)?.enhanceLevel,
    ).toBe(1);

    const bulkBtn = createButtonMock({ customId: 'rpg:gear_bulk_salvage' });
    await handleRpgButton(bulkBtn.interaction, ctx);
    expect(
      ctx.repos.rpg.listItems(GUILD_ID, USER_ID).find((i) => i.id === commonItem.id),
    ).toBeUndefined();

    const unequipBtn = createButtonMock({ customId: `rpg:gear_unequip:${rareItem.id}` });
    await handleRpgButton(unequipBtn.interaction, ctx);
    const salvageBtn = createButtonMock({ customId: `rpg:gear_salvage:${rareItem.id}` });
    await handleRpgButton(salvageBtn.interaction, ctx);
    expect(ctx.repos.rpg.listItems(GUILD_ID, USER_ID)).toHaveLength(0);

    ctx.db.close();
  });
});
