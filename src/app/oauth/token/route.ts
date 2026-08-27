import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { apiRoute } from '@/lib/route';
import { applyRateLimit } from '@/lib/rateLimit';
import { sha256hex, pkceMatches, wrapToken, unwrapToken } from '@/lib/oauthService';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function oauthError(error: string, description: string, status = 400): NextResponse {
  return NextResponse.json({ error, error_description: description }, { status });
}

function tokenResponse(raw: string, refreshToken: string, scope: string | null): NextResponse {
  return NextResponse.json(
    {
      access_token: raw,
      token_type: 'Bearer',
      // The ntk_ token itself never expires (revoke-only); a nominal expiry keeps
      // clients refreshing through the grant so revocation is noticed promptly.
      expires_in: 7 * 24 * 60 * 60,
      refresh_token: refreshToken,
      ...(scope ? { scope } : {}),
    },
    { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }
  );
}

/**
 * RFC 6749 token endpoint (form-encoded). authorization_code exchanges a consent
 * code (PKCE S256 enforced) for the user's ntk_ token as the Bearer credential;
 * refresh_token re-issues it with a rotated refresh token.
 */
export const POST = apiRoute('oauthToken', async (request: NextRequest) => {
  const rl = await applyRateLimit(request, '/oauth/token', 'auth');
  if (rl) return rl;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return oauthError('invalid_request', 'Expected application/x-www-form-urlencoded body');
  }
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v : '';
  };
  const grantType = get('grant_type');

  if (grantType === 'authorization_code') {
    const code = get('code');
    const verifier = get('code_verifier');
    const clientId = get('client_id');
    const redirectUri = get('redirect_uri');
    if (!code || !verifier) return oauthError('invalid_request', 'code and code_verifier are required');

    const row = await prisma.oAuthCode.findUnique({ where: { codeHash: sha256hex(code) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      return oauthError('invalid_grant', 'Authorization code is invalid, used, or expired');
    }
    if (clientId && clientId !== row.clientId) return oauthError('invalid_grant', 'client_id mismatch');
    if (redirectUri && redirectUri !== row.redirectUri) return oauthError('invalid_grant', 'redirect_uri mismatch');
    if (!pkceMatches(verifier, row.codeChallenge)) return oauthError('invalid_grant', 'PKCE verification failed');

    const raw = unwrapToken(row.encToken);
    if (!raw) return oauthError('invalid_grant', 'Stored grant could not be decrypted; authorize again');

    const refreshToken = `nrt_${randomBytes(32).toString('base64url')}`;
    await prisma.$transaction([
      prisma.oAuthCode.update({ where: { id: row.id }, data: { usedAt: new Date(), encToken: '' } }),
      prisma.oAuthGrant.create({
        data: {
          refreshHash: sha256hex(refreshToken),
          clientId: row.clientId,
          tokenId: row.tokenId,
          encToken: wrapToken(raw),
          scope: row.scope,
        },
      }),
    ]);
    const apiToken = await prisma.apiToken.findUnique({
      where: { id: row.tokenId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (apiToken) {
      const { recordAuthEvent } = await import('@/lib/authEvents');
      recordAuthEvent('OAUTH_GRANT', request, apiToken.user.id, { token: apiToken.name });
      const { capture } = await import('@/lib/analytics');
      capture('oauth_grant_created', apiToken.user.id);
      const { sendSecurityNotice } = await import('@/lib/emailFlows');
      sendSecurityNotice(
        apiToken.user.email,
        'New agent connection authorized',
        `An agent just completed the connect flow using your “${apiToken.name}” token.`
      );
    }
    logger.info('OAuth code exchanged', { clientId: row.clientId, tokenId: row.tokenId });
    return tokenResponse(raw, refreshToken, row.scope);
  }

  if (grantType === 'refresh_token') {
    const presented = get('refresh_token');
    if (!presented) return oauthError('invalid_request', 'refresh_token is required');
    const grant = await prisma.oAuthGrant.findUnique({ where: { refreshHash: sha256hex(presented) } });
    if (!grant || grant.revokedAt) return oauthError('invalid_grant', 'Refresh token is invalid or revoked');

    // Refuse refresh once the underlying ApiToken is gone/revoked — this is how
    // revocation in Settings propagates to connected OAuth clients.
    const apiToken = await prisma.apiToken.findUnique({
      where: { id: grant.tokenId },
      include: { user: { select: { disabledAt: true } } },
    });
    if (!apiToken || apiToken.revokedAt || apiToken.user.disabledAt) {
      await prisma.oAuthGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } }).catch(() => {});
      return oauthError('invalid_grant', 'The underlying API token was revoked');
    }

    const raw = unwrapToken(grant.encToken);
    if (!raw) return oauthError('invalid_grant', 'Stored grant could not be decrypted; authorize again');

    const rotated = `nrt_${randomBytes(32).toString('base64url')}`;
    await prisma.oAuthGrant.update({
      where: { id: grant.id },
      data: { refreshHash: sha256hex(rotated), lastUsedAt: new Date() },
    });
    return tokenResponse(raw, rotated, grant.scope);
  }

  return oauthError('unsupported_grant_type', `Unsupported grant_type: ${grantType || '(none)'}`);
});
