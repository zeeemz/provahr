import { describe, it, expect } from 'vitest';
import { backoffMs } from '../src/lib/queue';

// enqueue / claimNext / complete / fail / requeueStale are DB-backed — they
// need a real Postgres and belong to CI's integration tier (same note as
// admin-routes.test.ts). The pure retry curve is what unit tests cover here.

describe('backoffMs', () => {
  it('starts at 5s and doubles per attempt', () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(20_000);
    expect(backoffMs(4)).toBe(40_000);
    expect(backoffMs(5)).toBe(80_000);
    expect(backoffMs(6)).toBe(160_000);
  });

  it('caps at 5 minutes', () => {
    expect(backoffMs(7)).toBe(300_000); // 320_000 uncapped
    expect(backoffMs(8)).toBe(300_000);
    expect(backoffMs(50)).toBe(300_000);
    expect(backoffMs(10_000)).toBe(300_000);
  });

  it('is monotonic non-decreasing', () => {
    let previous = 0;
    for (let attempts = 1; attempts <= 64; attempts++) {
      const value = backoffMs(attempts);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});
