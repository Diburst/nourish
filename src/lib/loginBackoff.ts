/** In-memory login backoff: 5 failures → 15-minute lockout, keyed by email. */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

interface Entry {
  failures: number;
  lockedUntil: number | null;
  firstFailureAt: number;
}

const store = new Map<string, Entry>();

export function checkLoginBackoff(email: string): boolean {
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

/** Record a failure; returns true when this failure triggers the lockout. */
export function recordLoginFailure(email: string): boolean {
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

export function clearLoginFailures(email: string): void {
  store.delete(email);
}

export function resetLoginBackoffForTests(): void {
  store.clear();
}
