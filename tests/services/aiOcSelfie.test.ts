import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Client, Message } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { handleMessageCreate, resetAiRuntimeGuards } from '../../src/events/messageCreate.js';
import {
  AiOcPresetStore,
  compileOcSelfiePrompt,
  DEFAULT_AI_SELFIE_CONFIG,
  extractSelfieSkillTag,
  hasExplicitUserNsfwIntent,
  resolveActiveOcProfile,
  stripSelfieSkillTags,
  V5_GRAPHIC_UC,
  V5_SOLO_UC,
  V5_STICKER_UC,
  V5_WATERCOLOR_UC,
  type AiOcProfile,
} from '../../src/services/aiOcSelfie.js';
import { AiPackStore } from '../../src/services/aiPackStore.js';
import { AiService, cleanAiOutput } from '../../src/services/aiService.js';
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
import type { AppContext } from '../../src/ui/embeds.js';

const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const TINY_PNG_B64 = TINY_PNG_BYTES.toString('base64');

const SAMPLE_OC_ALPHA: AiOcProfile = {
  id: 'azure_scholar',
  name: '📘 苍蓝书院少女（测试自设A）',
  description: '短蓝发、琥珀眼、银丝眼镜、学院披肩与百褶裙',
  visualSummaryZh: '齐肩深蓝短发、琥珀色眼眸、细框银丝眼镜，身穿藏青披肩上衣、白衬衫与格纹百褶短裙',
  appearance:
    'girl, shoulder-length navy blue hair, soft bangs, bright amber eyes, thin silver-rimmed glasses, fair skin, slender figure,',
  costumePortrait: 'white collared blouse, navy ribbon tie, navy capelet over shoulders,',
  costumeUpper:
    'white collared blouse, navy ribbon tie, navy capelet over shoulders, plaid pleated mini skirt, white knee-high socks,',
  costumeFull:
    'white collared blouse, navy ribbon tie, navy capelet over shoulders, plaid pleated mini skirt, white knee-high socks, brown leather loafers,',
  silhouetteGuard: '-1.2::hoodie, baseball cap::,',
  defaultThemeHint: 'sunlit wooden classroom desk, soft afternoon window light',
};

const SAMPLE_OC_BETA: AiOcProfile = {
  id: 'amber_ranger',
  name: '🍂 琥珀林游侠（测试自设B）',
  description: '亚麻高马尾、翡翠眼、皮质肩甲与长靴',
  visualSummaryZh: '亚麻色高马尾、翡翠绿眼眸，身穿墨绿短披风、米白亚麻衬衫与深棕皮靴',
  appearance:
    'girl, long flaxen hair in high ponytail, emerald green eyes, braided side strand, fair skin, athletic slender figure,',
  costumePortrait: 'cream linen tunic collar, dark green short hooded cloak, brass clasp,',
  costumeUpper:
    'cream linen tunic, dark green short hooded cloak, brown leather belt with pouches, dark shorts,',
  costumeFull:
    'cream linen tunic, dark green short hooded cloak, brown leather belt with pouches, dark shorts, knee-high brown leather boots,',
  silhouetteGuard: '-1.2::modern jacket, sneakers::,',
  defaultThemeHint: 'sun-dappled pine forest clearing, warm golden breeze',
};

function createFullCtx(params: {
  llmClient: LlmClient;
  imageClient: ImageClient;
  packStore?: AiPackStore;
}): AppContext {
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
  const imageService = new ImageService(guildConfig, imageRepo, params.imageClient);
  const aiService = new AiService(
    guildConfig,
    aiMemory,
    params.llmClient,
    fetch,
    params.packStore,
    () => imageService.isConfigured(),
    'Asia/Shanghai',
  );

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
      blackjack: new BlackjackManager(db, profile, undefined, creditLoan),
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
      multiplayer: new MultiplayerService(db, profile, redPacket, chaos, undefined, creditLoan),
      chaos: new ChaosService(db, guildConfig, profile, chaos, creditLoan),
      worldEvent: new WorldEventService(
        db,
        guildConfig,
        profile,
        worldEvent,
        socialPet,
        creditLoan,
      ),
      socialPet: new SocialPetService(
        db,
        guildConfig,
        profile,
        shop,
        socialPet,
        'Asia/Shanghai',
        creditLoan,
      ),
      ai: aiService,
      image: imageService,
      creditLoan,
      rpg,
    },
  };
}

describe('OC Selfie Library & NovelAI V5 Pipeline SOP Compiler', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    resetAiRuntimeGuards();
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('loads private OC presets from external JSON store with mtime hot-reload and falls back cleanly to custom OC', () => {
    expect(DEFAULT_AI_SELFIE_CONFIG.enabled).toBe(true);
    expect(DEFAULT_AI_SELFIE_CONFIG.ocPreset).toBe('auto');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-presets-'));
    tempDirs.push(tmpDir);
    const presetFile = path.join(tmpDir, 'oc-presets.json');

    // Missing file returns empty list and resolves cleanly to custom OC
    const store = new AiOcPresetStore(presetFile);
    expect(store.listProfiles()).toEqual([]);
    const fallbackResolved = resolveActiveOcProfile(DEFAULT_AI_SELFIE_CONFIG, store.listProfiles());
    expect(fallbackResolved.id).toBe('custom');
    expect(fallbackResolved.appearance.startsWith('girl,')).toBe(true);

    // Writing external preset file loads & normalizes profiles dynamically
    fs.writeFileSync(
      presetFile,
      JSON.stringify({
        schemaVersion: 1,
        profiles: [
          {
            ...SAMPLE_OC_ALPHA,
            appearance: `1girl, ${SAMPLE_OC_ALPHA.appearance}`,
          },
          SAMPLE_OC_BETA,
        ],
      }),
      'utf8',
    );
    const loaded = store.listProfiles();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.id).toBe('azure_scholar');
    expect(loaded[0]?.appearance.startsWith('girl,')).toBe(true);
    expect(loaded[0]?.appearance).not.toMatch(/\b1girl\b/i);

    // 'auto' picks first external profile; explicit ID picks matching profile
    const autoResolved = resolveActiveOcProfile(DEFAULT_AI_SELFIE_CONFIG, loaded);
    expect(autoResolved.id).toBe('azure_scholar');

    const betaResolved = resolveActiveOcProfile(
      { ...DEFAULT_AI_SELFIE_CONFIG, ocPreset: 'amber_ranger' },
      loaded,
    );
    expect(betaResolved.id).toBe('amber_ranger');

    // Explicit custom normalizes count tag and fills missing upper/full tiers
    const customResolved = resolveActiveOcProfile(
      {
        ...DEFAULT_AI_SELFIE_CONFIG,
        ocPreset: 'custom',
        customOc: {
          name: '测试自设',
          appearance: '1girl, short black hair, golden eyes',
          costumePortrait: 'black turtleneck collar',
          costumeUpper: '',
          costumeFull: '',
          silhouetteGuard: '-1.2::hat::,',
        },
      },
      loaded,
    );
    expect(customResolved.id).toBe('custom');
    expect(customResolved.appearance.startsWith('girl,')).toBe(true);
    expect(customResolved.appearance).not.toMatch(/\b1girl\b/i);
    expect(customResolved.costumeUpper).toBe('black turtleneck collar,');
    expect(customResolved.costumeFull).toBe('black turtleneck collar,');
  });

  it('extracts and strips [SELFIE: {...}] tags cleanly including multiline JSON and nested brackets', () => {
    const raw = [
      '刚泡好茶你就来要照片，拿去看吧',
      '[SELFIE: {',
      '  "framing": "upper",',
      '  "aspect": "3:2",',
      '  "style": "anime",',
      '  "scene": "sunlit wooden veranda, ceramic teacup, rising steam",',
      '  "action": "sitting on veranda edge, holding cup with both hands, relaxed smile, looking at viewer",',
      '  "sentence": "The girl sits on a sunlit wooden veranda holding a warm ceramic teacup."',
      '}]',
    ].join('\n');

    const extracted = extractSelfieSkillTag(raw);
    expect(extracted).toEqual({
      framing: 'upper',
      aspect: '3:2',
      style: 'anime',
      scene: 'sunlit wooden veranda, ceramic teacup, rising steam',
      action:
        'sitting on veranda edge, holding cup with both hands, relaxed smile, looking at viewer',
      sentence: 'The girl sits on a sunlit wooden veranda holding a warm ceramic teacup.',
      nsfw: false,
    });

    const cleaned = cleanAiOutput(raw, '白虎姬');
    expect(cleaned).toBe('刚泡好茶你就来要照片，拿去看吧');
    expect(stripSelfieSkillTags(raw)).not.toContain('SELFIE');
  });

  it('compiles framing-matched costume tiers, UC presets, animal ear guards, impasto anti-doll guard, and sticker pack rules', () => {
    const oc = SAMPLE_OC_ALPHA;

    // 1. Portrait shot -> OC_COSTUME_PORTRAIT + 1:1 + V5_SOLO_UC
    const portrait = compileOcSelfiePrompt({
      oc,
      spec: {
        framing: 'portrait',
        scene: 'falling petals, sunlit window',
        action: 'head tilt, hand on own cheek, open mouth smile, blush, looking at viewer',
        sentence: 'The girl tilts her head gently while smiling warmly at the viewer.',
      },
      userContent: '发张自拍看看',
      allowNsfw: true,
    });
    expect(portrait.aspectRatio).toBe('1:1');
    expect(portrait.steps).toBe(28);
    expect(portrait.scale).toBe(5.0);
    expect(portrait.cfgRescale).toBe(0);
    expect(portrait.spoiler).toBe(false);
    expect(portrait.prompt.startsWith('1girl, solo,')).toBe(true);
    expect(portrait.prompt).not.toContain('nsfw');
    expect(portrait.prompt).toContain('portrait, close-up, upper body');
    expect(portrait.prompt).toContain('-1.2::hoodie, baseball cap::');
    expect(portrait.charCaptions).toHaveLength(1);
    expect(portrait.charCaptions[0]?.char_caption).toBe(`${oc.appearance}\n${oc.costumePortrait}`);
    expect(portrait.negativePrompt).toBe(V5_SOLO_UC);

    // 2. Full body with animal -> OC_COSTUME_FULL + omit solo + animal ear/tail guard + cropped feet guard
    const catFull = compileOcSelfiePrompt({
      oc,
      spec: {
        framing: 'full',
        aspect: '2:3',
        animal: 'fluffy calico cat',
        scene: 'stone garden path, warm afternoon sunlight',
        action: 'squatting, reaching one hand out to pet cat, tender smile',
      },
      userContent: '拍张你在院子里撸猫的全身照',
      allowNsfw: true,
    });
    expect(catFull.aspectRatio).toBe('2:3');
    expect(catFull.prompt.startsWith('1girl, fluffy calico cat,')).toBe(true);
    expect(catFull.prompt).not.toMatch(/\bsolo\b/);
    expect(catFull.prompt).toContain('cat ears on girl');
    expect(catFull.prompt).toContain('animal ears on girl');
    expect(catFull.prompt).toContain('tail on girl');
    expect(catFull.prompt).toContain('cropped feet');
    expect(catFull.charCaptions[0]?.char_caption).toBe(`${oc.appearance}\n${oc.costumeFull}`);

    // 3. Impasto style -> mandatory anti-Western-doll guard
    const impasto = compileOcSelfiePrompt({
      oc,
      spec: {
        framing: 'upper',
        style: 'impasto',
        scene: 'antique brass lantern, dark wooden hall',
        action: 'standing, slight smile, looking at viewer',
      },
      userContent: '画一张厚涂油画风的你',
      allowNsfw: true,
    });
    expect(impasto.prompt).toContain('thick impasto highlights');
    expect(impasto.prompt).toContain(
      '-2.0::realistic, photorealistic, western oil portrait, nosebleed, realistic nose, 3d, doll::',
    );
    expect(impasto.negativePrompt).toBe(V5_SOLO_UC);

    // 4. Watercolor & Nihonga -> V5_WATERCOLOR_UC & V5_GRAPHIC_UC
    const watercolor = compileOcSelfiePrompt({
      oc,
      spec: { framing: 'upper', style: 'watercolor', scene: 'misty spring plum branch' },
      userContent: '水彩风的你',
      allowNsfw: true,
    });
    expect(watercolor.negativePrompt).toBe(V5_WATERCOLOR_UC);
    expect(watercolor.negativePrompt).not.toContain('blank page');

    const nihonga = compileOcSelfiePrompt({
      oc,
      spec: { framing: 'upper', style: 'nihonga', scene: 'gold leaf byobu screen' },
      userContent: '岩彩金箔风的你',
      allowNsfw: true,
    });
    expect(nihonga.negativePrompt).toBe(V5_GRAPHIC_UC);

    // 5. 2x2 Sticker Pack -> V5_STICKER_UC (no extra characters / multiple views in UC) + 1:1
    const stickers = compileOcSelfiePrompt({
      oc,
      spec: {
        framing: 'sticker_pack',
        action: 'waving cheerfully, pouting grumpy face, sipping tea, surprised blush',
      },
      userContent: '给我发一套你的Q版四格表情包',
      allowNsfw: true,
    });
    expect(stickers.aspectRatio).toBe('1:1');
    expect(stickers.prompt).toContain(
      'four separate die-cut chibi stickers arranged neatly in a 2x2 layout',
    );
    expect(stickers.prompt).toContain('comic panels, speech bubble');
    expect(stickers.negativePrompt).toBe(V5_STICKER_UC);
    expect(stickers.negativePrompt).not.toContain('extra characters');
    expect(stickers.negativePrompt).not.toContain('multiple views');
    expect(stickers.charCaptions[0]?.char_caption).toBe(`${oc.appearance}\n${oc.costumeUpper}`);
  });

  it('enforces dual-gate SFW default vs explicit R18 + automatic spoiler mask', () => {
    const oc = SAMPLE_OC_BETA;

    expect(hasExplicitUserNsfwIntent('发张自拍看看')).toBe(false);
    expect(hasExplicitUserNsfwIntent('来张不打码的R18涩图看看')).toBe(true);

    // Hallucinated nsfw:true on innocent user request MUST stay SFW
    const guardedSfw = compileOcSelfiePrompt({
      oc,
      spec: {
        framing: 'portrait',
        scene: 'warm candlelit library, nude, nipples',
        action: 'gentle smile',
        nsfw: true,
      },
      userContent: '发张看书的自拍',
      allowNsfw: true,
    });
    expect(guardedSfw.nsfw).toBe(false);
    expect(guardedSfw.spoiler).toBe(false);
    expect(guardedSfw.prompt).not.toContain('nsfw');
    expect(guardedSfw.prompt).not.toContain('nude');
    expect(guardedSfw.prompt).not.toContain('nipples');

    // Genuine explicit NSFW user request + allowNsfw:true -> injects uncensored R18 + auto spoiler
    const allowedR18 = compileOcSelfiePrompt({
      oc,
      spec: {
        framing: 'upper',
        scene: 'dim bedroom, warm bedside lamp',
        action: 'blushing, shy gaze, looking at viewer',
        outfit: 'open white lace lingerie, bare breasts, nipples',
        nsfw: true,
      },
      userContent: '发张R18涩图自拍看看',
      allowNsfw: true,
    });
    expect(allowedR18.nsfw).toBe(true);
    expect(allowedR18.spoiler).toBe(true);
    expect(allowedR18.prompt.startsWith('nsfw, rating:explicit, uncensored,')).toBe(true);
    expect(allowedR18.negativePrompt).toContain('mosaic censoring');
    expect(allowedR18.charCaptions[0]?.char_caption).toContain(oc.appearance);
    expect(allowedR18.charCaptions[0]?.char_caption).toContain('open white lace lingerie');
    // Custom outfit should not include default silhouetteGuard
    expect(allowedR18.prompt).not.toContain('modern jacket');

    // When allowNsfw:false -> stays SFW even if user asks for R18
    const blockedR18 = compileOcSelfiePrompt({
      oc,
      spec: {
        framing: 'upper',
        scene: 'bedroom',
        outfit: 'nude, topless',
        nsfw: true,
      },
      userContent: '发张R18涩图自拍看看',
      allowNsfw: false,
    });
    expect(blockedR18.nsfw).toBe(false);
    expect(blockedR18.prompt).not.toContain('rating:explicit');
    expect(blockedR18.charCaptions[0]?.char_caption).toBe(`${oc.appearance}\n${oc.costumeUpper}`);
  });

  it('triggers end-to-end in handleMessageCreate with external oc-presets.json across non-draw channels, applies spoiler on R18, and degrades gracefully on cooldown', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-packs-selfie-'));
    tempDirs.push(tmpDir);
    const packStore = new AiPackStore(tmpDir);
    packStore.ensureInitialized();
    fs.writeFileSync(
      path.join(tmpDir, 'oc-presets.json'),
      JSON.stringify({ schemaVersion: 1, profiles: [SAMPLE_OC_ALPHA, SAMPLE_OC_BETA] }),
      'utf8',
    );

    let llmReplyContent =
      '刚在走廊吹风，随手拍一张给你。\n[SELFIE: {"framing":"portrait","aspect":"1:1","style":"anime","scene":"sunlit courtyard, warm afternoon light","action":"head tilt, gentle smile, looking at viewer"}]';
    let capturedImageBody: Record<string, unknown> | null = null;

    const llmClient = new LlmClient(
      { baseUrl: 'https://llm.local/v1', apiKey: 'sk-llm', model: 'demo-llm', timeoutMs: 5000 },
      {
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              model: 'demo-llm',
              choices: [{ message: { content: llmReplyContent } }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      },
    );

    const imageClient = new ImageClient(
      {
        baseUrl: 'https://img.local/v1',
        apiKey: 'sk-img',
        model: 'nai/nai-diffusion-5-full',
        timeoutMs: 10_000,
        maxRetries: 0,
      },
      {
        fetchFn: async (_url, init) => {
          capturedImageBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    );

    const ctx = createFullCtx({ llmClient, imageClient, packStore });

    // Lock /draw strictly to #draw-only so we verify chat selfie STILL works in #general-chat!
    const cfg = ctx.repos.guildConfig.getOrCreate('g1');
    ctx.repos.guildConfig.updateImageGen('g1', {
      ...cfg.imageGen,
      allowedChannelIds: ['draw-only-chan'],
    });
    ctx.repos.guildConfig.updateAi('g1', {
      ...cfg.ai,
      selfie: {
        ...cfg.ai.selfie,
        enabled: true,
        cooldownSec: 60,
      },
    });

    const fakeClient = { user: { id: 'bot-1' } } as unknown as Client;
    const reply1 = vi.fn(async () => undefined);

    await handleMessageCreate(
      fakeClient,
      {
        id: 'msg-selfie-1',
        channelId: 'general-chat',
        content: '<@bot-1> 发张自拍看看',
        createdTimestamp: Date.now(),
        author: { id: 'u1', bot: false, username: 'u1' },
        member: { displayName: '群友A' },
        guild: { id: 'g1', members: { cache: new Map() } },
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
        reply: reply1,
      } as unknown as Message,
      ctx,
    );

    expect(reply1).toHaveBeenCalledTimes(1);
    const payload1 = (
      reply1.mock.calls[0] as unknown as [
        { content: string; files?: Array<{ name?: string }> },
      ]
    )[0];
    expect(payload1.content).toBe('刚在走廊吹风，随手拍一张给你。');
    expect(payload1.content).not.toContain('[SELFIE:');
    expect(payload1.files).toHaveLength(1);
    expect(payload1.files?.[0]?.name).toMatch(/^oc-selfie-\d+\.png$/);

    // Check NAI V5 payload sent to ImageClient uses external OC preset #1 (auto)
    expect(capturedImageBody?.['aspect_ratio']).toBe('1:1');
    expect(capturedImageBody?.['steps']).toBe(28);
    expect(capturedImageBody?.['scale']).toBe(5);
    expect('cfg_rescale' in (capturedImageBody ?? {})).toBe(false);
    const sentChars = capturedImageBody?.['char_captions'] as Array<{ char_caption: string }>;
    expect(sentChars).toHaveLength(1);
    expect(sentChars[0]?.char_caption).toContain('thin silver-rimmed glasses');

    // Second immediate selfie by same non-admin user hits selfie cooldown -> text still replies cleanly!
    resetAiRuntimeGuards();
    const reply2 = vi.fn(async () => undefined);
    await handleMessageCreate(
      fakeClient,
      {
        id: 'msg-selfie-2',
        channelId: 'general-chat',
        content: '<@bot-1> 再发一张自拍',
        createdTimestamp: Date.now() + 6000,
        author: { id: 'u1', bot: false, username: 'u1' },
        member: { displayName: '群友A' },
        guild: { id: 'g1', members: { cache: new Map() } },
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
        reply: reply2,
      } as unknown as Message,
      ctx,
    );
    const payload2 = (
      reply2.mock.calls[0] as unknown as [{ content: string; files?: unknown[] }]
    )[0];
    expect(payload2.content).toContain('刚在走廊吹风，随手拍一张给你。');
    expect(payload2.content).toContain('冷却');
    expect(payload2.files).toBeUndefined();

    // Explicit R18 request from another user attaches SPOILER_ prefixed / spoiler-flagged attachment
    llmReplyContent =
      '真是拿你没办法，偷偷看一眼不许外传。\n[SELFIE: {"framing":"upper","aspect":"2:3","scene":"dim bedroom, warm lamp","action":"blushing, shy gaze","outfit":"black lace lingerie, topless, nipples","nsfw":true}]';
    const reply3 = vi.fn(async () => undefined);
    await handleMessageCreate(
      fakeClient,
      {
        id: 'msg-selfie-3',
        channelId: 'general-chat',
        content: '<@bot-1> 来张R18涩图自拍看看',
        createdTimestamp: Date.now() + 12_000,
        author: { id: 'u2', bot: false, username: 'u2' },
        member: { displayName: '群友B' },
        guild: { id: 'g1', members: { cache: new Map() } },
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
        reply: reply3,
      } as unknown as Message,
      ctx,
    );
    const payload3 = (
      reply3.mock.calls[0] as unknown as [{ content: string; files?: Array<{ name?: string }> }]
    )[0];
    expect(payload3.files).toHaveLength(1);
    expect(payload3.files?.[0]?.name?.startsWith('SPOILER_')).toBe(true);

    ctx.db.close();
  });
});
