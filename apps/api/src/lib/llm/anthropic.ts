// Anthropic Messages API adapter. Anthropic has no native JSON mode, so
// jsonMode is emulated with a system-prompt suffix instead of a request flag.

import { AppError } from '../http';
import { postJson } from './http';
import { LlmError } from './errors';
import type { AdapterConfig, ChatMessage, ChatRequest, ChatResponse, LlmAdapter, LlmProviderKindValue } from './types';

const JSON_MODE_SUFFIX = 'Respond with a single valid JSON object and nothing else.';

interface ContentBlock {
  type: string;
  text?: string;
}

function buildAnthropicMessages(req: ChatRequest): Array<{ role: string; content: unknown }> {
  let attachIndex = -1;
  for (let i = req.messages.length - 1; i >= 0; i--) {
    if (req.messages[i].role === 'user') {
      attachIndex = i;
      break;
    }
  }
  if (req.images && req.images.length > 0 && attachIndex === -1) {
    throw new LlmError(400, 'Images require at least one user message');
  }

  return req.messages.map((m: ChatMessage, i: number) => {
    if (i !== attachIndex || !req.images || req.images.length === 0) {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: [
        { type: 'text', text: m.content },
        ...req.images.map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
        })),
      ],
    };
  });
}

function parseAnthropicResponse(data: unknown): string {
  const blocks = (data as { content?: ContentBlock[] } | null)?.content;
  if (!Array.isArray(blocks)) {
    throw new LlmError(502, 'Malformed provider response');
  }
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

export class AnthropicAdapter implements LlmAdapter {
  public readonly kind: LlmProviderKindValue = 'ANTHROPIC';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly textModel: string;

  constructor(config: AdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.textModel = config.textModel;
    if (this.baseUrl.length === 0) {
      throw new AppError(500, 'Anthropic adapter requires a baseUrl', 'LLM_MISCONFIGURED');
    }
    if (this.apiKey.length === 0 || this.textModel.length === 0) {
      throw new AppError(500, 'LLM adapter requires an apiKey and a model', 'LLM_MISCONFIGURED');
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // No native JSON mode on Anthropic — instruct via the system prompt.
    let system: string | undefined = req.system;
    if (req.jsonMode) {
      system = system ? `${system} ${JSON_MODE_SUFFIX}` : JSON_MODE_SUFFIX;
    }

    const data = await postJson(
      `${this.baseUrl}/v1/messages`,
      {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      {
        model: this.textModel,
        ...(system !== undefined ? { system } : {}),
        messages: buildAnthropicMessages(req),
        max_tokens: req.maxTokens ?? 1024,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
      { scrub: this.apiKey },
    );
    return { text: parseAnthropicResponse(data), model: this.textModel };
  }
}
