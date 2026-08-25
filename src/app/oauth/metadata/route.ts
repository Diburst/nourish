import { NextRequest, NextResponse } from 'next/server';
import { publicOrigin, authorizationServerMetadata } from '@/lib/oauthService';

export const dynamic = 'force-dynamic';

/**
 * RFC 8414 authorization-server metadata (also served for the OIDC discovery path).
 * Reached via next.config.js rewrites from /.well-known/oauth-authorization-server
 * and /.well-known/openid-configuration, including their path-suffixed variants.
 */
export async function GET(request: NextRequest) {
  return NextResponse.json(authorizationServerMetadata(publicOrigin(request)), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
