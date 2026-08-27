import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { emailEnabled } from '@/lib/email';
import { sendEmailChangeEmail, sendSecurityNotice } from '@/lib/emailFlows';
import { recordAuthEvent } from '@/lib/authEvents';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({
  newEmail: z.string().email().max(200),
  currentPassword: z.string().min(1),
});

/**
 * POST /api/me/email — change the account email. With email configured, a
 * confirmation link goes to the NEW address and nothing changes until it's clicked;
 * without email (self-host), the change applies immediately (password-gated).
 */
export const POST = apiRoute('changeEmail', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/me/email',
    sessionOnly: true,
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, schema);
  if (bodyError) return bodyError;

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });

  const newEmail = body.newEmail.toLowerCase().trim();
  if (newEmail === user.email) {
    return NextResponse.json({ error: 'That is already your email address' }, { status: 400 });
  }
  const taken = await prisma.user.findUnique({ where: { email: newEmail } });
  if (taken) return NextResponse.json({ error: 'That email address is already in use' }, { status: 409 });

  if (emailEnabled()) {
    await sendEmailChangeEmail(user, newEmail);
    recordAuthEvent('EMAIL_CHANGE_REQUESTED', request, user.id);
    sendSecurityNotice(user.email, 'Email change requested', `A request was made to move this account to ${newEmail}.`);
    return NextResponse.json({ ok: true, pending: true, message: `Confirmation sent to ${newEmail}.` });
  }

  await prisma.user.update({ where: { id: user.id }, data: { email: newEmail } });
  recordAuthEvent('EMAIL_CHANGED', request, user.id, { newEmail });
  logger.info('Email changed (direct)', { userId: user.id });
  return NextResponse.json({ ok: true, pending: false, email: newEmail });
});
