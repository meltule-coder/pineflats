import type { Request, Response, NextFunction } from 'express';

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec?: number;
  remaining?: number;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

/** In-memory sliding-window counters keyed by `bucket:ip`. */
const buckets = new Map<string, BucketEntry>();

export function clientIp(req: Request): string {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (forwarded) return forwarded;
  return String(req.socket.remoteAddress || 'unknown');
}

/**
 * Fixed-window rate limit.
 * @param key unique key e.g. `comments:1.2.3.4`
 * @param max maximum requests in the window
 * @param windowMs window length in ms
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }
  entry.count += 1;
  if (entry.count > max) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      remaining: 0,
    };
  }
  return { ok: true, remaining: Math.max(0, max - entry.count) };
}

export function clearRateLimit(key: string) {
  buckets.delete(key);
}

/** Periodically drop expired entries to avoid unbounded growth. */
export function pruneRateLimits() {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

setInterval(pruneRateLimits, 5 * 60 * 1000).unref?.();

export type PublicWriteBucket =
  | 'comments'
  | 'bookings'
  | 'preview-login'
  | 'admin-login'
  | 'admin-recovery';

const PUBLIC_LIMITS: Record<PublicWriteBucket, { max: number; windowMs: number }> = {
  comments: { max: 5, windowMs: 15 * 60 * 1000 },
  bookings: { max: 10, windowMs: 15 * 60 * 1000 },
  'preview-login': { max: 8, windowMs: 15 * 60 * 1000 },
  'admin-login': { max: 8, windowMs: 15 * 60 * 1000 },
  'admin-recovery': { max: 6, windowMs: 15 * 60 * 1000 },
};

export function checkPublicWriteLimit(
  bucket: PublicWriteBucket,
  ip: string
): RateLimitResult {
  const cfg = PUBLIC_LIMITS[bucket];
  return checkRateLimit(`${bucket}:${ip}`, cfg.max, cfg.windowMs);
}

/** Express middleware factory for a named public-write bucket. */
export function publicWriteRateLimit(bucket: PublicWriteBucket) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = checkPublicWriteLimit(bucket, clientIp(req));
    if (!result.ok) {
      res.setHeader('Retry-After', String(result.retryAfterSec ?? 60));
      return res.status(429).json({
        error: `Too many requests. Try again in ${result.retryAfterSec}s.`,
      });
    }
    next();
  };
}
