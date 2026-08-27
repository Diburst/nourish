import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type AuthEventType =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'LOGIN_LOCKOUT'
  | 'SIGNUP'
  | 'EMAIL_VERIFIED'
  | 'EMAIL_CHANGE_REQUESTED'
  | 'EMAIL_CHANGED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET'
  | 'TOKEN_CREATED'
  | 'TOKEN_REVOKED'
  | 'OAUTH_GRANT'
  | 'SESSIONS_INVALIDATED'
  | 'ADMIN_ACTION';

/**
 * Fire-and-forget append to the auth audit trail. `meta` is small, non-sensitive
 * context (a token name, an admin action verb) — never credentials or nutrition.
 */
export function recordAuthEvent(
  type: AuthEventType,
  request: NextRequest | null,
  userId?: string | null,
  meta?: Record<string, string | number | boolean>
): void {
  const ip = request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  prisma.authEvent
    .create({
      data: {
        type,
        ip,
        userId: userId ?? null,
        meta: meta ? (meta as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    })
    .catch(() => {});
}
