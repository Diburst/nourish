import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, createUser, createToken, call, today } from './helpers';
import { POST as mcpPost, GET as mcpGet } from '@/app/api/mcp/route';
import { POST as mcpTokenPost } from '@/app/api/mcp/[token]/route';
import { MCP_TOOLS } from '@/lib/mcp/tools';

let token: string;
let readOnlyToken: string;

function rpc(id: number | null, method: string, params?: Record<string, unknown>) {
  return { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) };
}

async function mcp(body: unknown, bearer?: string) {
  return call(mcpPost, 'POST', '/api/mcp', { body, token: bearer });
}

beforeAll(async () => {
  await resetDb();
  const user = await createUser();
  token = (await createToken(user.id, undefined, 'Phone agent')).raw;
  readOnlyToken = (await createToken(user.id, ['nutrition:read'])).raw;
});

describe('MCP endpoint auth', () => {
  it('401 without a token', async () => {
    const res = await mcp(rpc(1, 'initialize', { protocolVersion: '2025-06-18' }));
    expect(res.status).toBe(401);
  });

  it('401 with a bogus path token', async () => {
    const res = await call(mcpTokenPost, 'POST', '/api/mcp/ntk_bogus', {
      body: rpc(1, 'ping'),
      params: { token: 'ntk_bogus' },
    });
    expect(res.status).toBe(401);
  });

  it('GET is 405 (stateless server)', async () => {
    const res = await call(mcpGet, 'GET', '/api/mcp', { token });
    expect(res.status).toBe(405);
  });
});

describe('MCP lifecycle', () => {
  it('initialize negotiates the protocol and describes the server', async () => {
    const res = await mcp(rpc(1, 'initialize', { protocolVersion: '2025-03-26' }), token);
    expect(res.status).toBe(200);
    const body = res.json as { result: { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools: unknown } } };
    expect(body.result.protocolVersion).toBe('2025-03-26');
    expect(body.result.serverInfo.name).toBe('nourish');
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it('unknown protocol falls back to the latest supported', async () => {
    const res = await mcp(rpc(1, 'initialize', { protocolVersion: '1999-01-01' }), token);
    expect((res.json as { result: { protocolVersion: string } }).result.protocolVersion).toBe('2025-06-18');
  });

  it('notifications get 202 with no body', async () => {
    const res = await mcp(rpc(null, 'notifications/initialized'), token);
    expect(res.status).toBe(202);
    expect(res.text).toBe('');
  });

  it('unknown method → -32601', async () => {
    const res = await mcp(rpc(9, 'sampling/createMessage'), token);
    expect((res.json as { error: { code: number } }).error.code).toBe(-32601);
  });
});

describe('MCP tools', () => {
  it('tools/list returns every tool for a full-scope token', async () => {
    const res = await mcp(rpc(2, 'tools/list'), token);
    const tools = (res.json as { result: { tools: { name: string; inputSchema: unknown }[] } }).result.tools;
    expect(tools).toHaveLength(MCP_TOOLS.length);
    expect(tools.map((t) => t.name)).toContain('log_meal');
    expect(tools.every((t) => t.inputSchema)).toBe(true);
  });

  it('tools/list hides write tools from a read-only token', async () => {
    const res = await mcp(rpc(2, 'tools/list'), readOnlyToken);
    const names = (res.json as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names).toContain('get_summary');
    expect(names).not.toContain('log_meal');
    expect(names).not.toContain('set_targets');
    expect(names).not.toContain('get_guidelines'); // needs guidelines:read
  });

  it('tools/call log_meal creates a real meal through the REST layer', async () => {
    const res = await mcp(
      rpc(3, 'tools/call', {
        name: 'log_meal',
        arguments: {
          date: today(),
          mealType: 'LUNCH',
          items: [{ name: 'Connector bowl', quantity: 1, nutrients: { KCAL: 640, PROT: 41 } }],
        },
      }),
      token
    );
    expect(res.status).toBe(200);
    const result = (res.json as { result: { content: { text: string }[]; isError: boolean } }).result;
    expect(result.isError).toBe(false);
    const payload = JSON.parse(result.content[0].text) as { meal: { items: { name: string }[] }; dayTotals: Record<string, number> };
    expect(payload.meal.items[0].name).toBe('Connector bowl');
    expect(payload.dayTotals.KCAL).toBe(640);

    const days = await mcp(rpc(4, 'tools/call', { name: 'get_days', arguments: { from: today(), to: today() } }), token);
    const daysPayload = JSON.parse(
      (days.json as { result: { content: { text: string }[] } }).result.content[0].text
    ) as { days: { logged: boolean }[] };
    expect(daysPayload.days[0].logged).toBe(true);
  });

  it('tools/call surfaces REST errors as {error} with isError', async () => {
    const res = await mcp(
      rpc(5, 'tools/call', {
        name: 'log_meal',
        arguments: { mealType: 'LUNCH', items: [{ name: 'Mystery', nutrients: { NOPE: 1 } }] },
      }),
      token
    );
    const result = (res.json as { result: { content: { text: string }[]; isError: boolean } }).result;
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/Unknown nutrient code/);
  });

  it('scope enforcement still applies on call even if a tool name is guessed', async () => {
    const res = await mcp(
      rpc(6, 'tools/call', { name: 'set_targets', arguments: { values: { KCAL: 1800 } } }),
      readOnlyToken
    );
    const result = (res.json as { result: { content: { text: string }[]; isError: boolean } }).result;
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toMatch(/targets:write/);
  });

  it('unknown tool → -32602', async () => {
    const res = await mcp(rpc(7, 'tools/call', { name: 'drop_tables', arguments: {} }), token);
    expect((res.json as { error: { code: number } }).error.code).toBe(-32602);
  });

  it('the tokenized URL works end to end (phone connector path)', async () => {
    const res = await call(mcpTokenPost, 'POST', `/api/mcp/${token}`, {
      body: rpc(8, 'tools/call', { name: 'get_summary', arguments: { range: '7d' } }),
      params: { token },
    });
    expect(res.status).toBe(200);
    const result = (res.json as { result: { content: { text: string }[]; isError: boolean } }).result;
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toHaveProperty('streak');
  });

  it('handles JSON-RPC batches', async () => {
    const res = await mcp([rpc(10, 'ping'), rpc(11, 'tools/list')], token);
    const body = res.json as { id: number }[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((m) => m.id).sort()).toEqual([10, 11]);
  });
});
