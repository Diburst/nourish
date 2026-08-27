import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { apiRoute, parseBody } from '@/lib/route';
import { applyRateLimit } from '@/lib/rateLimit';
import { passwordSchema } from '@/lib/validation';
import { findEmailToken, sendSecurityNotice } from '@/lib/emailFlows';
import { recordAuthEvent } from '@/lib/authEvents';
import { capture } from '@/lib/analytics';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().min(10).max(200),
  newPassword: passwordSchema,
});

/** POST /api/password-reset/confirm — consume the reset token, set the new password,
 *  and sign the account out everywhere. */
export const POST = apiRoute('passwordResetConfirm', async (request: NextRequest) => {
  const rl = await applyRateLimit(request, '/api/password-reset/confirm', 'auth');
  if (rl) return rl;
  const { body, error } = await parseBody(request, schema);
  if (error) return error;

  const token = await findEmailToken(body.token, 'RESET');
  if (!token) {
    return NextResponse.json({ error: 'This reset link is invalid or has expired' }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: token.userId },
      data: {
        passwordHash: await bcrypt.hash(body.newPassword, 12),
        mustChangePassword: false,
        // A reset proves inbox control — count it as verification too.
        emailVerifiedAt: new Date(),
        sessionVersion: { increment: 1 },
      },
    }),
    prisma.emailToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
  ]);
  recordAuthEvent('PASSWORD_RESET', request, token.userId);
  capture('password_reset_completed', token.userId);
  sendSecurityNotice(token.user.email, 'Password was reset', 'Your password was just reset through the email link, and all sessions were signed out.');
  logger.info('Password reset', { userId: token.userId });
  return NextResponse.json({ ok: true });
});
