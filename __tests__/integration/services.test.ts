import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { startFakeUpstash, startFakeResend, startFakePosthog, eventually, FakeUpstash, FakeResend, FakePosthog } from './fakes';
import { applyRateLimit, resetRateLimitsForTests } from '@/lib/rateLimit';
import { checkLoginBackoff, recordLoginFailure, clearLoginFailures } from '@/lib/loginBackoff';
import { sendEmail, emailEnabled } from '@/lib/email';
import { capture, analyticsEnabled } from '@/lib/analytics';
import { kvWindowIncr } from '@/lib/kv';

let upstash: FakeUpstash;
let resend: FakeResend;
let posthog: FakePosthog;

function req(ip = '1.2.3.4') {
  return new NextRequest('http://localhost:3000/api/test', {
    headers: { 'x-forwarded-for': ip },
  });
}

beforeAll(async () => {
  upstash = await startFakeUpstash();
  resend = await startFakeResend();
  posthog = await startFakePosthog();
});

afterAll(async () => {
  await Promise.all([upstash.close(), resend.close(), posthog.close()]);
});

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_BASE_URL;
  delete process.env.EMAIL_FROM;
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
  resetRateLimitsForTests();
});

function enableKv() {
  process.env.UPSTASH_REDIS_REST_URL = upstash.url;
  process.env.UPSTASH_REDIS_REST_TOKEN = upstash.token;
}

describe('KV-backed rate limiting (fake Upstash over real HTTP)', () => {
  it('enforces the limit across the window and resets after expiry', async () => {
    enableKv();
    const key = `kvtest-${Date.now()}`;
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await applyRateLimit(req(), '/api/test', 'auth', key);
      last = res ? res.status : 200;
    }
    expect(last).toBe(429); // auth budget is 10/min

    upstash.tick(61_000); // window expires on the fake clock
    const after = await applyRateLimit(req(), '/api/test', 'auth', key);
    expect(after).toBeNull();
  });

  it('is shared state, not per-instance: raw counter increments server-side', async () => {
    enableKv();
    const a = await kvWindowIncr('shared-counter', 60_000);
    const b = await kvWindowIncr('shared-counter', 60_000);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('fails open to the in-memory limiter when KV is unreachable', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:9'; // nothing listens here
    process.env.UPSTASH_REDIS_REST_TOKEN = 'x';
    const res = await applyRateLimit(req(), '/api/test', 'read', 'failopen-key');
    expect(res).toBeNull(); // request allowed via fallback, not an outage-induced 500/429
  });

  it('without env vars, behaves exactly as before (in-memory)', async () => {
    let last: number | null = null;
    for (let i = 0; i < 11; i++) {
      const res = await applyRateLimit(req('9.9.9.9'), '/api/test', 'auth', 'memkey');
      last = res ? res.status : null;
    }
    expect(last).toBe(429);
  });
});

describe('durable login backoff', () => {
  it('locks after 5 failures and clears on success, via KV', async () => {
    enableKv();
    const email = `victim-${Date.now()}@example.com`;
    expect(await checkLoginBackoff(email)).toBe(false);
    for (let i = 0; i < 4; i++) {
      expect(await recordLoginFailure(email)).toBe(false);
    }
    expect(await recordLoginFailure(email)).toBe(true); // 5th trips the lock
    expect(await checkLoginBackoff(email)).toBe(true);
    await clearLoginFailures(email);
    expect(await checkLoginBackoff(email)).toBe(false);
  });

  it('lockout expires with the window', async () => {
    enableKv();
    const email = `expiry-${Date.now()}@example.com`;
    for (let i = 0; i < 5; i++) await recordLoginFailure(email);
    expect(await checkLoginBackoff(email)).toBe(true);
    upstash.tick(16 * 60 * 1000);
    expect(await checkLoginBackoff(email)).toBe(false);
  });
});

describe('email (fake Resend over real HTTP)', () => {
  it('is disabled without env and logs to console instead', async () => {
    expect(emailEnabled()).toBe(false);
    const result = await sendEmail({ to: 'a@b.c', subject: 'Hi', html: '<p>x</p>', text: 'x' });
    expect(result.delivered).toBe(false);
    expect(resend.sent).toHaveLength(0);
  });

  it('posts the correct payload when configured', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_BASE_URL = resend.url;
    process.env.EMAIL_FROM = 'Nourish <mail@nourish.example>';
    const result = await sendEmail({
      to: 'thomas@example.com',
      subject: 'Verify your email',
      html: '<p>hello</p>',
      text: 'hello',
    });
    expect(result.delivered).toBe(true);
    expect(result.id).toBeTruthy();
    const last = resend.sent[resend.sent.length - 1];
    expect(last.from).toBe('Nourish <mail@nourish.example>');
    expect(last.to).toEqual(['thomas@example.com']);
    expect(last.subject).toBe('Verify your email');
  });

  it('reports failure without throwing when Resend errors', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_BASE_URL = resend.url;
    process.env.EMAIL_FROM = 'mail@nourish.example';
    resend.failNext.on = true;
    const result = await sendEmail({ to: 'x@y.z', subject: 's', html: 'h', text: 't' });
    expect(result.delivered).toBe(false);
    expect(result.error).toMatch(/500/);
  });
});

describe('analytics (fake PostHog over real HTTP)', () => {
  it('is off without env — no requests fired', async () => {
    expect(analyticsEnabled()).toBe(false);
    capture('should_not_send', 'user-1');
    await new Promise((r) => setTimeout(r, 150));
    expect(posthog.events.find((e) => e.event === 'should_not_send')).toBeUndefined();
  });

  it('captures events with the configured key when enabled', async () => {
    process.env.POSTHOG_KEY = 'phc_test';
    process.env.POSTHOG_HOST = posthog.url;
    capture('user_logged_in', 'user-42', { method: 'credentials' });
    const arrived = await eventually(() => posthog.events.some((e) => e.event === 'user_logged_in'));
    expect(arrived).toBe(true);
    const evt = posthog.events.find((e) => e.event === 'user_logged_in')!;
    expect(evt.api_key).toBe('phc_test');
    expect(evt.distinct_id).toBe('user-42');
    expect(evt.properties.method).toBe('credentials');
  });
});
