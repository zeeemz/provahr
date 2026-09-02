// Test blueprint + sealed question pool service (PLAN.md Phase 3, §5).
//
// Flow: HR PUTs a blueprint (requires an approved JD) describing WHAT the
// test covers — topics, format mix, counts, difficulty, time limit; never a
// question. POST .../blueprint/samples queues preview items HR may look at;
// POST .../pool/seal queues the worker to generate ≥6× the draw size per
// format, validate every item, and store them AES-256-GCM-encrypted. No
// function in this module ever returns decrypted pool items: the only
// pool-facing DTO is { hasActivePool, version/poolVersion, itemCount,
// sealedAt }. Sealing again requires the reseal route, which destroys the old
// pool first (PLAN §5.1: a stolen database dump ages out of usefulness).
//
// API-side functions are company-scoped; `runSamplesGeneration` /
// `runPoolSeal` are worker-side and address the job by id directly (same
// split as jd.service.ts).

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { enqueue } from '../../lib/queue';
import { encryptSecret } from '../../lib/crypto';
import { getActiveAdapter, type LlmAdapter } from '../../lib/llm';
import { ITEM_SYSTEM_PROMPT, buildItemsUserPrompt } from '../../prompts/pool';
import { composeSystem } from '../../prompts/compose';
import { getMainPrompt } from '../platform/settings.service';
import {
  QUESTION_FORMATS,
  assessmentItemSchema,
  blueprintSectionSchema,
  countByFormat,
  drawSizes,
  newItemId,
  poolSatisfiesBlueprint,
  requiredPoolSizes,
  type AssessmentItem,
  type BlueprintSection,
  type QuestionFormat,
} from '../../lib/assessment/item';
import type { AuthUser } from '../../types';
import type { PutBlueprintInput } from './blueprint.schema';

const SAMPLES_TARGET = 3; // preview items per request (PLAN §5.1: "3–5 examples")
const SAMPLES_MAX_TOKENS = 3_000;
const POOL_BATCH_SIZE = 10; // max items requested per LLM call
const POOL_BATCH_MAX_TOKENS = 8_000; // 10 rich items (CODE carries hidden cases)
const POOL_OVERSHOOT = 2; // stop prompting a format at 2× its required size

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Company-scoped job fetch — 404 for other companies' jobs (jd.service pattern). */
async function getScopedJob(user: AuthUser, jobId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: user.companyId! } });
  if (!job) throw new AppError(404, 'Job not found', 'NOT_FOUND');
  return job;
}

/** Re-validates stored blueprint sections at the worker boundary. */
function parseSections(raw: Prisma.JsonValue): BlueprintSection[] {
  const parsed = z.array(blueprintSectionSchema).safeParse(raw ?? []);
  if (!parsed.success) {
    throw new AppError(500, 'Blueprint sections failed schema validation', 'BLUEPRINT_CORRUPT');
  }
  return parsed.data;
}

/** Fail fast (503) when the company has no active LLM provider — before
 * enqueueing work. Company-scoped since V2-2: the check must fail on exactly
 * the condition the worker will hit (getActiveAdapter(job.companyId)). */
async function assertProvider(companyId: string): Promise<void> {
  const provider = await prisma.llmProvider.findFirst({
    where: { companyId, isActive: true },
    select: { id: true },
  });
  if (!provider) {
    throw new AppError(
      503,
      'No active LLM provider configured — add one via /api/admin/llm-providers first',
      'NO_PROVIDER',
    );
  }
}

async function requireBlueprint(jobId: string, action: string) {
  const blueprint = await prisma.testBlueprint.findUnique({ where: { jobId } });
  if (!blueprint) {
    throw new AppError(404, `Blueprint not found — create it before ${action}`, 'BLUEPRINT_NOT_FOUND');
  }
  return blueprint;
}

/** The active pool for a job; deterministic (newest sealedAt) under the documented isActive race.
 * Loads ONLY scalars — the itemsEncrypted blob must never enter the API
 * process (QA wave-4 F4: needless attack surface even though nothing leaks it). */
function activePoolFor(jobId: string) {
  return prisma.sealedQuestionPool.findFirst({
    where: { jobId, isActive: true },
    orderBy: { sealedAt: 'desc' },
    select: { blueprintVersion: true, itemCount: true, sealedAt: true, isActive: true },
  });
}

function formatSummary(counts: Record<QuestionFormat, number>): string {
  return QUESTION_FORMATS.map((f) => `${f}:${counts[f]}`).join(', ');
}

// ─── Blueprint CRUD ───────────────────────────────────────────────────────────

function toBlueprintDto(bp: {
  jobId: string;
  sections: Prisma.JsonValue;
  timeLimitMin: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    jobId: bp.jobId,
    sections: parseSections(bp.sections),
    timeLimitMin: bp.timeLimitMin,
    version: bp.version,
    createdAt: bp.createdAt,
    updatedAt: bp.updatedAt,
  };
}

/**
 * Create or replace the blueprint. Requires an approved JD (the blueprint is
 * derived from it) and NO active sealed pool — once a pool exists the
 * blueprint is frozen; re-seal is the flow that unlocks editing again.
 */
export async function putBlueprint(user: AuthUser, jobId: string, input: PutBlueprintInput) {
  const job = await getScopedJob(user, jobId);
  if (job.jdStatus !== 'JD_APPROVED') {
    throw new AppError(409, 'Blueprint requires an approved JD', 'JD_NOT_APPROVED');
  }
  const active = await prisma.sealedQuestionPool.findFirst({
    where: { jobId: job.id, isActive: true },
    select: { id: true },
  });
  if (active) {
    throw new AppError(409, 'Pool already sealed for this blueprint — re-seal after editing', 'POOL_SEALED');
  }

  const saved = await prisma.testBlueprint.upsert({
    where: { jobId: job.id },
    create: {
      jobId: job.id,
      sections: input.sections as unknown as Prisma.InputJsonValue,
      timeLimitMin: input.timeLimitMin,
    },
    update: {
      sections: input.sections as unknown as Prisma.InputJsonValue,
      timeLimitMin: input.timeLimitMin,
      version: { increment: 1 },
    },
  });
  // Stale previews would misrepresent the new blueprint (QA wave-4 F5) —
  // samples are cheap to regenerate on demand.
  await prisma.sampleItem.deleteMany({ where: { jobId: job.id } });
  return { blueprint: toBlueprintDto(saved) };
}

/** Blueprint + sealed-pool status for GET /api/jobs/:jobId/blueprint. */
export async function getBlueprint(user: AuthUser, jobId: string) {
  await getScopedJob(user, jobId);
  const [blueprint, pool] = await Promise.all([
    prisma.testBlueprint.findUnique({ where: { jobId } }),
    activePoolFor(jobId),
  ]);
  return {
    blueprint: blueprint ? toBlueprintDto(blueprint) : null,
    pool: {
      hasActivePool: pool !== null,
      poolVersion: pool?.blueprintVersion ?? null,
      itemCount: pool?.itemCount ?? 0,
      sealedAt: pool?.sealedAt ?? null,
    },
  };
}

// ─── Sample preview (PREVIEW-ONLY items — never drawn into sessions) ──────────

/**
 * Queue sample-preview generation. Existing sample rows are deleted first:
 * after a blueprint edit the old previews describe a test that no longer
 * exists, and a mid-flight failure leaves "no samples" (honest) rather than
 * stale ones (misleading).
 */
export async function requestSamples(user: AuthUser, jobId: string) {
  await getScopedJob(user, jobId);
  await requireBlueprint(jobId, 'requesting samples');
  await assertProvider(user.companyId!);
  await prisma.sampleItem.deleteMany({ where: { jobId } });
  await enqueue('SAMPLES_GENERATION', { jobId });
}

/** The preview items HR may see. By design visible — and never drawn. */
export async function getSamples(user: AuthUser, jobId: string) {
  await getScopedJob(user, jobId);
  const rows = await prisma.sampleItem.findMany({
    where: { jobId },
    orderBy: { createdAt: 'asc' },
    select: { item: true },
  });
  return { samples: rows.map((r) => r.item) };
}

// ─── Pool sealing ─────────────────────────────────────────────────────────────

/** First-time seal: refuse while an active pool exists (reseal is its own route). */
export async function sealPool(user: AuthUser, jobId: string) {
  await getScopedJob(user, jobId);
  await requireBlueprint(jobId, 'sealing a pool');
  const active = await prisma.sealedQuestionPool.findFirst({
    where: { jobId, isActive: true },
    select: { id: true },
  });
  if (active) {
    throw new AppError(409, 'Pool already sealed — use POST /pool/reseal to regenerate', 'POOL_SEALED');
  }
  await assertProvider(user.companyId!);
  await enqueue('POOL_SEAL', { jobId, reseal: false });
}

/**
 * Re-seal: destroy the old pool NOW and queue regeneration (PLAN §5.1 — the
 * one-click action that ages out a stolen dump). Deactivation + enqueue are
 * one transaction: a process death in between can neither leave a destroyed
 * pool without a regeneration job, nor enqueue against an still-active pool.
 */
export async function resealPool(user: AuthUser, jobId: string) {
  await getScopedJob(user, jobId);
  await requireBlueprint(jobId, 're-sealing');
  await assertProvider(user.companyId!);
  await prisma.$transaction(async (tx) => {
    await tx.sealedQuestionPool.updateMany({ where: { jobId, isActive: true }, data: { isActive: false } });
    await tx.jobQueue.create({
      data: {
        type: 'POOL_SEAL',
        payload: { jobId, reseal: true } as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
        runAt: new Date(),
      },
    });
  });
}

/**
 * Sealed-pool status for GET /api/jobs/:jobId/pool — counts only, nothing
 * else, ever. This is the complete pool surface exposed to any user role.
 */
export async function getPool(user: AuthUser, jobId: string) {
  await getScopedJob(user, jobId);
  const pool = await activePoolFor(jobId);
  return {
    pool: {
      hasActivePool: pool !== null,
      version: pool?.blueprintVersion ?? null,
      itemCount: pool?.itemCount ?? 0,
      sealedAt: pool?.sealedAt ?? null,
    },
  };
}

// ─── LLM batch generation (shared by both workers) ────────────────────────────

/**
 * Accepts either the canonical {"items":[...]} wrapper or a bare array (some
 * providers ignore the wrapper instruction when JSON mode is emulated).
 */
function asItemsArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)) {
    return (parsed as { items: unknown[] }).items;
  }
  return null;
}

/**
 * One LLM call → schema-valid items. Every candidate gets a server-minted id
 * (the model is told not to send one), then must pass assessmentItemSchema —
 * invalid output is skipped, never repaired. Bad JSON / wrong shape counts as
 * zero valid items; the caller decides whether that is fatal.
 *
 * `tiered` carries the two-tier system prompts (founder requirement): the
 * super-admin MAIN prompt and this job's HR-written jobPrompt, composed ahead
 * of the base ITEM_SYSTEM_PROMPT (which keeps the output contract, last).
 */
async function generateItems(
  adapter: LlmAdapter,
  input: { jdTitle: string; jdDescription: string; section: BlueprintSection; count: number },
  maxTokens: number,
  tiered: { mainPrompt: string; jobPrompt: string | null },
): Promise<{ valid: AssessmentItem[]; skipped: number }> {
  const res = await adapter.chat({
    system: composeSystem(ITEM_SYSTEM_PROMPT, tiered.mainPrompt, tiered.jobPrompt),
    messages: [
      {
        role: 'user',
        content: buildItemsUserPrompt({
          jdTitle: input.jdTitle,
          jdDescription: input.jdDescription,
          section: input.section,
          count: input.count,
        }),
      },
    ],
    jsonMode: true,
    maxTokens,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return { valid: [], skipped: 0 };
  }
  const arr = asItemsArray(parsed);
  if (!arr) return { valid: [], skipped: 0 };

  const valid: AssessmentItem[] = [];
  let skipped = 0;
  for (const raw of arr) {
    if (typeof raw !== 'object' || raw === null) {
      skipped++;
      continue;
    }
    const stamped = { ...(raw as Record<string, unknown>), id: newItemId() };
    const check = assessmentItemSchema.safeParse(stamped);
    if (check.success) {
      valid.push(check.data);
    } else {
      skipped++;
    }
  }
  return { valid, skipped };
}

// ─── Worker: SAMPLES_GENERATION ───────────────────────────────────────────────

/**
 * Generates up to min(3, total draw size) preview items spread across the
 * blueprint's sections (round-robin; a section picked twice gets its next
 * format). Idempotent no-op when the job or blueprint vanished. Zero valid
 * items → throw, so the queue retries.
 */
export async function runSamplesGeneration(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  const blueprint = await prisma.testBlueprint.findUnique({ where: { jobId } });
  if (!blueprint) return;

  const sections = parseSections(blueprint.sections);
  const draw = drawSizes({ sections });
  const totalDraw = QUESTION_FORMATS.reduce((sum, f) => sum + draw[f], 0);
  const target = Math.min(SAMPLES_TARGET, totalDraw);
  if (target <= 0) return;

  // Spread the cap across sections; `guard` bounds the loop even if a section
  // somehow contributed no formats (the schema forbids it — belt and braces).
  const picks: Array<{ section: BlueprintSection; format: QuestionFormat }> = [];
  const cursors = new Map<number, number>();
  let guard = 0;
  while (picks.length < target && guard < target * 10 + 10) {
    const idx = guard % sections.length;
    const section = sections[idx];
    guard++;
    const formats = QUESTION_FORMATS.filter((f) => (section.formats[f] ?? 0) > 0);
    if (formats.length === 0) continue;
    const cursor = cursors.get(idx) ?? 0;
    cursors.set(idx, cursor + 1);
    picks.push({ section, format: formats[cursor % formats.length] });
  }

  // V2-2: the job's company's provider — never another tenant's.
  const { adapter } = await getActiveAdapter(job.companyId);
  // Two-tier prompts (founder requirement): read once per run, ride every call.
  const tiered = { mainPrompt: await getMainPrompt(), jobPrompt: job.jobPrompt };
  const valid: AssessmentItem[] = [];
  let skipped = 0;
  for (const pick of picks) {
    try {
      const outcome = await generateItems(
        adapter,
        {
          jdTitle: job.title,
          jdDescription: job.description,
          section: { ...pick.section, formats: { [pick.format]: 1 } },
          count: 1,
        },
        SAMPLES_MAX_TOKENS,
        tiered,
      );
      valid.push(...outcome.valid);
      skipped += outcome.skipped;
    } catch (err) {
      // One dead call must not sink the rest of the preview; if nothing at
      // all survives, the zero-valid throw below makes the queue retry.
      console.warn(
        `[worker] sample generation call failed for job ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (valid.length === 0) {
    throw new AppError(502, 'LLM produced no valid sample items', 'LLM_BAD_OUTPUT');
  }

  await prisma.sampleItem.createMany({
    data: valid.map((item) => ({ jobId, item: item as unknown as Prisma.InputJsonValue })),
  });
  console.log(`[worker] samples for job ${jobId}: ${valid.length} valid, ${skipped} skipped (${formatSummary(countByFormat(valid))})`);
}

// ─── Worker: POOL_SEAL ────────────────────────────────────────────────────────

/**
 * Generates and seals the pool: required size per format is 6× the draw
 * (PLAN §5.2 mechanism 1), gathered in batches of ≤10 round-robin across the
 * sections contributing each format. Stop prompting a format at need OR at 2×
 * need (overshoot guard); every item is schema-validated, invalid ones are
 * skipped. Shortfalls get exactly ONE extra top-up round, then the run throws
 * POOL_UNDERGENERATED so the queue retries from scratch. The sealed pool is
 * written in one transaction that deactivates any previous active pool.
 *
 * Idempotency: a no-op when the blueprint is missing, or when an active pool
 * already exists for the CURRENT blueprint version (a retry landing after a
 * successful attempt). `reseal` deactivates old pools FIRST — during
 * regeneration the job has no active pool and draws fail closed rather than
 * serving from a pool HR believes was destroyed.
 *
 * Item contents are never logged — counts only (PLAN §5: nobody, logs
 * included, gets to enumerate the pool).
 */
export async function runPoolSeal(jobId: string, reseal = false): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  const blueprint = await prisma.testBlueprint.findUnique({ where: { jobId } });
  if (!blueprint) return;

  const active = await prisma.sealedQuestionPool.findFirst({
    where: { jobId, isActive: true },
    select: { blueprintVersion: true },
  });
  if (!reseal && active && active.blueprintVersion === blueprint.version) {
    return; // this exact blueprint version is already sealed
  }

  if (active) {
    // Reseal backstop (the route already did this) — and the rare
    // stale-version case: the final transaction still guarantees one active.
    await prisma.sealedQuestionPool.updateMany({ where: { jobId, isActive: true }, data: { isActive: false } });
  }

  const sections = parseSections(blueprint.sections);
  const required = requiredPoolSizes(drawSizes({ sections }));
  // V2-2: the job's company's provider — never another tenant's.
  const { adapter } = await getActiveAdapter(job.companyId);
  // Two-tier prompts (founder requirement): read once per run, ride every call.
  const tiered = { mainPrompt: await getMainPrompt(), jobPrompt: job.jobPrompt };

  const items: AssessmentItem[] = [];
  const tally = countByFormat([]); // running per-format counts
  let skippedTotal = 0;
  let callsTotal = 0;

  for (const format of QUESTION_FORMATS) {
    const need = required[format];
    if (need <= 0) continue;
    const contributing = sections.filter((s) => (s.formats[format] ?? 0) > 0);
    if (contributing.length === 0) continue; // defensive — drawSizes counted it

    // Bounded prompting: ideal batches + slack for invalid/failed ones, never
    // an infinite retry loop against a provider that keeps returning junk.
    const maxCalls = Math.ceil(need / POOL_BATCH_SIZE) * 2 + 2;
    let calls = 0;
    let sectionIdx = 0;

    while (tally[format] < need && tally[format] < need * POOL_OVERSHOOT && calls < maxCalls) {
      calls++;
      callsTotal++;
      const section = contributing[sectionIdx % contributing.length];
      sectionIdx++;
      const batch = Math.min(POOL_BATCH_SIZE, need - tally[format]);
      try {
        const outcome = await generateItems(
          adapter,
          {
            jdTitle: job.title,
            jdDescription: job.description,
            section: { ...section, formats: { [format]: batch } },
            count: batch,
          },
          POOL_BATCH_MAX_TOKENS,
          tiered,
        );
        skippedTotal += outcome.skipped;
        for (const item of outcome.valid) {
          items.push(item);
          tally[item.format]++; // off-format strays still count where they belong
        }
      } catch (err) {
        console.warn(
          `[worker] pool batch failed for job ${jobId} (${format}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  let check = poolSatisfiesBlueprint(items, { sections });
  if (!check.ok) {
    // ONE top-up round for the shortfall formats — then give up cleanly and
    // let the queue retry the whole seal.
    for (const format of QUESTION_FORMATS) {
      const missing = check.shortfalls[format];
      if (!missing) continue;
      const contributing = sections.filter((s) => (s.formats[format] ?? 0) > 0);
      if (contributing.length === 0) continue;
      const batch = Math.min(POOL_BATCH_SIZE, missing);
      callsTotal++;
      try {
        const outcome = await generateItems(
          adapter,
          {
            jdTitle: job.title,
            jdDescription: job.description,
            section: { ...contributing[0], formats: { [format]: batch } },
            count: batch,
          },
          POOL_BATCH_MAX_TOKENS,
          tiered,
        );
        skippedTotal += outcome.skipped;
        for (const item of outcome.valid) {
          items.push(item);
          tally[item.format]++;
        }
      } catch (err) {
        console.warn(
          `[worker] pool top-up failed for job ${jobId} (${format}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    check = poolSatisfiesBlueprint(items, { sections });
    if (!check.ok) {
      throw new AppError(502, 'LLM under-generated the pool: ' + JSON.stringify(check.shortfalls), 'POOL_UNDERGENERATED');
    }
  }

  const itemsEncrypted = encryptSecret(JSON.stringify(items));
  await prisma.$transaction(async (tx) => {
    await tx.sealedQuestionPool.updateMany({ where: { jobId, isActive: true }, data: { isActive: false } });
    await tx.sealedQuestionPool.create({
      data: {
        jobId,
        blueprintId: blueprint.id,
        blueprintVersion: blueprint.version,
        itemsEncrypted,
        itemCount: items.length,
        isActive: true,
      },
    });
  });

  console.log(
    `[worker] sealed pool for job ${jobId} (blueprint v${blueprint.version}): ${items.length} items (${formatSummary(tally)}), ${skippedTotal} invalid skipped, ${callsTotal} LLM call(s)`,
  );
}
