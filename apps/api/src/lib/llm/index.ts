// Factory + the single seam Phase 2+ consumes. Feature code calls
// `getActiveAdapter(companyId)` and never knows which provider is configured.

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

/**
 * Loads the company's single active provider and returns a ready-to-use
 * adapter (V2-2, PLAN.md §12 D20). Callers resolve their own companyId —
 * API-side from the authenticated user, worker-side from the job the queue
 * payload addresses; the seam stays thin on purpose (no getActiveAdapterForJob).
 */
export async function getActiveAdapter(companyId: string): Promise<{
  adapter: LlmAdapter;
  provider: { id: string; kind: LlmProviderKindValue; textModel: string };
}> {
  // Deterministic choice if the per-company single-active invariant is ever
  // raced by concurrent admin mutations (see schema note): oldest wins.
  // A NULL-companyId legacy row never matches this filter — that is the
  // documented "unusable until V2-3 backfills" state for pre-V2.2 rows.
  const row = await prisma.llmProvider.findFirst({
    where: { companyId, isActive: true },
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
