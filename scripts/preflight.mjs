#!/usr/bin/env node
/**
 * Deployment preflight — runs at the start of `vercel-build`. On Vercel (VERCEL=1)
 * it fails the build for configurations that would ship a broken or unsafe app;
 * everywhere else (mini/self-host, dev) it only prints advisories, so the Docker
 * path keeps working exactly as before.
 */
const onVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
const errors = [];
const warnings = [];

function requireOnVercel(cond, message) {
  if (!cond) (onVercel ? errors : warnings).push(message);
}

// Serverless correctness: per-instance memory is not a rate limiter.
requireOnVercel(
  Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  'UPSTASH_REDIS_REST_URL/TOKEN missing — rate limiting and login backoff need shared storage on serverless.'
);

// A public deployment must be HTTPS end to end.
requireOnVercel(
  (process.env.NEXTAUTH_URL ?? '').startsWith('https://'),
  'NEXTAUTH_URL must be an https:// URL on Vercel.'
);
requireOnVercel(
  !process.env.MCP_PUBLIC_URL || process.env.MCP_PUBLIC_URL.startsWith('https://'),
  'MCP_PUBLIC_URL must be https:// on Vercel.'
);

// Advisories either way.
if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
  warnings.push('Email (RESEND_API_KEY + EMAIL_FROM) not configured — verification and password reset fall back to console logging.');
}
if (!process.env.POSTHOG_KEY) {
  warnings.push('POSTHOG_KEY not configured — server-side analytics disabled.');
}

for (const w of warnings) console.warn(`[preflight] warn: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`[preflight] ERROR: ${e}`);
  console.error('[preflight] Refusing to build for Vercel with the above problems.');
  process.exit(1);
}
console.log(`[preflight] ok (${onVercel ? 'vercel' : 'self-host/dev'} mode).`);
