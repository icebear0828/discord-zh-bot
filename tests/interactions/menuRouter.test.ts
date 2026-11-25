import {
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIEmbed,
  type APIMessageActionRowComponent,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { menuCommand } from '../../src/commands/general/menu.js';
import { configCommand } from '../../src/commands/general/config.js';
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
import { AiMemoryRepo } from '../../src/db/repositories/aiMemoryRepo.js';
import { CreditLoanRepo } from '../../src/db/repositories/creditLoanRepo.js';
import { RpgRepo } from '../../src/db/repositories/rpgRepo.js';
import { routeInteraction } from '../../src/interactions/router.js';
import { BlackjackManager } from '../../src/services/blackjackService.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { CreditLoanService } from '../../src/services/creditLoanService.js';
import { EconomyService } from '../../src/services/economyService.js';
import { FunService } from '../../src/services/funService.js';
import { GiveawayService } from '../../src/services/giveawayService.js';
import { InviteService } from '../../src/services/inviteService.js';
import { LevelingService } from '../../src/services/levelingService.js';
import { MultiplayerService } from '../../src/services/multiplayerService.js';
import { RolePanelService } from '../../src/services/rolePanelService.js';
import { RpgService } from '../../src/services/rpgService.js';
import { ShopService } from '../../src/services/shopService.js';
import { SocialPetService } from '../../src/services/socialPetService.js';
import { TicketService } from '../../src/services/ticketService.js';
import { WorldEventService } from '../../src/services/worldEventService.js';
import { LlmClient } from '../../src/services/llmClient.js';
import { AiService } from '../../src/services/aiService.js';
import type { AppContext } from '../../src/ui/embeds.js';

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

interface MockUserInput {
  id: string;
  displayName?: string;
  bot?: boolean;
}

function makeMockUser(input: MockUserInput) {
  return {
    id: input.id,
    displayName: input.displayName ?? `User-${input.id}`,
    bot: input.bot ?? false,
    displayAvatarURL: () => `https://cdn.discordapp.com/embed/avatars/0.png`,
  };
}

interface MockPayload {
  content?: string;
  allowedMentions?: { parse?: string[]; users?: string[] };
  embeds?: ReadonlyArray<{ toJSON(): APIEmbed }>;
  components?: ReadonlyArray<{
    toJSON(): APIActionRowComponent<APIMessageActionRowComponent>;
  }>;
  flags?: number;
}

interface MockChannel {
  id: string;
  isSendable: () => boolean;
  send: ReturnType<typeof vi.fn<(payload: MockPayload) => Promise<{ id: string }>>>;
}

function makeMockChannel(sendable = true, nextMsgId = 'pub-msg-1'): MockChannel {
  return {
    id: 'c1',
    isSendable: () => sendable,
    send: vi.fn(async () => ({ id: nextMsgId })),
  };
}

function makeMockMember(
  userId: string,
  isAdmin = false,
  failRoleAdd = false,
  initialRoles: string[] = [],
) {
  const rolesAdd = failRoleAdd
    ? vi.fn(async () => {
        throw new Error('50013 Missing Permissions');
      })
    : vi.fn(async () => undefined);
  const rolesRemove = failRoleAdd
    ? vi.fn(async () => {
        throw new Error('50013 Missing Permissions');
      })
    : vi.fn(async () => undefined);
  const cache = new Map<string, { id: string }>(initialRoles.map((id) => [id, { id }]));

  return {
    id: userId,
    permissions: {
      has: (perm: bigint) => isAdmin && perm === PermissionFlagsBits.Administrator,
    },
    roles: {
      cache,
      add: rolesAdd,
      remove: rolesRemove,
    },
  };
}

function createChatCommandMock(opts: {
  commandName: string;
  userId: string;
  mode?: string | null;
  isAdmin?: boolean;
  channel?: MockChannel;
  subcommand?: string;
  subcommandGroup?: string | null;
  strings?: Record<string, string>;
  integers?: Record<string, number>;
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const followUp = vi.fn(async (_payload: MockPayload) => undefined);
  const channel = opts.channel ?? makeMockChannel(true);
  const member = makeMockMember(opts.userId, opts.isAdmin ?? false);

  const mock = {
    commandName: opts.commandName,
    guildId: 'g1',
    guild: { id: 'g1', name: '测试服务器' },
    channelId: channel.id,
    channel,
    user: makeMockUser({ id: opts.userId }),
    member,
    replied: false,
    deferred: false,
    options: {
      getString: (name: string, required?: boolean) => {
        if (name === 'mode') return opts.mode ?? null;
        const val = opts.strings?.[name] ?? null;
        if (required && val === null) throw new Error(`Missing string option: ${name}`);
        return val;
      },
      getInteger: (name: string, required?: boolean) => {
        const val = opts.integers?.[name] ?? null;
        if (required && val === null) throw new Error(`Missing integer option: ${name}`);
        return val;
      },
      getSubcommandGroup: () => opts.subcommandGroup ?? null,
      getSubcommand: () => opts.subcommand ?? '',
    },
    inCachedGuild: () => true,
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply,
    followUp,
  };

  return {
    interaction: mock as unknown as ChatInputCommandInteraction & Interaction,
    reply,
    followUp,
    channel,
  };
}

function createButtonMock(opts: {
  customId: string;
  userId: string;
  isAdmin?: boolean;
  channel?: MockChannel | null;
  fetchedChannel?: MockChannel | null;
  messageCustomIds?: string[];
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const editReply = vi.fn(async (_payload: MockPayload) => undefined);
  const followUp = vi.fn(async (_payload: MockPayload) => undefined);
  const deferUpdate = vi.fn(async () => undefined);
  const showModal = vi.fn(async (_modal: { toJSON(): { custom_id: string } }) => undefined);
  const msgEdit = vi.fn(async (_payload: MockPayload) => undefined);
  const channel = opts.channel === undefined ? makeMockChannel(true) : opts.channel;
  const fetchChannel = vi.fn(async () => opts.fetchedChannel ?? null);

  const messageComponents = opts.messageCustomIds
    ? [
        {
          type: ComponentType.ActionRow,
          components: opts.messageCustomIds.map((id) => ({ customId: id })),
        },
      ]
    : [];

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    guild: { id: 'g1', name: '测试服务器', channels: { cache: new Map() } },
    channelId: channel?.id ?? 'c1',
    channel,
    client: {
      channels: {
        cache: new Map(),
        fetch: fetchChannel,
      },
    },
    user: makeMockUser({ id: opts.userId }),
    member: makeMockMember(opts.userId, opts.isAdmin ?? false),
    replied: false,
    deferred: false,
    message: {
      id: 'ephem-msg-1',
      components: messageComponents,
      edit: msgEdit,
    },
    inCachedGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply,
    update,
    editReply,
    followUp,
    deferUpdate,
    showModal,
  };

  return {
    interaction: mock as unknown as ButtonInteraction & Interaction,
    reply,
    update,
    editReply,
    followUp,
    deferUpdate,
    showModal,
    msgEdit,
    channel,
    fetchChannel,
  };
}

function createStringSelectMock(opts: {
  customId: string;
  userId: string;
  values: string[];
  isAdmin?: boolean;
  failRoleAdd?: boolean;
  initialRoles?: string[];
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const deferUpdate = vi.fn(async () => undefined);
  const editReply = vi.fn(async (_payload: MockPayload) => undefined);
  const followUp = vi.fn(async (_payload: MockPayload) => undefined);
  const showModal = vi.fn(async (_modal: { toJSON(): { custom_id: string } }) => undefined);
  const member = makeMockMember(
    opts.userId,
    opts.isAdmin ?? false,
    opts.failRoleAdd ?? false,
    opts.initialRoles ?? [],
  );
  const channel = makeMockChannel(true);

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    guild: { id: 'g1', name: '测试服务器', channels: { cache: new Map() } },
    channelId: channel.id,
    channel,
    client: {
      channels: {
        cache: new Map(),
        fetch: vi.fn(async () => null),
      },
    },
    values: opts.values,
    user: makeMockUser({ id: opts.userId }),
    member,
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
    reply,
    update,
    deferUpdate,
    editReply,
    followUp,
    showModal,
  };

  return {
    interaction: mock as unknown as StringSelectMenuInteraction & Interaction,
    reply,
    update,
    deferUpdate,
    editReply,
    followUp,
    showModal,
    member,
  };
}

function createUserSelectMock(opts: {
  customId: string;
  userId: string;
  target: MockUserInput;
  isAdmin?: boolean;
  channel?: MockChannel | null;
  fetchedChannel?: MockChannel | null;
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const deferUpdate = vi.fn(async () => undefined);
  const editReply = vi.fn(async (_payload: MockPayload) => undefined);
  const followUp = vi.fn(async (_payload: MockPayload) => undefined);
  const showModal = vi.fn(async (_modal: { toJSON(): { custom_id: string } }) => undefined);
  const channel = opts.channel === undefined ? makeMockChannel(true) : opts.channel;
  const fetchChannel = vi.fn(async () => opts.fetchedChannel ?? null);
  const targetUser = makeMockUser(opts.target);
  const usersMap = new Map([[targetUser.id, targetUser]]);

  const users = {
    get: (id: string) => usersMap.get(id),
    first: () => targetUser,
  };

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    guild: { id: 'g1', name: '测试服务器', channels: { cache: new Map() } },
    channelId: channel?.id ?? 'c1',
    channel,
    client: {
      channels: {
        cache: new Map(),
        fetch: fetchChannel,
      },
    },
    values: [targetUser.id],
    users,
    user: makeMockUser({ id: opts.userId }),
    member: makeMockMember(opts.userId, opts.isAdmin ?? false),
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
    reply,
    update,
    deferUpdate,
    editReply,
    followUp,
    showModal,
  };

  return {
    interaction: mock as unknown as UserSelectMenuInteraction & Interaction,
    reply,
    update,
    deferUpdate,
    editReply,
    followUp,
    showModal,
    channel,
    fetchChannel,
  };
}

function createModalMock(opts: {
  customId: string;
  userId: string;
  fields: Record<string, string>;
  isAdmin?: boolean;
  fromMessage?: boolean;
  channel?: MockChannel;
  membersMap?: Map<string, { id: string; user: ReturnType<typeof makeMockUser> }>;
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const followUp = vi.fn(async (_payload: MockPayload) => undefined);
  const deferUpdate = vi.fn(async () => undefined);
  const deferReply = vi.fn(async () => undefined);
  const editReply = vi.fn(async (_payload: MockPayload) => undefined);
  const channel = opts.channel ?? makeMockChannel(true);
  const fromMessage = opts.fromMessage ?? true;
  const membersMap = opts.membersMap ?? new Map();

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    guild: {
      id: 'g1',
      name: '测试服务器',
      channels: { cache: new Map() },
      members: {
        fetch: vi.fn(async () => membersMap),
      },
    },
    channelId: channel.id,
    channel,
    client: {
      channels: {
        cache: new Map(),
        fetch: vi.fn(async () => null),
      },
    },
    user: makeMockUser({ id: opts.userId }),
    member: makeMockMember(opts.userId, opts.isAdmin ?? false),
    replied: false,
    deferred: false,
    fields: {
      getTextInputValue: (id: string) => opts.fields[id] ?? '',
    },
    inCachedGuild: () => true,
    isFromMessage: () => fromMessage,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isModalSubmit: () => true,
    isRepliable: () => true,
    reply,
    update,
    followUp,
    deferUpdate,
    deferReply,
    editReply,
  };

  return {
    interaction: mock as unknown as ModalSubmitInteraction & Interaction,
    reply,
    update,
    followUp,
    deferUpdate,
    deferReply,
    editReply,
    channel,
  };
}

function createRoleSelectMock(opts: {
  customId: string;
  userId: string;
  role: { id: string; name?: string; managed?: boolean };
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const showModal = vi.fn(async (_modal: { toJSON(): { custom_id: string } }) => undefined);
  const channel = makeMockChannel(true);
  const rolesMap = new Map([
    [
      opts.role.id,
      {
        id: opts.role.id,
        name: opts.role.name ?? `Role-${opts.role.id}`,
        managed: opts.role.managed ?? false,
      },
    ],
  ]);

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    guild: { id: 'g1', name: '测试服务器' },
    channelId: channel.id,
    channel,
    client: {
      channels: {
        fetch: vi.fn(async () => null),
      },
    },
    values: [opts.role.id],
    roles: {
      get: (id: string) => rolesMap.get(id),
    },
    user: makeMockUser({ id: opts.userId }),
    member: makeMockMember(opts.userId),
    replied: false,
    deferred: false,
    inCachedGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRoleSelectMenu: () => true,
    isChannelSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply,
    update,
    showModal,
  };

  return {
    interaction: mock as unknown as RoleSelectMenuInteraction & Interaction,
    reply,
    update,
    showModal,
  };
}

function createChannelSelectMock(opts: {
  customId: string;
  userId: string;
  values: string[];
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const channel = makeMockChannel(true);

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    guild: { id: 'g1', name: '测试服务器' },
    channelId: channel.id,
    channel,
    client: {
      channels: {
        fetch: vi.fn(async () => null),
      },
    },
    values: opts.values,
    user: makeMockUser({ id: opts.userId }),
    member: makeMockMember(opts.userId),
    replied: false,
    deferred: false,
    inCachedGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => true,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply,
    update,
  };

  return {
    interaction: mock as unknown as ChannelSelectMenuInteraction & Interaction,
    reply,
    update,
  };
}

describe('menu router & multiplayer interaction flows', () => {
  it('handles /menu personal & lobby modes and menu:open button', async () => {
    const ctx = createTestCtx();

    // Personal /menu
    const personal = createChatCommandMock({ commandName: 'menu', userId: 'u1' });
    await routeInteraction(personal.interaction, ctx);
    expect(personal.reply).toHaveBeenCalledTimes(1);
    const personalPayload = personal.reply.mock.calls[0]![0];
    expect(personalPayload.flags).toBe(MessageFlags.Ephemeral);
    expect(personalPayload.embeds?.[0]?.toJSON().author?.name).toContain('互动主菜单');

    // Non-admin lobby rejected
    const nonAdminLobby = createChatCommandMock({
      commandName: 'menu',
      userId: 'u1',
      mode: 'lobby',
      isAdmin: false,
    });
    await menuCommand.execute(nonAdminLobby.interaction, ctx);
    expect(nonAdminLobby.channel.send).not.toHaveBeenCalled();
    expect(nonAdminLobby.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    // Admin lobby sends public card and confirms ephemerally
    const adminLobby = createChatCommandMock({
      commandName: 'menu',
      userId: 'admin1',
      mode: 'lobby',
      isAdmin: true,
    });
    await menuCommand.execute(adminLobby.interaction, ctx);
    expect(adminLobby.channel.send).toHaveBeenCalledTimes(1);
    const sentLobby = adminLobby.channel.send.mock.calls[0]![0];
    expect(sentLobby.components?.[0]?.toJSON().components[0]).toMatchObject({
      custom_id: 'menu:open',
    });
    expect(adminLobby.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    // Clicking menu:open opens personal ephemeral Home for the clicker
    const openClick = createButtonMock({ customId: 'menu:open', userId: 'u2' });
    await routeInteraction(openClick.interaction, ctx);
    expect(openClick.reply).toHaveBeenCalledTimes(1);
    expect(openClick.update).not.toHaveBeenCalled();
    expect(openClick.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    ctx.db.close();
  });

  it('handles navigation, quick actions, and module toggle checks', async () => {
    const ctx = createTestCtx();

    const navSolo = createButtonMock({ customId: 'menu:nav:solo', userId: 'u1' });
    await routeInteraction(navSolo.interaction, ctx);
    expect(navSolo.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('独立游玩');

    // Daily action from solo keeps solo view via explicit source segment
    const dailyOnSolo = createButtonMock({
      customId: 'menu:act:daily:solo',
      userId: 'u1',
    });
    await routeInteraction(dailyOnSolo.interaction, ctx);
    expect(dailyOnSolo.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('独立游玩');
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBe(5000);

    // Work & fortune
    const workBtn = createButtonMock({ customId: 'menu:act:work', userId: 'u1' });
    await routeInteraction(workBtn.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBeGreaterThan(5000);

    const fortuneBtn = createButtonMock({ customId: 'menu:act:fortune', userId: 'u1' });
    await routeInteraction(fortuneBtn.interaction, ctx);
    expect(fortuneBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('今日运势');

    // Disable fun module -> fortune blocked with error feedback
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, fun: false });
    const fortuneBlocked = createButtonMock({ customId: 'menu:act:fortune', userId: 'u2' });
    await routeInteraction(fortuneBlocked.interaction, ctx);
    expect(fortuneBlocked.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('娱乐互动');
    expect(ctx.repos.profile.getOrCreate('g1', 'u2').coins).toBe(0);

    // Disable leveling -> rank blocked with error feedback
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, leveling: false });
    const rankBlocked = createButtonMock({ customId: 'menu:nav:rank', userId: 'u1' });
    await routeInteraction(rankBlocked.interaction, ctx);
    expect(rankBlocked.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('等级与热度');

    ctx.db.close();
  });

  it('handles bank deposit/withdraw/interest flows and zero-balance guard', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 1000);

    // 0 bank balance withdraw 25% -> clean error without throwing/calling withdraw(0)
    const zeroWd = createButtonMock({ customId: 'menu:bank:wd:25', userId: 'u1' });
    await routeInteraction(zeroWd.interaction, ctx);
    expect(zeroWd.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('银行存款不足');

    // Deposit 50% -> 500
    const dep50 = createButtonMock({ customId: 'menu:bank:dep:50', userId: 'u1' });
    await routeInteraction(dep50.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1')).toMatchObject({ coins: 500, bankCoins: 500 });

    // Claim daily interest (2% of 500 = +10)
    const interest = createButtonMock({ customId: 'menu:bank:interest', userId: 'u1' });
    await routeInteraction(interest.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').bankCoins).toBe(510);

    // Modal deposit & withdraw
    const openDepModal = createButtonMock({ customId: 'menu:modal:bank_dep', userId: 'u1' });
    await routeInteraction(openDepModal.interaction, ctx);
    expect(openDepModal.showModal).toHaveBeenCalledTimes(1);

    const subDep = createModalMock({
      customId: 'menu:modal_sub:bank_dep',
      userId: 'u1',
      fields: { amount: '200' },
    });
    await routeInteraction(subDep.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1')).toMatchObject({ coins: 300, bankCoins: 710 });

    const wdAll = createButtonMock({ customId: 'menu:bank:wd:all', userId: 'u1' });
    await routeInteraction(wdAll.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1')).toMatchObject({ coins: 1010, bankCoins: 0 });

    ctx.db.close();
  });

  it('handles rob UserSelect with bot/self guards and public channel notice', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'attacker', 500);
    ctx.repos.profile.addCoins('g1', 'victim', 1000);

    // Reject bot
    const robBot = createUserSelectMock({
      customId: 'menu:user:rob',
      userId: 'attacker',
      target: { id: 'bot1', bot: true },
    });
    await routeInteraction(robBot.interaction, ctx);
    expect(robBot.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('机器人');
    expect(robBot.channel.send).not.toHaveBeenCalled();

    // Reject self
    const robSelf = createUserSelectMock({
      customId: 'menu:user:rob',
      userId: 'attacker',
      target: { id: 'attacker' },
    });
    await routeInteraction(robSelf.interaction, ctx);
    expect(robSelf.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('不能打劫自己');

    // Valid rob executes with deferUpdate + editReply & sends public broadcast WITHOUT pinging members
    const robTarget = createUserSelectMock({
      customId: 'menu:user:rob',
      userId: 'attacker',
      target: { id: 'victim' },
    });
    await routeInteraction(robTarget.interaction, ctx);
    expect(robTarget.deferUpdate).toHaveBeenCalledTimes(1);
    expect(robTarget.editReply).toHaveBeenCalledTimes(1);
    expect(robTarget.channel!.send).toHaveBeenCalledTimes(1);
    const robBroadcast = robTarget.channel!.send.mock.calls[0]![0];
    expect(robBroadcast.allowedMentions).toEqual({ parse: [] });
    expect(robBroadcast.content).not.toContain('<@attacker>');
    expect(robBroadcast.content).not.toContain('<@victim>');
    expect(robBroadcast.content).toContain('User-attacker');
    expect(robBroadcast.content).toContain('User-victim');
    expect(robBroadcast.embeds?.[0]?.toJSON().title).toMatch(/抢钱/);

    // Fallback channel fetch works when interaction.channel is null
    ctx.repos.profile.addCoins('g1', 'attacker2', 500);
    ctx.repos.profile.addCoins('g1', 'victim2', 1000);
    const fetchedFallback = makeMockChannel(true, 'fallback-1');
    const robFallback = createUserSelectMock({
      customId: 'menu:user:rob',
      userId: 'attacker2',
      target: { id: 'victim2' },
      channel: null,
      fetchedChannel: fetchedFallback,
    });
    await routeInteraction(robFallback.interaction, ctx);
    expect(robFallback.fetchChannel).toHaveBeenCalledTimes(1);
    expect(fetchedFallback.send).toHaveBeenCalledTimes(1);

    ctx.db.close();
  });

  it('handles pay UserSelect -> immediate showModal -> ModalSubmit transfer', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'sender', 800);

    const paySelect = createUserSelectMock({
      customId: 'menu:user:pay',
      userId: 'sender',
      target: { id: 'receiver' },
    });
    await routeInteraction(paySelect.interaction, ctx);
    expect(paySelect.deferUpdate).not.toHaveBeenCalled();
    expect(paySelect.showModal).toHaveBeenCalledTimes(1);
    expect(paySelect.showModal.mock.calls[0]![0].toJSON().custom_id).toBe('menu:modal_sub:pay:receiver');

    const payModal = createModalMock({
      customId: 'menu:modal_sub:pay:receiver',
      userId: 'sender',
      fields: { amount: '250' },
    });
    await routeInteraction(payModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'sender').coins).toBe(550);
    expect(ctx.repos.profile.getOrCreate('g1', 'receiver').coins).toBe(250);
    expect(payModal.channel.send).toHaveBeenCalledTimes(1);
    expect(payModal.channel.send.mock.calls[0]![0].content).toContain('<@sender>');
    expect(payModal.channel.send.mock.calls[0]![0].content).toContain('<@receiver>');
    expect(payModal.channel.send.mock.calls[0]![0].content).toContain('250');
    expect(payModal.deferUpdate).toHaveBeenCalledTimes(1);
    expect(payModal.editReply).toHaveBeenCalledTimes(1);

    ctx.db.close();
  });

  it('handles duel UserSelect -> Modal -> public mp:duel:accept & decline', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'p1', 1000);
    ctx.repos.profile.addCoins('g1', 'p2', 1000);

    // Non-sendable channel blocks duel before modal
    const nonSendableSelect = createUserSelectMock({
      customId: 'menu:user:duel',
      userId: 'p1',
      target: { id: 'p2' },
      channel: makeMockChannel(false),
    });
    await routeInteraction(nonSendableSelect.interaction, ctx);
    expect(nonSendableSelect.showModal).not.toHaveBeenCalled();
    expect(nonSendableSelect.update).toHaveBeenCalledTimes(1);

    // Valid select shows duel modal
    const duelSelect = createUserSelectMock({
      customId: 'menu:user:duel',
      userId: 'p1',
      target: { id: 'p2' },
    });
    await routeInteraction(duelSelect.interaction, ctx);
    expect(duelSelect.showModal).toHaveBeenCalledTimes(1);
    expect(duelSelect.showModal.mock.calls[0]![0].toJSON().custom_id).toBe('menu:modal_sub:duel:p2');

    // Submit duel modal
    const duelModal = createModalMock({
      customId: 'menu:modal_sub:duel:p2',
      userId: 'p1',
      fields: { amount: '300' },
    });
    await routeInteraction(duelModal.interaction, ctx);
    expect(duelModal.channel.send).toHaveBeenCalledTimes(1);
    const sentDuelCard = duelModal.channel.send.mock.calls[0]![0];
    const acceptId = (
      sentDuelCard.components?.[0]?.toJSON().components[0] as { custom_id: string }
    ).custom_id;
    const declineId = (
      sentDuelCard.components?.[0]?.toJSON().components[1] as { custom_id: string }
    ).custom_id;
    expect(acceptId).toMatch(/^mp:duel:accept:/);
    expect(declineId).toMatch(/^mp:duel:decline:/);

    // Bystander cannot accept or decline
    const outsiderAccept = createButtonMock({ customId: acceptId, userId: 'outsider' });
    await routeInteraction(outsiderAccept.interaction, ctx);
    expect(outsiderAccept.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    // Opponent accepts
    const oppAccept = createButtonMock({ customId: acceptId, userId: 'p2' });
    await routeInteraction(oppAccept.interaction, ctx);
    expect(oppAccept.update).toHaveBeenCalledTimes(1);
    expect(oppAccept.update.mock.calls[0]![0].components).toHaveLength(0);

    // Subsequent decline sees already_resolved and clears stale buttons
    const lateDecline = createButtonMock({ customId: declineId, userId: 'p2' });
    await routeInteraction(lateDecline.interaction, ctx);
    expect(lateDecline.msgEdit).toHaveBeenCalledTimes(1);
    expect(lateDecline.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    ctx.db.close();
  });

  it('handles redpacket modal -> public mp:rp:claim & send failure rollback', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'sender', 1000);

    // Open modal
    const openRp = createButtonMock({ customId: 'menu:modal:redpacket', userId: 'sender' });
    await routeInteraction(openRp.interaction, ctx);
    expect(openRp.showModal).toHaveBeenCalledTimes(1);

    // Send failure rolls back coins gracefully
    const failingChannel = makeMockChannel(true);
    failingChannel.send.mockRejectedValueOnce(new Error('50013'));
    const failRpModal = createModalMock({
      customId: 'menu:modal_sub:redpacket',
      userId: 'sender',
      fields: { totalAmount: '400', totalCount: '2', greeting: '祝开心' },
      channel: failingChannel,
    });
    await routeInteraction(failRpModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'sender').coins).toBe(1000);

    // Successful send
    const okChannel = makeMockChannel(true, 'rp-msg-99');
    const okRpModal = createModalMock({
      customId: 'menu:modal_sub:redpacket',
      userId: 'sender',
      fields: { totalAmount: '200', totalCount: '2', greeting: '发红包啦' },
      channel: okChannel,
    });
    await routeInteraction(okRpModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'sender').coins).toBe(800);
    expect(okChannel.send).toHaveBeenCalledTimes(1);
    const sentCard = okChannel.send.mock.calls[0]![0];
    const claimCustomId = (
      sentCard.components?.[0]?.toJSON().components[0] as { custom_id: string }
    ).custom_id;
    const packetId = Number(claimCustomId.split(':')[3]);
    expect(ctx.services.multiplayer.getRedPacketWithClaims(packetId)?.packet.messageId).toBe(
      'rp-msg-99',
    );

    // User A claims -> updates public card & followUp ephemerally
    const claimA = createButtonMock({ customId: claimCustomId, userId: 'uA' });
    await routeInteraction(claimA.interaction, ctx);
    expect(claimA.update).toHaveBeenCalledTimes(1);
    expect(claimA.followUp).toHaveBeenCalledTimes(1);
    expect(claimA.followUp.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    // User A duplicate claim -> ephemeral error
    const dupA = createButtonMock({ customId: claimCustomId, userId: 'uA' });
    await routeInteraction(dupA.interaction, ctx);
    expect(dupA.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    // User B claims last share -> public card clears buttons & shows bestLuck
    const claimB = createButtonMock({ customId: claimCustomId, userId: 'uB' });
    await routeInteraction(claimB.interaction, ctx);
    expect(claimB.update.mock.calls[0]![0].components).toHaveLength(0);
    expect(claimB.followUp.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    // User C claims finished packet -> updates stale card & replies ephemerally
    const claimC = createButtonMock({ customId: claimCustomId, userId: 'uC' });
    await routeInteraction(claimC.interaction, ctx);
    expect(claimC.msgEdit).toHaveBeenCalledTimes(1);
    expect(claimC.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    const sumClaimed =
      ctx.repos.profile.getOrCreate('g1', 'uA').coins +
      ctx.repos.profile.getOrCreate('g1', 'uB').coins;
    expect(sumClaimed).toBe(200);

    ctx.db.close();
  });

  it('handles social StringSelect + UserSelect, shop + bag, and blackjack flows', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 5000);

    // Social action select -> updates user select customId
    const socialAct = createStringSelectMock({
      customId: 'menu:social_act',
      userId: 'u1',
      values: ['hug'],
    });
    await routeInteraction(socialAct.interaction, ctx);
    expect(socialAct.update.mock.calls[0]![0].components?.[1]?.toJSON().components[0]).toMatchObject({
      custom_id: 'menu:user:social:hug',
    });

    // Social user select -> defers, sends public embed & edits menu
    const socialUser = createUserSelectMock({
      customId: 'menu:user:social:hug',
      userId: 'u1',
      target: { id: 'u2' },
    });
    await routeInteraction(socialUser.interaction, ctx);
    expect(socialUser.deferUpdate).toHaveBeenCalledTimes(1);
    expect(socialUser.channel.send).toHaveBeenCalledTimes(1);
    expect(socialUser.editReply).toHaveBeenCalledTimes(1);

    // Shop: role item failure auto-refunds; boost item succeeds & activates in bag
    const roleItem = ctx.services.shop.createRoleItem({
      guildId: 'g1',
      name: 'VIP身份组',
      description: '尊贵身份',
      price: 500,
      roleId: 'r1',
      stock: 1,
    });
    const boostItem = ctx.services.shop.createBoostItem({
      guildId: 'g1',
      name: '双倍经验卡',
      description: '60分钟',
      price: 300,
      boostMultiplier: 2.0,
      boostDurationSec: 3600,
      stock: null,
    });

    const failRoleBuy = createStringSelectMock({
      customId: 'menu:shop_buy',
      userId: 'u1',
      values: [String(roleItem.id)],
      failRoleAdd: true,
    });
    await routeInteraction(failRoleBuy.interaction, ctx);
    // Auto-refunded coins & stock
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBe(5000);
    expect(ctx.services.shop.listItems('g1')[0]?.stock).toBe(1);

    const buyBoost = createStringSelectMock({
      customId: 'menu:shop_buy',
      userId: 'u1',
      values: [String(boostItem.id)],
    });
    await routeInteraction(buyBoost.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBe(4700);
    const inv = ctx.services.shop.listInventory('g1', 'u1');
    expect(inv).toHaveLength(1);

    const useBoost = createStringSelectMock({
      customId: 'menu:bag_use',
      userId: 'u1',
      values: [String(inv[0]!.id)],
    });
    await routeInteraction(useBoost.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').xpBoostMultiplier).toBe(2.0);

    // Slots & Dice
    const slots50 = createButtonMock({ customId: 'menu:slots:50', userId: 'u1' });
    await routeInteraction(slots50.interaction, ctx);
    expect(slots50.update).toHaveBeenCalledTimes(1);

    const dicePick = createButtonMock({ customId: 'menu:dice_pick:triple', userId: 'u1' });
    await routeInteraction(dicePick.interaction, ctx);
    expect(dicePick.update.mock.calls[0]![0].components?.[1]?.toJSON().components[0]).toMatchObject({
      custom_id: 'menu:dice_bet:triple:50',
    });

    const diceBet = createButtonMock({ customId: 'menu:dice_bet:triple:50', userId: 'u1' });
    await routeInteraction(diceBet.interaction, ctx);
    expect(diceBet.update).toHaveBeenCalledTimes(1);

    // Blackjack start -> hit or stand
    const bjStart = createButtonMock({ customId: 'menu:bj_start:100', userId: 'u1' });
    await routeInteraction(bjStart.interaction, ctx);
    expect(bjStart.update).toHaveBeenCalledTimes(1);
    if (ctx.services.blackjack.getActiveGame('g1', 'u1')) {
      const bjDouble = createButtonMock({ customId: 'menu:bj:double', userId: 'u1' });
      await routeInteraction(bjDouble.interaction, ctx);
      expect(bjDouble.update).toHaveBeenCalledTimes(1);
      if (ctx.services.blackjack.getActiveGame('g1', 'u1')) {
        const bjStand = createButtonMock({ customId: 'menu:bj:stand', userId: 'u1' });
        await routeInteraction(bjStand.interaction, ctx);
      }
    }
    expect(ctx.services.blackjack.getActiveGame('g1', 'u1')).toBeNull();

    // Blackjack start + hit + stand
    const bjStart2 = createButtonMock({ customId: 'menu:bj_start:50', userId: 'u1' });
    await routeInteraction(bjStart2.interaction, ctx);
    if (ctx.services.blackjack.getActiveGame('g1', 'u1')) {
      const bjHit = createButtonMock({ customId: 'menu:bj:hit', userId: 'u1' });
      await routeInteraction(bjHit.interaction, ctx);
      if (ctx.services.blackjack.getActiveGame('g1', 'u1')) {
        const bjStand = createButtonMock({ customId: 'menu:bj:stand', userId: 'u1' });
        await routeInteraction(bjStand.interaction, ctx);
      }
    }
    expect(ctx.services.blackjack.getActiveGame('g1', 'u1')).toBeNull();

    // Clear title via bag button
    ctx.services.fun.grantTitle('g1', 'u1', '测试称号');
    ctx.services.fun.equipTitle('g1', 'u1', '测试称号');
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').equippedTitle).toBe('测试称号');
    const clearTitle = createButtonMock({ customId: 'menu:bag:clear_title', userId: 'u1' });
    await routeInteraction(clearTitle.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').equippedTitle).toBeNull();

    // Slots / Dice / BJ custom modals
    const subSlots = createModalMock({
      customId: 'menu:modal_sub:slots',
      userId: 'u1',
      fields: { amount: '50' },
    });
    await routeInteraction(subSlots.interaction, ctx);
    expect(subSlots.update).toHaveBeenCalledTimes(1);

    const subDice = createModalMock({
      customId: 'menu:modal_sub:dice:big',
      userId: 'u1',
      fields: { amount: '50' },
    });
    await routeInteraction(subDice.interaction, ctx);
    expect(subDice.update).toHaveBeenCalledTimes(1);

    // Leaderboard pagination & private-only tab switching (never broadcasts on tab click)
    for (let i = 1; i <= 12; i++) {
      ctx.repos.profile.addCoins('g1', `rich-${i}`, i * 100);
    }
    const lbPage1 = createButtonMock({ customId: 'menu:rank:coins:1', userId: 'u1' });
    await routeInteraction(lbPage1.interaction, ctx);
    expect(lbPage1.update.mock.calls[0]![0].embeds?.[0]?.toJSON().footer?.text).toContain('第 1 / 2 页');
    expect(lbPage1.channel.send).not.toHaveBeenCalled();

    const lbPage2 = createButtonMock({ customId: 'menu:rank:coins:2:next', userId: 'u1' });
    await routeInteraction(lbPage2.interaction, ctx);
    expect(lbPage2.update.mock.calls[0]![0].embeds?.[0]?.toJSON().footer?.text).toContain('第 2 / 2 页');
    expect(lbPage2.channel.send).not.toHaveBeenCalled();

    const lbStat = createButtonMock({ customId: 'menu:rank:stat:1', userId: 'u1' });
    await routeInteraction(lbStat.interaction, ctx);
    expect(lbStat.channel.send).not.toHaveBeenCalled();
    expect(lbStat.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('成长值排行榜');

    ctx.db.close();
  });

  it('handles pending duel decline and expired red packet claim cleanup', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'p1', 1000);
    ctx.repos.profile.addCoins('g1', 'p2', 1000);

    // Pending duel decline succeeds & removes buttons
    const duelRes = ctx.services.multiplayer.createDuel('g1', 'c1', 'p1', 'p2', 100);
    expect(duelRes.ok).toBe(true);
    if (duelRes.ok) {
      const declineBtn = createButtonMock({
        customId: `mp:duel:decline:${duelRes.duel.id}`,
        userId: 'p2',
      });
      await routeInteraction(declineBtn.interaction, ctx);
      expect(declineBtn.update).toHaveBeenCalledTimes(1);
      expect(declineBtn.update.mock.calls[0]![0].components).toHaveLength(0);
    }

    // Expired red packet claim auto-expires & refunds sender
    const rpRes = ctx.services.multiplayer.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'p1',
      totalAmount: 200,
      totalCount: 2,
      nowMs: 1000,
      ttlMs: 100,
    });
    expect(rpRes.ok).toBe(true);
    if (rpRes.ok) {
      expect(ctx.repos.profile.getOrCreate('g1', 'p1').coins).toBe(800);
      const claimExpired = createButtonMock({
        customId: `mp:rp:claim:${rpRes.packet.id}`,
        userId: 'p2',
      });
      await routeInteraction(claimExpired.interaction, ctx);
      expect(claimExpired.msgEdit).toHaveBeenCalledTimes(1);
      expect(claimExpired.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
      expect(ctx.repos.profile.getOrCreate('g1', 'p1').coins).toBe(1000);
    }

    ctx.db.close();
  });

  it('broadcasts solo big wins & explicit rank/leaderboard shares while keeping ordinary solo silent', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 10_000);

    // Ordinary slots loss/small win does NOT broadcast
    const playSlotsSpy = vi.spyOn(ctx.services.economy, 'playSlots');
    playSlotsSpy.mockReturnValueOnce({
      ok: true,
      reels: ['🍒', '🍋', '🍇'],
      multiplier: 0,
      payout: 0,
      netChange: -100,
      balance: 9900,
    });
    const ordinarySlots = createButtonMock({ customId: 'menu:slots:100', userId: 'u1' });
    await routeInteraction(ordinarySlots.interaction, ctx);
    expect(ordinarySlots.channel!.send).not.toHaveBeenCalled();

    // Slots >= 4x broadcasts public highlight
    playSlotsSpy.mockReturnValueOnce({
      ok: true,
      reels: ['7️⃣', '7️⃣', '7️⃣'],
      multiplier: 15,
      payout: 1500,
      netChange: 1400,
      balance: 11_300,
    });
    const jackpotSlots = createButtonMock({ customId: 'menu:slots:100', userId: 'u1' });
    await routeInteraction(jackpotSlots.interaction, ctx);
    expect(jackpotSlots.channel!.send).toHaveBeenCalledTimes(1);
    expect(jackpotSlots.channel!.send.mock.calls[0]![0].content).toContain('<@u1>');

    // Dice triple win broadcasts public highlight; normal dice win does not
    const playDiceSpy = vi.spyOn(ctx.services.economy, 'playDice');
    playDiceSpy.mockReturnValueOnce({
      ok: true,
      dice: [4, 5, 6],
      sum: 15,
      isTriple: false,
      won: true,
      netChange: 100,
      balance: 11_400,
    });
    const normalDice = createButtonMock({ customId: 'menu:dice_bet:big:100', userId: 'u1' });
    await routeInteraction(normalDice.interaction, ctx);
    expect(normalDice.channel!.send).not.toHaveBeenCalled();

    playDiceSpy.mockReturnValueOnce({
      ok: true,
      dice: [6, 6, 6],
      sum: 18,
      isTriple: true,
      won: true,
      netChange: 1000,
      balance: 12_400,
    });
    const tripleDice = createButtonMock({ customId: 'menu:dice_bet:triple:100', userId: 'u1' });
    await routeInteraction(tripleDice.interaction, ctx);
    expect(tripleDice.channel!.send).toHaveBeenCalledTimes(1);
    expect(tripleDice.channel!.send.mock.calls[0]![0].content).toContain('<@u1>');

    // Fortune: first draw 大吉 broadcasts; non-大吉 or repeat draw does not
    const fortuneSpy = vi.spyOn(ctx.services.fun, 'drawDailyFortune');
    fortuneSpy.mockReturnValueOnce({
      alreadyDrawn: false,
      balance: 12_480,
      record: {
        guildId: 'g1',
        userId: 'u1',
        dateKey: '2026-11-23',
        luckTier: '大吉',
        goodFor: '水群',
        avoid: '梭哈',
        luckyNumber: 8,
        bonusCoins: 80,
        createdAt: Date.now(),
      },
    });
    const luckyFortune = createButtonMock({ customId: 'menu:act:fortune', userId: 'u1' });
    await routeInteraction(luckyFortune.interaction, ctx);
    expect(luckyFortune.channel!.send).toHaveBeenCalledTimes(1);
    expect(luckyFortune.channel!.send.mock.calls[0]![0].content).toContain('<@u1>');

    fortuneSpy.mockReturnValueOnce({
      alreadyDrawn: true,
      balance: 12_480,
      record: {
        guildId: 'g1',
        userId: 'u1',
        dateKey: '2026-11-23',
        luckTier: '大吉',
        goodFor: '水群',
        avoid: '梭哈',
        luckyNumber: 8,
        bonusCoins: 80,
        createdAt: Date.now(),
      },
    });
    const repeatFortune = createButtonMock({ customId: 'menu:act:fortune', userId: 'u1' });
    await routeInteraction(repeatFortune.interaction, ctx);
    expect(repeatFortune.channel!.send).not.toHaveBeenCalled();

    // Blackjack big win (>= 500 net) broadcasts public highlight
    const bjSpy = vi.spyOn(ctx.services.blackjack, 'startGame');
    bjSpy.mockReturnValueOnce({
      ok: true,
      balance: 13_980,
      game: {
        guildId: 'g1',
        userId: 'u1',
        bet: 500,
        deck: [],
        playerHand: [
          { rank: 'A', suit: '♠' },
          { rank: 'K', suit: '♥' },
        ],
        dealerHand: [
          { rank: '9', suit: '♣' },
          { rank: '8', suit: '♦' },
        ],
        status: 'player_blackjack',
        payout: 1250,
        canDouble: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + 900_000,
      },
    });
    const bjWin = createButtonMock({ customId: 'menu:bj_start:500', userId: 'u1' });
    await routeInteraction(bjWin.interaction, ctx);
    expect(bjWin.channel!.send).toHaveBeenCalledTimes(1);
    expect(bjWin.channel!.send.mock.calls[0]![0].allowedMentions).toEqual({ parse: [] });
    expect(bjWin.channel!.send.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('二十一点战报');
    expect(bjWin.channel!.send.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('<@u1>');

    // Share rank & leaderboard to channel (uses deferUpdate + editReply)
    const shareRank = createButtonMock({ customId: 'menu:share:rank', userId: 'u1' });
    await routeInteraction(shareRank.interaction, ctx);
    expect(shareRank.deferUpdate).toHaveBeenCalledTimes(1);
    expect(shareRank.channel!.send).toHaveBeenCalledTimes(1);
    expect(shareRank.channel!.send.mock.calls[0]![0].embeds).toHaveLength(1);
    expect(shareRank.editReply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('晒出');

    const shareLb = createButtonMock({ customId: 'menu:share:lb:coins:1', userId: 'u1' });
    await routeInteraction(shareLb.interaction, ctx);
    expect(shareLb.deferUpdate).toHaveBeenCalledTimes(1);
    expect(shareLb.channel!.send).toHaveBeenCalledTimes(1);
    expect(shareLb.channel!.send.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('富豪榜');

    ctx.db.close();
  });

  it('supports /config grant-coins and grant-all-coins for admins', async () => {
    const ctx = createTestCtx();

    // grant-coins to one human
    const grantOneReply = vi.fn(async (_payload: MockPayload) => undefined);
    const grantOneCmd = {
      commandName: 'config',
      guildId: 'g1',
      guild: { id: 'g1', name: '测试服务器' },
      user: makeMockUser({ id: 'admin1' }),
      member: makeMockMember('admin1', true),
      options: {
        getSubcommand: () => 'grant-coins',
        getUser: () => makeMockUser({ id: 'u1' }),
        getInteger: () => 5000,
      },
      inCachedGuild: () => true,
      reply: grantOneReply,
    } as unknown as ChatInputCommandInteraction;
    await configCommand.execute(grantOneCmd, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBe(5000);
    expect(grantOneReply.mock.calls[0]![0].flags).toBeUndefined();

    // grant-all-coins to all human members, excluding bots
    const membersMap = new Map([
      ['u1', { id: 'u1', user: makeMockUser({ id: 'u1' }) }],
      ['u2', { id: 'u2', user: makeMockUser({ id: 'u2' }) }],
      ['bot1', { id: 'bot1', user: makeMockUser({ id: 'bot1', bot: true }) }],
    ]);
    const deferReply = vi.fn(async () => undefined);
    const editReply = vi.fn(async (_payload: MockPayload) => undefined);
    const grantAllCmd = {
      commandName: 'config',
      guildId: 'g1',
      guild: {
        id: 'g1',
        name: '测试服务器',
        members: { fetch: vi.fn(async () => membersMap) },
      },
      user: makeMockUser({ id: 'admin1' }),
      member: makeMockMember('admin1', true),
      options: {
        getSubcommand: () => 'grant-all-coins',
        getInteger: () => 10_000,
      },
      inCachedGuild: () => true,
      deferReply,
      editReply,
      reply: vi.fn(async () => undefined),
    } as unknown as ChatInputCommandInteraction;
    await configCommand.execute(grantAllCmd, ctx);
    expect(deferReply).toHaveBeenCalledTimes(1);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBe(15_000);
    expect(ctx.repos.profile.getOrCreate('g1', 'u2').coins).toBe(10_000);
    expect(ctx.repos.profile.getOrCreate('g1', 'bot1').coins).toBe(0);
    expect(editReply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('2');

    ctx.db.close();
  });

  it('enforces admin guard and allows authorized adminUserIds to tune parameters via /menu admin panel', async () => {
    const ctx = createTestCtx();

    // Regular user denied on admin nav & admin modal
    const deniedNav = createButtonMock({ customId: 'menu:nav:admin', userId: 'normie' });
    await routeInteraction(deniedNav.interaction, ctx);
    expect(deniedNav.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('权限不足');

    const deniedModal = createButtonMock({ customId: 'menu:modal:admin_rob', userId: 'normie' });
    await routeInteraction(deniedModal.interaction, ctx);
    expect(deniedModal.showModal).not.toHaveBeenCalled();
    expect(deniedModal.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('权限不足');

    // Authorize user via adminUserIds (NO Discord Administrator permission)
    ctx.repos.guildConfig.updateAdminUsers('g1', ['auth1']);
    const authMenu = createChatCommandMock({ commandName: 'menu', userId: 'auth1', isAdmin: false });
    await routeInteraction(authMenu.interaction, ctx);
    const homeRow2Ids = authMenu.reply.mock.calls[0]![0].components?.[1]
      ?.toJSON()
      .components.map((c) => ('custom_id' in c ? c.custom_id : ''));
    expect(homeRow2Ids).toContain('menu:nav:admin');

    // Authorized user opens admin overview & clicks send lobby
    const openAdmin = createButtonMock({ customId: 'menu:nav:admin', userId: 'auth1' });
    await routeInteraction(openAdmin.interaction, ctx);
    expect(openAdmin.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('管理后台总览');

    const sendLobby = createButtonMock({ customId: 'menu:admin:send_lobby', userId: 'auth1' });
    await routeInteraction(sendLobby.interaction, ctx);
    expect(sendLobby.channel!.send).toHaveBeenCalledTimes(1);

    // Pre-filled modal for rob & save rob / bank / xp / heat
    const openRobModal = createButtonMock({ customId: 'menu:modal:admin_rob', userId: 'auth1' });
    await routeInteraction(openRobModal.interaction, ctx);
    expect(openRobModal.showModal).toHaveBeenCalledTimes(1);
    const robModalJson = openRobModal.showModal.mock.calls[0]![0].toJSON() as unknown as {
      components: Array<{ components: Array<{ value?: string }> }>;
    };
    expect(robModalJson.components[0]?.components[0]?.value).toBe('45');

    const subRob = createModalMock({
      customId: 'menu:modal_sub:admin_rob',
      userId: 'auth1',
      fields: { robSuccessPct: '65', robCooldownSec: '120', robTargetShieldSec: '300' },
    });
    await routeInteraction(subRob.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').economy.robSuccessRate).toBe(0.65);
    expect(ctx.repos.guildConfig.getOrCreate('g1').economy.robCooldownSec).toBe(120);

    const subBank = createModalMock({
      customId: 'menu:modal_sub:admin_bank',
      userId: 'auth1',
      fields: { bankInterestPct: '5', bankInterestMax: '2000', bankInterestMinDeposit: '50' },
    });
    await routeInteraction(subBank.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').economy.bankInterestRate).toBe(0.05);
    expect(ctx.repos.guildConfig.getOrCreate('g1').economy.bankInterestMax).toBe(2000);

    const subXp = createModalMock({
      customId: 'menu:modal_sub:admin_xp',
      userId: 'auth1',
      fields: { baseMinXp: '30', baseMaxXp: '50', cooldownSec: '5', hourlyXpCap: '3000' },
    });
    await routeInteraction(subXp.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling).toMatchObject({
      baseMinXp: 30,
      baseMaxXp: 50,
      cooldownSec: 5,
      hourlyXpCap: 3000,
    });

    const subHeat = createModalMock({
      customId: 'menu:modal_sub:admin_heat',
      userId: 'auth1',
      fields: {
        heatWindowSec: '240',
        heatMaxMultiplier: '3',
        voiceXpPerMin: '20',
        levelUpCoinReward: '250',
      },
    });
    await routeInteraction(subHeat.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling).toMatchObject({
      heatWindowSec: 240,
      heatMaxMultiplier: 3,
      voiceXpPerMin: 20,
      levelUpCoinReward: 250,
    });

    // Toggle voice works for adminUserIds; reset leveling/econ require Guild Super Admin + two-step confirm
    const curLvl = ctx.repos.guildConfig.getOrCreate('g1').leveling;
    ctx.repos.guildConfig.updateLeveling('g1', { ...curLvl, announceChannelId: 'ch-ann' });
    const toggleVoice = createButtonMock({ customId: 'menu:admin:toggle_voice', userId: 'auth1' });
    await routeInteraction(toggleVoice.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling.voiceEnabled).toBe(false);

    // Ordinary adminUserIds helper cannot reset leveling or econ
    const resetLvlDenied = createButtonMock({ customId: 'menu:admin:reset_lvl', userId: 'auth1' });
    await routeInteraction(resetLvlDenied.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling.baseMinXp).toBe(30);
    expect(resetLvlDenied.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('超级管理员');

    // Guild Super Admin resets leveling with two-step confirm (preserving announceChannelId)
    const resetLvlStep1 = createButtonMock({
      customId: 'menu:admin:reset_lvl',
      userId: 'super1',
      isAdmin: true,
    });
    await routeInteraction(resetLvlStep1.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling.baseMinXp).toBe(30);
    const resetLvlConfirm = createButtonMock({
      customId: 'menu:admin:reset_lvl:confirm',
      userId: 'super1',
      isAdmin: true,
    });
    await routeInteraction(resetLvlConfirm.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling.baseMinXp).toBe(15);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling.announceChannelId).toBe('ch-ann');

    const resetEconConfirm = createButtonMock({
      customId: 'menu:admin:reset_econ:confirm',
      userId: 'super1',
      isAdmin: true,
    });
    await routeInteraction(resetEconConfirm.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').economy.robSuccessRate).toBe(0.45);

    const modToggle = createStringSelectMock({
      customId: 'menu:admin_toggle_mod',
      userId: 'auth1',
      values: ['fun'],
    });
    await routeInteraction(modToggle.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').modules.fun).toBe(false);

    // Authorized adminUserIds cannot toggle admin users; Guild Super Admin can
    const helperToggleDenied = createUserSelectMock({
      customId: 'menu:user:admin_toggle_user',
      userId: 'auth1',
      target: { id: 'auth2' },
    });
    await routeInteraction(helperToggleDenied.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').adminUserIds).toEqual(['auth1']);
    expect(helperToggleDenied.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
      '超级管理员',
    );

    const addSecondAdmin = createUserSelectMock({
      customId: 'menu:user:admin_toggle_user',
      userId: 'super1',
      isAdmin: true,
      target: { id: 'auth2' },
    });
    await routeInteraction(addSecondAdmin.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').adminUserIds).toEqual(['auth1', 'auth2']);

    // Single coin grant modal works for auth1; server-wide grant requires Guild Super Admin
    const grantSelect = createUserSelectMock({
      customId: 'menu:user:admin_grant',
      userId: 'auth1',
      target: { id: 'u9' },
    });
    await routeInteraction(grantSelect.interaction, ctx);
    expect(grantSelect.showModal).toHaveBeenCalledTimes(1);

    const grantModal = createModalMock({
      customId: 'menu:modal_sub:admin_grant:u9',
      userId: 'auth1',
      fields: { amount: '1500' },
    });
    await routeInteraction(grantModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u9').coins).toBe(1500);
    expect(grantModal.channel.send).toHaveBeenCalledTimes(1);

    const membersMap = new Map([
      ['u9', { id: 'u9', user: makeMockUser({ id: 'u9' }) }],
      ['u10', { id: 'u10', user: makeMockUser({ id: 'u10' }) }],
      ['b1', { id: 'b1', user: makeMockUser({ id: 'b1', bot: true }) }],
    ]);
    const grantAllDenied = createModalMock({
      customId: 'menu:modal_sub:admin_grant_all',
      userId: 'auth1',
      fields: { amount: '2000' },
      membersMap,
    });
    await routeInteraction(grantAllDenied.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u10').coins).toBe(0);

    const grantAllModal = createModalMock({
      customId: 'menu:modal_sub:admin_grant_all',
      userId: 'super1',
      isAdmin: true,
      fields: { amount: '2000' },
      membersMap,
    });
    await routeInteraction(grantAllModal.interaction, ctx);
    expect(grantAllModal.deferUpdate).toHaveBeenCalledTimes(1);
    expect(ctx.repos.profile.getOrCreate('g1', 'u9').coins).toBe(3500);
    expect(ctx.repos.profile.getOrCreate('g1', 'u10').coins).toBe(2000);
    expect(ctx.repos.profile.getOrCreate('g1', 'b1').coins).toBe(0);
    expect(grantAllModal.editReply).toHaveBeenCalledTimes(1);

    ctx.db.close();
  });

  it('routes chaos props (including 50013 nickname protection), bounty+rob, roulette, and bomb modals without deferring', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 10_000);
    ctx.repos.profile.addCoins('g1', 'u2', 10_000);

    // Buy nickname card & verify failed setNickname (50013/owner) does NOT consume card
    const buyNick = createStringSelectMock({
      customId: 'menu:prop_buy',
      userId: 'u1',
      values: ['nickname'],
    });
    await routeInteraction(buyNick.interaction, ctx);
    expect(ctx.services.chaos.getPropQuantity('g1', 'u1', 'nickname')).toBe(1);

    const nickUserSelect = createUserSelectMock({
      customId: 'menu:user:prop_nick',
      userId: 'u1',
      target: { id: 'u2' },
    });
    await routeInteraction(nickUserSelect.interaction, ctx);
    expect(nickUserSelect.showModal).toHaveBeenCalledTimes(1);
    expect(nickUserSelect.deferUpdate).not.toHaveBeenCalled();

    // Failed setNickname leaves prop intact
    const failNickModal = createModalMock({
      customId: 'menu:modal_sub:prop_nick:u2',
      userId: 'u1',
      fields: { nickname: '大聪明' },
    });
    const mutableGuild = (failNickModal.interaction as unknown as {
      guild: { ownerId?: string; members: { fetch: ReturnType<typeof vi.fn> } };
    }).guild;
    mutableGuild.ownerId = 'owner-id';
    mutableGuild.members.fetch = vi.fn(async () => ({
      displayName: 'User-u2',
      setNickname: vi.fn(async () => {
        throw new Error('Missing Permissions');
      }),
    }));
    await routeInteraction(failNickModal.interaction, ctx);
    expect(ctx.services.chaos.getPropQuantity('g1', 'u1', 'nickname')).toBe(1);

    // Admin protection: target with Administrator permission OR in adminUserIds cannot be renamed
    const adminNickModal = createModalMock({
      customId: 'menu:modal_sub:prop_nick:u2',
      userId: 'u1',
      fields: { nickname: '篡位者' },
    });
    const adminGuild = (adminNickModal.interaction as unknown as {
      guild: { ownerId?: string; members: { fetch: ReturnType<typeof vi.fn> } };
    }).guild;
    adminGuild.ownerId = 'owner-id';
    const adminSetNickFn = vi.fn(async () => undefined);
    adminGuild.members.fetch = vi.fn(async () => ({
      displayName: 'Admin-u2',
      permissions: { has: (perm: bigint) => perm === PermissionFlagsBits.Administrator },
      roles: { cache: new Map() },
      setNickname: adminSetNickFn,
    }));
    await routeInteraction(adminNickModal.interaction, ctx);
    expect(adminSetNickFn).not.toHaveBeenCalled();
    expect(ctx.services.chaos.getPropQuantity('g1', 'u1', 'nickname')).toBe(1);
    expect(adminNickModal.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('管理员');

    ctx.repos.guildConfig.updateAdminUsers('g1', ['u2']);
    const botAdminNickModal = createModalMock({
      customId: 'menu:modal_sub:prop_nick:u2',
      userId: 'u1',
      fields: { nickname: '篡位者2' },
    });
    const botAdminGuild = (botAdminNickModal.interaction as unknown as {
      guild: { ownerId?: string; members: { fetch: ReturnType<typeof vi.fn> } };
    }).guild;
    botAdminGuild.ownerId = 'owner-id';
    botAdminGuild.members.fetch = vi.fn(async () => ({
      displayName: 'User-u2',
      setNickname: adminSetNickFn,
    }));
    await routeInteraction(botAdminNickModal.interaction, ctx);
    expect(adminSetNickFn).not.toHaveBeenCalled();
    expect(ctx.services.chaos.getPropQuantity('g1', 'u1', 'nickname')).toBe(1);
    ctx.repos.guildConfig.updateAdminUsers('g1', []);

    // Succeeding setNickname consumes prop & broadcasts
    const okNickModal = createModalMock({
      customId: 'menu:modal_sub:prop_nick:u2',
      userId: 'u1',
      fields: { nickname: '群内显眼包' },
    });
    const okGuild = (okNickModal.interaction as unknown as {
      guild: { ownerId?: string; members: { fetch: ReturnType<typeof vi.fn> } };
    }).guild;
    okGuild.ownerId = 'owner-id';
    const setNickFn = vi.fn(async () => undefined);
    okGuild.members.fetch = vi.fn(async () => ({
      displayName: 'User-u2',
      setNickname: setNickFn,
    }));
    await routeInteraction(okNickModal.interaction, ctx);
    expect(setNickFn).toHaveBeenCalledWith('群内显眼包', expect.any(String));
    expect(ctx.services.chaos.getPropQuantity('g1', 'u1', 'nickname')).toBe(0);
    expect(okNickModal.channel.send).toHaveBeenCalledTimes(1);

    // Place bounty via modal -> rob succeeds (guaranteed rate) and pays bounty!
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateEconomy('g1', { ...cfg.economy, robSuccessRate: 1.0 });

    const bountySelect = createUserSelectMock({
      customId: 'menu:user:bounty',
      userId: 'u1',
      target: { id: 'u2' },
    });
    await routeInteraction(bountySelect.interaction, ctx);
    expect(bountySelect.showModal).toHaveBeenCalledTimes(1);

    const bountySub = createModalMock({
      customId: 'menu:modal_sub:bounty:u2',
      userId: 'u1',
      fields: { amount: '600' },
    });
    await routeInteraction(bountySub.interaction, ctx);
    expect(ctx.services.chaos.getOpenBountyTotal('g1', 'u2')).toBe(600);
    expect(bountySub.channel.send.mock.calls[0]![0].allowedMentions).toEqual({ users: ['u2'] });

    const robSelect = createUserSelectMock({
      customId: 'menu:user:rob',
      userId: 'u1',
      target: { id: 'u2' },
    });
    await routeInteraction(robSelect.interaction, ctx);
    expect(ctx.services.chaos.getOpenBountyTotal('g1', 'u2')).toBe(0);
    expect(robSelect.channel.send.mock.calls[0]![0].allowedMentions).toEqual({ users: ['u2'] });
    expect(robSelect.channel.send.mock.calls[0]![0].content).toContain('600');

    // Roulette create & ch:rl:join/start
    const rlNew = createButtonMock({ customId: 'menu:roulette:new:100', userId: 'u1' });
    await routeInteraction(rlNew.interaction, ctx);
    expect(rlNew.channel.send).toHaveBeenCalledTimes(1);
    const activeRl = ctx.services.chaos.listActiveRoulettes('g1')[0]!;

    const rlJoin = createButtonMock({ customId: `ch:rl:join:${activeRl.id}`, userId: 'u2' });
    await routeInteraction(rlJoin.interaction, ctx);
    expect(ctx.services.chaos.getRoulette(activeRl.id)?.players).toEqual(['u1', 'u2']);

    const rlStart = createButtonMock({ customId: `ch:rl:start:${activeRl.id}`, userId: 'u1' });
    await routeInteraction(rlStart.interaction, ctx);
    expect(ctx.services.chaos.getRoulette(activeRl.id)?.status).toBe('playing');

    // Number bomb public button opens modal without deferring & processes guess
    const bombBtnNew = createButtonMock({ customId: 'menu:bomb:new:200', userId: 'u1' });
    await routeInteraction(bombBtnNew.interaction, ctx);
    const openBomb = ctx.services.chaos.listOpenNumberBombs('g1')[0]!;

    const bombGuessBtn = createButtonMock({ customId: `ch:bomb:guess:${openBomb.id}`, userId: 'u2' });
    await routeInteraction(bombGuessBtn.interaction, ctx);
    expect(bombGuessBtn.showModal).toHaveBeenCalledTimes(1);
    expect(bombGuessBtn.deferUpdate).not.toHaveBeenCalled();

    const safeGuess = openBomb.secretNumber > 50 ? 25 : 75;
    const bombGuessModal = createModalMock({
      customId: `ch:bomb_sub:${openBomb.id}`,
      userId: 'u2',
      fields: { guess: String(safeGuess) },
    });
    await routeInteraction(bombGuessModal.interaction, ctx);
    expect(ctx.services.chaos.getNumberBomb(openBomb.id)?.lastGuesserId).toBe('u2');

    ctx.db.close();
  });

  it('routes world events, predictions, CP/pets, and admin_games tuning end-to-end', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 10_000);
    ctx.repos.profile.addCoins('g1', 'u2', 10_000);
    ctx.repos.guildConfig.updateAdminUsers('g1', ['u1']);

    // Create prediction via modal -> public card ev:pred:bet modal (never defers!) -> ev:pred:settle
    const createPredModal = createModalMock({
      customId: 'menu:modal_sub:pred_create',
      userId: 'u1',
      fields: {
        title: '今晚大老板发红包吗',
        opt1: '发大包',
        opt2: '肯定鸽',
        extraOpts: '发一元',
        closeMinutes: '60',
      },
    });
    await routeInteraction(createPredModal.interaction, ctx);
    const pred = ctx.services.worldEvent.listPredictions('g1')[0]!;
    expect(pred.options).toEqual(['发大包', '肯定鸽', '发一元']);

    const predBetBtn = createButtonMock({ customId: `ev:pred:bet:${pred.id}:0`, userId: 'u2' });
    await routeInteraction(predBetBtn.interaction, ctx);
    expect(predBetBtn.showModal).toHaveBeenCalledTimes(1);
    expect(predBetBtn.deferUpdate).not.toHaveBeenCalled();

    const predBetSub = createModalMock({
      customId: `ev:pred_bet_sub:${pred.id}:0`,
      userId: 'u2',
      fields: { amount: '500' },
    });
    await routeInteraction(predBetSub.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u2').coins).toBe(9500);

    // Lock prediction before settling (per #9 P0-3)
    ctx.services.worldEvent.lockPrediction(pred.id, 'u1', true);
    const predSettle = createStringSelectMock({
      customId: `ev:pred:settle:${pred.id}`,
      userId: 'u1',
      values: ['0'],
    });
    await routeInteraction(predSettle.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u2').coins).toBe(10_000);

    // Spawn chest & claim via ev:chest:claim
    const chest = ctx.services.worldEvent.spawnChest('g1', 'c1');
    const claimChest = createButtonMock({ customId: `ev:chest:claim:${chest.id}`, userId: 'u2' });
    await routeInteraction(claimChest.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u2').coins).toBeGreaterThan(10_000);

    // CP propose -> sp:prop:accept -> daily checkin
    const marrySelect = createUserSelectMock({
      customId: 'menu:user:cp_marry',
      userId: 'u1',
      target: { id: 'u2' },
    });
    await routeInteraction(marrySelect.interaction, ctx);
    expect(marrySelect.channel.send).toHaveBeenCalledTimes(1);
    const proposals = ctx.db
      .prepare('SELECT id FROM relationship_proposals ORDER BY id DESC LIMIT 1')
      .get() as { id: number };

    const acceptProp = createButtonMock({ customId: `sp:prop:accept:${proposals.id}`, userId: 'u2' });
    await routeInteraction(acceptProp.interaction, ctx);
    expect(ctx.services.socialPet.listUserRelationships('g1', 'u1')).toHaveLength(1);

    // Pull pets for u1 & u2 -> open pet battle -> accept battle
    const g1Pet = createButtonMock({ customId: 'menu:pet:gacha', userId: 'u1' });
    await routeInteraction(g1Pet.interaction, ctx);
    const g2Pet = createButtonMock({ customId: 'menu:pet:gacha', userId: 'u2' });
    await routeInteraction(g2Pet.interaction, ctx);

    const openBattleModal = createModalMock({
      customId: 'menu:modal_sub:pet_open_battle',
      userId: 'u1',
      fields: { bet: '150' },
    });
    await routeInteraction(openBattleModal.interaction, ctx);
    const battleRow = ctx.db
      .prepare('SELECT id FROM pet_battles ORDER BY id DESC LIMIT 1')
      .get() as { id: number };

    const acceptBattle = createButtonMock({
      customId: `sp:petbattle:accept:${battleRow.id}`,
      userId: 'u2',
    });
    await routeInteraction(acceptBattle.interaction, ctx);
    expect(ctx.services.socialPet.getPetBattle(battleRow.id)?.status).toBe('completed');

    // admin_games modal & toggles
    const adminPropsModal = createModalMock({
      customId: 'menu:modal_sub:admin_props',
      userId: 'u1',
      fields: {
        trap: '700',
        lockpick: '600',
        shield: '800',
        curse: '400',
        nickname: '1500',
      },
    });
    await routeInteraction(adminPropsModal.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').games.propTrapPrice).toBe(700);

    const toggleAutoEv = createButtonMock({
      customId: 'menu:admin:toggle_auto_event',
      userId: 'u1',
    });
    await routeInteraction(toggleAutoEv.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').games.eventAutoEnabled).toBe(false);

    ctx.db.close();
  });

  it('routes level-up rewards, custom level-up messages, self-role panels, and personal ID card editing', async () => {
    const ctx = createTestCtx();
    ctx.repos.guildConfig.updateAdminUsers('g1', ['admin1']);

    // 1. Non-admin blocked from admin_lvl_rewards, admin_roles, and admin modals
    const nonAdminRewards = createButtonMock({
      customId: 'menu:nav:admin_lvl_rewards',
      userId: 'member1',
    });
    await routeInteraction(nonAdminRewards.interaction, ctx);
    expect(nonAdminRewards.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('权限不足');

    const nonAdminRoleSelect = createRoleSelectMock({
      customId: 'menu:role:admin_lvl_reward_add',
      userId: 'member1',
      role: { id: 'r1', name: 'VIP' },
    });
    await routeInteraction(nonAdminRoleSelect.interaction, ctx);
    expect(nonAdminRoleSelect.showModal).not.toHaveBeenCalled();

    // 2. Admin customizes level-up title/template, announce channel, and stackRoles
    const openMsgModal = createButtonMock({
      customId: 'menu:modal:admin_lvl_msg',
      userId: 'admin1',
    });
    await routeInteraction(openMsgModal.interaction, ctx);
    expect(openMsgModal.showModal).toHaveBeenCalledTimes(1);

    const submitMsgModal = createModalMock({
      customId: 'menu:modal_sub:admin_lvl_msg',
      userId: 'admin1',
      fields: {
        levelUpTitle: '🌟 境界突破 Lv.{level}',
        levelUpTemplate: '恭喜 {user} 晋升至 Lv.{level}，领取 {coins} {currency}！',
      },
    });
    await routeInteraction(submitMsgModal.interaction, ctx);
    const lvlCfg = ctx.repos.guildConfig.getOrCreate('g1').leveling;
    expect(lvlCfg.levelUpTitle).toBe('🌟 境界突破 Lv.{level}');
    expect(lvlCfg.levelUpTemplate).toBe('恭喜 {user} 晋升至 Lv.{level}，领取 {coins} {currency}！');

    const toggleAnnCh = createButtonMock({
      customId: 'menu:admin:toggle_announce_channel',
      userId: 'admin1',
    });
    await routeInteraction(toggleAnnCh.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling.announceChannelId).toBe('c1');

    const toggleStack = createButtonMock({
      customId: 'menu:admin:toggle_stack_roles',
      userId: 'admin1',
    });
    await routeInteraction(toggleStack.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling.stackRoles).toBe(false);

    // 3. Admin configures level-up reward roles via RoleSelect -> Modal -> StringSelect delete
    const everyonePick = createRoleSelectMock({
      customId: 'menu:role:admin_lvl_reward_add',
      userId: 'admin1',
      role: { id: 'g1', name: '@everyone' },
    });
    await routeInteraction(everyonePick.interaction, ctx);
    expect(everyonePick.showModal).not.toHaveBeenCalled();

    const rewardPick = createRoleSelectMock({
      customId: 'menu:role:admin_lvl_reward_add',
      userId: 'admin1',
      role: { id: 'role-lv5', name: '五级精英' },
    });
    await routeInteraction(rewardPick.interaction, ctx);
    expect(rewardPick.showModal).toHaveBeenCalledTimes(1);

    const rewardLevelModal = createModalMock({
      customId: 'menu:modal_sub:admin_lvl_reward_add:role-lv5',
      userId: 'admin1',
      fields: { level: '5' },
    });
    await routeInteraction(rewardLevelModal.interaction, ctx);
    expect(ctx.repos.profile.listLevelRewards('g1')).toEqual([
      { guildId: 'g1', level: 5, roleId: 'role-lv5' },
    ]);

    const rewardDel = createStringSelectMock({
      customId: 'menu:admin_lvl_reward_del',
      userId: 'admin1',
      values: ['5'],
    });
    await routeInteraction(rewardDel.interaction, ctx);
    expect(ctx.repos.profile.listLevelRewards('g1')).toHaveLength(0);

    // 4. Admin creates & populates self-role panel in menu, publishes to channel, and toggles modes
    const createPanelModal = createModalMock({
      customId: 'menu:modal_sub:admin_rp_create',
      userId: 'admin1',
      fields: {
        title: '身份标签',
        description: '自由挑选喜欢的身份组',
        selectionMode: '多选',
        displayMode: '按钮',
      },
    });
    await routeInteraction(createPanelModal.interaction, ctx);
    const panels = ctx.services.rolePanel.listPanels('g1');
    expect(panels).toHaveLength(1);
    const panelId = panels[0]!.id;

    const addRolePick = createRoleSelectMock({
      customId: `menu:role:admin_rp_add:${panelId}`,
      userId: 'admin1',
      role: { id: 'role-gamer', name: '游戏搭子' },
    });
    await routeInteraction(addRolePick.interaction, ctx);
    expect(addRolePick.showModal).toHaveBeenCalledTimes(1);

    const addRoleModal = createModalMock({
      customId: `menu:modal_sub:admin_rp_add:${panelId}:role-gamer`,
      userId: 'admin1',
      fields: { label: '游戏搭子', emoji: '🎮', description: '随时开黑' },
    });
    await routeInteraction(addRoleModal.interaction, ctx);

    const addRole2Modal = createModalMock({
      customId: `menu:modal_sub:admin_rp_add:${panelId}:role-owl`,
      userId: 'admin1',
      fields: { label: '夜猫子', emoji: '🌙', description: '' },
    });
    await routeInteraction(addRole2Modal.interaction, ctx);
    expect(ctx.services.rolePanel.getPanelWithOptions('g1', panelId)?.options).toHaveLength(2);

    const toggleMode = createButtonMock({
      customId: `menu:admin:rp_toggle_mode:${panelId}`,
      userId: 'admin1',
    });
    await routeInteraction(toggleMode.interaction, ctx);
    expect(ctx.services.rolePanel.getPanelWithOptions('g1', panelId)?.panel.selectionMode).toBe('single');

    const toggleModeBack = createButtonMock({
      customId: `menu:admin:rp_toggle_mode:${panelId}`,
      userId: 'admin1',
    });
    await routeInteraction(toggleModeBack.interaction, ctx);
    expect(ctx.services.rolePanel.getPanelWithOptions('g1', panelId)?.panel.selectionMode).toBe('multi');

    const sendPanel = createButtonMock({
      customId: `menu:admin:rp_send:${panelId}`,
      userId: 'admin1',
    });
    await routeInteraction(sendPanel.interaction, ctx);
    expect(sendPanel.channel.send).toHaveBeenCalledTimes(1);
    expect(ctx.services.rolePanel.getPanelWithOptions('g1', panelId)?.panel.messageId).toBe('pub-msg-1');

    // 5. Member picks self-service roles directly in /menu
    const navSelfRoles = createButtonMock({
      customId: 'menu:nav:self_roles',
      userId: 'member1',
    });
    await routeInteraction(navSelfRoles.interaction, ctx);
    expect(navSelfRoles.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('自助身份组');

    const pickRoles = createStringSelectMock({
      customId: `menu:self_role_pick:${panelId}`,
      userId: 'member1',
      values: ['role-owl'],
      initialRoles: ['role-gamer'],
    });
    await routeInteraction(pickRoles.interaction, ctx);
    expect(pickRoles.member.roles.remove).toHaveBeenCalledWith(['role-gamer'], expect.any(String));
    expect(pickRoles.member.roles.add).toHaveBeenCalledWith(['role-owl'], expect.any(String));

    const failPickRoles = createStringSelectMock({
      customId: `menu:self_role_pick:${panelId}`,
      userId: 'member1',
      values: ['role-owl'],
      failRoleAdd: true,
    });
    await routeInteraction(failPickRoles.interaction, ctx);
    expect(failPickRoles.deferUpdate).toHaveBeenCalledTimes(1);
    expect(failPickRoles.editReply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('身份组更新失败');

    // Admin removes an option & deletes panel (two-step confirm)
    const delOpt = createStringSelectMock({
      customId: `menu:admin_rp_del_opt:${panelId}`,
      userId: 'admin1',
      values: ['role-owl'],
    });
    await routeInteraction(delOpt.interaction, ctx);
    expect(ctx.services.rolePanel.getPanelWithOptions('g1', panelId)?.options).toHaveLength(1);

    const delPanelStep1 = createButtonMock({
      customId: `menu:admin:rp_delete:${panelId}`,
      userId: 'admin1',
    });
    await routeInteraction(delPanelStep1.interaction, ctx);
    expect(ctx.services.rolePanel.listPanels('g1')).toHaveLength(1);

    const delPanelConfirm = createButtonMock({
      customId: `menu:admin:rp_delete:${panelId}:confirm`,
      userId: 'admin1',
    });
    await routeInteraction(delPanelConfirm.interaction, ctx);
    expect(ctx.services.rolePanel.listPanels('g1')).toHaveLength(0);

    // 6. Member edits personal ID card via modal (rejects invalid color, saves valid card)
    const openCardModal = createButtonMock({
      customId: 'menu:modal:edit_card',
      userId: 'member1',
    });
    await routeInteraction(openCardModal.interaction, ctx);
    expect(openCardModal.showModal).toHaveBeenCalledTimes(1);

    const badColorModal = createModalMock({
      customId: 'menu:modal_sub:edit_card',
      userId: 'member1',
      fields: {
        cardNickname: '测试昵称',
        cardTag: '夜猫',
        cardBio: '签名',
        cardColor: '彩虹渐变',
      },
    });
    await routeInteraction(badColorModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'member1').cardNickname).toBeNull();

    const goodCardModal = createModalMock({
      customId: 'menu:modal_sub:edit_card',
      userId: 'member1',
      fields: {
        cardNickname: '冰熊骑士',
        cardTag: '深夜代码仙人',
        cardBio: '写代码不如睡觉',
        cardColor: '紫',
      },
    });
    await routeInteraction(goodCardModal.interaction, ctx);
    const savedProfile = ctx.repos.profile.getOrCreate('g1', 'member1');
    expect(savedProfile.cardNickname).toBe('冰熊骑士');
    expect(savedProfile.cardTag).toBe('深夜代码仙人');
    expect(savedProfile.cardBio).toBe('写代码不如睡觉');
    expect(savedProfile.cardColor).toBe('#9B59B6');
    const updatedEmbed = goodCardModal.update.mock.calls[0]![0].embeds?.[0]?.toJSON();
    expect(updatedEmbed?.author?.name).toContain('冰熊骑士');
    expect(updatedEmbed?.description).toContain('深夜代码仙人');

    // 7. Admin sets member growth stat via admin_ops UserSelect -> Modal
    const nonAdminSetStat = createUserSelectMock({
      customId: 'menu:user:admin_set_stat',
      userId: 'member1',
      target: { id: 'u9' },
    });
    await routeInteraction(nonAdminSetStat.interaction, ctx);
    expect(nonAdminSetStat.showModal).not.toHaveBeenCalled();

    const adminSetStatSelect = createUserSelectMock({
      customId: 'menu:user:admin_set_stat',
      userId: 'admin1',
      target: { id: 'u9' },
    });
    await routeInteraction(adminSetStatSelect.interaction, ctx);
    expect(adminSetStatSelect.showModal).toHaveBeenCalledTimes(1);

    const invalidStatModal = createModalMock({
      customId: 'menu:modal_sub:admin_set_stat:u9',
      userId: 'admin1',
      fields: { statValue: '-5' },
    });
    await routeInteraction(invalidStatModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u9').statValue).toBe(0);

    const validStatModal = createModalMock({
      customId: 'menu:modal_sub:admin_set_stat:u9',
      userId: 'admin1',
      fields: { statValue: '114514' },
    });
    await routeInteraction(validStatModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u9').statValue).toBe(114514);

    // 8. Admin shop management + user purchasing new item types
    const nonAdminShopNav = createButtonMock({
      customId: 'menu:nav:admin_shop',
      userId: 'member1',
    });
    await routeInteraction(nonAdminShopNav.interaction, ctx);
    expect(nonAdminShopNav.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
      '权限不足：仅服务器管理员',
    );

    const adminShopNav = createButtonMock({
      customId: 'menu:nav:admin_shop',
      userId: 'admin1',
    });
    await routeInteraction(adminShopNav.interaction, ctx);
    expect(adminShopNav.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('商店商品管理中心');

    const openStatModalBtn = createButtonMock({
      customId: 'menu:modal:admin_shop_stat',
      userId: 'admin1',
    });
    await routeInteraction(openStatModalBtn.interaction, ctx);
    expect(openStatModalBtn.showModal).toHaveBeenCalledTimes(1);

    const submitStatShopModal = createModalMock({
      customId: 'menu:modal_sub:admin_shop_stat',
      userId: 'admin1',
      fields: {
        name: '💊 强力药水',
        price: '600',
        minGain: '2',
        maxGain: '4',
        description: '每日限3次',
      },
    });
    await routeInteraction(submitStatShopModal.interaction, ctx);
    const statShopItem = ctx.services.shop.listItems('g1').find((i) => i.type === 'stat_boost');
    expect(statShopItem).toBeDefined();

    const customTitleShopItem = ctx.services.shop.createCustomTitleItem({
      guildId: 'g1',
      name: '✍️ 自定义称号券',
      description: '自拟称号',
      price: 1000,
      stock: null,
    });

    ctx.repos.profile.addCoins('g1', 'member1', 10_000);
    const buyCustomSelect = createStringSelectMock({
      customId: 'menu:shop_buy',
      userId: 'member1',
      values: [String(customTitleShopItem.id)],
    });
    await routeInteraction(buyCustomSelect.interaction, ctx);
    expect(buyCustomSelect.showModal).toHaveBeenCalledTimes(1);

    const submitCustomTitleModal = createModalMock({
      customId: `menu:modal_sub:shop_custom_title:${customTitleShopItem.id}`,
      userId: 'member1',
      fields: { titleText: '商店传奇大佬' },
    });
    await routeInteraction(submitCustomTitleModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'member1').equippedTitle).toBe('商店传奇大佬');

    const buyStatSelect = createStringSelectMock({
      customId: 'menu:shop_buy',
      userId: 'member1',
      values: [String(statShopItem!.id)],
    });
    await routeInteraction(buyStatSelect.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'member1').lastStatBoostDate).not.toBeNull();
    expect(ctx.repos.profile.getOrCreate('g1', 'member1').statBoostDailyCount).toBe(1);

    const delShopSelect = createStringSelectMock({
      customId: 'menu:admin_shop_del',
      userId: 'admin1',
      values: [String(statShopItem!.id)],
    });
    await routeInteraction(delShopSelect.interaction, ctx);
    expect(ctx.services.shop.listItems('g1').some((i) => i.id === statShopItem!.id)).toBe(true);

    const delShopConfirm = createButtonMock({
      customId: `menu:admin:shop_del_confirm:${statShopItem!.id}:1`,
      userId: 'admin1',
    });
    await routeInteraction(delShopConfirm.interaction, ctx);
    expect(ctx.services.shop.listItems('g1').some((i) => i.id === statShopItem!.id)).toBe(false);

    ctx.db.close();
  });

  it('handles admin_ai panel navigation, preset switch, channel select, modal edits, and /ai commands', async () => {
    const ctx = createTestCtx();
    ctx.repos.guildConfig.updateAdminUsers('g1', ['admin1']);

    // Non-admin blocked from admin_ai
    const deniedNav = createButtonMock({ customId: 'menu:nav:admin_ai', userId: 'member1' });
    await routeInteraction(deniedNav.interaction, ctx);
    expect(deniedNav.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('权限不足');

    // Admin opens admin_ai
    const adminNav = createButtonMock({ customId: 'menu:nav:admin_ai', userId: 'admin1' });
    await routeInteraction(adminNav.interaction, ctx);
    expect(adminNav.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('AI 对话与人格记忆管理');

    // Switch persona preset
    const presetSelect = createStringSelectMock({
      customId: 'menu:admin_ai_preset',
      userId: 'admin1',
      values: ['roast'],
    });
    await routeInteraction(presetSelect.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.preset).toBe('roast');
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.personaName).toBe('毒舌使者');

    const beautySelect = createStringSelectMock({
      customId: 'menu:admin_ai_preset',
      userId: 'admin1',
      values: ['beauty'],
    });
    await routeInteraction(beautySelect.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.preset).toBe('beauty');
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.personaName).toBe('黑吊国第一美女');

    // Configure free-chat channels & ignored channels via ChannelSelect
    const freeChan = createChannelSelectMock({
      customId: 'menu:chan:admin_ai_free',
      userId: 'admin1',
      values: ['c_free_1', 'c_free_2'],
    });
    await routeInteraction(freeChan.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.freeChatChannelIds).toEqual([
      'c_free_1',
      'c_free_2',
    ]);

    const ignoreChan = createChannelSelectMock({
      customId: 'menu:chan:admin_ai_ignore',
      userId: 'admin1',
      values: ['c_bad'],
    });
    await routeInteraction(ignoreChan.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.ignoredChannelIds).toEqual(['c_bad']);

    // Edit persona & worldbook via Modal
    const personaModal = createModalMock({
      customId: 'menu:modal_sub:admin_ai_persona',
      userId: 'admin1',
      fields: {
        personaName: '夜猫使者',
        identityPrompt: '你是深夜陪聊的群友。',
        soulPrompt: '说话简短幽默。',
        worldbook: '本群叫黑吊国，大家爱打游戏。',
      },
    });
    await routeInteraction(personaModal.interaction, ctx);
    const afterPersona = ctx.repos.guildConfig.getOrCreate('g1').ai;
    expect(afterPersona.preset).toBe('custom');
    expect(afterPersona.personaName).toBe('夜猫使者');
    expect(afterPersona.worldbook).toBe('本群叫黑吊国，大家爱打游戏。');

    // Edit model & parameters via Modal
    const paramsModal = createModalMock({
      customId: 'menu:modal_sub:admin_ai_params',
      userId: 'admin1',
      fields: {
        modelOverride: 'gemini-custom',
        temperature: '0.65',
        maxTokens: '2048',
        contextWindowMessages: '16',
        maxMemoriesPerScope: '40',
      },
    });
    await routeInteraction(paramsModal.interaction, ctx);
    const afterParams = ctx.repos.guildConfig.getOrCreate('g1').ai;
    expect(afterParams.modelOverride).toBe('gemini-custom');
    expect(afterParams.temperature).toBe(0.65);
    expect(afterParams.maxTokens).toBe(2048);
    expect(afterParams.contextWindowMessages).toBe(16);
    expect(afterParams.maxMemoriesPerScope).toBe(40);

    // Toggle memory & vision
    const toggleMem = createButtonMock({
      customId: 'menu:admin:ai_toggle_memory',
      userId: 'admin1',
    });
    await routeInteraction(toggleMem.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.memoryEnabled).toBe(false);

    const toggleVis = createButtonMock({
      customId: 'menu:admin:ai_toggle_vision',
      userId: 'admin1',
    });
    await routeInteraction(toggleVis.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.visionEnabled).toBe(false);

    // /ai reset command
    const aiResetCmd = createChatCommandMock({
      commandName: 'ai',
      userId: 'member1',
      subcommand: 'reset',
    });
    await routeInteraction(aiResetCmd.interaction, ctx);
    expect(ctx.services.ai.getChannelResetAt('g1', 'c1')).toBeGreaterThan(0);

    // /ai memory add -> list -> delete (non-admin cannot add guild memory, can manage own user memory)
    const aiMemAddDenied = createChatCommandMock({
      commandName: 'ai',
      userId: 'member1',
      subcommandGroup: 'memory',
      subcommand: 'add',
      strings: { content: '越权记忆', scope: 'guild' },
    });
    await routeInteraction(aiMemAddDenied.interaction, ctx);
    expect(aiMemAddDenied.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('权限不足');

    const aiMemAddUser = createChatCommandMock({
      commandName: 'ai',
      userId: 'member1',
      subcommandGroup: 'memory',
      subcommand: 'add',
      strings: { content: '喜欢打黑神话', category: 'hobby', scope: 'user' },
    });
    await routeInteraction(aiMemAddUser.interaction, ctx);
    const saved = ctx.services.ai.listMemories('g1', 'user', 'member1');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.content).toBe('喜欢打黑神话');

    const aiMemList = createChatCommandMock({
      commandName: 'ai',
      userId: 'member1',
      subcommandGroup: 'memory',
      subcommand: 'list',
      strings: { scope: 'user' },
    });
    await routeInteraction(aiMemList.interaction, ctx);
    expect(aiMemList.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('喜欢打黑神话');

    const aiMemDel = createChatCommandMock({
      commandName: 'ai',
      userId: 'member1',
      subcommandGroup: 'memory',
      subcommand: 'delete',
      integers: { id: saved[0]!.id },
    });
    await routeInteraction(aiMemDel.interaction, ctx);
    expect(ctx.services.ai.listMemories('g1', 'user', 'member1')).toHaveLength(0);

    // admin_ai:regex tab navigation, modal add (invalid + valid), toggle, delete, anti-cliche toggle, reset
    const regexNav = createButtonMock({ customId: 'menu:nav:admin_ai:regex:1', userId: 'admin1' });
    await routeInteraction(regexNav.interaction, ctx);
    expect(regexNav.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('AI 正则规则管理');

    const badRegexModal = createModalMock({
      customId: 'menu:modal_sub:admin_ai_regex_add',
      userId: 'admin1',
      fields: {
        label: '坏正则',
        pattern: '(a+)+',
        replacement: 'x',
        scope: 'output',
        flags: 'g',
      },
    });
    await routeInteraction(badRegexModal.interaction, ctx);
    expect(badRegexModal.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('回溯');

    const okRegexModal = createModalMock({
      customId: 'menu:modal_sub:admin_ai_regex_add',
      userId: 'admin1',
      fields: {
        label: '测别名',
        pattern: '菜鸡',
        replacement: '大佬',
        scope: 'both',
        flags: 'gi',
      },
    });
    await routeInteraction(okRegexModal.interaction, ctx);
    const addedRule = ctx.repos.guildConfig.getOrCreate('g1').ai.regexRules.find((r) => r.label === '测别名');
    expect(addedRule).toBeDefined();

    const toggleRuleSelect = createStringSelectMock({
      customId: 'menu:admin_ai_regex_toggle:1',
      userId: 'admin1',
      values: [addedRule!.id],
    });
    await routeInteraction(toggleRuleSelect.interaction, ctx);
    expect(
      ctx.repos.guildConfig.getOrCreate('g1').ai.regexRules.find((r) => r.id === addedRule!.id)?.enabled,
    ).toBe(false);

    const delRuleSelect = createStringSelectMock({
      customId: 'menu:admin_ai_regex_delete:1',
      userId: 'admin1',
      values: [addedRule!.id],
    });
    await routeInteraction(delRuleSelect.interaction, ctx);
    expect(
      ctx.repos.guildConfig.getOrCreate('g1').ai.regexRules.some((r) => r.id === addedRule!.id),
    ).toBe(false);

    const toggleClicheBtn = createButtonMock({
      customId: 'menu:admin:ai_toggle_cliche_prompt',
      userId: 'admin1',
    });
    await routeInteraction(toggleClicheBtn.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.antiClichePromptEnabled).toBe(false);

    const resetRegexBtn = createButtonMock({
      customId: 'menu:admin:ai_regex_reset',
      userId: 'admin1',
    });
    await routeInteraction(resetRegexBtn.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.antiClichePromptEnabled).toBe(true);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.regexRules.length).toBeGreaterThan(0);

    // admin_ai:usage tab, pricing modal, and clear usage logs
    ctx.repos.aiMemory.recordUsageLog({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'member1',
      model: 'demo-model',
      status: 'ok',
      promptTokens: 500_000,
      completionTokens: 100_000,
      totalTokens: 600_000,
      latencyMs: 320,
    });
    const usageNav = createButtonMock({ customId: 'menu:nav:admin_ai:usage', userId: 'admin1' });
    await routeInteraction(usageNav.interaction, ctx);
    expect(usageNav.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('Token 用量与费用监控');

    const pricingModal = createModalMock({
      customId: 'menu:modal_sub:admin_ai_pricing',
      userId: 'admin1',
      fields: {
        inputPricePer1MUsd: '1.5',
        outputPricePer1MUsd: '6',
      },
    });
    await routeInteraction(pricingModal.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.inputPricePer1MUsd).toBe(1.5);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.outputPricePer1MUsd).toBe(6);
    expect(pricingModal.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('$1.3500');

    const clearUsageBtn = createButtonMock({ customId: 'menu:admin:ai_clear_usage', userId: 'admin1' });
    await routeInteraction(clearUsageBtn.interaction, ctx);
    expect(ctx.services.ai.getUsageSummary('g1', 24).totalCalls).toBe(0);

    ctx.db.close();
  });

  it('supports bank vault heist (menu:user:rob_bank), >1M coin grants, admin random/system red packets, boss cooldown card preservation, and admin_monitor logging', async () => {
    const ctx = createTestCtx();
    ctx.repos.guildConfig.updateAdminUsers('g1', ['admin1']);

    // 1. Admin single grant > 1,000,000 (e.g. 50,000,000)
    const highGrantModal = createModalMock({
      customId: 'menu:modal_sub:admin_grant:u1',
      userId: 'admin1',
      fields: { amount: '50000000' },
    });
    await routeInteraction(highGrantModal.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBe(50_000_000);

    // 2. Admin random red packet distribution (5,000,000 across 2 members, requires Guild Super Admin)
    const membersMap = new Map([
      ['u1', { id: 'u1', user: makeMockUser({ id: 'u1' }) }],
      ['u2', { id: 'u2', user: makeMockUser({ id: 'u2' }) }],
      ['b1', { id: 'b1', user: makeMockUser({ id: 'b1', bot: true }) }],
    ]);
    const randomRpModal = createModalMock({
      customId: 'menu:modal_sub:admin_random_redpacket',
      userId: 'admin1',
      isAdmin: true,
      fields: {
        totalAmount: '5000000',
        totalCount: '2',
        greeting: '五百万随机大红包',
      },
      membersMap,
    });
    await routeInteraction(randomRpModal.interaction, ctx);
    expect(randomRpModal.deferUpdate).toHaveBeenCalledTimes(1);
    expect(randomRpModal.channel.send).toHaveBeenCalledTimes(1);
    expect(randomRpModal.channel.send.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain(
      '五百万随机大红包',
    );
    const totalAfterRandomRp =
      ctx.repos.profile.getOrCreate('g1', 'u1').coins +
      ctx.repos.profile.getOrCreate('g1', 'u2').coins;
    expect(totalAfterRandomRp).toBe(55_000_000);

    // 3. Admin system-funded red packet card in channel
    const sysRpModal = createModalMock({
      customId: 'menu:modal_sub:admin_sys_redpacket',
      userId: 'admin1',
      fields: {
        totalAmount: '20000000',
        totalCount: '5',
        greeting: '两千万系统红包',
      },
    });
    await routeInteraction(sysRpModal.interaction, ctx);
    expect(sysRpModal.channel.send).toHaveBeenCalledTimes(1);
    expect(ctx.repos.profile.getOrCreate('g1', 'admin1').coins).toBe(0);

    // 4. Bank Vault Heist via menu:user:rob_bank
    ctx.services.economy.deposit('g1', 'u1', 10_000);
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateEconomy('g1', {
      ...cfg.economy,
      robBankSuccessRate: 1.0,
      robCooldownSec: 0,
      robTargetShieldSec: 0,
    });
    const robBankSelect = createUserSelectMock({
      customId: 'menu:user:rob_bank',
      userId: 'u2',
      target: { id: 'u1' },
    });
    await routeInteraction(robBankSelect.interaction, ctx);
    expect(robBankSelect.deferUpdate).toHaveBeenCalledTimes(1);
    expect(robBankSelect.editReply).toHaveBeenCalledTimes(1);
    expect(robBankSelect.channel!.send).toHaveBeenCalledTimes(1);
    expect(robBankSelect.channel!.send.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain(
      '银行金库大劫案',
    );
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').bankCoins).toBeLessThan(10_000);

    // 5. World Boss cooldown click replies immediately without editing/wiping the Boss card
    const boss = ctx.services.worldEvent.spawnBoss('g1', 'c1');
    const hit1 = createButtonMock({ customId: `ev:boss:hit:${boss.id}:normal`, userId: 'u1' });
    await routeInteraction(hit1.interaction, ctx);
    expect(hit1.update).toHaveBeenCalledTimes(1);

    const hitCooldown = createButtonMock({
      customId: `ev:boss:hit:${boss.id}:normal`,
      userId: 'u1',
    });
    await routeInteraction(hitCooldown.interaction, ctx);
    expect(hitCooldown.reply).toHaveBeenCalledTimes(1);
    expect(hitCooldown.msgEdit).not.toHaveBeenCalled();

    // 6. Unhandled interaction fallback & admin_monitor dashboard view
    const unhandledBtn = createButtonMock({
      customId: 'unknown_prefix:noop',
      userId: 'u1',
    });
    await routeInteraction(unhandledBtn.interaction, ctx);
    expect(unhandledBtn.reply).toHaveBeenCalledTimes(1);
    expect(unhandledBtn.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain(
      '交互未响应',
    );

    const monitorNav = createButtonMock({
      customId: 'menu:nav:admin_monitor',
      userId: 'admin1',
    });
    await routeInteraction(monitorNav.interaction, ctx);
    const monitorEmbed = monitorNav.update.mock.calls[0]![0].embeds?.[0]?.toJSON();
    expect(monitorEmbed?.title).toContain('运行监控与交互诊断中心');
    expect(monitorEmbed?.description).toContain('unknown_prefix:noop');

    const monitorAllBtn = createButtonMock({
      customId: 'menu:admin_monitor:filter:all',
      userId: 'admin1',
    });
    await routeInteraction(monitorAllBtn.interaction, ctx);
    expect(
      monitorAllBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description,
    ).toContain('全部交互流水');

    const monitorClearStep1 = createButtonMock({
      customId: 'menu:admin_monitor:clear',
      userId: 'admin1',
      isAdmin: true,
    });
    await routeInteraction(monitorClearStep1.interaction, ctx);
    expect(
      monitorClearStep1.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description,
    ).toContain('确认清空');

    const monitorClearBtn = createButtonMock({
      customId: 'menu:admin_monitor:clear:confirm',
      userId: 'admin1',
      isAdmin: true,
    });
    await routeInteraction(monitorClearBtn.interaction, ctx);
    expect(
      monitorClearBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description,
    ).toContain('已清理本服务器');

    ctx.db.close();
  });

  it('toggles creditLoan and rpg modules via admin_toggle_mod and refunds exact credit-adjusted finalPrice on role grant failure', async () => {
    const ctx = createTestCtx();
    ctx.repos.guildConfig.updateAdminUsers('g1', ['admin1']);

    // 1. Toggle creditLoan and rpg off then back on via menu:admin_toggle_mod
    for (const modKey of ['creditLoan', 'rpg'] as const) {
      expect(ctx.repos.guildConfig.getOrCreate('g1').modules[modKey]).toBe(true);

      const toggleOff = createStringSelectMock({
        customId: 'menu:admin_toggle_mod',
        userId: 'admin1',
        values: [modKey],
      });
      await routeInteraction(toggleOff.interaction, ctx);
      expect(ctx.repos.guildConfig.getOrCreate('g1').modules[modKey]).toBe(false);

      const toggleOn = createStringSelectMock({
        customId: 'menu:admin_toggle_mod',
        userId: 'admin1',
        values: [modKey],
      });
      await routeInteraction(toggleOn.interaction, ctx);
      expect(ctx.repos.guildConfig.getOrCreate('g1').modules[modKey]).toBe(true);
    }

    // 2. Role purchase failure refunds exact credit-adjusted finalPrice (no coin-minting exploit)
    const roleItem = ctx.services.shop.createRoleItem({
      guildId: 'g1',
      name: '贵族身份组',
      description: '测试退款防刷币',
      price: 1000,
      roleId: 'role_vip',
      stock: 5,
    });

    // Noble (score 900 -> 0.8x -> finalPrice 800)
    ctx.services.creditLoan.adjustCredit('g1', 'u_noble', 300, 'test_noble');
    ctx.repos.profile.addCoins('g1', 'u_noble', 2000);
    const nobleFail = createStringSelectMock({
      customId: 'menu:shop_buy',
      userId: 'u_noble',
      values: [String(roleItem.id)],
      failRoleAdd: true,
    });
    await routeInteraction(nobleFail.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u_noble').coins).toBe(2000);

    // Deadbeat (score 200 -> 1.25x -> finalPrice 1250)
    ctx.services.creditLoan.adjustCredit('g1', 'u_deadbeat', -400, 'test_deadbeat');
    ctx.repos.profile.addCoins('g1', 'u_deadbeat', 2000);
    const deadbeatFail = createStringSelectMock({
      customId: 'menu:shop_buy',
      userId: 'u_deadbeat',
      values: [String(roleItem.id)],
      failRoleAdd: true,
    });
    await routeInteraction(deadbeatFail.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u_deadbeat').coins).toBe(2000);

    // Stock restored intact
    const reloadedItem = ctx.services.shop.listItems('g1').find((i) => i.id === roleItem.id);
    expect(reloadedItem?.stock).toBe(5);

    ctx.db.close();
  });

  it('routes cl:/rpg:/lb: interactions, menu credit/loan/hustle/rpg navigation, 12-board leaderboard selector, and admin_credit_rpg modals', async () => {
    const ctx = createTestCtx();
    ctx.repos.guildConfig.updateAdminUsers('g1', ['admin1']);
    ctx.repos.profile.addCoins('g1', 'u1', 50_000);
    ctx.repos.profile.addCoins('g1', 'u2', 50_000);

    // 1. menu:nav:credit / loan / hustle / rpg
    for (const nav of ['credit', 'loan', 'hustle', 'rpg'] as const) {
      const btn = createButtonMock({ customId: `menu:nav:${nav}`, userId: 'u1' });
      await routeInteraction(btn.interaction, ctx);
      expect(btn.update).toHaveBeenCalledTimes(1);
    }

    // 2. Module toggle blocks credit/rpg nav cleanly
    const origCfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateModules('g1', { ...origCfg.modules, creditLoan: false, rpg: false });
    const blockedCredit = createButtonMock({ customId: 'menu:nav:loan', userId: 'u1' });
    await routeInteraction(blockedCredit.interaction, ctx);
    expect(blockedCredit.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
      '已关闭',
    );
    const blockedRpg = createButtonMock({ customId: 'menu:nav:rpg', userId: 'u1' });
    await routeInteraction(blockedRpg.interaction, ctx);
    expect(blockedRpg.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('已关闭');
    ctx.repos.guildConfig.updateModules('g1', origCfg.modules);

    // 3. Router dispatches cl: button & rpg: button -> active run -> menu:nav:rpg opens run view
    const clBtn = createButtonMock({ customId: 'cl:nav:review:endorse', userId: 'u1' });
    await routeInteraction(clBtn.interaction, ctx);
    expect(clBtn.update).toHaveBeenCalledTimes(1);

    const pickClass = createButtonMock({ customId: 'rpg:pick_class:warrior', userId: 'u1' });
    await routeInteraction(pickClass.interaction, ctx);
    expect(pickClass.update).toHaveBeenCalledTimes(1);
    expect(ctx.repos.rpg.getCharacter('g1', 'u1')?.classSelected).toBe(true);

    const startCh1 = createButtonMock({ customId: 'rpg:start:1', userId: 'u1' });
    await routeInteraction(startCh1.interaction, ctx);
    expect(startCh1.update).toHaveBeenCalledTimes(1);
    expect(ctx.services.rpg.getActiveRun('g1', 'u1')).not.toBeNull();

    // Navigating menu:nav:rpg while classic run is active opens classic run view
    const resumeRpg = createButtonMock({ customId: 'menu:nav:rpg', userId: 'u1' });
    await routeInteraction(resumeRpg.interaction, ctx);
    expect(resumeRpg.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('第 1 章');

    // Retreat classic run -> start tabletop run via router -> menu:nav:rpg auto-resumes tabletop view
    const retreatClassic = createButtonMock({ customId: 'rpg:act:retreat', userId: 'u1' });
    await routeInteraction(retreatClassic.interaction, ctx);
    const startTtCh1 = createButtonMock({ customId: 'rpg:start_tt:1', userId: 'u1' });
    await routeInteraction(startTtCh1.interaction, ctx);
    expect(ctx.services.rpg.getActiveTabletopRun('g1', 'u1')).not.toBeNull();
    const resumeTtRpg = createButtonMock({ customId: 'menu:nav:rpg', userId: 'u1' });
    await routeInteraction(resumeTtRpg.interaction, ctx);
    expect(resumeTtRpg.update.mock.calls[0]![0].embeds?.[0]?.toJSON().author?.name).toContain(
      '博德跑团中',
    );

    // 4. 12-board leaderboard StringSelectMenu (menu:lb_select) & public lb:select
    ctx.services.creditLoan.recordGamblingResult('g1', 'u1', 2000, 1500);
    const lbGambling = createStringSelectMock({
      customId: 'menu:lb_select',
      userId: 'u1',
      values: ['gambling_profit'],
    });
    await routeInteraction(lbGambling.interaction, ctx);
    const lbDesc = lbGambling.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description ?? '';
    expect(lbDesc).toContain('总赢 +1,500');
    expect(lbDesc).toContain('总亏 -0');

    const lbCp = createStringSelectMock({
      customId: 'menu:lb_select',
      userId: 'u1',
      values: ['cp_lb'],
    });
    await routeInteraction(lbCp.interaction, ctx);
    expect(lbCp.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('亲密');

    const lbBounty = createStringSelectMock({
      customId: 'menu:lb_select',
      userId: 'u1',
      values: ['bounty'],
    });
    await routeInteraction(lbBounty.interaction, ctx);
    expect(lbBounty.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('悬赏');

    const publicLbSelect = createStringSelectMock({
      customId: 'lb:select',
      userId: 'u1',
      values: ['rpg'],
    });
    await routeInteraction(publicLbSelect.interaction, ctx);
    expect(publicLbSelect.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('RPG');

    // 5. Admin credit/loan/RPG tuning panel & modals
    const navAdminCr = createButtonMock({ customId: 'menu:nav:admin_credit_rpg', userId: 'admin1' });
    await routeInteraction(navAdminCr.interaction, ctx);
    expect(navAdminCr.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('信用 / 借贷 / 西幻 RPG');

    for (const modalId of ['admin_cl_loan', 'admin_cl_hustle', 'admin_rpg_cfg'] as const) {
      const openBtn = createButtonMock({ customId: `menu:modal:${modalId}`, userId: 'admin1' });
      await routeInteraction(openBtn.interaction, ctx);
      expect(openBtn.showModal).toHaveBeenCalledTimes(1);
    }

    const subLoan = createModalMock({
      customId: 'menu:modal_sub:admin_cl_loan',
      userId: 'admin1',
      fields: {
        bankLoanMaxCap: '800000',
        usuryLoanMax: '200000',
        usuryDailyRatePct: '15',
        usuryTermDays: '3',
        garnishRatePct: '60',
      },
    });
    await routeInteraction(subLoan.interaction, ctx);
    const afterLoan = ctx.repos.guildConfig.getOrCreate('g1').creditLoan;
    expect(afterLoan.bankLoanMaxCap).toBe(800_000);
    expect(afterLoan.usuryLoanMax).toBe(200_000);
    expect(afterLoan.usuryDailyRate).toBe(0.15);
    expect(afterLoan.usuryTermDays).toBe(3);
    expect(afterLoan.garnishRate).toBe(0.6);

    const subHustle = createModalMock({
      customId: 'menu:modal_sub:admin_cl_hustle',
      userId: 'admin1',
      fields: {
        hustleCooldownSec: '43200',
        hustleMinMultiplier: '3',
        hustleMaxMultiplier: '6',
        hustleCreditPenalty: '12',
        dailyReviewLimit: '5',
      },
    });
    await routeInteraction(subHustle.interaction, ctx);
    const afterHustle = ctx.repos.guildConfig.getOrCreate('g1').creditLoan;
    expect(afterHustle.hustleCooldownSec).toBe(43_200);
    expect(afterHustle.hustleMinMultiplier).toBe(3);
    expect(afterHustle.hustleMaxMultiplier).toBe(6);
    expect(afterHustle.hustleCreditPenalty).toBe(12);
    expect(afterHustle.dailyReviewLimit).toBe(5);

    const subRpg = createModalMock({
      customId: 'menu:modal_sub:admin_rpg_cfg',
      userId: 'admin1',
      fields: {
        dailyStamina: '8',
        staminaPotionPrice: '2500',
        staminaPotionDailyLimit: '5',
        classSwitchCost: '8000',
        bagCapacity: '50',
      },
    });
    await routeInteraction(subRpg.interaction, ctx);
    const afterRpg = ctx.repos.guildConfig.getOrCreate('g1').rpg;
    expect(afterRpg).toEqual({
      dailyStamina: 8,
      staminaPotionPrice: 2500,
      staminaPotionDailyLimit: 5,
      classSwitchCost: 8000,
      bagCapacity: 50,
    });

    const resetHustleBtn = createButtonMock({
      customId: 'menu:admin:reset_hustle_cd',
      userId: 'admin1',
    });
    ctx.services.creditLoan.sellButt('g1', 'u1', Date.now(), () => 0.5);
    expect(ctx.services.creditLoan.getHustleStats('g1', 'u1').lastHustleAt).toBeGreaterThan(0);
    await routeInteraction(resetHustleBtn.interaction, ctx);
    expect(ctx.services.creditLoan.getHustleStats('g1', 'u1').lastHustleAt).toBe(0);

    const resetBtn = createButtonMock({
      customId: 'menu:admin:reset_credit_rpg',
      userId: 'admin1',
    });
    await routeInteraction(resetBtn.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').rpg.dailyStamina).toBe(5);
    expect(ctx.repos.guildConfig.getOrCreate('g1').creditLoan.garnishRate).toBe(0.5);

    ctx.db.close();
  });
});
