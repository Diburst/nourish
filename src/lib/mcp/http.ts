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
    include: { user: { select: { disabledAt: true, role: true } } },
  });
  if (!token || token.revokedAt || token.user.disabledAt || token.user.role === 'ADMIN') return null;
  prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { raw, scopes: token.scopes, tokenId: token.id, name: token.name };
}

async function handleMessage(
  msg: JsonRpcRequest,
  auth: { raw: string; scopes: string[]; name: string }
): Promise<unknown | null> {
  const id = msg.id ?? null;

  // Notifications (no id) get no response body.
  if (msg.id === undefined) return null;

  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '');
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'nourish', version: '1.1.0' },
        instructions:
          'Nourish nutrition tracker. Meals are slots per (date, mealType); item nutrition is per single unit — never send duplicate items, use quantity. Get valid nutrient codes from list_nutrients. Tool errors come back as {"error": "..."} JSON.',
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
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result.body, null, 2) }],
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
      return rpcResult(id, { resources: [] });
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function mcpPost(request: NextRequest, pathToken?: string): Promise<NextResponse> {
  const auth = await authenticate(request, pathToken);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized: supply a valid ntk_ token' }, { status: 401 });
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
