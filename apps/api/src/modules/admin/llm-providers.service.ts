import type { LlmProvider } from '@prisma/client';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { buildAdapterFromProvider } from '../../lib/llm';
import type { CreateProviderInput, UpdateProviderInput } from './llm-providers.schema';

// V2-2 (PLAN.md §12 D20): providers are company-scoped tenant resources.
// Every function below takes the caller's companyId and every query filters
// on it — a provider of another company is indistinguishable from a missing
// one (same 404, no existence oracle). Routes pass req.user!.companyId!,
// guaranteed non-null because requireRole('ADMIN') never admits the
// company-less SUPER_ADMIN.

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

async function getProviderOr404(id: string, companyId: string): Promise<LlmProvider> {
  // findFirst, not findUnique: the companyId half of the compound lookup is a
  // filter, so another company's provider resolves to the same 404.
  const provider = await prisma.llmProvider.findFirst({ where: { id, companyId } });
  if (!provider) {
    throw new AppError(404, 'LLM provider not found', 'NOT_FOUND');
  }
  return provider;
}

export async function listProviders(companyId: string): Promise<RedactedProvider[]> {
  const rows = await prisma.llmProvider.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } });
  return rows.map(toRedactedProvider);
}

export async function createProvider(companyId: string, input: CreateProviderInput): Promise<RedactedProvider> {
  const data = {
    companyId,
    kind: input.kind,
    baseUrl: input.baseUrl ?? '',
    apiKeyEncrypted: encryptSecret(input.apiKey),
    textModel: input.textModel,
    visionModel: input.visionModel ?? null,
  };
  const row = input.isActive
    ? await prisma.$transaction(async (tx) => {
        // Deactivate only THIS company's providers — per-company single-active.
        await tx.llmProvider.updateMany({ where: { companyId }, data: { isActive: false } });
        return tx.llmProvider.create({ data: { ...data, isActive: true } });
      })
    : await prisma.llmProvider.create({ data });
  return toRedactedProvider(row);
}

export async function updateProvider(companyId: string, id: string, input: UpdateProviderInput): Promise<RedactedProvider> {
  await getProviderOr404(id, companyId);
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

/** The only code path that changes which provider is active (per company). */
export async function activateProvider(companyId: string, id: string): Promise<RedactedProvider> {
  await getProviderOr404(id, companyId);
  const row = await prisma.$transaction(async (tx) => {
    await tx.llmProvider.updateMany({ where: { companyId, isActive: true }, data: { isActive: false } });
    return tx.llmProvider.update({ where: { id }, data: { isActive: true } });
  });
  return toRedactedProvider(row);
}

export async function deleteProvider(companyId: string, id: string): Promise<void> {
  await getProviderOr404(id, companyId);
  await prisma.llmProvider.delete({ where: { id } });
}

export interface SmokeTestResult {
  ok: true;
  model: string;
  latencyMs: number;
  reply: string;
}

/** Sends a minimal real request through the provider's adapter. Failures propagate as LlmError. */
export async function smokeTest(companyId: string, id: string): Promise<SmokeTestResult> {
  const provider = await getProviderOr404(id, companyId);
  const adapter = buildAdapterFromProvider(provider);
  const startedAt = Date.now();
  const res = await adapter.chat({
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    maxTokens: 8,
  });
  return { ok: true, model: res.model, latencyMs: Date.now() - startedAt, reply: res.text };
}
