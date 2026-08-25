import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';

export const dynamic = 'force-dynamic';

/** GET /api/admin/users — account metadata only; never nutrition data. */
export const GET = apiRoute('adminGetUsers', async (request: NextRequest) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/users', admin: true });
  if (error) return error;
  void auth;
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      timezone: true,
      mustChangePassword: true,
      disabledAt: true,
      createdAt: true,
      _count: { select: { tokens: true } },
    },
  });
  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      timezone: u.timezone,
      mustChangePassword: u.mustChangePassword,
      disabledAt: u.disabledAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      tokenCount: u._count.tokens,
    })),
  });
});
