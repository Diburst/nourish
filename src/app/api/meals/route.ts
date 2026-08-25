import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { postMealSchema } from '@/lib/validation';
import { todayInTz } from '@/lib/dates';
import { upsertSlot, appendItem, dayTotalsFor, conflictResponse } from '@/lib/mealService';
import { serializeMeal } from '@/lib/dayData';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** POST /api/meals — upsert the (date, mealType) slot and append items. */
export const POST = apiRoute('createMeal', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meals',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;

  const { body, error: bodyError } = await parseBody(request, postMealSchema);
  if (bodyError) return bodyError;

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const date = body.date ?? todayInTz(user.timezone);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const slot = await upsertSlot(tx, auth, {
        date,
        mealTypeCode: body.mealType,
        notes: body.notes,
      });
      let anyCreated = false;
      for (const item of body.items) {
        const r = await appendItem(tx, auth, slot, { ...item, quantity: item.quantity ?? 1 }, body.onConflict);
        anyCreated = anyCreated || r.created;
      }
      const full = await tx.meal.findUniqueOrThrow({
        where: { id: slot.id },
        include: { mealType: true, items: { include: { nutrients: { include: { nutrient: true } } } } },
      });
      const dayTotals = await dayTotalsFor(tx, auth.userId, date);
      return { meal: serializeMeal(full as never), dayTotals, anyCreated };
    });
    logger.info('Meal logged', { userId: auth.userId, date, mealType: body.mealType });
    const status = result.anyCreated ? 201 : 200;
    return NextResponse.json({ meal: result.meal, dayTotals: result.dayTotals }, { status });
  } catch (e) {
    const conflict = conflictResponse(e);
    if (conflict) return conflict;
    throw e;
  }
});
