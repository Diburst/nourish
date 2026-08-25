#!/usr/bin/env node
/**
 * Applies each prisma/migrations/<name>/migration.sql in order, using only `pg`
 * (which ships in the standalone server bundle). No Prisma CLI in the production
 * image — its dependency tree (engines, @prisma/config, effect, …) is not
 * shippable piecemeal.
 *
 * Ledger-compatible with `prisma migrate deploy`: applied migrations are recorded in
 * _prisma_migrations with the same shape, so running the real CLI in dev and this
 * script in production agree with each other.
 */
import { readdir, readFile } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[migrate] DATABASE_URL is not set. Refusing to start.');
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function ensureLedger() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);
}

async function appliedNames() {
  const res = await client.query(
    `SELECT migration_name FROM "_prisma_migrations"
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
  );
  return new Set(res.rows.map((r) => r.migration_name));
}

async function migrationDirs() {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

try {
  await client.connect();
  await ensureLedger();
  const applied = await appliedNames();
  const dirs = await migrationDirs();
  let ran = 0;

  for (const name of dirs) {
    if (applied.has(name)) continue;
    const sqlPath = path.join(MIGRATIONS_DIR, name, 'migration.sql');
    const sql = await readFile(sqlPath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    console.log(`[migrate] applying ${name}`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
         VALUES ($1, $2, $3, now(), 1)`,
        [randomUUID(), checksum, name]
      );
      await client.query('COMMIT');
      ran++;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[migrate] ${name} failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }

  console.log(ran === 0 ? '[migrate] up to date — nothing to apply.' : `[migrate] applied ${ran} migration${ran === 1 ? '' : 's'}.`);
} catch (error) {
  console.error(`[migrate] failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
