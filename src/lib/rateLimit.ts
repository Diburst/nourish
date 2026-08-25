import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export type LimitType = 'auth' | 'agentWrite' | 'read' | 'admin';

const LIMITS: Record<LimitType, { limit: number; windowMs: number }> = {
  auth: { limit: 10, windowMs: 60_000 },
  agentWrite: { limit: 120, windowMs: 60_000 },
  read: { limit: 600, windowMs: 60_000 },
  admin: { limit: 60, windowMs: 60_000 },
};

// ---- in-memory sliding window (default) ----
const buckets = new Map<string, number[]>();

function inMemoryAllow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

// ---- Upstash (lazy init; a misconfig can never crash module load) ----
let upstash: { limit: (key: string) => Promise<{ success: boolean }> } | null | undefined;

async function getUpstash(type: LimitType) {
  if (upstash !== undefined) return upstash;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    upstash = null;
    return upstash;
  }
  try {
    const { Ratelimit } = await import('@upstash/ratelimit');
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url, token });
    const cfg = LIMITS[type];
    upstash = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(cfg.limit, `${cfg.windowMs} ms`),
      prefix: 'nourish',
    });
  } catch (error) {
    logger.warn('Upstash init failed; falling back to in-memory rate limiting', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    upstash = null;
  }
  return upstash;
}

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Rate limit a request. `key` should be the token id / user id for authenticated
 * traffic; falls back to client IP. Returns a 429 response or null.
 */
export async function applyRateLimit(
  request: NextRequest,
  endpoint: string,
  type: LimitType,
  key?: string
): Promise<NextResponse | null> {
  const cfg = LIMITS[type];
  const bucketKey = `${type}:${key ?? clientIp(request)}`;
  let allowed: boolean;
  const limiter = await getUpstash(type);
  if (limiter) {
    try {
      allowed = (await limiter.limit(bucketKey)).success;
    } catch {
      allowed = inMemoryAllow(bucketKey, cfg.limit, cfg.windowMs);
    }
  } else {
    allowed = inMemoryAllow(bucketKey, cfg.limit, cfg.windowMs);
  }
  if (!allowed) {
    logger.warn('Rate limited', { endpoint, type, key: bucketKey });
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  return null;
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
