import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { putTargetsSchema } from '@/lib/validation';
import { parseDateToNoonUTC, toDateString, todayInTz, addDays } from '@/lib/dates';
import { writeRevision } from '@/lib/revisions';
import { actorOf } from '@/lib/apiAuth';
import type { Prisma } from '@prisma/client';
import { serializeTarget } from '@/lib/serializers';

export const dynamic = 'force-dynamic';

/** GET /api/targets — full effective-dated history. */
export const GET = apiRoute('getTargets', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/targets',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;
  const targets = await prisma.target.findMany({
    where: { userId: auth.userId },
    orderBy: { effectiveFrom: 'asc' },
  });
  return NextResponse.json({ targets: targets.map(serializeTarget) });
});

/**
 * PUT /api/targets — append-only: closes the open row (effectiveTo = new.effectiveFrom − 1)
 * and inserts a new one. Never edits history, so past checkmarks and streaks are frozen.
 */
export const PUT = apiRoute('putTargets', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/targets',
    nutrition: true,
    scope: 'targets:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, putTargetsSchema);
  if (bodyError) return bodyError;

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const effectiveFrom = body.effectiveFrom ?? todayInTz(user.timezone);

  // Validate codes against the user's nutrient list.
  const nutrients = await prisma.nutrient.findMany({ where: { userId: auth.userId } });
  const validCodes = new Set(nutrients.map((n) => n.code));
  const unknown = Object.keys(body.values).filter((c) => !validCodes.has(c));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: `Unknown nutrient code${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Valid codes: ${[...validCodes].join(', ')}` },
      { status: 400 }
    );
  }

  const rows = await prisma.target.findMany({
    where: { userId: auth.userId },
    orderBy: { effectiveFrom: 'asc' },
  });
  const maxFrom = rows.length ? toDateString(rows[rows.length - 1].effectiveFrom) : null;
  if (maxFrom && effectiveFrom < maxFrom) {
    return NextResponse.json(
      { error: 'effectiveFrom predates an existing target row. Use PATCH /api/targets/{id} to correct a past target.' },
      { status: 400 }
    );
  }

  const { source } = actorOf(auth);
  const created = await prisma.$transaction(async (tx) => {
    const open = rows.filter((r) => r.effectiveTo === null);
    for (const row of open) {
      await tx.target.update({
        where: { id: row.id },
        data: { effectiveTo: parseDateToNoonUTC(addDays(effectiveFrom, -1)) },
      });
    }
    const row = await tx.target.create({
      data: {
        userId: auth.userId,
        effectiveFrom: parseDateToNoonUTC(effectiveFrom),
        values: body.values as Prisma.InputJsonValue,
        source,
        tokenId: auth.tokenId,
      },
    });
    await writeRevision(tx, auth, {
      entityType: 'TARGET',
      entityId: row.id,
      action: 'CREATE',
      before: open.length ? serializeTarget(open[open.length - 1]) : undefined,
      after: serializeTarget(row),
    });
    return row;
  });

  return NextResponse.json(serializeTarget(created), { status: 201 });
});
