// OpenAI-compatible chat/completions adapter. Works with OpenAI itself and
// any API that mirrors it (OpenRouter, Ollama, vLLM, LM Studio, ...).

import { AppError } from '../http';
import { postJson, buildOpenAiChatBody, parseOpenAiChatResponse } from './http';
import type { AdapterConfig, ChatRequest, ChatResponse, LlmAdapter, LlmProviderKindValue } from './types';

export class OpenAiCompatibleAdapter implements LlmAdapter {
  public readonly kind: LlmProviderKindValue = 'OPENAI_COMPATIBLE';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly textModel: string;

  constructor(config: AdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.textModel = config.textModel;
    if (this.baseUrl.length === 0) {
      throw new AppError(500, 'OpenAI-compatible adapter requires a baseUrl', 'LLM_MISCONFIGURED');
    }
    if (this.apiKey.length === 0 || this.textModel.length === 0) {
      throw new AppError(500, 'LLM adapter requires an apiKey and a model', 'LLM_MISCONFIGURED');
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const data = await postJson(
      `${this.baseUrl}/chat/completions`,
      {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      buildOpenAiChatBody(req, this.textModel),
      { scrub: this.apiKey },
    );
    return { text: parseOpenAiChatResponse(data), model: this.textModel };
  }
}
