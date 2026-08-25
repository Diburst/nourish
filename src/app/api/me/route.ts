import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';
import { parseBody } from '@/lib/route';
import { isValidTimezone } from '@/lib/dates';
import { nameString } from '@/lib/validation';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function serializeUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  timezone: string;
  weightUnit: string;
  energyUnit: string;
  mustChangePassword: boolean;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    timezone: u.timezone,
    weightUnit: u.weightUnit,
    energyUnit: u.energyUnit,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt.toISOString(),
    // Where agents reach the MCP endpoint from outside (e.g. a Tailscale Funnel URL).
    // Set MCP_PUBLIC_URL when the public origin differs from the app's own.
    mcpPublicUrl: process.env.MCP_PUBLIC_URL || null,
  };
}

export const GET = apiRoute('getMe', async (request: NextRequest) => {
  const { auth, error } = await guard(request, { endpoint: '/api/me' });
  if (error) return error;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(serializeUser(user));
});

const patchMeSchema = z.object({
  name: nameString.optional(),
  timezone: z.string().max(64).optional(),
  weightUnit: z.enum(['LB', 'KG']).optional(),
  energyUnit: z.enum(['KCAL', 'KJ']).optional(),
});

export const PATCH = apiRoute('patchMe', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/me',
    sessionOnly: true,
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, patchMeSchema);
  if (bodyError) return bodyError;
  if (body.timezone !== undefined && !isValidTimezone(body.timezone)) {
    return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
  }
  const user = await prisma.user.update({
    where: { id: auth.userId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.weightUnit !== undefined ? { weightUnit: body.weightUnit } : {}),
      ...(body.energyUnit !== undefined ? { energyUnit: body.energyUnit } : {}),
    },
  });
  return NextResponse.json(serializeUser(user));
});

/** DELETE /api/me — delete the account and everything under it. Session only. */
export const DELETE = apiRoute('deleteMe', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/me',
    sessionOnly: true,
    write: true,
  });
  if (error) return error;
  if (auth.role === 'ADMIN') {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', disabledAt: null } });
    if (admins <= 1) {
      return NextResponse.json({ error: 'The last admin account cannot be deleted' }, { status: 400 });
    }
  }
  await prisma.user.delete({ where: { id: auth.userId } });
  logger.info('Account deleted', { userId: auth.userId });
  return new NextResponse(null, { status: 204 });
});
