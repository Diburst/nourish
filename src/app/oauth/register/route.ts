import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiRoute, parseBody } from '@/lib/route';
import { applyRateLimit } from '@/lib/rateLimit';
import { validRedirectUri } from '@/lib/oauthService';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().max(200).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().max(500).optional(),
});

/**
 * RFC 7591 dynamic client registration. Open by design: registering a client grants
 * nothing — every grant still requires a user to paste a valid ntk_ token on the
 * authorize page, and the resulting credential is that token, scopes and all.
 */
export const POST = apiRoute('oauthRegister', async (request: NextRequest) => {
  const rl = await applyRateLimit(request, '/oauth/register', 'auth');
  if (rl) return rl;

  const { body, error } = await parseBody(request, registerSchema);
  if (error) return error;

  const bad = body.redirect_uris.filter((u) => !validRedirectUri(u));
  if (bad.length > 0) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri', error_description: `Rejected redirect_uris: ${bad.join(', ')}` },
      { status: 400 }
    );
  }

  const client = await prisma.oAuthClient.create({
    data: { name: body.client_name ?? 'MCP client', redirectUris: body.redirect_uris },
  });
  logger.info('OAuth client registered', { clientId: client.id, name: client.name });

  return NextResponse.json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    { status: 201 }
  );
});
