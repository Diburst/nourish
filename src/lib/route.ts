import { NextRequest, NextResponse } from 'next/server';
import { z, ZodTypeAny } from 'zod';
import { logger } from '@/lib/logger';
import {
  requireAuth,
  requireScope,
  refuseAdminOnNutrition,
  requireAdmin,
  requireSession,
  checkBodySize,
  AuthPrincipal,
  Scope,
} from '@/lib/apiAuth';
import { applyRateLimit } from '@/lib/rateLimit';
import { zodErrorMessage } from '@/lib/validation';

type Params = Record<string, string>;
type Handler = (req: NextRequest, ctx: { params: Params }) => Promise<NextResponse>;

/** Top-level try/catch: log the detail, return a generic 500. */
export function apiRoute(operation: string, handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      logger.error('Database error', {
        operation,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}

export async function parseBody<S extends ZodTypeAny>(
  req: NextRequest,
  schema: S
): Promise<{ body: z.infer<S>; error: null } | { body: null; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { body: null, error: NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    logger.warn('Validation failed', { reason: zodErrorMessage(parsed.error) });
    return {
      body: null,
      error: NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 }),
    };
  }
  return { body: parsed.data, error: null };
}

interface GuardOptions {
  endpoint: string;
  scope?: Scope;
  nutrition?: boolean; // refuse ADMIN principals
  sessionOnly?: boolean;
  admin?: boolean;
  write?: boolean; // mutation: body-size cap + agent-write rate limit
  bodyBytes?: number;
}

/**
 * Standard gate: body size → auth → role/scope → rate limit.
 * Returns either the principal or a ready error response.
 */
export async function guard(
  req: NextRequest,
  opts: GuardOptions
): Promise<{ auth: AuthPrincipal; error: null } | { auth: null; error: NextResponse }> {
  if (opts.write) {
    const tooBig = checkBodySize(req, opts.bodyBytes ?? 100 * 1024);
    if (tooBig) return { auth: null, error: tooBig };
  }
  const { auth, errorResponse } = await requireAuth(opts.endpoint, req);
  if (errorResponse) return { auth: null, error: errorResponse };

  if (opts.admin) {
    const err = requireAdmin(auth);
    if (err) return { auth: null, error: err };
    const rl = await applyRateLimit(req, opts.endpoint, 'admin', auth.userId);
    if (rl) return { auth: null, error: rl };
    return { auth, error: null };
  }

  if (opts.sessionOnly) {
    const err = requireSession(auth);
    if (err) return { auth: null, error: err };
  }
  if (opts.nutrition) {
    const err = refuseAdminOnNutrition(auth);
    if (err) return { auth: null, error: err };
  }
  if (opts.scope) {
    const err = requireScope(auth, opts.scope);
    if (err) return { auth: null, error: err };
  }
  const type = opts.write ? 'agentWrite' : 'read';
  const rl = await applyRateLimit(req, opts.endpoint, type, auth.tokenId ?? auth.userId);
  if (rl) return { auth: null, error: rl };
  return { auth, error: null };
}

export function notFound(what = 'Not found'): NextResponse {
  return NextResponse.json({ error: what }, { status: 404 });
}
