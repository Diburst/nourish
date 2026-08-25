import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';
import { DATE_RE, todayInTz, addDays } from '@/lib/dates';
import { getDaysData } from '@/lib/dayData';

export const dynamic = 'force-dynamic';

/** GET /api/days?from&to — per-day totals, success flags, meals with items. Max 100 days per page. */
export const GET = apiRoute('getDays', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/days',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const today = todayInTz(user.timezone);
  const from = sp.get('from') ?? addDays(today, -6);
  const to = sp.get('to') ?? today;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: 'from must be <= to' }, { status: 400 });
  }

  const MAX_DAYS = 100;
  let pageTo = to;
  let nextFrom: string | null = null;
  const spanDays =
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000 + 1;
  if (spanDays > MAX_DAYS) {
    pageTo = addDays(from, MAX_DAYS - 1);
    nextFrom = addDays(pageTo, 1);
  }

  const days = await getDaysData(
    { id: user.id, timezone: user.timezone, createdAt: user.createdAt },
    from,
    pageTo
  );
  return NextResponse.json({
    days: days.map((d) => ({
      date: d.date,
      logged: d.logged,
      status: d.status,
      totals: d.totals,
      target: d.target,
      weightKg: d.weightKg,
      meals: d.meals,
    })),
    ...(nextFrom ? { nextFrom } : {}),
  });
});
