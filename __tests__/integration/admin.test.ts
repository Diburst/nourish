import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, createUser, createToken, call, setSession, prisma, today } from './helpers';
import { GET as adminUsers } from '@/app/api/admin/users/route';
import { PATCH as adminPatchUser } from '@/app/api/admin/users/[id]/route';
import { GET as adminInvites, POST as adminPostInvite } from '@/app/api/admin/invites/route';
import { DELETE as adminDeleteInvite } from '@/app/api/admin/invites/[id]/route';
import { GET as adminTokens } from '@/app/api/admin/tokens/route';
import { PATCH as adminPatchToken, DELETE as adminDeleteToken } from '@/app/api/admin/tokens/[id]/route';
import { GET as adminSettings } from '@/app/api/admin/settings/route';
import { GET as adminHealth } from '@/app/api/admin/health/route';
import { POST as signup } from '@/app/api/signup/route';
import { GET as getTokens, POST as postToken } from '@/app/api/tokens/route';
import { DELETE as revokeToken } from '@/app/api/tokens/[id]/route';
import { GET as getMe, PATCH as patchMe } from '@/app/api/me/route';
import { POST as changePassword } from '@/app/api/me/password/route';
import { POST as postMeals } from '@/app/api/meals/route';
import { GET as getDays } from '@/app/api/days/route';

let admin: Awaited<ReturnType<typeof createUser>>;
let user: Awaited<ReturnType<typeof createUser>>;
let userToken: string;

beforeAll(async () => {
  await resetDb();
  admin = await createUser({ role: 'ADMIN', email: 'admin@example.com' });
  user = await createUser({ name: 'Norm' });
  userToken = (await createToken(user.id)).raw;
  await call(postMeals, 'POST', '/api/meals', {
    token: userToken,
    body: { mealType: 'LUNCH', items: [{ name: 'Bowl', quantity: 1, nutrients: { KCAL: 700, PROT: 40 } }] },
  });
});

describe('admin gates', () => {
  it('non-admin session gets 404 (existence not leaked)', async () => {
    setSession(user);
    const res = await call(adminUsers, 'GET', '/api/admin/users');
    expect(res.status).toBe(404);
    setSession(null);
  });

  it('agent tokens can never reach admin routes', async () => {
    const res = await call(adminUsers, 'GET', '/api/admin/users', { token: userToken });
    expect(res.status).toBe(403);
  });
});

describe('admin surface never exposes nutrition', () => {
  it('users list carries account metadata only', async () => {
    setSession(admin);
    const res = await call(adminUsers, 'GET', '/api/admin/users');
    expect(res.status).toBe(200);
    const text = res.text.toLowerCase();
    for (const forbidden of ['kcal', 'meal', 'weight', 'nutrient', 'protein']) {
      expect(text).not.toContain(forbidden);
    }
    setSession(null);
  });

  it('tokens overview shows names/scopes/last-used only', async () => {
    setSession(admin);
    const res = await call(adminTokens, 'GET', '/api/admin/tokens');
    const body = res.json as { tokens: Record<string, unknown>[] };
    expect(body.tokens[0]).not.toHaveProperty('tokenHash');
    expect(res.text).not.toMatch(/ntk_/);
    setSession(null);
  });

  it('admin principals are refused on nutrition endpoints', async () => {
    setSession(admin);
    const write = await call(postMeals, 'POST', '/api/meals', {
      body: { mealType: 'LUNCH', items: [{ name: 'X', quantity: 1, nutrients: { KCAL: 1 } }] },
    });
    expect(write.status).toBe(403);
    const read = await call(getDays, 'GET', `/api/days?from=${today()}&to=${today()}`);
    expect(read.status).toBe(403);
    setSession(null);
  });
});

describe('invite → signup flow', () => {
  let inviteCode: string;
  let inviteId: string;

  it('admin creates a single-use, 7-day, email-pinned invite (code shown once)', async () => {
    setSession(admin);
    const res = await call(adminPostInvite, 'POST', '/api/admin/invites', { body: { email: 'new@example.com' } });
    expect(res.status).toBe(201);
    const body = res.json as { id: string; code: string; expiresAt: string };
    inviteCode = body.code;
    inviteId = body.id;
    const days = (Date.parse(body.expiresAt) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    setSession(null);
  });

  it('signup rejects a wrong pinned email', async () => {
    const res = await call(signup, 'POST', '/api/signup', {
      body: { invite: inviteCode, email: 'wrong@example.com', name: 'W', password: 'long-password-1', timezone: 'UTC' },
    });
    expect(res.status).toBe(400);
  });

  it('signup with a valid invite creates a seeded user and burns the invite', async () => {
    const res = await call(signup, 'POST', '/api/signup', {
      body: { invite: inviteCode, email: 'new@example.com', name: 'Newbie', password: 'long-password-1', timezone: 'America/Los_Angeles' },
    });
    expect(res.status).toBe(201);
    const created = await prisma.user.findUnique({ where: { email: 'new@example.com' } });
    expect(created).not.toBeNull();
    expect(await prisma.nutrient.count({ where: { userId: created!.id } })).toBe(15);
    expect(await prisma.mealType.count({ where: { userId: created!.id } })).toBe(5);

    const reuse = await call(signup, 'POST', '/api/signup', {
      body: { invite: inviteCode, email: 'again@example.com', name: 'A', password: 'long-password-1', timezone: 'UTC' },
    });
    expect(reuse.status).toBe(400);
  });

  it('used invites cannot be revoked; fresh ones can', async () => {
    setSession(admin);
    const gone = await call(adminDeleteInvite, 'DELETE', `/api/admin/invites/${inviteId}`, { params: { id: inviteId } });
    expect(gone.status).toBe(409);
    const fresh = await call(adminPostInvite, 'POST', '/api/admin/invites', { body: {} });
    const freshId = (fresh.json as { id: string }).id;
    const del = await call(adminDeleteInvite, 'DELETE', `/api/admin/invites/${freshId}`, { params: { id: freshId } });
    expect(del.status).toBe(204);
    const list = await call(adminInvites, 'GET', '/api/admin/invites');
    expect(list.status).toBe(200);
    setSession(null);
  });
});

describe('admin user management', () => {
  it('temp password sets mustChangePassword; disable blocks token auth', async () => {
    setSession(admin);
    const temp = await call(adminPatchUser, 'PATCH', `/api/admin/users/${user.id}`, {
      params: { id: user.id },
      body: { tempPassword: 'temporary-pass-1' },
    });
    expect(temp.status).toBe(200);
    expect((temp.json as { mustChangePassword: boolean }).mustChangePassword).toBe(true);

    const disable = await call(adminPatchUser, 'PATCH', `/api/admin/users/${user.id}`, {
      params: { id: user.id },
      body: { disabled: true },
    });
    expect((disable.json as { disabledAt: string | null }).disabledAt).not.toBeNull();
    setSession(null);

    const blocked = await call(getDays, 'GET', `/api/days?from=${today()}&to=${today()}`, { token: userToken });
    expect(blocked.status).toBe(401);

    setSession(admin);
    await call(adminPatchUser, 'PATCH', `/api/admin/users/${user.id}`, {
      params: { id: user.id },
      body: { disabled: false },
    });
    setSession(null);
  });

  it('admin cannot disable themself', async () => {
    setSession(admin);
    const res = await call(adminPatchUser, 'PATCH', `/api/admin/users/${admin.id}`, {
      params: { id: admin.id },
      body: { disabled: true },
    });
    expect(res.status).toBe(400);
    setSession(null);
  });

  it('admin can revoke any token and strip guidelines:write', async () => {
    const { token: t } = await createToken(user.id, undefined, 'To be stripped');
    setSession(admin);
    const stripped = await call(adminPatchToken, 'PATCH', `/api/admin/tokens/${t.id}`, {
      params: { id: t.id },
      body: { removeGuidelinesWrite: true },
    });
    expect((stripped.json as { scopes: string[] }).scopes).not.toContain('guidelines:write');
    const revoked = await call(adminDeleteToken, 'DELETE', `/api/admin/tokens/${t.id}`, { params: { id: t.id } });
    expect(revoked.status).toBe(204);
    setSession(null);
  });

  it('settings and health endpoints respond for admins', async () => {
    setSession(admin);
    const s = await call(adminSettings, 'GET', '/api/admin/settings');
    expect(s.status).toBe(200);
    expect((s.json as { rateLimits: unknown }).rateLimits).toBeDefined();
    const h = await call(adminHealth, 'GET', '/api/admin/health');
    expect(h.status).toBe(200);
    expect((h.json as { counts: { users: number } }).counts.users).toBeGreaterThan(0);
    setSession(null);
  });
});

describe('own tokens & profile', () => {
  it('token create is session-only, secret shown once, default scopes all', async () => {
    const asAgent = await call(postToken, 'POST', '/api/tokens', { token: userToken, body: { name: 'X' } });
    expect(asAgent.status).toBe(403);

    setSession(user);
    const res = await call(postToken, 'POST', '/api/tokens', { body: { name: 'Claude desktop' } });
    expect(res.status).toBe(201);
    const body = res.json as { id: string; token: string; scopes: string[] };
    expect(body.token).toMatch(/^ntk_/);
    expect(body.scopes).toHaveLength(5);

    const list = await call(getTokens, 'GET', '/api/tokens');
    expect(list.text).not.toContain(body.token);

    const revoked = await call(revokeToken, 'DELETE', `/api/tokens/${body.id}`, { params: { id: body.id } });
    expect(revoked.status).toBe(204);
    setSession(null);

    const dead = await call(getDays, 'GET', `/api/days?from=${today()}&to=${today()}`, { token: body.token });
    expect(dead.status).toBe(401);
  });

  it('me: GET/PATCH profile; password change clears mustChangePassword', async () => {
    setSession(user);
    const me = await call(getMe, 'GET', '/api/me');
    expect((me.json as { name: string }).name).toBe('Norm');

    const patched = await call(patchMe, 'PATCH', '/api/me', { body: { weightUnit: 'KG', timezone: 'Asia/Tokyo' } });
    expect((patched.json as { weightUnit: string }).weightUnit).toBe('KG');

    const wrong = await call(changePassword, 'POST', '/api/me/password', {
      body: { currentPassword: 'nope', newPassword: 'a-new-long-password' },
    });
    expect(wrong.status).toBe(400);

    const ok = await call(changePassword, 'POST', '/api/me/password', {
      body: { currentPassword: 'temporary-pass-1', newPassword: 'a-new-long-password' },
    });
    expect(ok.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after!.mustChangePassword).toBe(false);
    setSession(null);
  });
});
