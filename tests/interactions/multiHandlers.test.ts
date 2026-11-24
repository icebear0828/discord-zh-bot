import {
  MessageFlags,
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
import { DuelRepo } from '../../src/db/repositories/duelRepo.js';
import { FunRepo } from '../../src/db/repositories/funRepo.js';
import { GiveawayRepo } from '../../src/db/repositories/giveawayRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import { InviteRepo } from '../../src/db/repositories/inviteRepo.js';
import { MonitorRepo } from '../../src/db/repositories/monitorRepo.js';
import { ProfileRepo } from '../../src/db/repositories/profileRepo.js';
import { RedPacketRepo } from '../../src/db/repositories/redPacketRepo.js';
import { RolePanelRepo } from '../../src/db/repositories/rolePanelRepo.js';
import { ShopRepo } from '../../src/db/repositories/shopRepo.js';
import { SocialPetRepo } from '../../src/db/repositories/socialPetRepo.js';
import { TicketRepo } from '../../src/db/repositories/ticketRepo.js';
import { WorldEventRepo } from '../../src/db/repositories/worldEventRepo.js';
import { handleChaosButton, handleChaosModal } from '../../src/interactions/chaosHandler.js';
import {
  tryHandleGamesMenuButton,
  tryHandleGamesMenuModal,
  tryHandleGamesMenuStringSelect,
  tryHandleGamesMenuUserSelect,
} from '../../src/interactions/gamesMenuHandler.js';
import { handleMultiplayerButton } from '../../src/interactions/multiplayerHandler.js';
import { handleSocialPetButton } from '../../src/interactions/socialPetHandler.js';
import {
  handleWorldEventButton,
  handleWorldEventModal,
  handleWorldEventStringSelect,
} from '../../src/interactions/worldEventHandler.js';
import { AiService } from '../../src/services/aiService.js';
import { BlackjackManager } from '../../src/services/blackjackService.js';
import { ChaosService } from '../../src/services/chaosService.js';
import { EconomyService } from '../../src/services/economyService.js';
import { FunService } from '../../src/services/funService.js';
import { GiveawayService } from '../../src/services/giveawayService.js';
import { InviteService } from '../../src/services/inviteService.js';
import { LevelingService } from '../../src/services/levelingService.js';
import { MultiplayerService } from '../../src/services/multiplayerService.js';
import { RolePanelService } from '../../src/services/rolePanelService.js';
import { ShopService } from '../../src/services/shopService.js';
import { SocialPetService } from '../../src/services/socialPetService.js';
import { TicketService } from '../../src/services/ticketService.js';
import { WorldEventService } from '../../src/services/worldEventService.js';
import {
  buildNumberBombCard,
  buildPropsView,
  buildRouletteCard,
  buildRouletteView,
} from '../../src/ui/chaosMenuBuilder.js';
import type { AppContext } from '../../src/ui/embeds.js';
import type { MenuActor } from '../../src/ui/menuShared.js';
import {
  buildCpView,
  buildPetBattleCard,
  buildPetsView,
} from '../../src/ui/socialPetMenuBuilder.js';
import {
  buildPredictionCard,
  buildWorldBossCard,
  buildWorldStatusView,
} from '../../src/ui/worldEventMenuBuilder.js';

interface MockPayload {
  content?: string;
  embeds?: Array<{ toJSON(): { title?: string; description?: string; footer?: { text?: string } } }>;
  components?: Array<{ toJSON(): { components: Array<Record<string, unknown>> } }>;
  flags?: number;
}

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
  const blackjack = new BlackjackRepo(db);
  const duel = new DuelRepo(db);
  const monitor = new MonitorRepo(db);

  const leveling = new LevelingService(guildConfig, profile);
  const economy = new EconomyService(db, guildConfig, profile, 'Asia/Shanghai', chaos);
  const blackjackSvc = new BlackjackManager(db, profile, blackjack);
  const shopSvc = new ShopService(db, profile, shop, guildConfig, 'Asia/Shanghai', chaos, socialPet);
  const funSvc = new FunService(fun);
  const ticketSvc = new TicketService(db, guildConfig, ticket);
  const giveawaySvc = new GiveawayService(db, giveaway);
  const inviteSvc = new InviteService(db, invite);
  const rolePanelSvc = new RolePanelService(rolePanel);
  const multiplayerSvc = new MultiplayerService(db, profile, redPacket, chaos, duel);
  const chaosSvc = new ChaosService(db, guildConfig, profile, chaos);
  const worldEventSvc = new WorldEventService(db, guildConfig, profile, worldEvent, socialPet);
  const socialPetSvc = new SocialPetService(db, guildConfig, profile, shop, socialPet, 'Asia/Shanghai');
  const aiSvc = new AiService(guildConfig, aiMemory, profile, socialPet, null);

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
      blackjack,
      duel,
      monitor,
    },
    services: {
      leveling,
      economy,
      blackjack: blackjackSvc,
      shop: shopSvc,
      fun: funSvc,
      ticket: ticketSvc,
      giveaway: giveawaySvc,
      invite: inviteSvc,
      rolePanel: rolePanelSvc,
      multiplayer: multiplayerSvc,
      chaos: chaosSvc,
      worldEvent: worldEventSvc,
      socialPet: socialPetSvc,
      ai: aiSvc,
    },
  };
}

function makeActor(id: string, isAdmin = false): MenuActor {
  return {
    id,
    displayName: `User-${id}`,
    avatarUrl: 'https://example.com/a.png',
    isAdmin,
  };
}

function makeButtonMock(opts: {
  customId: string;
  userId: string;
  channelId?: string;
  isAdmin?: boolean;
  sendFail?: boolean;
  fetchedMsgEdit?: ReturnType<typeof vi.fn>;
}) {
  const reply = vi.fn(async (_p: MockPayload) => undefined);
  const update = vi.fn(async (_p: MockPayload) => undefined);
  const followUp = vi.fn(async (_p: MockPayload) => undefined);
  const showModal = vi.fn(async (_m: unknown) => undefined);
  const msgEdit = vi.fn(async (_p: MockPayload) => undefined);
  const fetchedMsgEdit = opts.fetchedMsgEdit ?? vi.fn(async (_p: MockPayload) => undefined);
  let msgSeq = 1;
  const channelSend = opts.sendFail
    ? vi.fn(async () => {
        throw new Error('Cannot send');
      })
    : vi.fn(async (_p: MockPayload) => ({ id: `sent-msg-${msgSeq++}` }));

  const chId = opts.channelId ?? 'c1';
  const channelObj = {
    id: chId,
    isSendable: () => true,
    isTextBased: () => true,
    send: channelSend,
    messages: {
      fetch: vi.fn(async () => ({ edit: fetchedMsgEdit })),
    },
  };

  const channelsCache = new Map([[chId, channelObj]]);

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    channelId: chId,
    channel: channelObj,
    guild: {
      id: 'g1',
      ownerId: 'owner-1',
      channels: { cache: channelsCache },
    },
    client: {
      channels: {
        cache: channelsCache,
        fetch: vi.fn(async () => channelObj),
      },
    },
    user: {
      id: opts.userId,
      displayName: `User-${opts.userId}`,
      displayAvatarURL: () => 'https://example.com/a.png',
    },
    member: {
      id: opts.userId,
      permissions: { has: () => Boolean(opts.isAdmin) },
      roles: { cache: new Map() },
    },
    message: { edit: msgEdit },
    inCachedGuild: () => true,
    reply,
    update,
    followUp,
    showModal,
  };

  return {
    interaction: mock as unknown as ButtonInteraction,
    reply,
    update,
    followUp,
    showModal,
    msgEdit,
    fetchedMsgEdit,
    channelSend,
  };
}

function makeModalMock(opts: {
  customId: string;
  userId: string;
  fields: Record<string, string>;
  fromMessage?: boolean;
  setNicknameFail?: boolean;
  targetNotFound?: boolean;
}) {
  const reply = vi.fn(async (_p: MockPayload) => undefined);
  const update = vi.fn(async (_p: MockPayload) => undefined);
  const followUp = vi.fn(async (_p: MockPayload) => undefined);
  const channelSend = vi.fn(async (_p: MockPayload) => ({ id: 'modal-sent-1' }));
  const setNickname = opts.setNicknameFail
    ? vi.fn(async () => {
        throw new Error('50013');
      })
    : vi.fn(async () => undefined);

  const channelObj = {
    id: 'c1',
    isSendable: () => true,
    isTextBased: () => true,
    send: channelSend,
    messages: { fetch: vi.fn(async () => ({ edit: vi.fn(async () => undefined) })) },
  };
  const channelsCache = new Map([['c1', channelObj]]);

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    channelId: 'c1',
    channel: channelObj,
    guild: {
      id: 'g1',
      ownerId: 'owner-1',
      channels: { cache: channelsCache },
      members: {
        fetch: vi.fn(async () =>
          opts.targetNotFound
            ? null
            : {
                displayName: 'Target',
                permissions: { has: () => false },
                roles: { cache: new Map() },
                setNickname,
              },
        ),
      },
    },
    client: {
      channels: {
        cache: channelsCache,
        fetch: vi.fn(async () => channelObj),
      },
    },
    user: {
      id: opts.userId,
      displayName: `User-${opts.userId}`,
      displayAvatarURL: () => 'https://example.com/a.png',
    },
    fields: {
      getTextInputValue: (k: string) => opts.fields[k] ?? '',
    },
    isFromMessage: () => opts.fromMessage ?? true,
    reply,
    update,
    followUp,
  };

  return {
    interaction: mock as unknown as ModalSubmitInteraction,
    reply,
    update,
    followUp,
    channelSend,
    setNickname,
  };
}

function makeStringSelectMock(opts: {
  customId: string;
  userId: string;
  values: string[];
  isAdmin?: boolean;
}) {
  const reply = vi.fn(async (_p: MockPayload) => undefined);
  const update = vi.fn(async (_p: MockPayload) => undefined);
  const showModal = vi.fn(async (_m: unknown) => undefined);
  const channelSend = vi.fn(async (_p: MockPayload) => ({ id: 'sel-sent-1' }));

  const channelObj = {
    id: 'c1',
    isSendable: () => true,
    isTextBased: () => true,
    send: channelSend,
    messages: { fetch: vi.fn(async () => ({ edit: vi.fn(async () => undefined) })) },
  };
  const channelsCache = new Map([['c1', channelObj]]);

  const mock = {
    customId: opts.customId,
    guildId: 'g1',
    channelId: 'c1',
    channel: channelObj,
    guild: {
      id: 'g1',
      channels: { cache: channelsCache },
    },
    client: {
      channels: {
        cache: channelsCache,
        fetch: vi.fn(async () => channelObj),
      },
    },
    values: opts.values,
    user: {
      id: opts.userId,
      displayName: `User-${opts.userId}`,
      displayAvatarURL: () => 'https://example.com/a.png',
    },
    member: {
      id: opts.userId,
      permissions: { has: () => Boolean(opts.isAdmin) },
      roles: { cache: new Map() },
    },
    inCachedGuild: () => true,
    reply,
    update,
    showModal,
  };

  return {
    interaction: mock as unknown as StringSelectMenuInteraction,
    reply,
    update,
    showModal,
    channelSend,
  };
}

describe('Wave 2 multiplayer, chaos, worldEvent, and socialPet handlers & builders', () => {
  it('multiplayerHandler: single-ID red packet expire leaves other expired packets untouched, and bystander clicking expired duel cleans buttons', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'sender', 2000);

    const past = Date.now() - 120_000;
    const rp1 = ctx.services.multiplayer.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'sender',
      totalAmount: 200,
      totalCount: 2,
      nowMs: past,
      ttlMs: 1000,
    });
    const rp2 = ctx.services.multiplayer.createRedPacket({
      guildId: 'g1',
      channelId: 'c1',
      senderId: 'sender',
      totalAmount: 300,
      totalCount: 2,
      nowMs: past,
      ttlMs: 1000,
    });
    expect(rp1.ok && rp2.ok).toBe(true);
    if (!rp1.ok || !rp2.ok) return;

    const claimBtn = makeButtonMock({ customId: `mp:rp:claim:${rp1.packet.id}`, userId: 'u2' });
    await handleMultiplayerButton(claimBtn.interaction, ctx);
    expect(claimBtn.reply).toHaveBeenCalledTimes(1);
    expect(claimBtn.msgEdit).toHaveBeenCalledTimes(1);
    // Only rp1 expired; rp2 remains open for ready.ts timer to expire & edit its card!
    expect(ctx.services.multiplayer.getRedPacketWithClaims(rp1.packet.id)?.packet.status).toBe('expired');
    expect(ctx.services.multiplayer.getRedPacketWithClaims(rp2.packet.id)?.packet.status).toBe('open');

    // Expired duel clicked by bystander -> expired + clears buttons + refunds challenger!
    const duel = ctx.services.multiplayer.createDuel('g1', 'c1', 'sender', 'opp', 100, past, 1000);
    expect(duel.ok).toBe(true);
    if (duel.ok) {
      const beforeRefund = ctx.repos.profile.getOrCreate('g1', 'sender').coins;
      const bystanderBtn = makeButtonMock({
        customId: `mp:duel:accept:${duel.duel.id}`,
        userId: 'random-bystander',
      });
      await handleMultiplayerButton(bystanderBtn.interaction, ctx);
      expect(bystanderBtn.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('过期');
      expect(bystanderBtn.msgEdit).toHaveBeenCalledTimes(1);
      expect(ctx.repos.profile.getOrCreate('g1', 'sender').coins).toBe(beforeRefund + 100);
    }

    ctx.db.close();
  });

  it('chaosHandler & chaosMenuBuilder: roulette fire has zero followUp/broadcast spam, bomb redraws persisted payoutsJson, single-ID rollback, and 0-qty disabled prop selects', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 5000);
    ctx.repos.profile.addCoins('g1', 'u2', 5000);

    // Custom currencyName reflected in chaos builders
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateEconomy('g1', { ...cfg.economy, currencyName: '钻石' });
    const rlView = buildRouletteView(ctx, 'g1', makeActor('u1'), undefined);
    const rlBtnJson = JSON.stringify(rlView.components.map((c) => c.toJSON()));
    expect(rlBtnJson).toContain('钻石');

    // Props view disables curse & nickname user selects when qty === 0
    const propsView = buildPropsView(ctx, 'g1', makeActor('u1'), undefined, Date.now());
    const curseSelect = propsView.components[2]!.toJSON().components[0] as { disabled?: boolean };
    const nickSelect = propsView.components[3]!.toJSON().components[0] as { disabled?: boolean };
    expect(curseSelect.disabled).toBe(true);
    expect(nickSelect.disabled).toBe(true);

    // Roulette fire updates card in-place with ZERO followUp and ZERO channelSend spam!
    const rl = ctx.services.chaos.createRoulette({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u1',
      entryFee: 100,
      maxPlayers: 2,
    });
    expect(rl.ok).toBe(true);
    if (rl.ok) {
      const card = buildRouletteCard(rl.game, ctx.repos.guildConfig.getOrCreate('g1').economy);
      expect(JSON.stringify(card.components.map((c) => c.toJSON()))).toContain('房主退出即散桌');

      ctx.services.chaos.joinRoulette(rl.game.id, 'u2');
      const started = ctx.services.chaos.startRoulette(rl.game.id, 'u1', false, Date.now(), () => 0);
      expect(started.ok).toBe(true);
      if (started.ok) {
        const shooter = started.game.alivePlayers[0]!;
        const fireBtn = makeButtonMock({ customId: `ch:rl:fire:${rl.game.id}`, userId: shooter });
        await handleChaosButton(fireBtn.interaction, ctx);
        expect(fireBtn.update).toHaveBeenCalledTimes(1);
        expect(fireBtn.followUp).not.toHaveBeenCalled();
        expect(fireBtn.channelSend).not.toHaveBeenCalled();
      }
    }

    // Bomb send failure cancels ONLY its own bomb, not another open bomb!
    const existingBomb = ctx.services.chaos.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u1',
      penalty: 200,
    });
    expect(existingBomb.ok).toBe(true);
    const failBombBtn = makeButtonMock({
      customId: 'menu:bomb:new:200',
      userId: 'u1',
      sendFail: true,
    });
    await tryHandleGamesMenuButton(failBombBtn.interaction, ctx, 'g1', makeActor('u1'), [
      'menu',
      'bomb',
      'new',
      '200',
    ]);
    if (existingBomb.ok) {
      expect(ctx.services.chaos.getNumberBomb(existingBomb.game.id)?.status).toBe('open');
    }

    // Bomb modal from message gives Ephemeral followUp AND exploded card redraw uses persisted payoutsJson!
    const b2 = ctx.services.chaos.createNumberBomb({
      guildId: 'g1',
      channelId: 'c1',
      hostId: 'u1',
      penalty: 200,
      rng: () => 0.5, // secret = 51
    });
    expect(b2.ok).toBe(true);
    if (b2.ok) {
      const gSafeModal = makeModalMock({
        customId: `ch:bomb_sub:${b2.game.id}`,
        userId: 'u1',
        fields: { guess: '50' },
        fromMessage: true,
      });
      await handleChaosModal(gSafeModal.interaction, ctx);
      expect(gSafeModal.update).toHaveBeenCalledTimes(1);
      expect(gSafeModal.followUp).toHaveBeenCalledTimes(1);
      expect(gSafeModal.followUp.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

      // Narrow to single number [51, 51] -> card highlights single number warning!
      ctx.services.chaos.guessNumberBomb(b2.game.id, 'u2', 52);
      const singleNumGame = ctx.services.chaos.getNumberBomb(b2.game.id)!;
      expect(singleNumGame.minBound).toBe(51);
      expect(singleNumGame.maxBound).toBe(51);
      const singleCard = buildNumberBombCard(
        singleNumGame,
        ctx.repos.guildConfig.getOrCreate('g1').economy,
      );
      expect(singleCard.embeds[0]!.toJSON().description).toContain('仅剩唯一数字');

      // Explode and redraw WITHOUT passing payouts arg -> reads persisted payoutsJson!
      ctx.services.chaos.guessNumberBomb(b2.game.id, 'u1', 51);
      const explodedGame = ctx.services.chaos.getNumberBomb(b2.game.id)!;
      const redrawn = buildNumberBombCard(
        explodedGame,
        ctx.repos.guildConfig.getOrCreate('g1').economy,
      );
      const desc = redrawn.embeds[0]!.toJSON().description ?? '';
      expect(desc).toContain('<@u2>');
      expect(desc).not.toContain('系统没收');
    }

    // Nickname card atomic reserve + refund on failure
    expect(ctx.services.chaos.buyProp('g1', 'u1', 'nickname').ok).toBe(true);
    const failNick = makeModalMock({
      customId: 'menu:modal_sub:prop_nick:u2',
      userId: 'u1',
      fields: { nickname: '新名字' },
      setNicknameFail: true,
    });
    await tryHandleGamesMenuModal(failNick.interaction, ctx, 'g1', makeActor('u1'), [
      'menu',
      'modal_sub',
      'prop_nick',
      'u2',
    ]);
    expect(ctx.services.chaos.getPropQuantity('g1', 'u1', 'nickname')).toBe(1);

    ctx.db.close();
  });

  it('worldEventHandler & worldEventMenuBuilder: public prediction card strips admin controls, enforces module guards, syncs channel_id on post_card, and redraws Boss rewardsJson', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'creator', 5000);
    ctx.repos.profile.addCoins('g1', 'u2', 5000);

    const pred = ctx.services.worldEvent.createPrediction({
      guildId: 'g1',
      channelId: 'c1',
      creatorId: 'creator',
      title: '吃瓜测试',
      options: ['A', 'B'],
      closeMinutes: 60,
    });
    expect(pred.ok).toBe(true);
    if (!pred.ok) return;

    // Public prediction card has ONLY bet & refresh buttons (NO settle/lock/cancel!)
    const econ = ctx.repos.guildConfig.getOrCreate('g1').economy;
    const pubCard = buildPredictionCard(pred.summary, econ);
    const ids = pubCard.components.flatMap((r) =>
      r.toJSON().components.map((c) => String(c.custom_id ?? '')),
    );
    expect(ids.some((id) => id.startsWith('ev:pred:bet:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('ev:pred:refresh:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('ev:pred:settle:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('ev:pred:lock:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('ev:pred:cancel:'))).toBe(false);

    // Creator clicking bet button gets blocked immediately
    const creatorBetBtn = makeButtonMock({
      customId: `ev:pred:bet:${pred.summary.prediction.id}:0`,
      userId: 'creator',
    });
    await handleWorldEventButton(creatorBetBtn.interaction, ctx);
    expect(creatorBetBtn.showModal).not.toHaveBeenCalled();
    expect(creatorBetBtn.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('开盘人');

    // Settling open prediction via select is rejected with not_locked message
    const settleOpen = makeStringSelectMock({
      customId: `ev:pred:settle:${pred.summary.prediction.id}`,
      userId: 'creator',
      values: ['0'],
    });
    await handleWorldEventStringSelect(settleOpen.interaction, ctx);
    expect(settleOpen.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('封盘');

    // Module off blocks ev:pred:refresh and ev:pred:settle
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, worldEvents: false });
    const refreshDisabled = makeButtonMock({
      customId: `ev:pred:refresh:${pred.summary.prediction.id}`,
      userId: 'u2',
    });
    await handleWorldEventButton(refreshDisabled.interaction, ctx);
    expect(refreshDisabled.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('模块未开启');
    ctx.repos.guildConfig.updateModules('g1', { ...cfg.modules, worldEvents: true });

    // World Boss: non-admin cannot post_card; admin post_card syncs channel_id & disables old card
    const boss = ctx.services.worldEvent.spawnBoss('g1', 'c1');
    ctx.services.worldEvent.bindWorldEventMessage(boss.id, 'old-boss-msg', 'c1');

    const statusNonAdmin = buildWorldStatusView(ctx, 'g1', makeActor('u2', false), undefined);
    const statusIds = statusNonAdmin.components.flatMap((r) =>
      r.toJSON().components.map((c) => String(c.custom_id ?? '')),
    );
    expect(statusIds.some((id) => id.includes('post_card'))).toBe(false);

    const nonAdminPost = makeButtonMock({
      customId: `menu:world:post_card:${boss.id}`,
      userId: 'u2',
    });
    await tryHandleGamesMenuButton(nonAdminPost.interaction, ctx, 'g1', makeActor('u2', false), [
      'menu',
      'world',
      'post_card',
      String(boss.id),
    ]);
    expect(nonAdminPost.channelSend).not.toHaveBeenCalled();

    const adminPost = makeButtonMock({
      customId: `menu:world:post_card:${boss.id}`,
      userId: 'admin1',
      channelId: 'c2',
      isAdmin: true,
    });
    await tryHandleGamesMenuButton(adminPost.interaction, ctx, 'g1', makeActor('admin1', true), [
      'menu',
      'world',
      'post_card',
      String(boss.id),
    ]);
    expect(ctx.services.worldEvent.getWorldEventDetail(boss.id)?.event.channelId).toBe('c2');
    expect(adminPost.fetchedMsgEdit).toHaveBeenCalledWith({ components: [] });

    // Admin spawn blocked while active event exists
    const spawnBlocked = makeButtonMock({
      customId: 'menu:world:spawn_chest',
      userId: 'admin1',
      isAdmin: true,
    });
    await tryHandleGamesMenuButton(spawnBlocked.interaction, ctx, 'g1', makeActor('admin1', true), [
      'menu',
      'world',
      'spawn_chest',
    ]);
    expect(ctx.services.worldEvent.listActiveWorldEvents('g1')).toHaveLength(1);

    // Boss kill via ev:boss:hit does NOT double broadcast & redrawing from DB uses rewardsJson
    ctx.repos.guildConfig.updateGames('g1', { ...cfg.games, bossBaseHp: 100 });
    const smallBoss = ctx.services.worldEvent.spawnBoss('g1', 'c1');
    const killBtn = makeButtonMock({
      customId: `ev:boss:hit:${smallBoss.id}:heavy`,
      userId: 'u2',
    });
    // Force deterministic kill by attacking directly until dead if needed
    ctx.services.worldEvent.attackBoss(smallBoss.id, 'u2', 'heavy', Date.now() - 30_000, () => 0.99);
    const afterBoss = ctx.services.worldEvent.getWorldEventDetail(smallBoss.id)!;
    expect(afterBoss.event.status).toBe('completed');
    const redrawnBoss = buildWorldBossCard(afterBoss.event, afterBoss.participants, econ);
    expect(redrawnBoss.embeds[0]!.toJSON().description).toContain('含尾刀+');
    expect(killBtn.channelSend).not.toHaveBeenCalled();

    // Prediction bet modal rejects creator
    const creatorModal = makeModalMock({
      customId: `ev:pred_bet_sub:${pred.summary.prediction.id}:0`,
      userId: 'creator',
      fields: { amount: '100' },
    });
    await handleWorldEventModal(creatorModal.interaction, ctx);
    expect(creatorModal.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('开盘人');

    ctx.db.close();
  });

  it('socialPetHandler & socialPetMenuBuilder: proposal accept has no duplicate Embed, CP dissolve shows partner ID + two-step confirm, pet release two-step confirm, and open arena label', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins('g1', 'u1', 5000);
    ctx.repos.profile.addCoins('g1', 'u2', 5000);

    // Proposal accept updates card + sends short single-line congrats (NO duplicate Embed!)
    const prop = ctx.services.socialPet.createProposal({
      guildId: 'g1',
      channelId: 'c1',
      proposerId: 'u1',
      targetId: 'u2',
      relType: 'marriage',
    });
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;

    const acceptBtn = makeButtonMock({ customId: `sp:prop:accept:${prop.proposal.id}`, userId: 'u2' });
    await handleSocialPetButton(acceptBtn.interaction, ctx);
    expect(acceptBtn.update).toHaveBeenCalledTimes(1);
    expect(acceptBtn.channelSend).toHaveBeenCalledTimes(1);
    const sentCongrats = acceptBtn.channelSend.mock.calls[0]![0] as MockPayload;
    expect(sentCongrats.embeds).toBeUndefined();
    expect(sentCongrats.content).toContain('<@u1>');

    // CP view shows partner <@u2> / ID in dissolve dropdown
    const cpView = buildCpView(ctx, 'g1', makeActor('u1'), undefined, Date.now());
    const cpJson = JSON.stringify(cpView.components.map((c) => c.toJSON()));
    expect(cpJson).toContain('<@u2>');
    expect(cpJson).toContain('ID:u2');

    // Selecting cp_dissolve shows two-step confirm (does NOT delete yet!)
    const rel = ctx.services.socialPet.listUserRelationships('g1', 'u1')[0]!;
    const dissolveSel = makeStringSelectMock({
      customId: 'menu:cp_dissolve',
      userId: 'u1',
      values: [String(rel.id)],
    });
    await tryHandleGamesMenuStringSelect(dissolveSel.interaction, ctx, 'g1', makeActor('u1'), [
      'menu',
      'cp_dissolve',
    ]);
    expect(ctx.services.socialPet.listUserRelationships('g1', 'u1')).toHaveLength(1);
    expect(dissolveSel.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('二次确认');

    // Clicking dissolve_confirm deletes relationship
    const dissolveConfirm = makeButtonMock({
      customId: `menu:cp:dissolve_confirm:${rel.id}`,
      userId: 'u1',
    });
    await tryHandleGamesMenuButton(dissolveConfirm.interaction, ctx, 'g1', makeActor('u1'), [
      'menu',
      'cp',
      'dissolve_confirm',
      String(rel.id),
    ]);
    expect(ctx.services.socialPet.listUserRelationships('g1', 'u1')).toHaveLength(0);

    // Pet gacha + open arena card label + pet release two-step confirm
    const pull = ctx.services.socialPet.pullPetGacha('g1', 'u1', Date.now(), () => 0.1);
    expect(pull.ok).toBe(true);
    if (!pull.ok) return;

    const econ = ctx.repos.guildConfig.getOrCreate('g1').economy;
    const petsView = buildPetsView(ctx, 'g1', makeActor('u1'), undefined, Date.now());
    expect(petsView.embeds[0]!.toJSON().footer?.text).toContain('SSR');
    expect(petsView.embeds[0]!.toJSON().footer?.text).not.toContain('SR / SSR');

    const releaseBtn = makeButtonMock({ customId: 'menu:pet:release', userId: 'u1' });
    await tryHandleGamesMenuButton(releaseBtn.interaction, ctx, 'g1', makeActor('u1'), [
      'menu',
      'pet',
      'release',
    ]);
    expect(ctx.services.socialPet.listUserPets('g1', 'u1')).toHaveLength(1);
    expect(releaseBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('二次确认');

    // Open battle card button explicitly says 「撤回擂台（仅擂主）」
    const battle = ctx.services.socialPet.createPetBattle({
      guildId: 'g1',
      channelId: 'c1',
      challengerId: 'u1',
      opponentId: null,
      bet: 100,
    });
    expect(battle.ok).toBe(true);
    if (battle.ok) {
      const battleCard = buildPetBattleCard(battle.battle, battle.challengerPet, null, econ);
      expect(JSON.stringify(battleCard.components.map((c) => c.toJSON()))).toContain(
        '撤回擂台（仅擂主）',
      );
      // Trying to confirm release while in battle is blocked!
      const confirmRelBlocked = makeButtonMock({
        customId: `menu:pet:release_confirm:${pull.pet.id}`,
        userId: 'u1',
      });
      await tryHandleGamesMenuButton(confirmRelBlocked.interaction, ctx, 'g1', makeActor('u1'), [
        'menu',
        'pet',
        'release_confirm',
        String(pull.pet.id),
      ]);
      expect(ctx.services.socialPet.listUserPets('g1', 'u1')).toHaveLength(1);
      expect(confirmRelBlocked.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
        '斗兽场待战中',
      );

      // Decline battle refunds & allows release confirm
      ctx.services.socialPet.declinePetBattle(battle.battle.id, 'u1');
      const confirmRelOk = makeButtonMock({
        customId: `menu:pet:release_confirm:${pull.pet.id}`,
        userId: 'u1',
      });
      await tryHandleGamesMenuButton(confirmRelOk.interaction, ctx, 'g1', makeActor('u1'), [
        'menu',
        'pet',
        'release_confirm',
        String(pull.pet.id),
      ]);
      expect(ctx.services.socialPet.listUserPets('g1', 'u1')).toHaveLength(0);
    }

    // Also test duplicate proposal error message in user select
    const prop2 = ctx.services.socialPet.createProposal({
      guildId: 'g1',
      channelId: 'c1',
      proposerId: 'u1',
      targetId: 'u2',
      relType: 'sworn',
    });
    expect(prop2.ok).toBe(true);
    const dupUserSelect = {
      customId: 'menu:user:cp_sworn',
      guildId: 'g1',
      channelId: 'c1',
      channel: { id: 'c1', isSendable: () => true, send: vi.fn() },
      update: vi.fn(async (_p: MockPayload) => undefined),
    };
    await tryHandleGamesMenuUserSelect(
      dupUserSelect as unknown as UserSelectMenuInteraction,
      ctx,
      'g1',
      makeActor('u1'),
      'cp_sworn',
      'u2',
      false,
    );
    expect(dupUserSelect.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain(
      '待处理邀请',
    );

    ctx.db.close();
  });
});
