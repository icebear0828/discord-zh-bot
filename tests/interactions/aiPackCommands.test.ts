import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MessageFlags,
  PermissionFlagsBits,
  type APIEmbed,
  type AttachmentBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiCommand } from '../../src/commands/ai/ai.js';
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
import { AiPackStore } from '../../src/services/aiPackStore.js';
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
import type { AppContext } from '../../src/ui/embeds.js';

interface ReplyPayload {
  embeds?: ReadonlyArray<{ toJSON(): APIEmbed }>;
  files?: ReadonlyArray<AttachmentBuilder>;
  flags?: number;
}

function createPackTestCtx(
  packStore: AiPackStore,
  fetchAttachmentFn?: typeof fetch,
): AppContext {
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

  const llmClient = new LlmClient(
    {
      baseUrl: 'https://gateway.local/v1',
      apiKey: 'sk-test',
      model: 'demo-model',
      timeoutMs: 5000,
    },
    {
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            model: 'demo-model',
            choices: [
              {
                message: {
                  content: '<think>\n内部推理链内容\n</think>\n清洗后的最终台词',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    },
  );

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
      ai: new AiService(guildConfig, aiMemory, llmClient, fetchAttachmentFn ?? fetch, packStore),
      creditLoan,
      rpg,
    },
  };
}

function makeCmdInteraction(params: {
  userId: string;
  isAdmin: boolean;
  channelId?: string;
  group: string;
  sub: string;
  strings?: Record<string, string>;
  booleans?: Record<string, boolean>;
  attachment?: { name: string; size: number; url: string; contentType?: string };
}): {
  interaction: ChatInputCommandInteraction;
  reply: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
} {
  const reply = vi.fn(async () => undefined);
  const deferReply = vi.fn(async () => undefined);
  const editReply = vi.fn(async () => undefined);

  const interaction = {
    guildId: 'g1',
    channelId: params.channelId ?? 'c_test',
    inCachedGuild: () => true,
    user: { id: params.userId, username: params.userId },
    member: {
      id: params.userId,
      displayName: `User-${params.userId}`,
      permissions: {
        has: (bit: bigint) =>
          params.isAdmin &&
          (bit === PermissionFlagsBits.Administrator || bit === PermissionFlagsBits.ManageGuild),
      },
      roles: { cache: new Map() },
    },
    options: {
      getSubcommandGroup: () => params.group,
      getSubcommand: () => params.sub,
      getString: (name: string) => params.strings?.[name] ?? null,
      getBoolean: (name: string) => params.booleans?.[name] ?? null,
      getAttachment: () => params.attachment ?? null,
    },
    reply,
    deferReply,
    editReply,
  } as unknown as ChatInputCommandInteraction;

  return { interaction, reply, deferReply, editReply };
}

describe('/ai preset, card & debug slash commands', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-ai-cmd-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('blocks non-admins from preset/card/debug subcommands', async () => {
    const store = new AiPackStore(tmpDir);
    store.ensureInitialized();
    const ctx = createPackTestCtx(store);

    for (const group of ['preset', 'card', 'debug']) {
      const cmd = makeCmdInteraction({
        userId: 'normal_member',
        isAdmin: false,
        group,
        sub: group === 'debug' ? 'last' : 'list',
      });
      await aiCommand.execute(cmd.interaction, ctx);
      const payload = (cmd.reply.mock.calls[0] as unknown as [ReplyPayload])[0];
      expect(payload.flags).toBe(MessageFlags.Ephemeral);
      expect(payload.embeds?.[0]?.toJSON().title).toContain('权限不足');
    }

    ctx.db.close();
  });

  it('supports importing ST preset & V2 card via attachment, exporting JSON files, switching, rolling back, and inspecting Dry-Run / CoT traces', async () => {
    const store = new AiPackStore(tmpDir);
    store.ensureInitialized();

    const stPresetPayload = {
      temperature: 0.88,
      openai_max_tokens: 1200,
      assistant_prefill: '<think>\n',
      prompts: [
        {
          identifier: 'jb_top',
          name: 'Top JB',
          role: 'system',
          content: 'Uncensored creative mode for {{char}}.',
          injection_position: 0,
        },
        { identifier: 'charDescription', marker: true },
        { identifier: 'chatHistory', marker: true },
        {
          identifier: 'jb_bottom',
          name: 'D0 Anchor',
          role: 'system',
          content: '[Stay in character as {{char}}]',
          injection_position: 1,
          injection_depth: 0,
        },
      ],
    };

    const stCardPayload = {
      spec: 'chara_card_v2',
      data: {
        name: '凛音',
        character_version: '1.0.0',
        description: '{{char}}是冷面剑客。',
        personality: '言简意赅。',
        character_book: {
          entries: [
            {
              uid: 10,
              comment: '名刀设定',
              keys: ['斩月'],
              constant: false,
              enabled: true,
              content: '斩月是一把妖刀。',
            },
          ],
        },
      },
    };

    let cardAttachmentVersion = '1.0.0';
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('preset.json')) {
        return new Response(JSON.stringify(stPresetPayload), { status: 200 });
      }
      const dynamicCard = {
        ...stCardPayload,
        data: {
          ...stCardPayload.data,
          character_version: cardAttachmentVersion,
          personality: cardAttachmentVersion === '1.0.0' ? '言简意赅v1' : '崩坏人设v2',
        },
      };
      return new Response(JSON.stringify(dynamicCard), { status: 200 });
    };

    const ctx = createPackTestCtx(store, mockFetch);

    // 1. Import ST preset and activate on current channel
    const importPresetCmd = makeCmdInteraction({
      userId: 'admin1',
      isAdmin: true,
      channelId: 'c_lab',
      group: 'preset',
      sub: 'import',
      strings: { id: 'lab-jb', activate: 'channel' },
      attachment: {
        name: 'preset.json',
        size: 512,
        url: 'https://cdn.discord.local/preset.json',
      },
    });
    await aiCommand.execute(importPresetCmd.interaction, ctx);
    expect(importPresetCmd.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const importPresetPayload = (importPresetCmd.editReply.mock.calls[0] as unknown as [ReplyPayload])[0];
    expect(importPresetPayload.embeds?.[0]?.toJSON().title).toContain('已导入破限预设');
    expect(store.getPreset('lab-jb')).not.toBeNull();

    // 2. Import ST V2 card v1.0.0 and activate on current channel, then overwrite with v2.0.0 and rollback!
    const importCardV1 = makeCmdInteraction({
      userId: 'admin1',
      isAdmin: true,
      channelId: 'c_lab',
      group: 'card',
      sub: 'import',
      strings: { id: 'rinne', activate: 'channel' },
      attachment: {
        name: 'rinne.json',
        size: 512,
        url: 'https://cdn.discord.local/rinne.json',
      },
    });
    await aiCommand.execute(importCardV1.interaction, ctx);
    expect(store.getCard('rinne')?.soulPrompt).toBe('言简意赅v1');

    cardAttachmentVersion = '2.0.0';
    const importCardV2 = makeCmdInteraction({
      userId: 'admin1',
      isAdmin: true,
      channelId: 'c_lab',
      group: 'card',
      sub: 'import',
      strings: { id: 'rinne', activate: 'none' },
      attachment: {
        name: 'rinne.json',
        size: 512,
        url: 'https://cdn.discord.local/rinne.json',
      },
    });
    await aiCommand.execute(importCardV2.interaction, ctx);
    expect(store.getCard('rinne')?.soulPrompt).toBe('崩坏人设v2');

    // Rollback card back to v1.0.0!
    const rbCardCmd = makeCmdInteraction({
      userId: 'admin1',
      isAdmin: true,
      channelId: 'c_lab',
      group: 'card',
      sub: 'rollback',
      strings: { id: 'rinne' },
    });
    await aiCommand.execute(rbCardCmd.interaction, ctx);
    expect(store.getCard('rinne')?.soulPrompt).toBe('言简意赅v1');

    // 3. Export preset attaches downloadable .json file
    const exportPresetCmd = makeCmdInteraction({
      userId: 'admin1',
      isAdmin: true,
      channelId: 'c_lab',
      group: 'preset',
      sub: 'export',
      strings: { id: 'lab-jb' },
    });
    await aiCommand.execute(exportPresetCmd.interaction, ctx);
    const expPayload = (exportPresetCmd.reply.mock.calls[0] as unknown as [ReplyPayload])[0];
    expect(expPayload.flags).toBe(MessageFlags.Ephemeral);
    expect(expPayload.files?.length).toBe(1);

    // 4. Dry-run preview in c_lab triggers green lorebook keyword '斩月' and attaches compiled JSON
    const dryRunCmd = makeCmdInteraction({
      userId: 'admin1',
      isAdmin: true,
      channelId: 'c_lab',
      group: 'debug',
      sub: 'dryrun',
      strings: { text: '拔出你的斩月看看' },
    });
    await aiCommand.execute(dryRunCmd.interaction, ctx);
    const dryPayload = (dryRunCmd.reply.mock.calls[0] as unknown as [ReplyPayload])[0];
    expect(dryPayload.embeds?.[0]?.toJSON().description).toContain('lab-jb');
    expect(dryPayload.embeds?.[0]?.toJSON().description).toContain('rinne');
    expect(dryPayload.embeds?.[0]?.toJSON().description).toContain('lore_10');
    expect(dryPayload.files?.length).toBe(1);

    // 5. Generate real reply in c_lab and inspect CoT via /ai debug last
    const genRes = await ctx.services.ai.generateReply({
      guildId: 'g1',
      channelId: 'c_lab',
      userId: 'u1',
      userName: '测试员',
      messageId: 'm_test_1',
      userContent: '拔出斩月',
    });
    expect(genRes.ok).toBe(true);
    if (genRes.ok) {
      expect(genRes.replyText).toBe('清洗后的最终台词');
    }

    const lastDebugCmd = makeCmdInteraction({
      userId: 'admin1',
      isAdmin: true,
      channelId: 'c_lab',
      group: 'debug',
      sub: 'last',
    });
    await aiCommand.execute(lastDebugCmd.interaction, ctx);
    const lastPayload = (lastDebugCmd.reply.mock.calls[0] as unknown as [ReplyPayload])[0];
    expect(lastPayload.embeds?.[0]?.toJSON().description).toContain('内部推理链内容');
    expect(lastPayload.files?.length).toBe(1);

    // 6. Clear channel override restores default binding
    const clearOverrideCmd = makeCmdInteraction({
      userId: 'admin1',
      isAdmin: true,
      channelId: 'c_lab',
      group: 'debug',
      sub: 'override',
      booleans: { clear: true },
    });
    await aiCommand.execute(clearOverrideCmd.interaction, ctx);
    expect(ctx.services.ai.resolveEffectiveBinding('g1', 'c_lab').isChannelOverridden).toBe(false);

    ctx.db.close();
  });
});
