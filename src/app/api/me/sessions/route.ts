import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** POST /api/me/sessions — sign out everywhere (bumps sessionVersion; all JWTs invalidate). */
export const POST = apiRoute('signOutEverywhere', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/me/sessions',
    sessionOnly: true,
    write: true,
  });
  if (error) return error;
  await prisma.user.update({
    where: { id: auth.userId },
    data: { sessionVersion: { increment: 1 } },
  });
  logger.info('Sessions invalidated', { userId: auth.userId });
  return NextResponse.json({ ok: true });
});
