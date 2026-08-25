import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { patchTargetSchema } from '@/lib/validation';
import { writeRevision } from '@/lib/revisions';
import { serializeTarget } from '@/lib/serializers';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/** PATCH /api/targets/{id} — "correct a past target". Session only; edits a historical row in place. */
export const PATCH = apiRoute('correctTarget', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/targets/[id]',
    nutrition: true,
    sessionOnly: true,
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, patchTargetSchema);
  if (bodyError) return bodyError;

  const row = await prisma.target.findFirst({ where: { id: params.id, userId: auth.userId } });
  if (!row) return notFound('Target not found');

  const nutrients = await prisma.nutrient.findMany({ where: { userId: auth.userId } });
  const validCodes = new Set(nutrients.map((n) => n.code));
  const unknown = Object.keys(body.values).filter((c) => !validCodes.has(c));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown nutrient codes: ${unknown.join(', ')}` },
      { status: 400 }
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.target.update({
      where: { id: row.id },
      data: { values: body.values as Prisma.InputJsonValue },
    });
    await writeRevision(tx, auth, {
      entityType: 'TARGET',
      entityId: row.id,
      action: 'CORRECT',
      before: serializeTarget(row),
      after: serializeTarget(u),
    });
    return u;
  });
  return NextResponse.json(serializeTarget(updated));
});
