import { ApiError } from './errors';

/**
 * Fixed-window rate limiter (in-memory, per process).
 *
 * Good enough for a single instance and for tests; with several instances the
 * limits apply per instance. The `check` signature is what a Redis-backed
 * implementation (token bucket, planned with BullMQ in Phase 3/4) will keep.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now = Date.now()
) {
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });

    if (buckets.size > 10000) {
      buckets.forEach((b, k) => b.resetAt <= now && buckets.delete(k));
    }

    return { ok: true, remaining: limit - 1 };
  }

  bucket.count += 1;

  return {
    ok: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
  };
}

export function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
) {
  if (process.env.DISABLE_RATE_LIMIT === 'true') {
    return;
  }

  if (!rateLimit(key, limit, windowSeconds).ok) {
    throw new ApiError(429, 'Too many requests. Please try again later.');
  }
}

export const clientIp = (req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}) => {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();

  return first || req.socket?.remoteAddress || 'unknown';
};

export const resetRateLimits = () => buckets.clear();
