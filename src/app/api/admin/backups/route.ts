import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import { apiRoute, guard } from '@/lib/route';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const execAsync = promisify(exec);
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(process.cwd(), 'backups');

let lastStatus: { at: string; ok: boolean; file?: string; error?: string } | null = null;

async function listBackups() {
  try {
    const files = await readdir(BACKUP_DIR);
    const out = [];
    for (const f of files.filter((f) => f.endsWith('.sql.gz')).sort().reverse().slice(0, 30)) {
      const s = await stat(path.join(BACKUP_DIR, f));
      out.push({ file: f, bytes: s.size, createdAt: s.mtime.toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}

/** GET — recent backup files + last run status. */
export const GET = apiRoute('adminGetBackups', async (request: NextRequest) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/backups', admin: true });
  if (error) return error;
  void auth;
  return NextResponse.json({ backups: await listBackups(), lastStatus });
});

/**
 * POST — "Backup now": runs the same pg_dump as the backup sidecar, into the shared
 * ./backups mount, so both paths produce identical files.
 */
export const POST = apiRoute('adminPostBackup', async (request: NextRequest) => {
  const { auth, error } = await guard(request, { endpoint: '/api/admin/backups', admin: true });
  if (error) return error;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 500 });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = `nourish-${stamp}.sql.gz`;
  const target = path.join(BACKUP_DIR, file);
  try {
    await execAsync(`mkdir -p ${JSON.stringify(BACKUP_DIR)}`);
    await execAsync(
      `pg_dump --no-owner --no-privileges ${JSON.stringify(dbUrl)} | gzip > ${JSON.stringify(target)}`,
      { timeout: 120_000, shell: '/bin/sh' }
    );
    lastStatus = { at: new Date().toISOString(), ok: true, file };
    logger.info('Backup complete', { adminId: auth.userId, file });
    return NextResponse.json({ ok: true, file }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'pg_dump failed';
    lastStatus = { at: new Date().toISOString(), ok: false, error: message };
    logger.error('Backup failed', { adminId: auth.userId, error: message });
    return NextResponse.json({ error: 'Backup failed; check server logs' }, { status: 500 });
  }
});
