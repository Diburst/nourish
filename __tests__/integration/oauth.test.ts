import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { resetDb, createUser, createToken, call } from './helpers';
import { GET as metadata } from '@/app/oauth/metadata/route';
import { GET as protectedResource } from '@/app/oauth/protected-resource/route';
import { POST as register } from '@/app/oauth/register/route';
import { GET as authorizeGet, POST as authorizeSubmit } from '@/app/oauth/authorize/route';
import { POST as tokenEndpoint } from '@/app/oauth/token/route';
import { POST as mcpPost } from '@/app/api/mcp/route';

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let ntk: string;
let clientId: string;
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());

async function postForm(handler: typeof authorizeSubmit, url: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  const req = new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': `10.9.0.${Math.floor(Math.random() * 250) + 1}`,
    },
    body,
  });
  const res = await handler(req, { params: {} });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

beforeAll(async () => {
  await resetDb();
  process.env.MCP_PUBLIC_URL = 'https://nourish.example.ts.net/api/mcp';
  const user = await createUser();
  ntk = (await createToken(user.id, undefined, 'Phone via OAuth')).raw;
});

describe('discovery metadata', () => {
  it('authorization-server metadata advertises the shim endpoints', async () => {
    const res = await call(metadata, 'GET', '/oauth/metadata');
    expect(res.status).toBe(200);
    const body = res.json as Record<string, unknown>;
    expect(body.issuer).toBe('https://nourish.example.ts.net');
    expect(body.authorization_endpoint).toBe('https://nourish.example.ts.net/oauth/authorize');
    expect(body.token_endpoint).toBe('https://nourish.example.ts.net/oauth/token');
    expect(body.registration_endpoint).toBe('https://nourish.example.ts.net/oauth/register');
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('protected-resource metadata points at the MCP resource and this AS', async () => {
    const res = await call(protectedResource, 'GET', '/oauth/protected-resource');
    const body = res.json as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe('https://nourish.example.ts.net/api/mcp');
    expect(body.authorization_servers).toEqual(['https://nourish.example.ts.net']);
  });

  it('unauthenticated MCP 401s carry the RFC 9728 pointer', async () => {
    const res = await call(mcpPost, 'POST', '/api/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(res.status).toBe(401);
  });
});

describe('dynamic client registration', () => {
  it('registers a public client', async () => {
    const res = await call(register, 'POST', '/oauth/register', {
      body: { redirect_uris: [REDIRECT], client_name: 'Claude' },
    });
    expect(res.status).toBe(201);
    const body = res.json as { client_id: string; token_endpoint_auth_method: string };
    expect(body.client_id).toBeTruthy();
    expect(body.token_endpoint_auth_method).toBe('none');
    clientId = body.client_id;
  });

  it('rejects non-loopback http redirect URIs', async () => {
    const res = await call(register, 'POST', '/oauth/register', {
      body: { redirect_uris: ['http://evil.example.com/cb'] },
    });
    expect(res.status).toBe(400);
  });
});

describe('authorize + token exchange', () => {
  const authQuery = () =>
    `client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&state=xyz&code_challenge=${challenge}&code_challenge_method=S256`;

  it('GET renders the consent form for a valid client', async () => {
    const res = await call(authorizeGet, 'GET', `/oauth/authorize?${authQuery()}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Connect to Nourish');
    expect(res.text).toContain('name="token"');
  });

  it('GET dead-ends (no redirect) on an unknown client', async () => {
    const res = await call(authorizeGet, 'GET', `/oauth/authorize?client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}`);
    expect(res.status).toBe(400);
  });

  it('POST with a bad token re-renders the form with an error', async () => {
    const res = await postForm(authorizeSubmit, '/oauth/authorize', {
      client_id: clientId,
      redirect_uri: REDIRECT,
      state: 'xyz',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      response_type: 'code',
      token: 'ntk_wrong',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('not valid');
  });

  let code: string;

  it('POST with a valid ntk_ token redirects back with a code and the state', async () => {
    const res = await postForm(authorizeSubmit, '/oauth/authorize', {
      client_id: clientId,
      redirect_uri: REDIRECT,
      state: 'xyz',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      response_type: 'code',
      token: ntk,
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('xyz');
    code = location.searchParams.get('code')!;
    expect(code).toBeTruthy();
  });

  it('token exchange fails with a wrong PKCE verifier', async () => {
    const res = await postForm(tokenEndpoint, '/oauth/token', {
      grant_type: 'authorization_code',
      code,
      code_verifier: 'not-the-verifier',
      client_id: clientId,
      redirect_uri: REDIRECT,
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text).error).toBe('invalid_grant');
  });

  let refreshToken: string;

  it('token exchange returns the ntk_ token as the Bearer credential', async () => {
    // Re-run consent (the failed PKCE attempt above did not consume the code, but be explicit).
    const consent = await postForm(authorizeSubmit, '/oauth/authorize', {
      client_id: clientId,
      redirect_uri: REDIRECT,
      state: 's2',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      response_type: 'code',
      token: ntk,
    });
    const freshCode = new URL(consent.headers.get('location')!).searchParams.get('code')!;

    const res = await postForm(tokenEndpoint, '/oauth/token', {
      grant_type: 'authorization_code',
      code: freshCode,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { access_token: string; token_type: string; refresh_token: string };
    expect(body.access_token).toBe(ntk);
    expect(body.token_type).toBe('Bearer');
    refreshToken = body.refresh_token;

    // The code is single-use now.
    const replay = await postForm(tokenEndpoint, '/oauth/token', {
      grant_type: 'authorization_code',
      code: freshCode,
      code_verifier: verifier,
    });
    expect(replay.status).toBe(400);

    // And the issued credential actually works against MCP.
    const mcp = await call(mcpPost, 'POST', '/api/mcp', {
      token: body.access_token,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.status).toBe(200);
  });

  it('refresh rotates the refresh token and re-issues the credential', async () => {
    const res = await postForm(tokenEndpoint, '/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { access_token: string; refresh_token: string };
    expect(body.access_token).toBe(ntk);
    expect(body.refresh_token).not.toBe(refreshToken);

    // The old refresh token is dead after rotation.
    const stale = await postForm(tokenEndpoint, '/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    expect(stale.status).toBe(400);
    refreshToken = body.refresh_token;
  });

  it('revoking the ApiToken kills refresh', async () => {
    const { prisma } = await import('./helpers');
    await prisma.apiToken.updateMany({ where: { name: 'Phone via OAuth' }, data: { revokedAt: new Date() } });
    const res = await postForm(tokenEndpoint, '/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text).error_description).toMatch(/revoked/);
  });
});
