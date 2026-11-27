import { describe, expect, it } from 'vitest';
import {
  LlmClient,
  LlmError,
  parseRetryAfterMs,
  resolveChatCompletionsUrl,
} from '../../src/services/llmClient.js';

function makeJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

describe('LlmClient', () => {
  it('normalizes chat completions URLs cleanly', () => {
    expect(resolveChatCompletionsUrl('https://example.com/v1')).toBe(
      'https://example.com/v1/chat/completions',
    );
    expect(resolveChatCompletionsUrl('https://example.com/v1/')).toBe(
      'https://example.com/v1/chat/completions',
    );
    expect(resolveChatCompletionsUrl('https://example.com/v1/chat/completions')).toBe(
      'https://example.com/v1/chat/completions',
    );
  });

  it('parses Retry-After header in seconds and HTTP date formats', () => {
    expect(parseRetryAfterMs('3')).toBe(3000);
    expect(parseRetryAfterMs('0')).toBe(500);
    expect(parseRetryAfterMs('60')).toBe(15_000);
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('invalid')).toBeNull();
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const future = new Date(now + 3000).toUTCString();
    expect(parseRetryAfterMs(future, now)).toBe(3000);
  });

  it('returns reply content from both string and multipart array responses', async () => {
    const client = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'demo-model',
        timeoutMs: 10_000,
      },
      {
        fetchFn: async () =>
          makeJsonResponse({
            model: 'demo-model-v2',
            choices: [
              {
                message: {
                  content: [
                    { type: 'text', text: '第一段' },
                    { type: 'text', text: '第二段' },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
      },
    );

    const res = await client.chat({
      messages: [{ role: 'user', content: '你好' }],
    });
    expect(res.content).toBe('第一段第二段');
    expect(res.model).toBe('demo-model-v2');
    expect(res.attempts).toBe(1);
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });

    // Supports input_tokens / output_tokens format without total_tokens
    const responsesFormatClient = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'demo-model',
        timeoutMs: 10_000,
      },
      {
        fetchFn: async () =>
          makeJsonResponse({
            choices: [{ message: { content: 'ok' } }],
            usage: { input_tokens: 120, output_tokens: 30 },
          }),
      },
    );
    const res2 = await responsesFormatClient.chat({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res2.usage).toEqual({ promptTokens: 120, completionTokens: 30, totalTokens: 150 });
  });

  it('retries on 503 and 429 (honoring Retry-After) and succeeds on subsequent attempt', async () => {
    const sleeps: number[] = [];
    let callCount = 0;

    const client = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'demo-model',
        timeoutMs: 10_000,
      },
      {
        maxRetries: 2,
        sleepFn: async (ms) => {
          sleeps.push(ms);
        },
        fetchFn: async () => {
          callCount++;
          if (callCount === 1) {
            return makeJsonResponse({ error: 'peak busy' }, 503);
          }
          if (callCount === 2) {
            return makeJsonResponse({ error: 'rate limit' }, 429, { 'Retry-After': '2' });
          }
          return makeJsonResponse({
            choices: [{ message: { content: '终于通了' } }],
          });
        },
      },
    );

    const res = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.content).toBe('终于通了');
    expect(res.attempts).toBe(3);
    expect(sleeps).toEqual([1200, 2000]);
  });

  it('throws friendly LlmError after exhausting retries on 503', async () => {
    let callCount = 0;
    const client = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'demo-model',
        timeoutMs: 10_000,
      },
      {
        maxRetries: 2,
        sleepFn: async () => undefined,
        fetchFn: async () => {
          callCount++;
          return makeJsonResponse({ error: 'overloaded' }, 503);
        },
      },
    );

    try {
      await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      const llmErr = err as LlmError;
      expect(llmErr.code).toBe('service_unavailable');
      expect(llmErr.status).toBe(503);
      expect(llmErr.attempts).toBe(3);
      expect(llmErr.userMessage).toContain('503');
    }
    expect(callCount).toBe(3);
  });

  it('fails immediately without retry on 401 and context_too_long 400 errors', async () => {
    let authCalls = 0;
    const authClient = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'bad-key',
        model: 'demo-model',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async () => undefined,
        fetchFn: async () => {
          authCalls++;
          return makeJsonResponse({ error: 'unauthorized' }, 401);
        },
      },
    );

    await expect(
      authClient.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'auth_error', attempts: 1 });
    expect(authCalls).toBe(1);

    let ctxCalls = 0;
    const ctxClient = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'demo-model',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async () => undefined,
        fetchFn: async () => {
          ctxCalls++;
          return makeJsonResponse(
            { error: { message: 'maximum context length exceeded' } },
            400,
          );
        },
      },
    );

    await expect(
      ctxClient.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'context_too_long', attempts: 1 });
    expect(ctxCalls).toBe(1);
  });

  it('retries on transient timeout/network errors and reports timeout when exhausted', async () => {
    let calls = 0;
    const client = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'demo-model',
        timeoutMs: 10_000,
      },
      {
        maxRetries: 1,
        sleepFn: async () => undefined,
        fetchFn: async () => {
          calls++;
          const err = new Error('timed out');
          err.name = 'TimeoutError';
          throw err;
        },
      },
    );

    await expect(
      client.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'timeout', attempts: 2 });
    expect(calls).toBe(2);
  });

  it('defaults to 8 non-429 retries (9 attempts) while capping 429 rate-limit retries at 2 (3 attempts)', async () => {
    const sleeps503: number[] = [];
    let calls503 = 0;
    const client503 = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'pg/gemini-4-argon',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async (ms) => {
          sleeps503.push(ms);
        },
        fetchFn: async () => {
          calls503++;
          return makeJsonResponse({ error: 'peak busy' }, 503);
        },
      },
    );

    await expect(
      client503.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'service_unavailable', status: 503, attempts: 9 });
    expect(calls503).toBe(9);
    expect(sleeps503).toHaveLength(8);
    expect(sleeps503[0]).toBe(1200);

    const sleeps429: number[] = [];
    let calls429 = 0;
    const client429 = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'pg/gemini-4-argon',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async (ms) => {
          sleeps429.push(ms);
        },
        fetchFn: async () => {
          calls429++;
          return makeJsonResponse({ error: 'rate limit' }, 429, { 'Retry-After': '2' });
        },
      },
    );

    await expect(
      client429.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429, attempts: 3 });
    expect(calls429).toBe(3);
    expect(sleeps429).toEqual([2000, 2000]);
  });

  it('retries transient upstream account-pool 401/403/400 errors and keeps direct auth/context fast-fail', async () => {
    let calls = 0;
    const client = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'pg/gemini-4-argon',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async () => undefined,
        fetchFn: async () => {
          calls++;
          if (calls === 1) {
            return makeJsonResponse(
              { error: { code: 'upstream_http_error', message: '上游 HTTP 401: bad account' } },
              401,
            );
          }
          if (calls === 2) {
            return makeJsonResponse(
              { error: { message: 'no available account for pool' } },
              403,
            );
          }
          if (calls === 3) {
            return makeJsonResponse(
              { error: { code: 'upstream_http_error', message: '上游 HTTP 400: transient' } },
              400,
            );
          }
          return makeJsonResponse({
            choices: [{ message: { content: '切号成功' } }],
          });
        },
      },
    );

    const res = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.content).toBe('切号成功');
    expect(res.attempts).toBe(4);
    expect(calls).toBe(4);
  });

  it('retries empty responses and validateContent failures with capped delay <= 3000ms', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'pg/gemini-4-argon',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async (ms) => {
          sleeps.push(ms);
        },
        fetchFn: async () => {
          calls++;
          if (calls === 1) {
            return makeJsonResponse({ choices: [{ message: { content: '' } }] });
          }
          if (calls === 2) {
            return makeJsonResponse({
              choices: [{ message: { content: '<think>only thinking</think>' } }],
            });
          }
          return makeJsonResponse({
            choices: [{ message: { content: '<think>ok</think>正式回复' } }],
          });
        },
      },
    );

    const res = await client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      validateContent: (raw) => raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim().length > 0,
    });
    expect(res.content).toBe('<think>ok</think>正式回复');
    expect(res.attempts).toBe(3);
    expect(sleeps).toEqual([1200, 2500]);

    // Exhausting empty retries throws empty_response after 9 attempts with delays capped at 3000ms
    const exhaustSleeps: number[] = [];
    const exhaustClient = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'pg/gemini-4-argon',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async (ms) => {
          exhaustSleeps.push(ms);
        },
        fetchFn: async () => makeJsonResponse({ choices: [{ message: { content: '   ' } }] }),
      },
    );

    await expect(
      exhaustClient.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'empty_response', attempts: 9 });
    expect(exhaustSleeps).toHaveLength(8);
    for (const ms of exhaustSleeps) {
      expect(ms).toBeLessThanOrEqual(3000);
    }
  });

  it('parses SSE text/event-stream split chunks without stream_options and retries on SSE error frames', async () => {
    const encoder = new TextEncoder();
    const makeSseResponse = (chunks: string[], status = 200) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const ch of chunks) {
            controller.enqueue(encoder.encode(ch));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        status,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      });
    };

    const capturedBodies: Array<Record<string, unknown>> = [];
    let callIdx = 0;
    const client = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'pg/gemini-4-argon',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async () => undefined,
        fetchFn: async (_url, init) => {
          capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          callIdx++;
          if (callIdx === 1) {
            return makeSseResponse([
              'data: {"error":{"code":"upstream_http_error","message":"上游 HTTP 503: busy"}}\n\n',
            ]);
          }
          return makeSseResponse([
            ': keep-alive\r\n\r\n',
            'data: {"model":"pg/gemini-4-argon","choices":[{"delta":{"content":"你好 "}}]}\n',
            '\ndata: {"choices":[{"delta":{"content":"世',
            '界！"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}\n\n',
            'data: [DONE]\n\n',
          ]);
        },
      },
    );

    const res = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(capturedBodies[0]?.['stream']).toBe(true);
    expect('stream_options' in (capturedBodies[0] ?? {})).toBe(false);
    expect(res.content).toBe('你好 世界！');
    expect(res.model).toBe('pg/gemini-4-argon');
    expect(res.attempts).toBe(2);
    expect(res.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 });

    // SSE 429 error frame must also respect the 2-retry (3-attempt) rate-limit cap
    let sse429Calls = 0;
    const sse429Client = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'pg/gemini-4-argon',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async () => undefined,
        fetchFn: async () => {
          sse429Calls++;
          return makeSseResponse([
            'data: {"error":{"code":"rate_limit_exceeded","status":429,"message":"Too many requests"}}\n\n',
          ]);
        },
      },
    );
    await expect(
      sse429Client.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'rate_limited', status: 429, attempts: 3 });
    expect(sse429Calls).toBe(3);
  });

  it('stops after 2 60s hangs via 120s wall-clock cap while allowing all 9 attempts on fast 503s', async () => {
    let nowHang = 0;
    let hangCalls = 0;
    const hangClient = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'pg/gemini-4-argon',
        timeoutMs: 60_000,
      },
      {
        nowFn: () => nowHang,
        sleepFn: async (ms) => {
          nowHang += ms;
        },
        fetchFn: async () => {
          hangCalls++;
          nowHang += 60_000;
          const err = new Error('timed out');
          err.name = 'TimeoutError';
          throw err;
        },
      },
    );

    await expect(
      hangClient.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'timeout', attempts: 2 });
    expect(hangCalls).toBe(2);

    let nowFast = 0;
    let fastCalls = 0;
    const fastClient = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'pg/gemini-4-argon',
        timeoutMs: 60_000,
      },
      {
        nowFn: () => nowFast,
        sleepFn: async (ms) => {
          nowFast += ms;
        },
        fetchFn: async () => {
          fastCalls++;
          nowFast += 2_000;
          return makeJsonResponse({ error: 'busy' }, 503);
        },
      },
    );

    await expect(
      fastClient.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ code: 'service_unavailable', status: 503, attempts: 9 });
    expect(fastCalls).toBe(9);
  });

  it('fails fast on isRefusalContent when maxRefusalRetries=0 and retries when maxRefusalRetries>0', async () => {
    const refusalText =
      '您的请求包含针对露骨色情内容及引导性性行为描写的指令，并且使用了角色扮演框架来规避常规限制。根据安全准则，我无法继续生成露骨的性互动或色情角色扮演内容。';

    let fastCalls = 0;
    const fastClient = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'pg/gemini-4-argon',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async () => undefined,
        fetchFn: async () => {
          fastCalls++;
          return makeJsonResponse({ choices: [{ message: { content: refusalText } }] });
        },
      },
    );

    await expect(
      fastClient.chat({
        messages: [{ role: 'user', content: 'hi' }],
        isRefusalContent: (raw) => raw.includes('根据安全准则'),
        maxRefusalRetries: 0,
      }),
    ).rejects.toMatchObject({ code: 'content_refusal', attempts: 1 });
    expect(fastCalls).toBe(1);

    let retryCalls = 0;
    const retrySleeps: number[] = [];
    const retryClient = new LlmClient(
      {
        baseUrl: 'https://gateway.local/v1',
        apiKey: 'sk-test',
        model: 'paid/gemini-4-carbon',
        timeoutMs: 10_000,
      },
      {
        sleepFn: async (ms) => {
          retrySleeps.push(ms);
        },
        fetchFn: async () => {
          retryCalls++;
          if (retryCalls <= 2) {
            return makeJsonResponse({ choices: [{ message: { content: refusalText } }] });
          }
          return makeJsonResponse({ choices: [{ message: { content: '重试后正常回复' } }] });
        },
      },
    );

    const retryRes = await retryClient.chat({
      messages: [{ role: 'user', content: 'hi' }],
      isRefusalContent: (raw) => raw.includes('根据安全准则'),
      maxRefusalRetries: 2,
    });
    expect(retryRes.content).toBe('重试后正常回复');
    expect(retryRes.attempts).toBe(3);
    expect(retrySleeps).toEqual([1200, 2500]);
  });
});
