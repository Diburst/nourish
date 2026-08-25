import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, createUser, createToken, call, setSession, today } from './helpers';
import { GET as getTargets, PUT as putTargets } from '@/app/api/targets/route';
import { GET as getCurrent } from '@/app/api/targets/current/route';
import { PATCH as patchTarget } from '@/app/api/targets/[id]/route';
import { GET as getGoal, PUT as putGoal } from '@/app/api/weight-goal/route';
import { POST as postMeals } from '@/app/api/meals/route';
import { GET as getDays } from '@/app/api/days/route';
import { GET as getSummary } from '@/app/api/summary/route';

let user: Awaited<ReturnType<typeof createUser>>;
let token: string;
let readToken: string;

beforeAll(async () => {
  await resetDb();
  user = await createUser();
  token = (await createToken(user.id)).raw;
  readToken = (await createToken(user.id, ['nutrition:read'])).raw;
});

describe('targets', () => {
  it('GET returns empty history initially', async () => {
    const res = await call(getTargets, 'GET', '/api/targets', { token });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ targets: [] });
  });

  it('PUT requires targets:write', async () => {
    const res = await call(putTargets, 'PUT', '/api/targets', {
      token: readToken,
      body: { values: { KCAL: 1800 } },
    });
    expect(res.status).toBe(403);
  });

  it('PUT rejects unknown codes', async () => {
    const res = await call(putTargets, 'PUT', '/api/targets', {
      token,
      body: { values: { KCAL: 1800, BOGUS: 1 } },
    });
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toMatch(/BOGUS/);
  });

  it('PUT creates the first row, effective from a past date', async () => {
    const res = await call(putTargets, 'PUT', '/api/targets', {
      token,
      body: { effectiveFrom: today(-30), values: { KCAL: 2000, PROT: 100, MG: 400 } },
    });
    expect(res.status).toBe(201);
    const body = res.json as { effectiveFrom: string; effectiveTo: string | null };
    expect(body.effectiveFrom).toBe(today(-30));
    expect(body.effectiveTo).toBeNull();
  });

  it('target freeze: lowering kcal today closes the old row and leaves yesterday ✓', async () => {
    // Log a 1900-kcal day yesterday, passing under the 2000 target.
    await call(postMeals, 'POST', '/api/meals', {
      token,
      body: {
        date: today(-1),
        mealType: 'DINNER',
        items: [{ name: 'Big dinner', quantity: 1, nutrients: { KCAL: 1900, PROT: 120 } }],
      },
    });
    let days = await call(getDays, 'GET', `/api/days?from=${today(-1)}&to=${today(-1)}`, { token });
    expect((days.json as { days: { status: string }[] }).days[0].status).toBe('success');

    // Lower the target to 1500 effective today.
    const put = await call(putTargets, 'PUT', '/api/targets', {
      token,
      body: { values: { KCAL: 1500, PROT: 100, MG: 400 } },
    });
    expect(put.status).toBe(201);

    // Yesterday still ✓ — day evaluation joins to the row covering that date.
    days = await call(getDays, 'GET', `/api/days?from=${today(-1)}&to=${today(-1)}`, { token });
    expect((days.json as { days: { status: string }[] }).days[0].status).toBe('success');

    // History: old row closed at yesterday, new row open from today.
    const all = await call(getTargets, 'GET', '/api/targets', { token });
    const rows = (all.json as { targets: { effectiveFrom: string; effectiveTo: string | null }[] }).targets;
    expect(rows).toHaveLength(2);
    expect(rows[0].effectiveTo).toBe(today(-1));
    expect(rows[1].effectiveFrom).toBe(today());
    expect(rows[1].effectiveTo).toBeNull();
  });

  it('GET /api/targets/current returns the open row', async () => {
    const res = await call(getCurrent, 'GET', '/api/targets/current', { token });
    const body = res.json as { target: { values: { KCAL: number } } };
    expect(body.target.values.KCAL).toBe(1500);
  });

  it('PUT with effectiveFrom before an existing row → 400 pointing to PATCH', async () => {
    const res = await call(putTargets, 'PUT', '/api/targets', {
      token,
      body: { effectiveFrom: today(-10), values: { KCAL: 1700 } },
    });
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toMatch(/correct a past target/);
  });

  it('PATCH (correct a past target) is session-only and rewrites a historical row', async () => {
    const all = await call(getTargets, 'GET', '/api/targets', { token });
    const oldRow = (all.json as { targets: { id: string }[] }).targets[0];

    const asAgent = await call(patchTarget, 'PATCH', `/api/targets/${oldRow.id}`, {
      token,
      params: { id: oldRow.id },
      body: { values: { KCAL: 1800 } },
    });
    expect(asAgent.status).toBe(403);

    setSession(user);
    const asUser = await call(patchTarget, 'PATCH', `/api/targets/${oldRow.id}`, {
      params: { id: oldRow.id },
      body: { values: { KCAL: 1800, PROT: 100, MG: 400 } },
    });
    expect(asUser.status).toBe(200);
    expect((asUser.json as { values: { KCAL: number } }).values.KCAL).toBe(1800);
    setSession(null);

    // Yesterday's 1900-kcal day now fails against the corrected 1800 row.
    const days = await call(getDays, 'GET', `/api/days?from=${today(-1)}&to=${today(-1)}`, { token });
    expect((days.json as { days: { status: string }[] }).days[0].status).toBe('fail');
  });
});

describe('weight goal', () => {
  it('PUT converts lb → kg and GET returns the current goal', async () => {
    const put = await call(putGoal, 'PUT', '/api/weight-goal', {
      token,
      body: { target: 165, weightUnit: 'lb', direction: 'LOSE' },
    });
    expect(put.status).toBe(201);
    expect((put.json as { targetKg: number }).targetKg).toBeCloseTo(74.84, 1);

    const get = await call(getGoal, 'GET', '/api/weight-goal', { token });
    const body = get.json as { goal: { direction: string }; history: unknown[] };
    expect(body.goal.direction).toBe('LOSE');
    expect(body.history).toHaveLength(1);
  });
});

describe('summary', () => {
  it('400 on a bad range', async () => {
    const res = await call(getSummary, 'GET', '/api/summary?range=14d', { token });
    expect(res.status).toBe(400);
  });

  it('returns the documented shape', async () => {
    const res = await call(getSummary, 'GET', '/api/summary?range=7d', { token });
    expect(res.status).toBe(200);
    const body = res.json as Record<string, unknown>;
    for (const key of ['range', 'daysLogged', 'unloggedDays', 'averages', 'kcal', 'prot', 'weeks', 'streak', 'weight', 'topShortfalls']) {
      expect(body).toHaveProperty(key);
    }
    expect((body.kcal as { daysHit: number }).daysHit).toBeTypeOf('number');
  });
});
