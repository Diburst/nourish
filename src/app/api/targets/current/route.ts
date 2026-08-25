import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';
import { todayInTz, parseDateToNoonUTC } from '@/lib/dates';
import { serializeTarget } from '@/lib/serializers';

export const dynamic = 'force-dynamic';

/** GET /api/targets/current — the row covering today, or null. */
export const GET = apiRoute('getCurrentTarget', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/targets/current',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const today = parseDateToNoonUTC(todayInTz(user.timezone));
  const row = await prisma.target.findFirst({
    where: {
      userId: auth.userId,
      effectiveFrom: { lte: today },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  return NextResponse.json({ target: row ? serializeTarget(row) : null });
});
