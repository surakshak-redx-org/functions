import { RATE_LIMIT_MAX_TRACKED_KEYS } from './constants';

export interface RateLimiter {
  /** Records a hit; returns `false` when `key` is over its limit for the window. */
  allow: (key: string, nowMs: number) => boolean;
}

/**
 * Sliding-window limiter held in instance memory.
 *
 * Instances do not share state, so this is a best-effort brake, not a hard
 * guarantee; `maxInstances` on the function bounds the total. It still stops
 * a single client hammering one instance, which is the realistic abuse here.
 *
 * Memory is capped by evicting the least-recently-used key, so a flood of
 * distinct keys cannot reset everyone else's counters.
 *
 * @param limit - Maximum hits per key within the window.
 * @param windowMs - Window length in milliseconds.
 * @param maxKeys - Maximum distinct keys tracked at once.
 * @returns A limiter with its own private state.
 */
export function createRateLimiter(
  limit: number,
  windowMs: number,
  maxKeys: number = RATE_LIMIT_MAX_TRACKED_KEYS,
): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    allow(key: string, nowMs: number): boolean {
      const recent = (hits.get(key) ?? []).filter((at) => nowMs - at < windowMs);
      const allowed = recent.length < limit;
      if (allowed) recent.push(nowMs);

      // Delete then set so Map insertion order tracks recency.
      hits.delete(key);
      hits.set(key, recent);

      if (hits.size > maxKeys) {
        const oldest = hits.keys().next();
        if (oldest.done !== true) hits.delete(oldest.value);
      }
      return allowed;
    },
  };
}
