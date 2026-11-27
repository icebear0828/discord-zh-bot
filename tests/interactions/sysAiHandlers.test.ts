import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIEmbed,
  type APIMessageActionRowComponent,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
  type ModalSubmitInteraction,
} from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiCommand, formatMemoryListDescription } from '../../src/commands/ai/ai.js';
import { buildRolePanelMessage, rolePanelCommand } from '../../src/commands/roles/rolePanel.js';
import { ticketCommand } from '../../src/commands/tickets/ticket.js';
import { createDatabase } from '../../src/db/database.js';
import { AiMemoryRepo } from '../../src/db/repositories/aiMemoryRepo.js';
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
import {
  AI_CHANNEL_MAX_PENDING,
  handleMessageCreate,
  resetAiRuntimeGuards,
} from '../../src/events/messageCreate.js';
import { handleGiveawayButton } from '../../src/interactions/giveawayHandler.js';
import { handleRolePanelButton } from '../../src/interactions/rolePanelHandler.js';
import {
  formatBlockquote,
  handleTicketButton,
  handleTicketModal,
} from '../../src/interactions/ticketHandler.js';
import { AiService } from '../../src/services/aiService.js';
import { BlackjackManager } from '../../src/services/blackjackService.js';
import { ChaosService } from '../../src/services/chaosService.js';
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
import { CreditLoanRepo } from '../../src/db/repositories/creditLoanRepo.js';
import { RpgRepo } from '../../src/db/repositories/rpgRepo.js';
import { CreditLoanService } from '../../src/services/creditLoanService.js';
import type { AppContext } from '../../src/ui/embeds.js';

interface MockPayload {
  content?: string;
  embeds?: ReadonlyArray<{ toJSON(): APIEmbed }>;
  components?: ReadonlyArray<{
    toJSON(): APIActionRowComponent<APIMessageActionRowComponent>;
  }>;
  flags?: number;
}

function createCtx(llmClient?: LlmClient): AppContext {
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
  const client = llmClient ?? new LlmClient(undefined);
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
      ticket: new TicketService(guildConfig, ticket, db),
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
      ai: new AiService(guildConfig, aiMemory, client),
      creditLoan,
      rpg,
    },
  };
}

function makeMember(userId: string, opts?: { roleIds?: string[]; admin?: boolean }) {
  const roleMap = new Map<string, { id: string }>();
  for (const r of opts?.roleIds ?? []) {
    roleMap.set(r, { id: r });
  }
  return {
    id: userId,
    displayName: `User-${userId}`,
    permissions: {
      has: (bit: bigint) =>
        Boolean(opts?.admin && (bit === PermissionFlagsBits.Administrator || bit === PermissionFlagsBits.ManageGuild)),
    },
    roles: {
      cache: roleMap,
      add: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
  };
}

describe('ticketHandler & /ticket command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats multi-line blockquotes with > on every line', () => {
    expect(formatBlockquote('第一行\n第二行\r\n第三行')).toBe('> 第一行\n> 第二行\n> 第三行');
  });

  it('enforces authorization and two-step confirmation on ticket:close', async () => {
    const ctx = createCtx();
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateTicket('g1', {
      ...cfg.ticket,
      staffRoleIds: ['staff-role'],
      logChannelId: 'log-ch',
    });
    ctx.repos.guildConfig.updateAdminUsers('g1', ['bot-admin-1']);

    const ticket = ctx.services.ticket.createTicket('g1', 'ticket-ch-1', 'creator-1', '支付问题');

    const closeBtnEdit = vi.fn(async () => undefined);
    const channelSend = vi.fn(async () => ({ id: 'notice-1' }));
    const channelDelete = vi.fn(async () => undefined);
    const logSend = vi.fn(async () => ({ id: 'log-1' }));

    const ticketChannel = {
      id: 'ticket-ch-1',
      type: ChannelType.GuildText,
      isSendable: () => true,
      isTextBased: () => true,
      send: channelSend,
      delete: channelDelete,
      messages: {
        fetch: vi.fn(async () => ({
          id: 'welcome-msg-1',
          edit: closeBtnEdit,
        })),
      },
    };

    const guild = {
      id: 'g1',
      channels: {
        cache: new Map(),
        fetch: vi.fn(async (id: string) =>
          id === 'log-ch' ? { id, type: ChannelType.GuildText, isSendable: () => true, send: logSend } : null,
        ),
      },
    };

    // 1. Unauthorized bystander cannot close ticket
    const bystanderReply = vi.fn(async () => undefined);
    await handleTicketButton(
      {
        guildId: 'g1',
        channelId: 'ticket-ch-1',
        customId: 'ticket:close',
        inCachedGuild: () => true,
        user: { id: 'stranger-1', tag: 'stranger#0001' },
        member: makeMember('stranger-1'),
        guild,
        channel: ticketChannel,
        message: { id: 'welcome-msg-1' },
        reply: bystanderReply,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(bystanderReply).toHaveBeenCalledTimes(1);
    expect(ctx.services.ticket.getByChannel('ticket-ch-1')?.status).toBe('open');

    // 2. Authorized bot admin (via adminUserIds) gets Ephemeral confirm button ticket:confirm_close:<id>
    const adminReply = vi.fn(async () => undefined);
    await handleTicketButton(
      {
        guildId: 'g1',
        channelId: 'ticket-ch-1',
        customId: 'ticket:close',
        inCachedGuild: () => true,
        user: { id: 'bot-admin-1', tag: 'admin#0001' },
        member: makeMember('bot-admin-1'),
        guild,
        channel: ticketChannel,
        message: { id: 'welcome-msg-1' },
        reply: adminReply,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(ctx.services.ticket.getByChannel('ticket-ch-1')?.status).toBe('open');
    const confirmPayload = (adminReply.mock.calls[0] as unknown as [MockPayload])[0];
    expect(confirmPayload.flags).toBe(MessageFlags.Ephemeral);
    const confirmRow = confirmPayload.components?.[0]?.toJSON();
    const confirmBtn = confirmRow?.components[0] as APIButtonComponentWithCustomId;
    expect(confirmBtn.custom_id).toBe(`ticket:confirm_close:${ticket.id}`);

    // 3. Confirming closes DB, disables original button, sends log via fetch, schedules channel delete
    const confirmDefer = vi.fn(async () => undefined);
    const confirmEdit = vi.fn(async () => undefined);
    await handleTicketButton(
      {
        guildId: 'g1',
        channelId: 'ticket-ch-1',
        customId: `ticket:confirm_close:${ticket.id}`,
        inCachedGuild: () => true,
        user: { id: 'bot-admin-1', tag: 'admin#0001' },
        member: makeMember('bot-admin-1'),
        guild,
        channel: ticketChannel,
        deferUpdate: confirmDefer,
        editReply: confirmEdit,
      } as unknown as ButtonInteraction,
      ctx,
    );

    expect(confirmDefer).toHaveBeenCalledTimes(1);
    expect(ctx.services.ticket.getByChannel('ticket-ch-1')?.status).toBe('closed');
    expect(closeBtnEdit).toHaveBeenCalledTimes(1);
    expect(logSend).toHaveBeenCalledTimes(1);
    expect(channelDelete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(channelDelete).toHaveBeenCalledTimes(1);

    ctx.db.close();
  });

  it('defers modal reply, checks modules.tickets, quotes multi-line detail, and rolls back on send failure', async () => {
    const ctx = createCtx();
    const callOrder: string[] = [];

    // Disabled module check
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, tickets: false });

    const editReplyDisabled = vi.fn(async () => undefined);
    const deferDisabled = vi.fn(async () => {
      callOrder.push('defer');
    });
    await handleTicketModal(
      {
        guildId: 'g1',
        inCachedGuild: () => true,
        user: { id: 'u1', tag: 'u1#0001' },
        client: { user: { id: 'bot-1' } },
        fields: {
          getTextInputValue: (k: string) => (k === 'subject' ? '测试主题' : '行1\n行2'),
        },
        deferReply: deferDisabled,
        editReply: editReplyDisabled,
      } as unknown as ModalSubmitInteraction,
      ctx,
    );
    expect(deferDisabled).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(editReplyDisabled).toHaveBeenCalledTimes(1);

    // Enable tickets & test rollback when createdChannel.send fails
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, tickets: true });
    const createdDelete = vi.fn(async () => undefined);
    const createdSendFail = vi.fn(async () => {
      throw new Error('send failed');
    });
    const channelsCreate = vi.fn(async () => {
      callOrder.push('channels.create');
      return {
        id: 'new-ch-1',
        send: createdSendFail,
        delete: createdDelete,
      };
    });
    const editReplyFail = vi.fn(async () => undefined);
    const deferFail = vi.fn(async () => {
      callOrder.push('deferFail');
    });

    await handleTicketModal(
      {
        guildId: 'g1',
        inCachedGuild: () => true,
        user: { id: 'u1', tag: 'u1#0001' },
        client: { user: { id: 'bot-1' } },
        guild: {
          roles: { everyone: { id: 'everyone-1' } },
          channels: { create: channelsCreate },
        },
        fields: {
          getTextInputValue: (k: string) => (k === 'subject' ? '测试主题' : '行1\n行2'),
        },
        deferReply: deferFail,
        editReply: editReplyFail,
      } as unknown as ModalSubmitInteraction,
      ctx,
    );

    expect(callOrder.indexOf('deferFail')).toBeLessThan(callOrder.indexOf('channels.create'));
    expect(createdDelete).toHaveBeenCalledTimes(1);
    expect(ctx.services.ticket.canOpenTicket('g1', 'u1').openCount).toBe(0);
    expect(ctx.services.ticket.getByChannel('new-ch-1')).toBeNull();
    expect(editReplyFail).toHaveBeenCalledTimes(1);

    // Now succeed and verify multi-line blockquote formatting
    const createdSendOk = vi.fn(async () => ({ id: 'welcome-msg-ok' }));
    const editReplyOk = vi.fn(async () => undefined);
    await handleTicketModal(
      {
        guildId: 'g1',
        inCachedGuild: () => true,
        user: { id: 'u1', tag: 'u1#0001' },
        client: { user: { id: 'bot-1' } },
        guild: {
          roles: { everyone: { id: 'everyone-1' } },
          channels: {
            create: vi.fn(async () => ({
              id: 'new-ch-2',
              send: createdSendOk,
              delete: vi.fn(async () => undefined),
            })),
          },
        },
        fields: {
          getTextInputValue: (k: string) => (k === 'subject' ? '多行测试' : '第一行\n第二行'),
        },
        deferReply: vi.fn(async () => undefined),
        editReply: editReplyOk,
      } as unknown as ModalSubmitInteraction,
      ctx,
    );

    const sentPayload = (createdSendOk.mock.calls[0] as unknown as [MockPayload])[0];
    const embedDesc = sentPayload.embeds?.[0]?.toJSON().description ?? '';
    expect(embedDesc).toContain('> 第一行\n> 第二行');

    ctx.db.close();
  });

  it('allows adminUserIds in /ticket slash command via checkMemberIsBotAdmin', async () => {
    const ctx = createCtx();
    ctx.repos.guildConfig.updateAdminUsers('g1', ['admin-user-99']);
    ctx.services.ticket.createTicket('g1', 'tk-ch', 'creator-1', '问题');

    const editPerm = vi.fn(async () => undefined);
    const reply = vi.fn(async () => undefined);

    await ticketCommand.execute(
      {
        guildId: 'g1',
        channelId: 'tk-ch',
        inCachedGuild: () => true,
        user: { id: 'admin-user-99', tag: 'admin99#0001' },
        member: makeMember('admin-user-99'),
        channel: {
          id: 'tk-ch',
          type: ChannelType.GuildText,
          permissionOverwrites: { edit: editPerm },
        },
        options: {
          getSubcommand: () => 'add',
          getUser: () => ({ id: 'helper-1' }),
        },
        reply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );

    expect(editPerm).toHaveBeenCalledTimes(1);
    const payload = (reply.mock.calls[0] as unknown as [MockPayload])[0];
    expect(payload.embeds?.[0]?.toJSON().title).toContain('已添加成员');

    ctx.db.close();
  });
});

describe('giveawayHandler', () => {
  it('checks modules.giveaways, defers before edits, prompts confirm leave on re-click, and leaves via giveaway:leave:<id>', async () => {
    const ctx = createCtx();
    const gw = ctx.services.giveaway.createGiveaway({
      guildId: 'g1',
      channelId: 'gw-ch',
      messageId: 'gw-msg-1',
      hostId: 'host-1',
      prize: '限量大奖',
      winnerCount: 1,
      minLevel: 0,
      requiredRoleId: null,
      endsAt: Date.now() + 3600_000,
    });

    // 1. Module disabled -> rejected
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, giveaways: false });
    const disabledEditReply = vi.fn(async () => undefined);
    await handleGiveawayButton(
      {
        guildId: 'g1',
        customId: `giveaway:join:${gw.id}`,
        inCachedGuild: () => true,
        user: { id: 'u1' },
        member: makeMember('u1'),
        deferReply: vi.fn(async () => undefined),
        editReply: disabledEditReply,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(
      (disabledEditReply.mock.calls[0] as unknown as [MockPayload])[0].embeds?.[0]?.toJSON().title,
    ).toContain('模块未开启');

    // 2. Enable module -> first click defers before editing original message
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, giveaways: true });
    const order: string[] = [];
    const publicMsgEdit = vi.fn(async () => {
      order.push('msg.edit');
    });
    const joinEditReply = vi.fn(async () => {
      order.push('editReply');
    });
    await handleGiveawayButton(
      {
        guildId: 'g1',
        customId: `giveaway:join:${gw.id}`,
        inCachedGuild: () => true,
        user: { id: 'u1' },
        member: makeMember('u1'),
        message: { edit: publicMsgEdit },
        deferReply: vi.fn(async () => {
          order.push('deferReply');
        }),
        editReply: joinEditReply,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(order).toEqual(['deferReply', 'msg.edit', 'editReply']);
    expect(ctx.services.giveaway.countEntries(gw.id)).toBe(1);

    // 3. Second click does NOT silently leave; shows Ephemeral confirm button giveaway:leave:<id>
    const reclickEditReply = vi.fn(async () => undefined);
    const reclickMsgEdit = vi.fn(async () => undefined);
    await handleGiveawayButton(
      {
        guildId: 'g1',
        customId: `giveaway:join:${gw.id}`,
        inCachedGuild: () => true,
        user: { id: 'u1' },
        member: makeMember('u1'),
        message: { edit: reclickMsgEdit },
        deferReply: vi.fn(async () => undefined),
        editReply: reclickEditReply,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(ctx.services.giveaway.countEntries(gw.id)).toBe(1);
    expect(reclickMsgEdit).not.toHaveBeenCalled();
    const reclickPayload = (reclickEditReply.mock.calls[0] as unknown as [MockPayload])[0];
    const leaveBtn = reclickPayload.components?.[0]?.toJSON()
      .components[0] as APIButtonComponentWithCustomId;
    expect(leaveBtn.custom_id).toBe(`giveaway:leave:${gw.id}`);

    // 4. Clicking giveaway:leave:<id> removes entry and edits public giveaway message
    const fetchedMsgEdit = vi.fn(async () => undefined);
    const leaveEditReply = vi.fn(async () => undefined);
    await handleGiveawayButton(
      {
        guildId: 'g1',
        customId: `giveaway:leave:${gw.id}`,
        inCachedGuild: () => true,
        user: { id: 'u1' },
        member: makeMember('u1'),
        guild: {
          channels: {
            cache: new Map([
              [
                'gw-ch',
                {
                  id: 'gw-ch',
                  isTextBased: () => true,
                  messages: {
                    fetch: vi.fn(async () => ({ edit: fetchedMsgEdit })),
                  },
                },
              ],
            ]),
          },
        },
        client: { channels: { cache: new Map(), fetch: vi.fn(async () => null) } },
        deferUpdate: vi.fn(async () => undefined),
        editReply: leaveEditReply,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(ctx.services.giveaway.countEntries(gw.id)).toBe(0);
    expect(fetchedMsgEdit).toHaveBeenCalledTimes(1);

    ctx.db.close();
  });
});

describe('rolePanelHandler & /role-panel command', () => {
  it('checks modules.rolePanels and defers before calling member.roles.add', async () => {
    const ctx = createCtx();
    const panel = ctx.services.rolePanel.createPanel({
      guildId: 'g1',
      title: '测试面板',
      description: '选择身份组',
      displayMode: 'button',
      selectionMode: 'multi',
    });
    ctx.services.rolePanel.addOption('g1', panel.id, {
      roleId: 'r1',
      label: '玩家',
      emoji: '🎮',
      description: null,
    });

    // Disabled module check
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, rolePanels: false });
    const member1 = makeMember('u1');
    const disabledEdit = vi.fn(async () => undefined);
    await handleRolePanelButton(
      {
        guildId: 'g1',
        customId: `rolepanel:btn:${panel.id}:r1`,
        inCachedGuild: () => true,
        member: member1,
        deferReply: vi.fn(async () => undefined),
        editReply: disabledEdit,
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(member1.roles.add).not.toHaveBeenCalled();

    // Enabled: deferReply must happen BEFORE roles.add
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, rolePanels: true });
    const order: string[] = [];
    const member2 = makeMember('u2');
    member2.roles.add = vi.fn(async () => {
      order.push('roles.add');
    });
    await handleRolePanelButton(
      {
        guildId: 'g1',
        customId: `rolepanel:btn:${panel.id}:r1`,
        inCachedGuild: () => true,
        member: member2,
        deferReply: vi.fn(async () => {
          order.push('deferReply');
        }),
        editReply: vi.fn(async () => {
          order.push('editReply');
        }),
      } as unknown as ButtonInteraction,
      ctx,
    );
    expect(order).toEqual(['deferReply', 'roles.add', 'editReply']);

    ctx.db.close();
  });

  it('rejects invalid emoji text in /role-panel add-option and safely skips invalid legacy emoji in buildRolePanelMessage', async () => {
    const ctx = createCtx();
    const panel = ctx.services.rolePanel.createPanel({
      guildId: 'g1',
      title: '测试面板',
      description: '描述',
      displayMode: 'button',
      selectionMode: 'multi',
    });

    const badReply = vi.fn(async () => undefined);
    await rolePanelCommand.execute(
      {
        guildId: 'g1',
        inCachedGuild: () => true,
        member: makeMember('admin-1', { admin: true }),
        options: {
          getSubcommand: () => 'add-option',
          getInteger: () => panel.id,
          getRole: () => ({ id: 'r1' }),
          getString: (name: string) => {
            if (name === 'label') return '星辰';
            if (name === 'emoji') return '星星文本';
            return null;
          },
        },
        reply: badReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );

    const errTitle = (badReply.mock.calls[0] as unknown as [MockPayload])[0].embeds?.[0]?.toJSON().title;
    expect(errTitle).toContain('无效');
    expect(ctx.services.rolePanel.getPanelWithOptions('g1', panel.id)?.options).toHaveLength(0);

    // Defensive buildRolePanelMessage must not throw even if legacy DB row has invalid emoji
    ctx.services.rolePanel.addOption('g1', panel.id, {
      roleId: 'r2',
      label: '旧数据',
      emoji: 'invalid-text',
      description: null,
    });
    const data = ctx.services.rolePanel.getPanelWithOptions('g1', panel.id)!;
    expect(() => buildRolePanelMessage(data.panel, data.options)).not.toThrow();

    ctx.db.close();
  });
});

describe('/ai command fixes', () => {
  it('fixes category description to default manual and safely truncates long memory list within 4096 chars', () => {
    const json = aiCommand.data.toJSON();
    const serialized = JSON.stringify(json);
    expect(serialized).toContain('默认 manual');
    expect(serialized).not.toContain('默认 general');

    const items = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      guildId: 'g1',
      scopeType: 'user' as const,
      scopeId: 'u1',
      category: 'manual',
      content: `内容_${i + 1}_${'长'.repeat(180)}`,
      createdBy: 'u1',
      createdAt: 1000 + i,
      updatedAt: 1000 + i,
    }));

    const desc = formatMemoryListDescription(items, 4096);
    expect(desc.length).toBeLessThanOrEqual(4096);
    expect(desc).toContain('共 30 条');
  });
});

describe('messageCreate isolation, world event guards, and AI safety/rate-limits', () => {
  beforeEach(() => {
    resetAiRuntimeGuards();
  });

  it('isolates leveling/worldEvent errors from AI and skips world events in ticket/ignored channels or when economy disabled', async () => {
    const llmCalls = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: 'demo',
            choices: [{ message: { content: 'AI 照常回复' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const llmClient = new LlmClient(
      { baseUrl: 'https://gateway.local/v1', apiKey: 'sk-test', model: 'demo', timeoutMs: 5000 },
      { fetchFn: llmCalls },
    );
    const ctx = createCtx(llmClient);

    // Create a ticket channel
    ctx.services.ticket.createTicket('g1', 'ticket-ch', 'u1', '私密工单');

    // Spy on leveling throwing an error & worldEvent tryAutoSpawnOnMessage
    vi.spyOn(ctx.services.leveling, 'awardMessageXp').mockImplementation(() => {
      throw new Error('leveling boom');
    });
    const spawnSpy = vi.spyOn(ctx.services.worldEvent, 'tryAutoSpawnOnMessage');

    const replyFn = vi.fn(async () => undefined);
    const makeMsg = (overrides?: Partial<Record<string, unknown>>) =>
      ({
        id: 'msg-1',
        channelId: 'ticket-ch',
        content: '<@bot-1> 帮我看看',
        createdTimestamp: Date.now(),
        author: { id: 'u1', bot: false, username: 'alice', displayName: 'Alice' },
        member: { displayName: 'Alice' },
        guild: { id: 'g1' },
        mentions: { users: new Map([['bot-1', { id: 'bot-1' }]]) },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: {
          isTextBased: () => true,
          isSendable: () => true,
          sendTyping: vi.fn(async () => undefined),
          messages: { fetch: vi.fn(async () => new Map()) },
        },
        reply: replyFn,
        ...overrides,
      }) as unknown as Message;

    const fakeClient = { user: { id: 'bot-1' } } as unknown as Client;

    // Ticket channel: leveling throws, worldEvent MUST be skipped, AI still replies!
    await handleMessageCreate(fakeClient, makeMsg(), ctx);
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(llmCalls).toHaveBeenCalledTimes(1);
    expect(replyFn).toHaveBeenCalledTimes(1);

    // Ignored leveling channel: worldEvent MUST be skipped
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateLeveling('g1', { ...cfg.leveling, ignoredChannelIds: ['ignored-ch'] });
    await handleMessageCreate(
      fakeClient,
      makeMsg({ id: 'msg-2', channelId: 'ignored-ch', mentions: { users: new Map() } }),
      ctx,
    );
    expect(spawnSpy).not.toHaveBeenCalled();

    // Economy disabled: worldEvent MUST be skipped even if worldEvents is enabled
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, worldEvents: true, economy: false });
    await handleMessageCreate(
      fakeClient,
      makeMsg({ id: 'msg-3', channelId: 'normal-ch', mentions: { users: new Map() } }),
      ctx,
    );
    expect(spawnSpy).not.toHaveBeenCalled();

    // Auto-locks onto #游戏聊天: messages in #生图区 must NEVER trigger or count, only #游戏聊天 does!
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, worldEvents: true, economy: true });
    ctx.repos.guildConfig.updateGames('g1', {
      ...cfg.games,
      eventChannelId: null,
      eventMsgThreshold: 2,
      eventCooldownSec: 1,
    });
    const gameChatSend = vi.fn(async () => ({ id: 'ev-msg-1' }));
    const drawChatSend = vi.fn(async () => ({ id: 'draw-msg-1' }));
    const gameChatObj = {
      id: 'ch-game-chat',
      name: '游戏聊天',
      isTextBased: () => true,
      isThread: () => false,
      isSendable: () => true,
      send: gameChatSend,
    };
    const drawChatObj = {
      id: 'ch-draw-chat',
      name: '生图区',
      isTextBased: () => true,
      isThread: () => false,
      isSendable: () => true,
      send: drawChatSend,
    };
    const guildWithGameChat = {
      id: 'g1',
      channels: {
        cache: new Map([
          ['ch-draw-chat', drawChatObj],
          ['ch-game-chat', gameChatObj],
        ]),
      },
    };
    const clientWithChannels = {
      user: { id: 'bot-1' },
      channels: {
        cache: guildWithGameChat.channels.cache,
        fetch: vi.fn(async (id: string) => guildWithGameChat.channels.cache.get(id) ?? null),
      },
    } as unknown as Client;

    // Messages in #生图区 do not call tryAutoSpawnOnMessage, while auto-resolving eventChannelId to #游戏聊天
    for (let i = 0; i < 3; i++) {
      await handleMessageCreate(
        clientWithChannels,
        makeMsg({
          id: `draw-m-${i}`,
          channelId: 'ch-draw-chat',
          guild: guildWithGameChat,
          mentions: { users: new Map() },
        }),
        ctx,
      );
    }
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(drawChatSend).not.toHaveBeenCalled();
    expect(ctx.repos.guildConfig.getOrCreate('g1').games.eventChannelId).toBe('ch-game-chat');

    // 2 messages in #游戏聊天 trigger spawn strictly in #游戏聊天
    await handleMessageCreate(
      clientWithChannels,
      makeMsg({
        id: 'game-m-1',
        channelId: 'ch-game-chat',
        guild: guildWithGameChat,
        mentions: { users: new Map() },
      }),
      ctx,
    );
    await handleMessageCreate(
      clientWithChannels,
      makeMsg({
        id: 'game-m-2',
        channelId: 'ch-game-chat',
        guild: guildWithGameChat,
        mentions: { users: new Map() },
      }),
      ctx,
    );
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(gameChatSend).toHaveBeenCalledTimes(1);
    expect(drawChatSend).not.toHaveBeenCalled();

    ctx.db.close();
  });

  it('guards AI against premature deep reference fetches, empty content fallback, .env leakage, cooldown, and concurrency', async () => {
    const ctx = createCtx(new LlmClient(undefined)); // unconfigured LLM
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateAi('g1', { ...cfg.ai, freeChatChannelIds: ['free-ch'] });

    // 1. Non-triggered channel replying to a human only fetches 1-level directRef, NEVER deeper
    const deeperFetch = vi.fn(async () => {
      throw new Error('should not fetch deeper');
    });
    const directFetch = vi.fn(async () => ({
      id: 'ref-1',
      author: { id: 'human-2', bot: false, username: 'bob' },
      content: 'hi',
      createdTimestamp: 1000,
      attachments: new Map(),
      embeds: [],
      reference: { messageId: 'ref-0' },
      fetchReference: deeperFetch,
    }));

    const fakeClient = { user: { id: 'bot-1' } } as unknown as Client;
    await handleMessageCreate(
      fakeClient,
      {
        id: 'm-ref',
        channelId: 'normal-ch',
        content: '回复人类',
        createdTimestamp: Date.now(),
        author: { id: 'u1', bot: false, username: 'alice' },
        member: { displayName: 'Alice' },
        guild: { id: 'g1' },
        mentions: { users: new Map() },
        attachments: new Map(),
        embeds: [],
        reference: { messageId: 'ref-1' },
        fetchReference: directFetch,
        channel: { isTextBased: () => true, isSendable: () => true },
        reply: vi.fn(async () => undefined),
      } as unknown as Message,
      ctx,
    );
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(deeperFetch).not.toHaveBeenCalled();

    // 2. Empty content + no attachments in freeChat channel does NOT trigger AI
    const emptyReply = vi.fn(async () => undefined);
    await handleMessageCreate(
      fakeClient,
      {
        id: 'm-empty',
        channelId: 'free-ch',
        content: '   ',
        createdTimestamp: Date.now(),
        author: { id: 'u1', bot: false, username: 'alice' },
        member: { displayName: 'Alice' },
        guild: { id: 'g1' },
        mentions: { users: new Map() },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: { isTextBased: () => true, isSendable: () => true },
        reply: emptyReply,
      } as unknown as Message,
      ctx,
    );
    expect(emptyReply).not.toHaveBeenCalled();

    // 3. Unconfigured AI notice does NOT leak .env variable names
    const unconfReply = vi.fn(async () => undefined);
    await handleMessageCreate(
      fakeClient,
      {
        id: 'm-unconf',
        channelId: 'normal-ch',
        content: '<@bot-1> 你好',
        createdTimestamp: Date.now(),
        author: { id: 'u1', bot: false, username: 'alice' },
        member: { displayName: 'Alice' },
        guild: { id: 'g1' },
        mentions: { users: new Map([['bot-1', { id: 'bot-1' }]]) },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: { isTextBased: () => true, isSendable: () => true },
        reply: unconfReply,
      } as unknown as Message,
      ctx,
    );
    expect(unconfReply).toHaveBeenCalledTimes(1);
    const unconfText = (unconfReply.mock.calls[0] as unknown as [{ content: string }])[0].content;
    expect(unconfText).not.toContain('.env');
    expect(unconfText).not.toContain('LLM_API_KEY');
    expect(unconfText).not.toContain('LLM_BASE_URL');

    ctx.db.close();

    // 4. Per-user cooldown & per-channel FIFO queue (same channel serializes instead of dropping)
    const resolvers: Array<(res: Response) => void> = [];
    let fetchCount = 0;
    const slowClient = new LlmClient(
      { baseUrl: 'https://gateway.local/v1', apiKey: 'sk-test', model: 'demo', timeoutMs: 5000 },
      {
        fetchFn: () => {
          fetchCount++;
          return new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          });
        },
      },
    );
    const ctx2 = createCtx(slowClient);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const makeChatMsg = (
      id: string,
      userId: string,
      channelId: string,
      replySpy = vi.fn(async () => undefined),
    ) =>
      ({
        id,
        channelId,
        content: '<@bot-1> 聊聊天',
        createdTimestamp: Date.now(),
        author: { id: userId, bot: false, username: userId },
        member: { displayName: userId },
        guild: { id: 'g1' },
        mentions: { users: new Map([['bot-1', { id: 'bot-1' }]]) },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: {
          isTextBased: () => true,
          isSendable: () => true,
          sendTyping: vi.fn(async () => undefined),
          messages: { fetch: vi.fn(async () => new Map()) },
        },
        reply: replySpy,
      }) as unknown as Message;

    const reply1 = vi.fn(async () => undefined);
    const reply2 = vi.fn(async () => undefined);
    const p1 = handleMessageCreate(fakeClient, makeChatMsg('c1', 'user-a', 'chan-lock', reply1), ctx2);
    // Wait for p1 to enter LLM fetch
    await vi.waitFor(() => {
      expect(fetchCount).toBe(1);
    });

    // Different user in SAME channel is queued rather than dropped or fired concurrently
    const p2 = handleMessageCreate(fakeClient, makeChatMsg('c2', 'user-b', 'chan-lock', reply2), ctx2);
    await Promise.resolve();
    expect(fetchCount).toBe(1);
    expect(
      infoSpy.mock.calls.some((args) => String(args[0]).includes('[ai:queue] pos=1 user=user-b')),
    ).toBe(true);

    resolvers[0]!(
      new Response(
        JSON.stringify({ model: 'demo', choices: [{ message: { content: '第一条回复' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await p1;

    await vi.waitFor(() => {
      expect(fetchCount).toBe(2);
    });
    resolvers[1]!(
      new Response(
        JSON.stringify({ model: 'demo', choices: [{ message: { content: '第二条回复' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await p2;
    expect(reply1).toHaveBeenCalledTimes(1);
    expect(reply2).toHaveBeenCalledTimes(1);

    // Same user immediately in another channel is blocked by per-user 5s cooldown
    await handleMessageCreate(fakeClient, makeChatMsg('c3', 'user-a', 'chan-other'), ctx2);
    expect(fetchCount).toBe(2);
    expect(
      infoSpy.mock.calls.some((args) => String(args[0]).includes('[ai:skip] reason=cooldown')),
    ).toBe(true);

    infoSpy.mockRestore();
    ctx2.db.close();
  });

  it('caps per-channel AI queue at AI_CHANNEL_MAX_PENDING and skips overflow without consuming cooldown', async () => {
    const resolvers: Array<(res: Response) => void> = [];
    let fetchCount = 0;
    const llmClient = new LlmClient(
      { baseUrl: 'https://gateway.local/v1', apiKey: 'sk-test', model: 'demo', timeoutMs: 5000 },
      {
        fetchFn: () => {
          fetchCount++;
          return new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          });
        },
      },
    );
    const ctx = createCtx(llmClient);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const fakeClient = { user: { id: 'bot-1' } } as unknown as Client;

    const makeChatMsg = (id: string, userId: string, channelId = 'chan-cap') =>
      ({
        id,
        channelId,
        content: '<@bot-1> 排队测试',
        createdTimestamp: Date.now(),
        author: { id: userId, bot: false, username: userId },
        member: { displayName: userId },
        guild: { id: 'g1' },
        mentions: { users: new Map([['bot-1', { id: 'bot-1' }]]) },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: {
          isTextBased: () => true,
          isSendable: () => true,
          sendTyping: vi.fn(async () => undefined),
          messages: { fetch: vi.fn(async () => new Map()) },
        },
        reply: vi.fn(async () => undefined),
      }) as unknown as Message;

    const totalAccepted = 1 + AI_CHANNEL_MAX_PENDING;
    const pendingPromises: Array<Promise<void>> = [];
    pendingPromises.push(handleMessageCreate(fakeClient, makeChatMsg('m0', 'u0'), ctx));
    await vi.waitFor(() => {
      expect(fetchCount).toBe(1);
    });

    for (let i = 1; i < totalAccepted; i++) {
      pendingPromises.push(handleMessageCreate(fakeClient, makeChatMsg(`m${i}`, `u${i}`), ctx));
    }

    // Overflow user should return immediately without entering queue or setting cooldown
    await handleMessageCreate(fakeClient, makeChatMsg('m-overflow', 'u-overflow'), ctx);
    expect(
      infoSpy.mock.calls.some((args) =>
        String(args[0]).includes('[ai:skip] reason=queue_full pending=4 user=u-overflow'),
      ),
    ).toBe(true);

    for (let i = 0; i < totalAccepted; i++) {
      await vi.waitFor(() => {
        expect(resolvers.length).toBe(i + 1);
      });
      resolvers[i]!(
        new Response(
          JSON.stringify({ model: 'demo', choices: [{ message: { content: `ok-${i}` } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    await Promise.all(pendingPromises);
    expect(fetchCount).toBe(totalAccepted);

    // Since u-overflow was skipped by queue_full, it was not put on cooldown
    const afterDrain = handleMessageCreate(fakeClient, makeChatMsg('m-after', 'u-overflow'), ctx);
    await vi.waitFor(() => {
      expect(fetchCount).toBe(totalAccepted + 1);
    });
    resolvers[totalAccepted]!(
      new Response(
        JSON.stringify({ model: 'demo', choices: [{ message: { content: 'ok-after' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await afterDrain;

    infoSpy.mockRestore();
    ctx.db.close();
  });

  it('allows concurrent AI requests across different channels without waiting', async () => {
    const resolvers: Array<(res: Response) => void> = [];
    let fetchCount = 0;
    const llmClient = new LlmClient(
      { baseUrl: 'https://gateway.local/v1', apiKey: 'sk-test', model: 'demo', timeoutMs: 5000 },
      {
        fetchFn: () => {
          fetchCount++;
          return new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          });
        },
      },
    );
    const ctx = createCtx(llmClient);
    const fakeClient = { user: { id: 'bot-1' } } as unknown as Client;
    const makeChatMsg = (id: string, userId: string, channelId: string) =>
      ({
        id,
        channelId,
        content: '<@bot-1> 并发频道',
        createdTimestamp: Date.now(),
        author: { id: userId, bot: false, username: userId },
        member: { displayName: userId },
        guild: { id: 'g1' },
        mentions: { users: new Map([['bot-1', { id: 'bot-1' }]]) },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: {
          isTextBased: () => true,
          isSendable: () => true,
          sendTyping: vi.fn(async () => undefined),
          messages: { fetch: vi.fn(async () => new Map()) },
        },
        reply: vi.fn(async () => undefined),
      }) as unknown as Message;

    const pa = handleMessageCreate(fakeClient, makeChatMsg('ma', 'ua', 'chan-a'), ctx);
    const pb = handleMessageCreate(fakeClient, makeChatMsg('mb', 'ub', 'chan-b'), ctx);

    await vi.waitFor(() => {
      expect(fetchCount).toBe(2);
    });

    resolvers[0]!(
      new Response(JSON.stringify({ model: 'demo', choices: [{ message: { content: 'a' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    resolvers[1]!(
      new Response(JSON.stringify({ model: 'demo', choices: [{ message: { content: 'b' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await Promise.all([pa, pb]);
    ctx.db.close();
  });

  it('isolates per-task errors in the channel queue so subsequent queued messages still receive replies', async () => {
    const resolvers: Array<(res: Response) => void> = [];
    let fetchCount = 0;
    const llmClient = new LlmClient(
      { baseUrl: 'https://gateway.local/v1', apiKey: 'sk-test', model: 'demo', timeoutMs: 5000 },
      {
        fetchFn: () => {
          fetchCount++;
          return new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          });
        },
      },
    );
    const ctx = createCtx(llmClient);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fakeClient = { user: { id: 'bot-1' } } as unknown as Client;

    const failingReply = vi.fn(async () => {
      throw new Error('Discord reply failed');
    });
    const okReply = vi.fn(async () => undefined);
    const makeChatMsg = (id: string, userId: string, replyFn: ReturnType<typeof vi.fn>) =>
      ({
        id,
        channelId: 'chan-err-iso',
        content: '<@bot-1> 测试异常隔离',
        createdTimestamp: Date.now(),
        author: { id: userId, bot: false, username: userId },
        member: { displayName: userId },
        guild: { id: 'g1' },
        mentions: { users: new Map([['bot-1', { id: 'bot-1' }]]) },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: {
          isTextBased: () => true,
          isSendable: () => true,
          sendTyping: vi.fn(async () => undefined),
          messages: { fetch: vi.fn(async () => new Map()) },
        },
        reply: replyFn,
      }) as unknown as Message;

    const p1 = handleMessageCreate(fakeClient, makeChatMsg('me1', 'ue1', failingReply), ctx);
    await vi.waitFor(() => {
      expect(fetchCount).toBe(1);
    });
    const p2 = handleMessageCreate(fakeClient, makeChatMsg('me2', 'ue2', okReply), ctx);

    resolvers[0]!(
      new Response(JSON.stringify({ model: 'demo', choices: [{ message: { content: 'r1' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await p1;

    await vi.waitFor(() => {
      expect(fetchCount).toBe(2);
    });
    resolvers[1]!(
      new Response(JSON.stringify({ model: 'demo', choices: [{ message: { content: 'r2' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await p2;

    expect(errSpy).toHaveBeenCalled();
    expect(okReply).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
    ctx.db.close();
  });

  it('passes failIfNotExists: false on AI replies and logs upstream error detail in [ai:error]', async () => {
    const fakeClient = { user: { id: 'bot-1' } } as unknown as Client;

    // 1. Unconfigured notice includes failIfNotExists: false
    const unconfCtx = createCtx(new LlmClient(undefined));
    const unconfReply = vi.fn(async () => undefined);
    await handleMessageCreate(
      fakeClient,
      {
        id: 'm-unconf-flag',
        channelId: 'chan-flag',
        content: '<@bot-1> hi',
        createdTimestamp: Date.now(),
        author: { id: 'u1', bot: false, username: 'u1' },
        member: { displayName: 'u1' },
        guild: { id: 'g1' },
        mentions: { users: new Map([['bot-1', { id: 'bot-1' }]]) },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: { isTextBased: () => true, isSendable: () => true },
        reply: unconfReply,
      } as unknown as Message,
      unconfCtx,
    );
    expect(unconfReply.mock.calls[0]?.[0]).toMatchObject({ failIfNotExists: false });
    unconfCtx.db.close();

    // 2. Normal reply & HTTP 400 error reply both include failIfNotExists: false, and [ai:error] logs detail
    let mode: 'ok' | '400' = 'ok';
    const llmClient = new LlmClient(
      { baseUrl: 'https://gateway.local/v1', apiKey: 'sk-test', model: 'demo', timeoutMs: 5000 },
      {
        maxRetries: 0,
        fetchFn: async () => {
          if (mode === 'ok') {
            return new Response(
              JSON.stringify({ model: 'demo', choices: [{ message: { content: '正常回复' } }] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return new Response('{"error":{"message":"invalid_model_param"}}', {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    );
    const ctx = createCtx(llmClient);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const okReply = vi.fn(async () => undefined);
    await handleMessageCreate(
      fakeClient,
      {
        id: 'm-ok-flag',
        channelId: 'chan-flag-2',
        content: '<@bot-1> hi',
        createdTimestamp: Date.now(),
        author: { id: 'u2', bot: false, username: 'u2' },
        member: { displayName: 'u2' },
        guild: { id: 'g1' },
        mentions: { users: new Map([['bot-1', { id: 'bot-1' }]]) },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: {
          isTextBased: () => true,
          isSendable: () => true,
          sendTyping: vi.fn(async () => undefined),
          messages: { fetch: vi.fn(async () => new Map()) },
        },
        reply: okReply,
      } as unknown as Message,
      ctx,
    );
    expect(okReply.mock.calls[0]?.[0]).toMatchObject({ failIfNotExists: false });

    mode = '400';
    const errReply = vi.fn(async () => undefined);
    await handleMessageCreate(
      fakeClient,
      {
        id: 'm-err-flag',
        channelId: 'chan-flag-2',
        content: '<@bot-1> hi again',
        createdTimestamp: Date.now(),
        author: { id: 'u3', bot: false, username: 'u3' },
        member: { displayName: 'u3' },
        guild: { id: 'g1' },
        mentions: { users: new Map([['bot-1', { id: 'bot-1' }]]) },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: {
          isTextBased: () => true,
          isSendable: () => true,
          sendTyping: vi.fn(async () => undefined),
          messages: { fetch: vi.fn(async () => new Map()) },
        },
        reply: errReply,
      } as unknown as Message,
      ctx,
    );
    expect(errReply.mock.calls[0]?.[0]).toMatchObject({ failIfNotExists: false });
    const warnLine = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(warnLine).toContain('[ai:error] code=bad_request');
    expect(warnLine).toContain('detail=LLM HTTP 400: {"error":{"message":"invalid_model_param"}}');

    warnSpy.mockRestore();
    ctx.db.close();
  });

  it('resolves <@userId> mentions to display names and applies input/output regex in handleMessageCreate and /ai regex', async () => {
    resetAiRuntimeGuards();
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const llmClient = new LlmClient(
      { baseUrl: 'https://gateway.local/v1', apiKey: 'sk-test', model: 'demo', timeoutMs: 5000 },
      {
        fetchFn: async (_url, init) => {
          const parsed = JSON.parse(String(init?.body)) as {
            messages: Array<{ role: string; content: string }>;
          };
          capturedMessages = parsed.messages;
          return new Response(
            JSON.stringify({
              model: 'demo',
              choices: [{ message: { content: '布丁酱这波极其稳，草莓留着自己吃' } }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    );
    const ctx = createCtx(llmClient);
    ctx.services.ai.addRegexRule('g1', {
      label: '测试代称归一化',
      pattern: '草莓布丁酱|布丁酱',
      replacement: '黑屌王',
      scope: 'both',
      flags: 'gi',
    });
    const replyFn = vi.fn(async () => undefined);
    const fakeClient = { user: { id: 'bot-1' } } as unknown as Client;

    const historyMsg = {
      id: 'm-hist-1',
      author: { id: '900002', bot: false, username: 'other', displayName: '路人' },
      member: { displayName: '路人' },
      content: '刚才 <@900001> 发红包了',
      createdTimestamp: Date.now() - 2000,
      attachments: new Map(),
      embeds: [],
      mentions: {
        users: new Map([
          ['900001', { id: '900001', username: 'pudding', displayName: '草莓布丁酱' }],
        ]),
        members: new Map([['900001', { displayName: '草莓布丁酱' }]]),
      },
      guild: { id: 'g1', members: { cache: new Map() } },
    };

    await handleMessageCreate(
      fakeClient,
      {
        id: 'm-mention',
        channelId: 'chat-ch',
        content: '<@bot-1> 看看 <@!900001> 买草莓没',
        createdTimestamp: Date.now(),
        author: { id: '900003', bot: false, username: 'asker', displayName: '路人甲' },
        member: { displayName: '路人甲' },
        guild: { id: 'g1', members: { cache: new Map() } },
        mentions: {
          users: new Map([
            ['bot-1', { id: 'bot-1' }],
            ['900001', { id: '900001', username: 'pudding', displayName: '草莓布丁酱' }],
          ]),
          members: new Map([['900001', { displayName: '草莓布丁酱' }]]),
        },
        attachments: new Map(),
        embeds: [],
        reference: null,
        channel: {
          isTextBased: () => true,
          isSendable: () => true,
          sendTyping: vi.fn(async () => undefined),
          messages: { fetch: vi.fn(async () => new Map([['m-hist-1', historyMsg]])) },
        },
        reply: replyFn,
      } as unknown as Message,
      ctx,
    );

    expect(capturedMessages).toHaveLength(2);
    expect(capturedMessages[1]?.role).toBe('user');
    expect(capturedMessages[1]?.content).toMatch(
      /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] \[路人\]: 刚才 @黑屌王 发红包了/,
    );
    expect(capturedMessages[1]?.content).toMatch(
      /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] \[路人甲\]: 看看 @黑屌王 买草莓没/,
    );
    expect(capturedMessages[1]?.content).toContain('本句点名提到：@黑屌王');
    const replyPayload = (replyFn.mock.calls[0] as unknown as [{ content: string }])[0];
    expect(replyPayload.content).toBe('黑屌王这波特别稳，草莓留着自己吃');

    // /ai regex permission & CRUD/test
    const memberDeniedReply = vi.fn(async () => undefined);
    await aiCommand.execute(
      {
        guildId: 'g1',
        channelId: 'chat-ch',
        inCachedGuild: () => true,
        user: { id: 'u-asker' },
        member: makeMember('u-asker'),
        options: {
          getSubcommandGroup: () => 'regex',
          getSubcommand: () => 'list',
        },
        reply: memberDeniedReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(
      (memberDeniedReply.mock.calls[0] as unknown as [MockPayload])[0].embeds?.[0]?.toJSON().title,
    ).toContain('权限不足');

    const adminAddReply = vi.fn(async () => undefined);
    await aiCommand.execute(
      {
        guildId: 'g1',
        channelId: 'chat-ch',
        inCachedGuild: () => true,
        user: { id: 'admin-1' },
        member: makeMember('admin-1', { admin: true }),
        options: {
          getSubcommandGroup: () => 'regex',
          getSubcommand: () => 'add',
          getString: (name: string) => {
            if (name === 'label') return '口癖替换';
            if (name === 'pattern') return '好家伙';
            if (name === 'replacement') return '厉害';
            if (name === 'scope') return 'output';
            if (name === 'flags') return 'g';
            return null;
          },
        },
        reply: adminAddReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(
      (adminAddReply.mock.calls[0] as unknown as [MockPayload])[0].embeds?.[0]?.toJSON().title,
    ).toContain('已添加正则规则');

    const adminTestReply = vi.fn(async () => undefined);
    await aiCommand.execute(
      {
        guildId: 'g1',
        channelId: 'chat-ch',
        inCachedGuild: () => true,
        user: { id: 'admin-1' },
        member: makeMember('admin-1', { admin: true }),
        options: {
          getSubcommandGroup: () => 'regex',
          getSubcommand: () => 'test',
          getString: (name: string) => {
            if (name === 'text') return '好家伙，草莓布丁酱极其强';
            if (name === 'scope') return 'output';
            return null;
          },
        },
        reply: adminTestReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    const testDesc = (adminTestReply.mock.calls[0] as unknown as [MockPayload])[0].embeds?.[0]?.toJSON()
      .description;
    expect(testDesc).toContain('厉害，黑屌王特别强');

    // /ai usage permission & summary output
    const deniedUsageReply = vi.fn(async () => undefined);
    await aiCommand.execute(
      {
        guildId: 'g1',
        channelId: 'chat-ch',
        inCachedGuild: () => true,
        user: { id: 'u-asker' },
        member: makeMember('u-asker'),
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => 'usage',
          getInteger: () => 24,
        },
        reply: deniedUsageReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(
      (deniedUsageReply.mock.calls[0] as unknown as [MockPayload])[0].embeds?.[0]?.toJSON().title,
    ).toContain('权限不足');

    ctx.services.ai.updatePricing('g1', 2, 10);
    const okUsageReply = vi.fn(async () => undefined);
    await aiCommand.execute(
      {
        guildId: 'g1',
        channelId: 'chat-ch',
        inCachedGuild: () => true,
        user: { id: 'admin-1' },
        member: makeMember('admin-1', { admin: true }),
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => 'usage',
          getInteger: () => 24,
        },
        reply: okUsageReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    const usageEmbed = (okUsageReply.mock.calls[0] as unknown as [MockPayload])[0].embeds?.[0]?.toJSON();
    expect(usageEmbed?.title).toContain('AI 近 24 小时用量统计');
    expect(usageEmbed?.description).toContain('demo');

    // /ai profile permission & CRUD
    const deniedProfileReply = vi.fn(async () => undefined);
    await aiCommand.execute(
      {
        guildId: 'g1',
        channelId: 'chat-ch',
        inCachedGuild: () => true,
        user: { id: 'u-asker' },
        member: makeMember('u-asker'),
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'list',
        },
        reply: deniedProfileReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(
      (deniedProfileReply.mock.calls[0] as unknown as [MockPayload])[0].embeds?.[0]?.toJSON().title,
    ).toContain('权限不足');

    const profileSetReply = vi.fn(async () => undefined);
    await aiCommand.execute(
      {
        guildId: 'g1',
        channelId: 'chat-ch',
        inCachedGuild: () => true,
        user: { id: 'admin-1' },
        member: makeMember('admin-1', { admin: true }),
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'set',
          getUser: () => ({ id: '100000000000000001' }),
          getString: (name: string) => {
            if (name === 'relation') return 'vip';
            if (name === 'alias') return '冰吊王';
            if (name === 'note') return '核心偏爱大佬';
            return null;
          },
        },
        reply: profileSetReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(
      (profileSetReply.mock.calls[0] as unknown as [MockPayload])[0].embeds?.[0]?.toJSON().title,
    ).toContain('已新增人物档案');
    expect(ctx.services.ai.listUserProfiles('g1')).toHaveLength(1);

    const profileListReply = vi.fn(async () => undefined);
    await aiCommand.execute(
      {
        guildId: 'g1',
        channelId: 'chat-ch',
        inCachedGuild: () => true,
        user: { id: 'admin-1' },
        member: makeMember('admin-1', { admin: true }),
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'list',
        },
        reply: profileListReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(
      (profileListReply.mock.calls[0] as unknown as [MockPayload])[0].embeds?.[0]?.toJSON()
        .description,
    ).toContain('冰吊王');

    const profileDelReply = vi.fn(async () => undefined);
    await aiCommand.execute(
      {
        guildId: 'g1',
        channelId: 'chat-ch',
        inCachedGuild: () => true,
        user: { id: 'admin-1' },
        member: makeMember('admin-1', { admin: true }),
        options: {
          getSubcommandGroup: () => 'profile',
          getSubcommand: () => 'delete',
          getUser: () => ({ id: '100000000000000001' }),
        },
        reply: profileDelReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(ctx.services.ai.listUserProfiles('g1')).toHaveLength(0);

    ctx.db.close();
  });
});
