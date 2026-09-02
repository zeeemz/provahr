import { describe, it, expect } from 'vitest';
import { isJobStatus, canTransitionJob } from '../src/rules/jobStatus';

describe('job status transitions', () => {
  it('recognizes valid statuses', () => {
    expect(isJobStatus('DRAFT')).toBe(true);
    expect(isJobStatus('OPEN')).toBe(true);
    expect(isJobStatus('PAUSED')).toBe(true);
    expect(isJobStatus('CLOSED')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isJobStatus('ARCHIVED')).toBe(false);
    expect(isJobStatus('open')).toBe(false);
  });

  it('follows the published lifecycle', () => {
    expect(canTransitionJob('DRAFT', 'OPEN')).toBe(true);
    expect(canTransitionJob('OPEN', 'PAUSED')).toBe(true);
    expect(canTransitionJob('OPEN', 'CLOSED')).toBe(true);
    expect(canTransitionJob('PAUSED', 'OPEN')).toBe(true);
    expect(canTransitionJob('PAUSED', 'CLOSED')).toBe(true);
  });

  it('never publishes straight from closed, drafts stay unpublished to paused', () => {
    expect(canTransitionJob('CLOSED', 'OPEN')).toBe(false);
    expect(canTransitionJob('DRAFT', 'PAUSED')).toBe(false);
    expect(canTransitionJob('DRAFT', 'CLOSED')).toBe(false);
  });

  it('never allows same-status transitions', () => {
    expect(canTransitionJob('OPEN', 'OPEN')).toBe(false);
    expect(canTransitionJob('CLOSED', 'CLOSED')).toBe(false);
  });
});
