// Provider-agnostic chat interface. Phase 2+ features (resume screening,
// scorecard drafting, ...) code against `LlmAdapter`, never an SDK.

export type LlmProviderKindValue = 'OPENAI_COMPATIBLE' | 'ANTHROPIC' | 'AZURE_OPENAI';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  base64: string;
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  jsonMode?: boolean;
  images?: ChatImage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  text: string;
  model: string;
}

export interface AdapterConfig {
  baseUrl: string;
  apiKey: string;
  textModel: string;
  visionModel?: string;
}

export interface LlmAdapter {
  readonly kind: LlmProviderKindValue;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
