// Prompts for assessment-item generation (PLAN.md Phase 3, §5) — sample
// previews for HR and the sealed question pool. Pure string builders: no
// imports beyond the item vocabulary, no side effects, unit-tested.
//
// OUTPUT SHAPE NOTE: `jsonMode` means different things per adapter — OpenAI's
// `json_object` response format and Anthropic's emulated mode BOTH require a
// top-level JSON OBJECT. So the canonical output here is {"items":[...]} (an
// object wrapping the array), and the worker's parser additionally tolerates
// a bare array from providers that ignore the wrapper instruction.

import { QUESTION_FORMATS, type BlueprintSection } from '../lib/assessment/item';

export const ITEM_SYSTEM_PROMPT = `You are an expert assessment designer building technical screening tests.
You write questions that separate genuine skill from polished bluffing: concrete, role-grounded, objectively checkable.

Rules you must never break:
1. Output STRICT JSON and nothing else — no markdown fences, no commentary. The response is a single JSON object: {"items":[ ... ]} holding every item.
2. Ground every item in the job description given in the user message — its stack, its domain, its seniority. Never invent technologies, tools, or responsibilities it does not mention.
3. Do NOT include an "id" field in items; the platform assigns ids. Off-schema items are discarded, not repaired.
4. Give an honest difficulty spread — mix EASY, MEDIUM and HARD unless the requested difficulty mix says otherwise.
5. SWIPE_MCQ: the candidate likes/dislikes each option separately. Provide 3-6 options that MIX true and false claims — at least one of each — every option a self-contained statement (no "all of the above", no option that depends on another).
6. MCQ: exactly ONE option is correct. Distractors must be plausible but definitively wrong; no joke options, no "all/none of the above".
7. CODE: the task must be objectively verifiable via stdout and/or exit code. Provide 2-5 hiddenCases with exact expectedStdout / expectedExit; a case may pass stdin and/or args. The prompt may show at most one visible example — never the hidden cases. language is BASH, NODE or PYTHON; starterCode is optional scaffolding.
8. WRITTEN: the rubric (20-1000 chars) lists the concrete points a correct answer must cover, in checkable terms — not "discusses caching well" but "names cache invalidation AND TTL strategy".
9. NO personal data: no real people's names, no private information about anyone.
10. Every item: topics = 1-3 short labels taken from the section's topic list; difficulty = EASY, MEDIUM or HARD.

JSON shape per item (exact keys, nothing extra):
- {"format":"SWIPE_MCQ","prompt":"10-2000 chars","options":[{"id":"a","text":"up to 500 chars","truth":true}, ...3-6 options...],"difficulty":"EASY","topics":["..."]}
- {"format":"MCQ","prompt":"...","options":[{"id":"a","text":"..."}, ...3-6 options...],"correctOptionId":"a","difficulty":"MEDIUM","topics":["..."]}
- {"format":"WRITTEN","prompt":"...","rubric":"20-1000 chars","difficulty":"HARD","topics":["..."]}
- {"format":"CODE","prompt":"...","language":"PYTHON","starterCode":"optional, up to 5000 chars","hiddenCases":[{"name":"up to 60 chars","stdin":"optional","args":["optional, up to 10"],"expectedStdout":"...","expectedExit":0}, ...2-5 cases...],"difficulty":"MEDIUM","topics":["..."]}`;

const JD_DESCRIPTION_CAP = 12_000;

/**
 * Builds the user message for ONE generation batch: exactly `count` items for
 * ONE section (its `formats` map carries this batch's per-format counts — the
 * caller narrows it to the batch's format(s) before calling). Pure.
 */
export function buildItemsUserPrompt(input: {
  jdTitle: string;
  jdDescription: string;
  section: BlueprintSection;
  count: number;
}): string {
  const formatLines = QUESTION_FORMATS.filter((f) => (input.section.formats[f] ?? 0) > 0).map(
    (f) => `  - ${f}: ${input.section.formats[f]} item(s)`,
  );

  // The JD derives from web content an attacker may influence — strip the
  // delimiter markers from it so embedded text cannot forge a premature
  // "END" and smuggle instructions past the boundary (QA wave-4 F6).
  const neutralizedJd = input.jdDescription
    .slice(0, JD_DESCRIPTION_CAP)
    .replace(/={2,}\s*JOB DESCRIPTION\s*(START|END)\s*={2,}/gi, '[marker removed]')
    .trim() || '(empty job description)';

  const parts: string[] = [
    `Generate assessment items for ONE section of a hiring test for the role below. Produce EXACTLY ${input.count} item(s) in total — not fewer, not more.`,
    '',
    `Role: ${input.jdTitle}`,
    '',
    '=== JOB DESCRIPTION START ===',
    neutralizedJd,
    '=== JOB DESCRIPTION END ===',
    '',
    `Section${input.section.title ? ` (${input.section.title})` : ''}:`,
    `- Topics (each item must target at least one): ${input.section.topics.join(', ')}`,
    '- Items for this batch, by format:',
    ...formatLines,
  ];

  if (input.section.difficultyMix) {
    parts.push(
      `- Difficulty mix: ${input.section.difficultyMix} (EASY_HEAVY = mostly easy, BALANCED = even spread, HARD_HEAVY = mostly hard)`,
    );
  }

  parts.push(
    '',
    'Every item must be grounded in the job description and follow the exact JSON shapes from the system rules.',
    `Return {"items":[...]} with exactly ${input.count} item(s) now.`,
  );
  return parts.join('\n');
}
