// Generic fixed-window in-memory rate limiter — extracted from the setup
// wizard's proven per-IP pattern (setup.router.ts) so every public surface
// can reuse one implementation. Zero dependencies.
//
// LIMITS (documented honestly): state lives in this process's heap. Counters
// are per-instance (a restart or a second API process resets/splits them) —
// acceptable for the single-process v1 deploy; swap in a shared store (Redis
// et al.) before scaling horizontally.

export interface RateLimiterOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum allowed hits per key inside one window. */
  max: number;
}

/** Upper bound on tracked keys before the periodic cleanup sweep runs. */
const MAX_TRACKED_KEYS = 1000;

/**
 * Creates a limiter with its own independent counters. Returns `allow(key)`:
 * `true` = let the request through (hit recorded), `false` = over the limit
 * (hit NOT recorded — a flood of refusals must not extend honest clients'
 * windows once they come back inside the original one).
 */
export function createRateLimiter(opts: RateLimiterOptions): (key: string) => boolean {
  const { windowMs, max } = opts;
  const hits = new Map<string, number[]>();

  return function allow(key: string): boolean {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      // Keep the (filtered) window so expiry still works, but add nothing.
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    // Periodic, size-capped cleanup so the Map cannot grow without bound.
    if (hits.size > MAX_TRACKED_KEYS) {
      for (const [k, timestamps] of hits) {
        if (timestamps.every((t) => now - t >= windowMs)) hits.delete(k);
      }
    }
    return true;
  };
}
