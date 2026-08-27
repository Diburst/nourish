import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { kvEnabled, kvWindowIncr } from '@/lib/kv';

export type LimitType = 'auth' | 'agentWrite' | 'read' | 'admin';

const LIMITS: Record<LimitType, { limit: number; windowMs: number }> = {
  auth: { limit: 10, windowMs: 60_000 },
  agentWrite: { limit: 120, windowMs: 60_000 },
  read: { limit: 600, windowMs: 60_000 },
  admin: { limit: 60, windowMs: 60_000 },
};

// ---- in-memory sliding window (single-process deployments, and the KV fallback) ----
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

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Rate limit a request. `key` should be the token id / user id for authenticated
 * traffic; falls back to client IP. Uses Upstash (fixed window via INCR+PEXPIRE)
 * when configured — required for serverless, where per-instance memory is
 * decorative — and the in-memory sliding window otherwise. Returns 429 or null.
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

  if (kvEnabled()) {
    const count = await kvWindowIncr(`rl:${bucketKey}`, cfg.windowMs);
    allowed = count === null ? inMemoryAllow(bucketKey, cfg.limit, cfg.windowMs) : count <= cfg.limit;
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
