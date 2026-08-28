import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { apiRoute, guard } from '@/lib/route';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/skip — "Explore without an agent". Stamps
 * onboardingSkippedAt so the soft wall stops redirecting; the setup banner
 * persists until setup actually completes.
 */
export const POST = apiRoute('skipOnboarding', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/onboarding/skip',
    sessionOnly: true,
    write: true,
  });
  if (error) return error;

  await prisma.user.updateMany({
    where: { id: auth.userId, onboardingSkippedAt: null },
    data: { onboardingSkippedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
});
