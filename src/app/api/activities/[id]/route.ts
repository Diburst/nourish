import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { patchActivitySchema } from '@/lib/validation';
import { parseDateToNoonUTC, todayInTz } from '@/lib/dates';
import { writeRevision } from '@/lib/revisions';
import { serializeActivity, recomputeDayAdjustment } from '@/lib/activityService';

export const dynamic = 'force-dynamic';

/** PATCH /api/activities/:id — amend any field. Moving the date recomputes both days. */
export const PATCH = apiRoute('patchActivity', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/activities/[id]',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, patchActivitySchema);
  if (bodyError) return bodyError;

  const existing = await prisma.dayActivity.findFirst({
    where: { id: params.id, userId: auth.userId, deletedAt: null },
  });
  if (!existing) return notFound('Activity not found');

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const today = todayInTz(user.timezone);
  if (body.date && body.date > today) {
    return NextResponse.json(
      {
        error: 'Activities cannot be moved to future dates',
        code: 'FUTURE_DATE',
        fix: 'For a lasting change to everyday goals, use set_targets instead.',
      },
      { status: 400 }
    );
  }

  const newDate = body.date ? parseDateToNoonUTC(body.date) : existing.date;
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.dayActivity.update({
      where: { id: existing.id },
      data: {
        date: newDate,
        ...(body.kcal !== undefined ? { kcal: body.kcal } : {}),
        ...(body.proteinG !== undefined ? { proteinG: body.proteinG } : {}),
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.minutes !== undefined ? { minutes: body.minutes } : {}),
        updatedAt: new Date(),
      },
    });
    await writeRevision(tx, auth, {
      entityType: 'ACTIVITY',
      entityId: existing.id,
      action: 'UPDATE',
      before: serializeActivity(existing),
      after: serializeActivity(updated),
    });
    const adjustment = await recomputeDayAdjustment(tx, auth.userId, newDate);
    if (newDate.getTime() !== existing.date.getTime()) {
      await recomputeDayAdjustment(tx, auth.userId, existing.date);
    }
    return { updated, adjustment };
  });

  return NextResponse.json({ ...serializeActivity(result.updated), dayAdjustment: result.adjustment });
});

/** DELETE /api/activities/:id — soft delete; the day's roll-up recomputes in-transaction. */
export const DELETE = apiRoute('deleteActivity', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/activities/[id]',
    nutrition: true,
    scope: 'nutrition:write',
    write: true,
  });
  if (error) return error;

  const existing = await prisma.dayActivity.findFirst({
    where: { id: params.id, userId: auth.userId, deletedAt: null },
  });
  if (!existing) return notFound('Activity not found');

  const adjustment = await prisma.$transaction(async (tx) => {
    await tx.dayActivity.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), updatedAt: new Date() },
    });
    await writeRevision(tx, auth, {
      entityType: 'ACTIVITY',
      entityId: existing.id,
      action: 'DELETE',
      before: serializeActivity(existing),
    });
    return recomputeDayAdjustment(tx, auth.userId, existing.date);
  });

  return NextResponse.json({ ok: true, dayAdjustment: adjustment });
});
