import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, notFound } from '@/lib/route';

export const dynamic = 'force-dynamic';

/** DELETE — revoke an unused invite. */
export const DELETE = apiRoute('adminDeleteInvite', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/invites/[id]', admin: true });
  if (error) return error;
  void auth;
  const invite = await prisma.invite.findUnique({ where: { id: params.id } });
  if (!invite) return notFound('Invite not found');
  if (invite.usedAt) {
    return NextResponse.json({ error: 'Invite has already been used' }, { status: 409 });
  }
  await prisma.invite.delete({ where: { id: invite.id } });
  return new NextResponse(null, { status: 204 });
});
