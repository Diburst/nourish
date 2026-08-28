/**
 * Stateless MCP Streamable-HTTP endpoint logic.
 *
 * Setup for a client is a single URL — no installs:
 *   https://<host>/api/mcp                     with an Authorization: Bearer ntk_... header
 *   https://<host>/api/mcp/<ntk_token>         for clients that cannot set headers
 *                                              (claude.ai / phone custom connectors)
 *
 * Stateless by design: every POST carries the token, no Mcp-Session-Id is issued, and
 * responses are plain JSON (the spec allows servers to answer without an SSE stream).
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/apiAuth';
import { applyRateLimit } from '@/lib/rateLimit';
import { logger } from '@/lib/logger';
import { MCP_TOOLS, toolsForScopes } from '@/lib/mcp/tools';
import { DOC_TOPICS, getDoc } from '@/lib/mcp/docs';

/**
 * The highest-leverage 400 words in the project: injected into every session that
 * connects. Everything longer is lazy-loaded through get_docs.
 */
const INSTRUCTIONS = `Nourish is a nutrition tracker where YOU are the primary writer: the human tells you what they ate, weighed and did; you log it; they read the trends. There is no food diary UI — if you don't write it, it doesn't exist.

Data model in five lines:
- Meals are SLOTS, unique per (date, mealType) — one Lunch per day; SNACK and DRINK each hold the whole day's snacks/drinks. Logging again appends items.
- Item nutrition is PER SINGLE UNIT × quantity. Never send duplicate items — use quantity: 2.
- Targets are append-only and effective-dated; past days keep the targets they were scored against.
- Every write is soft-deleted and revisioned; the user sees a full audit feed.
- Dates are YYYY-MM-DD in the user's local timezone; omitted dates mean today.

Golden rules:
- Call list_nutrients and get_targets before your first write of a session. Never invent nutrient codes.
- Always pass an idempotencyKey on writes so retries are safe.
- THE DISTINCTION THAT MATTERS MOST: a workout raises today's energy and protein allowance only — call log_activity (and pass proteinG in the same call; it defaults to 0). It never carries forward and never changes the baseline. set_targets is for lasting goal changes and does carry forward. "I ran today" is log_activity; "from now on" is set_targets.
- Entries the human edited are pinned; changing them needs override: true — only when they asked.

Errors come back as {"error": ...} with code and fix fields when there is a smarter move. Results may carry a _hint field while the account is incomplete — follow it.

For playbooks (logging patterns, targets vs adjustments, onboarding prompts, error recovery), call get_docs — no topic returns the index.`;

/** Setup nudges while the account is incomplete; the targets-vs-adjustments reminder on set_targets. */
async function buildHint(
  auth: { userId: string; setupComplete: boolean },
  toolName: string
): Promise<string | null> {
  if (!auth.setupComplete) {
    const { getAccountStatus } = await import('@/lib/onboarding');
    const status = await getAccountStatus(auth.userId);
    if (status.hint) return status.hint;
  }
  if (toolName === 'set_targets') {
    const { hasRecentActivity } = await import('@/lib/activityService');
    const { todayInTz } = await import('@/lib/dates');
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { timezone: true } });
    if (user && (await hasRecentActivity(auth.userId, todayInTz(user.timezone)))) {
      return 'Reminder: set_targets changes the everyday goal and carries forward. For a one-day fuelling bump after a workout, log_activity is the right tool — this account has recent activity entries.';
    }
  }
  return null;
}

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_PROTOCOL = '2025-06-18';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function authenticate(request: NextRequest, pathToken?: string) {
  let raw = pathToken ? decodeURIComponent(pathToken) : '';
  if (!raw) {
    const header = request.headers.get('authorization');
    if (header?.startsWith('Bearer ')) raw = header.slice(7).trim();
  }
  if (!raw.startsWith('ntk_')) return null;
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: {
      user: { select: { disabledAt: true, role: true, firstMcpCallAt: true, onboardingCompletedAt: true } },
    },
  });
  if (!token || token.revokedAt || token.user.disabledAt || token.user.role === 'ADMIN') return null;
  // Every dispatch stamps lastUsedAt; the FIRST successful authenticated dispatch
  // stamps User.firstMcpCallAt — the pairing signal /onboarding polls for.
  prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  if (!token.user.firstMcpCallAt) {
    prisma.user
      .update({ where: { id: token.userId }, data: { firstMcpCallAt: new Date() } })
      .catch(() => {});
  }
  return {
    raw,
    scopes: token.scopes,
    tokenId: token.id,
    name: token.name,
    userId: token.userId,
    setupComplete: token.user.onboardingCompletedAt !== null,
  };
}

async function handleMessage(
  msg: JsonRpcRequest,
  auth: { raw: string; scopes: string[]; name: string; tokenId: string; userId: string; setupComplete: boolean }
): Promise<unknown | null> {
  const id = msg.id ?? null;

  // Notifications (no id) get no response body.
  if (msg.id === undefined) return null;

  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '');
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: 'nourish', version: '1.2.0' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: toolsForScopes(auth.scopes).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        const result = await tool.run(args, auth.raw);
        // Analytics: tool name + outcome only — never arguments or results.
        const { capture } = await import('@/lib/analytics');
        capture('mcp_tool_called', auth.tokenId, { tool: name, ok: result.status < 400 });
        // Teaching hints. Zero extra queries once the account is set up (except the
        // set_targets/activity distinction reminder, one cheap indexed lookup).
        if (result.status < 400 && result.body && typeof result.body === 'object' && !Array.isArray(result.body)) {
          const hint = await buildHint(auth, name);
          if (hint) (result.body as Record<string, unknown>)._hint = hint;
        }
        return rpcResult(id, {
          content: [
            {
              type: 'text',
              text: typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2),
            },
          ],
          isError: result.status >= 400,
        });
      } catch (error) {
        logger.error('MCP tool failed', {
          operation: 'mcpToolCall',
          tool: name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Internal server error' }) }],
          isError: true,
        });
      }
    }
    case 'resources/list':
      // Same strings as get_docs, at nourish://docs/{topic}, so a human can attach
      // a playbook manually from a client's resource menu.
      return rpcResult(id, {
        resources: DOC_TOPICS.map((t) => ({
          uri: `nourish://docs/${t}`,
          name: `Nourish docs: ${t}`,
          mimeType: 'text/markdown',
        })),
      });
    case 'resources/read': {
      const uri = String(msg.params?.uri ?? '');
      const m = uri.match(/^nourish:\/\/docs\/([a-z-]+)$/);
      const doc = m ? getDoc(m[1]) : null;
      if (!doc || !doc.ok) return rpcError(id, -32602, `Unknown resource: ${uri}`);
      return rpcResult(id, {
        contents: [{ uri, mimeType: 'text/markdown', text: doc.markdown }],
      });
    }
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function mcpPost(request: NextRequest, pathToken?: string): Promise<NextResponse> {
  const auth = await authenticate(request, pathToken);
  if (!auth) {
    // RFC 9728: point OAuth-capable clients at the resource metadata so they can
    // discover the authorization server and run the connect flow.
    const { publicOrigin } = await import('@/lib/oauthService');
    const origin = publicOrigin(request);
    return NextResponse.json(
      { error: 'Unauthorized: supply a valid ntk_ token' },
      {
        status: 401,
        headers: {
          'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        },
      }
    );
  }
  const rl = await applyRateLimit(request, '/api/mcp', 'read', auth.tokenId);
  if (rl) return rl;

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }

  const messages: JsonRpcRequest[] = Array.isArray(parsed) ? parsed : [parsed as JsonRpcRequest];
  const responses = [];
  for (const msg of messages) {
    const res = await handleMessage(msg, auth);
    if (res !== null) responses.push(res);
  }

  // Pure notifications → 202 Accepted with no body.
  if (responses.length === 0) return new NextResponse(null, { status: 202 });

  const payload = Array.isArray(parsed) ? responses : responses[0];
  return NextResponse.json(payload, { status: 200 });
}

/** No server-initiated stream in stateless mode. */
export function mcpGet(): NextResponse {
  return NextResponse.json(
    { error: 'This MCP endpoint is stateless: POST JSON-RPC messages here' },
    { status: 405, headers: { allow: 'POST, DELETE' } }
  );
}

/** Session teardown is a no-op for a stateless server. */
export function mcpDelete(): NextResponse {
  return new NextResponse(null, { status: 200 });
}
