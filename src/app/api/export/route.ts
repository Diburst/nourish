import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';
import { toDateString } from '@/lib/dates';
import { serializeMeal } from '@/lib/dayData';
import { serializeTarget, serializeWeightGoal, serializeNutrient, serializeMealType, serializeRevision } from '@/lib/serializers';

export const dynamic = 'force-dynamic';

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET /api/export?format=json|csv — full dump of the caller's data. */
export const GET = apiRoute('exportData', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/export',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;

  const format = request.nextUrl.searchParams.get('format') ?? 'json';
  if (!['json', 'csv'].includes(format)) {
    return NextResponse.json({ error: 'format must be json or csv' }, { status: 400 });
  }

  const [user, nutrients, mealTypes, targets, weightGoals, meals, weights, revisions] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: auth.userId } }),
      prisma.nutrient.findMany({ where: { userId: auth.userId }, orderBy: { sortOrder: 'asc' } }),
      prisma.mealType.findMany({ where: { userId: auth.userId }, orderBy: { sortOrder: 'asc' } }),
      prisma.target.findMany({ where: { userId: auth.userId }, orderBy: { effectiveFrom: 'asc' } }),
      prisma.weightGoal.findMany({ where: { userId: auth.userId }, orderBy: { effectiveFrom: 'asc' } }),
      prisma.meal.findMany({
        where: { userId: auth.userId, deletedAt: null },
        include: { mealType: true, items: { include: { nutrients: { include: { nutrient: true } } } } },
        orderBy: { date: 'asc' },
      }),
      prisma.weight.findMany({ where: { userId: auth.userId }, orderBy: { date: 'asc' } }),
      prisma.entryRevision.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: 'asc' },
        take: 10000,
      }),
    ]);

  const serializedMeals = meals.map((m) => serializeMeal(m as never));

  if (format === 'json') {
    const dump = {
      version: 1,
      exportedAt: new Date().toISOString(),
      user: {
        email: user.email,
        name: user.name,
        timezone: user.timezone,
        weightUnit: user.weightUnit,
        energyUnit: user.energyUnit,
      },
      nutrients: nutrients.map(serializeNutrient),
      mealTypes: mealTypes.map(serializeMealType),
      targets: targets.map(serializeTarget),
      weightGoals: weightGoals.map(serializeWeightGoal),
      meals: serializedMeals,
      weights: weights.map((w) => ({
        date: toDateString(w.date),
        valueKg: Number(w.valueKg),
        pinned: w.pinned,
        source: w.source,
      })),
      revisions: revisions.map(serializeRevision),
    };
    return new NextResponse(JSON.stringify(dump, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-disposition': 'attachment; filename="nourish-export.json"',
      },
    });
  }

  // CSV: meal items flattened, then weights as a second table after a blank line.
  const codes = nutrients.map((n) => n.code);
  const lines: string[] = [];
  lines.push(['date', 'mealType', 'item', 'quantity', ...codes].map(csvEscape).join(','));
  for (const meal of serializedMeals) {
    for (const item of meal.items) {
      lines.push(
        [
          meal.date,
          meal.mealType,
          item.name,
          item.quantity,
          ...codes.map((c) => item.totals[c] ?? ''),
        ]
          .map(csvEscape)
          .join(',')
      );
    }
  }
  lines.push('');
  lines.push(['date', 'weightKg', 'pinned', 'source'].map(csvEscape).join(','));
  for (const w of weights) {
    lines.push([toDateString(w.date), Number(w.valueKg), w.pinned, w.source].map(csvEscape).join(','));
  }
  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'text/csv',
      'content-disposition': 'attachment; filename="nourish-export.csv"',
    },
  });
});
