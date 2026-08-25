#!/usr/bin/env node
/**
 * Runs before the server starts (dev and production):
 * 1. Validates the environment — refuses to start with anything missing.
 * 2. Bootstraps the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when no admin exists.
 *
 * Deliberately depends only on `pg` and `bcryptjs`, both of which ship in the
 * standalone server bundle (zod and the generated Prisma client are bundled into the
 * server and are not importable from a standalone script).
 */
import { randomBytes } from 'crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const problems = [];
function requireVar(name, test, hint) {
  const value = process.env[name];
  if (!value || !test(value)) problems.push(`${name} ${hint}`);
  return value ?? '';
}

const databaseUrl = requireVar('DATABASE_URL', (v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// URL');
requireVar('NEXTAUTH_SECRET', (v) => v.length >= 16, 'must be at least 16 characters (openssl rand -base64 32)');
requireVar('NEXTAUTH_URL', (v) => /^https?:\/\//.test(v), 'must be an http(s) URL');
const adminEmail = requireVar('ADMIN_EMAIL', (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'must be an email address');
const adminPassword = requireVar('ADMIN_PASSWORD', (v) => v.length >= 8, 'must be at least 8 characters');

if (problems.length > 0) {
  console.error(`[bootstrap] Invalid environment:\n  - ${problems.join('\n  - ')}\nRefusing to start.`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const admins = await client.query(`SELECT count(*)::int AS n FROM "User" WHERE role = 'ADMIN'`);
  if (admins.rows[0].n === 0) {
    const id = `admin-${randomBytes(12).toString('hex')}`;
    const hash = await bcrypt.hash(adminPassword, 12);
    await client.query(
      `INSERT INTO "User" (id, email, "passwordHash", name, role, "mustChangePassword")
       VALUES ($1, $2, $3, 'Admin', 'ADMIN', true)
       ON CONFLICT (email) DO NOTHING`,
      [id, adminEmail.toLowerCase(), hash]
    );
    console.log(`[bootstrap] Created first admin: ${adminEmail}`);
  } else {
    console.log('[bootstrap] Admin exists — nothing to do.');
  }
} catch (error) {
  console.error('[bootstrap] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
