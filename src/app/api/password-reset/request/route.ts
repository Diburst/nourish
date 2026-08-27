import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiRoute, parseBody } from '@/lib/route';
import { applyRateLimit } from '@/lib/rateLimit';
import { emailEnabled } from '@/lib/email';
import { sendPasswordResetEmail } from '@/lib/emailFlows';
import { recordAuthEvent } from '@/lib/authEvents';
import { capture } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().email().max(200) });

/**
 * POST /api/password-reset/request — always answers 200 so account existence is
 * never leaked; the email (when the account exists and email is configured) carries
 * the single-use reset link.
 */
export const POST = apiRoute('passwordResetRequest', async (request: NextRequest) => {
  const rl = await applyRateLimit(request, '/api/password-reset/request', 'auth');
  if (rl) return rl;
  const { body, error } = await parseBody(request, schema);
  if (error) return error;

  const emailConfigured = emailEnabled();
  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase().trim() } });
  if (user && !user.disabledAt && emailConfigured) {
    await sendPasswordResetEmail(user).catch(() => {});
    recordAuthEvent('PASSWORD_RESET_REQUESTED', request, user.id);
    capture('password_reset_requested', user.id);
  }
  return NextResponse.json({
    ok: true,
    emailConfigured,
    message: emailConfigured
      ? 'If that address has an account, a reset link is on its way.'
      : 'Email is not configured on this server — ask your admin to set a temporary password.',
  });
});
