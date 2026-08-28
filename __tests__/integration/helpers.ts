import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { hashToken, ALL_SCOPES } from '@/lib/apiAuth';
import { seedUserDefaults } from '@/lib/seedDefaults';
import { resetRateLimitsForTests } from '@/lib/rateLimit';

export { prisma };

let ipCounter = 0;

export async function resetDb() {
  // Order matters only for non-cascading FKs; TRUNCATE ... CASCADE handles it all.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "EntryRevision", "AuthEvent", "GuidelineRevision", "GuidelineSection",
      "MealItemNutrient", "MealItem", "Meal", "Weight", "Target", "WeightGoal",
      "DayActivity", "DayAdjustment",
      "Nutrient", "MealType", "ApiToken", "Session", "Invite", "User" CASCADE
  `);
  resetRateLimitsForTests();
  globalThis.__testSession = null;
}

export async function createUser(
  overrides: { email?: string; role?: 'USER' | 'ADMIN'; name?: string; timezone?: string } = {}
) {
  const email = overrides.email ?? `user-${randomBytes(4).toString('hex')}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash('password-123', 4),
      name: overrides.name ?? 'Test User',
      role: overrides.role ?? 'USER',
      timezone: overrides.timezone ?? 'UTC',
    },
  });
  if (user.role === 'USER') {
    await prisma.$transaction(async (tx) => seedUserDefaults(tx, user.id));
  }
  return user;
}

export async function createToken(userId: string, scopes: string[] = [...ALL_SCOPES], name = 'Test agent') {
  const raw = `ntk_${randomBytes(24).toString('hex')}`;
  const token = await prisma.apiToken.create({
    data: { userId, name, tokenHash: hashToken(raw), scopes },
  });
  return { raw, token };
}

export function setSession(
  user: { id: string; email: string; name: string; role: 'USER' | 'ADMIN'; mustChangePassword?: boolean } | null
) {
  globalThis.__testSession = user
    ? {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mustChangePassword: user.mustChangePassword ?? false,
        },
      }
    : null;
}

type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<NextResponse>;

export async function call(
  handler: Handler,
  method: string,
  url: string,
  opts: { body?: unknown; token?: string; params?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {
    'x-forwarded-for': `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  const req = new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
  const res = await handler(req, { params: opts.params ?? {} });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json: json as never, text };
}

/** Today's date string in UTC (test users default to the UTC timezone). */
export function today(offset = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
