import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { passwordSchema } from '@/lib/validation';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    disabled: z.boolean().optional(),
    tempPassword: passwordSchema.optional(),
    forceLogout: z.literal(true).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

/** PATCH /api/admin/users/{id} — enable/disable, set temp password, force logout. */
export const PATCH = apiRoute('adminPatchUser', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/users/[id]', admin: true });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, patchSchema);
  if (bodyError) return bodyError;

  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) return notFound('User not found');
  if (user.id === auth.userId && body.disabled === true) {
    return NextResponse.json({ error: 'You cannot disable your own account' }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(body.disabled !== undefined ? { disabledAt: body.disabled ? new Date() : null } : {}),
      ...(body.tempPassword !== undefined
        ? { passwordHash: await bcrypt.hash(body.tempPassword, 12), mustChangePassword: true }
        : {}),
      ...(body.forceLogout || body.disabled ? { sessionVersion: { increment: 1 } } : {}),
    },
  });
  logger.info('Admin updated user', {
    adminId: auth.userId,
    userId: user.id,
    disabled: body.disabled,
    tempPassword: body.tempPassword !== undefined,
    forceLogout: body.forceLogout === true,
  });
  return NextResponse.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    mustChangePassword: updated.mustChangePassword,
    disabledAt: updated.disabledAt?.toISOString() ?? null,
  });
});
