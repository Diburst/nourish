import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { postNutrientSchema } from '@/lib/validation';
import { serializeNutrient } from '@/lib/serializers';
import { writeRevision } from '@/lib/revisions';

export const dynamic = 'force-dynamic';

export const GET = apiRoute('getNutrients', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/nutrients',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;
  const includeArchived = request.nextUrl.searchParams.get('archived') === 'true';
  const nutrients = await prisma.nutrient.findMany({
    where: { userId: auth.userId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: { sortOrder: 'asc' },
  });
  return NextResponse.json({ nutrients: nutrients.map(serializeNutrient) });
});

/** POST — add a nutrient. Re-adding an archived code un-archives it. */
export const POST = apiRoute('postNutrient', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/nutrients',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, postNutrientSchema);
  if (bodyError) return bodyError;

  const existing = await prisma.nutrient.findUnique({
    where: { userId_code: { userId: auth.userId, code: body.code } },
  });

  if (existing && !existing.archivedAt) {
    return NextResponse.json(
      { error: 'Nutrient already exists', nutrient: serializeNutrient(existing) },
      { status: 409 }
    );
  }

  const row = await prisma.$transaction(async (tx) => {
    if (existing) {
      const revived = await tx.nutrient.update({
        where: { id: existing.id },
        data: {
          archivedAt: null,
          displayName: body.displayName,
          unit: body.unit,
          kind: body.kind,
          targetRule: body.targetRule,
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        },
      });
      await writeRevision(tx, auth, {
        entityType: 'NUTRIENT',
        entityId: existing.id,
        action: 'RESTORE',
        before: serializeNutrient(existing),
        after: serializeNutrient(revived),
      });
      return revived;
    }
    const max = await tx.nutrient.aggregate({
      where: { userId: auth.userId },
      _max: { sortOrder: true },
    });
    const created = await tx.nutrient.create({
      data: {
        userId: auth.userId,
        code: body.code,
        displayName: body.displayName,
        unit: body.unit,
        kind: body.kind,
        targetRule: body.targetRule,
        sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1,
      },
    });
    await writeRevision(tx, auth, {
      entityType: 'NUTRIENT',
      entityId: created.id,
      action: 'CREATE',
      after: serializeNutrient(created),
    });
    return created;
  });

  return NextResponse.json(serializeNutrient(row), { status: existing ? 200 : 201 });
});
