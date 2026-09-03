import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAiCompatibleAdapter } from '../src/lib/llm/openai-compatible';
import { AnthropicAdapter } from '../src/lib/llm/anthropic';
import { AzureOpenAiAdapter } from '../src/lib/llm/azure-openai';
import { createAdapter, buildAdapterFromProvider } from '../src/lib/llm';
import { LlmError } from '../src/lib/llm/errors';
import { encryptSecret } from '../src/lib/crypto';
import { OPENAI_TEST_KEY, ANTHROPIC_TEST_KEY, AZURE_TEST_KEY, RETRY_TEST_KEY, DEFAULT_URL_KEY, NO_BASE_URL_KEY } from './fixtures/credentials';

// Every test stubs the global fetch; responses are queued per test and built
// with the REAL Response class so res.ok/status/json()/text() behave exactly
// like production. No network, ever.

let queue: Response[];

const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
  const res = queue.shift();
  if (!res) {
    return Promise.reject(new Error('unexpected extra fetch call'));
  }
  return Promise.resolve(res);
});

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function headersOf(call: number): Record<string, string> {
  return fetchMock.mock.calls[call][1]!.headers as Record<string, string>;
}

function bodyOf(call: number): any {
  return JSON.parse(fetchMock.mock.calls[call][1]!.body as string);
}

beforeEach(() => {
  queue = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiCompatibleAdapter', () => {
  const config = {
    baseUrl: 'https://api.openai.com/v1/',
    apiKey: OPENAI_TEST_KEY,
    textModel: 'gpt-4o-mini',
  };

  it('joins the base URL (trailing slash trimmed), sends the bearer header and the system message first', async () => {
    queue.push(ok({ choices: [{ message: { content: 'hello there' } }] }));
    const adapter = new OpenAiCompatibleAdapter(config);
    const res = await adapter.chat({
      system: 'Be terse.',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res).toEqual({ text: 'hello there', model: 'gpt-4o-mini' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.openai.com/v1/chat/completions');
    expect(headersOf(0).authorization).toBe(`Bearer ${OPENAI_TEST_KEY}`);
    expect(headersOf(0)['content-type']).toBe('application/json');
    const body = bodyOf(0);
    expect(body.messages).toEqual([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'hi' },
    ]);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.max_tokens).toBe(1024);
    expect(body.response_format).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it('adds response_format json_object in jsonMode and honors maxTokens/temperature', async () => {
    queue.push(ok({ choices: [{ message: { content: '{}' } }] }));
    const adapter = new OpenAiCompatibleAdapter(config);
    await adapter.chat({
      messages: [{ role: 'user', content: 'give me json' }],
      jsonMode: true,
      maxTokens: 64,
      temperature: 0.2,
    });
    const body = bodyOf(0);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_tokens).toBe(64);
    expect(body.temperature).toBe(0.2);
  });

  it('attaches images as data-URL parts on the last user message', async () => {
    queue.push(ok({ choices: [{ message: { content: 'a cat' } }] }));
    const adapter = new OpenAiCompatibleAdapter(config);
    await adapter.chat({
      messages: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'an answer' },
        { role: 'user', content: 'what is this?' },
      ],
      images: [
        { mediaType: 'image/png', base64: 'aGk=' },
        { mediaType: 'image/jpeg', base64: 'AA==' },
      ],
    });
    const messages = bodyOf(0).messages;
    expect(messages[0]).toEqual({ role: 'user', content: 'first question' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'an answer' });
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } },
    ]);
  });
});

describe('AnthropicAdapter', () => {
  const config = {
    baseUrl: 'https://api.anthropic.com',
    apiKey: ANTHROPIC_TEST_KEY,
    textModel: 'claude-sonnet-4-20250514',
  };

  it('posts to /v1/messages with x-api-key + anthropic-version and system as a top-level field', async () => {
    queue.push(ok({ content: [{ type: 'text', text: 'part one ' }, { type: 'text', text: 'two' }, { type: 'other' }] }));
    const adapter = new AnthropicAdapter(config);
    const res = await adapter.chat({
      system: 'Be terse.',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res).toEqual({ text: 'part one two', model: 'claude-sonnet-4-20250514' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.anthropic.com/v1/messages');
    const headers = headersOf(0);
    expect(headers['x-api-key']).toBe(ANTHROPIC_TEST_KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBeUndefined();
    const body = bodyOf(0);
    expect(body.system).toBe('Be terse.');
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.max_tokens).toBe(1024);
  });

  it('emulates jsonMode via a system-prompt suffix (created when absent)', async () => {
    queue.push(ok({ content: [{ type: 'text', text: '{}' }] }));
    queue.push(ok({ content: [{ type: 'text', text: '{}' }] }));
    const adapter = new AnthropicAdapter(config);

    await adapter.chat({ system: 'Grade resumes.', messages: [{ role: 'user', content: 'go' }], jsonMode: true });
    expect(bodyOf(0).system).toBe('Grade resumes. Respond with a single valid JSON object and nothing else.');
    expect(bodyOf(0).response_format).toBeUndefined();

    await adapter.chat({ messages: [{ role: 'user', content: 'go' }], jsonMode: true });
    expect(bodyOf(1).system).toBe('Respond with a single valid JSON object and nothing else.');
  });

  it('attaches images as base64 source blocks', async () => {
    queue.push(ok({ content: [{ type: 'text', text: 'seen' }] }));
    const adapter = new AnthropicAdapter(config);
    await adapter.chat({
      messages: [{ role: 'user', content: 'look' }],
      images: [{ mediaType: 'image/webp', base64: 'abcd' }],
    });
    expect(bodyOf(0).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: 'abcd' } },
        ],
      },
    ]);
  });
});

describe('AzureOpenAiAdapter', () => {
  const config = {
    baseUrl: 'https://provahr-llm.openai.azure.com',
    apiKey: AZURE_TEST_KEY,
    textModel: 'dep-gpt-4o',
  };

  it('targets the deployment path with the api-key header and NO Authorization', async () => {
    queue.push(ok({ choices: [{ message: { content: 'azure says hi' } }] }));
    const adapter = new AzureOpenAiAdapter(config);
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(res.text).toBe('azure says hi');
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://provahr-llm.openai.azure.com/openai/deployments/dep-gpt-4o/chat/completions?api-version=2024-10-21',
    );
    const headers = headersOf(0);
    expect(headers['api-key']).toBe(AZURE_TEST_KEY);
    expect(headers.authorization).toBeUndefined();
    expect(bodyOf(0).max_tokens).toBe(1024);
  });
});

describe('transport behavior (postJson)', () => {
  const config = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: RETRY_TEST_KEY,
    textModel: 'gpt-4o-mini',
  };

  it('retries exactly once on HTTP 429 and then succeeds', async () => {
    queue.push(new Response('rate limited', { status: 429 }));
    queue.push(ok({ choices: [{ message: { content: 'second try' } }] }));
    const adapter = new OpenAiCompatibleAdapter(config);
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });

    expect(res.text).toBe('second try');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on HTTP 400 — exactly one call, LlmError thrown, provider status collapsed to 502', async () => {
    queue.push(new Response('{"error":{"code":"bad_request"}}', { status: 400 }));
    const adapter = new OpenAiCompatibleAdapter(config);
    const err = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmError);
    // The provider's raw status must never become OUR status (QA wave-2 F4) —
    // a provider 401 colliding with ProvaHR's own auth semantics.
    expect((err as LlmError).statusCode).toBe(502);
    expect((err as LlmError).message).toContain('LLM provider request failed (status 400)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('scrubs the API key from the thrown LlmError message and detail', async () => {
    queue.push(new Response(JSON.stringify({ error: `Invalid API key ${RETRY_TEST_KEY} supplied` }), { status: 401 }));
    const adapter = new OpenAiCompatibleAdapter(config);
    const err = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmError);
    const llmErr = err as LlmError;
    expect(llmErr.message).toContain('***');
    expect(llmErr.message).not.toContain(RETRY_TEST_KEY);
    expect(llmErr.detail).toContain('***');
    expect(llmErr.detail).not.toContain(RETRY_TEST_KEY);
  });

  it('maps network failures to a 504 LlmError without retrying', async () => {
    const failing = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    vi.stubGlobal('fetch', failing);
    const adapter = new OpenAiCompatibleAdapter(config);
    const err = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).statusCode).toBe(504);
    expect((err as LlmError).message).toBe('LLM provider unreachable');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('throws a 502 LlmError on a malformed provider response', async () => {
    queue.push(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    const adapter = new OpenAiCompatibleAdapter(config);
    const err = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).statusCode).toBe(502);
    expect((err as LlmError).message).toBe('Malformed provider response');
  });
});

describe('createAdapter / buildAdapterFromProvider', () => {
  it('fills default base URLs when config.baseUrl is empty', async () => {
    queue.push(ok({ choices: [{ message: { content: 'x' } }] }));
    const adapter = createAdapter('OPENAI_COMPATIBLE', {
      baseUrl: '',
      apiKey: DEFAULT_URL_KEY,
      textModel: 'gpt-4o-mini',
    });
    expect(adapter.kind).toBe('OPENAI_COMPATIBLE');
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('buildAdapterFromProvider decrypts the stored key and resolves defaults (pure, no DB)', async () => {
    queue.push(ok({ content: [{ type: 'text', text: 'from anthropic' }] }));
    const adapter = buildAdapterFromProvider({
      kind: 'ANTHROPIC',
      baseUrl: '',
      apiKeyEncrypted: encryptSecret('sk-ant-from-row-42'),
      textModel: 'claude-sonnet-4-20250514',
      visionModel: null,
    });
    expect(adapter.kind).toBe('ANTHROPIC');
    const res = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('from anthropic');
    expect(headersOf(0)['x-api-key']).toBe('sk-ant-from-row-42');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.anthropic.com/v1/messages');
  });

  it('rejects Azure with an empty baseUrl (no default exists)', () => {
    expect(() =>
      createAdapter('AZURE_OPENAI', { baseUrl: '', apiKey: NO_BASE_URL_KEY, textModel: 'dep' }),
    ).toThrowError(/baseUrl/);
  });
});
