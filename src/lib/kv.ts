/**
 * Minimal Upstash-Redis-REST client. Deliberately fetch-only (no SDK): the protocol
 * is a POST of ["CMD", args...] (or a /pipeline of them), which keeps the dependency
 * surface at zero and makes the wiring fully testable against a local fake server.
 *
 * Configured by UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN; when absent every
 * caller falls back to its in-memory behavior (correct for the single-process
 * Mac-mini deployment, decorative on serverless — hence the Vercel preflight check).
 */
import { logger } from '@/lib/logger';

export type KvCommand = (string | number)[];

export function kvEnabled(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/** Run commands as a pipeline. Returns each command's result, or null on any failure. */
export async function kvPipeline(commands: KvCommand[]): Promise<unknown[] | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      logger.warn('KV pipeline failed', { status: res.status });
      return null;
    }
    const body = (await res.json()) as { result?: unknown; error?: string }[];
    if (!Array.isArray(body) || body.some((r) => r.error)) {
      logger.warn('KV pipeline command error', {
        error: Array.isArray(body) ? body.find((r) => r.error)?.error : 'malformed response',
      });
      return null;
    }
    return body.map((r) => r.result);
  } catch (error) {
    logger.warn('KV unreachable; caller falls back to in-memory', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

export async function kvCommand(command: KvCommand): Promise<unknown | null> {
  const results = await kvPipeline([command]);
  return results ? results[0] : null;
}

/**
 * Fixed-window counter: INCR the key and stamp the window TTL on first hit.
 * Returns the count within the current window, or null when KV is off/unreachable
 * (callers then use their in-memory path — fail-open by design: a KV outage
 * degrades to per-instance limiting rather than locking everyone out).
 */
export async function kvWindowIncr(key: string, windowMs: number): Promise<number | null> {
  const results = await kvPipeline([
    ['INCR', key],
    ['PEXPIRE', key, windowMs, 'NX'],
  ]);
  if (!results) return null;
  const count = Number(results[0]);
  return Number.isFinite(count) ? count : null;
}

export async function kvDelete(key: string): Promise<void> {
  await kvCommand(['DEL', key]);
}
