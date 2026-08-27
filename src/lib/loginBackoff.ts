/**
 * Login backoff: 5 failures → 15-minute lockout, keyed by email. Durable via Upstash
 * (fixed 15-minute window; INCR per failure, DEL on success) when configured, so the
 * lockout holds across serverless instances; per-process in-memory otherwise.
 */
import { kvEnabled, kvWindowIncr, kvCommand, kvDelete } from '@/lib/kv';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

interface Entry {
  failures: number;
  lockedUntil: number | null;
  firstFailureAt: number;
}

const store = new Map<string, Entry>();

function memCheck(email: string): boolean {
  const e = store.get(email);
  if (!e) return false;
  if (e.lockedUntil && Date.now() < e.lockedUntil) return true;
  if (e.lockedUntil && Date.now() >= e.lockedUntil) {
    store.delete(email);
    return false;
  }
  if (Date.now() - e.firstFailureAt > WINDOW_MS) {
    store.delete(email);
    return false;
  }
  return false;
}

function memRecord(email: string): boolean {
  const now = Date.now();
  const e = store.get(email);
  if (!e || now - e.firstFailureAt > WINDOW_MS) {
    store.set(email, { failures: 1, lockedUntil: null, firstFailureAt: now });
    return false;
  }
  e.failures++;
  if (e.failures >= MAX_FAILURES && !e.lockedUntil) {
    e.lockedUntil = now + WINDOW_MS;
    return true;
  }
  return false;
}

const kvKey = (email: string) => `lb:${email.toLowerCase()}`;

/** Is this email currently locked out? */
export async function checkLoginBackoff(email: string): Promise<boolean> {
  if (kvEnabled()) {
    const count = await kvCommand(['GET', kvKey(email)]);
    if (count !== null) return Number(count) >= MAX_FAILURES;
    // KV unreachable → fall through to the in-memory view.
  }
  return memCheck(email);
}

/** Record a failure; returns true when this failure triggers the lockout. */
export async function recordLoginFailure(email: string): Promise<boolean> {
  if (kvEnabled()) {
    const count = await kvWindowIncr(kvKey(email), WINDOW_MS);
    if (count !== null) return count === MAX_FAILURES;
  }
  return memRecord(email);
}

export async function clearLoginFailures(email: string): Promise<void> {
  if (kvEnabled()) await kvDelete(kvKey(email));
  store.delete(email);
}

export function resetLoginBackoffForTests(): void {
  store.clear();
}
