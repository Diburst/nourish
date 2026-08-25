import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { guidelineLinks } from '@/lib/validation';
import { getSectionWithCurrent, serializeSection } from '@/lib/guidelineService';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const putLinksSchema = z.object({ links: guidelineLinks });

/** PUT — replace the section's links array (new revision, body carried forward). */
export const PUT = apiRoute('putGuidelineLinks', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/guidelines/[slug]/links',
    scope: 'guidelines:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, putLinksSchema);
  if (bodyError) return bodyError;

  const found = await getSectionWithCurrent(params.slug);
  if (!found) return notFound('Section not found');

  await prisma.guidelineRevision.create({
    data: {
      sectionId: found.section.id,
      body: found.current?.body ?? '',
      links: body.links as Prisma.InputJsonValue,
      authorUserId: auth.tokenId ? null : auth.userId,
      tokenId: auth.tokenId,
    },
  });
  return NextResponse.json(await serializeSection(params.slug));
});
