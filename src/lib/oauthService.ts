/**
 * Helpers for the OAuth 2.1 shim. The design in one paragraph: Claude's custom
 * connector flow refuses servers with no OAuth, so Nourish speaks just enough of it —
 * dynamic client registration, an authorize page where the user pastes their ntk_
 * API token as consent, and a PKCE-checked code exchange whose access token IS that
 * ntk_ token. Authorization stays exactly where it always was: the ApiToken's scopes.
 */
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { NextRequest } from 'next/server';

export function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE S256: base64url(sha256(verifier)) must equal the stored challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  return b64url(createHash('sha256').update(verifier).digest()) === challenge;
}

// ---- token wrapping (AES-256-GCM keyed from NEXTAUTH_SECRET) ----
// The raw ntk_ token is never stored in clear: authorize wraps it, the token
// endpoint unwraps it to hand it to the client, and MCP auth still only ever
// compares SHA-256 hashes.

function encKey(): Buffer {
  return createHash('sha256').update(`${process.env.NEXTAUTH_SECRET}:oauth-wrap`).digest();
}

export function wrapToken(raw: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

export function unwrapToken(enc: string): string | null {
  try {
    const [iv, tag, ct] = enc.split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', encKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * The public origin OAuth metadata should advertise. Prefer MCP_PUBLIC_URL's origin
 * (the Funnel address); otherwise reconstruct from forwarded headers.
 */
export function publicOrigin(request: NextRequest): string {
  const configured = process.env.MCP_PUBLIC_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to headers
    }
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost:3000';
  const proto =
    request.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['nutrition:read', 'nutrition:write', 'targets:write', 'guidelines:read', 'guidelines:write'],
    service_documentation: `${origin}`,
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['nutrition:read', 'nutrition:write', 'targets:write', 'guidelines:read', 'guidelines:write'],
    resource_documentation: origin,
  };
}

const REDIRECT_SCHEMES = ['https:', 'http:'];

/** Accept https URIs anywhere, http only for loopback (RFC 8252 §7.3). */
export function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (!REDIRECT_SCHEMES.includes(u.protocol)) return false;
    if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
