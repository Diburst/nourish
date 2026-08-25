import { NextRequest } from 'next/server';
import { apiRoute } from '@/lib/route';
import { mcpPost, mcpGet, mcpDelete } from '@/lib/mcp/http';

export const dynamic = 'force-dynamic';

/** MCP over Streamable HTTP — authenticate with `Authorization: Bearer ntk_...`. */
export const POST = apiRoute('mcp', (request: NextRequest) => mcpPost(request));
export const GET = apiRoute('mcp', async () => mcpGet());
export const DELETE = apiRoute('mcp', async () => mcpDelete());
