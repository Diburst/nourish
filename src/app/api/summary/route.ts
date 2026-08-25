import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';
import { buildSummary } from '@/lib/summaryService';

export const dynamic = 'force-dynamic';

/** GET /api/summary?range=7d|30d|90d — JSON only. */
export const GET = apiRoute('getSummary', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/summary',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;

  const range = request.nextUrl.searchParams.get('range') ?? '7d';
  if (!['7d', '30d', '90d'].includes(range)) {
    return NextResponse.json({ error: 'range must be one of 7d, 30d, 90d' }, { status: 400 });
  }
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const summary = await buildSummary(
    { id: user.id, timezone: user.timezone, createdAt: user.createdAt },
    { rangeDays: Number(range.replace('d', '')) as 7 | 30 | 90 }
  );
  return NextResponse.json(summary);
});
