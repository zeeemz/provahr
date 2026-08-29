import type { ApplicationStatus, Stage } from '@prisma/client';

/** Kanban columns, in pipeline order. */
export const STAGES: readonly Stage[] = [
  'APPLIED',
  'SCREENING',
  'ASSESSMENT',
  'INTERVIEW',
  'OFFER',
  'HIRED',
] as const;

/** Valid forward/backward stage moves. Rejection is a status change, not a stage move. */
const TRANSITIONS: Record<Stage, readonly Stage[]> = {
  APPLIED: ['SCREENING', 'ASSESSMENT', 'INTERVIEW'],
  SCREENING: ['APPLIED', 'ASSESSMENT', 'INTERVIEW'],
  ASSESSMENT: ['SCREENING', 'INTERVIEW'],
  INTERVIEW: ['SCREENING', 'ASSESSMENT', 'OFFER'],
  OFFER: ['INTERVIEW', 'HIRED'],
  HIRED: [],
};

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

export function canTransition(from: Stage, to: Stage): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

export function transitionsFrom(stage: Stage): readonly Stage[] {
  return TRANSITIONS[stage];
}

// ─── AI-loop pipeline (PLAN.md §4 step 7) — future stages, rules-level only ──
//
// The AI-native loop renames the board: Applied → Test → Review → Interview →
// Offer → Hired (PLAN.md §4 step 7). TEST is the proctored AI-test stage (the
// tracking-spine name for it was ASSESSMENT — superseded here); REVIEW is HR's
// post-evaluation pass over the X-ray. SCREENING survives as an optional human
// pre-screen for processes that want one before the test.
//
// WHY A SEPARATE MAP (deliberate, honest): the persisted `Stage` Prisma enum
// does NOT contain TEST/REVIEW, and every stage write validates through zod
// enums in applications.schema.ts (moveStageSchema — outside this module).
// Enum values cannot be added without a Prisma migration, so this module must
// not advertise stages the database cannot store: STAGES/TRANSITIONS above
// stay the enum-backed truth used by every route today. The enum extension
// lands with the NEXT migration after 0001_init — folding TEST/REVIEW into
// the init migration would be fine for fresh installs but would diverge from
// existing dev databases created via `db push` (one migration history, one
// truth). Until then the maps below serve display/validation of the future
// flow only (dashboards, the web portal's stage mirrors, Phase 9 wiring).

/** The AI-loop Kanban columns, in pipeline order (PLAN.md §4 step 7 + SCREENING). */
export const AI_PIPELINE_STAGES = [
  'APPLIED',
  'SCREENING',
  'TEST',
  'REVIEW',
  'INTERVIEW',
  'OFFER',
  'HIRED',
] as const;

export type AiPipelineStage = (typeof AI_PIPELINE_STAGES)[number];

/**
 * Valid moves on the AI-loop board. The spine edges survive (APPLIED↔SCREENING,
 * INTERVIEW↔SCREENING, INTERVIEW↔OFFER, OFFER↔HIRED, HIRED terminal);
 * ASSESSMENT's edges are inherited by its successor TEST, and REVIEW slots in
 * between TEST and INTERVIEW. REVIEW does NOT go back to TEST: a re-test is a
 * NEW one-time link + session, never a backward board move.
 */
const AI_PIPELINE_TRANSITIONS: Record<AiPipelineStage, readonly AiPipelineStage[]> = {
  APPLIED: ['TEST', 'SCREENING'],
  SCREENING: ['APPLIED', 'TEST', 'INTERVIEW'],
  TEST: ['SCREENING', 'REVIEW'],
  REVIEW: ['INTERVIEW', 'SCREENING'],
  INTERVIEW: ['OFFER', 'REVIEW', 'SCREENING'],
  OFFER: ['INTERVIEW', 'HIRED'],
  HIRED: [],
};

export function isAiPipelineStage(value: unknown): value is AiPipelineStage {
  return typeof value === 'string' && (AI_PIPELINE_STAGES as readonly string[]).includes(value);
}

export function canTransitionAiPipeline(from: AiPipelineStage, to: AiPipelineStage): boolean {
  if (from === to) return false;
  return AI_PIPELINE_TRANSITIONS[from].includes(to);
}

export function aiPipelineTransitionsFrom(stage: AiPipelineStage): readonly AiPipelineStage[] {
  return AI_PIPELINE_TRANSITIONS[stage];
}

// ─── Status actions ──────────────────────────────────────────────────────────
// Status (the outcome) is orthogonal to the stage (the board position).

export type StatusAction = 'REJECT' | 'WITHDRAW' | 'REOPEN';

export function canReject(stage: Stage, status: ApplicationStatus): boolean {
  return status === 'ACTIVE' && stage !== 'HIRED';
}

export function canWithdraw(status: ApplicationStatus): boolean {
  return status === 'ACTIVE';
}

export function canReopen(status: ApplicationStatus): boolean {
  return status === 'REJECTED' || status === 'WITHDRAWN';
}

export function statusAfter(action: StatusAction): ApplicationStatus {
  switch (action) {
    case 'REJECT':
      return 'REJECTED';
    case 'WITHDRAW':
      return 'WITHDRAWN';
    case 'REOPEN':
      return 'ACTIVE';
  }
}
