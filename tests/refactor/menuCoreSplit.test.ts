import {
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIMessageActionRowComponent,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/core/context.js';
import { createDatabase } from '../../src/db/database.js';
import { AiMemoryRepo } from '../../src/db/repositories/aiMemoryRepo.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { CreditLoanRepo } from '../../src/db/repositories/creditLoanRepo.js';
import { FunRepo } from '../../src/db/repositories/funRepo.js';
import { GiveawayRepo } from '../../src/db/repositories/giveawayRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { ImageRepo } from '../../src/db/repositories/imageRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo } from '../../src/db/repositories/redPacketRepo.js';
import { RolePanelRepo } from '../../src/db/repositories/rolePanelRepo.js';
import { RpgRepo } from '../../src/db/repositories/rpgRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { TicketRepo } from '../../src/db/repositories/ticketRepo.js';
import { WorldEventRepo } from '../../src/db/repositories/worldEventRepo.js';
import { AiService } from '../../src/services/aiService.js';
import { BlackjackManager } from '../../src/services/blackjackService.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { CreditLoanService } from '../../src/services/creditLoanService.js';
import { EconomyService } from '../../src/services/economyService.js';
import { FunService } from '../../src/services/funService.js';
import { GiveawayService } from '../../src/services/giveawayService.js';
import { ImageClient } from '../../src/services/imageClient.js';
import { ImageService } from '../../src/services/imageService.js';
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
  MENU_VIEW_BUILDERS,
  SOCIAL_ACTIONS,
  buildDuelMessage,
  buildLobbyMessage,
  buildMenuMessage,
  buildPublicLeaderboardEmbed,
  buildPublicRankEmbed,
  buildRedPacketMessage,
  truncateText,
  type MenuActor,
  type MenuView,
} from '../../src/ui/menuBuilder.js';
import { buildHomeView } from '../../src/ui/menu/lobbyAndHomeViews.js';
import { buildDiceView, buildSlotsView, buildSoloView } from '../../src/ui/menu/soloAndGambleViews.js';
import { buildBankView, buildMultiView, buildRobView } from '../../src/ui/menu/bankAndMultiViews.js';
import { buildBagView, buildShopView } from '../../src/ui/menu/shopAndBagViews.js';
import { buildLeaderboardView, buildRankView } from '../../src/ui/menu/rankAndLeaderboardViews.js';
import {
  buildAdminEconView,
  buildAdminOverviewView,
} from '../../src/ui/menu/adminOverviewAndSubViews.js';
import {
  buildAdminRedPacketModal,
  buildAmountModal,
  buildRedPacketModal,
  parseDiceChoice,
  parseLeaderboardType,
  parseSocialAction,
} from '../../src/interactions/menu/handlers/menuSharedModalsAndParsers.js';
import { tryHandleSoloGameButton } from '../../src/interactions/menu/handlers/soloGameButtons.js';
import { tryHandleEconomyBankRobButton } from '../../src/interactions/menu/handlers/economyBankRobButtons.js';
import { tryHandleShopBagSocialRankButton } from '../../src/interactions/menu/handlers/shopBagSocialRankButtons.js';
import { tryHandleAdminQuickButton } from '../../src/interactions/menu/handlers/adminQuickButtons.js';
import { tryHandleMenuStringSelect } from '../../src/interactions/menu/handlers/menuStringSelects.js';
import { tryHandleMenuUserSelect } from '../../src/interactions/menu/handlers/menuUserRoleChannelSelects.js';
import { tryHandleEconomyModal } from '../../src/interactions/menu/handlers/menuEconomyModals.js';
import { tryHandleAdminAndMiscModal } from '../../src/interactions/menu/handlers/menuAdminAndMiscModals.js';
import {
  handleMenuButton,
  handleMenuChannelSelect,
  handleMenuModal,
  handleMenuRoleSelect,
  handleMenuStringSelect,
  handleMenuUserSelect,
} from '../../src/interactions/menuHandler.js';

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
  const imageRepo = new ImageRepo(db);
  const llmClient = new LlmClient(undefined);
  const imageClient = new ImageClient(undefined);
  const creditLoan = new CreditLoanService(db, guildConfig, profile, creditLoanRepo, 'Asia/Shanghai', chaos);
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
      image: imageRepo,
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
      socialPet: new SocialPetService(db, guildConfig, profile, shop, socialPet, 'Asia/Shanghai', creditLoan),
      ai: new AiService(guildConfig, aiMemory, llmClient),
      image: new ImageService(guildConfig, imageRepo, imageClient),
      creditLoan,
      rpg,
    },
  };
}

const GUILD_ID = 'g-menu-split';
const ACTOR: MenuActor = {
  id: 'u-1',
  displayName: '测试勇者',
  avatarUrl: 'https://example.com/a.png',
  isAdmin: false,
  isSuperAdmin: false,
};
const ADMIN_ACTOR: MenuActor = {
  ...ACTOR,
  id: 'u-admin',
  displayName: '超管',
  isAdmin: true,
  isSuperAdmin: true,
};

function makeFakeButton(customId: string, opts?: { isAdmin?: boolean; isSuperAdmin?: boolean }) {
  const update = vi.fn(async () => undefined);
  const reply = vi.fn(async () => undefined);
  const deferUpdate = vi.fn(async () => undefined);
  const editReply = vi.fn(async () => undefined);
  const showModal = vi.fn(async () => undefined);
  const send = vi.fn(async () => ({ id: 'pub-msg-1' }));
  const perms = {
    has: (bit: bigint) =>
      Boolean(opts?.isSuperAdmin) &&
      (bit === PermissionFlagsBits.Administrator || bit === PermissionFlagsBits.ManageGuild),
  };
  const interaction = {
    guildId: GUILD_ID,
    channelId: 'ch-1',
    customId,
    user: {
      id: opts?.isAdmin ? 'u-admin' : 'u-1',
      displayName: opts?.isAdmin ? '超管' : '测试勇者',
      displayAvatarURL: () => 'https://example.com/a.png',
    },
    member: {
      permissions: perms,
      roles: { cache: new Map<string, unknown>() },
    },
    memberPermissions: perms,
    inCachedGuild: () => true,
    guild: { name: '测试服', ownerId: 'owner-1', members: { cache: new Map() } },
    channel: { id: 'ch-1', isSendable: () => true, send },
    update,
    reply,
    deferUpdate,
    editReply,
    showModal,
  } as unknown as ButtonInteraction;

  return { interaction, update, reply, deferUpdate, editReply, showModal, send };
}

function makeFakeStringSelect(customId: string, value: string, opts?: { isAdmin?: boolean }) {
  const update = vi.fn(async () => undefined);
  const showModal = vi.fn(async () => undefined);
  const perms = {
    has: (bit: bigint) =>
      Boolean(opts?.isAdmin) &&
      (bit === PermissionFlagsBits.Administrator || bit === PermissionFlagsBits.ManageGuild),
  };
  const interaction = {
    guildId: GUILD_ID,
    channelId: 'ch-1',
    customId,
    values: [value],
    user: {
      id: opts?.isAdmin ? 'u-admin' : 'u-1',
      displayName: opts?.isAdmin ? '超管' : '测试勇者',
      displayAvatarURL: () => 'https://example.com/a.png',
    },
    member: {
      permissions: perms,
      roles: { cache: new Map<string, unknown>() },
    },
    memberPermissions: perms,
    inCachedGuild: () => true,
    guild: { name: '测试服', ownerId: 'owner-1', members: { cache: new Map() } },
    channel: { id: 'ch-1', isSendable: () => true, send: vi.fn(async () => ({ id: 'm1' })) },
    update,
    showModal,
  } as unknown as StringSelectMenuInteraction;

  return { interaction, update, showModal };
}

function makeFakeUserSelect(
  customId: string,
  targetId: string,
  targetOpts?: { bot?: boolean; isAdminOwner?: boolean; displayName?: string },
) {
  const update = vi.fn(async () => undefined);
  const deferUpdate = vi.fn(async () => undefined);
  const editReply = vi.fn(async () => undefined);
  const showModal = vi.fn(async () => undefined);
  const send = vi.fn(async () => ({ id: 'pub-rob-1' }));
  const targetUser = {
    id: targetId,
    username: targetOpts?.displayName ?? 'target',
    displayName: targetOpts?.displayName ?? '目标群友',
    bot: Boolean(targetOpts?.bot),
  };
  const users = new Map<string, typeof targetUser>([[targetId, targetUser]]);
  const membersCache = new Map<string, { id: string; displayName: string; roles: { cache: Map<string, unknown> }; permissions: { has: () => boolean } }>();
  membersCache.set(targetId, {
    id: targetId,
    displayName: targetUser.displayName,
    roles: { cache: new Map() },
    permissions: { has: () => Boolean(targetOpts?.isAdminOwner) },
  });
  const interaction = {
    guildId: GUILD_ID,
    channelId: 'ch-1',
    customId,
    values: [targetId],
    users: {
      get: (id: string) => users.get(id),
      first: () => targetUser,
    },
    user: {
      id: 'u-1',
      displayName: '测试勇者',
      displayAvatarURL: () => 'https://example.com/a.png',
    },
    member: {
      permissions: { has: () => false },
      roles: { cache: new Map<string, unknown>() },
    },
    memberPermissions: { has: () => false },
    inCachedGuild: () => true,
    guild: {
      name: '测试服',
      ownerId: targetOpts?.isAdminOwner ? targetId : 'owner-999',
      members: { cache: membersCache },
    },
    channel: { id: 'ch-1', isSendable: () => true, send },
    update,
    deferUpdate,
    editReply,
    showModal,
  } as unknown as UserSelectMenuInteraction;

  return { interaction, update, deferUpdate, editReply, showModal, send };
}

function makeFakeModal(
  customId: string,
  fields: Record<string, string>,
  opts?: { isAdmin?: boolean; isSuperAdmin?: boolean },
) {
  const update = vi.fn(async () => undefined);
  const reply = vi.fn(async () => undefined);
  const deferUpdate = vi.fn(async () => undefined);
  const editReply = vi.fn(async () => undefined);
  const send = vi.fn(async () => ({ id: 'pub-modal-1' }));
  const perms = {
    has: (bit: bigint) =>
      Boolean(opts?.isSuperAdmin) &&
      (bit === PermissionFlagsBits.Administrator || bit === PermissionFlagsBits.ManageGuild),
  };
  const interaction = {
    guildId: GUILD_ID,
    channelId: 'ch-1',
    customId,
    replied: false,
    deferred: false,
    isFromMessage: () => true,
    fields: {
      getTextInputValue: (key: string) => {
        if (!(key in fields)) throw new Error(`Missing field ${key}`);
        return fields[key]!;
      },
    },
    user: {
      id: opts?.isAdmin ? 'u-admin' : 'u-1',
      displayName: opts?.isAdmin ? '超管' : '测试勇者',
      displayAvatarURL: () => 'https://example.com/a.png',
    },
    member: {
      permissions: perms,
      roles: { cache: new Map<string, unknown>() },
    },
    memberPermissions: perms,
    inCachedGuild: () => true,
    guild: { name: '测试服', ownerId: 'owner-1', members: { cache: new Map() } },
    channel: { id: 'ch-1', isSendable: () => true, send },
    update,
    reply,
    deferUpdate,
    editReply,
  } as unknown as ModalSubmitInteraction;

  return { interaction, update, reply, deferUpdate, editReply, send };
}

describe('menuBuilder table-driven views & split submodules', () => {
  it('registers all MenuView pages in MENU_VIEW_BUILDERS and preserves re-exports', () => {
    const ctx = createTestCtx();
    const pages: MenuView['page'][] = [
      'home', 'solo', 'slots', 'dice', 'bj', 'bank', 'credit', 'loan', 'hustle', 'rpg', 'image',
      'multi', 'rob', 'pay', 'duel', 'social', 'props', 'bounty', 'roulette', 'bomb',
      'events', 'predictions', 'pred_detail', 'world_status', 'social_hub', 'cp', 'cp_lb',
      'pets', 'pet_arena', 'shop', 'bag', 'rank', 'self_roles', 'leaderboard',
      'admin', 'admin_econ', 'admin_lvl', 'admin_lvl_rewards', 'admin_roles', 'admin_shop',
      'admin_games', 'admin_mod', 'admin_ops', 'admin_ai', 'admin_image', 'admin_credit_rpg',
      'admin_monitor',
    ];
    for (const p of pages) {
      expect(typeof MENU_VIEW_BUILDERS[p]).toBe('function');
    }

    expect(SOCIAL_ACTIONS).toHaveLength(6);
    expect(truncateText('abcdef', 4)).toBe('abc…');
    expect(buildLobbyMessage('测试服').components).toHaveLength(1);
    expect(buildPublicRankEmbed(ctx, GUILD_ID, ACTOR).data.author?.name).toContain('身份证名片');
    expect(buildPublicLeaderboardEmbed(ctx, GUILD_ID, 'xp', 1).data.title).toContain('排行榜');

    const duelCard = buildDuelMessage(
      {
        id: 1,
        guildId: GUILD_ID,
        channelId: 'ch-1',
        messageId: null,
        challengerId: 'u-1',
        opponentId: 'u-2',
        bet: 100,
        status: 'pending',
        winnerId: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
      ctx.repos.guildConfig.getOrCreate(GUILD_ID).economy,
    );
    expect(duelCard.components).toHaveLength(1);

    const rpCard = buildRedPacketMessage(
      {
        id: 2,
        guildId: GUILD_ID,
        channelId: 'ch-1',
        messageId: null,
        senderId: 'u-1',
        totalAmount: 100,
        remainingAmount: 100,
        totalCount: 5,
        remainingCount: 5,
        greeting: '恭喜发财',
        status: 'open',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
      [],
      null,
      ctx.repos.guildConfig.getOrCreate(GUILD_ID).economy,
    );
    expect(rpCard.components).toHaveLength(1);
  });

  it('builds split views directly and keeps 12 leaderboard dimensions intact', () => {
    const ctx = createTestCtx();
    const now = Date.now();
    expect(buildHomeView(ctx, GUILD_ID, ACTOR, undefined, now).embeds).toHaveLength(1);
    expect(buildSoloView(ctx, GUILD_ID, ACTOR, undefined, now).embeds[0]?.data.title).toContain('独立游玩');
    expect(buildSlotsView(ctx, GUILD_ID, ACTOR, undefined).embeds[0]?.data.title).toContain('老虎机');
    expect(buildDiceView(ctx, GUILD_ID, ACTOR, 'triple', undefined).embeds[0]?.data.description).toContain('豹子');
    expect(buildBankView(ctx, GUILD_ID, ACTOR, undefined, now).embeds[0]?.data.title).toContain('银行');
    expect(buildMultiView(ctx, GUILD_ID, ACTOR, undefined, now).embeds[0]?.data.title).toContain('多人');
    expect(buildRobView(ctx, GUILD_ID, ACTOR, undefined, now).components).toHaveLength(3);
    expect(buildShopView(ctx, GUILD_ID, ACTOR, undefined, now).embeds[0]?.data.title).toContain('商店');
    expect(buildBagView(ctx, GUILD_ID, ACTOR, undefined, now).embeds[0]?.data.title).toContain('背包');
    expect(buildRankView(ctx, GUILD_ID, ACTOR, undefined, now).components).toHaveLength(2);
    expect(buildAdminOverviewView(ctx, GUILD_ID, ADMIN_ACTOR, undefined).embeds[0]?.data.title).toContain('管理后台');
    expect(buildAdminEconView(ctx, GUILD_ID, ADMIN_ACTOR, undefined, true).components).toHaveLength(3);

    const lbMsg = buildLeaderboardView(ctx, GUILD_ID, 'rpg', 1, undefined);
    const selectRow = lbMsg.components[2]?.toJSON() as APIActionRowComponent<APIMessageActionRowComponent>;
    const select = selectRow.components[0];
    expect(select?.type).toBe(ComponentType.StringSelect);
    if (select && select.type === ComponentType.StringSelect) {
      expect(select.options).toHaveLength(12);
      expect(select.options.map((o) => o.value)).toEqual([
        'xp',
        'coins',
        'stat',
        'invites',
        'credit',
        'deadbeat',
        'hustle',
        'gambling_profit',
        'gambling_loss',
        'rpg',
        'cp_lb',
        'bounty',
      ]);
    }

    const viaDispatch = buildMenuMessage(ctx, GUILD_ID, ACTOR, { page: 'leaderboard', lbType: 'rpg', lbPage: 1 });
    expect(viaDispatch.embeds[0]?.data.title).toContain('RPG');
  });
});

describe('menuHandler sub-routers, modals & parsers', () => {
  it('enforces 45-char truncation on modals and parses choices/types safely', () => {
    expect(parseDiceChoice('triple')).toBe('triple');
    expect(parseDiceChoice('invalid')).toBe('big');
    expect(parseSocialAction('hug')).toBe('hug');
    expect(parseSocialAction('bad')).toBe('pat');
    expect(parseLeaderboardType('gambling_loss')).toBe('gambling_loss');
    expect(parseLeaderboardType('unknown')).toBe('xp');

    const longCurrency = '超级无敌非常长到超过四十五个字的宇宙终极代币名称测试币';
    const amountModal = buildAmountModal('menu:modal_sub:slots', longCurrency + longCurrency, longCurrency + longCurrency, '100').toJSON();
    expect(amountModal.title.length).toBeLessThanOrEqual(45);
    expect(amountModal.components[0]?.components[0]?.label.length).toBeLessThanOrEqual(45);

    const rpModal = buildRedPacketModal(longCurrency).toJSON();
    expect(rpModal.components[0]?.components[0]?.label.length).toBeLessThanOrEqual(45);

    const adminRpModal = buildAdminRedPacketModal('menu:modal_sub:admin_sys_redpacket', longCurrency + longCurrency, 2, longCurrency).toJSON();
    expect(adminRpModal.title.length).toBeLessThanOrEqual(45);
    expect(adminRpModal.components[0]?.components[0]?.label.length).toBeLessThanOrEqual(45);
  });

  it('dispatches button sub-handlers and enforces admin/module guards', async () => {
    const ctx = createTestCtx();

    // 1. Entry point exports
    expect(typeof handleMenuButton).toBe('function');
    expect(typeof handleMenuStringSelect).toBe('function');
    expect(typeof handleMenuUserSelect).toBe('function');
    expect(typeof handleMenuModal).toBe('function');
    expect(typeof handleMenuRoleSelect).toBe('function');
    expect(typeof handleMenuChannelSelect).toBe('function');

    // 2. menu:open
    const openBtn = makeFakeButton('menu:open');
    await handleMenuButton(openBtn.interaction, ctx);
    expect(openBtn.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));

    // 3. soloGameButtons: daily
    const dailyBtn = makeFakeButton('menu:act:daily:solo');
    const soloClaimed = await tryHandleSoloGameButton({
      interaction: dailyBtn.interaction,
      ctx,
      guildId: GUILD_ID,
      actor: ACTOR,
      parts: ['menu', 'act', 'daily', 'solo'],
    });
    expect(soloClaimed).toBe(true);
    expect(dailyBtn.update).toHaveBeenCalledTimes(1);

    // 4. economyBankRobButtons: bank deposit
    ctx.repos.profile.addCoins(GUILD_ID, ACTOR.id, 1000);
    const depBtn = makeFakeButton('menu:bank:dep:50');
    const bankClaimed = await tryHandleEconomyBankRobButton({
      interaction: depBtn.interaction,
      ctx,
      guildId: GUILD_ID,
      actor: ACTOR,
      parts: ['menu', 'bank', 'dep', '50'],
    });
    expect(bankClaimed).toBe(true);
    expect(ctx.repos.profile.getOrCreate(GUILD_ID, ACTOR.id).bankCoins).toBeGreaterThan(0);

    // 5. shopBagSocialRankButtons: rank & nav
    const rankBtn = makeFakeButton('menu:rank:coins:1');
    const rankClaimed = await tryHandleShopBagSocialRankButton({
      interaction: rankBtn.interaction,
      ctx,
      guildId: GUILD_ID,
      actor: ACTOR,
      parts: ['menu', 'rank', 'coins', '1'],
    });
    expect(rankClaimed).toBe(true);
    expect(rankBtn.update).toHaveBeenCalledTimes(1);

    // 6. adminQuickButtons: denied for non-admin, allowed for superAdmin
    const deniedBtn = makeFakeButton('menu:nav:admin');
    const adminDenied = await tryHandleAdminQuickButton({
      interaction: deniedBtn.interaction,
      ctx,
      guildId: GUILD_ID,
      actor: ACTOR,
      parts: ['menu', 'nav', 'admin'],
    });
    expect(adminDenied).toBe(true);
    const deniedArg = (deniedBtn.update.mock.calls[0] as unknown as [{ embeds: Array<{ data: { description?: string } }> }])[0];
    expect(deniedArg.embeds[0]?.data.description).toContain('权限不足');

    // Non-super-admin blocked from reset_econ
    const nonSuperAdminBtn = makeFakeButton('menu:admin:reset_econ');
    await tryHandleAdminQuickButton({
      interaction: nonSuperAdminBtn.interaction,
      ctx,
      guildId: GUILD_ID,
      actor: { ...ACTOR, isAdmin: true, isSuperAdmin: false },
      parts: ['menu', 'admin', 'reset_econ'],
    });
    const superDeniedArg = (nonSuperAdminBtn.update.mock.calls[0] as unknown as [{ embeds: Array<{ data: { description?: string } }> }])[0];
    expect(superDeniedArg.embeds[0]?.data.description).toContain('超级管理员');
  });

  it('handles string selects, rob admin easter-egg disguise, and modal submissions', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins(GUILD_ID, 'u-1', 50_000);
    ctx.repos.profile.addCoins(GUILD_ID, 'u-owner', 50_000);

    // StringSelect: lb_select -> rpg
    const lbSel = makeFakeStringSelect('menu:lb_select', 'rpg');
    const lbHandled = await tryHandleMenuStringSelect({
      interaction: lbSel.interaction,
      ctx,
      guildId: GUILD_ID,
      actor: ACTOR,
      parts: ['menu', 'lb_select'],
      selected: 'rpg',
    });
    expect(lbHandled).toBe(true);
    expect(lbSel.update).toHaveBeenCalledTimes(1);

    // UserSelect: rob an admin/owner triggers admin disguise feedback
    const robSel = makeFakeUserSelect('menu:user:rob', 'u-owner', { isAdminOwner: true, displayName: '群主大人' });
    const robHandled = await tryHandleMenuUserSelect({
      interaction: robSel.interaction,
      ctx,
      guildId: GUILD_ID,
      actor: ACTOR,
      parts: ['menu', 'user', 'rob'],
      actionType: 'rob',
      targetId: 'u-owner',
      targetUser: robSel.interaction.users.get('u-owner'),
    });
    expect(robHandled).toBe(true);
    expect(robSel.deferUpdate).toHaveBeenCalledTimes(1);
    expect(robSel.send).toHaveBeenCalledTimes(1);
    expect(robSel.editReply).toHaveBeenCalledTimes(1);
    const robReply = (robSel.editReply.mock.calls[0] as unknown as [{ embeds: Array<{ data: { description?: string } }> }])[0];
    expect(robReply.embeds[0]?.data.description).toContain('当前现金');

    // Economy modal: bank_dep
    const depModal = makeFakeModal('menu:modal_sub:bank_dep', { amount: '500' });
    const econModalHandled = await tryHandleEconomyModal({
      interaction: depModal.interaction,
      ctx,
      guildId: GUILD_ID,
      actor: ACTOR,
      parts: ['menu', 'modal_sub', 'bank_dep'],
      modalType: 'bank_dep',
    });
    expect(econModalHandled).toBe(true);
    expect(depModal.update).toHaveBeenCalledTimes(1);

    // Admin modal: admin_work
    const workModal = makeFakeModal(
      'menu:modal_sub:admin_work',
      { workMin: '20', workMax: '80', workCooldownSec: '120' },
      { isAdmin: true, isSuperAdmin: true },
    );
    const adminModalHandled = await tryHandleAdminAndMiscModal({
      interaction: workModal.interaction,
      ctx,
      guildId: GUILD_ID,
      actor: ADMIN_ACTOR,
      parts: ['menu', 'modal_sub', 'admin_work'],
      modalType: 'admin_work',
    });
    expect(adminModalHandled).toBe(true);
    expect(ctx.repos.guildConfig.getOrCreate(GUILD_ID).economy.workMin).toBe(20);
  });
});
