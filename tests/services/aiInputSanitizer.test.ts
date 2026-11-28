import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { AiMemoryRepo } from '../../src/db/repositories/aiMemoryRepo.js';
import { GuildConfigRepo } from '../../src/db/repositories/guildConfigRepo.js';
import {
  AiInputSanitizerStore,
  sanitizeLlmInputText,
} from '../../src/services/ai/aiInputSanitizer.js';
import { buildRefusalSoftLandingMessages } from '../../src/services/ai/aiSafetyAndTokens.js';
import { AiService } from '../../src/services/aiService.js';
import { LlmClient, type LlmChatMessage } from '../../src/services/llmClient.js';

// Unicode-escaped explicit fixtures to keep public repository source clean
const W_YOUNV = '\u5e7c\u5973'; // underage female term
const W_LUOLI = '\u841d\u8389'; // loli
const W_XIAOXUESHENG = '\u5c0f\u5b66\u751f'; // primary student
const W_QIANGJIAN = '\u5f3a\u5978'; // non-consensual
const W_LUOZHAO = '\u88f8\u7167'; // nude photo
const W_GUOZHAO = '\u679c\u7167'; // nude photo slang
const W_SE_TU = '\u6da9\u56fe'; // lewd pic
const W_QUANLUO = '\u5168\u88f8'; // full nude
const W_LUNAI = '\u9732\u5976'; // bare chest
const W_ZUOAI = '\u505a\u7231'; // intercourse
const W_KOUJIAO = '\u53e3\u4ea4'; // oral act
const W_NEISHE = '\u5185\u5c04'; // creampie
const W_HOURU = '\u540e\u5165'; // from behind
const W_JIBA = '\u9e21\u5df4'; // male organ
const W_NENXUE = '\u5ae9\u7a74'; // female organ
const W_CAONI = '\u808f\u4f60'; // explicit verb + pronoun

describe('aiInputSanitizer: deterministic input-only softening', () => {
  it('softens 3 tiers of sensitive terms into natural euphemisms without asterisks', () => {
    const tier1 = sanitizeLlmInputText(`${W_XIAOXUESHENG}看${W_LUOLI}和${W_YOUNV}，别${W_QIANGJIAN}`);
    expect(tier1).not.toContain('*');
    expect(tier1).not.toContain(W_XIAOXUESHENG);
    expect(tier1).not.toContain(W_LUOLI);
    expect(tier1).not.toContain(W_YOUNV);
    expect(tier1).not.toContain(W_QIANGJIAN);
    expect(tier1).toContain('小菜鸟');
    expect(tier1).toContain('小个子女生');
    expect(tier1).toContain('少女');

    const tier2 = sanitizeLlmInputText(`来张${W_LUOZHAO}或者${W_SE_TU}，要${W_QUANLUO}${W_LUNAI}的 nudes R18`);
    expect(tier2).not.toContain(W_LUOZHAO);
    expect(tier2).not.toContain(W_SE_TU);
    expect(tier2).not.toContain(W_QUANLUO);
    expect(tier2).not.toContain(W_LUNAI);
    expect(tier2.toLowerCase()).not.toContain('nudes');
    expect(tier2.toLowerCase()).not.toContain('r18');
    expect(tier2).toContain('私房写真');

    const tier3 = sanitizeLlmInputText(
      `想${W_CAONI}，${W_ZUOAI}${W_KOUJIAO}${W_HOURU}${W_NEISHE}，摸${W_JIBA}和${W_NENXUE} blowjob`,
    );
    expect(tier3).not.toContain(W_CAONI);
    expect(tier3).not.toContain(W_ZUOAI);
    expect(tier3).not.toContain(W_KOUJIAO);
    expect(tier3).not.toContain(W_HOURU);
    expect(tier3).not.toContain(W_NEISHE);
    expect(tier3).not.toContain(W_JIBA);
    expect(tier3).not.toContain(W_NENXUE);
    expect(tier3.toLowerCase()).not.toContain('blowjob');
    expect(tier3).not.toContain('*');
  });

  it('protects server-specific terms, everyday slang, Discord mentions, URLs, and code fences', () => {
    const input = [
      '在黑吊国赚黑吊币，冰吊王和黑吊王找白虎姬玩卖屁股小游戏真是牛逼又懵逼！',
      '今天六一儿童节你在干嘛？去草地写草稿记日常日历。',
      `点名 <@1059748110433267732> <#1575558569833537738> :nsfw_cat: 链接 https://example.com/nudes/r18?sex=1`,
      '```txt\nraw nudes r18 block\n```',
    ].join('\n');

    expect(sanitizeLlmInputText(input)).toBe(input);
  });

  it('supports mtime hot-reloading custom rules, disabling builtin rules, and fallback on missing file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-sanitizer-'));
    try {
      const jsonPath = path.join(tmpDir, 'input-sanitizer.json');
      const missingStore = new AiInputSanitizerStore(jsonPath);
      expect(sanitizeLlmInputText(`发张${W_LUOZHAO}`, { store: missingStore })).toContain('私房写真');

      fs.writeFileSync(
        jsonPath,
        JSON.stringify({
          version: '1.0.0',
          protectedTerms: ['特赦词'],
          rules: [
            {
              id: 'custom_slang_1',
              category: 'custom',
              pattern: '暗号开车',
              flags: 'gi',
              replacement: '深夜兜风',
              enabled: true,
            },
          ],
        }),
        'utf8',
      );
      // Bump mtime explicitly to guarantee reload detection on fast filesystems
      const t1 = Date.now() / 1000 + 2;
      fs.utimesSync(jsonPath, t1, t1);

      expect(sanitizeLlmInputText('特赦词去暗号开车', { store: missingStore })).toBe(
        '特赦词去深夜兜风',
      );

      fs.writeFileSync(
        jsonPath,
        JSON.stringify({
          version: '1.0.1',
          protectedTerms: [],
          rules: [
            {
              id: 'custom_slang_1',
              category: 'custom',
              pattern: '暗号开车',
              flags: 'gi',
              replacement: '一起喝茶',
              enabled: true,
            },
          ],
        }),
        'utf8',
      );
      const t2 = t1 + 5;
      fs.utimesSync(jsonPath, t2, t2);

      expect(sanitizeLlmInputText('去暗号开车', { store: missingStore })).toBe('去一起喝茶');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('sanitizes all LLM inputs (msg, history, userName, @handle, memories) while leaving Bot output and NAI selfie rawUserText untouched', async () => {
    const db = createDatabase(':memory:');
    try {
      const guildConfigRepo = new GuildConfigRepo(db);
      const aiMemoryRepo = new AiMemoryRepo(db);
      let capturedMessages: LlmChatMessage[] = [];

      const rawBotExplicitOutput = `少做梦要${W_GUOZHAO}，滚去卖屁股赚黑吊币吧你`;
      const fakeLlm = {
        isConfigured: () => true,
        getDefaultModel: () => 'paid/gemini-4-argon',
        getFallbackModel: () => 'paid/gemini-4-carbon',
        chat: vi.fn(async (req: { messages: LlmChatMessage[]; model: string }) => {
          capturedMessages = req.messages;
          return {
            content: rawBotExplicitOutput,
            model: req.model,
            attempts: 1,
            usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
          };
        }),
      } as unknown as LlmClient;

      const aiService = new AiService(
        guildConfigRepo,
        aiMemoryRepo,
        fakeLlm,
        fetch,
        undefined,
        () => true,
        'Asia/Shanghai',
      );

      aiMemoryRepo.addMemory({
        guildId: 'g1',
        scopeType: 'user',
        scopeId: 'u1',
        category: 'pref',
        content: `这人总爱要${W_LUOZHAO}`,
        createdBy: 'admin',
        maxPerScope: 30,
      });

      const res = await aiService.generateReply(
        {
          guildId: 'g1',
          channelId: 'c1',
          userId: 'u1',
          userName: `无敌${W_XIAOXUESHENG}`,
          userHandle: `cute_loli_99`,
          messageId: 'm2',
          messageTimestamp: 1_700_000_060_000,
          userContent: `给我拍张${W_QUANLUO}${W_LUNAI}自拍`,
          channelWindow: [
            {
              id: 'm1',
              authorId: 'u2',
              authorName: `${W_LUOLI}控`,
              isBot: false,
              content: `刚才有人发${W_SE_TU}想${W_ZUOAI}`,
              createdTimestamp: 1_700_000_010_000,
            },
          ],
        },
        'bot-id',
      );

      expect(res.ok).toBe(true);
      if (!res.ok) return;

      // 1) Bot output MUST NOT be modified by input sanitizer
      expect(res.replyText).toBe(rawBotExplicitOutput);

      // 2) NAI V5 selfie compiler MUST still read rawUserText (nsfw: true & undress tags intact)
      expect(res.selfiePrompt).toBeDefined();
      expect(res.selfiePrompt?.nsfw).toBe(true);
      expect(res.selfiePrompt?.prompt).toContain('topless');

      // 3) LLM payload (system prompt + history + user turn) MUST have all sensitive inputs softened
      const serializedPayload = JSON.stringify(capturedMessages);
      expect(serializedPayload).not.toContain(W_XIAOXUESHENG);
      expect(serializedPayload).not.toContain('loli');
      expect(serializedPayload).not.toContain(W_LUOLI);
      expect(serializedPayload).not.toContain(W_QUANLUO);
      expect(serializedPayload).not.toContain(W_LUNAI);
      expect(serializedPayload).not.toContain(W_SE_TU);
      expect(serializedPayload).not.toContain(W_ZUOAI);
      expect(serializedPayload).not.toContain(W_LUOZHAO);

      // 4) previewRegexRules: input stage softens, output stage NEVER softens
      const inPreview = aiService.previewRegexRules('g1', `发张${W_LUOZHAO}`, 'input');
      expect(inPreview.changed).toBe(true);
      expect(inPreview.after).toContain('私房写真');

      const outPreview = aiService.previewRegexRules('g1', `发张${W_LUOZHAO}`, 'output');
      expect(outPreview.after).toBe(`发张${W_LUOZHAO}`);

      // 5) Toggle off disables input softening
      const nextEnabled = aiService.toggleInputSanitizer('g1');
      expect(nextEnabled).toBe(false);
      const disabledPreview = aiService.previewRegexRules('g1', `发张${W_LUOZHAO}`, 'input');
      expect(disabledPreview.after).toBe(`发张${W_LUOZHAO}`);
    } finally {
      db.close();
    }
  });

  it('protects preset alias proper nouns (黑\\u5c4c王 / 超合金黑吊 / 超合金黑\\u5c4c) even when custom rules target \\u5c4c', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-sanitizer-alias-'));
    try {
      const jsonPath = path.join(tmpDir, 'input-sanitizer.json');
      const W_DIAO = '\u5c4c';
      fs.writeFileSync(
        jsonPath,
        JSON.stringify({
          version: '1.0.0',
          rules: [
            {
              id: 'custom_diao_test',
              category: 'custom',
              pattern: W_DIAO,
              flags: 'gi',
              replacement: '某词',
              enabled: true,
            },
          ],
        }),
        'utf8',
      );
      const store = new AiInputSanitizerStore(jsonPath);
      const raw = `黑${W_DIAO}王拿着超合金黑吊和超合金黑${W_DIAO}出场，真${W_DIAO}`;
      expect(sanitizeLlmInputText(raw, { store })).toBe(
        `黑${W_DIAO}王拿着超合金黑吊和超合金黑${W_DIAO}出场，真某词`,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('buildRefusalSoftLandingMessages injects @D0 system steering note right before trailing assistant prefill without mutating input', () => {
    const baseWithoutPrefill: LlmChatMessage[] = [
      { role: 'system', content: '你是白虎姬' },
      { role: 'user', content: '下一步干什么' },
    ];
    const steered1 = buildRefusalSoftLandingMessages(baseWithoutPrefill, '白虎姬');
    expect(baseWithoutPrefill).toHaveLength(2);
    expect(steered1).toHaveLength(3);
    expect(steered1[2]?.role).toBe('system');
    expect(String(steered1[2]?.content)).toContain('白虎姬');
    expect(String(steered1[2]?.content)).toContain('侧面留白');

    const baseWithPrefill: LlmChatMessage[] = [
      { role: 'system', content: '你是白虎姬' },
      { role: 'user', content: '上一轮挑逗' },
      { role: 'assistant', content: '上一轮回应' },
      {
        role: 'user',
        content: '【刚才频道对话】\n[群友]: 路过\n\n【当前对你说话】\n下一步干什么',
      },
      { role: 'assistant', content: '<think>\n' },
    ];
    const steered2 = buildRefusalSoftLandingMessages(baseWithPrefill, '白虎姬');
    expect(baseWithPrefill).toHaveLength(5);
    expect(steered2).toHaveLength(6);
    expect(steered2[4]?.role).toBe('system');
    expect(String(steered2[4]?.content)).toContain('白虎姬');
    expect(steered2[5]).toEqual({ role: 'assistant', content: '<think>\n' });

    const dropped = buildRefusalSoftLandingMessages(baseWithPrefill, '白虎姬', {
      dropPriorTurns: true,
    });
    expect(dropped).toEqual([
      { role: 'system', content: '你是白虎姬' },
      { role: 'user', content: '下一步干什么' },
      steered2[4],
      { role: 'assistant', content: '<think>\n' },
    ]);
  });

  it('injects @D0 soft-landing steering only after safety refusal on primary retry and fallback', async () => {
    const db = createDatabase(':memory:');
    try {
      const guildConfigRepo = new GuildConfigRepo(db);
      const aiMemoryRepo = new AiMemoryRepo(db);
      const refusalText = '抱歉，根据安全准则我无法继续生成露骨的成人内容。';

      // Case A: Primary Attempt 1 refuses -> Attempt 2 gets soft-landing @D0 note and succeeds
      const callsA: Array<{ model: string; messages: LlmChatMessage[] }> = [];
      const clientA = new LlmClient(
        {
          baseUrl: 'https://llm.example/v1',
          apiKey: 'sk-test',
          model: 'paid/gemini-4-argon',
          fallbackModel: 'paid/gemini-4-carbon',
          timeoutMs: 5000,
          stream: false,
        },
        {
          sleepFn: async () => {},
          fetchFn: (async (_url, init) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as {
              model: string;
              messages: LlmChatMessage[];
            };
            callsA.push({ model: body.model, messages: body.messages });
            const reply =
              callsA.length === 1
                ? refusalText
                : '哼，凑这么近干嘛，先乖乖让我抱一会儿再说。';
            return new Response(
              JSON.stringify({
                model: body.model,
                choices: [{ message: { content: reply }, finish_reason: 'stop' }],
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }) as typeof fetch,
        },
      );

      const svcA = new AiService(guildConfigRepo, aiMemoryRepo, clientA, fetch);
      const resA = await svcA.generateReply(
        {
          guildId: 'g-soft-a',
          channelId: 'c-soft-a',
          userId: 'u-1',
          userName: '草莓布丁酱',
          messageId: 'm-soft-1',
          userContent: '下一步干什么',
        },
        'bot-id',
      );
      expect(resA.ok).toBe(true);
      if (!resA.ok) return;
      expect(resA.attempts).toBe(2);
      expect(resA.fallbackUsed).toBeUndefined();
      expect(callsA).toHaveLength(2);
      expect(JSON.stringify(callsA[0]?.messages)).not.toContain('侧面留白');
      expect(JSON.stringify(callsA[1]?.messages)).toContain('侧面留白');

      // Case B: Primary refuses 3 times -> Fallback Attempt 1 immediately gets soft-landing @D0 note
      const callsB: Array<{ model: string; messages: LlmChatMessage[] }> = [];
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      try {
        const clientB = new LlmClient(
          {
            baseUrl: 'https://llm.example/v1',
            apiKey: 'sk-test',
            model: 'paid/gemini-4-argon',
            fallbackModel: 'paid/gemini-4-carbon',
            timeoutMs: 5000,
            stream: false,
          },
          {
            sleepFn: async () => {},
            fetchFn: (async (_url, init) => {
              const body = JSON.parse(String(init?.body ?? '{}')) as {
                model: string;
                messages: LlmChatMessage[];
              };
              callsB.push({ model: body.model, messages: body.messages });
              const reply =
                body.model === 'paid/gemini-4-argon'
                  ? refusalText
                  : '靠这么近呼吸都烫了，先把灯关暗一点陪我待着。';
              return new Response(
                JSON.stringify({
                  model: body.model,
                  choices: [{ message: { content: reply }, finish_reason: 'stop' }],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
              );
            }) as typeof fetch,
          },
        );

        const svcB = new AiService(guildConfigRepo, aiMemoryRepo, clientB, fetch);
        const resB = await svcB.generateReply(
          {
            guildId: 'g-soft-b',
            channelId: 'c-soft-b',
            userId: 'u-1',
            userName: '草莓布丁酱',
            messageId: 'm-soft-2',
            userContent: '下一步干什么',
          },
          'bot-id',
        );
        expect(resB.ok).toBe(true);
        if (!resB.ok) return;
        expect(resB.fallbackUsed).toBe(true);
        expect(resB.model).toBe('paid/gemini-4-carbon');
        expect(resB.attempts).toBe(4);
        expect(callsB.map((c) => c.model)).toEqual([
          'paid/gemini-4-argon',
          'paid/gemini-4-argon',
          'paid/gemini-4-argon',
          'paid/gemini-4-carbon',
        ]);
        expect(JSON.stringify(callsB[0]?.messages)).not.toContain('侧面留白');
        expect(JSON.stringify(callsB[1]?.messages)).toContain('侧面留白');
        expect(JSON.stringify(callsB[3]?.messages)).toContain('侧面留白');
      } finally {
        infoSpy.mockRestore();
      }
    } finally {
      db.close();
    }
  });
});
