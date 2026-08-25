import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard, parseBody } from '@/lib/route';
import { postGuidelineSchema } from '@/lib/validation';
import { serializeSection } from '@/lib/guidelineService';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

/** GET /api/guidelines — all sections with their current bodies. Global (cross-user). */
export const GET = apiRoute('getGuidelines', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/guidelines',
    scope: 'guidelines:read',
  });
  if (error) return error;
  void auth;
  const sections = await prisma.guidelineSection.findMany({ orderBy: { sortOrder: 'asc' } });
  const out = [];
  for (const s of sections) {
    const serialized = await serializeSection(s.slug);
    if (serialized) out.push(serialized);
  }
  return NextResponse.json({ sections: out });
});

/** POST /api/guidelines — create a section (with its first revision). */
export const POST = apiRoute('postGuideline', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/guidelines',
    scope: 'guidelines:write',
    write: true,
  });
  if (error) return error;
  const { body, error: bodyError } = await parseBody(request, postGuidelineSchema);
  if (bodyError) return bodyError;

  const existing = await prisma.guidelineSection.findUnique({ where: { slug: body.slug } });
  if (existing) {
    return NextResponse.json({ error: 'Section already exists' }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    const max = await tx.guidelineSection.aggregate({ _max: { sortOrder: true } });
    const section = await tx.guidelineSection.create({
      data: {
        slug: body.slug,
        title: body.title,
        sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1,
      },
    });
    await tx.guidelineRevision.create({
      data: {
        sectionId: section.id,
        body: body.body,
        links: (body.links ?? []) as Prisma.InputJsonValue,
        authorUserId: auth.tokenId ? null : auth.userId,
        tokenId: auth.tokenId,
      },
    });
  });

  const serialized = await serializeSection(body.slug);
  return NextResponse.json(serialized, { status: 201 });
});
