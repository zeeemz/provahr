// Pure unit tests for the Phase 5 session engine (PLAN.md §5.2 mechanisms
// 1–2, §4 loop step 4; docs/TESTING.md §3 Phase 5 T1, §2 T8 determinism, §6
// never-regress #5 clock). No database, no network, no wall-clock — every
// input is a fixture, every date is passed in.

import { describe, it, expect } from 'vitest';
import {
  assessmentItemSchema,
  countByFormat,
  drawSizes,
  newItemId,
  type AssessmentItem,
  type QuestionFormat,
} from '../src/lib/assessment/item';
import {
  drawSession,
  realizeVariant,
  seededRng,
  type DrawnQuestion,
  type PresentedQuestion,
} from '../src/lib/session/draw';
import {
  SUBMIT_GRACE_MS,
  deadlineFor,
  isExpired,
  remainingMs,
  withinSubmitGrace,
} from '../src/lib/session/clock';

// ─── Fixture builders (schema-parsed, like assessment-item.test.ts) ───────────

function swipeItem(): Record<string, unknown> {
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
  };
}

function mcqItem(): Record<string, unknown> {
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
  };
}

function writtenItem(): Record<string, unknown> {
  return {
    id: newItemId(),
    format: 'WRITTEN',
    prompt: 'Explain how you would make a checkout endpoint safe against double submission.',
    rubric: 'RUBRIC-SECRET names idempotency keys and replay semantics.',
    difficulty: 'MEDIUM',
    topics: ['api-design', 'payments'],
  };
}

function codeItem(): Record<string, unknown> {
  return {
    id: newItemId(),
    format: 'CODE',
    prompt: 'Write a bash script that prints the number of stdin lines containing ERROR.',
    language: 'BASH',
    starterCode: '#!/usr/bin/env bash\n',
    hiddenCases: [
      { name: 'HIDDEN-SECRET-clean', stdin: 'ok\n', expectedStdout: '0\n' },
      { name: 'HIDDEN-SECRET-two', stdin: 'ERROR one\nERROR two\n', expectedStdout: '2\n' },
    ],
    difficulty: 'EASY',
    topics: ['bash'],
  };
}

function itemsOf(format: QuestionFormat, n: number): AssessmentItem[] {
  const builder: Record<QuestionFormat, () => Record<string, unknown>> = {
    SWIPE_MCQ: swipeItem,
    MCQ: mcqItem,
    WRITTEN: writtenItem,
    CODE: codeItem,
  };
  return Array.from({ length: n }, () => assessmentItemSchema.parse(builder[format]()) as AssessmentItem);
}

// Blueprint mixing all four formats: draw = {2, 3, 1, 1} → total 7.
const MIXED_BLUEPRINT = {
  sections: [
    { topics: ['payments'], formats: { SWIPE_MCQ: 2, MCQ: 3 } },
    { topics: ['sql'], formats: { WRITTEN: 1, CODE: 1 } },
  ],
};

/** A pool at the seal-time guaranteed minimum: 6x the draw per format. */
function fullMixedPool(): AssessmentItem[] {
  return [
    ...itemsOf('SWIPE_MCQ', 12),
    ...itemsOf('MCQ', 18),
    ...itemsOf('WRITTEN', 6),
    ...itemsOf('CODE', 6),
  ];
}

function idsOf(drawn: DrawnQuestion[]): string[] {
  return drawn.map((d) => d.item.id);
}

// ─── seededRng ────────────────────────────────────────────────────────────────

describe('seededRng', () => {
  it('same seed ⇒ identical number stream', () => {
    const a = seededRng('sess-1:pool-1');
    const b = seededRng('sess-1:pool-1');
    expect([a(), a(), a(), a(), a()]).toEqual([b(), b(), b(), b(), b()]);
  });

  it('different seed ⇒ different stream', () => {
    const a = seededRng('sess-1:pool-1');
    const b = seededRng('sess-2:pool-1');
    const streamA = Array.from({ length: 5 }, () => a());
    const streamB = Array.from({ length: 5 }, () => b());
    expect(streamA).not.toEqual(streamB);
  });

  it('yields floats in [0, 1)', () => {
    const rng = seededRng('any-seed');
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ─── drawSession: determinism (T8 property, deterministic form) ───────────────

describe('drawSession — determinism', () => {
  it('same seed + same pool ⇒ byte-identical draw twice', () => {
    const pool = fullMixedPool();
    const first = drawSession({ items: pool, blueprint: MIXED_BLUEPRINT, seed: 'sess-1:pool-1' });
    const second = drawSession({ items: pool, blueprint: MIXED_BLUEPRINT, seed: 'sess-1:pool-1' });
    expect(second).toEqual(first); // items AND orders identical
    expect(idsOf(second)).toEqual(idsOf(first));
    expect(second.map((d) => d.order)).toEqual(first.map((d) => d.order));
  });

  it('different seed ⇒ order differs on ≥90% of shuffled positions', () => {
    // MCQ-only blueprint with a 10-item draw and a 60-item pool (6x): two
    // seeds must produce near-completely different item sequences.
    const blueprint = { sections: [{ topics: ['api-design'], formats: { MCQ: 10 } }] };
    const pool = itemsOf('MCQ', 60);
    const a = idsOf(drawSession({ items: pool, blueprint, seed: 'sess-a:pool-1' }));
    const b = idsOf(drawSession({ items: pool, blueprint, seed: 'sess-b:pool-1' }));
    const differing = a.filter((id, i) => id !== b[i]).length;
    expect(differing / a.length).toBeGreaterThanOrEqual(0.9);
  });
});

// ─── drawSession: sizes, orders, interleave ───────────────────────────────────

describe('drawSession — sizes and shape', () => {
  const pool = fullMixedPool();
  const drawn = drawSession({ items: pool, blueprint: MIXED_BLUEPRINT, seed: 'sess-1:pool-1' });

  it('draws exactly the blueprint per-format sizes', () => {
    expect(countByFormat(drawn.map((d) => d.item))).toEqual(drawSizes(MIXED_BLUEPRINT));
    expect(drawn).toHaveLength(7);
  });

  it('assigns each order 1..N exactly once (1-based, gapless)', () => {
    expect(drawn.map((d) => d.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('never draws the same item twice', () => {
    expect(new Set(idsOf(drawn)).size).toBe(drawn.length);
  });

  it('only draws items from the pool', () => {
    const poolIds = new Set(pool.map((i) => i.id));
    for (const id of idsOf(drawn)) expect(poolIds.has(id)).toBe(true);
  });

  it('interleaves formats round-robin (one per format per round)', () => {
    // Round 1: SWIPE_MCQ, MCQ, WRITTEN, CODE → round 2: SWIPE_MCQ, MCQ, MCQ.
    expect(drawn.map((d) => d.item.format)).toEqual([
      'SWIPE_MCQ',
      'MCQ',
      'WRITTEN',
      'CODE',
      'SWIPE_MCQ',
      'MCQ',
      'MCQ',
    ]);
  });
});

describe('drawSession — defensive paths', () => {
  it('draws everything available when the pool bucket is smaller than the draw size', () => {
    const pool = itemsOf('MCQ', 1);
    const drawn = drawSession({
      items: pool,
      blueprint: { sections: [{ topics: ['api-design'], formats: { MCQ: 3 } }] },
      seed: 's',
    });
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.order).toBe(1);
  });

  it('skips formats with a zero draw size even when the pool has items', () => {
    const drawn = drawSession({
      items: fullMixedPool(),
      blueprint: { sections: [{ topics: ['api-design'], formats: { MCQ: 2 } }] },
      seed: 's',
    });
    expect(drawn).toHaveLength(2);
    expect(drawn.every((d) => d.item.format === 'MCQ')).toBe(true);
  });
});

// ─── realizeVariant: the candidate surface (never-regress #2 adjacent) ────────

describe('realizeVariant — leak-proofing', () => {
  const TRUTH_KEYS = /truth|correctOptionId|rubric|hiddenCases/;

  it('presented NEVER contains truth/correctOptionId/rubric/hiddenCases (deep JSON scan)', () => {
    const all: AssessmentItem[] = [
      assessmentItemSchema.parse(swipeItem()) as AssessmentItem,
      assessmentItemSchema.parse(mcqItem()) as AssessmentItem,
      assessmentItemSchema.parse(writtenItem()) as AssessmentItem,
      assessmentItemSchema.parse(codeItem()) as AssessmentItem,
    ];
    for (const item of all) {
      const presented = realizeVariant(item, seededRng(`seed:${item.id}`));
      const json = JSON.stringify(presented);
      expect(json).not.toMatch(TRUTH_KEYS);
      // Fixture-borne secrets never reach the candidate view either.
      expect(json).not.toContain('RUBRIC-SECRET');
      expect(json).not.toContain('HIDDEN-SECRET');
    }
  });

  it('WRITTEN presented is exactly { prompt }', () => {
    const item = assessmentItemSchema.parse(writtenItem()) as AssessmentItem;
    const presented = realizeVariant(item, seededRng('s'));
    expect(Object.keys(presented).sort()).toEqual(['prompt']);
    expect(presented.prompt).toBe(item.prompt);
  });

  it('CODE presented carries language + starterCode but never hidden cases', () => {
    const item = assessmentItemSchema.parse(codeItem()) as AssessmentItem;
    const presented = realizeVariant(item, seededRng('s')) as PresentedQuestion & {
      language?: string;
      starterCode?: string;
    };
    expect(presented.language).toBe('BASH');
    expect(presented.starterCode).toBe('#!/usr/bin/env bash\n');
    expect(Object.keys(presented).sort()).toEqual(['language', 'prompt', 'starterCode']);
  });

  it('keeps the POOL option ids (scoring keys stable across sessions)', () => {
    for (const builder of [swipeItem, mcqItem]) {
      const item = assessmentItemSchema.parse(builder()) as AssessmentItem;
      const presented = realizeVariant(item, seededRng('s'));
      const poolOptions = 'options' in item ? item.options : [];
      expect(new Set(presented.options!.map((o) => o.id))).toEqual(
        new Set(poolOptions.map((o) => o.id)),
      );
      // Same texts too — content is invariant, only order varies (v1).
      expect(new Set(presented.options!.map((o) => o.text))).toEqual(
        new Set(poolOptions.map((o) => o.text)),
      );
    }
  });
});

describe('realizeVariant — option-order variation', () => {
  type McqItem = Extract<AssessmentItem, { format: 'MCQ' }>;

  /** A 6-option MCQ: 720 orderings, so an unchanged order is 1/720 per seed. */
  function sixOptionMcq(): McqItem {
    return assessmentItemSchema.parse({
      id: newItemId(),
      format: 'MCQ',
      prompt: 'Pick the correct statement about distributed retries.',
      options: [1, 2, 3, 4, 5, 6].map((i) => ({ id: `o${i}`, text: `Claim number ${i}.` })),
      correctOptionId: 'o1',
      difficulty: 'MEDIUM',
      topics: ['api-design'],
    }) as McqItem;
  }

  const item = sixOptionMcq();
  const poolOrder = item.options.map((o) => o.id).join(',');

  it('same seed ⇒ same option order (variant determinism)', () => {
    const a = realizeVariant(item, seededRng('sess-1:item-1'));
    const b = realizeVariant(item, seededRng('sess-1:item-1'));
    expect(a).toEqual(b);
  });

  it('most sessions see a different option order than the pool order', () => {
    let reordered = 0;
    const seeds = Array.from({ length: 8 }, (_, i) => `sess-${i}:item-1`);
    for (const seed of seeds) {
      const presented = realizeVariant(item, seededRng(seed));
      if (presented.options!.map((o) => o.id).join(',') !== poolOrder) reordered++;
    }
    expect(reordered).toBeGreaterThanOrEqual(3); // P(fail) ≈ C(8,2)·(1/720)² — negligible
  });

  it('two sessions on the same item usually see different orders from each other', () => {
    let differed = 0;
    const seeds = Array.from({ length: 8 }, (_, i) => `sess-${i}:item-1`);
    const orders = seeds.map((seed) =>
      realizeVariant(item, seededRng(seed)).options!.map((o) => o.id).join(','),
    );
    for (let i = 1; i < orders.length; i++) {
      if (orders[i] !== orders[0]) differed++;
    }
    expect(differed).toBeGreaterThanOrEqual(3);
  });
});

// ─── Clock (never-regress #5: the clock never pauses) ─────────────────────────

describe('session clock', () => {
  const T0 = new Date('2026-01-01T10:00:00.000Z');
  const deadline = deadlineFor(T0, 45);

  it('deadlineFor: start + timeLimitMin exactly', () => {
    expect(deadline).toEqual(new Date('2026-01-01T10:45:00.000Z'));
    expect(deadlineFor(T0, 10)).toEqual(new Date('2026-01-01T10:10:00.000Z'));
  });

  it('remainingMs: positive before, zero at, negative after the deadline', () => {
    expect(remainingMs(deadline, new Date('2026-01-01T10:44:59.999Z'))).toBe(1);
    expect(remainingMs(deadline, deadline)).toBe(0);
    expect(remainingMs(deadline, new Date('2026-01-01T10:45:00.001Z'))).toBe(-1);
    expect(remainingMs(deadline, new Date('2026-01-01T11:00:00.000Z'))).toBe(-15 * 60_000);
  });

  it('isExpired: false before, true at the exact deadline and after', () => {
    expect(isExpired(deadline, new Date('2026-01-01T10:44:59.999Z'))).toBe(false);
    expect(isExpired(deadline, deadline)).toBe(true);
    expect(isExpired(deadline, new Date('2026-01-01T10:45:00.001Z'))).toBe(true);
  });

  it('submit grace is 60s and its boundaries are exact', () => {
    expect(SUBMIT_GRACE_MS).toBe(60_000);
    // Before the deadline and at it: submit counts.
    expect(withinSubmitGrace(deadline, T0)).toBe(true);
    expect(withinSubmitGrace(deadline, deadline)).toBe(true);
    // Exactly 60s past: still counts (≤ grace).
    expect(withinSubmitGrace(deadline, new Date('2026-01-01T10:46:00.000Z'))).toBe(true);
    // One ms past the grace: refused.
    expect(withinSubmitGrace(deadline, new Date('2026-01-01T10:46:00.001Z'))).toBe(false);
    expect(withinSubmitGrace(deadline, new Date('2026-01-01T11:00:00.000Z'))).toBe(false);
  });
});
