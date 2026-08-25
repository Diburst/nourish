import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';
import { DATE_RE, parseDateToNoonUTC, addDays } from '@/lib/dates';
import { serializeRevision } from '@/lib/serializers';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/** GET /api/activity?cursor&actor&entityType&from&to — EntryRevision feed, 50/page. */
export const GET = apiRoute('getActivity', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/activity',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const cursor = sp.get('cursor');
  const actor = sp.get('actor'); // 'user' | 'agents' | a specific token id
  const entityType = sp.get('entityType');
  const from = sp.get('from');
  const to = sp.get('to');
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
  }

  const where = {
    userId: auth.userId,
    ...(entityType ? { entityType } : {}),
    ...(actor === 'user'
      ? { actorType: 'USER' as const }
      : actor === 'agents'
        ? { actorType: 'TOKEN' as const }
        : actor
          ? { actorType: 'TOKEN' as const, actorId: actor }
          : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: parseDateToNoonUTC(from) } : {}),
            ...(to ? { lt: parseDateToNoonUTC(addDays(to, 1)) } : {}),
          },
        }
      : {}),
  };

  const rows = await prisma.entryRevision.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Resolve token names for display.
  const tokenIds = [...new Set(page.filter((r) => r.actorType === 'TOKEN').map((r) => r.actorId))];
  const tokens = tokenIds.length
    ? await prisma.apiToken.findMany({ where: { id: { in: tokenIds } }, select: { id: true, name: true } })
    : [];
  const tokenName = new Map(tokens.map((t) => [t.id, t.name]));

  return NextResponse.json({
    revisions: page.map((r) => ({
      ...serializeRevision(r),
      actorName: r.actorType === 'TOKEN' ? (tokenName.get(r.actorId) ?? 'revoked token') : 'you',
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});
