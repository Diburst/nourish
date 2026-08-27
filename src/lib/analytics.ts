/**
 * Server-side PostHog capture — plain fetch to /capture/, no SDK. Privacy rule:
 * event names, ids and coarse properties only; NEVER nutrition payloads, meal names,
 * amounts or weights (the EntryRevision audit trail owns the details). Disabled
 * entirely unless POSTHOG_KEY is set; failures never block a request.
 */
import { logger } from '@/lib/logger';

export function analyticsEnabled(): boolean {
  return Boolean(process.env.POSTHOG_KEY);
}

function host(): string {
  return (process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(/\/$/, '');
}

/** Fire-and-forget event capture. */
export function capture(
  event: string,
  distinctId: string,
  properties: Record<string, string | number | boolean> = {}
): void {
  if (!analyticsEnabled()) return;
  fetch(`${host()}/capture/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.POSTHOG_KEY,
      event,
      distinct_id: distinctId,
      properties: { ...properties, source: 'nourish-server' },
      timestamp: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(3000),
  }).catch((error) => {
    logger.warn('Analytics capture failed', {
      event,
      error: error instanceof Error ? error.message : 'unknown',
    });
  });
}

/** Exception capture, wired into the top-level route error handler. */
export function captureError(operation: string, error: unknown): void {
  capture('server_error', 'server', {
    operation,
    message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
  });
}
