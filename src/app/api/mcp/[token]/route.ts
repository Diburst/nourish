import { NextRequest } from 'next/server';
import { apiRoute } from '@/lib/route';
import { mcpPost, mcpGet, mcpDelete } from '@/lib/mcp/http';

export const dynamic = 'force-dynamic';

/**
 * MCP over Streamable HTTP with the token in the URL — for clients that cannot set
 * headers (claude.ai custom connectors, phones). The URL is the secret: share it only
 * with the agent, and revoke the token in Settings to kill it.
 */
export const POST = apiRoute('mcp', (request: NextRequest, { params }) => mcpPost(request, params.token));
export const GET = apiRoute('mcp', async () => mcpGet());
export const DELETE = apiRoute('mcp', async () => mcpDelete());
