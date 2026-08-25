import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, notFound } from '@/lib/route';
import { serializeSection } from '@/lib/guidelineService';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/** POST — revert: copy an old revision forward as a new revision. */
export const POST = apiRoute('revertGuideline', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/guidelines/[slug]/revisions/[revisionId]/revert',
    scope: 'guidelines:write',
    write: true,
  });
  if (error) return error;

  const section = await prisma.guidelineSection.findUnique({ where: { slug: params.slug } });
  if (!section) return notFound('Section not found');
  const revision = await prisma.guidelineRevision.findFirst({
    where: { id: params.revisionId, sectionId: section.id },
  });
  if (!revision) return notFound('Revision not found');

  await prisma.guidelineRevision.create({
    data: {
      sectionId: section.id,
      body: revision.body,
      links: (revision.links ?? []) as Prisma.InputJsonValue,
      authorUserId: auth.tokenId ? null : auth.userId,
      tokenId: auth.tokenId,
    },
  });
  return NextResponse.json(await serializeSection(params.slug));
});
