import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/** GET /api/admin/auth-events — the auth audit trail, newest first. Account metadata only. */
export const GET = apiRoute('adminGetAuthEvents', async (request: NextRequest) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/auth-events', admin: true });
  if (error) return error;
  void auth;

  const cursor = request.nextUrl.searchParams.get('cursor');
  const rows = await prisma.authEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const userIds = [...new Set(page.map((r) => r.userId).filter((u): u is string => !!u))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return NextResponse.json({
    events: page.map((r) => ({
      id: r.id,
      type: r.type,
      ip: r.ip,
      userEmail: r.userId ? (emailById.get(r.userId) ?? 'deleted account') : null,
      meta: r.meta,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});
