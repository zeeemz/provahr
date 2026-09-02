// Two-tier system-prompt composition (founder requirement).
//
// Every LLM request carries TWO user-editable prompt tiers ahead of the
// hardcoded base system prompt:
//   1. MAIN (platform-wide) — PlatformSettings.mainPrompt, edited only by the
//      super admin (PUT /api/platform/prompts/main), readable by everyone.
//   2. JOB-SPECIFIC — Job.jobPrompt, edited by the HR user creating the job
//      (PUT /api/jobs/:jobId/prompt).
// The BASE prompt (JD_SYSTEM_PROMPT / ITEM_SYSTEM_PROMPT / review prompts)
// stays LAST: it owns the output contract (strict-JSON shape), and the tiers
// above only steer style/emphasis — so a rogue overlay cannot silently
// displace the schema instructions the parsers depend on.
//
// Pure string assembly: no imports, no side effects, unit-tested
// (tests/compose.test.ts).

export const MAIN_PROMPT_HEADER = '=== PLATFORM PROMPT RULES ===';
export const JOB_PROMPT_HEADER = '=== ROLE-SPECIFIC INSTRUCTIONS ===';

/** One delimited section, or null when the body carries no content. */
function section(header: string, body: string | null | undefined): string | null {
  const trimmed = (body ?? '').trim();
  if (trimmed === '') return null; // empty/whitespace tier ⇒ skipped entirely
  return `${header}\n${trimmed}`;
}

/**
 * Composes the full system prompt: MAIN tier, JOB tier, then the base prompt.
 * Empty or whitespace-only tiers are skipped (no header for them); when both
 * are absent the result is exactly the base prompt, unchanged.
 */
export function composeSystem(
  base: string,
  mainPrompt: string | null | undefined,
  jobPrompt: string | null | undefined,
): string {
  const parts = [
    section(MAIN_PROMPT_HEADER, mainPrompt),
    section(JOB_PROMPT_HEADER, jobPrompt),
    base.trim() === '' ? null : base,
  ];
  return parts.filter((part): part is string => part !== null).join('\n\n');
}
