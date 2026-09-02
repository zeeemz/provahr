// Role intake → JD generation service (PLAN.md Phase 2).
//
// Flow: POST /api/jobs/intake creates a placeholder Job (jdStatus=JD_DRAFTING)
// and enqueues a JD_GENERATION queue row. The worker calls `runJdGeneration`,
// which fetches source URLs, sends notes + excerpts + screenshots to the
// active LLM adapter, and stores the draft for HR review (jdStatus=JD_REVIEW).
// HR edits the draft via PATCH, then approves via POST .../jd/approve, which
// copies the draft onto the Job proper.
//
// Every read/write is scoped to the caller's company (except the
// worker-driven `runJdGeneration`, which addresses the job by id directly).

import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { AppError } from '../../lib/http';
import { getActiveAdapter, type ChatImage } from '../../lib/llm';
import { fetchPageText } from '../../lib/urlFetch';
import { JD_SYSTEM_PROMPT, buildJdUserPrompt } from '../../prompts/jd';
import { composeSystem } from '../../prompts/compose';
import { getMainPrompt } from '../platform/settings.service';
import { jdDraftPartialSchema } from './jd.schema';
import type { IntakeInput, EditDraftInput, ScreenshotInput } from './jd.schema';
import type { AuthUser } from '../../types';

const FETCHED_TEXT_CAP = 60_000;

/** Company-scoped job fetch for the JD endpoints — 404 for other companies' jobs. */
async function getScopedJob(user: AuthUser, jobId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: user.companyId! } });
  if (!job) throw new AppError(404, 'Job not found', 'NOT_FOUND');
  return job;
}

function asScreenshotArray(value: Prisma.JsonValue | null): ScreenshotInput[] {
  return Array.isArray(value) ? (value as ScreenshotInput[]) : [];
}

/** Creates the intake job and enqueues JD generation. */
export async function createIntake(
  user: AuthUser,
  input: IntakeInput,
): Promise<{ job: { id: string; title: string; status: string; jdStatus: string | null }; queued: true }> {
  // Fail BEFORE creating anything if the COMPANY has no provider — otherwise
  // the job would sit in JD_DRAFTING forever with every queue attempt dying on
  // NO_PROVIDER. Company-scoped since V2-2: the check must fail on exactly the
  // condition the worker will hit (getActiveAdapter(job.companyId)).
  const provider = await prisma.llmProvider.findFirst({
    where: { companyId: user.companyId!, isActive: true },
    select: { id: true },
  });
  if (!provider) {
    throw new AppError(
      503,
      'No active LLM provider configured — add one via /api/admin/llm-providers first',
      'NO_PROVIDER',
    );
  }

  // Job creation + queue insertion are one transaction — a failure between
  // two separate writes would orphan a JD_DRAFTING job with no queue row and
  // no recovery path (QA wave-3 F6).
  const { jobId } = await prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        companyId: user.companyId!,
        title: 'Draft role',
        department: 'Unassigned',
        roleFamily: 'OTHER',
        location: 'To be determined',
        description: 'Pending JD generation — edit after the draft is ready.',
        status: 'DRAFT',
        jdStatus: 'JD_DRAFTING',
        jdNotes: input.notes ?? null,
        jdSourceUrls: input.urls as unknown as Prisma.InputJsonValue,
        jdScreenshots: input.screenshots as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await tx.jobQueue.create({
      data: {
        type: 'JD_GENERATION',
        payload: { jobId: job.id } as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
        runAt: new Date(),
      },
    });
    return { jobId: job.id };
  });
  return { job: { id: jobId, title: 'Draft role', status: 'DRAFT', jdStatus: 'JD_DRAFTING' }, queued: true };
}

/** The JD view for GET /api/jobs/:jobId/jd. */
export async function getJd(user: AuthUser, jobId: string) {
  const job = await getScopedJob(user, jobId);
  const parsed = jdDraftPartialSchema.safeParse(job.jdDraft ?? {});
  return {
    jdStatus: job.jdStatus,
    urls: (Array.isArray(job.jdSourceUrls) ? job.jdSourceUrls : []) as string[],
    screenshotCount: asScreenshotArray(job.jdScreenshots).length,
    notes: job.jdNotes,
    draft: parsed.success ? parsed.data : null,
    error: job.jdError,
    // Best-effort enrichment is visible as such (PLAN §10): HR sees which
    // sources fetched and which failed (QA wave-3 F11).
    fetchedExcerpt: job.jdFetchedText ? job.jdFetchedText.slice(0, 500) : null,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ─── Job-specific prompt tier (founder requirement: two-tier prompts) ────────

/**
 * GET /api/jobs/:jobId/prompt — the HR-editable role-specific prompt overlay,
 * plus the platform MAIN prompt for display convenience (company users can
 * READ the main prompt — the visibility half of the founder requirement —
 * but only the super admin can edit it, via /api/platform/prompts/main).
 */
export async function getJobPrompt(user: AuthUser, jobId: string) {
  const job = await getScopedJob(user, jobId);
  return { jobPrompt: job.jobPrompt, mainPrompt: await getMainPrompt() };
}

/**
 * PUT /api/jobs/:jobId/prompt — set or clear the role-specific overlay.
 * Company-scoped via getScopedJob; the ADMIN/RECRUITER gate lives in the
 * route. `null` clears the overlay (an empty string behaves the same at
 * composition time — composeSystem skips empty tiers).
 */
export async function putJobPrompt(user: AuthUser, jobId: string, jobPrompt: string | null) {
  const job = await getScopedJob(user, jobId);
  const updated = await prisma.job.update({
    where: { id: job.id },
    data: { jobPrompt },
    select: { id: true, jobPrompt: true },
  });
  return { jobPrompt: updated.jobPrompt };
}

/** Recursive merge: objects merge, everything else (arrays included) replaces. */
function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** HR edits the draft — only while it is in review. */
export async function editDraft(user: AuthUser, jobId: string, patch: EditDraftInput) {
  const job = await getScopedJob(user, jobId);
  if (job.jdStatus !== 'JD_REVIEW') {
    throw new AppError(409, 'Draft is not editable in this state', 'JD_NOT_EDITABLE');
  }
  const current = isPlainObject(job.jdDraft) ? job.jdDraft : {};
  const merged = deepMerge(current, patch as Record<string, unknown>);
  const updated = await prisma.job.update({
    where: { id: job.id },
    data: { jdDraft: merged as unknown as Prisma.InputJsonValue },
    select: { jdDraft: true },
  });
  return updated.jdDraft;
}

/** HR approves the draft — its fields become the Job's fields. */
export async function approveJd(user: AuthUser, jobId: string) {
  const job = await getScopedJob(user, jobId);
  if (job.jdStatus !== 'JD_REVIEW') {
    throw new AppError(409, 'Draft is not editable in this state', 'JD_NOT_EDITABLE');
  }
  const draft = isPlainObject(job.jdDraft) ? job.jdDraft : {};
  // Copy only present, non-null fields — a null is the LLM honestly saying
  // "the material did not support this", and the placeholder must survive.
  const data: Prisma.JobUpdateInput = { jdStatus: 'JD_APPROVED' };
  if (typeof draft.title === 'string' && draft.title !== '') data.title = draft.title;
  if (typeof draft.department === 'string' && draft.department !== '') data.department = draft.department;
  if (draft.roleFamily === 'ENGINEERING' || draft.roleFamily === 'PRODUCT_MANAGEMENT' || draft.roleFamily === 'DESIGN' ||
      draft.roleFamily === 'DATA' || draft.roleFamily === 'QA' || draft.roleFamily === 'OTHER') {
    data.roleFamily = draft.roleFamily;
  }
  if (typeof draft.location === 'string' && draft.location !== '') data.location = draft.location;
  if (draft.workMode === 'ONSITE' || draft.workMode === 'HYBRID' || draft.workMode === 'REMOTE') {
    data.workMode = draft.workMode;
  }
  if (draft.employmentType === 'FULL_TIME' || draft.employmentType === 'PART_TIME' ||
      draft.employmentType === 'CONTRACT' || draft.employmentType === 'INTERNSHIP') {
    data.employmentType = draft.employmentType;
  }
  if (typeof draft.description === 'string' && draft.description !== '') data.description = draft.description;

  return prisma.job.update({ where: { id: job.id }, data });
}

/**
 * Worker-side JD generation. Idempotent no-op when the job is missing or no
 * longer JD_DRAFTING (e.g. a retry landing after a later attempt succeeded).
 * On failure the job stays JD_DRAFTING with `jdError` set (HR sees the
 * interim state via GET) and the error is rethrown so the queue records
 * failure / schedules the retry.
 */
export async function runJdGeneration(jobId: string): Promise<void> {
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.jdStatus !== 'JD_DRAFTING') return;

    // Fetch each source URL; a bad URL must not kill the whole run.
    const urls = (Array.isArray(job.jdSourceUrls) ? job.jdSourceUrls : []) as string[];
    const fetched: Array<{ url: string; text: string }> = [];
    for (const url of urls) {
      try {
        const page = await fetchPageText(url);
        fetched.push({ url: page.url, text: page.text });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        fetched.push({ url, text: `(fetch failed: ${reason})` });
      }
    }
    const excerpts = fetched
      .map((f) => `--- ${f.url} ---\n${f.text}`)
      .join('\n\n')
      .slice(0, FETCHED_TEXT_CAP);
    await prisma.job.update({ where: { id: jobId }, data: { jdFetchedText: excerpts } });

    const images: ChatImage[] = asScreenshotArray(job.jdScreenshots)
      .filter((s) => s.mediaType === 'image/png' || s.mediaType === 'image/jpeg' || s.mediaType === 'image/webp')
      .map((s) => ({ mediaType: s.mediaType, base64: s.base64 }));

    // V2-2: the job's company's provider — never another tenant's.
    const { adapter } = await getActiveAdapter(job.companyId);
    const res = await adapter.chat({
      // Two-tier prompts (founder requirement): the super-admin MAIN prompt
      // and this job's HR-written jobPrompt ride AHEAD of the base contract.
      system: composeSystem(JD_SYSTEM_PROMPT, await getMainPrompt(), job.jobPrompt),
      messages: [
        {
          role: 'user',
          content: buildJdUserPrompt({
            notes: job.jdNotes ?? undefined,
            fetched,
            screenshotCount: images.length,
          }),
        },
      ],
      jsonMode: true,
      images,
      // 4000 leaves headroom for the full permitted description length —
      // at 2000 the longest legal drafts truncated into invalid JSON (QA
      // wave-3 F7).
      maxTokens: 4000,
    });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(res.text);
    } catch {
      throw new AppError(502, 'LLM returned invalid JSON', 'LLM_BAD_OUTPUT');
    }
    const draft = jdDraftPartialSchema.safeParse(parsedJson);
    // title + description are the minimum a usable draft can carry.
    if (!draft.success || !draft.data.title || !draft.data.description) {
      throw new AppError(502, 'LLM draft missing required fields (title, description)', 'LLM_BAD_OUTPUT');
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        jdDraft: { ...draft.data, _model: res.model, _generatedAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
        jdStatus: 'JD_REVIEW',
        jdError: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort interim state; never masks the original error.
    await prisma.job
      .update({ where: { id: jobId }, data: { jdError: message.slice(0, 500) } })
      .catch(() => undefined);
    throw err;
  }
}
