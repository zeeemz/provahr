import { describe, it, expect } from 'vitest';
import {
  STAGES,
  isStage,
  canTransition,
  transitionsFrom,
  canReject,
  canWithdraw,
  canReopen,
  statusAfter,
  AI_PIPELINE_STAGES,
  isAiPipelineStage,
  canTransitionAiPipeline,
  aiPipelineTransitionsFrom,
} from '../src/rules/pipeline';

describe('stage validation', () => {
  it('recognizes every stage name', () => {
    for (const stage of STAGES) {
      expect(isStage(stage)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isStage('APPLIED ')).toBe(false);
    expect(isStage('applied')).toBe(false);
    expect(isStage('ARCHIVED')).toBe(false);
    expect(isStage(42)).toBe(false);
    expect(isStage(undefined)).toBe(false);
  });
});

describe('stage transitions', () => {
  it('allows the standard forward path', () => {
    expect(canTransition('APPLIED', 'SCREENING')).toBe(true);
    expect(canTransition('SCREENING', 'ASSESSMENT')).toBe(true);
    expect(canTransition('ASSESSMENT', 'INTERVIEW')).toBe(true);
    expect(canTransition('INTERVIEW', 'OFFER')).toBe(true);
    expect(canTransition('OFFER', 'HIRED')).toBe(true);
  });

  it('allows skipping stages where the process allows it', () => {
    expect(canTransition('APPLIED', 'INTERVIEW')).toBe(true);
    expect(canTransition('SCREENING', 'INTERVIEW')).toBe(true);
  });

  it('allows moving backwards', () => {
    expect(canTransition('INTERVIEW', 'SCREENING')).toBe(true);
    expect(canTransition('OFFER', 'INTERVIEW')).toBe(true);
    expect(canTransition('SCREENING', 'APPLIED')).toBe(true);
  });

  it('rejects invalid jumps', () => {
    expect(canTransition('APPLIED', 'OFFER')).toBe(false);
    expect(canTransition('APPLIED', 'HIRED')).toBe(false);
    expect(canTransition('SCREENING', 'OFFER')).toBe(false);
    expect(canTransition('ASSESSMENT', 'OFFER')).toBe(false);
    expect(canTransition('INTERVIEW', 'HIRED')).toBe(false); // must pass through OFFER
  });

  it('never allows staying in the same stage', () => {
    for (const stage of STAGES) {
      expect(canTransition(stage, stage)).toBe(false);
    }
  });

  it('treats HIRED as terminal', () => {
    expect(transitionsFrom('HIRED')).toEqual([]);
    for (const stage of STAGES) {
      expect(canTransition('HIRED', stage)).toBe(false);
    }
  });
});

describe('status actions', () => {
  it('rejects only active, not-yet-hired applications', () => {
    expect(canReject('SCREENING', 'ACTIVE')).toBe(true);
    expect(canReject('OFFER', 'ACTIVE')).toBe(true);
    expect(canReject('HIRED', 'ACTIVE')).toBe(false);
    expect(canReject('SCREENING', 'REJECTED')).toBe(false);
    expect(canReject('SCREENING', 'WITHDRAWN')).toBe(false);
  });

  it('withdraws only active applications', () => {
    expect(canWithdraw('ACTIVE')).toBe(true);
    expect(canWithdraw('REJECTED')).toBe(false);
    expect(canWithdraw('WITHDRAWN')).toBe(false);
    expect(canWithdraw('HIRED')).toBe(false);
  });

  it('reopens only rejected or withdrawn applications', () => {
    expect(canReopen('REJECTED')).toBe(true);
    expect(canReopen('WITHDRAWN')).toBe(true);
    expect(canReopen('ACTIVE')).toBe(false);
    expect(canReopen('HIRED')).toBe(false);
  });

  it('maps actions to statuses', () => {
    expect(statusAfter('REJECT')).toBe('REJECTED');
    expect(statusAfter('WITHDRAW')).toBe('WITHDRAWN');
    expect(statusAfter('REOPEN')).toBe('ACTIVE');
  });
});

// ─── AI-loop pipeline (PLAN.md §4 step 7) — rules-level future flow ───────────

describe('enum-backed stages (constraint until the Stage enum migration)', () => {
  it('STAGES stays the Prisma Stage enum truth — no TEST/REVIEW until the next migration', () => {
    // applications.schema.ts zod enums reject TEST/REVIEW today; the rules
    // module must not advertise stages the database cannot store.
    expect(STAGES).toHaveLength(6);
    expect(STAGES).not.toContain('TEST');
    expect(STAGES).not.toContain('REVIEW');
    expect(STAGES).toContain('ASSESSMENT');
    expect(isStage('TEST')).toBe(false);
    expect(isStage('REVIEW')).toBe(false);
  });
});

describe('AI pipeline stage validation', () => {
  it('recognizes every AI pipeline stage name', () => {
    for (const stage of AI_PIPELINE_STAGES) {
      expect(isAiPipelineStage(stage)).toBe(true);
    }
  });

  it('keeps the PLAN §4 step 7 order: Applied → Test → Review → Interview → Offer → Hired', () => {
    const chain = ['APPLIED', 'TEST', 'REVIEW', 'INTERVIEW', 'OFFER', 'HIRED'];
    const indexes = chain.map((s) => AI_PIPELINE_STAGES.indexOf(s as (typeof AI_PIPELINE_STAGES)[number]));
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i]).toBeGreaterThan(indexes[i - 1]!); // strictly board-ordered
    }
    expect(AI_PIPELINE_STAGES).toHaveLength(7);
  });

  it('supersedes ASSESSMENT and rejects unknown values', () => {
    expect(isAiPipelineStage('ASSESSMENT')).toBe(false); // superseded by TEST
    expect(isAiPipelineStage('TEST ')).toBe(false);
    expect(isAiPipelineStage('hired')).toBe(false);
    expect(isAiPipelineStage(null)).toBe(false);
  });
});

describe('AI pipeline stage transitions', () => {
  it('allows the standard forward path', () => {
    expect(canTransitionAiPipeline('APPLIED', 'TEST')).toBe(true);
    expect(canTransitionAiPipeline('TEST', 'REVIEW')).toBe(true);
    expect(canTransitionAiPipeline('REVIEW', 'INTERVIEW')).toBe(true);
    expect(canTransitionAiPipeline('INTERVIEW', 'OFFER')).toBe(true);
    expect(canTransitionAiPipeline('OFFER', 'HIRED')).toBe(true);
  });

  it('keeps SCREENING as an optional human pre-screen around the test', () => {
    expect(canTransitionAiPipeline('APPLIED', 'SCREENING')).toBe(true);
    expect(canTransitionAiPipeline('SCREENING', 'TEST')).toBe(true);
    expect(canTransitionAiPipeline('SCREENING', 'INTERVIEW')).toBe(true);
  });

  it('allows moving backwards', () => {
    expect(canTransitionAiPipeline('SCREENING', 'APPLIED')).toBe(true);
    expect(canTransitionAiPipeline('TEST', 'SCREENING')).toBe(true);
    expect(canTransitionAiPipeline('REVIEW', 'SCREENING')).toBe(true);
    expect(canTransitionAiPipeline('INTERVIEW', 'REVIEW')).toBe(true);
    expect(canTransitionAiPipeline('OFFER', 'INTERVIEW')).toBe(true);
  });

  it('rejects invalid jumps', () => {
    expect(canTransitionAiPipeline('APPLIED', 'INTERVIEW')).toBe(false); // the test IS the entry gate
    expect(canTransitionAiPipeline('APPLIED', 'REVIEW')).toBe(false);
    expect(canTransitionAiPipeline('APPLIED', 'OFFER')).toBe(false);
    expect(canTransitionAiPipeline('TEST', 'INTERVIEW')).toBe(false); // must pass through REVIEW
    expect(canTransitionAiPipeline('TEST', 'OFFER')).toBe(false);
    expect(canTransitionAiPipeline('REVIEW', 'OFFER')).toBe(false);
    expect(canTransitionAiPipeline('REVIEW', 'TEST')).toBe(false); // a re-test is a NEW session, not a move
    expect(canTransitionAiPipeline('INTERVIEW', 'HIRED')).toBe(false); // must pass through OFFER
  });

  it('never allows staying in the same stage', () => {
    for (const stage of AI_PIPELINE_STAGES) {
      expect(canTransitionAiPipeline(stage, stage)).toBe(false);
    }
  });

  it('treats HIRED as terminal', () => {
    expect(aiPipelineTransitionsFrom('HIRED')).toEqual([]);
    for (const stage of AI_PIPELINE_STAGES) {
      expect(canTransitionAiPipeline('HIRED', stage)).toBe(false);
    }
  });
});
