/**
 * v1.6 day adjustments: DayActivity rows + the DayAdjustment recorded roll-up.
 * Covers the plan §6 unit/contract items for workstream 1.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, createUser, createToken, call, prisma, today } from './helpers';
import { GET as getActivities, POST as postActivity } from '@/app/api/activities/route';
import { PATCH as patchActivity, DELETE as deleteActivity } from '@/app/api/activities/[id]/route';
import { PUT as putTargets } from '@/app/api/targets/route';
import { GET as getDays } from '@/app/api/days/route';
import { GET as getSummary } from '@/app/api/summary/route';
import { parseDateToNoonUTC } from '@/lib/dates';
import { applyAdjustment } from '@/lib/scoring';

let user: Awaited<ReturnType<typeof createUser>>;
let token: string;
let readToken: string;

async function adjustmentRow(date: string) {
  return prisma.dayAdjustment.findUnique({
    where: { userId_date: { userId: user.id, date: parseDateToNoonUTC(date) } },
  });
}

beforeAll(async () => {
  await resetDb();
  user = await createUser();
  token = (await createToken(user.id)).raw;
  readToken = (await createToken(user.id, ['nutrition:read'])).raw;
  await call(putTargets, 'PUT', '/api/targets', {
    token,
    body: { effectiveFrom: today(-30), values: { KCAL: 2000, PROT: 100 } },
  });
});

describe('activity CRUD + roll-up recompute', () => {
  let firstId: string;
  let secondId: string;

  it('POST creates an activity and the DayAdjustment row on demand', async () => {
    const res = await call(postActivity, 'POST', '/api/activities', {
      token,
      body: { date: today(), kcal: 700, proteinG: 25, label: '10k run', minutes: 52 },
    });
    expect(res.status).toBe(201);
    const body = res.json as { id: string; kcal: number; proteinG: number; dayAdjustment: { kcal: number } };
    firstId = body.id;
    expect(body.kcal).toBe(700);
    expect(body.proteinG).toBe(25);
    expect(body.dayAdjustment).toEqual({ kcal: 700, proteinG: 25 });
    const row = await adjustmentRow(today());
    expect(row).not.toBeNull();
    expect(row!.activityKcal).toBe(700);
    expect(row!.activityProteinG).toBe(25);
  });

  it('proteinG defaults to 0 when omitted', async () => {
    const res = await call(postActivity, 'POST', '/api/activities', {
      token,
      body: { date: today(), kcal: 300, label: 'walk' },
    });
    expect(res.status).toBe(201);
    secondId = (res.json as { id: string }).id;
    const row = await adjustmentRow(today());
    expect(row!.activityKcal).toBe(1000); // 700 + 300 — several activities sum
    expect(row!.activityProteinG).toBe(25);
  });

  it('PATCH recomputes the roll-up (update path)', async () => {
    const res = await call(patchActivity, 'PATCH', `/api/activities/${secondId}`, {
      token,
      body: { kcal: 400, proteinG: 10 },
      params: { id: secondId },
    });
    expect(res.status).toBe(200);
    const row = await adjustmentRow(today());
    expect(row!.activityKcal).toBe(1100);
    expect(row!.activityProteinG).toBe(35);
  });

  it('DELETE soft-deletes and drops the roll-up back', async () => {
    const res = await call(deleteActivity, 'DELETE', `/api/activities/${secondId}`, {
      token,
      params: { id: secondId },
    });
    expect(res.status).toBe(200);
    const soft = await prisma.dayActivity.findUnique({ where: { id: secondId } });
    expect(soft!.deletedAt).not.toBeNull();
    const row = await adjustmentRow(today());
    expect(row!.activityKcal).toBe(700);
    expect(row!.activityProteinG).toBe(25);
  });

  it('deleting the last activity leaves a zero roll-up, not a stale one', async () => {
    await call(deleteActivity, 'DELETE', `/api/activities/${firstId}`, { token, params: { id: firstId } });
    const row = await adjustmentRow(today());
    expect(row!.activityKcal).toBe(0);
    expect(row!.activityProteinG).toBe(0);
    // restore one for later tests
    const res = await call(postActivity, 'POST', '/api/activities', {
      token,
      body: { date: today(), kcal: 700, proteinG: 25, label: '10k run' },
    });
    firstId = (res.json as { id: string }).id;
  });

  it('GET lists non-deleted activities only', async () => {
    const res = await call(getActivities, 'GET', `/api/activities?from=${today(-7)}&to=${today()}`, { token: readToken });
    expect(res.status).toBe(200);
    const acts = (res.json as { activities: { id: string }[] }).activities;
    expect(acts.map((a) => a.id)).toEqual([firstId]);
  });

  it('idempotencyKey makes retries safe', async () => {
    const body = { date: today(), kcal: 150, idempotencyKey: 'retry-safe-1' };
    const a = await call(postActivity, 'POST', '/api/activities', { token, body });
    expect(a.status).toBe(201);
    const b = await call(postActivity, 'POST', '/api/activities', { token, body });
    expect(b.status).toBe(200);
    expect((b.json as { id: string }).id).toBe((a.json as { id: string }).id);
    const row = await adjustmentRow(today());
    expect(row!.activityKcal).toBe(850); // counted once
    await call(deleteActivity, 'DELETE', `/api/activities/${(a.json as { id: string }).id}`, {
      token,
      params: { id: (a.json as { id: string }).id },
    });
  });

  it('writes EntryRevisions with entityType ACTIVITY', async () => {
    const revs = await prisma.entryRevision.findMany({ where: { userId: user.id, entityType: 'ACTIVITY' } });
    expect(revs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(revs.map((r) => r.action))).toContain('DELETE');
  });
});

describe('teaching errors', () => {
  it('rejects future dates, pointing at set_targets', async () => {
    const res = await call(postActivity, 'POST', '/api/activities', {
      token,
      body: { date: today(2), kcal: 500 },
    });
    expect(res.status).toBe(400);
    const body = res.json as { error: string; code: string; fix: string };
    expect(body.code).toBe('FUTURE_DATE');
    expect(body.fix).toMatch(/set_targets/);
  });

  it('allows past dates', async () => {
    const res = await call(postActivity, 'POST', '/api/activities', {
      token,
      body: { date: today(-1), kcal: 500, proteinG: 20 },
    });
    expect(res.status).toBe(201);
    const row = await adjustmentRow(today(-1));
    expect(row!.activityKcal).toBe(500);
  });

  it('range-validates a mis-keyed 7000 kcal', async () => {
    const res = await call(postActivity, 'POST', '/api/activities', {
      token,
      body: { kcal: 7000 },
    });
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toMatch(/0–5000/);
  });

  it('range-validates proteinG > 300', async () => {
    const res = await call(postActivity, 'POST', '/api/activities', {
      token,
      body: { kcal: 500, proteinG: 400 },
    });
    expect(res.status).toBe(400);
    expect((res.json as { error: string }).error).toMatch(/0–300/);
  });

  it('requires nutrition:write', async () => {
    const res = await call(postActivity, 'POST', '/api/activities', {
      token: readToken,
      body: { kcal: 100 },
    });
    expect(res.status).toBe(403);
  });
});

describe('adjustments vs targets stay disjoint (bidirectional contract)', () => {
  it('activity writes never touch the targets table', async () => {
    const before = await prisma.target.findMany({ where: { userId: user.id } });
    await call(postActivity, 'POST', '/api/activities', { token, body: { kcal: 200, label: 'row' } });
    const after = await prisma.target.findMany({ where: { userId: user.id } });
    expect(after).toEqual(before);
  });

  it('set_targets never touches DayAdjustment rows', async () => {
    const before = await prisma.dayAdjustment.findMany({ where: { userId: user.id }, orderBy: { date: 'asc' } });
    const res = await call(putTargets, 'PUT', '/api/targets', {
      token,
      body: { values: { KCAL: 2100, PROT: 110 } },
    });
    expect([200, 201]).toContain(res.status);
    const after = await prisma.dayAdjustment.findMany({ where: { userId: user.id }, orderBy: { date: 'asc' } });
    expect(after).toEqual(before);
  });
});

describe('effective targets in reads', () => {
  it('get_days: baseline target unchanged, adjustment and activities additive; success uses base + adjustment', async () => {
    const res = await call(getDays, 'GET', `/api/days?from=${today(-1)}&to=${today()}`, { token: readToken });
    expect(res.status).toBe(200);
    const days = (res.json as { days: Record<string, unknown>[] }).days;
    // v1.5 contract: every pre-existing field still present with the same shape.
    for (const d of days) {
      for (const key of ['date', 'logged', 'status', 'totals', 'target', 'weightKg', 'meals']) {
        expect(d).toHaveProperty(key);
      }
      expect(d).toHaveProperty('activityAdjustmentKcal');
      expect(d).toHaveProperty('activityAdjustmentProteinG');
      expect(d).toHaveProperty('activities');
      expect(d).toHaveProperty('adjustedTarget');
    }
    const yesterday = days.find((d) => d.date === today(-1))!;
    // Baseline reads 2000/100 (the row effective at that date), untouched by activity.
    expect((yesterday.target as Record<string, number>).KCAL).toBe(2000);
    expect(yesterday.activityAdjustmentKcal).toBe(500);
    expect((yesterday.adjustedTarget as Record<string, number>).KCAL).toBe(2500);
    expect((yesterday.adjustedTarget as Record<string, number>).PROT).toBe(120);
  });

  it('adjustments never leak to the next day', async () => {
    const res = await call(getDays, 'GET', `/api/days?from=${today(-2)}&to=${today(-2)}`, { token: readToken });
    const day = (res.json as { days: Record<string, unknown>[] }).days[0];
    expect(day.activityAdjustmentKcal).toBe(0);
    expect(day.adjustedTarget).toEqual(day.target);
  });

  it('get_summary keeps v1.5 fields and gains the activity block', async () => {
    const res = await call(getSummary, 'GET', '/api/summary?range=7d', { token: readToken });
    expect(res.status).toBe(200);
    const s = res.json as Record<string, unknown>;
    for (const key of [
      'range', 'daysLogged', 'unloggedDays', 'averages', 'kcal', 'prot', 'weeks', 'streak', 'weight',
      'topShortfalls', 'laggingMicros',
    ]) {
      expect(s).toHaveProperty(key);
    }
    const activity = s.activity as { daysWithActivity: number; adjustmentKcalTotal: number; adjustmentProteinGTotal: number };
    expect(activity.daysWithActivity).toBeGreaterThanOrEqual(2);
    expect(activity.adjustmentKcalTotal).toBeGreaterThanOrEqual(1400);
  });
});

describe('blank-day rule and applyAdjustment purity', () => {
  it('a day with an adjustment but no baseline target stays blank, not red', async () => {
    const fresh = await createUser({ timezone: 'UTC' });
    const freshToken = (await createToken(fresh.id)).raw;
    // Log a meal (so the day is "logged") and an activity — but never set targets.
    const { POST: postMeals } = await import('@/app/api/meals/route');
    await call(postMeals, 'POST', '/api/meals', {
      token: freshToken,
      body: { mealType: 'LUNCH', items: [{ name: 'eggs', nutrients: { KCAL: 4000 } }] },
    });
    await call(postActivity, 'POST', '/api/activities', { token: freshToken, body: { kcal: 400 } });
    const res = await call(getDays, 'GET', `/api/days?from=${today()}&to=${today()}`, { token: freshToken });
    const day = (res.json as { days: Record<string, unknown>[] }).days[0];
    expect(day.target).toBeNull();
    expect(day.adjustedTarget).toBeNull();
    // Today is 'pending' only when evaluable; with no target it must be blank.
    expect(day.status).toBe('blank');
  });

  it('applyAdjustment bumps KCAL/PROT only and never mutates its input', () => {
    const target = {
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      values: { KCAL: 2000, PROT: 100, MG: 400, FIBER: { min: 25, max: 40 } },
    };
    const frozen = JSON.parse(JSON.stringify(target));
    const adjusted = applyAdjustment(target, { kcal: 700, proteinG: 25 });
    expect(adjusted!.values.KCAL).toBe(2700);
    expect(adjusted!.values.PROT).toBe(125);
    expect(adjusted!.values.MG).toBe(400);
    expect(adjusted!.values.FIBER).toEqual({ min: 25, max: 40 });
    expect(target).toEqual(frozen); // no mutation — nothing writes to target history
    expect(applyAdjustment(null, { kcal: 700, proteinG: 0 })).toBeNull(); // blank-day rule wins
    expect(applyAdjustment(target, { kcal: 0, proteinG: 0 })).toBe(target); // zero adj is identity
  });
});
