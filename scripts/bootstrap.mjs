#!/usr/bin/env node
/**
 * Runs before the server starts (dev and production):
 * 1. Validates the environment — refuses to start with anything missing.
 * 2. Bootstraps the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when no admin exists.
 */
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(16),
  NEXTAUTH_URL: z.string().url(),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  console.error(`[bootstrap] Invalid environment: ${missing}. Refusing to start.`);
  process.exit(1);
}
const env = parsed.data;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

try {
  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
  if (adminCount === 0) {
    await prisma.user.create({
      data: {
        email: env.ADMIN_EMAIL.toLowerCase(),
        passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, 12),
        name: 'Admin',
        role: 'ADMIN',
        mustChangePassword: true,
      },
    });
    console.log(`[bootstrap] Created first admin: ${env.ADMIN_EMAIL}`);
  } else {
    console.log('[bootstrap] Admin exists — nothing to do.');
  }
} catch (error) {
  console.error('[bootstrap] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
