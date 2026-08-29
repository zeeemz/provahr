// Pure per-session draw & variant engine (PLAN.md Phase 5, §4 loop step 4,
// §5.2 mechanisms 1–2). PURE: no database, no clock, no network — everything
// here is a deterministic function of (seed, pool, blueprint), which is what
// makes the never-regress determinism property (docs/TESTING.md §2 T8)
// testable without fast-check.
//
// Determinism contract: the same seed string over the same pool array yields
// the identical draw (item set, per-format picks, interleaved question order)
// and the identical realized variants. The service seeds everything from
// persisted or immutable values — `${session.id}:${pool.id}` for the draw,
// `${seed}:${itemId}` per question — so a draw is reproducible from the
// database alone, never from client input.
//
// v1 variant surface: option-ORDER shuffling only. Structural data variants
// (different scenario values, log contents, constants) are a later phase;
// realizeVariant is the single place they will land.

import {
  QUESTION_FORMATS,
  drawSizes,
  type AssessmentItem,
  type BlueprintSection,
  type QuestionFormat,
} from '../assessment/item';

// ─── Seeded PRNG (zero dependencies) ──────────────────────────────────────────

/** FNV-1a 32-bit string hash — tiny, stable across processes and Node versions. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, well-distributed; yields floats in [0, 1). */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic rng factory: the same seed string ⇒ the same number stream. */
export function seededRng(seed: string): () => number {
  return mulberry32(hashSeed(seed));
}

/** Fisher–Yates over a copy — the input array is never mutated. */
function shuffled<T>(arr: readonly T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

// ─── The candidate-visible surface (PLAN.md §5.1 "Session items") ─────────────

export interface PresentedOption {
  /** The POOL option id — scoring keys stay stable across sessions/variants. */
  id: string;
  text: string;
}

/**
 * What a candidate may see for one question. Deliberately narrow: prompt plus
 * (format-dependent) options / language / starterCode. Truth flags,
 * correctOptionId, rubrics and hidden cases are UNREPRESENTABLE here — see
 * the compile-time guards below.
 */
export interface PresentedQuestion {
  prompt: string;
  options?: PresentedOption[];
  language?: string;
  starterCode?: string;
}

// Compile-time leak guards: realizeVariant's output type cannot grow a truth
// channel by accident. Each check resolves to `true` while the key is absent;
// if any forbidden key ever appears on the type, the assignment below fails
// to compile (tsc --noEmit is a CI gate).
type KeyAbsent<T, K extends PropertyKey> = K extends keyof T ? never : true;
const _presentedCarriesNoTruth: [
  KeyAbsent<PresentedQuestion, 'truth'>,
  KeyAbsent<PresentedQuestion, 'correctOptionId'>,
  KeyAbsent<PresentedQuestion, 'rubric'>,
  KeyAbsent<PresentedQuestion, 'hiddenCases'>,
  KeyAbsent<PresentedOption, 'truth'>,
] = [true, true, true, true, true];
void _presentedCarriesNoTruth;

// ─── Variant realization (PLAN.md §5.2 mechanism 2, v1) ───────────────────────

/**
 * Realizes the candidate view of one item for THIS session.
 *
 * v1 varies option ORDER only — the option ids themselves are kept (answers
 * and scoring stay keyed to the pool's ids). The mapping is exhaustive per
 * format and copies fields explicitly (never a spread of the sealed item), so
 * a new truth-bearing field on AssessmentItem cannot silently flow through.
 */
export function realizeVariant(item: AssessmentItem, rng: () => number): PresentedQuestion {
  switch (item.format) {
    case 'SWIPE_MCQ':
      return {
        prompt: item.prompt,
        options: shuffled(item.options, rng).map(({ id, text }) => ({ id, text })), // truth stripped by construction
      };
    case 'MCQ':
      return {
        prompt: item.prompt,
        options: shuffled(item.options, rng).map(({ id, text }) => ({ id, text })), // correctOptionId lives on the item, never copied
      };
    case 'CODE':
      // No structural variation in v1 — language + starter code pass through;
      // hiddenCases stay sealed in the pool.
      return {
        prompt: item.prompt,
        language: item.language,
        ...(item.starterCode !== undefined ? { starterCode: item.starterCode } : {}),
      };
    case 'WRITTEN':
      return { prompt: item.prompt }; // rubric stays sealed in the pool
  }
}

// ─── The draw (PLAN.md §5.2 mechanism 1) ──────────────────────────────────────

export interface DrawInput {
  /** The decrypted sealed-pool items — the caller owns decryption (one site). */
  items: AssessmentItem[];
  blueprint: { sections: BlueprintSection[] };
  /** Any string; the service uses `${sessionId}:${poolId}` (both persisted). */
  seed: string;
}

export interface DrawnQuestion {
  item: AssessmentItem;
  /** 1-based presentation order — round-robin interleaved across formats. */
  order: number;
}

/**
 * Draws this session's questions. Per format (QUESTION_FORMATS order) the
 * qualifying pool items are shuffled with the seeded rng and the blueprint's
 * draw size is taken; the per-format picks are then interleaved round-robin
 * into the final order, so formats mix instead of clumping and no single
 * screenshot region maps to one format (§5.2 mechanism 4).
 *
 * If a format's pool bucket is smaller than its draw size (shrunken/corrupt
 * pool), everything available is drawn — a short test beats a dead session.
 * Seal-time validation (blueprint.service) makes that a defensive path only.
 */
export function drawSession(input: DrawInput): DrawnQuestion[] {
  const sizes = drawSizes(input.blueprint);
  const rng = seededRng(input.seed);

  const picked: Partial<Record<QuestionFormat, AssessmentItem[]>> = {};
  for (const format of QUESTION_FORMATS) {
    if (sizes[format] === 0) continue;
    const qualifying = input.items.filter((item) => item.format === format);
    if (qualifying.length === 0) continue;
    picked[format] = shuffled(qualifying, rng).slice(0, sizes[format]);
  }

  // Round-robin interleave: one item per format per round, QUESTION_FORMATS order.
  const drawn: DrawnQuestion[] = [];
  const queues = QUESTION_FORMATS.map((format) => picked[format] ?? []);
  let more = true;
  while (more) {
    more = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined) {
        drawn.push({ item: next, order: drawn.length + 1 });
        more = true;
      }
    }
  }
  return drawn;
}
