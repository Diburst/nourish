import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** DELETE — admin may revoke any token. */
export const DELETE = apiRoute('adminRevokeToken', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/tokens/[id]', admin: true });
  if (error) return error;
  const token = await prisma.apiToken.findUnique({ where: { id: params.id } });
  if (!token) return notFound('Token not found');
  if (!token.revokedAt) {
    await prisma.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    logger.info('Admin revoked token', { adminId: auth.userId, tokenId: token.id });
  }
  return new NextResponse(null, { status: 204 });
});

const patchSchema = z.object({ removeGuidelinesWrite: z.literal(true) });

/** PATCH — admin may remove guidelines:write from any token. */
export const PATCH = apiRoute('adminPatchToken', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/tokens/[id]', admin: true });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, patchSchema);
  if (bodyError) return bodyError;
  void body;

  const token = await prisma.apiToken.findUnique({ where: { id: params.id } });
  if (!token) return notFound('Token not found');
  const updated = await prisma.apiToken.update({
    where: { id: token.id },
    data: { scopes: token.scopes.filter((s) => s !== 'guidelines:write') },
  });
  logger.info('Admin removed guidelines:write', { adminId: auth.userId, tokenId: token.id });
  return NextResponse.json({ id: updated.id, name: updated.name, scopes: updated.scopes });
});
