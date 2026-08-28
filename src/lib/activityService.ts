import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toDateString, parseDateToNoonUTC } from '@/lib/dates';
import { ActivityAdjustment } from '@/lib/scoring';

type Tx = Prisma.TransactionClient;

export interface SerializedActivity {
  id: string;
  date: string;
  kcal: number;
  proteinG: number;
  label: string | null;
  minutes: number | null;
  source: string;
  tokenId: string | null;
  externalId: string | null;
  loggedAt: string;
}

export function serializeActivity(a: {
  id: string;
  date: Date;
  kcal: number;
  proteinG: number;
  label: string | null;
  minutes: number | null;
  source: string;
  tokenId: string | null;
  externalId: string | null;
  loggedAt: Date;
}): SerializedActivity {
  return {
    id: a.id,
    date: toDateString(a.date),
    kcal: a.kcal,
    proteinG: a.proteinG,
    label: a.label,
    minutes: a.minutes,
    source: a.source,
    tokenId: a.tokenId,
    externalId: a.externalId,
    loggedAt: a.loggedAt.toISOString(),
  };
}

/**
 * Recompute the day's recorded roll-up from its DayActivity rows, inside the
 * caller's transaction. Recompute-from-rows, never increment: a dropped write, a
 * partial rollback or a hand-edited row all correct themselves on the next touch.
 * The DayAdjustment row is upserted — created on demand when a user logs a workout
 * before eating anything — so it never exists with a stale zero.
 */
export async function recomputeDayAdjustment(tx: Tx, userId: string, date: Date): Promise<ActivityAdjustment> {
  const agg = await tx.dayActivity.aggregate({
    where: { userId, date, deletedAt: null },
    _sum: { kcal: true, proteinG: true },
  });
  const kcal = agg._sum.kcal ?? 0;
  const proteinG = agg._sum.proteinG ?? 0;
  await tx.dayAdjustment.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, activityKcal: kcal, activityProteinG: proteinG },
    update: { activityKcal: kcal, activityProteinG: proteinG, updatedAt: new Date() },
  });
  return { kcal, proteinG };
}

/** Map date string → adjustment for [from, to]. Days without a row are simply absent. */
export async function loadAdjustments(
  userId: string,
  from: string,
  to: string
): Promise<Map<string, ActivityAdjustment>> {
  const rows = await prisma.dayAdjustment.findMany({
    where: { userId, date: { gte: parseDateToNoonUTC(from), lte: parseDateToNoonUTC(to) } },
  });
  return new Map(
    rows.map((r) => [toDateString(r.date), { kcal: r.activityKcal, proteinG: r.activityProteinG }])
  );
}

/** Map date string → non-deleted activities for [from, to], oldest first per day. */
export async function loadActivities(
  userId: string,
  from: string,
  to: string
): Promise<Map<string, SerializedActivity[]>> {
  const rows = await prisma.dayActivity.findMany({
    where: {
      userId,
      deletedAt: null,
      date: { gte: parseDateToNoonUTC(from), lte: parseDateToNoonUTC(to) },
    },
    orderBy: [{ date: 'asc' }, { loggedAt: 'asc' }],
  });
  const out = new Map<string, SerializedActivity[]>();
  for (const row of rows) {
    const s = serializeActivity(row);
    const arr = out.get(s.date) ?? [];
    arr.push(s);
    out.set(s.date, arr);
  }
  return out;
}

/** Does the account have any activity entry in the last `days` days? (set_targets hint) */
export async function hasRecentActivity(userId: string, today: string, days = 14): Promise<boolean> {
  const from = parseDateToNoonUTC(today);
  from.setUTCDate(from.getUTCDate() - days);
  const row = await prisma.dayActivity.findFirst({
    where: { userId, deletedAt: null, date: { gte: from } },
    select: { id: true },
  });
  return row !== null;
}
