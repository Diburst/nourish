import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, notFound } from '@/lib/route';

export const dynamic = 'force-dynamic';

/** GET — revision history, newest first. */
export const GET = apiRoute('getGuidelineRevisions', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/guidelines/[slug]/revisions',
    scope: 'guidelines:read',
  });
  if (error) return error;
  void auth;

  const section = await prisma.guidelineSection.findUnique({ where: { slug: params.slug } });
  if (!section) return notFound('Section not found');

  const revisions = await prisma.guidelineRevision.findMany({
    where: { sectionId: section.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { author: { select: { name: true } } },
  });
  const tokenIds = [...new Set(revisions.map((r) => r.tokenId).filter((t): t is string => !!t))];
  const tokens = tokenIds.length
    ? await prisma.apiToken.findMany({ where: { id: { in: tokenIds } }, select: { id: true, name: true } })
    : [];
  const tokenName = new Map(tokens.map((t) => [t.id, t.name]));

  return NextResponse.json({
    revisions: revisions.map((r) => ({
      id: r.id,
      body: r.body,
      links: r.links,
      editedBy: r.tokenId ? (tokenName.get(r.tokenId) ?? 'revoked token') : (r.author?.name ?? null),
      createdAt: r.createdAt.toISOString(),
    })),
  });
});
