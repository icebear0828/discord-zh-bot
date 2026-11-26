import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/database.js';
import { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import { ImageRepo } from '../db/repositories/imageRepo.js';
import { ImageClient } from '../services/imageClient.js';
import {
  containsCjkText,
  LiteralTranslationPromptProcessor,
} from '../services/imagePromptProcessor.js';
import { ImageService } from '../services/imageService.js';
import { LlmClient } from '../services/llmClient.js';

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
    const llmClient = new LlmClient(env.llm);
    const imageClient = new ImageClient(env.image);
    const promptProcessor = new LiteralTranslationPromptProcessor(
      llmClient,
      env.llm?.fallbackModel || env.llm?.model,
    );
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

    // Call #1: English NAI tags, default 2:3, steps=28, scale=5.0
    const res1 = await imageService.generateImage({
      guildId: 'e2e-img-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: '1girl, solo, silver hair, blue eyes, simple background',
      aspectRatio: '2:3',
      steps: 28,
      scale: 5.0,
    });
    if (!res1.ok) {
      throw new Error(`[E2E #1/3] 失败 (${res1.errorCode}): ${res1.errorMessage} ${res1.errorDetail ?? ''}`);
    }
    if (res1.translated) {
      throw new Error('[E2E #1/3] 纯英文提示词不应触发翻译');
    }
    assertPngBuffer(res1.buffer, 'E2E #1/3');
    console.log(
      `[E2E #1/3 纯英文 2:3] OK | id=#${res1.record.id} model=${res1.record.model} latency=${res1.record.latencyMs}ms bytes=${res1.buffer.length} attempts=${res1.attempts}`,
    );

    // Call #2: Chinese prompt literal translation -> NAI generation, 1:1
    const res2 = await imageService.generateImage({
      guildId: 'e2e-img-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: '银发蓝瞳少女，独自一人，看着镜头，白色连衣裙',
      aspectRatio: '1:1',
      steps: 22,
      scale: 5.0,
    });
    if (!res2.ok) {
      throw new Error(`[E2E #2/3] 失败 (${res2.errorCode}): ${res2.errorMessage} ${res2.errorDetail ?? ''}`);
    }
    if (env.llm?.baseUrl && env.llm?.apiKey) {
      if (!res2.translated || containsCjkText(res2.record.finalPrompt)) {
        throw new Error(
          `[E2E #2/3] 中文直译未生效或仍含中文: translated=${res2.translated}, finalPrompt=${res2.record.finalPrompt}`,
        );
      }
    }
    assertPngBuffer(res2.buffer, 'E2E #2/3');
    console.log(
      `[E2E #2/3 中文直译 1:1] OK | id=#${res2.record.id} translated=${res2.translated} finalPrompt="${res2.record.finalPrompt}" latency=${res2.record.latencyMs}ms bytes=${res2.buffer.length}`,
    );

    // Call #3: Custom params (3:2, negative_prompt, steps=20, scale=5.5, explicit seed) + SQLite persistence check
    const res3 = await imageService.generateImage({
      guildId: 'e2e-img-guild',
      channelId: 'e2e-ch',
      userId: 'e2e-u1',
      prompt: 'scenery, sunset sky, ocean, clouds, no humans',
      negativePrompt: 'lowres, blurry, bad anatomy, worst quality',
      aspectRatio: '3:2',
      steps: 20,
      scale: 5.5,
      seed: 424242,
    });
    if (!res3.ok) {
      throw new Error(`[E2E #3/3] 失败 (${res3.errorCode}): ${res3.errorMessage} ${res3.errorDetail ?? ''}`);
    }
    assertPngBuffer(res3.buffer, 'E2E #3/3');
    const persisted = imageRepo.getById(res3.record.id);
    if (!persisted || persisted.seed !== 424242 || persisted.aspectRatio !== '3:2') {
      throw new Error('[E2E #3/3] SQLite 记录字段校验不一致');
    }
    console.log(
      `[E2E #3/3 自定义参数 3:2+负面词+Seed] OK | id=#${res3.record.id} seed=${persisted.seed} latency=${res3.record.latencyMs}ms bytes=${res3.buffer.length}`,
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
