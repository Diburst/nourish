import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { resetDb, createUser, createToken, call, setSession, prisma, today } from './helpers';
import { startFakeResend, FakeResend } from './fakes';
import { POST as signup } from '@/app/api/signup/route';
import { POST as verifyEmail } from '@/app/api/verify-email/route';
import { POST as resetRequest } from '@/app/api/password-reset/request/route';
import { POST as resetConfirm } from '@/app/api/password-reset/confirm/route';
import { POST as changeEmail } from '@/app/api/me/email/route';
import { POST as postToken } from '@/app/api/tokens/route';
import { POST as postMeals } from '@/app/api/meals/route';
import { GET as adminAuthEvents } from '@/app/api/admin/auth-events/route';
import { GET as backupsGet, POST as backupsPost } from '@/app/api/admin/backups/route';
import { POST as adminPostInvite } from '@/app/api/admin/invites/route';
import { authOptions } from '@/lib/authOptions';

let resend: FakeResend;
let admin: Awaited<ReturnType<typeof createUser>>;

function enableEmail() {
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_BASE_URL = resend.url;
  process.env.EMAIL_FROM = 'Nourish <mail@nourish.test>';
}

function disableEmail() {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_BASE_URL;
  delete process.env.EMAIL_FROM;
}

/** Drive the real credentials authorize() the way NextAuth would. */
async function authorize(email: string, password: string): Promise<{ id: string } | null> {
  const provider = authOptions.providers[0] as unknown as {
    options?: { authorize?: (c: Record<string, string>, r: unknown) => Promise<{ id: string } | null> };
    authorize?: (c: Record<string, string>, r: unknown) => Promise<{ id: string } | null>;
  };
  const fn = provider.options?.authorize ?? provider.authorize;
  if (!fn) throw new Error('credentials authorize not found');
  return fn({ email, password }, { headers: { 'x-forwarded-for': `10.20.0.${Math.floor(Math.random() * 250) + 1}` } });
}

function linkToken(text: string, path: string): string {
  const match = text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`no ${path} link in email: ${text}`);
  return match[1];
}

beforeAll(async () => {
  await resetDb();
  resend = await startFakeResend();
  admin = await createUser({ role: 'ADMIN', email: 'admin@example.com' });
});

afterAll(async () => {
  disableEmail();
  delete process.env.VERCEL;
  await resend.close();
});

describe('cross-origin session mutation guard', () => {
  it('rejects cookie-auth writes with a foreign Origin, allows same-origin and bearer', async () => {
    disableEmail();
    const user = await createUser();
    const token = (await createToken(user.id)).raw;
    const mealBody = { mealType: 'LUNCH', items: [{ name: 'CSRF probe', quantity: 1, nutrients: { KCAL: 1 } }] };

    setSession(user);
    const crossOrigin = new NextRequest('http://localhost:3000/api/meals', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        host: 'localhost:3000',
        'content-type': 'application/json',
        'x-forwarded-for': '10.21.0.1',
      },
      body: JSON.stringify(mealBody),
    });
    const rejected = await postMeals(crossOrigin, { params: {} });
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toEqual({ error: 'Cross-origin request rejected' });

    const sameOrigin = new NextRequest('http://localhost:3000/api/meals', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
        'x-forwarded-for': '10.21.0.2',
      },
      body: JSON.stringify(mealBody),
    });
    const ok = await postMeals(sameOrigin, { params: {} });
    expect(ok.status).toBe(201);
    setSession(null);

    // Bearer requests are immune — no cookies are in play.
    const bearer = new NextRequest('http://localhost:3000/api/meals', {
      method: 'POST',
      headers: {
        origin: 'https://claude.ai',
        host: 'localhost:3000',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-forwarded-for': '10.21.0.3',
      },
      body: JSON.stringify({ mealType: 'DINNER', items: [{ name: 'Agent meal', quantity: 1, nutrients: { KCAL: 2 } }] }),
    });
    const agentOk = await postMeals(bearer, { params: {} });
    expect(agentOk.status).toBe(201);
  });
});

describe('signup + verification', () => {
  async function makeInvite(email?: string) {
    setSession(admin);
    const res = await call(adminPostInvite, 'POST', '/api/admin/invites', { body: email ? { email } : {} });
    setSession(null);
    return (res.json as { code: string }).code;
  }

  it('without email configured: auto-verified, login works immediately (mini back-compat)', async () => {
    disableEmail();
    const code = await makeInvite();
    const res = await call(signup, 'POST', '/api/signup', {
      body: { invite: code, email: 'plain@example.com', name: 'Plain', password: 'a-long-password-1', timezone: 'UTC' },
    });
    expect(res.status).toBe(201);
    expect((res.json as { requiresVerification: boolean }).requiresVerification).toBe(false);
    expect(await authorize('plain@example.com', 'a-long-password-1')).not.toBeNull();
  });

  it('with email configured: unverified until the emailed link is consumed', async () => {
    enableEmail();
    const code = await makeInvite('gated@example.com');
    const res = await call(signup, 'POST', '/api/signup', {
      body: { invite: code, email: 'gated@example.com', name: 'Gated', password: 'a-long-password-1', timezone: 'UTC' },
    });
    expect(res.status).toBe(201);
    expect((res.json as { requiresVerification: boolean }).requiresVerification).toBe(true);

    const mail = resend.sent.find((m) => m.to.includes('gated@example.com') && m.subject.includes('Verify'));
    expect(mail).toBeDefined();

    // Login is refused pre-verification.
    await expect(authorize('gated@example.com', 'a-long-password-1')).rejects.toThrow(/verify/i);

    const token = linkToken(mail!.text, '/verify');
    const verified = await call(verifyEmail, 'POST', '/api/verify-email', { body: { token } });
    expect(verified.status).toBe(200);

    expect(await authorize('gated@example.com', 'a-long-password-1')).not.toBeNull();

    // The link is single-use.
    const replay = await call(verifyEmail, 'POST', '/api/verify-email', { body: { token } });
    expect(replay.status).toBe(400);
  });
});

describe('password reset', () => {
  it('full flow: request → emailed link → confirm → old sessions dead, new password works', async () => {
    enableEmail();
    const user = await createUser({ email: 'resetme@example.com' });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    const req = await call(resetRequest, 'POST', '/api/password-reset/request', {
      body: { email: 'resetme@example.com' },
    });
    expect(req.status).toBe(200);
    const mail = resend.sent.find((m) => m.to.includes('resetme@example.com') && m.subject.includes('Reset'));
    expect(mail).toBeDefined();

    const token = linkToken(mail!.text, '/reset');
    const confirm = await call(resetConfirm, 'POST', '/api/password-reset/confirm', {
      body: { token, newPassword: 'brand-new-password-1' },
    });
    expect(confirm.status).toBe(200);

    expect(await authorize('resetme@example.com', 'brand-new-password-1')).not.toBeNull();
    expect(await authorize('resetme@example.com', 'password-123')).toBeNull(); // old creds dead

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1); // signed out everywhere

    // Token is single-use.
    const replay = await call(resetConfirm, 'POST', '/api/password-reset/confirm', {
      body: { token, newPassword: 'another-password-1' },
    });
    expect(replay.status).toBe(400);
  });

  it('never leaks account existence, and reports when email is unconfigured', async () => {
    enableEmail();
    const unknown = await call(resetRequest, 'POST', '/api/password-reset/request', {
      body: { email: 'nobody@example.com' },
    });
    expect(unknown.status).toBe(200);

    disableEmail();
    const res = await call(resetRequest, 'POST', '/api/password-reset/request', {
      body: { email: 'resetme@example.com' },
    });
    expect(res.status).toBe(200);
    expect((res.json as { emailConfigured: boolean }).emailConfigured).toBe(false);
  });
});

describe('email change', () => {
  it('with email configured: pending until the new address confirms', async () => {
    enableEmail();
    const user = await createUser({ email: 'old-addr@example.com' });
    setSession(user);
    const res = await call(changeEmail, 'POST', '/api/me/email', {
      body: { newEmail: 'new-addr@example.com', currentPassword: 'password-123' },
    });
    expect(res.status).toBe(200);
    expect((res.json as { pending: boolean }).pending).toBe(true);
    setSession(null);

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unchanged.email).toBe('old-addr@example.com');

    const mail = resend.sent.find((m) => m.to.includes('new-addr@example.com'));
    const token = linkToken(mail!.text, '/verify');
    const confirmed = await call(verifyEmail, 'POST', '/api/verify-email', {
      body: { token, kind: 'change' },
    });
    expect(confirmed.status).toBe(200);
    const changed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(changed.email).toBe('new-addr@example.com');
  });

  it('without email configured: password-gated direct change (mini back-compat)', async () => {
    disableEmail();
    const user = await createUser({ email: 'direct@example.com' });
    setSession(user);
    const wrongPw = await call(changeEmail, 'POST', '/api/me/email', {
      body: { newEmail: 'direct2@example.com', currentPassword: 'wrong' },
    });
    expect(wrongPw.status).toBe(400);
    const res = await call(changeEmail, 'POST', '/api/me/email', {
      body: { newEmail: 'direct2@example.com', currentPassword: 'password-123' },
    });
    expect((res.json as { pending: boolean }).pending).toBe(false);
    setSession(null);
    const changed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(changed.email).toBe('direct2@example.com');
  });
});

describe('audit trail + notices', () => {
  it('token creation writes an AuthEvent and emails a security notice', async () => {
    enableEmail();
    const user = await createUser({ email: 'noticed@example.com' });
    setSession(user);
    const res = await call(postToken, 'POST', '/api/tokens', { body: { name: 'Audited token' } });
    expect(res.status).toBe(201);
    setSession(null);

    const event = await prisma.authEvent.findFirst({
      where: { userId: user.id, type: 'TOKEN_CREATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event).not.toBeNull();
    expect((event!.meta as { name: string }).name).toBe('Audited token');

    const notice = resend.sent.find((m) => m.to.includes('noticed@example.com') && m.subject.includes('security'));
    expect(notice).toBeDefined();
  });

  it('admin auth-events feed lists events, and is admin-only', async () => {
    setSession(admin);
    const res = await call(adminAuthEvents, 'GET', '/api/admin/auth-events');
    expect(res.status).toBe(200);
    const types = (res.json as { events: { type: string }[] }).events.map((e) => e.type);
    expect(types).toContain('SIGNUP');
    expect(types).toContain('TOKEN_CREATED');
    setSession(null);

    const user = await prisma.user.findFirst({ where: { role: 'USER' } });
    setSession({ ...user!, role: 'USER' });
    const denied = await call(adminAuthEvents, 'GET', '/api/admin/auth-events');
    expect(denied.status).toBe(404);
    setSession(null);
  });
});

describe('provider-aware backups', () => {
  it('reports managed mode and refuses pg_dump on Vercel; unchanged otherwise', async () => {
    setSession(admin);
    process.env.VERCEL = '1';
    const managed = await call(backupsGet, 'GET', '/api/admin/backups');
    expect((managed.json as { mode: string }).mode).toBe('managed');
    const refused = await call(backupsPost, 'POST', '/api/admin/backups', { body: {} });
    expect(refused.status).toBe(501);

    delete process.env.VERCEL;
    const selfHost = await call(backupsGet, 'GET', '/api/admin/backups');
    expect((selfHost.json as { mode: string }).mode).toBe('pg_dump');
    setSession(null);
  });
});

describe('invite delivery by email', () => {
  it('emails the invite code, and the emailed code actually signs up', async () => {
    enableEmail();
    setSession(admin);
    const res = await call(adminPostInvite, 'POST', '/api/admin/invites', {
      body: { email: 'invited@example.com', send: true },
    });
    expect(res.status).toBe(201);
    expect((res.json as { emailed: boolean }).emailed).toBe(true);
    setSession(null);

    const mail = resend.sent.find((m) => m.to.includes('invited@example.com') && m.subject.includes('invited'));
    expect(mail).toBeDefined();
    const code = mail!.text.match(/invite code: (\S+)/)?.[1];
    expect(code).toBeTruthy();

    const created = await call(signup, 'POST', '/api/signup', {
      body: { invite: code, email: 'invited@example.com', name: 'Invited', password: 'a-long-password-1', timezone: 'UTC' },
    });
    expect(created.status).toBe(201);
    void today;
  });
});
