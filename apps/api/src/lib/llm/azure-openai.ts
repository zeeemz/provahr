// Azure OpenAI adapter — the org's own tenant. Azure authenticates with the
// `api-key` header (NOT Bearer) and addresses models by DEPLOYMENT name in
// the path, so `config.textModel` must be the deployment name. The
// api-version is pinned here so behavior cannot drift per request.

import { AppError } from '../http';
import { postJson, buildOpenAiChatBody, parseOpenAiChatResponse } from './http';
import type { AdapterConfig, ChatRequest, ChatResponse, LlmAdapter, LlmProviderKindValue } from './types';

const API_VERSION = '2024-10-21';

export class AzureOpenAiAdapter implements LlmAdapter {
  public readonly kind: LlmProviderKindValue = 'AZURE_OPENAI';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly textModel: string;

  constructor(config: AdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.textModel = config.textModel;
    // No default: the resource URL is mandatory on Azure.
    if (this.baseUrl.length === 0) {
      throw new AppError(500, 'Azure OpenAI adapter requires a baseUrl (https://<resource>.openai.azure.com)', 'LLM_MISCONFIGURED');
    }
    if (this.apiKey.length === 0 || this.textModel.length === 0) {
      throw new AppError(500, 'LLM adapter requires an apiKey and a deployment name', 'LLM_MISCONFIGURED');
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const url =
      `${this.baseUrl}/openai/deployments/${encodeURIComponent(this.textModel)}` +
      `/chat/completions?api-version=${API_VERSION}`;
    const data = await postJson(
      url,
      {
        'api-key': this.apiKey,
        'content-type': 'application/json',
      },
      buildOpenAiChatBody(req, this.textModel),
      { scrub: this.apiKey },
    );
    return { text: parseOpenAiChatResponse(data), model: this.textModel };
  }
}
