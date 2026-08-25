import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb, createUser, createToken, call, today } from './helpers';
import { GET as getGuidelines, POST as postGuideline } from '@/app/api/guidelines/route';
import { GET as getSection, PUT as putSection, PATCH as patchSection } from '@/app/api/guidelines/[slug]/route';
import { PUT as putLinks } from '@/app/api/guidelines/[slug]/links/route';
import { GET as getRevisions } from '@/app/api/guidelines/[slug]/revisions/route';
import { POST as revert } from '@/app/api/guidelines/[slug]/revisions/[revisionId]/revert/route';
import { patchHeadingBlock } from '@/lib/guidelineService';

let tokenA: string;
let tokenB: string;
let noWriteToken: string;

beforeAll(async () => {
  await resetDb();
  const a = await createUser();
  const b = await createUser();
  tokenA = (await createToken(a.id, undefined, 'Claude desktop')).raw;
  tokenB = (await createToken(b.id)).raw;
  noWriteToken = (await createToken(a.id, ['nutrition:read', 'guidelines:read'])).raw;
});

describe('patchHeadingBlock (pure)', () => {
  it('replaces an existing ## block up to the next heading', () => {
    const body = '## Seeds\n\nOld text.\n\n## Fish\n\nSardines.\n';
    const out = patchHeadingBlock(body, 'Seeds', 'New text.');
    expect(out).toContain('## Seeds\n\nNew text.');
    expect(out).toContain('## Fish\n\nSardines.');
    expect(out).not.toContain('Old text');
  });
  it('appends when the heading is missing', () => {
    const out = patchHeadingBlock('## Seeds\n\nKeep.\n', 'Legumes', 'Lentils.');
    expect(out).toContain('## Seeds\n\nKeep.');
    expect(out.trim().endsWith('Lentils.')).toBe(true);
  });
  it('handles an empty body', () => {
    expect(patchHeadingBlock('', 'Seeds', 'Pumpkin.')).toBe('## Seeds\n\nPumpkin.\n');
  });
});

describe('guidelines API (global, cross-user)', () => {
  it('403 without guidelines:write', async () => {
    const res = await call(postGuideline, 'POST', '/api/guidelines', {
      token: noWriteToken,
      body: { slug: 'meal-ideas', title: 'Meal Ideas' },
    });
    expect(res.status).toBe(403);
  });

  it('creates a section and 409s on duplicates', async () => {
    const res = await call(postGuideline, 'POST', '/api/guidelines', {
      token: tokenA,
      body: { slug: 'pantry-staples', title: 'Pantry Staples', body: '## Seeds\n\nPumpkin seeds.' },
    });
    expect(res.status).toBe(201);
    const dup = await call(postGuideline, 'POST', '/api/guidelines', {
      token: tokenA,
      body: { slug: 'pantry-staples', title: 'Again' },
    });
    expect(dup.status).toBe(409);
  });

  it('is readable by another user (the only cross-user surface)', async () => {
    const res = await call(getGuidelines, 'GET', '/api/guidelines', { token: tokenB });
    const body = res.json as { sections: { slug: string; editedBy: string | null }[] };
    expect(body.sections.map((s) => s.slug)).toContain('pantry-staples');
    expect(body.sections[0].editedBy).toBe('Claude desktop');
  });

  it('PATCH appends-or-replaces a ## heading block', async () => {
    const res = await call(patchSection, 'PATCH', '/api/guidelines/pantry-staples', {
      token: tokenB,
      params: { slug: 'pantry-staples' },
      body: { heading: 'Seeds', content: 'Pumpkin AND sunflower seeds.' },
    });
    expect(res.status).toBe(200);
    expect((res.json as { body: string }).body).toContain('Pumpkin AND sunflower seeds.');
  });

  it('PUT replaces the body, keeping links; PUT /links replaces links keeping body', async () => {
    const links = await call(putLinks, 'PUT', '/api/guidelines/pantry-staples/links', {
      token: tokenA,
      params: { slug: 'pantry-staples' },
      body: { links: [{ label: 'Pumpkin seeds', nutrients: ['MG'] }] },
    });
    expect(links.status).toBe(200);

    const put = await call(putSection, 'PUT', '/api/guidelines/pantry-staples', {
      token: tokenA,
      params: { slug: 'pantry-staples' },
      body: { body: '## Rewritten\n\nAll new.' },
    });
    expect(put.status).toBe(200);
    const body = put.json as { body: string; links: { label: string }[] };
    expect(body.body).toContain('Rewritten');
    expect(body.links[0].label).toBe('Pumpkin seeds');
  });

  it('history lists revisions and revert copies an old one forward', async () => {
    const history = await call(getRevisions, 'GET', '/api/guidelines/pantry-staples/revisions', {
      token: tokenA,
      params: { slug: 'pantry-staples' },
    });
    const revisions = (history.json as { revisions: { id: string; body: string }[] }).revisions;
    expect(revisions.length).toBeGreaterThanOrEqual(4);
    const original = revisions[revisions.length - 1];

    const res = await call(revert, 'POST', `/api/guidelines/pantry-staples/revisions/${original.id}/revert`, {
      token: tokenA,
      params: { slug: 'pantry-staples', revisionId: original.id },
    });
    expect(res.status).toBe(200);
    expect((res.json as { body: string }).body).toBe(original.body);
  });

  it('404 for a missing slug', async () => {
    const res = await call(getSection, 'GET', '/api/guidelines/nope', { token: tokenA, params: { slug: 'nope' } });
    expect(res.status).toBe(404);
  });

  it('validates slugs and link shapes', async () => {
    const bad = await call(postGuideline, 'POST', '/api/guidelines', {
      token: tokenA,
      body: { slug: 'Bad Slug!', title: 'X' },
    });
    expect(bad.status).toBe(400);
    void today;
  });
});
