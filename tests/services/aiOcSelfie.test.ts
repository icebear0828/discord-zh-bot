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
  buildOcSelfieSkillPrompt,
  compileOcSelfiePrompt,
  DEFAULT_AI_SELFIE_CONFIG,
  extractSelfieSkillTag,
  hasExplicitDuoIntent,
  hasExplicitUserNsfwIntent,
  listBuiltinOcPoses,
  resetPoseRotationState,
  resolveActiveOcOutfit,
  resolveActiveOcProfile,
  stripSelfieSkillTags,
  V5_GRAPHIC_UC,
  V5_SOLO_UC,
  V5_STICKER_UC,
  V5_WATERCOLOR_UC,
  type AiOcProfile,
  type OcOutfitPreset,
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
    resetPoseRotationState();
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
    expect(allowedR18.prompt.startsWith('nsfw, 1girl, solo,')).toBe(true);
    expect(allowedR18.prompt).not.toContain('rating:explicit');
    expect(allowedR18.prompt).toContain('-1.5::censored, mosaic censoring, bar censor::');
    expect(allowedR18.negativePrompt).toContain('mosaic censoring');
    expect(allowedR18.charCaptions[0]?.char_caption).toContain(oc.appearance);
    expect(allowedR18.charCaptions[0]?.char_caption).toContain('smooth dewy skin');
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

  it('provides full 288-pose catalog across 4 safety tiers, 5 camera angles, Chinese keyword hits, and anti-repeat rotation', () => {
    const poses = listBuiltinOcPoses();
    expect(poses.length).toBeGreaterThanOrEqual(288);

    const tiers = new Set(poses.map((p) => p.tier));
    expect(tiers.has('sfw')).toBe(true);
    expect(tiers.has('spicy')).toBe(true);
    expect(tiers.has('nsfw')).toBe(true);
    expect(tiers.has('duo_hug')).toBe(true);
    expect(tiers.has('duo_nsfw')).toBe(true);

    const duoCount = poses.filter((p) => p.tier === 'duo_hug' || p.tier === 'duo_nsfw').length;
    expect(duoCount).toBe(55);
    const sfwCount = poses.filter((p) => p.tier === 'sfw').length;
    expect(sfwCount).toBeGreaterThanOrEqual(98);

    // Every pose must have clean non-empty actionTags and sentence
    for (const p of poses) {
      expect(p.id).toMatch(/^[a-z0-9_]+$/);
      expect(p.actionTags.trim().length).toBeGreaterThan(3);
      expect(p.sentence.trim().length).toBeGreaterThan(8);
    }

    // Exact Chinese keyword match ("招财猫" -> paw pose) + camera angle ("high" -> from above)
    const pawShot = compileOcSelfiePrompt({
      oc: SAMPLE_OC_ALPHA,
      spec: {
        framing: 'upper',
        pose: 'cute_playful',
        angle: 'high',
        scene: 'cozy cafe table',
      },
      userContent: '对我做个招财猫猫爪手势俯拍一张',
      allowNsfw: true,
    });
    expect(pawShot.prompt).toContain('from above');
    expect(pawShot.prompt.toLowerCase()).toMatch(/paw|beckoning|cat pose/);

    // Anti-repeat rotation: consecutive shots in same cluster pick distinct pose IDs
    const seenPoseIds = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const shot = compileOcSelfiePrompt({
        oc: SAMPLE_OC_ALPHA,
        spec: {
          framing: 'upper',
          pose: 'cute_heart',
          angle: 'three_quarter',
        },
        userContent: '发张比心自拍',
        allowNsfw: true,
        rotationScopeKey: 'g1:c1',
      });
      if (shot.poseId) {
        seenPoseIds.add(shot.poseId);
      }
    }
    expect(seenPoseIds.size).toBeGreaterThanOrEqual(3);
  });

  it('strictly gates spicy, solo NSFW, duo_hug, and duo_nsfw poses and compiles NAI V5 2-character captions cleanly', () => {
    expect(hasExplicitDuoIntent('发张你的日常自拍')).toBe(false);
    expect(hasExplicitDuoIntent('拍一张从背后抱着你坐腿上的双人照')).toBe(true);

    // 1. Innocent daily request MUST reject hallucinated duo or nsfw pose IDs
    const blockedDuoOnSolo = compileOcSelfiePrompt({
      oc: SAMPLE_OC_ALPHA,
      spec: {
        framing: 'full',
        pose: 'duo_p003',
        nsfw: true,
      },
      userContent: '发张你站在窗边的全身照',
      allowNsfw: true,
    });
    expect(blockedDuoOnSolo.nsfw).toBe(false);
    expect(blockedDuoOnSolo.charCaptions).toHaveLength(1);
    expect(blockedDuoOnSolo.prompt.startsWith('1girl, solo,')).toBe(true);
    expect(blockedDuoOnSolo.negativePrompt).toContain('extra characters');

    // 1b. Persona refusal gate: user asks for couple hug, but Bot refuses in-character and picks a solo pose -> stays solo!
    const refusedDuoByPersona = compileOcSelfiePrompt({
      oc: SAMPLE_OC_ALPHA,
      spec: {
        framing: 'full',
        pose: 'stand_casual',
        nsfw: false,
      },
      userContent: '拍一张我从背后环抱你坐在膝上的双人合照',
      allowNsfw: true,
    });
    expect(refusedDuoByPersona.charCaptions).toHaveLength(1);
    expect(refusedDuoByPersona.prompt.startsWith('1girl, solo,')).toBe(true);
    expect(refusedDuoByPersona.negativePrompt).toContain('extra characters');

    // 2. Explicit non-R18 couple cuddle request -> unlocks duo_hug, faceless male Character 2, strips extra characters from UC
    const cuddleDuo = compileOcSelfiePrompt({
      oc: SAMPLE_OC_ALPHA,
      spec: {
        framing: 'full',
        pose: 'duo_cuddle',
        angle: 'three_quarter',
        scene: 'warm living room sofa, evening lamp light',
        nsfw: false,
      },
      userContent: '拍一张我从背后环抱你坐在膝上的合照',
      allowNsfw: true,
    });
    expect(cuddleDuo.nsfw).toBe(false);
    expect(cuddleDuo.charCaptions).toHaveLength(2);
    expect(cuddleDuo.charCaptions[0]?.char_caption).toContain(SAMPLE_OC_ALPHA.appearance);
    expect(cuddleDuo.charCaptions[1]?.char_caption).toContain('boy, faceless male');
    expect(cuddleDuo.prompt.startsWith('1girl, 1boy,')).toBe(true);
    expect(cuddleDuo.prompt).not.toMatch(/\bsolo\b/);
    expect(cuddleDuo.prompt).toContain('Character 1: girl,');
    expect(cuddleDuo.prompt).toContain('Character 2: boy,');
    expect(cuddleDuo.negativePrompt).not.toContain('extra characters');

    // 3. Explicit yuri/2girls couple cuddle -> switches partner to 2girls
    const yuriDuo = compileOcSelfiePrompt({
      oc: SAMPLE_OC_ALPHA,
      spec: {
        framing: 'full',
        pose: 'duo_cuddle',
      },
      userContent: '来一张双女主百合贴贴背后抱的合照',
      allowNsfw: true,
    });
    expect(yuriDuo.prompt.startsWith('2girls,')).toBe(true);
    expect(yuriDuo.charCaptions).toHaveLength(2);
    expect(yuriDuo.charCaptions[1]?.char_caption.startsWith('girl,')).toBe(true);

    // 4. Explicit Duo R18 request -> unlocks duo_nsfw + R18 prefix + spoiler + anti-censor UC without extra characters
    const nsfwDuo = compileOcSelfiePrompt({
      oc: SAMPLE_OC_ALPHA,
      spec: {
        framing: 'full',
        pose: 'duo_intimate',
        scene: 'dim bedroom, messy sheets',
        nsfw: true,
      },
      userContent: '来张和我一起骑乘位的双人R18涩图',
      allowNsfw: true,
    });
    expect(nsfwDuo.nsfw).toBe(true);
    expect(nsfwDuo.spoiler).toBe(true);
    expect(nsfwDuo.prompt.startsWith('nsfw, 1girl, 1boy,')).toBe(true);
    expect(nsfwDuo.prompt).not.toContain('rating:explicit');
    expect(nsfwDuo.prompt).toContain('censored, mosaic censoring, bar censor');
    expect(nsfwDuo.charCaptions).toHaveLength(2);
    expect(nsfwDuo.negativePrompt).not.toContain('extra characters');
    expect(nsfwDuo.negativePrompt).toContain('mosaic censoring');
  });

  it('rotates daily OOTD deterministically, excludes hidden spicy outfits from auto OOTD, decouples hair accessories, and keeps chat outfit changes per-shot only', () => {
    const wardrobeOutfits: OcOutfitPreset[] = [
      {
        id: 'sig_kimono',
        name: '🌺 招牌和风振袖',
        summaryZh: '黑金樱花露肩挂脖上衣与白色宽振袖百褶裙',
        ootdEligible: true,
        costumePortrait: 'black halter top, white detached sleeves,',
        costumeUpper: 'black halter top, white detached sleeves, pleated mini skirt,',
        costumeFull: 'black halter top, white detached sleeves, pleated mini skirt, platform sandals,',
        silhouetteGuard: '-1.2::kimono lapels covering shoulders::,',
      },
      {
        id: 'urban_beret',
        name: '🏙️ 都市针织贝雷私服',
        summaryZh: '酒红斜戴羊毛贝雷帽、米白露肩绞花毛衣与黑色高腰皮裙',
        ootdEligible: true,
        hairAccessory: 'loose wavy hair down, burgundy wool beret tilted on head, small gold hairpin,',
        costumePortrait: 'cream off-shoulder cable-knit sweater, thin black velvet choker,',
        costumeUpper: 'cream off-shoulder cable-knit sweater, high-waisted black leather mini skirt,',
        costumeFull: 'cream off-shoulder cable-knit sweater, high-waisted black leather mini skirt, black ankle boots,',
        silhouetteGuard: '-1.2::detached sleeves, kimono::,',
        keywordsZh: ['贝雷帽', '都市私服', '毛衣'],
      },
      {
        id: 'cozy_lounge',
        name: '🛋️ 居家慵懒开衫',
        summaryZh: '松散长发配软糯米杏宽松针织开衫与丝质吊带短裤',
        ootdEligible: true,
        hairAccessory: 'loose messy-soft hair down over shoulders, simple crimson ribbon hairclip,',
        costumePortrait: 'crimson silk camisole straps, oversized cream knit cardigan slipping off one shoulder,',
        costumeUpper: 'crimson silk camisole, oversized cream knit cardigan, matching silk lounge shorts,',
        costumeFull: 'crimson silk camisole, oversized cream knit cardigan, matching silk lounge shorts, bare feet,',
        silhouetteGuard: '-1.2::shoes, boots, formal dress::,',
        keywordsZh: ['居家', '睡衣', '开衫'],
      },
      {
        id: 'secret_bunny',
        name: '🐇 绯红丝绒兔女郎（隐藏款）',
        summaryZh: '黑红丝绒兔耳发箍与紧身兔女郎连体衣黑丝高跟',
        ootdEligible: false,
        hairAccessory: 'high ponytail, black-and-crimson velvet bunny ears headband,',
        costumePortrait: 'white wing collar with crimson bowtie, strapless black velvet sweetheart bodice,',
        costumeUpper: 'white wing collar with crimson bowtie, strapless black velvet bunny leotard, sheer black pantyhose,',
        costumeFull: 'white wing collar with crimson bowtie, strapless black velvet bunny leotard, fluffy white tail, sheer black pantyhose, crimson stiletto heels,',
        silhouetteGuard: '-1.2::skirt, sleeves::,',
        keywordsZh: ['兔女郎'],
      },
    ];

    const richOc: AiOcProfile = {
      ...SAMPLE_OC_ALPHA,
      id: 'crimson_test',
      baseAppearanceZh: '银白微粉长卷发、赤红眼眸、左眼泪痣',
      baseAppearance:
        'girl, very long silver-white hair, parted bangs, crimson eyes, mole under left eye, fair skin, slender figure,',
      defaultHairAccessory:
        'half updo with large black ribbon bow, heavy crimson camellia gold suzu bell hair ornament,',
      appearance:
        'girl, very long silver-white hair, parted bangs, half updo with large black ribbon bow, heavy crimson camellia gold suzu bell hair ornament, crimson eyes, mole under left eye, fair skin, slender figure,',
      outfits: wardrobeOutfits,
    };

    // Check 30 consecutive days in Asia/Shanghai: hidden outfit MUST NEVER be selected in auto OOTD,
    // and consecutive days MUST NOT wear the same outfit!
    let prevId = '';
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const ts = Date.UTC(2026, 10, 1 + dayOffset, 4, 0, 0); // 12:00 Asia/Shanghai
      const resolved = resolveActiveOcOutfit({
        oc: richOc,
        selfieCfg: DEFAULT_AI_SELFIE_CONFIG,
        nowMs: ts,
        timezone: 'Asia/Shanghai',
      });
      expect(resolved.id).not.toBe('secret_bunny');
      expect(resolved.id).not.toBe(prevId);
      prevId = resolved.id;
    }

    // Manual reroll offset shifts today's OOTD immediately
    const fixedTs = Date.UTC(2026, 10, 26, 4, 0, 0);
    const ootd0 = resolveActiveOcOutfit({
      oc: richOc,
      selfieCfg: { ...DEFAULT_AI_SELFIE_CONFIG, outfitMode: 'ootd', ootdOffset: 0 },
      nowMs: fixedTs,
      timezone: 'Asia/Shanghai',
    });
    const ootd1 = resolveActiveOcOutfit({
      oc: richOc,
      selfieCfg: { ...DEFAULT_AI_SELFIE_CONFIG, outfitMode: 'ootd', ootdOffset: 1 },
      nowMs: fixedTs,
      timezone: 'Asia/Shanghai',
    });
    expect(ootd1.id).not.toBe(ootd0.id);

    // Admin locking hidden outfit works
    const lockedBunny = resolveActiveOcOutfit({
      oc: richOc,
      selfieCfg: { ...DEFAULT_AI_SELFIE_CONFIG, outfitMode: 'secret_bunny' },
      nowMs: fixedTs,
      timezone: 'Asia/Shanghai',
    });
    expect(lockedBunny.id).toBe('secret_bunny');

    // System prompt reflects today's active OOTD summary & compact pose/outfit protocol
    const skillPrompt = buildOcSelfieSkillPrompt({
      oc: richOc,
      activeOutfit: ootd0,
      allowNsfw: true,
    });
    expect(skillPrompt).toContain(ootd0.summaryZh);
    expect(skillPrompt).toContain('secret_bunny');
    expect(skillPrompt.length).toBeLessThan(2600);

    // Per-shot chat request for urban_beret swaps hairAccessory (drops gold suzu bell!) & uses urban_beret guard,
    // without mutating richOc or guild OOTD!
    const beretShot = compileOcSelfiePrompt({
      oc: richOc,
      activeOutfit: sigOrOther(wardrobeOutfits, 'sig_kimono'),
      spec: {
        framing: 'full',
        outfitId: 'urban_beret',
        pose: 'stand_casual',
      },
      userContent: '换那套贝雷帽都市私服拍张全身照看看',
      allowNsfw: true,
    });
    expect(beretShot.outfitId).toBe('urban_beret');
    expect(beretShot.charCaptions[0]?.char_caption).toContain('burgundy wool beret');
    expect(beretShot.charCaptions[0]?.char_caption).not.toContain('gold suzu bell');
    expect(beretShot.charCaptions[0]?.char_caption).toContain('black ankle boots');
    expect(beretShot.prompt).toContain('detached sleeves, kimono');

    // Subsequent normal shot without outfitId still wears the active daily OOTD (sig_kimono) with default suzu bell!
    const nextDefaultShot = compileOcSelfiePrompt({
      oc: richOc,
      activeOutfit: sigOrOther(wardrobeOutfits, 'sig_kimono'),
      spec: {
        framing: 'portrait',
        pose: 'cute_face',
      },
      userContent: '再来张大头自拍',
      allowNsfw: true,
    });
    expect(nextDefaultShot.outfitId).toBe('sig_kimono');
    expect(nextDefaultShot.charCaptions[0]?.char_caption).toContain('gold suzu bell');
  });

  it('preserves costumeNsfw and bodyAnchors from external oc-presets.json and deduplicates appearance anchors in NSFW mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-nsfw-schema-'));
    tempDirs.push(tmpDir);
    const presetFile = path.join(tmpDir, 'oc-presets.json');

    fs.writeFileSync(
      presetFile,
      JSON.stringify({
        schemaVersion: 1,
        profiles: [
          {
            ...SAMPLE_OC_ALPHA,
            appearance:
              'girl, shoulder-length navy blue hair, bright amber eyes, fair skin, slender waist,',
            bodyAnchors: 'smooth dewy skin, slender waist, toned midriff',
            costumeNsfw: 'loosely draped silk bath towel, delicate silver choker',
            outfits: [
              {
                id: 'day_uniform',
                name: '学院日常服',
                summaryZh: '日常白衬衫与百褶裙',
                ootdEligible: true,
                costumePortrait: SAMPLE_OC_ALPHA.costumePortrait,
                costumeUpper: SAMPLE_OC_ALPHA.costumeUpper,
                costumeFull: SAMPLE_OC_ALPHA.costumeFull,
                silhouetteGuard: '-1.2::hoodie::,',
              },
              {
                id: 'evening_robe',
                name: '夜间丝绸睡袍',
                summaryZh: '轻薄丝绸睡袍',
                ootdEligible: false,
                bodyAnchors: 'dewy collarbone, slender waist, soft curves',
                costumeNsfw: 'unfastened sheer silk nightgown off shoulders, satin ribbon',
                costumePortrait: 'silk nightgown collar,',
                costumeUpper: 'silk nightgown, waist sash,',
                costumeFull: 'silk nightgown, waist sash, bare feet,',
                silhouetteGuard: '-1.2::shoes::,',
              },
            ],
          },
        ],
      }),
      'utf8',
    );

    const store = new AiOcPresetStore(presetFile);
    const loadedOc = store.getProfile('azure_scholar');
    expect(loadedOc).toBeDefined();
    expect(loadedOc?.bodyAnchors).toBe('smooth dewy skin, slender waist, toned midriff,');
    expect(loadedOc?.costumeNsfw).toBe('loosely draped silk bath towel, delicate silver choker,');
    expect(loadedOc?.outfits?.[1]?.bodyAnchors).toBe(
      'dewy collarbone, slender waist, soft curves,',
    );
    expect(loadedOc?.outfits?.[1]?.costumeNsfw).toBe(
      'unfastened sheer silk nightgown off shoulders, satin ribbon,',
    );

    // 1. SFW shot keeps clothed tier and ignores costumeNsfw / bodyAnchors
    const sfwShot = compileOcSelfiePrompt({
      oc: loadedOc!,
      spec: { framing: 'upper', outfitId: 'evening_robe', nsfw: false },
      userContent: '看看你穿夜间睡袍的样子',
      allowNsfw: true,
    });
    expect(sfwShot.nsfw).toBe(false);
    expect(sfwShot.charCaptions[0]?.char_caption).toContain('silk nightgown, waist sash,');
    expect(sfwShot.charCaptions[0]?.char_caption).not.toContain('unfastened sheer silk nightgown');
    expect(sfwShot.charCaptions[0]?.char_caption).not.toContain('dewy collarbone');

    // 2. NSFW shot on outfit WITH costumeNsfw & bodyAnchors -> prefers outfit's costumeNsfw & bodyAnchors, deduplicating 'slender waist'
    const outfitNsfwShot = compileOcSelfiePrompt({
      oc: loadedOc!,
      spec: { framing: 'upper', outfitId: 'evening_robe', nsfw: true },
      userContent: '发张大尺度私房照看看',
      allowNsfw: true,
    });
    expect(outfitNsfwShot.nsfw).toBe(true);
    const outfitCap = outfitNsfwShot.charCaptions[0]?.char_caption ?? '';
    expect(outfitCap).toContain('unfastened sheer silk nightgown off shoulders, satin ribbon,');
    expect(outfitCap).toContain('dewy collarbone');
    expect(outfitCap).toContain('soft curves');
    expect(outfitCap.match(/\bslender waist\b/gi)).toHaveLength(1);

    // 3. NSFW shot on daywear outfit WITHOUT costumeNsfw -> falls back to oc.costumeNsfw & oc.bodyAnchors instead of fully clothed daywear
    const profileFallbackNsfwShot = compileOcSelfiePrompt({
      oc: loadedOc!,
      spec: { framing: 'full', outfitId: 'day_uniform', nsfw: true },
      userContent: '脱掉外套来张福利图',
      allowNsfw: true,
    });
    expect(profileFallbackNsfwShot.nsfw).toBe(true);
    const fallbackCap = profileFallbackNsfwShot.charCaptions[0]?.char_caption ?? '';
    expect(fallbackCap).toContain('loosely draped silk bath towel, delicate silver choker,');
    expect(fallbackCap).not.toContain('plaid pleated mini skirt');
    expect(fallbackCap).toContain('toned midriff');
    expect(fallbackCap.match(/\bslender waist\b/gi)).toHaveLength(1);
  });

  it('prioritizes explicit spec.sentence, spec.action, spec.partnerOutfit, and spec.partnerAction over catalog defaults and documents them in skill prompt', () => {
    const rawTag = [
      '[SELFIE: {',
      '  "framing": "full",',
      '  "pose": "duo_cuddle",',
      '  "duo": true,',
      '  "action": "sitting side by side on wooden bench, leaning head on shoulder, mutual#shoulder_rest",',
      '  "sentence": "The girl leans her head peacefully against her companion shoulder under warm lantern light.",',
      '  "partnerOutfit": "charcoal wool coat, knitted scarf",',
      '  "partnerAction": "sitting beside girl, arm draped gently around her shoulder, mutual#shoulder_rest",',
      '  "nsfw": false',
      '}]',
    ].join('\n');

    const parsed = extractSelfieSkillTag(rawTag);
    expect(parsed?.partnerOutfit).toBe('charcoal wool coat, knitted scarf');
    expect(parsed?.partnerAction).toBe(
      'sitting beside girl, arm draped gently around her shoulder, mutual#shoulder_rest',
    );

    // 1. Solo shot with BOTH pose and explicit action/sentence -> explicit action & sentence win over catalog pose defaults
    const soloCustom = compileOcSelfiePrompt({
      oc: SAMPLE_OC_ALPHA,
      spec: {
        framing: 'upper',
        pose: 'sit_relaxed',
        action: 'holding warm porcelain teacup, blowing gently over steam, soft smile',
        sentence: 'The girl cradles a warm porcelain teacup by the window.',
      },
      userContent: '发张你坐着喝热茶的照片',
      allowNsfw: true,
    });
    expect(soloCustom.poseId).toBeDefined();
    expect(soloCustom.prompt).toContain(
      'holding warm porcelain teacup, blowing gently over steam, soft smile',
    );
    expect(soloCustom.prompt).toContain(
      'The girl cradles a warm porcelain teacup by the window,',
    );

    // 2. Duo shot with custom action, sentence, partnerOutfit, and partnerAction -> overrides hardcoded defaults
    const duoCustom = compileOcSelfiePrompt({
      oc: SAMPLE_OC_ALPHA,
      spec: parsed!,
      userContent: '拍一张我们两个并肩靠在一起的双人合照',
      allowNsfw: true,
    });
    expect(duoCustom.charCaptions).toHaveLength(2);
    expect(duoCustom.charCaptions[1]?.char_caption).toContain('charcoal wool coat, knitted scarf,');
    expect(duoCustom.prompt).toContain(
      'The girl leans her head peacefully against her companion shoulder under warm lantern light,',
    );
    expect(duoCustom.prompt).toContain(
      'Character 1: girl, sitting side by side on wooden bench, leaning head on shoulder, mutual#shoulder_rest,',
    );
    expect(duoCustom.prompt).toContain(
      'Character 2: boy, faceless male, sitting beside girl, arm draped gently around her shoulder, mutual#shoulder_rest,',
    );

    // 3. Skill prompt documents custom override fields when allowNsfw is true
    const skillPrompt = buildOcSelfieSkillPrompt({
      oc: SAMPLE_OC_ALPHA,
      allowNsfw: true,
    });
    expect(skillPrompt).toContain('"outfit"');
    expect(skillPrompt).toContain('"action"');
    expect(skillPrompt).toContain('"sentence"');
    expect(skillPrompt).toContain('"partnerOutfit"');
    expect(skillPrompt).toContain('"partnerAction"');
  });

  it('reclassifies yoga/gymnastics poses full_sexy_p066..p080 as spicy tier and supports broadened NSFW intent + intentText window', () => {
    const poses = listBuiltinOcPoses();
    const yogaIds = Array.from({ length: 15 }, (_, idx) =>
      `full_sexy_p${String(66 + idx).padStart(3, '0')}`,
    );
    for (const id of yogaIds) {
      const found = poses.find((p) => p.id === id);
      expect(found, `missing pose ${id}`).toBeDefined();
      expect(found?.tier, `pose ${id} should be spicy`).toBe('spicy');
    }

    // Rolling 25 consecutive nsfw_open / default NSFW full-body shots never picks yoga poses p066..p080
    const yogaSet = new Set(yogaIds);
    for (let i = 0; i < 25; i++) {
      const shot = compileOcSelfiePrompt({
        oc: SAMPLE_OC_ALPHA,
        spec: { framing: 'full', pose: 'nsfw_open', nsfw: true },
        userContent: '来张大尺度私房照',
        allowNsfw: true,
        rotationScopeKey: 'yoga-check',
      });
      expect(yogaSet.has(shot.poseId ?? '')).toBe(false);
    }

    // Broadened natural Chinese NSFW expressions
    const naturalNsfwPhrases = [
      '把外套脱掉拍一张',
      '裙子脱下看看',
      '不穿外套拍张看看',
      '发张私房照',
      '来张床照',
      '给点福利图',
      '拍得色一点',
      '再来张涩一点的',
      '更色一点行不行',
      '更涩一点',
      '稍微过分一点',
      '来点刺激的照片',
      '大尺度自拍',
      '尺度大一点',
      '发张内衣照',
      '半裸自拍',
      '全裸写真',
      '无码大图',
    ];
    for (const phrase of naturalNsfwPhrases) {
      expect(hasExplicitUserNsfwIntent(phrase), `expected NSFW intent for: ${phrase}`).toBe(true);
    }
    expect(hasExplicitUserNsfwIntent('换个角度再来一张')).toBe(false);

    // intentText unlocks 2-turn follow-up without leaking turn-1 pose keywords into turn-2 pose matching
    const followUpShot = compileOcSelfiePrompt({
      oc: SAMPLE_OC_ALPHA,
      spec: { framing: 'upper', pose: 'nsfw_tease', nsfw: true },
      userContent: '换个角度再来一张',
      intentText: '做个招财猫手势发张私房照\n换个角度再来一张',
      allowNsfw: true,
    });
    expect(followUpShot.nsfw).toBe(true);
    expect(followUpShot.spoiler).toBe(true);
    // Must NOT lock onto '招财猫' (upper_p008) from turn 1 when turn 2 userContent is '换个角度再来一张'
    expect(followUpShot.poseId).not.toBe('upper_p008');
  });
});

function sigOrOther(list: readonly OcOutfitPreset[], id: string): OcOutfitPreset {
  return list.find((o) => o.id === id) ?? list[0]!;
}
