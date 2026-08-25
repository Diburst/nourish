import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { patchNutrientSchema } from '@/lib/validation';
import { serializeNutrient } from '@/lib/serializers';
import { writeRevision } from '@/lib/revisions';

export const dynamic = 'force-dynamic';

/** PATCH /api/nutrients/{id} — edit display fields, rule, sort order; archive/unarchive. */
export const PATCH = apiRoute('patchNutrient', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/nutrients/[id]',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, patchNutrientSchema);
  if (bodyError) return bodyError;

  const row = await prisma.nutrient.findFirst({ where: { id: params.id, userId: auth.userId } });
  if (!row) return notFound('Nutrient not found');

  if (body.archived === true && (row.code === 'KCAL' || row.code === 'PROT')) {
    return NextResponse.json(
      { error: 'KCAL and PROT drive day success and cannot be archived' },
      { status: 400 }
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.nutrient.update({
      where: { id: row.id },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.targetRule !== undefined ? { targetRule: body.targetRule } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.archived !== undefined
          ? { archivedAt: body.archived ? new Date() : null }
          : {}),
      },
    });
    await writeRevision(tx, auth, {
      entityType: 'NUTRIENT',
      entityId: row.id,
      action: body.archived === true ? 'ARCHIVE' : body.archived === false ? 'RESTORE' : 'UPDATE',
      before: serializeNutrient(row),
      after: serializeNutrient(u),
    });
    return u;
  });
  return NextResponse.json(serializeNutrient(updated));
});
