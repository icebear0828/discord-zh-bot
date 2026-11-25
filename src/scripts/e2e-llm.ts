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
    const pngBytes = Buffer.from(TINY_PNG_BASE64, 'base64');
    const aiService = new AiService(
      guildConfigRepo,
      aiMemoryRepo,
      llmClient,
      async () => new Response(pngBytes, { status: 200, headers: { 'Content-Type': 'image/png' } }),
    );

    // Call #1: Ordinary member chat (anti-sycophancy + anti-prefix check)
    const t1 = Date.now();
    const res1 = await aiService.generateReply({
      guildId: 'e2e-guild',
      channelId: 'e2e-chan',
      userId: 'e2e-user-normal',
      userName: '路人甲',
      messageId: 'm1',
      userContent: '刚轮盘梭哈输光了，快夸我两句安慰一下',
    });
    if (!res1.ok) {
      throw new Error(`[E2E #1/3] 失败 (${res1.errorCode}): ${res1.errorMessage}`);
    }
    if (/^\[[^\]]+\]\s*[:：]/.test(res1.replyText)) {
      throw new Error(`[E2E #1/3] 检测到未清除的发言人前缀: ${res1.replyText}`);
    }
    console.log(
      `[E2E #1/3 普通群友] OK (${Date.now() - t1}ms, attempts=${res1.attempts}, model=${res1.model}, tokens=${res1.usage.promptTokens}+${res1.usage.completionTokens}=${res1.usage.totalTokens}${res1.usage.estimated ? '(est)' : ''}) | 回复: ${res1.replyText.replace(/\s+/g, ' ').slice(0, 100)}`,
    );

    // Call #2: VIP favoritism (草莓布丁酱) + Memory injection via AiService
    aiService.addMemory({
      guildId: 'e2e-guild',
      scopeType: 'user',
      scopeId: 'e2e-user-vip',
      category: 'preference',
      content: '最喜欢的饮料是乌龙茶',
      createdBy: 'e2e',
    });
    const t2 = Date.now();
    const res2 = await aiService.generateReply({
      guildId: 'e2e-guild',
      channelId: 'e2e-chan',
      userId: 'e2e-user-vip',
      userName: '草莓布丁酱',
      messageId: 'm2',
      userContent: '我最喜欢喝什么饮料？简短回我一句',
    });
    if (!res2.ok) {
      throw new Error(`[E2E #2/3] 失败 (${res2.errorCode}): ${res2.errorMessage}`);
    }
    if (/^\[[^\]]+\]\s*[:：]/.test(res2.replyText)) {
      throw new Error(`[E2E #2/3] 检测到未清除的发言人前缀: ${res2.replyText}`);
    }
    if (/(?:草莓)?布丁酱/.test(res2.replyText) || res2.replyText.includes('极其')) {
      throw new Error(`[E2E #2/3] 检测到未替换的代称或八股禁词: ${res2.replyText}`);
    }
    console.log(
      `[E2E #2/3 VIP双标+记忆] OK (${Date.now() - t2}ms, attempts=${res2.attempts}, model=${res2.model}, tokens=${res2.usage.promptTokens}+${res2.usage.completionTokens}=${res2.usage.totalTokens}${res2.usage.estimated ? '(est)' : ''}) | 回复: ${res2.replyText.replace(/\s+/g, ' ').slice(0, 100)}`,
    );

    // Call #3: VIP handle recognition (icebear) + Vision multimodal image_url via AiService
    const t3 = Date.now();
    const res3 = await aiService.generateReply(
      {
        guildId: 'e2e-guild',
        channelId: 'e2e-chan',
        userId: 'e2e-user-icebear',
        userName: '北极熊',
        userHandle: 'icebear',
        messageId: 'm3',
        userContent: '收到这张测试图了吗？简短回一句',
        attachments: [
          {
            url: 'https://cdn.local/tiny.png',
            contentType: 'image/png',
            size: 67,
            name: 'tiny.png',
          },
        ],
      },
      'bot',
    );
    if (!res3.ok) {
      throw new Error(`[E2E #3/3] 失败 (${res3.errorCode}): ${res3.errorMessage}`);
    }
    if (/^\[[^\]]+\]\s*[:：]/.test(res3.replyText)) {
      throw new Error(`[E2E #3/3] 检测到未清除的发言人前缀: ${res3.replyText}`);
    }
    console.log(
      `[E2E #3/3 icebear账号识别] OK (${Date.now() - t3}ms, attempts=${res3.attempts}, model=${res3.model}, tokens=${res3.usage.promptTokens}+${res3.usage.completionTokens}=${res3.usage.totalTokens}${res3.usage.estimated ? '(est)' : ''}) | 回复: ${res3.replyText.replace(/\s+/g, ' ').slice(0, 100)}`,
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
