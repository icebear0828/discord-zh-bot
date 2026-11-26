import {
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIEmbed,
  type APIMessageActionRowComponent,
  type APIModalInteractionResponseCallbackData,
  type APIStringSelectComponent,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
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
import { runGamesTick } from '../../src/events/ready.js';
import { routeInteraction } from '../../src/interactions/router.js';
import {
  handleRpgButton,
  handleRpgModal,
  handleRpgStringSelect,
  handleRpgUserSelect,
} from '../../src/interactions/rpgHandler.js';
import { AiService } from '../../src/services/aiService.js';
import { BlackjackManager } from '../../src/services/blackjackService.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { CreditLoanService } from '../../src/services/creditLoanService.js';
import { DuelArenaService } from '../../src/services/duelArenaService.js';
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
import type { BuiltMenuMessage, MenuActor } from '../../src/ui/menuShared.js';
import {
  buildRpgCoopRaidCard,
  buildRpgCoopView,
  buildRpgDuelBetModal,
  buildRpgGearView,
  buildRpgHomeView,
  buildRpgPublicDuelCard,
  buildRpgPvpView,
} from '../../src/ui/rpgMenuBuilder.js';

const GUILD_ID = 'g-rpg-v2';
const HERO_1 = 'u-hero-1';
const HERO_2 = 'u-hero-2';
const HERO_3 = 'u-hero-3';
const GAME_CHAT_ID = 'ch-game-chat';
const IMAGE_CHAT_ID = 'ch-image-zone';
const NOW = Date.UTC(2026, 5, 20, 12, 0, 0);

function createV2Ctx(): AppContext {
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
    creditLoanService: creditLoan,
    isGamblingBlocked: (gId, uId, now) => creditLoan.isDeadbeatBlocked(gId, uId, now).blocked,
    recordGamblingResult: (gId, uId, stake, netProfit, now) => {
      creditLoan.recordGamblingResult(gId, uId, stake, netProfit, now);
    },
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
      worldEvent: new WorldEventService(
        db,
        guildConfig,
        profile,
        worldEvent,
        socialPet,
        creditLoan,
        rpg.createWorldBossBridge(),
      ),
      socialPet: new SocialPetService(
        db,
        guildConfig,
        profile,
        shop,
        socialPet,
        'Asia/Shanghai',
        creditLoan,
      ),
      ai: new AiService(guildConfig, aiMemory, new LlmClient(undefined)),
      creditLoan,
      rpg,
      duelArena: new DuelArenaService(db, profile, duel, chaos, creditLoan),
    },
  };
}

function makeActor(id = HERO_1, displayName = '兰斯洛特'): MenuActor {
  return {
    id,
    displayName,
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
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
  messages: {
    fetch: ReturnType<
      typeof vi.fn<
        (id: string) => Promise<{ edit: ReturnType<typeof vi.fn<(payload: MockPayload) => Promise<void>>> }>
      >
    >;
  };
  lastEdited?: ReturnType<typeof vi.fn<(payload: MockPayload) => Promise<void>>>;
}

function makeMockChannel(opts?: {
  id?: string;
  name?: string;
  sendable?: boolean;
  failSend?: boolean;
  msgId?: string;
}): MockChannel {
  const sendable = opts?.sendable ?? true;
  const failSend = opts?.failSend ?? false;
  const msgEdit = vi.fn(async (_payload: MockPayload) => undefined);
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
      : vi.fn(async () => ({ id: opts?.msgId ?? 'pub-msg-v2' })),
    messages: {
      fetch: vi.fn(async () => ({ edit: msgEdit })),
    },
    lastEdited: msgEdit,
  };
}

function makeMockMember(userId = HERO_1) {
  return {
    id: userId,
    permissions: {
      has: (perm: bigint) => perm === PermissionFlagsBits.SendMessages,
    },
    roles: {
      cache: new Map<string, { id: string }>(),
    },
  };
}

function assertDiscordLimits(msg: BuiltMenuMessage | MockPayload, label = 'view'): void {
  const embeds = msg.embeds ?? [];
  expect(embeds.length, `${label} embeds count`).toBeGreaterThanOrEqual(1);
  for (const emb of embeds) {
    const json = emb.toJSON();
    expect((json.description ?? '').length, `${label} embed description`).toBeLessThanOrEqual(4096);
    expect((json.title ?? '').length, `${label} embed title`).toBeLessThanOrEqual(256);
  }
  const rows = (msg.components ?? []).map((row) => row.toJSON());
  expect(rows.length, `${label} action rows`).toBeLessThanOrEqual(5);
  for (const row of rows) {
    expect(row.components.length, `${label} row components > 0`).toBeGreaterThan(0);
    expect(row.components.length, `${label} row components <= 5`).toBeLessThanOrEqual(5);
    for (const comp of row.components) {
      if (comp.type === ComponentType.Button && 'label' in comp && comp.label) {
        expect(comp.label.length, `${label} button label`).toBeLessThanOrEqual(80);
      }
      if (comp.type === ComponentType.StringSelect) {
        expect(comp.options.length, `${label} select options > 0`).toBeGreaterThan(0);
        expect(comp.options.length, `${label} select options <= 25`).toBeLessThanOrEqual(25);
        for (const opt of comp.options) {
          expect(opt.label.length, `${label} option label`).toBeLessThanOrEqual(80);
          if (opt.description) {
            expect(opt.description.length, `${label} option desc`).toBeLessThanOrEqual(100);
          }
        }
      }
    }
  }
}

function assertModalLimits(modalData: APIModalInteractionResponseCallbackData): void {
  expect(modalData.title.length).toBeLessThanOrEqual(45);
  expect(modalData.components.length).toBeLessThanOrEqual(5);
  for (const row of modalData.components) {
    if ('components' in row) {
      for (const input of row.components) {
        if ('label' in input && typeof input.label === 'string') {
          expect(input.label.length).toBeLessThanOrEqual(45);
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

function extractStringSelects(msg: BuiltMenuMessage | MockPayload): APIStringSelectComponent[] {
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

function createButtonInteraction(opts: {
  customId: string;
  userId?: string;
  channel?: MockChannel;
  guildChannels?: MockChannel[];
  callOrder?: string[];
}) {
  const userId = opts.userId ?? HERO_1;
  const channel = opts.channel ?? makeMockChannel();
  const channelCache = new Map<string, MockChannel>();
  for (const ch of opts.guildChannels ?? [channel]) {
    channelCache.set(ch.id, ch);
  }
  const update = vi.fn(async (_payload: MockPayload) => {
    opts.callOrder?.push('update');
  });
  const reply = vi.fn(async (_payload: MockPayload) => {
    opts.callOrder?.push('reply');
  });
  const showModal = vi.fn(async (_modal: { toJSON(): APIModalInteractionResponseCallbackData }) => {
    opts.callOrder?.push('showModal');
  });
  const messageEdit = vi.fn(async (_payload: MockPayload) => {
    opts.callOrder?.push('message.edit');
  });

  const interaction = {
    customId: opts.customId,
    guildId: GUILD_ID,
    channelId: channel.id,
    channel,
    guild: {
      id: GUILD_ID,
      channels: { cache: channelCache },
    },
    client: {
      channels: {
        cache: channelCache,
        fetch: vi.fn(async (id: string) => channelCache.get(id) ?? null),
      },
    },
    message: {
      id: 'card-msg-1',
      edit: messageEdit,
    },
    user: {
      id: userId,
      username: userId,
      displayName: `Hero-${userId}`,
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png',
    },
    member: makeMockMember(userId),
    inCachedGuild: () => true,
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
    showModal,
  };

  return {
    interaction: interaction as unknown as ButtonInteraction,
    update,
    reply,
    showModal,
    messageEdit,
    channel,
  };
}

function createStringSelectInteraction(opts: {
  customId: string;
  values: string[];
  userId?: string;
  channel?: MockChannel;
}) {
  const userId = opts.userId ?? HERO_1;
  const channel = opts.channel ?? makeMockChannel();
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const interaction = {
    customId: opts.customId,
    values: opts.values,
    guildId: GUILD_ID,
    channelId: channel.id,
    channel,
    user: {
      id: userId,
      username: userId,
      displayName: `Hero-${userId}`,
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png',
    },
    member: makeMockMember(userId),
    inCachedGuild: () => true,
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
    update,
    reply,
  };
  return {
    interaction: interaction as unknown as StringSelectMenuInteraction,
    update,
    reply,
  };
}

function createUserSelectInteraction(opts: {
  customId: string;
  targetId: string;
  targetBot?: boolean;
  userId?: string;
}) {
  const userId = opts.userId ?? HERO_1;
  const showModal = vi.fn(async (_modal: { toJSON(): APIModalInteractionResponseCallbackData }) => undefined);
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const users = new Map([
    [
      opts.targetId,
      { id: opts.targetId, bot: Boolean(opts.targetBot), displayName: `Target-${opts.targetId}` },
    ],
  ]);
  const interaction = {
    customId: opts.customId,
    values: [opts.targetId],
    users,
    guildId: GUILD_ID,
    channelId: GAME_CHAT_ID,
    user: {
      id: userId,
      username: userId,
      displayName: `Hero-${userId}`,
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png',
    },
    member: makeMockMember(userId),
    inCachedGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => true,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    replied: false,
    deferred: false,
    showModal,
    reply,
    update,
  };
  return {
    interaction: interaction as unknown as UserSelectMenuInteraction,
    showModal,
    reply,
    update,
  };
}

function createModalInteraction(opts: {
  customId: string;
  fields: Record<string, string>;
  userId?: string;
  channel?: MockChannel;
  guildChannels?: MockChannel[];
}) {
  const userId = opts.userId ?? HERO_1;
  const channel = opts.channel ?? makeMockChannel();
  const channelCache = new Map<string, MockChannel>();
  for (const ch of opts.guildChannels ?? [channel]) {
    channelCache.set(ch.id, ch);
  }
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const followUp = vi.fn(async (_payload: MockPayload) => undefined);
  const interaction = {
    customId: opts.customId,
    guildId: GUILD_ID,
    channelId: channel.id,
    channel,
    guild: {
      id: GUILD_ID,
      channels: { cache: channelCache },
    },
    client: {
      channels: {
        cache: channelCache,
        fetch: vi.fn(async (id: string) => channelCache.get(id) ?? null),
      },
    },
    user: {
      id: userId,
      username: userId,
      displayName: `Hero-${userId}`,
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png',
    },
    member: makeMockMember(userId),
    inCachedGuild: () => true,
    isFromMessage: () => true,
    fields: {
      getTextInputValue: (id: string) => opts.fields[id] ?? '',
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
    update,
    reply,
    followUp,
  };
  return {
    interaction: interaction as unknown as ModalSubmitInteraction,
    update,
    reply,
    followUp,
    channel,
  };
}

describe('RPG 2.0 UI, Forge, Abyss, PVP Arena/Duel, Co-op Raid, Router & Timers', () => {
  it('renders Home View with Arcane Dust, Arena Rating, Abyss progress, Abyss battle, and Share Profile affixes', async () => {
    const ctx = createV2Ctx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, HERO_1, 'mage', NOW);
    ctx.repos.profile.addCoins(GUILD_ID, HERO_1, 100_000);
    const baseChar = ctx.services.rpg.getOrCreateCharacter(GUILD_ID, HERO_1, NOW);
    ctx.repos.rpg.saveCharacter({
      ...baseChar,
      level: 8,
      arcaneDust: 250,
      arenaRating: 1380,
      abyssClearedTier: 0,
    });

    const legWeapon = ctx.repos.rpg.createItem({
      guildId: GUILD_ID,
      userId: HERO_1,
      name: '阿卡纳永恒法典',
      slot: 'weapon',
      rarity: 'legendary',
      baseHp: 80,
      baseAtk: 160,
      baseDef: 30,
      baseCritBp: 1500,
      enhanceLevel: 6,
      equipped: true,
      affixes: [
        { kind: 'lifesteal', valueBp: 1200 },
        { kind: 'crit_dmg', valueBp: 3500 },
        { kind: 'armor_pen', valueBp: 2000 },
      ],
      legendaryEffect: 'twin_meteor',
      affixesAwakened: true,
      createdAt: NOW,
    });
    expect(legWeapon.legendaryEffect).toBe('twin_meteor');

    const homeMsg = buildRpgHomeView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordLimits(homeMsg, 'home_v2');
    const homeDesc = homeMsg.embeds[0]!.toJSON().description ?? '';
    expect(homeDesc).toContain('奥术魔尘');
    expect(homeDesc).toContain('250');
    expect(homeDesc).toContain('1,380');
    expect(homeDesc).toContain('深渊');

    const homeBtns = extractButtons(homeMsg);
    expect(homeBtns.some((b) => b.custom_id === 'rpg:act:abyss')).toBe(true);
    expect(homeBtns.some((b) => b.custom_id === 'rpg:nav:pvp')).toBe(true);
    expect(homeBtns.some((b) => b.custom_id === 'rpg:nav:coop')).toBe(true);

    // Challenge Abyss Boss (first-clear costs 0 stamina and grants dust + epic/legendary)
    const gameChat = makeMockChannel({ id: GAME_CHAT_ID, name: '游戏聊天' });
    const abyssBtn = createButtonInteraction({ customId: 'rpg:act:abyss', channel: gameChat });
    await handleRpgButton(abyssBtn.interaction, ctx);
    expect(abyssBtn.update).toHaveBeenCalledTimes(1);
    const abyssPayload = abyssBtn.update.mock.calls[0]![0];
    assertDiscordLimits(abyssPayload, 'home_after_abyss');
    const abyssDesc = abyssPayload.embeds?.[0]?.toJSON().description ?? '';
    expect(abyssDesc).toContain('深渊');
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, HERO_1)?.abyssClearedTier).toBe(1);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, HERO_1)?.stamina).toBe(5);

    // Share profile card includes affixes/legendary effect & arena rating
    const shareBtn = createButtonInteraction({
      customId: 'rpg:act:share_profile',
      channel: gameChat,
    });
    await handleRpgButton(shareBtn.interaction, ctx);
    expect(gameChat.send).toHaveBeenCalled();
    const sharedEmbedJson = gameChat.send.mock.calls.at(-1)?.[0].embeds?.[0]?.toJSON();
    expect(sharedEmbedJson?.description).toContain('双生星陨');
    expect(sharedEmbedJson?.description).toContain('1,380');

    // Abyss defeat costs 0 stamina (naked hero at tier 9 on current date)
    const todayNow = Date.now();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, HERO_2, 'mage', todayNow);
    const weakChar = ctx.services.rpg.getOrCreateCharacter(GUILD_ID, HERO_2, todayNow);
    ctx.repos.rpg.saveCharacter({ ...weakChar, level: 73, abyssClearedTier: 9, stamina: 4 });
    const loseAbyss = createButtonInteraction({
      customId: 'rpg:act:abyss',
      userId: HERO_2,
      channel: gameChat,
    });
    await handleRpgButton(loseAbyss.interaction, ctx);
    expect(loseAbyss.update.mock.calls[0]?.[0].embeds?.[0]?.toJSON().description).toContain(
      '深渊挑战失利',
    );
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, HERO_2)?.stamina).toBe(4);

    ctx.db.close();
  });

  it('handles Gear Forge View: item lock protection, lock-affix cycling, and reforge with coins + arcane dust', async () => {
    const ctx = createV2Ctx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, HERO_1, 'warrior', NOW);
    ctx.repos.profile.addCoins(GUILD_ID, HERO_1, 200_000);
    const char = ctx.services.rpg.getOrCreateCharacter(GUILD_ID, HERO_1, NOW);
    ctx.repos.rpg.saveCharacter({ ...char, arcaneDust: 500 });

    const legSword = ctx.repos.rpg.createItem({
      guildId: GUILD_ID,
      userId: HERO_1,
      name: '晨曦裁决者',
      slot: 'weapon',
      rarity: 'legendary',
      baseHp: 60,
      baseAtk: 90,
      baseDef: 25,
      baseCritBp: 800,
      enhanceLevel: 3,
      equipped: false,
      affixes: [
        { kind: 'lifesteal', valueBp: 1100 },
        { kind: 'combo', valueBp: 1600 },
        { kind: 'thorns', valueBp: 1500 },
      ],
      legendaryEffect: 'phoenix_rebirth',
      affixesAwakened: true,
      createdAt: NOW,
    });

    const gearView = buildRpgGearView(ctx, GUILD_ID, makeActor(), legSword.id, undefined, NOW);
    assertDiscordLimits(gearView, 'gear_forge_v2');
    const gearDesc = gearView.embeds[0]!.toJSON().description ?? '';
    expect(gearDesc).toContain('奥术魔尘');
    expect(gearDesc).toContain('500');
    expect(gearDesc).toContain('嗜血');
    expect(gearDesc).toContain('不灭凤羽');

    // Lock item -> salvage button disabled & direct salvage call blocked with item_locked message
    const lockBtn = createButtonInteraction({ customId: `rpg:gear_lock:${legSword.id}` });
    await handleRpgButton(lockBtn.interaction, ctx);
    expect(ctx.repos.rpg.getItemById(legSword.id)?.locked).toBe(true);
    const lockedViewPayload = lockBtn.update.mock.calls[0]![0];
    assertDiscordLimits(lockedViewPayload, 'gear_locked_v2');
    const lockedSalvageBtn = extractButtons(lockedViewPayload).find((b) =>
      b.custom_id.startsWith('rpg:gear_salvage:'),
    );
    expect(lockedSalvageBtn?.disabled).toBe(true);

    const trySalvageLocked = createButtonInteraction({
      customId: `rpg:gear_salvage:${legSword.id}`,
    });
    await handleRpgButton(trySalvageLocked.interaction, ctx);
    expect(trySalvageLocked.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
      '锁定',
    );
    expect(ctx.repos.rpg.getItemById(legSword.id)).not.toBeNull();

    // Cycle lock affix: none -> 0 (锁第1条) -> reforge preserves 1st affix (lifesteal 1100bp)
    const cycleBtn1 = extractButtons(lockedViewPayload).find((b) =>
      b.custom_id.startsWith('rpg:gear_cycle_lock:'),
    );
    expect(cycleBtn1).toBeDefined();
    const cycle1 = createButtonInteraction({ customId: cycleBtn1!.custom_id });
    await handleRpgButton(cycle1.interaction, ctx);
    const afterCycle1 = cycle1.update.mock.calls[0]![0];
    assertDiscordLimits(afterCycle1, 'gear_cycle_1');
    const reforgeLockedBtn = extractButtons(afterCycle1).find((b) =>
      b.custom_id.startsWith('rpg:gear_reforge:'),
    );
    expect(reforgeLockedBtn?.custom_id).toBe(`rpg:gear_reforge:${legSword.id}:0`);

    const reforgeCall = createButtonInteraction({ customId: reforgeLockedBtn!.custom_id });
    await handleRpgButton(reforgeCall.interaction, ctx);
    const updatedItem = ctx.repos.rpg.getItemById(legSword.id)!;
    expect(updatedItem.affixes).toHaveLength(3);
    expect(updatedItem.affixes[0]).toEqual({ kind: 'lifesteal', valueBp: 1100 });
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, HERO_1)!.arcaneDust).toBeLessThan(500);

    ctx.db.close();
  });

  it('handles Async Arena fights & daily stipend, and routes Public Duel modal + UserSelect via router.ts with #游戏聊天 strict lock & 10062 reply-first safety', async () => {
    const ctx = createV2Ctx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, HERO_1, 'paladin', NOW);
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, HERO_2, 'ranger', NOW);
    ctx.repos.profile.addCoins(GUILD_ID, HERO_1, 50_000);
    ctx.repos.profile.addCoins(GUILD_ID, HERO_2, 50_000);

    // Build PVP view when opponent exists
    const pvpView = buildRpgPvpView(ctx, GUILD_ID, makeActor(HERO_1), undefined, NOW);
    assertDiscordLimits(pvpView, 'pvp_with_candidates');
    const arenaSelects = extractStringSelects(pvpView);
    expect(arenaSelects.some((s) => s.custom_id === 'rpg:arena_fight')).toBe(true);

    // Also verify PVP view when NO candidates exist (no empty StringSelect!)
    const emptyGuildId = 'g-empty-arena';
    ctx.services.rpg.chooseOrSwitchClass(emptyGuildId, HERO_1, 'warrior', NOW);
    const soloPvpView = buildRpgPvpView(ctx, emptyGuildId, makeActor(HERO_1), undefined, NOW);
    assertDiscordLimits(soloPvpView, 'pvp_no_candidates');
    expect(extractStringSelects(soloPvpView)).toHaveLength(0);

    // Claim daily Arena stipend
    const claimArena = createButtonInteraction({ customId: 'rpg:arena_claim', userId: HERO_1 });
    await handleRpgButton(claimArena.interaction, ctx);
    expect(claimArena.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('俸禄');

    // Fight HERO_2 mirror via StringSelect
    const fightSelect = createStringSelectInteraction({
      customId: 'rpg:arena_fight',
      values: [HERO_2],
      userId: HERO_1,
    });
    await handleRpgStringSelect(fightSelect.interaction, ctx);
    const fightDesc = fightSelect.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description ?? '';
    expect(fightDesc).toContain('天梯');
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, HERO_2)?.arenaRating).toBe(1000); // Defender loses nothing

    // Verify Modal truncation <= 45 chars even with extra-long currencyName
    const longModal = buildRpgDuelBetModal(
      'equalized',
      HERO_2,
      '超级无敌宇宙第一豪华闪耀至尊黄金星币名称超长测试货币',
    );
    assertModalLimits(longModal.toJSON());

    // Direct UserSelect guards: self-target & bot-target return ephemeral error
    const selfSel = createUserSelectInteraction({
      customId: 'rpg:duel_target:full',
      targetId: HERO_1,
      userId: HERO_1,
    });
    await handleRpgUserSelect(selfSel.interaction, ctx);
    expect(selfSel.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );

    const botSel = createUserSelectInteraction({
      customId: 'rpg:duel_target:full',
      targetId: 'u-bot-1',
      targetBot: true,
      userId: HERO_1,
    });
    await handleRpgUserSelect(botSel.interaction, ctx);
    expect(botSel.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );

    // Open duel button (rpg:duel_open:full) opens modal with target='open'
    const openBtn = createButtonInteraction({ customId: 'rpg:duel_open:full', userId: HERO_1 });
    await handleRpgButton(openBtn.interaction, ctx);
    expect(openBtn.showModal).toHaveBeenCalledTimes(1);
    expect(openBtn.showModal.mock.calls[0]![0].toJSON().custom_id).toBe('rpg:modal:duel:full:open');

    // Route UserSelect (rpg:duel_target:equalized) through routeInteraction -> opens modal!
    const userSel = createUserSelectInteraction({
      customId: 'rpg:duel_target:equalized',
      targetId: HERO_2,
      userId: HERO_1,
    });
    await routeInteraction(userSel.interaction, ctx);
    expect(userSel.showModal).toHaveBeenCalledTimes(1);
    const shownModalJson = userSel.showModal.mock.calls[0]![0].toJSON();
    assertModalLimits(shownModalJson);
    expect(shownModalJson.custom_id).toBe(`rpg:modal:duel:equalized:${HERO_2}`);

    // 1) Submit modal when #游戏聊天 send fails -> refunds bet & NEVER sends to #生图区!
    const imageChannel = makeMockChannel({ id: IMAGE_CHAT_ID, name: '生图区' });
    const brokenGameChat = makeMockChannel({
      id: GAME_CHAT_ID,
      name: '游戏聊天',
      failSend: true,
    });
    const coinsBeforeFail = ctx.repos.profile.getOrCreate(GUILD_ID, HERO_1).coins;
    const failedModal = createModalInteraction({
      customId: `rpg:modal:duel:equalized:${HERO_2}`,
      fields: { bet_amount: '5000' },
      userId: HERO_1,
      channel: imageChannel,
      guildChannels: [imageChannel, brokenGameChat],
    });
    await routeInteraction(failedModal.interaction, ctx);
    expect(imageChannel.send).not.toHaveBeenCalled();
    expect(ctx.repos.profile.getOrCreate(GUILD_ID, HERO_1).coins).toBe(coinsBeforeFail);
    expect(ctx.services.rpg.getPendingDuelForUser(GUILD_ID, HERO_1)).toBeNull();

    // 2) Submit modal with working #游戏聊天 -> strictly sends to #游戏聊天!
    const workingGameChat = makeMockChannel({ id: GAME_CHAT_ID, name: '游戏聊天' });
    const okModal = createModalInteraction({
      customId: `rpg:modal:duel:equalized:${HERO_2}`,
      fields: { bet_amount: '5000' },
      userId: HERO_1,
      channel: imageChannel,
      guildChannels: [imageChannel, workingGameChat],
    });
    await routeInteraction(okModal.interaction, ctx);
    expect(imageChannel.send).not.toHaveBeenCalled();
    expect(workingGameChat.send).toHaveBeenCalledTimes(1);

    const pendingDuel = ctx.services.rpg.getPendingDuelForUser(GUILD_ID, HERO_1)!;
    expect(pendingDuel).not.toBeNull();
    assertDiscordLimits(
      buildRpgPublicDuelCard(pendingDuel, ctx.repos.guildConfig.getOrCreate(GUILD_ID).economy),
      'pending_duel_card',
    );

    // Wrong opponent tries to accept -> ephemeral error FIRST, no update
    const wrongAcceptOrder: string[] = [];
    const wrongAccept = createButtonInteraction({
      customId: `rpg:duel_accept:${pendingDuel.id}`,
      userId: HERO_3,
      channel: workingGameChat,
      callOrder: wrongAcceptOrder,
    });
    await handleRpgButton(wrongAccept.interaction, ctx);
    expect(wrongAccept.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(wrongAccept.update).not.toHaveBeenCalled();

    // HERO_2 accepts duel -> settles & renders highlight rounds
    const acceptDuel = createButtonInteraction({
      customId: `rpg:duel_accept:${pendingDuel.id}`,
      userId: HERO_2,
      channel: workingGameChat,
    });
    await handleRpgButton(acceptDuel.interaction, ctx);
    expect(acceptDuel.update).toHaveBeenCalledTimes(1);
    const settledCardPayload = acceptDuel.update.mock.calls[0]![0];
    expect(settledCardPayload.components).toHaveLength(0);

    // Late click on already-settled duel -> reply BEFORE message.edit (10062 guard!)
    const staleOrder: string[] = [];
    const staleAccept = createButtonInteraction({
      customId: `rpg:duel_accept:${pendingDuel.id}`,
      userId: HERO_2,
      channel: workingGameChat,
      callOrder: staleOrder,
    });
    await handleRpgButton(staleAccept.interaction, ctx);
    expect(staleOrder[0]).toBe('reply');
    expect(staleOrder).toContain('message.edit');

    ctx.db.close();
  });

  it('handles 2~4p Co-op Raid recruitment, #游戏聊天 refund on send failure, manual launch, and ready.ts timer auto-mercenary settlement + duel expiry', async () => {
    const ctx = createV2Ctx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, HERO_1, 'warrior', NOW);
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, HERO_2, 'mage', NOW);
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, HERO_3, 'paladin', NOW);
    ctx.repos.profile.addCoins(GUILD_ID, HERO_1, 20_000);

    const coopView = buildRpgCoopView(ctx, GUILD_ID, makeActor(HERO_1), undefined, NOW);
    assertDiscordLimits(coopView, 'coop_view');
    expect(coopView.embeds[0]!.toJSON().description).toContain('2/2');

    // 1) Send failure to #游戏聊天 refunds leader ticket!
    const imageChannel = makeMockChannel({ id: IMAGE_CHAT_ID, name: '生图区' });
    const brokenGameChat = makeMockChannel({
      id: GAME_CHAT_ID,
      name: '游戏聊天',
      failSend: true,
    });
    const failedCoopStart = createButtonInteraction({
      customId: 'rpg:coop_start',
      userId: HERO_1,
      channel: imageChannel,
      guildChannels: [imageChannel, brokenGameChat],
    });
    await handleRpgButton(failedCoopStart.interaction, ctx);
    expect(imageChannel.send).not.toHaveBeenCalled();
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, HERO_1)?.coopTicketsToday).toBe(0);

    // 2) Working #游戏聊天 -> starts Raid #1, HERO_2 joins, HERO_1 launches manually!
    const gameChat = makeMockChannel({ id: GAME_CHAT_ID, name: '游戏聊天', msgId: 'raid-msg-1' });
    const startCoop1 = createButtonInteraction({
      customId: 'rpg:coop_start',
      userId: HERO_1,
      channel: imageChannel,
      guildChannels: [imageChannel, gameChat],
    });
    await handleRpgButton(startCoop1.interaction, ctx);
    expect(gameChat.send).toHaveBeenCalledTimes(1);
    const raid1 = ctx.services.rpg.getRecruitingRaidForLeader(GUILD_ID, HERO_1)!;
    expect(raid1).not.toBeNull();
    assertDiscordLimits(
      buildRpgCoopRaidCard(raid1, ctx.repos.guildConfig.getOrCreate(GUILD_ID).economy),
      'coop_recruiting_card',
    );

    const joinRaid = createButtonInteraction({
      customId: `rpg:coop_join:${raid1.id}`,
      userId: HERO_2,
      channel: gameChat,
    });
    await handleRpgButton(joinRaid.interaction, ctx);
    expect(joinRaid.update).toHaveBeenCalledTimes(1);

    const launchRaid = createButtonInteraction({
      customId: `rpg:coop_launch:${raid1.id}`,
      userId: HERO_1,
      channel: gameChat,
    });
    await handleRpgButton(launchRaid.interaction, ctx);
    expect(launchRaid.update).toHaveBeenCalledTimes(1);
    const completedRaid1 = ctx.services.rpg.getCoopRaidById(raid1.id)!;
    expect(['completed', 'failed']).toContain(completedRaid1.status);
    assertDiscordLimits(
      buildRpgCoopRaidCard(completedRaid1, ctx.repos.guildConfig.getOrCreate(GUILD_ID).economy),
      'coop_completed_card',
    );

    // Late join on settled raid -> reply FIRST before message.edit (10062 guard)
    const lateJoinOrder: string[] = [];
    const lateJoin = createButtonInteraction({
      customId: `rpg:coop_join:${raid1.id}`,
      userId: HERO_3,
      channel: gameChat,
      callOrder: lateJoinOrder,
    });
    await handleRpgButton(lateJoin.interaction, ctx);
    expect(lateJoinOrder[0]).toBe('reply');
    expect(lateJoinOrder).toContain('message.edit');

    // 3) Timer test: solo leader starts Raid #2 (1/4 humans) + open Public Duel, both expire -> runGamesTick auto-fills mercenaries & settles Raid #2 AND expires Duel with refund!
    const pastMs = Date.now() - 700_000;
    const soloRaidRes = ctx.services.rpg.startCoopRaidLobby(GUILD_ID, GAME_CHAT_ID, HERO_1, pastMs);
    expect(soloRaidRes.ok).toBe(true);
    if (!soloRaidRes.ok) return;
    ctx.services.rpg.bindCoopRaidMessage(soloRaidRes.raid.id, 'raid-msg-2', GAME_CHAT_ID);

    const openDuelRes = ctx.services.rpg.createPublicDuel({
      guildId: GUILD_ID,
      channelId: GAME_CHAT_ID,
      challengerId: HERO_1,
      rulesMode: 'full',
      betAmount: 3000,
      nowMs: pastMs,
    });
    expect(openDuelRes.ok).toBe(true);
    if (!openDuelRes.ok) return;
    ctx.services.rpg.bindPublicDuelMessage(openDuelRes.duel.id, 'duel-msg-2', GAME_CHAT_ID);
    const coinsWhileEscrowed = ctx.repos.profile.getOrCreate(GUILD_ID, HERO_1).coins;

    const timerChannel = makeMockChannel({ id: GAME_CHAT_ID, name: '游戏聊天' });
    const mockGuild = {
      id: GUILD_ID,
      channels: { cache: new Map([[GAME_CHAT_ID, timerChannel]]) },
    };
    const mockClient = {
      guilds: {
        cache: new Map([[GUILD_ID, mockGuild]]),
        fetch: vi.fn(async () => mockGuild),
      },
      channels: {
        cache: new Map([[GAME_CHAT_ID, timerChannel]]),
        fetch: vi.fn(async () => timerChannel),
      },
    } as unknown as Parameters<typeof runGamesTick>[0];

    await runGamesTick(mockClient, ctx);

    const settledRaid2 = ctx.services.rpg.getCoopRaidById(soloRaidRes.raid.id)!;
    expect(['completed', 'failed']).toContain(settledRaid2.status);
    expect(settledRaid2.mercIds.length).toBeGreaterThanOrEqual(1);

    const expiredDuel = ctx.services.rpg.getPublicDuelById(openDuelRes.duel.id)!;
    expect(expiredDuel.status).toBe('expired');
    expect(ctx.repos.profile.getOrCreate(GUILD_ID, HERO_1).coins).toBeGreaterThanOrEqual(
      coinsWhileEscrowed + 3000,
    );
    expect(timerChannel.lastEdited).toHaveBeenCalled();
    expect(timerChannel.send).toHaveBeenCalled();

    ctx.db.close();
  });

  it('blocks deadbeats with overdue loans from betting > 0 in Public Duels while allowing 0-bet honor spars', async () => {
    const ctx = createV2Ctx();
    const nowReal = Date.now();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, HERO_1, 'warrior', nowReal);

    // Create an overdue loan larger than pocket balance so HERO_1 remains an overdue deadbeat
    const loan = ctx.services.creditLoan.takeUsuryLoan(
      GUILD_ID,
      HERO_1,
      20_000,
      nowReal - 10 * 86_400_000,
    );
    expect(loan.ok).toBe(true);
    ctx.services.creditLoan.processOverdueLoans(nowReal);
    ctx.repos.profile.addCoins(GUILD_ID, HERO_1, 3_000);
    expect(ctx.services.creditLoan.isDeadbeatBlocked(GUILD_ID, HERO_1, nowReal).blocked).toBe(true);

    const gameChat = makeMockChannel({ id: GAME_CHAT_ID, name: '游戏聊天' });

    // Bet > 0 is blocked
    const betModal = createModalInteraction({
      customId: 'rpg:modal:duel:full:open',
      fields: { bet_amount: '1000' },
      userId: HERO_1,
      channel: gameChat,
      guildChannels: [gameChat],
    });
    await handleRpgModal(betModal.interaction, ctx);
    expect(gameChat.send).not.toHaveBeenCalled();
    expect(betModal.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('逾期');

    // Bet === 0 honor spar is allowed — and challenger can cancel it via duel_cancel!
    const honorModal = createModalInteraction({
      customId: 'rpg:modal:duel:equalized:open',
      fields: { bet_amount: '0' },
      userId: HERO_1,
      channel: gameChat,
      guildChannels: [gameChat],
    });
    await handleRpgModal(honorModal.interaction, ctx);
    expect(gameChat.send).toHaveBeenCalledTimes(1);

    const honorDuel = ctx.services.rpg.getPendingDuelForUser(GUILD_ID, HERO_1)!;
    expect(honorDuel).not.toBeNull();
    const nonOwnerCancel = createButtonInteraction({
      customId: `rpg:duel_cancel:${honorDuel.id}`,
      userId: HERO_2,
      channel: gameChat,
    });
    await handleRpgButton(nonOwnerCancel.interaction, ctx);
    expect(nonOwnerCancel.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );

    const ownerCancel = createButtonInteraction({
      customId: `rpg:duel_cancel:${honorDuel.id}`,
      userId: HERO_1,
      channel: gameChat,
    });
    await handleRpgButton(ownerCancel.interaction, ctx);
    expect(ownerCancel.update).toHaveBeenCalledTimes(1);
    expect(ctx.services.rpg.getPublicDuelById(honorDuel.id)?.status).toBe('cancelled');

    ctx.db.close();
  });
});
