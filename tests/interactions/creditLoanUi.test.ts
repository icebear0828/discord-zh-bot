import {
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIComponentInMessageActionRow,
  type APIEmbed,
  type APIModalInteractionResponseCallbackData,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalBuilder,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creditCommand } from '../../src/commands/economy/credit.js';
import { hustleCommand } from '../../src/commands/economy/hustle.js';
import { loanCommand } from '../../src/commands/economy/loan.js';
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
import {
  buildBankLoanModal,
  buildRepayLoanModal,
  buildUsuryLoanModal,
  handleCreditLoanButton,
  handleCreditLoanModal,
  handleCreditLoanUserSelect,
} from '../../src/interactions/creditLoanHandler.js';
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
import { RpgService } from '../../src/services/rpgService.js';
import { ShopService } from '../../src/services/shopService.js';
import { SocialPetService } from '../../src/services/socialPetService.js';
import { TicketService } from '../../src/services/ticketService.js';
import { WorldEventService } from '../../src/services/worldEventService.js';
import {
  buildCreditInspectEmbed,
  buildCreditReviewTargetView,
  buildCreditView,
  buildHustleView,
  buildLoanView,
} from '../../src/ui/creditLoanMenuBuilder.js';
import type { AppContext } from '../../src/ui/embeds.js';
import type { BuiltMenuMessage, MenuActor } from '../../src/ui/menuShared.js';

const GUILD_ID = 'guild-credit-ui';
const USER_A = 'user-alpha';
const USER_B = 'user-beta';

interface MockPayload {
  content?: string;
  embeds?: ReadonlyArray<{ toJSON(): APIEmbed }>;
  components?: ReadonlyArray<{
    toJSON(): APIActionRowComponent<APIComponentInMessageActionRow>;
  }>;
  flags?: number;
}

const ACTOR_A: MenuActor = {
  id: USER_A,
  displayName: '阿强',
  avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
};

function createTestContext(): AppContext {
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
      socialPet: new SocialPetService(db, guildConfig, profile, shop, socialPet, 'Asia/Shanghai'),
      ai: new AiService(guildConfig, aiMemory, new LlmClient(undefined)),
      creditLoan,
      rpg,
    },
  };
}

function assertValidMenuLayout(msg: BuiltMenuMessage): {
  embed: APIEmbed;
  buttons: APIButtonComponentWithCustomId[];
  selectIds: string[];
} {
  expect(msg.embeds.length).toBeGreaterThanOrEqual(1);
  expect(msg.components.length).toBeGreaterThanOrEqual(1);
  expect(msg.components.length).toBeLessThanOrEqual(5);

  const buttons: APIButtonComponentWithCustomId[] = [];
  const selectIds: string[] = [];

  for (const row of msg.components) {
    const json = row.toJSON();
    expect(json.components.length).toBeGreaterThanOrEqual(1);
    expect(json.components.length).toBeLessThanOrEqual(5);
    for (const comp of json.components) {
      if (comp.type === ComponentType.Button && 'custom_id' in comp) {
        expect(comp.label).toBeTruthy();
        expect((comp.label ?? '').length).toBeLessThanOrEqual(80);
        buttons.push(comp);
      } else if ('custom_id' in comp) {
        selectIds.push(comp.custom_id);
      }
    }
  }

  return {
    embed: msg.embeds[0]!.toJSON(),
    buttons,
    selectIds,
  };
}

function assertModalLabelsValid(modal: ModalBuilder): APIModalInteractionResponseCallbackData {
  const json = modal.toJSON();
  expect(json.title.length).toBeLessThanOrEqual(45);
  expect(json.components.length).toBeGreaterThanOrEqual(1);
  expect(json.components.length).toBeLessThanOrEqual(5);
  let checkedInputs = 0;
  for (const row of json.components) {
    if (!('components' in row)) continue;
    for (const input of row.components) {
      if ('label' in input && typeof input.label === 'string') {
        expect(input.label.length).toBeGreaterThan(0);
        expect(input.label.length).toBeLessThanOrEqual(45);
        checkedInputs += 1;
      }
    }
  }
  expect(checkedInputs).toBeGreaterThan(0);
  return json;
}

function createMockButtonInteraction(options: {
  customId: string;
  userId?: string;
  channelSend?: ReturnType<typeof vi.fn>;
  channelSendable?: boolean;
}) {
  const update = vi.fn<(payload: MockPayload) => Promise<void>>().mockResolvedValue(undefined);
  const reply = vi.fn<(payload: MockPayload) => Promise<void>>().mockResolvedValue(undefined);
  const showModal = vi.fn<(modal: ModalBuilder) => Promise<void>>().mockResolvedValue(undefined);
  const send =
    options.channelSend ?? vi.fn<(payload: MockPayload) => Promise<{ id: string }>>().mockResolvedValue({ id: 'pub-msg-1' });
  const userId = options.userId ?? USER_A;

  const interaction = {
    guildId: GUILD_ID,
    channelId: 'ch-1',
    customId: options.customId,
    user: {
      id: userId,
      displayName: '阿强',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    inCachedGuild: () => false,
    channel:
      options.channelSendable === false
        ? { isSendable: () => false }
        : { isSendable: () => true, send },
    client: { channels: { fetch: vi.fn().mockResolvedValue(null) } },
    update,
    reply,
    showModal,
  } as unknown as ButtonInteraction;

  return { interaction, update, reply, showModal, send };
}

function createMockUserSelectInteraction(options: {
  customId: string;
  values: string[];
  userId?: string;
}) {
  const update = vi.fn<(payload: MockPayload) => Promise<void>>().mockResolvedValue(undefined);
  const reply = vi.fn<(payload: MockPayload) => Promise<void>>().mockResolvedValue(undefined);
  const userId = options.userId ?? USER_A;

  const interaction = {
    guildId: GUILD_ID,
    customId: options.customId,
    values: options.values,
    user: {
      id: userId,
      displayName: '阿强',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    inCachedGuild: () => false,
    update,
    reply,
  } as unknown as UserSelectMenuInteraction;

  return { interaction, update, reply };
}

function createMockModalInteraction(options: {
  customId: string;
  fields: Record<string, string>;
  userId?: string;
  fromMessage?: boolean;
}) {
  const update = vi.fn<(payload: MockPayload) => Promise<void>>().mockResolvedValue(undefined);
  const reply = vi.fn<(payload: MockPayload) => Promise<void>>().mockResolvedValue(undefined);
  const userId = options.userId ?? USER_A;
  const fromMessage = options.fromMessage ?? true;

  const interaction = {
    guildId: GUILD_ID,
    customId: options.customId,
    user: {
      id: userId,
      displayName: '阿强',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    inCachedGuild: () => false,
    isFromMessage: () => fromMessage,
    fields: {
      getTextInputValue: (id: string) => {
        if (!(id in options.fields)) {
          throw new Error(`Missing field: ${id}`);
        }
        return options.fields[id]!;
      },
    },
    update,
    reply,
  } as unknown as ModalSubmitInteraction;

  return { interaction, update, reply };
}

function createMockSlashInteraction(options: {
  userId?: string;
  targetUser?: { id: string; displayName: string; displayAvatarURL: () => string } | null;
}) {
  const reply = vi.fn<(payload: MockPayload) => Promise<void>>().mockResolvedValue(undefined);
  const userId = options.userId ?? USER_A;

  const interaction = {
    guildId: GUILD_ID,
    inCachedGuild: () => true,
    user: {
      id: userId,
      displayName: '阿强',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
    member: {
      id: userId,
      permissions: { has: (bit: bigint) => bit === PermissionFlagsBits.SendMessages },
      roles: { cache: new Map<string, unknown>() },
    },
    options: {
      getUser: (name: string) => (name === '成员' ? (options.targetUser ?? null) : null),
    },
    reply,
  } as unknown as ChatInputCommandInteraction;

  return { interaction, reply };
}

describe('Credit, Loan & Hustle UI builders, handlers and slash commands', () => {
  let ctx: AppContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.db.close();
  });

  describe('Menu builders layout and content', () => {
    it('buildCreditView renders tier perks, deadbeat alert, logs and exact buttons', () => {
      const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0);
      ctx.services.creditLoan.adjustCredit(GUILD_ID, USER_A, 150, '按期还款奖励', nowMs - 10_000);
      ctx.services.creditLoan.adjustCredit(GUILD_ID, USER_A, -20, '轻微失信记录', nowMs - 5_000);

      const view = buildCreditView(ctx, GUILD_ID, ACTOR_A, undefined, nowMs);
      const { embed, buttons } = assertValidMenuLayout(view);

      expect(embed.title).toContain('💎 优质白金');
      expect(embed.description).toContain('730 / 1000');
      expect(embed.description).toContain('打工收益倍率');
      expect(embed.description).toContain('1.2x');
      expect(embed.description).toContain('银行日息上限');
      expect(embed.description).toContain('1.5x');
      expect(embed.description).toContain('打 9 折');
      expect(embed.description).toContain('按期还款奖励');
      expect(embed.description).toContain('轻微失信记录');

      const ids = buttons.map((b) => b.custom_id);
      expect(ids).toEqual([
        'cl:nav:review:endorse',
        'cl:nav:review:report',
        'menu:nav:loan',
        'menu:rank:credit:1',
        'menu:rank:deadbeat:1',
        'menu:nav:home',
      ]);

      // Add an overdue loan and verify deadbeat warning appears
      const loanRes = ctx.services.creditLoan.takeBankLoan(GUILD_ID, USER_A, 10_000, 1, nowMs);
      expect(loanRes.ok).toBe(true);
      const overdueView = buildCreditView(ctx, GUILD_ID, ACTOR_A, undefined, nowMs + 2 * 86_400_000);
      const overdueParsed = assertValidMenuLayout(overdueView);
      expect(overdueParsed.embed.description).toContain('老赖失信警报');
      expect(overdueParsed.embed.description).toContain('10,000');
    });

    it('buildCreditReviewTargetView renders UserSelectMenu and back button for endorse & report', () => {
      const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0);
      const endorseView = buildCreditReviewTargetView(ctx, GUILD_ID, ACTOR_A, 'endorse', undefined, nowMs);
      const eParsed = assertValidMenuLayout(endorseView);
      expect(eParsed.selectIds).toContain('cl:review_user:endorse');
      expect(eParsed.buttons.map((b) => b.custom_id)).toEqual(['menu:nav:credit']);

      const reportView = buildCreditReviewTargetView(ctx, GUILD_ID, ACTOR_A, 'report', undefined, nowMs);
      const rParsed = assertValidMenuLayout(reportView);
      expect(rParsed.selectIds).toContain('cl:review_user:report');
      expect(rParsed.embed.description).toContain('-15');
    });

    it('buildLoanView stays <= 5 rows even with both bank & usury loans active', () => {
      const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0);
      const bankLoan = ctx.services.creditLoan.takeBankLoan(GUILD_ID, USER_A, 20_000, 3, nowMs);
      const usuryLoan = ctx.services.creditLoan.takeUsuryLoan(GUILD_ID, USER_A, 5_000, nowMs);
      expect(bankLoan.ok).toBe(true);
      expect(usuryLoan.ok).toBe(true);
      if (!bankLoan.ok || !usuryLoan.ok) return;

      const view = buildLoanView(ctx, GUILD_ID, ACTOR_A, undefined, nowMs + 2.5 * 86_400_000);
      const { embed, buttons } = assertValidMenuLayout(view);

      expect(view.components.length).toBe(4);
      expect(embed.description).toContain('20,000');
      expect(embed.description).toContain('5,000');
      expect(embed.description).toContain('🚨 已逾期');
      expect(embed.description).toContain('🟢 计息中');

      const ids = buttons.map((b) => b.custom_id);
      expect(ids).toContain('cl:modal:bank_loan');
      expect(ids).toContain('cl:modal:usury_loan');
      expect(ids).toContain(`cl:modal:repay:${bankLoan.loan.id}`);
      expect(ids).toContain(`cl:act:repay_full:${bankLoan.loan.id}`);
      expect(ids).toContain(`cl:modal:repay:${usuryLoan.loan.id}`);
      expect(ids).toContain(`cl:act:repay_full:${usuryLoan.loan.id}`);
      expect(ids).toContain('menu:nav:hustle');
      expect(ids).toContain('menu:nav:credit');
      expect(ids).toContain('menu:nav:bank');
      expect(ids).toContain('menu:nav:home');
    });

    it('buildHustleView shows stats, expected range, credit warning, garnish warning & cooldown disable state', () => {
      const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0);
      const loanRes = ctx.services.creditLoan.takeUsuryLoan(GUILD_ID, USER_A, 5_000, nowMs - 3 * 86_400_000);
      expect(loanRes.ok).toBe(true);

      const readyView = buildHustleView(ctx, GUILD_ID, ACTOR_A, undefined, nowMs);
      const readyParsed = assertValidMenuLayout(readyView);
      const readyBtn = readyParsed.buttons.find((b) => b.custom_id === 'cl:act:sell_butt');
      expect(readyBtn?.disabled).toBeFalsy();
      expect(readyParsed.embed.description).toContain('24,000 ~ 70,000');
      expect(readyParsed.embed.description).toContain('-5');
      expect(readyParsed.embed.description).toContain('逾期自动划扣提醒');

      const sellRes = ctx.services.creditLoan.sellButt(GUILD_ID, USER_A, nowMs, () => 0.5);
      expect(sellRes.ok).toBe(true);

      const cdView = buildHustleView(ctx, GUILD_ID, ACTOR_A, undefined, nowMs + 60_000);
      const cdParsed = assertValidMenuLayout(cdView);
      const cdBtn = cdParsed.buttons.find((b) => b.custom_id === 'cl:act:sell_butt');
      expect(cdBtn?.disabled).toBe(true);
      expect(cdParsed.buttons.map((b) => b.custom_id)).toEqual([
        'cl:act:sell_butt',
        'menu:rank:hustle:1',
        'menu:nav:loan',
        'menu:nav:home',
      ]);
    });

    it('modal builders enforce <= 45 character labels even with very long currency names', () => {
      const longCurrency = '超级无敌赛博星际黄金闪耀宇宙无敌星币币币币币币币币币币';
      const bankModal = assertModalLabelsValid(buildBankLoanModal(500, 500_000, 10, longCurrency));
      expect(bankModal.custom_id).toBe('cl:submit:bank_loan');

      const usuryModal = assertModalLabelsValid(buildUsuryLoanModal(1_000, 100_000, longCurrency));
      expect(usuryModal.custom_id).toBe('cl:submit:usury_loan');

      const repayModal = assertModalLabelsValid(buildRepayLoanModal(42, 999_999, longCurrency));
      expect(repayModal.custom_id).toBe('cl:submit:repay:42');
    });

    it('buildCreditInspectEmbed shows target score, tier, overdue debt and logs', () => {
      const nowMs = Date.UTC(2026, 4, 1, 12, 0, 0);
      ctx.services.creditLoan.adjustCredit(GUILD_ID, USER_B, -350, '严重违约', nowMs);
      const embed = buildCreditInspectEmbed(
        ctx,
        GUILD_ID,
        {
          id: USER_B,
          displayName: '老赖王',
          avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
        },
        nowMs,
      ).toJSON();

      expect(embed.title).toContain('💀 极危老赖');
      expect(embed.description).toContain('250 / 1000');
      expect(embed.description).toContain('严重违约');
    });
  });

  describe('Button, Modal & UserSelect handlers', () => {
    it('blocks all handlers cleanly when creditLoan module is disabled', async () => {
      const cfg = ctx.repos.guildConfig.getOrCreate(GUILD_ID);
      ctx.repos.guildConfig.updateModules(GUILD_ID, {
        ...cfg.modules,
        creditLoan: false,
      });

      const btn = createMockButtonInteraction({ customId: 'cl:act:sell_butt' });
      await handleCreditLoanButton(btn.interaction, ctx);
      expect(btn.reply).toHaveBeenCalledTimes(1);
      expect(btn.update).not.toHaveBeenCalled();
      expect(btn.send).not.toHaveBeenCalled();
      expect(btn.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

      const sel = createMockUserSelectInteraction({
        customId: 'cl:review_user:endorse',
        values: [USER_B],
      });
      await handleCreditLoanUserSelect(sel.interaction, ctx);
      expect(sel.reply).toHaveBeenCalledTimes(1);
      expect(sel.update).not.toHaveBeenCalled();

      const modal = createMockModalInteraction({
        customId: 'cl:submit:usury_loan',
        fields: { amount: '5000' },
      });
      await handleCreditLoanModal(modal.interaction, ctx);
      expect(modal.reply).toHaveBeenCalledTimes(1);
      expect(modal.update).not.toHaveBeenCalled();
    });

    it('handles endorse and report flows via button -> user select', async () => {
      const navBtn = createMockButtonInteraction({ customId: 'cl:nav:review:endorse' });
      await handleCreditLoanButton(navBtn.interaction, ctx);
      expect(navBtn.update).toHaveBeenCalledTimes(1);

      const endorseSel = createMockUserSelectInteraction({
        customId: 'cl:review_user:endorse',
        values: [USER_B],
      });
      await handleCreditLoanUserSelect(endorseSel.interaction, ctx);
      expect(endorseSel.update).toHaveBeenCalledTimes(1);
      expect(ctx.services.creditLoan.getCreditProfile(GUILD_ID, USER_B).account.score).toBe(610);
      expect(endorseSel.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('+10');

      // Self-report rejected cleanly without crashing
      const selfSel = createMockUserSelectInteraction({
        customId: 'cl:review_user:report',
        values: [USER_A],
      });
      await handleCreditLoanUserSelect(selfSel.interaction, ctx);
      expect(selfSel.update).toHaveBeenCalledTimes(1);
      expect(selfSel.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('不能对自己');

      // Overdue report deals -15 penalty
      const overdueUsury = ctx.services.creditLoan.takeUsuryLoan(
        GUILD_ID,
        USER_B,
        5_000,
        Date.now() - 5 * 86_400_000,
      );
      expect(overdueUsury.ok).toBe(true);
      const reportSel = createMockUserSelectInteraction({
        customId: 'cl:review_user:report',
        values: [USER_B],
        userId: 'user-gamma',
      });
      await handleCreditLoanUserSelect(reportSel.interaction, ctx);
      expect(reportSel.update).toHaveBeenCalledTimes(1);
      expect(ctx.services.creditLoan.getCreditProfile(GUILD_ID, USER_B).account.score).toBe(595);
      expect(reportSel.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('-15');
    });

    it('handles bank loan modal open + submit, usury loan, custom repay with bank fallback, and repay_full', async () => {
      // Open bank loan modal
      const bankModalBtn = createMockButtonInteraction({ customId: 'cl:modal:bank_loan' });
      await handleCreditLoanButton(bankModalBtn.interaction, ctx);
      expect(bankModalBtn.showModal).toHaveBeenCalledTimes(1);
      assertModalLabelsValid(bankModalBtn.showModal.mock.calls[0]![0]);

      // Submit invalid input
      const badBankSubmit = createMockModalInteraction({
        customId: 'cl:submit:bank_loan',
        fields: { amount: 'abc', term_days: '3' },
      });
      await handleCreditLoanModal(badBankSubmit.interaction, ctx);
      expect(badBankSubmit.update).toHaveBeenCalledTimes(1);
      expect(badBankSubmit.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('正整数');

      // Submit valid bank loan
      const okBankSubmit = createMockModalInteraction({
        customId: 'cl:submit:bank_loan',
        fields: { amount: '10000', term_days: '3' },
      });
      await handleCreditLoanModal(okBankSubmit.interaction, ctx);
      expect(okBankSubmit.update).toHaveBeenCalledTimes(1);
      expect(okBankSubmit.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('放款成功');

      const loans = ctx.services.creditLoan.listUserLoans(GUILD_ID, USER_A);
      expect(loans).toHaveLength(1);
      const bankLoanId = loans[0]!.id;

      // Move 6,000 to bank so pocket has 4,000 and bank has 6,000
      const prof = ctx.repos.profile.getOrCreate(GUILD_ID, USER_A);
      ctx.repos.profile.save({ ...prof, coins: 4_000, bankCoins: 6_000 });

      // Open custom repay modal
      const repayModalBtn = createMockButtonInteraction({
        customId: `cl:modal:repay:${bankLoanId}`,
      });
      await handleCreditLoanButton(repayModalBtn.interaction, ctx);
      expect(repayModalBtn.showModal).toHaveBeenCalledTimes(1);
      assertModalLabelsValid(repayModalBtn.showModal.mock.calls[0]![0]);

      // Partial repay 2,000 from pocket (use_bank = 否)
      const partialRepay = createMockModalInteraction({
        customId: `cl:submit:repay:${bankLoanId}`,
        fields: { amount: '2000', use_bank: '否' },
      });
      await handleCreditLoanModal(partialRepay.interaction, ctx);
      expect(partialRepay.update).toHaveBeenCalledTimes(1);
      expect(ctx.repos.profile.getOrCreate(GUILD_ID, USER_A).coins).toBe(2_000);
      expect(ctx.repos.profile.getOrCreate(GUILD_ID, USER_A).bankCoins).toBe(6_000);

      // One-click full repay pulls remaining 2,000 pocket + 6,000 bank and awards on-time credit bonus
      const fullRepayBtn = createMockButtonInteraction({
        customId: `cl:act:repay_full:${bankLoanId}`,
      });
      await handleCreditLoanButton(fullRepayBtn.interaction, ctx);
      expect(fullRepayBtn.update).toHaveBeenCalledTimes(1);
      const fullDesc = fullRepayBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description ?? '';
      expect(fullDesc).toContain('贷款已全额结清');
      expect(fullDesc).toContain('奖励信用分');
      expect(ctx.services.creditLoan.listUserLoans(GUILD_ID, USER_A)).toHaveLength(0);
      expect(ctx.services.creditLoan.getCreditProfile(GUILD_ID, USER_A).account.score).toBeGreaterThan(600);

      // Usury loan open + submit + insufficient repay_full error
      const usuryModalBtn = createMockButtonInteraction({ customId: 'cl:modal:usury_loan' });
      await handleCreditLoanButton(usuryModalBtn.interaction, ctx);
      expect(usuryModalBtn.showModal).toHaveBeenCalledTimes(1);

      const usurySubmit = createMockModalInteraction({
        customId: 'cl:submit:usury_loan',
        fields: { amount: '5000' },
      });
      await handleCreditLoanModal(usurySubmit.interaction, ctx);
      expect(usurySubmit.update).toHaveBeenCalledTimes(1);
      expect(usurySubmit.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('黑市高利贷');

      const usuryLoanId = ctx.services.creditLoan.listUserLoans(GUILD_ID, USER_A)[0]!.id;
      const broke = ctx.repos.profile.getOrCreate(GUILD_ID, USER_A);
      ctx.repos.profile.save({ ...broke, coins: 100, bankCoins: 0 });

      const failedFullBtn = createMockButtonInteraction({
        customId: `cl:act:repay_full:${usuryLoanId}`,
      });
      await handleCreditLoanButton(failedFullBtn.interaction, ctx);
      expect(failedFullBtn.update).toHaveBeenCalledTimes(1);
      expect(failedFullBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('余额不足');
    });

    it('cl:act:sell_butt updates ephemeral panel first, broadcasts public embed, handles cooldown & channel failure safely', async () => {
      const order: string[] = [];
      const btn = createMockButtonInteraction({
        customId: 'cl:act:sell_butt',
        channelSend: vi.fn().mockImplementation(async () => {
          order.push('public_send');
          return { id: 'pub-1' };
        }),
      });
      btn.update.mockImplementation(async () => {
        order.push('ephemeral_update');
      });

      await handleCreditLoanButton(btn.interaction, ctx);
      expect(order).toEqual(['ephemeral_update', 'public_send']);
      expect(btn.send).toHaveBeenCalledTimes(1);
      const sentPayload = btn.send.mock.calls[0]![0] as MockPayload;
      expect(sentPayload.embeds?.[0]?.toJSON().description).toContain('【下海快报】');

      // Second click immediately hits cooldown -> ephemeral update only, NO public broadcast
      const cdBtn = createMockButtonInteraction({ customId: 'cl:act:sell_butt' });
      await handleCreditLoanButton(cdBtn.interaction, ctx);
      expect(cdBtn.update).toHaveBeenCalledTimes(1);
      expect(cdBtn.send).not.toHaveBeenCalled();
      expect(cdBtn.update.mock.calls[0]![0].embeds?.[0]?.toJSON().description).toContain('恢复体力');

      // Channel send rejection must not crash handler
      const errBtn = createMockButtonInteraction({
        customId: 'cl:act:sell_butt',
        userId: USER_B,
        channelSend: vi.fn().mockRejectedValue(new Error('Missing Permissions')),
      });
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(handleCreditLoanButton(errBtn.interaction, ctx)).resolves.toBeUndefined();
      expect(errBtn.update).toHaveBeenCalledTimes(1);
      errSpy.mockRestore();
    });

    it('cl:open:loan and cl:open:hustle_lb reply ephemerally without mutating public message', async () => {
      const openLoan = createMockButtonInteraction({ customId: 'cl:open:loan' });
      await handleCreditLoanButton(openLoan.interaction, ctx);
      expect(openLoan.reply).toHaveBeenCalledTimes(1);
      expect(openLoan.update).not.toHaveBeenCalled();
      expect(openLoan.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);

      const openLb = createMockButtonInteraction({ customId: 'cl:open:hustle_lb' });
      await handleCreditLoanButton(openLb.interaction, ctx);
      expect(openLb.reply).toHaveBeenCalledTimes(1);
      expect(openLb.update).not.toHaveBeenCalled();
      expect(openLb.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
    });
  });

  describe('Slash commands (/信用, /贷款, /卖屁股)', () => {
    it('exports valid Chinese SlashCommandBuilder metadata', () => {
      expect(creditCommand.name).toBe('信用');
      expect(loanCommand.name).toBe('贷款');
      expect(hustleCommand.name).toBe('卖屁股');

      const creditJson = creditCommand.data.toJSON() as {
        name: string;
        options?: Array<{ name: string; required?: boolean }>;
      };
      expect(creditJson.name).toBe('信用');
      expect(creditJson.options?.[0]?.name).toBe('成员');
      expect(creditJson.options?.[0]?.required).toBeFalsy();

      const loanJson = loanCommand.data.toJSON() as { name: string };
      expect(loanJson.name).toBe('贷款');

      const hustleJson = hustleCommand.data.toJSON() as { name: string };
      expect(hustleJson.name).toBe('卖屁股');
    });

    it('/信用 renders interactive self view when no target given and read-only embed when inspecting another member', async () => {
      const selfCmd = createMockSlashInteraction({});
      await creditCommand.execute(selfCmd.interaction, ctx);
      expect(selfCmd.reply).toHaveBeenCalledTimes(1);
      const selfPayload = selfCmd.reply.mock.calls[0]![0];
      expect(selfPayload.flags).toBe(MessageFlags.Ephemeral);
      expect(selfPayload.components?.length).toBe(2);

      ctx.services.creditLoan.adjustCredit(GUILD_ID, USER_B, 280, '贵族加分');
      const otherCmd = createMockSlashInteraction({
        targetUser: {
          id: USER_B,
          displayName: '金卡大佬',
          displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/2.png',
        },
      });
      await creditCommand.execute(otherCmd.interaction, ctx);
      expect(otherCmd.reply).toHaveBeenCalledTimes(1);
      const otherPayload = otherCmd.reply.mock.calls[0]![0];
      expect(otherPayload.flags).toBe(MessageFlags.Ephemeral);
      expect(otherPayload.components).toBeUndefined();
      expect(otherPayload.embeds?.[0]?.toJSON().title).toContain('👑 金卡贵族');
      expect(otherPayload.embeds?.[0]?.toJSON().description).toContain('880 / 1000');
    });

    it('/贷款 opens ephemeral loan panel and respects creditLoan module toggle', async () => {
      const okCmd = createMockSlashInteraction({});
      await loanCommand.execute(okCmd.interaction, ctx);
      expect(okCmd.reply).toHaveBeenCalledTimes(1);
      expect(okCmd.reply.mock.calls[0]![0].flags).toBe(MessageFlags.Ephemeral);
      expect(okCmd.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('银行信用贷');

      const cfg = ctx.repos.guildConfig.getOrCreate(GUILD_ID);
      ctx.repos.guildConfig.updateModules(GUILD_ID, {
        ...cfg.modules,
        creditLoan: false,
      });

      const disabledCmd = createMockSlashInteraction({});
      await loanCommand.execute(disabledCmd.interaction, ctx);
      expect(disabledCmd.reply).toHaveBeenCalledTimes(1);
      expect(disabledCmd.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('模块未开启');

      const disabledCreditCmd = createMockSlashInteraction({});
      await creditCommand.execute(disabledCreditCmd.interaction, ctx);
      expect(disabledCreditCmd.reply).toHaveBeenCalledTimes(1);
      expect(disabledCreditCmd.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('模块未开启');

      const disabledHustleCmd = createMockSlashInteraction({});
      await hustleCommand.execute(disabledHustleCmd.interaction, ctx);
      expect(disabledHustleCmd.reply).toHaveBeenCalledTimes(1);
      expect(disabledHustleCmd.reply.mock.calls[0]![0].embeds?.[0]?.toJSON().title).toContain('模块未开启');
    });

    it('/卖屁股 replies publicly with story + quick buttons, then ephemerally on cooldown', async () => {
      const firstCmd = createMockSlashInteraction({});
      await hustleCommand.execute(firstCmd.interaction, ctx);
      expect(firstCmd.reply).toHaveBeenCalledTimes(1);
      const firstPayload = firstCmd.reply.mock.calls[0]![0];
      expect(firstPayload.flags).toBeUndefined();
      expect(firstPayload.embeds?.[0]?.toJSON().description).toContain('【下海快报】');
      expect(firstPayload.components?.length).toBe(1);

      const secondCmd = createMockSlashInteraction({});
      await hustleCommand.execute(secondCmd.interaction, ctx);
      expect(secondCmd.reply).toHaveBeenCalledTimes(1);
      const secondPayload = secondCmd.reply.mock.calls[0]![0];
      expect(secondPayload.flags).toBe(MessageFlags.Ephemeral);
      expect(secondPayload.embeds?.[0]?.toJSON().title).toContain('体力恢复中');
      expect(secondPayload.embeds?.[0]?.toJSON().description).toContain('累计营业 **1** 次');
    });
  });
});
