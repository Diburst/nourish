import { NextRequest, NextResponse } from 'next/server';
import { apiRoute, guard } from '@/lib/route';
import { getAccountStatus } from '@/lib/onboarding';

export const dynamic = 'force-dynamic';

/**
 * GET /api/onboarding/status — the one source of truth for "does this account
 * work": setup steps + live connection state. Session-only (the wizard and the
 * banners poll it); read-cheap under the existing read budget. The MCP endpoint
 * is NEVER gated by any of this — the agent is what satisfies the gate.
 */
export const GET = apiRoute('getOnboardingStatus', async (request: NextRequest) => {
  const { auth, error } = await guard(request, {
    endpoint: '/api/onboarding/status',
    sessionOnly: true,
  });
  if (error) return error;

  const status = await getAccountStatus(auth.userId);
  return NextResponse.json({
    steps: status.steps,
    setupComplete: status.setupComplete,
    connection: status.connection,
    skipped: status.skipped,
    mcpPublicUrl: process.env.MCP_PUBLIC_URL || null,
  });
});
