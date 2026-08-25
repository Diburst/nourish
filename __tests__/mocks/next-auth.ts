/**
 * Test stub for `next-auth` (wired via vitest resolve.alias). Contract tests drive
 * the session path by setting `globalThis.__testSession`.
 */
type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  mustChangePassword: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __testSession: { user: SessionUser } | null | undefined;
}

export async function getServerSession() {
  return globalThis.__testSession ?? null;
}

export default function NextAuth() {
  return async () => new Response('not implemented in tests', { status: 501 });
}
