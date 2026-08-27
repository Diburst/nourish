import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { passwordSchema } from '@/lib/validation';
import { applyRateLimit } from '@/lib/rateLimit';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

/** POST /api/me/password — change password (also clears mustChangePassword). Session only. */
export const POST = apiRoute('changePassword', async (request: NextRequest) => {
  const rl = await applyRateLimit(request, '/api/me/password', 'auth');
  if (rl) return rl;
  const { auth, error } = await guard(request, {
    endpoint: '/api/me/password',
    sessionOnly: true,
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, schema);
  if (bodyError) return bodyError;

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(body.newPassword, 12),
      mustChangePassword: false,
    },
  });
  const { recordAuthEvent } = await import('@/lib/authEvents');
  recordAuthEvent('PASSWORD_CHANGED', request, user.id);
  const { sendSecurityNotice } = await import('@/lib/emailFlows');
  sendSecurityNotice(user.email, 'Password changed', 'Your Nourish password was just changed from Settings.');
  logger.info('Password changed', { userId: user.id });
  return NextResponse.json({ ok: true });
});
