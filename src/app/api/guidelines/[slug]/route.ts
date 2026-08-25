import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody, notFound } from '@/lib/route';
import { putGuidelineSchema, patchGuidelineSchema } from '@/lib/validation';
import { getSectionWithCurrent, serializeSection, patchHeadingBlock } from '@/lib/guidelineService';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const GET = apiRoute('getGuideline', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/guidelines/[slug]',
    scope: 'guidelines:read',
  });
  if (error) return error;
  void auth;
  const serialized = await serializeSection(params.slug);
  if (!serialized) return notFound('Section not found');
  return NextResponse.json(serialized);
});

/** PUT — replace the full body (new revision; links carry forward). */
export const PUT = apiRoute('putGuideline', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/guidelines/[slug]',
    scope: 'guidelines:write',
    write: true,
    bodyBytes: 300 * 1024,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, putGuidelineSchema);
  if (bodyError) return bodyError;

  const found = await getSectionWithCurrent(params.slug);
  if (!found) return notFound('Section not found');

  await prisma.$transaction(async (tx) => {
    if (body.title !== undefined || body.sortOrder !== undefined) {
      await tx.guidelineSection.update({
        where: { id: found.section.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        },
      });
    }
    await tx.guidelineRevision.create({
      data: {
        sectionId: found.section.id,
        body: body.body,
        links: (found.current?.links ?? []) as Prisma.InputJsonValue,
        authorUserId: auth.tokenId ? null : auth.userId,
        tokenId: auth.tokenId,
      },
    });
  });
  return NextResponse.json(await serializeSection(params.slug));
});

/** PATCH — append-or-replace one `## heading` block. */
export const PATCH = apiRoute('patchGuideline', async (request: NextRequest, { params }) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/guidelines/[slug]',
    scope: 'guidelines:write',
    write: true,
    bodyBytes: 300 * 1024,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, patchGuidelineSchema);
  if (bodyError) return bodyError;

  const found = await getSectionWithCurrent(params.slug);
  if (!found) return notFound('Section not found');

  const newBody = patchHeadingBlock(found.current?.body ?? '', body.heading, body.content);
  await prisma.guidelineRevision.create({
    data: {
      sectionId: found.section.id,
      body: newBody,
      links: (found.current?.links ?? []) as Prisma.InputJsonValue,
      authorUserId: auth.tokenId ? null : auth.userId,
      tokenId: auth.tokenId,
    },
  });
  return NextResponse.json(await serializeSection(params.slug));
});
