// Transport + shared request-shaping for LLM providers. Uses the global fetch
// (Node 22 / undici) — zero new dependencies. Never logs anything: request
// bodies and headers carry secrets.

import { LlmError } from './errors';
import type { ChatMessage, ChatRequest } from './types';

export interface PostJsonOptions {
  timeoutMs?: number;
  retries?: number;
  /** Secret scrubbed from any error message/detail (the provider API key). */
  scrub?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const RETRY_BACKOFF_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POSTs `body` as JSON and returns the parsed response. Retries (once by
 * default, 300ms backoff) on HTTP 429 and >= 500 only; network failures and
 * timeouts are NOT retried. Non-2xx after retries → LlmError carrying at most
 * 300 chars of the (scrubbed) response body in `detail`.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: PostJsonOptions = {},
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? 1;
  const payload = JSON.stringify(body);

  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BACKOFF_MS);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Network error or timeout — not retryable by policy.
      throw new LlmError(504, 'LLM provider unreachable', undefined, opts.scrub);
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new LlmError(502, 'Malformed provider response', undefined, opts.scrub);
      }
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      continue;
    }

    const text = await res.text();
    const excerpt = text.slice(0, 120).trim();
    const message = excerpt
      ? `LLM provider request failed (status ${res.status}): ${excerpt}`
      : `LLM provider request failed (status ${res.status})`;
    // Always surface 502 to OUR clients — never the provider's raw status,
    // which collides with ProvaHR's own auth semantics (a provider 401 is not
    // the admin's session expiring). QA wave-2 F4.
    throw new LlmError(502, message, text.slice(0, 300), opts.scrub);
  }
}

// ─── Shared OpenAI-style request shaping ─────────────────────────────────────
// Azure OpenAI speaks the same chat/completions body/response shape as the
// OpenAI REST API, so both adapters use these helpers.

function lastUserMessageIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return i;
    }
  }
  return -1;
}

/** Builds the OpenAI-style chat/completions request body. */
export function buildOpenAiChatBody(req: ChatRequest, model: string): Record<string, unknown> {
  const attachIndex = req.images && req.images.length > 0 ? lastUserMessageIndex(req.messages) : -1;
  if (req.images && req.images.length > 0 && attachIndex === -1) {
    throw new LlmError(400, 'Images require at least one user message');
  }

  const messages = req.messages.map((m, i) => {
    if (i !== attachIndex) {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: [
        { type: 'text', text: m.content },
        ...req.images!.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
        })),
      ],
    };
  });

  return {
    model,
    ...(req.system !== undefined ? { messages: [{ role: 'system', content: req.system }, ...messages] } : { messages }),
    max_tokens: req.maxTokens ?? 1024,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
}

/** Extracts `choices[0].message.content` from an OpenAI-style response. */
export function parseOpenAiChatResponse(data: unknown): string {
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]
    ?.message?.content;
  if (typeof content !== 'string') {
    throw new LlmError(502, 'Malformed provider response');
  }
  return content;
}
