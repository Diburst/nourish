import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';

export const dynamic = 'force-dynamic';

/** GET /api/admin/health — DB latency + instance counts (no nutrition data). */
export const GET = apiRoute('adminGetHealth', async (request: NextRequest) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/health', admin: true });
  if (error) return error;
  void auth;
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbLatencyMs = Date.now() - started;
  const [users, tokens, invites] = await Promise.all([
    prisma.user.count(),
    prisma.apiToken.count({ where: { revokedAt: null } }),
    prisma.invite.count({ where: { usedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return NextResponse.json({
    status: 'ok',
    dbLatencyMs,
    counts: { users, activeTokens: tokens, openInvites: invites },
    uptimeSeconds: Math.floor(process.uptime()),
    version: process.env.npm_package_version ?? '1.0.0',
  });
});
