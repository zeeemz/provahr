// Unit tests for the assessment-item vocabulary and pool math
// (PLAN.md Phase 3 + §5.2 mechanism 1). Pure — no database, no network.

import { describe, it, expect } from 'vitest';
import {
  assessmentItemSchema,
  blueprintSectionSchema,
  countByFormat,
  drawSizes,
  newItemId,
  poolSatisfiesBlueprint,
  requiredPoolSizes,
  type AssessmentItem,
  type QuestionFormat,
} from '../src/lib/assessment/item';

// ─── Builders ─────────────────────────────────────────────────────────────────

function swipeItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: newItemId(),
    format: 'SWIPE_MCQ',
    prompt: 'Which claims about this payments role are true?',
    options: [
      { id: 'a', text: 'Idempotency keys prevent duplicate charges.', truth: true },
      { id: 'b', text: 'Postgres has no native UUID type.', truth: false },
      { id: 'c', text: 'PCI scope shrinks when card data never touches your servers.', truth: true },
    ],
    difficulty: 'MEDIUM',
    topics: ['payments'],
    ...overrides,
  };
}

function mcqItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: newItemId(),
    format: 'MCQ',
    prompt: 'Which HTTP status should a well-formed idempotent replay return?',
    options: [
      { id: 'a', text: '200 with the original result body' },
      { id: 'b', text: '409 Conflict' },
      { id: 'c', text: '500 Internal Server Error' },
    ],
    correctOptionId: 'a',
    difficulty: 'EASY',
    topics: ['api-design'],
    ...overrides,
  };
}

function writtenItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: newItemId(),
    format: 'WRITTEN',
    prompt: 'Explain how you would make a checkout endpoint safe against double submission.',
    rubric: 'Names idempotency keys; explains storage; covers the replay response semantics.',
    difficulty: 'MEDIUM',
    topics: ['api-design', 'payments'],
    ...overrides,
  };
}

function codeItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: newItemId(),
    format: 'CODE',
    prompt: 'Write a bash script that prints the number of lines of stdin that contain the word ERROR.',
    language: 'BASH',
    hiddenCases: [
      { name: 'all clean', stdin: 'ok\nfine\n', expectedStdout: '0\n' },
      { name: 'two errors', stdin: 'ERROR one\nok\nERROR two\n', expectedStdout: '2\n' },
    ],
    difficulty: 'EASY',
    topics: ['bash'],
    ...overrides,
  };
}

const ALL_FORMATS: Array<[QuestionFormat, () => Record<string, unknown>]> = [
  ['SWIPE_MCQ', swipeItem],
  ['MCQ', mcqItem],
  ['WRITTEN', writtenItem],
  ['CODE', codeItem],
];

/** n schema-valid items of one format (each parsed to the canonical type). */
function itemsOf(format: QuestionFormat, n: number): AssessmentItem[] {
  const builder = Object.fromEntries(ALL_FORMATS)[format] as () => Record<string, unknown>;
  return Array.from({ length: n }, () => assessmentItemSchema.parse(builder()) as AssessmentItem);
}

// ─── Item schema: happy paths ─────────────────────────────────────────────────

describe('assessmentItemSchema — happy paths', () => {
  for (const [format, builder] of ALL_FORMATS) {
    it(`accepts a well-formed ${format} item`, () => {
      const parsed = assessmentItemSchema.safeParse(builder());
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.format).toBe(format);
        expect(parsed.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }
    });
  }

  it('accepts a CODE item with optional fields (starterCode, args, expectedExit) and 5 hidden cases', () => {
    const parsed = assessmentItemSchema.safeParse(
      codeItem({
        starterCode: '#!/usr/bin/env bash\ncount=0\n',
        hiddenCases: [1, 2, 3, 4, 5].map((i) => ({
          name: `case ${i}`,
          args: [`file${i}.log`],
          expectedExit: i,
        })),
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown format discriminator', () => {
    expect(assessmentItemSchema.safeParse({ ...swipeItem(), format: 'ORAL' }).success).toBe(false);
  });
});

// ─── Item schema: refinements ─────────────────────────────────────────────────

describe('assessmentItemSchema — refinements', () => {
  it('rejects a SWIPE_MCQ without a false option (all-true)', () => {
    const item = swipeItem({
      options: [
        { id: 'a', text: 'True one.', truth: true },
        { id: 'b', text: 'True two.', truth: true },
        { id: 'c', text: 'True three.', truth: true },
      ],
    });
    const parsed = assessmentItemSchema.safeParse(item);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes('options'))).toBe(true);
    }
  });

  it('rejects a SWIPE_MCQ without a true option (all-false)', () => {
    const item = swipeItem({
      options: [
        { id: 'a', text: 'False one.', truth: false },
        { id: 'b', text: 'False two.', truth: false },
        { id: 'c', text: 'False three.', truth: false },
      ],
    });
    expect(assessmentItemSchema.safeParse(item).success).toBe(false);
  });

  it('rejects a MCQ whose correctOptionId matches no option', () => {
    const parsed = assessmentItemSchema.safeParse(mcqItem({ correctOptionId: 'zz' }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes('correctOptionId'))).toBe(true);
    }
  });

  it('rejects a CODE item with fewer than 2 hidden cases', () => {
    const parsed = assessmentItemSchema.safeParse(
      codeItem({ hiddenCases: [{ name: 'only case', expectedStdout: '0\n' }] }),
    );
    expect(parsed.success).toBe(false);
  });

  it('rejects a CODE item with 6 hidden cases', () => {
    const parsed = assessmentItemSchema.safeParse(
      codeItem({ hiddenCases: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `c${i}`, expectedExit: 0 })) }),
    );
    expect(parsed.success).toBe(false);
  });

  it('rejects an unsupported CODE language', () => {
    expect(assessmentItemSchema.safeParse(codeItem({ language: 'RUST' })).success).toBe(false);
  });
});

// ─── Item schema: bounds ──────────────────────────────────────────────────────

describe('assessmentItemSchema — bounds', () => {
  it('rejects a 9-character prompt (boundary: 10 is the minimum)', () => {
    expect(assessmentItemSchema.safeParse(swipeItem({ prompt: '123456789' })).success).toBe(false);
    expect(assessmentItemSchema.safeParse(swipeItem({ prompt: '1234567890' })).success).toBe(true);
  });

  it('rejects 2 and 7 options', () => {
    const two = [
      { id: 'a', text: 'True.', truth: true },
      { id: 'b', text: 'False.', truth: false },
    ];
    expect(assessmentItemSchema.safeParse(swipeItem({ options: two })).success).toBe(false);
    expect(assessmentItemSchema.safeParse(mcqItem({ options: two })).success).toBe(false);

    const seven = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
      id: `o${i}`,
      text: `Claim ${i}.`,
      truth: i % 2 === 0,
    }));
    expect(assessmentItemSchema.safeParse(swipeItem({ options: seven })).success).toBe(false);
  });

  it('rejects a 19-character rubric (boundary: 20 is the minimum)', () => {
    expect(assessmentItemSchema.safeParse(writtenItem({ rubric: '1234567890123456789' })).success).toBe(false);
    expect(assessmentItemSchema.safeParse(writtenItem({ rubric: '12345678901234567890' })).success).toBe(true);
  });

  it('rejects 0 and 4 topics, and a 1-character topic', () => {
    expect(assessmentItemSchema.safeParse(writtenItem({ topics: [] })).success).toBe(false);
    expect(assessmentItemSchema.safeParse(writtenItem({ topics: ['a', 'b', 'c', 'd'] })).success).toBe(false);
    expect(assessmentItemSchema.safeParse(writtenItem({ topics: ['a'] })).success).toBe(false);
  });

  it('rejects an item without an id', () => {
    const { id: _id, ...noId } = swipeItem() as { id: string };
    expect(assessmentItemSchema.safeParse(noId).success).toBe(false);
  });
});

// ─── newItemId ────────────────────────────────────────────────────────────────

describe('newItemId', () => {
  it('mints distinct UUIDs', () => {
    const a = newItemId();
    const b = newItemId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(b).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ─── blueprintSectionSchema ───────────────────────────────────────────────────

describe('blueprintSectionSchema', () => {
  const validSection = {
    title: 'Core payments',
    topics: ['payments', 'api-design'],
    formats: { MCQ: 4, CODE: 1 },
    difficultyMix: 'BALANCED',
  };

  it('accepts a valid section and tolerates omitted optional fields', () => {
    expect(blueprintSectionSchema.safeParse(validSection).success).toBe(true);
    expect(blueprintSectionSchema.safeParse({ topics: ['payments'], formats: { WRITTEN: 2 } }).success).toBe(true);
  });

  it('rejects a section with no formats at all', () => {
    expect(blueprintSectionSchema.safeParse({ topics: ['payments'], formats: {} }).success).toBe(false);
  });

  it('rejects a format count of 0 or 11 (boundary: 1..10)', () => {
    expect(blueprintSectionSchema.safeParse({ topics: ['x-topic'], formats: { MCQ: 0, CODE: 2 } }).success).toBe(false);
    expect(blueprintSectionSchema.safeParse({ topics: ['x-topic'], formats: { MCQ: 11 } }).success).toBe(false);
    expect(blueprintSectionSchema.safeParse({ topics: ['x-topic'], formats: { MCQ: 10 } }).success).toBe(true);
  });

  it('rejects 0 or 6 topics', () => {
    expect(blueprintSectionSchema.safeParse({ topics: [], formats: { MCQ: 1 } }).success).toBe(false);
    expect(
      blueprintSectionSchema.safeParse({ topics: ['t1', 't2', 't3', 't4', 't5', 't6'], formats: { MCQ: 1 } }).success,
    ).toBe(false);
  });

  it('rejects an unknown difficultyMix', () => {
    expect(blueprintSectionSchema.safeParse({ ...validSection, difficultyMix: 'WILD' }).success).toBe(false);
  });
});

// ─── Pool math (PLAN.md §5.2 mechanism 1: pool >= 6x draw) ────────────────────

describe('drawSizes', () => {
  it('sums per-format counts across sections and zeros absent formats', () => {
    const draw = drawSizes({
      sections: [
        { topics: ['payments'], formats: { MCQ: 4, CODE: 1 } },
        { topics: ['sql'], formats: { MCQ: 2, WRITTEN: 3 } },
        { topics: ['bash'], formats: { CODE: 2 } },
      ],
    });
    expect(draw).toEqual({ SWIPE_MCQ: 0, MCQ: 6, WRITTEN: 3, CODE: 3 });
  });
});

describe('requiredPoolSizes', () => {
  it('multiplies by 6 by default and keeps zero-count formats at zero', () => {
    expect(requiredPoolSizes({ SWIPE_MCQ: 0, MCQ: 2, WRITTEN: 0, CODE: 1 })).toEqual({
      SWIPE_MCQ: 0,
      MCQ: 12,
      WRITTEN: 0,
      CODE: 6,
    });
  });

  it('honours a custom multiplier, including the draw-of-one boundary', () => {
    expect(requiredPoolSizes({ SWIPE_MCQ: 1, MCQ: 0, WRITTEN: 0, CODE: 0 }, 3)).toEqual({
      SWIPE_MCQ: 3,
      MCQ: 0,
      WRITTEN: 0,
      CODE: 0,
    });
    // The minimum legal blueprint: one item per session → a pool of exactly 6.
    expect(requiredPoolSizes({ SWIPE_MCQ: 1, MCQ: 0, WRITTEN: 0, CODE: 0 })).toEqual({
      SWIPE_MCQ: 6,
      MCQ: 0,
      WRITTEN: 0,
      CODE: 0,
    });
  });
});

describe('poolSatisfiesBlueprint', () => {
  const blueprint = {
    sections: [
      { topics: ['payments'], formats: { MCQ: 2, CODE: 1 } },
      { topics: ['sql'], formats: { MCQ: 1 } },
    ],
  };
  // draw = { MCQ: 3, CODE: 1 } → required at 6x = { MCQ: 18, CODE: 6 }

  it('is ok with empty shortfalls at exactly the required sizes', () => {
    const items = [...itemsOf('MCQ', 18), ...itemsOf('CODE', 6)];
    const check = poolSatisfiesBlueprint(items, blueprint);
    expect(check.ok).toBe(true);
    expect(check.shortfalls).toEqual({});
  });

  it('is ok when the pool over-satisfies the blueprint', () => {
    const items = [...itemsOf('MCQ', 20), ...itemsOf('CODE', 9), ...itemsOf('WRITTEN', 4)];
    expect(poolSatisfiesBlueprint(items, blueprint).ok).toBe(true);
  });

  it('reports per-format shortfalls', () => {
    const items = [...itemsOf('MCQ', 17), ...itemsOf('CODE', 6)];
    const check = poolSatisfiesBlueprint(items, blueprint);
    expect(check.ok).toBe(false);
    expect(check.shortfalls).toEqual({ MCQ: 1 });
  });

  it('reports every shortfall format for an empty pool', () => {
    const check = poolSatisfiesBlueprint([], blueprint);
    expect(check.ok).toBe(false);
    expect(check.shortfalls).toEqual({ MCQ: 18, CODE: 6 });
  });

  it('flags the exact boundary: one CODE item short of 6x', () => {
    expect(poolSatisfiesBlueprint([...itemsOf('MCQ', 18), ...itemsOf('CODE', 5)], blueprint).shortfalls).toEqual({
      CODE: 1,
    });
    expect(poolSatisfiesBlueprint([...itemsOf('MCQ', 18), ...itemsOf('CODE', 6)], blueprint).ok).toBe(true);
  });
});

describe('countByFormat', () => {
  it('tallies per format with zeros for absent formats', () => {
    expect(countByFormat([...itemsOf('WRITTEN', 2), ...itemsOf('CODE', 1)])).toEqual({
      SWIPE_MCQ: 0,
      MCQ: 0,
      WRITTEN: 2,
      CODE: 1,
    });
  });
});

// ─── QA wave-4 regression guards (F2 duplicate ids, F3 expectation-less cases) ─

describe('item schema — QA wave-4 refinements', () => {
  it('rejects duplicate option ids on MCQ (ambiguous correctOptionId)', () => {
    const item = {
      id: newItemId(),
      format: 'MCQ',
      prompt: 'Which command lists open ports?',
      options: [
        { id: 'a', text: 'ss -tlnp' },
        { id: 'a', text: 'curl localhost' },
        { id: 'c', text: 'ping -c 1' },
      ],
      correctOptionId: 'a',
      difficulty: 'EASY',
      topics: ['bash'],
    };
    expect(assessmentItemSchema.safeParse(item).success).toBe(false);
  });

  it('rejects duplicate option ids on SWIPE_MCQ (ambiguous valuations)', () => {
    const item = {
      id: newItemId(),
      format: 'SWIPE_MCQ',
      prompt: 'Which claims about SQL indexes are true?',
      options: [
        { id: 'a', text: 'Indexes speed up reads.', truth: true },
        { id: 'a', text: 'Indexes always slow writes.', truth: false },
        { id: 'c', text: 'Composite indexes have column order.', truth: true },
      ],
      difficulty: 'MEDIUM',
      topics: ['sql'],
    };
    expect(assessmentItemSchema.safeParse(item).success).toBe(false);
  });

  it('rejects a hidden case that expects nothing', () => {
    const item = {
      id: newItemId(),
      format: 'CODE',
      prompt: 'Write a bash one-liner that prints the third field of a colon-separated file.',
      language: 'BASH',
      hiddenCases: [
        { name: 'happy path', stdin: 'a:b:c\n', expectedStdout: 'c\n' },
        { name: 'asserts nothing' },
      ],
      difficulty: 'MEDIUM',
      topics: ['bash'],
    };
    expect(assessmentItemSchema.safeParse(item).success).toBe(false);
  });

  it('accepts a hidden case with only expectedExit', () => {
    const item = {
      id: newItemId(),
      format: 'CODE',
      prompt: 'Write a bash script that exits 7 when given the flag --fail.',
      language: 'BASH',
      hiddenCases: [
        { name: 'ok', args: [], expectedExit: 0 },
        { name: 'fail', args: ['--fail'], expectedExit: 7 },
      ],
      difficulty: 'MEDIUM',
      topics: ['bash'],
    };
    expect(assessmentItemSchema.safeParse(item).success).toBe(true);
  });
});
