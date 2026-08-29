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
