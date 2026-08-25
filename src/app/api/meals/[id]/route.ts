import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { findOwnMeal } from '@/lib/mealService';
import { serializeMeal } from '@/lib/dayData';
import { writeRevision } from '@/lib/revisions';

export const dynamic = 'force-dynamic';

export const GET = apiRoute('getMeal', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meals/[id]',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;
  const meal = await findOwnMeal(auth.userId, params.id);
  if (!meal || meal.deletedAt) return notFound('Meal not found');
  return NextResponse.json(serializeMeal(meal as never));
});

const patchMealSchema = z.object({ notes: z.string().max(2000).nullable() });

export const PATCH = apiRoute('patchMeal', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meals/[id]',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, patchMealSchema);
  if (bodyError) return bodyError;

  const meal = await findOwnMeal(auth.userId, params.id);
  if (!meal || meal.deletedAt) return notFound('Meal not found');

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.meal.update({
      where: { id: meal.id },
      data: { notes: body.notes },
      include: { mealType: true, items: { include: { nutrients: { include: { nutrient: true } } } } },
    });
    await writeRevision(tx, auth, {
      entityType: 'MEAL',
      entityId: meal.id,
      action: 'UPDATE',
      before: { notes: meal.notes },
      after: { notes: body.notes },
    });
    return u;
  });
  return NextResponse.json(serializeMeal(updated as never));
});

export const DELETE = apiRoute('deleteMeal', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meals/[id]',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const meal = await findOwnMeal(auth.userId, params.id);
  if (!meal || meal.deletedAt) return notFound('Meal not found');

  await prisma.$transaction(async (tx) => {
    await tx.meal.update({ where: { id: meal.id }, data: { deletedAt: new Date() } });
    await writeRevision(tx, auth, {
      entityType: 'MEAL',
      entityId: meal.id,
      action: 'DELETE',
      before: serializeMeal(meal as never),
    });
  });
  return new NextResponse(null, { status: 204 });
});
