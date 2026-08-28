/**
 * v1.6 onboarding: getAccountStatus steps + latch, connection states, the skip
 * stamp, and the status/skip endpoints.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, createUser, createToken, call, setSession, prisma, today } from './helpers';
import { GET as getStatus } from '@/app/api/onboarding/status/route';
import { POST as postSkip } from '@/app/api/onboarding/skip/route';
import { PUT as putTargets } from '@/app/api/targets/route';
import { POST as postWeight } from '@/app/api/weights/route';
import { getAccountStatus } from '@/lib/onboarding';

beforeAll(async () => {
  await resetDb();
});

describe('getAccountStatus steps and latch', () => {
  it('walks the steps as setup progresses and latches completion', async () => {
    const user = await createUser();

    let s = await getAccountStatus(user.id);
    expect(s.steps).toEqual({ account: true, token: false, paired: false, targets: false, weight: false });
    expect(s.setupComplete).toBe(false);
    expect(s.connection).toBe('never_set_up');
    expect(s.hint).toMatch(/set_targets/);

    const { raw, token: tokenRow } = await createToken(user.id);
    s = await getAccountStatus(user.id);
    expect(s.steps.token).toBe(true);
    expect(s.steps.paired).toBe(false);

    // pairing signal
    await prisma.user.update({ where: { id: user.id }, data: { firstMcpCallAt: new Date() } });
    s = await getAccountStatus(user.id);
    expect(s.steps.paired).toBe(true);
    expect(s.setupComplete).toBe(false);

    await call(putTargets, 'PUT', '/api/targets', { token: raw, body: { values: { KCAL: 2300, PROT: 160 } } });
    s = await getAccountStatus(user.id);
    expect(s.steps.targets).toBe(true);
    expect(s.hint).toMatch(/log_weight/);

    await call(postWeight, 'POST', '/api/weights', { token: raw, body: { value: 78.4, weightUnit: 'kg' } });
    s = await getAccountStatus(user.id);
    expect(s.steps.weight).toBe(true);
    expect(s.setupComplete).toBe(true);
    expect(s.connection).toBe('connected');
    expect(s.hint).toBeNull();

    // The latch: a later-broken step must NOT re-open the setup flow…
    await prisma.weight.deleteMany({ where: { userId: user.id } });
    s = await getAccountStatus(user.id);
    expect(s.setupComplete).toBe(true);
    expect(s.connection).toBe('connected');

    // …but revoking every token deliberately brings the reconnect state back,
    // and creating a new token clears it.
    await prisma.apiToken.update({ where: { id: tokenRow.id }, data: { revokedAt: new Date() } });
    s = await getAccountStatus(user.id);
    expect(s.setupComplete).toBe(true);
    expect(s.connection).toBe('disconnected');

    await createToken(user.id);
    s = await getAccountStatus(user.id);
    expect(s.connection).toBe('connected');
  });

  it('a target with zero energy does not satisfy the targets step', async () => {
    const user = await createUser();
    const { raw } = await createToken(user.id);
    await call(putTargets, 'PUT', '/api/targets', { token: raw, body: { values: { PROT: 100 } } });
    const s = await getAccountStatus(user.id);
    expect(s.steps.targets).toBe(false);
  });
});

describe('status + skip endpoints', () => {
  it('status is session-only', async () => {
    const user = await createUser();
    const { raw } = await createToken(user.id);
    const viaToken = await call(getStatus, 'GET', '/api/onboarding/status', { token: raw });
    expect(viaToken.status).toBe(403);

    setSession(user);
    const res = await call(getStatus, 'GET', '/api/onboarding/status');
    expect(res.status).toBe(200);
    const body = res.json as { steps: Record<string, boolean>; connection: string; skipped: boolean };
    expect(body.connection).toBe('never_set_up');
    expect(body.skipped).toBe(false);
    setSession(null);
  });

  it('skip stamps once and is reflected in status', async () => {
    const user = await createUser();
    setSession(user);
    const res = await call(postSkip, 'POST', '/api/onboarding/skip', { body: {} });
    expect(res.status).toBe(200);
    const status = await call(getStatus, 'GET', '/api/onboarding/status');
    expect((status.json as { skipped: boolean }).skipped).toBe(true);

    const stamped = (await prisma.user.findUnique({ where: { id: user.id } }))!.onboardingSkippedAt;
    await call(postSkip, 'POST', '/api/onboarding/skip', { body: {} });
    const again = (await prisma.user.findUnique({ where: { id: user.id } }))!.onboardingSkippedAt;
    expect(again!.getTime()).toBe(stamped!.getTime()); // updateMany guard: first stamp wins
    setSession(null);
  });
});
