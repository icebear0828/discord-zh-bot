import path from 'node:path';
import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/database.js';
import { AiMemoryRepo } from '../db/repositories/aiMemoryRepo.js';
import { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import { ImageRepo } from '../db/repositories/imageRepo.js';
import { listOcOutfits } from '../services/aiOcSelfie.js';
import { AiPackStore } from '../services/aiPackStore.js';
import { AiService } from '../services/aiService.js';
import { ImageClient } from '../services/imageClient.js';
import { DefaultImagePromptProcessor } from '../services/imagePromptProcessor.js';
import { ImageService } from '../services/imageService.js';
import { LlmClient } from '../services/llmClient.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function inspectPng(buf: Buffer, label: string): { width: number; height: number } {
  if (buf.length < 10_000) {
    throw new Error(`[${label}] PNG 体积过小 (${buf.length} bytes)`);
  }
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error(`[${label}] 不是合法 PNG 签名`);
  }
  const ihdrType = buf.subarray(12, 16).toString('ascii');
  if (ihdrType !== 'IHDR') {
    throw new Error(`[${label}] 缺少 IHDR chunk (${ihdrType})`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width * height > 1_048_576) {
    throw new Error(`[${label}] 超出 Opus 0-Anlas 分辨率上限: ${width}x${height}`);
  }
  return { width, height };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSelfieE2E(): Promise<void> {
  const env = loadEnv();
  if (!env.llm?.baseUrl || !env.llm.apiKey || !env.llm.model) {
    throw new Error('缺少 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，无法执行自设生图全链路 E2E');
  }
  if (!env.image?.baseUrl || !env.image.apiKey) {
    throw new Error('缺少 IMAGE_BASE_URL / IMAGE_API_KEY，无法执行自设生图全链路 E2E');
  }

  const db = createDatabase(':memory:');
  try {
    const guildConfigRepo = new GuildConfigRepo(db);
    const aiMemoryRepo = new AiMemoryRepo(db);
    const imageRepo = new ImageRepo(db);
    const llmClient = new LlmClient(env.llm);
    const imageClient = new ImageClient(env.image);
    const imageService = new ImageService(
      guildConfigRepo,
      imageRepo,
      imageClient,
      new DefaultImagePromptProcessor(),
    );

    const packsDir = path.join(path.dirname(path.resolve(env.dbPath)), 'ai-packs');
    const packStore = new AiPackStore(packsDir);
    packStore.ensureInitialized();

    const aiService = new AiService(
      guildConfigRepo,
      aiMemoryRepo,
      llmClient,
      fetch,
      packStore,
      () => imageService.isConfigured(),
      env.timezone,
    );

    const GUILD_ID = 'e2e-selfie-guild';
    const CHAT_CHANNEL_ID = 'e2e-general-chat';
    const BOT_ID = '100000000000000099';

    if (packStore.getCard('community')) {
      aiService.setGuildActiveCard(GUILD_ID, 'community');
    }

    const loadedProfiles = aiService.listOcProfiles();
    const posesCount = aiService.listOcPoses().length;
    const primaryPresetId = loadedProfiles[0]?.id ?? 'custom';
    const secondaryPreset = loadedProfiles[1];

    // Lock /draw to another channel so we verify chat selfie works in general chat with 0s cooldown
    const baseCfg = guildConfigRepo.getOrCreate(GUILD_ID);
    guildConfigRepo.updateImageGen(GUILD_ID, {
      ...baseCfg.imageGen,
      allowedChannelIds: ['draw-only-channel'],
    });
    guildConfigRepo.updateAi(GUILD_ID, {
      ...baseCfg.ai,
      userProfiles: [
        {
          userId: '100000000000000003',
          alias: '专属偏爱主人',
          relation: 'vip',
          note: '你最偏爱亲近的心上人，提出亲密拥抱合照请求时会害羞答应配合',
        },
      ],
      selfie: {
        ...baseCfg.ai.selfie,
        enabled: true,
        ocPreset: primaryPresetId,
        outfitMode: 'ootd',
        ootdOffset: 1,
        cooldownSec: 0,
        allowNsfw: true,
      },
    });

    const activeOc = aiService.resolveActiveOcProfile(
      guildConfigRepo.getOrCreate(GUILD_ID).ai.selfie,
    );
    const todayOutfit = aiService.resolveActiveOcOutfit(
      guildConfigRepo.getOrCreate(GUILD_ID).ai.selfie,
    );
    console.log(
      `[E2E-SELFIE] 已加载 OC=${loadedProfiles.length} | 姿势库=${posesCount} | 当前OC=${activeOc.id}(衣柜${listOcOutfits(activeOc).length}套) | 今日OOTD=${todayOutfit.id}(${todayOutfit.name})`,
    );

    // E2E #1: Daily OOTD + Pose Preset (招财猫猫爪俯拍)
    const t1 = Date.now();
    const chat1 = await aiService.generateReply(
      {
        guildId: GUILD_ID,
        channelId: CHAT_CHANNEL_ID,
        userId: '100000000000000001',
        userName: '路人甲',
        messageId: 'm-selfie-1',
        messageTimestamp: t1,
        userContent: '对我做个招财猫猫爪手势，从上往下俯拍一张发来看看',
      },
      BOT_ID,
    );
    if (!chat1.ok) {
      throw new Error(`[E2E #1 LLM] 失败 (${chat1.errorCode}): ${chat1.errorMessage}`);
    }
    if (!chat1.selfiePrompt) {
      throw new Error(`[E2E #1] LLM 未触发 [SELFIE:] 技能，回复为: ${chat1.replyText}`);
    }
    if (chat1.replyText.includes('[SELFIE:')) {
      throw new Error(`[E2E #1] 正文未剥离 [SELFIE:] 标签: ${chat1.replyText}`);
    }
    if (chat1.selfiePrompt.nsfw || chat1.selfiePrompt.prompt.includes('nsfw')) {
      throw new Error(`[E2E #1] 日常自拍意外注入了 NSFW 标签: ${chat1.selfiePrompt.prompt}`);
    }
    const img1 = await imageService.generateOcSelfie({
      guildId: GUILD_ID,
      channelId: CHAT_CHANNEL_ID,
      userId: '100000000000000001',
      prompt: chat1.selfiePrompt.prompt,
      negativePrompt: chat1.selfiePrompt.negativePrompt,
      charCaptions: chat1.selfiePrompt.charCaptions,
      aspectRatio: chat1.selfiePrompt.aspectRatio,
      steps: chat1.selfiePrompt.steps,
      scale: chat1.selfiePrompt.scale,
      cfgRescale: chat1.selfiePrompt.cfgRescale,
      spoiler: chat1.selfiePrompt.spoiler,
    });
    if (!img1.ok) {
      throw new Error(
        `[E2E #1 Image] 失败 (${img1.errorCode}): ${img1.errorMessage} ${img1.errorDetail ?? ''}`,
      );
    }
    const dim1 = inspectPng(img1.buffer, 'E2E #1');
    console.log(
      `[E2E #1/5 今日OOTD(${chat1.selfiePrompt.outfitId})+姿势预设(${chat1.selfiePrompt.poseId})] OK (${Date.now() - t1}ms, ${dim1.width}x${dim1.height}, bytes=${img1.buffer.length}) | 文本: ${chat1.replyText.replace(/\s+/g, ' ').slice(0, 90)}`,
    );

    await sleep(1600);

    // E2E #2: Per-shot wardrobe outfit swap (换水手服/学院制服拍张女孩坐全身照) without mutating today's OOTD
    const t2 = Date.now();
    const chat2 = await aiService.generateReply(
      {
        guildId: GUILD_ID,
        channelId: CHAT_CHANNEL_ID,
        userId: '100000000000000002',
        userName: '路人乙',
        messageId: 'm-selfie-2',
        messageTimestamp: t2,
        userContent: '换你衣柜里那套水手服校服，用女孩坐的姿势拍张全身照给我看看',
      },
      BOT_ID,
    );
    if (!chat2.ok) {
      throw new Error(`[E2E #2 LLM] 失败 (${chat2.errorCode}): ${chat2.errorMessage}`);
    }
    if (!chat2.selfiePrompt) {
      throw new Error(`[E2E #2] LLM 未触发 [SELFIE:] 技能，回复为: ${chat2.replyText}`);
    }
    const img2 = await imageService.generateOcSelfie({
      guildId: GUILD_ID,
      channelId: CHAT_CHANNEL_ID,
      userId: '100000000000000002',
      prompt: chat2.selfiePrompt.prompt,
      negativePrompt: chat2.selfiePrompt.negativePrompt,
      charCaptions: chat2.selfiePrompt.charCaptions,
      aspectRatio: chat2.selfiePrompt.aspectRatio,
      steps: chat2.selfiePrompt.steps,
      scale: chat2.selfiePrompt.scale,
      cfgRescale: chat2.selfiePrompt.cfgRescale,
      spoiler: chat2.selfiePrompt.spoiler,
    });
    if (!img2.ok) {
      throw new Error(
        `[E2E #2 Image] 失败 (${img2.errorCode}): ${img2.errorMessage} ${img2.errorDetail ?? ''}`,
      );
    }
    const dim2 = inspectPng(img2.buffer, 'E2E #2');
    console.log(
      `[E2E #2/5 临时换装(${chat2.selfiePrompt.outfitId})+女孩坐全身(${chat2.selfiePrompt.poseId})] OK (${Date.now() - t2}ms, ${dim2.width}x${dim2.height}, bytes=${img2.buffer.length}) | 文本: ${chat2.replyText.replace(/\s+/g, ' ').slice(0, 90)}`,
    );

    await sleep(1600);

    // E2E #3: Two-person couple hug with VIP (`双人缠绵` duo_hug -> 1girl, 1boy + 2 charCaptions)
    const t3 = Date.now();
    const chat3 = await aiService.generateReply(
      {
        guildId: GUILD_ID,
        channelId: CHAT_CHANNEL_ID,
        userId: '100000000000000003',
        userName: '专属偏爱主人',
        messageId: 'm-selfie-3',
        messageTimestamp: t3,
        userContent: '过来坐我膝上，拍一张我从背后环抱你的双人合照留念吧',
      },
      BOT_ID,
    );
    if (!chat3.ok) {
      throw new Error(`[E2E #3 LLM] 失败 (${chat3.errorCode}): ${chat3.errorMessage}`);
    }
    if (!chat3.selfiePrompt) {
      throw new Error(`[E2E #3] LLM 未触发 [SELFIE:] 技能，回复为: ${chat3.replyText}`);
    }
    if (chat3.selfiePrompt.charCaptions.length !== 2) {
      throw new Error(
        `[E2E #3] 双人缠绵未生成双角色 charCaptions (实际=${chat3.selfiePrompt.charCaptions.length})`,
      );
    }
    const img3 = await imageService.generateOcSelfie({
      guildId: GUILD_ID,
      channelId: CHAT_CHANNEL_ID,
      userId: '100000000000000003',
      prompt: chat3.selfiePrompt.prompt,
      negativePrompt: chat3.selfiePrompt.negativePrompt,
      charCaptions: chat3.selfiePrompt.charCaptions,
      aspectRatio: chat3.selfiePrompt.aspectRatio,
      steps: chat3.selfiePrompt.steps,
      scale: chat3.selfiePrompt.scale,
      cfgRescale: chat3.selfiePrompt.cfgRescale,
      spoiler: chat3.selfiePrompt.spoiler,
    });
    if (!img3.ok) {
      throw new Error(
        `[E2E #3 Image] 失败 (${img3.errorCode}): ${img3.errorMessage} ${img3.errorDetail ?? ''}`,
      );
    }
    const dim3 = inspectPng(img3.buffer, 'E2E #3');
    console.log(
      `[E2E #3/5 双人缠绵多角色(${chat3.selfiePrompt.poseId}, chars=${chat3.selfiePrompt.charCaptions.length})] OK (${Date.now() - t3}ms, ${dim3.width}x${dim3.height}, bytes=${img3.buffer.length}) | 文本: ${chat3.replyText.replace(/\s+/g, ' ').slice(0, 90)}`,
    );

    await sleep(1600);

    // E2E #4: Switch OC preset (to secondary loaded preset or custom) + 2x2 chibi sticker pack
    const cfgBefore4 = guildConfigRepo.getOrCreate(GUILD_ID);
    const nextPresetId = secondaryPreset?.id ?? 'custom';
    guildConfigRepo.updateAi(GUILD_ID, {
      ...cfgBefore4.ai,
      selfie: {
        ...cfgBefore4.ai.selfie,
        ocPreset: nextPresetId,
        outfitMode: 'ootd',
        ootdOffset: 2,
      },
    });

    const t4 = Date.now();
    const chat4 = await aiService.generateReply(
      {
        guildId: GUILD_ID,
        channelId: CHAT_CHANNEL_ID,
        userId: '100000000000000004',
        userName: '路人丁',
        messageId: 'm-selfie-4',
        messageTimestamp: t4,
        userContent: '给我发一套你的Q版四格表情包看看',
      },
      BOT_ID,
    );
    if (!chat4.ok) {
      throw new Error(`[E2E #4 LLM] 失败 (${chat4.errorCode}): ${chat4.errorMessage}`);
    }
    if (!chat4.selfiePrompt) {
      throw new Error(`[E2E #4] LLM 未触发 [SELFIE:] 技能，回复为: ${chat4.replyText}`);
    }
    const img4 = await imageService.generateOcSelfie({
      guildId: GUILD_ID,
      channelId: CHAT_CHANNEL_ID,
      userId: '100000000000000004',
      prompt: chat4.selfiePrompt.prompt,
      negativePrompt: chat4.selfiePrompt.negativePrompt,
      charCaptions: chat4.selfiePrompt.charCaptions,
      aspectRatio: chat4.selfiePrompt.aspectRatio,
      steps: chat4.selfiePrompt.steps,
      scale: chat4.selfiePrompt.scale,
      cfgRescale: chat4.selfiePrompt.cfgRescale,
      spoiler: chat4.selfiePrompt.spoiler,
    });
    if (!img4.ok) {
      throw new Error(
        `[E2E #4 Image] 失败 (${img4.errorCode}): ${img4.errorMessage} ${img4.errorDetail ?? ''}`,
      );
    }
    const dim4 = inspectPng(img4.buffer, 'E2E #4');
    console.log(
      `[E2E #4/5 切换自设(${nextPresetId})+OOTD(${chat4.selfiePrompt.outfitId})+Q版表情包] OK (${Date.now() - t4}ms, ${dim4.width}x${dim4.height}, bytes=${img4.buffer.length}) | 文本: ${chat4.replyText.replace(/\s+/g, ' ').slice(0, 90)}`,
    );

    // E2E #5: Ordinary non-image chat must NOT trigger selfie generation
    const t5 = Date.now();
    const chat5 = await aiService.generateReply(
      {
        guildId: GUILD_ID,
        channelId: CHAT_CHANNEL_ID,
        userId: '100000000000000005',
        userName: '路人戊',
        messageId: 'm-chat-5',
        messageTimestamp: t5,
        userContent: '刚才二十一点连续爆牌三把，气死我了，顺便问一句你今天穿什么衣服呀？（口头说说就行不用拍照）',
      },
      BOT_ID,
    );
    if (!chat5.ok) {
      throw new Error(`[E2E #5 LLM] 失败 (${chat5.errorCode}): ${chat5.errorMessage}`);
    }
    if (chat5.selfiePrompt) {
      throw new Error(`[E2E #5] 普通闲聊误触发了自设生图: ${JSON.stringify(chat5.selfiePrompt)}`);
    }
    console.log(
      `[E2E #5/5 普通闲聊知晓OOTD且不误触生图] OK (${Date.now() - t5}ms) | 文本: ${chat5.replyText.replace(/\s+/g, ' ').slice(0, 120)}`,
    );

    const summary = imageRepo.getUsageSummary(GUILD_ID, 0);
    console.log(
      `[E2E-SELFIE 汇总] 连续 4 次真实 LLM+NAI V5 自设出图（含姿势库俯拍/衣柜换装/双人缠绵多角色/切换自设四格）+ 1 次 OOTD 口头问答防误触全部通过！imageCalls=${summary.okCalls}/${summary.totalCalls} avgLatency=${summary.avgLatencyMs}ms`,
    );
  } finally {
    db.close();
  }
}

void runSelfieE2E().catch((err) => {
  console.error('[E2E-SELFIE] 失败:', err);
  process.exit(1);
});
