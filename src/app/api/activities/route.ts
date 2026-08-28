import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { postActivitySchema } from '@/lib/validation';
import { parseDateToNoonUTC, todayInTz, DATE_RE, addDays } from '@/lib/dates';
import { writeRevision } from '@/lib/revisions';
import { actorOf } from '@/lib/apiAuth';
import { serializeActivity, recomputeDayAdjustment } from '@/lib/activityService';

export const dynamic = 'force-dynamic';

/** GET /api/activities?from&to — non-deleted activity entries, oldest first. */
export const GET = apiRoute('getActivities', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/activities',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const today = todayInTz(user.timezone);
  const from = sp.get('from') ?? addDays(today, -29);
  const to = sp.get('to') ?? today;
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD with from <= to' }, { status: 400 });
  }
  const rows = await prisma.dayActivity.findMany({
    where: {
      userId: auth.userId,
      deletedAt: null,
      date: { gte: parseDateToNoonUTC(from), lte: parseDateToNoonUTC(to) },
    },
    orderBy: [{ date: 'asc' }, { loggedAt: 'asc' }],
  });
  return NextResponse.json({ activities: rows.map(serializeActivity) });
});

/**
 * POST /api/activities — log one activity. Bumps the day's energy/protein allowance
 * only; never touches the targets table. Future dates are rejected with a teaching
 * error: "more calories from tomorrow on" is a target change (set_targets), not an
 * activity. Past dates are allowed — logging last night's run this morning is normal.
 */
export const POST = apiRoute('postActivity', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/activities',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, postActivitySchema);
  if (bodyError) return bodyError;

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const today = todayInTz(user.timezone);
  const dateStr = body.date ?? today;
  if (dateStr > today) {
    return NextResponse.json(
      {
        error: 'Activities cannot be logged for future dates',
        code: 'FUTURE_DATE',
        fix: `An activity bumps one finished (or in-progress) day's allowance. If the user wants a lasting change to their everyday goals starting ${dateStr}, that is a target change — call set_targets with effectiveFrom instead.`,
      },
      { status: 400 }
    );
  }

  if (body.idempotencyKey) {
    const existing = await prisma.dayActivity.findUnique({
      where: { userId_idempotencyKey: { userId: auth.userId, idempotencyKey: body.idempotencyKey } },
    });
    if (existing) return NextResponse.json(serializeActivity(existing), { status: 200 });
  }

  const date = parseDateToNoonUTC(dateStr);
  const { source } = actorOf(auth);

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.dayActivity.create({
      data: {
        userId: auth.userId,
        date,
        kcal: body.kcal,
        proteinG: body.proteinG ?? 0,
        label: body.label ?? null,
        minutes: body.minutes ?? null,
        source,
        tokenId: auth.tokenId,
        externalId: body.externalId ?? null,
        idempotencyKey: body.idempotencyKey ?? null,
      },
    });
    await writeRevision(tx, auth, {
      entityType: 'ACTIVITY',
      entityId: created.id,
      action: 'CREATE',
      after: serializeActivity(created),
    });
    const adjustment = await recomputeDayAdjustment(tx, auth.userId, date);
    return { created, adjustment };
  });

  return NextResponse.json(
    { ...serializeActivity(result.created), dayAdjustment: result.adjustment },
    { status: 201 }
  );
});
