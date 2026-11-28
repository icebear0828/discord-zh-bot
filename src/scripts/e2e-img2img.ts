import { MAX_IMAGE_STEPS } from '../config/defaults.js';
import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/database.js';
import { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import { ImageRepo } from '../db/repositories/imageRepo.js';
import { ImageClient } from '../services/imageClient.js';
import { DefaultImagePromptProcessor } from '../services/imagePromptProcessor.js';
import {
  DEFAULT_IMG2IMG_NOISE,
  ENHANCE_IMG2IMG_STRENGTH,
  ImageService,
} from '../services/imageService.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertPngBuffer(buf: Buffer, label: string): void {
  if (buf.length < 10_000) {
    throw new Error(`[${label}] 返回图片体积异常过小 (${buf.length} bytes)`);
  }
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error(`[${label}] 返回内容不是合法 PNG 文件头`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runImg2ImgE2E(): Promise<void> {
  const env = loadEnv();
  if (!env.image || !env.image.baseUrl || !env.image.apiKey) {
    throw new Error('缺少 IMAGE_BASE_URL / IMAGE_API_KEY 环境变量，无法执行真实改图 E2E 检查');
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

    const cfg = guildConfigRepo.getOrCreate('e2e-i2i-guild');
    guildConfigRepo.updateImageGen('e2e-i2i-guild', {
      ...cfg.imageGen,
      cooldownSec: 0,
    });

    // Base image: real SFW generation so img2img runs on realistic NAI V5 output
    const baseRes = await imageService.generateImage({
      guildId: 'e2e-i2i-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: '1girl, silver hair, blue eyes, white shirt, black skirt, standing, simple background, rating:safe',
      aspectRatio: '2:3',
      steps: 24,
      scale: 5.0,
    });
    if (!baseRes.ok) {
      throw new Error(
        `[Base SFW] 失败 (${baseRes.errorCode}): ${baseRes.errorMessage} ${baseRes.errorDetail ?? ''}`,
      );
    }
    assertPngBuffer(baseRes.buffer, 'Base SFW');
    const baseDataUrl = `data:image/png;base64,${baseRes.buffer.toString('base64')}`;
    console.log(
      `[Base SFW] OK | id=#${baseRes.record.id} model=${baseRes.record.model} latency=${baseRes.record.latencyMs}ms bytes=${baseRes.buffer.length}`,
    );

    await sleep(1200);

    // Img2Img Call 1/3: Outfit change (strength=0.60, noise=0)
    const res1 = await imageService.generateImage({
      guildId: 'e2e-i2i-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: '1girl, silver hair, blue eyes, red gothic dress, lace trim, standing, simple background, rating:safe',
      initImageDataUrl: baseDataUrl,
      strength: 0.6,
      noise: 0,
      aspectRatio: '2:3',
      steps: MAX_IMAGE_STEPS,
      scale: 5.0,
    });
    if (!res1.ok) {
      throw new Error(
        `[Img2Img 1/3] 失败 (${res1.errorCode}): ${res1.errorMessage} ${res1.errorDetail ?? ''}`,
      );
    }
    assertPngBuffer(res1.buffer, 'Img2Img 1/3');
    if (res1.buffer.equals(baseRes.buffer)) {
      throw new Error('[Img2Img 1/3] 输出图片与原图完全相同，未发生重绘');
    }
    const persisted1 = imageRepo.getById(res1.record.id);
    if (!persisted1 || persisted1.strength !== 0.6 || persisted1.noise !== 0) {
      throw new Error('[Img2Img 1/3] strength/noise 持久化校验异常');
    }
    console.log(
      `[Img2Img 1/3 换装改图] OK | id=#${res1.record.id} strength=${persisted1.strength} noise=${persisted1.noise} latency=${res1.record.latencyMs}ms bytes=${res1.buffer.length}`,
    );

    await sleep(1200);

    // Img2Img Call 2/3: Character Caption + explicit noise (strength=0.65, noise=0.05)
    const res2 = await imageService.generateImage({
      guildId: 'e2e-i2i-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: '1girl, warm sunset cafe background, holding coffee cup, rating:safe',
      charCaptions: [
        {
          char_caption: 'girl, silver hair, blue eyes, cozy knit sweater, scarf',
          uc: 'hat, glasses',
        },
      ],
      useCoords: false,
      initImageDataUrl: baseDataUrl,
      strength: 0.65,
      noise: 0.05,
      aspectRatio: '2:3',
      steps: 24,
      scale: 5.5,
    });
    if (!res2.ok) {
      throw new Error(
        `[Img2Img 2/3] 失败 (${res2.errorCode}): ${res2.errorMessage} ${res2.errorDetail ?? ''}`,
      );
    }
    assertPngBuffer(res2.buffer, 'Img2Img 2/3');
    if (res2.buffer.equals(baseRes.buffer)) {
      throw new Error('[Img2Img 2/3] 输出图片与原图完全相同，未发生重绘');
    }
    const persisted2 = imageRepo.getById(res2.record.id);
    if (
      !persisted2 ||
      persisted2.charCaptions.length !== 1 ||
      persisted2.strength !== 0.65 ||
      persisted2.noise !== 0.05
    ) {
      throw new Error('[Img2Img 2/3] 角色栏或 img2img 参数持久化校验异常');
    }
    console.log(
      `[Img2Img 2/3 角色分栏垫图] OK | id=#${res2.record.id} chars=${persisted2.charCaptions.length} strength=${persisted2.strength} noise=${persisted2.noise} latency=${res2.record.latencyMs}ms bytes=${res2.buffer.length}`,
    );

    await sleep(1200);

    // Img2Img Call 3/3: 1-click Enhance flow on res1 (strength=0.35, noise=0, steps=28)
    const res1DataUrl = `data:image/png;base64,${res1.buffer.toString('base64')}`;
    const res3 = await imageService.generateImage({
      guildId: 'e2e-i2i-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: `${res1.record.rawPrompt}, -2::upscaled, blurry::`,
      initImageDataUrl: res1DataUrl,
      strength: ENHANCE_IMG2IMG_STRENGTH,
      noise: DEFAULT_IMG2IMG_NOISE,
      aspectRatio: '2:3',
      steps: MAX_IMAGE_STEPS,
      scale: 5.0,
    });
    if (!res3.ok) {
      throw new Error(
        `[Img2Img 3/3 Enhance] 失败 (${res3.errorCode}): ${res3.errorMessage} ${res3.errorDetail ?? ''}`,
      );
    }
    assertPngBuffer(res3.buffer, 'Img2Img 3/3 Enhance');
    if (res3.buffer.equals(res1.buffer)) {
      throw new Error('[Img2Img 3/3 Enhance] 输出图片与原图完全相同，未发生细节精修');
    }
    const persisted3 = imageRepo.getById(res3.record.id);
    if (
      !persisted3 ||
      persisted3.strength !== ENHANCE_IMG2IMG_STRENGTH ||
      persisted3.noise !== DEFAULT_IMG2IMG_NOISE ||
      persisted3.steps !== MAX_IMAGE_STEPS
    ) {
      throw new Error('[Img2Img 3/3 Enhance] 细节精修参数持久化校验异常');
    }
    console.log(
      `[Img2Img 3/3 细节精修 Enhance] OK | id=#${res3.record.id} strength=${persisted3.strength} noise=${persisted3.noise} steps=${persisted3.steps} latency=${res3.record.latencyMs}ms bytes=${res3.buffer.length}`,
    );

    const summary = imageRepo.getUsageSummary('e2e-i2i-guild', 0);
    console.log(
      `[E2E-IMG2IMG 汇总] total=${summary.totalCalls} ok=${summary.okCalls} err=${summary.errorCalls} avgLatency=${summary.avgLatencyMs}ms`,
    );
  } finally {
    db.close();
  }
}

runImg2ImgE2E().catch((err) => {
  console.error('[E2E-IMG2IMG] 失败:', err);
  process.exit(1);
});
