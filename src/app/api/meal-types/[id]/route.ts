import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { patchMealTypeSchema } from '@/lib/validation';
import { serializeMealType } from '@/lib/serializers';
import { writeRevision } from '@/lib/revisions';

export const dynamic = 'force-dynamic';

/** PATCH — rename (propagates), reorder, archive. Archiving is refused-delete's replacement. */
export const PATCH = apiRoute('patchMealType', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meal-types/[id]',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, patchMealTypeSchema);
  if (bodyError) return bodyError;

  const row = await prisma.mealType.findFirst({ where: { id: params.id, userId: auth.userId } });
  if (!row) return notFound('Meal type not found');

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.mealType.update({
      where: { id: row.id },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.archived !== undefined
          ? { archivedAt: body.archived ? new Date() : null }
          : {}),
      },
    });
    await writeRevision(tx, auth, {
      entityType: 'MEAL_TYPE',
      entityId: row.id,
      action: body.archived === true ? 'ARCHIVE' : body.archived === false ? 'RESTORE' : 'UPDATE',
      before: serializeMealType(row),
      after: serializeMealType(u),
    });
    return u;
  });
  return NextResponse.json(serializeMealType(updated));
});

/** DELETE — refused when the meal type is in use; archive instead. */
export const DELETE = apiRoute('deleteMealType', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meal-types/[id]',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;

  const row = await prisma.mealType.findFirst({ where: { id: params.id, userId: auth.userId } });
  if (!row) return notFound('Meal type not found');

  const inUse = await prisma.meal.count({ where: { mealTypeId: row.id } });
  if (inUse > 0) {
    return NextResponse.json(
      { error: 'Meal type is in use; archive it instead' },
      { status: 409 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.mealType.delete({ where: { id: row.id } });
    await writeRevision(tx, auth, {
      entityType: 'MEAL_TYPE',
      entityId: row.id,
      action: 'DELETE',
      before: serializeMealType(row),
    });
  });
  return new NextResponse(null, { status: 204 });
});
