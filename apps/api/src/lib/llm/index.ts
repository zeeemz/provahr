// Factory + the single seam Phase 2+ consumes. Feature code calls
// `getActiveAdapter()` and never knows which provider is configured.

import { prisma } from '../../prisma';
import { AppError } from '../http';
import { decryptSecret } from '../crypto';
import type { AdapterConfig, LlmAdapter, LlmProviderKindValue } from './types';
import { OpenAiCompatibleAdapter } from './openai-compatible';
import { AnthropicAdapter } from './anthropic';
import { AzureOpenAiAdapter } from './azure-openai';

export type { ChatMessage, ChatImage, ChatRequest, ChatResponse, AdapterConfig, LlmAdapter, LlmProviderKindValue } from './types';
export { LlmError, redactSecret } from './errors';

const DEFAULT_BASE_URLS: Record<LlmProviderKindValue, string> = {
  OPENAI_COMPATIBLE: 'https://api.openai.com/v1',
  ANTHROPIC: 'https://api.anthropic.com',
  // Azure has no default: the org's resource URL is mandatory.
  AZURE_OPENAI: '',
};

/** Builds an adapter, filling the kind's default baseUrl when empty. */
export function createAdapter(kind: LlmProviderKindValue, config: AdapterConfig): LlmAdapter {
  const baseUrl = config.baseUrl.trim() !== '' ? config.baseUrl : DEFAULT_BASE_URLS[kind];
  const resolved: AdapterConfig = { ...config, baseUrl };
  switch (kind) {
    case 'OPENAI_COMPATIBLE':
      return new OpenAiCompatibleAdapter(resolved);
    case 'ANTHROPIC':
      return new AnthropicAdapter(resolved);
    case 'AZURE_OPENAI':
      return new AzureOpenAiAdapter(resolved);
    default: {
      const exhaustive: never = kind;
      throw new AppError(500, `Unknown LLM provider kind: ${String(exhaustive)}`, 'LLM_MISCONFIGURED');
    }
  }
}

/** Minimal shape `buildAdapterFromProvider` needs from an `llm_providers` row. */
export interface ProviderRowLike {
  kind: LlmProviderKindValue;
  baseUrl: string;
  apiKeyEncrypted: string;
  textModel: string;
  visionModel?: string | null;
}

/** Pure row → adapter mapping (decrypts the stored key). No database access. */
export function buildAdapterFromProvider(provider: ProviderRowLike): LlmAdapter {
  return createAdapter(provider.kind, {
    baseUrl: provider.baseUrl,
    apiKey: decryptSecret(provider.apiKeyEncrypted),
    textModel: provider.textModel,
    visionModel: provider.visionModel ?? undefined,
  });
}

/** Loads the single active provider and returns a ready-to-use adapter. */
export async function getActiveAdapter(): Promise<{
  adapter: LlmAdapter;
  provider: { id: string; kind: LlmProviderKindValue; textModel: string };
}> {
  // Deterministic choice if the code-level single-active invariant is ever
  // raced by concurrent admin mutations (see schema note): oldest wins.
  const row = await prisma.llmProvider.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!row) {
    throw new AppError(503, 'No active LLM provider configured — add one via /api/admin/llm-providers', 'NO_PROVIDER');
  }
  return {
    adapter: buildAdapterFromProvider(row),
    provider: { id: row.id, kind: row.kind, textModel: row.textModel },
  };
}
