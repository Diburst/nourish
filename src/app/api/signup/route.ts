import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { apiRoute, parseBody } from '@/lib/route';
import { signupSchema } from '@/lib/validation';
import { hashToken } from '@/lib/apiAuth';
import { applyRateLimit } from '@/lib/rateLimit';
import { seedUserDefaults } from '@/lib/seedDefaults';
import { isValidTimezone } from '@/lib/dates';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const POST = apiRoute('signup', async (request: NextRequest) => {
  const rl = await applyRateLimit(request, '/api/signup', 'auth');
  if (rl) return rl;

  const { body, error } = await parseBody(request, signupSchema);
  if (error) return error;

  const timezone = isValidTimezone(body.timezone) ? body.timezone : 'UTC';
  const email = body.email.toLowerCase().trim();

  const invite = await prisma.invite.findUnique({ where: { tokenHash: hashToken(body.invite) } });
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 });
  }
  if (invite.email && invite.email.toLowerCase() !== email) {
    return NextResponse.json({ error: 'This invite is pinned to a different email address' }, { status: 400 });
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
  }

  const { emailEnabled } = await import('@/lib/email');
  const requiresVerification = emailEnabled();

  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash,
        name: body.name,
        timezone,
        // With no email service configured (self-host default), the invite already
        // pinned identity — stamp verified so behavior is unchanged.
        emailVerifiedAt: requiresVerification ? null : new Date(),
      },
    });
    await seedUserDefaults(tx, created.id);
    await tx.invite.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), usedById: created.id },
    });
    return created;
  });

  const { recordAuthEvent } = await import('@/lib/authEvents');
  recordAuthEvent('SIGNUP', request, user.id);
  const { capture } = await import('@/lib/analytics');
  capture('user_signed_up', user.id, { verificationRequired: requiresVerification });

  if (requiresVerification) {
    const { sendVerificationEmail } = await import('@/lib/emailFlows');
    await sendVerificationEmail(user).catch(() => {});
  }

  logger.info('User signed up', { userId: user.id, requiresVerification });
  return NextResponse.json(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      timezone: user.timezone,
      requiresVerification,
    },
    { status: 201 }
  );
});
