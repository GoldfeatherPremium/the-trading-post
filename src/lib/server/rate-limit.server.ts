/**
 * Tiny in-memory token bucket. Per-Worker instance — adequate for casual abuse
 * defense on auth/checkout/dispute/withdrawal endpoints. For multi-region
 * persistence, swap the store for a DB-backed counter later.
 */
const buckets = new Map<string, { tokens: number; resetAt: number }>();

export interface RateLimitOptions {
  /** Unique key (e.g. `login:${ip}` or `withdraw:${userId}`). */
  key: string;
  /** Maximum hits allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export class RateLimitedError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`Too many requests — try again in ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.retryAfterMs = retryAfterMs;
  }
}

export function rateLimit(opts: RateLimitOptions): void {
  const now = Date.now();
  const entry = buckets.get(opts.key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(opts.key, { tokens: opts.limit - 1, resetAt: now + opts.windowMs });
    return;
  }
  if (entry.tokens <= 0) {
    throw new RateLimitedError(entry.resetAt - now);
  }
  entry.tokens -= 1;
}

// Lazy cleanup so the map never grows unbounded
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}, 60_000).unref?.();
