import {
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIEmbed,
  type APIMessageActionRowComponent,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { menuCommand } from '../../src/commands/general/menu.js';
import { configCommand } from '../../src/commands/general/config.js';
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
import { routeInteraction } from '../../src/interactions/router.js';
import { BlackjackManager } from '../../src/services/blackjackService.js';
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

function makeMockMember(userId: string, isAdmin = false, failRoleAdd = false) {
  const rolesAdd = failRoleAdd
    ? vi.fn(async () => {
        throw new Error('50013 Missing Permissions');
      })
    : vi.fn(async () => undefined);

  return {
    id: userId,
    permissions: {
      has: (perm: bigint) => isAdmin && perm === PermissionFlagsBits.Administrator,
    },
    roles: {
      cache: new Map<string, { id: string }>(),
      add: rolesAdd,
    },
  };
}

function createChatCommandMock(opts: {
  commandName: string;
  userId: string;
  mode?: string | null;
  isAdmin?: boolean;
  channel?: MockChannel;
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
      getString: (name: string) => (name === 'mode' ? (opts.mode ?? null) : null),
    },
    inCachedGuild: () => true,
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
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
  channel?: MockChannel | null;
  fetchedChannel?: MockChannel | null;
  messageCustomIds?: string[];
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
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
    guild: { id: 'g1', name: '测试服务器' },
    channelId: channel?.id ?? 'c1',
    channel,
    client: {
      channels: {
        fetch: fetchChannel,
      },
    },
    user: makeMockUser({ id: opts.userId }),
    member: makeMockMember(opts.userId),
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
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply,
    update,
    followUp,
    deferUpdate,
    showModal,
  };

  return {
    interaction: mock as unknown as ButtonInteraction & Interaction,
    reply,
    update,
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
  failRoleAdd?: boolean;
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const followUp = vi.fn(async (_payload: MockPayload) => undefined);
  const member = makeMockMember(opts.userId, false, opts.failRoleAdd ?? false);

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    guild: { id: 'g1', name: '测试服务器' },
    channelId: 'c1',
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
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply,
    update,
    followUp,
  };

  return {
    interaction: mock as unknown as StringSelectMenuInteraction & Interaction,
    reply,
    update,
    member,
  };
}

function createUserSelectMock(opts: {
  customId: string;
  userId: string;
  target: MockUserInput;
  channel?: MockChannel | null;
  fetchedChannel?: MockChannel | null;
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const deferUpdate = vi.fn(async () => undefined);
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
    guild: { id: 'g1', name: '测试服务器' },
    channelId: channel?.id ?? 'c1',
    channel,
    client: {
      channels: {
        fetch: fetchChannel,
      },
    },
    values: [targetUser.id],
    users,
    user: makeMockUser({ id: opts.userId }),
    member: makeMockMember(opts.userId),
    replied: false,
    deferred: false,
    inCachedGuild: () => true,
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => true,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply,
    update,
    deferUpdate,
    showModal,
  };

  return {
    interaction: mock as unknown as UserSelectMenuInteraction & Interaction,
    reply,
    update,
    deferUpdate,
    showModal,
    channel,
    fetchChannel,
  };
}

function createModalMock(opts: {
  customId: string;
  userId: string;
  fields: Record<string, string>;
  fromMessage?: boolean;
  channel?: MockChannel;
}) {
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const followUp = vi.fn(async (_payload: MockPayload) => undefined);
  const channel = opts.channel ?? makeMockChannel(true);
  const fromMessage = opts.fromMessage ?? true;

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    guild: { id: 'g1', name: '测试服务器' },
    channelId: channel.id,
    channel,
    user: makeMockUser({ id: opts.userId }),
    member: makeMockMember(opts.userId),
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
    isModalSubmit: () => true,
    isRepliable: () => true,
    reply,
    update,
    followUp,
  };

  return {
    interaction: mock as unknown as ModalSubmitInteraction & Interaction,
    reply,
    update,
    channel,
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

    // Daily action from solo keeps solo view
    const dailyOnSolo = createButtonMock({
      customId: 'menu:act:daily',
      userId: 'u1',
      messageCustomIds: ['menu:nav:slots'],
    });
    await routeInteraction(dailyOnSolo.interaction, ctx);
    expect(dailyOnSolo.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('独立游玩');
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBe(200);

    // Work & fortune
    const workBtn = createButtonMock({ customId: 'menu:act:work', userId: 'u1' });
    await routeInteraction(workBtn.interaction, ctx);
    expect(ctx.repos.profile.getOrCreate('g1', 'u1').coins).toBeGreaterThan(200);

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

    // Valid rob executes & sends public content with mentions + amount + embed
    const robTarget = createUserSelectMock({
      customId: 'menu:user:rob',
      userId: 'attacker',
      target: { id: 'victim' },
    });
    await routeInteraction(robTarget.interaction, ctx);
    expect(robTarget.update).toHaveBeenCalledTimes(1);
    expect(robTarget.channel!.send).toHaveBeenCalledTimes(1);
    const robBroadcast = robTarget.channel!.send.mock.calls[0]![0];
    expect(robBroadcast.content).toContain('<@attacker>');
    expect(robBroadcast.content).toContain('<@victim>');
    expect(robBroadcast.embeds?.[0]?.toJSON().title).toMatch(/抢钱/);

    // Fallback channel fetch works when interaction.channel is null
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
    expect(payModal.update).toHaveBeenCalledTimes(1);

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

    // Social user select -> sends public embed & updates menu
    const socialUser = createUserSelectMock({
      customId: 'menu:user:social:hug',
      userId: 'u1',
      target: { id: 'u2' },
    });
    await routeInteraction(socialUser.interaction, ctx);
    expect(socialUser.channel.send).toHaveBeenCalledTimes(1);
    expect(socialUser.update).toHaveBeenCalledTimes(1);

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

    // Leaderboard pagination
    for (let i = 1; i <= 12; i++) {
      ctx.repos.profile.addCoins('g1', `rich-${i}`, i * 100);
    }
    const lbPage1 = createButtonMock({ customId: 'menu:rank:coins:1', userId: 'u1' });
    await routeInteraction(lbPage1.interaction, ctx);
    expect(lbPage1.update.mock.calls[0]![0].embeds?.[0]?.toJSON().footer?.text).toContain('第 1 / 2 页');

    const lbPage2 = createButtonMock({ customId: 'menu:rank:coins:2:next', userId: 'u1' });
    await routeInteraction(lbPage2.interaction, ctx);
    expect(lbPage2.update.mock.calls[0]![0].embeds?.[0]?.toJSON().footer?.text).toContain('第 2 / 2 页');

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
      },
    });
    const bjWin = createButtonMock({ customId: 'menu:bj_start:500', userId: 'u1' });
    await routeInteraction(bjWin.interaction, ctx);
    expect(bjWin.channel!.send).toHaveBeenCalledTimes(1);
    expect(bjWin.channel!.send.mock.calls[0]![0].content).toContain('<@u1>');

    // Share rank & leaderboard to channel
    const shareRank = createButtonMock({ customId: 'menu:share:rank', userId: 'u1' });
    await routeInteraction(shareRank.interaction, ctx);
    expect(shareRank.channel!.send).toHaveBeenCalledTimes(1);
    expect(shareRank.channel!.send.mock.calls[0]![0].embeds).toHaveLength(1);
    expect(shareRank.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('晒出');

    const shareLb = createButtonMock({ customId: 'menu:share:lb:coins:1', userId: 'u1' });
    await routeInteraction(shareLb.interaction, ctx);
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
});
