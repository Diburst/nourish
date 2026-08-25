import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { postItemSchema } from '@/lib/validation';
import { appendItem, conflictResponse, dayTotalsFor } from '@/lib/mealService';
import { toDateString } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/** POST /api/meals/{id}/items — append one item; 409 on duplicate unless onConflict. */
export const POST = apiRoute('addMealItem', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meals/[id]/items',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, postItemSchema);
  if (bodyError) return bodyError;

  const meal = await prisma.meal.findFirst({ where: { id: params.id, userId: auth.userId } });
  if (!meal || meal.deletedAt) return notFound('Meal not found');

  try {
    const { onConflict, ...item } = body;
    const result = await prisma.$transaction(async (tx) => {
      const r = await appendItem(tx, auth, meal, { ...item, quantity: item.quantity ?? 1 }, onConflict);
      const dayTotals = await dayTotalsFor(tx, auth.userId, toDateString(meal.date));
      return { ...r, dayTotals };
    });
    const status = result.replayed ? 200 : result.created ? 201 : 200;
    return NextResponse.json({ item: result.item, dayTotals: result.dayTotals }, { status });
  } catch (e) {
    const conflict = conflictResponse(e);
    if (conflict) return conflict;
    throw e;
  }
});
