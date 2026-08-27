import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiRoute, parseBody } from '@/lib/route';
import { applyRateLimit } from '@/lib/rateLimit';
import { findEmailToken } from '@/lib/emailFlows';
import { recordAuthEvent } from '@/lib/authEvents';
import { capture } from '@/lib/analytics';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().min(10).max(200),
  kind: z.enum(['verify', 'change']).default('verify'),
});

/**
 * POST /api/verify-email — consume a VERIFY token (activates the account) or an
 * EMAIL_CHANGE token (moves the account to the confirmed new address). Public:
 * possession of the emailed token is the authentication.
 */
export const POST = apiRoute('verifyEmail', async (request: NextRequest) => {
  const rl = await applyRateLimit(request, '/api/verify-email', 'auth');
  if (rl) return rl;
  const { body, error } = await parseBody(request, schema);
  if (error) return error;

  if (body.kind === 'verify') {
    const token = await findEmailToken(body.token, 'VERIFY');
    if (!token) {
      return NextResponse.json({ error: 'This verification link is invalid or has expired' }, { status: 400 });
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } }),
      prisma.emailToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
    ]);
    recordAuthEvent('EMAIL_VERIFIED', request, token.userId);
    capture('email_verified', token.userId);
    logger.info('Email verified', { userId: token.userId });
    return NextResponse.json({ ok: true, action: 'verified' });
  }

  const token = await findEmailToken(body.token, 'EMAIL_CHANGE');
  if (!token || !token.newEmail) {
    return NextResponse.json({ error: 'This confirmation link is invalid or has expired' }, { status: 400 });
  }
  const taken = await prisma.user.findUnique({ where: { email: token.newEmail } });
  if (taken && taken.id !== token.userId) {
    return NextResponse.json({ error: 'That email address is already in use' }, { status: 409 });
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: token.userId },
      data: { email: token.newEmail, emailVerifiedAt: new Date() },
    }),
    prisma.emailToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
  ]);
  recordAuthEvent('EMAIL_CHANGED', request, token.userId, { newEmail: token.newEmail });
  logger.info('Email changed', { userId: token.userId });
  return NextResponse.json({ ok: true, action: 'changed', email: token.newEmail });
});
