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
});
