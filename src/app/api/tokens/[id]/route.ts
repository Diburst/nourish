import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, notFound } from '@/lib/route';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** DELETE /api/tokens/{id} — revoke (tokens are revoke-only, never edited). Session only. */
export const DELETE = apiRoute('revokeToken', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/tokens/[id]',
    sessionOnly: true,
    write: true,
  });
  if (error) return error;

  const token = await prisma.apiToken.findFirst({ where: { id: params.id, userId: auth.userId } });
  if (!token) return notFound('Token not found');
  if (!token.revokedAt) {
    await prisma.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    logger.info('Token revoked', { userId: auth.userId, tokenId: token.id });
  }
  return new NextResponse(null, { status: 204 });
});
