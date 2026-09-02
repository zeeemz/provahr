// Prompts for role-intake → job-description generation (PLAN.md Phase 2).
// Pure string builders — unit-tested, no imports, no side effects.

export const JD_SYSTEM_PROMPT = `You are an expert technical recruiter who writes precise, honest job descriptions.

Rules you must never break:
1. Ground every fact in the provided material (notes, fetched page excerpts, screenshots) and NOTHING else. Never invent a company name, product, stack, salary, or benefit that is not supported by the material.
2. When a field of the JSON output is not supported by the material, set it to null instead of guessing. An honest null is correct; a plausible invention is a defect.
3. Output STRICT JSON and nothing else — no markdown fences, no commentary. The JSON object has exactly these keys:
   title, department, roleFamily, location, workMode, employmentType, description, summary
   - roleFamily: one of ENGINEERING, PRODUCT_MANAGEMENT, DESIGN, DATA, QA, OTHER
   - workMode: one of ONSITE, HYBRID, REMOTE
   - employmentType: one of FULL_TIME, PART_TIME, CONTRACT, INTERNSHIP
   - description: well-structured markdown (200–4000 characters) with sections such as "About the role", "Responsibilities", "Requirements", "Nice to have"
   - summary: a one-to-two sentence overview, at most 500 characters
4. Keep the tone professional and inclusive; no discriminatory requirements (age, gender, marital status, unrelated physical demands).`;

/**
 * Builds the user message for JD generation. Material is explicitly
 * delimited so the model cannot confuse it with instructions.
 */
export function buildJdUserPrompt(input: {
  notes?: string;
  fetched: Array<{ url: string; text: string }>;
  screenshotCount: number;
}): string {
  const parts: string[] = [
    'Generate a job description draft from the material below.',
    'Use ONLY the material. Leave any field null when the material does not support it — do not invent.',
  ];

  if (input.screenshotCount > 0) {
    parts.push(
      `Screenshots of a reference professional profile are attached as images (${input.screenshotCount} total). Extract role-relevant facts from them the same way: grounded only in what is visible.`,
    );
  }

  parts.push('=== MATERIAL START ===');

  if (input.notes && input.notes.trim() !== '') {
    parts.push('--- Recruiter notes ---');
    parts.push(input.notes.trim());
  }

  if (input.fetched.length > 0) {
    for (const page of input.fetched) {
      parts.push(`--- Fetched page: ${page.url} ---`);
      parts.push(page.text.trim() === '' ? '(no extractable text)' : page.text.trim());
    }
  }

  parts.push('=== MATERIAL END ===');
  parts.push('Return the JSON object now.');
  return parts.join('\n\n');
}
