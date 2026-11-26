import { DEFAULT_NAI_POSITIVE_PROMPT } from '../config/defaults.js';
import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/database.js';
import { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import { ImageRepo } from '../db/repositories/imageRepo.js';
import { ImageClient } from '../services/imageClient.js';
import { DefaultImagePromptProcessor } from '../services/imagePromptProcessor.js';
import { ImageService } from '../services/imageService.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertPngBuffer(buf: Buffer, label: string): void {
  if (buf.length < 10_000) {
    throw new Error(`[${label}] 返回图片体积异常过小 (${buf.length} bytes)`);
  }
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error(`[${label}] 返回内容不是合法 PNG 文件头`);
  }
}

async function runImageE2E(): Promise<void> {
  const env = loadEnv();
  if (!env.image || !env.image.baseUrl || !env.image.apiKey) {
    throw new Error('缺少 IMAGE_BASE_URL / IMAGE_API_KEY 环境变量，无法执行真实生图 E2E 检查');
  }

  const db = createDatabase(':memory:');
  try {
    const guildConfigRepo = new GuildConfigRepo(db);
    const imageRepo = new ImageRepo(db);
    const imageClient = new ImageClient(env.image);
    const promptProcessor = new DefaultImagePromptProcessor();
    const imageService = new ImageService(
      guildConfigRepo,
      imageRepo,
      imageClient,
      promptProcessor,
    );

    const cfg = guildConfigRepo.getOrCreate('e2e-img-guild');
    guildConfigRepo.updateImageGen('e2e-img-guild', {
      ...cfg.imageGen,
      cooldownSec: 0,
    });

    // Stage 1 (Call #1): Single R18 uncensored preset + cfg_rescale=0.3, 2:3, steps=28
    const res1 = await imageService.generateImage({
      guildId: 'e2e-img-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: '1girl, mature female, silver hair, blue eyes, white dress',
      aspectRatio: '2:3',
      steps: 28,
      scale: 5.0,
    });
    if (!res1.ok) {
      throw new Error(
        `[E2E Stage 1] 失败 (${res1.errorCode}): ${res1.errorMessage} ${res1.errorDetail ?? ''}`,
      );
    }
    if (!res1.record.finalPrompt.startsWith(`${DEFAULT_NAI_POSITIVE_PROMPT},`)) {
      throw new Error(`[E2E Stage 1] 未前置默认 R18 无码标签: ${res1.record.finalPrompt}`);
    }
    if (
      !res1.record.negativePrompt.includes('censored') ||
      !res1.record.negativePrompt.includes('mosaic censoring')
    ) {
      throw new Error(`[E2E Stage 1] 负面词缺少反打码标签: ${res1.record.negativePrompt}`);
    }
    assertPngBuffer(res1.buffer, 'E2E Stage 1');
    console.log(
      `[E2E Stage 1/3 单张 R18预设 2:3] OK | id=#${res1.record.id} model=${res1.record.model} latency=${res1.record.latencyMs}ms bytes=${res1.buffer.length} attempts=${res1.attempts}`,
    );

    // Stage 2 (Calls #2 & #3): Serial batch count=2 with >=1000ms anti-risk pause
    const batchStart = Date.now();
    const resBatch = await imageService.generateBatch({
      guildId: 'e2e-img-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: '1girl, adult woman, black hair, lingerie, soft lighting',
      aspectRatio: '1:1',
      steps: 20,
      scale: 5.0,
      count: 2,
    });
    const batchWallMs = Date.now() - batchStart;
    if (!resBatch.ok) {
      throw new Error(
        `[E2E Stage 2] 失败 (${resBatch.errorCode}): ${resBatch.errorMessage} ${resBatch.errorDetail ?? ''}`,
      );
    }
    if (resBatch.items.length !== 2) {
      throw new Error(`[E2E Stage 2] 期望 2 张结果，实际 ${resBatch.items.length}`);
    }
    for (let i = 0; i < resBatch.items.length; i++) {
      assertPngBuffer(resBatch.items[i]!.buffer, `E2E Stage 2 #${i + 1}`);
    }
    const genSumMs = resBatch.items.reduce((acc, item) => acc + item.record.latencyMs, 0);
    const pauseMs = batchWallMs - genSumMs;
    if (pauseMs < 950) {
      throw new Error(`[E2E Stage 2] 防风控间隔不足 1s: wall=${batchWallMs}ms sum=${genSumMs}ms`);
    }
    console.log(
      `[E2E Stage 2/3 串行2连 1:1] OK | ids=#${resBatch.items.map((x) => x.record.id).join(',#')} wall=${batchWallMs}ms pause≈${pauseMs}ms bytes=${resBatch.items.map((x) => x.buffer.length).join('+')}`,
    );

    // Stage 3 (Call #4): Code fence & fullwidth comma cleanup + rating:safe override + fixed seed
    const res3 = await imageService.generateImage({
      guildId: 'e2e-img-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: '```scenery，sunset sky\nmountains，ocean，no humans, rating:safe```',
      negativePrompt: 'blurry，text',
      aspectRatio: '3:2',
      steps: 20,
      scale: 5.5,
      seed: 424242,
    });
    if (!res3.ok) {
      throw new Error(
        `[E2E Stage 3] 失败 (${res3.errorCode}): ${res3.errorMessage} ${res3.errorDetail ?? ''}`,
      );
    }
    assertPngBuffer(res3.buffer, 'E2E Stage 3');
    if (
      res3.record.finalPrompt.includes('```') ||
      res3.record.finalPrompt.includes('，') ||
      res3.record.finalPrompt.includes('nsfw')
    ) {
      throw new Error(`[E2E Stage 3] Tag 清洗或 rating:safe 跳过异常: ${res3.record.finalPrompt}`);
    }
    const persisted = imageRepo.getById(res3.record.id);
    if (!persisted || persisted.seed !== 424242 || persisted.aspectRatio !== '3:2') {
      throw new Error('[E2E Stage 3] SQLite 记录字段校验不一致');
    }
    console.log(
      `[E2E Stage 3/4 清洗+rating:safe+Seed 3:2] OK | id=#${res3.record.id} seed=${persisted.seed} latency=${res3.record.latencyMs}ms bytes=${res3.buffer.length}`,
    );

    // Stage 4 (Call #5): NAI V5 multi-character paste (Base Prompt + Character 1 & 2 + Character UC + Coords + UC)
    const multiCharPrompt = [
      'Base Prompt:',
      '```text',
      '2girls, rooftop, sunset, warm lighting, rating:safe,',
      'The silver-haired girl stands on the left while the black-haired girl stands on the right,',
      '',
      'Character 1: girl, standing, smile, looking at another,',
      'Character 2: girl, standing, gentle smile, looking at another,',
      '```',
      'Character 1 (0.25, 0.5):',
      '```text',
      'girl, silver hair, long hair, blue eyes,',
      'white sailor collar, navy pleated skirt,',
      '```',
      'Character 1 UC:',
      '```text',
      'glasses, hat',
      '```',
      'Character 2 @D3:',
      '```text',
      'girl, black hair, short bob, amber eyes,',
      'beige cardigan, plaid skirt,',
      '```',
      'Undesired Content:',
      '```text',
      'blurry, watermark',
      '```',
      '补充:',
      '双角色站位 E2E 测试。',
    ].join('\n');

    const res4 = await imageService.generateImage({
      guildId: 'e2e-img-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: multiCharPrompt,
      aspectRatio: '3:2',
      steps: 24,
      scale: 5.5,
    });
    if (!res4.ok) {
      throw new Error(
        `[E2E Stage 4] 失败 (${res4.errorCode}): ${res4.errorMessage} ${res4.errorDetail ?? ''}`,
      );
    }
    assertPngBuffer(res4.buffer, 'E2E Stage 4');
    const persisted4 = imageRepo.getById(res4.record.id);
    if (
      !persisted4 ||
      persisted4.charCaptions.length !== 2 ||
      !persisted4.useCoords ||
      persisted4.charCaptions[0]?.uc !== 'glasses, hat'
    ) {
      throw new Error(
        `[E2E Stage 4] 多角色字段持久化校验不一致: ${JSON.stringify(persisted4?.charCaptions)}`,
      );
    }
    console.log(
      `[E2E Stage 4/6 NAI V5 整段多栏粘贴+双角色坐标+独立UC 3:2] OK | id=#${res4.record.id} chars=${persisted4.charCaptions.length} useCoords=${persisted4.useCoords} latency=${res4.record.latencyMs}ms bytes=${res4.buffer.length}`,
    );

    // Stage 5 (Call #6): Modal rawCharacterPrompt flow (blank-line blocks + @B3/@D3 grid coords)
    const res5 = await imageService.generateImage({
      guildId: 'e2e-img-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: '1girl, 1boy, cafe interior, afternoon light, sitting at table, rating:safe',
      rawCharacterPrompt: [
        '@B3 girl, blonde hair, twin tails, green eyes,',
        'white blouse, red bowtie,',
        'UC: glasses',
        '',
        '@D3 boy, brown hair, short hair, blue eyes,',
        'black vest, white shirt,',
      ].join('\n'),
      aspectRatio: '3:2',
      steps: 22,
      scale: 5.0,
    });
    if (!res5.ok) {
      throw new Error(
        `[E2E Stage 5] 失败 (${res5.errorCode}): ${res5.errorMessage} ${res5.errorDetail ?? ''}`,
      );
    }
    assertPngBuffer(res5.buffer, 'E2E Stage 5');
    if (res5.record.charCaptions.length !== 2 || !res5.record.useCoords) {
      throw new Error('[E2E Stage 5] rawCharacterPrompt 角色栏或网格坐标解析异常');
    }
    console.log(
      `[E2E Stage 5/6 弹窗角色栏+网格坐标(@B3/@D3) 3:2] OK | id=#${res5.record.id} chars=${res5.record.charCaptions.length} useCoords=${res5.record.useCoords} latency=${res5.record.latencyMs}ms bytes=${res5.buffer.length}`,
    );

    // Stage 6 (Call #7): Slash command explicit charCaptions flow (AI's Choice automatic placement)
    const res6 = await imageService.generateImage({
      guildId: 'e2e-img-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: '1girl, solo, library, warm lamp light, reading book, rating:safe',
      charCaptions: [
        {
          char_caption: 'girl, lavender hair, long braid, purple eyes, dark robe, witch hat',
          uc: 'modern clothes',
        },
      ],
      aspectRatio: '2:3',
      steps: 22,
      scale: 5.0,
    });
    if (!res6.ok) {
      throw new Error(
        `[E2E Stage 6] 失败 (${res6.errorCode}): ${res6.errorMessage} ${res6.errorDetail ?? ''}`,
      );
    }
    assertPngBuffer(res6.buffer, 'E2E Stage 6');
    if (res6.record.charCaptions.length !== 1 || res6.record.useCoords !== false) {
      throw new Error('[E2E Stage 6] 单角色 AI 自动排布参数校验异常');
    }
    console.log(
      `[E2E Stage 6/6 斜杠角色栏(AI自动站位+角色UC) 2:3] OK | id=#${res6.record.id} chars=${res6.record.charCaptions.length} useCoords=${res6.record.useCoords} latency=${res6.record.latencyMs}ms bytes=${res6.buffer.length}`,
    );

    const summary = imageRepo.getUsageSummary('e2e-img-guild', 0);
    console.log(
      `[E2E-IMAGE 汇总] total=${summary.totalCalls} ok=${summary.okCalls} err=${summary.errorCalls} avgLatency=${summary.avgLatencyMs}ms`,
    );
  } finally {
    db.close();
  }
}

runImageE2E().catch((err) => {
  console.error('[E2E-IMAGE] 失败:', err);
  process.exit(1);
});
