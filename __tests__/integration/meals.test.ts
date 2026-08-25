import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, createUser, createToken, call, setSession, today, prisma } from './helpers';
import { POST as postMeals } from '@/app/api/meals/route';
import { GET as getMeal, PATCH as patchMeal, DELETE as deleteMeal } from '@/app/api/meals/[id]/route';
import { POST as postItem } from '@/app/api/meals/[id]/items/route';
import { PATCH as patchItem, DELETE as deleteItem } from '@/app/api/meals/[id]/items/[itemId]/route';
import { GET as getDays } from '@/app/api/days/route';

let user: Awaited<ReturnType<typeof createUser>>;
let other: Awaited<ReturnType<typeof createUser>>;
let token: string;
let otherToken: string;
let readOnlyToken: string;

const lunchPayload = (extra: Record<string, unknown> = {}) => ({
  date: today(),
  mealType: 'LUNCH',
  items: [
    {
      idempotencyKey: `${today()}-lunch-bowl`,
      name: 'Chicken burrito bowl',
      quantity: 1,
      nutrients: { KCAL: 720, PROT: 48, MG: 95 },
    },
  ],
  ...extra,
});

beforeAll(async () => {
  await resetDb();
  user = await createUser();
  other = await createUser();
  token = (await createToken(user.id)).raw;
  otherToken = (await createToken(other.id)).raw;
  readOnlyToken = (await createToken(user.id, ['nutrition:read'])).raw;
});

describe('POST /api/meals', () => {
  it('401 without auth', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', { body: lunchPayload() });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: 'Unauthorized' });
  });

  it('403 without nutrition:write scope', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', { body: lunchPayload(), token: readOnlyToken });
    expect(res.status).toBe(403);
    expect((res.json as { error: string }).error).toMatch(/nutrition:write/);
  });

  it('creates the slot and returns meal + day totals', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', { body: lunchPayload(), token });
    expect(res.status).toBe(201);
    const body = res.json as { meal: { id: string; mealType: string; items: { name: string; totals: Record<string, number> }[] }; dayTotals: Record<string, number> };
    expect(body.meal.mealType).toBe('LUNCH');
    expect(body.meal.items).toHaveLength(1);
    expect(body.dayTotals.KCAL).toBe(720);
  });

  it('idempotent replay returns the existing item with 200', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', { body: lunchPayload(), token });
    expect(res.status).toBe(200);
    const body = res.json as { meal: { items: unknown[] }; dayTotals: Record<string, number> };
    expect(body.meal.items).toHaveLength(1);
    expect(body.dayTotals.KCAL).toBe(720); // not doubled
  });

  it('second POST to the slot appends items (slot upsert)', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', {
      token,
      body: lunchPayload({
        items: [
          {
            idempotencyKey: `${today()}-lunch-tortilla`,
            name: 'Corn tortilla',
            quantity: 2,
            nutrients: { KCAL: 60, PROT: 1.5 },
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = res.json as { meal: { items: { name: string; totals: Record<string, number> }[] }; dayTotals: Record<string, number> };
    expect(body.meal.items).toHaveLength(2);
    const tortilla = body.meal.items.find((i) => i.name === 'Corn tortilla')!;
    expect(tortilla.totals.KCAL).toBe(120); // perUnit × quantity, derived
    expect(body.dayTotals.KCAL).toBe(840);
  });

  it('409 on duplicate item name (normalized), returning the existing item', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', {
      token,
      body: lunchPayload({ items: [{ name: '  CHICKEN   burrito bowl ', quantity: 1, nutrients: { KCAL: 700 } }] }),
    });
    expect(res.status).toBe(409);
    const body = res.json as { error: string; item: { name: string } };
    expect(body.error).toBe('Item already exists');
    expect(body.item.name).toBe('Chicken burrito bowl');
  });

  it('onConflict: increment bumps quantity', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', {
      token,
      body: lunchPayload({
        onConflict: 'increment',
        items: [{ name: 'Chicken burrito bowl', quantity: 1, nutrients: { KCAL: 720 } }],
      }),
    });
    expect(res.status).toBe(200);
    const body = res.json as { meal: { items: { name: string; quantity: number }[] } };
    expect(body.meal.items.find((i) => i.name === 'Chicken burrito bowl')!.quantity).toBe(2);
  });

  it('onConflict: replace overwrites quantity and nutrients', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', {
      token,
      body: lunchPayload({
        onConflict: 'replace',
        items: [{ name: 'Chicken burrito bowl', quantity: 1, nutrients: { KCAL: 650, PROT: 45 } }],
      }),
    });
    expect(res.status).toBe(200);
    const body = res.json as { meal: { items: { name: string; quantity: number; nutrients: Record<string, number> }[] } };
    const bowl = body.meal.items.find((i) => i.name === 'Chicken burrito bowl')!;
    expect(bowl.quantity).toBe(1);
    expect(bowl.nutrients.KCAL).toBe(650);
  });

  it('400 with unknown nutrient code, listing valid codes', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', {
      token,
      body: lunchPayload({ items: [{ name: 'Mystery', quantity: 1, nutrients: { NOPE: 10 } }] }),
    });
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toMatch(/Unknown nutrient code.*NOPE.*KCAL/s);
  });

  it('400 with unknown meal type, listing valid types', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', {
      token,
      body: lunchPayload({ mealType: 'ELEVENSES' }),
    });
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toMatch(/Unknown meal type.*LUNCH/s);
  });

  it('400 on invalid body', async () => {
    const res = await call(postMeals, 'POST', '/api/meals', { token, body: { mealType: 'LUNCH', items: [] } });
    expect(res.status).toBe(400);
  });

  it('403 for ADMIN principals (admins hold no nutrition data)', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    setSession(admin);
    const res = await call(postMeals, 'POST', '/api/meals', { body: lunchPayload() });
    expect(res.status).toBe(403);
    setSession(null);
  });
});

describe('meal detail routes', () => {
  let mealId: string;

  beforeAll(async () => {
    const meal = await prisma.meal.findFirst({ where: { userId: user.id }, orderBy: { loggedAt: 'asc' } });
    mealId = meal!.id;
  });

  it('GET returns the meal with items', async () => {
    const res = await call(getMeal, 'GET', `/api/meals/${mealId}`, { token, params: { id: mealId } });
    expect(res.status).toBe(200);
    expect((res.json as { id: string }).id).toBe(mealId);
  });

  it('tenancy: other user gets 404, not 403', async () => {
    const res = await call(getMeal, 'GET', `/api/meals/${mealId}`, { token: otherToken, params: { id: mealId } });
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'Meal not found' });
  });

  it('PATCH updates notes', async () => {
    const res = await call(patchMeal, 'PATCH', `/api/meals/${mealId}`, {
      token,
      params: { id: mealId },
      body: { notes: 'extra salsa' },
    });
    expect(res.status).toBe(200);
    expect((res.json as { notes: string }).notes).toBe('extra salsa');
  });

  it('POST /items appends to an existing meal and 409s on duplicates', async () => {
    const ok = await call(postItem, 'POST', `/api/meals/${mealId}/items`, {
      token,
      params: { id: mealId },
      body: { name: 'Lime seltzer', quantity: 1, nutrients: { KCAL: 5 } },
    });
    expect(ok.status).toBe(201);
    const dup = await call(postItem, 'POST', `/api/meals/${mealId}/items`, {
      token,
      params: { id: mealId },
      body: { name: 'lime  SELTZER', quantity: 1, nutrients: { KCAL: 5 } },
    });
    expect(dup.status).toBe(409);
  });
});

describe('pinning and overrides', () => {
  let mealId: string;
  let itemId: string;

  beforeAll(async () => {
    const res = await call(postMeals, 'POST', '/api/meals', {
      token,
      body: {
        date: today(-1),
        mealType: 'DINNER',
        items: [{ name: 'Salmon bowl', quantity: 1, nutrients: { KCAL: 640, PROT: 42 } }],
      },
    });
    const body = res.json as { meal: { id: string; items: { id: string }[] } };
    mealId = body.meal.id;
    itemId = body.meal.items[0].id;
  });

  it('user (session) edit pins the item', async () => {
    setSession(user);
    const res = await call(patchItem, 'PATCH', `/api/meals/${mealId}/items/${itemId}`, {
      params: { id: mealId, itemId },
      body: { quantity: 2 },
    });
    expect(res.status).toBe(200);
    expect((res.json as { item: { pinned: boolean } }).item.pinned).toBe(true);
    setSession(null);
  });

  it('agent write to a pinned item → 409 Entry pinned by user', async () => {
    const res = await call(patchItem, 'PATCH', `/api/meals/${mealId}/items/${itemId}`, {
      token,
      params: { id: mealId, itemId },
      body: { nutrients: { KCAL: 600 } },
    });
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: 'Entry pinned by user' });
  });

  it('override: true succeeds and is recorded on the revision', async () => {
    const res = await call(patchItem, 'PATCH', `/api/meals/${mealId}/items/${itemId}`, {
      token,
      params: { id: mealId, itemId },
      body: { nutrients: { KCAL: 600 }, override: true },
    });
    expect(res.status).toBe(200);
    const rev = await prisma.entryRevision.findFirst({
      where: { entityId: itemId, override: true },
      orderBy: { createdAt: 'desc' },
    });
    expect(rev).not.toBeNull();
    expect(rev!.actorType).toBe('TOKEN');
  });

  it('agent delete of pinned item needs override too', async () => {
    const blocked = await call(deleteItem, 'DELETE', `/api/meals/${mealId}/items/${itemId}`, {
      token,
      params: { id: mealId, itemId },
    });
    expect(blocked.status).toBe(409);
    const ok = await call(deleteItem, 'DELETE', `/api/meals/${mealId}/items/${itemId}?override=true`, {
      token,
      params: { id: mealId, itemId },
    });
    expect(ok.status).toBe(204);
  });

  it('idempotent replay still returns a soft-deleted item', async () => {
    const create = await call(postItem, 'POST', `/api/meals/${mealId}/items`, {
      token,
      params: { id: mealId },
      body: { idempotencyKey: 'replay-key-1', name: 'Side salad', quantity: 1, nutrients: { KCAL: 90 } },
    });
    expect(create.status).toBe(201);
    const created = (create.json as { item: { id: string } }).item;
    await call(deleteItem, 'DELETE', `/api/meals/${mealId}/items/${created.id}`, {
      token,
      params: { id: mealId, itemId: created.id },
    });
    const replay = await call(postItem, 'POST', `/api/meals/${mealId}/items`, {
      token,
      params: { id: mealId },
      body: { idempotencyKey: 'replay-key-1', name: 'Side salad', quantity: 1, nutrients: { KCAL: 90 } },
    });
    expect(replay.status).toBe(200);
    expect((replay.json as { item: { id: string; deleted: boolean } }).item.id).toBe(created.id);
  });

  it('DELETE meal soft-deletes and excludes from totals', async () => {
    const res = await call(deleteMeal, 'DELETE', `/api/meals/${mealId}`, { token, params: { id: mealId } });
    expect(res.status).toBe(204);
    const days = await call(getDays, 'GET', `/api/days?from=${today(-1)}&to=${today(-1)}`, { token });
    const day = (days.json as { days: { totals: Record<string, number>; logged: boolean }[] }).days[0];
    expect(day.totals.KCAL ?? 0).toBe(0);
  });
});

describe('GET /api/days', () => {
  it('returns wrapped per-day rows with totals and status', async () => {
    const res = await call(getDays, 'GET', `/api/days?from=${today()}&to=${today()}`, { token });
    expect(res.status).toBe(200);
    const body = res.json as { days: { date: string; logged: boolean; status: string; meals: unknown[] }[] };
    expect(body.days).toHaveLength(1);
    expect(body.days[0].date).toBe(today());
    expect(body.days[0].logged).toBe(true);
    // No targets yet: today is blank, never red.
    expect(body.days[0].status).toBe('blank');
  });

  it('400 on bad range', async () => {
    const res = await call(getDays, 'GET', `/api/days?from=2026-09-01&to=2026-08-01`, { token });
    expect(res.status).toBe(400);
  });
});
