import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';

export const dynamic = 'force-dynamic';

/** GET /api/admin/tokens — names/scopes/last-used only; never token secrets or nutrition data. */
export const GET = apiRoute('adminGetTokens', async (request: NextRequest) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/tokens', admin: true });
  if (error) return error;
  void auth;
  const tokens = await prisma.apiToken.findMany({
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { email: true } } },
  });
  return NextResponse.json({
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      userEmail: t.user.email,
      scopes: t.scopes,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});
