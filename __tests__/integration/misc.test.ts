import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, createUser, createToken, call, setSession, today, prisma } from './helpers';
import { GET as getWeights, POST as postWeight } from '@/app/api/weights/route';
import { GET as getNutrients, POST as postNutrient } from '@/app/api/nutrients/route';
import { PATCH as patchNutrient } from '@/app/api/nutrients/[id]/route';
import { GET as getMealTypes, POST as postMealType } from '@/app/api/meal-types/route';
import { PATCH as patchMealType, DELETE as deleteMealType } from '@/app/api/meal-types/[id]/route';
import { GET as getActivity } from '@/app/api/activity/route';
import { GET as getExport } from '@/app/api/export/route';
import { POST as postImport } from '@/app/api/import/route';
import { GET as getHealth } from '@/app/api/health/route';
import { POST as postMeals } from '@/app/api/meals/route';
import { GET as getSuggestions } from '@/app/api/suggestions/route';
import { PUT as putTargets } from '@/app/api/targets/route';
import { POST as postGuideline } from '@/app/api/guidelines/route';
import { PUT as putLinks } from '@/app/api/guidelines/[slug]/links/route';
import { NextRequest } from 'next/server';

let user: Awaited<ReturnType<typeof createUser>>;
let token: string;

beforeAll(async () => {
  await resetDb();
  user = await createUser();
  token = (await createToken(user.id)).raw;
});

describe('weights', () => {
  it('POST converts lb and creates (201), then upserts by date (200, latest wins)', async () => {
    const first = await call(postWeight, 'POST', '/api/weights', {
      token,
      body: { date: today(), value: 176, weightUnit: 'lb' },
    });
    expect(first.status).toBe(201);
    expect((first.json as { valueKg: number }).valueKg).toBeCloseTo(79.8, 1);

    const second = await call(postWeight, 'POST', '/api/weights', {
      token,
      body: { date: today(), value: 79.2, weightUnit: 'kg' },
    });
    expect(second.status).toBe(200);
    expect((second.json as { valueKg: number }).valueKg).toBeCloseTo(79.2, 5);

    const list = await call(getWeights, 'GET', `/api/weights?from=${today()}&to=${today()}`, { token });
    expect((list.json as { weights: unknown[] }).weights).toHaveLength(1);
  });

  it('idempotency replay returns 200 with the existing row', async () => {
    const a = await call(postWeight, 'POST', '/api/weights', {
      token,
      body: { date: today(-1), value: 80, weightUnit: 'kg', idempotencyKey: 'w-1' },
    });
    expect(a.status).toBe(201);
    const b = await call(postWeight, 'POST', '/api/weights', {
      token,
      body: { date: today(-1), value: 99, weightUnit: 'kg', idempotencyKey: 'w-1' },
    });
    expect(b.status).toBe(200);
    expect((b.json as { valueKg: number }).valueKg).toBeCloseTo(80, 5);
  });

  it('user weight is pinned; agent write 409s then overrides', async () => {
    setSession(user);
    await call(postWeight, 'POST', '/api/weights', { body: { date: today(-2), value: 80, weightUnit: 'kg' } });
    setSession(null);
    const blocked = await call(postWeight, 'POST', '/api/weights', {
      token,
      body: { date: today(-2), value: 81, weightUnit: 'kg' },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.json).toEqual({ error: 'Entry pinned by user' });
    const forced = await call(postWeight, 'POST', '/api/weights', {
      token,
      body: { date: today(-2), value: 81, weightUnit: 'kg', override: true },
    });
    expect(forced.status).toBe(200);
  });
});

describe('nutrients', () => {
  it('GET returns the seeded list wrapped in { nutrients }', async () => {
    const res = await call(getNutrients, 'GET', '/api/nutrients', { token });
    const body = res.json as { nutrients: { code: string }[] };
    expect(body.nutrients.map((n) => n.code)).toContain('OMEGA3');
    expect(body.nutrients).toHaveLength(15);
  });

  it('POST duplicate active code → 409; archive → hidden; re-add → un-archives', async () => {
    const dup = await call(postNutrient, 'POST', '/api/nutrients', {
      token,
      body: { code: 'MG', displayName: 'Mag', unit: 'mg', kind: 'MICRO', targetRule: 'MIN' },
    });
    expect(dup.status).toBe(409);

    const mg = await prisma.nutrient.findFirst({ where: { userId: user.id, code: 'MG' } });
    const archived = await call(patchNutrient, 'PATCH', `/api/nutrients/${mg!.id}`, {
      token,
      params: { id: mg!.id },
      body: { archived: true },
    });
    expect(archived.status).toBe(200);
    const hidden = await call(getNutrients, 'GET', '/api/nutrients', { token });
    expect((hidden.json as { nutrients: { code: string }[] }).nutrients.map((n) => n.code)).not.toContain('MG');

    const readd = await call(postNutrient, 'POST', '/api/nutrients', {
      token,
      body: { code: 'MG', displayName: 'Magnesium', unit: 'mg', kind: 'MICRO', targetRule: 'MIN' },
    });
    expect(readd.status).toBe(200);
    expect((readd.json as { archived: boolean }).archived).toBe(false);
  });

  it('KCAL cannot be archived', async () => {
    const kcal = await prisma.nutrient.findFirst({ where: { userId: user.id, code: 'KCAL' } });
    const res = await call(patchNutrient, 'PATCH', `/api/nutrients/${kcal!.id}`, {
      token,
      params: { id: kcal!.id },
      body: { archived: true },
    });
    expect(res.status).toBe(400);
  });
});

describe('meal types', () => {
  it('rename propagates and delete is refused when in use', async () => {
    await call(postMeals, 'POST', '/api/meals', {
      token,
      body: { mealType: 'SNACK', items: [{ name: 'Apple', quantity: 1, nutrients: { KCAL: 80 } }] },
    });
    const snack = await prisma.mealType.findFirst({ where: { userId: user.id, code: 'SNACK' } });

    const renamed = await call(patchMealType, 'PATCH', `/api/meal-types/${snack!.id}`, {
      token,
      params: { id: snack!.id },
      body: { displayName: 'Snacks & bites' },
    });
    expect(renamed.status).toBe(200);

    const del = await call(deleteMealType, 'DELETE', `/api/meal-types/${snack!.id}`, {
      token,
      params: { id: snack!.id },
    });
    expect(del.status).toBe(409);
    expect((del.json as { error: string }).error).toMatch(/archive it instead/);

    const archived = await call(patchMealType, 'PATCH', `/api/meal-types/${snack!.id}`, {
      token,
      params: { id: snack!.id },
      body: { archived: true },
    });
    expect(archived.status).toBe(200);
  });

  it('unused meal type can be deleted', async () => {
    const created = await call(postMealType, 'POST', '/api/meal-types', {
      token,
      body: { code: 'ELEVENSES', displayName: 'Elevenses' },
    });
    expect(created.status).toBe(201);
    const id = (created.json as { id: string }).id;
    const del = await call(deleteMealType, 'DELETE', `/api/meal-types/${id}`, { token, params: { id } });
    expect(del.status).toBe(204);
  });

  it('GET wraps in { mealTypes }', async () => {
    const res = await call(getMealTypes, 'GET', '/api/meal-types', { token });
    expect(res.status).toBe(200);
    expect(Array.isArray((res.json as { mealTypes: unknown[] }).mealTypes)).toBe(true);
  });
});

describe('activity', () => {
  it('returns the revision feed with actor names, filterable by actor', async () => {
    const all = await call(getActivity, 'GET', '/api/activity', { token });
    expect(all.status).toBe(200);
    const body = all.json as { revisions: { actorType: string; actorName: string }[]; nextCursor: string | null };
    expect(body.revisions.length).toBeGreaterThan(0);
    expect(body.revisions[0].actorName).toBeTypeOf('string');

    const usersOnly = await call(getActivity, 'GET', '/api/activity?actor=user', { token });
    for (const r of (usersOnly.json as { revisions: { actorType: string }[] }).revisions) {
      expect(r.actorType).toBe('USER');
    }
  });
});

describe('suggestions', () => {
  it('surfaces lagging micros with matching guideline links', async () => {
    await call(putTargets, 'PUT', '/api/targets', {
      token,
      body: { effectiveFrom: today(-7), values: { KCAL: 1800, PROT: 100, MG: 400 } },
    });
    // Meals exist (logged days) but MG intake is far below pace.
    const section = await call(postGuideline, 'POST', '/api/guidelines', {
      token,
      body: { slug: 'pantry-staples', title: 'Pantry Staples', body: '## Seeds\n\nPumpkin seeds.' },
    });
    expect(section.status).toBe(201);
    const links = await call(putLinks, 'PUT', '/api/guidelines/pantry-staples/links', {
      token,
      params: { slug: 'pantry-staples' },
      body: { links: [{ label: 'Pumpkin seeds', nutrients: ['MG', 'ZN'] }] },
    });
    expect(links.status).toBe(200);

    const res = await call(getSuggestions, 'GET', '/api/suggestions', { token });
    expect(res.status).toBe(200);
    const body = res.json as { suggestions: { code: string; links: { label: string }[] }[] };
    const mg = body.suggestions.find((s) => s.code === 'MG');
    expect(mg).toBeDefined();
    expect(mg!.links[0].label).toBe('Pumpkin seeds');
    expect(body.suggestions.length).toBeLessThanOrEqual(3);
  });
});

describe('export / import', () => {
  it('JSON export has the documented envelope', async () => {
    const res = await call(getExport, 'GET', '/api/export?format=json', { token });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as Record<string, unknown>;
    for (const key of ['version', 'user', 'nutrients', 'mealTypes', 'targets', 'weightGoals', 'meals', 'weights', 'revisions']) {
      expect(body).toHaveProperty(key);
    }
  });

  it('CSV export returns text/csv', async () => {
    const res = await call(getExport, 'GET', '/api/export?format=csv', { token });
    expect(res.status).toBe(200);
    expect(res.text.split('\n')[0]).toMatch(/^date,mealType,item,quantity/);
  });

  it('import refuses non-fresh accounts (409) and agents (403)', async () => {
    const asAgent = await call(postImport, 'POST', '/api/import', { token, body: { version: 1 } });
    expect(asAgent.status).toBe(403);

    setSession(user);
    const nonFresh = await call(postImport, 'POST', '/api/import', { body: { version: 1 } });
    expect(nonFresh.status).toBe(409);
    setSession(null);
  });

  it('imports a dump into a fresh account', async () => {
    const fresh = await createUser();
    setSession(fresh);
    const res = await call(postImport, 'POST', '/api/import', {
      body: {
        version: 1,
        targets: [{ effectiveFrom: today(-5), effectiveTo: null, values: { KCAL: 1800, PROT: 120 } }],
        meals: [
          {
            date: today(-1),
            mealType: 'LUNCH',
            items: [{ name: 'Imported bowl', quantity: 1, nutrients: { KCAL: 600, PROT: 40 } }],
          },
        ],
        weights: [{ date: today(-1), valueKg: 78 }],
      },
    });
    expect(res.status).toBe(201);
    expect((res.json as { imported: { meals: number } }).imported.meals).toBe(1);
    setSession(null);
  });
});

describe('health', () => {
  it('is public and reports db status', async () => {
    const res = await getHealth();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: string };
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
  });
});

describe('rate limiting', () => {
  it('429 after the agent write budget is exhausted', async () => {
    const { raw } = await createToken(user.id, ['nutrition:write', 'nutrition:read'], 'burst');
    let last = 0;
    for (let i = 0; i < 125; i++) {
      const res = await call(postWeight, 'POST', '/api/weights', {
        token: raw,
        body: { date: today(-3), value: 80, weightUnit: 'kg' },
      });
      last = res.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('body size cap', () => {
  it('413 on oversized mutation bodies', async () => {
    const req = new NextRequest('http://localhost:3000/api/meals', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-length': String(200 * 1024),
      },
      body: JSON.stringify({}),
    });
    const res = await postMeals(req, { params: {} });
    expect(res.status).toBe(413);
  });
});
