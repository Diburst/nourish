import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { postTokenSchema } from '@/lib/validation';
import { hashToken, ALL_SCOPES } from '@/lib/apiAuth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** GET /api/tokens — the caller's tokens (never the secret). Session only. */
export const GET = apiRoute('getTokens', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/tokens',
    sessionOnly: true,
  });
  if (error) return error;
  const tokens = await prisma.apiToken.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      scopes: t.scopes,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

/** POST /api/tokens — create a token; the secret is shown exactly once. Default scopes: all. */
export const POST = apiRoute('postToken', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/tokens',
    sessionOnly: true,
    write: true,
  });
  if (error) return error;
  if (auth.role === 'ADMIN') {
    return NextResponse.json({ error: 'Admins cannot hold agent tokens' }, { status: 403 });
  }
  const { body, error: bodyError } = await parseBody(request, postTokenSchema);
  if (bodyError) return bodyError;

  const raw = `ntk_${randomBytes(24).toString('hex')}`;
  const token = await prisma.apiToken.create({
    data: {
      userId: auth.userId,
      name: body.name,
      tokenHash: hashToken(raw),
      scopes: body.scopes ?? [...ALL_SCOPES],
    },
  });
  const { recordAuthEvent } = await import('@/lib/authEvents');
  recordAuthEvent('TOKEN_CREATED', request, auth.userId, { name: token.name });
  const { capture } = await import('@/lib/analytics');
  capture('api_token_created', auth.userId);
  const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } });
  if (user) {
    const { sendSecurityNotice } = await import('@/lib/emailFlows');
    sendSecurityNotice(user.email, 'New API token created', `A new agent token named “${token.name}” was just created in your Settings.`);
  }
  logger.info('Token created', { userId: auth.userId, tokenId: token.id });
  return NextResponse.json(
    {
      id: token.id,
      name: token.name,
      scopes: token.scopes,
      token: raw,
      createdAt: token.createdAt.toISOString(),
    },
    { status: 201 }
  );
});
