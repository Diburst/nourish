import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { postWeightSchema } from '@/lib/validation';
import { parseDateToNoonUTC, toDateString, todayInTz, DATE_RE, addDays } from '@/lib/dates';
import { weightToKg } from '@/lib/units';
import { writeRevision } from '@/lib/revisions';
import { actorOf } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

function serializeWeight(w: { id: string; date: Date; valueKg: Prisma.Decimal; pinned: boolean; source: string; loggedAt: Date }) {
  return {
    id: w.id,
    date: toDateString(w.date),
    valueKg: Number(w.valueKg),
    pinned: w.pinned,
    source: w.source,
    loggedAt: w.loggedAt.toISOString(),
  };
}

/** GET /api/weights?from&to */
export const GET = apiRoute('getWeights', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/weights',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const today = todayInTz(user.timezone);
  const from = sp.get('from') ?? addDays(today, -89);
  const to = sp.get('to') ?? today;
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD with from <= to' }, { status: 400 });
  }
  const weights = await prisma.weight.findMany({
    where: { userId: auth.userId, date: { gte: parseDateToNoonUTC(from), lte: parseDateToNoonUTC(to) } },
    orderBy: { date: 'asc' },
  });
  return NextResponse.json({ weights: weights.map(serializeWeight) });
});

/** POST /api/weights — one per day, (userId, date) upsert, latest write wins. */
export const POST = apiRoute('postWeight', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/weights',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, postWeightSchema);
  if (bodyError) return bodyError;

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dateStr = body.date ?? todayInTz(user.timezone);
  const unit = (body.weightUnit ?? user.weightUnit).toUpperCase() as 'LB' | 'KG';
  const valueKg = weightToKg(body.value, unit);
  const { source } = actorOf(auth);
  const isAgent = auth.tokenId !== null;

  if (body.idempotencyKey) {
    const existing = await prisma.weight.findUnique({
      where: { userId_idempotencyKey: { userId: auth.userId, idempotencyKey: body.idempotencyKey } },
    });
    if (existing) return NextResponse.json(serializeWeight(existing), { status: 200 });
  }

  const date = parseDateToNoonUTC(dateStr);
  const existing = await prisma.weight.findUnique({
    where: { userId_date: { userId: auth.userId, date } },
  });

  if (existing && existing.pinned && isAgent && !body.override) {
    return NextResponse.json({ error: 'Entry pinned by user' }, { status: 409 });
  }

  const result = await prisma.$transaction(async (tx) => {
    if (existing) {
      const updated = await tx.weight.update({
        where: { id: existing.id },
        data: {
          valueKg: new Prisma.Decimal(valueKg),
          loggedAt: new Date(),
          source,
          tokenId: auth.tokenId,
          idempotencyKey: body.idempotencyKey ?? existing.idempotencyKey,
          pinned: isAgent ? existing.pinned : true,
        },
      });
      await writeRevision(tx, auth, {
        entityType: 'WEIGHT',
        entityId: existing.id,
        action: 'UPDATE',
        before: serializeWeight(existing),
        after: serializeWeight(updated),
        override: Boolean(body.override && existing.pinned && isAgent),
      });
      return { row: updated, created: false };
    }
    const created = await tx.weight.create({
      data: {
        userId: auth.userId,
        date,
        valueKg: new Prisma.Decimal(valueKg),
        source,
        tokenId: auth.tokenId,
        idempotencyKey: body.idempotencyKey ?? null,
        pinned: !isAgent,
      },
    });
    await writeRevision(tx, auth, {
      entityType: 'WEIGHT',
      entityId: created.id,
      action: 'CREATE',
      after: serializeWeight(created),
    });
    return { row: created, created: true };
  });

  return NextResponse.json(serializeWeight(result.row), { status: result.created ? 201 : 200 });
});
