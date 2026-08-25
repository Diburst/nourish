import { NextRequest, NextResponse } from 'next/server';
import { apiRoute, guard } from '@/lib/route';

export const dynamic = 'force-dynamic';

/** GET /api/admin/settings — effective (read-only) instance settings. No secrets. */
export const GET = apiRoute('adminGetSettings', async (request: NextRequest) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/settings', admin: true });
  if (error) return error;
  void auth;
  return NextResponse.json({
    rateLimits: {
      auth: '10/min per IP',
      agentWrites: '120/min per token',
      reads: '600/min per token',
      admin: '60/min',
    },
    rateLimitBackend:
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
        ? 'upstash'
        : 'in-memory',
    loginBackoff: '5 failures → 15-min lockout',
    inviteExpiryDays: 7,
    backupRetentionDays: Number(process.env.RETENTION_DAYS ?? 14),
  });
});
