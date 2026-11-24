import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type Client,
  type Interaction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { MONITOR_RETENTION_MS } from '../../src/config/economyConstants.js';
import { createDatabase } from '../../src/db/database.js';
import { AiMemoryRepo } from '../../src/db/repositories/aiMemoryRepo.js';
import { ChaosRepo } from '../../src/db/repositories/chaosRepo.js';
import { CreditLoanRepo } from '../../src/db/repositories/creditLoanRepo.js';
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
  runGamesTick,
  runGiveawayTick,
  runMonitorPruneTick,
  runRedPacketTick,
  runVoiceXpTick,
} from '../../src/events/ready.js';
import {
  isGuildSuperAdmin,
  resolveActor,
  respondFromModal,
  safeEditOrFollowUp,
  type MenuSupportedInteraction,
} from '../../src/interactions/menuHelpers.js';
import { formatFriendlyError, routeInteraction } from '../../src/interactions/router.js';
import { AiService } from '../../src/services/aiService.js';
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
import type { AppContext } from '../../src/ui/embeds.js';
import type { BuiltMenuMessage } from '../../src/ui/menuShared.js';

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
      monitor,
    },
    services: {
      leveling: new LevelingService(guildConfig, profile, invite, creditLoan, rpg),
      economy: new EconomyService(db, guildConfig, profile, 'Asia/Shanghai', chaos),
      blackjack: new BlackjackManager(db, profile),
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
      multiplayer: new MultiplayerService(db, profile, redPacket, chaos),
      chaos: new ChaosService(db, guildConfig, profile, chaos),
      worldEvent: new WorldEventService(db, guildConfig, profile, worldEvent, socialPet),
      socialPet: new SocialPetService(db, guildConfig, profile, shop, socialPet, 'Asia/Shanghai'),
      ai: new AiService(guildConfig, aiMemory, llmClient),
      creditLoan,
      rpg,
    },
  };
}

function makePerms(flags: readonly bigint[]) {
  const set = new Set(flags);
  return { has: (p: bigint) => set.has(p) };
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

describe('router error mapping, DM guard, and 15m token expiry degradation', () => {
  it('maps Discord error codes 50013/50001/10008/50027/10062/50035 accurately', () => {
    expect(formatFriendlyError({ code: 50013 })).toContain('50013');
    expect(formatFriendlyError({ code: 50001 })).toContain('50001');
    expect(formatFriendlyError({ code: 10008 })).toContain('15 分钟');
    expect(formatFriendlyError({ code: 50027 })).toContain('/菜单');
    expect(formatFriendlyError({ code: 10062 })).toContain('10062');
    expect(formatFriendlyError({ code: 50035 })).toContain('50035');
    expect(formatFriendlyError(new Error('unexpected'))).toContain('内部异常');
  });

  it('replies ephemerally to DM component interactions instead of logging unhandled', async () => {
    const ctx = createCtx();
    const reply = vi.fn(async () => undefined);
    const dmBtn = {
      customId: 'menu:nav:solo',
      guildId: null,
      channelId: 'dm-1',
      user: makeUser('u1'),
      replied: false,
      deferred: false,
      isChatInputCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isUserSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      reply,
    } as unknown as Interaction;

    await routeInteraction(dmBtn, ctx);
    expect(reply).toHaveBeenCalledTimes(1);
    const payload = (reply.mock.calls[0] as unknown as [{ flags: number; embeds: Array<{ toJSON(): { description?: string } }> }])[0];
    expect(payload.flags).toBe(MessageFlags.Ephemeral);
    expect(payload.embeds[0]?.toJSON().description).toContain('仅限服务器内使用');

    const logs = ctx.repos.monitor!.listRecent('g1', { onlyIssues: true, limit: 10 });
    expect(logs.filter((l) => l.status === 'unhandled')).toHaveLength(0);
    ctx.db.close();
  });

  it('degrades respondFromModal and safeEditOrFollowUp gracefully on 10008/50027 errors', async () => {
    const dummyMsg = { embeds: [], components: [] } as unknown as BuiltMenuMessage;

    const modalReply = vi.fn(async () => undefined);
    const modalMock = {
      isFromMessage: () => true,
      replied: false,
      deferred: false,
      update: vi.fn(async () => {
        throw Object.assign(new Error('Invalid Webhook Token'), { code: 50027 });
      }),
      reply: modalReply,
      followUp: vi.fn(async () => undefined),
    } as unknown as ModalSubmitInteraction;

    await respondFromModal(modalMock, dummyMsg);
    expect(modalReply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));

    const followUp = vi.fn(async () => undefined);
    const deferredMock = {
      editReply: vi.fn(async () => {
        throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      }),
      followUp,
    } as unknown as MenuSupportedInteraction;

    await safeEditOrFollowUp(deferredMock, dummyMsg);
    expect(followUp).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));

    const nonExpiryMock = {
      editReply: vi.fn(async () => {
        throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      }),
      followUp: vi.fn(async () => undefined),
    } as unknown as MenuSupportedInteraction;
    await expect(safeEditOrFollowUp(nonExpiryMock, dummyMsg)).rejects.toThrow('Missing Permissions');
  });

  it('distinguishes Guild Super Admin from adminUserIds and resolves uncached guild members via fetch', async () => {
    const ctx = createCtx();
    ctx.repos.guildConfig.updateAdminUsers('g1', ['helper1']);

    const helperInteraction = {
      user: makeUser('helper1'),
      inCachedGuild: () => true,
      member: {
        id: 'helper1',
        permissions: makePerms([]),
        roles: { cache: new Map() },
      },
    } as unknown as MenuSupportedInteraction;

    expect(isGuildSuperAdmin(helperInteraction, ctx, 'g1')).toBe(false);
    const helperActor = await resolveActor(helperInteraction, ctx, 'g1');
    expect(helperActor.isAdmin).toBe(true);
    expect(helperActor.isSuperAdmin).toBe(false);

    // Uncached guild fetches member to restore roles & ManageGuild superAdmin
    const fetchMember = vi.fn(async () => ({
      id: 'mgr1',
      permissions: makePerms([PermissionFlagsBits.ManageGuild]),
      roles: { cache: new Map([['r-vip', { id: 'r-vip' }]]) },
    }));
    const uncachedInteraction = {
      user: makeUser('mgr1'),
      inCachedGuild: () => false,
      memberPermissions: null,
      guild: { members: { fetch: fetchMember } },
    } as unknown as MenuSupportedInteraction;

    const mgrActor = await resolveActor(uncachedInteraction, ctx, 'g1');
    expect(fetchMember).toHaveBeenCalledWith('mgr1');
    expect(mgrActor.isAdmin).toBe(true);
    expect(mgrActor.isSuperAdmin).toBe(true);
    expect(mgrActor.roleIds).toEqual(['r-vip']);

    ctx.db.close();
  });
});

describe('menu guards, super-admin tiering, confirm flows, role panel sync & channel selects', () => {
  it('enforces navigation/bag/shop module guards and preserves currency on reset_econ:confirm', async () => {
    const ctx = createCtx();
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateEconomy('g1', {
      ...cfg.economy,
      currencyName: '金豆',
      currencyEmoji: '🫘',
      robSuccessRate: 0.8,
    });
    ctx.repos.guildConfig.updateModules('g1', {
      ...cfg.modules,
      economy: false,
      fun: false,
    });

    const makeBtn = (customId: string, userId: string, superAdmin = false) => {
      const update = vi.fn(async () => undefined);
      const editReply = vi.fn(async () => undefined);
      const deferUpdate = vi.fn(async () => undefined);
      const interaction = {
        customId,
        guildId: 'g1',
        guild: { id: 'g1', name: 'Test', channels: { cache: new Map() } },
        channelId: 'c1',
        channel: { id: 'c1', isSendable: () => true, send: vi.fn(async () => ({ id: 'm1' })) },
        client: { channels: { cache: new Map(), fetch: vi.fn(async () => null) } },
        user: makeUser(userId),
        member: {
          id: userId,
          permissions: makePerms(superAdmin ? [PermissionFlagsBits.Administrator] : []),
          roles: { cache: new Map() },
        },
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
        editReply,
        deferUpdate,
        reply: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      } as unknown as ButtonInteraction & Interaction;
      return { interaction, update, editReply, deferUpdate };
    };

    // Nav guards block disabled economy/fun pages before entering
    for (const navId of ['menu:nav:shop', 'menu:nav:bag', 'menu:nav:slots', 'menu:nav:social', 'menu:bag:clear_title']) {
      const b = makeBtn(navId, 'u1');
      await routeInteraction(b.interaction, ctx);
      const desc = (b.update.mock.calls[0] as unknown as [{ embeds: Array<{ toJSON(): { description?: string } }> }])[0]
        .embeds[0]?.toJSON().description;
      expect(desc).toContain('已关闭');
    }

    // Modal shop_custom_title blocked when economy disabled
    const modalUpdate = vi.fn(async () => undefined);
    const customTitleModal = {
      customId: 'menu:modal_sub:shop_custom_title:1',
      guildId: 'g1',
      channelId: 'c1',
      user: makeUser('u1'),
      member: { id: 'u1', permissions: makePerms([]), roles: { cache: new Map() } },
      fields: { getTextInputValue: () => '称号' },
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
      update: modalUpdate,
      reply: vi.fn(async () => undefined),
    } as unknown as ModalSubmitInteraction & Interaction;
    await routeInteraction(customTitleModal, ctx);
    const modalDesc = (modalUpdate.mock.calls[0] as unknown as [{ embeds: Array<{ toJSON(): { description?: string } }> }])[0]
      .embeds[0]?.toJSON().description;
    expect(modalDesc).toContain('经济系统');

    // reset_econ two-step confirm preserves currencyName & currencyEmoji (P2-9)
    const step1 = makeBtn('menu:admin:reset_econ', 'super1', true);
    await routeInteraction(step1.interaction, ctx);
    expect(ctx.repos.guildConfig.getOrCreate('g1').economy.robSuccessRate).toBe(0.8);

    const step2 = makeBtn('menu:admin:reset_econ:confirm', 'super1', true);
    await routeInteraction(step2.interaction, ctx);
    const afterReset = ctx.repos.guildConfig.getOrCreate('g1').economy;
    expect(afterReset.robSuccessRate).toBe(0.45);
    expect(afterReset.currencyName).toBe('金豆');
    expect(afterReset.currencyEmoji).toBe('🫘');

    ctx.db.close();
  });

  it('validates role panel emojis & strict enums, auto-syncs channel card on mutations, and handles admin channel selects', async () => {
    const ctx = createCtx();
    ctx.repos.guildConfig.updateAdminUsers('g1', ['admin1']);

    const editedPayloads: Array<{ components?: unknown[]; embeds?: unknown[] }> = [];
    const mockChannelMsg = {
      id: 'rp-msg-1',
      edit: vi.fn(async (p: { components?: unknown[]; embeds?: unknown[] }) => {
        editedPayloads.push(p);
      }),
    };
    const mockTextChannel = {
      id: 'c1',
      isSendable: () => true,
      isTextBased: () => true,
      send: vi.fn(async () => ({ id: 'rp-msg-1' })),
      messages: { fetch: vi.fn(async () => mockChannelMsg) },
    };
    const channelsCache = new Map([['c1', mockTextChannel]]);

    const makeModal = (customId: string, fields: Record<string, string>) => {
      const update = vi.fn(async () => undefined);
      const editReply = vi.fn(async () => undefined);
      const deferUpdate = vi.fn(async () => undefined);
      const interaction = {
        customId,
        guildId: 'g1',
        guild: { id: 'g1', name: 'Test', channels: { cache: channelsCache } },
        channelId: 'c1',
        channel: mockTextChannel,
        client: { channels: { cache: channelsCache, fetch: vi.fn(async () => mockTextChannel) } },
        user: makeUser('admin1'),
        member: { id: 'admin1', permissions: makePerms([]), roles: { cache: new Map() } },
        fields: { getTextInputValue: (k: string) => fields[k] ?? '' },
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
        update,
        editReply,
        deferUpdate,
        deferReply: vi.fn(async () => undefined),
        reply: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      } as unknown as ModalSubmitInteraction & Interaction;
      return { interaction, update, editReply, deferUpdate };
    };

    // Strict enum rejection for admin_rp_create & admin_shop_special
    const badPanel = makeModal('menu:modal_sub:admin_rp_create', {
      title: '测试面板',
      description: '说明',
      selectionMode: '随便填',
      displayMode: '按钮',
    });
    await routeInteraction(badPanel.interaction, ctx);
    expect(ctx.services.rolePanel.listPanels('g1')).toHaveLength(0);

    const badSpecial = makeModal('menu:modal_sub:admin_shop_special', {
      kind: '未知类型',
      name: '神秘物',
      price: '500',
    });
    await routeInteraction(badSpecial.interaction, ctx);
    expect(ctx.services.shop.listItems('g1')).toHaveLength(0);

    const cheapBox = makeModal('menu:modal_sub:admin_shop_special', {
      kind: '盲盒',
      name: '0元盲盒',
      price: '0',
    });
    await routeInteraction(cheapBox.interaction, ctx);
    expect(ctx.services.shop.listItems('g1')).toHaveLength(0);

    // Create valid panel, reject invalid emoji, accept valid emoji & publish
    const panel = ctx.services.rolePanel.createPanel({
      guildId: 'g1',
      title: '兴趣标签',
      description: '选标签',
      displayMode: 'button',
      selectionMode: 'multi',
    });

    const badEmoji = makeModal(`menu:modal_sub:admin_rp_add:${panel.id}:r1`, {
      label: '游戏',
      emoji: 'not-an-emoji',
      description: '',
    });
    await routeInteraction(badEmoji.interaction, ctx);
    expect(ctx.services.rolePanel.getPanelWithOptions('g1', panel.id)?.options).toHaveLength(0);

    const okEmoji = makeModal(`menu:modal_sub:admin_rp_add:${panel.id}:r1`, {
      label: '游戏',
      emoji: '🎮',
      description: '',
    });
    await routeInteraction(okEmoji.interaction, ctx);
    expect(ctx.services.rolePanel.getPanelWithOptions('g1', panel.id)?.options).toHaveLength(1);

    // Bind published channel message, then add another option -> auto-syncs channel card
    ctx.services.rolePanel.setPanelMessage(panel.id, 'c1', 'rp-msg-1');
    const customEmojiAdd = makeModal(`menu:modal_sub:admin_rp_add:${panel.id}:r2`, {
      label: '音乐',
      emoji: '<:music:123456789012345678>',
      description: '',
    });
    await routeInteraction(customEmojiAdd.interaction, ctx);
    expect(customEmojiAdd.deferUpdate).toHaveBeenCalledTimes(1);
    expect(mockChannelMsg.edit).toHaveBeenCalledTimes(1);

    // Toggle display mode -> auto-syncs channel card
    const toggleDisplay = {
      customId: `menu:admin:rp_toggle_display:${panel.id}`,
      guildId: 'g1',
      guild: { id: 'g1', name: 'Test', channels: { cache: channelsCache } },
      channelId: 'c1',
      channel: mockTextChannel,
      client: { channels: { cache: channelsCache, fetch: vi.fn(async () => mockTextChannel) } },
      user: makeUser('admin1'),
      member: { id: 'admin1', permissions: makePerms([]), roles: { cache: new Map() } },
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
      update: vi.fn(async () => undefined),
      deferUpdate: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    } as unknown as ButtonInteraction & Interaction;
    await routeInteraction(toggleDisplay, ctx);
    expect(mockChannelMsg.edit).toHaveBeenCalledTimes(2);

    // Confirm delete -> clears buttons on published channel card
    const deleteConfirm = {
      ...(toggleDisplay as unknown as Record<string, unknown>),
      customId: `menu:admin:rp_delete:${panel.id}:confirm`,
    } as unknown as ButtonInteraction & Interaction;
    await routeInteraction(deleteConfirm, ctx);
    expect(mockChannelMsg.edit).toHaveBeenCalledTimes(3);
    expect(editedPayloads[2]?.components).toEqual([]);

    // ChannelSelectMenu for admin_lvl_announce, admin_games_event, and admin_ai_allowed
    const runChanSelect = async (customId: string, values: string[]) => {
      const update = vi.fn(async () => undefined);
      const interaction = {
        customId,
        values,
        guildId: 'g1',
        channelId: 'c1',
        user: makeUser('admin1'),
        member: { id: 'admin1', permissions: makePerms([]), roles: { cache: new Map() } },
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
        update,
        reply: vi.fn(async () => undefined),
      } as unknown as ChannelSelectMenuInteraction & Interaction;
      await routeInteraction(interaction, ctx);
      expect(update).toHaveBeenCalledTimes(1);
    };

    await runChanSelect('menu:chan:admin_lvl_announce', ['ch-lvl-1']);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling.announceChannelId).toBe('ch-lvl-1');
    await runChanSelect('menu:chan:admin_lvl_announce', []);
    expect(ctx.repos.guildConfig.getOrCreate('g1').leveling.announceChannelId).toBeNull();

    await runChanSelect('menu:chan:admin_games_event', ['ch-ev-1']);
    expect(ctx.repos.guildConfig.getOrCreate('g1').games.eventChannelId).toBe('ch-ev-1');

    await runChanSelect('menu:chan:admin_ai_allowed', ['ch-ai-1', 'ch-ai-2']);
    expect(ctx.repos.guildConfig.getOrCreate('g1').ai.allowedChannelIds).toEqual([
      'ch-ai-1',
      'ch-ai-2',
    ]);

    ctx.db.close();
  });
});

describe('background timers hardening (ready.ts)', () => {
  it('blocks solo voice XP (<2 humans) and serverMute+serverDeaf, awards 2+ active humans, and isolates errors', () => {
    const ctx = createCtx();
    const awardSpy = vi.spyOn(ctx.services.leveling, 'awardVoiceXp');

    const makeChannelMembers = (members: Array<{ id: string; bot: boolean }>) => ({
      filter: (fn: (m: { user: { bot: boolean } }) => boolean) => {
        const filtered = members.filter((m) => fn({ user: { bot: m.bot } }));
        return { size: filtered.length };
      },
    });

    const voiceStates = new Map([
      // Solo human -> must NOT get XP
      [
        'solo-u',
        {
          channelId: 'vc-solo',
          selfMute: false,
          selfDeaf: false,
          serverMute: false,
          serverDeaf: false,
          member: { id: 'solo-u', user: { bot: false } },
          channel: { members: makeChannelMembers([{ id: 'solo-u', bot: false }]) },
        },
      ],
      // Server muted & deafened in 2-person channel -> must NOT get XP
      [
        'muted-u',
        {
          channelId: 'vc-pair',
          selfMute: false,
          selfDeaf: false,
          serverMute: true,
          serverDeaf: true,
          member: { id: 'muted-u', user: { bot: false } },
          channel: {
            members: makeChannelMembers([
              { id: 'muted-u', bot: false },
              { id: 'active-u', bot: false },
            ]),
          },
        },
      ],
      // Active human in 2-person channel -> MUST get XP
      [
        'active-u',
        {
          channelId: 'vc-pair',
          selfMute: false,
          selfDeaf: false,
          serverMute: false,
          serverDeaf: false,
          member: { id: 'active-u', user: { bot: false } },
          channel: {
            members: makeChannelMembers([
              { id: 'muted-u', bot: false },
              { id: 'active-u', bot: false },
            ]),
          },
        },
      ],
    ]);

    const fakeClient = {
      guilds: {
        cache: new Map([
          [
            'g1',
            {
              id: 'g1',
              afkChannelId: 'vc-afk',
              voiceStates: { cache: voiceStates },
            },
          ],
        ]),
      },
    } as unknown as Client;

    runVoiceXpTick(fakeClient, ctx);
    expect(awardSpy).toHaveBeenCalledTimes(1);
    expect(awardSpy).toHaveBeenCalledWith('g1', 'active-u');
    ctx.db.close();
  });

  it('fetches uncached/thread giveaway channels, isolates item errors in giveaway/redpacket/games ticks, and prunes old monitor logs', async () => {
    const ctx = createCtx();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Two due giveaways: #1 throws during finalize, #2 succeeds in uncached thread channel
    const g1 = ctx.services.giveaway.createGiveaway({
      guildId: 'g1',
      channelId: 'thread-99',
      messageId: 'gw-msg-1',
      hostId: 'host1',
      prize: '异常奖品',
      winnerCount: 1,
      minLevel: 0,
      requiredRoleId: null,
      endsAt: Date.now() - 10_000,
    });
    const g2 = ctx.services.giveaway.createGiveaway({
      guildId: 'g1',
      channelId: 'thread-99',
      messageId: 'gw-msg-2',
      hostId: 'host1',
      prize: '帖子大奖',
      winnerCount: 1,
      minLevel: 0,
      requiredRoleId: null,
      endsAt: Date.now() - 5_000,
    });
    ctx.repos.giveaway.addEntry(g2.id, 'winner-1');

    const origFinalize = ctx.services.giveaway.finalizeGiveaway.bind(ctx.services.giveaway);
    vi.spyOn(ctx.services.giveaway, 'finalizeGiveaway').mockImplementation((id: number) => {
      if (id === g1.id) throw new Error('simulated db error');
      return origFinalize(id);
    });

    const threadEdit = vi.fn(async () => undefined);
    const threadSend = vi.fn(async () => undefined);
    const threadChannel = {
      id: 'thread-99',
      isSendable: () => true,
      messages: { fetch: vi.fn(async () => ({ edit: threadEdit })) },
      send: threadSend,
    };

    const fakeClient = {
      guilds: {
        cache: new Map([
          [
            'g1',
            {
              id: 'g1',
              channels: {
                cache: new Map(),
                fetch: vi.fn(async () => threadChannel),
              },
            },
          ],
        ]),
      },
      channels: {
        cache: new Map(),
        fetch: vi.fn(async () => null),
      },
    } as unknown as Client;

    await expect(runGiveawayTick(fakeClient, ctx)).resolves.toBeUndefined();
    expect(threadEdit).toHaveBeenCalledTimes(1);
    expect(threadSend).toHaveBeenCalledTimes(1);
    expect((threadSend.mock.calls[0] as unknown as [string])[0]).toContain('<@winner-1>');

    // RedPacket tick & Games tick do not throw even when services throw
    vi.spyOn(ctx.services.multiplayer, 'expireDueRedPackets').mockImplementation(() => {
      throw new Error('rp boom');
    });
    await expect(runRedPacketTick(fakeClient, ctx)).resolves.toBeUndefined();

    vi.spyOn(ctx.services.chaos, 'processTimedOutRoulettes').mockImplementation(() => {
      throw new Error('roulette boom');
    });
    const bombSpy = vi.spyOn(ctx.services.chaos, 'expireDueNumberBombs').mockReturnValue([]);
    await expect(runGamesTick(fakeClient, ctx)).resolves.toBeUndefined();
    expect(bombSpy).toHaveBeenCalledTimes(1);

    // Monitor prune deletes logs older than MONITOR_RETENTION_MS and keeps fresh ones
    const now = Date.now();
    ctx.repos.monitor!.record({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      userName: 'old',
      interactionType: 'button',
      interactionKey: 'old:btn',
      status: 'ok',
      durationMs: 10,
      createdAt: now - MONITOR_RETENTION_MS - 60_000,
    });
    ctx.repos.monitor!.record({
      guildId: 'g1',
      channelId: 'c1',
      userId: 'u1',
      userName: 'new',
      interactionType: 'button',
      interactionKey: 'new:btn',
      status: 'ok',
      durationMs: 10,
      createdAt: now - 60_000,
    });
    const pruned = runMonitorPruneTick(ctx, now);
    expect(pruned).toBe(1);
    const remaining = ctx.repos.monitor!.listRecent('g1', { limit: 10 });
    expect(remaining.map((r) => r.interactionKey)).toEqual(['new:btn']);

    errSpy.mockRestore();
    ctx.db.close();
  });
});
