import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { apiRoute } from '@/lib/route';
import { applyRateLimit } from '@/lib/rateLimit';
import { hashToken } from '@/lib/apiAuth';
import { sha256hex, wrapToken, htmlEscape } from '@/lib/oauthService';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const CODE_TTL_MS = 10 * 60 * 1000;

interface AuthParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  responseType: string;
}

function readParams(source: URLSearchParams | FormData): AuthParams {
  const get = (k: string) => {
    const v = source.get(k);
    return typeof v === 'string' ? v : '';
  };
  return {
    clientId: get('client_id'),
    redirectUri: get('redirect_uri'),
    state: get('state'),
    codeChallenge: get('code_challenge'),
    codeChallengeMethod: get('code_challenge_method') || 'S256',
    scope: get('scope'),
    responseType: get('response_type') || 'code',
  };
}

async function validateClient(p: AuthParams): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!p.clientId) return { ok: false, message: 'Missing client_id.' };
  const client = await prisma.oAuthClient.findUnique({ where: { id: p.clientId } });
  if (!client) return { ok: false, message: 'Unknown client — re-add the connector so it can re-register.' };
  if (!p.redirectUri || !client.redirectUris.includes(p.redirectUri)) {
    return { ok: false, message: 'redirect_uri does not match the registered client.' };
  }
  return { ok: true };
}

function page(body: string, status = 200): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Nourish</title>
<style>
  body { margin:0; background:#FAFAF8; color:#1C1C1A; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         display:flex; justify-content:center; padding:16vh 16px 0; }
  .card { background:#fff; border:1px solid #E7E5E1; border-radius:8px; padding:24px; width:100%; max-width:380px; }
  h1 { font-size:16px; margin:0 0 4px; display:flex; align-items:center; gap:6px; }
  p { font-size:13px; color:#8A8880; line-height:1.5; margin:8px 0; }
  input[type=password] { width:100%; box-sizing:border-box; border:1px solid #E7E5E1; border-radius:6px;
         padding:8px 10px; font-size:13px; font-family:ui-monospace,monospace; }
  button { width:100%; margin-top:12px; background:#1C1C1A; color:#fff; border:0; border-radius:6px;
         padding:9px; font-size:13px; cursor:pointer; }
  .err { color:#B3413E; font-size:13px; }
  .leaf { color:#7A9B6D; }
</style></head><body><div class="card">${body}</div></body></html>`;
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function consentForm(p: AuthParams, errorMessage?: string): NextResponse {
  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${htmlEscape(value)}">`;
  return page(`
    <h1><span class="leaf">☘</span> Connect to Nourish</h1>
    <p>An agent is asking to connect to your Nourish account. Paste one of your API tokens
       (Nourish → Settings → API tokens) to allow it. The connection gets exactly that
       token's permissions, and revoking the token disconnects it.</p>
    ${errorMessage ? `<p class="err">${htmlEscape(errorMessage)}</p>` : ''}
    <form method="POST" action="/oauth/authorize">
      ${hidden('client_id', p.clientId)}
      ${hidden('redirect_uri', p.redirectUri)}
      ${hidden('state', p.state)}
      ${hidden('code_challenge', p.codeChallenge)}
      ${hidden('code_challenge_method', p.codeChallengeMethod)}
      ${hidden('scope', p.scope)}
      ${hidden('response_type', p.responseType)}
      <input type="password" name="token" placeholder="ntk_…" autocomplete="off" autofocus required>
      <button type="submit">Allow</button>
    </form>`);
}

/** GET — render the consent form (or a dead-end error page for invalid clients). */
export const GET = apiRoute('oauthAuthorize', async (request: NextRequest) => {
  const rl = await applyRateLimit(request, '/oauth/authorize', 'auth');
  if (rl) return rl;
  const p = readParams(request.nextUrl.searchParams);
  const client = await validateClient(p);
  if (!client.ok) return page(`<h1>Cannot continue</h1><p class="err">${htmlEscape(client.message)}</p>`, 400);
  if (p.responseType !== 'code' || !p.codeChallenge || p.codeChallengeMethod !== 'S256') {
    const err = new URL(p.redirectUri);
    err.searchParams.set('error', p.responseType !== 'code' ? 'unsupported_response_type' : 'invalid_request');
    if (p.state) err.searchParams.set('state', p.state);
    return NextResponse.redirect(err, 302);
  }
  return consentForm(p);
});

/** POST — validate the pasted ntk_ token, mint a code, bounce back to the client. */
export const POST = apiRoute('oauthAuthorizeSubmit', async (request: NextRequest) => {
  const rl = await applyRateLimit(request, '/oauth/authorize', 'auth');
  if (rl) return rl;
  const form = await request.formData();
  const p = readParams(form);
  const client = await validateClient(p);
  if (!client.ok) return page(`<h1>Cannot continue</h1><p class="err">${htmlEscape(client.message)}</p>`, 400);

  const raw = String(form.get('token') ?? '').trim();
  const token = raw.startsWith('ntk_')
    ? await prisma.apiToken.findUnique({
        where: { tokenHash: hashToken(raw) },
        include: { user: { select: { disabledAt: true, role: true } } },
      })
    : null;
  if (!token || token.revokedAt || token.user.disabledAt || token.user.role === 'ADMIN') {
    return consentForm(p, 'That token is not valid (revoked, mistyped, or from an admin account). Check Settings → API tokens.');
  }

  const code = randomBytes(32).toString('base64url');
  await prisma.oAuthCode.create({
    data: {
      codeHash: sha256hex(code),
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      codeChallengeMethod: p.codeChallengeMethod,
      tokenId: token.id,
      encToken: wrapToken(raw),
      scope: p.scope || token.scopes.join(' '),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  // Opportunistic cleanup of expired codes.
  prisma.oAuthCode.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  logger.info('OAuth consent granted', { clientId: p.clientId, tokenId: token.id });

  const target = new URL(p.redirectUri);
  target.searchParams.set('code', code);
  if (p.state) target.searchParams.set('state', p.state);
  return NextResponse.redirect(target, 302);
});
