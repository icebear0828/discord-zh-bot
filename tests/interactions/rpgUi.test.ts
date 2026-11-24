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
import {
  RPG_CHAPTERS,
  RpgService,
  type RpgRunState,
} from '../../src/services/rpgService.js';
import { ShopService } from '../../src/services/shopService.js';
import { SocialPetService } from '../../src/services/socialPetService.js';
import { TicketService } from '../../src/services/ticketService.js';
import { WorldEventService } from '../../src/services/worldEventService.js';
import type { AppContext } from '../../src/ui/embeds.js';
import type { BuiltMenuMessage, MenuActor } from '../../src/ui/menuShared.js';
import {
  buildRpgChaptersView,
  buildRpgClassSwitchView,
  buildRpgGearView,
  buildRpgHomeView,
  buildRpgRunView,
} from '../../src/ui/rpgMenuBuilder.js';

const GUILD_ID = 'g-rpg-ui';
const USER_ID = 'u-hero-1';
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
  isSendable: () => boolean;
  send: ReturnType<typeof vi.fn<(payload: MockPayload) => Promise<{ id: string }>>>;
}

function makeMockChannel(sendable = true, failSend = false): MockChannel {
  return {
    id: 'ch-rpg-1',
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
}) {
  const userId = opts.userId ?? USER_ID;
  const channel = opts.channel ?? makeMockChannel(true);
  const update = vi.fn(async (_payload: MockPayload) => undefined);
  const reply = vi.fn(async (_payload: MockPayload) => undefined);
  const interaction = {
    customId: opts.customId,
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
    interaction: interaction as unknown as ButtonInteraction,
    update,
    reply,
    channel,
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
  const channel = opts.channel ?? makeMockChannel(true);
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

function saveCustomRun(ctx: AppContext, run: RpgRunState): void {
  ctx.repos.rpg.upsertRun({
    guildId: GUILD_ID,
    userId: USER_ID,
    chapter: run.chapter,
    floor: run.floor,
    stateJson: JSON.stringify(run),
    updatedAt: NOW,
  });
}

describe('RPG UI Builders', () => {
  it('renders newbie 4-class onboarding screen when classSelected is false', () => {
    const ctx = createTestCtx();
    const view = buildRpgHomeView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(view);

    const embed = view.embeds[0]!.toJSON();
    expect(embed.title).toContain('选择你的初始职业');
    expect(embed.description).toContain('圣殿战士');
    expect(embed.description).toContain('奥术法师');
    expect(embed.description).toContain('暗影游侠');
    expect(embed.description).toContain('辉光圣骑士');

    const ids = extractButtons(view).map((b) => b.custom_id);
    expect(ids).toEqual([
      'rpg:pick_class:warrior',
      'rpg:pick_class:mage',
      'rpg:pick_class:ranger',
      'rpg:pick_class:paladin',
      'menu:nav:home',
    ]);
  });

  it('renders hero home profile with active pet synergy, gear slots, and active run banner', () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'mage', NOW);

    // Give active pet
    ctx.repos.socialPet.createPet({
      guildId: GUILD_ID,
      ownerId: USER_ID,
      speciesKey: 'dragon_cub',
      nickname: '小火龙',
      rarity: 'SSR',
      trait: '狂暴',
      hp: 200,
      atk: 80,
      spd: 40,
      critRate: 0.2,
      isActive: true,
      createdAt: NOW,
    });

    // Equip a weapon
    const weapon = ctx.repos.rpg.createItem({
      guildId: GUILD_ID,
      userId: USER_ID,
      name: '虚空星杖',
      slot: 'weapon',
      rarity: 'epic',
      baseHp: 20,
      baseAtk: 40,
      baseDef: 5,
      baseCritBp: 500,
      enhanceLevel: 2,
      equipped: true,
      createdAt: NOW,
    });
    expect(weapon.equipped).toBe(true);

    const view = buildRpgHomeView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(view);
    const desc = view.embeds[0]!.toJSON().description ?? '';
    expect(desc).toContain('奥术法师');
    expect(desc).toContain('小火龙');
    expect(desc).toContain('虚空星杖');
    expect(desc).toContain('+2');
    expect(desc).toContain('0 / 6');
    expect(extractButtons(view).map((b) => b.custom_id)).toContain('rpg:nav:chapters');

    // Start a run and confirm banner + continue button
    const started = ctx.services.rpg.startRun(GUILD_ID, USER_ID, 1, NOW, () => 0.1);
    expect(started.ok).toBe(true);
    const viewWithRun = buildRpgHomeView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(viewWithRun);
    expect(viewWithRun.embeds[0]!.toJSON().description).toContain('进行中的地下城冒险');
    const runBtnIds = extractButtons(viewWithRun).map((b) => b.custom_id);
    expect(runBtnIds).toContain('rpg:nav:run');
    expect(runBtnIds).not.toContain('rpg:nav:chapters');
  });

  it('renders all 6 chapters with locked chapters disabled', () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'warrior', NOW);

    const view = buildRpgChaptersView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(view);
    const desc = view.embeds[0]!.toJSON().description ?? '';
    for (const ch of RPG_CHAPTERS) {
      expect(desc).toContain(ch.name);
      expect(desc).toContain(ch.boss.name);
    }

    const buttons = extractButtons(view);
    const ch1 = buttons.find((b) => b.custom_id === 'rpg:start:1');
    const ch2 = buttons.find((b) => b.custom_id === 'rpg:start:2');
    const ch6 = buttons.find((b) => b.custom_id === 'rpg:start:6');
    expect(ch1?.disabled).toBe(false);
    expect(ch2?.disabled).toBe(true);
    expect(ch6?.disabled).toBe(true);
  });

  it('renders combat, event, and floor_clear run views and falls back to home when no run exists', () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'paladin', NOW);

    // Fallback when no active run
    const fallback = buildRpgRunView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    expect(fallback.embeds[0]!.toJSON().title).toContain('勇者档案');

    // Combat phase with cooldown > 0 and potions = 0
    const baseRun: RpgRunState = {
      chapter: 1,
      floor: 2,
      phase: 'combat',
      turn: 2,
      classKey: 'paladin',
      playerHp: 110,
      playerMaxHp: 155,
      playerAtk: 25,
      playerDef: 12,
      playerCritBp: 1200,
      playerDodgeBp: 600,
      skillCooldown: 2,
      potionsLeft: 0,
      atkBuffPct: 0,
      petSynergy: null,
      enemy: {
        name: '哥布林斥候',
        emoji: '👺',
        kind: 'monster',
        hp: 45,
        maxHp: 78,
        atk: 17,
        def: 4,
        armorBreakTurns: 1,
        burnTurns: 0,
        burnDamage: 0,
      },
      event: null,
      pendingCoins: 1200,
      pendingXp: 40,
      pendingItems: [],
      logs: ['⚔️ 第 2 层遭遇 👺 **哥布林斥候**！'],
    };
    saveCustomRun(ctx, baseRun);

    const combatView = buildRpgRunView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(combatView);
    const combatButtons = extractButtons(combatView);
    expect(combatButtons.find((b) => b.custom_id === 'rpg:act:attack')?.disabled).toBe(false);
    expect(combatButtons.find((b) => b.custom_id === 'rpg:act:skill')?.disabled).toBe(true);
    expect(combatButtons.find((b) => b.custom_id === 'rpg:act:potion')?.disabled).toBe(true);
    expect(combatButtons.find((b) => b.custom_id === 'rpg:act:retreat')?.disabled).toBe(false);

    // Event phase
    saveCustomRun(ctx, {
      ...baseRun,
      phase: 'event',
      enemy: null,
      event: {
        key: 'tavern',
        title: '🍺 迷雾旅店',
        description: '地下城深处的神秘酒馆。',
        optionALabel: '豪赌一把',
        optionBLabel: '稳健痛饮',
      },
    });
    const eventView = buildRpgRunView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(eventView);
    expect(eventView.embeds[0]!.toJSON().description).toContain('迷雾旅店');
    const eventIds = extractButtons(eventView).map((b) => b.custom_id);
    expect(eventIds).toContain('rpg:act:event_a');
    expect(eventIds).toContain('rpg:act:event_b');
    expect(eventIds).toContain('rpg:act:retreat');

    // Floor-clear phase
    saveCustomRun(ctx, {
      ...baseRun,
      phase: 'floor_clear',
      enemy: null,
      event: null,
      potionsLeft: 2,
    });
    const clearView = buildRpgRunView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(clearView);
    const clearIds = extractButtons(clearView).map((b) => b.custom_id);
    expect(clearIds).toContain('rpg:act:next_floor');
    expect(clearIds).toContain('rpg:act:retreat');
  });

  it('renders gear view with <= 25 select options prioritizing equipped & legendary items', () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'ranger', NOW);

    for (let i = 0; i < 27; i++) {
      ctx.repos.rpg.createItem({
        guildId: GUILD_ID,
        userId: USER_ID,
        name: `普通装备#${i + 1}`,
        slot: 'weapon',
        rarity: 'common',
        baseHp: 5,
        baseAtk: 8,
        baseDef: 1,
        baseCritBp: 100,
        createdAt: NOW + i,
      });
    }
    const legItem = ctx.repos.rpg.createItem({
      guildId: GUILD_ID,
      userId: USER_ID,
      name: '弑神星陨弓',
      slot: 'weapon',
      rarity: 'legendary',
      baseHp: 50,
      baseAtk: 120,
      baseDef: 10,
      baseCritBp: 1500,
      enhanceLevel: 3,
      equipped: true,
      createdAt: NOW + 99,
    });

    const view = buildRpgGearView(ctx, GUILD_ID, makeActor(), legItem.id, undefined, NOW);
    assertDiscordComponentLimits(view);
    const selects = extractSelects(view);
    expect(selects).toHaveLength(1);
    expect(selects[0]!.custom_id).toBe('rpg:gear_select');
    expect(selects[0]!.options).toHaveLength(25);
    expect(selects[0]!.options[0]!.value).toBe(String(legItem.id));

    const buttons = extractButtons(view);
    expect(buttons.find((b) => b.custom_id === `rpg:gear_unequip:${legItem.id}`)).toBeDefined();
    expect(buttons.find((b) => b.custom_id === `rpg:gear_salvage:${legItem.id}`)?.disabled).toBe(
      true,
    );
  });

  it('renders class switch view with current class disabled and switch cost displayed', () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'warrior', NOW);

    const view = buildRpgClassSwitchView(ctx, GUILD_ID, makeActor(), undefined, NOW);
    assertDiscordComponentLimits(view);
    const desc = view.embeds[0]!.toJSON().description ?? '';
    expect(desc).toContain('10000');

    const buttons = extractButtons(view);
    expect(buttons.find((b) => b.custom_id === 'rpg:pick_class:warrior')?.disabled).toBe(true);
    expect(buttons.find((b) => b.custom_id === 'rpg:pick_class:mage')?.disabled).toBe(false);
  });
});

describe('RPG Interaction Handlers & Public Broadcasts', () => {
  it('blocks rpg button and select interactions cleanly when cfg.modules.rpg is disabled', async () => {
    const ctx = createTestCtx();
    const cfg = ctx.repos.guildConfig.getOrCreate(GUILD_ID);
    ctx.repos.guildConfig.updateModules(GUILD_ID, { ...cfg.modules, rpg: false });

    const btn = createButtonMock({ customId: 'rpg:nav:home' });
    await handleRpgButton(btn.interaction, ctx);
    expect(btn.reply).toHaveBeenCalledTimes(1);
    expect(btn.update).not.toHaveBeenCalled();
    expect(btn.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

    const sel = createStringSelectMock({ customId: 'rpg:gear_select', values: ['1'] });
    await handleRpgStringSelect(sel.interaction, ctx);
    expect(sel.reply).toHaveBeenCalledTimes(1);
    expect(sel.update).not.toHaveBeenCalled();
  });

  it('handles class pick, switch, stamina purchase, navigation, and gear management lifecycle', async () => {
    const ctx = createTestCtx();
    ctx.repos.profile.addCoins(GUILD_ID, USER_ID, 50_000);

    // 1. First free class selection
    const pick = createButtonMock({ customId: 'rpg:pick_class:warrior' });
    await handleRpgButton(pick.interaction, ctx);
    expect(pick.update).toHaveBeenCalledTimes(1);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.classKey).toBe('warrior');

    // 2. Paid class switch
    const sw = createButtonMock({ customId: 'rpg:pick_class:mage' });
    await handleRpgButton(sw.interaction, ctx);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)?.classKey).toBe('mage');
    expect(ctx.repos.profile.getOrCreate(GUILD_ID, USER_ID).coins).toBe(40_000);

    // 3. Buy stamina potion
    const staminaBefore = ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)!.stamina;
    const potion = createButtonMock({ customId: 'rpg:act:buy_stamina' });
    await handleRpgButton(potion.interaction, ctx);
    expect(ctx.repos.rpg.getCharacter(GUILD_ID, USER_ID)!.stamina).toBe(staminaBefore + 1);

    // 4. Nav buttons
    for (const id of ['rpg:nav:chapters', 'rpg:nav:gear', 'rpg:nav:class', 'rpg:nav:home']) {
      const nav = createButtonMock({ customId: id });
      await handleRpgButton(nav.interaction, ctx);
      expect(nav.update).toHaveBeenCalledTimes(1);
      assertDiscordComponentLimits(nav.update.mock.calls[0]![0]);
    }

    // 5. Gear select / equip / enhance / unequip / salvage
    const item = ctx.repos.rpg.createItem({
      guildId: GUILD_ID,
      userId: USER_ID,
      name: '星辉权杖',
      slot: 'weapon',
      rarity: 'rare',
      baseHp: 15,
      baseAtk: 30,
      baseDef: 3,
      baseCritBp: 400,
      createdAt: NOW,
    });

    const sel = createStringSelectMock({ customId: 'rpg:gear_select', values: [String(item.id)] });
    await handleRpgStringSelect(sel.interaction, ctx);
    expect(sel.update).toHaveBeenCalledTimes(1);

    const equipBtn = createButtonMock({ customId: `rpg:gear_equip:${item.id}` });
    await handleRpgButton(equipBtn.interaction, ctx);
    expect(ctx.repos.rpg.getItemById(item.id)?.equipped).toBe(true);

    // +0 -> +1 has 100% rate
    const enhBtn = createButtonMock({ customId: `rpg:gear_enhance:${item.id}` });
    await handleRpgButton(enhBtn.interaction, ctx);
    expect(ctx.repos.rpg.getItemById(item.id)?.enhanceLevel).toBe(1);

    const unequipBtn = createButtonMock({ customId: `rpg:gear_unequip:${item.id}` });
    await handleRpgButton(unequipBtn.interaction, ctx);
    expect(ctx.repos.rpg.getItemById(item.id)?.equipped).toBe(false);

    const salvageBtn = createButtonMock({ customId: `rpg:gear_salvage:${item.id}` });
    await handleRpgButton(salvageBtn.interaction, ctx);
    expect(ctx.repos.rpg.getItemById(item.id)).toBeNull();
  });

  it('broadcasts publicly on chapter first clear and legendary drops after updating ephemeral panel', async () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'warrior', NOW);

    // Set up a Boss encounter on floor 5 with 1 HP left and a pending legendary item
    saveCustomRun(ctx, {
      chapter: 1,
      floor: 5,
      phase: 'combat',
      turn: 1,
      classKey: 'warrior',
      playerHp: 170,
      playerMaxHp: 170,
      playerAtk: 100,
      playerDef: 20,
      playerCritBp: 1500,
      playerDodgeBp: 500,
      skillCooldown: 0,
      potionsLeft: 3,
      atkBuffPct: 0,
      petSynergy: null,
      enemy: {
        name: '哥布林酋长·格鲁克',
        emoji: '👑',
        kind: 'boss',
        hp: 1,
        maxHp: 195,
        atk: 26,
        def: 8,
        armorBreakTurns: 0,
        burnTurns: 0,
        burnDamage: 0,
        bossSkillName: '部落咆哮重击',
      },
      event: null,
      pendingCoins: 2000,
      pendingXp: 100,
      pendingItems: [
        {
          name: '晨曦裁决者',
          slot: 'weapon',
          rarity: 'legendary',
          baseHp: 40,
          baseAtk: 90,
          baseDef: 10,
          baseCritBp: 1200,
        },
      ],
      logs: ['🔥 首领降临！'],
    });

    const channel = makeMockChannel(true);
    const atkBtn = createButtonMock({ customId: 'rpg:act:attack', channel });
    await handleRpgButton(atkBtn.interaction, ctx);

    // Ephemeral panel updated to Home view with victory summary
    expect(atkBtn.update).toHaveBeenCalledTimes(1);
    expect(atkBtn.reply).not.toHaveBeenCalled();
    const updatedDesc = atkBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description ?? '';
    expect(updatedDesc).toContain('通关成功');
    expect(updatedDesc).toContain('首通双倍奖励');

    // Public celebratory broadcast fired after update
    expect(channel.send).toHaveBeenCalledTimes(1);
    const pubPayload = channel.send.mock.calls[0]![0];
    const pubEmbed = pubPayload.embeds?.[0]?.toJSON();
    expect(pubEmbed?.title).toContain('章节首通');
    expect(pubEmbed?.title).toContain('传说橙装');
    expect(pubEmbed?.description).toContain('晨曦裁决者');

    // Also verify retreat with a legendary drop triggers legendary public broadcast safely
    saveCustomRun(ctx, {
      chapter: 1,
      floor: 3,
      phase: 'floor_clear',
      turn: 1,
      classKey: 'warrior',
      playerHp: 120,
      playerMaxHp: 170,
      playerAtk: 30,
      playerDef: 15,
      playerCritBp: 1000,
      playerDodgeBp: 500,
      skillCooldown: 0,
      potionsLeft: 2,
      atkBuffPct: 0,
      petSynergy: null,
      enemy: null,
      event: null,
      pendingCoins: 1500,
      pendingXp: 80,
      pendingItems: [
        {
          name: '永恒神佑战甲',
          slot: 'armor',
          rarity: 'legendary',
          baseHp: 180,
          baseAtk: 0,
          baseDef: 35,
          baseCritBp: 0,
        },
      ],
      logs: [],
    });

    const failChannel = makeMockChannel(true, true);
    const retreatBtn = createButtonMock({ customId: 'rpg:act:retreat', channel: failChannel });
    // Even if channel.send throws 50013, handler does not reject or double-reply
    await expect(handleRpgButton(retreatBtn.interaction, ctx)).resolves.toBeUndefined();
    expect(retreatBtn.update).toHaveBeenCalledTimes(1);
    expect(retreatBtn.reply).not.toHaveBeenCalled();
    expect(failChannel.send).toHaveBeenCalledTimes(1);
  });

  it('handles defeat summary and start chapter flow cleanly', async () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'mage', NOW);

    const startBtn = createButtonMock({ customId: 'rpg:start:1' });
    await handleRpgButton(startBtn.interaction, ctx);
    expect(startBtn.update).toHaveBeenCalledTimes(1);
    expect(ctx.services.rpg.getActiveRun(GUILD_ID, USER_ID)).not.toBeNull();

    // Force lethal enemy blow
    saveCustomRun(ctx, {
      chapter: 1,
      floor: 2,
      phase: 'combat',
      turn: 1,
      classKey: 'mage',
      playerHp: 1,
      playerMaxHp: 115,
      playerAtk: 10,
      playerDef: 1,
      playerCritBp: 0,
      playerDodgeBp: 0,
      skillCooldown: 0,
      potionsLeft: 0,
      atkBuffPct: 0,
      petSynergy: null,
      enemy: {
        name: '狂暴哥布林萨满',
        emoji: '🪄',
        kind: 'elite',
        hp: 999,
        maxHp: 999,
        atk: 500,
        def: 50,
        armorBreakTurns: 0,
        burnTurns: 0,
        burnDamage: 0,
      },
      event: null,
      pendingCoins: 3000,
      pendingXp: 90,
      pendingItems: [
        {
          name: '秘银魔杖',
          slot: 'weapon',
          rarity: 'uncommon',
          baseHp: 10,
          baseAtk: 15,
          baseDef: 2,
          baseCritBp: 200,
        },
      ],
      logs: [],
    });

    const atkBtn = createButtonMock({ customId: 'rpg:act:attack' });
    await handleRpgButton(atkBtn.interaction, ctx);
    expect(atkBtn.update).toHaveBeenCalledTimes(1);
    expect(ctx.services.rpg.getActiveRun(GUILD_ID, USER_ID)).toBeNull();
    const desc = atkBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description ?? '';
    expect(desc).toContain('探险战败');
    expect(desc).toContain('3000');
  });

  it('handles combat errors (cooldown/no potions/phase mismatch), event choice, next_floor, and debt garnishing summary', async () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'paladin', NOW);

    // Combat phase with cooldown & 0 potions
    saveCustomRun(ctx, {
      chapter: 1,
      floor: 1,
      phase: 'combat',
      turn: 1,
      classKey: 'paladin',
      playerHp: 120,
      playerMaxHp: 155,
      playerAtk: 25,
      playerDef: 12,
      playerCritBp: 1200,
      playerDodgeBp: 600,
      skillCooldown: 2,
      potionsLeft: 0,
      atkBuffPct: 0,
      petSynergy: null,
      enemy: {
        name: '哥布林斥候',
        emoji: '👺',
        kind: 'monster',
        hp: 70,
        maxHp: 78,
        atk: 17,
        def: 4,
        armorBreakTurns: 0,
        burnTurns: 0,
        burnDamage: 0,
      },
      event: null,
      pendingCoins: 4000,
      pendingXp: 50,
      pendingItems: [],
      logs: [],
    });

    const cdBtn = createButtonMock({ customId: 'rpg:act:skill' });
    await handleRpgButton(cdBtn.interaction, ctx);
    expect(cdBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('冷却中');

    const potBtn = createButtonMock({ customId: 'rpg:act:potion' });
    await handleRpgButton(potBtn.interaction, ctx);
    expect(potBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('药水已经全部用完');

    const badPhase = createButtonMock({ customId: 'rpg:act:next_floor' });
    await handleRpgButton(badPhase.interaction, ctx);
    expect(badPhase.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('当前阶段无法执行');

    // Event phase -> event_b transitions to floor_clear -> next_floor advances to floor 2
    saveCustomRun(ctx, {
      chapter: 1,
      floor: 1,
      phase: 'event',
      turn: 1,
      classKey: 'paladin',
      playerHp: 100,
      playerMaxHp: 155,
      playerAtk: 25,
      playerDef: 12,
      playerCritBp: 1200,
      playerDodgeBp: 600,
      skillCooldown: 0,
      potionsLeft: 1,
      atkBuffPct: 0,
      petSynergy: null,
      enemy: null,
      event: {
        key: 'tavern',
        title: '🍺 迷雾旅店',
        description: '迷雾中的小酒馆。',
        optionALabel: '豪赌',
        optionBLabel: '痛饮麦酒',
      },
      pendingCoins: 4000,
      pendingXp: 50,
      pendingItems: [],
      logs: [],
    });

    const evBtn = createButtonMock({ customId: 'rpg:act:event_b' });
    await handleRpgButton(evBtn.interaction, ctx);
    expect(ctx.services.rpg.getActiveRun(GUILD_ID, USER_ID)?.phase).toBe('floor_clear');

    const nextBtn = createButtonMock({ customId: 'rpg:act:next_floor' });
    await handleRpgButton(nextBtn.interaction, ctx);
    expect(ctx.services.rpg.getActiveRun(GUILD_ID, USER_ID)?.floor).toBe(2);

    // Create an overdue loan to verify debt garnish appears in retreat summary
    ctx.repos.creditLoan.createLoan({
      guildId: GUILD_ID,
      userId: USER_ID,
      loanType: 'usury',
      principal: 10_000,
      dailyRate: 0.12,
      remainingPrincipal: 10_000,
      accruedInterest: 1200,
      status: 'overdue',
      termDays: 2,
      createdAt: NOW - 5 * 86_400_000,
      dueAt: NOW - 3 * 86_400_000,
      lastAccrualDate: '2026-05-14',
    });

    const retreatBtn = createButtonMock({ customId: 'rpg:act:retreat' });
    await handleRpgButton(retreatBtn.interaction, ctx);
    const retreatDesc = retreatBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description ?? '';
    expect(retreatDesc).toContain('安全撤退');
    expect(retreatDesc).toContain('自动抵扣逾期债务');
  });
});

describe('/冒险 Slash Command', () => {
  it('exposes Chinese command name 冒险 and respects module toggle', async () => {
    expect(adventureCommand.name).toBe('冒险');
    const json = adventureCommand.data.toJSON() as { name: string };
    expect(json.name).toBe('冒险');

    const ctx = createTestCtx();
    const cfg = ctx.repos.guildConfig.getOrCreate(GUILD_ID);
    ctx.repos.guildConfig.updateModules(GUILD_ID, { ...cfg.modules, rpg: false });

    const { interaction, reply } = createSlashMock();
    await adventureCommand.execute(interaction, ctx);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
    expect(reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('模块未开启');
  });

  it('replies ephemerally with home view when idle and run view when an active run exists', async () => {
    const ctx = createTestCtx();
    ctx.services.rpg.chooseOrSwitchClass(GUILD_ID, USER_ID, 'ranger', NOW);

    const idle = createSlashMock();
    await adventureCommand.execute(idle.interaction, ctx);
    expect(idle.reply).toHaveBeenCalledTimes(1);
    expect(idle.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
    expect(idle.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('暗影游侠');

    ctx.services.rpg.startRun(GUILD_ID, USER_ID, 1, NOW, () => 0.1);
    const running = createSlashMock();
    await adventureCommand.execute(running.interaction, ctx);
    expect(running.reply).toHaveBeenCalledTimes(1);
    expect(running.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
    expect(running.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('第 1 章');
  });
});
