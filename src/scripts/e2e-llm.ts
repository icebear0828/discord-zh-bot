import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/database.js';
import { AiMemoryRepo } from '../db/repositories/aiMemoryRepo.js';
import { GuildConfigRepo } from '../db/repositories/guildConfigRepo.js';
import { AiService } from '../services/aiService.js';
import { LlmClient } from '../services/llmClient.js';

// 1x1 transparent PNG (67 bytes) for real Vision API E2E check
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function runLlmE2E(): Promise<void> {
  const env = loadEnv();
  if (!env.llm || !env.llm.baseUrl || !env.llm.apiKey || !env.llm.model) {
    throw new Error('缺少 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 环境变量，无法执行真实 LLM E2E 检查');
  }

  const db = createDatabase(':memory:');
  try {
    const guildConfigRepo = new GuildConfigRepo(db);
    const aiMemoryRepo = new AiMemoryRepo(db);
    const llmClient = new LlmClient(env.llm);
    const aiService = new AiService(guildConfigRepo, aiMemoryRepo, llmClient);

    // Call #1: Basic Chinese reply through AiService
    const t1 = Date.now();
    const res1 = await aiService.generateReply({
      guildId: 'e2e-guild',
      channelId: 'e2e-chan',
      userId: 'e2e-user',
      userName: '测试群友',
      messageId: 'm1',
      userContent: '用一句话自我介绍一下，不超过30字。',
    });
    if (!res1.ok) {
      throw new Error(`[E2E #1/3] 失败 (${res1.errorCode}): ${res1.errorMessage}`);
    }
    console.log(
      `[E2E #1/3] OK (${Date.now() - t1}ms, attempts=${res1.attempts}, model=${res1.model}) | 回复: ${res1.replyText.replace(/\s+/g, ' ').slice(0, 80)}`,
    );

    // Call #2: Memory injection & multi-turn context via AiService
    aiService.addMemory({
      guildId: 'e2e-guild',
      scopeType: 'user',
      scopeId: 'e2e-user',
      category: 'preference',
      content: '最喜欢的饮料是乌龙茶',
      createdBy: 'e2e',
    });
    const t2 = Date.now();
    const res2 = await aiService.generateReply({
      guildId: 'e2e-guild',
      channelId: 'e2e-chan',
      userId: 'e2e-user',
      userName: '测试群友',
      messageId: 'm2',
      userContent: '我最喜欢喝什么饮料？直接简短回答。',
    });
    if (!res2.ok) {
      throw new Error(`[E2E #2/3] 失败 (${res2.errorCode}): ${res2.errorMessage}`);
    }
    console.log(
      `[E2E #2/3] OK (${Date.now() - t2}ms, attempts=${res2.attempts}, model=${res2.model}) | 回复: ${res2.replyText.replace(/\s+/g, ' ').slice(0, 80)}`,
    );

    // Call #3: Vision multimodal image_url payload via LlmClient
    const t3 = Date.now();
    const res3 = await llmClient.chat({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '我发了一张极小测试图，请用简短中文回复“已收到图片”。' },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` },
            },
          ],
        },
      ],
      maxTokens: 128,
    });
    console.log(
      `[E2E #3/3] OK (${Date.now() - t3}ms, attempts=${res3.attempts}, model=${res3.model}) | 回复: ${res3.content.replace(/\s+/g, ' ').slice(0, 80)}`,
    );

    console.log('[E2E-LLM] 连续 3 次真实 LLM 网关调用全部成功！');
  } finally {
    db.close();
  }
}

void runLlmE2E().catch((err) => {
  console.error('[E2E-LLM] 真实 LLM 网关检查失败:', err);
  process.exit(1);
});
