import { NextRequest, NextResponse } from 'next/server';
import { publicOrigin, protectedResourceMetadata } from '@/lib/oauthService';

export const dynamic = 'force-dynamic';

/**
 * RFC 9728 protected-resource metadata. Reached via next.config.js rewrites from
 * /.well-known/oauth-protected-resource and its path-suffixed variants
 * (clients probe /.well-known/oauth-protected-resource/api/mcp too).
 */
export async function GET(request: NextRequest) {
  return NextResponse.json(protectedResourceMetadata(publicOrigin(request)), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
