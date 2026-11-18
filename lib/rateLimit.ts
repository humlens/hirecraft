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

// ---------------------------------------------------------------------------
// Token bucket (Redis-backed when REDIS_URL is set, in-memory otherwise)
// ---------------------------------------------------------------------------
import { getRedis } from './redis';

type TB = { tokens: number; ts: number };
const memoryBuckets = new Map<string, TB>();

const LUA = `
local key=KEYS[1]; local rate=tonumber(ARGV[1]); local cap=tonumber(ARGV[2]); local now=tonumber(ARGV[3]); local cost=tonumber(ARGV[4])
local d=redis.call('HMGET',key,'tokens','ts'); local tokens=tonumber(d[1]); local ts=tonumber(d[2])
if tokens==nil then tokens=cap; ts=now end
tokens=math.min(cap, tokens + (now-ts)*rate/1000)
local ok=0; if tokens>=cost then tokens=tokens-cost; ok=1 end
redis.call('HSET',key,'tokens',tokens,'ts',now); redis.call('PEXPIRE',key, math.ceil(cap/rate*1000)+1000)
return {ok, math.floor(tokens)}`;

/**
 * Token bucket: `perMinute` tokens per minute, burst = perMinute.
 * Returns whether a token was available.
 */
export async function takeToken(
  key: string,
  perMinute: number,
  now = Date.now()
) {
  const rate = perMinute / 60; // tokens per second
  const redis = getRedis();

  if (redis) {
    const [ok] = (await redis.eval(
      LUA,
      1,
      `rl:${key}`,
      rate,
      perMinute,
      now,
      1
    )) as [number, number];

    return ok === 1;
  }

  const b = memoryBuckets.get(key) ?? { tokens: perMinute, ts: now };

  b.tokens = Math.min(perMinute, b.tokens + ((now - b.ts) * rate) / 1000);
  b.ts = now;

  const ok = b.tokens >= 1;

  if (ok) {
    b.tokens -= 1;
  }

  memoryBuckets.set(key, b);

  return ok;
}

export const resetTokenBuckets = () => memoryBuckets.clear();
