import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createHash } from 'crypto';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/prisma';

export const ALL_SCOPES = [
  'nutrition:read',
  'nutrition:write',
  'targets:write',
  'guidelines:read',
  'guidelines:write',
] as const;
export type Scope = (typeof ALL_SCOPES)[number];

export interface AuthPrincipal {
  userId: string;
  role: 'USER' | 'ADMIN';
  /** null for browser sessions; the ApiToken id for bearer tokens. */
  tokenId: string | null;
  tokenName: string | null;
  /** Sessions implicitly hold every scope. */
  scopes: string[];
  mustChangePassword: boolean;
}

export type AuthResult =
  | { auth: AuthPrincipal; errorResponse: null }
  | { auth: null; errorResponse: NextResponse };

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Authenticate the request: NextAuth session cookie OR `Authorization: Bearer ntk_...`.
 * Discriminated union — check `errorResponse` first (Task Together convention).
 */
export async function requireAuth(_endpoint: string, request?: NextRequest): Promise<AuthResult> {
  const bearer = request?.headers.get('authorization');
  if (bearer?.startsWith('Bearer ')) {
    const raw = bearer.slice(7).trim();
    if (!raw.startsWith('ntk_')) {
      return unauthorized();
    }
    const token = await prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: { select: { id: true, role: true, disabledAt: true, mustChangePassword: true } } },
    });
    if (!token || token.revokedAt || token.user.disabledAt) return unauthorized();
    prisma.apiToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    return {
      auth: {
        userId: token.userId,
        role: token.user.role,
        tokenId: token.id,
        tokenName: token.name,
        scopes: token.scopes,
        mustChangePassword: false,
      },
      errorResponse: null,
    };
  }

  const session = await getServerSession(authOptions);
  const user = session?.user as
    | { id: string; role: 'USER' | 'ADMIN'; mustChangePassword: boolean }
    | undefined;
  if (!user?.id) return unauthorized();
  return {
    auth: {
      userId: user.id,
      role: user.role,
      tokenId: null,
      tokenName: null,
      scopes: [...ALL_SCOPES],
      mustChangePassword: user.mustChangePassword,
    },
    errorResponse: null,
  };
}

function unauthorized(): AuthResult {
  return {
    auth: null,
    errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
}

/** Scope gate. Sessions pass everything; tokens must hold the scope. Returns a 403 response or null. */
export function requireScope(auth: AuthPrincipal, scope: Scope): NextResponse | null {
  if (auth.tokenId === null) return null;
  if (auth.scopes.includes(scope)) return null;
  return NextResponse.json({ error: `Missing scope: ${scope}` }, { status: 403 });
}

/** Session-only endpoints (token management, imports, admin, past-target correction). */
export function requireSession(auth: AuthPrincipal): NextResponse | null {
  if (auth.tokenId !== null) {
    return NextResponse.json({ error: 'This endpoint requires a browser session' }, { status: 403 });
  }
  return null;
}

/** Admin principals hold no nutrition data and may not touch nutrition endpoints. */
export function refuseAdminOnNutrition(auth: AuthPrincipal): NextResponse | null {
  if (auth.role === 'ADMIN') {
    return NextResponse.json({ error: 'Admins cannot access nutrition data' }, { status: 403 });
  }
  return null;
}

/** Admin-only gate. */
export function requireAdmin(auth: AuthPrincipal): NextResponse | null {
  const sessionOnly = requireSession(auth);
  if (sessionOnly) return sessionOnly;
  if (auth.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return null;
}

/** Body-size cap for mutations. Returns a 413 response or null. */
export function checkBodySize(request: NextRequest, maxBytes = 100 * 1024): NextResponse | null {
  const len = request.headers.get('content-length');
  if (len && Number(len) > maxBytes) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }
  return null;
}

export function actorOf(auth: AuthPrincipal): { actorType: 'USER' | 'TOKEN'; actorId: string; source: 'USER' | 'TOKEN' } {
  return auth.tokenId
    ? { actorType: 'TOKEN', actorId: auth.tokenId, source: 'TOKEN' }
    : { actorType: 'USER', actorId: auth.userId, source: 'USER' };
}
