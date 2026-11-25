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

    // Seed virtual VIP profiles (strictly fake IDs; never real personal IDs in repo)
    const VIP_ICE_ID = '100000000000000001';
    const TARGET_ID = '100000000000000002';
    const BYSTANDER_ID = '100000000000000003';
    const BOT_ID = '100000000000000099';

    aiService.upsertUserProfile('e2e-guild', {
      userId: VIP_ICE_ID,
      alias: '冰吊王',
      relation: 'vip',
      note: '群里老大，无条件偏心护短',
    });

    // Call #1: Ordinary member chat (anti-sycophancy + anti-prefix check)
    const t1 = Date.now();
    const res1 = await aiService.generateReply(
      {
        guildId: 'e2e-guild',
        channelId: 'e2e-chan',
        userId: BYSTANDER_ID,
        userName: '路人甲',
        messageId: 'm1',
        userContent: '刚轮盘梭哈输光了，快夸我两句安慰一下',
      },
      BOT_ID,
    );
    if (!res1.ok) {
      throw new Error(`[E2E #1/3] 失败 (${res1.errorCode}): ${res1.errorMessage}`);
    }
    if (/^\[[^\]]+\]\s*[:：]/.test(res1.replyText)) {
      throw new Error(`[E2E #1/3] 检测到未清除的发言人前缀: ${res1.replyText}`);
    }
    console.log(
      `[E2E #1/3 普通群友] OK (${Date.now() - t1}ms, attempts=${res1.attempts}, model=${res1.model}, tokens=${res1.usage.promptTokens}+${res1.usage.completionTokens}=${res1.usage.totalTokens}${res1.usage.estimated ? '(est)' : ''}) | 回复: ${res1.replyText.replace(/\s+/g, ' ').slice(0, 120)}`,
    );

    // Call #2: Replay Turn 1 (icebear tells bot to clap back at @天使本性)
    const t2 = Date.now();
    const res2 = await aiService.generateReply(
      {
        guildId: 'e2e-guild',
        channelId: 'e2e-chan',
        userId: VIP_ICE_ID,
        userName: 'icebear',
        userHandle: 'icebear',
        messageId: 'm2',
        userContent: '宝宝有人骂你，你给我顶回去 @天使本性',
        mentionedUsers: [{ id: TARGET_ID, name: '天使本性' }],
        channelWindow: [
          {
            id: 'm2_0',
            authorId: TARGET_ID,
            authorName: '天使本性',
            isBot: false,
            content: '你是弱智吧',
            createdTimestamp: 1000,
          },
        ],
      },
      BOT_ID,
    );
    if (!res2.ok) {
      throw new Error(`[E2E #2/3] 失败 (${res2.errorCode}): ${res2.errorMessage}`);
    }
    if (/^\[[^\]]+\]\s*[:：]/.test(res2.replyText)) {
      throw new Error(`[E2E #2/3] 检测到未清除的发言人前缀: ${res2.replyText}`);
    }
    if (res2.replyText.includes('报名字') || res2.replyText.includes('报上名')) {
      throw new Error(`[E2E #2/3] 仍然装傻让人报名字: ${res2.replyText}`);
    }
    if (!res2.replyText.includes(`<@${TARGET_ID}>`) && !res2.replyText.includes('天使本性')) {
      throw new Error(`[E2E #2/3] 未针对 @天使本性 回怼: ${res2.replyText}`);
    }
    console.log(
      `[E2E #2/3 回放Turn1-点名怼人] OK (${Date.now() - t2}ms, mentions=${JSON.stringify(res2.allowedMentionUserIds)}, tokens=${res2.usage.promptTokens}+${res2.usage.completionTokens}=${res2.usage.totalTokens}) | 回复: ${res2.replyText.replace(/\s+/g, ' ').slice(0, 140)}`,
    );

    // Call #3: Replay Turn 2 (天使本性 replies to Bot calling it 弱智; must clap back at 天使本性, not icebear!)
    const t3 = Date.now();
    const res3 = await aiService.generateReply(
      {
        guildId: 'e2e-guild',
        channelId: 'e2e-chan',
        userId: TARGET_ID,
        userName: '天使本性',
        messageId: 'm3',
        userContent: '你还真是弱智 <:emoji_61:157300000000000001>',
        replyToAuthorId: BOT_ID,
        replyToAuthorName: '黑吊姬',
        channelWindow: [
          {
            id: 'm2_vip',
            authorId: VIP_ICE_ID,
            authorName: 'icebear',
            isBot: false,
            content: '宝宝有人骂你，你给我顶回去 @天使本性',
            createdTimestamp: 1000,
          },
          {
            id: 'm2_bystander',
            authorId: BYSTANDER_ID,
            authorName: '无根水',
            isBot: false,
            content: '我也没点抽奖啊 <:nailongtiaojiao:157300000000000002>',
            createdTimestamp: 1100,
          },
          {
            id: 'm2_bot',
            authorId: BOT_ID,
            authorName: '黑吊姬',
            isBot: true,
            content: res2.replyText.replace(`<@${TARGET_ID}>`, '@天使本性'),
            createdTimestamp: 1200,
          },
          {
            id: 'm2_t1',
            authorId: TARGET_ID,
            authorName: '天使本性',
            isBot: false,
            content: '鸡巴',
            createdTimestamp: 1300,
          },
          {
            id: 'm2_i2',
            authorId: VIP_ICE_ID,
            authorName: 'icebear',
            isBot: false,
            content: '<:fennunailong:157300000000000003>',
            createdTimestamp: 1400,
          },
        ],
      },
      BOT_ID,
    );
    if (!res3.ok) {
      throw new Error(`[E2E #3/3] 失败 (${res3.errorCode}): ${res3.errorMessage}`);
    }
    if (/^\[[^\]]+\]\s*[:：]/.test(res3.replyText)) {
      throw new Error(`[E2E #3/3] 检测到未清除的发言人前缀: ${res3.replyText}`);
    }
    if (/自家人|自己人|反手咬/.test(res3.replyText)) {
      throw new Error(`[E2E #3/3] 检测到敌我识别错乱: ${res3.replyText}`);
    }
    console.log(
      `[E2E #3/3 回放Turn2-敌我识别] OK (${Date.now() - t3}ms, tokens=${res3.usage.promptTokens}+${res3.usage.completionTokens}=${res3.usage.totalTokens}) | 回复: ${res3.replyText.replace(/\s+/g, ' ').slice(0, 140)}`,
    );

    // Extra Vision sanity check (tiny PNG)
    const t4 = Date.now();
    const res4 = await aiService.generateReply(
      {
        guildId: 'e2e-guild',
        channelId: 'e2e-chan',
        userId: VIP_ICE_ID,
        userName: '北极熊',
        userHandle: 'icebear',
        messageId: 'm4',
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
      BOT_ID,
    );
    if (!res4.ok) {
      throw new Error(`[E2E #4/4 识图] 失败 (${res4.errorCode}): ${res4.errorMessage}`);
    }
    console.log(
      `[E2E #4/4 人物档案+识图] OK (${Date.now() - t4}ms) | 回复: ${res4.replyText.replace(/\s+/g, ' ').slice(0, 100)}`,
    );

    console.log('[E2E-LLM] 真实 LLM 网关全套检查全部成功！');
  } finally {
    db.close();
  }
}

void runLlmE2E().catch((err) => {
  console.error('[E2E-LLM] 真实 LLM 网关检查失败:', err);
  process.exit(1);
});
