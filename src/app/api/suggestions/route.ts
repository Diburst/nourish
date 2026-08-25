import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';
import { buildSuggestions } from '@/lib/summaryService';

export const dynamic = 'force-dynamic';

/** GET /api/suggestions — lagging micros (by pace) + matching guideline links. */
export const GET = apiRoute('getSuggestions', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/suggestions',
    nutrition: true,
    scope: 'nutrition:read',
  });
  if (error) return error;
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await buildSuggestions({
    id: user.id,
    timezone: user.timezone,
    createdAt: user.createdAt,
  });
  return NextResponse.json(result);
});
