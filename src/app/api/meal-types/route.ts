import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { postMealTypeSchema } from '@/lib/validation';
import { serializeMealType } from '@/lib/serializers';
import { writeRevision } from '@/lib/revisions';

export const dynamic = 'force-dynamic';

export const GET = apiRoute('getMealTypes', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meal-types',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;
  const includeArchived = request.nextUrl.searchParams.get('archived') === 'true';
  const mealTypes = await prisma.mealType.findMany({
    where: { userId: auth.userId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: { sortOrder: 'asc' },
  });
  return NextResponse.json({ mealTypes: mealTypes.map(serializeMealType) });
});

export const POST = apiRoute('postMealType', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/meal-types',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, postMealTypeSchema);
  if (bodyError) return bodyError;

  const existing = await prisma.mealType.findUnique({
    where: { userId_code: { userId: auth.userId, code: body.code } },
  });
  if (existing && !existing.archivedAt) {
    return NextResponse.json(
      { error: 'Meal type already exists', mealType: serializeMealType(existing) },
      { status: 409 }
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    if (existing) {
      const revived = await tx.mealType.update({
        where: { id: existing.id },
        data: { archivedAt: null, displayName: body.displayName },
      });
      await writeRevision(tx, auth, {
        entityType: 'MEAL_TYPE',
        entityId: existing.id,
        action: 'RESTORE',
        before: serializeMealType(existing),
        after: serializeMealType(revived),
      });
      return revived;
    }
    const max = await tx.mealType.aggregate({
      where: { userId: auth.userId },
      _max: { sortOrder: true },
    });
    const created = await tx.mealType.create({
      data: {
        userId: auth.userId,
        code: body.code,
        displayName: body.displayName,
        sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1,
      },
    });
    await writeRevision(tx, auth, {
      entityType: 'MEAL_TYPE',
      entityId: created.id,
      action: 'CREATE',
      after: serializeMealType(created),
    });
    return created;
  });
  return NextResponse.json(serializeMealType(row), { status: existing ? 200 : 201 });
});
