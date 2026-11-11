import { AppError } from "@/lib/errors/AppError";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory sliding-window rate limiter, keyed by caller-supplied string
 * (typically `${ip}:${route}`). Sufficient for a single Node process.
 *
 * IMPORTANT: this does NOT coordinate across multiple server instances —
 * once this app is horizontally scaled, replace the Map below with a
 * Redis-backed counter (e.g. INCR + EXPIRE) so limits are enforced
 * globally rather than per-instance. Flagged here rather than silently
 * shipping a limiter that looks like real protection but isn't once you scale.
 */
const buckets = new Map<string, Bucket>();

export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw AppError.tooManyRequests();
  }

  bucket.count += 1;
}
