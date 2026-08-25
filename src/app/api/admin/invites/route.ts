import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { hashToken } from '@/lib/apiAuth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const GET = apiRoute('adminGetInvites', async (request: NextRequest) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/invites', admin: true });
  if (error) return error;
  void auth;
  const invites = await prisma.invite.findMany({
    orderBy: { createdAt: 'desc' },
    include: { usedBy: { select: { email: true } } },
  });
  return NextResponse.json({
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      expiresAt: i.expiresAt.toISOString(),
      usedAt: i.usedAt?.toISOString() ?? null,
      usedByEmail: i.usedBy?.email ?? null,
      createdAt: i.createdAt.toISOString(),
      expired: !i.usedAt && i.expiresAt < new Date(),
    })),
  });
});

const postSchema = z.object({
  email: z.string().email().optional(),
});

/** POST — create a single-use invite (7-day expiry, optional email pin). Code shown once. */
export const POST = apiRoute('adminPostInvite', async (request: NextRequest) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/invites', admin: true });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, postSchema);
  if (bodyError) return bodyError;

  const raw = randomBytes(24).toString('base64url');
  const invite = await prisma.invite.create({
    data: {
      tokenHash: hashToken(raw),
      createdById: auth.userId,
      email: body.email?.toLowerCase() ?? null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  logger.info('Invite created', { adminId: auth.userId, inviteId: invite.id });
  return NextResponse.json(
    {
      id: invite.id,
      code: raw,
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
    },
    { status: 201 }
  );
});
