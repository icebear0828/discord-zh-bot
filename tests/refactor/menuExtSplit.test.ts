import type {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  Guild,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
} from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CREDIT_LOAN_CONFIG,
  DEFAULT_GAMES_CONFIG,
  DEFAULT_LEVELING_CONFIG,
  DEFAULT_RPG_CONFIG,
} from '../../src/config/defaults.js';
import { SHOP_MYSTERY_BOX_MIN_PRICE } from '../../src/config/economyConstants.js';
import type { AppContext } from '../../src/core/context.js';
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
  DEFAULT_LEVELING_CONFIG as EXPORTED_DEFAULT_LEVELING_CONFIG,
  tryHandleConfigMenuButton,
  tryHandleConfigMenuChannelSelect,
  tryHandleConfigMenuModal,
  tryHandleConfigMenuRoleSelect,
  tryHandleConfigMenuStringSelect,
} from '../../src/interactions/configMenuHandler.js';
import {
  buildAddRoleOptionModal,
  buildCreateRolePanelModal,
  buildCreditLoanConfigModal,
  buildEditCardModal,
  buildHustleConfigModal,
  buildLevelMsgModal,
  buildLevelRewardAddModal,
  buildRpgConfigModal,
} from '../../src/interactions/configMenu/configModalBuilders.js';
import {
  buildShopCreateModal,
  buildShopRoleModal,
} from '../../src/interactions/configMenu/configShopModalBuilders.js';
import {
  tryHandleGamesMenuButton,
  tryHandleGamesMenuModal,
  tryHandleGamesMenuStringSelect,
  tryHandleGamesMenuUserSelect,
} from '../../src/interactions/gamesMenuHandler.js';
import { isValidPropKey } from '../../src/interactions/gamesMenu/gamesLaunchHelpers.js';
import {
  buildAdminBountyModal,
  buildAdminEventsModal,
  buildAdminPetsCpModal,
  buildAdminPropsModal,
  buildCreatePredictionModal,
  buildNumberBombModal,
  buildPetOpenBattleModal,
  buildPetRenameModal,
  buildRouletteModal,
  buildTextModal,
} from '../../src/interactions/gamesMenu/gamesModalBuilders.js';
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
import type { MenuActor } from '../../src/ui/menuShared.js';

interface MockPayload {
  embeds?: Array<{ toJSON(): { title?: string; description?: string } }>;
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
  const creditLoan = new CreditLoanRepo(db);
  const duel = new DuelRepo(db);
  const monitor = new MonitorRepo(db);
  const rpg = new RpgRepo(db);

  const creditLoanSvc = new CreditLoanService(
    db,
    guildConfig,
    profile,
    creditLoan,
    'Asia/Shanghai',
    chaos,
  );
  const rpgSvc = new RpgService(db, rpg, profile, {
    timezone: 'Asia/Shanghai',
    guildConfigRepo: guildConfig,
    socialPetRepo: socialPet,
  });

  const leveling = new LevelingService(guildConfig, profile, invite, creditLoanSvc, rpgSvc);
  const economy = new EconomyService(
    db,
    guildConfig,
    profile,
    'Asia/Shanghai',
    chaos,
    creditLoanSvc,
  );
  const blackjackSvc = new BlackjackManager(db, profile, blackjack, creditLoanSvc);
  const shopSvc = new ShopService(db, profile, shop, {
    guildConfigRepo: guildConfig,
    chaosRepo: chaos,
    socialPetRepo: socialPet,
    creditLoanService: creditLoanSvc,
    rpgRepo: rpg,
    timezone: 'Asia/Shanghai',
  });
  const funSvc = new FunService(db, profile, shop, fun, 'Asia/Shanghai');
  const ticketSvc = new TicketService(guildConfig, ticket);
  const giveawaySvc = new GiveawayService(giveaway);
  const inviteSvc = new InviteService(invite);
  const rolePanelSvc = new RolePanelService(rolePanel);
  const multiplayer = new MultiplayerService(db, profile, redPacket, chaos, duel, creditLoanSvc);
  const chaosSvc = new ChaosService(db, guildConfig, profile, chaos, creditLoanSvc);
  const worldEventSvc = new WorldEventService(
    db,
    guildConfig,
    profile,
    worldEvent,
    socialPet,
    creditLoanSvc,
  );
  const socialPetSvc = new SocialPetService(
    db,
    guildConfig,
    profile,
    shop,
    socialPet,
    'Asia/Shanghai',
    creditLoanSvc,
  );
  const ai = new AiService(guildConfig, aiMemory);

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
      creditLoan,
      rpg,
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
      multiplayer,
      chaos: chaosSvc,
      worldEvent: worldEventSvc,
      socialPet: socialPetSvc,
      ai,
      creditLoan: creditLoanSvc,
      rpg: rpgSvc,
    },
  };
}

const ADMIN_ACTOR: MenuActor = {
  id: 'u-admin',
  displayName: 'AdminUser',
  avatarUrl: 'https://example.com/a.png',
  isAdmin: true,
  isSuperAdmin: true,
};

const NORMAL_ACTOR: MenuActor = {
  id: 'u-user',
  displayName: 'NormalUser',
  avatarUrl: 'https://example.com/u.png',
  isAdmin: false,
  isSuperAdmin: false,
};

function makeModalInteraction(
  values: Record<string, string>,
  opts?: {
    sendable?: boolean;
    channelId?: string;
    guild?: Partial<Guild> | null;
  },
) {
  const updated: MockPayload[] = [];
  const replied: MockPayload[] = [];
  const sentMessages: unknown[] = [];

  const interaction = {
    channelId: opts?.channelId ?? 'ch-1',
    guild: opts?.guild ?? null,
    replied: false,
    deferred: false,
    isFromMessage: () => true,
    fields: {
      getTextInputValue: (id: string) => {
        if (!(id in values)) {
          throw new Error(`Missing field: ${id}`);
        }
        return values[id] ?? '';
      },
    },
    channel:
      opts?.sendable === false
        ? { isSendable: () => false }
        : {
            id: opts?.channelId ?? 'ch-1',
            isSendable: () => true,
            send: vi.fn(async (payload: unknown) => {
              sentMessages.push(payload);
              return { id: 'msg-pub-1' };
            }),
          },
    client: {
      channels: {
        cache: new Map(),
        fetch: vi.fn(async () => null),
      },
    },
    update: vi.fn(async (payload: MockPayload) => {
      updated.push(payload);
    }),
    reply: vi.fn(async (payload: MockPayload) => {
      replied.push(payload);
    }),
    followUp: vi.fn(async (payload: MockPayload) => {
      replied.push(payload);
    }),
    deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(async (payload: MockPayload) => {
      updated.push(payload);
    }),
  } as unknown as ModalSubmitInteraction;

  return { interaction, updated, replied, sentMessages };
}

function getEmbedDesc(payload: MockPayload | undefined): string {
  return payload?.embeds?.[0]?.toJSON().description ?? '';
}

describe('menuExtSplit: modal builders & truncateText(45) guard', () => {
  it('preserves DEFAULT_LEVELING_CONFIG re-export on configMenuHandler', () => {
    expect(EXPORTED_DEFAULT_LEVELING_CONFIG).toBe(DEFAULT_LEVELING_CONFIG);
  });

  it('truncates long modal title and text input label to <= 45 chars in gamesModalBuilders', () => {
    const longTitle = '这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的标题超过45字';
    const longLabel = '这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的标签超过45字';
    const modal = buildTextModal({
      customId: 'menu:modal_sub:test',
      title: longTitle,
      fieldId: 'val',
      label: longLabel,
      placeholder: 'hint',
    });
    const json = modal.toJSON();
    expect(json.title.length).toBeLessThanOrEqual(45);
    const input = json.components[0]?.components[0];
    expect(input && 'label' in input ? input.label.length : 999).toBeLessThanOrEqual(45);
  });

  it('builds all config and shop modals with valid customIds and titles <= 45 chars', () => {
    const ctx = createTestCtx();
    const guildId = 'g-modal';
    ctx.repos.guildConfig.updateLeveling(guildId, {
      ...DEFAULT_LEVELING_CONFIG,
      statName: '超长自定义数值属性名称测试长度截断',
    });

    const shopTypes = [
      'admin_shop_title',
      'admin_shop_boost',
      'admin_shop_stat',
      'admin_shop_pet',
      'admin_shop_special',
    ];
    for (const modalType of shopTypes) {
      const json = buildShopCreateModal(modalType, ctx, guildId).toJSON();
      expect(json.custom_id).toBe(`menu:modal_sub:${modalType}`);
      expect(json.title.length).toBeLessThanOrEqual(45);
      expect(json.components.length).toBeGreaterThanOrEqual(4);
    }

    expect(buildShopRoleModal('r-1', '身份组：VIP').toJSON().custom_id).toBe(
      'menu:modal_sub:admin_shop_role:r-1',
    );
    expect(
      buildEditCardModal({ cardNickname: 'A', cardTag: null, cardBio: null, cardColor: '#FF0000' })
        .toJSON()
        .custom_id,
    ).toBe('menu:modal_sub:edit_card');
    expect(buildLevelMsgModal('Title', '{user}').toJSON().custom_id).toBe(
      'menu:modal_sub:admin_lvl_msg',
    );
    expect(buildCreateRolePanelModal().toJSON().custom_id).toBe('menu:modal_sub:admin_rp_create');
    expect(buildAddRoleOptionModal(3, 'r-9', 'LOL').toJSON().custom_id).toBe(
      'menu:modal_sub:admin_rp_add:3:r-9',
    );
    expect(buildCreditLoanConfigModal(DEFAULT_CREDIT_LOAN_CONFIG).toJSON().custom_id).toBe(
      'menu:modal_sub:admin_cl_loan',
    );
    expect(buildHustleConfigModal(DEFAULT_CREDIT_LOAN_CONFIG).toJSON().custom_id).toBe(
      'menu:modal_sub:admin_cl_hustle',
    );
    expect(buildRpgConfigModal(DEFAULT_RPG_CONFIG).toJSON().custom_id).toBe(
      'menu:modal_sub:admin_rpg_cfg',
    );
    expect(buildLevelRewardAddModal('r-2').toJSON().custom_id).toBe(
      'menu:modal_sub:admin_lvl_reward_add:r-2',
    );
  });

  it('builds all games modals with expected customIds and field counts', () => {
    expect(buildCreatePredictionModal().toJSON().custom_id).toBe('menu:modal_sub:pred_create');
    expect(buildRouletteModal('金币').toJSON().custom_id).toBe('menu:modal_sub:roulette');
    expect(buildNumberBombModal('金币').toJSON().custom_id).toBe('menu:modal_sub:bomb');
    expect(buildPetRenameModal('旺财').toJSON().custom_id).toBe('menu:modal_sub:pet_rename');
    expect(buildPetOpenBattleModal('金币').toJSON().custom_id).toBe(
      'menu:modal_sub:pet_open_battle',
    );
    expect(buildAdminPropsModal(DEFAULT_GAMES_CONFIG).toJSON().components).toHaveLength(5);
    expect(buildAdminEventsModal(DEFAULT_GAMES_CONFIG).toJSON().components).toHaveLength(5);
    expect(buildAdminPetsCpModal(DEFAULT_GAMES_CONFIG).toJSON().components).toHaveLength(5);
    expect(buildAdminBountyModal(DEFAULT_GAMES_CONFIG).toJSON().components).toHaveLength(2);
    expect(isValidPropKey('trap')).toBe(true);
    expect(isValidPropKey('unknown_prop')).toBe(false);
  });
});

describe('menuExtSplit: configMenu routing & shop/system form validation', () => {
  it('returns false for unmatched configMenu routes', async () => {
    const ctx = createTestCtx();
    const { interaction } = makeModalInteraction({});

    expect(
      await tryHandleConfigMenuButton(
        interaction as unknown as ButtonInteraction,
        ctx,
        'g-1',
        ADMIN_ACTOR,
        ['menu', 'unknown_section', 'foo'],
      ),
    ).toBe(false);
    expect(
      await tryHandleConfigMenuStringSelect(
        { ...interaction, values: ['1'] } as unknown as StringSelectMenuInteraction,
        ctx,
        'g-1',
        ADMIN_ACTOR,
        ['menu', 'unknown_select'],
      ),
    ).toBe(false);
    expect(
      await tryHandleConfigMenuChannelSelect(
        { ...interaction, values: ['ch-1'] } as unknown as ChannelSelectMenuInteraction,
        ctx,
        'g-1',
        ADMIN_ACTOR,
        ['menu', 'chan', 'unknown_chan'],
      ),
    ).toBe(false);
    expect(
      await tryHandleConfigMenuRoleSelect(
        { ...interaction, values: ['r-1'], roles: new Map() } as unknown as RoleSelectMenuInteraction,
        ctx,
        'g-1',
        ADMIN_ACTOR,
        ['menu', 'role', 'unknown_role'],
      ),
    ).toBe(false);
    expect(
      await tryHandleConfigMenuModal(interaction, ctx, 'g-1', ADMIN_ACTOR, [
        'menu',
        'modal_sub',
        'unknown_modal',
      ]),
    ).toBe(false);
  });

  it('validates shop mystery box min price, stat min/max, and creates custom title item', async () => {
    const ctx = createTestCtx();
    const guildId = 'g-shop';

    const lowBox = makeModalInteraction({
      kind: '盲盒',
      name: '低价盲盒',
      price: String(SHOP_MYSTERY_BOX_MIN_PRICE - 1),
      description: '',
      stock: '',
    });
    expect(
      await tryHandleConfigMenuModal(lowBox.interaction, ctx, guildId, ADMIN_ACTOR, [
        'menu',
        'modal_sub',
        'admin_shop_special',
      ]),
    ).toBe(true);
    expect(getEmbedDesc(lowBox.updated[0])).toContain(String(SHOP_MYSTERY_BOX_MIN_PRICE));

    const badStat = makeModalInteraction({
      name: '错范围药水',
      price: '500',
      minGain: '10',
      maxGain: '5',
      description: '',
    });
    expect(
      await tryHandleConfigMenuModal(badStat.interaction, ctx, guildId, ADMIN_ACTOR, [
        'menu',
        'modal_sub',
        'admin_shop_stat',
      ]),
    ).toBe(true);
    expect(getEmbedDesc(badStat.updated[0])).toContain('不能小于最小增量');

    const okTitleTicket = makeModalInteraction({
      kind: 'custom_title',
      name: '自定义称号券',
      price: '2000',
      description: '任选称号',
      stock: '5',
    });
    expect(
      await tryHandleConfigMenuModal(okTitleTicket.interaction, ctx, guildId, ADMIN_ACTOR, [
        'menu',
        'modal_sub',
        'admin_shop_special',
      ]),
    ).toBe(true);
    expect(getEmbedDesc(okTitleTicket.updated[0])).toContain('已上架自定义称号券');
    expect(ctx.repos.shop.listItems(guildId)).toHaveLength(1);
  });

  it('rejects non-admin for admin modals and validates hustle min/max & role panel modes', async () => {
    const ctx = createTestCtx();
    const guildId = 'g-cfg';

    const denied = makeModalInteraction({
      bankLoanMaxCap: '10000',
      usuryLoanMax: '10000',
      usuryDailyRatePct: '10',
      usuryTermDays: '7',
      garnishRatePct: '30',
    });
    expect(
      await tryHandleConfigMenuModal(denied.interaction, ctx, guildId, NORMAL_ACTOR, [
        'menu',
        'modal_sub',
        'admin_cl_loan',
      ]),
    ).toBe(true);
    expect(getEmbedDesc(denied.updated[0])).toContain('权限不足');

    const badHustle = makeModalInteraction({
      hustleCooldownSec: '300',
      hustleMinMultiplier: '10',
      hustleMaxMultiplier: '5',
      hustleCreditPenalty: '5',
      dailyReviewLimit: '5',
    });
    expect(
      await tryHandleConfigMenuModal(badHustle.interaction, ctx, guildId, ADMIN_ACTOR, [
        'menu',
        'modal_sub',
        'admin_cl_hustle',
      ]),
    ).toBe(true);
    expect(getEmbedDesc(badHustle.updated[0])).toContain('上限倍率须 >= 下限倍率');

    const badRp = makeModalInteraction({
      title: '测试面板',
      description: '',
      selectionMode: 'invalid_mode',
      displayMode: '按钮',
    });
    expect(
      await tryHandleConfigMenuModal(badRp.interaction, ctx, guildId, ADMIN_ACTOR, [
        'menu',
        'modal_sub',
        'admin_rp_create',
      ]),
    ).toBe(true);
    expect(getEmbedDesc(badRp.updated[0])).toContain('选择模式无效');
  });
});

describe('menuExtSplit: gamesMenu routing, #游戏聊天 isolation & 10062 redline', () => {
  it('returns false for unmatched gamesMenu routes', async () => {
    const ctx = createTestCtx();
    const { interaction } = makeModalInteraction({});

    expect(
      await tryHandleGamesMenuButton(
        interaction as unknown as ButtonInteraction,
        ctx,
        'g-1',
        NORMAL_ACTOR,
        ['menu', 'unknown_games_sec', 'x'],
      ),
    ).toBe(false);
    expect(
      await tryHandleGamesMenuStringSelect(
        { ...interaction, values: ['1'] } as unknown as StringSelectMenuInteraction,
        ctx,
        'g-1',
        NORMAL_ACTOR,
        ['menu', 'unknown_games_sel'],
      ),
    ).toBe(false);
    expect(
      await tryHandleGamesMenuUserSelect(
        interaction as unknown as UserSelectMenuInteraction,
        ctx,
        'g-1',
        NORMAL_ACTOR,
        'unknown_user_sel',
        'u-2',
        false,
      ),
    ).toBe(false);
    expect(
      await tryHandleGamesMenuModal(interaction, ctx, 'g-1', NORMAL_ACTOR, [
        'menu',
        'modal_sub',
        'unknown_games_modal',
      ]),
    ).toBe(false);
  });

  it('never edits original card on chest already_claimed or boss cooldown (10062 protection)', async () => {
    const ctx = createTestCtx();
    const guildId = 'g-10062';

    const chest = ctx.services.worldEvent.spawnChest(guildId, 'ch-game');
    ctx.services.worldEvent.bindWorldEventMessage(chest.id, 'msg-chest', 'ch-game');
    ctx.services.worldEvent.claimChest(chest.id, NORMAL_ACTOR.id);

    const editSpy = vi.fn(async () => undefined);
    const channelMock = {
      id: 'ch-game',
      isTextBased: () => true,
      isSendable: () => true,
      messages: {
        fetch: vi.fn(async () => ({ edit: editSpy })),
      },
    };
    const btnInteraction = {
      channelId: 'ch-game',
      guild: {
        channels: {
          cache: new Map([['ch-game', channelMock]]),
        },
      },
      client: {
        channels: {
          cache: new Map([['ch-game', channelMock]]),
        },
      },
      update: vi.fn(async () => undefined),
    } as unknown as ButtonInteraction;

    await tryHandleGamesMenuButton(btnInteraction, ctx, guildId, NORMAL_ACTOR, [
      'menu',
      'world',
      'claim_chest',
      String(chest.id),
    ]);
    expect(editSpy).not.toHaveBeenCalled();

    // Expire chest so we can spawn boss and test cooldown without editing card
    ctx.repos.worldEvent.saveWorldEvent({ ...chest, status: 'expired' });
    const boss = ctx.services.worldEvent.spawnBoss(guildId, 'ch-game');
    ctx.services.worldEvent.bindWorldEventMessage(boss.id, 'msg-boss', 'ch-game');
    ctx.services.worldEvent.attackBoss(boss.id, NORMAL_ACTOR.id, 'normal');

    await tryHandleGamesMenuButton(btnInteraction, ctx, guildId, NORMAL_ACTOR, [
      'menu',
      'world',
      'boss_hit',
      String(boss.id),
      'normal',
    ]);
    expect(editSpy).not.toHaveBeenCalled();
  });

  it('isolates manual world event spawn to #游戏聊天 and refuses fallback when missing', async () => {
    const ctx = createTestCtx();
    const guildId = 'g-iso';
    const updated: MockPayload[] = [];

    const noGameChatBtn = {
      channelId: 'ch-other',
      guild: { channels: { cache: new Map() } },
      client: { channels: { cache: new Map(), fetch: vi.fn(async () => null) } },
      update: vi.fn(async (payload: MockPayload) => {
        updated.push(payload);
      }),
    } as unknown as ButtonInteraction;

    expect(
      await tryHandleGamesMenuButton(noGameChatBtn, ctx, guildId, ADMIN_ACTOR, [
        'menu',
        'world',
        'spawn_chest',
      ]),
    ).toBe(true);
    expect(getEmbedDesc(updated[0])).toContain('#游戏聊天');
    expect(ctx.services.worldEvent.listActiveWorldEvents(guildId)).toHaveLength(0);
  });

  it('validates games modal parameters for admin_events and roulette', async () => {
    const ctx = createTestCtx();
    const guildId = 'g-gmodal';

    const badEvents = makeModalInteraction({
      threshold: '30',
      cooldown: '600',
      bossHp: '1000',
      bossPool: '5000',
      chestRange: '3000-1000',
    });
    expect(
      await tryHandleGamesMenuModal(badEvents.interaction, ctx, guildId, ADMIN_ACTOR, [
        'menu',
        'modal_sub',
        'admin_events',
      ]),
    ).toBe(true);
    expect(getEmbedDesc(badEvents.updated[0])).toContain('min <= max');

    const badRoulette = makeModalInteraction({
      entryFee: '10',
      maxPlayers: '6',
    });
    expect(
      await tryHandleGamesMenuModal(badRoulette.interaction, ctx, guildId, NORMAL_ACTOR, [
        'menu',
        'modal_sub',
        'roulette',
      ]),
    ).toBe(true);
    expect(getEmbedDesc(badRoulette.updated[0])).toContain('入场费需 >= 50');
  });
});
