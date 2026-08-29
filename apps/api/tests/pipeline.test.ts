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
