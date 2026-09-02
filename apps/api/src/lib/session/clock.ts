// Pure deadline math for the never-pausing session clock (PLAN.md §5.2
// mechanism 5; docs/TESTING.md §6 never-regress #5). The clock starts ONCE at
// session start and nothing extends it — review passes, answer revisions,
// refreshes and re-entry all run against the same deadline.
//
// PURE: no Date.now() in here; callers pass `now` so tests are deterministic.

/**
 * Auto-submit race grace: a submit arriving within this window past the
 * deadline is accepted (the candidate's client fired as the clock hit zero).
 * Answer upserts and signal writes get NO grace — the clock never pauses.
 */
export const SUBMIT_GRACE_MS = 60_000;

/** deadline = start + the blueprint's time limit (the hard time budget). */
export function deadlineFor(startedAt: Date, timeLimitMin: number): Date {
  return new Date(startedAt.getTime() + timeLimitMin * 60_000);
}

/** Milliseconds left; goes negative once the deadline has passed. */
export function remainingMs(deadlineAt: Date, now: Date): number {
  return deadlineAt.getTime() - now.getTime();
}

/** The deadline is reached (remaining <= 0) — the session's time is up. */
export function isExpired(deadlineAt: Date, now: Date): boolean {
  return remainingMs(deadlineAt, now) <= 0;
}

/** Whether a submit still counts despite landing past the deadline (race). */
export function withinSubmitGrace(deadlineAt: Date, now: Date): boolean {
  return now.getTime() - deadlineAt.getTime() <= SUBMIT_GRACE_MS;
}
