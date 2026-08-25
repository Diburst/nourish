import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { putWeightGoalSchema } from '@/lib/validation';
import { parseDateToNoonUTC, toDateString, todayInTz, addDays } from '@/lib/dates';
import { weightToKg } from '@/lib/units';
import { writeRevision } from '@/lib/revisions';
import { actorOf } from '@/lib/apiAuth';
import { serializeWeightGoal } from '@/lib/serializers';

export const dynamic = 'force-dynamic';

/** GET /api/weight-goal — current goal + history. */
export const GET = apiRoute('getWeightGoal', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/weight-goal',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const today = parseDateToNoonUTC(todayInTz(user.timezone));
  const rows = await prisma.weightGoal.findMany({
    where: { userId: auth.userId },
    orderBy: { effectiveFrom: 'asc' },
  });
  const current =
    rows.filter(
      (r) => r.effectiveFrom <= today && (r.effectiveTo === null || r.effectiveTo >= today)
    )[0] ?? null;
  return NextResponse.json({
    goal: current ? serializeWeightGoal(current) : null,
    history: rows.map(serializeWeightGoal),
  });
});

/** PUT /api/weight-goal — append-only, same mechanism as targets. */
export const PUT = apiRoute('putWeightGoal', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/weight-goal',
    nutrition: true,
    scope: 'targets:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, putWeightGoalSchema);
  if (bodyError) return bodyError;

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const effectiveFrom = body.effectiveFrom ?? todayInTz(user.timezone);
  const unit = (body.weightUnit ?? user.weightUnit).toUpperCase() as 'LB' | 'KG';
  const targetKg = weightToKg(body.target, unit);

  const rows = await prisma.weightGoal.findMany({
    where: { userId: auth.userId },
    orderBy: { effectiveFrom: 'asc' },
  });
  const maxFrom = rows.length ? toDateString(rows[rows.length - 1].effectiveFrom) : null;
  if (maxFrom && effectiveFrom < maxFrom) {
    return NextResponse.json(
      { error: 'effectiveFrom predates an existing weight goal row' },
      { status: 400 }
    );
  }

  const { source } = actorOf(auth);
  const created = await prisma.$transaction(async (tx) => {
    const open = rows.filter((r) => r.effectiveTo === null);
    for (const row of open) {
      await tx.weightGoal.update({
        where: { id: row.id },
        data: { effectiveTo: parseDateToNoonUTC(addDays(effectiveFrom, -1)) },
      });
    }
    const row = await tx.weightGoal.create({
      data: {
        userId: auth.userId,
        effectiveFrom: parseDateToNoonUTC(effectiveFrom),
        targetKg: new Prisma.Decimal(targetKg),
        direction: body.direction,
        source,
        tokenId: auth.tokenId,
      },
    });
    await writeRevision(tx, auth, {
      entityType: 'WEIGHT_GOAL',
      entityId: row.id,
      action: 'CREATE',
      before: open.length ? serializeWeightGoal(open[open.length - 1]) : undefined,
      after: serializeWeightGoal(row),
    });
    return row;
  });

  return NextResponse.json(serializeWeightGoal(created), { status: 201 });
});
