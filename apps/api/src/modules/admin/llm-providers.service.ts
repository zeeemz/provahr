import type { LlmProvider } from '@prisma/client';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { buildAdapterFromProvider } from '../../lib/llm';
import type { CreateProviderInput, UpdateProviderInput } from './llm-providers.schema';

/** What any admin endpoint may reveal about a provider. No ciphertext, no key — last 4 only. */
export interface RedactedProvider {
  id: string;
  kind: LlmProvider['kind'];
  baseUrl: string;
  textModel: string;
  visionModel: string | null;
  isActive: boolean;
  createdAt: Date;
  apiKeyLast4: string;
}

export function toRedactedProvider(p: {
  id: string;
  kind: LlmProvider['kind'];
  baseUrl: string;
  textModel: string;
  visionModel?: string | null;
  isActive: boolean;
  createdAt: Date;
  apiKeyEncrypted: string;
}): RedactedProvider {
  return {
    id: p.id,
    kind: p.kind,
    baseUrl: p.baseUrl,
    textModel: p.textModel,
    visionModel: p.visionModel ?? null,
    isActive: p.isActive,
    createdAt: p.createdAt,
    apiKeyLast4: decryptSecret(p.apiKeyEncrypted).slice(-4),
  };
}

async function getProviderOr404(id: string): Promise<LlmProvider> {
  const provider = await prisma.llmProvider.findUnique({ where: { id } });
  if (!provider) {
    throw new AppError(404, 'LLM provider not found', 'NOT_FOUND');
  }
  return provider;
}

export async function listProviders(): Promise<RedactedProvider[]> {
  const rows = await prisma.llmProvider.findMany({ orderBy: { createdAt: 'asc' } });
  return rows.map(toRedactedProvider);
}

export async function createProvider(input: CreateProviderInput): Promise<RedactedProvider> {
  const data = {
    kind: input.kind,
    baseUrl: input.baseUrl ?? '',
    apiKeyEncrypted: encryptSecret(input.apiKey),
    textModel: input.textModel,
    visionModel: input.visionModel ?? null,
  };
  const row = input.isActive
    ? await prisma.$transaction(async (tx) => {
        await tx.llmProvider.updateMany({ data: { isActive: false } });
        return tx.llmProvider.create({ data: { ...data, isActive: true } });
      })
    : await prisma.llmProvider.create({ data });
  return toRedactedProvider(row);
}

export async function updateProvider(id: string, input: UpdateProviderInput): Promise<RedactedProvider> {
  await getProviderOr404(id);
  const row = await prisma.llmProvider.update({
    where: { id },
    data: {
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.apiKey !== undefined ? { apiKeyEncrypted: encryptSecret(input.apiKey) } : {}),
      ...(input.textModel !== undefined ? { textModel: input.textModel } : {}),
      ...(input.visionModel !== undefined ? { visionModel: input.visionModel } : {}),
    },
  });
  return toRedactedProvider(row);
}

/** The only code path that changes which provider is active. */
export async function activateProvider(id: string): Promise<RedactedProvider> {
  await getProviderOr404(id);
  const row = await prisma.$transaction(async (tx) => {
    await tx.llmProvider.updateMany({ where: { isActive: true }, data: { isActive: false } });
    return tx.llmProvider.update({ where: { id }, data: { isActive: true } });
  });
  return toRedactedProvider(row);
}

export async function deleteProvider(id: string): Promise<void> {
  await getProviderOr404(id);
  await prisma.llmProvider.delete({ where: { id } });
}

export interface SmokeTestResult {
  ok: true;
  model: string;
  latencyMs: number;
  reply: string;
}

/** Sends a minimal real request through the provider's adapter. Failures propagate as LlmError. */
export async function smokeTest(id: string): Promise<SmokeTestResult> {
  const provider = await getProviderOr404(id);
  const adapter = buildAdapterFromProvider(provider);
  const startedAt = Date.now();
  const res = await adapter.chat({
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    maxTokens: 8,
  });
  return { ok: true, model: res.model, latencyMs: Date.now() - startedAt, reply: res.text };
}
