/**
 * v1.6 docs layer: get_docs, initialize.instructions, docs resources, _hint
 * plumbing, pairing stamps, and the docs drift guard.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, createUser, createToken, call, prisma, today } from './helpers';
import { POST as mcpPost } from '@/app/api/mcp/route';
import { MCP_TOOLS } from '@/lib/mcp/tools';
import { DOCS, DOC_TOPICS, docsIndex, getDoc } from '@/lib/mcp/docs';

let user: Awaited<ReturnType<typeof createUser>>;
let token: string;

function rpc(id: number | null, method: string, params?: Record<string, unknown>) {
  return { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) };
}

async function mcp(body: unknown, bearer?: string) {
  return call(mcpPost, 'POST', '/api/mcp', { body, token: bearer });
}

function toolText(res: { json: unknown }): string {
  return (res.json as { result: { content: { text: string }[] } }).result.content[0].text;
}

beforeAll(async () => {
  await resetDb();
  user = await createUser();
  token = (await createToken(user.id)).raw;
});

describe('docs drift guard', () => {
  it('every registered tool name appears in the docs corpus (or instructions)', async () => {
    const corpus = Object.values(DOCS).join('\n') + docsIndex();
    for (const tool of MCP_TOOLS) {
      expect(corpus, `tool ${tool.name} is undocumented`).toContain(tool.name);
    }
  });

  it('every doc topic is reachable from the index and resolves', () => {
    const index = docsIndex();
    for (const topic of DOC_TOPICS) {
      expect(index).toContain(topic);
      const doc = getDoc(topic);
      expect(doc.ok).toBe(true);
    }
  });

  it('unknown topic returns a teaching error listing valid topics', () => {
    const doc = getDoc('bogus');
    expect(doc.ok).toBe(false);
    if (!doc.ok) expect(doc.error).toContain('targets-vs-adjustments');
  });
});

describe('get_docs over MCP', () => {
  it('is listed regardless of scopes and returns markdown', async () => {
    const bare = (await createToken(user.id, [])).raw;
    const list = await mcp(rpc(1, 'tools/list'), bare);
    const names = (list.json as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names).toEqual(['get_docs']);

    const res = await mcp(rpc(2, 'tools/call', { name: 'get_docs', arguments: { topic: 'activity' } }), bare);
    const text = toolText(res);
    expect(text).toContain('log_activity');
    expect(text).toContain('proteinG defaults to 0');
  });

  it('no topic returns the index plus overview', async () => {
    const res = await mcp(rpc(1, 'tools/call', { name: 'get_docs', arguments: {} }), token);
    const text = toolText(res);
    expect(text).toContain('targets-vs-adjustments');
    expect(text).toContain('the agent is the primary writer');
  });
});

describe('initialize + resources', () => {
  it('initialize carries the long-form instructions', async () => {
    const res = await mcp(rpc(1, 'initialize', { protocolVersion: '2025-06-18' }), token);
    const instructions = (res.json as { result: { instructions: string } }).result.instructions;
    expect(instructions).toContain('log_activity');
    expect(instructions).toContain('set_targets');
    expect(instructions).toContain('idempotencyKey');
    expect(instructions.length).toBeGreaterThan(800);
  });

  it('docs are exposed as resources and readable', async () => {
    const list = await mcp(rpc(1, 'resources/list'), token);
    const resources = (list.json as { result: { resources: { uri: string }[] } }).result.resources;
    expect(resources.map((r) => r.uri)).toContain('nourish://docs/targets-vs-adjustments');

    const read = await mcp(
      rpc(2, 'resources/read', { uri: 'nourish://docs/targets-vs-adjustments' }),
      token
    );
    const contents = (read.json as { result: { contents: { text: string }[] } }).result.contents;
    expect(contents[0].text).toContain('set_targets');
  });
});

describe('pairing stamps and hints', () => {
  it('the first successful dispatch stamps firstMcpCallAt; every dispatch stamps lastUsedAt', async () => {
    const freshUser = await createUser();
    const { raw, token: tokenRow } = await createToken(freshUser.id);
    expect((await prisma.user.findUnique({ where: { id: freshUser.id } }))!.firstMcpCallAt).toBeNull();
    await mcp(rpc(1, 'ping'), raw);
    // fire-and-forget stamps — allow the promise to settle
    await new Promise((r) => setTimeout(r, 50));
    const after = await prisma.user.findUnique({ where: { id: freshUser.id } });
    expect(after!.firstMcpCallAt).not.toBeNull();
    const tokenAfter = await prisma.apiToken.findUnique({ where: { id: tokenRow.id } });
    expect(tokenAfter!.lastUsedAt).not.toBeNull();
  });

  it('incomplete accounts get a targets hint, then a weight hint, then none', async () => {
    const freshUser = await createUser();
    const raw = (await createToken(freshUser.id)).raw;

    const r1 = await mcp(rpc(1, 'tools/call', { name: 'get_targets', arguments: {} }), token && raw);
    expect(toolText(r1)).toContain('No targets set yet');

    await mcp(
      rpc(2, 'tools/call', { name: 'set_targets', arguments: { values: { KCAL: 2300, PROT: 160 } } }),
      raw
    );
    const r2 = await mcp(rpc(3, 'tools/call', { name: 'get_targets', arguments: {} }), raw);
    expect(toolText(r2)).toContain('No weight recorded yet');

    await mcp(rpc(4, 'tools/call', { name: 'log_weight', arguments: { value: 78.4, weightUnit: 'kg' } }), raw);
    const r3 = await mcp(rpc(5, 'tools/call', { name: 'get_targets', arguments: {} }), raw);
    expect(toolText(r3)).not.toContain('_hint');
  });

  it('set_targets on an account with recent activity restates the distinction once', async () => {
    // main user: give them targets, weight, and an activity, complete setup
    await mcp(
      rpc(1, 'tools/call', { name: 'set_targets', arguments: { values: { KCAL: 2000, PROT: 100 } } }),
      token
    );
    await mcp(rpc(2, 'tools/call', { name: 'log_weight', arguments: { value: 80, weightUnit: 'kg' } }), token);
    await mcp(
      rpc(3, 'tools/call', { name: 'log_activity', arguments: { kcal: 500, proteinG: 20, label: 'run' } }),
      token
    );
    // ensure the latch has been observed (getAccountStatus stamps completion)
    const { getAccountStatus } = await import('@/lib/onboarding');
    await getAccountStatus(user.id);

    const res = await mcp(
      rpc(4, 'tools/call', { name: 'set_targets', arguments: { values: { KCAL: 2100, PROT: 105 } } }),
      token
    );
    expect(toolText(res)).toContain('log_activity is the right tool');

    // and a read tool on the now-complete account carries no hint
    const read = await mcp(rpc(5, 'tools/call', { name: 'get_targets', arguments: {} }), token);
    expect(toolText(read)).not.toContain('_hint');
  });

  it('MCP dispatch is never gated by onboarding state', async () => {
    // A user who never completed onboarding can still call every tool.
    const freshUser = await createUser();
    const raw = (await createToken(freshUser.id)).raw;
    const status = await prisma.user.findUnique({ where: { id: freshUser.id } });
    expect(status!.onboardingCompletedAt).toBeNull();
    const res = await mcp(
      rpc(1, 'tools/call', { name: 'log_meal', arguments: { mealType: 'LUNCH', items: [{ name: 'toast', nutrients: { KCAL: 200 } }] } }),
      raw
    );
    expect(res.status).toBe(200);
    const body = res.json as { result: { isError?: boolean } };
    expect(body.result.isError ?? false).toBe(false);
  });
});
